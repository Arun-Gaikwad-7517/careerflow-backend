const test = require('node:test');
const assert = require('node:assert/strict');

const { generateDedupHash, normalizeString } = require('../src/utils/dedupHash');
const { calculateFreshness } = require('../src/utils/freshness');
const MockJobAdapter = require('../src/adapters/sources/MockJobAdapter');
const { registryInstance } = require('../src/adapters/AdapterRegistry');
const { evaluateJobMatch } = require('../src/services/matchingService');

test('1. Deduplication Hash Generator', (t) => {
  const company = '  TechScale Innovations!  ';
  const title = 'Senior NODE.JS Developer ';
  const location = ' Remote ';
  const desc = 'We are hiring a Node.js developer...';

  const hash1 = generateDedupHash(company, title, location, desc);
  const hash2 = generateDedupHash('techscale innovations', 'senior nodejs developer', 'remote', 'we are hiring a nodejs developer');

  assert.equal(typeof hash1, 'string');
  assert.equal(hash1.length, 64); // SHA-256 length
  assert.equal(hash1, hash2, 'Normalized strings with matching content must produce identical hashes');
});

test('2. 48-Hour Freshness Rules & Timestamp Handling', (t) => {
  const refTime = new Date('2026-08-11T12:00:00Z');

  // Test 1: EXACT 2 hours ago -> VERY_FRESH
  const exactFresh = calculateFreshness('2026-08-11T10:00:00Z', 'EXACT', refTime);
  assert.equal(exactFresh.category, 'VERY_FRESH');
  assert.equal(exactFresh.freshnessScore, 100.0);

  // Test 2: HOUR 18 hours ago -> VERY_FRESH
  const hourFresh = calculateFreshness('2026-08-10T18:00:00Z', 'HOUR', refTime);
  assert.equal(hourFresh.category, 'VERY_FRESH');
  assert.equal(hourFresh.freshnessScore, 100.0);

  // Test 3: DAY 36 hours ago -> FRESH
  const dayFresh = calculateFreshness('2026-08-10T00:00:00Z', 'DAY', refTime);
  assert.equal(dayFresh.category, 'FRESH');
  assert.equal(dayFresh.freshnessScore, 75.0);

  // Test 4: EXACT 72 hours ago -> NOT_FRESH
  const oldJob = calculateFreshness('2026-08-08T12:00:00Z', 'EXACT', refTime);
  assert.equal(oldJob.category, 'NOT_FRESH');
  assert.equal(oldJob.freshnessScore, 25.0);

  // Test 5: UNKNOWN posting date -> MUST BE UNKNOWN (Never convert to FRESH using discovery date!)
  const unknownJob = calculateFreshness(null, 'UNKNOWN', refTime);
  assert.equal(unknownJob.category, 'UNKNOWN');
  assert.equal(unknownJob.displayLabel, 'Posting date unavailable');
  assert.equal(unknownJob.freshnessScore, 0.0);
  assert.equal(unknownJob.ageInHours, null);
});

test('3. MockJobAdapter and AdapterRegistry Integration', async (t) => {
  const adapter = new MockJobAdapter();
  registryInstance.register(adapter);

  const registered = registryInstance.get('MockSource');
  assert.ok(registered);
  assert.equal(registered.sourceName, 'MockSource');

  const jobs = await adapter.process();
  assert.equal(jobs.length, 5);

  jobs.forEach(job => {
    assert.ok(job.externalJobId);
    assert.ok(job.title);
    assert.ok(job.company);
    assert.ok(job.dedupHash);
    assert.equal(job.dedupHash.length, 64);
  });
});

test('4. Matching Engine & Priority Classification', async (t) => {
  const mockAdapter = new MockJobAdapter();
  const jobs = await mockAdapter.process();

  const topJob = jobs.find(j => j.externalJobId === 'MOCK-001');
  assert.ok(topJob);

  const matchEval = evaluateJobMatch(topJob);

  assert.equal(typeof matchEval.scores.finalMatchScore, 'number');
  assert.ok(matchEval.scores.finalMatchScore >= 80.0, 'Top job should score high');
  assert.equal(matchEval.priority, 'APPLY_NOW');
  assert.equal(matchEval.freshness.category, 'VERY_FRESH');
});
