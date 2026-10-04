const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { createPool, isMysqlConfigured } = require('./pool');

function normalizeSqlForMysql(sql) {
  return String(sql || '')
    .replace(/datetime\(\s*['\"]now['\"]\s*\)/gi, 'NOW()')
    .replace(/datetime\(\s*['\"]now['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\)/gi, 'DATE_ADD(NOW(), INTERVAL $1)')
    .replace(/strftime\s*\(([^)]+)\)/gi, 'DATE_FORMAT(NOW(), $1)');
}

function rewriteSqlForMysql(sql) {
  const normalized = normalizeSqlForMysql(sql);
  if (/sqlite_master/i.test(normalized)) {
    return normalized
      .replace(/SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*['\"]table['\"]\s+AND\s+name\s*=?/i, "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?")
      .replace(/SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*['\"]table['\"]\s+AND\s+name\s*=\s*['\"]([^'\"]+)['\"]\s*;/i, "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '$1';")
      .replace(/SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*['\"]table['\"]\s+AND\s+name\s*NOT\s+LIKE\s*['\"]sqlite_%['\"]\s+ORDER\s+BY\s+name/i, "SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME NOT LIKE 'sqlite_%' ORDER BY TABLE_NAME");
  }
  return normalized;
}

function resolveDatabasePath() {
  const configured = process.env.DATABASE_PATH || process.env.DB_PATH || path.join(process.cwd(), 'data.db');
  const absolute = path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured);
  return absolute;
}

function ensureDatabaseDirectory(databasePath) {
  const directory = path.dirname(databasePath);
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory, { recursive: true });
  }
}

function mapMysqlResult(result) {
  if (!result) {
    return { lastID: null, insertId: null, changes: 0, affectedRows: 0 };
  }
  return {
    lastID: result.insertId ?? null,
    insertId: result.insertId ?? null,
    changes: result.affectedRows ?? 0,
    affectedRows: result.affectedRows ?? 0,
  };
}

async function getTableColumns(db, tableName) {
  if (!tableName) {
    return [];
  }
  if (isMysqlConfigured()) {
    const [rows] = await db.execute(
      'SELECT COLUMN_NAME AS name, DATA_TYPE AS type, IS_NULLABLE AS notnull, COLUMN_DEFAULT AS dflt_value, EXTRA AS extra FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION ASC',
      [tableName]
    );
    return rows.map((row) => ({
      name: row.name,
      type: row.type,
      notnull: row.notnull === 'NO' ? 1 : 0,
      dflt_value: row.dflt_value,
      extra: row.extra,
    }));
  }
  return db.all(`PRAGMA table_info(${tableName})`);
}

function wrapMysqlConnection(connection) {
  return {
    run: async (sql, params = []) => {
      const query = rewriteSqlForMysql(sql);
      const [result] = await connection.execute(query, params || []);
      return mapMysqlResult(result);
    },
    get: async (sql, params = []) => {
      const query = rewriteSqlForMysql(sql);
      const [rows] = await connection.execute(query, params || []);
      return rows[0] || null;
    },
    all: async (sql, params = []) => {
      const query = rewriteSqlForMysql(sql);
      if (/sqlite_master/i.test(query)) {
        const [rows] = await connection.execute(query, params || []);
        return rows;
      }
      const [rows] = await connection.execute(query, params || []);
      return rows;
    },
    exec: async (sql) => {
      const [result] = await connection.query(rewriteSqlForMysql(sql));
      return result;
    },
    close: async () => {
      connection.release();
    },
    execute: async (sql, params = []) => connection.execute(rewriteSqlForMysql(sql), params || []),
    query: async (sql, params = []) => connection.query(rewriteSqlForMysql(sql), params || []),
  };
}

function wrapSqliteDatabase(db, { keepAliveOnClose = false } = {}) {
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
    execute: (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res([rows, null]))),
    query: (sql, params = []) => new Promise((res, rej) => {
      db.all(sql, params, (err, rows) => {
        if (err) {
          rej(err);
          return;
        }
        res([rows]);
      });
    }),
  };
}

let testMemoryDb = null;
let operationQueue = Promise.resolve();

function queueDatabaseOperation(task) {
  const queued = operationQueue.then(task, task);
  operationQueue = queued.then(() => undefined, () => undefined);
  return queued;
}

async function init() {
  const databaseType = isMysqlConfigured() ? 'mysql' : 'sqlite';

  if (databaseType === 'mysql') {
    const pool = createPool();
    const connection = await pool.getConnection();
    return wrapMysqlConnection(connection);
  }

  const hasExplicitDatabasePath = Boolean(process.env.DATABASE_PATH || process.env.DB_PATH);
  const isTestRun = (process.env.NODE_ENV === 'test' || process.argv.includes('--test') || (Array.isArray(process.execArgv) && process.execArgv.includes('--test'))) && !hasExplicitDatabasePath;
  if (isTestRun) {
    if (!testMemoryDb) {
      const raw = new sqlite3.Database(':memory:');
      testMemoryDb = wrapSqliteDatabase(raw, { keepAliveOnClose: true });
      await testMemoryDb.exec('PRAGMA foreign_keys = ON;');
    }
    return testMemoryDb;
  }

  const databasePath = resolveDatabasePath();
  ensureDatabaseDirectory(databasePath);
  const raw = new sqlite3.Database(databasePath);
  const db = wrapSqliteDatabase(raw);
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
