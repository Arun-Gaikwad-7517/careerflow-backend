const test = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeHtml } = require('../src/utils/sanitizeHtml');
const { VALID_TRANSITIONS } = require('../src/controllers/applicationController');
const { query, testConnection } = require('../src/config/db');

test('1. Safe HTML Description Sanitization & XSS Prevention', (t) => {
  const maliciousInput = `
    <h1>Senior Backend Engineer</h1>
    <script>alert("XSS Attack!");</script>
    <p>Required skills: <b onclick="evilCode()">Node.js</b> & Express.</p>
    <iframe src="http://malicious.site"></iframe>
    <a href="https://stripe.com/jobs" target="_blank">Apply Here</a>
  `;

  const sanitized = sanitizeHtml(maliciousInput);

  assert.equal(sanitized.includes('<script>'), false);
  assert.equal(sanitized.includes('onclick'), false);
  assert.equal(sanitized.includes('<iframe'), false);
  assert.equal(sanitized.includes('<h1>Senior Backend Engineer</h1>'), true);
  assert.equal(sanitized.includes('Node.js'), true);
  assert.equal(sanitized.includes('href="https://stripe.com/jobs"'), true);
});

test('2. State Machine Transition Validation Rules (Pure Tracking)', (t) => {
  // Test DRAFT transitions
  assert.deepEqual(VALID_TRANSITIONS.DRAFT, ['APPLIED', 'WITHDRAWN']);
  
  // Test APPLIED transitions
  assert.deepEqual(VALID_TRANSITIONS.APPLIED, ['INTERVIEWING', 'OFFER', 'REJECTED', 'WITHDRAWN']);

  // Test INTERVIEWING transitions
  assert.deepEqual(VALID_TRANSITIONS.INTERVIEWING, ['OFFER', 'REJECTED', 'WITHDRAWN']);
});

test('3. End-to-End Application Controller & API Endpoints', async (t) => {
  const dbStatus = await testConnection();

  const app = require('../src/app');
  const server = app.listen(5038);

  try {
    let testJobId = 1;
    if (dbStatus.connected) {
      const realJobs = await query("SELECT id FROM jobs WHERE source_id != (SELECT id FROM job_sources WHERE source_name = 'MockSource') LIMIT 1");
      if (realJobs && realJobs.length > 0) {
        testJobId = realJobs[0].id;
      }
    }

    // Step A: Prepare Application (Save Job)
    const prepRes = await fetch('http://localhost:5038/api/v1/applications/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: testJobId })
    });

    assert.equal(prepRes.status, 201);
    const prepJson = await prepRes.json();
    assert.equal(prepJson.success, true);
    assert.equal(prepJson.application.status, 'DRAFT');

    const createdAppId = prepJson.application.id;

    // Step B: Mark as APPLIED
    const appliedRes = await fetch(`http://localhost:5038/api/v1/applications/${createdAppId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'APPLIED', notes: 'Submitted via company career portal.' })
    });

    assert.equal(appliedRes.status, 200);
    const appliedJson = await appliedRes.json();
    assert.equal(appliedJson.success, true);
    assert.equal(appliedJson.application.status, 'APPLIED');
    assert.ok(appliedJson.application.appliedAt);

    // Step C: Update Status to INTERVIEWING
    const interviewRes = await fetch(`http://localhost:5038/api/v1/applications/${createdAppId}/status`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'INTERVIEWING', notes: 'Scheduled recruiter screen.' })
    });

    assert.equal(interviewRes.status, 200);

    // Step D: Get Application Details
    const detailRes = await fetch(`http://localhost:5038/api/v1/applications/${createdAppId}`);
    assert.equal(detailRes.status, 200);
    const detailJson = await detailRes.json();
    assert.equal(detailJson.application.status, 'INTERVIEWING');
    assert.ok(Array.isArray(detailJson.application.history));

    // Cleanup test application record if DB connected
    if (dbStatus.connected) {
      await query('DELETE FROM application_status_history WHERE application_id = ?', [createdAppId]);
      await query('DELETE FROM applications WHERE id = ?', [createdAppId]);
    }

    server.close();
  } catch (err) {
    server.close();
    throw err;
  }
});
