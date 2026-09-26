// Creating membership terms and payments — shared by the admin Renew/Add flows and by
// confirming a member's UPI renewal request.
import type { Env } from '../env';
import { tzOffset } from '../env';
import { assert, first, int, nextReceiptNo, run, str } from './db';
import { addDays, isDate, today as todayOf } from './dates';
import { durationLabel, renewalStart, termEnd } from './membership';
import { checkCoupon, type CouponRow } from './coupons';
import { quote, type DiscountType, type Quote } from './pricing';

export interface TermInput {
  plan_id?: number; start_date?: string; price?: number; pt_amount?: number; paid?: number; mode?: string; reference?: string; notes?: string;
  discount_type?: DiscountType; discount_value?: number; coupon_code?: string; extra_days?: number;
  pay_full?: boolean;             // record a payment for exactly the billed total
}

interface PlanRow { id: number; name: string; category: string; duration_months: number; duration_days: number; price: number }

/**
 * Price a term exactly as it will be saved: plan (desk may edit the price) + PT − manual discount − coupon,
 * and free days (desk extra days + coupon days). Used for the live preview and for createTerm.
 */
export async function priceTerm(env: Env, memberId: number | null, t: TermInput, from: 'desk' | 'app', ignorePaymentId?: number) {
  const plan = await first<PlanRow>(env.DB, `SELECT * FROM plans WHERE id=?`, int(t.plan_id));
  assert(plan, 400, 'Choose a plan');
  const planPrice = Math.max(0, int(t.price) ?? plan.price);
  const ptAmount = Math.max(0, int(t.pt_amount) ?? 0);
  const discountType: DiscountType = t.discount_type === 'amount' || t.discount_type === 'percent' ? t.discount_type : 'none';
  const base = quote({ planPrice, ptAmount, discountType, discountValue: Number(t.discount_value) || 0, extraDays: int(t.extra_days) ?? 0 });
  let coupon: CouponRow | null = null;
  if (t.coupon_code && String(t.coupon_code).trim()) {
    coupon = (await checkCoupon(env, t.coupon_code, { memberId, planId: plan.id, amount: base.list - base.manual_discount, from, ignorePaymentId })).coupon;
  }
  const q: Quote = coupon
    ? quote({ planPrice, ptAmount, discountType, discountValue: Number(t.discount_value) || 0, extraDays: int(t.extra_days) ?? 0, coupon })
    : base;
  const note = [coupon ? `Coupon ${coupon.code}` : null, q.note].filter(Boolean).join(' · ') || null;
  return { plan, planPrice, ptAmount, quote: q, coupon, note };
}

export async function createTerm(env: Env, memberId: number, t: TermInput, kind: 'new' | 'renewal', by: string,
  opts: { from?: 'desk' | 'app'; reservedPaymentId?: number } = {}) {
  const today = todayOf(tzOffset(env));
  const { plan, ptAmount, quote: q, coupon, note } = await priceTerm(env, memberId, t, opts.from ?? 'desk', opts.reservedPaymentId);
  let start = t.start_date && isDate(t.start_date) ? t.start_date : null;
  if (!start) {
    const cur = await first<{ end_date: string | null }>(env.DB, `SELECT MAX(end_date) AS end_date FROM memberships WHERE member_id=? AND status='active'`, memberId);
    start = renewalStart(cur?.end_date ?? null, today);
  }
  const end = addDays(termEnd(start, plan), q.bonus_days);
  const notes = [str(t.notes, 400), note].filter(Boolean).join(' · ') || null;
  const ms = await first<{ id: number }>(
    env.DB,
    `INSERT INTO memberships (member_id, plan_id, category, duration_label, start_date, end_date, price, pt_included, pt_amount, kind, notes, created_by,
                              list_price, discount, discount_note, coupon_id, bonus_days)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    memberId, plan.id, plan.category, durationLabel(plan), start, end, q.total, ptAmount > 0 ? 1 : 0, ptAmount, kind, notes, by,
    q.list, q.discount, note, coupon?.id ?? null, q.bonus_days,
  );
  if (coupon) {
    // Confirming a member's reserved coupon turns the pending reservation into an applied redemption.
    const reserved = opts.reservedPaymentId
      ? await first<{ id: number }>(env.DB, `SELECT id FROM coupon_redemptions WHERE payment_id=? AND coupon_id=? AND status='pending'`, opts.reservedPaymentId, coupon.id)
      : null;
    if (reserved) {
      await run(env.DB, `UPDATE coupon_redemptions SET status='applied', membership_id=?, discount=?, bonus_days=? WHERE id=?`, ms!.id, q.coupon_discount, coupon.bonus_days, reserved.id);
    } else {
      await run(env.DB, `INSERT INTO coupon_redemptions (coupon_id, member_id, membership_id, discount, bonus_days, status, created_by) VALUES (?, ?, ?, ?, ?, 'applied', ?)`,
        coupon.id, memberId, ms!.id, q.coupon_discount, coupon.bonus_days, by);
    }
  }
  let payment: { id: number; receipt_no: string } | null = null;
  const paid = t.pay_full ? q.total : int(t.paid) ?? 0;
  if (paid > 0) payment = await recordPayment(env, memberId, ms!.id, { amount: paid, mode: t.mode, reference: t.reference, entry_type: kind === 'new' ? 'new' : 'renewal' }, by);
  return { membership_id: ms!.id, start_date: start, end_date: end, price: q.total, list_price: q.list, discount: q.discount, bonus_days: q.bonus_days, coupon: coupon?.code ?? null, payment };
}

const MODES = ['cash', 'upi', 'card', 'bank', 'other'];

export async function recordPayment(
  env: Env, memberId: number, membershipId: number | null,
  p: { amount: number; mode?: string; reference?: string; paid_on?: string; entry_type?: string; remarks?: string; status?: string; proof_key?: string; request_plan_id?: number | null },
  by: string,
) {
  const mode = MODES.includes(p.mode ?? '') ? p.mode! : 'cash';
  const receipt = p.status === 'pending' ? null : await nextReceiptNo(env.DB);
  const r = await first<{ id: number }>(
    env.DB,
    `INSERT INTO payments (member_id, membership_id, amount, mode, paid_on, receipt_no, reference, proof_key, entry_type, status, handled_by, remarks, request_plan_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
    memberId, membershipId, p.amount, mode, p.paid_on && isDate(p.paid_on) ? p.paid_on : todayOf(tzOffset(env)), receipt,
    str(p.reference, 80), p.proof_key ?? null, p.entry_type ?? 'due', p.status ?? 'confirmed', by, str(p.remarks, 300), p.request_plan_id ?? null,
  );
  return { id: r!.id, receipt_no: receipt ?? '' };
}
