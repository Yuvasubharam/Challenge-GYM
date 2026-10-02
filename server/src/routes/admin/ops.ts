import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { tzOffset } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, getSettings, int, isDateOrNull, nextReceiptNo, putSetting, run, str, type GymSettings } from '../../lib/db';
import { cleanModelList, MODEL_CATALOG } from '../../lib/ai';
import { randomToken } from '../../lib/crypto';
import { addDays, addMonths, offsetSuffix, today as todayOf } from '../../lib/dates';
import { listMembers } from '../../lib/members';
import { planReconcile, reconcile, syncMember } from '../../device/queue';
import { createTerm } from '../../lib/terms';
import { cachedView } from '../../lib/viewCache';
import { pushConfigured } from '../../lib/content';
import { renderReminder, renewalTargets, sendRenewalReminders } from '../../lib/renewalPush';
import { sendWeightReminders, weightTargets } from '../../lib/weightPush';
import { renderWeightNudge, weightTrend, type WeightTrend } from '../../lib/weightTrack';

export const ops = new Hono<AppEnv>();
ops.use('*', requireAdmin());

const todayFor = (c: { env: AppEnv['Bindings'] }) => todayOf(tzOffset(c.env));

// ── Dashboard ───────────────────────────────────────────────────────────
// Cached 30 s (and cleared by any admin write): the dashboard is opened far more often than data changes.
ops.get('/dashboard', async (c) => c.json(await cachedView(c.env, `dashboard:${todayFor(c)}`, 30_000, () => dashboardData(c))));

async function dashboardData(c: { env: AppEnv['Bindings'] }) {
  const today = todayFor(c);
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  const from12 = addMonths(`${month}-01`, -11);
  const list = await listMembers(c.env);

  const count = (f: (m: (typeof list)[number]) => boolean) => list.filter(f).length;
  const members = {
    total: list.length,
    active: count((m) => m.status === 'active'),
    near_expiry: count((m) => m.status === 'near_expiry'),
    expiring: count((m) => m.status === 'expiring'),
    expired: count((m) => m.status === 'expired'),
    frozen: count((m) => m.status === 'frozen'),
    no_plan: count((m) => m.status === 'none'),
    staff: count((m) => m.status === 'staff'),
    male: count((m) => m.gender === 'male'),
    female: count((m) => m.gender === 'female'),
    gender_unset: count((m) => !m.gender),
    new_this_month: count((m) => (m.join_date ?? '').startsWith(month)),
    with_dues: count((m) => m.due > 0),
    dues_total: list.reduce((s, m) => s + m.due, 0),
    device_unsynced: count((m) => !m.device_in_sync),
  };

  // New members per month come from the list already in memory (the SQL form read ~1.3k rows per load).
  const newByMonth: { ym: string; n: number }[] = [];
  for (const m of list) {
    const ym = (m.join_date ?? '').slice(0, 7);
    if (ym < from12.slice(0, 7)) continue;
    const row = newByMonth.find((r) => r.ym === ym);
    if (row) row.n++; else newByMonth.push({ ym, n: 1 });
  }

  const [money, monthly, visits, hourly, recentPayments, pendingClaims, device, queue, agent, followupsDue] = await Promise.all([
    first<Record<string, number>>(c.env.DB,
      `SELECT COALESCE(SUM(CASE WHEN paid_on=? THEN amount END),0) AS today,
              COALESCE(SUM(CASE WHEN substr(paid_on,1,7)=? THEN amount END),0) AS month,
              COALESCE(SUM(CASE WHEN substr(paid_on,1,4)=? THEN amount END),0) AS year,
              COALESCE(SUM(amount),0) AS all_time,
              COUNT(CASE WHEN substr(paid_on,1,7)=? AND entry_type='renewal' THEN 1 END) AS renewals_month
       FROM payments WHERE status='confirmed'`, today, month, year, month),
    all<{ ym: string; payments: number; revenue: number; renewals: number }>(c.env.DB,
      `SELECT substr(paid_on,1,7) AS ym, COUNT(*) AS payments, SUM(amount) AS revenue,
              SUM(CASE WHEN entry_type='renewal' THEN 1 ELSE 0 END) AS renewals
       FROM payments WHERE status='confirmed' AND paid_on >= ? GROUP BY ym ORDER BY ym`, from12),
    all<{ day: string; visitors: number }>(c.env.DB,
      `SELECT day, COUNT(DISTINCT essl_id) AS visitors FROM attendance WHERE day >= ? GROUP BY day ORDER BY day`, addDays(today, -13)),
    all<{ hour: string; n: number }>(c.env.DB,
      `SELECT substr(punched_at,12,2) AS hour, COUNT(DISTINCT essl_id) AS n FROM attendance WHERE day=? GROUP BY hour ORDER BY hour`, today),
    all(c.env.DB,
      `SELECT p.id, p.amount, p.mode, p.paid_on, p.receipt_no, p.entry_type, m.id AS member_id, m.name, m.essl_id
       FROM payments p JOIN members m ON m.id=p.member_id WHERE p.status='confirmed' ORDER BY p.paid_on DESC, p.id DESC LIMIT 8`),
    first<{ n: number; total: number }>(c.env.DB, `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE status='pending'`),
    first(c.env.DB, `SELECT sn, name, firmware, last_seen_at, last_seen_via, user_count, fp_count FROM devices WHERE approved=1 ORDER BY last_seen_at DESC LIMIT 1`),
    first<{ pending: number; failed: number }>(c.env.DB,
      `SELECT SUM(status IN ('pending','sent')) AS pending, SUM(status='failed' AND done_at > ?) AS failed FROM device_commands`, addDays(today, -1)),
    first(c.env.DB, `SELECT name, last_seen_at FROM agents ORDER BY last_seen_at DESC LIMIT 1`),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM followups WHERE status='open' AND next_date <= ?`, today),
  ]);

  const newMap = Object.fromEntries(newByMonth.map((r) => [r.ym, r.n]));
  const payMap = Object.fromEntries(monthly.map((r) => [r.ym, r]));
  const months = Array.from({ length: 12 }, (_, i) => addMonths(from12, i).slice(0, 7)).map((ym) => ({
    ym, new_members: newMap[ym] ?? 0, renewals: payMap[ym]?.renewals ?? 0, payments: payMap[ym]?.payments ?? 0, revenue: payMap[ym]?.revenue ?? 0,
  }));

  const dueSoon = list
    .filter((m) => m.status === 'expiring' || m.status === 'near_expiry')
    .sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0))
    .slice(0, 8)
    .map(({ id, name, essl_id, mobile, end_date, days_left, category, duration_label, price }) => ({ id, name, essl_id, mobile, end_date, days_left, category, duration_label, price }));

  const todayVisits = visits.find((v) => v.day === today)?.visitors ?? 0;
  const deniedToday = await all(c.env.DB,
    `SELECT DISTINCT a.essl_id, m.id AS member_id, m.name FROM attendance a JOIN members m ON m.id=a.member_id
     WHERE a.day=? AND m.is_staff=0 AND m.access_override IS NOT 'allow'
       AND COALESCE((SELECT MAX(end_date) FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active'),'0000') < ?`, today, today);

  return {
    today, members, money, pending_claims: pendingClaims, months, due_soon: dueSoon,
    attendance: { today: todayVisits, last14: visits, hourly, expired_but_entered: deniedToday },
    recent_payments: recentPayments, followups_due: followupsDue?.n ?? 0,
    device: { ...(device ?? {}), queue, agent },
  };
}

// ── Renewals & follow-up worklist ───────────────────────────────────────
ops.get('/renewals', async (c) => {
  const s = await getSettings(c.env.DB);
  const window = Number(c.req.query('expiredDays') ?? 60);
  const list = (await listMembers(c.env)).filter(
    (m) => m.status === 'expiring' || m.status === 'near_expiry' || (m.status === 'expired' && (m.days_left ?? -9999) >= -window),
  );
  const last = await all<{ member_id: number; call_date: string; status: string; remarks: string; next_date: string | null }>(c.env.DB,
    `SELECT f.member_id, f.call_date, f.status, f.remarks, f.next_date FROM followups f
     WHERE f.id = (SELECT id FROM followups f2 WHERE f2.member_id=f.member_id ORDER BY call_date DESC, id DESC LIMIT 1)`);
  const lastBy = Object.fromEntries(last.map((f) => [f.member_id, f]));
  list.sort((a, b) => Math.abs(a.days_left ?? 0) - Math.abs(b.days_left ?? 0));
  return c.json({ soon_days: s.reminders.soon_days, members: list.map((m) => ({ ...m, last_followup: lastBy[m.id] ?? null })) });
});

// ── Follow-ups ──────────────────────────────────────────────────────────
const FU_STATUS = ['open', 'converted', 'lost', 'closed'];
const FU_PRIORITY = ['low', 'medium', 'high'];

ops.get('/followups', async (c) => {
  const status = c.req.query('status');
  const rows = await all(c.env.DB,
    `SELECT f.*, m.name, m.essl_id, m.mobile FROM followups f JOIN members m ON m.id=f.member_id
     WHERE (? IS NULL OR f.status=?) ORDER BY COALESCE(f.next_date, f.call_date) DESC, f.id DESC LIMIT 500`, status ?? null, status ?? null);
  return c.json(rows);
});

ops.post('/followups', async (c) => {
  const b = await c.req.json();
  const memberId = int(b.member_id);
  assert(memberId && (await first(c.env.DB, `SELECT 1 FROM members WHERE id=?`, memberId)), 400, 'Member not found');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO followups (member_id, call_date, response, next_date, priority, status, remarks, handled_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    memberId, isDateOrNull(b.call_date) ?? todayFor(c), str(b.response, 200), isDateOrNull(b.next_date),
    FU_PRIORITY.includes(b.priority) ? b.priority : 'medium', FU_STATUS.includes(b.status) ? b.status : 'open', str(b.remarks, 500), c.get('session').name);
  return c.json({ id: r!.id });
});

ops.patch('/followups/:id', async (c) => {
  const b = await c.req.json();
  const f: Record<string, unknown> = {};
  if (FU_STATUS.includes(b.status)) f.status = b.status;
  if (FU_PRIORITY.includes(b.priority)) f.priority = b.priority;
  if ('next_date' in b) f.next_date = isDateOrNull(b.next_date);
  if ('remarks' in b) f.remarks = str(b.remarks, 500);
  if ('response' in b) f.response = str(b.response, 200);
  const keys = Object.keys(f);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE followups SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => f[k]), Number(c.req.param('id')));
  return c.json({ ok: true });
});

// ── Plans ───────────────────────────────────────────────────────────────
ops.get('/plans', async (c) => c.json(await all(c.env.DB, `SELECT * FROM plans ORDER BY active DESC, sort, price`)));

ops.post('/plans', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const name = str(b.name, 80);
  const price = int(b.price);
  const months = Math.max(0, int(b.duration_months) ?? 0);
  const days = Math.max(0, int(b.duration_days) ?? 0);
  assert(name && price !== null && price >= 0, 400, 'Name and price are required');
  assert(months + days > 0, 400, 'Duration is required');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO plans (name, category, duration_months, duration_days, price, sort) VALUES (?, ?, ?, ?, ?, ?) RETURNING id`,
    name, str(b.category, 60) ?? 'Strength', months, days, price, int(b.sort) ?? 100);
  await audit(c.env, actor(c), 'plan.create', 'plan', r!.id, b);
  return c.json({ id: r!.id });
});

ops.patch('/plans/:id', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json();
  const f: Record<string, unknown> = {};
  if ('name' in b) f.name = str(b.name, 80);
  if ('category' in b) f.category = str(b.category, 60);
  if ('price' in b) f.price = Math.max(0, int(b.price) ?? 0);
  if ('duration_months' in b) f.duration_months = Math.max(0, int(b.duration_months) ?? 0);
  if ('duration_days' in b) f.duration_days = Math.max(0, int(b.duration_days) ?? 0);
  if ('active' in b) f.active = b.active ? 1 : 0;
  if ('sort' in b) f.sort = int(b.sort) ?? 0;
  const keys = Object.keys(f);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE plans SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => f[k]), Number(c.req.param('id')));
  await audit(c.env, actor(c), 'plan.update', 'plan', c.req.param('id'), f);
  return c.json({ ok: true });
});

// ── Payments ledger ─────────────────────────────────────────────────────
ops.get('/payments', async (c) => {
  const today = todayFor(c);
  const from = isDateOrNull(c.req.query('from')) ?? `${today.slice(0, 7)}-01`;
  const to = isDateOrNull(c.req.query('to')) ?? today;
  const status = c.req.query('status') ?? 'confirmed';
  const mode = c.req.query('mode') || null;
  const q = (c.req.query('q') ?? '').trim();
  const rows = await all<{ amount: number; mode: string }>(c.env.DB,
    `SELECT p.*, m.name, m.essl_id, m.mobile, pl.name AS request_plan_name FROM payments p JOIN members m ON m.id=p.member_id LEFT JOIN plans pl ON pl.id=p.request_plan_id
     WHERE p.status=? AND (p.status='pending' OR p.paid_on BETWEEN ? AND ?) AND (? IS NULL OR p.mode=?)
       AND (?='' OR m.name LIKE ? OR m.essl_id=? OR m.mobile LIKE ? OR p.receipt_no=?)
     ORDER BY p.paid_on DESC, p.id DESC LIMIT 2000`,
    status, from, to, mode, mode, q, `%${q}%`, q, `%${q}%`, q);
  const byMode: Record<string, number> = {};
  for (const r of rows) byMode[r.mode] = (byMode[r.mode] ?? 0) + r.amount;
  return c.json({ from, to, total: rows.reduce((s, r) => s + r.amount, 0), count: rows.length, by_mode: byMode, payments: rows });
});

/** Approve a member's UPI claim → confirmed with a receipt number. */
ops.post('/payments/:id/confirm', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await first<{ status: string; member_id: number; membership_id: number | null; request_plan_id: number | null; amount: number; coupon_code: string | null }>(
    c.env.DB, `SELECT p.status, p.member_id, p.membership_id, p.request_plan_id, p.amount, cp.code AS coupon_code FROM payments p LEFT JOIN coupons cp ON cp.id=p.coupon_id WHERE p.id=?`, id);
  assert(p?.status === 'pending', 400, 'Only pending payments can be confirmed');
  // A renewal requested from the member app becomes a real term now that the money is in.
  let renewal: Awaited<ReturnType<typeof createTerm>> | null = null;
  if (p.request_plan_id && !p.membership_id) {
    // The member's promo code (reserved when they paid) is applied to the new term.
    renewal = await createTerm(c.env, p.member_id, { plan_id: p.request_plan_id, paid: 0, notes: 'Renewed from member app (UPI)', coupon_code: p.coupon_code ?? undefined },
      'renewal', actor(c), { from: 'app', reservedPaymentId: id });
    await run(c.env.DB, `UPDATE payments SET membership_id=?, entry_type='renewal' WHERE id=?`, renewal.membership_id, id);
  }
  const receipt = await nextReceiptNo(c.env.DB);
  await run(c.env.DB, `UPDATE payments SET status='confirmed', receipt_no=?, handled_by=? WHERE id=?`, receipt, c.get('session').name, id);
  const device_command = renewal ? await syncMember(c.env, p.member_id, actor(c), true) : null;
  await audit(c.env, actor(c), 'payment.confirm', 'payment', id, { receipt, renewal });
  return c.json({ ok: true, receipt_no: receipt, renewal, device_command });
});

ops.post('/payments/:id/reject', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  await run(c.env.DB, `UPDATE payments SET status='rejected', remarks=COALESCE(remarks||' · ','')||?, handled_by=? WHERE id=? AND status='pending'`,
    `Rejected: ${str(b.reason, 200) ?? 'not received'}`, c.get('session').name, id);
  // Release a coupon the member had reserved with this payment.
  await run(c.env.DB, `UPDATE coupon_redemptions SET status='void' WHERE payment_id=? AND status='pending'`, id);
  await audit(c.env, actor(c), 'payment.reject', 'payment', id, b);
  return c.json({ ok: true });
});

/** Void a confirmed payment (owner/admin) — kept for audit, excluded from totals. */
ops.post('/payments/:id/void', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json().catch(() => ({}));
  const reason = str(b.reason, 200);
  assert(reason, 400, 'Give a reason for voiding');
  await run(c.env.DB, `UPDATE payments SET status='rejected', remarks=COALESCE(remarks||' · ','')||? WHERE id=? AND status='confirmed'`, `Voided: ${reason}`, id);
  await audit(c.env, actor(c), 'payment.void', 'payment', id, { reason });
  return c.json({ ok: true });
});

ops.get('/payments/:id/receipt', async (c) => {
  const p = await first(c.env.DB,
    `SELECT p.*, m.name, m.essl_id, m.mobile, ms.category, ms.duration_label, ms.start_date, ms.end_date
     FROM payments p JOIN members m ON m.id=p.member_id LEFT JOIN memberships ms ON ms.id=p.membership_id WHERE p.id=?`, Number(c.req.param('id')));
  assert(p, 404, 'Payment not found');
  const s = await getSettings(c.env.DB);
  return c.json({ payment: p, gym: s.gym });
});

/** Share token for the public receipt page (member app /r/<token>); created once, then reused. */
ops.post('/payments/:id/share', async (c) => {
  const id = Number(c.req.param('id'));
  const p = await first<{ share_token: string | null }>(c.env.DB, `SELECT share_token FROM payments WHERE id=?`, id);
  assert(p, 404, 'Payment not found');
  if (p.share_token) return c.json({ token: p.share_token });
  const token = randomToken(12);
  await run(c.env.DB, `UPDATE payments SET share_token=? WHERE id=? AND share_token IS NULL`, token, id);
  const saved = await first<{ share_token: string }>(c.env.DB, `SELECT share_token FROM payments WHERE id=?`, id);
  return c.json({ token: saved!.share_token });
});

// ── Attendance ──────────────────────────────────────────────────────────
ops.get('/attendance', async (c) => {
  const day = isDateOrNull(c.req.query('date')) ?? todayFor(c);
  // Today's list refreshes within 20 s (members are scanning in); past days hardly change (1 h).
  return c.json(await cachedView(c.env, `attendance:${day}`, day === todayFor(c) ? 20_000 : 3_600_000, () => attendanceDay(c, day)));
});

async function attendanceDay(c: { env: AppEnv['Bindings'] }, day: string) {
  const s = await getSettings(c.env.DB);
  // Match by device ID at read time (punches may predate the member record), and fall back to
  // the device roster / eTimeTrack name for staff and people who are not members in the app.
  const rows = await all<{ essl_id: string; member_id: number | null; name: string | null; is_staff: number | null }>(c.env.DB,
    `SELECT a.essl_id, m.id AS member_id,
            COALESCE(m.name, du.name, et.name) AS name, m.is_staff,
            MIN(a.punched_at) AS first_in, MAX(a.punched_at) AS last_punch, COUNT(*) AS punches,
            (SELECT MAX(end_date) FROM memberships ms WHERE ms.member_id=m.id AND ms.status='active') AS end_date
     FROM attendance a
     LEFT JOIN members m ON m.id = COALESCE(a.member_id, (SELECT id FROM members x WHERE x.essl_id=a.essl_id AND x.archived=0))
     LEFT JOIN device_users du ON du.essl_id=a.essl_id
     LEFT JOIN etimetrack_employees et ON et.code=a.essl_id
     WHERE a.day=? GROUP BY a.essl_id ORDER BY first_in DESC`, day);
  const staff = (id: string) => s.access.staff_prefixes.some((p) => id.toUpperCase().startsWith(p.toUpperCase()));
  return { date: day, visitors: rows.length, rows: rows.map((r) => ({ ...r, is_staff: r.is_staff ?? (staff(r.essl_id) ? 1 : 0) })) };
}

ops.get('/attendance/report', async (c) => {
  const today = todayFor(c);
  const from = isDateOrNull(c.req.query('from')) ?? addDays(today, -29);
  const to = isDateOrNull(c.req.query('to')) ?? today;
  // 30-day statistics: 5 min of staleness is invisible here, and saves thousands of rows per open.
  return c.json(await cachedView(c.env, `attendance-report:${from}:${to}`, 300_000, async () => {
  const [daily, top, inactive] = await Promise.all([
    all(c.env.DB, `SELECT day, COUNT(DISTINCT essl_id) AS visitors, COUNT(*) AS punches FROM attendance WHERE day BETWEEN ? AND ? GROUP BY day ORDER BY day`, from, to),
    all(c.env.DB, `SELECT m.id, m.name, m.essl_id, COUNT(DISTINCT a.day) AS days FROM attendance a JOIN members m ON m.id=a.member_id
                   WHERE a.day BETWEEN ? AND ? AND m.is_staff=0 GROUP BY m.id ORDER BY days DESC LIMIT 15`, from, to),
    all(c.env.DB, `SELECT m.id, m.name, m.essl_id, m.mobile, (SELECT MAX(day) FROM attendance a WHERE a.member_id=m.id) AS last_visit
                   FROM members m JOIN v_current_membership cm ON cm.member_id=m.id
                   WHERE m.archived=0 AND m.is_staff=0 AND cm.end_date >= ?
                     AND COALESCE((SELECT MAX(day) FROM attendance a WHERE a.member_id=m.id),'0000') < ? ORDER BY last_visit LIMIT 50`, today, addDays(today, -10)),
  ]);
  return { from, to, daily, top, inactive_active_members: inactive };
  }));
});

ops.post('/attendance/manual', async (c) => {
  const b = await c.req.json();
  const m = await first<{ id: number; essl_id: string | null }>(c.env.DB, `SELECT id, essl_id FROM members WHERE id=?`, int(b.member_id));
  assert(m, 404, 'Member not found');
  const day = isDateOrNull(b.date) ?? todayFor(c);
  const time = /^\d{2}:\d{2}$/.test(b.time ?? '') ? b.time : new Date(Date.now() + tzOffset(c.env) * 60_000).toISOString().slice(11, 16);
  const iso = `${day}T${time}:00${offsetSuffix(tzOffset(c.env))}`;
  await run(c.env.DB, `INSERT OR IGNORE INTO attendance (essl_id, member_id, punched_at, day, source) VALUES (?, ?, ?, ?, 'manual')`,
    m.essl_id ?? `M${m.id}`, m.id, iso, day);
  await audit(c.env, actor(c), 'attendance.manual', 'member', m.id, { iso });
  return c.json({ ok: true });
});

// ── Announcements ───────────────────────────────────────────────────────
ops.get('/announcements', async (c) => c.json(await all(c.env.DB, `SELECT * FROM announcements ORDER BY pinned DESC, id DESC LIMIT 100`)));
ops.post('/announcements', async (c) => {
  const b = await c.req.json();
  const title = str(b.title, 120);
  assert(title, 400, 'Title is required');
  const r = await first<{ id: number }>(c.env.DB, `INSERT INTO announcements (title, body, pinned, created_by) VALUES (?, ?, ?, ?) RETURNING id`,
    title, str(b.body, 2000), b.pinned ? 1 : 0, c.get('session').name);
  return c.json({ id: r!.id });
});
ops.patch('/announcements/:id', async (c) => {
  const b = await c.req.json();
  await run(c.env.DB, `UPDATE announcements SET title=COALESCE(?,title), body=COALESCE(?,body), pinned=COALESCE(?,pinned), published=COALESCE(?,published) WHERE id=?`,
    str(b.title, 120), str(b.body, 2000), typeof b.pinned === 'boolean' ? (b.pinned ? 1 : 0) : null,
    typeof b.published === 'boolean' ? (b.published ? 1 : 0) : null, Number(c.req.param('id')));
  return c.json({ ok: true });
});
ops.delete('/announcements/:id', async (c) => {
  await run(c.env.DB, `DELETE FROM announcements WHERE id=?`, Number(c.req.param('id')));
  return c.json({ ok: true });
});

// ── Settings ────────────────────────────────────────────────────────────
ops.get('/settings', async (c) => c.json(await getSettings(c.env.DB)));
/** Models the AI coach can use (Settings → AI coach models). */
ops.get('/ai-models', (c) => c.json({ models: MODEL_CATALOG }));

ops.put('/settings/:key', requireAdmin('owner', 'admin'), async (c) => {
  const key = c.req.param('key') as keyof GymSettings;
  const b = await c.req.json();
  const cur = await getSettings(c.env.DB);
  let value: unknown;
  switch (key) {
    case 'gym':
      value = { name: str(b.name, 80) ?? cur.gym.name, tagline: str(b.tagline, 160) ?? '', phone: str(b.phone, 20) ?? '', address: str(b.address, 300) ?? '' };
      break;
    case 'upi':
      assert(!b.vpa || /^[\w.\-]{2,256}@[a-zA-Z]{2,64}$/.test(b.vpa), 400, 'Enter a valid UPI ID like gym@okicici');
      value = { vpa: str(b.vpa, 120) ?? '', payee: str(b.payee, 80) ?? cur.gym.name };
      break;
    case 'access': {
      const enabling = b.auto_enforce === true && !cur.access.auto_enforce;
      assert(!enabling || c.get('session').role === 'owner', 403, 'Only the owner can switch on automatic blocking');
      value = {
        grace_days: Math.min(30, Math.max(0, int(b.grace_days) ?? cur.access.grace_days)),
        staff_prefixes: Array.isArray(b.staff_prefixes) ? b.staff_prefixes.map((p: unknown) => String(p).trim().toUpperCase()).filter(Boolean).slice(0, 10) : cur.access.staff_prefixes,
        block_method: 'remove', // verified on the X990: group changes do not deny access
        auto_enforce: typeof b.auto_enforce === 'boolean' ? b.auto_enforce : cur.access.auto_enforce,
      };
      break;
    }
    case 'reminders':
      value = { near_days: Math.min(90, Math.max(1, int(b.near_days) ?? 30)), soon_days: Math.min(30, Math.max(1, int(b.soon_days) ?? 7)) };
      break;
    case 'renewal_push': {
      const title = str(b.title, 120) ?? cur.renewal_push.title;
      const message = str(b.message, 300) ?? cur.renewal_push.message;
      value = {
        enabled: typeof b.enabled === 'boolean' ? b.enabled : cur.renewal_push.enabled,
        days_before: Math.min(30, Math.max(1, int(b.days_before) ?? cur.renewal_push.days_before)),
        send_hour: Math.min(23, Math.max(0, int(b.send_hour) ?? cur.renewal_push.send_hour)),
        title, message,
        motivation: Array.isArray(b.motivation)
          ? b.motivation.map((x: unknown) => str(x, 160)).filter((x: string | null): x is string => !!x).slice(0, 30)
          : cur.renewal_push.motivation,
      };
      break;
    }
    case 'ai_models': {
      // Model order per purpose; 'same' = one list (diet's) used for both.
      const same = typeof b.same === 'boolean' ? b.same : cur.ai_models.same;
      const diet = cleanModelList(b.diet ?? cur.ai_models.diet);
      value = { same, diet, workout: same ? diet : cleanModelList(b.workout ?? cur.ai_models.workout) };
      break;
    }
    case 'weight_push': {
      const w = cur.weight_push;
      const lines = (v: unknown, dflt: string[]) => Array.isArray(v)
        ? v.map((x: unknown) => str(x, 160)).filter((x: string | null): x is string => !!x).slice(0, 20)
        : dflt;
      value = {
        enabled: typeof b.enabled === 'boolean' ? b.enabled : w.enabled,
        weekday: Math.min(6, Math.max(0, int(b.weekday) ?? w.weekday)),
        send_hour: Math.min(23, Math.max(0, int(b.send_hour) ?? w.send_hour)),
        due_title: str(b.due_title, 120) ?? w.due_title,
        due_message: str(b.due_message, 300) ?? w.due_message,
        on_track: lines(b.on_track, w.on_track),
        off_track: lines(b.off_track, w.off_track),
        reached: lines(b.reached, w.reached),
      };
      break;
    }
    case 'receipt':
      assert(c.get('session').role === 'owner', 403, 'Only the owner can change receipt numbering');
      value = { prefix: (str(b.prefix, 8) ?? 'CG').toUpperCase(), next: Math.max(1, int(b.next) ?? cur.receipt.next) };
      break;
    default:
      assert(false, 404, 'Unknown setting');
  }
  await putSetting(c.env.DB, key, value);
  // Staff flag follows the prefix list
  if (key === 'access') {
    const prefixes = (value as GymSettings['access']).staff_prefixes;
    await run(c.env.DB, `UPDATE members SET is_staff = CASE WHEN ${prefixes.map(() => 'upper(essl_id) LIKE ?').join(' OR ') || '0'} THEN 1 ELSE is_staff END`,
      ...prefixes.map((p) => `${p}%`));
  }
  await audit(c.env, actor(c), 'settings.update', 'settings', key, value);
  return c.json({ ok: true, value });
});

// ── Renewal reminders (phone push) ──────────────────────────────────────
/** Who would get today's reminder, and what it looks like. */
ops.get('/renewal-push', async (c) => {
  const s = await getSettings(c.env.DB);
  const today = todayFor(c);
  const targets = await renewalTargets(c.env, s.renewal_push, today);
  const members = [...new Map(targets.map((t) => [t.member_id, t])).values()].sort((a, b) => a.end_date.localeCompare(b.end_date));
  const sample = members[0] ?? { name: 'Ravi Kumar', end_date: addDays(today, Math.min(3, s.renewal_push.days_before)) };
  return c.json({
    push_ready: pushConfigured(c.env),
    log: s.renewal_push_log,
    due_today: members.slice(0, 50).map((m) => ({ member_id: m.member_id, name: m.name, end_date: m.end_date })),
    due_count: members.length,
    preview: renderReminder(s.renewal_push, s.gym.name, sample, today),
  });
});

/** Send today's reminders now (members already reminded today are skipped). */
ops.post('/renewal-push/send', requireAdmin('owner', 'admin'), async (c) => {
  const r = await sendRenewalReminders(c.env, { force: true });
  assert(!('skipped' in r), 400, `Not sent: ${'skipped' in r ? r.skipped : ''}`);
  await audit(c.env, actor(c), 'renewal_push.send', 'settings', 'renewal_push', r);
  return c.json(r);
});

// ── Weekly weigh-in reminders (phone push) ──────────────────────────────
/** Who would get a weigh-in reminder if sent now, and a preview per status. */
ops.get('/weight-push', async (c) => {
  const s = await getSettings(c.env.DB);
  const today = todayFor(c);
  const targets = await weightTargets(c.env, today);
  const members = [...new Map(targets.map((t) => [t.member_id, t])).values()];
  const sample = (status: WeightTrend['status'], extra: Partial<WeightTrend>) =>
    renderWeightNudge(s.weight_push, s.gym.name, members[0]?.name ?? 'Ravi Kumar',
      { ...weightTrend([], { start_weight_kg: 84, target_weight_kg: 74, goal: 'lose_weight' }, today), status, current: 80.4, start: 84, target: 74, change_total: -3.6, to_go: 6.4, ...extra }, today);
  return c.json({
    push_ready: pushConfigured(c.env),
    log: s.weight_push_log,
    due_now: members.slice(0, 50).map((m) => ({ member_id: m.member_id, name: m.name })),
    due_count: members.length,
    preview: { on_track: sample('on_track', {}), off_track: sample('off_track', { change_total: 0.8, current: 84.8, to_go: 10.8 }), reached: sample('reached', { current: 73.8, to_go: 0 }) },
  });
});

ops.post('/weight-push/send', requireAdmin('owner', 'admin'), async (c) => {
  const r = await sendWeightReminders(c.env, { force: true });
  assert(!('skipped' in r), 400, `Not sent: ${'skipped' in r ? r.skipped : ''}`);
  await audit(c.env, actor(c), 'weight_push.send', 'settings', 'weight_push', r);
  return c.json(r);
});

ops.get('/audit', requireAdmin('owner', 'admin'), async (c) =>
  c.json(await all(c.env.DB, `SELECT * FROM audit_log ORDER BY id DESC LIMIT 300`)));

// ── Exports (CSV) ───────────────────────────────────────────────────────
function csv(rows: Record<string, unknown>[], cols: string[]): string {
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formulas
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return '﻿' + [cols.join(','), ...rows.map((r) => cols.map((k) => esc(r[k])).join(','))].join('\n');
}

ops.get('/export/:what', requireAdmin('owner', 'admin'), async (c) => {
  const what = c.req.param('what');
  let body = '';
  if (what === 'members.csv') {
    const list = await listMembers(c.env);
    body = csv(list as unknown as Record<string, unknown>[], ['essl_id', 'name', 'mobile', 'gender', 'join_date', 'category', 'duration_label', 'start_date', 'end_date', 'days_left', 'status', 'price', 'due', 'last_visit', 'device_state']);
  } else if (what === 'payments.csv') {
    const rows = await all(c.env.DB, `SELECT p.paid_on, p.receipt_no, m.essl_id, m.name, m.mobile, p.amount, p.mode, p.entry_type, p.reference, p.status, p.handled_by, p.remarks
      FROM payments p JOIN members m ON m.id=p.member_id ORDER BY p.paid_on, p.id`);
    body = csv(rows, ['paid_on', 'receipt_no', 'essl_id', 'name', 'mobile', 'amount', 'mode', 'entry_type', 'reference', 'status', 'handled_by', 'remarks']);
  } else if (what === 'attendance.csv') {
    const from = isDateOrNull(c.req.query('from')) ?? addDays(todayFor(c), -30);
    const rows = await all(c.env.DB, `SELECT a.day, a.punched_at, a.essl_id, m.name, a.source FROM attendance a LEFT JOIN members m ON m.id=a.member_id WHERE a.day >= ? ORDER BY a.punched_at`, from);
    body = csv(rows, ['day', 'punched_at', 'essl_id', 'name', 'source']);
  } else {
    assert(false, 404, 'Unknown export');
  }
  return new Response(body, {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="challenge-gym-${todayFor(c)}-${what}"` },
  });
});

// ── Files (R2) — member photos / payment proofs, admin-only read ─────────
ops.get('/files/*', async (c) => {
  assert(c.env.FILES, 503, 'File storage is not configured');
  const key = c.req.path.replace(/^.*\/files\//, '');
  assert(/^(photos|proofs)\/[\w.\-]+$/.test(key), 400, 'Bad file key');
  const obj = await c.env.FILES!.get(key);
  assert(obj, 404, 'File not found');
  // Every upload gets a new key, so a stored file never changes: let the browser keep it.
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
    'Cache-Control': key.startsWith('photos/') ? 'private, max-age=2592000, immutable' : 'private, max-age=3600' } });
});

// ── Access preview (what auto-enforce would do right now) ───────────────
ops.get('/access/preview', async (c) => c.json(await planReconcile(c.env)));
ops.post('/access/apply', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const r = await reconcile(c.env, { force: true, by: actor(c), limit: Math.min(int(b.limit) ?? 200, 500) });
  await audit(c.env, actor(c), 'access.apply', 'device', undefined, r);
  return c.json(r);
});
