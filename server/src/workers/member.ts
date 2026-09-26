// Member API worker — serves only the member app (via its Pages service binding).
// Own JWT secret + cookie + `aud: member`: a member session is useless against the admin API.
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { HttpError } from '../lib/db';
import { memberAuth } from '../routes/member/auth';
import { me } from '../routes/member/me';
import { fit } from '../routes/member/fitness';
import { memberContent } from '../routes/member/content';

const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  // Personal data is never cached; exercise photos set their own long cache header.
  if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
});

// CSRF: state-changing requests must be JSON, except raw image uploads.
app.use('*', async (c, next) => {
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
    const ct = c.req.header('content-type') ?? '';
    const isUpload = c.req.method === 'PUT' && /\/me\/(proof|photo)$/.test(c.req.path);
    if (!isUpload && !ct.includes('application/json')) return c.json({ error: 'Expected JSON' }, 415);
  }
  await next();
});

app.get('/health', (c) => c.json({ ok: true, service: 'challenge-gym-member' }));
app.route('/auth', memberAuth);
app.route('/me', me);
app.route('/fit', fit);
app.route('/content', memberContent);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid request' }, 400);
  console.error('member-api error', c.req.method, c.req.path, err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default app;
