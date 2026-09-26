// Excel master-sheet import. The admin app parses GYM_Membership_System.xlsx in the browser
// and sends normalised rows in chunks. Idempotent: re-importing an updated sheet only adds
// what is new (members matched by device ID, terms by start date, payments by date+amount).
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, audit, getSettings, isDateOrNull, mobile, relinkAttendance, str } from '../../lib/db';
import { isStaffCode } from '../../lib/membership';

export const importer = new Hono<AppEnv>();
importer.use('*', requireAdmin('owner', 'admin'));

interface SheetMember {
  row: number; essl_id: string; name: string; mobile?: string; gender?: string; join_date?: string;
  start_date?: string; end_date?: string; category?: string; duration_label?: string;
  total?: number; paid?: number; pending?: number; pt?: boolean; pt_amount?: number;
}
interface SheetPayment { essl_id: string; name?: string; paid_on: string; amount: number; mode?: string; receipt_no?: string; entry_type?: string; remarks?: string; ref?: string }
interface SheetFollowup { essl_id: string; name?: string; call_date: string; response?: string; next_date?: string; priority?: string; status?: string; remarks?: string; handled_by?: string }

const norm = (s: string | null | undefined) => (s ?? '').toLowerCase().replace(/[^a-z]/g, '');
const MODES: Record<string, string> = { cash: 'cash', upi: 'upi', gpay: 'upi', phonepe: 'upi', paytm: 'upi', card: 'card', bank: 'bank', neft: 'bank' };

importer.post('/excel', async (c) => {
  const b = await c.req.json();
  const commit = b.commit === true;
  const sheetMembers: SheetMember[] = (b.members ?? []).slice(0, 400);
  const sheetPayments: SheetPayment[] = (b.payments ?? []).slice(0, 2000);
  const sheetFollowups: SheetFollowup[] = (b.followups ?? []).slice(0, 2000);
  const by = actor(c);
  const s = await getSettings(c.env.DB);

  const [existing, terms, pays, fus, deviceUsers] = await Promise.all([
    all<{ id: number; essl_id: string | null; name: string; mobile: string | null; gender: string | null }>(c.env.DB, `SELECT id, essl_id, name, mobile, gender FROM members WHERE archived=0`),
    all<{ id: number; member_id: number; start_date: string }>(c.env.DB, `SELECT id, member_id, start_date FROM memberships`),
    all<{ member_id: number; paid_on: string; amount: number }>(c.env.DB, `SELECT member_id, paid_on, amount FROM payments`),
    all<{ member_id: number; call_date: string; remarks: string | null }>(c.env.DB, `SELECT member_id, call_date, remarks FROM followups`),
    all<{ essl_id: string; name: string }>(c.env.DB, `SELECT essl_id, name FROM device_users`),
  ]);
  const deviceName = new Map(deviceUsers.map((d) => [d.essl_id, d.name]));
  const byEssl = new Map(existing.filter((m) => m.essl_id).map((m) => [m.essl_id!, m]));
  const byNameMobile = new Map(existing.map((m) => [`${norm(m.name)}|${m.mobile ?? ''}`, m]));

  const report = {
    commit, members_new: 0, members_updated: 0, terms_new: 0, payments_new: 0, followups_new: 0, dues_adjusted: 0,
    shared_ids: [] as { essl_id: string; kept: string; separated: string[] }[],
    no_end_date: [] as { essl_id: string; name: string }[],
    not_on_device: [] as string[],
  };

  // 1. Resolve shared device IDs: the person whose name matches the device roster keeps the PIN.
  const groups = new Map<string, SheetMember[]>();
  for (const m of sheetMembers) {
    if (!m.essl_id || !m.name) continue;
    groups.set(m.essl_id, [...(groups.get(m.essl_id) ?? []), m]);
  }
  interface Plan { sheet: SheetMember; essl: string | null; memberId: number | null; note?: string }
  const plans: Plan[] = [];
  for (const [essl, rows] of groups) {
    let keeper = rows[0];
    if (rows.length > 1) {
      const dn = norm(deviceName.get(essl));
      keeper = rows.find((r) => dn && (norm(r.name).includes(dn) || dn.includes(norm(r.name)))) ?? rows[0];
      report.shared_ids.push({ essl_id: essl, kept: keeper.name, separated: rows.filter((r) => r !== keeper).map((r) => r.name) });
    }
    for (const r of rows) {
      const isKeeper = r === keeper;
      const found = isKeeper ? byEssl.get(essl) ?? byNameMobile.get(`${norm(r.name)}|${mobile(r.mobile) ?? ''}`) : byNameMobile.get(`${norm(r.name)}|${mobile(r.mobile) ?? ''}`);
      plans.push({ sheet: r, essl: isKeeper ? essl : null, memberId: found?.id ?? null,
        note: isKeeper ? undefined : `Shares device ID ${essl} with ${keeper.name} in the Excel sheet — assign a new ID and enrol on the device.` });
      if (deviceUsers.length && isKeeper && !deviceName.has(essl)) report.not_on_device.push(essl);
    }
  }

  // 2. Members: insert new, update changed basics.
  const inserts = plans.filter((p) => !p.memberId);
  const updates = plans.filter((p) => p.memberId);
  report.members_new = inserts.length;
  report.members_updated = updates.length;
  if (commit && inserts.length) {
    const res = await c.env.DB.batch<{ id: number }>(inserts.map((p) => c.env.DB.prepare(
      `INSERT INTO members (essl_id, name, mobile, gender, join_date, notes, is_staff, device_state) VALUES (?, ?, ?, ?, ?, ?, ?, 'unknown') RETURNING id`,
    ).bind(p.essl, p.sheet.name.slice(0, 80), mobile(p.sheet.mobile), p.sheet.gender ?? null, isDateOrNull(p.sheet.join_date) ?? isDateOrNull(p.sheet.start_date),
      p.note ?? null, isStaffCode(p.essl, s.access.staff_prefixes) ? 1 : 0)));
    res.forEach((r, i) => { inserts[i].memberId = r.results?.[0]?.id ?? null; });
  }
  const stmts: D1PreparedStatement[] = [];
  if (commit) {
    for (const p of updates) {
      stmts.push(c.env.DB.prepare(
        `UPDATE members SET name=?, mobile=COALESCE(?, mobile), gender=COALESCE(?, gender), join_date=COALESCE(join_date, ?), updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=?`,
      ).bind(p.sheet.name.slice(0, 80), mobile(p.sheet.mobile), p.sheet.gender ?? null, isDateOrNull(p.sheet.join_date), p.memberId));
    }
  }

  // 3. Payments grouped per resolved member (by ID, then name for shared IDs)
  const planFor = (essl: string, name?: string) => {
    const cands = plans.filter((p) => p.sheet.essl_id === essl);
    if (cands.length <= 1) return cands[0];
    return cands.find((p) => norm(p.sheet.name) === norm(name)) ?? cands.find((p) => p.essl === essl);
  };
  const payKey = new Set(pays.map((p) => `${p.member_id}|${p.paid_on}|${p.amount}`));
  const termStarts = new Set(terms.map((t) => `${t.member_id}|${t.start_date}`));

  // 4. Terms (membership rows). Dues made to equal the sheet's Pending column.
  const termStmts: { plan: Plan; stmt: D1PreparedStatement }[] = [];
  for (const p of plans) {
    const m = p.sheet;
    if (!m.end_date || !m.start_date) { report.no_end_date.push({ essl_id: m.essl_id, name: m.name }); continue; }
    if (p.memberId && termStarts.has(`${p.memberId}|${m.start_date}`)) continue;
    report.terms_new++;
    const total = Math.max(0, Math.round(m.total ?? 0));
    const pending = Math.max(0, Math.round(m.pending ?? 0));
    const linkedPaid = sheetPayments
      .filter((x) => planFor(x.essl_id, x.name) === p && x.paid_on >= m.start_date!)
      .reduce((sum, x) => sum + Math.round(x.amount), 0);
    let price = total;
    if (total - linkedPaid !== pending) { price = linkedPaid + pending; report.dues_adjusted++; }
    if (commit && p.memberId) {
      termStmts.push({ plan: p, stmt: c.env.DB.prepare(
        `INSERT INTO memberships (member_id, category, duration_label, start_date, end_date, price, pt_included, pt_amount, kind, notes, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'import', ?, ?) RETURNING id, member_id, start_date`,
      ).bind(p.memberId, m.category ?? null, m.duration_label ?? null, m.start_date, m.end_date, price, m.pt ? 1 : 0, Math.round(m.pt_amount ?? 0),
        price !== total ? `Imported from sheet row ${m.row}; sheet total ₹${total}, pending ₹${pending}` : `Imported from sheet row ${m.row}`, by) });
    }
  }
  if (commit) {
    for (let i = 0; i < stmts.length; i += 80) await c.env.DB.batch(stmts.slice(i, i + 80));
    for (let i = 0; i < termStmts.length; i += 80) {
      const res = await c.env.DB.batch<{ id: number; member_id: number; start_date: string }>(termStmts.slice(i, i + 80).map((t) => t.stmt));
      res.forEach((r) => { const t = r.results?.[0]; if (t) terms.push(t); });
    }
  }

  // 5. Payments linked to the latest term that started on/before the payment date
  const payStmts: D1PreparedStatement[] = [];
  for (const x of sheetPayments) {
    const p = planFor(x.essl_id, x.name);
    if (!p?.memberId && commit) continue;
    const amount = Math.round(x.amount);
    if (!(amount > 0) || !isDateOrNull(x.paid_on)) continue;
    const key = `${p?.memberId}|${x.paid_on}|${amount}`;
    if (p?.memberId && payKey.has(key)) continue;
    payKey.add(key);
    report.payments_new++;
    if (!commit || !p?.memberId) continue;
    const term = terms.filter((t) => t.member_id === p.memberId && t.start_date <= x.paid_on).sort((a, b) => b.start_date.localeCompare(a.start_date))[0];
    const receipt = x.receipt_no && !/^[—\-–]+$/.test(x.receipt_no) ? x.receipt_no.slice(0, 40) : null;
    const remarks = [x.remarks && !/^[—\-–]+$/.test(x.remarks) ? x.remarks : null, x.ref ? `Sheet #${x.ref}` : null].filter(Boolean).join(' · ');
    payStmts.push(c.env.DB.prepare(
      `INSERT INTO payments (member_id, membership_id, amount, mode, paid_on, receipt_no, entry_type, status, handled_by, remarks)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?) ON CONFLICT(receipt_no) DO NOTHING`,
    ).bind(p.memberId, term?.id ?? null, amount, MODES[norm(x.mode)] ?? 'cash', x.paid_on, receipt, x.entry_type === 'Renewal' ? 'renewal' : 'new',
      'Excel import', remarks || null));
  }
  if (commit) for (let i = 0; i < payStmts.length; i += 80) await c.env.DB.batch(payStmts.slice(i, i + 80));

  // 6. Follow-ups
  const fuKey = new Set(fus.map((f) => `${f.member_id}|${f.call_date}|${f.remarks ?? ''}`));
  const fuStmts: D1PreparedStatement[] = [];
  const STATUS: Record<string, string> = { open: 'open', lost: 'lost', converted: 'converted', renewed: 'converted', closed: 'closed', done: 'closed' };
  for (const f of sheetFollowups) {
    const p = planFor(f.essl_id, f.name);
    if (!isDateOrNull(f.call_date)) continue;
    const remarks = str(f.remarks, 500) ?? '';
    if (p?.memberId && fuKey.has(`${p.memberId}|${f.call_date}|${remarks}`)) continue;
    report.followups_new++;
    if (!commit || !p?.memberId) continue;
    fuKey.add(`${p.memberId}|${f.call_date}|${remarks}`);
    fuStmts.push(c.env.DB.prepare(
      `INSERT INTO followups (member_id, call_date, response, next_date, priority, status, remarks, handled_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(p.memberId, f.call_date, str(f.response, 200), isDateOrNull(f.next_date), ['low', 'medium', 'high'].includes(norm(f.priority)) ? norm(f.priority) : 'medium',
      STATUS[norm(f.status)] ?? 'open', remarks || null, str(f.handled_by, 60) ?? 'Admin'));
  }
  if (commit) for (let i = 0; i < fuStmts.length; i += 80) await c.env.DB.batch(fuStmts.slice(i, i + 80));

  if (commit) await relinkAttendance(c.env.DB);
  if (commit) await audit(c.env, by, 'import.excel', 'import', undefined, { ...report, shared_ids: report.shared_ids.length, no_end_date: report.no_end_date.length });
  return c.json(report);
});
