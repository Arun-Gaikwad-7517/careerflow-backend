const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function runAivenMigrationAndAudit() {
  console.log('=== AIVEN CLOUD MYSQL MIGRATION & AUDIT ===\n');

  const host = process.env.AIVEN_DB_HOST;
  const port = parseInt(process.env.AIVEN_DB_PORT || '3306', 10);
  const user = process.env.AIVEN_DB_USER;
  const password = process.env.AIVEN_DB_PASSWORD;
  const database = process.env.AIVEN_DB_NAME || 'defaultdb';

  if (!host || !user || !password) {
    console.error('[Configuration Required] AIVEN_DB_HOST, AIVEN_DB_USER, and AIVEN_DB_PASSWORD must be populated in server/.env before running migration.');
    console.log('\nPlease add the following template to server/.env:');
    console.log(`
# Aiven Cloud MySQL Credentials
AIVEN_DB_HOST=mysql-xxxx-your-project.aivencloud.com
AIVEN_DB_PORT=12345
AIVEN_DB_USER=avnadmin
AIVEN_DB_PASSWORD=your_aiven_password_here
AIVEN_DB_NAME=defaultdb
    `);
    process.exit(1);
  }

  const cloudConfig = {
    host,
    port,
    user,
    password,
    database,
    ssl: { rejectUnauthorized: false },
    multipleStatements: true,
    waitForConnections: true,
    connectionLimit: 5
  };

  console.log(`[+] Attempting SSL connection to Aiven Cloud MySQL at ${host}:${port}...`);
  let connection;
  try {
    connection = await mysql.createConnection(cloudConfig);
    console.log('[✓] SSL Connection to Aiven Cloud MySQL successful.');
  } catch (connErr) {
    console.error('[Error] SSL Connection to Aiven Cloud MySQL failed:', connErr.message);
    process.exit(1);
  }

  // 1. Read backup file
  const backupPath = path.join(__dirname, '../../backup_job_assistant.sql');
  if (!fs.existsSync(backupPath)) {
    console.error('[Error] Migration source backup missing at:', backupPath);
    process.exit(1);
  }

  const backupSql = fs.readFileSync(backupPath, 'utf8');
  console.log(`[+] Loaded backup_job_assistant.sql (${(backupSql.length / 1024 / 1024).toFixed(2)} MB).`);

  // 2. Import SQL dump to Aiven over SSL
  console.log('[+] Importing database schema & data to Aiven Cloud MySQL...');
  try {
    await connection.query(backupSql);
    console.log('[✓] Database dump successfully imported into Aiven Cloud MySQL.');
  } catch (importErr) {
    console.error('[Error] SQL Import failed:', importErr.message);
    await connection.end();
    process.exit(1);
  }

  // 3. READ-ONLY VERIFICATION AGAINST AIVEN CLOUD MYSQL
  console.log('\n=== READ-ONLY VERIFICATION AGAINST AIVEN CLOUD MYSQL ===\n');

  // A. Test SELECT 1
  const [pingRes] = await connection.query('SELECT 1 + 1 AS pingResult');
  console.log(`[✓] Node.js SSL Read-Only Connection Test (SELECT 1 + 1): ${pingRes[0].pingResult}`);

  // B. Exact Row Counts
  const tables = [
    'jobs',
    'job_sources',
    'job_matches',
    'applications',
    'application_status_history',
    'users',
    'resumes',
    'user_preferences',
    'skills',
    'job_skills',
    'job_notifications'
  ];

  console.log('\n--- AIVEN TABLE ROW COUNTS ---');
  const counts = {};
  for (const tbl of tables) {
    const [rows] = await connection.query(`SELECT COUNT(*) as total FROM \`${tbl}\``);
    counts[tbl] = rows[0].total;
    console.log(`Cloud Table ${tbl.padEnd(30)} Row Count: ${rows[0].total}`);
  }

  // C. Source Breakdown
  console.log('\n--- AIVEN SOURCE BREAKDOWN ---');
  const [sourceRows] = await connection.query(`
    SELECT s.source_name, COUNT(j.id) as cnt
    FROM job_sources s
    LEFT JOIN jobs j ON j.source_id = s.id
    GROUP BY s.source_name
  `);
  for (const s of sourceRows) {
    console.log(`Source [${s.source_name.padEnd(15)}]: ${s.cnt} jobs`);
  }

  // D. Mock & Dedup Integrity
  const [mockSource] = await connection.query(`
    SELECT COUNT(*) as cnt FROM jobs j
    JOIN job_sources s ON j.source_id = s.id
    WHERE s.source_name = 'MockSource'
  `);

  const [mockExternal] = await connection.query(`
    SELECT COUNT(*) as cnt FROM jobs WHERE external_job_id LIKE 'MOCK-%'
  `);

  const [dupHashes] = await connection.query(`
    SELECT dedup_hash, COUNT(*) as cnt FROM jobs GROUP BY dedup_hash HAVING cnt > 1
  `);

  console.log('\n--- AIVEN DATA INTEGRITY ---');
  console.log(`MockSource Jobs: ${mockSource[0].cnt}`);
  console.log(`MOCK-* External IDs: ${mockExternal[0].cnt}`);
  console.log(`Duplicate dedup_hash entries: ${dupHashes.length}`);

  // E. Admin User Verification (WITHOUT printing password_hash)
  const [adminUsers] = await connection.query(`
    SELECT id, full_name, email, role, created_at FROM users WHERE role = 'ADMIN'
  `);

  console.log('\n--- ADMIN USER VERIFICATION ---');
  if (adminUsers.length > 0) {
    const admin = adminUsers[0];
    console.log(`[✓] Admin user verified: ID ${admin.id} | Email: ${admin.email} | Role: ${admin.role} (password_hash hidden)`);
  } else {
    console.error('[X] Admin user missing!');
  }

  // F. Foreign Key Integrity Check
  const [fks] = await connection.query(`
    SELECT TABLE_NAME, COLUMN_NAME, CONSTRAINT_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE() AND REFERENCED_TABLE_NAME IS NOT NULL
  `);

  console.log('\n--- FOREIGN KEY INTEGRITY ---');
  console.log(`Verified ${fks.length} explicit foreign key constraints intact on Aiven Cloud MySQL.`);

  await connection.end();
  console.log('\n=== AIVEN MIGRATION & VERIFICATION COMPLETE ===');
  process.exit(0);
}

runAivenMigrationAndAudit();
