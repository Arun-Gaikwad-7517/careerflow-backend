const test = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { query, testConnection } = require('../src/config/db');

test('Admin & Auth Suite: Unauthenticated and Authorization Enforcement', async (t) => {
  const app = require('../src/app');
  const server = app.listen(5033);

  try {
    // 1. Unauthenticated request to /admin/stats -> HTTP 401
    const unauthRes = await fetch('http://localhost:5033/api/v1/admin/stats');
    assert.equal(unauthRes.status, 401);
    const unauthJson = await unauthRes.json();
    assert.equal(unauthJson.success, false);

    // 2. Login with invalid password -> HTTP 401
    const invalidLoginRes = await fetch('http://localhost:5033/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'arun@example.com', password: 'wrongpassword' })
    });
    assert.equal(invalidLoginRes.status, 401);

    // 3. Create a test admin user in DB if connection is active
    const dbStatus = await testConnection();
    let adminToken = null;

    if (dbStatus.connected) {
      const testEmail = 'testadmin@example.com';
      const testPass = 'admin12345';
      const hash = bcrypt.hashSync(testPass, 12);

      const existing = await query('SELECT id FROM users WHERE email = ?', [testEmail]);
      if (!existing || existing.length === 0) {
        await query('INSERT INTO users (full_name, email, role, password_hash) VALUES (?, ?, "ADMIN", ?)', ['Test Admin', testEmail, hash]);
      } else {
        await query('UPDATE users SET role = "ADMIN", password_hash = ? WHERE email = ?', [hash, testEmail]);
      }

      // Login as Admin
      const loginRes = await fetch('http://localhost:5033/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: testEmail, password: testPass })
      });

      assert.equal(loginRes.status, 200);
      const loginJson = await loginRes.json();
      assert.equal(loginJson.success, true);
      assert.equal(loginJson.user.role, 'ADMIN');
      assert.equal(loginJson.token, undefined, 'Raw JWT token must not be exposed in login JSON response');

      const setCookieHeader = loginRes.headers.get('set-cookie');
      assert.ok(setCookieHeader, 'Set-Cookie header must be set by authentication server');

      const cookieMatch = setCookieHeader.match(/token=([^;]+)/);
      assert.ok(cookieMatch, 'Token cookie must be present in Set-Cookie header');
      const adminCookie = cookieMatch[0];

      // 4. Authenticated ADMIN request to /admin/stats using HTTP-only Cookie -> HTTP 200
      const adminStatsRes = await fetch('http://localhost:5033/api/v1/admin/stats', {
        headers: {
          'Cookie': adminCookie
        }
      });
      assert.equal(adminStatsRes.status, 200);
      const statsJson = await adminStatsRes.json();
      assert.equal(statsJson.success, true);
      assert.ok(typeof statsJson.metrics.totalRealJobs === 'number');
      assert.ok(Array.isArray(statsJson.sources));

      // 5. Test Auth /me Endpoint using HTTP-only Cookie
      const meRes = await fetch('http://localhost:5033/api/v1/auth/me', {
        headers: {
          'Cookie': adminCookie
        }
      });
      assert.equal(meRes.status, 200);
      const meJson = await meRes.json();
      assert.equal(meJson.user.email, testEmail);

      // Clean up test admin user from MySQL
      await query('DELETE FROM users WHERE email = ?', [testEmail]);
    }

    // 6. Test GET /api/v1/cron/jobs-sync without CRON_SECRET header -> HTTP 401
    process.env.CRON_SECRET = 'test_cron_secret_12345';
    const cronNoAuthRes = await fetch('http://localhost:5033/api/v1/cron/jobs-sync');
    assert.equal(cronNoAuthRes.status, 401, 'Cron request without authorization header must be rejected with 401');

    // 7. Test GET /api/v1/cron/jobs-sync with invalid secret -> HTTP 401
    const cronWrongSecretRes = await fetch('http://localhost:5033/api/v1/cron/jobs-sync', {
      headers: { 'Authorization': 'Bearer wrong_secret' }
    });
    assert.equal(cronWrongSecretRes.status, 401, 'Cron request with invalid secret must be rejected with 401');

    // 8. Test GET /api/v1/cron/jobs-sync with valid CRON_SECRET -> HTTP 200
    const cronValidRes = await fetch('http://localhost:5033/api/v1/cron/jobs-sync', {
      headers: { 'Authorization': `Bearer ${process.env.CRON_SECRET}` }
    });
    assert.equal(cronValidRes.status, 200, 'Cron request with valid CRON_SECRET must succeed with 200');
    const cronJson = await cronValidRes.json();
    assert.equal(cronJson.success, true);

    server.close();
  } catch (err) {
    server.close();
    throw err;
  }
});
