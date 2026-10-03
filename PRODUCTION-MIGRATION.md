# Production database and server migration

This repository is prepared for a controlled production migration without performing the live cutover in Codespaces. The purpose of this guide is to document the safe procedure for the real server environment once the server-side account and domain are available.

## 1. Checkpoint and validation

Before production migration work, verify the repository is at the intended checkpoint and the application test suite remains green.

```bash
git status --short --branch
git branch -vv
git log -7 --oneline
npm test -- --test-reporter=spec
```

The MLT-009 checkpoint expects a clean branch plus a passing baseline. MLT-010 adds the final repository-side deployment package and documentation only.

## 2. Configure production environment

Create a server-specific `.env` file from `.env.example` and set production values. Do not commit real passwords or secrets.

Required values for production include:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/home/<account>/data/mplocaltime.db
SITE_URL=https://www.example.com
JWT_SECRET=<secure-random-secret>
INITIAL_PASSWORD=<temporary-admin-password>
INITIAL_USER_PASSWORD=<temporary-user-password>
ADSENSE_ENABLED=false
```

Optional values:

```bash
TRUST_PROXY=1
MEDIA_UPLOAD_DIR=/home/<account>/data/uploads
MEDIA_MAX_BYTES=10485760
ADSENSE_PUBLISHER_ID=
ADSENSE_ADS_TXT_ENTRY=
```

Production guidance:

- Keep the SQLite database outside any publicly served directory.
- Keep uploads outside `public/` unless that is explicitly mounted as a private static area.
- Set `JWT_SECRET` to a strong secret. Do not accept placeholder values such as `changeme`, `secret`, or `development` in production.
- Leave AdSense disabled until the Google account and configuration are approved.

## 3. Prepare the database path and permissions

Use a dedicated directory owned by the application account, for example:

```bash
mkdir -p /home/<account>/data
mkdir -p /home/<account>/data/uploads
mkdir -p /home/<account>/backups
chown <account>:<group> /home/<account>/data /home/<account>/data/uploads /home/<account>/backups
chmod 700 /home/<account>/data /home/<account>/backups
chmod 750 /home/<account>/data/uploads
```

The SQLite database file may live under that directory, for example:

```text
/home/<account>/data/mplocaltime.db
```

Do not place the database inside a public web root or a document directory exposed directly by Apache/nginx.

## 4. Migration command

Run the migration/bootstrap command before starting the server:

```bash
npm run db:migrate
```

The migration entry point is the same code path used by application startup; it is idempotent and safe to re-run.

## 5. Check status before startup

```bash
npm run db:status
```

This prints the configured database path and the newest recorded schema version. It does not expose secrets.

## 6. Backup the existing production database

Before any upgrades or configuration changes, create a dedicated backup:

```bash
npm run db:backup
```

The helper creates a timestamped SQLite backup in the same database directory and verifies backup integrity. It never overwrites the source database.

## 7. Start the application in production mode

```bash
NODE_ENV=production DATABASE_PATH=/home/<account>/data/mplocaltime.db npm start
```

The application will not auto-clear production data. Test-only reset logic remains test-only and is not triggered in production mode.

## 8. Restore procedure

A restore is an administrator action, not an automatic startup action.

1. Stop the application or place it into maintenance mode.
2. Confirm the backup file exists and passes integrity checks.
3. Move the backup into place or point `DATABASE_PATH` at the recovered database file.
4. Re-run the application under the intended environment and verify the health endpoint.

Do not run a restore automatically during web traffic or on a live production site without explicit admin approval.

## 9. Verify schema health

After startup, verify the server and database are healthy:

```bash
npm run db:status
curl -f http://127.0.0.1:3000/health
```

The health route should return a minimal successful payload and not leak secrets, filesystem paths, or raw SQL.

## 10. Production launch remains deferred to the real server operator

This document prepares the repository for a future deployment. It does not perform the live DNS, hosting, or domain cutover. Final production launch remains the responsibility of the server administrator and the real hosting environment.
