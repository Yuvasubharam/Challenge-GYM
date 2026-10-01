-- Curated dishes (source 'cg') carry a photo and a home recipe.
--   slug          stable key for re-seeding (ids of curated rows are AUTOINCREMENT, shared with member custom foods)
--   image         path of a static WebP in the member app ('food/<slug>.webp'; '-t' suffix = list thumbnail)
--   image_credit  author · licence · source (CC BY / BY-SA photos must be credited)
--   ingredients / steps  JSON arrays of strings; recipe_serves / recipe_min describe the recipe
ALTER TABLE foods ADD COLUMN slug TEXT;
ALTER TABLE foods ADD COLUMN image TEXT;
ALTER TABLE foods ADD COLUMN image_credit TEXT;
ALTER TABLE foods ADD COLUMN ingredients TEXT;
ALTER TABLE foods ADD COLUMN steps TEXT;
ALTER TABLE foods ADD COLUMN recipe_serves INTEGER;
ALTER TABLE foods ADD COLUMN recipe_min INTEGER;
CREATE UNIQUE INDEX ux_foods_slug ON foods(slug) WHERE slug IS NOT NULL;
