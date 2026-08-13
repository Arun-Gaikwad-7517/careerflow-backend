const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'job_assistant',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_CONNECTION_LIMIT || '10', 10),
  queueLimit: 0,
  ...(process.env.DB_SSL === 'true' ? { ssl: { rejectUnauthorized: false } } : {})
};

let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool(dbConfig);
  }
  return pool;
}

async function testConnection() {
  try {
    const currentPool = getPool();
    const [rows] = await currentPool.query('SELECT 1 + 1 AS result');
    return {
      connected: true,
      message: 'Database connection successful',
      details: { host: dbConfig.host, database: dbConfig.database, port: dbConfig.port }
    };
  } catch (error) {
    return {
      connected: false,
      message: 'Database connection failed',
      error: error.message,
      code: error.code || 'ECONNREFUSED'
    };
  }
}

async function query(sql, params) {
  const currentPool = getPool();
  const [rows, fields] = await currentPool.execute(sql, params);
  return rows;
}

module.exports = {
  getPool,
  testConnection,
  query,
  dbConfig: {
    host: dbConfig.host,
    port: dbConfig.port,
    user: dbConfig.user,
    database: dbConfig.database
    // Notice: DB_PASSWORD is intentionally omitted for security
  }
};
