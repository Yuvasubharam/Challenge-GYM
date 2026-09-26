// Admin: correct / add / hide foods in the shared food database (values per 100 g).
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, int, nowIso, run, str } from '../../lib/db';

export const foods = new Hono<AppEnv>();
foods.use('*', requireAdmin());

const SORTS: Record<string, string> = {
  used: 'uses DESC, name COLLATE NOCASE',
  name: 'name COLLATE NOCASE',
  kcal_desc: 'kcal DESC, name COLLATE NOCASE',
  kcal_asc: 'kcal ASC, name COLLATE NOCASE',
  protein: 'protein DESC, name COLLATE NOCASE',
  updated: 'updated_at DESC',
};

/** Paginated + filtered list. Query: q, veg (veg|egg|nonveg|unknown), source (basic|indb|custom), status (visible|hidden|all), sort, page, size */
foods.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);
  const where: string[] = ['owner_member_id IS NULL'];
  const params: unknown[] = [];
  for (const w of q.split(/\s+/).filter(Boolean).slice(0, 4)) { where.push('lower(name) LIKE ?'); params.push(`%${w}%`); }
  const veg = c.req.query('veg');
  if (veg === 'unknown') where.push('veg IS NULL');
  else if (veg && ['veg', 'egg', 'nonveg'].includes(veg)) { where.push('veg=?'); params.push(veg); }
  const source = c.req.query('source');
  if (source && ['basic', 'indb', 'custom'].includes(source)) { where.push('source=?'); params.push(source); }
  const status = c.req.query('status') ?? 'visible';
  if (status === 'visible') where.push('active=1');
  else if (status === 'hidden') where.push('active=0');
  const size = Math.min(100, Math.max(10, int(c.req.query('size')) ?? 25));
  const page = Math.max(1, int(c.req.query('page')) ?? 1);
  const order = SORTS[c.req.query('sort') ?? 'used'] ?? SORTS.used;
  const w = where.join(' AND ');
  const [count, rows, stats] = await Promise.all([
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM foods WHERE ${w}`, ...params),
    all(c.env.DB, `SELECT * FROM foods WHERE ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size),
    first(c.env.DB, `SELECT COUNT(*) AS total, SUM(active=0) AS hidden, SUM(source='custom') AS gym_added, SUM(veg='veg') AS veg,
                     SUM(veg='egg') AS egg, SUM(veg='nonveg') AS nonveg, SUM(veg IS NULL) AS unknown FROM foods WHERE owner_member_id IS NULL`),
  ]);
  const total = count?.n ?? 0;
  return c.json({ stats, total, page, size, pages: Math.max(1, Math.ceil(total / size)), foods: rows });
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
  return out;
}

foods.post('/', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const v = values({ serving_g: 100, serving_label: '100 g', ...b });
  assert(v.name && v.kcal !== undefined, 400, 'Name and kcal per 100 g are required');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO foods (name, kcal, protein, carbs, fat, fiber, serving_g, serving_label, veg, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'custom') RETURNING id`,
    v.name, v.kcal, v.protein ?? 0, v.carbs ?? 0, v.fat ?? 0, v.fiber ?? null, v.serving_g, v.serving_label, v.veg ?? null);
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
