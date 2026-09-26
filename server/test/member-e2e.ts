// Member API end-to-end test (run after admin-e2e has imported the Excel data).
//   .\run-local.ps1 admin ; .\run-local.ps1 member      (other terminals)
//   npx tsx test/member-e2e.ts
// Safety: device approval is switched off during the run so no command can reach a real X990.
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

console.log('\n── 0. setup');
sql(`UPDATE devices SET approved=0`);
// Only this test's members are touched — real member logins (e.g. staff who activated) are kept.
const FAMILY_MOBILE = '9652157359';
sql(`DELETE FROM login_attempts`);
const admin = (await call(ADMIN, 'POST', '/auth/login', { username: 'owner', password: 'owner-pass-123' })).cookie;
check('admin signed in', admin.startsWith('cg_admin='));
await call(ADMIN, 'PUT', '/settings/upi', { vpa: 'challengegym@okicici', payee: 'Challenge Gym' }, admin);
// Pick a real expired member with a mobile, and the shared-mobile pair from ID 101
const exp = sql(`SELECT m.id, m.essl_id, m.name, m.mobile FROM members m JOIN v_current_membership cm ON cm.member_id=m.id
                 WHERE m.archived=0 AND m.mobile IS NOT NULL AND length(m.mobile)=10 AND cm.end_date < date('now','+5 hours','+30 minutes') AND m.essl_id GLOB '[0-9]*'
                   AND (SELECT COUNT(*) FROM members x WHERE x.mobile=m.mobile) = 1 LIMIT 1`)[0];
check('test member found (expired, own mobile)', !!exp, exp);
console.log(`    using #${exp.essl_id} ${exp.name}`);
const testIds = [exp.id, ...sql(`SELECT id FROM members WHERE mobile='${FAMILY_MOBILE}'`).map((x: any) => x.id)].join(',');
sql(`DELETE FROM accounts WHERE member_id IN (${testIds})`);

console.log('\n── 1. activation & login');
let r = await call(MEMBER, 'POST', '/auth/login', { id: exp.mobile, password: 'whatever' });
check('login before activation explains what to do', r.status === 401 && /not activated/i.test(r.data.error), r.data);
r = await call(MEMBER, 'POST', '/auth/activate', { mobile: exp.mobile, memberId: '99999', password: 'secret1' });
check('activation with wrong ID rejected', r.status === 404);
r = await call(MEMBER, 'POST', '/auth/activate', { mobile: exp.mobile, memberId: exp.essl_id, password: '123' });
check('short password rejected', r.status === 400);
r = await call(MEMBER, 'POST', '/auth/activate', { mobile: exp.mobile, memberId: exp.essl_id, password: 'secret1' });
check('activation ok + member cookie', r.status === 200 && r.cookie.startsWith('cg_member='), r.data);
let mc = r.cookie;
r = await call(MEMBER, 'POST', '/auth/activate', { mobile: exp.mobile, memberId: exp.essl_id, password: 'secret1' });
check('cannot activate twice', r.status === 409);
r = await call(MEMBER, 'POST', '/auth/login', { id: exp.mobile, password: 'secret1' });
check('login by mobile', r.status === 200);
r = await call(MEMBER, 'POST', '/auth/login', { id: exp.essl_id, password: 'secret1' });
check('login by member ID', r.status === 200);
mc = r.cookie;

console.log('\n── 2. isolation between the two apps');
check('member cookie rejected by admin API', (await call(ADMIN, 'GET', '/members', undefined, mc.replace('cg_member=', 'cg_admin='))).status === 401);
check('member token as Bearer rejected by admin API', (await fetch(ADMIN + '/members', { headers: { Authorization: `Bearer ${mc.split('=')[1]}` } })).status === 401);
check('admin cookie rejected by member API', (await call(MEMBER, 'GET', '/me', undefined, admin.replace('cg_admin=', 'cg_member='))).status === 401);
check('member API has no admin routes', (await call(MEMBER, 'GET', '/members', undefined, mc)).status === 404);

console.log('\n── 3. member data');
r = await call(MEMBER, 'GET', '/me', undefined, mc);
check('home shows own plan', r.status === 200 && r.data.member.essl_id === exp.essl_id && r.data.plan.status === 'expired', r.data.plan);
check('door shows blocked for expired', r.data.door.allowed === false);
check('UPI details exposed for payment', r.data.upi?.vpa === 'challengegym@okicici');
r = await call(MEMBER, 'GET', '/me/attendance', undefined, mc);
check('attendance endpoint', r.status === 200 && Array.isArray(r.data.days));
r = await call(MEMBER, 'GET', '/me/plan', undefined, mc);
check('plans listed for renewal', r.data.plans.length >= 4);
const plan = r.data.plans[0];
r = await call(MEMBER, 'PATCH', '/me', { email: 'test@example.com', name: 'Hacker' }, mc);
check('can edit own details (name ignored)', r.status === 200 && sql(`SELECT name, email FROM members WHERE id=${exp.id}`)[0].name === exp.name);
const other = sql(`SELECT id FROM payments WHERE member_id <> ${exp.id} AND status='confirmed' LIMIT 1`)[0];
check("cannot read another member's receipt", (await call(MEMBER, 'GET', `/me/receipt/${other.id}`, undefined, mc)).status === 404);

console.log('\n── 4. UPI renewal → desk confirms → renewed + door restored');
r = await call(MEMBER, 'POST', '/me/payments', { amount: plan.price - 1, reference: '426500000001', plan_id: plan.id }, mc);
check('underpayment for plan rejected', r.status === 400);
r = await call(MEMBER, 'POST', '/me/payments', { amount: plan.price, reference: 'x', plan_id: plan.id }, mc);
check('invalid UTR rejected', r.status === 400);
r = await call(MEMBER, 'POST', '/me/payments', { amount: plan.price, reference: '426500000001', plan_id: plan.id }, mc);
check('renewal claim submitted (pending)', r.status === 200 && r.data.status === 'pending', r.data);
const payId = r.data.id;
check('duplicate UTR rejected', (await call(MEMBER, 'POST', '/me/payments', { amount: plan.price, reference: '426500000001', plan_id: plan.id }, mc)).status === 409);
r = await call(MEMBER, 'GET', '/me/plan', undefined, mc);
check('member sees renewal waiting', r.data.pending_renewal?.id === payId);
r = await call(ADMIN, 'GET', '/payments?status=pending', undefined, admin);
const row = r.data.payments.find((p: any) => p.id === payId);
check('desk sees request with plan name', row?.request_plan_name === plan.name, row);
sql(`UPDATE members SET device_state='removed' WHERE id=${exp.id}`); // as if auto-blocking had removed them
r = await call(ADMIN, 'POST', `/payments/${payId}/confirm`, {}, admin);
check('desk confirms → receipt + renewal term', r.status === 200 && r.data.receipt_no && r.data.renewal?.membership_id, r.data);
check('door unblock command queued', !!r.data.device_command && sql(`SELECT action FROM device_commands WHERE id=${r.data.device_command}`)[0].action === 'unblock');
r = await call(MEMBER, 'GET', '/me', undefined, mc);
check('member now active with door access', r.data.plan.status !== 'expired' && r.data.door.allowed === true && r.data.plan.due === 0, { plan: r.data.plan, door: r.data.door });
r = await call(MEMBER, 'GET', `/me/receipt/${payId}`, undefined, mc);
check('member can open own receipt', r.status === 200 && r.data.payment.amount === plan.price);

console.log('\n── 5. shared mobile (family) login');
const fam = sql(`SELECT id, essl_id, name, mobile FROM members WHERE mobile='9652157359' AND archived=0 ORDER BY id`);
check('two members share mobile 9652157359', fam.length === 2, fam);
const a1 = await call(MEMBER, 'POST', '/auth/activate', { mobile: fam[0].mobile, memberId: fam[0].essl_id ?? 'x', password: 'fam-one' });
check('first family member activates with ID', a1.status === 200, a1.data);
await call(ADMIN, 'POST', `/members/${fam[1].id}/reset-password`, { password: 'fam-two' }, admin);
const l2 = await call(MEMBER, 'POST', '/auth/login', { id: fam[0].mobile, password: 'fam-two' });
const who = await call(MEMBER, 'GET', '/auth/me', undefined, l2.cookie);
check('same mobile, second password → second person', l2.status === 200 && who.data.mid === fam[1].id, who.data);

console.log('\n── 6. brute force');
for (let i = 0; i < 5; i++) await call(MEMBER, 'POST', '/auth/login', { id: exp.essl_id, password: 'wrong' });
check('locked after 5 wrong attempts', (await call(MEMBER, 'POST', '/auth/login', { id: exp.essl_id, password: 'secret1' })).status === 429);

console.log('\n── cleanup');
sql(`UPDATE device_commands SET status='cancelled', result='e2e test' WHERE status IN ('pending','sent')`);
// Undo everything this test changed on real imported records
sql(`DELETE FROM memberships WHERE id IN (SELECT membership_id FROM payments WHERE reference LIKE '4265000000%'); DELETE FROM payments WHERE reference LIKE '4265000000%';
     UPDATE members SET email=NULL, device_state='unknown' WHERE id=${exp.id}; DELETE FROM accounts WHERE member_id IN (${testIds});
     UPDATE settings SET value='{"vpa":"","payee":"Challenge Gym"}' WHERE key='upi'; UPDATE settings SET value=json_set(value,'$.next',json_extract(value,'$.next')-1) WHERE key='receipt';
     DELETE FROM login_attempts; UPDATE devices SET approved=1 WHERE sn='CUB7252100258'`);
check('no pending device commands left', sql(`SELECT COUNT(*) n FROM device_commands WHERE status IN ('pending','sent')`)[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
