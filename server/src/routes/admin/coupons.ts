// Admin: coupon management + live price quote for the Add member / Renew forms.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { tzOffset } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, int, isDateOrNull, run, str } from '../../lib/db';
import { today as todayOf } from '../../lib/dates';
import { isCouponCode, normalizeCode } from '../../lib/pricing';
import { priceTerm } from '../../lib/terms';

export const coupons = new Hono<AppEnv>();
coupons.use('*', requireAdmin());

/** Live preview: { plan_id, price?, pt_amount?, discount_type?, discount_value?, coupon_code?, extra_days?, member_id? } */
coupons.post('/quote', async (c) => {
  const b = await c.req.json();
  const r = await priceTerm(c.env, int(b.member_id), b, 'desk');
  return c.json({ ...r.quote, coupon: r.coupon ? { code: r.coupon.code, description: r.coupon.description, bonus_days: r.coupon.bonus_days } : null, note: r.note });
});

coupons.get('/', async (c) => {
  const today = todayOf(tzOffset(c.env));
  const rows = await all<Record<string, unknown> & { valid_until: string | null; valid_from: string | null; active: number; max_uses: number | null; used: number }>(c.env.DB,
    `SELECT cp.*,
            (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=cp.id AND r.status='applied') AS used,
            (SELECT COUNT(*) FROM coupon_redemptions r WHERE r.coupon_id=cp.id AND r.status='pending') AS pending,
            (SELECT COALESCE(SUM(discount),0) FROM coupon_redemptions r WHERE r.coupon_id=cp.id AND r.status='applied') AS total_discount
     FROM coupons cp ORDER BY cp.active DESC, cp.created_at DESC`);
  return c.json(rows.map((r) => ({
    ...r,
    plan_ids: r.plan_ids ? JSON.parse(String(r.plan_ids)) : null,
    state: !r.active ? 'paused' : r.valid_until && r.valid_until < today ? 'expired' : r.valid_from && r.valid_from > today ? 'scheduled'
      : r.max_uses && r.used >= r.max_uses ? 'used_up' : 'live',
  })));
});

function couponFields(b: Record<string, unknown>, partial: boolean) {
  const f: Record<string, unknown> = {};
  const has = (k: string) => !partial || k in b;
  if (has('code')) {
    const code = normalizeCode(b.code);
    assert(isCouponCode(code), 400, 'Code: 3–24 letters/digits (e.g. DIWALI25)');
    f.code = code;
  }
  if (has('description')) f.description = str(b.description, 200);
  if (has('kind')) { assert(['percent', 'amount', 'days'].includes(String(b.kind)), 400, 'Choose a coupon type'); f.kind = b.kind; }
  if (has('value')) f.value = Math.max(0, int(b.value) ?? 0);
  if (has('max_discount')) f.max_discount = int(b.max_discount) || null;
  if (has('min_amount')) f.min_amount = int(b.min_amount) || null;
  if (has('bonus_days')) f.bonus_days = Math.min(365, Math.max(0, int(b.bonus_days) ?? 0));
  if (has('plan_ids')) f.plan_ids = Array.isArray(b.plan_ids) && b.plan_ids.length ? JSON.stringify(b.plan_ids.map(Number).filter(Number.isFinite)) : null;
  if (has('valid_from')) f.valid_from = isDateOrNull(b.valid_from);
  if (has('valid_until')) f.valid_until = isDateOrNull(b.valid_until);
  if (has('max_uses')) f.max_uses = int(b.max_uses) || null;
  if (has('per_member_limit')) f.per_member_limit = Math.max(1, int(b.per_member_limit) ?? 1);
  if (has('new_members_only')) f.new_members_only = b.new_members_only ? 1 : 0;
  if (has('member_app')) f.member_app = b.member_app === false ? 0 : 1;
  if (has('active')) f.active = b.active === false ? 0 : 1;
  const kind = f.kind ?? b.kind;
  if (kind === 'percent' && 'value' in f) assert(Number(f.value) >= 1 && Number(f.value) <= 100, 400, 'Percent must be 1–100');
  if (kind === 'amount' && 'value' in f) assert(Number(f.value) >= 1, 400, 'Enter the ₹ amount off');
  if (kind === 'days' && ('bonus_days' in f || !partial)) assert(Number(f.bonus_days ?? 0) >= 1, 400, 'A free-days coupon needs at least 1 bonus day');
  if (f.valid_from && f.valid_until) assert(String(f.valid_from) <= String(f.valid_until), 400, 'End date is before start date');
  return f;
}

coupons.post('/', requireAdmin('owner', 'admin'), async (c) => {
  const f = couponFields(await c.req.json(), false);
  assert(!(await first(c.env.DB, `SELECT 1 FROM coupons WHERE code=?`, f.code)), 409, `Code ${f.code} already exists`);
  const keys = Object.keys(f);
  const r = await first<{ id: number }>(c.env.DB, `INSERT INTO coupons (${keys.join(', ')}, created_by) VALUES (${keys.map(() => '?').join(', ')}, ?) RETURNING id`,
    ...keys.map((k) => f[k]), actor(c));
  await audit(c.env, actor(c), 'coupon.create', 'coupon', r!.id, f);
  return c.json({ id: r!.id });
});

coupons.patch('/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const cur = await first<{ kind: string }>(c.env.DB, `SELECT kind FROM coupons WHERE id=?`, id);
  assert(cur, 404, 'Coupon not found');
  const b = await c.req.json();
  const f = couponFields({ kind: cur.kind, ...b }, true);
  if (!('kind' in b)) delete f.kind;
  if (f.code) assert(!(await first(c.env.DB, `SELECT 1 FROM coupons WHERE code=? AND id<>?`, f.code, id)), 409, `Code ${f.code} already exists`);
  const keys = Object.keys(f);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE coupons SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => f[k]), id);
  await audit(c.env, actor(c), 'coupon.update', 'coupon', id, f);
  return c.json({ ok: true });
});

coupons.get('/:id/redemptions', async (c) => c.json(await all(c.env.DB,
  `SELECT r.*, m.name, m.essl_id, ms.duration_label, ms.category FROM coupon_redemptions r JOIN members m ON m.id=r.member_id
   LEFT JOIN memberships ms ON ms.id=r.membership_id WHERE r.coupon_id=? ORDER BY r.id DESC LIMIT 300`, Number(c.req.param('id')))));
