// Device worker — the only component that speaks to the eSSL X990 (directly via ADMS, or via the
// gym-PC agent). Admin/member apps never reach this worker; they share state through D1.
import { Hono } from 'hono';
import type { AppEnv, Env } from '../env';
import { adms } from '../device/adms';
import { agentApi } from '../device/agentApi';
import { reconcile, requeueStale } from '../device/queue';

const app = new Hono<AppEnv>();

app.route('/iclock', adms);
app.route('/agent', agentApi);
app.get('/health', (c) => c.json({ ok: true, service: 'challenge-gym-device', time: new Date().toISOString() }));
app.all('*', (c) => c.text('Not found', 404));

app.onError((err, c) => {
  console.error('device-worker error', c.req.method, c.req.path, err);
  // Devices retry aggressively on non-200; answer OK on /iclock so the X990 does not stall.
  if (c.req.path.startsWith('/iclock')) return c.text('OK');
  return c.json({ error: 'internal error' }, 500);
});

export default {
  // eSSL firmware 6.60 (ZMM200) calls /iclock/cdata.aspx, /iclock/getrequest.aspx, ... —
  // strip the ASP.NET-style suffix so both forms hit the same routes.
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/iclock/') && url.pathname.endsWith('.aspx')) {
      url.pathname = url.pathname.slice(0, -5);
      req = new Request(url.toString(), req);
    }
    return app.fetch(req, env, ctx);
  },
  async scheduled(_evt: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil((async () => {
      await requeueStale(env);
      const r = await reconcile(env);
      console.log('reconcile', JSON.stringify(r));
    })());
  },
};
