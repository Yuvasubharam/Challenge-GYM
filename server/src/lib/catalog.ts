// In-memory copies of the read-mostly catalogs (exercise library, shared food list).
// D1 bills and rate-limits by rows *read*: a LIKE search or GROUP BY facet over these tables
// reads every row each time. Loading them once per worker isolate (refreshed every few
// minutes) turns thousands of reads per search into zero. Admin edits show up after the TTL.
import type { Env } from '../env';
import { all, first, run } from './db';

const TTL_MS = 60 * 60_000;
const VERSION_KEY = 'catalog_v';

/** Admin edits to exercises/foods bump this counter; member workers reload when it changes (1 row read per check). */
export async function bumpCatalogVersion(env: Env) {
  await run(env.DB, `INSERT INTO settings (key, value) VALUES (?, '1') ON CONFLICT(key) DO UPDATE SET value = CAST(value AS INTEGER) + 1`, VERSION_KEY);
}

let seenVersion: string | null = null;
async function checkVersion(env: Env) {
  const v = (await first<{ value: string }>(env.DB, `SELECT value FROM settings WHERE key=?`, VERSION_KEY))?.value ?? '0';
  if (seenVersion !== null && v !== seenVersion) invalidateCatalogs();
  seenVersion = v;
}

export interface ExRow {
  id: string; name: string; body_part: string | null; target: string | null; equipment: string | null;
  category: string | null; level: string | null; images: string | null; met: number | null; tracking: string | null; popular: number;
  _name: string; _target: string;
}

export interface FoodRow {
  id: number; name: string; veg: string | null; source: string | null; uses: number; [k: string]: unknown;
  _name: string;
}

type Cached<T> = { at: number; rows: T[]; loading?: Promise<T[]> };
let exercises: Cached<ExRow> | null = null;
let foods: Cached<FoodRow> | null = null;

async function cached<T>(slot: Cached<T> | null, set: (c: Cached<T>) => void, load: () => Promise<T[]>, ttl = TTL_MS): Promise<T[]> {
  if (slot && Date.now() - slot.at < ttl) return slot.rows;
  if (slot?.loading) return slot.loading;
  const loading = load().then((rows) => { set({ at: Date.now(), rows }); return rows; })
    .catch((e) => { if (slot) set({ ...slot, loading: undefined }); throw e; });
  set({ at: slot?.at ?? 0, rows: slot?.rows ?? [], loading });
  return loading;
}

export const exerciseCatalog = async (env: Env) => (await checkVersion(env), cached(exercises, (c) => { exercises = c; }, async () =>
  (await all<Omit<ExRow, '_name' | '_target'>>(env.DB,
    `SELECT id, name, body_part, target, equipment, category, level, images, met, tracking, popular FROM exercises WHERE active=1`))
    .map((r) => ({ ...r, _name: r.name.toLowerCase(), _target: (r.target ?? '').toLowerCase() }))));

/**
 * Food columns for lists: everything except the recipe text (ingredients/steps), which only the
 * details endpoint reads — keeps the in-memory catalogs and search responses small.
 * Use with a table alias `f`.
 */
export const FOOD_LIST_COLS = `f.id, f.name, f.kcal, f.protein, f.carbs, f.fat, f.fiber, f.sugar, f.sodium_mg, f.serving_g, f.serving_label, f.veg,
  f.source, f.owner_member_id, f.active, f.uses, f.updated_at, f.slug, f.image, f.steps IS NOT NULL AS has_recipe`;

/** Shared foods only (owner_member_id IS NULL); a member's own foods are fetched by index. */
export const foodCatalog = async (env: Env) => (await checkVersion(env), cached(foods, (c) => { foods = c; }, async () =>
  (await all<Record<string, unknown>>(env.DB, `SELECT ${FOOD_LIST_COLS} FROM foods f WHERE f.active=1 AND f.owner_member_id IS NULL`))
    .map((r) => ({ ...r, _name: String(r.name).toLowerCase() }) as FoodRow)));

// ── Admin copies: every row (hidden too) plus admin-only columns ────────
// The admin library pages filter, sort, count facets and paginate in memory: the SQL version
// scanned the ~2k exercises 7× per page load (and ~1k foods 3×) on every search keystroke.
// Admin edits bump catalog_v, so changes show on the very next request; the TTL only bounds
// how stale member-driven counters (food "uses", exercise log counts) can get.
const ADMIN_TTL_MS = 10 * 60_000;

export interface AdminExRow {
  id: string; name: string; body_part: string | null; target: string | null; equipment: string | null; category: string | null;
  level: string | null; images: string | null; met: number | null; tracking: string | null; popular: number; active: number;
  source: string | null; has_video: number; _name: string; _target: string;
}
export interface AdminFoodRow { id: number; name: string; veg: string | null; source: string | null; uses: number; active: number; [k: string]: unknown; _name: string }

let adminExercises: Cached<AdminExRow> | null = null;
let adminFoods: Cached<AdminFoodRow> | null = null;
let exerciseUses: Cached<{ exercise_id: string; n: number }> | null = null;

export const adminExerciseCatalog = async (env: Env) => (await checkVersion(env), cached(adminExercises, (c) => { adminExercises = c; }, async () =>
  (await all<Omit<AdminExRow, '_name' | '_target'>>(env.DB,
    `SELECT id, name, body_part, target, equipment, category, level, images, met, tracking, popular, active, source, video IS NOT NULL AS has_video FROM exercises`))
    .map((r) => ({ ...r, _name: r.name.toLowerCase(), _target: (r.target ?? '').toLowerCase() })), ADMIN_TTL_MS));

/** How often each exercise was logged by members (index-only scan of ix_workout_logs_exercise). */
export const exerciseUseCounts = async (env: Env) => new Map((await cached(exerciseUses, (c) => { exerciseUses = c; }, () =>
  all<{ exercise_id: string; n: number }>(env.DB, `SELECT exercise_id, COUNT(*) AS n FROM workout_logs WHERE exercise_id IS NOT NULL GROUP BY exercise_id`),
  ADMIN_TTL_MS)).map((r) => [r.exercise_id, r.n]));

export const adminFoodCatalog = async (env: Env) => (await checkVersion(env), cached(adminFoods, (c) => { adminFoods = c; }, async () =>
  (await all<Record<string, unknown>>(env.DB, `SELECT ${FOOD_LIST_COLS} FROM foods f WHERE f.owner_member_id IS NULL`))
    .map((r) => ({ ...r, _name: String(r.name).toLowerCase() }) as AdminFoodRow), ADMIN_TTL_MS));

/** Drop the copies in this isolate (e.g. right after an admin edit in the same worker). */
export function invalidateCatalogs() { exercises = null; foods = null; adminExercises = null; adminFoods = null; exerciseUses = null; }

/** GROUP BY … ORDER BY n DESC, in memory. */
export function countBy<T>(rows: T[], key: (r: T) => string | null, skipNull = false) {
  const m = new Map<string | null, number>();
  for (const r of rows) { const k = key(r); if (skipNull && k == null) continue; m.set(k, (m.get(k) ?? 0) + 1); }
  return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
}

/** Remove the lower-cased helper fields before sending a row to the client. */
export function strip<T extends { _name: string }>(r: T): Record<string, unknown> {
  const out: Record<string, unknown> = { ...r };
  delete out._name;
  delete out._target;
  return out;
}
