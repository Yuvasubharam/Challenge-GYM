-- Discounts, coupons and free extra days on membership purchases / renewals.

CREATE TABLE coupons (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT NOT NULL UNIQUE COLLATE NOCASE,   -- stored upper-case, e.g. DIWALI25
  description       TEXT,
  kind              TEXT NOT NULL CHECK (kind IN ('percent','amount','days')),  -- 'days' = only bonus days, no price cut
  value             INTEGER NOT NULL DEFAULT 0,             -- % (1–100) or ₹
  max_discount      INTEGER,                                -- cap for % coupons (₹)
  min_amount        INTEGER,                                -- minimum bill (₹) before discount
  bonus_days        INTEGER NOT NULL DEFAULT 0,             -- free days added to the plan
  plan_ids          TEXT,                                   -- JSON array of plan ids; NULL = all plans
  valid_from        TEXT,                                   -- 'YYYY-MM-DD' inclusive
  valid_until       TEXT,                                   -- 'YYYY-MM-DD' inclusive
  max_uses          INTEGER,                                -- total redemptions; NULL = unlimited
  per_member_limit  INTEGER NOT NULL DEFAULT 1,
  new_members_only  INTEGER NOT NULL DEFAULT 0,
  member_app        INTEGER NOT NULL DEFAULT 1,             -- members may apply it themselves in the app
  active            INTEGER NOT NULL DEFAULT 1,
  created_by        TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 'pending' = reserved by a member's UPI renewal awaiting confirmation; 'void' = released
CREATE TABLE coupon_redemptions (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  coupon_id       INTEGER NOT NULL REFERENCES coupons(id) ON DELETE CASCADE,
  member_id       INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  membership_id   INTEGER REFERENCES memberships(id) ON DELETE SET NULL,
  payment_id      INTEGER REFERENCES payments(id) ON DELETE SET NULL,
  discount        INTEGER NOT NULL DEFAULT 0,
  bonus_days      INTEGER NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','pending','void')),
  created_by      TEXT,
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_redemptions_coupon ON coupon_redemptions(coupon_id, status);
CREATE INDEX ix_redemptions_member ON coupon_redemptions(member_id, coupon_id);

-- What the term cost before the discount, and how it was reduced / extended.
ALTER TABLE memberships ADD COLUMN list_price INTEGER;            -- plan price + PT before discount
ALTER TABLE memberships ADD COLUMN discount INTEGER NOT NULL DEFAULT 0;
ALTER TABLE memberships ADD COLUMN discount_note TEXT;             -- e.g. '10%', '₹500 off', 'DIWALI25'
ALTER TABLE memberships ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
ALTER TABLE memberships ADD COLUMN bonus_days INTEGER NOT NULL DEFAULT 0;

-- A member's UPI renewal request can carry a promo code.
ALTER TABLE payments ADD COLUMN coupon_id INTEGER REFERENCES coupons(id);
