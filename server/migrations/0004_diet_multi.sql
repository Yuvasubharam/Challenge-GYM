-- Food preference becomes multi-select: diet_pref holds a comma list, e.g. 'veg,egg'.
-- SQLite cannot drop a CHECK constraint, so the table is rebuilt (data copied as-is).
PRAGMA defer_foreign_keys = true;

CREATE TABLE fitness_profiles_new (
  member_id         INTEGER PRIMARY KEY REFERENCES members(id) ON DELETE CASCADE,
  birth_year        INTEGER,
  height_cm         REAL,
  start_weight_kg   REAL,
  weight_kg         REAL,
  target_weight_kg  REAL,
  goal              TEXT CHECK (goal IN ('lose_weight','gain_weight','build_muscle','maintain','get_fit')),
  activity          TEXT CHECK (activity IN ('sedentary','light','moderate','active','very_active')),
  workouts_per_week INTEGER,
  diet_pref         TEXT,                      -- comma list of veg | egg | nonveg | vegan (validated in code)
  kcal_target       INTEGER,
  protein_g         INTEGER,
  carbs_g           INTEGER,
  fat_g             INTEGER,
  water_ml          INTEGER,
  custom_targets    INTEGER NOT NULL DEFAULT 0,
  onboarded_at      TEXT,
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO fitness_profiles_new SELECT member_id, birth_year, height_cm, start_weight_kg, weight_kg, target_weight_kg, goal, activity,
  workouts_per_week, diet_pref, kcal_target, protein_g, carbs_g, fat_g, water_ml, custom_targets, onboarded_at, updated_at FROM fitness_profiles;

DROP TABLE fitness_profiles;
ALTER TABLE fitness_profiles_new RENAME TO fitness_profiles;
