// /agent/* — API for the gym-PC bridge (agent/agent.py). The agent only makes outbound
// HTTPS calls, so no port forwarding / public IP is needed at the gym.
import { Hono } from 'hono';
import type { AppEnv } from '../env';
import { sha256 } from '../lib/crypto';
import { all, first, getSettings, nowIso, run } from '../lib/db';
import { claimForAgent, finish, ingestOperlog, ingestPunches, type CommandRow } from './queue';

export const agentApi = new Hono<AppEnv & { Variables: { agentName: string } }>();

agentApi.use('*', async (c, next) => {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  let name: string | null = null;
  if (c.env.AGENT_TOKEN && token === c.env.AGENT_TOKEN) name = 'default';
  else {
    const row = await first<{ name: string }>(c.env.DB, `SELECT name FROM agents WHERE token_hash=?`, await sha256(token));
    name = row?.name ?? null;
  }
  if (!name) return c.json({ error: 'unauthorized' }, 401);
  c.set('agentName', name);
  await next();
});

agentApi.post('/heartbeat', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const name = c.get('agentName');
  // The env-token agent gets a synthetic row so the admin app can show its last heartbeat.
  await run(c.env.DB, `INSERT INTO agents (name, token_hash, last_seen_at, info) VALUES (?, ?, ?, ?)
                       ON CONFLICT(token_hash) DO UPDATE SET last_seen_at=excluded.last_seen_at, info=excluded.info`,
    name, name === 'default' ? 'env:default' : `name:${name}`, nowIso(), JSON.stringify(b).slice(0, 4000));
  const d = b.device;
  if (d?.sn && /^[A-Za-z0-9]{4,32}$/.test(d.sn)) {
    const allow = (c.env.DEVICE_SN_ALLOWLIST ?? '').split(',').map((s) => s.trim());
    await run(c.env.DB,
      `INSERT INTO devices (sn, approved, model, firmware, last_ip, last_seen_at, last_seen_via, user_count, fp_count, att_count)
       VALUES (?, ?, ?, ?, ?, ?, 'agent', ?, ?, ?)
       ON CONFLICT(sn) DO UPDATE SET model=excluded.model, firmware=excluded.firmware, last_ip=excluded.last_ip,
         user_count=excluded.user_count, fp_count=excluded.fp_count, att_count=excluded.att_count,
         approved=MAX(devices.approved, excluded.approved),
         last_seen_at=CASE WHEN devices.last_seen_via='adms' AND devices.last_seen_at > ? THEN devices.last_seen_at ELSE excluded.last_seen_at END,
         last_seen_via=CASE WHEN devices.last_seen_via='adms' AND devices.last_seen_at > ? THEN 'adms' ELSE 'agent' END`,
      d.sn, allow.includes(d.sn) ? 1 : 0, d.platform ?? null, d.firmware ?? null, d.ip ?? null, nowIso(),
      d.users ?? null, d.fingers ?? null, d.records ?? null,
      new Date(Date.now() - 120_000).toISOString(), new Date(Date.now() - 120_000).toISOString());
  }
  const s = await getSettings(c.env.DB);
  const last = await first<{ t: string | null }>(c.env.DB, `SELECT MAX(punched_at) AS t FROM attendance WHERE source IN ('agent','adms')`);
  return c.json({ ok: true, block_method: s.access.block_method, last_punch: last?.t ?? null, server_time: nowIso() });
});

agentApi.post('/commands/claim', async (c) => {
  const b = await c.req.json().catch(() => ({}));
  return c.json({ commands: await claimForAgent(c.env, Math.min(Number(b.max) || 10, 25)) });
});

agentApi.post('/commands/:id/result', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const cmd = await first<CommandRow>(c.env.DB, `SELECT * FROM device_commands WHERE id=? AND channel='agent' AND status='sent'`, id);
  if (!cmd) return c.json({ error: 'command not claimed by agent' }, 409);
  // Templates backed up by the agent before a remove-block
  if (Array.isArray(b.templates) && b.templates.length && cmd.essl_id) {
    await ingestOperlog(c.env, { users: [], fps: b.templates.map((t: any) => ({ pin: cmd.essl_id!, fid: Number(t.fid), size: t.size ?? null, valid: Number(t.valid ?? 1), tmp: String(t.tmp) })) }, 'agent');
  }
  if (b.method && cmd.action === 'block') {
    await run(c.env.DB, `UPDATE device_commands SET payload=json_set(COALESCE(payload,'{}'),'$.method',?) WHERE id=?`, b.method === 'disable' ? 'disable' : 'remove', id);
    cmd.payload = JSON.stringify({ ...(cmd.payload ? JSON.parse(cmd.payload) : {}), method: b.method });
  }
  if (b.requeue) {
    await run(c.env.DB, `UPDATE device_commands SET status='pending', channel=NULL, result=? WHERE id=?`, String(b.result ?? 'device busy').slice(0, 300), id);
    return c.json({ ok: true, requeued: true });
  }
  await finish(c.env, cmd, !!b.ok, String(b.result ?? (b.ok ? 'ok' : 'failed')));
  return c.json({ ok: true });
});

agentApi.post('/attendance', async (c) => {
  const b = await c.req.json();
  const punches = (Array.isArray(b.punches) ? b.punches : []).slice(0, 5000).map((p: any) => ({
    pin: String(p.pin), time: String(p.time), status: p.status ?? null, verify: p.verify ?? null,
  }));
  return c.json(await ingestPunches(c.env, punches, 'agent', b.sn ?? null));
});

/** Full roster from the device (users + optional templates) — marks missing users off-device. */
agentApi.post('/device-users', async (c) => {
  const b = await c.req.json();
  const raw: any[] = Array.isArray(b.users) ? b.users : [];
  const users = raw.map((u) => ({
    pin: String(u.pin), name: String(u.name ?? ''), pri: Number(u.privilege ?? 0), card: String(u.card ?? ''), grp: String(u.group ?? ''),
  }));
  const started = nowIso();
  const r = await ingestOperlog(c.env, { users, fps: [] }, 'agent');
  if (b.complete && users.length) {
    const ts = nowIso();
    // Anyone not in this complete roster is no longer on the device.
    await run(c.env.DB, `UPDATE device_users SET on_device=0 WHERE seen_at < ? AND on_device=1`, started);
    const stmts = raw
      .filter((u) => u.fingers !== undefined)
      .map((u) => c.env.DB.prepare(`UPDATE device_users SET fp_count=? WHERE essl_id=?`).bind(Number(u.fingers), String(u.pin)));
    for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
    // Reflect reality in member device_state (on device → active unless we know it was blocked by group)
    await run(c.env.DB, `UPDATE members SET device_state='removed', device_synced_at=? WHERE archived=0 AND essl_id IS NOT NULL
                         AND essl_id NOT IN (SELECT essl_id FROM device_users WHERE on_device=1)`, ts);
    await run(c.env.DB, `UPDATE members SET device_state='active', device_synced_at=? WHERE archived=0 AND device_state IN ('unknown','removed')
                         AND essl_id IN (SELECT essl_id FROM device_users WHERE on_device=1 AND (grp IS NULL OR grp NOT IN ('99')))`, ts);
  }
  return c.json(r);
});

agentApi.post('/templates', async (c) => {
  const b = await c.req.json();
  const fps = (Array.isArray(b.templates) ? b.templates : []).map((t: any) => ({ pin: String(t.pin), fid: Number(t.fid), size: t.size ?? null, valid: Number(t.valid ?? 1), tmp: String(t.tmp) }));
  return c.json(await ingestOperlog(c.env, { users: [], fps }, 'agent'));
});

agentApi.get('/templates/missing', async (c) => {
  // PINs on device with fingerprints but no cloud backup yet — agent backs these up in the background.
  const rows = await all<{ essl_id: string }>(c.env.DB,
    `SELECT d.essl_id FROM device_users d WHERE d.on_device=1 AND COALESCE(d.fp_count,1) > 0
     AND NOT EXISTS (SELECT 1 FROM bio_templates b WHERE b.essl_id=d.essl_id) LIMIT 5000`);
  return c.json({ pins: rows.map((r) => r.essl_id) });
});

/** eTimeTrack Lite Employees mirror (read from the local .mdb by the agent). */
agentApi.post('/etimetrack', async (c) => {
  const b = await c.req.json();
  const rows = Array.isArray(b.employees) ? b.employees : [];
  const ts = nowIso();
  const stmts = rows.slice(0, 5000).map((e: any) =>
    c.env.DB.prepare(`INSERT INTO etimetrack_employees (code, name, status, doj, contact, device_group, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name=excluded.name, status=excluded.status, doj=excluded.doj, contact=excluded.contact,
      device_group=excluded.device_group, synced_at=excluded.synced_at`)
      .bind(String(e.code), e.name ?? null, e.status ?? null, e.doj ?? null, e.contact ?? null, e.device_group ?? null, ts));
  for (let i = 0; i < stmts.length; i += 50) await c.env.DB.batch(stmts.slice(i, i + 50));
  return c.json({ upserted: stmts.length });
});
