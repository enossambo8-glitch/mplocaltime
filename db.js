const sqlite3 = require('sqlite3').verbose();

const DATABASE_PATH = process.env.DB_PATH || './data.db';

function wrap(db) {
  return {
    run: (sql, params=[]) => new Promise((res, rej) => db.run(sql, params, function(err) { if (err) rej(err); else res(this); })),
    get: (sql, params=[]) => new Promise((res, rej) => db.get(sql, params, (err, row) => err ? rej(err) : res(row))),
    all: (sql, params=[]) => new Promise((res, rej) => db.all(sql, params, (err, rows) => err ? rej(err) : res(rows))),
    exec: (sql) => new Promise((res, rej) => db.exec(sql, (err) => err ? rej(err) : res())),
    close: () => new Promise((res, rej) => db.close((err) => err ? rej(err) : res()))
  };
}

async function init() {
  const raw = new sqlite3.Database(DATABASE_PATH);
  const db = wrap(raw);
  await db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

module.exports = { init, DATABASE_PATH };
