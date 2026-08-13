const test = require('node:test');
const assert = require('node:assert/strict');

const AdzunaApiAdapter = require('../src/adapters/sources/AdzunaApiAdapter');
const GreenhouseAdapter = require('../src/adapters/sources/GreenhouseAdapter');
const LeverAdapter = require('../src/adapters/sources/LeverAdapter');
const { generateDedupHash } = require('../src/utils/dedupHash');
const { calculateFreshness } = require('../src/utils/freshness');
const { rateLimiterInstance } = require('../src/utils/rateLimiter');
const { getSyncIntervalMs } = require('../src/services/schedulerService');
const { ingestJobsFromSources } = require('../src/services/jobIngestionService');

test('1. Adzuna Normalization & Timestamp Rules', (t) => {
  const adapter = new AdzunaApiAdapter();
  const rawAdzunaItem = {
    id: '12345678',
    title: 'Senior Node.js Developer',
    company: { display_name: 'TechScale' },
    location: { display_name: 'Bangalore, India' },
    created: '2026-08-11T10:00:00Z',
    description: 'Looking for a Node.js backend developer...',
    redirect_url: 'https://www.adzuna.com/job/12345678'
  };

  const normalized = adapter.normalizeJob(rawAdzunaItem);

  assert.equal(normalized.externalJobId, '12345678');
  assert.equal(normalized.title, 'Senior Node.js Developer');
  assert.equal(normalized.company, 'TechScale');
  assert.equal(normalized.postedAt, '2026-08-11T10:00:00.000Z');
  assert.equal(normalized.postedAtPrecision, 'EXACT');
});

test('2. Greenhouse Normalization: first_published vs updated_at', (t) => {
  const adapter = new GreenhouseAdapter();

  // Item A: Valid first_published -> postedAt EXACT
  const itemWithFirstPublished = {
    id: 991,
    title: 'Backend Engineer',
    first_published: '2026-08-11T08:00:00Z',
    updated_at: '2026-08-11T14:00:00Z', // Should be ignored!
    content: '<p>Job description</p>',
    location: { name: 'Remote' }
  };

  const normA = adapter.normalizeJob(itemWithFirstPublished);
  assert.equal(normA.postedAt, '2026-08-11T08:00:00.000Z');
  assert.equal(normA.postedAtPrecision, 'EXACT');

  // Item B: Missing first_published, but has updated_at -> MUST BE NULL / UNKNOWN
  const itemWithoutFirstPublished = {
    id: 992,
    title: 'Backend Engineer',
    first_published: null,
    updated_at: '2026-08-11T14:00:00Z', // Must NOT be used!
    content: '<p>Job description</p>',
    location: { name: 'Remote' }
  };

  const normB = adapter.normalizeJob(itemWithoutFirstPublished);
  assert.equal(normB.postedAt, null);
  assert.equal(normB.postedAtPrecision, 'UNKNOWN');
});

test('3. Lever Normalization: createdAt vs updatedAt', (t) => {
  const adapter = new LeverAdapter();

  // Item A: Valid createdAt -> postedAt EXACT
  const itemWithCreatedAt = {
    id: 'lever-101',
    text: 'Node.js Systems Engineer',
    createdAt: 1786444800000, // Epoch ms
    updatedAt: 1786450000000, // Should be ignored!
    descriptionPlain: 'Backend description...',
    categories: { location: 'Bangalore' }
  };

  const normA = adapter.normalizeJob(itemWithCreatedAt);
  assert.equal(normA.postedAtPrecision, 'EXACT');
  assert.ok(normA.postedAt);

  // Item B: Missing createdAt -> MUST BE NULL / UNKNOWN
  const itemWithoutCreatedAt = {
    id: 'lever-102',
    text: 'Node.js Systems Engineer',
    createdAt: null,
    updatedAt: 1786450000000, // Must NOT be used!
    descriptionPlain: 'Backend description...',
    categories: { location: 'Bangalore' }
  };

  const normB = adapter.normalizeJob(itemWithoutCreatedAt);
  assert.equal(normB.postedAt, null);
  assert.equal(normB.postedAtPrecision, 'UNKNOWN');
});

test('4. UNKNOWN Timestamp & Freshness Integrity', (t) => {
  const refTime = new Date();

  // Verify UNKNOWN freshness
  const freshness = calculateFreshness(null, 'UNKNOWN', refTime);
  assert.equal(freshness.category, 'UNKNOWN');
  assert.equal(freshness.displayLabel, 'Posting date unavailable');
  assert.equal(freshness.freshnessScore, 0.0);
});

test('5. Deduplication Hash Generator', (t) => {
  const hash1 = generateDedupHash('Stripe', 'Node.js Developer', 'Remote', 'Build global payment APIs.');
  const hash2 = generateDedupHash('  stripe ', 'NODE.JS DEVELOPER!', 'remote', 'build global payment apis.');

  assert.equal(hash1, hash2);
  assert.equal(hash1.length, 64); // SHA-256 hex string
});

test('6. Per-Source Configurable Rate Limiting', (t) => {
  const adzunaConfig = rateLimiterInstance.getRateLimitConfig('AdzunaAPI');
  const ghConfig = rateLimiterInstance.getRateLimitConfig('Greenhouse');
  const leverConfig = rateLimiterInstance.getRateLimitConfig('Lever');

  assert.equal(typeof adzunaConfig.minDelayMs, 'number');
  assert.equal(typeof ghConfig.minDelayMs, 'number');
  assert.equal(typeof leverConfig.minDelayMs, 'number');
  assert.ok(adzunaConfig.minDelayMs > 0);
});

test('7. Scheduler Interval Configuration', (t) => {
  const defaultIntervalMs = getSyncIntervalMs();
  assert.equal(defaultIntervalMs, 1 * 60 * 60 * 1000); // Default 1 hour = 3600000 ms
});

test('8. Ingestion Failure Isolation (Mock Integration - Non-Mutating)', async (t) => {
  // Requirement 1 & 2: Use persistDb: false to prevent database mutation during unit test
  const results = await ingestJobsFromSources({ sourceName: 'MockSource', persistDb: false });

  assert.ok(results.timestamp);
  assert.ok(results.totalFetched >= 0);
  assert.ok(Array.isArray(results.adapterBreakdown));

  const mockAdapterStatus = results.adapterBreakdown.find(a => a.sourceName === 'MockSource');
  assert.ok(mockAdapterStatus);
  assert.equal(mockAdapterStatus.status, 'SUCCESS');
});

test('9. GET /api/v1/jobs Real MySQL Jobs Endpoint', async (t) => {
  const app = require('../src/app');
  const server = app.listen(5019);

  try {
    const res = await fetch('http://localhost:5019/api/v1/jobs');
    const json = await res.json();

    assert.equal(res.status, 200);
    assert.equal(json.success, true);
    assert.ok(typeof json.count === 'number');
    assert.ok(json.freshnessSummary);
    assert.ok(Array.isArray(json.jobs));

    if (json.jobs.length > 0) {
      const firstJob = json.jobs[0];
      assert.ok(firstJob.title);
      assert.ok(firstJob.company);
      assert.ok(firstJob.match);
      assert.ok(firstJob.match.scores);
      assert.ok(firstJob.match.freshness);
    }

    server.close();
  } catch (err) {
    server.close();
    throw err;
  }
});

test('10. Adzuna API 5-Query Strategy & URL Parameters', (t) => {
  const adapter = new AdzunaApiAdapter();
  assert.equal(adapter.defaultQueries.length, 5);
  assert.ok(adapter.defaultQueries.includes('Node.js Developer'));
  assert.ok(adapter.defaultQueries.includes('Node.js Backend Developer'));
  assert.ok(adapter.defaultQueries.includes('MERN Stack Developer'));
  assert.ok(adapter.defaultQueries.includes('Backend Developer'));
  assert.ok(adapter.defaultQueries.includes('Full Stack Developer'));
  assert.equal(adapter.defaultQueries.includes('Software Developer'), false);
});
