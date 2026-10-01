// Logical device command queue + desired-state reconciler.
//
// Admin actions never talk to the device directly. They change membership data; the
// reconciler compares "should have access" with the last known device state and queues
// block / unblock commands. Two delivery channels compete for pending commands:
//   • ADMS  — the X990 polls /iclock/getrequest over the internet (no PC needed)
//   • Agent — the PC bridge on the gym LAN claims commands and uses TCP 4370 (pyzk)
import type { Env } from '../env';
import { tzOffset } from '../env';
import { all, first, getAccessSettings, getSettings, nowIso, run } from '../lib/db';
import { accessAllowed } from '../lib/membership';
import { deviceTimeToIso, today as todayOf } from '../lib/dates';
import {
  deleteUserLine, fingerLine, isSafePin, queryFingerLine, queryUsersLine, userInfoLine,
  type AttPunch, type OperFp, type OperUser,
} from './protocol';

export type Action = 'upsert_user' | 'block' | 'unblock' | 'delete_user' | 'backup_templates' | 'query_users' | 'reboot' | 'raw';

export interface CommandRow {
  id: number;
  essl_id: string | null;
  action: Action;
  payload: string | null;
  status: string;
  channel: string | null;
  attempts: number;
  reason: string | null;
  created_at: string;
}

const OPPOSITE: Partial<Record<Action, Action>> = { block: 'unblock', unblock: 'block' };

export async function queueCommand(
  env: Env,
  c: { essl_id?: string | null; action: Action; payload?: unknown; reason?: string; by?: string },
): Promise<number | null> {
  const pin = c.essl_id ?? null;
  if (pin && !isSafePin(pin)) throw new Error(`Invalid device PIN: ${pin}`);
  if (pin) {
    // A newer intent supersedes an undelivered opposite one (block→unblock flip-flop). A block that is
    // only 'sent' for its fingerprint-backup pre-step has not touched the user yet, and would otherwise
    // go back to pending and run AFTER this command.
    const opp = OPPOSITE[c.action];
    if (opp) {
      await run(env.DB, `UPDATE device_commands SET status='cancelled', result='superseded', done_at=?
                         WHERE essl_id=? AND action=? AND (status='pending' OR (status='sent' AND json_extract(payload,'$.awaiting_backup')=1))`,
        nowIso(), pin, opp);
    }
    // De-duplicate identical pending work.
    const dup = await first<{ id: number }>(env.DB, `SELECT id FROM device_commands WHERE essl_id=? AND action=? AND status IN ('pending','sent') LIMIT 1`, pin, c.action);
    if (dup && c.action !== 'raw') return dup.id;
  }
  const r = await first<{ id: number }>(
    env.DB,
    `INSERT INTO device_commands (essl_id, action, payload, reason, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    pin, c.action, c.payload != null ? JSON.stringify(c.payload) : null, c.reason ?? null, c.by ?? 'system',
  );
  return r?.id ?? null;
}

async function memberForPin(env: Env, pin: string) {
  return first<{ id: number; name: string; device_state: string }>(env.DB, `SELECT id, name, device_state FROM members WHERE essl_id=? AND archived=0`, pin);
}

async function templatesFor(env: Env, pin: string) {
  return all<{ fid: number; size: number | null; valid: number; tmp: string }>(env.DB, `SELECT fid, size, valid, tmp FROM bio_templates WHERE essl_id=? ORDER BY fid`, pin);
}

// ── ADMS delivery ───────────────────────────────────────────────────────
/**
 * Claim pending commands for an ADMS poll and render protocol lines.
 * A 'remove'-style block is only delivered once the member's fingerprints are backed up
 * in the cloud; otherwise a backup query goes first so renewal can restore them.
 */
export async function claimForAdms(env: Env, sn: string, max = 6): Promise<string> {
  const pending = await all<CommandRow>(env.DB, `SELECT * FROM device_commands WHERE status='pending' ORDER BY id LIMIT 30`);
  const out: string[] = [];
  let defaultBlockMethod: string | undefined;
  let taken = 0;

  for (const cmd of pending) {
    if (taken >= max) break;
    const payload = cmd.payload ? JSON.parse(cmd.payload) : {};
    if (payload.agent_only) continue; // e.g. junk PINs containing spaces — only addressable by uid over TCP
    const pin = cmd.essl_id ?? '';
    let lines: string[] = [];

    switch (cmd.action) {
      case 'upsert_user':
        lines = [userInfoLine({ pin, name: payload.name ?? pin, card: payload.card })];
        break;
      case 'unblock': {
        const m = await memberForPin(env, pin);
        lines = [userInfoLine({ pin, name: payload.name ?? m?.name ?? pin, card: payload.card })];
        for (const t of await templatesFor(env, pin)) lines.push(fingerLine(pin, t));
        break;
      }
      case 'block': {
        const method = payload.method ?? (defaultBlockMethod ??= (await getAccessSettings(env.DB)).block_method);
        if (method === 'disable') {
          const m = await memberForPin(env, pin);
          lines = [userInfoLine({ pin, name: m?.name ?? pin, grp: payload.blocked_group ?? 99 })];
          break;
        }
        const tpl = await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM bio_templates WHERE essl_id=?`, pin);
        const du = await first<{ fp_count: number | null; on_device: number }>(env.DB, `SELECT fp_count, on_device FROM device_users WHERE essl_id=?`, pin);
        const knownNoFingers = du && du.fp_count === 0;
        const backupTries = payload.backup_tries ?? 0;
        if (!tpl?.n && !knownNoFingers && backupTries < 3) {
          // Ask the device for this member's templates first; retry the block on a later poll.
          await run(env.DB, `UPDATE device_commands SET payload=json_set(COALESCE(payload,'{}'),'$.backup_tries',?) WHERE id=?`, backupTries + 1, cmd.id);
          lines = [queryFingerLine(pin)];
          const claimed = await claim(env, cmd.id, sn, 'adms', true);
          if (claimed) {
            out.push(...(await recordLines(env, cmd.id, lines)));
            taken++;
          }
          continue;
        }
        if (!tpl?.n && !knownNoFingers) {
          // Firmware did not return templates after 3 tries: fall back to a reversible disable.
          const m = await memberForPin(env, pin);
          lines = [userInfoLine({ pin, name: m?.name ?? pin, grp: 99 })];
          await run(env.DB, `UPDATE device_commands SET payload=json_set(COALESCE(payload,'{}'),'$.method','disable') WHERE id=?`, cmd.id);
        } else {
          lines = [deleteUserLine(pin)];
        }
        break;
      }
      case 'delete_user':
        lines = [deleteUserLine(pin)];
        break;
      case 'backup_templates':
        lines = [queryFingerLine(pin)];
        break;
      case 'query_users':
        lines = [queryUsersLine()];
        break;
      case 'reboot':
        lines = ['REBOOT'];
        break;
      case 'raw':
        if (typeof payload.line === 'string' && !/[\r\n]/.test(payload.line)) lines = [payload.line];
        break;
    }
    if (!lines.length) {
      await finish(env, cmd, false, 'nothing to send');
      continue;
    }
    if (await claim(env, cmd.id, sn, 'adms')) {
      out.push(...(await recordLines(env, cmd.id, lines)));
      taken++;
    }
  }
  return out.length ? out.join('\n') + '\n' : 'OK';
}

/** Atomic claim; `keepPending` is used for the backup pre-step of a block. */
async function claim(env: Env, id: number, sn: string | null, channel: 'adms' | 'agent', keepPending = false): Promise<boolean> {
  const r = await env.DB.prepare(
    `UPDATE device_commands SET status='sent', channel=?, device_sn=?, sent_at=?, attempts=attempts+1
     WHERE id=? AND status='pending'`,
  ).bind(channel, sn, nowIso(), id).run();
  if (keepPending && r.meta.changes) {
    // Mark as 'sent' until the backup query is answered; devicecmd reply puts it back to pending.
    await run(env.DB, `UPDATE device_commands SET payload=json_set(COALESCE(payload,'{}'),'$.awaiting_backup',1) WHERE id=?`, id);
  }
  return (r.meta.changes ?? 0) > 0;
}

async function recordLines(env: Env, commandId: number, lines: string[]): Promise<string[]> {
  const stmts = lines.map((l) => env.DB.prepare(`INSERT INTO adms_lines (command_id, line) VALUES (?, ?) RETURNING seq`).bind(commandId, l));
  const res = await env.DB.batch<{ seq: number }>(stmts);
  return res.map((r, i) => `C:${r.results?.[0]?.seq}:${lines[i]}`);
}

/** Device replied to one or more C:<seq>: lines. */
export async function applyAdmsReplies(env: Env, replies: { id: number; ret: number }[]) {
  const touched = new Set<number>();
  for (const r of replies) {
    const row = await first<{ command_id: number }>(env.DB, `UPDATE adms_lines SET return_code=?, done_at=? WHERE seq=? RETURNING command_id`, r.ret, nowIso(), r.id);
    if (row) touched.add(row.command_id);
  }
  for (const id of touched) {
    const pendingLines = await first<{ n: number; bad: number }>(
      env.DB,
      `SELECT SUM(return_code IS NULL) AS n, SUM(return_code IS NOT NULL AND return_code <> 0) AS bad FROM adms_lines WHERE command_id=?`,
      id,
    );
    if (pendingLines && pendingLines.n > 0) continue;
    const cmd = await first<CommandRow>(env.DB, `SELECT * FROM device_commands WHERE id=?`, id);
    if (!cmd || cmd.status !== 'sent') continue;
    const payload = cmd.payload ? JSON.parse(cmd.payload) : {};
    if (payload.awaiting_backup) {
      // Backup query answered (templates arrive separately via OPERLOG/querydata). Re-queue the block.
      await run(env.DB, `UPDATE device_commands SET status='pending', payload=json_remove(payload,'$.awaiting_backup') WHERE id=?`, id);
      await run(env.DB, `DELETE FROM adms_lines WHERE command_id=?`, id);
      if (!(await first(env.DB, `SELECT 1 FROM bio_templates WHERE essl_id=?`, cmd.essl_id)) && (pendingLines?.bad ?? 0) === 0) {
        // Device answered OK but has no templates for this PIN → it has no fingerprints.
        await run(env.DB, `INSERT INTO device_users (essl_id, fp_count, source, seen_at) VALUES (?, 0, 'adms', ?)
                           ON CONFLICT(essl_id) DO UPDATE SET fp_count=0, seen_at=excluded.seen_at`, cmd.essl_id, nowIso());
      }
      continue;
    }
    // Deleting a user that is already absent returns non-zero; the goal is still met.
    const ok = (pendingLines?.bad ?? 0) === 0 || cmd.action === 'block' || cmd.action === 'delete_user';
    await finish(env, cmd, ok, ok ? 'ok' : `device returned error on ${pendingLines?.bad} line(s)`);
  }
}

// ── Agent delivery ──────────────────────────────────────────────────────
export async function claimForAgent(env: Env, max = 10) {
  const pending = await all<CommandRow>(env.DB, `SELECT * FROM device_commands WHERE status='pending' ORDER BY id LIMIT ?`, max);
  const out = [];
  let defaultBlockMethod: string | undefined;
  for (const cmd of pending) {
    if (!(await claim(env, cmd.id, null, 'agent'))) continue;
    const payload = cmd.payload ? JSON.parse(cmd.payload) : {};
    const m = cmd.essl_id ? await memberForPin(env, cmd.essl_id) : null;
    out.push({
      id: cmd.id,
      action: cmd.action,
      essl_id: cmd.essl_id,
      name: payload.name ?? m?.name ?? cmd.essl_id,
      method: payload.method ?? (defaultBlockMethod ??= (await getAccessSettings(env.DB)).block_method),
      payload,
      templates: cmd.action === 'unblock' && cmd.essl_id ? await templatesFor(env, cmd.essl_id) : [],
    });
  }
  return out;
}

// ── Outcomes ────────────────────────────────────────────────────────────
export async function finish(env: Env, cmd: CommandRow, ok: boolean, result: string) {
  await run(env.DB, `UPDATE device_commands SET status=?, result=?, done_at=? WHERE id=?`, ok ? 'done' : 'failed', result.slice(0, 500), nowIso(), cmd.id);
  if (!ok || !cmd.essl_id) return;
  const payload = cmd.payload ? JSON.parse(cmd.payload) : {};
  const ts = nowIso();
  switch (cmd.action) {
    case 'block': {
      const removed = (payload.method ?? 'remove') === 'remove';
      await run(env.DB, `UPDATE members SET device_state=?, device_synced_at=? WHERE essl_id=? AND archived=0`, removed ? 'removed' : 'blocked', ts, cmd.essl_id);
      if (removed) await run(env.DB, `UPDATE device_users SET on_device=0, seen_at=? WHERE essl_id=?`, ts, cmd.essl_id);
      break;
    }
    case 'unblock':
    case 'upsert_user':
      await run(env.DB, `UPDATE members SET device_state='active', device_synced_at=? WHERE essl_id=? AND archived=0`, ts, cmd.essl_id);
      await run(env.DB, `INSERT INTO device_users (essl_id, on_device, source, seen_at) VALUES (?, 1, 'cloud', ?)
                         ON CONFLICT(essl_id) DO UPDATE SET on_device=1, seen_at=excluded.seen_at`, cmd.essl_id, ts);
      break;
    case 'delete_user':
      await run(env.DB, `UPDATE members SET device_state='removed', device_synced_at=? WHERE essl_id=?`, ts, cmd.essl_id);
      await run(env.DB, `UPDATE device_users SET on_device=0, seen_at=? WHERE essl_id=?`, ts, cmd.essl_id);
      break;
  }
}

/** Commands delivered but never answered (device offline/rebooted) go back to the queue. */
export async function requeueStale(env: Env, minutes = 15) {
  const cutoff = new Date(Date.now() - minutes * 60_000).toISOString();
  // Runs every 5 minutes: start from the (usually empty) indexed list of sent commands
  // instead of scanning adms_lines, which grows with every command ever sent.
  const stale = (await all<{ id: number }>(env.DB, `SELECT id FROM device_commands WHERE status='sent' AND sent_at < ?`, cutoff)).map((r) => r.id);
  if (!stale.length) return;
  const ids = JSON.stringify(stale);
  await run(env.DB, `DELETE FROM adms_lines WHERE command_id IN (SELECT value FROM json_each(?)) AND return_code IS NULL`, ids);
  await run(env.DB, `UPDATE device_commands SET status=CASE WHEN attempts >= 5 THEN 'failed' ELSE 'pending' END,
                     result=CASE WHEN attempts >= 5 THEN 'no response from device after 5 attempts' ELSE result END
                     WHERE id IN (SELECT value FROM json_each(?)) AND status='sent'`, ids);
}

// ── Reconciler ──────────────────────────────────────────────────────────
export interface PlannedChange { member_id: number; essl_id: string; name: string; action: 'block' | 'unblock'; end_date: string | null }

export async function planReconcile(env: Env, memberId?: number): Promise<PlannedChange[]> {
  const s = await getSettings(env.DB);
  const today = todayOf(tzOffset(env));
  const rows = await all<{
    id: number; essl_id: string; name: string; device_state: string; is_staff: number;
    access_override: 'allow' | 'deny' | null; frozen_from: string | null; frozen_until: string | null; end_date: string | null; busy: number;
  }>(
    env.DB,
    `SELECT m.id, m.essl_id, m.name, m.device_state, m.is_staff, m.access_override, m.frozen_from, m.frozen_until,
            (SELECT MAX(end_date) FROM memberships WHERE member_id=m.id AND status='active') AS end_date,
            EXISTS(SELECT 1 FROM device_commands c WHERE c.essl_id=m.essl_id AND c.action IN ('block','unblock') AND c.status IN ('pending','sent')) AS busy
     FROM members m WHERE m.archived=0 AND m.essl_id IS NOT NULL ${memberId ? 'AND m.id=?' : ''}`,
    ...(memberId ? [memberId] : []),
  );
  const plan: PlannedChange[] = [];
  for (const r of rows) {
    if (r.busy) continue;
    const allowed = accessAllowed(r, today, s.access);
    const offDevice = r.device_state === 'blocked' || r.device_state === 'removed';
    if (!allowed && !offDevice) plan.push({ member_id: r.id, essl_id: r.essl_id, name: r.name, action: 'block', end_date: r.end_date });
    if (allowed && offDevice) plan.push({ member_id: r.id, essl_id: r.essl_id, name: r.name, action: 'unblock', end_date: r.end_date });
  }
  return plan;
}

export async function reconcile(env: Env, opts: { force?: boolean; by?: string; limit?: number } = {}) {
  const s = await getSettings(env.DB);
  if (!s.access.auto_enforce && !opts.force) return { queued: 0, skipped: 'auto_enforce is off' };
  const plan = (await planReconcile(env)).slice(0, opts.limit ?? 200);
  if (!plan.length) return { queued: 0 };
  const stmts = plan.map((p) =>
    env.DB.prepare(`INSERT INTO device_commands (essl_id, action, payload, reason, created_by) VALUES (?, ?, ?, ?, ?)`).bind(
      p.essl_id, p.action,
      JSON.stringify(p.action === 'block' ? { method: s.access.block_method } : { name: p.name }),
      p.action === 'block' ? 'membership expired' : 'membership active', opts.by ?? 'reconciler',
    ),
  );
  await env.DB.batch(stmts);
  return { queued: plan.length };
}

/**
 * Queue an immediate sync for one member (after renewal/edit/access change) if auto-enforce is on or forced.
 * Unlike the bulk reconciler this does not skip members with a command in flight: it compares the
 * wanted state with what the device will be once that command lands, so block → unblock clicked in
 * quick succession still ends with the member allowed. Returns the command to wait on, or null when
 * the device already matches.
 */
export async function syncMember(env: Env, memberId: number, by: string, force = false) {
  const s = await getSettings(env.DB);
  if (!s.access.auto_enforce && !force) return null;
  const r = await first<{
    essl_id: string; name: string; device_state: string; is_staff: number; access_override: 'allow' | 'deny' | null;
    frozen_from: string | null; frozen_until: string | null; end_date: string | null; inflight_id: number | null; inflight: 'block' | 'unblock' | null;
  }>(
    env.DB,
    `SELECT m.essl_id, m.name, m.device_state, m.is_staff, m.access_override, m.frozen_from, m.frozen_until,
            (SELECT MAX(end_date) FROM memberships WHERE member_id=m.id AND status='active') AS end_date,
            c.id AS inflight_id, c.action AS inflight
     FROM members m
     LEFT JOIN device_commands c ON c.id = (SELECT id FROM device_commands WHERE essl_id=m.essl_id AND action IN ('block','unblock')
                                            AND status IN ('pending','sent') ORDER BY id DESC LIMIT 1)
     WHERE m.id=? AND m.archived=0 AND m.essl_id IS NOT NULL`,
    memberId,
  );
  if (!r) return null;
  const want = accessAllowed(r, todayOf(tzOffset(env)), s.access) ? 'unblock' : 'block';
  const willBeOff = r.inflight ? r.inflight === 'block' : r.device_state === 'blocked' || r.device_state === 'removed';
  if ((want === 'block') === willBeOff) return r.inflight === want ? r.inflight_id : null;
  return queueCommand(env, {
    essl_id: r.essl_id, action: want, by,
    payload: want === 'block' ? { method: s.access.block_method } : { name: r.name },
    reason: want === 'block' ? 'access removed' : 'access restored',
  });
}

// ── Ingest from device (ADMS or agent) ──────────────────────────────────
export async function ingestPunches(env: Env, punches: AttPunch[], source: 'adms' | 'agent' | 'manual', sn: string | null) {
  if (!punches.length) return { inserted: 0, skipped: 0 };
  const off = tzOffset(env);
  const stmts: D1PreparedStatement[] = [];
  for (const p of punches) {
    const iso = deviceTimeToIso(p.time, off);
    if (!iso) continue;
    stmts.push(
      env.DB.prepare(
        `INSERT OR IGNORE INTO attendance (essl_id, member_id, punched_at, day, status_code, verify_mode, source, device_sn)
         VALUES (?, (SELECT id FROM members WHERE essl_id=? AND archived=0), ?, ?, ?, ?, ?, ?)`,
      ).bind(p.pin, p.pin, iso, iso.slice(0, 10), p.status, p.verify, source, sn),
    );
  }
  let inserted = 0;
  for (let i = 0; i < stmts.length; i += 50) {
    const res = await env.DB.batch(stmts.slice(i, i + 50));
    inserted += res.reduce((n, r) => n + (r.meta.changes ?? 0), 0);
  }
  return { inserted, skipped: punches.length - inserted };
}

export async function ingestOperlog(env: Env, data: { users: OperUser[]; fps: OperFp[] }, source: string) {
  const ts = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const u of data.users) {
    stmts.push(env.DB.prepare(
      `INSERT INTO device_users (essl_id, name, privilege, card, grp, on_device, source, seen_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(essl_id) DO UPDATE SET name=excluded.name, privilege=excluded.privilege, card=excluded.card, grp=excluded.grp,
       on_device=1, source=excluded.source, seen_at=excluded.seen_at`,
    ).bind(u.pin, u.name, u.pri, u.card, u.grp, source, ts));
  }
  for (const f of data.fps) {
    stmts.push(env.DB.prepare(
      `INSERT INTO bio_templates (essl_id, fid, size, valid, tmp, source, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(essl_id, fid) DO UPDATE SET size=excluded.size, valid=excluded.valid, tmp=excluded.tmp, source=excluded.source, updated_at=excluded.updated_at`,
    ).bind(f.pin, f.fid, f.size, f.valid, f.tmp, source, ts));
  }
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
  if (data.fps.length) {
    await run(env.DB, `UPDATE device_users SET fp_count=(SELECT COUNT(*) FROM bio_templates b WHERE b.essl_id=device_users.essl_id)
                       WHERE essl_id IN (SELECT DISTINCT essl_id FROM bio_templates WHERE updated_at=?)`, ts);
  }
  return { users: data.users.length, templates: data.fps.length };
}
