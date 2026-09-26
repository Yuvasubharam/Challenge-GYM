// Coupon lookup + eligibility. Messages are shown to staff and members as-is.
import type { Env } from '../env';
import { tzOffset } from '../env';
import { HttpError, first } from './db';
import { today as todayOf } from './dates';
import { couponDiscount, isCouponCode, normalizeCode, type CouponRule } from './pricing';

export interface CouponRow extends CouponRule {
  id: number; code: string; description: string | null; plan_ids: string | null; valid_from: string | null; valid_until: string | null;
  max_uses: number | null; per_member_limit: number; new_members_only: number; member_app: number; active: number;
}

export interface CouponCheck {
  memberId: number | null;       // null = brand-new member being created at the desk
  planId: number;
  amount: number;                // bill after any manual discount
  from: 'desk' | 'app';
  ignorePaymentId?: number;      // a member's own pending reservation being confirmed
}

const fail = (msg: string): never => { throw new HttpError(400, msg); };

export async function checkCoupon(env: Env, rawCode: unknown, c: CouponCheck): Promise<{ coupon: CouponRow; discount: number }> {
  const code = normalizeCode(rawCode);
  if (!isCouponCode(code)) fail('Enter a valid coupon code');
  const coupon = await first<CouponRow>(env.DB, `SELECT * FROM coupons WHERE code=?`, code);
  if (!coupon || !coupon.active) fail(`Coupon ${code} is not valid`);
  const cp = coupon!;
  if (c.from === 'app' && !cp.member_app) fail(`Coupon ${code} can only be applied at the front desk`);
  const today = todayOf(tzOffset(env));
  if (cp.valid_from && today < cp.valid_from) fail(`Coupon ${code} starts on ${cp.valid_from}`);
  if (cp.valid_until && today > cp.valid_until) fail(`Coupon ${code} expired on ${cp.valid_until}`);
  if (cp.plan_ids) {
    const ids = JSON.parse(cp.plan_ids) as number[];
    if (ids.length && !ids.includes(c.planId)) fail(`Coupon ${code} is not valid for this plan`);
  }
  const ignore = c.ignorePaymentId ?? -1;
  if (cp.max_uses) {
    const used = await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=? AND status IN ('applied','pending') AND COALESCE(payment_id,0)<>?`, cp.id, ignore);
    if ((used?.n ?? 0) >= cp.max_uses) fail(`Coupon ${code} has been fully used`);
  }
  if (c.memberId) {
    const mine = await first<{ n: number }>(env.DB, `SELECT COUNT(*) AS n FROM coupon_redemptions WHERE coupon_id=? AND member_id=? AND status IN ('applied','pending') AND COALESCE(payment_id,0)<>?`, cp.id, c.memberId, ignore);
    if ((mine?.n ?? 0) >= Math.max(1, cp.per_member_limit)) fail(`You have already used coupon ${code}`);
    if (cp.new_members_only) {
      const had = await first(env.DB, `SELECT 1 FROM memberships WHERE member_id=? AND status='active' LIMIT 1`, c.memberId);
      if (had) fail(`Coupon ${code} is for new members only`);
    }
  }
  if (cp.min_amount && c.amount < cp.min_amount) fail(`Coupon ${code} needs a bill of at least ₹${cp.min_amount}`);
  const discount = couponDiscount(cp, c.amount);
  if (cp.kind !== 'days' && discount <= 0) fail(`Coupon ${code} gives no discount on this bill`);
  return { coupon: cp, discount };
}
