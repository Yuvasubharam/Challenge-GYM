// Admin API worker — serves only the admin app (bound to it via a Pages service binding).
// Device actions are written to D1 as intents; the device worker executes them.
import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { HttpError } from '../lib/db';
import { renewalCron } from '../lib/renewalPush';
import { weightCron } from '../lib/weightPush';
import { bumpAdminVersion } from '../lib/viewCache';
import { auth } from '../routes/admin/auth';
import { members } from '../routes/admin/members';
import { ops } from '../routes/admin/ops';
import { device } from '../routes/admin/device';
import { importer } from '../routes/admin/importer';
import { foods } from '../routes/admin/foods';
import { fitnessAdmin } from '../routes/admin/fitness';
import { coupons } from '../routes/admin/coupons';
import { content } from '../routes/admin/content';

const app = new Hono<AppEnv>().basePath('/api');

// Same-origin only: the admin app reaches this worker through its Pages proxy.
app.use('*', async (c, next) => {
  await next();
  if (!c.res.headers.get('Cache-Control')) c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('Referrer-Policy', 'same-origin');
});

// Any successful change made in the admin app clears the cached list/dashboard views everywhere.
app.use('*', async (c, next) => {
  await next();
  const m = c.req.method;
  // Awaited (not waitUntil) so the admin's very next page load already sees the new version.
  if (m !== 'GET' && m !== 'HEAD' && c.res.status < 400 && !c.req.path.startsWith('/api/auth/')) await bumpAdminVersion(c.env);
});

// CSRF: state-changing requests must be JSON (browsers cannot send that cross-site without CORS).
app.use('*', async (c, next) => {
  const m = c.req.method;
  if (m !== 'GET' && m !== 'HEAD') {
    const ct = c.req.header('content-type') ?? '';
    const isUpload = m === 'PUT' && /\/(photo|fitness\/media|content\/upload)$/.test(c.req.path);
    if (!isUpload && !ct.includes('application/json')) return c.json({ error: 'Expected JSON' }, 415);
  }
  await next();
});

// Public routes must be registered before `ops`, whose auth middleware is mounted at '/'.
app.get('/health', (c) => c.json({ ok: true, service: 'challenge-gym-admin' }));
app.route('/auth', auth);
app.route('/members', members);
app.route('/device', device);
app.route('/import', importer);
app.route('/foods', foods);
app.route('/fitness', fitnessAdmin);
app.route('/coupons', coupons);
app.route('/content', content);
app.route('/', ops);

app.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status as 400);
  if (err instanceof SyntaxError) return c.json({ error: 'Invalid request body' }, 400);
  console.error('admin-api error', c.req.method, c.req.path, err);
  return c.json({ error: 'Something went wrong. Please try again.' }, 500);
});
app.notFound((c) => c.json({ error: 'Not found' }, 404));

export default {
  fetch: app.fetch,
  // Hourly: the daily renewal reminder goes out on the first run at/after the configured hour,
  // the weekly weigh-in reminder on the configured weekday. Runs here because only this worker
  // holds the VAPID private key.
  async scheduled(_evt: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(renewalCron(env).then((r) => console.log('renewal-push', JSON.stringify(r))));
    ctx.waitUntil(weightCron(env).then((r) => console.log('weight-push', JSON.stringify(r))));
  },
};
