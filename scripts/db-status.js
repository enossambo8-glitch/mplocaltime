require("dotenv").config();
const { init, resolveDatabasePath, isMysqlConfigured } = require('../db');

async function main() {
  const db = await init();
  try {
    let schemaTable = null;
    let currentVersion = null;
    let recordCount = { count: 0 };

    if (isMysqlConfigured()) {
      schemaTable = await db.get("SELECT TABLE_NAME AS name FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'schema_migrations'");
      currentVersion = schemaTable ? await db.get('SELECT migration_name AS name, executed_at AS applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1') : null;
      recordCount = schemaTable ? await db.get('SELECT COUNT(*) AS count FROM schema_migrations') : { count: 0 };
    } else {
      schemaTable = await db.get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'");
      currentVersion = schemaTable ? await db.get('SELECT name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 1') : null;
      recordCount = schemaTable ? await db.get('SELECT COUNT(*) AS count FROM schema_migrations') : { count: 0 };
    }

    const payload = {
      database_type: isMysqlConfigured() ? 'mysql' : 'sqlite',
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
