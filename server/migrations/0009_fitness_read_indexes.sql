-- Read-cost indexes for the fitness logs (D1 bills and rate-limits by rows read).
-- These tables grow with every meal / workout a member logs, so a full scan gets more expensive every day.
-- Admin fitness overview: "last 7 / 30 days" counts and top foods/exercises filter by day across all members;
-- the existing indexes all start with member_id, so those queries scanned the whole table.
CREATE INDEX IF NOT EXISTS ix_food_logs_day ON food_logs(day, member_id);
CREATE INDEX IF NOT EXISTS ix_workout_logs_day ON workout_logs(day, member_id);
-- Exercise editor "used N times" and the library's per-exercise use counts.
CREATE INDEX IF NOT EXISTS ix_workout_logs_exercise ON workout_logs(exercise_id);
