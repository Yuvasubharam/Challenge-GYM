// Content hub: posts (notice / event / offer), home carousel, shop, gallery, phone push.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, int, isDateOrNull, nowIso, run, str } from '../../lib/db';
import { ctaLink, dropImages, imageKey, pushBatch, pushConfigured, serveContentImage, storeContentImage } from '../../lib/content';

export const content = new Hono<AppEnv>();
content.use('*', requireAdmin());

type Coerce = (v: unknown) => unknown;
const bool: Coerce = (v) => (typeof v === 'boolean' ? (v ? 1 : 0) : undefined);
const text = (max: number): Coerce => (v) => (v === undefined ? undefined : str(v, max));
const date: Coerce = (v) => (v === undefined ? undefined : v === null || v === '' ? null : (assert(isDateOrNull(v), 400, 'Dates must be YYYY-MM-DD'), v));
const money: Coerce = (v) => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  const n = int(v);
  assert(n !== null && n >= 0 && n <= 10_000_000, 400, 'Enter a valid price');
  return n;
};
const whole: Coerce = (v) => (v === undefined ? undefined : int(v) ?? 0);

/** Build "a=?, b=?" from the fields present in the body. */
function patchSql(body: Record<string, unknown>, fields: Record<string, Coerce>) {
  const cols: string[] = [];
  const vals: unknown[] = [];
  for (const [k, fn] of Object.entries(fields)) {
    if (!(k in body)) continue;
    const v = fn(body[k]);
    if (v === undefined) continue;
    cols.push(`${k}=?`);
    vals.push(v);
  }
  return { cols, vals };
}

async function insertRow(c: { env: AppEnv['Bindings'] }, table: string, body: Record<string, unknown>, fields: Record<string, Coerce>, extra: Record<string, unknown> = {}) {
  const { cols, vals } = patchSql(body, fields);
  const names = [...cols.map((x) => x.slice(0, -2)), ...Object.keys(extra)];
  const r = await first<{ id: number }>(c.env.DB, `INSERT INTO ${table} (${names.join(',')}) VALUES (${names.map(() => '?').join(',')}) RETURNING id`,
    ...vals, ...Object.values(extra));
  return r!.id;
}

async function patchRow(c: { env: AppEnv['Bindings'] }, table: string, id: number, body: Record<string, unknown>, fields: Record<string, Coerce>, imageCols: string[] = [], touch = false) {
  const before = await first<Record<string, unknown>>(c.env.DB, `SELECT * FROM ${table} WHERE id=?`, id);
  assert(before, 404, 'Not found');
  const { cols, vals } = patchSql(body, fields);
  if (touch) { cols.push('updated_at=?'); vals.push(nowIso()); }
  if (cols.length) await run(c.env.DB, `UPDATE ${table} SET ${cols.join(', ')} WHERE id=?`, ...vals, id);
  const replaced = imageCols.filter((k) => k in body && before[k] !== body[k]).map((k) => before[k] as string | null);
  await dropImages(c.env, replaced);
  return before;
}

// ── Images ──────────────────────────────────────────────────────────────
content.put('/upload', async (c) => c.json({ key: await storeContentImage(c.env, c.req.raw) }));
content.get('/img/*', (c) => serveContentImage(c.env, c.req.path.replace(/^.*\/img\//, '')));

content.get('/summary', async (c) => {
  const r = await first<Record<string, number>>(c.env.DB, `SELECT
    (SELECT COUNT(*) FROM announcements WHERE published=1) AS posts,
    (SELECT COUNT(*) FROM banners WHERE active=1) AS banners,
    (SELECT COUNT(*) FROM products WHERE active=1) AS products,
    (SELECT COUNT(*) FROM product_enquiries WHERE status='new') AS enquiries,
    (SELECT COUNT(*) FROM gallery_albums) AS albums,
    (SELECT COUNT(*) FROM push_subscriptions) AS push_devices,
    (SELECT COUNT(DISTINCT member_id) FROM push_subscriptions) AS push_members`);
  return c.json({ ...r, push_ready: pushConfigured(c.env) });
});

// ── Posts (announcements) ───────────────────────────────────────────────
const POST_FIELDS: Record<string, Coerce> = {
  kind: (v) => (v === undefined ? undefined : (assert(['notice', 'event', 'offer'].includes(String(v)), 400, 'Unknown post type'), String(v))),
  title: text(120), body: text(4000), image_key: imageKey, event_date: date, event_time: text(40),
  cta_label: text(30), cta_link: ctaLink, expires_on: date, pinned: bool, published: bool, notify: bool,
};

content.get('/posts', async (c) =>
  c.json(await all(c.env.DB, `SELECT * FROM announcements ORDER BY published DESC, pinned DESC, id DESC LIMIT 200`)));

content.post('/posts', async (c) => {
  const b = await c.req.json();
  assert(str(b.title, 120), 400, 'Title is required');
  assert(b.kind !== 'event' || isDateOrNull(b.event_date), 400, 'Pick the event date');
  const id = await insertRow(c, 'announcements', b, POST_FIELDS, { created_by: c.get('session').name, updated_at: nowIso() });
  await audit(c.env, actor(c), 'content.post.create', 'announcement', id, { title: b.title, kind: b.kind, notify: !!b.notify });
  return c.json({ id });
});

content.patch('/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  await patchRow(c, 'announcements', id, await c.req.json(), POST_FIELDS, ['image_key'], true);
  return c.json({ ok: true });
});

content.delete('/posts/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const row = await first<{ image_key: string | null; title: string }>(c.env.DB, `SELECT image_key, title FROM announcements WHERE id=?`, id);
  assert(row, 404, 'Not found');
  await run(c.env.DB, `DELETE FROM announcements WHERE id=?`, id);
  await dropImages(c.env, [row.image_key]);
  await audit(c.env, actor(c), 'content.post.delete', 'announcement', id, { title: row.title });
  return c.json({ ok: true });
});

/** Phone push, one batch per call; the admin app loops with `after` until next is null. */
content.post('/posts/:id/push', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const post = await first<{ published: number; title: string }>(c.env.DB, `SELECT published, title FROM announcements WHERE id=?`, id);
  assert(post?.published, 400, 'Publish the post before sending it to phones');
  const after = int(b.after) ?? 0;
  await run(c.env.DB, `UPDATE announcements SET notify=1, pushed_at=? WHERE id=?`, nowIso(), id);
  if (after === 0) await audit(c.env, actor(c), 'content.post.push', 'announcement', id, { title: post.title });
  return c.json(await pushBatch(c.env, after));
});

// ── Carousel ────────────────────────────────────────────────────────────
const BANNER_FIELDS: Record<string, Coerce> = {
  title: text(80), subtitle: text(160), image_key: imageKey, cta_label: text(30), cta_link: ctaLink,
  starts_on: date, ends_on: date, sort: whole, active: bool,
};
content.get('/banners', async (c) => c.json(await all(c.env.DB, `SELECT * FROM banners ORDER BY active DESC, sort, id DESC`)));
content.post('/banners', async (c) => {
  const b = await c.req.json();
  assert(str(b.title, 80), 400, 'Title is required');
  const max = await first<{ s: number }>(c.env.DB, `SELECT COALESCE(MAX(sort),0)+1 AS s FROM banners`);
  const id = await insertRow(c, 'banners', { sort: max!.s, ...b }, BANNER_FIELDS, { created_by: c.get('session').name });
  return c.json({ id });
});
content.patch('/banners/:id', async (c) => {
  await patchRow(c, 'banners', Number(c.req.param('id')), await c.req.json(), BANNER_FIELDS, ['image_key']);
  return c.json({ ok: true });
});
content.delete('/banners/:id', async (c) => {
  const row = await first<{ image_key: string | null }>(c.env.DB, `DELETE FROM banners WHERE id=? RETURNING image_key`, Number(c.req.param('id')));
  assert(row, 404, 'Not found');
  await dropImages(c.env, [row.image_key]);
  return c.json({ ok: true });
});
/** Body: { ids: number[] } in display order (used for banners and products). */
content.post('/:table{banners|products}/order', async (c) => {
  const table = c.req.param('table');
  const ids = ((await c.req.json()).ids ?? []) as unknown[];
  assert(Array.isArray(ids) && ids.length <= 500, 400, 'Invalid order');
  await c.env.DB.batch(ids.map((id, i) => c.env.DB.prepare(`UPDATE ${table} SET sort=? WHERE id=?`).bind(i + 1, Number(id))));
  return c.json({ ok: true });
});

// ── Shop ────────────────────────────────────────────────────────────────
const PRODUCT_FIELDS: Record<string, Coerce> = {
  name: text(100), description: text(1500), category: text(40), price: money, mrp: money, image_key: imageKey,
  in_stock: bool, featured: bool, active: bool, sort: whole,
};
content.get('/products', async (c) => c.json(await all(c.env.DB,
  `SELECT p.*, (SELECT COUNT(*) FROM product_enquiries e WHERE e.product_id=p.id AND e.status='new') AS open_enquiries
   FROM products p ORDER BY p.active DESC, p.sort, p.id DESC`)));
content.post('/products', async (c) => {
  const b = await c.req.json();
  assert(str(b.name, 100), 400, 'Name is required');
  assert(money(b.price) != null, 400, 'Price is required');
  const max = await first<{ s: number }>(c.env.DB, `SELECT COALESCE(MAX(sort),0)+1 AS s FROM products`);
  const id = await insertRow(c, 'products', { sort: max!.s, ...b }, PRODUCT_FIELDS, { updated_at: nowIso() });
  await audit(c.env, actor(c), 'content.product.create', 'product', id, { name: b.name, price: b.price });
  return c.json({ id });
});
content.patch('/products/:id', async (c) => {
  await patchRow(c, 'products', Number(c.req.param('id')), await c.req.json(), PRODUCT_FIELDS, ['image_key'], true);
  return c.json({ ok: true });
});
content.delete('/products/:id', async (c) => {
  const row = await first<{ image_key: string | null }>(c.env.DB, `DELETE FROM products WHERE id=? RETURNING image_key`, Number(c.req.param('id')));
  assert(row, 404, 'Not found');
  await dropImages(c.env, [row.image_key]);
  return c.json({ ok: true });
});

content.get('/enquiries', async (c) => {
  const status = c.req.query('status');
  return c.json(await all(c.env.DB,
    `SELECT e.*, p.name AS product, p.price, m.name AS member_name, m.essl_id, m.mobile
     FROM product_enquiries e JOIN products p ON p.id=e.product_id JOIN members m ON m.id=e.member_id
     WHERE (?1 IS NULL OR e.status=?1) ORDER BY e.status='new' DESC, e.id DESC LIMIT 200`,
    status && ['new', 'done', 'cancelled'].includes(status) ? status : null));
});
content.patch('/enquiries/:id', async (c) => {
  const s = String((await c.req.json()).status ?? '');
  assert(['new', 'done', 'cancelled'].includes(s), 400, 'Unknown status');
  await run(c.env.DB, `UPDATE product_enquiries SET status=?, handled_by=? WHERE id=?`, s, c.get('session').name, Number(c.req.param('id')));
  return c.json({ ok: true });
});

// ── Gallery ─────────────────────────────────────────────────────────────
const ALBUM_FIELDS: Record<string, Coerce> = { title: text(100), description: text(1000), event_date: date, cover_key: imageKey, published: bool };
content.get('/albums', async (c) => c.json(await all(c.env.DB,
  `SELECT a.*, (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id=a.id) AS photos,
          COALESCE(a.cover_key, (SELECT image_key FROM gallery_photos p WHERE p.album_id=a.id ORDER BY sort, id LIMIT 1)) AS cover
   FROM gallery_albums a ORDER BY COALESCE(a.event_date, substr(a.created_at,1,10)) DESC, a.id DESC`)));
content.post('/albums', async (c) => {
  const b = await c.req.json();
  assert(str(b.title, 100), 400, 'Album title is required');
  return c.json({ id: await insertRow(c, 'gallery_albums', b, ALBUM_FIELDS) });
});
content.patch('/albums/:id', async (c) => {
  await patchRow(c, 'gallery_albums', Number(c.req.param('id')), await c.req.json(), ALBUM_FIELDS, ['cover_key']);
  return c.json({ ok: true });
});
content.delete('/albums/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const keys = await all<{ k: string }>(c.env.DB, `SELECT image_key AS k FROM gallery_photos WHERE album_id=? UNION SELECT cover_key FROM gallery_albums WHERE id=?`, id, id);
  const row = await first(c.env.DB, `DELETE FROM gallery_albums WHERE id=? RETURNING id`, id);
  assert(row, 404, 'Not found');
  await run(c.env.DB, `DELETE FROM gallery_photos WHERE album_id=?`, id); // in case FK enforcement is off
  await dropImages(c.env, keys.map((k) => k.k));
  await audit(c.env, actor(c), 'content.album.delete', 'album', id);
  return c.json({ ok: true });
});
content.get('/albums/:id/photos', async (c) =>
  c.json(await all(c.env.DB, `SELECT * FROM gallery_photos WHERE album_id=? ORDER BY sort, id`, Number(c.req.param('id')))));
/** Body: { keys: string[] } — images already uploaded via PUT /upload. */
content.post('/albums/:id/photos', async (c) => {
  const id = Number(c.req.param('id'));
  assert(await first(c.env.DB, `SELECT id FROM gallery_albums WHERE id=?`, id), 404, 'Album not found');
  const keys = ((await c.req.json()).keys ?? []) as unknown[];
  assert(Array.isArray(keys) && keys.length > 0 && keys.length <= 100, 400, 'Add 1–100 photos at a time');
  const base = (await first<{ s: number }>(c.env.DB, `SELECT COALESCE(MAX(sort),0) AS s FROM gallery_photos WHERE album_id=?`, id))!.s;
  await c.env.DB.batch(keys.map((k, i) => c.env.DB.prepare(`INSERT INTO gallery_photos (album_id, image_key, sort) VALUES (?, ?, ?)`).bind(id, imageKey(k), base + i + 1)));
  return c.json({ ok: true, added: keys.length });
});
content.patch('/photos/:id', async (c) => {
  const b = await c.req.json();
  await run(c.env.DB, `UPDATE gallery_photos SET caption=? WHERE id=?`, str(b.caption, 200), Number(c.req.param('id')));
  return c.json({ ok: true });
});
content.delete('/photos/:id', async (c) => {
  const row = await first<{ image_key: string }>(c.env.DB, `DELETE FROM gallery_photos WHERE id=? RETURNING image_key`, Number(c.req.param('id')));
  assert(row, 404, 'Not found');
  await dropImages(c.env, [row.image_key]);
  return c.json({ ok: true });
});
