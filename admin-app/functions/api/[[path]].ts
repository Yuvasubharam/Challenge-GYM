// Cloudflare Pages Function: forwards /api/* to the admin API worker through a service
// binding (private — the admin worker has no public URL). Keeps cookies same-origin.
interface Env { ADMIN_API: { fetch: (req: Request) => Promise<Response> } }

export const onRequest = async (ctx: { request: Request; env: Env }) => ctx.env.ADMIN_API.fetch(ctx.request);
