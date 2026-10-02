// Member fitness tracker: onboarding & targets, diet log, water, weight, exercise library, workouts.
// Available to every member with app access (any plan, expired or not) and to staff.
import { Hono } from 'hono';
import type { AppEnv, Env } from '../../env';
import { tzOffset } from '../../env';
import { requireMember } from '../../lib/auth';
import { all, assert, first, int, nowIso, run, str } from '../../lib/db';
import { addDays, diffDays, isDate, today as todayOf } from '../../lib/dates';
import {
  ACTIVITIES, GOALS, ageFromBirthYear, bmi, bmiCategory, dailyTargets, healthyWeightRange, round, type Activity, type Goal, type SetEntry, type Sex,
} from '../../lib/fitness';
import { logFood, logWorkout } from '../../lib/fitlog';
import { bucketWeights, weighIn, weightTrend, type WeightRow } from '../../lib/weightTrack';
import { memberWeights } from '../../lib/weightPush';
import { serveExerciseMedia } from '../../lib/exerciseMedia';
import { exerciseCatalog, FOOD_LIST_COLS, foodCatalog, strip, type ExRow, type FoodRow } from '../../lib/catalog';

export const fit = new Hono<AppEnv>();

// Exercise photos/GIFs/videos (free-exercise-db mirror + gym uploads; file names never change).
// Registered before the auth middleware: <img>/<video> loads are cheap and the media isn't private.
fit.get('/media/*', (c) => serveExerciseMedia(c.env, c.req.raw, decodeURIComponent(c.req.path.replace(/^.*\/media\//, '')),
  'public, max-age=2592000, immutable', (p) => c.executionCtx.waitUntil(p)));

fit.use('*', requireMember());

const mid = (c: { get: (k: 'session') => { mid: number | null } }) => c.get('session').mid!;
export const todayFor = (env: Env) => todayOf(tzOffset(env));

/** Dates a member may log for: today and the past year (no future). */
export function logDate(env: Env, v: unknown): string {
  const today = todayFor(env);
  const d = typeof v === 'string' && isDate(v) ? v : today;
  assert(d <= today, 400, "You can't log for a future date");
  assert(diffDays(today, d) <= 365, 400, 'That date is too far back');
  return d;
}

export interface Profile {
  member_id: number; birth_year: number | null; height_cm: number | null; start_weight_kg: number | null; weight_kg: number | null;
  target_weight_kg: number | null; goal: Goal | null; activity: Activity | null; workouts_per_week: number | null; diet_pref: string | null;
  kcal_target: number | null; protein_g: number | null; carbs_g: number | null; fat_g: number | null; water_ml: number | null;
  custom_targets: number; onboarded_at: string | null;
}

export async function loadProfile(env: Env, memberId: number) {
  const p = await first<Profile>(env.DB, `SELECT * FROM fitness_profiles WHERE member_id=?`, memberId);
  const m = await first<{ gender: Sex; name: string }>(env.DB, `SELECT gender, name FROM members WHERE id=?`, memberId);
  return { p, sex: (m?.gender ?? null) as Sex };
}

function describe(p: Profile | null, sex: Sex, today: string) {
  if (!p?.onboarded_at || !p.height_cm || !p.weight_kg) return null;
  const b = bmi(p.weight_kg, p.height_cm);
  const age = p.birth_year ? ageFromBirthYear(p.birth_year, today) : null;
  const computed = age && p.goal && p.activity ? dailyTargets({ weightKg: p.weight_kg, heightCm: p.height_cm, age, sex, activity: p.activity, goal: p.goal }) : null;
  const start = p.start_weight_kg ?? p.weight_kg;
  const target = p.target_weight_kg;
  const progress = target && start !== target ? Math.max(0, Math.min(100, Math.round(((start - p.weight_kg) / (start - target)) * 100))) : null;
  return {
    age, sex, height_cm: p.height_cm, weight_kg: p.weight_kg, start_weight_kg: start, target_weight_kg: target, goal: p.goal, activity: p.activity,
    workouts_per_week: p.workouts_per_week, diet_pref: p.diet_pref, diet_prefs: p.diet_pref ? p.diet_pref.split(',') : [], custom_targets: !!p.custom_targets,
    bmi: b, bmi_category: bmiCategory(b), healthy_range: healthyWeightRange(p.height_cm),
    bmr: computed?.bmr ?? null, tdee: computed?.tdee ?? null, goal_progress: progress,
    targets: { kcal: p.kcal_target, protein_g: p.protein_g, carbs_g: p.carbs_g, fat_g: p.fat_g, water_ml: p.water_ml },
  };
}

/** Recompute targets from the profile unless the member set their own. */
async function refreshTargets(env: Env, memberId: number) {
  const { p, sex } = await loadProfile(env, memberId);
  if (!p || p.custom_targets || !p.birth_year || !p.height_cm || !p.weight_kg || !p.goal || !p.activity) return;
  const t = dailyTargets({ weightKg: p.weight_kg, heightCm: p.height_cm, age: ageFromBirthYear(p.birth_year, todayFor(env)), sex, activity: p.activity, goal: p.goal });
  await run(env.DB, `UPDATE fitness_profiles SET kcal_target=?, protein_g=?, carbs_g=?, fat_g=?, water_ml=?, updated_at=? WHERE member_id=?`,
    t.kcal, t.protein_g, t.carbs_g, t.fat_g, t.water_ml, nowIso(), memberId);
}

// ── Profile / onboarding ────────────────────────────────────────────────
fit.get('/profile', async (c) => {
  const [{ p, sex }, last] = await Promise.all([
    loadProfile(c.env, mid(c)),
    first<WeightRow>(c.env.DB, `SELECT day, weight_kg FROM weight_logs WHERE member_id=? ORDER BY day DESC LIMIT 1`, mid(c)),
  ]);
  const today = todayFor(c.env);
  return c.json({ onboarded: !!p?.onboarded_at, profile: describe(p, sex, today), raw: p, weigh_in: p?.onboarded_at ? weighIn(last, today) : null });
});

/** Onboarding + edits. Body: age, gender, height_cm, weight_kg, target_weight_kg, goal, activity, workouts_per_week, diet_pref, [targets]. */
fit.put('/profile', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const today = todayFor(c.env);
  const age = int(b.age);
  const height = Number(b.height_cm);
  const weight = Number(b.weight_kg);
  const targetW = b.target_weight_kg === null || b.target_weight_kg === '' || b.target_weight_kg === undefined ? null : Number(b.target_weight_kg);
  assert(age && age >= 12 && age <= 90, 400, 'Enter your age (12–90)');
  assert(['male', 'female', 'other'].includes(b.gender), 400, 'Choose your gender');
  assert(height >= 120 && height <= 230, 400, 'Enter your height in cm (120–230)');
  assert(weight >= 30 && weight <= 250, 400, 'Enter your weight in kg (30–250)');
  assert(targetW === null || (targetW >= 30 && targetW <= 250), 400, 'Target weight must be 30–250 kg');
  assert(GOALS.includes(b.goal), 400, 'Choose a goal');
  assert(ACTIVITIES.includes(b.activity), 400, 'Choose your activity level');
  const wpw = Math.max(0, Math.min(7, int(b.workouts_per_week) ?? 3));
  // Multi-select: array (or comma string) of veg | egg | nonveg | vegan → stored as 'veg,egg'
  const DIETS = ['veg', 'egg', 'nonveg', 'vegan'];
  const dietList = (Array.isArray(b.diet_pref) ? b.diet_pref : String(b.diet_pref ?? '').split(','))
    .map((x: unknown) => String(x).trim()).filter((x: string) => DIETS.includes(x));
  const diet = dietList.length ? [...new Set(dietList)].sort((x, y) => DIETS.indexOf(x as string) - DIETS.indexOf(y as string)).join(',') : null;

  const existing = await first<{ start_weight_kg: number | null; onboarded_at: string | null }>(c.env.DB, `SELECT start_weight_kg, onboarded_at FROM fitness_profiles WHERE member_id=?`, id);
  const t = dailyTargets({ weightKg: weight, heightCm: height, age, sex: b.gender, activity: b.activity, goal: b.goal });
  const custom = b.targets && typeof b.targets === 'object';
  const tg = custom
    ? { kcal: clampInt(b.targets.kcal, 1000, 6000, t.kcal), protein_g: clampInt(b.targets.protein_g, 20, 400, t.protein_g), carbs_g: clampInt(b.targets.carbs_g, 0, 900, t.carbs_g),
        fat_g: clampInt(b.targets.fat_g, 10, 300, t.fat_g), water_ml: clampInt(b.targets.water_ml, 500, 8000, t.water_ml) }
    : { kcal: t.kcal, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, water_ml: t.water_ml };

  await run(c.env.DB,
    `INSERT INTO fitness_profiles (member_id, birth_year, height_cm, start_weight_kg, weight_kg, target_weight_kg, goal, activity, workouts_per_week, diet_pref,
       kcal_target, protein_g, carbs_g, fat_g, water_ml, custom_targets, onboarded_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(member_id) DO UPDATE SET birth_year=excluded.birth_year, height_cm=excluded.height_cm, weight_kg=excluded.weight_kg,
       target_weight_kg=excluded.target_weight_kg, goal=excluded.goal, activity=excluded.activity, workouts_per_week=excluded.workouts_per_week,
       diet_pref=excluded.diet_pref, kcal_target=excluded.kcal_target, protein_g=excluded.protein_g, carbs_g=excluded.carbs_g, fat_g=excluded.fat_g,
       water_ml=excluded.water_ml, custom_targets=excluded.custom_targets, updated_at=excluded.updated_at`,
    id, Number(today.slice(0, 4)) - age, height, existing?.start_weight_kg ?? weight, weight, targetW, b.goal, b.activity, wpw, diet,
    tg.kcal, tg.protein_g, tg.carbs_g, tg.fat_g, tg.water_ml, custom ? 1 : 0, existing?.onboarded_at ?? nowIso(), nowIso());
  await run(c.env.DB, `UPDATE members SET gender=?, updated_at=? WHERE id=?`, b.gender, nowIso(), id);
  await run(c.env.DB, `INSERT INTO weight_logs (member_id, day, weight_kg) VALUES (?, ?, ?) ON CONFLICT(member_id, day) DO UPDATE SET weight_kg=excluded.weight_kg`, id, today, weight);
  const { p, sex } = await loadProfile(c.env, id);
  return c.json({ ok: true, profile: describe(p, sex, today), computed: t });
});

function clampInt(v: unknown, lo: number, hi: number, dflt: number) {
  const n = int(v);
  return n === null ? dflt : Math.max(lo, Math.min(hi, n));
}

// ── Day view ────────────────────────────────────────────────────────────
fit.get('/day', async (c) => {
  const id = mid(c);
  const date = logDate(c.env, c.req.query('date'));
  const [food, workouts, water, weight, prof] = await Promise.all([
    all<{ id: number; meal: string; food_id: number | null; name: string; grams: number; kcal: number; protein: number; carbs: number; fat: number; image: string | null; has_recipe: number | null }>(c.env.DB,
      `SELECT l.id, l.meal, l.food_id, l.name, l.grams, l.kcal, l.protein, l.carbs, l.fat, f.image, f.steps IS NOT NULL AS has_recipe
       FROM food_logs l LEFT JOIN foods f ON f.id=l.food_id WHERE l.member_id=? AND l.day=? ORDER BY l.id`, id, date),
    all<{ id: number; exercise_id: string | null; name: string; sets: string | null; duration_min: number; kcal: number; volume_kg: number; best_e1rm: number | null; images: string | null; body_part: string | null; tracking: string | null }>(c.env.DB,
      `SELECT w.id, w.exercise_id, w.name, w.sets, w.duration_min, w.kcal, w.volume_kg, w.best_e1rm, e.images, e.body_part, e.tracking
       FROM workout_logs w LEFT JOIN exercises e ON e.id=w.exercise_id WHERE w.member_id=? AND w.day=? ORDER BY w.id`, id, date),
    first<{ ml: number }>(c.env.DB, `SELECT ml FROM water_logs WHERE member_id=? AND day=?`, id, date),
    first<{ weight_kg: number; day: string }>(c.env.DB, `SELECT weight_kg, day FROM weight_logs WHERE member_id=? AND day<=? ORDER BY day DESC LIMIT 1`, id, date),
    loadProfile(c.env, id),
  ]);
  const sum = (rows: { kcal: number; protein?: number; carbs?: number; fat?: number }[]) => ({
    kcal: round(rows.reduce((s, r) => s + r.kcal, 0)), protein: round(rows.reduce((s, r) => s + (r.protein ?? 0), 0), 1),
    carbs: round(rows.reduce((s, r) => s + (r.carbs ?? 0), 0), 1), fat: round(rows.reduce((s, r) => s + (r.fat ?? 0), 0), 1),
  });
  const meals = Object.fromEntries(['breakfast', 'lunch', 'dinner', 'snacks'].map((m) => {
    const items = food.filter((f) => f.meal === m);
    return [m, { items, ...sum(items) }];
  }));
  const eaten = sum(food);
  const burned = round(workouts.reduce((s, w) => s + w.kcal, 0));
  const t = prof.p;
  return c.json({
    date,
    targets: t?.onboarded_at ? { kcal: t.kcal_target, protein_g: t.protein_g, carbs_g: t.carbs_g, fat_g: t.fat_g, water_ml: t.water_ml } : null,
    eaten, burned, net: round(eaten.kcal - burned),
    remaining: t?.kcal_target ? round(t.kcal_target - eaten.kcal + burned) : null,
    meals,
    workouts: workouts.map((w) => ({ ...w, sets: w.sets ? JSON.parse(w.sets) : [], images: w.images ? JSON.parse(w.images) : [] })),
    minutes: round(workouts.reduce((s, w) => s + w.duration_min, 0)),
    water_ml: water?.ml ?? 0,
    weight: weight ?? null,
  });
});

/** Last N days: calories in/out, workouts, water, weight trend, streak, personal records. */
fit.get('/summary', async (c) => {
  const id = mid(c);
  const today = todayFor(c.env);
  const days = Math.min(90, Math.max(7, int(c.req.query('days')) ?? 30));
  const from = addDays(today, -(days - 1));
  const [food, work, water, weights, prs, visits] = await Promise.all([
    all<{ day: string; kcal: number; protein: number }>(c.env.DB, `SELECT day, SUM(kcal) AS kcal, SUM(protein) AS protein FROM food_logs WHERE member_id=? AND day>=? GROUP BY day`, id, from),
    all<{ day: string; kcal: number; n: number; minutes: number }>(c.env.DB, `SELECT day, SUM(kcal) AS kcal, COUNT(*) AS n, SUM(duration_min) AS minutes FROM workout_logs WHERE member_id=? AND day>=? GROUP BY day`, id, from),
    all<{ day: string; ml: number }>(c.env.DB, `SELECT day, ml FROM water_logs WHERE member_id=? AND day>=?`, id, from),
    all<{ day: string; weight_kg: number }>(c.env.DB, `SELECT day, weight_kg FROM weight_logs WHERE member_id=? ORDER BY day DESC LIMIT 60`, id),
    all<{ exercise_id: string; name: string; best: number; day: string }>(c.env.DB,
      `SELECT exercise_id, name, MAX(best_e1rm) AS best, MAX(day) AS day FROM workout_logs WHERE member_id=? AND best_e1rm IS NOT NULL GROUP BY exercise_id ORDER BY best DESC LIMIT 8`, id),
    all<{ day: string }>(c.env.DB, `SELECT DISTINCT day FROM attendance WHERE member_id=? AND day>=?`, id, from),
  ]);
  const fm = new Map(food.map((r) => [r.day, r]));
  const wm = new Map(work.map((r) => [r.day, r]));
  const hm = new Map(water.map((r) => [r.day, r.ml]));
  const vs = new Set(visits.map((v) => v.day));
  const series = Array.from({ length: days }, (_, i) => {
    const d = addDays(from, i);
    return { day: d, kcal_in: round(fm.get(d)?.kcal ?? 0), protein: round(fm.get(d)?.protein ?? 0), kcal_out: round(wm.get(d)?.kcal ?? 0),
      workouts: wm.get(d)?.n ?? 0, minutes: round(wm.get(d)?.minutes ?? 0), water_ml: hm.get(d) ?? 0, gym_visit: vs.has(d) };
  });
  // Active streak: consecutive days (ending today/yesterday) with a workout log or a gym check-in
  const activeDays = new Set(series.filter((s) => s.workouts > 0 || s.gym_visit).map((s) => s.day));
  let streak = 0;
  let d = activeDays.has(today) ? today : addDays(today, -1);
  while (activeDays.has(d)) { streak++; d = addDays(d, -1); }
  const logged = series.filter((s) => s.kcal_in > 0);
  const weekStart = addDays(today, -6);
  return c.json({
    from, to: today, series,
    weights: weights.reverse(),
    streak,
    this_week: { workouts: series.filter((s) => s.day >= weekStart && s.workouts > 0).length, kcal_out: round(series.filter((s) => s.day >= weekStart).reduce((a, s) => a + s.kcal_out, 0)) },
    avg_kcal_in: logged.length ? round(logged.reduce((a, s) => a + s.kcal_in, 0) / logged.length) : null,
    records: prs,
  });
});

// ── Foods & diet log ────────────────────────────────────────────────────
fit.get('/foods', async (c) => {
  const id = mid(c);
  const q = (c.req.query('q') ?? '').trim().slice(0, 60);
  const veg = c.req.query('veg'); // 'veg' → veg only, 'egg' → veg+egg
  const vegSql = veg === 'veg' ? `AND (veg='veg' OR veg IS NULL)` : veg === 'egg' ? `AND (veg IN ('veg','egg') OR veg IS NULL)` : '';
  const vegOk = (v: string | null) => veg === 'veg' ? v === 'veg' || v == null : veg === 'egg' ? v === 'veg' || v === 'egg' || v == null : true;
  // Shared foods come from the in-memory catalog (no D1 reads per keystroke);
  // the member's own foods are a small indexed lookup.
  const [shared, own] = await Promise.all([
    foodCatalog(c.env),
    all<FoodRow>(c.env.DB, `SELECT ${FOOD_LIST_COLS} FROM foods f WHERE f.owner_member_id=? AND f.active=1`, id)
      .then((rows) => rows.map((r) => ({ ...r, _name: String(r.name).toLowerCase() }))),
  ]);
  if (!q) {
    // Recent + popular when the search box is empty
    const recent = await all(c.env.DB,
      `SELECT ${FOOD_LIST_COLS}, MAX(l.id) AS last FROM food_logs l JOIN foods f ON f.id=l.food_id WHERE l.member_id=? AND l.day >= ? AND f.active=1 ${vegSql} GROUP BY f.id ORDER BY last DESC LIMIT 12`,
      id, addDays(todayFor(c.env), -60));
    const popular = shared.filter((f) => vegOk(f.veg))
      .sort((a, b) => b.uses - a.uses || Number(b.source === 'basic') - Number(a.source === 'basic') || a.id - b.id)
      .slice(0, 20).map(strip);
    return c.json({ recent, results: popular });
  }
  const words = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 4);
  const mine = new Set(own.map((f) => f.id));
  const results = [...own, ...shared]
    .filter((f) => vegOk(f.veg) && words.every((w) => f._name.includes(w)))
    .sort((a, b) => Number(b._name.startsWith(words[0])) - Number(a._name.startsWith(words[0]))
      || Number(mine.has(b.id)) - Number(mine.has(a.id))
      || Number(b.source === 'basic') - Number(a.source === 'basic')
      || b.uses - a.uses || a._name.length - b._name.length)
    .slice(0, 40).map(strip);
  return c.json({ recent: [], results });
});

/** One food with its photo credit and recipe (ingredients + steps). 1 row read by primary key. */
fit.get('/foods/:id', async (c) => {
  const f = await first<Record<string, unknown> & { ingredients: string | null; steps: string | null }>(c.env.DB,
    `SELECT id, name, kcal, protein, carbs, fat, fiber, sugar, sodium_mg, serving_g, serving_label, veg, source, owner_member_id,
            image, image_credit, ingredients, steps, recipe_serves, recipe_min
     FROM foods WHERE id=? AND active=1 AND (owner_member_id IS NULL OR owner_member_id=?)`, int(c.req.param('id')), mid(c));
  assert(f, 404, 'Food not found');
  return c.json({ ...f, ingredients: f.ingredients ? JSON.parse(f.ingredients) : [], steps: f.steps ? JSON.parse(f.steps) : [] });
});

/** Private custom food (per 100 g or per serving). */
fit.post('/foods', async (c) => {
  const b = await c.req.json();
  const name = str(b.name, 80);
  assert(name, 400, 'Enter a food name');
  const servingG = Number(b.serving_g) > 0 ? Math.min(2000, Number(b.serving_g)) : 100;
  // Values entered per serving → store per 100 g
  const per = b.per === 'serving' ? 100 / servingG : 1;
  const n = (v: unknown, max: number) => { const x = Number(v); return Number.isFinite(x) && x >= 0 && x <= max ? round(x * per, 1) : 0; };
  const kcal = n(b.kcal, 5000);
  assert(kcal > 0 || n(b.protein, 500) > 0, 400, 'Enter at least the calories');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO foods (name, kcal, protein, carbs, fat, serving_g, serving_label, veg, source, owner_member_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?) RETURNING id`,
    name, kcal, n(b.protein, 500), n(b.carbs, 500), n(b.fat, 500), servingG, str(b.serving_label, 40) ?? `1 serving (${servingG} g)`,
    ['veg', 'egg', 'nonveg'].includes(b.veg) ? b.veg : null, mid(c));
  return c.json({ id: r!.id });
});

fit.post('/food-logs', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const date = logDate(c.env, b.date);
  let grams = Number(b.grams);
  if (b.grams === undefined) {
    const f = await first<{ serving_g: number }>(c.env.DB, `SELECT serving_g FROM foods WHERE id=?`, int(b.food_id));
    grams = Number(b.servings ?? 1) * (f?.serving_g ?? 100);
  }
  return c.json(await logFood(c.env, id, { date, meal: b.meal, foodId: int(b.food_id), grams }));
});

fit.delete('/food-logs/:id', async (c) => {
  await run(c.env.DB, `DELETE FROM food_logs WHERE id=? AND member_id=?`, Number(c.req.param('id')), mid(c));
  return c.json({ ok: true });
});

/** Copy a whole meal from another day (e.g. "same breakfast as yesterday"). */
fit.post('/food-logs/copy', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const to = logDate(c.env, b.date);
  const from = logDate(c.env, b.from_date);
  assert(['breakfast', 'lunch', 'dinner', 'snacks'].includes(b.meal), 400, 'Choose a meal');
  const r = await c.env.DB.prepare(
    `INSERT INTO food_logs (member_id, day, meal, food_id, name, grams, kcal, protein, carbs, fat)
     SELECT member_id, ?, meal, food_id, name, grams, kcal, protein, carbs, fat FROM food_logs WHERE member_id=? AND day=? AND meal=?`,
  ).bind(to, id, from, b.meal).run();
  return c.json({ copied: r.meta.changes ?? 0 });
});

fit.put('/water', async (c) => {
  const b = await c.req.json();
  const date = logDate(c.env, b.date);
  const ml = Math.max(0, Math.min(5000, int(b.ml) ?? 0)); // 20 glasses max per day
  await run(c.env.DB, `INSERT INTO water_logs (member_id, day, ml) VALUES (?, ?, ?) ON CONFLICT(member_id, day) DO UPDATE SET ml=excluded.ml`, mid(c), date, ml);
  return c.json({ ml });
});

/** Weight history for the Progress chart. view = day (each weigh-in) | week | month (averages); trend vs goal. */
fit.get('/weight', async (c) => {
  const id = mid(c);
  const view = (['day', 'week', 'month'] as const).find((v) => v === c.req.query('view')) ?? 'week';
  const today = todayFor(c.env);
  const { rows, p } = await memberWeights(c.env, id);
  // Last 90 weigh-ins / 26 weeks / 24 months keep the chart readable
  const points = bucketWeights(rows, view).slice(view === 'day' ? -90 : view === 'week' ? -26 : -24);
  return c.json({ view, points, trend: weightTrend(rows, p, today), entries: rows.slice(-30).reverse() });
});

fit.post('/weight', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const date = logDate(c.env, b.date);
  const kg = Number(b.weight_kg);
  assert(kg >= 30 && kg <= 250, 400, 'Enter your weight in kg (30–250)');
  await run(c.env.DB, `INSERT INTO weight_logs (member_id, day, weight_kg) VALUES (?, ?, ?) ON CONFLICT(member_id, day) DO UPDATE SET weight_kg=excluded.weight_kg`, id, date, round(kg, 1));
  await syncLatestWeight(c.env, id);
  const [{ p, sex }, w] = await Promise.all([loadProfile(c.env, id), memberWeights(c.env, id)]);
  const today = todayFor(c.env);
  return c.json({ ok: true, profile: describe(p, sex, today), trend: weightTrend(w.rows, w.p, today) });
});

fit.delete('/weight/:day', async (c) => {
  const day = c.req.param('day');
  const id = mid(c);
  assert(isDate(day), 400, 'Bad date');
  await run(c.env.DB, `DELETE FROM weight_logs WHERE member_id=? AND day=?`, id, day);
  await syncLatestWeight(c.env, id);
  return c.json({ ok: true });
});

/** Latest weigh-in drives the profile weight, BMI and targets (also after deleting the newest entry). */
async function syncLatestWeight(env: Env, id: number) {
  const latest = await first<{ weight_kg: number }>(env.DB, `SELECT weight_kg FROM weight_logs WHERE member_id=? ORDER BY day DESC LIMIT 1`, id);
  if (!latest) return;
  await run(env.DB, `UPDATE fitness_profiles SET weight_kg=?, updated_at=? WHERE member_id=?`, latest.weight_kg, nowIso(), id);
  await refreshTargets(env, id);
}

// ── Exercise library ────────────────────────────────────────────────────
const EX_COLS = `id, name, body_part, target, equipment, category, level, images, met, tracking, popular`;
const parseEx = <T extends { images?: string | null }>(r: T) => ({ ...r, images: r.images ? (JSON.parse(r.images) as string[]) : [] });

/**
 * Filters shared by the list and the facet counts, applied to the in-memory catalog
 * (the library is read once per isolate instead of scanned on every request).
 */
function exerciseFilter(query: (k: string) => string | undefined, skip: string[] = []) {
  const val = (k: string) => (skip.includes(k) ? '' : (query(k) ?? '').trim());
  const words = val('q').toLowerCase().slice(0, 60).split(/\s+/).filter(Boolean).slice(0, 4);
  const eq = ([['body', 'body_part'], ['target', 'target'], ['equipment', 'equipment'], ['level', 'level']] as const)
    .map(([k, col]) => [col, val(k)] as const).filter(([, v]) => v);
  const type = val('type'); // strength | cardio | stretching | plyometrics
  const photos = val('photos') === 'yes';
  const test = (e: ExRow) =>
    words.every((w) => e._name.includes(w) || e._target.includes(w))
    && eq.every(([col, v]) => e[col] === v)
    && (!type || (type === 'cardio' ? e.category === 'cardio' || e.body_part === 'cardio' : e.category === type))
    && (!photos || e.images != null);
  return { test, filtered: words.length > 0 || eq.length > 0 || !!type || photos };
}

const countBy = (rows: ExRow[], key: (e: ExRow) => string | null, limit?: number) => {
  const m = new Map<string, number>();
  for (const e of rows) { const v = key(e); if (v) m.set(v, (m.get(v) ?? 0) + 1); }
  return [...m].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n).slice(0, limit);
};
const exType = (e: ExRow) => (e.category === 'cardio' || e.body_part === 'cardio' ? 'cardio' : e.category);
const byRank = (a: ExRow, b: ExRow) => b.popular - a.popular || Number(b.images != null) - Number(a.images != null)
  || a.name.length - b.name.length || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

/**
 * Dropdown options with counts. Each list is computed with every *other* filter applied,
 * so e.g. choosing Chest narrows Muscle to pectorals/serratus and Equipment to what exists for chest.
 */
fit.get('/exercises/facets', async (c) => {
  const lib = await exerciseCatalog(c.env);
  const qf = (k: string) => c.req.query(k);
  const facet = (key: (e: ExRow) => string | null, skip: string) => {
    const { test } = exerciseFilter(qf, [skip]);
    return countBy(lib.filter(test), key);
  };
  return c.json({
    body: facet((e) => e.body_part, 'body'), target: facet((e) => e.target, 'target'),
    equipment: facet((e) => e.equipment, 'equipment'), level: facet((e) => e.level, 'level'), type: facet(exType, 'type'),
  });
});

fit.get('/exercises', async (c) => {
  const offset = Math.max(0, int(c.req.query('offset')) ?? 0);
  const catalog = await exerciseCatalog(c.env);
  const { test, filtered } = exerciseFilter((k) => c.req.query(k));
  const matches = catalog.filter((e) => test(e) && (filtered || e.popular === 1)).sort(byRank);
  const rows = matches.slice(offset, offset + 40);
  const facets = offset === 0 && !filtered
    ? { body_parts: countBy(catalog, (e) => e.body_part), equipment: countBy(catalog, (e) => e.equipment, 14) }
    : null;
  return c.json({ results: rows.map((r) => parseEx(strip(r))), facets, total: offset === 0 ? matches.length : null, next: rows.length === 40 ? offset + 40 : null });
});

fit.get('/exercises/:id', async (c) => {
  const ex = await first<Record<string, unknown> & { images: string | null; instructions: string | null; instructions_hi: string | null; secondary: string | null }>(
    c.env.DB, `SELECT * FROM exercises WHERE id=?`, c.req.param('id'));
  assert(ex, 404, 'Exercise not found');
  const history = await all<{ day: string; sets: string | null; duration_min: number; kcal: number; best_e1rm: number | null; volume_kg: number }>(c.env.DB,
    `SELECT day, sets, duration_min, kcal, best_e1rm, volume_kg FROM workout_logs WHERE member_id=? AND exercise_id=? ORDER BY day DESC, id DESC LIMIT 12`, mid(c), ex.id);
  return c.json({
    ...ex,
    images: ex.images ? JSON.parse(ex.images) : [],
    instructions: ex.instructions ? JSON.parse(ex.instructions) : [],
    instructions_hi: ex.instructions_hi ? JSON.parse(ex.instructions_hi) : null,
    secondary: ex.secondary ? JSON.parse(ex.secondary) : [],
    history: history.map((h) => ({ ...h, sets: h.sets ? JSON.parse(h.sets) : [] })),
    best_e1rm: history.reduce((m, h) => Math.max(m, h.best_e1rm ?? 0), 0) || null,
  });
});

// ── Workouts ────────────────────────────────────────────────────────────
fit.post('/workouts', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const date = logDate(c.env, b.date);
  const sets: SetEntry[] = (Array.isArray(b.sets) ? b.sets : []).slice(0, 30)
    .map((s: { reps?: unknown; kg?: unknown }) => ({ reps: Math.max(0, Math.min(500, int(s.reps) ?? 0)), kg: Math.max(0, Math.min(500, round(Number(s.kg) || 0, 2))) }))
    .filter((s: SetEntry) => s.reps > 0);
  return c.json(await logWorkout(c.env, id, { date, exerciseId: str(b.exercise_id, 120), sets, minutes: Number(b.duration_min), notes: b.notes }));
});

fit.delete('/workouts/:id', async (c) => {
  await run(c.env.DB, `DELETE FROM workout_logs WHERE id=? AND member_id=?`, Number(c.req.param('id')), mid(c));
  return c.json({ ok: true });
});
