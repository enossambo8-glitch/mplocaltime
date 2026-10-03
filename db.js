const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

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

function wrap(db, { keepAliveOnClose = false } = {}) {
  return {
    run: (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(err) { if (err) rej(err); else res(this); })),
    get: (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row))),
    all: (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows))),
    exec: (sql) => new Promise((res, rej) => db.exec(sql, (err) => err ? rej(err) : res())),
    close: () => {
      if (keepAliveOnClose) {
        return Promise.resolve();
      }
      return new Promise((res, rej) => db.close((err) => err ? rej(err) : res()));
    }
  };
}

async function init() {
  const hasExplicitDatabasePath = Boolean(process.env.DATABASE_PATH || process.env.DB_PATH);
  const isTestRun = (process.env.NODE_ENV === 'test' || process.argv.includes('--test') || (Array.isArray(process.execArgv) && process.execArgv.includes('--test'))) && !hasExplicitDatabasePath;
  if (isTestRun) {
    if (!testMemoryDb) {
      const raw = new sqlite3.Database(':memory:');
      testMemoryDb = wrap(raw, { keepAliveOnClose: true });
      await testMemoryDb.exec('PRAGMA foreign_keys = ON;');
    }
    return testMemoryDb;
  }

  const databasePath = resolveDatabasePath();
  ensureDatabaseDirectory(databasePath);
  const raw = new sqlite3.Database(databasePath);
  const db = wrap(raw);
  await db.exec('PRAGMA foreign_keys = ON;');
  await db.exec('PRAGMA journal_mode = WAL;');
  await db.exec('PRAGMA busy_timeout = 5000;');
  return db;
}

module.exports = { init, resolveDatabasePath, DATABASE_PATH: resolveDatabasePath(), queueDatabaseOperation };
