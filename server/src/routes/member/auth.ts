import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { APP_DISABLED, checkLock, clearFails, endSession, recordFail, requireMember, startSession } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { all, assert, audit, first, mobile, run, str } from '../../lib/db';
import { isMemberId, MEMBER_ID_HINT, normalizeMemberId } from '../../lib/membership';
import { ensureDefaultLogin } from '../../lib/memberAccounts';

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
  // Safety net for members added without a login (e.g. Excel import): signing in with
  // member ID as both user ID and password creates their default login on the spot.
  if (asId && normalizeMemberId(pw) === asId) {
    const m = await first<{ id: number }>(c.env.DB,
      `SELECT m.id FROM members m WHERE upper(m.essl_id)=? AND m.archived=0 AND NOT EXISTS (SELECT 1 FROM accounts a WHERE a.member_id=m.id)`, asId);
    if (m) await ensureDefaultLogin(c.env, m.id);
  }
  const rows = await all<{ aid: number; mid: number; name: string; password_hash: string; active: number; app_access: number; must_change_password: number }>(
    c.env.DB,
    `SELECT a.id AS aid, m.id AS mid, m.name, a.password_hash, a.active, m.app_access, a.must_change_password
     FROM accounts a JOIN members m ON m.id = a.member_id
     WHERE a.role='member' AND m.archived=0 AND (upper(m.essl_id) = ? OR (? IS NOT NULL AND m.mobile = ?))`,
    asId, byMobile, byMobile,
  );
  for (const r of rows) {
    if (!r.active) continue;
    // Default passwords are the member ID in capitals ("CGA5"); accept "cga5" too while it is unchanged.
    const ok = (await verifyPassword(pw, r.password_hash))
      || (r.must_change_password === 1 && pw !== pw.trim().toUpperCase() && (await verifyPassword(pw.trim().toUpperCase(), r.password_hash)));
    if (ok) {
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
  return c.json({ error: notActivated && !rows.length
    ? 'First time? Sign in with your member ID as both user ID and password.'
    : 'Wrong member ID/mobile or password. Forgot it? Ask the front desk to reset it.' }, 401);
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

/** Session + what the app must ask for before anything else (new password, missing mobile). */
memberAuth.get('/me', requireMember(), async (c) => {
  const s = c.get('session');
  const r = await first<{ must_change_password: number; mobile: string | null; essl_id: string | null }>(c.env.DB,
    `SELECT a.must_change_password, m.mobile, m.essl_id FROM accounts a JOIN members m ON m.id=a.member_id WHERE a.id=?`, s.aid);
  return c.json({ ...s, essl_id: r?.essl_id ?? null, must_change_password: !!r?.must_change_password, needs_mobile: !r?.mobile });
});

/** First sign-in setup: own password (replacing the default / desk password) and a mobile number if the gym has none. */
memberAuth.post('/setup', requireMember(), async (c) => {
  const s = c.get('session');
  const b = await c.req.json();
  const r = await first<{ must_change_password: number; mobile: string | null; essl_id: string | null }>(c.env.DB,
    `SELECT a.must_change_password, m.mobile, m.essl_id FROM accounts a JOIN members m ON m.id=a.member_id WHERE a.id=?`, s.aid);
  assert(r, 401, 'Please sign in');
  if (r.must_change_password) {
    assert(typeof b.password === 'string' && b.password.length >= MIN_PW, 400, `Password must be at least ${MIN_PW} characters`);
    assert(normalizeMemberId(b.password) !== normalizeMemberId(r.essl_id), 400, 'Choose a password that is different from your member ID');
  }
  let mob: string | null = null;
  if (!r.mobile) {
    mob = mobile(b.mobile);
    assert(mob && /^[6-9]\d{9}$/.test(mob), 400, 'Enter your 10-digit mobile number');
  }
  if (r.must_change_password) await run(c.env.DB, 'UPDATE accounts SET password_hash=?, must_change_password=0 WHERE id=?', await hashPassword(b.password), s.aid);
  if (mob) await run(c.env.DB, 'UPDATE members SET mobile=?, updated_at=? WHERE id=?', mob, new Date().toISOString(), s.mid);
  await audit(c.env, `member:${s.name}`, 'member.setup', 'member', s.mid!, { password: !!r.must_change_password, mobile: !!mob });
  return c.json({ ok: true });
});

memberAuth.post('/change-password', requireMember(), async (c) => {
  const s = c.get('session');
  const b = await c.req.json();
  const acc = await first<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM accounts WHERE id=?', s.aid);
  assert(acc && (await verifyPassword(String(b.current ?? ''), acc.password_hash)), 400, 'Current password is wrong');
  assert(typeof b.next === 'string' && b.next.length >= MIN_PW, 400, `New password must be at least ${MIN_PW} characters`);
  await run(c.env.DB, 'UPDATE accounts SET password_hash=?, must_change_password=0 WHERE id=?', await hashPassword(b.next), s.aid);
  return c.json({ ok: true });
});
