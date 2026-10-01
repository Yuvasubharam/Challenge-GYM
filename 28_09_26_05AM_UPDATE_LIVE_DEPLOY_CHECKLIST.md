# Live Deployment Checklist

Target window: after the D1 usage limit resets, after 5:00 AM IST. Do not run remote D1 writes before then.

## Confirmed State

- [x] Admin Pages deployed: `https://a7cb383c.challenge-gym-admin.pages.dev` (production project `challenge-gym-admin`; verified HTTP 200 on its production domain).
- [x] Member Pages deployed: `https://765ddf01.challenge-gym-member.pages.dev` (production project `challenge-gym-member`; verified `/launch` and launch MP3/MP4 assets return HTTP 200).
- [x] R2 bucket `challenge-gym-files` exists. Launch music, clock, and logo video are served from the member Pages `public/launch-media` bundle; no separate R2 upload was needed or made.
- [ ] Migration `server/migrations/0008_read_indexes.sql` exists. Its production status is **unverified**: the local Wrangler credentials were denied access to the configured D1 database. No migration was applied during this session.
- [ ] The configured production database ID is present in `wrangler.prod-*.toml`, but the current Cloudflare login could not access it. Confirm the authorized Cloudflare account/token and GitHub production variables before deployment.
- [ ] `launch.challengegym.in` did not resolve when last checked, and it was not listed as a custom domain on the member Pages project. Add the Pages domain and DNS record as part of publishing the launch page.
- [x] No D1 migration, Worker/device deployment, or attendance resend was performed with the Pages-only release.

## Before Deployment

- [ ] Wait until after 5:00 AM IST and confirm the D1 limit has reset.
- [ ] Authenticate with a Cloudflare account that owns or can access the production D1 database. Confirm the database ID matches the production database; do not use the local Wrangler config with `REPLACE_WITH_D1_DATABASE_ID`.
- [ ] Check production migration history:

  ```powershell
  cd "Challenge Gym\server"
  npx wrangler d1 migrations list challenge-gym --remote -c wrangler.prod-device.toml
  ```

- [ ] Confirm whether `0008_read_indexes.sql` is already applied. If it is pending, review its three `CREATE INDEX IF NOT EXISTS` statements and apply it once:

  ```powershell
  npx wrangler d1 migrations apply challenge-gym --remote -c wrangler.prod-device.toml
  ```

- [ ] Check GitHub Actions production environment values: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `D1_DATABASE_ID`, worker secrets, and VAPID values. Ensure the token can access Workers, D1, R2, Pages, and the `challengegym.in` zone.
- [ ] Confirm the release contains the intended device-worker fix, admin/member logo changes, and launch page/audio updates.

## Deploy All Changes

After the D1 limit resets and production access is verified, use **GitHub → Actions → Deploy to Cloudflare → Run workflow → `all`** to deploy the deferred D1 migration and Worker/device changes. The Pages apps have already been deployed; the `all` target also republishes them.

The workflow runs checks and builds first, then applies any pending D1 migrations, deploys the device/admin/member workers and secrets, and finally deploys both Pages apps. Verify each job succeeds. If the migration status check showed `0008` already applied, the workflow should report no pending migration for it.

## Publish Launch Subdomain

- [ ] In the Cloudflare Pages project `challenge-gym-member`, add `launch.challengegym.in` as a custom domain.
- [ ] Confirm the generated DNS record exists and resolves, and that HTTPS is active.
- [ ] Open `https://launch.challengegym.in/` and verify it serves the launch page; check `https://challengegym.in/` still serves the member app.

## Recover Attendance

- [ ] After the D1 limit resets, confirm device serial `CUB7252100258` is online via ADMS.
- [ ] Queue the supported device attendance-log resend for the missing time range; avoid issuing repeated resend requests while one is pending.
- [ ] Allow the device to poll and the device worker's 5-minute cron/reconciliation to run.
- [ ] Verify the recovered punches in Admin → Attendance against the device log, including timestamps and duplicate handling.

## Post-Deploy Checks

- [ ] Re-run the remote migration list and confirm `0008_read_indexes.sql` is applied.
- [ ] Check the device worker `/health` endpoint and Admin → Device for a recent ADMS heartbeat.
- [ ] Smoke-test admin sign-in, member sign-in, the member app, and the launch page.
- [ ] Confirm the launch page shows October 2, 2026 at 9:09 AM IST, the full-screen final countdown, fireworks, delayed soundtrack, feature reel, and muted logo video.
- [ ] Record the workflow run URL, migration result, recovered attendance range, and custom-domain status here or in the release notes.