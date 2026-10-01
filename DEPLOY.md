# Deploying Challenge Gym to Cloudflare

After a one-time setup, every push to `main` on GitHub deploys the whole system automatically.
The workflow is [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).

```
push to main ──► 1. check ─────────► 2. workers ──────────────────────► 3. pages
                 type-check          R2 bucket (if missing)             admin app  ─┐ both run
                 unit tests          D1 migrations                      member app ─┘ in parallel
                 build both apps     device · admin · member workers
                                     worker secrets
```

| Piece | Cloudflare product | Name |
|---|---|---|
| Database | D1 | `challenge-gym` |
| Files (photos, proofs, gym content) | R2 | `challenge-gym-files` |
| X990 + gym-PC endpoint, 5-min cron | Worker (public) | `challenge-gym-device` |
| Admin API | Worker (private, no URL) | `challenge-gym-admin-api` |
| Member API | Worker (private, no URL) | `challenge-gym-member-api` |
| Admin app | Pages | `challenge-gym-admin` |
| Member app | Pages | `challenge-gym-member` |

Each app reaches its API through a **service binding**, so the API workers have no public URL.
Cookies stay on the app's own domain.

---

## Step 1 — What you need

- A Cloudflare account. The free plan works to start. The paid Workers plan ($5/month) raises the
  limits, and you should use it once all members are on the app.
- This folder pushed to GitHub (`github.com/Yuvasubharam/Challenge-GYM`, branch `main`).
- Node 22 on your PC, and one `npm install` inside `server\`, for the one-time commands below.

> **The repo is public.** Never commit `server\.dev.vars`, the Excel sheet, or any token.
> `.gitignore` already covers them. Every secret below goes into GitHub **Secrets**.

## Step 2 — Create the database (once, from your PC)

```powershell
cd "Challenge Gym\server"
npx wrangler login                    # opens the browser; allow access
npx wrangler d1 create challenge-gym
```

Copy the `database_id` it prints (it looks like `3f2a…-…`). You will paste it into GitHub in Step 4.
**Don't** paste it into the `wrangler.*.toml` files; the workflow fills it in at deploy time.

Also note your **Account ID**. It is in the Cloudflare dashboard's right sidebar on *Workers & Pages*,
or run `npx wrangler whoami`.

> The R2 bucket and the two Pages projects are created by the workflow on its first run.

## Step 3 — Create an API token for GitHub

Cloudflare dashboard → *My Profile* → *API Tokens* → **Create Token** → *Create Custom Token*:

| Permission (Account) | Access |
|---|---|
| Workers Scripts | Edit |
| D1 | Edit |
| Workers R2 Storage | Edit |
| Cloudflare Pages | Edit |
| Account Settings | Read |

- **Account resources:** include only your account.
- **Custom domains:** if you use them (Step 8), also add *Zone → Workers Routes → Edit* for that zone.
- Copy the token. Cloudflare shows it only once.

## Step 4 — Generate the app secrets (once, on your PC)

```powershell
cd "Challenge Gym\server"
# three different long random strings: admin JWT, member JWT, gym-PC agent token
1..3 | % { node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))" }
# phone-notification keys (keep this pair forever, or members must turn notifications on again)
node scripts/gen-vapid.mjs
```

Keep them in your password manager. Then in GitHub open the repo → *Settings* → *Secrets and
variables* → *Actions*.

**Secrets** tab → *New repository secret*:

| Secret | Value |
|---|---|
| `CLOUDFLARE_API_TOKEN` | token from Step 3 |
| `CLOUDFLARE_ACCOUNT_ID` | account ID from Step 2 |
| `ADMIN_JWT_SECRET` | random string #1 |
| `MEMBER_JWT_SECRET` | random string #2 (**must differ** from #1; the workflow checks) |
| `AGENT_TOKEN` | random string #3 (for the optional gym-PC agent) |
| `SETUP_TOKEN` | any passphrase you choose; used once to create the owner login |
| `VAPID_PRIVATE` | `VAPID_PRIVATE=` value from `gen-vapid.mjs` |

**Variables** tab → *New repository variable*. These are not secret:

| Variable | Value |
|---|---|
| `D1_DATABASE_ID` | `database_id` from Step 2 |
| `VAPID_PUBLIC` | `VAPID_PUBLIC=` value from `gen-vapid.mjs` |

*Optional, recommended:* *Settings* → *Environments* → **production** → *Required reviewers* →
add yourself. Every deploy then waits for your click before it touches the live database.
The environment is created automatically on the first run if you skip this.

## Step 5 — First deploy

GitHub → **Actions** → *Deploy to Cloudflare* → **Run workflow**:

- *What to deploy:* `all`
- **Load foods + exercises:** ✅ tick it the first time. It loads 1,068 foods and 2,023 exercises,
  and skips itself if they're already there.

It takes about 4–6 minutes. The **workers** job log shows:

- **Restore point:** a D1 Time Travel bookmark. It appears on every run, so you can undo a bad migration (Step 10).
- **Apply D1 migrations:** `0001 … 0007` ✅.
- **Deploy device worker:** its URL, `https://challenge-gym-device.<your-subdomain>.workers.dev`.
  Write it down for the X990.

The **pages** jobs print the app URLs:

- Admin: `https://challenge-gym-admin.pages.dev`
- Member: `https://challenge-gym-member.pages.dev`

Quick check: open `https://challenge-gym-device.<sub>.workers.dev/health`. It should return `{"ok":true…}`.

## Step 6 — First login and data

1. Open the **admin** URL. It asks to create the owner: enter the `SETUP_TOKEN`, a username and a
   strong password. After that, setup is locked for good (it answers "Setup already completed").
2. *Settings → Import Excel* → `GYM_Membership_System (1).xlsx`. Check the preview, then import.
   Your local test database is **not** copied to production, so this import is the real start.
3. *Settings → Gym & UPI*: gym name, phone, address, and the UPI ID for member payments.
4. *Settings → Staff logins*: add the front-desk staff.
5. Members open the **member** URL → *First time here?* → mobile + member ID → choose a password.
   On phones: *Add to Home Screen* (needed on iPhone for notifications).

## Step 7 — Point the X990 at the cloud (at the gym)

The X990 speaks plain HTTP on port 80. The `*.workers.dev` hostname accepts that. From the gym PC,
on the same LAN as the device:

```powershell
cd "Challenge Gym\agent"; pip install -r requirements.txt
python tools\set_cloud_server.py show
python tools\set_cloud_server.py cloud challenge-gym-device.<your-subdomain>.workers.dev
```

The device restarts (~45 s) and shows **Online via adms** on *Admin → Device*. Only serial
`CUB7252100258` is accepted (`DEVICE_SN_ALLOWLIST` in `wrangler.device.toml`). Then:

- Review *Admin → Device → Pending changes*.
- Switch on **Automatic blocking** when the list looks right.
- Clear *Always allow* on members 452 and 606 if that was only for testing.

## Step 8 — Domains: challengegym.in

| Hostname | Serves |
|---|---|
| `challengegym.in` | member app (`challenge-gym-member`) |
| `www.challengegym.in` | redirects to `challengegym.in` |
| `admin.challengegym.in` | admin app (`challenge-gym-admin`) |
| `device.challengegym.in` *(optional)* | X990 endpoint (`challenge-gym-device`); otherwise use the workers.dev hostname |

### 8a. Move the domain's DNS to Cloudflare (once)

Pages can only serve a bare domain (`challengegym.in`, no `www`) when the domain's DNS is on
Cloudflare. As of Sep 2026 it is on **Netlify DNS** (`dns1–4.p07.nsone.net`). The domain has no
email (MX) records, so nothing else breaks when you move it.

1. Cloudflare dashboard → **Add a domain** → `challengegym.in` → *Free* plan → continue.
   Cloudflare imports the existing records. **Delete** the imported `A`/`AAAA`/`CNAME` records for
   `challengegym.in` and `www` that point to Netlify (`13.215.239.219`, `52.74.6.109`, and the
   `2406:da18:…` addresses). Pages adds its own records in 8b.
2. Cloudflare shows two nameservers (e.g. `xxx.ns.cloudflare.com`). Where you **bought** the domain
   (the registrar, not Netlify), replace the four `nsone.net` nameservers with those two.
3. Wait for Cloudflare to say **Active**. It is usually under an hour and can take up to 24 h.
4. Remove the domain from the old Netlify site (*Domain management*), or the old site stays up
   until the nameserver change is done.
5. *SSL/TLS* → **Full (strict)**.

### 8b. Attach the apps (after the first deploy)

- *Workers & Pages* → `challenge-gym-member` → *Custom domains* → **Set up a domain** →
  `challengegym.in`. Repeat for `www.challengegym.in`.
- *Workers & Pages* → `challenge-gym-admin` → *Custom domains* → `admin.challengegym.in`.
- `www` → bare domain: *Rules → Redirect Rules* → template *Redirect from WWW to root* → 301.

Cloudflare creates the DNS records and certificates. The `*.pages.dev` addresses keep working.

### 8c. Device hostname (optional)

`challenge-gym-device.<sub>.workers.dev` works fine for the X990. If you prefer your own name:

1. *Workers & Pages* → `challenge-gym-device` → *Settings → Domains & Routes* → *Add* →
   *Custom domain* → `device.challengegym.in`.
2. The X990 cannot do HTTPS. Go to *Rules → Configuration Rules* → *Create* →
   hostname equals `device.challengegym.in` → **Automatic HTTPS Rewrites: Off** and
   **Always Use HTTPS: Off**.
3. Do **not** turn on HSTS with *include subdomains* for the zone. It doesn't stop the X990, but
   browsers would then refuse `http://device…`, which makes it hard to test.
4. `python tools\set_cloud_server.py cloud device.challengegym.in`

### Notes

- Decide the member domain **before** members turn on phone notifications. A subscription belongs
  to the domain it was made on (`challengegym.in`), so moving later means everyone re-enables it.
- Each app keeps its own login cookie. `challengegym.in` and `admin.challengegym.in` never share
  sessions, and the admin API still refuses member tokens.
- Tell members to use **challengegym.in** and *Add to Home Screen* from there, not from `pages.dev`.

## Step 9 — Everyday use

- **Deploy:** push to `main`. Changes to `*.md` files or `agent/` alone don't trigger a deploy.
- **Deploy by hand:** *Actions → Run workflow*. Pick `workers` (API + database only) or `pages`
  (apps only).
- **Database changes:** add a new numbered file such as `server/migrations/0008_something.sql`.
  - Never edit a migration that has already run.
  - Keep changes **additive** (new tables or columns, nullable or with defaults). Migrations run
    *before* the new workers go live, so the old code must keep working against the new schema.
  - Test locally first: `npm run db:migrate:local`.
- **Rotate a secret:** update it in GitHub Secrets, then re-run the workflow (`workers`).
  - Changing `ADMIN_JWT_SECRET` or `MEMBER_JWT_SECRET` signs everyone out, which is the point after a leak.
  - Changing `AGENT_TOKEN` means updating `agent\.env` on the gym PC.
- **Watch live logs:** `npx wrangler tail -c wrangler.admin.toml` (or `.device.toml` / `.member.toml`)
  from `server\`, after `wrangler login`.

## Step 10 — Rolling back

| What broke | Fix |
|---|---|
| An app page | *Workers & Pages* → the Pages project → *Deployments* → older deployment → **Rollback** |
| A worker | *Workers & Pages* → the worker → *Deployments* → **Rollback**, or `npx wrangler rollback -c wrangler.admin.toml` |
| Data or a migration | Find the bookmark in that run's *Restore point* step, then run `npx wrangler d1 time-travel restore challenge-gym --bookmark=<bookmark>` (needs the real id in the toml, or run it from the dashboard's D1 → *Time Travel*) |

Time Travel keeps 30 days on the paid plan (7 on free). A D1 restore rewinds **everything**
after that point, including new payments, so check with the desk first.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `D1_DATABASE_ID is not set` | Add the variable (Step 4, *Variables* tab, not *Secrets*). |
| `Authentication error [code: 10000]` | Token missing a permission from Step 3, or wrong account ID. |
| `ADMIN_JWT_SECRET and MEMBER_JWT_SECRET must be different` | Make them different; this keeps admin and member sessions separate. |
| Admin app loads but every call fails with *Something went wrong* / 500 | Secrets not set yet: check the *Sync worker secrets* step ran, then reload. |
| Admin app shows 404 on `/api/...` | The Pages project lost its service binding. Re-run with target `pages`. It reads `admin-app/wrangler.toml`. |
| Owner setup says *Invalid setup token* | `SETUP_TOKEN` secret missing or mistyped; fix it and re-run `workers`. |
| Member bell works but no phone notifications | `VAPID_PUBLIC` variable or `VAPID_PRIVATE` secret missing. On iPhone, the app must be opened from the Home Screen. |
| Device stays offline | It must use the **workers.dev** or HTTPS-off hostname on port 80, in IP/DNS mode with a DNS on the gym's subnet. `set_cloud_server.py` sets all three. |
| *Load foods + exercises* says already loaded | Expected after the first run. |

## Deploying from your PC instead (no GitHub)

This is the manual equivalent of the workflow. Use it only if Actions is unavailable. Temporarily
put the real `database_id` into the three `wrangler.*.toml` files, and **don't commit** that change.

```powershell
cd "Challenge Gym\server"
npx wrangler r2 bucket create challenge-gym-files            # first time only
npm run db:migrate:remote
npm run db:fitness:remote                                    # first time only
npm run deploy:device
npx wrangler deploy -c wrangler.admin.toml  --var VAPID_PUBLIC:<key>
npx wrangler deploy -c wrangler.member.toml --var VAPID_PUBLIC:<key>
npx wrangler secret put JWT_SECRET    -c wrangler.admin.toml    # and SETUP_TOKEN, VAPID_PRIVATE
npx wrangler secret put JWT_SECRET    -c wrangler.member.toml   # different value!
npx wrangler secret put AGENT_TOKEN   -c wrangler.device.toml
cd ..\admin-app;  npm run build; npx wrangler pages deploy dist --project-name challenge-gym-admin  --branch main
cd ..\member-app; npm run build; npx wrangler pages deploy dist --project-name challenge-gym-member --branch main
git checkout -- ..\server\wrangler.*.toml                     # remove the database id again
```
