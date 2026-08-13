const { query, testConnection } = require('../config/db');
const { evaluateJobMatch } = require('../services/matchingService');

/**
 * GET /api/v1/jobs
 * Returns real stored jobs strictly from MySQL `jobs` table.
 * NO MOCK FALLBACK: If DB is disconnected, returns HTTP 503. If table is empty, returns count: 0.
 */
async function getJobs(req, res) {
  try {
    const dbStatus = await testConnection();

    // Requirement 3 & 8: If MySQL is unavailable, return HTTP 503 (NEVER display mock jobs)
    if (!dbStatus.connected) {
      return res.status(503).json({
        success: false,
        error: 'Database service unavailable. Real job data could not be retrieved.',
        details: dbStatus.error
      });
    }

    // 1. Query stored jobs joined with job_sources
    const rows = await query(`
      SELECT 
        j.id,
        j.source_id,
        j.external_job_id,
        j.title,
        j.company,
        j.location,
        j.is_remote,
        j.employment_type,
        j.experience_level,
        j.min_experience_years,
        j.max_experience_years,
        j.description,
        j.job_url,
        j.posted_at,
        j.posted_at_precision,
        j.discovered_at,
        s.source_name
      FROM jobs j
      LEFT JOIN job_sources s ON j.source_id = s.id
      ORDER BY j.posted_at DESC, j.id DESC
    `);

    // Requirement 4 & 9: If jobs table is empty, return empty list (NEVER populate with mock jobs)
    if (!rows || rows.length === 0) {
      return res.status(200).json({
        success: true,
        count: 0,
        message: 'No real jobs found.',
        freshnessSummary: { veryFresh: 0, fresh: 0, notFresh: 0, unknown: 0 },
        jobs: []
      });
    }

    // 2. Fetch active candidate resume for accurate matching
    let activeResume = null;
    const resumeRows = await query(
      'SELECT * FROM resumes WHERE user_id = 1 AND is_active = TRUE ORDER BY id DESC LIMIT 1'
    );
    if (resumeRows && resumeRows.length > 0) {
      activeResume = {
        id: resumeRows[0].id,
        title: resumeRows[0].title,
        confirmedSkills: typeof resumeRows[0].confirmed_skills === 'string' ? JSON.parse(resumeRows[0].confirmed_skills) : (resumeRows[0].confirmed_skills || []),
        confirmedExperience: typeof resumeRows[0].confirmed_experience === 'string' ? JSON.parse(resumeRows[0].confirmed_experience) : (resumeRows[0].confirmed_experience || {})
      };
    }

    // 3. Normalize database rows into standard Job objects
    const normalizedJobs = rows.map(r => {
      const rawJobObj = {
        id: r.id,
        externalJobId: r.external_job_id,
        sourceId: r.source_id,
        sourceName: r.source_name || 'Direct',
        title: r.title,
        company: r.company,
        location: r.location || 'Remote',
        isRemote: Boolean(r.is_remote),
        employmentType: r.employment_type || 'Full-time',
        experienceLevel: r.experience_level || 'Mid-Senior',
        minExperienceYears: r.min_experience_years,
        maxExperienceYears: r.max_experience_years,
        description: r.description || '',
        jobUrl: r.job_url,
        postedAt: r.posted_at ? new Date(r.posted_at).toISOString() : null,
        postedAtPrecision: r.posted_at_precision || 'UNKNOWN',
        discoveredAt: r.discovered_at ? new Date(r.discovered_at).toISOString() : new Date().toISOString()
      };

      // 4. Compute 5-factor match score & 48-hour freshness evaluation
      const matchEvaluation = evaluateJobMatch(rawJobObj, activeResume);

      return {
        ...rawJobObj,
        match: matchEvaluation
      };
    });

    // 5. Sort jobs by Freshness first (VERY_FRESH > FRESH > NOT_FRESH > UNKNOWN), then score
    const freshnessRank = { VERY_FRESH: 1, FRESH: 2, NOT_FRESH: 3, UNKNOWN: 4 };
    normalizedJobs.sort((a, b) => {
      const rankA = freshnessRank[a.match.freshness.category] || 99;
      const rankB = freshnessRank[b.match.freshness.category] || 99;

      if (rankA !== rankB) return rankA - rankB;
      return b.match.scores.finalMatchScore - a.match.scores.finalMatchScore;
    });

    // 6. Summary Metadata
    const freshnessSummary = {
      veryFresh: normalizedJobs.filter(j => j.match.freshness.category === 'VERY_FRESH').length,
      fresh: normalizedJobs.filter(j => j.match.freshness.category === 'FRESH').length,
      notFresh: normalizedJobs.filter(j => j.match.freshness.category === 'NOT_FRESH').length,
      unknown: normalizedJobs.filter(j => j.match.freshness.category === 'UNKNOWN').length
    };

    return res.status(200).json({
      success: true,
      count: normalizedJobs.length,
      freshnessSummary,
      jobs: normalizedJobs
    });
  } catch (error) {
    console.error('[getJobs Controller Error]:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch jobs',
      details: error.message
    });
  }
}

module.exports = {
  getJobs
};
