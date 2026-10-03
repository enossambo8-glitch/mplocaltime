# MLT deployment procedure

This document is the repository-side deployment package for Mpumalanga Local Time. It covers the exact server setup, migration order, environment requirements, verification steps, and rollback path for a controlled production deployment.

## 1. Runtime and prerequisites

- Node.js: >=20
- Package manager: npm
- Database: SQLite (production database kept outside the public web root)
- Runtime command: `npm start`
- Health check endpoint: `/health`

## 2. Server layout

Use a server layout like the following:

```text
/home/<cpanel-user>/
  mplocaltime-app/
  mlt-data/
    mplocaltime.db
  mlt-uploads/
  mlt-backups/
```

Keep the following outside disposable deployment folders:

- `.env`
- SQLite database file
- uploads/media directory
- backups directory

## 3. Required environment values

Create a production `.env` file from `.env.example` and replace placeholder values with real server values. Do not commit secrets.

```bash
cp .env.example .env
```

Example production values:

```bash
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
DATABASE_PATH=/home/<cpanel-user>/mlt-data/mplocaltime.db
SITE_URL=https://www.example.com
JWT_SECRET=<secure-random-secret>
INITIAL_PASSWORD=<secure-admin-password>
INITIAL_USER_PASSWORD=<secure-contributor-password>
MEDIA_UPLOAD_DIR=/home/<cpanel-user>/mlt-uploads
ADSENSE_ENABLED=false
```

Set `TRUST_PROXY=1` only if the application is behind a trusted reverse proxy that terminates TLS and forwards standard proxy headers.

## 4. Install dependencies

```bash
cd /home/<cpanel-user>/mplocaltime-app
npm ci
```

## 5. Preflight check

```bash
npm run production:check
```

This command fails if critical production configuration is missing or obviously insecure. The check is intentionally conservative and does not make destructive changes.

## 6. Database migration and backup

Before starting the app, migrate the schema:

```bash
npm run db:migrate
npm run db:status
```

Create a backup before any production schema change or deployment update:

```bash
npm run db:backup
```

## 7. Start the app in production mode

```bash
cd /home/<cpanel-user>/mplocaltime-app
NODE_ENV=production DATABASE_PATH=/home/<cpanel-user>/mlt-data/mplocaltime.db npm start
```

The underlying runtime command remains:

```bash
npm start
```

The application will bind to the configured `HOST` and `PORT` and must be placed behind a trusted reverse proxy or TLS terminator if the public site is served through Apache/Passenger or a node-based reverse proxy.

## 8. Health verification

After startup, confirm the app is healthy:

```bash
curl -fsS http://127.0.0.1:3000/health
curl -fsS http://127.0.0.1:3000/
curl -fsS http://127.0.0.1:3000/robots.txt
curl -fsS http://127.0.0.1:3000/sitemap.xml
```

The `/health` route reports a simple success payload and does not reveal secrets.

## 9. cPanel / SSH deployment pattern

A generic cPanel or SSH deployment should follow this pattern:

```bash
ssh <user>@<server>
cd /home/<cpanel-user>/mplocaltime-app
git fetch origin
git checkout main
git pull --ff-only origin main
npm ci
npm run production:check
npm run db:backup
npm run db:migrate
npm run db:status
pm2 restart mplocaltime || systemctl restart mplocaltime
```

If the deployment runs under Apache or cPanel with a different process manager, replace the restart command with the appropriate service manager. The important sequence is: validate config, back up, migrate, restart, verify health.

## 10. Rollback procedure

If deployment fails or the migration introduces issues:

1. Stop the app process or take it out of service.
2. Preserve the failed database and logs for investigation.
3. Restore the most recent verified backup if required.
4. Check out the last known-good code version.
5. Reinstall dependencies if needed.
6. Re-run migration and status checks.
7. Restart and verify health and public pages.
8. Only then resume traffic.

Do not run destructive Git reset commands as a normal deployment path. Protect runtime uploads and persistent database files.

## 11. AdSense and ads.txt

The repository defaults to:

```bash
ADSENSE_ENABLED=false
```

The `ads.txt` route remains intentionally empty unless a valid AdSense publisher relationship has been approved by Google for the live production domain. No fake seller relationship is inserted into the repository or corresponding deployment.

## 12. Production launch checklist

Before a live public launch, confirm the following:

- Node version is supported (`>=20`)
- `.env` is present and private
- `SITE_URL` is trustworthy and matches the canonical domain
- database path is outside the public web root
- uploads path is outside the public web root
- `JWT_SECRET` is not placeholder data
- `INITIAL_PASSWORD` and `INITIAL_USER_PASSWORD` are set
- `ADSENSE_ENABLED=false` until approval is complete
- database migration succeeds cleanly
- `npm run production:check` passes
- health endpoint responds successfully
- public homepage and article content load without internal metadata leakage
- private admin/newsroom routes remain protected
- rollback plan is ready

This repository is production-ready in the sense that the code and deployment procedures are verified locally. The actual live cutover still requires real hosting access, DNS changes, TLS steps, and the operator’s approval.
