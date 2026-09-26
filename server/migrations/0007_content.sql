-- Member-app content: richer announcements (image / event / offer + notification),
-- home carousel, shop showcase with desk enquiries, event gallery, web-push subscriptions.
-- Images live in R2 under content/<uuid>.<ext>; rows store only the key.

-- ── Announcements → posts ───────────────────────────────────────────────
ALTER TABLE announcements ADD COLUMN kind TEXT NOT NULL DEFAULT 'notice';  -- notice | event | offer
ALTER TABLE announcements ADD COLUMN image_key TEXT;
ALTER TABLE announcements ADD COLUMN event_date TEXT;                     -- YYYY-MM-DD (events)
ALTER TABLE announcements ADD COLUMN event_time TEXT;                     -- free text, e.g. "6:00 AM"
ALTER TABLE announcements ADD COLUMN cta_label TEXT;                      -- button text
ALTER TABLE announcements ADD COLUMN cta_link TEXT;                       -- app path (/plan, /shop) or https URL
ALTER TABLE announcements ADD COLUMN expires_on TEXT;                     -- hidden from members after this day
ALTER TABLE announcements ADD COLUMN notify INTEGER NOT NULL DEFAULT 0;   -- appears in the bell feed
ALTER TABLE announcements ADD COLUMN pushed_at TEXT;                      -- last phone push
ALTER TABLE announcements ADD COLUMN updated_at TEXT;

-- ── Home carousel ───────────────────────────────────────────────────────
CREATE TABLE banners (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  subtitle    TEXT,
  image_key   TEXT,
  cta_label   TEXT,
  cta_link    TEXT,
  starts_on   TEXT,
  ends_on     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- ── Shop (showcase; sale happens at the desk) ───────────────────────────
CREATE TABLE products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT,
  price       INTEGER NOT NULL DEFAULT 0,        -- rupees
  mrp         INTEGER,                           -- strike-through price
  image_key   TEXT,
  in_stock    INTEGER NOT NULL DEFAULT 1,
  featured    INTEGER NOT NULL DEFAULT 0,        -- shown on Home
  active      INTEGER NOT NULL DEFAULT 1,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT
);
CREATE INDEX idx_products_active ON products(active, sort);

CREATE TABLE product_enquiries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id  INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  qty         INTEGER NOT NULL DEFAULT 1,
  note        TEXT,
  status      TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','done','cancelled')),
  handled_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_enquiries_status ON product_enquiries(status, id);

-- ── Gallery ─────────────────────────────────────────────────────────────
CREATE TABLE gallery_albums (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  description TEXT,
  event_date  TEXT,
  cover_key   TEXT,
  published   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE gallery_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id    INTEGER NOT NULL REFERENCES gallery_albums(id) ON DELETE CASCADE,
  image_key   TEXT NOT NULL,
  caption     TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_gallery_photos_album ON gallery_photos(album_id, sort, id);

-- ── Notifications ───────────────────────────────────────────────────────
CREATE TABLE notice_reads (
  member_id    INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  last_seen_id INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE push_subscriptions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_ok_at  TEXT,
  fail_count  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_push_member ON push_subscriptions(member_id);
