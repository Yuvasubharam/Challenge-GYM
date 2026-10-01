// Member-facing gym content: home carousel, posts/events, shop, gallery, notifications, push.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { tzOffset } from '../../env';
import { requireMember } from '../../lib/auth';
import { all, assert, first, int, run, str } from '../../lib/db';
import { today as todayOf } from '../../lib/dates';
import { serveContentImage } from '../../lib/content';
import { reminderFor } from '../../lib/renewalPush';

export const memberContent = new Hono<AppEnv>();
memberContent.use('*', requireMember());

const mid = (c: { get: (k: 'session') => { mid: number | null } }) => c.get('session').mid!;
const POST_COLS = `id, kind, title, body, image_key, event_date, event_time, cta_label, cta_link, pinned, notify, created_at`;
// Visible = published, not past its expiry, and (for events) not already over.
const VISIBLE = `published=1 AND (expires_on IS NULL OR expires_on >= ?1) AND (kind <> 'event' OR event_date IS NULL OR event_date >= ?1)`;

memberContent.get('/img/*', (c) => serveContentImage(c.env, c.req.path.replace(/^.*\/img\//, '')));

memberContent.get('/home', async (c) => {
  const t = todayOf(tzOffset(c.env));
  const [banners, posts, products, albums, unread] = await Promise.all([
    all(c.env.DB, `SELECT id, title, subtitle, image_key, cta_label, cta_link FROM banners
                   WHERE active=1 AND (starts_on IS NULL OR starts_on <= ?1) AND (ends_on IS NULL OR ends_on >= ?1) ORDER BY sort, id DESC LIMIT 10`, t),
    all(c.env.DB, `SELECT ${POST_COLS} FROM announcements WHERE ${VISIBLE}
                   ORDER BY pinned DESC, CASE WHEN kind='event' THEN event_date END, id DESC LIMIT 12`, t),
    all(c.env.DB, `SELECT id, name, category, price, mrp, image_key, in_stock FROM products WHERE active=1
                   ORDER BY featured DESC, sort, id DESC LIMIT 10`),
    all(c.env.DB, `SELECT a.id, a.title, a.event_date,
                     COALESCE(a.cover_key, (SELECT image_key FROM gallery_photos p WHERE p.album_id=a.id ORDER BY sort, id LIMIT 1)) AS cover,
                     (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id=a.id) AS photos
                   FROM gallery_albums a WHERE a.published=1 AND EXISTS (SELECT 1 FROM gallery_photos p WHERE p.album_id=a.id)
                   ORDER BY COALESCE(a.event_date, substr(a.created_at,1,10)) DESC, a.id DESC LIMIT 8`),
    unreadCount(c.env.DB, mid(c)),
  ]);
  return c.json({ banners, posts, products, albums, unread });
});

memberContent.get('/posts', async (c) => {
  const t = todayOf(tzOffset(c.env));
  const kind = c.req.query('kind');
  return c.json(await all(c.env.DB,
    `SELECT ${POST_COLS} FROM announcements WHERE ${VISIBLE} AND (?2 IS NULL OR kind=?2) ORDER BY pinned DESC, id DESC LIMIT 60`,
    t, kind && ['notice', 'event', 'offer'].includes(kind) ? kind : null));
});

memberContent.get('/posts/:id', async (c) => {
  const p = await first(c.env.DB, `SELECT ${POST_COLS} FROM announcements WHERE id=? AND published=1`, Number(c.req.param('id')));
  assert(p, 404, 'This post is no longer available');
  return c.json(p);
});

// ── Shop ────────────────────────────────────────────────────────────────
memberContent.get('/products', async (c) => c.json(await all(c.env.DB,
  `SELECT id, name, description, category, price, mrp, image_key, in_stock, featured FROM products WHERE active=1 ORDER BY featured DESC, sort, id DESC`)));

memberContent.post('/products/:id/enquire', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const p = await first<{ in_stock: number }>(c.env.DB, `SELECT in_stock FROM products WHERE id=? AND active=1`, id);
  assert(p, 404, 'Product not found');
  const qty = Math.min(20, Math.max(1, int(b.qty) ?? 1));
  const open = await first(c.env.DB, `SELECT id FROM product_enquiries WHERE product_id=? AND member_id=? AND status='new'`, id, mid(c));
  if (open) {
    await run(c.env.DB, `UPDATE product_enquiries SET qty=?, note=? WHERE id=?`, qty, str(b.note, 300), (open as { id: number }).id);
  } else {
    await run(c.env.DB, `INSERT INTO product_enquiries (product_id, member_id, qty, note) VALUES (?, ?, ?, ?)`, id, mid(c), qty, str(b.note, 300));
  }
  return c.json({ ok: true, updated: !!open });
});

memberContent.get('/enquiries', async (c) => c.json(await all(c.env.DB,
  `SELECT e.id, e.qty, e.status, e.created_at, p.id AS product_id, p.name, p.price, p.image_key
   FROM product_enquiries e JOIN products p ON p.id=e.product_id WHERE e.member_id=? ORDER BY e.id DESC LIMIT 30`, mid(c))));

memberContent.post('/enquiries/:id/cancel', async (c) => {
  await run(c.env.DB, `UPDATE product_enquiries SET status='cancelled' WHERE id=? AND member_id=? AND status='new'`, Number(c.req.param('id')), mid(c));
  return c.json({ ok: true });
});

// ── Gallery ─────────────────────────────────────────────────────────────
memberContent.get('/albums', async (c) => c.json(await all(c.env.DB,
  `SELECT a.id, a.title, a.description, a.event_date,
     COALESCE(a.cover_key, (SELECT image_key FROM gallery_photos p WHERE p.album_id=a.id ORDER BY sort, id LIMIT 1)) AS cover,
     (SELECT COUNT(*) FROM gallery_photos p WHERE p.album_id=a.id) AS photos
   FROM gallery_albums a WHERE a.published=1 AND EXISTS (SELECT 1 FROM gallery_photos p WHERE p.album_id=a.id)
   ORDER BY COALESCE(a.event_date, substr(a.created_at,1,10)) DESC, a.id DESC`)));

memberContent.get('/albums/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const album = await first(c.env.DB, `SELECT id, title, description, event_date FROM gallery_albums WHERE id=? AND published=1`, id);
  assert(album, 404, 'Album not found');
  const photos = await all(c.env.DB, `SELECT id, image_key, caption FROM gallery_photos WHERE album_id=? ORDER BY sort, id`, id);
  return c.json({ album, photos });
});

// ── Notifications (bell) ────────────────────────────────────────────────
async function unreadCount(db: D1Database, member: number) {
  const r = await first<{ n: number }>(db,
    `SELECT COUNT(*) AS n FROM announcements WHERE published=1 AND notify=1
       AND id > COALESCE((SELECT last_seen_id FROM notice_reads WHERE member_id=?), 0)`, member);
  return r?.n ?? 0;
}

memberContent.get('/notifications', async (c) => {
  const seen = await first<{ last_seen_id: number }>(c.env.DB, `SELECT last_seen_id FROM notice_reads WHERE member_id=?`, mid(c));
  const items = await all(c.env.DB, `SELECT ${POST_COLS} FROM announcements WHERE published=1 AND notify=1 ORDER BY id DESC LIMIT 40`);
  return c.json({ items, last_seen_id: seen?.last_seen_id ?? 0 });
});

memberContent.post('/notifications/seen', async (c) => {
  const id = int((await c.req.json()).id) ?? 0;
  await run(c.env.DB, `INSERT INTO notice_reads (member_id, last_seen_id) VALUES (?, ?)
                       ON CONFLICT(member_id) DO UPDATE SET last_seen_id=MAX(last_seen_id, excluded.last_seen_id)`, mid(c), id);
  return c.json({ ok: true });
});

/**
 * Read by the service worker when a (payload-less) push arrives: the newest thing pushed to this
 * member — their own renewal reminder if it was sent after the latest announcement push.
 */
memberContent.get('/notifications/latest', async (c) => {
  const p = await first<Record<string, unknown> & { pushed_at: string | null }>(c.env.DB,
    `SELECT id, kind, title, body, image_key, cta_link, pushed_at FROM announcements WHERE published=1 AND notify=1 ORDER BY pushed_at IS NULL, pushed_at DESC, id DESC LIMIT 1`);
  const reminder = await reminderFor(c.env, mid(c), p?.pushed_at ?? null);
  return c.json(reminder ?? p ?? null);
});

// ── Phone push subscriptions ────────────────────────────────────────────
memberContent.get('/push/key', (c) => c.json({ key: c.env.VAPID_PUBLIC ?? null }));

memberContent.post('/push/subscribe', async (c) => {
  const endpoint = String((await c.req.json()).endpoint ?? '');
  assert(/^https:\/\/[^\s]{10,800}$/.test(endpoint), 400, 'Invalid subscription');
  await run(c.env.DB, `INSERT INTO push_subscriptions (member_id, endpoint) VALUES (?, ?)
                       ON CONFLICT(endpoint) DO UPDATE SET member_id=excluded.member_id, fail_count=0`, mid(c), endpoint);
  return c.json({ ok: true });
});

memberContent.post('/push/unsubscribe', async (c) => {
  const endpoint = String((await c.req.json()).endpoint ?? '');
  await run(c.env.DB, `DELETE FROM push_subscriptions WHERE endpoint=? AND member_id=?`, endpoint, mid(c));
  return c.json({ ok: true });
});
