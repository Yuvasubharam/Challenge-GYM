-- Admin-editable exercise library: description, video, own photos/GIFs.
-- images (JSON array) may now also hold gym uploads: 'u/<uuid>.<ext>' (stored in R2 under exercise-media/).
ALTER TABLE exercises ADD COLUMN description TEXT;
ALTER TABLE exercises ADD COLUMN video TEXT;                   -- 'u/<uuid>.mp4' upload, or an https link (YouTube etc.)
ALTER TABLE exercises ADD COLUMN edited INTEGER NOT NULL DEFAULT 0; -- 1 = changed by an admin; re-seeding leaves it alone
ALTER TABLE exercises ADD COLUMN updated_at TEXT;
