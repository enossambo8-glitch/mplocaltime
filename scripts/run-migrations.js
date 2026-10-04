const { runMigrations } = require('../server/db/migrations');

async function main() {
  const result = await runMigrations();
  console.log(JSON.stringify({
    database_type: result.databaseType,
    skipped: result.skipped,
    applied: result.applied,
  }, null, 2));
}

main().catch((error) => {
  console.error('Migration failed:', error.message);
  process.exit(1);
});
