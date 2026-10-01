import type { Context, MiddlewareHandler } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import type { AppEnv, Role, Session } from '../env';
import { signToken, verifyToken } from './crypto';
import { first, nowIso, run } from './db';

// Each app has its own cookie and its own JWT secret (per worker) and an `aud` claim, so a
// member session can never be replayed against the admin API and vice versa.
const COOKIE = { admin: 'cg_admin', member: 'cg_member' } as const;
// Members stay signed in until they sign out: the cookie is renewed once a day while the app is used,
// so only a member who leaves the app unused for 400 days (the browser cookie maximum) is signed out.
const TTL = { admin: 60 * 60 * 12, member: 60 * 60 * 24 * 400 } as const;
const RENEW_AFTER_SEC = 60 * 60 * 24;

async function setSessionCookie(c: Context<AppEnv>, s: Omit<Session, 'aud'>, aud: Session['aud']) {
  const token = await signToken({ aid: s.aid, role: s.role, mid: s.mid, name: s.name, aud }, c.env.JWT_SECRET, TTL[aud]);
  setCookie(c, COOKIE[aud], token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Strict',
    path: '/',
    maxAge: TTL[aud],
  });
}

export async function startSession(c: Context<AppEnv>, s: Omit<Session, 'aud'>, aud: Session['aud']) {
  await setSessionCookie(c, s, aud);
  await run(c.env.DB, 'UPDATE accounts SET last_login_at=? WHERE id=?', nowIso(), s.aid);
}

export function endSession(c: Context<AppEnv>, aud: Session['aud']) {
  deleteCookie(c, COOKIE[aud], { path: '/' });
}

async function readSession(c: Context<AppEnv>, aud: Session['aud']): Promise<Session | null> {
  const token = getCookie(c, COOKIE[aud]) ?? c.req.header('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const s = await verifyToken<Session>(token, c.env.JWT_SECRET);
  if (!s || s.aud !== aud) return null;
  const acc = await first<{ active: number; role: Role }>(c.env.DB, 'SELECT active, role FROM accounts WHERE id=?', s.aid);
  if (!acc?.active) return null;
  return { ...s, role: acc.role }; // role changes apply immediately
}

export const ADMIN_ROLES: Role[] = ['owner', 'admin', 'staff'];

export function requireAdmin(...roles: Role[]): MiddlewareHandler<AppEnv> {
  const allowed = roles.length ? roles : ADMIN_ROLES;
  return async (c, next) => {
    const s = await readSession(c, 'admin');
    if (!s) return c.json({ error: 'Please sign in' }, 401);
    if (!allowed.includes(s.role)) return c.json({ error: 'You do not have permission for this action' }, 403);
    c.set('session', s);
    await next();
  };
}

export const APP_DISABLED = 'Your member app access has been turned off by the gym. Please contact the front desk.';

export function requireMember(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const s = await readSession(c, 'member');
    if (!s || s.role !== 'member' || !s.mid) return c.json({ error: 'Please sign in' }, 401);
    // Admin can switch a member's app access off at any time — takes effect on the next request.
    const m = await first<{ app_access: number; archived: number }>(c.env.DB, 'SELECT app_access, archived FROM members WHERE id=?', s.mid);
    if (!m || m.archived) return c.json({ error: 'Please sign in' }, 401);
    if (!m.app_access) {
      endSession(c, 'member');
      return c.json({ error: APP_DISABLED, code: 'app_disabled' }, 403);
    }
    c.set('session', s);
    // Sliding session: re-issue a fresh 400-day cookie at most once a day.
    const iat = (s as Session & { iat?: number }).iat ?? 0;
    if (Date.now() / 1000 - iat > RENEW_AFTER_SEC) await setSessionCookie(c, s, 'member');
    await next();
  };
}

export const actor = (c: Context<AppEnv>) => {
  const s = c.get('session');
  return s ? `${s.role}:${s.name}` : 'system';
};

// ── Brute-force protection ──────────────────────────────────────────────
export async function checkLock(db: D1Database, ident: string): Promise<string | null> {
  const row = await first<{ locked_until: string | null }>(db, 'SELECT locked_until FROM login_attempts WHERE ident=?', ident);
  if (row?.locked_until && row.locked_until > nowIso()) return 'Too many attempts. Try again in 15 minutes.';
  return null;
}

export async function recordFail(db: D1Database, ident: string) {
  await run(
    db,
    `INSERT INTO login_attempts (ident, fails) VALUES (?, 1)
     ON CONFLICT(ident) DO UPDATE SET fails = fails + 1,
       locked_until = CASE WHEN fails + 1 >= 5 THEN ? ELSE locked_until END`,
    ident,
    new Date(Date.now() + 15 * 60_000).toISOString(),
  );
}

export async function clearFails(db: D1Database, ident: string) {
  await run(db, 'DELETE FROM login_attempts WHERE ident=?', ident);
}
