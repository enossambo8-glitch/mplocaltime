const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { init, resolveDatabasePath } = require('../db');

async function main() {
  const sourcePath = resolveDatabasePath();
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Database does not exist at ${sourcePath}`);
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.dirname(sourcePath);
  const backupPath = path.join(dir, `mplocaltime-backup-${timestamp}.db`);

  const db = await init();
  try {
    await db.exec(`VACUUM INTO '${backupPath.replace(/'/g, "''")}'`);
  } finally {
    await db.close();
  }

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup file was not created at ${backupPath}`);
  }

  const backupSize = fs.statSync(backupPath).size;
  const integrity = await new Promise((resolve, reject) => {
    const backupDb = new sqlite3.Database(backupPath, sqlite3.OPEN_READONLY, (openError) => {
      if (openError) {
        reject(openError);
        return;
      }
      backupDb.all('PRAGMA integrity_check;', (queryError, rows) => {
        backupDb.close();
        if (queryError) {
          reject(queryError);
          return;
        }
        resolve(rows);
      });
    });
  });

  console.log(JSON.stringify({
    source: sourcePath,
    backup_path: backupPath,
    backup_size_bytes: backupSize,
    integrity_check: integrity,
  }, null, 2));
}

main().catch((error) => {
  console.error('Database backup failed:', error.message);
  process.exit(1);
});
