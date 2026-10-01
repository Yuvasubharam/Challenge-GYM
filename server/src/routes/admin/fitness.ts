// Admin: fitness tracker overview + exercise library management (edit, add, photos/GIFs/videos).
import { Hono } from 'hono';
import type { AppEnv, Env } from '../../env';
import { tzOffset } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, int, nowIso, run, str } from '../../lib/db';
import { adminExerciseCatalog, bumpCatalogVersion, countBy, exerciseUseCounts, type AdminExRow } from '../../lib/catalog';
import { UPLOAD_RE, UPLOAD_TYPES, isImagePath, isVideoUpload, mediaKey, serveExerciseMedia } from '../../lib/exerciseMedia';
import { addDays, today as todayOf } from '../../lib/dates';

export const fitnessAdmin = new Hono<AppEnv>();
fitnessAdmin.use('*', requireAdmin());
// Any successful edit makes member workers reload their in-memory catalog.
fitnessAdmin.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 400) await bumpCatalogVersion(c.env);
});
fitnessAdmin.get('/overview', async (c) => {
  const today = todayOf(tzOffset(c.env));
  const week = addDays(today, -6);
  const [counts, goals, diets, topFoods, topExercises, recent] = await Promise.all([
    first(c.env.DB, `SELECT
        (SELECT COUNT(*) FROM members WHERE archived=0) AS members,
        (SELECT COUNT(*) FROM accounts WHERE role='member' AND active=1 AND last_login_at IS NOT NULL) AS app_users,
        (SELECT COUNT(*) FROM members WHERE archived=0 AND app_access=0) AS app_off,
        (SELECT COUNT(*) FROM fitness_profiles WHERE onboarded_at IS NOT NULL) AS onboarded,
        (SELECT COUNT(DISTINCT member_id) FROM food_logs WHERE day>=?1) AS food_loggers_7d,
        (SELECT COUNT(DISTINCT member_id) FROM workout_logs WHERE day>=?1) AS workout_loggers_7d,
        (SELECT COUNT(*) FROM food_logs WHERE day>=?1) AS food_logs_7d,
        (SELECT COUNT(*) FROM workout_logs WHERE day>=?1) AS workouts_7d`, week),
    all(c.env.DB, `SELECT goal, COUNT(*) AS n FROM fitness_profiles WHERE onboarded_at IS NOT NULL GROUP BY goal ORDER BY n DESC`),
    all<{ diet_pref: string | null }>(c.env.DB, `SELECT diet_pref FROM fitness_profiles WHERE onboarded_at IS NOT NULL`),
    all(c.env.DB, `SELECT name, COUNT(*) AS n FROM food_logs WHERE day>=? GROUP BY food_id ORDER BY n DESC LIMIT 8`, addDays(today, -29)),
    all(c.env.DB, `SELECT name, COUNT(*) AS n FROM workout_logs WHERE day>=? GROUP BY exercise_id ORDER BY n DESC LIMIT 8`, addDays(today, -29)),
    all(c.env.DB, `SELECT m.id, m.name, m.essl_id, p.goal, p.weight_kg, p.onboarded_at FROM fitness_profiles p JOIN members m ON m.id=p.member_id
                   WHERE p.onboarded_at IS NOT NULL ORDER BY p.onboarded_at DESC LIMIT 10`),
  ]);
  const dietCounts: Record<string, number> = {};
  for (const d of diets) for (const x of (d.diet_pref ?? '').split(',').filter(Boolean)) dietCounts[x] = (dietCounts[x] ?? 0) + 1;
  return c.json({ counts, goals, diets: dietCounts, top_foods: topFoods, top_exercises: topExercises, recent });
});

type ExSorter = (a: AdminExRow & { uses: number }, b: AdminExRow & { uses: number }) => number;
const byName: ExSorter = (a, b) => a._name.localeCompare(b._name);
const EX_SORTS: Record<string, ExSorter> = {
  popular: (a, b) => b.popular - a.popular || Number(b.images != null) - Number(a.images != null) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
  name: byName,
  used: (a, b) => b.uses - a.uses || byName(a, b),
};

/**
 * Paginated exercise library. Query: q, body, equipment, photos (yes|no), status (visible|hidden|all), popular (1), sort, page, size.
 * Served from the in-memory admin catalog: 1 D1 row read (catalog version) per request instead of ~15k.
 */
fitnessAdmin.get('/exercises', async (c) => {
  const [catalog, uses] = await Promise.all([adminExerciseCatalog(c.env), exerciseUseCounts(c.env)]);
  const words = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60).split(/\s+/).filter(Boolean).slice(0, 4);
  const body = c.req.query('body');
  const equipment = c.req.query('equipment');
  const photos = c.req.query('photos');
  const status = c.req.query('status') ?? 'visible';
  const popularOnly = c.req.query('popular') === '1';
  const matches = catalog
    .filter((e) => words.every((w) => e._name.includes(w) || e._target.includes(w))
      && (!body || e.body_part === body) && (!equipment || e.equipment === equipment)
      && (photos !== 'yes' || e.images != null) && (photos !== 'no' || e.images == null)
      && (status !== 'visible' || e.active === 1) && (status !== 'hidden' || e.active === 0)
      && (!popularOnly || e.popular === 1))
    .map((e) => ({ ...e, uses: uses.get(e.id) ?? 0 }))
    .sort(EX_SORTS[c.req.query('sort') ?? 'popular'] ?? EX_SORTS.popular);
  const size = Math.min(100, Math.max(10, int(c.req.query('size')) ?? 24));
  const page = Math.max(1, int(c.req.query('page')) ?? 1);
  const total = matches.length;
  return c.json({
    total, page, size, pages: Math.max(1, Math.ceil(total / size)),
    exercises: matches.slice((page - 1) * size, page * size).map(({ _name, _target, ...r }) => ({ ...r, images: r.images ? JSON.parse(r.images) : [] })),
    facets: page === 1 ? {
      body_parts: countBy(catalog, (e) => e.body_part),
      equipment: countBy(catalog, (e) => e.equipment),
      stats: {
        total: catalog.length,
        hidden: catalog.filter((e) => e.active === 0).length,
        popular: catalog.filter((e) => e.popular === 1).length,
        with_photos: catalog.filter((e) => e.images != null).length,
      },
      targets: countBy(catalog, (e) => e.target, true),
      categories: countBy(catalog, (e) => e.category, true),
    } : null,
  });
});

/** One exercise with every editable field (admin editor). */
fitnessAdmin.get('/exercises/:id', async (c) => {
  const ex = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM exercises WHERE id=?`, c.req.param('id'));
  assert(ex, 404, 'Exercise not found');
  const uses = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM workout_logs WHERE exercise_id=?`, ex.id);
  return c.json({ ...parseFull(ex), uses: uses?.n ?? 0 });
});

const JSON_COLS = ['secondary', 'instructions', 'instructions_hi', 'images'] as const;
function parseFull(ex: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...ex };
  for (const k of JSON_COLS) out[k] = ex[k] ? JSON.parse(String(ex[k])) : k === 'instructions_hi' ? null : [];
  return out;
}

/** Validates the editable fields present in `b` → column values. */
function exerciseValues(b: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  const list = (k: string, maxItems: number, maxLen: number) => {
    const v = b[k] ?? [];
    assert(Array.isArray(v) && v.every((x) => typeof x === 'string'), 400, `${k} must be a list of text`);
    return (v as string[]).map((x) => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems);
  };
  if ('name' in b) { const s = str(b.name, 100); assert(s, 400, 'Name is required'); out.name = s; }
  for (const [k, max] of [['body_part', 40], ['target', 60], ['equipment', 60], ['category', 40], ['level', 20]] as const) {
    if (k in b) out[k] = str(b[k], max)?.toLowerCase() ?? null;
  }
  if ('description' in b) out.description = str(b.description, 3000);
  if ('secondary' in b) { const l = list('secondary', 10, 60).map((x) => x.toLowerCase()); out.secondary = l.length ? JSON.stringify(l) : null; }
  if ('instructions' in b) out.instructions = JSON.stringify(list('instructions', 30, 800));
  if ('instructions_hi' in b) { const l = list('instructions_hi', 30, 800); out.instructions_hi = l.length ? JSON.stringify(l) : null; }
  if ('images' in b) {
    const l = [...new Set(list('images', 10, 200))];
    assert(l.every(isImagePath), 400, 'Unknown photo — upload it first');
    out.images = l.length ? JSON.stringify(l) : null;
  }
  if ('video' in b) {
    const v = str(b.video, 500);
    assert(!v || isVideoUpload(v) || /^https:\/\/[^\s"'<>]+$/.test(v), 400, 'Video must be an uploaded file or an https:// link');
    out.video = v;
  }
  if ('met' in b) { const x = Number(b.met); assert(Number.isFinite(x) && x >= 1 && x <= 20, 400, 'MET must be between 1 and 20'); out.met = Math.round(x * 10) / 10; }
  if ('tracking' in b) { assert(b.tracking === 'sets' || b.tracking === 'time', 400, 'Tracking must be sets or time'); out.tracking = b.tracking; }
  if (typeof b.active === 'boolean') out.active = b.active ? 1 : 0;
  if (typeof b.popular === 'boolean') out.popular = b.popular ? 1 : 0;
  return out;
}

/** Gym uploads referenced by an exercise row (deleted from R2 once no longer used). */
const uploadsOf = (row: { images?: unknown; video?: unknown }) => {
  const imgs = row.images ? (JSON.parse(String(row.images)) as string[]) : [];
  return [...imgs, ...(row.video ? [String(row.video)] : [])].filter((p) => UPLOAD_RE.test(p));
};
const dropUploads = async (env: Env, paths: string[]) => { if (env.FILES && paths.length) await env.FILES.delete(paths.map(mediaKey)); };

/** Add a gym exercise. */
fitnessAdmin.post('/exercises', requireAdmin('owner', 'admin'), async (c) => {
  const v = exerciseValues({ tracking: 'sets', met: 5, instructions: [], ...(await c.req.json()) });
  assert(v.name, 400, 'Name is required');
  const id = `gym-${crypto.randomUUID()}`;
  const keys = Object.keys(v);
  await run(c.env.DB, `INSERT INTO exercises (id, ${keys.join(', ')}, source, edited, updated_at) VALUES (?, ${keys.map(() => '?').join(', ')}, 'gym', 1, ?)`,
    id, ...keys.map((k) => v[k]), nowIso());
  await audit(c.env, actor(c), 'exercise.create', 'exercise', id, { name: v.name });
  return c.json({ id });
});

/** Edit any field; also used by the grid's show/hide and Popular buttons. */
fitnessAdmin.patch('/exercises/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  const f = exerciseValues(await c.req.json());
  const keys = Object.keys(f);
  assert(keys.length, 400, 'Nothing to update');
  const old = await first<{ images: string | null; video: string | null }>(c.env.DB, `SELECT images, video FROM exercises WHERE id=?`, id);
  assert(old, 404, 'Exercise not found');
  await run(c.env.DB, `UPDATE exercises SET ${keys.map((k) => `${k}=?`).join(', ')}, edited=1, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), nowIso(), id);
  const kept = new Set(uploadsOf({ images: 'images' in f ? f.images : old.images, video: 'video' in f ? f.video : old.video }));
  c.executionCtx.waitUntil(dropUploads(c.env, uploadsOf(old).filter((p) => !kept.has(p))));
  await audit(c.env, actor(c), 'exercise.update', 'exercise', id,
    Object.fromEntries(keys.map((k) => [k, typeof f[k] === 'string' && String(f[k]).length > 80 ? '(text)' : f[k]])));
  return c.json({ ok: true });
});

/** Delete a gym-added exercise (members' past logs keep its name). Built-in exercises can only be hidden. */
fitnessAdmin.delete('/exercises/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = c.req.param('id');
  const ex = await first<{ source: string; name: string; images: string | null; video: string | null }>(c.env.DB,
    `SELECT source, name, images, video FROM exercises WHERE id=?`, id);
  assert(ex, 404, 'Exercise not found');
  assert(ex.source === 'gym', 400, 'Built-in exercises can only be hidden');
  await run(c.env.DB, `DELETE FROM exercises WHERE id=?`, id);
  c.executionCtx.waitUntil(dropUploads(c.env, uploadsOf(ex)));
  await audit(c.env, actor(c), 'exercise.delete', 'exercise', id, { name: ex.name });
  return c.json({ ok: true });
});

/** Upload a photo, GIF or video → R2. Returns the path to put in `images` / `video`. */
fitnessAdmin.put('/media', requireAdmin('owner', 'admin'), async (c) => {
  assert(c.env.FILES, 503, 'File storage is not configured');
  const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const t = UPLOAD_TYPES[type];
  assert(t, 400, 'Upload a JPEG, PNG, WebP or GIF image, or an MP4/WebM video');
  const tooBig = `File must be under ${t.max / 1_000_000} MB`;
  assert(Number(c.req.header('content-length') ?? 0) <= t.max, 413, tooBig);
  const buf = await c.req.arrayBuffer();
  assert(buf.byteLength > 0 && buf.byteLength <= t.max, 413, tooBig);
  const path = `u/${crypto.randomUUID()}.${t.ext}`;
  await c.env.FILES!.put(mediaKey(path), buf, { httpMetadata: { contentType: type } });
  return c.json({ path });
});

// Exercise media for the admin app (free-exercise-db mirror + gym uploads).
fitnessAdmin.get('/media/*', (c) => serveExerciseMedia(c.env, c.req.raw, decodeURIComponent(c.req.path.replace(/^.*\/media\//, '')),
  'private, max-age=86400', (p) => c.executionCtx.waitUntil(p)));
