// Admin view of the device. Writes only intents into device_commands; the device worker
// (ADMS or PC agent) executes them. Never contacts the X990 directly.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { randomToken, sha256 } from '../../lib/crypto';
import { all, assert, audit, first, nowIso, run, str } from '../../lib/db';
import { planReconcile, queueCommand, type Action } from '../../device/queue';
import { isSafePin } from '../../device/protocol';

export const device = new Hono<AppEnv>();
device.use('*', requireAdmin());

device.get('/', async (c) => {
  const [devices, agents, queue, recent, plan, coverage, orphans, missing, privileged] = await Promise.all([
    all(c.env.DB, `SELECT * FROM devices ORDER BY approved DESC, last_seen_at DESC`),
    all(c.env.DB, `SELECT id, name, last_seen_at, info FROM agents ORDER BY last_seen_at DESC`),
    first(c.env.DB, `SELECT SUM(status='pending') AS pending, SUM(status='sent') AS sent,
                     SUM(status='failed' AND done_at > datetime('now','-1 day')) AS failed_24h,
                     SUM(status='done' AND done_at > datetime('now','-1 day')) AS done_24h FROM device_commands`),
    all(c.env.DB, `SELECT c.id, c.essl_id, c.action, c.status, c.channel, c.attempts, c.result, c.reason, c.created_by, c.created_at, c.done_at, m.name
                   FROM device_commands c LEFT JOIN members m ON m.essl_id=c.essl_id AND m.archived=0 ORDER BY c.id DESC LIMIT 60`),
    planReconcile(c.env),
    first(c.env.DB, `SELECT (SELECT COUNT(*) FROM device_users WHERE on_device=1) AS on_device,
                            (SELECT COUNT(*) FROM device_users WHERE on_device=1 AND fp_count>0) AS with_fingers,
                            (SELECT COUNT(DISTINCT essl_id) FROM bio_templates) AS backed_up,
                            (SELECT MAX(seen_at) FROM device_users) AS roster_at`),
    // On the device but not a member in the app (junk, staff not added, or legacy)
    all(c.env.DB, `SELECT d.essl_id, d.name, d.privilege, d.fp_count, d.seen_at FROM device_users d
                   WHERE d.on_device=1 AND NOT EXISTS (SELECT 1 FROM members m WHERE m.essl_id=d.essl_id AND m.archived=0) ORDER BY d.essl_id LIMIT 300`),
    // Members whose PIN is not on the device although they should have access
    all(c.env.DB, `SELECT m.id, m.essl_id, m.name, m.device_state FROM members m
                   WHERE m.archived=0 AND m.essl_id IS NOT NULL AND m.device_state IN ('unknown','active')
                     AND EXISTS (SELECT 1 FROM device_users) AND NOT EXISTS (SELECT 1 FROM device_users d WHERE d.essl_id=m.essl_id AND d.on_device=1) LIMIT 300`),
    all(c.env.DB, `SELECT d.essl_id, d.name, d.privilege, (SELECT is_staff FROM members m WHERE m.essl_id=d.essl_id AND m.archived=0) AS is_staff
                   FROM device_users d WHERE d.on_device=1 AND d.privilege <> 0 ORDER BY d.essl_id`),
  ]);
  return c.json({
    devices, agents, queue, recent,
    pending_changes: { block: plan.filter((p) => p.action === 'block'), unblock: plan.filter((p) => p.action === 'unblock') },
    coverage, orphans, missing, privileged,
  });
});

const ALLOWED: Action[] = ['upsert_user', 'block', 'unblock', 'delete_user', 'backup_templates', 'query_users', 'reboot'];

device.post('/commands', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const action = b.action as Action;
  assert(ALLOWED.includes(action), 400, 'Unsupported action');
  const pin = str(b.essl_id, 24);
  const needsPin = !['query_users', 'reboot'].includes(action);
  assert(!needsPin || (pin && isSafePin(pin)), 400, 'A valid device ID is required');
  let payload: Record<string, unknown> | undefined;
  if (action === 'upsert_user' || action === 'unblock') {
    const m = await first<{ name: string }>(c.env.DB, `SELECT name FROM members WHERE essl_id=? AND archived=0`, pin);
    const d = await first<{ name: string }>(c.env.DB, `SELECT name FROM device_users WHERE essl_id=?`, pin);
    payload = { name: str(b.name, 24) ?? m?.name ?? d?.name ?? pin };
  }
  if (action === 'block') payload = { method: 'remove' };
  const id = await queueCommand(c.env, { essl_id: needsPin ? pin : null, action, payload, reason: str(b.reason, 120) ?? 'manual', by: actor(c) });
  await audit(c.env, actor(c), `device.${action}`, 'device', pin ?? undefined, { id });
  return c.json({ id });
});

/** Remove device users that are not members (junk PINs like "CGA2 Privilege=14"). */
device.post('/cleanup', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const pins: string[] = Array.isArray(b.pins) ? b.pins.map(String).slice(0, 200) : [];
  assert(pins.length, 400, 'Choose device users to remove');
  let queued = 0;
  const skipped: string[] = [];
  for (const pin of pins) {
    const isMember = await first(c.env.DB, `SELECT 1 FROM members WHERE essl_id=? AND archived=0`, pin);
    if (isMember) { skipped.push(pin); continue; }
    if (!isSafePin(pin)) {
      // Junk PINs with spaces/'=' cannot be addressed via ADMS; only the PC agent (by uid) can remove them.
      await run(c.env.DB, `INSERT INTO device_commands (essl_id, action, payload, reason, created_by) VALUES (NULL, 'delete_user', ?, 'cleanup junk PIN', ?)`,
        JSON.stringify({ pin_raw: pin, agent_only: true }), actor(c));
      queued++;
      continue;
    }
    await queueCommand(c.env, { essl_id: pin, action: 'delete_user', reason: 'cleanup: not a member', by: actor(c) });
    queued++;
  }
  await audit(c.env, actor(c), 'device.cleanup', 'device', undefined, { pins, skipped });
  return c.json({ queued, skipped });
});

/** Take admin rights away from a device user (e.g. a member with menu access). */
device.post('/demote', requireAdmin('owner'), async (c) => {
  const b = await c.req.json();
  const pin = str(b.essl_id, 24);
  assert(pin && isSafePin(pin), 400, 'Invalid device ID');
  const d = await first<{ name: string }>(c.env.DB, `SELECT name FROM device_users WHERE essl_id=?`, pin);
  const id = await queueCommand(c.env, { essl_id: pin, action: 'upsert_user', payload: { name: d?.name ?? pin }, reason: 'remove device admin rights', by: actor(c) });
  await audit(c.env, actor(c), 'device.demote', 'device', pin, { id });
  return c.json({ id });
});

device.post('/commands/:id/cancel', requireAdmin('owner', 'admin'), async (c) => {
  await run(c.env.DB, `UPDATE device_commands SET status='cancelled', result='cancelled by '||?, done_at=? WHERE id=? AND status IN ('pending','sent')`,
    c.get('session').name, nowIso(), Number(c.req.param('id')));
  return c.json({ ok: true });
});

device.post('/commands/:id/retry', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  await run(c.env.DB, `DELETE FROM adms_lines WHERE command_id=?`, id);
  await run(c.env.DB, `UPDATE device_commands SET status='pending', channel=NULL, attempts=0, result=NULL WHERE id=? AND status IN ('failed','cancelled')`, id);
  return c.json({ ok: true });
});

device.post('/approve', requireAdmin('owner'), async (c) => {
  const b = await c.req.json();
  await run(c.env.DB, `UPDATE devices SET approved=?, name=COALESCE(?, name) WHERE sn=?`, b.approved === false ? 0 : 1, str(b.name, 60), str(b.sn, 32));
  await audit(c.env, actor(c), 'device.approve', 'device', b.sn, b);
  return c.json({ ok: true });
});

/** Issue a token for a gym-PC agent. Shown once; only its hash is stored. */
device.post('/agents', requireAdmin('owner'), async (c) => {
  const b = await c.req.json();
  const name = str(b.name, 60) ?? 'Front desk PC';
  const token = `cga_${randomToken(24)}`;
  await run(c.env.DB, `INSERT INTO agents (name, token_hash) VALUES (?, ?)`, name, await sha256(token));
  await audit(c.env, actor(c), 'agent.create', 'agent', name);
  return c.json({ name, token });
});

device.delete('/agents/:id', requireAdmin('owner'), async (c) => {
  await run(c.env.DB, `DELETE FROM agents WHERE id=?`, Number(c.req.param('id')));
  return c.json({ ok: true });
});
