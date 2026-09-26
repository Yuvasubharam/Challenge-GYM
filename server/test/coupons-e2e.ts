// Discounts, free days and coupons — desk + member app. Creates and removes its own data.
//   npx tsx test/coupons-e2e.ts        (admin :8788 and member :8789 workers running)
import { execFileSync } from 'node:child_process';

const ADMIN = 'http://127.0.0.1:8788/api';
const MEMBER = 'http://127.0.0.1:8789/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); }
};
async function call<T = any>(base: string, method: string, path: string, body?: unknown, cookie = ''): Promise<{ status: number; data: T; cookie: string }> {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T, cookie: sc ? sc.split(';')[0] : cookie };
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const addMonths = (d: string, n: number) => { const [y, m, day] = d.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1 + n, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); t.setUTCDate(Math.min(day, last)); return t.toISOString().slice(0, 10); };
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

console.log('\n── setup');
sql(`UPDATE devices SET approved=0`);
const receiptBefore = sql(`SELECT value FROM settings WHERE key='receipt'`)[0].value;
const upiBefore = sql(`SELECT value FROM settings WHERE key='upi'`)[0].value;
// Remove leftovers of an interrupted earlier run (children first — foreign keys).
const stale = `(SELECT id FROM members WHERE name LIKE 'Coupon Test%')`;
sql(`DELETE FROM coupon_redemptions WHERE member_id IN ${stale} OR coupon_id IN (SELECT id FROM coupons WHERE code LIKE 'T%E2E');
     DELETE FROM payments WHERE member_id IN ${stale}; DELETE FROM memberships WHERE member_id IN ${stale}; DELETE FROM accounts WHERE member_id IN ${stale};
     UPDATE device_commands SET status='cancelled' WHERE essl_id='CGT2' AND status IN ('pending','sent'); DELETE FROM members WHERE name LIKE 'Coupon Test%';
     DELETE FROM coupons WHERE code LIKE 'T%E2E'`);
const admin = (await call(ADMIN, 'POST', '/auth/login', { username: 'owner', password: 'owner-pass-123' })).cookie;
await call(ADMIN, 'PUT', '/settings/upi', { vpa: 'challengegym@okicici', payee: 'Challenge Gym' }, admin);
const plans = (await call(ADMIN, 'GET', '/plans', undefined, admin)).data as any[];
const p1m = plans.find((p) => p.category === 'Strength' && p.duration_months === 1);
const p3m = plans.find((p) => p.category === 'Strength' && p.duration_months === 3);
check('plans available', p1m && p3m);
const mk = async (b: any) => (await call(ADMIN, 'POST', '/coupons', b, admin));
let r = await mk({ code: 'tpct e2e', kind: 'percent', value: 20, max_discount: 250, bonus_days: 3, description: '20% off max 250 + 3 days' });
check('create % coupon (code normalised to TPCTE2E)', r.status === 200 && sql(`SELECT code FROM coupons WHERE id=${r.data.id}`)[0].code === 'TPCTE2E', r.data);
await mk({ code: 'TFLATE2E', kind: 'amount', value: 300, min_amount: 2000 });
await mk({ code: 'TDAYSE2E', kind: 'days', bonus_days: 7 });
await mk({ code: 'TNEWE2E', kind: 'percent', value: 10, new_members_only: true });
await mk({ code: 'TONCEE2E', kind: 'amount', value: 100, max_uses: 1 });
await mk({ code: 'TOLDE2E', kind: 'amount', value: 100, valid_from: addDays(today, -10), valid_until: addDays(today, -1) });
await mk({ code: 'TDESKE2E', kind: 'amount', value: 100, member_app: false });
await mk({ code: 'TPLANE2E', kind: 'amount', value: 100, plan_ids: [p3m.id] });
check('duplicate code rejected', (await mk({ code: 'TPCTE2E', kind: 'amount', value: 1 })).status === 409);
check('invalid % rejected', (await mk({ code: 'TBADE2E', kind: 'percent', value: 150 })).status === 400);
check('days coupon needs days', (await mk({ code: 'TBAD2E2E', kind: 'days', bonus_days: 0 })).status === 400);

console.log('\n── desk quote');
const q = (b: any) => call(ADMIN, 'POST', '/coupons/quote', { plan_id: p1m.id, ...b }, admin);
r = await q({ discount_type: 'amount', discount_value: 200, extra_days: 5 });
check('₹200 off + 5 free days', r.data.total === p1m.price - 200 && r.data.bonus_days === 5, r.data);
r = await q({ discount_type: 'percent', discount_value: 10 });
check('10% off', r.data.discount === Math.round(p1m.price * 0.1), r.data);
r = await q({ price: 2000, pt_amount: 1000 });
check('edited price + PT', r.data.list === 3000 && r.data.total === 3000);
r = await q({ coupon_code: 'tpcte2e', price: 2000 });
check('coupon % capped at ₹250 and +3 days', r.data.coupon_discount === 250 && r.data.bonus_days === 3 && r.data.total === 1750, r.data);
r = await q({ coupon_code: 'TFLATE2E' });
check('minimum bill enforced', r.status === 400 && /at least ₹2000/.test(r.data.error), r.data);
r = await q({ coupon_code: 'TFLATE2E', price: 2500 });
check('flat ₹300 once minimum met', r.data.total === 2200);
check('expired coupon', /expired/.test((await q({ coupon_code: 'TOLDE2E' })).data.error));
check('plan-restricted coupon', /not valid for this plan/.test((await q({ coupon_code: 'TPLANE2E' })).data.error));
check('unknown coupon', /not valid/.test((await q({ coupon_code: 'NOPE1234' })).data.error));
r = await q({ discount_type: 'amount', discount_value: 100, coupon_code: 'TDAYSE2E', extra_days: 2 });
check('manual ₹ + days coupon + extra days stack', r.data.total === p1m.price - 100 && r.data.bonus_days === 9, r.data);

console.log('\n── desk: add member with discount, coupon and free days');
r = await call(ADMIN, 'POST', '/members', { name: 'Coupon Test One', mobile: '9111100001', plan_id: p1m.id, coupon_code: 'TNEWE2E', extra_days: 5, pay_full: true, mode: 'upi' }, admin);
check('member created', r.status === 200, r.data);
const m1 = r.data.id;
const t1 = sql(`SELECT * FROM memberships WHERE member_id=${m1}`)[0];
const expectedDisc = Math.round(p1m.price * 0.1);
check('term stores list price, discount, coupon, free days', t1.list_price === p1m.price && t1.discount === expectedDisc && t1.price === p1m.price - expectedDisc && t1.bonus_days === 5 && t1.coupon_id, t1);
check('end date = 1 month + 5 days', t1.end_date === addDays(addMonths(t1.start_date, 1), 5), { start: t1.start_date, end: t1.end_date });
const pay1 = sql(`SELECT amount FROM payments WHERE member_id=${m1}`)[0];
check('pay_full records exactly the billed total (no dues)', pay1.amount === t1.price && (await call(ADMIN, 'GET', `/members/${m1}`, undefined, admin)).data.summary.due === 0, pay1);
check('redemption applied', sql(`SELECT status, discount FROM coupon_redemptions WHERE member_id=${m1}`)[0].status === 'applied');
r = await call(ADMIN, 'POST', `/members/${m1}/renew`, { plan_id: p1m.id, coupon_code: 'TNEWE2E', pay_full: true }, admin);
check('new-members-only coupon refused on renewal', r.status === 400 && /new members only|already used/.test(r.data.error), r.data);
r = await call(ADMIN, 'POST', `/members/${m1}/renew`, { plan_id: p1m.id, coupon_code: 'TONCEE2E', pay_full: true }, admin);
check('single-use coupon works once', r.status === 200 && r.data.discount === 100, r.data);
r = await call(ADMIN, 'POST', '/members', { name: 'Coupon Test Two', mobile: '9111100002', essl_id: 'CGT2', plan_id: p1m.id, coupon_code: 'TONCEE2E', pay_full: true }, admin);
check('…and is refused once used up', r.status === 400 && /fully used/.test(r.data.error), r.data);
r = await call(ADMIN, 'POST', '/members', { name: 'Coupon Test Two', mobile: '9111100002', essl_id: 'CGT2', plan_id: p1m.id, discount_type: 'amount', discount_value: 500, paid: 500, mode: 'cash' }, admin);
const m2 = r.data.id;
check('partial payment after discount leaves correct dues', (await call(ADMIN, 'GET', `/members/${m2}`, undefined, admin)).data.summary.due === p1m.price - 500 - 500);

console.log('\n── member app: promo code on UPI renewal');
sql(`DELETE FROM accounts WHERE member_id=${m2}; DELETE FROM login_attempts`);
r = await call(MEMBER, 'POST', '/auth/activate', { mobile: '9111100002', memberId: 'CGT2', password: 'secret1' });
const mc = r.cookie;
check('test member signed in', r.status === 200, r.data);
r = await call(MEMBER, 'GET', `/me/coupon-quote?plan_id=${p3m.id}&code=tpcte2e`, undefined, mc);
check('member sees discounted price + bonus days', r.data.total === p3m.price - Math.min(250, Math.round(p3m.price * 0.2)) && r.data.bonus_days === 3, r.data);
check('desk-only coupon refused in app', /front desk/.test((await call(MEMBER, 'GET', `/me/coupon-quote?plan_id=${p3m.id}&code=TDESKE2E`, undefined, mc)).data.error));
const promoTotal = r.data.total;
r = await call(MEMBER, 'POST', '/me/payments', { amount: promoTotal - 1, reference: 'UTRE2E000001', plan_id: p3m.id, coupon_code: 'TPCTE2E' }, mc);
check('underpaying the promo price rejected', r.status === 400);
r = await call(MEMBER, 'POST', '/me/payments', { amount: promoTotal, reference: 'UTRE2E000001', plan_id: p3m.id, coupon_code: 'TPCTE2E' }, mc);
check('claim with promo accepted (pending)', r.status === 200, r.data);
const payA = r.data.id;
check('coupon reserved as pending', sql(`SELECT status FROM coupon_redemptions WHERE payment_id=${payA}`)[0]?.status === 'pending');
check('reserved coupon cannot be reused meanwhile', /already used/.test((await call(MEMBER, 'GET', `/me/coupon-quote?plan_id=${p3m.id}&code=TPCTE2E`, undefined, mc)).data.error));
await call(ADMIN, 'POST', `/payments/${payA}/reject`, { reason: 'not received' }, admin);
check('reject releases the coupon', sql(`SELECT status FROM coupon_redemptions WHERE payment_id=${payA}`)[0].status === 'void');
r = await call(MEMBER, 'POST', '/me/payments', { amount: promoTotal, reference: 'UTRE2E000002', plan_id: p3m.id, coupon_code: 'TPCTE2E' }, mc);
const payB = r.data.id;
const before = sql(`SELECT MAX(end_date) e FROM memberships WHERE member_id=${m2} AND status='active'`)[0].e;
r = await call(ADMIN, 'POST', `/payments/${payB}/confirm`, {}, admin);
check('desk confirms → renewal created', r.status === 200 && r.data.renewal, r.data);
const t2 = sql(`SELECT * FROM memberships WHERE id=${r.data.renewal.membership_id}`)[0];
check('renewal priced with coupon + 3 bonus days', t2.price === promoTotal && t2.bonus_days === 3 && t2.discount === p3m.price - promoTotal, t2);
check('renewal continues from current end + 3 months + 3 days', t2.end_date === addDays(addMonths(before >= today ? before : today, 3), 3), { before, end: t2.end_date });
check('redemption now applied to that term', sql(`SELECT status, membership_id FROM coupon_redemptions WHERE payment_id=${payB}`)[0].membership_id === t2.id);
check('member owes nothing for it', (await call(MEMBER, 'GET', '/me/plan', undefined, mc)).data.memberships.find((x: any) => x.id === t2.id)?.due === 0);

console.log('\n── coupon list, pause, cancel term');
const list = (await call(ADMIN, 'GET', '/coupons', undefined, admin)).data as any[];
const pct = list.find((x) => x.code === 'TPCTE2E');
check('usage counted (1 applied, voided one ignored)', pct.used === 1 && pct.pending === 0 && pct.total_discount === p3m.price - promoTotal && pct.state === 'live', pct);
check('expired coupon shows expired', list.find((x) => x.code === 'TOLDE2E').state === 'expired');
check('used-up coupon shows used_up', list.find((x) => x.code === 'TONCEE2E').state === 'used_up');
await call(ADMIN, 'PATCH', `/coupons/${pct.id}`, { active: false }, admin);
check('paused coupon rejected', /not valid/.test((await q({ coupon_code: 'TPCTE2E' })).data.error));
r = await call(ADMIN, 'GET', `/coupons/${pct.id}/redemptions`, undefined, admin);
check('usage history lists member', r.data.some((x: any) => x.member_id === m2 && x.status === 'applied'));
await call(ADMIN, 'PATCH', `/members/${m1}/memberships/${sql(`SELECT id FROM memberships WHERE member_id=${m1} AND coupon_id IS NOT NULL ORDER BY id LIMIT 1`)[0].id}`, { status: 'cancelled' }, admin);
check('cancelling a term releases its coupon', sql(`SELECT status FROM coupon_redemptions WHERE member_id=${m1} ORDER BY id LIMIT 1`)[0].status === 'void');

console.log('\n── cleanup');
const ids = `${m1},${m2}`;
sql(`DELETE FROM coupon_redemptions WHERE member_id IN (${ids}); DELETE FROM payments WHERE member_id IN (${ids}); DELETE FROM memberships WHERE member_id IN (${ids});
     DELETE FROM accounts WHERE member_id IN (${ids}); UPDATE device_commands SET status='cancelled', result='coupon e2e' WHERE essl_id='CGT2' AND status IN ('pending','sent');
     DELETE FROM members WHERE id IN (${ids}); DELETE FROM coupons WHERE code LIKE 'T%E2E'; DELETE FROM login_attempts;
     UPDATE settings SET value='${receiptBefore.replace(/'/g, "''")}' WHERE key='receipt'; UPDATE settings SET value='${upiBefore.replace(/'/g, "''")}' WHERE key='upi';
     UPDATE devices SET approved=1 WHERE sn='CUB7252100258'`);
check('test data removed', sql(`SELECT COUNT(*) n FROM members WHERE id IN (${ids})`)[0].n === 0 && sql(`SELECT COUNT(*) n FROM coupons WHERE code LIKE 'T%E2E'`)[0].n === 0);
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
