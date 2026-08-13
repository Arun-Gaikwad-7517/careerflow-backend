const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateAndNotifyJob, isIndiaLocation } = require('../src/services/notificationService');
const { query, testConnection } = require('../src/config/db');

test('1. India Location Qualification Helper', (t) => {
  assert.equal(isIndiaLocation('Bangalore, India'), true);
  assert.equal(isIndiaLocation('Hyderabad, Telangana'), true);
  assert.equal(isIndiaLocation('Pune, India'), true);
  assert.equal(isIndiaLocation('Indiana, USA'), false);
  assert.equal(isIndiaLocation('Indianapolis, IN, USA'), false);
});

test('2. Alert Qualification Rules (Non-Mutating)', async (t) => {
  const freshIndiaJob = {
    sourceName: 'AdzunaAPI',
    title: 'Senior Node.js Developer',
    company: 'TechCorp',
    location: 'Bangalore, India',
    postedAt: new Date().toISOString()
  };

  const highMatchEval = {
    freshness: { category: 'VERY_FRESH' },
    scores: { finalMatchScore: 88.5 },
    priority: 'APPLY_NOW'
  };

  // Test 1: Real fresh India job with high match -> Qualifies (persistDb: false)
  const qualifies = await evaluateAndNotifyJob(freshIndiaJob, highMatchEval, { persistDb: false });
  assert.equal(qualifies, true);

  // Test 2: Mock Source Job -> Rejects
  const mockJob = { ...freshIndiaJob, sourceName: 'MockSource' };
  const mockQualifies = await evaluateAndNotifyJob(mockJob, highMatchEval, { persistDb: false });
  assert.equal(mockQualifies, false);

  // Test 3: Non-India Job -> Rejects
  const usJob = { ...freshIndiaJob, location: 'San Francisco, CA' };
  const usQualifies = await evaluateAndNotifyJob(usJob, highMatchEval, { persistDb: false });
  assert.equal(usQualifies, false);

  // Test 4: Stale Job (>48h) -> Rejects
  const staleEval = {
    freshness: { category: 'NOT_FRESH' },
    scores: { finalMatchScore: 88.5 },
    priority: 'APPLY_NOW'
  };
  const staleQualifies = await evaluateAndNotifyJob(freshIndiaJob, staleEval, { persistDb: false });
  assert.equal(staleQualifies, false);
});

test('3. Candidate Notification API Endpoints & DB Unique Constraint', async (t) => {
  const dbStatus = await testConnection();

  const app = require('../src/app');
  const server = app.listen(5034);

  try {
    // A. Fetch Notifications
    const res = await fetch('http://localhost:5034/api/v1/notifications');
    assert.equal(res.status, 200);
    const json = await res.json();
    assert.equal(json.success, true);
    assert.ok(typeof json.unreadCount === 'number');
    assert.ok(Array.isArray(json.notifications));

    // B. If DB connected, test DB insertion and unique constraint deduplication
    if (dbStatus.connected) {
      // Find a real job ID
      const jobs = await query('SELECT id FROM jobs LIMIT 1');
      if (jobs && jobs.length > 0) {
        const jobId = jobs[0].id;

        // Insert test notification 1
        await query(`
          INSERT IGNORE INTO job_notifications (user_id, job_id, priority, match_score, notification_type, is_read)
          VALUES (1, ?, 'APPLY_NOW', 90.00, 'VERY_FRESH_HIGH_MATCH', FALSE)
        `, [jobId]);

        // Insert test notification 2 (Duplicate for same job_id -> MUST BE IGNORED BY UNIQUE KEY)
        const dupResult = await query(`
          INSERT IGNORE INTO job_notifications (user_id, job_id, priority, match_score, notification_type, is_read)
          VALUES (1, ?, 'APPLY_NOW', 90.00, 'VERY_FRESH_HIGH_MATCH', FALSE)
        `, [jobId]);

        assert.equal(dupResult.affectedRows, 0); // Duplicate skipped!

        // Read notification ID
        const notifRows = await query('SELECT id FROM job_notifications WHERE user_id = 1 AND job_id = ? LIMIT 1', [jobId]);
        if (notifRows && notifRows.length > 0) {
          const notifId = notifRows[0].id;

          // Test Mark Read API
          const readRes = await fetch(`http://localhost:5034/api/v1/notifications/${notifId}/read`, { method: 'PUT' });
          assert.equal(readRes.status, 200);

          // Test Mark All Read API
          const readAllRes = await fetch('http://localhost:5034/api/v1/notifications/read-all', { method: 'PUT' });
          assert.equal(readAllRes.status, 200);

          // Clean up test notification
          await query('DELETE FROM job_notifications WHERE id = ?', [notifId]);
        }
      }
    }

    server.close();
  } catch (err) {
    server.close();
    throw err;
  }
});
