-- Signed risk-acceptance consent (one row per signing; the latest one counts).
-- Wording is identified by version + language; the signature is a compact SVG path (see src/lib/consent.ts).
CREATE TABLE member_consents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  lang         TEXT NOT NULL,
  signer_name  TEXT NOT NULL,
  signature    TEXT NOT NULL,
  signed_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  witnessed_by TEXT
);
CREATE INDEX ix_member_consents_member ON member_consents(member_id, id);
