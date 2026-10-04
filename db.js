const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createPool, isMysqlConfigured } = require('./server/db/pool');
const { normalizeSqlForMysql, getTableColumns } = require('./server/db/query');

function resolveDatabasePath() {
  const configured = process.env.DATABASE_PATH || process.env.DB_PATH || path.join(__dirname, 'data.db');
  const absolute = path.isAbsolute(configured) ? configured : path.resolve(__dirname, configured);
  return absolute;
}

function ensureDatabaseDirectory(databasePath) {
  const directory = path.dirname(databasePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

let testMemoryDb = null;
let operationQueue = Promise.resolve();

function queueDatabaseOperation(task) {
  const queued = operationQueue.then(task, task);
  operationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

function wrapSqlite(db, { keepAliveOnClose = false } = {}) {
  return {
    run: (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function runCallback(err) {
      if (err) {
        rej(err);
        return;
      }
      res({ lastID: this.lastID, insertId: this.lastID, changes: this.changes, affectedRows: this.changes });
    })),
    get: (sql, params = []) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row))),
    all: (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows))),
    exec: (sql) => new Promise((res, rej) => db.exec(sql, (err) => err ? rej(err) : res())),
    close: () => {
      if (keepAliveOnClose) {
        return Promise.resolve();
      }
      return new Promise((res, rej) => db.close((err) => err ? rej(err) : res()));
    },
  };
}

function wrapMysql(connection) {
  return {
    run: async (sql, params = []) => {
      if (/^\s*PRAGMA\s+table_info\s*\(/i.test(sql)) {
        const tableName = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*([A-Za-z0-9_]+)\s*\)/i)?.[1];
        return { rows: await getTableColumnsFromMysql(connection, tableName) };
      }
      const [result] = await connection.execute(normalizeSqlForMysql(sql), params || []);
      return {
        lastID: result.insertId ?? null,
        insertId: result.insertId ?? null,
        changes: result.affectedRows ?? 0,
        affectedRows: result.affectedRows ?? 0,
      };
    },
    get: async (sql, params = []) => {
      if (/^\s*PRAGMA\s+table_info\s*\(/i.test(sql)) {
        const tableName = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*([A-Za-z0-9_]+)\s*\)/i)?.[1];
        const rows = await getTableColumnsFromMysql(connection, tableName);
        return rows[0] || null;
      }
      const [rows] = await connection.execute(normalizeSqlForMysql(sql), params || []);
      return rows[0] || null;
    },
    all: async (sql, params = []) => {
      if (/^\s*PRAGMA\s+table_info\s*\(/i.test(sql)) {
        const tableName = sql.match(/^\s*PRAGMA\s+table_info\s*\(\s*([A-Za-z0-9_]+)\s*\)/i)?.[1];
        return getTableColumnsFromMysql(connection, tableName);
      }
      const [rows] = await connection.execute(normalizeSqlForMysql(sql), params || []);
      return rows;
    },
    exec: async (sql) => {
      const [result] = await connection.query(normalizeSqlForMysql(sql));
      return result;
    },
    close: async () => connection.release(),
    execute: async (sql, params = []) => connection.execute(normalizeSqlForMysql(sql), params || []),
    query: async (sql, params = []) => connection.query(normalizeSqlForMysql(sql), params || []),
  };
}

async function getTableColumnsFromMysql(connection, tableName) {
  if (!tableName) {
    return [];
  }
  const [rows] = await connection.execute(
    'SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS notnull, COLUMN_DEFAULT AS dflt_value, EXTRA AS extra FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION ASC',
    [tableName]
  );
  return rows.map((row) => ({ name: row.name, type: row.type, notnull: row.notnull === 'NO' ? 1 : 0, dflt_value: row.dflt_value, extra: row.extra }));
}

async function init() {
  if (isMysqlConfigured()) {
    const pool = createPool();
    const connection = await pool.getConnection();
    return wrapMysql(connection);
  }

  const hasExplicitDatabasePath = Boolean(process.env.DATABASE_PATH || process.env.DB_PATH);
  const isTestRun = (process.env.NODE_ENV === 'test' || process.argv.includes('--test') || (Array.isArray(process.execArgv) && process.execArgv.includes('--test'))) && !hasExplicitDatabasePath;
  if (isTestRun) {
    if (!testMemoryDb) {
      const raw = new sqlite3.Database(':memory:');
      testMemoryDb = wrapSqlite(raw, { keepAliveOnClose: true });
      await testMemoryDb.exec('PRAGMA foreign_keys = ON;');
    }
    return testMemoryDb;
  }

  const databasePath = resolveDatabasePath();
  ensureDatabaseDirectory(databasePath);
  const raw = new sqlite3.Database(databasePath);
  const db = wrapSqlite(raw);
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

module.exports = {
  init,
  resolveDatabasePath,
  DATABASE_PATH: resolveDatabasePath(),
  queueDatabaseOperation,
  isMysqlConfigured,
  getTableColumns,
  normalizeSqlForMysql,
};
