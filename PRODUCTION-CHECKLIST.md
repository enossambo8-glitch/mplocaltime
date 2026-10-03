# Production deployment checklist

## Before deployment
- [ ] Confirm the branch is the intended release branch.
- [ ] Confirm the local repository is clean and the baseline matrix is verified.
- [ ] Confirm `npm test -- --test-reporter=spec` passes.
- [ ] Confirm `NODE_ENV=production npm run production:check` passes.
- [ ] Confirm the server account and hosting directory are available.
- [ ] Confirm the production domain, DNS, and TLS certificate are ready.

## Database and storage
- [ ] Confirm a dedicated data directory exists.
- [ ] Confirm the SQLite file sits outside the public web root.
- [ ] Confirm uploads/media are stored outside the public web root where practical.
- [ ] Confirm backups directory exists and is writable by the service account.
- [ ] Confirm the database file is not tracked by Git.
- [ ] Confirm `npm run db:migrate` succeeds.
- [ ] Confirm `npm run db:status` shows the expected schema version.
- [ ] Confirm `npm run db:backup` creates a backup and the backup passes integrity checks.

## Environment
- [ ] `.env` exists on the server.
- [ ] `.env` is not committed to Git.
- [ ] `JWT_SECRET` is set to a secret value.
- [ ] `INITIAL_PASSWORD` is set.
- [ ] `INITIAL_USER_PASSWORD` is set.
- [ ] `PORT` is set for the production service.
- [ ] `HOST` is configured to the intended bind address.
- [ ] `SITE_URL` matches the real production domain.
- [ ] `TRUST_PROXY` is configured only for a trusted reverse proxy.
- [ ] `ADSENSE_ENABLED=false` unless Google approval is active.

## Security
- [ ] Production credentials are not stored in source control.
- [ ] No placeholder or demo secrets remain.
- [ ] Protected admin and newsroom routes remain protected.
- [ ] The health endpoint does not leak sensitive data.
- [ ] The database path is not web accessible.
- [ ] No fake publisher or seller relationship is claimed in `ads.txt`.

## Application and content
- [ ] `npm start` starts the app in production mode.
- [ ] `/health` returns a healthy response.
- [ ] Homepage loads successfully.
- [ ] Published stories render correctly.
- [ ] Draft and archived content remain hidden appropriately.
- [ ] Category, municipality, and article pages render correctly.
- [ ] RSS and sitemap endpoints respond successfully.
- [ ] The app uses trusted canonical URLs and production-safe metadata.

## Advertising and SEO
- [ ] Direct advertising remains functional without Google AdSense.
- [ ] `ADSENSE_ENABLED=false` prevents ad script injection.
- [ ] `/ads.txt` does not claim a fake Google relationship.
- [ ] `robots.txt`, `sitemap.xml`, `news-sitemap.xml`, and RSS endpoints are valid.
- [ ] `NewsArticle` JSON-LD is valid for a sample published article.

## Accessibility and performance
- [ ] Skip links and landmarks remain present.
- [ ] Keyboard and focus behavior remains acceptable.
- [ ] Mobile navigation continues to work.
- [ ] Large static assets are not duplicated unnecessarily.
- [ ] Third-party traffic stays off while AdSense is disabled.

## Deployment and rollback
- [ ] Restart command is prepared for the actual service manager.
- [ ] Backup command is ready.
- [ ] Rollback path is documented.
- [ ] The operator has a clear procedure for restoring the prior database snapshot.
- [ ] Launch is announced only after the live server has actual verification.
