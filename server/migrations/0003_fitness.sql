-- Fitness tracker (member app) + per-member app access switch.
-- All members (any plan, expired or not) and staff can use the tracker; admins can switch
-- member-app access off per member.

ALTER TABLE members ADD COLUMN app_access INTEGER NOT NULL DEFAULT 1;

-- Onboarding answers + computed daily targets
CREATE TABLE fitness_profiles (
  member_id         INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  birth_year        INTEGER,
  height_cm         REAL,
  start_weight_kg   REAL,
  weight_kg         REAL,                  -- latest
  target_weight_kg  REAL,
  goal              TEXT CHECK (goal IN ('lose_weight','gain_weight','build_muscle','maintain','get_fit')),
  activity          TEXT CHECK (activity IN ('sedentary','light','moderate','active','very_active')),
  workouts_per_week INTEGER,
  diet_pref         TEXT CHECK (diet_pref IN ('veg','egg','nonveg','vegan') OR diet_pref IS NULL),
  kcal_target       INTEGER,
  protein_g         INTEGER,
  carbs_g           INTEGER,
  fat_g             INTEGER,
  water_ml          INTEGER,
  custom_targets    INTEGER NOT NULL DEFAULT 0, -- 1 = member overrode the computed targets
  onboarded_at      TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE weight_logs (
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  weight_kg  REAL NOT NULL,
  PRIMARY KEY (member_id, day)
);

-- Food database: values per 100 g (or 100 ml). owner_member_id set = a member's private custom food.
CREATE TABLE foods (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  kcal            REAL NOT NULL,
  protein         REAL NOT NULL DEFAULT 0,
  carbs           REAL NOT NULL DEFAULT 0,
  fat             REAL NOT NULL DEFAULT 0,
  fiber           REAL,
  sugar           REAL,
  sodium_mg       REAL,
  serving_g       REAL NOT NULL DEFAULT 100,
  serving_label   TEXT NOT NULL DEFAULT '100 g',
  veg             TEXT CHECK (veg IN ('veg','egg','nonveg') OR veg IS NULL),
  source          TEXT NOT NULL DEFAULT 'custom',  -- 'basic' (USDA), 'indb', 'custom'
  owner_member_id INTEGER REFERENCES members(id) ON DELETE CASCADE,
  active          INTEGER NOT NULL DEFAULT 1,
  uses            INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_foods_name ON foods(name COLLATE NOCASE);
CREATE INDEX ix_foods_owner ON foods(owner_member_id);

CREATE TABLE food_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id   INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day         TEXT NOT NULL,
  meal        TEXT NOT NULL CHECK (meal IN ('breakfast','lunch','dinner','snacks')),
  food_id     INTEGER REFERENCES foods(id) ON DELETE SET NULL,
  name        TEXT NOT NULL,
  grams       REAL NOT NULL,
  kcal        REAL NOT NULL,
  protein     REAL NOT NULL DEFAULT 0,
  carbs       REAL NOT NULL DEFAULT 0,
  fat         REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_food_logs_member_day ON food_logs(member_id, day);

CREATE TABLE water_logs (
  member_id  INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day        TEXT NOT NULL,
  ml         INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (member_id, day)
);

-- Exercise library (openGym data, MIT + free-exercise-db photos, public domain)
CREATE TABLE exercises (
  id               TEXT PRIMARY KEY,           -- 'og-1254' / 'fe-Barbell_Squat' / 'cg-...'
  name             TEXT NOT NULL,
  body_part        TEXT,                       -- chest, back, upper legs, cardio, ...
  target           TEXT,                       -- primary muscle
  secondary        TEXT,                       -- JSON array
  equipment        TEXT,
  category         TEXT,                       -- strength, cardio, stretching, plyometrics, ...
  level            TEXT,
  instructions     TEXT,                       -- JSON array (English)
  instructions_hi  TEXT,                       -- JSON array (Hindi) when available
  images           TEXT,                       -- JSON array of free-exercise-db paths
  met              REAL NOT NULL DEFAULT 5.0,  -- metabolic equivalent for calorie estimates
  tracking         TEXT NOT NULL DEFAULT 'sets' CHECK (tracking IN ('sets','time')),
  popular          INTEGER NOT NULL DEFAULT 0,
  source           TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX ix_exercises_body ON exercises(body_part, popular DESC);
CREATE INDEX ix_exercises_name ON exercises(name COLLATE NOCASE);

-- One row per exercise performed on a day. sets = JSON [{reps, kg}] for strength.
CREATE TABLE workout_logs (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  day           TEXT NOT NULL,
  exercise_id   TEXT REFERENCES exercises(id) ON DELETE SET NULL,
  name          TEXT NOT NULL,
  sets          TEXT,
  duration_min  REAL NOT NULL DEFAULT 0,
  kcal          REAL NOT NULL DEFAULT 0,
  volume_kg     REAL NOT NULL DEFAULT 0,
  best_e1rm     REAL,
  notes         TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX ix_workout_logs_member_day ON workout_logs(member_id, day);
CREATE INDEX ix_workout_logs_member_ex ON workout_logs(member_id, exercise_id);
