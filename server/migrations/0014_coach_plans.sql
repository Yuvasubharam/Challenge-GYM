-- AI coach: generated diet / workout plans (one current plan per member per kind).
-- Items are ticked off by logging them into food_logs / workout_logs; log_id points at that row,
-- so deleting the log from the Diet/Train page un-ticks the item automatically.

CREATE TABLE coach_plans (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('diet','workout')),
  span        TEXT NOT NULL,              -- day | 3days | week
  start_day   TEXT NOT NULL,
  days        INTEGER NOT NULL,
  meta        TEXT,                       -- JSON: { note, request, days: { 'YYYY-MM-DD': { title, tip, rest } } }
  model       TEXT,                       -- AI model that built it; 'rules' when no model answered
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_coach_plans_member ON coach_plans(member_id, kind);

CREATE TABLE coach_plan_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  plan_id      INTEGER NOT NULL REFERENCES coach_plans(id) ON DELETE CASCADE,
  day          TEXT NOT NULL,
  slot         TEXT NOT NULL,             -- diet: breakfast|lunch|dinner|snacks · workout: warmup, chest_press, core, …
  pos          INTEGER NOT NULL DEFAULT 0,
  food_id      INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  exercise_id  TEXT REFERENCES exercises(id) ON DELETE SET NULL,
  name         TEXT NOT NULL,
  grams        REAL,
  kcal         REAL,
  protein      REAL,
  carbs        REAL,
  fat          REAL,
  sets         INTEGER,
  reps         TEXT,                      -- '8–10', '12–15', '30–45 s'
  rest_s       INTEGER,
  minutes      REAL,
  log_id       INTEGER                    -- food_logs.id / workout_logs.id once done
);
CREATE INDEX ix_coach_items_plan ON coach_plan_items(plan_id, day, pos);

-- Per-member daily AI generation counter (Workers AI is billed per call).
CREATE TABLE coach_usage (
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  n          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, day)
);
