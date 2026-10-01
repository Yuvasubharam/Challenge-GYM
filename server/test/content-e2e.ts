// Content hub (posts/events/offers, carousel, shop, gallery, bell, phone push) — admin + member.
// Creates and removes its own data; no payments, receipts or device commands.
//   npx tsx test/content-e2e.ts        (admin :8788 and member :8789 workers running)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const ADMIN = 'http://127.0.0.1:8788/api';
const MEMBER = 'http://127.0.0.1:8789/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); }
};
async function call<T = any>(base: string, method: string, path: string, body?: unknown, cookie = ''): Promise<{ status: number; data: T; cookie: string }> {
  const go = () => fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  // The blocking `wrangler d1` calls stall Node long enough for the worker to drop idle keep-alive
  // sockets; a reset on a reused socket means the request never arrived, so one retry is safe.
  const r = await go().catch((e) => { if (e?.cause?.code === 'ECONNRESET') return go(); throw e; });
  const sc = r.headers.get('set-cookie');
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T, cookie: sc ? sc.split(';')[0] : cookie };
}
const upload = async (cookie: string, type = 'image/png') => {
  // 1×1 PNG
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==', 'base64');
  const r = await fetch(`${ADMIN}/content/upload`, { method: 'PUT', headers: { 'Content-Type': type, Cookie: cookie }, body: png });
  return { status: r.status, data: await r.json() as any };
};
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const T = 'E2E·';

console.log('\n── setup');
const clean = () => sql(`DELETE FROM announcements WHERE title LIKE '${T}%'; DELETE FROM banners WHERE title LIKE '${T}%';
  DELETE FROM product_enquiries WHERE product_id IN (SELECT id FROM products WHERE name LIKE '${T}%'); DELETE FROM products WHERE name LIKE '${T}%';
  DELETE FROM gallery_photos WHERE album_id IN (SELECT id FROM gallery_albums WHERE title LIKE '${T}%'); DELETE FROM gallery_albums WHERE title LIKE '${T}%';
  DELETE FROM push_subscriptions WHERE member_id IN (SELECT id FROM members WHERE name='Content Test'); DELETE FROM notice_reads WHERE member_id IN (SELECT id FROM members WHERE name='Content Test');
  DELETE FROM accounts WHERE member_id IN (SELECT id FROM members WHERE name='Content Test'); DELETE FROM members WHERE name='Content Test'`);
clean();
// Fake push service on localhost: captures the request so the VAPID JWT can be verified.
// Subscriptions are written here, not mid-run: CLI writes while the worker is busy can reset it.
let got: { auth: string; ttl: string; len: string } | null = null;
const srv = createServer((req, rs) => { got = { auth: String(req.headers.authorization), ttl: String(req.headers.ttl), len: String(req.headers['content-length']) }; rs.statusCode = 201; rs.end(); });
await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
const port = (srv.address() as any).port;
sql(`INSERT INTO members (name, mobile, essl_id, join_date) VALUES ('Content Test', '9111100009', 'CGT9', '${today}'); DELETE FROM login_attempts;
  INSERT INTO push_subscriptions (member_id, endpoint) SELECT id, 'http://127.0.0.1:${port}/push/1' FROM members WHERE name='Content Test';
  INSERT INTO push_subscriptions (member_id, endpoint) SELECT id, 'http://127.0.0.1:1/dead' FROM members WHERE name='Content Test'`);
const before = sql(`SELECT MIN(id) - 1 AS b FROM push_subscriptions WHERE member_id=(SELECT id FROM members WHERE name='Content Test')`)[0].b;
const admin = (await call(ADMIN, 'POST', '/auth/login', { username: 'owner', password: 'owner-pass-123' })).cookie;
let r = await call(MEMBER, 'POST', '/auth/activate', { mobile: '9111100009', memberId: 'CGT9', password: 'secret1' });
const mc = r.cookie;
check('admin + test member signed in', admin && r.status === 200, r.data);

console.log('\n── images');
let u = await upload(admin);
const k1 = u.data.key;
check('upload stores image under content/', u.status === 200 && /^content\/[0-9a-f-]{36}\.png$/.test(k1), u.data);
check('non-image refused', (await upload(admin, 'text/html')).status === 400);
let res = await fetch(`${ADMIN}/content/img/${k1}`, { headers: { Cookie: admin } });
check('admin serves it with long cache', res.status === 200 && res.headers.get('content-type') === 'image/png' && /immutable/.test(res.headers.get('cache-control') ?? ''));
check('path traversal refused', (await fetch(`${ADMIN}/content/img/photos%2Fmember-1`, { headers: { Cookie: admin } })).status === 404);
check('member upload endpoint does not exist', (await fetch(`${MEMBER}/content/upload`, { method: 'PUT', headers: { 'Content-Type': 'image/png', Cookie: mc }, body: 'x' })).status >= 400);

console.log('\n── posts');
const post = (b: any) => call(ADMIN, 'POST', '/content/posts', b, admin);
r = await post({ kind: 'event', title: `${T}Deadlift day`, body: 'Bring chalk', image_key: k1, event_date: addDays(today, 3), event_time: '6 AM', cta_label: 'Plans', cta_link: '/plan', notify: true, published: true });
const pEvent = r.data.id;
check('event with image + button created', r.status === 200 && pEvent);
check('event needs a date', (await post({ kind: 'event', title: `${T}x` })).status === 400);
check('javascript: links refused', (await post({ title: `${T}x`, cta_link: 'javascript:alert(1)' })).status === 400);
check('foreign image keys refused', (await post({ title: `${T}x`, image_key: 'photos/member-1-1' })).status === 400);
const pOld = (await post({ kind: 'offer', title: `${T}Old offer`, expires_on: addDays(today, -1), notify: true })).data.id;
const pHidden = (await post({ title: `${T}Hidden`, published: false, notify: true })).data.id;
const pPast = (await post({ kind: 'event', title: `${T}Past event`, event_date: addDays(today, -2) })).data.id;
const pNote = (await post({ kind: 'notice', title: `${T}Closed Sunday`, pinned: true, notify: true })).data.id;
r = await call(ADMIN, 'PATCH', `/content/posts/${pNote}`, { body: 'Diwali holiday' }, admin);
check('post edited', r.status === 200 && sql(`SELECT body FROM announcements WHERE id=${pNote}`)[0].body === 'Diwali holiday');

console.log('\n── carousel');
const b1 = (await call(ADMIN, 'POST', '/content/banners', { title: `${T}Slide A`, image_key: k1, cta_link: '/shop' }, admin)).data.id;
const b2 = (await call(ADMIN, 'POST', '/content/banners', { title: `${T}Slide B` }, admin)).data.id;
const b3 = (await call(ADMIN, 'POST', '/content/banners', { title: `${T}Ended`, ends_on: addDays(today, -1) }, admin)).data.id;
const b4 = (await call(ADMIN, 'POST', '/content/banners', { title: `${T}Future`, starts_on: addDays(today, 5) }, admin)).data.id;
const allB = ((await call(ADMIN, 'GET', '/content/banners', undefined, admin)).data as any[]).map((b) => b.id);
const order = [b2, b1, ...allB.filter((x) => x !== b1 && x !== b2)];
r = await call(ADMIN, 'POST', '/content/banners/order', { ids: order }, admin);
check('reorder saved', r.status === 200 && sql(`SELECT sort FROM banners WHERE id=${b2}`)[0].sort === 1);

console.log('\n── shop');
u = await upload(admin);
const k2 = u.data.key;
const pr1 = (await call(ADMIN, 'POST', '/content/products', { name: `${T}Whey 1kg`, price: 2499, mrp: 2999, image_key: k2, featured: true, category: 'Supplements' }, admin)).data.id;
const pr2 = (await call(ADMIN, 'POST', '/content/products', { name: `${T}Retired`, price: 10, active: false }, admin)).data.id;
check('price required', (await call(ADMIN, 'POST', '/content/products', { name: `${T}x` }, admin)).status === 400);
check('negative price refused', (await call(ADMIN, 'POST', '/content/products', { name: `${T}x`, price: -5 }, admin)).status === 400);

console.log('\n── gallery');
const al = (await call(ADMIN, 'POST', '/content/albums', { title: `${T}Meet 2026`, event_date: today }, admin)).data.id;
const alEmpty = (await call(ADMIN, 'POST', '/content/albums', { title: `${T}Empty album` }, admin)).data.id;
const k3 = (await upload(admin)).data.key, k4 = (await upload(admin)).data.key;
r = await call(ADMIN, 'POST', `/content/albums/${al}/photos`, { keys: [k3, k4] }, admin);
check('2 photos added', r.data.added === 2);
check('bad key in batch refused', (await call(ADMIN, 'POST', `/content/albums/${al}/photos`, { keys: ['../x'] }, admin)).status === 400);
r = await call(ADMIN, 'GET', '/content/summary', undefined, admin);
check('summary counts', r.data.banners >= 2 && r.data.products >= 1 && r.data.push_ready === true, r.data);

console.log('\n── member home');
r = await call(MEMBER, 'GET', '/content/home', undefined, mc);
const h = r.data;
const bIds = h.banners.map((b: any) => b.id);
check('carousel: live slides in admin order', bIds.indexOf(b2) >= 0 && bIds.indexOf(b2) < bIds.indexOf(b1), bIds);
check('carousel: ended + future slides hidden', !bIds.includes(b3) && !bIds.includes(b4));
const postIds = h.posts.map((p: any) => p.id);
check('posts: upcoming event + notice shown', postIds.includes(pEvent) && postIds.includes(pNote));
check('posts: expired, hidden, past event not shown', !postIds.includes(pOld) && !postIds.includes(pHidden) && !postIds.includes(pPast), postIds);
check('pinned notice first', h.posts[0].pinned === 1);
check('shop: featured product shown, inactive hidden', h.products.some((p: any) => p.id === pr1) && !h.products.some((p: any) => p.id === pr2));
check('gallery: album with photos shown, empty album hidden', h.albums.some((a: any) => a.id === al && a.photos === 2 && a.cover === k3) && !h.albums.some((a: any) => a.id === alEmpty));
check('bell has unread (visible notify posts only)', h.unread >= 2, h.unread);
res = await fetch(`${MEMBER}/content/img/${k1}`, { headers: { Cookie: mc } });
check('member can load content images', res.status === 200);
check('…but not member photos via that route', (await fetch(`${MEMBER}/content/img/photos/member-1-1`, { headers: { Cookie: mc } })).status === 404);
check('signed-out users get nothing', (await call(MEMBER, 'GET', '/content/home')).status === 401);
r = await call(MEMBER, 'GET', '/content/posts?kind=event', undefined, mc);
check('events filter', r.data.every((p: any) => p.kind === 'event') && r.data.some((p: any) => p.id === pEvent));
check('hidden post not readable', (await call(MEMBER, 'GET', `/content/posts/${pHidden}`, undefined, mc)).status === 404);
r = await call(MEMBER, 'GET', `/content/albums/${al}`, undefined, mc);
check('album photos in order', r.data.photos.map((p: any) => p.image_key).join() === [k3, k4].join());

console.log('\n── shop reservations');
r = await call(MEMBER, 'POST', `/content/products/${pr1}/enquire`, { qty: 2, note: 'chocolate' }, mc);
check('member reserves', r.status === 200 && !r.data.updated);
r = await call(MEMBER, 'POST', `/content/products/${pr1}/enquire`, { qty: 3 }, mc);
check('second tap updates, not duplicates', r.data.updated && sql(`SELECT COUNT(*) AS n FROM product_enquiries WHERE product_id=${pr1}`)[0].n === 1);
check('inactive product cannot be reserved', (await call(MEMBER, 'POST', `/content/products/${pr2}/enquire`, { qty: 1 }, mc)).status === 404);
r = await call(ADMIN, 'GET', '/content/enquiries?status=new', undefined, admin);
const enq = r.data.find((e: any) => e.product === `${T}Whey 1kg`);
check('desk sees it with member + qty', enq && enq.member_name === 'Content Test' && enq.qty === 3 && enq.mobile === '9111100009', enq);
r = await call(ADMIN, 'PATCH', `/content/enquiries/${enq.id}`, { status: 'done' }, admin);
check('desk marks handed over', r.status === 200 && (await call(MEMBER, 'GET', '/content/enquiries', undefined, mc)).data[0].status === 'done');

console.log('\n── bell');
r = await call(MEMBER, 'GET', '/content/notifications', undefined, mc);
check('feed lists visible notify posts only', r.data.items.some((p: any) => p.id === pEvent) && !r.data.items.some((p: any) => p.id === pHidden));
await call(MEMBER, 'POST', '/content/notifications/seen', { id: r.data.items[0].id }, mc);
check('marking seen clears the badge', (await call(MEMBER, 'GET', '/content/home', undefined, mc)).data.unread === 0);
await call(MEMBER, 'POST', '/content/notifications/seen', { id: 1 }, mc);
check('seen marker never goes backwards', (await call(MEMBER, 'GET', '/content/home', undefined, mc)).data.unread === 0);

console.log('\n── phone push (VAPID)');
r = await call(MEMBER, 'GET', '/content/push/key', undefined, mc);
const vapidPub = r.data.key as string;
check('member app gets the public key', typeof vapidPub === 'string' && vapidPub.length === 87);
check('non-https endpoint refused', (await call(MEMBER, 'POST', '/content/push/subscribe', { endpoint: 'http://evil/x' }, mc)).status === 400);
r = await call(MEMBER, 'POST', '/content/push/subscribe', { endpoint: 'https://push.example.invalid/sub/abc123' }, mc);
check('subscribe ok', r.status === 200);
r = await call(MEMBER, 'POST', '/content/push/unsubscribe', { endpoint: 'https://push.example.invalid/sub/abc123' }, mc);
check('unsubscribe ok', r.status === 200);
check('hidden post cannot be pushed', (await call(ADMIN, 'POST', `/content/posts/${pHidden}/push`, { after: 0 }, admin)).status === 400);
r = await call(ADMIN, 'POST', `/content/posts/${pEvent}/push`, { after: before }, admin);
srv.close();
check('batch reports 1 sent / 1 failed', r.data.sent === 1 && r.data.failed === 1, r.data);
const g = got as { auth: string; ttl: string; len: string } | null;
check('push is payload-less with TTL', g?.len === '0' && g?.ttl === '86400', g);
const m = /^vapid t=([^,]+), k=(.+)$/.exec(g?.auth ?? '');
check('Authorization: vapid t=…, k=<public key>', m && m[2] === vapidPub, g?.auth);
if (m) {
  const [hd, bd, sg] = m[1].split('.');
  const claims = JSON.parse(Buffer.from(bd, 'base64url').toString());
  check('JWT aud = push origin, exp ≤ 24h, sub mailto', claims.aud === `http://127.0.0.1:${port}` && claims.exp - Date.now() / 1000 <= 86400 && /^mailto:/.test(claims.sub), claims);
  const key = await crypto.subtle.importKey('raw', Buffer.from(vapidPub, 'base64url'), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(sg, 'base64url'), new TextEncoder().encode(`${hd}.${bd}`));
  check('JWT ES256 signature verifies with the public key', ok);
  const priv = /^VAPID_PUBLIC=(.+)$/m.exec(readFileSync('.dev.vars', 'utf8'))?.[1]?.trim();
  check('public key matches .dev.vars', priv === vapidPub);
}
check('post marked as pushed', !!sql(`SELECT pushed_at FROM announcements WHERE id=${pEvent}`)[0].pushed_at);
r = await call(MEMBER, 'GET', '/content/notifications/latest', undefined, mc);
check('service worker fetch returns the pushed post', r.data?.id === pEvent && r.data.cta_link === '/plan',
  { got: r.data, rows: sql(`SELECT id, notify, published, pushed_at FROM announcements WHERE title LIKE '${T}%'`) });

console.log('\n── deletes clean up R2');
check('DELETE with JSON works', (await call(ADMIN, 'DELETE', `/content/posts/${pOld}`, {}, admin)).status === 200);
await call(ADMIN, 'DELETE', `/content/posts/${pEvent}`, {}, admin);
check('image still used by slide → kept', (await fetch(`${ADMIN}/content/img/${k1}`, { headers: { Cookie: admin } })).status === 200);
await call(ADMIN, 'DELETE', `/content/banners/${b1}`, {}, admin);
check('last reference gone → image deleted from R2', (await fetch(`${ADMIN}/content/img/${k1}`, { headers: { Cookie: admin } })).status === 404);
r = await call(ADMIN, 'PATCH', `/content/products/${pr1}`, { image_key: null }, admin);
check('replacing/removing product image deletes old file', (await fetch(`${ADMIN}/content/img/${k2}`, { headers: { Cookie: admin } })).status === 404);
await call(ADMIN, 'DELETE', `/content/albums/${al}`, {}, admin);
check('album delete removes photos + files', sql(`SELECT COUNT(*) AS n FROM gallery_photos WHERE album_id=${al}`)[0].n === 0
  && (await fetch(`${ADMIN}/content/img/${k3}`, { headers: { Cookie: admin } })).status === 404);
for (const id of [pHidden, pPast, pNote]) await call(ADMIN, 'DELETE', `/content/posts/${id}`, {}, admin);
for (const id of [b2, b3, b4]) await call(ADMIN, 'DELETE', `/content/banners/${id}`, {}, admin);
for (const id of [pr1, pr2]) await call(ADMIN, 'DELETE', `/content/products/${id}`, {}, admin);
await call(ADMIN, 'DELETE', `/content/albums/${alEmpty}`, {}, admin);
await fetch(`${ADMIN}/content/img/${k4}`, { headers: { Cookie: admin } }).then((x) => check('all test images gone', x.status === 404));
clean();
check('no test rows left', sql(`SELECT (SELECT COUNT(*) FROM announcements WHERE title LIKE '${T}%') + (SELECT COUNT(*) FROM members WHERE name='Content Test') AS n`)[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
