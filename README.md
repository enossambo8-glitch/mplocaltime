# Mpumalanga Local Time

## Production runtime

The application is designed to run as a Node.js Express service with a local SQLite database. The repository-side production start command is:

```bash
npm start
```

Run it with a production environment, for example:

```bash
NODE_ENV=production \
PORT=3000 \
HOST=0.0.0.0 \
DATABASE_PATH=/home/<user>/data/mplocaltime.db \
SITE_URL=https://www.example.com \
JWT_SECRET='<secure-random-secret>' \
INITIAL_PASSWORD='<secure-admin-password>' \
INITIAL_USER_PASSWORD='<secure-reporter-password>' \
ADSENSE_ENABLED=false \
npm start
```

## Required setup

1. Copy `.env.example` to `.env` and fill in production values.
2. Keep the database file outside a publicly served web root.
3. Keep uploads and backup directories outside disposable deployment folders.
4. Set `JWT_SECRET`, `INITIAL_PASSWORD`, and `INITIAL_USER_PASSWORD` explicitly.
5. Leave `ADSENSE_ENABLED=false` until a valid approved Google publisher configuration exists.

## Repository commands

```bash
npm ci
npm run db:migrate
npm run db:status
npm run production:check
npm test -- --test-reporter=spec
```

## Production deployment guidance

Use the deployment documentation in [DEPLOYMENT.md](./DEPLOYMENT.md) for the full cPanel/SSH rollout procedure, environment file layout, migration order, database backup guidance, and rollback path.

## Security notes

- No real production secrets should be committed.
- `.env` must remain untracked.
- `SITE_URL` must be the trusted production domain, not a request Host header.
- AdSense remains inactive by default; activation requires a legitimate Google publisher setup.
