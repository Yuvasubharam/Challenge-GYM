// Member photos. Both apps shrink and crop the picture in the browser (512 px square WebP, ~20–40 KB)
// before upload, so the API only accepts those small files. iPhone Safari cannot encode WebP from a
// canvas, so a JPEG of the same size is accepted too.
import type { Env } from '../env';
import { assert, first, nowIso, run } from './db';

const TYPES: Record<string, string> = { 'image/webp': 'webp', 'image/jpeg': 'jpg' };
const MAX_BYTES = 400_000;

export async function storeMemberPhoto(env: Env, memberId: number, req: Request): Promise<string> {
  assert(env.FILES, 503, 'Uploads are not available right now');
  const type = (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  assert(TYPES[type], 400, 'Photo must be a WebP or JPEG image — please update the app and try again');
  const buf = await req.arrayBuffer();
  assert(buf.byteLength > 0 && buf.byteLength <= MAX_BYTES, 413, 'Photo is too large — please update the app and try again');
  const old = await first<{ photo_key: string | null }>(env.DB, `SELECT photo_key FROM members WHERE id=?`, memberId);
  assert(old, 404, 'Member not found');
  const key = `photos/member-${memberId}-${Date.now()}.${TYPES[type]}`;
  await env.FILES!.put(key, buf, { httpMetadata: { contentType: type, cacheControl: 'private, max-age=31536000, immutable' } });
  await run(env.DB, `UPDATE members SET photo_key=?, updated_at=? WHERE id=?`, key, nowIso(), memberId);
  if (old.photo_key) await env.FILES!.delete(old.photo_key);
  return key;
}
