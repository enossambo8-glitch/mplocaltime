const { init, resolveDatabasePath } = require('../db');

async function main() {
  const db = await init();
  try {
    const schemaTable = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
    const currentVersion = schemaTable
      ? await db.get('SELECT name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1')
      : null;
    const recordCount = schemaTable
      ? await db.get('SELECT COUNT(*) AS count FROM schema_migrations')
      : { count: 0 };

    const payload = {
      database_path: resolveDatabasePath(),
      schema_version: currentVersion ? currentVersion.name : 'none',
      applied_at: currentVersion ? currentVersion.applied_at : null,
      migration_count: Number(recordCount.count || 0),
      status: schemaTable ? 'ready' : 'pending',
    };

    console.log(JSON.stringify(payload, null, 2));
  } finally {
    await db.close();
  }
}

main().catch((error) => {
  console.error('Database status check failed:', error.message);
  process.exit(1);
});
