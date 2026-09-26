// Cloudflare Pages Function: forwards /api/* to the member API worker via a private service binding.
interface Env { MEMBER_API: { fetch: (req: Request) => Promise<Response> } }

export const onRequest = async (ctx: { request: Request; env: Env }) => ctx.env.MEMBER_API.fetch(ctx.request);
