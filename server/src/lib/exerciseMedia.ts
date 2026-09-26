// Exercise media shared by the admin and member workers.
//   '<Name>/<n>.jpg'   → free-exercise-db photo (public domain), mirrored into R2 on first request
//   'u/<uuid>.<ext>'   → photo / GIF / video uploaded by the gym (admin app)
import type { Env } from '../env';

export const FEDB_RE = /^[\w\-.,'()]+\/\d\.jpg$/;
export const UPLOAD_RE = /^u\/[a-f0-9-]{36}\.(jpg|png|webp|gif|mp4|webm)$/;
export const isImagePath = (p: string) => FEDB_RE.test(p) || (UPLOAD_RE.test(p) && !/\.(mp4|webm)$/.test(p));
export const isVideoUpload = (p: string) => UPLOAD_RE.test(p) && /\.(mp4|webm)$/.test(p);

/** Accepted upload types → file extension and size cap. */
export const UPLOAD_TYPES: Record<string, { ext: string; max: number }> = {
  'image/jpeg': { ext: 'jpg', max: 8_000_000 },
  'image/png': { ext: 'png', max: 8_000_000 },
  'image/webp': { ext: 'webp', max: 8_000_000 },
  'image/gif': { ext: 'gif', max: 15_000_000 },
  'video/mp4': { ext: 'mp4', max: 50_000_000 },
  'video/webm': { ext: 'webm', max: 50_000_000 },
};

export const mediaKey = (path: string) => `exercise-media/${path}`;

/** Serves one exercise media file. Supports Range requests so videos can seek. */
export async function serveExerciseMedia(env: Env, req: Request, path: string, cacheControl: string, waitUntil: (p: Promise<unknown>) => void): Promise<Response> {
  if (FEDB_RE.test(path)) {
    const origin = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/main/exercises/${path.split('/').map(encodeURIComponent).join('/')}`;
    const headers = { 'Content-Type': 'image/jpeg', 'Cache-Control': cacheControl };
    if (!env.FILES) return Response.redirect(origin, 302);
    const hit = await env.FILES.get(mediaKey(path));
    if (hit) return new Response(hit.body, { headers });
    const r = await fetch(origin);
    if (!r.ok) return new Response('Not found', { status: 404 });
    const buf = await r.arrayBuffer();
    waitUntil(env.FILES.put(mediaKey(path), buf, { httpMetadata: { contentType: 'image/jpeg' } }));
    return new Response(buf, { headers });
  }
  if (!UPLOAD_RE.test(path) || !env.FILES) return new Response('Not found', { status: 404 });
  const range = req.headers.get('range');
  let obj: R2ObjectBody | R2Object | null;
  try {
    obj = await env.FILES.get(mediaKey(path), range ? { range: req.headers } : undefined);
  } catch {
    return new Response('Range not satisfiable', { status: 416 });
  }
  if (!obj || !('body' in obj)) return new Response('Not found', { status: 404 });
  const headers = new Headers({
    'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': cacheControl, 'Accept-Ranges': 'bytes', ETag: obj.httpEtag,
  });
  const r = obj.range as { offset?: number; length?: number; suffix?: number } | undefined;
  if (range && r) {
    const offset = r.suffix !== undefined ? obj.size - r.suffix : r.offset ?? 0;
    const length = r.suffix !== undefined ? r.suffix : r.length ?? obj.size - offset;
    headers.set('Content-Range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
    headers.set('Content-Length', String(length));
    return new Response(obj.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(obj.size));
  return new Response(obj.body, { headers });
}
