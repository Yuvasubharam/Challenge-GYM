// Temporary: send every page visit on challengegym.in / www to /launch until the launch moment.
// After the cutoff it is a pure pass-through, and the cron below removes its routes and then the worker itself
// (needs the CF_API_TOKEN secret: a Cloudflare token from the "Edit Cloudflare Workers" template).
const CUTOFF = Date.parse('2026-10-02T09:09:00+05:30'); // 09:09 AM IST
const ACCOUNT_ID = 'c833d4e17d8a22d81d27bfee17492127';
const SCRIPT = 'challenge-gym-launch-redirect';

async function cf(env, method, path) {
  const res = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.CF_API_TOKEN}` },
  });
  const body = await res.json();
  if (!body.success) throw new Error(`${method} ${path}: ${JSON.stringify(body.errors)}`);
  return body.result;
}

async function selfDestruct(env) {
  // The token has Workers Routes:Edit but not Zone:Read, so the zone id comes from wrangler.toml [vars].
  const zoneId = env.ZONE_ID;
  const routes = await cf(env, 'GET', `/zones/${zoneId}/workers/routes`);
  for (const r of routes.filter((r) => r.script === SCRIPT)) {
    await cf(env, 'DELETE', `/zones/${zoneId}/workers/routes/${r.id}`);
    console.log(`deleted route ${r.pattern}`);
  }
  await cf(env, 'DELETE', `/accounts/${ACCOUNT_ID}/workers/scripts/${SCRIPT}?force=true`);
  console.log('deleted worker');
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const isPage = request.method === 'GET'
      && !url.pathname.startsWith('/api/')
      && !url.pathname.startsWith('/launch')
      && !/\.[a-z0-9]+$/i.test(url.pathname); // leave assets, icons, manifest, sw.js alone
    if (Date.now() < CUTOFF && isPage) {
      return new Response(null, {
        status: 302,
        headers: { Location: `${url.origin}/launch`, 'Cache-Control': 'no-store' },
      });
    }
    return fetch(request);
  },

  async scheduled(_event, env, ctx) {
    if (Date.now() < CUTOFF) return;
    ctx.waitUntil(selfDestruct(env));
  },
};
