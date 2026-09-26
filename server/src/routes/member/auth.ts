import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { APP_DISABLED, checkLock, clearFails, endSession, recordFail, requireMember, startSession } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { all, assert, audit, first, mobile, run, str } from '../../lib/db';
import { isMemberId, MEMBER_ID_HINT, normalizeMemberId } from '../../lib/membership';

export const memberAuth = new Hono<AppEnv>();

const MIN_PW = 6;

/**
 * Sign in with mobile number OR member (device) ID + password.
 * Families often share one mobile, so every account on that mobile is tried.
 */
memberAuth.post('/login', async (c) => {
  const b = await c.req.json();
  const id = str(b.id, 30) ?? '';
  const pw = String(b.password ?? '');
  const ident = `member:${id.toLowerCase()}`;
  const locked = await checkLock(c.env.DB, ident);
  if (locked) return c.json({ error: locked }, 429);

  const mob = mobile(id);
  const byMobile = mob && mob.length === 10 ? mob : null;
  const asId = normalizeMemberId(id) ?? '';
  const rows = await all<{ aid: number; mid: number; name: string; password_hash: string; active: number; app_access: number }>(
    c.env.DB,
    `SELECT a.id AS aid, m.id AS mid, m.name, a.password_hash, a.active, m.app_access
     FROM accounts a JOIN members m ON m.id = a.member_id
     WHERE a.role='member' AND m.archived=0 AND (upper(m.essl_id) = ? OR (? IS NOT NULL AND m.mobile = ?))`,
    asId, byMobile, byMobile,
  );
  for (const r of rows) {
    if (r.active && (await verifyPassword(pw, r.password_hash))) {
      await clearFails(c.env.DB, ident);
      if (!r.app_access) return c.json({ error: APP_DISABLED, code: 'app_disabled' }, 403);
      await startSession(c, { aid: r.aid, role: 'member', mid: r.mid, name: r.name }, 'member');
      return c.json({ ok: true });
    }
  }
  await recordFail(c.env.DB, ident);
  const notActivated = await first(
    c.env.DB,
    `SELECT 1 FROM members m WHERE m.archived=0 AND (upper(m.essl_id)=? OR (? IS NOT NULL AND m.mobile=?))
       AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.member_id=m.id)`,
    asId, byMobile, byMobile,
  );
  return c.json({ error: notActivated && !rows.length ? 'Your account is not activated yet — tap "First time here?"' : 'Wrong mobile/ID or password' }, 401);
});

/** First-time activation: mobile + member ID (printed on the receipt / shown at the desk). */
memberAuth.post('/activate', async (c) => {
  const b = await c.req.json();
  const mob = mobile(b.mobile);
  const essl = normalizeMemberId(b.memberId);
  const ident = `activate:${mob}`;
  const locked = await checkLock(c.env.DB, ident);
  if (locked) return c.json({ error: locked }, 429);
  assert(mob && mob.length === 10, 400, 'Enter your 10-digit mobile number');
  assert(isMemberId(essl), 400, MEMBER_ID_HINT);
  assert(typeof b.password === 'string' && b.password.length >= MIN_PW, 400, `Password must be at least ${MIN_PW} characters`);

  const m = await first<{ id: number; name: string; app_access: number }>(c.env.DB, `SELECT id, name, app_access FROM members WHERE upper(essl_id)=? AND mobile=? AND archived=0`, essl, mob);
  if (!m) {
    await recordFail(c.env.DB, ident);
    const noMobile = await first(c.env.DB, `SELECT 1 FROM members WHERE upper(essl_id)=? AND archived=0 AND (mobile IS NULL OR mobile='')`, essl);
    return c.json({ error: noMobile
      ? 'The gym has no mobile number saved for this ID. Ask the front desk to add it (or to create your login).'
      : 'No member found with that mobile and ID. Please check with the front desk.' }, 404);
  }
  assert(m.app_access, 403, APP_DISABLED);
  const existing = await first(c.env.DB, `SELECT 1 FROM accounts WHERE member_id=?`, m.id);
  assert(!existing, 409, 'This account is already activated. Sign in, or ask the front desk to reset your password.');
  const r = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO accounts (role, member_id, display_name, password_hash) VALUES ('member', ?, ?, ?) RETURNING id`,
    m.id, m.name, await hashPassword(b.password),
  );
  await clearFails(c.env.DB, ident);
  await startSession(c, { aid: r!.id, role: 'member', mid: m.id, name: m.name }, 'member');
  await audit(c.env, `member:${m.name}`, 'member.activate', 'member', m.id);
  return c.json({ ok: true });
});

memberAuth.post('/logout', (c) => {
  endSession(c, 'member');
  return c.json({ ok: true });
});

memberAuth.get('/me', requireMember(), (c) => c.json(c.get('session')));

memberAuth.post('/change-password', requireMember(), async (c) => {
  const s = c.get('session');
  const b = await c.req.json();
  const acc = await first<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM accounts WHERE id=?', s.aid);
  assert(acc && (await verifyPassword(String(b.current ?? ''), acc.password_hash)), 400, 'Current password is wrong');
  assert(typeof b.next === 'string' && b.next.length >= MIN_PW, 400, `New password must be at least ${MIN_PW} characters`);
  await run(c.env.DB, 'UPDATE accounts SET password_hash=? WHERE id=?', await hashPassword(b.next), s.aid);
  return c.json({ ok: true });
});
