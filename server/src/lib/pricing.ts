// Membership pricing — pure, unit-tested (test/pricing.test.ts). All amounts in whole rupees.

export type DiscountType = 'none' | 'amount' | 'percent';

export interface CouponRule {
  kind: 'percent' | 'amount' | 'days';
  value: number;            // % or ₹
  max_discount: number | null;
  min_amount: number | null;
  bonus_days: number;
}

export interface QuoteInput {
  planPrice: number;        // price charged for the plan (may already be edited at the desk)
  ptAmount?: number;        // personal training add-on
  discountType?: DiscountType;
  discountValue?: number;   // ₹ or % for a manual discount
  coupon?: CouponRule | null;
  extraDays?: number;       // free days given at the desk
}

export interface Quote {
  list: number;             // plan + PT before any discount
  manual_discount: number;
  coupon_discount: number;
  discount: number;         // total discount
  total: number;            // amount billed
  bonus_days: number;       // coupon days + desk extra days
  note: string | null;      // human summary for the membership record
}

const clampInt = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(Number.isFinite(n) ? n : 0)));

export function couponDiscount(c: CouponRule, amount: number): number {
  if (c.kind === 'days') return 0;
  if (c.min_amount && amount < c.min_amount) return 0;
  const raw = c.kind === 'percent' ? (amount * clampInt(c.value, 0, 100)) / 100 : c.value;
  const capped = c.kind === 'percent' && c.max_discount ? Math.min(raw, c.max_discount) : raw;
  return clampInt(capped, 0, amount);
}

/** Manual discount first (desk), then coupon on what remains. Never below ₹0. */
export function quote(i: QuoteInput): Quote {
  const list = clampInt(i.planPrice, 0, 10_000_000) + clampInt(i.ptAmount ?? 0, 0, 10_000_000);
  let manual = 0;
  if (i.discountType === 'amount') manual = clampInt(i.discountValue ?? 0, 0, list);
  if (i.discountType === 'percent') manual = clampInt((list * clampInt(i.discountValue ?? 0, 0, 100)) / 100, 0, list);
  const afterManual = list - manual;
  const couponCut = i.coupon ? couponDiscount(i.coupon, afterManual) : 0;
  const bonus = clampInt(i.extraDays ?? 0, 0, 365) + (i.coupon ? clampInt(i.coupon.bonus_days, 0, 365) : 0);
  const parts: string[] = [];
  if (manual) parts.push(i.discountType === 'percent' ? `${clampInt(i.discountValue ?? 0, 0, 100)}% off` : `₹${manual} off`);
  if (couponCut) parts.push(`coupon −₹${couponCut}`);
  if (bonus) parts.push(`+${bonus} free day${bonus === 1 ? '' : 's'}`);
  return {
    list, manual_discount: manual, coupon_discount: couponCut, discount: manual + couponCut,
    total: afterManual - couponCut, bonus_days: bonus, note: parts.length ? parts.join(' · ') : null,
  };
}

export const normalizeCode = (s: unknown) => String(s ?? '').trim().toUpperCase().replace(/\s+/g, '');
export const isCouponCode = (s: string) => /^[A-Z0-9_-]{3,24}$/.test(s);
