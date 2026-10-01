-- Daily renewal reminders sent to member phones (one row per member per day).
-- Pushes carry no payload: the member's service worker reads this row to build "your membership ends in N days".
CREATE TABLE IF NOT EXISTS push_reminders (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  sent_at   TEXT NOT NULL,
  PRIMARY KEY (member_id, day)
);
