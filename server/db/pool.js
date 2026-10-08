const mysql = require('mysql2/promise');

function getEnvironment(key, fallback = '') {
  const value = process.env[key];
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function isMysqlConfigured() {
  if (process.env.NODE_ENV === "test") return false;
  return Boolean(
    getEnvironment('DB_HOST') ||
    getEnvironment('DB_NAME') ||
    getEnvironment('DB_USER') ||
    getEnvironment('DB_PASSWORD') ||
    getEnvironment('DB_PORT')
  );
}

function validateMysqlConfig() {
  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((key) => !getEnvironment(key));
  if (missing.length > 0) {
    throw new Error(`Missing required MariaDB/MySQL configuration: ${missing.join(', ')}`);
  }
  return {
    host: getEnvironment('DB_HOST'),
    port: Number.parseInt(getEnvironment('DB_PORT', '3306'), 10),
    database: getEnvironment('DB_NAME'),
    user: getEnvironment('DB_USER'),
    password: getEnvironment('DB_PASSWORD'),
    waitForConnections: true,
    connectionLimit: Number.parseInt(getEnvironment('DB_CONNECTION_LIMIT', '10'), 10) || 10,
    queueLimit: Number.parseInt(getEnvironment('DB_QUEUE_LIMIT', '0'), 10) || 0,
    charset: 'utf8mb4',
    timezone: 'Z',
    multipleStatements: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  };
}

let pool;

function createPool() {
  if (pool) {
    return pool;
  }

  if (!isMysqlConfigured()) {
    return null;
  }

  const config = validateMysqlConfig();
  pool = mysql.createPool(config);
  return pool;
}

module.exports = {
  getEnvironment,
  isMysqlConfigured,
  validateMysqlConfig,
  createPool,
};
