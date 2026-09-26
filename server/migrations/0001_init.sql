-- Challenge Gym — D1 schema
-- Dates are stored as 'YYYY-MM-DD' (gym-local, IST). Timestamps as ISO-8601 with offset.
-- Money is stored in whole rupees (INTEGER).

PRAGMA foreign_keys = ON;

-- ── Members ─────────────────────────────────────────────────────────────
CREATE TABLE members (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  essl_id          TEXT,                         -- device PIN; NULL until enrolled
  name             TEXT NOT NULL,
  mobile           TEXT,
  gender           TEXT CHECK (gender IN ('male','female','other') OR gender IS NULL),
  dob              TEXT,
  email            TEXT,
  address          TEXT,
  emergency_contact TEXT,
  photo_key        TEXT,                         -- R2 object key
  join_date        TEXT,
  notes            TEXT,
  is_staff         INTEGER NOT NULL DEFAULT 0,   -- staff never auto-blocked
  frozen_from      TEXT,
  frozen_until     TEXT,                         -- membership paused; end date is extended on unfreeze
  access_override  TEXT CHECK (access_override IN ('allow','deny') OR access_override IS NULL),
  device_state     TEXT NOT NULL DEFAULT 'unknown'
                   CHECK (device_state IN ('unknown','active','blocked','removed')),
  device_synced_at TEXT,
  archived         INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Two people may share a PIN in legacy data; uniqueness is enforced only for active rows.
CREATE UNIQUE INDEX ux_members_essl_active ON members(essl_id) WHERE essl_id IS NOT NULL AND archived = 0;
CREATE INDEX ix_members_mobile ON members(mobile);
CREATE INDEX ix_members_name ON members(name COLLATE NOCASE);

-- ── Plans (price list) ──────────────────────────────────────────────────
CREATE TABLE plans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL,                 -- 'Strength' | 'Strength + Cardio' | 'Personal Training' ...
  duration_months INTEGER NOT NULL DEFAULT 0,
  duration_days   INTEGER NOT NULL DEFAULT 0,
  price           INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  sort            INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Membership terms (one row per purchase/renewal) ─────────────────────
CREATE TABLE memberships (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  plan_id         INTEGER REFERENCES plans(id),
  category        TEXT,
  duration_label  TEXT,                          -- '1 Month', '3 Month', '1 Year'
  start_date      TEXT NOT NULL,
  end_date        TEXT NOT NULL,                 -- access valid through this date (inclusive)
  price           INTEGER NOT NULL DEFAULT 0,    -- billed amount incl. PT
  pt_included     INTEGER NOT NULL DEFAULT 0,
  pt_amount       INTEGER NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL DEFAULT 'new' CHECK (kind IN ('new','renewal','import')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled')),
  notes           TEXT,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_memberships_member ON memberships(member_id, end_date);
CREATE INDEX ix_memberships_end ON memberships(end_date);

-- ── Payments ledger ─────────────────────────────────────────────────────
CREATE TABLE payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  membership_id   INTEGER REFERENCES memberships(id) ON DELETE SET NULL,
  amount          INTEGER NOT NULL,
  mode            TEXT NOT NULL DEFAULT 'cash' CHECK (mode IN ('cash','upi','card','bank','other')),
  paid_on         TEXT NOT NULL,
  receipt_no      TEXT UNIQUE,
  reference       TEXT,                          -- UPI txn id / cheque no.
  proof_key       TEXT,                          -- R2 screenshot uploaded by member
  entry_type      TEXT NOT NULL DEFAULT 'new' CHECK (entry_type IN ('new','renewal','due','pt','other')),
  status          TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','pending','rejected')),
  handled_by      TEXT,
  remarks         TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_payments_member ON payments(member_id);
CREATE INDEX ix_payments_date ON payments(paid_on);
CREATE INDEX ix_payments_status ON payments(status);

-- ── Attendance (every punch; visits = distinct day) ─────────────────────
CREATE TABLE attendance (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  essl_id         TEXT NOT NULL,
  member_id       INTEGER REFERENCES members(id) ON DELETE SET NULL,
  punched_at      TEXT NOT NULL,                 -- 'YYYY-MM-DDTHH:MM:SS+05:30'
  day             TEXT NOT NULL,                 -- 'YYYY-MM-DD' local
  status_code     INTEGER,
  verify_mode     INTEGER,
  source          TEXT NOT NULL DEFAULT 'adms' CHECK (source IN ('adms','agent','manual','import')),
  device_sn       TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (essl_id, punched_at)
);
CREATE INDEX ix_attendance_day ON attendance(day);
CREATE INDEX ix_attendance_member ON attendance(member_id, day);

-- ── Device control ──────────────────────────────────────────────────────
CREATE TABLE devices (
  sn              TEXT PRIMARY KEY,
  name            TEXT,
  approved        INTEGER NOT NULL DEFAULT 0,
  model           TEXT,
  firmware        TEXT,
  push_version    TEXT,
  last_ip         TEXT,
  last_seen_at    TEXT,
  last_seen_via   TEXT,                          -- 'adms' | 'agent'
  user_count      INTEGER,
  fp_count        INTEGER,
  att_count       INTEGER,
  info            TEXT,                          -- raw JSON
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Queue of logical actions. Whichever channel (ADMS poll or PC agent) claims first executes.
CREATE TABLE device_commands (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  essl_id         TEXT,
  action          TEXT NOT NULL CHECK (action IN
                  ('upsert_user','block','unblock','delete_user','backup_templates',
                   'query_users','reboot','clear_admins','raw')),
  payload         TEXT,                          -- JSON
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','sent','done','failed','cancelled')),
  channel         TEXT CHECK (channel IN ('adms','agent') OR channel IS NULL),
  device_sn       TEXT,
  attempts        INTEGER NOT NULL DEFAULT 0,
  result          TEXT,
  reason          TEXT,                          -- 'expired','renewed','manual', ...
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  sent_at         TEXT,
  done_at         TEXT
);
CREATE INDEX ix_cmd_status ON device_commands(status, id);
CREATE INDEX ix_cmd_essl ON device_commands(essl_id, status);

-- ADMS sub-commands (one logical command may expand to several protocol lines)
CREATE TABLE adms_lines (
  seq             INTEGER PRIMARY KEY AUTOINCREMENT,  -- the ID echoed back by the device
  command_id      INTEGER NOT NULL REFERENCES device_commands(id) ON DELETE CASCADE,
  line            TEXT NOT NULL,
  return_code     INTEGER,
  done_at         TEXT
);
CREATE INDEX ix_adms_lines_cmd ON adms_lines(command_id);

-- What is actually on the device (from ADMS OPERLOG / agent / eTimeTrack roster)
CREATE TABLE device_users (
  essl_id         TEXT PRIMARY KEY,
  name            TEXT,
  privilege       INTEGER,
  card            TEXT,
  grp             TEXT,
  fp_count        INTEGER,
  on_device       INTEGER NOT NULL DEFAULT 1,
  source          TEXT,
  seen_at         TEXT
);

-- Fingerprint template backups: allow a blocked member to be removed from the device
-- and restored on renewal without re-enrolling.
CREATE TABLE bio_templates (
  essl_id         TEXT NOT NULL,
  fid             INTEGER NOT NULL,
  size            INTEGER,
  valid           INTEGER NOT NULL DEFAULT 1,
  tmp             TEXT NOT NULL,                 -- base64
  source          TEXT,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (essl_id, fid)
);

-- Mirror of eTimeTrack Lite Employees (read-only sync by the PC agent)
CREATE TABLE etimetrack_employees (
  code            TEXT PRIMARY KEY,
  name            TEXT,
  status          TEXT,
  doj             TEXT,
  contact         TEXT,
  device_group    TEXT,
  synced_at       TEXT
);

-- ── CRM / follow-ups ────────────────────────────────────────────────────
CREATE TABLE followups (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  call_date       TEXT NOT NULL,
  response        TEXT,
  next_date       TEXT,
  priority        TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high')),
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','converted','lost','closed')),
  remarks         TEXT,
  handled_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_followups_member ON followups(member_id);
CREATE INDEX ix_followups_next ON followups(status, next_date);

CREATE TABLE announcements (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT NOT NULL,
  body            TEXT,
  pinned          INTEGER NOT NULL DEFAULT 0,
  published       INTEGER NOT NULL DEFAULT 1,
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Accounts & auth ─────────────────────────────────────────────────────
CREATE TABLE accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  role            TEXT NOT NULL CHECK (role IN ('owner','admin','staff','member')),
  member_id       INTEGER UNIQUE REFERENCES members(id) ON DELETE CASCADE,
  username        TEXT,                          -- admin login (mobile/email); members log in via members.mobile / essl_id
  display_name    TEXT,
  password_hash   TEXT NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1,
  last_login_at   TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE UNIQUE INDEX ux_accounts_username ON accounts(username) WHERE username IS NOT NULL;

CREATE TABLE login_attempts (
  ident           TEXT PRIMARY KEY,
  fails           INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT
);

-- PC agents (outbound-only bridge on the gym LAN)
CREATE TABLE agents (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  token_hash      TEXT NOT NULL UNIQUE,
  last_seen_at    TEXT,
  info            TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL
);

CREATE TABLE audit_log (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  actor           TEXT,
  action          TEXT NOT NULL,
  entity          TEXT,
  entity_id       TEXT,
  detail          TEXT,
  at              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_audit_at ON audit_log(at);

-- ── Current membership per member (latest non-cancelled term) ───────────
CREATE VIEW v_current_membership AS
SELECT ms.*
FROM memberships ms
WHERE ms.status = 'active'
  AND ms.id = (
    SELECT m2.id FROM memberships m2
    WHERE m2.member_id = ms.member_id AND m2.status = 'active'
    ORDER BY m2.end_date DESC, m2.id DESC LIMIT 1
  );

-- Dues are tracked per term: payments are linked to the membership they pay for.
-- Over-payment on a term never becomes credit on another (legacy data has renewals
-- recorded only as payments).
CREATE VIEW v_membership_dues AS
SELECT ms.id AS membership_id, ms.member_id, ms.price,
       COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.membership_id = ms.id AND p.status = 'confirmed'), 0) AS paid,
       MAX(0, ms.price - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.membership_id = ms.id AND p.status = 'confirmed'), 0)) AS due
FROM memberships ms
WHERE ms.status = 'active';

CREATE VIEW v_member_dues AS
SELECT member_id, SUM(due) AS due FROM v_membership_dues GROUP BY member_id;

-- ── Defaults ────────────────────────────────────────────────────────────
INSERT INTO settings (key, value) VALUES
  ('gym',            '{"name":"Challenge Gym","tagline":"Wherever you are, health is number one","phone":"","address":""}'),
  ('upi',            '{"vpa":"","payee":"Challenge Gym"}'),
  -- auto_enforce starts OFF: review the "pending changes" preview on the Device page, then switch it on.
  ('access',         '{"grace_days":0,"staff_prefixes":["CGA","CGC"],"block_method":"remove","auto_enforce":false}'),
  ('reminders',      '{"near_days":30,"soon_days":7}'),
  ('receipt',        '{"prefix":"CG","next":1}');

INSERT INTO plans (name, category, duration_months, price, sort) VALUES
  ('Strength — 1 Month',          'Strength',          1,  1500, 10),
  ('Strength — 3 Months',         'Strength',          3,  3500, 11),
  ('Strength — 6 Months',         'Strength',          6,  6000, 12),
  ('Strength — 1 Year',           'Strength',          12, 9000, 13),
  ('Strength + Cardio — 1 Month', 'Strength + Cardio', 1,  2000, 20),
  ('Strength + Cardio — 3 Months','Strength + Cardio', 3,  4500, 21),
  ('Strength + Cardio — 6 Months','Strength + Cardio', 6,  8000, 22),
  ('Strength + Cardio — 1 Year',  'Strength + Cardio', 12, 10000, 23);
