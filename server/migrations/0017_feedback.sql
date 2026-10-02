-- Member feedback surveys (rated 1–5, asked every N months or on demand) and grievances.

-- Questions the gym can change at any time. Answers keep a copy of the wording they were given.
CREATE TABLE feedback_questions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  text        TEXT NOT NULL,
  category    TEXT NOT NULL DEFAULT 'gym',          -- gym | equipment | staff | cleanliness | app | other
  sort        INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One survey round = one "please rate us" request to every app member (scheduled or sent now).
CREATE TABLE feedback_rounds (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  kind        TEXT NOT NULL DEFAULT 'scheduled' CHECK (kind IN ('scheduled','instant')),
  questions   TEXT NOT NULL,                        -- JSON snapshot: [{id, text, category}]
  closes_on   TEXT,                                 -- YYYY-MM-DD; after it the popup stops
  created_by  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE feedback_responses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  round_id    INTEGER NOT NULL REFERENCES feedback_rounds(id) ON DELETE CASCADE,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  comment     TEXT,                                 -- anything else for management
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (round_id, member_id)
);

CREATE TABLE feedback_answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  response_id  INTEGER NOT NULL REFERENCES feedback_responses(id) ON DELETE CASCADE,
  question_id  INTEGER,
  question     TEXT NOT NULL,
  category     TEXT,
  rating       INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  improvement  TEXT                                 -- required when rating ≤ 3
);
CREATE INDEX ix_feedback_answers_response ON feedback_answers(response_id);

-- Grievances / issues raised by members, handled by the desk.
CREATE TABLE grievances (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id    INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  type         TEXT NOT NULL,
  subject      TEXT NOT NULL,
  description  TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved','closed')),
  reply        TEXT,                                -- management's answer, shown to the member
  handled_by   TEXT,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved_at  TEXT
);
CREATE INDEX ix_grievances_member ON grievances(member_id, id);
CREATE INDEX ix_grievances_status ON grievances(status, id);

-- Starter questions (editable in Admin → Feedback → Settings).
INSERT INTO feedback_questions (text, category, sort) VALUES
  ('Gym equipment — condition and availability', 'equipment', 1),
  ('Cleanliness of the gym floor', 'cleanliness', 2),
  ('Washrooms and changing rooms', 'cleanliness', 3),
  ('Trainers — guidance and support', 'staff', 4),
  ('Front desk — helpfulness', 'staff', 5),
  ('Crowd and waiting time at peak hours', 'gym', 6),
  ('Music, ventilation and lighting', 'gym', 7),
  ('Challenge Gym member app', 'app', 8),
  ('Value for money', 'gym', 9);
