// One Env type for all three workers; each wrangler.*.toml binds only what that worker needs.
//   device worker  — /iclock/* (X990 ADMS), /agent/* (gym PC bridge), cron reconciler
//   admin worker   — /api/* for the admin app (queues device intents in D1, never calls the device)
//   member worker  — /api/* for the member app (read-mostly, own session secret)
export interface Env {
  DB: D1Database;
  FILES?: R2Bucket;
  JWT_SECRET: string;           // different value per worker → tokens are not interchangeable
  SETUP_TOKEN?: string;         // admin worker: one-time owner creation
  AGENT_TOKEN?: string;         // device worker: shared secret for the gym PC agent
  GYM_TZ_OFFSET_MIN?: string;
  DEVICE_SN_ALLOWLIST?: string;
  VAPID_PUBLIC?: string;        // admin + member workers: web-push public key (base64url, uncompressed P-256)
  VAPID_PRIVATE?: string;       // admin worker only: private scalar `d` (base64url) — secret
  VAPID_SUBJECT?: string;       // mailto: contact sent to push services
  AI?: { run(model: string, input: Record<string, unknown>): Promise<unknown> }; // member worker: Workers AI (coach plans)
}

export type Role = 'owner' | 'admin' | 'staff' | 'member';

export interface Session {
  aid: number;         // account id
  role: Role;
  mid: number | null;  // member id for member accounts
  name: string;
  aud: 'admin' | 'member';
}

export type AppEnv = { Bindings: Env; Variables: { session: Session } };

export const tzOffset = (env: Env) => Number(env.GYM_TZ_OFFSET_MIN ?? 330);
