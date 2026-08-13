const { registryInstance } = require('../adapters/AdapterRegistry');
const MockJobAdapter = require('../adapters/sources/MockJobAdapter');
const AdzunaApiAdapter = require('../adapters/sources/AdzunaApiAdapter');
const GreenhouseAdapter = require('../adapters/sources/GreenhouseAdapter');
const LeverAdapter = require('../adapters/sources/LeverAdapter');
const { evaluateJobMatch } = require('./matchingService');
const { evaluateAndNotifyJob } = require('./notificationService');
const { query, testConnection } = require('../config/db');

// Ensure all Phase 3 adapters are registered in registry
function initAdapters() {
  if (!registryInstance.get('MockSource')) registryInstance.register(new MockJobAdapter());
  if (!registryInstance.get('AdzunaAPI')) registryInstance.register(new AdzunaApiAdapter());
  if (!registryInstance.get('Greenhouse')) registryInstance.register(new GreenhouseAdapter());
  if (!registryInstance.get('Lever')) registryInstance.register(new LeverAdapter());
}

initAdapters();

/**
 * Orchestrates job ingestion across active adapters with deduplication,
 * 48h freshness verification, failure isolation, and high-value alert qualification.
 */
async function ingestJobsFromSources(options = {}) {
  initAdapters();

  const shouldPersist = options.persistDb !== false;

  const adapters = registryInstance.list();
  const results = {
    timestamp: new Date().toISOString(),
    totalFetched: 0,
    totalUniqueIngested: 0,
    totalDuplicatesSkipped: 0,
    adapterBreakdown: [],
    jobs: []
  };

  const processedDedupHashes = new Set();

  for (const adapterInfo of adapters) {
    const adapter = registryInstance.get(adapterInfo.sourceName);
    if (!adapter) continue;

    // Skip MockSource during regular production syncs unless explicitly invoked by name
    if (!options.sourceName && adapter.sourceName === 'MockSource') {
      continue;
    }

    // Filter by specific adapter if target is provided
    if (options.sourceName && options.sourceName.toLowerCase() !== adapter.sourceName.toLowerCase()) {
      continue;
    }

    const adapterResult = {
      sourceName: adapter.sourceName,
      sourceType: adapter.sourceType,
      fetchedCount: 0,
      ingestedCount: 0,
      duplicateCount: 0,
      status: 'SUCCESS',
      error: null
    };

    try {
      // Failure Isolation: Process adapter in isolated try-catch block
      const normalizedJobs = await adapter.process(options.params || {});
      adapterResult.fetchedCount = normalizedJobs.length;
      results.totalFetched += normalizedJobs.length;

      for (const job of normalizedJobs) {
        // Cross-source deduplication check using dedupHash
        if (processedDedupHashes.has(job.dedupHash)) {
          adapterResult.duplicateCount++;
          results.totalDuplicatesSkipped++;
          continue;
        }

        processedDedupHashes.add(job.dedupHash);

        // Evaluate 48h freshness and match scoring matrix
        const matchEval = evaluateJobMatch(job, options.userProfile || {});
        const processedJob = {
          ...job,
          match: matchEval
        };

        results.jobs.push(processedJob);
        adapterResult.ingestedCount++;
        results.totalUniqueIngested++;

        // Persist to MySQL ONLY if database connection is active and persistDb is NOT false
        if (shouldPersist) {
          await persistJobToDb(processedJob);
          await evaluateAndNotifyJob(processedJob, matchEval, { persistDb: shouldPersist });
        }
      }

    } catch (err) {
      // Adapter Failure Isolation: Log warning without failing the entire ingestion process
      console.error(`[Ingestion Adapter Failure] ${adapter.sourceName}:`, err.message);
      adapterResult.status = 'FAILED';
      adapterResult.error = err.message;
    }

    results.adapterBreakdown.push(adapterResult);
  }

  // Sort final jobs by Freshness Rank (VERY_FRESH > FRESH > NOT_FRESH > UNKNOWN) and finalMatchScore DESC
  const freshnessRank = { VERY_FRESH: 1, FRESH: 2, NOT_FRESH: 3, UNKNOWN: 4 };
  results.jobs.sort((a, b) => {
    const rankA = freshnessRank[a.match.freshness.category] || 99;
    const rankB = freshnessRank[b.match.freshness.category] || 99;
    if (rankA !== rankB) return rankA - rankB;
    return b.match.scores.finalMatchScore - a.match.scores.finalMatchScore;
  });

  return results;
}

/**
 * Persists normalized job and match evaluation into MySQL.
 */
async function persistJobToDb(job) {
  try {
    const dbStatus = await testConnection();
    if (!dbStatus.connected) return;

    // 1. Ensure source record exists in job_sources table
    let sourceId = 1;
    const sourceRows = await query('SELECT id FROM job_sources WHERE source_name = ? LIMIT 1', [job.sourceName]);
    if (sourceRows && sourceRows.length > 0) {
      sourceId = sourceRows[0].id;
    } else {
      const insSource = await query(
        'INSERT INTO job_sources (source_name, source_type, is_active) VALUES (?, ?, TRUE)',
        [job.sourceName, job.sourceType || 'API']
      );
      sourceId = insSource.insertId;
    }

    // 2. Insert into jobs table with deduplication ON DUPLICATE KEY UPDATE
    const jobSql = `
      INSERT INTO jobs (
        source_id, external_job_id, title, company, location, is_remote,
        employment_type, experience_level, min_experience_years, max_experience_years,
        description, job_url, posted_at, posted_at_precision, dedup_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        title = VALUES(title),
        location = VALUES(location),
        description = VALUES(description),
        job_url = VALUES(job_url);
    `;

function formatMysqlTimestamp(isoString) {
  if (!isoString) return null;
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 19).replace('T', ' ');
}

    const jobParams = [
      sourceId,
      job.externalJobId,
      job.title,
      job.company,
      job.location,
      job.isRemote ? 1 : 0,
      job.employmentType || 'Full-time',
      job.experienceLevel || 'Not specified',
      job.minExperienceYears,
      job.maxExperienceYears,
      job.description,
      job.jobUrl,
      formatMysqlTimestamp(job.postedAt),
      job.postedAtPrecision || 'UNKNOWN',
      job.dedupHash
    ];

    const jobResult = await query(jobSql, jobParams);
    const dbJobId = jobResult.insertId || jobResult.id;

    if (dbJobId && job.match) {
      // 3. Insert or Update job_matches
      const matchSql = `
        INSERT INTO job_matches (
          user_id, job_id, resume_id, role_match_score, skill_match_score,
          experience_match_score, location_match_score, freshness_score,
          final_match_score, priority, match_reasons, missing_skills
        )
        VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          role_match_score = VALUES(role_match_score),
          skill_match_score = VALUES(skill_match_score),
          final_match_score = VALUES(final_match_score),
          priority = VALUES(priority);
      `;

      await query(matchSql, [
        1,
        dbJobId,
        job.match.scores.roleMatchScore,
        job.match.scores.skillMatchScore,
        job.match.scores.experienceMatchScore,
        job.match.scores.locationMatchScore,
        job.match.scores.freshnessScore,
        job.match.scores.finalMatchScore,
        job.match.priority,
        JSON.stringify(job.match.reasons || []),
        JSON.stringify(job.match.missingSkills || [])
      ]);
    }
  } catch (err) {
    console.warn(`[MySQL Job Persistence Warning for ${job.externalJobId}]:`, err.message);
  }
}

module.exports = {
  ingestJobsFromSources,
  initAdapters
};
