import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, checkLock, clearFails, endSession, recordFail, requireAdmin, startSession } from '../../lib/auth';
import { hashPassword, verifyPassword } from '../../lib/crypto';
import { all, assert, audit, first, run, str } from '../../lib/db';

export const auth = new Hono<AppEnv>();

auth.get('/status', async (c) => {
  const owner = await first(c.env.DB, `SELECT 1 FROM accounts WHERE role='owner' LIMIT 1`);
  return c.json({ needsSetup: !owner });
});

/** One-time creation of the owner account; requires the SETUP_TOKEN secret. */
auth.post('/setup', async (c) => {
  const b = await c.req.json();
  assert(!(await first(c.env.DB, `SELECT 1 FROM accounts WHERE role='owner' LIMIT 1`)), 409, 'Setup already completed');
  assert(c.env.SETUP_TOKEN && b.setupToken === c.env.SETUP_TOKEN, 403, 'Invalid setup token');
  const username = str(b.username, 80)?.toLowerCase();
  const name = str(b.name, 80) ?? 'Owner';
  assert(username, 400, 'Username is required');
  assert(typeof b.password === 'string' && b.password.length >= 8, 400, 'Password must be at least 8 characters');
  const r = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO accounts (role, username, display_name, password_hash) VALUES ('owner', ?, ?, ?) RETURNING id`,
    username, name, await hashPassword(b.password),
  );
  await startSession(c, { aid: r!.id, role: 'owner', mid: null, name }, 'admin');
  await audit(c.env, `owner:${name}`, 'setup');
  return c.json({ ok: true });
});

auth.post('/login', async (c) => {
  const b = await c.req.json();
  const username = str(b.username, 80)?.toLowerCase() ?? '';
  const ident = `admin:${username}`;
  const locked = await checkLock(c.env.DB, ident);
  if (locked) return c.json({ error: locked }, 429);
  const acc = await first<{ id: number; role: 'owner' | 'admin' | 'staff'; display_name: string; password_hash: string; active: number }>(
    c.env.DB,
    `SELECT id, role, display_name, password_hash, active FROM accounts WHERE username=? AND role IN ('owner','admin','staff')`,
    username,
  );
  if (!acc || !acc.active || !(await verifyPassword(String(b.password ?? ''), acc.password_hash))) {
    await recordFail(c.env.DB, ident);
    return c.json({ error: 'Wrong username or password' }, 401);
  }
  await clearFails(c.env.DB, ident);
  await startSession(c, { aid: acc.id, role: acc.role, mid: null, name: acc.display_name ?? username }, 'admin');
  return c.json({ ok: true, role: acc.role, name: acc.display_name });
});

auth.post('/logout', (c) => {
  endSession(c, 'admin');
  return c.json({ ok: true });
});

auth.get('/me', requireAdmin(), (c) => c.json(c.get('session')));

auth.post('/change-password', requireAdmin(), async (c) => {
  const s = c.get('session');
  const b = await c.req.json();
  const acc = await first<{ password_hash: string }>(c.env.DB, 'SELECT password_hash FROM accounts WHERE id=?', s.aid);
  assert(acc && (await verifyPassword(String(b.current ?? ''), acc.password_hash)), 400, 'Current password is wrong');
  assert(typeof b.next === 'string' && b.next.length >= 8, 400, 'New password must be at least 8 characters');
  await run(c.env.DB, 'UPDATE accounts SET password_hash=? WHERE id=?', await hashPassword(b.next), s.aid);
  return c.json({ ok: true });
});

// ── Staff accounts (owner / admin) ──────────────────────────────────────
auth.get('/staff', requireAdmin('owner', 'admin'), async (c) =>
  c.json(await all(c.env.DB, `SELECT id, role, username, display_name, active, last_login_at, created_at FROM accounts WHERE role IN ('owner','admin','staff') ORDER BY role, display_name`)));

auth.post('/staff', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const me = c.get('session');
  const role = b.role === 'admin' ? 'admin' : 'staff';
  assert(role === 'staff' || me.role === 'owner', 403, 'Only the owner can create admins');
  const username = str(b.username, 80)?.toLowerCase();
  assert(username && /^[a-z0-9._@-]{3,80}$/.test(username), 400, 'Username: 3+ letters/digits');
  assert(typeof b.password === 'string' && b.password.length >= 8, 400, 'Password must be at least 8 characters');
  assert(!(await first(c.env.DB, `SELECT 1 FROM accounts WHERE username=?`, username)), 409, 'Username already taken');
  const r = await first<{ id: number }>(c.env.DB, `INSERT INTO accounts (role, username, display_name, password_hash) VALUES (?, ?, ?, ?) RETURNING id`,
    role, username, str(b.name, 80) ?? username, await hashPassword(b.password));
  await audit(c.env, actor(c), 'staff.create', 'account', r!.id, { role, username });
  return c.json({ id: r!.id });
});

auth.patch('/staff/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const me = c.get('session');
  const target = await first<{ role: string }>(c.env.DB, `SELECT role FROM accounts WHERE id=?`, id);
  assert(target && target.role !== 'member', 404, 'Account not found');
  assert(target.role !== 'owner' || me.role === 'owner', 403, 'Only the owner can change the owner');
  assert(id !== me.aid || b.active !== false, 400, "You can't deactivate yourself");
  if (typeof b.active === 'boolean') await run(c.env.DB, `UPDATE accounts SET active=? WHERE id=?`, b.active ? 1 : 0, id);
  if (typeof b.password === 'string') {
    assert(b.password.length >= 8, 400, 'Password must be at least 8 characters');
    await run(c.env.DB, `UPDATE accounts SET password_hash=? WHERE id=?`, await hashPassword(b.password), id);
  }
  if ((b.role === 'admin' || b.role === 'staff') && target.role !== 'owner') {
    assert(me.role === 'owner', 403, 'Only the owner can change roles');
    await run(c.env.DB, `UPDATE accounts SET role=? WHERE id=?`, b.role, id);
  }
  await audit(c.env, actor(c), 'staff.update', 'account', id, { active: b.active, role: b.role, password: !!b.password });
  return c.json({ ok: true });
});
