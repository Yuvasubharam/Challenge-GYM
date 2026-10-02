-- Weekly weigh-in reminders sent to member phones (one row per member per send day).
-- Pushes carry no payload: the member's service worker reads this row to build "weigh-in day" + their progress.
CREATE TABLE IF NOT EXISTS weight_reminders (
  member_id INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day       TEXT NOT NULL,
  sent_at   TEXT NOT NULL,
  PRIMARY KEY (member_id, day)
);

-- Admin "transformations" list and the reminder job read the latest/first weigh-ins per member.
CREATE INDEX IF NOT EXISTS ix_weight_logs_day ON weight_logs(day);
