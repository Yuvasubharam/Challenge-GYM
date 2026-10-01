// Admin: correct / add / hide foods in the shared food database (values per 100 g).
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, int, nowIso, run, str } from '../../lib/db';
import { adminFoodCatalog, bumpCatalogVersion, type AdminFoodRow } from '../../lib/catalog';

export const foods = new Hono<AppEnv>();
foods.use('*', requireAdmin());
// Any successful edit makes member workers reload their in-memory catalog.
foods.use('*', async (c, next) => {
  await next();
  if (c.req.method !== 'GET' && c.res.status < 400) await bumpCatalogVersion(c.env);
});
type FoodSorter = (a: AdminFoodRow, b: AdminFoodRow) => number;
const num = (v: unknown) => Number(v ?? 0);
const byName: FoodSorter = (a, b) => a._name.localeCompare(b._name);
const SORTS: Record<string, FoodSorter> = {
  used: (a, b) => b.uses - a.uses || byName(a, b),
  name: byName,
  kcal_desc: (a, b) => num(b.kcal) - num(a.kcal) || byName(a, b),
  kcal_asc: (a, b) => num(a.kcal) - num(b.kcal) || byName(a, b),
  protein: (a, b) => num(b.protein) - num(a.protein) || byName(a, b),
  updated: (a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')),
};

/**
 * Paginated + filtered list. Query: q, veg (veg|egg|nonveg|unknown), source (basic|indb|cg|custom), status (visible|hidden|all), sort, page, size.
 * Served from the in-memory admin food catalog (1 D1 row read per request instead of ~3k per keystroke).
 */
foods.get('/', async (c) => {
  const catalog = await adminFoodCatalog(c.env);
  const words = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60).split(/\s+/).filter(Boolean).slice(0, 4);
  const veg = c.req.query('veg');
  const source = c.req.query('source');
  const status = c.req.query('status') ?? 'visible';
  const matches = catalog
    .filter((f) => words.every((w) => f._name.includes(w))
      && (veg !== 'unknown' || f.veg == null) && (!veg || !['veg', 'egg', 'nonveg'].includes(veg) || f.veg === veg)
      && (!source || !['basic', 'indb', 'cg', 'custom'].includes(source) || f.source === source)
      && (status !== 'visible' || f.active === 1) && (status !== 'hidden' || f.active === 0))
    .sort(SORTS[c.req.query('sort') ?? 'used'] ?? SORTS.used);
  const size = Math.min(100, Math.max(10, int(c.req.query('size')) ?? 25));
  const page = Math.max(1, int(c.req.query('page')) ?? 1);
  const total = matches.length;
  const n = (f: (x: AdminFoodRow) => boolean) => catalog.filter(f).length;
  const stats = {
    total: catalog.length, hidden: n((f) => f.active === 0), gym_added: n((f) => f.source === 'custom'), curated: n((f) => f.source === 'cg'),
    veg: n((f) => f.veg === 'veg'), egg: n((f) => f.veg === 'egg'), nonveg: n((f) => f.veg === 'nonveg'), unknown: n((f) => f.veg == null),
  };
  return c.json({ stats, total, page, size, pages: Math.max(1, Math.ceil(total / size)), foods: matches.slice((page - 1) * size, page * size).map(({ _name, ...r }) => r) });
});

function values(b: Record<string, unknown>) {
  const n = (k: string, max: number) => {
    if (!(k in b)) return undefined;
    const x = Number(b[k]);
    assert(Number.isFinite(x) && x >= 0 && x <= max, 400, `${k} must be between 0 and ${max}`);
    return Math.round(x * 10) / 10;
  };
  const out: Record<string, unknown> = {};
  if ('name' in b) { const s = str(b.name, 80); assert(s, 400, 'Name is required'); out.name = s; }
  for (const [k, max] of [['kcal', 950], ['protein', 100], ['carbs', 100], ['fat', 100], ['fiber', 100], ['serving_g', 2000]] as const) {
    const v = n(k, max);
    if (v !== undefined) out[k] = v;
  }
  if ('serving_label' in b) out.serving_label = str(b.serving_label, 40) ?? '100 g';
  if ('veg' in b) out.veg = ['veg', 'egg', 'nonveg'].includes(String(b.veg)) ? b.veg : null;
  if ('active' in b) out.active = b.active ? 1 : 0;
  // Recipe: list of lines (or one string, one item per line); empty → no recipe
  for (const k of ['ingredients', 'steps'] as const) {
    if (!(k in b)) continue;
    const raw = Array.isArray(b[k]) ? b[k] as unknown[] : String(b[k] ?? '').split('\n');
    const lines = raw.map((x) => String(x ?? '').trim().slice(0, 400)).filter(Boolean);
    assert(lines.length <= 40, 400, `Up to 40 ${k}`);
    out[k] = lines.length ? JSON.stringify(lines) : null;
  }
  return out;
}

/** Full row incl. recipe (the list leaves the recipe text out). */
foods.get('/:id', async (c) => {
  const f = await first<Record<string, unknown> & { ingredients: string | null; steps: string | null }>(c.env.DB,
    `SELECT * FROM foods WHERE id=? AND owner_member_id IS NULL`, Number(c.req.param('id')));
  assert(f, 404, 'Food not found');
  return c.json({ ...f, ingredients: f.ingredients ? JSON.parse(f.ingredients) : [], steps: f.steps ? JSON.parse(f.steps) : [] });
});

foods.post('/', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const v = values({ serving_g: 100, serving_label: '100 g', ...b });
  assert(v.name && v.kcal !== undefined, 400, 'Name and kcal per 100 g are required');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO foods (name, kcal, protein, carbs, fat, fiber, serving_g, serving_label, veg, source, ingredients, steps) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom', ?, ?) RETURNING id`,
    v.name, v.kcal, v.protein ?? 0, v.carbs ?? 0, v.fat ?? 0, v.fiber ?? null, v.serving_g, v.serving_label, v.veg ?? null, v.ingredients ?? null, v.steps ?? null);
  await audit(c.env, actor(c), 'food.create', 'food', r!.id, v);
  return c.json({ id: r!.id });
});

foods.patch('/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const v = values(await c.req.json());
  const keys = Object.keys(v);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE foods SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=? AND owner_member_id IS NULL`,
    ...keys.map((k) => v[k]), nowIso(), id);
  await audit(c.env, actor(c), 'food.update', 'food', id, v);
  return c.json({ ok: true });
});
