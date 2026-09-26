// Member self-service API. Every query is scoped to the signed-in member (session.mid);
// there is no route that takes another member's id.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { tzOffset } from '../../env';
import { requireMember } from '../../lib/auth';
import { all, assert, first, getSettings, int, isDateOrNull, nowIso, run, str } from '../../lib/db';
import { addDays, monthRange, today as todayOf } from '../../lib/dates';
import { getMemberSummary } from '../../lib/members';
import { priceTerm, recordPayment } from '../../lib/terms';

export const me = new Hono<AppEnv>();
me.use('*', requireMember());

const mid = (c: { get: (k: 'session') => { mid: number | null } }) => c.get('session').mid!;

/** Home: profile, current plan, status, dues, door access, visit stats, gym info. */
me.get('/', async (c) => {
  const id = mid(c);
  const today = todayOf(tzOffset(c.env));
  const [s, m, settings, visits, pending] = await Promise.all([
    getMemberSummary(c.env, id),
    first<Record<string, unknown>>(c.env.DB, `SELECT id, essl_id, name, mobile, gender, dob, email, address, emergency_contact, join_date, photo_key, frozen_from, frozen_until FROM members WHERE id=?`, id),
    getSettings(c.env.DB),
    all<{ day: string }>(c.env.DB, `SELECT DISTINCT day FROM attendance WHERE member_id=? AND day >= ? ORDER BY day DESC`, id, addDays(today, -120)),
    first<{ n: number; total: number }>(c.env.DB, `SELECT COUNT(*) AS n, COALESCE(SUM(amount),0) AS total FROM payments WHERE member_id=? AND status='pending'`, id),
  ]);
  assert(s && m, 404, 'Member not found');

  // Streak = consecutive days (ending today or yesterday) with a visit
  const set = new Set(visits.map((v) => v.day));
  let streak = 0;
  let d = set.has(today) ? today : addDays(today, -1);
  while (set.has(d)) { streak++; d = addDays(d, -1); }
  const weekStart = addDays(today, -((new Date(today + 'T00:00:00Z').getUTCDay() + 6) % 7)); // Monday
  const thisMonth = today.slice(0, 7);

  return c.json({
    today,
    member: m,
    plan: {
      status: s.status, days_left: s.days_left, pct_elapsed: s.pct_elapsed, start_date: s.start_date, end_date: s.end_date,
      category: s.category, duration_label: s.duration_label, price: s.price, due: s.due, pt: !!s.pt_included,
    },
    door: { allowed: s.access, reason: doorReason(s) },
    visits: {
      today: set.has(today),
      streak,
      this_week: visits.filter((v) => v.day >= weekStart).length,
      this_month: visits.filter((v) => v.day.startsWith(thisMonth)).length,
      last_visit: visits[0]?.day ?? null,
    },
    pending_payments: pending,
    gym: { name: settings.gym.name, tagline: settings.gym.tagline, phone: settings.gym.phone, address: settings.gym.address },
    upi: settings.upi.vpa ? settings.upi : null,
    reminders: settings.reminders,
  });
});

function doorReason(s: NonNullable<Awaited<ReturnType<typeof getMemberSummary>>>): string {
  if (s.access_override === 'deny') return 'Door access is paused by the gym. Please visit the front desk.';
  if (s.status === 'staff') return 'Staff access';
  if (s.status === 'frozen') return 'Membership frozen';
  if (s.status === 'none') return 'No active plan';
  if (!s.access) return 'Membership expired — renew to open the door again';
  if (s.access_override === 'allow' && s.status === 'expired') return 'Temporary access allowed by the gym';
  return 'Scan your finger at the door';
}

me.patch('/', async (c) => {
  const b = await c.req.json();
  const f: Record<string, unknown> = {};
  if ('gender' in b) f.gender = ['male', 'female', 'other'].includes(b.gender) ? b.gender : null;
  if ('dob' in b) f.dob = isDateOrNull(b.dob);
  if ('email' in b) {
    const e = str(b.email, 120);
    assert(!e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), 400, 'Enter a valid email');
    f.email = e;
  }
  if ('address' in b) f.address = str(b.address, 300);
  if ('emergency_contact' in b) f.emergency_contact = str(b.emergency_contact, 80);
  // Name, mobile and member ID are changed only by the front desk (they identify the member).
  const keys = Object.keys(f);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE members SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=? WHERE id=?`, ...keys.map((k) => f[k]), nowIso(), mid(c));
  return c.json({ ok: true });
});

me.get('/attendance', async (c) => {
  const today = todayOf(tzOffset(c.env));
  const ym = /^\d{4}-\d{2}$/.test(c.req.query('month') ?? '') ? c.req.query('month')! : today.slice(0, 7);
  const { from, to } = monthRange(ym);
  const days = await all<{ day: string; first_in: string; last_out: string; punches: number }>(c.env.DB,
    `SELECT day, MIN(punched_at) AS first_in, MAX(punched_at) AS last_out, COUNT(*) AS punches
     FROM attendance WHERE member_id=? AND day BETWEEN ? AND ? GROUP BY day ORDER BY day DESC`, mid(c), from, to);
  const first12 = await all<{ ym: string; n: number }>(c.env.DB,
    `SELECT substr(day,1,7) AS ym, COUNT(DISTINCT day) AS n FROM attendance WHERE member_id=? AND day >= ? GROUP BY ym ORDER BY ym`,
    mid(c), addDays(today, -365));
  return c.json({ month: ym, days, monthly: first12 });
});

me.get('/plan', async (c) => {
  const id = mid(c);
  const [memberships, plans, pending] = await Promise.all([
    all(c.env.DB, `SELECT ms.id, ms.category, ms.duration_label, ms.start_date, ms.end_date, ms.price, ms.kind, ms.status, d.paid, d.due
                   FROM memberships ms LEFT JOIN v_membership_dues d ON d.membership_id=ms.id
                   WHERE ms.member_id=? AND ms.status='active' ORDER BY ms.start_date DESC`, id),
    all(c.env.DB, `SELECT id, name, category, duration_months, duration_days, price FROM plans WHERE active=1 ORDER BY sort, price`),
    first(c.env.DB, `SELECT p.id, p.amount, p.paid_on, pl.name AS plan_name FROM payments p LEFT JOIN plans pl ON pl.id=p.request_plan_id
                     WHERE p.member_id=? AND p.status='pending' AND p.request_plan_id IS NOT NULL ORDER BY p.id DESC LIMIT 1`, id),
  ]);
  return c.json({ memberships, plans, pending_renewal: pending });
});

me.get('/payments', async (c) => {
  const rows = await all(c.env.DB,
    `SELECT p.id, p.amount, p.mode, p.paid_on, p.receipt_no, p.reference, p.entry_type, p.status, p.remarks, pl.name AS request_plan_name,
            ms.category, ms.duration_label, ms.start_date, ms.end_date
     FROM payments p LEFT JOIN plans pl ON pl.id=p.request_plan_id LEFT JOIN memberships ms ON ms.id=p.membership_id
     WHERE p.member_id=? ORDER BY p.paid_on DESC, p.id DESC LIMIT 200`, mid(c));
  return c.json(rows);
});

/**
 * "I paid by UPI": records a pending payment for the front desk to verify.
 * With plan_id it is a renewal request — confirming it renews the plan and restores door access.
 */
me.post('/payments', async (c) => {
  const b = await c.req.json();
  const id = mid(c);
  const amount = int(b.amount);
  assert(amount && amount > 0 && amount <= 100000, 400, 'Enter the amount you paid');
  const reference = str(b.reference, 40);
  assert(reference && /^[A-Za-z0-9-]{6,40}$/.test(reference), 400, 'Enter the UPI transaction / UTR number from your payment app');
  const dup = await first(c.env.DB, `SELECT 1 FROM payments WHERE reference=? AND status<>'rejected'`, reference);
  assert(!dup, 409, 'This transaction ID was already submitted');
  const open = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM payments WHERE member_id=? AND status='pending'`, id);
  assert((open?.n ?? 0) < 3, 429, 'You already have payments waiting for confirmation. Please wait for the front desk.');

  let planId: number | null = null;
  let remarks = 'Paid via member app (UPI)';
  let couponId: number | null = null;
  let couponDiscount = 0;
  if (b.plan_id) {
    const plan = await first<{ id: number; name: string; price: number }>(c.env.DB, `SELECT id, name, price FROM plans WHERE id=? AND active=1`, int(b.plan_id));
    assert(plan, 400, 'That plan is no longer available');
    // Promo code: validated now, reserved with this payment, applied when the desk confirms.
    const priced = b.coupon_code ? await priceTerm(c.env, id, { plan_id: plan.id, coupon_code: String(b.coupon_code) }, 'app') : null;
    const due = priced ? priced.quote.total : plan.price;
    assert(amount >= due, 400, `The ${plan.name} plan costs ₹${due}${priced?.coupon ? ` with ${priced.coupon.code}` : ''}`);
    planId = plan.id;
    couponId = priced?.coupon?.id ?? null;
    couponDiscount = priced?.quote.coupon_discount ?? 0;
    remarks = `Renewal request: ${plan.name} (member app)${priced?.coupon ? ` · coupon ${priced.coupon.code} −₹${couponDiscount}${priced.coupon.bonus_days ? `, +${priced.coupon.bonus_days} days` : ''}` : ''}`;
  }
  const proof = str(b.proof_key, 120);
  assert(!proof || proof.startsWith(`proofs/member-${id}-`), 400, 'Invalid screenshot');

  // Dues payments attach to the oldest term with a balance; renewals get their term on confirmation.
  let membershipId: number | null = null;
  if (!planId) {
    const due = await first<{ membership_id: number }>(c.env.DB,
      `SELECT d.membership_id FROM v_membership_dues d JOIN memberships ms ON ms.id=d.membership_id WHERE d.member_id=? AND d.due>0 ORDER BY ms.start_date LIMIT 1`, id);
    membershipId = due?.membership_id ?? null;
  }
  const p = await recordPayment(c.env, id, membershipId, {
    amount, mode: 'upi', reference, entry_type: planId ? 'renewal' : 'due', status: 'pending', remarks, proof_key: proof ?? undefined, request_plan_id: planId,
  }, `member:${c.get('session').name}`);
  if (couponId) {
    await run(c.env.DB, `UPDATE payments SET coupon_id=? WHERE id=?`, couponId, p.id);
    await run(c.env.DB, `INSERT INTO coupon_redemptions (coupon_id, member_id, payment_id, discount, status, created_by) VALUES (?, ?, ?, ?, 'pending', 'member-app')`,
      couponId, id, p.id, couponDiscount);
  }
  return c.json({ id: p.id, status: 'pending' });
});

/** Promo code check before paying: ?plan_id=&code= → price after coupon + bonus days. */
me.get('/coupon-quote', async (c) => {
  const r = await priceTerm(c.env, mid(c), { plan_id: int(c.req.query('plan_id')) ?? undefined, coupon_code: c.req.query('code') ?? '' }, 'app');
  return c.json({ list: r.quote.list, discount: r.quote.coupon_discount, total: r.quote.total, bonus_days: r.quote.bonus_days,
    coupon: r.coupon ? { code: r.coupon.code, description: r.coupon.description } : null });
});

/** Payment screenshot → R2 (optional, helps the desk verify). */
me.put('/proof', async (c) => {
  assert(c.env.FILES, 503, 'Uploads are not available right now');
  const type = c.req.header('content-type') ?? '';
  assert(/^image\/(jpeg|png|webp)$/.test(type), 400, 'Upload a JPEG, PNG or WebP screenshot');
  const buf = await c.req.arrayBuffer();
  assert(buf.byteLength > 0 && buf.byteLength <= 3_000_000, 413, 'Screenshot must be under 3 MB');
  const key = `proofs/member-${mid(c)}-${Date.now()}`;
  await c.env.FILES!.put(key, buf, { httpMetadata: { contentType: type } });
  return c.json({ proof_key: key });
});

me.put('/photo', async (c) => {
  assert(c.env.FILES, 503, 'Uploads are not available right now');
  const type = c.req.header('content-type') ?? '';
  assert(/^image\/(jpeg|png|webp)$/.test(type), 400, 'Upload a JPEG, PNG or WebP image');
  const buf = await c.req.arrayBuffer();
  assert(buf.byteLength > 0 && buf.byteLength <= 3_000_000, 413, 'Photo must be under 3 MB');
  const id = mid(c);
  const key = `photos/member-${id}-${Date.now()}`;
  await c.env.FILES!.put(key, buf, { httpMetadata: { contentType: type } });
  const old = await first<{ photo_key: string | null }>(c.env.DB, `SELECT photo_key FROM members WHERE id=?`, id);
  await run(c.env.DB, `UPDATE members SET photo_key=?, updated_at=? WHERE id=?`, key, nowIso(), id);
  if (old?.photo_key) await c.env.FILES!.delete(old.photo_key);
  return c.json({ photo_key: key });
});

/** Own photo only. */
me.get('/photo', async (c) => {
  const m = await first<{ photo_key: string | null }>(c.env.DB, `SELECT photo_key FROM members WHERE id=?`, mid(c));
  assert(m?.photo_key && c.env.FILES, 404, 'No photo');
  const obj = await c.env.FILES!.get(m.photo_key);
  assert(obj, 404, 'No photo');
  return new Response(obj.body, { headers: { 'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg', 'Cache-Control': 'private, max-age=300' } });
});

me.get('/announcements', async (c) =>
  c.json(await all(c.env.DB, `SELECT id, title, body, pinned, created_at FROM announcements WHERE published=1 ORDER BY pinned DESC, id DESC LIMIT 20`)));

me.get('/receipt/:id', async (c) => {
  const p = await first(c.env.DB,
    `SELECT p.id, p.amount, p.mode, p.paid_on, p.receipt_no, p.reference, p.entry_type, p.status, m.name, m.essl_id, ms.category, ms.duration_label, ms.start_date, ms.end_date
     FROM payments p JOIN members m ON m.id=p.member_id LEFT JOIN memberships ms ON ms.id=p.membership_id
     WHERE p.id=? AND p.member_id=? AND p.status='confirmed'`, Number(c.req.param('id')), mid(c));
  assert(p, 404, 'Receipt not found');
  const s = await getSettings(c.env.DB);
  return c.json({ payment: p, gym: s.gym });
});
