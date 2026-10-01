// Temporary: send every page visit on challengegym.in / www to /launch until the launch moment.
// After the cutoff it is a pure pass-through; remove the worker (and its routes) once it has passed.
const CUTOFF = Date.parse('2026-10-02T09:09:00+05:30'); // 09:09 AM IST

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
};
