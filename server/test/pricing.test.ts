import { describe, expect, it } from 'vitest';
import { couponDiscount, isCouponCode, normalizeCode, quote } from '../src/lib/pricing';

const pct = (value: number, extra: Partial<Parameters<typeof couponDiscount>[0]> = {}) => ({ kind: 'percent' as const, value, max_discount: null, min_amount: null, bonus_days: 0, ...extra });
const amt = (value: number, extra: Partial<Parameters<typeof couponDiscount>[0]> = {}) => ({ kind: 'amount' as const, value, max_discount: null, min_amount: null, bonus_days: 0, ...extra });

describe('quote', () => {
  it('no discount', () => expect(quote({ planPrice: 1500 })).toMatchObject({ list: 1500, discount: 0, total: 1500, bonus_days: 0, note: null }));
  it('includes PT in the list price', () => expect(quote({ planPrice: 1500, ptAmount: 2000 }).total).toBe(3500));
  it('₹ discount', () => expect(quote({ planPrice: 1500, discountType: 'amount', discountValue: 200 })).toMatchObject({ discount: 200, total: 1300, note: '₹200 off' }));
  it('% discount rounds to rupees', () => expect(quote({ planPrice: 1499, discountType: 'percent', discountValue: 10 })).toMatchObject({ discount: 150, total: 1349 }));
  it('discount never exceeds the bill', () => expect(quote({ planPrice: 1500, discountType: 'amount', discountValue: 9999 }).total).toBe(0));
  it('extra free days', () => expect(quote({ planPrice: 1500, extraDays: 7 })).toMatchObject({ bonus_days: 7, total: 1500, note: '+7 free days' }));
  it('manual then coupon, days add up', () => {
    const q = quote({ planPrice: 10000, discountType: 'amount', discountValue: 1000, coupon: pct(10, { bonus_days: 5 }), extraDays: 3 });
    expect(q).toMatchObject({ manual_discount: 1000, coupon_discount: 900, discount: 1900, total: 8100, bonus_days: 8 });
  });
});

describe('coupons', () => {
  it('percent with cap', () => expect(couponDiscount(pct(20, { max_discount: 500 }), 10000)).toBe(500));
  it('flat amount', () => expect(couponDiscount(amt(300), 1500)).toBe(300));
  it('minimum bill', () => {
    expect(couponDiscount(amt(300, { min_amount: 3000 }), 1500)).toBe(0);
    expect(couponDiscount(amt(300, { min_amount: 3000 }), 4500)).toBe(300);
  });
  it('days-only coupon gives no price cut but adds days', () => {
    const q = quote({ planPrice: 1500, coupon: { kind: 'days', value: 0, max_discount: null, min_amount: null, bonus_days: 12 } });
    expect(q).toMatchObject({ total: 1500, bonus_days: 12 });
  });
  it('codes', () => {
    expect(normalizeCode(' diwali 25 ')).toBe('DIWALI25');
    expect(isCouponCode('DIWALI25')).toBe(true);
    expect(isCouponCode('X')).toBe(false);
  });
});
