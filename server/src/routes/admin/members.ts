import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { tzOffset } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { hashPassword } from '../../lib/crypto';
import { all, assert, audit, first, getSettings, int, isDateOrNull, mobile, nowIso, relinkAttendance, run, str } from '../../lib/db';
import { addDays, isDate, today as todayOf } from '../../lib/dates';
import { bmi, bmiCategory } from '../../lib/fitness';
import { isMemberId, isStaffCode, MEMBER_ID_HINT, normalizeMemberId, unfreezeEnd } from '../../lib/membership';
import { createTerm, priceTerm, recordPayment } from '../../lib/terms';
import { getMemberSummary, listMembers } from '../../lib/members';
import { queueCommand, syncMember } from '../../device/queue';
import { ensureDefaultLogin } from '../../lib/memberAccounts';
import { clearFails } from '../../lib/auth';
import { storeMemberPhoto } from '../../lib/memberPhoto';
import { CONSENT_LANGS, CONSENT_VERSIONS, isSignaturePath } from '../../lib/consent';

export const members = new Hono<AppEnv>();
members.use('*', requireAdmin());

members.get('/', async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase();
  const status = c.req.query('status') ?? '';
  let list = await listMembers(c.env, c.req.query('archived') === '1');
  if (q) list = list.filter((m) => m.name.toLowerCase().includes(q) || (m.mobile ?? '').includes(q) || (m.essl_id ?? '').toLowerCase() === q || (m.essl_id ?? '').toLowerCase().startsWith(q));
  if (status === 'dues') list = list.filter((m) => m.due > 0);
  else if (status === 'unsynced') list = list.filter((m) => !m.device_in_sync);
  else if (status === 'app_off') list = list.filter((m) => !m.app_access);
  else if (status === 'app_users') list = list.filter((m) => m.app_user);
  else if (status === 'no_consent') list = list.filter((m) => !m.has_consent && !m.is_staff);
  else if (status === 'expiring_all') list = list.filter((m) => m.status === 'expiring' || m.status === 'near_expiry');
  else if (status) list = list.filter((m) => m.status === status);
  const sort = c.req.query('sort') ?? 'name';
  if (sort === 'end') list.sort((a, b) => (a.end_date ?? '').localeCompare(b.end_date ?? ''));
  // Numeric IDs in order, then lettered IDs (CGA5…) alphabetically, then members without an ID
  const idKey = (e: string | null) => (!e ? [2, 0, ''] : /^\d+$/.test(e) ? [0, Number(e), ''] : [1, 0, e]) as [number, number, string];
  if (sort === 'id') list.sort((a, b) => { const x = idKey(a.essl_id), y = idKey(b.essl_id); return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], undefined, { numeric: true }); });
  if (sort === 'recent') list.sort((a, b) => (b.last_visit ?? '').localeCompare(a.last_visit ?? ''));
  if (sort === 'app') list.sort((a, b) => (b.app_last_login ?? '').localeCompare(a.app_last_login ?? '') || b.app_user - a.app_user);
  return c.json({ total: list.length, members: list });
});

members.get('/next-id', async (c) => {
  const r = await first<{ n: number }>(c.env.DB, `SELECT MAX(CAST(essl_id AS INTEGER)) AS n FROM members WHERE essl_id GLOB '[0-9]*'`);
  const e = await first<{ n: number }>(c.env.DB, `SELECT MAX(CAST(code AS INTEGER)) AS n FROM etimetrack_employees WHERE code GLOB '[0-9]*'`);
  return c.json({ next: String(Math.max(r?.n ?? 0, e?.n ?? 0) + 1) });
});

members.get('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await first(c.env.DB, `SELECT * FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  const summary = await getMemberSummary(c.env, id);
  const [memberships, payments, attendance, followups, commands, account, device, consent] = await Promise.all([
    all(c.env.DB, `SELECT ms.*, d.paid, d.due FROM memberships ms LEFT JOIN v_membership_dues d ON d.membership_id = ms.id WHERE ms.member_id=? ORDER BY ms.start_date DESC, ms.id DESC`, id),
    all(c.env.DB, `SELECT * FROM payments WHERE member_id=? ORDER BY paid_on DESC, id DESC`, id),
    all(c.env.DB, `SELECT day, MIN(punched_at) AS first_in, MAX(punched_at) AS last_out, COUNT(*) AS punches FROM attendance WHERE member_id=? GROUP BY day ORDER BY day DESC LIMIT 90`, id),
    all(c.env.DB, `SELECT * FROM followups WHERE member_id=? ORDER BY call_date DESC, id DESC`, id),
    all(c.env.DB, `SELECT id, action, status, channel, result, reason, created_at, done_at FROM device_commands WHERE essl_id=(SELECT essl_id FROM members WHERE id=?) ORDER BY id DESC LIMIT 20`, id),
    first(c.env.DB, `SELECT id, active, last_login_at, must_change_password FROM accounts WHERE member_id=?`, id),
    first(c.env.DB, `SELECT d.*, (SELECT COUNT(*) FROM bio_templates b WHERE b.essl_id=d.essl_id) AS templates_backed_up FROM device_users d WHERE d.essl_id=(SELECT essl_id FROM members WHERE id=?)`, id),
    first(c.env.DB, `SELECT id, version, lang, signer_name, signature, signed_at, witnessed_by FROM member_consents WHERE member_id=? ORDER BY id DESC LIMIT 1`, id),
  ]);
  return c.json({ member: m, summary, memberships, payments, attendance, followups, commands, account, device, consent });
});

/** Create member (+ optional first plan & payment). Device user is created on the X990 automatically. */
members.post('/', async (c) => {
  const b = await c.req.json();
  const by = actor(c);
  const s = await getSettings(c.env.DB);
  const name = str(b.name, 80);
  assert(name, 400, 'Name is required');
  const essl = normalizeMemberId(b.essl_id);
  if (essl) {
    assert(isMemberId(essl), 400, MEMBER_ID_HINT);
    const dup = await first(c.env.DB, `SELECT 1 FROM members WHERE upper(essl_id)=? AND archived=0`, essl);
    assert(!dup, 409, `Member ID ${essl} is already in use`);
  }
  // Validate the plan, discount and coupon BEFORE saving anything, so a rejected coupon
  // doesn't leave a half-created member behind.
  if (b.plan_id) await priceTerm(c.env, null, b, 'desk');
  const today = todayOf(tzOffset(c.env));
  const r = await first<{ id: number }>(
    c.env.DB,
    `INSERT INTO members (essl_id, name, mobile, gender, dob, email, address, emergency_contact, join_date, notes, is_staff)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    essl, name, mobile(b.mobile), ['male', 'female', 'other'].includes(b.gender) ? b.gender : null, isDateOrNull(b.dob),
    str(b.email, 120), str(b.address, 300), str(b.emergency_contact, 80), isDateOrNull(b.join_date) ?? today, str(b.notes, 1000),
    isStaffCode(essl, s.access.staff_prefixes) || b.is_staff ? 1 : 0,
  );
  const id = r!.id;
  let term = null;
  if (b.plan_id) term = await createTerm(c.env, id, b, 'new', by);
  if (essl) {
    await queueCommand(c.env, { essl_id: essl, action: 'upsert_user', payload: { name }, reason: 'new member', by });
    await relinkAttendance(c.env.DB);
    // Member-app login: user ID and first password = member ID (changed on first sign-in).
    await ensureDefaultLogin(c.env, id);
  }
  await audit(c.env, by, 'member.create', 'member', id, { name, essl });
  return c.json({ id, term });
});

members.patch('/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const by = actor(c);
  const m = await first<{ essl_id: string | null; name: string }>(c.env.DB, `SELECT essl_id, name FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  const fields: Record<string, unknown> = {};
  if ('name' in b) fields.name = str(b.name, 80) ?? m.name;
  if ('mobile' in b) fields.mobile = mobile(b.mobile);
  if ('gender' in b) fields.gender = ['male', 'female', 'other'].includes(b.gender) ? b.gender : null;
  for (const k of ['email', 'address', 'emergency_contact', 'notes']) if (k in b) fields[k] = str(b[k], k === 'notes' ? 1000 : 300);
  for (const k of ['dob', 'join_date']) if (k in b) fields[k] = isDateOrNull(b[k]);
  if ('is_staff' in b) fields.is_staff = b.is_staff ? 1 : 0;
  if ('essl_id' in b) {
    const essl = normalizeMemberId(b.essl_id);
    if (essl && essl !== m.essl_id) {
      assert(isMemberId(essl), 400, MEMBER_ID_HINT);
      assert(!(await first(c.env.DB, `SELECT 1 FROM members WHERE upper(essl_id)=? AND archived=0 AND id<>?`, essl, id)), 409, `Member ID ${essl} is already in use`);
    }
    fields.essl_id = essl;
    if (essl !== m.essl_id) fields.device_state = 'unknown';
  }
  const keys = Object.keys(fields);
  if (keys.length) {
    await run(c.env.DB, `UPDATE members SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => fields[k]), nowIso(), id);
  }
  if ('essl_id' in fields) await relinkAttendance(c.env.DB);
  if ('essl_id' in fields && fields.essl_id !== m.essl_id && fields.essl_id) {
    // A still-unchanged default password follows the new member ID; members without a login get one.
    const acc = await first<{ id: number; must_change_password: number }>(c.env.DB, `SELECT id, must_change_password FROM accounts WHERE member_id=?`, id);
    if (!acc) await ensureDefaultLogin(c.env, id);
    else if (acc.must_change_password) await run(c.env.DB, `UPDATE accounts SET password_hash=? WHERE id=?`, await hashPassword(String(fields.essl_id)), acc.id);
  }
  // Keep device display name in step with the app
  const essl = (fields.essl_id as string | undefined) ?? m.essl_id;
  if (essl && ('name' in fields || 'essl_id' in fields)) {
    await queueCommand(c.env, { essl_id: essl, action: 'upsert_user', payload: { name: fields.name ?? m.name }, reason: 'profile edit', by });
  }
  await audit(c.env, by, 'member.update', 'member', id, fields);
  return c.json({ ok: true });
});

members.post('/:id/renew', async (c) => {
  const id = Number(c.req.param('id'));
  const by = actor(c);
  assert(await first(c.env.DB, `SELECT 1 FROM members WHERE id=? AND archived=0`, id), 404, 'Member not found');
  const term = await createTerm(c.env, id, await c.req.json(), 'renewal', by);
  await run(c.env.DB, `UPDATE members SET frozen_from=NULL, frozen_until=NULL WHERE id=?`, id);
  // Renewal restores access immediately even when auto-enforce is off.
  const cmd = await syncMember(c.env, id, by, true);
  await audit(c.env, by, 'member.renew', 'member', id, term);
  return c.json({ ...term, device_command: cmd });
});

members.post('/:id/payments', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const by = actor(c);
  const amount = int(b.amount);
  assert(amount && amount > 0, 400, 'Enter an amount');
  // Apply to the oldest term with dues unless a specific term was chosen.
  let msId = int(b.membership_id);
  if (!msId) {
    const due = await first<{ membership_id: number }>(c.env.DB, `SELECT d.membership_id FROM v_membership_dues d JOIN memberships ms ON ms.id=d.membership_id WHERE d.member_id=? AND d.due>0 ORDER BY ms.start_date LIMIT 1`, id);
    const cur = await first<{ id: number }>(c.env.DB, `SELECT id FROM v_current_membership WHERE member_id=?`, id);
    msId = due?.membership_id ?? cur?.id ?? null;
  }
  const p = await recordPayment(c.env, id, msId, { amount, mode: b.mode, reference: b.reference, paid_on: b.paid_on, entry_type: b.entry_type ?? 'due', remarks: b.remarks }, by);
  await audit(c.env, by, 'payment.create', 'member', id, { amount, receipt: p.receipt_no });
  return c.json(p);
});

members.post('/:id/freeze', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const today = todayOf(tzOffset(c.env));
  const from = isDateOrNull(b.from) ?? today;
  const until = isDateOrNull(b.until);
  assert(until && until >= from, 400, 'Choose a valid freeze end date');
  await run(c.env.DB, `UPDATE members SET frozen_from=?, frozen_until=?, updated_at=? WHERE id=?`, from, until, nowIso(), id);
  await syncMember(c.env, id, actor(c));
  await audit(c.env, actor(c), 'member.freeze', 'member', id, { from, until });
  return c.json({ ok: true });
});

members.post('/:id/unfreeze', async (c) => {
  const id = Number(c.req.param('id'));
  const today = todayOf(tzOffset(c.env));
  const m = await first<{ frozen_from: string | null }>(c.env.DB, `SELECT frozen_from FROM members WHERE id=?`, id);
  assert(m?.frozen_from, 400, 'Member is not frozen');
  const cur = await first<{ id: number; end_date: string }>(c.env.DB, `SELECT id, end_date FROM v_current_membership WHERE member_id=?`, id);
  if (cur) {
    const newEnd = unfreezeEnd(cur.end_date, m.frozen_from, today);
    await run(c.env.DB, `UPDATE memberships SET end_date=?, notes=COALESCE(notes||' · ','')||? WHERE id=?`, newEnd, `Frozen ${m.frozen_from}→${today}, extended to ${newEnd}`, cur.id);
  }
  await run(c.env.DB, `UPDATE members SET frozen_from=NULL, frozen_until=NULL, updated_at=? WHERE id=?`, nowIso(), id);
  await syncMember(c.env, id, actor(c), true);
  await audit(c.env, actor(c), 'member.unfreeze', 'member', id);
  return c.json({ ok: true });
});

/** Manual override: 'allow' | 'deny' | null (follow membership) */
members.post('/:id/access', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const v = b.override === 'allow' || b.override === 'deny' ? b.override : null;
  await run(c.env.DB, `UPDATE members SET access_override=?, updated_at=? WHERE id=?`, v, nowIso(), id);
  const cmd = await syncMember(c.env, id, actor(c), true);
  await audit(c.env, actor(c), 'member.access', 'member', id, { override: v });
  return c.json({ ok: true, device_command: cmd });
});

/** Push this member's current state to the device now. */
members.post('/:id/device-sync', async (c) => {
  const id = Number(c.req.param('id'));
  const m = await getMemberSummary(c.env, id);
  assert(m?.essl_id, 400, 'Member has no device ID');
  const s = await getSettings(c.env.DB);
  const cmd = await queueCommand(c.env, {
    essl_id: m.essl_id, action: m.access ? 'unblock' : 'block', by: actor(c), reason: 'manual sync',
    payload: m.access ? { name: m.name } : { method: s.access.block_method },
  });
  return c.json({ ok: true, device_command: cmd, action: m.access ? 'unblock' : 'block' });
});

/** Member app on/off. Off = login refused and any open session is signed out on its next request. */
members.post('/:id/app-access', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const on = b.enabled !== false;
  const m = await first(c.env.DB, `SELECT 1 FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  await run(c.env.DB, `UPDATE members SET app_access=?, updated_at=? WHERE id=?`, on ? 1 : 0, nowIso(), id);
  await audit(c.env, actor(c), on ? 'member.app_on' : 'member.app_off', 'member', id);
  return c.json({ ok: true, app_access: on });
});

/** Read-only fitness overview for trainers / front desk. */
members.get('/:id/fitness', async (c) => {
  const id = Number(c.req.param('id'));
  const since = addDays(todayOf(tzOffset(c.env)), -13);
  const [profile, days, workouts, weights] = await Promise.all([
    first<Record<string, number | string | null>>(c.env.DB, `SELECT * FROM fitness_profiles WHERE member_id=?`, id),
    all(c.env.DB, `SELECT d.day, COALESCE(f.kcal,0) AS kcal_in, COALESCE(w.kcal,0) AS kcal_out, COALESCE(w.n,0) AS workouts
                   FROM (SELECT DISTINCT day FROM food_logs WHERE member_id=?1 AND day>=?2 UNION SELECT DISTINCT day FROM workout_logs WHERE member_id=?1 AND day>=?2) d
                   LEFT JOIN (SELECT day, SUM(kcal) kcal FROM food_logs WHERE member_id=?1 GROUP BY day) f ON f.day=d.day
                   LEFT JOIN (SELECT day, SUM(kcal) kcal, COUNT(*) n FROM workout_logs WHERE member_id=?1 GROUP BY day) w ON w.day=d.day
                   ORDER BY d.day DESC`, id, since),
    all(c.env.DB, `SELECT day, name, sets, duration_min, kcal, best_e1rm FROM workout_logs WHERE member_id=? ORDER BY day DESC, id DESC LIMIT 15`, id),
    all(c.env.DB, `SELECT day, weight_kg FROM weight_logs WHERE member_id=? ORDER BY day DESC LIMIT 12`, id),
  ]);
  let bmiInfo = null;
  if (profile?.height_cm && profile.weight_kg) {
    const b = bmi(Number(profile.weight_kg), Number(profile.height_cm));
    bmiInfo = { bmi: b, category: bmiCategory(b).label };
  }
  return c.json({ profile, bmi: bmiInfo, days, workouts, weights });
});

/**
 * Forgotten password: set one for the member ({ password }) or put it back to their member ID ({ to_default: true }).
 * Either way the member must choose their own password after signing in.
 */
members.post('/:id/reset-password', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const m = await first<{ name: string; essl_id: string | null }>(c.env.DB, `SELECT name, essl_id FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  let pw: string;
  if (b.to_default === true) {
    assert(m.essl_id, 400, 'This member has no member ID — set a password instead');
    pw = m.essl_id.toUpperCase();
  } else {
    assert(typeof b.password === 'string' && b.password.length >= 6, 400, 'Password must be at least 6 characters');
    pw = b.password;
  }
  await run(
    c.env.DB,
    `INSERT INTO accounts (role, member_id, display_name, password_hash, must_change_password) VALUES ('member', ?, ?, ?, 1)
     ON CONFLICT(member_id) DO UPDATE SET password_hash=excluded.password_hash, active=1, must_change_password=1`,
    id, m.name, await hashPassword(pw),
  );
  await clearFails(c.env.DB, `member:${(m.essl_id ?? '').toLowerCase()}`);
  await audit(c.env, actor(c), 'member.reset_password', 'member', id, { to_default: b.to_default === true });
  return c.json({ ok: true, user_id: m.essl_id, password: b.to_default === true ? pw : undefined });
});

/** Archive (soft delete). Removes the person from the device; history is kept. */
members.delete('/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const m = await first<{ essl_id: string | null; name: string }>(c.env.DB, `SELECT essl_id, name FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  if (m.essl_id && c.req.query('keepDevice') !== '1') {
    await queueCommand(c.env, { essl_id: m.essl_id, action: 'delete_user', reason: 'member archived', by: actor(c) });
  }
  await run(c.env.DB, `UPDATE members SET archived=1, updated_at=? WHERE id=?`, nowIso(), id);
  await run(c.env.DB, `UPDATE accounts SET active=0 WHERE member_id=?`, id);
  await audit(c.env, actor(c), 'member.archive', 'member', id, { name: m.name, essl: m.essl_id });
  return c.json({ ok: true });
});

// ── Permanent delete (lead lost for good) ─────────────────────────────────
// Everything tied to the member row goes via ON DELETE CASCADE (plans, payments, follow-ups, login,
// fitness logs, …). Rows keyed only by device ID are cleaned here — but only while no other member
// uses that ID, so an old archived record can never wipe a current member's device data.
async function deleteImpact(env: AppEnv['Bindings'], id: number) {
  const m = await first<{ id: number; name: string; essl_id: string | null; archived: number; photo_key: string | null }>(env.DB,
    `SELECT id, name, essl_id, archived, photo_key FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  const pinShared = !!m.essl_id && !!(await first(env.DB, `SELECT 1 FROM members WHERE upper(essl_id)=upper(?) AND id<>? AND archived=0`, m.essl_id, id));
  const n = await first<{ plans: number; payments: number; paid: number; visits: number; fingerprints: number }>(env.DB,
    `SELECT (SELECT COUNT(*) FROM memberships WHERE member_id=?1) AS plans,
            (SELECT COUNT(*) FROM payments WHERE member_id=?1) AS payments,
            (SELECT COALESCE(SUM(amount),0) FROM payments WHERE member_id=?1 AND status='confirmed') AS paid,
            (SELECT COUNT(*) FROM attendance WHERE member_id=?1) AS visits,
            (SELECT COUNT(*) FROM bio_templates WHERE ?2 IS NOT NULL AND essl_id=?2) AS fingerprints`, id, pinShared ? null : m.essl_id);
  return { m, pinShared, counts: n! };
}

members.get('/:id/delete-preview', requireAdmin('owner'), async (c) => {
  const { m, pinShared, counts } = await deleteImpact(c.env, Number(c.req.param('id')));
  return c.json({ name: m.name, essl_id: m.essl_id, archived: !!m.archived, pin_shared: pinShared, ...counts });
});

members.delete('/:id/permanent', requireAdmin('owner'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const { m, pinShared, counts } = await deleteImpact(c.env, id);
  // Typed confirmation: the member ID (or the name when there is none).
  const expect = (m.essl_id ?? m.name).trim().toUpperCase();
  assert(String(b.confirm ?? '').trim().toUpperCase() === expect, 400, `Type ${m.essl_id ? 'the member ID' : 'the name'} to confirm`);
  const pin = !pinShared && m.essl_id ? m.essl_id : null;
  const stmts: D1PreparedStatement[] = [
    // attendance.member_id is ON DELETE SET NULL (keeps unknown punches); a lost lead's visits go too.
    c.env.DB.prepare(`DELETE FROM attendance WHERE member_id=?`).bind(id),
    c.env.DB.prepare(`DELETE FROM members WHERE id=?`).bind(id),
  ];
  if (pin) {
    stmts.push(
      c.env.DB.prepare(`DELETE FROM attendance WHERE essl_id=? AND member_id IS NULL`).bind(pin),
      c.env.DB.prepare(`DELETE FROM bio_templates WHERE essl_id=?`).bind(pin),
      c.env.DB.prepare(`DELETE FROM device_commands WHERE essl_id=?`).bind(pin), // adms_lines cascade
      c.env.DB.prepare(`DELETE FROM login_attempts WHERE ident=?`).bind(`member:${pin.toLowerCase()}`),
    );
  }
  await c.env.DB.batch(stmts);
  // Free the slot on the X990 too; device_users is updated when the device confirms.
  const cmd = pin ? await queueCommand(c.env, { essl_id: pin, action: 'delete_user', reason: 'member deleted permanently', by: actor(c) }) : null;
  if (m.photo_key && c.env.FILES) c.executionCtx.waitUntil(c.env.FILES.delete(m.photo_key));
  await audit(c.env, actor(c), 'member.delete_permanent', 'member', id, { name: m.name, essl: m.essl_id, ...counts, device_id_kept_for_other_member: pinShared });
  return c.json({ ok: true, device_command: cmd });
});

members.post('/:id/restore', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const m = await first<{ essl_id: string | null }>(c.env.DB, `SELECT essl_id FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  if (m.essl_id) assert(!(await first(c.env.DB, `SELECT 1 FROM members WHERE essl_id=? AND archived=0`, m.essl_id)), 409, `ID ${m.essl_id} is now used by another member`);
  await run(c.env.DB, `UPDATE members SET archived=0, device_state='removed', updated_at=? WHERE id=?`, nowIso(), id);
  await run(c.env.DB, `UPDATE accounts SET active=1 WHERE member_id=?`, id);
  await syncMember(c.env, id, actor(c), true);
  return c.json({ ok: true });
});

/** Risk-acceptance consent signed by the member at the desk (wording: admin-app/src/lib/consent.ts). */
members.post('/:id/consent', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const m = await first<{ name: string }>(c.env.DB, `SELECT name FROM members WHERE id=?`, id);
  assert(m, 404, 'Member not found');
  assert((CONSENT_VERSIONS as readonly string[]).includes(b.version), 400, 'Unknown consent version — reload the page');
  assert((CONSENT_LANGS as readonly string[]).includes(b.lang), 400, 'Choose a language');
  assert(b.agreed === true, 400, 'The member must tick “I agree” before signing');
  assert(isSignaturePath(b.signature), 400, 'Please sign in the box');
  const signer = str(b.signer_name, 80) ?? m.name;
  const r = await first<{ id: number; signed_at: string }>(c.env.DB,
    `INSERT INTO member_consents (member_id, version, lang, signer_name, signature, witnessed_by) VALUES (?, ?, ?, ?, ?, ?) RETURNING id, signed_at`,
    id, b.version, b.lang, signer, b.signature, c.get('session').name);
  await audit(c.env, actor(c), 'member.consent', 'member', id, { version: b.version, lang: b.lang, consent_id: r!.id });
  return c.json(r);
});

// Photo upload → R2
members.put('/:id/photo', async (c) => {
  const id = Number(c.req.param('id'));
  const key = await storeMemberPhoto(c.env, id, c.req.raw);
  await audit(c.env, actor(c), 'member.photo', 'member', id);
  return c.json({ photo_key: key });
});

// Edit / cancel a term (corrections)
members.patch('/:id/memberships/:msId', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const msId = Number(c.req.param('msId'));
  const b = await c.req.json();
  const fields: Record<string, unknown> = {};
  if (isDate(b.start_date)) fields.start_date = b.start_date;
  if (isDate(b.end_date)) fields.end_date = b.end_date;
  if (int(b.price) !== null) fields.price = Math.max(0, int(b.price)!);
  if (b.status === 'cancelled' || b.status === 'active') fields.status = b.status;
  if ('notes' in b) fields.notes = str(b.notes, 500);
  const keys = Object.keys(fields);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE memberships SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=? AND member_id=?`, ...keys.map((k) => fields[k]), msId, id);
  if (fields.status === 'cancelled') await run(c.env.DB, `UPDATE coupon_redemptions SET status='void' WHERE membership_id=? AND status='applied'`, msId);
  await syncMember(c.env, id, actor(c));
  await audit(c.env, actor(c), 'membership.update', 'membership', msId, fields);
  return c.json({ ok: true });
});
