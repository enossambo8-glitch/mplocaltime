const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const mysql = require('mysql2/promise');
const { init, resolveDatabasePath, isMysqlConfigured } = require('../db');

async function backupSqlite() {
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

  return {
    database_type: 'sqlite',
    source: sourcePath,
    backup_path: backupPath,
    backup_size_bytes: backupSize,
    integrity_check: integrity,
  };
}

async function backupMysql() {
  const config = {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: Number(process.env.DB_PORT || 3306),
  };
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFile = `backups/mlt-${timestamp}.sql`;
  const dir = path.join(process.cwd(), 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const targetPath = path.join(dir, path.basename(backupFile));

  const connection = await mysql.createConnection(config);
  try {
    const [rows] = await connection.query('SHOW TABLES');
    const tableNames = rows.map((row) => Object.values(row)[0]);
    const dump = [];
    for (const table of tableNames) {
      const [createRows] = await connection.query(`SHOW CREATE TABLE \`${table}\``);
      const createStatement = createRows[0]['Create Table'];
      dump.push(`-- table: ${table}`);
      dump.push(createStatement + ';');
      const [dataRows] = await connection.query(`SELECT * FROM \`${table}\``);
      if (dataRows.length > 0) {
        const columns = Object.keys(dataRows[0]);
        for (const row of dataRows) {
          const values = columns.map((column) => {
            const value = row[column];
            if (value === null || value === undefined) return 'NULL';
            if (typeof value === 'number') return String(value);
            if (value instanceof Date) return `'${value.toISOString().replace(/'/g, "''")}'`;
            return `'${String(value).replace(/'/g, "''")}'`;
          });
          dump.push(`INSERT INTO \`${table}\` (${columns.map((column) => `\`${column}\``).join(', ')}) VALUES (${values.join(', ')});`);
        }
      }
    }
    fs.writeFileSync(targetPath, `${dump.join('\n\n')}\n`, 'utf8');
    return {
      database_type: 'mysql',
      source: `${config.database}@${config.host}:${config.port}`,
      backup_path: targetPath,
      backup_size_bytes: fs.statSync(targetPath).size,
    };
  } finally {
    await connection.end();
  }
}

async function main() {
  const result = isMysqlConfigured() ? await backupMysql() : await backupSqlite();
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error('Database backup failed:', error.message);
  process.exit(1);
});
