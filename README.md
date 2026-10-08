# Mpumalanga Local Time

## Production runtime

The application is designed to run as a Node.js Express service with a MariaDB/MySQL production database and a SQLite fallback for local development and repository tests. The repository-side production start command is:

```bash
npm start
```

Production mode should use MariaDB/MySQL connection variables, for example:

```bash
NODE_ENV=production \
PORT=3000 \
HOST=0.0.0.0 \
DB_HOST=localhost \
DB_PORT=3306 \
DB_NAME=cpaneluser_mlt \
DB_USER=cpaneluser_mltuser \
DB_PASSWORD='<secure-db-password>' \
SITE_URL=https://www.example.com \
JWT_SECRET='<secure-random-secret>' \
INITIAL_PASSWORD='<secure-admin-password>' \
INITIAL_USER_PASSWORD='<secure-reporter-password>' \
ADSENSE_ENABLED=false \
npm start
```

## Required setup

1. Copy `.env.example` to `.env` and fill in production values.
2. Create the MariaDB/MySQL database and user in cPanel.
3. Grant the database user the privileges required by the application.
4. Keep uploads and backup directories outside disposable deployment folders.
5. Set `JWT_SECRET`, `INITIAL_PASSWORD`, and `INITIAL_USER_PASSWORD` explicitly.
6. Leave `ADSENSE_ENABLED=false` until a valid approved Google publisher configuration exists.
7. Run `npm run db:migrate` after creating the database user and schema.
8. Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, and `SMTP_FROM` for password-reset email delivery.

## Repository commands

```bash
npm ci
npm run db:migrate
npm run db:status
npm run db:backup
npm run db:import-sqlite
npm run db:verify
npm run production:check
npm test -- --test-reporter=spec
```

## Production deployment guidance

Use the deployment documentation in [DEPLOYMENT.md](./DEPLOYMENT.md) for the full cPanel/SSH rollout procedure, environment file layout, migration order, database backup guidance, and rollback path.

## Security notes

- No real production secrets should be committed.
- `.env` must remain untracked.
- `SITE_URL` must be the trusted production domain, not a request Host header.
- The `DB_PASSWORD` and other database settings are never printed in logs.
- Password-reset links are single-use and expire after 30 minutes.
- AdSense remains inactive by default; activation requires a legitimate Google publisher setup.
