# mplocaltime

## Deployment

1. Create a local `.env` file from `.env.example` and add your values:

```bash
cp .env.example .env
# then edit .env and set JWT_SECRET, INITIAL_PASSWORD, INITIAL_USER_PASSWORD and VERCEL_TOKEN
```

Important security note:
- No production defaults are shipped in this repository.
- `JWT_SECRET`, `INITIAL_PASSWORD`, and `INITIAL_USER_PASSWORD` must be set explicitly in the environment before the app starts.
- Do not use predictable demo credentials in production or leave them in committed files.
- Seed/demo accounts are for local testing only and are not a substitute for production secrets.

2. Deploy to Vercel:

```bash
cd /workspaces/mplocaltime
npx vercel --prod --yes
```

If you prefer interactive login instead of a token, run `npx vercel login` first.
