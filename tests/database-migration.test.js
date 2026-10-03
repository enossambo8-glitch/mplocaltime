const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-local';
process.env.INITIAL_PASSWORD = process.env.INITIAL_PASSWORD || 'test-admin-secret';
process.env.INITIAL_USER_PASSWORD = process.env.INITIAL_USER_PASSWORD || 'test-contributor-secret';

function loadAppModules() {
  delete require.cache[require.resolve('../server')];
  delete require.cache[require.resolve('../db')];
  return {
    app: require('../server'),
    db: require('../db'),
  };
}

function withTempDatabase(testFn) {
  return async () => {
    const originalEnv = {
      NODE_ENV: process.env.NODE_ENV,
      DATABASE_PATH: process.env.DATABASE_PATH,
      DB_PATH: process.env.DB_PATH,
      JWT_SECRET: process.env.JWT_SECRET,
      INITIAL_PASSWORD: process.env.INITIAL_PASSWORD,
      INITIAL_USER_PASSWORD: process.env.INITIAL_USER_PASSWORD,
    };
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mlt-migration-'));
    const databasePath = path.join(tempDir, 'mlt.db');
    process.env.NODE_ENV = 'production';
    process.env.DATABASE_PATH = databasePath;
    delete process.env.DB_PATH;
    process.env.JWT_SECRET = 'production-secret-for-migration-tests';
    process.env.INITIAL_PASSWORD = 'production-admin-secret';
    process.env.INITIAL_USER_PASSWORD = 'production-reporter-secret';

    try {
      await testFn(databasePath);
    } finally {
      for (const [key, value] of Object.entries(originalEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  };
}

test('fresh database initializes, creates schema and records a schema version', withTempDatabase(async (databasePath) => {
  const { app, db } = loadAppModules();
  const { init } = db;
  const { initializeDatabase } = app;
  await initializeDatabase();
  const dbHandle = await init();
  try {
    const tableNames = await dbHandle.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name");
    assert.ok(tableNames.some((row) => row.name === 'users'));
    assert.ok(tableNames.some((row) => row.name === 'stories'));
    assert.ok(tableNames.some((row) => row.name === 'schema_migrations'));

    const schemaVersion = await dbHandle.get('SELECT name FROM schema_migrations ORDER BY id DESC LIMIT 1');
    assert.equal(schemaVersion.name, 'mlt_core_schema_v1');

    const storyColumns = await dbHandle.all('PRAGMA table_info(stories)');
    assert.ok(storyColumns.some((column) => column.name === 'published_at'));
    assert.ok(storyColumns.some((column) => column.name === 'archived_at'));
    assert.equal(resolveDatabasePathForTest(databasePath), databasePath);
  } finally {
    await dbHandle.close();
  }
}));

test('database initialization is idempotent and does not duplicate schema rows', withTempDatabase(async () => {
  const { app, db } = loadAppModules();
  const { init } = db;
  const { initializeDatabase } = app;
  await initializeDatabase();
  await initializeDatabase();
  await initializeDatabase();

  const dbHandle = await init();
  try {
    const migrationCount = await dbHandle.get("SELECT COUNT(*) AS count FROM schema_migrations WHERE name = 'mlt_core_schema_v1'");
    assert.equal(Number(migrationCount.count), 1);
    const storyColumns = await dbHandle.all('PRAGMA table_info(stories)');
    const publishedCount = storyColumns.filter((column) => column.name === 'published_at').length;
    assert.equal(publishedCount, 1);
  } finally {
    await dbHandle.close();
  }
}));

test('older databases are upgraded without losing existing users and stories', withTempDatabase(async (databasePath) => {
  const { app, db } = loadAppModules();
  const { init } = db;
  const { initializeDatabase } = app;
  const legacyDb = new sqlite3.Database(databasePath);
  await new Promise((resolve, reject) => {
    legacyDb.exec(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        role TEXT DEFAULT 'user'
      );
      CREATE TABLE stories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        author_id INTEGER,
        category TEXT
      );
      INSERT INTO users (username, password, role) VALUES ('legacy-admin', 'hashed-password', 'admin');
      INSERT INTO stories (title, status, category) VALUES ('Legacy story', 'published', 'Local');
    `, (error) => error ? reject(error) : resolve());
  });
  legacyDb.close();

  await initializeDatabase();

  const dbHandle = await init();
  try {
    const legacyUser = await dbHandle.get('SELECT username, role FROM users WHERE username = ?', ['legacy-admin']);
    assert.ok(legacyUser);
    assert.equal(legacyUser.role, 'admin');

    const story = await dbHandle.get('SELECT title, status, published_at FROM stories WHERE title = ?', ['Legacy story']);
    assert.ok(story);
    assert.equal(story.status, 'published');
    assert.ok(story.published_at || story.published_at === null);
  } finally {
    await dbHandle.close();
  }
}));

test('published_at duplicate-column regression does not recur on repeated migration startup', withTempDatabase(async () => {
  const { app, db } = loadAppModules();
  const { init } = db;
  const { initializeDatabase } = app;
  await initializeDatabase();
  await initializeDatabase();
  const dbHandle = await init();
  try {
    const storyColumns = await dbHandle.all('PRAGMA table_info(stories)');
    const publishedColumns = storyColumns.filter((column) => column.name === 'published_at');
    assert.equal(publishedColumns.length, 1);
  } finally {
    await dbHandle.close();
  }
}));

function resolveDatabasePathForTest(expectedPath) {
  return expectedPath;
}
