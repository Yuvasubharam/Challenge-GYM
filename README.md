# Challenge Gym

Membership, payments, attendance and **door access control** for Challenge Gym, built on
Cloudflare (Pages + Workers + D1 + R2) and the eSSL X990 biometric device.

```
 Admin app (Pages) ──/api──► admin-api worker ─┐
                                               ├──► D1 database (one DB) + R2 (photos, payment screenshots)
 Member app (Pages) ─/api──► member-api worker ┘            ▲
                                                            │ intents (block / unblock / add user)
 eSSL X990 ──ADMS (HTTP)──► device worker ──────────────────┤  cron every 5 min: expiry → block, renewal → restore
 Gym PC agent ──HTTPS (outbound only)──► device worker ─────┘  fallback over LAN (TCP 4370) + eTimeTrack Lite mirror
```

* **Two separate apps, one database.** Admin and member apps are separate Pages projects, each
  with its own API worker, own session cookie and **different signing secret**; a member session is
  rejected by the admin API and vice-versa. Neither app talks to the device — they write intents to
  D1, and only the device worker delivers them.
* **Simple workflow.** Staff record payments/renewals; the system decides who may enter. Expired
  members are removed from the device (fingerprint backed up first) and restored instantly on renewal.
  Members can renew by UPI in their app; one tap on **Received** at the desk renews the plan and
  re-opens the door.

## Fitness tracker (member app)

Available to every member with app access — any plan, expired or not — and to staff. Admins can turn
the member app off per member (member → *More* → *Turn member app OFF*; takes effect immediately).

* **Onboarding:** age, gender, height (cm or ft/in), weight, goal (lose / gain / muscle / maintain / fitness),
  target weight, activity, workouts per week, veg/egg/non-veg → BMI (Asian-Indian cut-offs), healthy
  weight range, daily kcal (Mifflin–St Jeor × activity ± goal), protein/carbs/fat and water targets.
* **Diet:** 1,068 foods (1,016 Indian dishes + USDA basics) with Indian servings ("1 roti (40 g)"), veg filter,
  recent foods, custom foods, copy yesterday's meal, water glasses. Admins correct values in
  *Settings → Food database*.
* **Train:** 2,023 exercises (879 with photos), English/Hindi instructions, sets × reps × kg or minutes,
  calories burned (MET × kg × time), estimated 1RM personal records.
* **Progress:** weight trend & goal progress, BMI, 30-day calories in vs out, streak incl. gym check-ins.

Data credits (shown in the app): exercise data — hasaneyldrm/exercises-dataset (MIT, text only; its
Gym visual GIFs are **not** used, they need a paid licence); photos — yuhonas/free-exercise-db (public
domain); nutrition — Indian Nutrient Databank, USDA FoodData Central.

## Announcements & content (admin sidebar → *Announcements*)

What members see on their app home, managed in one place:

* **Posts:** notice / event (with date and time) / offer, with an optional image and button (to an app
  page like `/plan` or `/shop`, or an `https://` link). Posts can be pinned, hidden, or given an
  auto-hide date. Events disappear after their day.
* **Notifications:** posts marked *bell* show in the member's 🔔 with an unread count. Owners and
  admins can also **Send to phones** as web push, to members who turned it on (News → Notifications).
  Push works on Android Chrome and on iPhone once the app is added to the Home Screen (iOS 16.4+).
* **Home carousel:** slides with an image, headline, button, show-from/until dates and order.
* **Shop:** a product showcase with price/MRP, stock, categories and *feature on home*. Members tap
  *Reserve* and pay at the desk; reservations appear under Shop → Enquiries.
* **Gallery:** one album per event. Drag photos in; they are resized in the browser before upload.

Images live in R2 under `content/`. A file is deleted when nothing references it any more.

## Folders

| Folder | What |
|---|---|
| `server/` | All three workers (shared code), D1 migrations, tests |
| `admin-app/` | Admin PWA (desktop / tablet / phone) |
| `member-app/` | Member PWA |
| `agent/` | Python bridge for the gym PC (pyzk + eTimeTrack Lite reader) and device tools |

## Verified on the real X990 (26 Sep 2026)

Serial `CUB7252100258`, firmware Ver 6.60 (push 8.0.4.6), 683 users / 642 fingerprints.

* ✅ Cloud (ADMS) link: handshake, real-time punches, commands with results.
* ✅ Block = back up fingerprint → delete user; unblock = re-create user + restore fingerprint
  (byte-identical). Physically confirmed: blocked finger rejected, restored finger accepted.
* ❌ Changing a user's *group* does **not** stop the door on this firmware (679 users have a blank
  group and still enter) — that is why the old system never blocked anyone.
* Old cloud link was dead: port **8081** (Cloudflare can't serve it) + domain mode with DNS on the
  wrong subnet. The firmware also calls `/iclock/*.aspx` paths — handled.
* Device commands **must be tab-separated**; the old worker's space-separated commands created junk
  users like `CGA2 Privilege=14` (clean them up from Admin → Device → Roster issues).
* Member **#213 Vamsi has admin rights on the device menu** — remove them (Device → Roster issues).

## Run locally (Windows / PowerShell)

Needs Node 20+. First time only:

```powershell
cd "Challenge Gym\server";     npm install; npm run db:migrate:local
cd "..\admin-app";            npm install
cd "..\member-app";           npm install
```

`server\.dev.vars` (already created for development):

```
JWT_SECRET=dev-only-secret-change-me
SETUP_TOKEN=dev-setup
AGENT_TOKEN=dev-agent-token
VAPID_PUBLIC=…        # from: node scripts/gen-vapid.mjs (phone notifications)
VAPID_PRIVATE=…
```

Start (one terminal each):

```powershell
cd "Challenge Gym\server";  .\run-local.ps1 admin     # admin API   → :8788
cd "Challenge Gym\server";  .\run-local.ps1 member    # member API  → :8789 (own secret)
cd "Challenge Gym\server";  .\run-local.ps1 device    # device/ADMS → :8790 (only needed with the X990 on the LAN)
cd "Challenge Gym\admin-app";  npm run dev            # http://localhost:5180
cd "Challenge Gym\member-app"; npm run dev            # http://localhost:5181
```

* **Admin:** first visit asks to create the owner (setup token `dev-setup`).
* **Member:** tap *First time here?* → mobile + member ID from the Excel sheet → choose a password.
  Or in Admin → member → *More* → *Create member app login*.
* Import your data: Admin → Settings → **Import Excel** → `GYM_Membership_System.xlsx`
  (preview first; safe to re-import after editing the sheet).

Tests (with the admin + member workers running):

```powershell
cd "Challenge Gym\server"
node ..\..\node_modules\tsx\dist\cli.mjs test/admin-e2e.ts "..\GYM_Membership_System (1).xlsx"   # 47 checks
node ..\..\node_modules\tsx\dist\cli.mjs test/member-e2e.ts                                     # 35 checks
node ..\..\node_modules\tsx\dist\cli.mjs test/content-e2e.ts                                    # 59 checks (content + push)
# device protocol simulator (35 checks) — NOT while a real X990 is pointed at this PC:
node test/adms-sim.mjs
```

## Deploy to Cloudflare

```powershell
cd "Challenge Gym\server"
npx wrangler login
npx wrangler d1 create challenge-gym           # copy database_id into all three wrangler.*.toml
npx wrangler r2 bucket create challenge-gym-files
npm run db:migrate:remote
npm run db:fitness:remote        # 1,068 foods + 2,023 exercises (seed/fitness/*.sql, rebuild with db:fitness:build)

# secrets — use long random values; admin and member JWT secrets MUST differ
npx wrangler secret put JWT_SECRET  -c wrangler.admin.toml
npx wrangler secret put SETUP_TOKEN -c wrangler.admin.toml
npx wrangler secret put JWT_SECRET  -c wrangler.member.toml
npx wrangler secret put AGENT_TOKEN -c wrangler.device.toml

# phone notifications: generate once (keep the same pair forever, or members must re-enable)
node scripts/gen-vapid.mjs                     # prints VAPID_PUBLIC and VAPID_PRIVATE
#   VAPID_PUBLIC → add under [vars] in wrangler.admin.toml AND wrangler.member.toml
npx wrangler secret put VAPID_PRIVATE -c wrangler.admin.toml

npm run deploy:device; npm run deploy:admin; npm run deploy:member

cd ..\admin-app;  npm run build; npx wrangler pages deploy dist --project-name challenge-gym-admin
cd ..\member-app; npm run build; npx wrangler pages deploy dist --project-name challenge-gym-member
```

The Pages projects reach their API workers through service bindings (`admin-app/wrangler.toml`,
`member-app/wrangler.toml`); the admin/member workers have no public URL.

### Point the X990 at the cloud (at the gym, on the LAN)

The device worker must accept **plain HTTP on port 80** (the X990 does not do HTTPS). The
`*.workers.dev` hostname does; on a custom domain turn off *Always Use HTTPS* for that hostname.

```powershell
cd "Challenge Gym\agent"; pip install -r requirements.txt
python tools\set_cloud_server.py show
python tools\set_cloud_server.py cloud challenge-gym-device.<your-subdomain>.workers.dev
```

It also fixes the device DNS (was 192.168.1.1 on the wrong subnet). The device restarts (~45 s)
and appears as **Online via adms** on Admin → Device. Original values before testing were
`ICLOCKSVRURL=gym.dimplekumara1.workers.dev`, `IclockSvrPort=8081`, `WebServerURLModel=1`.

Then review **Admin → Device → Pending changes** and switch on **Automatic blocking**.

### Gym PC agent (optional fallback)

Admin → Device → *New agent token*, then on the gym PC:

```powershell
cd "Challenge Gym\agent"; copy .env.example .env   # set CLOUD_URL + AGENT_TOKEN
pip install -r requirements.txt
python agent.py
```

Outbound HTTPS only. It backs up all fingerprints, runs commands over TCP 4370 if the cloud link is
down, uploads punches, and mirrors eTimeTrack Lite's employee list (read-only).
Diagnostics: `python tools\probe_device.py` (read-only).
