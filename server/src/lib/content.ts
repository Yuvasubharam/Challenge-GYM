// Shared helpers for gym content (posts, carousel, shop, gallery) and phone push.
import type { Env } from '../env';
import { all, assert, run } from './db';

// ── Images in R2 ────────────────────────────────────────────────────────
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
export const CONTENT_KEY_RE = /^content\/[0-9a-f-]{36}\.(jpg|png|webp|gif)$/;
const MAX_IMAGE = 4_000_000;

export async function storeContentImage(env: Env, req: Request): Promise<string> {
  assert(env.FILES, 503, 'File storage is not configured');
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  const ext = IMAGE_TYPES[type];
  assert(ext, 400, 'Upload a JPEG, PNG, WebP or GIF image');
  assert(Number(req.headers.get('content-length') ?? 0) <= MAX_IMAGE, 413, 'Image must be under 4 MB');
  const buf = await req.arrayBuffer();
  assert(buf.byteLength > 0 && buf.byteLength <= MAX_IMAGE, 413, 'Image must be under 4 MB');
  const key = `content/${crypto.randomUUID()}.${ext}`;
  await env.FILES!.put(key, buf, { httpMetadata: { contentType: type } });
  return key;
}

/** Keys are random UUIDs and never reused, so they can be cached for a long time. */
export async function serveContentImage(env: Env, key: string): Promise<Response> {
  if (!CONTENT_KEY_RE.test(key) || !env.FILES) return new Response('Not found', { status: 404 });
  const obj = await env.FILES.get(key);
  if (!obj) return new Response('Not found', { status: 404 });
  return new Response(obj.body, {
    headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'private, max-age=2592000, immutable', ETag: obj.httpEtag },
  });
}

/** Accept only keys produced by storeContentImage (or null to clear). */
export const imageKey = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  if (v === null || v === '') return null;
  assert(typeof v === 'string' && CONTENT_KEY_RE.test(v), 400, 'Invalid image');
  return v;
};

/** Delete R2 objects no row references any more (best effort). */
export async function dropImages(env: Env, keys: (string | null | undefined)[]) {
  const list = keys.filter((k): k is string => !!k && CONTENT_KEY_RE.test(k));
  if (!env.FILES || !list.length) return;
  const still = new Set<string>();
  for (const k of list) {
    const r = await all<{ n: number }>(env.DB,
      `SELECT (SELECT COUNT(*) FROM announcements WHERE image_key=?1) + (SELECT COUNT(*) FROM banners WHERE image_key=?1)
            + (SELECT COUNT(*) FROM products WHERE image_key=?1) + (SELECT COUNT(*) FROM gallery_photos WHERE image_key=?1)
            + (SELECT COUNT(*) FROM gallery_albums WHERE cover_key=?1) AS n`, k);
    if ((r[0]?.n ?? 0) > 0) still.add(k);
  }
  const gone = list.filter((k) => !still.has(k));
  if (gone.length) await env.FILES.delete(gone);
}

/** In-app path (/shop, /plan …) or an https URL; anything else is rejected. */
export const ctaLink = (v: unknown): string | null | undefined => {
  if (v === undefined) return undefined;
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  assert(/^\/[\w\-/?=&#.]*$/.test(s) || /^https:\/\/[^\s]{3,300}$/.test(s), 400, 'Link must be an app page like /shop or an https:// URL');
  return s.slice(0, 300);
};

// ── Web push (VAPID, payload-less) ──────────────────────────────────────
// The push carries no data, so no payload encryption is needed: the service worker
// wakes up and fetches the latest notification from the member API itself.
const b64u = {
  enc: (b: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0)),
};

export const pushConfigured = (env: Env) => !!(env.VAPID_PUBLIC && env.VAPID_PRIVATE);

let keyCache: { pub: string; key: CryptoKey } | null = null;
async function vapidKey(env: Env): Promise<CryptoKey> {
  const hit = keyCache;
  if (hit && hit.pub === env.VAPID_PUBLIC) return hit.key;
  const raw = b64u.dec(env.VAPID_PUBLIC!);
  assert(raw.length === 65 && raw[0] === 4, 500, 'VAPID_PUBLIC is not a P-256 public key');
  const key = await crypto.subtle.importKey('jwk',
    { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE, x: b64u.enc(raw.slice(1, 33)), y: b64u.enc(raw.slice(33, 65)), ext: true },
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  keyCache = { pub: env.VAPID_PUBLIC!, key };
  return keyCache.key;
}

async function vapidJwt(env: Env, audience: string): Promise<string> {
  const enc = new TextEncoder();
  const head = b64u.enc(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u.enc(enc.encode(JSON.stringify({ aud: audience, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:admin@challengegym.in' })));
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, await vapidKey(env), enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64u.enc(sig)}`;
}

/** Wake up to `limit` subscriptions with id > after. Returns progress for client-driven batching. */
export async function pushBatch(env: Env, after: number, limit = 40): Promise<{ sent: number; failed: number; removed: number; next: number | null; total: number }> {
  assert(pushConfigured(env), 503, 'Phone notifications are not set up (VAPID keys missing)');
  const subs = await all<{ id: number; endpoint: string }>(env.DB, `SELECT id, endpoint FROM push_subscriptions WHERE id > ? ORDER BY id LIMIT ?`, after, limit);
  const total = (await all<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM push_subscriptions`))[0]?.n ?? 0;
  const jwts = new Map<string, string>();
  let sent = 0, failed = 0, removed = 0;
  await Promise.all(subs.map(async (s) => {
    try {
      const aud = new URL(s.endpoint).origin;
      if (!jwts.has(aud)) jwts.set(aud, await vapidJwt(env, aud));
      const res = await fetch(s.endpoint, {
        method: 'POST',
        headers: { Authorization: `vapid t=${jwts.get(aud)}, k=${env.VAPID_PUBLIC}`, TTL: '86400', Urgency: 'normal', 'Content-Length': '0' },
      });
      if (res.status === 404 || res.status === 410) {
        await run(env.DB, `DELETE FROM push_subscriptions WHERE id=?`, s.id); removed++;
      } else if (res.ok) {
        await run(env.DB, `UPDATE push_subscriptions SET last_ok_at=?, fail_count=0 WHERE id=?`, new Date().toISOString(), s.id); sent++;
      } else {
        await run(env.DB, `UPDATE push_subscriptions SET fail_count=fail_count+1 WHERE id=?`, s.id); failed++;
      }
    } catch {
      failed++;
    }
  }));
  await run(env.DB, `DELETE FROM push_subscriptions WHERE fail_count >= 5`);
  return { sent, failed, removed, next: subs.length === limit ? subs[subs.length - 1].id : null, total };
}
