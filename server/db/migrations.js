const fs = require('fs');
const path = require('path');
const { createPool, isMysqlConfigured } = require('./pool');

const migrationDirectory = path.join(__dirname, '..', '..', 'migrations');

async function getAppliedMigrations(connection) {
  const [rows] = await connection.execute(
    'SELECT migration_name FROM schema_migrations ORDER BY id ASC'
  );
  return new Set(rows.map((row) => row.migration_name));
}

function getMigrationFiles() {
  if (!fs.existsSync(migrationDirectory)) {
    return [];
  }
  return fs.readdirSync(migrationDirectory)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

async function runMigrations() {
  if (!isMysqlConfigured()) {
    return { databaseType: 'sqlite', applied: [], skipped: true };
  }

  const pool = createPool();
  const connection = await pool.getConnection();
  try {
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        migration_name VARCHAR(255) NOT NULL,
        executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_name (migration_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const migrationFiles = getMigrationFiles();
    const applied = [];
    const appliedSet = await getAppliedMigrations(connection);

    for (const file of migrationFiles) {
      if (appliedSet.has(file)) {
        continue;
      }
      const script = fs.readFileSync(path.join(migrationDirectory, file), 'utf8');
      await connection.query(script);
      await connection.execute('INSERT INTO schema_migrations (migration_name) VALUES (?)', [file]);
      applied.push(file);
    }

    return { databaseType: 'mysql', applied, skipped: false };
  } finally {
    connection.release();
  }
}

module.exports = {
  getMigrationFiles,
  runMigrations,
};
