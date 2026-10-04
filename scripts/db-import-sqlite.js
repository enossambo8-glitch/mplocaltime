const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const { resolveDatabasePath } = require('../db');

function getSqliteTables(databasePath) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name", (queryError, rows) => {
        db.close();
        if (queryError) {
          reject(queryError);
          return;
        }
        resolve(rows.map((row) => row.name));
      });
    });
  });
}

function getSqliteTableInfo(databasePath, tableName) {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(databasePath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      db.all(`PRAGMA table_info(${tableName})`, (queryError, rows) => {
        db.close();
        if (queryError) {
          reject(queryError);
          return;
        }
        resolve(rows);
      });
    });
  });
}

async function main() {
  const sourcePath = resolveDatabasePath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`SQLite database does not exist at ${sourcePath}`);
  }

  const required = ['DB_HOST', 'DB_PORT', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`MariaDB/MySQL target is not configured: ${missing.join(', ')}`);
  }

  console.log(`Importing SQLite data from ${sourcePath} to MariaDB/MySQL ...`);
  const tables = await getSqliteTables(sourcePath);
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    charset: 'utf8mb4',
    multipleStatements: true,
  });

  const results = [];
  for (const tableName of tables) {
    const columns = await getSqliteTableInfo(sourcePath, tableName);
    if (!columns.length) {
      continue;
    }
    const sqliteRows = await new Promise((resolve, reject) => {
      const db = new sqlite3.Database(sourcePath, sqlite3.OPEN_READONLY, (openError) => {
        if (openError) {
          reject(openError);
          return;
        }
        db.all(`SELECT * FROM ${tableName}`, (queryError, rows) => {
          db.close();
          if (queryError) {
            reject(queryError);
            return;
          }
          resolve(rows);
        });
      });
    });

    if (!sqliteRows.length) {
      results.push({ table: tableName, rows: 0, status: 'skipped-empty' });
      continue;
    }

    const columnNames = columns.map((column) => column.name);
    const placeholders = columnNames.map(() => '?').join(', ');
    const insertSql = `INSERT INTO ${tableName} (${columnNames.join(', ')}) VALUES (${placeholders}) ON DUPLICATE KEY UPDATE ${columnNames.map((column) => `${column} = VALUES(${column})`).join(', ')}`;

    const connection = await pool.getConnection();
    try {
      for (const row of sqliteRows) {
        const values = columnNames.map((columnName) => row[columnName] === undefined ? null : row[columnName]);
        await connection.execute(insertSql, values);
      }
      results.push({ table: tableName, rows: sqliteRows.length, status: 'imported' });
    } catch (error) {
      results.push({ table: tableName, rows: sqliteRows.length, status: 'failed', error: error.message });
      throw error;
    } finally {
      connection.release();
    }
  }

  console.log(JSON.stringify(results, null, 2));
  await pool.end();
}

main().catch((error) => {
  console.error('SQLite import failed:', error.message);
  process.exit(1);
});
