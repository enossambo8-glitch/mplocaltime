# Google AdSense readiness for Mpumalanga Local Time

This repository keeps the existing direct advertising system in place and treats Google AdSense as a future optional network. AdSense remains disabled by default and must never be activated with a fake or placeholder publisher ID.

## Safe default

- `ADSENSE_ENABLED` defaults to `false`.
- `ADSENSE_PUBLISHER_ID` must be a real Google AdSense publisher ID in the form `ca-pub-...`.
- `ADSENSE_ADS_TXT_ENTRY` must only be populated with the real Google-authorised seller record after the production domain has been approved.
- The app will not inject the Google AdSense script when the feature is disabled or the publisher ID is missing or invalid.

## Production activation checklist

1. Create/approve the real Google AdSense account.
2. Add the correct MLT production domain to the AdSense account.
3. Obtain the real publisher ID from Google.
4. Set `ADSENSE_PUBLISHER_ID` in the production environment.
5. Obtain the exact authorised seller record for `/ads.txt` from Google.
6. Set `ADSENSE_ADS_TXT_ENTRY` to that exact value.
7. Verify the public `/ads.txt` route serves it without authentication.
8. Complete any required privacy, consent, and CMP requirements for the target jurisdiction.
9. Enable `ADSENSE_ENABLED=true` only after the configuration has been verified.
10. Redeploy and confirm the Google script appears only when enabled.
11. Confirm the direct MLT advertising system still renders and remains prioritised over AdSense.
12. Verify the homepage, story pages, municipality pages, and mobile layouts remain accessible and uncluttered.

## Security and policy notes

- No arbitrary JavaScript is accepted through configuration.
- Publisher IDs are validated before use.
- The application does not claim a fake seller relationship.
- Direct advertising and AdSense remain conceptually separate systems.
- Google display advertising is never treated as editorial content or newsroom permission.
