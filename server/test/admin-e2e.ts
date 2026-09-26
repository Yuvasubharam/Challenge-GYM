// Admin API end-to-end test against the local admin worker, using the REAL Excel master sheet.
//   npx wrangler dev -c wrangler.admin.toml --port 8788 --persist-to .wrangler/state   (terminal 1)
//   npx tsx test/admin-e2e.ts "<path to GYM_Membership_System.xlsx>"                   (terminal 2)
// Safety: device approval is switched off during the run so no command can reach a real X990.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { chunk, parseWorkbook } from '../../admin-app/src/lib/excelImport';

const BASE = process.env.ADMIN_URL ?? 'http://127.0.0.1:8788/api';
const XLSX_PATH = process.argv[2];
let pass = 0, fail = 0;
let cookie = '';

const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`); }
};
async function call<T = any>(method: string, path: string, body?: unknown, useCookie = cookie): Promise<{ status: number; data: T; headers: Headers }> {
  const r = await fetch(BASE + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(useCookie ? { Cookie: useCookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  if (sc && useCookie === cookie) cookie = sc.split(';')[0];
  const ct = r.headers.get('content-type') ?? '';
  return { status: r.status, data: (ct.includes('json') ? await r.json() : await r.text()) as T, headers: r.headers };
}

if (process.env.ALLOW_DESTRUCTIVE !== '1') {
  console.error('admin-e2e DELETES all members, payments and logins in the LOCAL database and re-imports the Excel.\nRe-run with ALLOW_DESTRUCTIVE=1 if that is what you want.');
  process.exit(2);
}
console.log('\n── 0. safety + clean slate (device data kept)');
sql(`UPDATE devices SET approved=0`);
sql(`DELETE FROM payments; DELETE FROM memberships; DELETE FROM followups; DELETE FROM accounts; DELETE FROM login_attempts; DELETE FROM audit_log;
     UPDATE device_commands SET status='cancelled' WHERE status IN ('pending','sent'); DELETE FROM members;
     UPDATE settings SET value='{"prefix":"CG","next":1}' WHERE key='receipt'`);
check('device unapproved for the test run', sql(`SELECT MAX(approved) a FROM devices`)[0].a === 0);

console.log('\n── 1. auth');
let r = await call('GET', '/health', undefined, '');
check('health is public', r.status === 200);
r = await call('GET', '/members', undefined, '');
check('members require login', r.status === 401);
r = await call('GET', '/auth/status', undefined, '');
check('needs setup', r.data.needsSetup === true);
r = await call('POST', '/auth/setup', { setupToken: 'wrong', username: 'owner', password: 'owner-pass-123', name: 'Yuva' }, '');
check('setup rejects wrong token', r.status === 403);
r = await call('POST', '/auth/setup', { setupToken: 'dev-setup', username: 'owner', password: 'owner-pass-123', name: 'Yuva Subharam' });
check('owner created + signed in', r.status === 200 && cookie.startsWith('cg_admin='), r.data);
check('session cookie is HttpOnly + SameSite=Strict', /HttpOnly/i.test(r.headers.get('set-cookie') ?? '') && /SameSite=Strict/i.test(r.headers.get('set-cookie') ?? ''));
r = await call('POST', '/auth/setup', { setupToken: 'dev-setup', username: 'x', password: 'xxxxxxxxx' }, '');
check('setup cannot run twice', r.status === 409);
r = await call('POST', '/auth/login', { username: 'owner', password: 'nope' }, '');
check('wrong password → 401', r.status === 401);
const text = await fetch(BASE + '/members', { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'text/plain' }, body: '{}' });
check('non-JSON POST rejected (CSRF guard)', text.status === 415);

console.log('\n── 2. Excel import — preview');
const file = new File([readFileSync(XLSX_PATH)], 'GYM_Membership_System.xlsx');
const parsed = await parseWorkbook(file);
check('parsed master rows', parsed.members.length >= 630, parsed.members.length);
check('parsed payment rows', parsed.payments.length >= 600, parsed.payments.length);
check('parsed follow-ups', parsed.followups.length >= 200, parsed.followups.length);
const sample = parsed.members.find((m) => m.essl_id === '1');
check('date + money parsing (ID 1)', sample?.start_date === '2026-02-01' && sample?.end_date === '2027-02-01' && sample?.total === 7999, sample);
const parts = chunk(parsed);
const sum = async (commit: boolean) => {
  const t: Record<string, any> = { shared: [], noEnd: 0 };
  for (const p of parts) {
    const x = (await call('POST', '/import/excel', { ...p, commit })).data;
    for (const k of ['members_new', 'members_updated', 'terms_new', 'payments_new', 'followups_new', 'dues_adjusted']) t[k] = (t[k] ?? 0) + (x[k] ?? 0);
    t.shared.push(...(x.shared_ids ?? [])); t.noEnd += x.no_end_date?.length ?? 0;
  }
  return t;
};
const pre = await sum(false);
console.log('    preview:', JSON.stringify({ ...pre, shared: pre.shared.map((s: any) => s.essl_id) }));
check('preview writes nothing', sql(`SELECT COUNT(*) n FROM members`)[0].n === 0);
check('shared IDs 101 & 268 detected', pre.shared.length === 2, pre.shared);

console.log('\n── 3. Excel import — commit + idempotency');
const t0 = Date.now();
const done = await sum(true);
console.log(`    committed in ${((Date.now() - t0) / 1000).toFixed(1)}s:`, JSON.stringify({ ...done, shared: undefined }));
check('members imported', sql(`SELECT COUNT(*) n FROM members`)[0].n === pre.members_new, sql(`SELECT COUNT(*) n FROM members`)[0].n);
check('payments imported', sql(`SELECT COUNT(*) n FROM payments`)[0].n === pre.payments_new);
const again = await sum(false);
check('re-import adds nothing new', again.members_new === 0 && again.terms_new === 0 && again.payments_new === 0 && again.followups_new === 0, again);
check('no device commands queued by import', sql(`SELECT COUNT(*) n FROM device_commands WHERE status='pending'`)[0].n === 0);
check('staff flagged from CGA prefix', sql(`SELECT COUNT(*) n FROM members WHERE essl_id LIKE 'CGA%' AND is_staff=0`)[0].n === 0);

console.log('\n── 4. numbers vs the Excel Dashboard (refreshed 26-Sep-2026 10:09)');
const dash = (await call('GET', '/dashboard')).data;
const m = dash.members;
console.log('    app:', JSON.stringify({ total: m.total, active: m.active, near: m.near_expiry, soon: m.expiring, expired: m.expired, none: m.no_plan, dues: m.dues_total, with_dues: m.with_dues, all_time: dash.money.all_time }));
console.log('    xls: {"total":632,"active":129,"near":77,"soon":28,"expired":398(incl. 10 without end date),"dues":28000,"with_dues":14,"collected":2120806}');
check('total members = 632 + 2 separated shared-ID people', m.total === 634 || m.total === 632, m.total);
check('active/near/soon within ±3 of sheet (day boundary)', Math.abs(m.active - 129) <= 3 && Math.abs(m.near_expiry - 77) <= 3 && Math.abs(m.expiring - 28) <= 3);
check('expired + no-plan ≈ 398', Math.abs(m.expired + m.no_plan - 398) <= 4, m.expired + m.no_plan);
check('collected all-time = ₹21,20,806', dash.money.all_time === 2120806, dash.money.all_time);
// The workbook is internally inconsistent (Dashboard tab ₹28,000/14, TOTAL row ₹13,000); the
// member rows themselves are the source of truth.
const sheetDue = parsed.members.filter((x) => (x.pending ?? 0) > 0);
check(`pending dues match Master Data rows (₹${sheetDue.reduce((s, x) => s + (x.pending ?? 0), 0)} across ${sheetDue.length})`,
  m.dues_total === sheetDue.reduce((s, x) => s + (x.pending ?? 0), 0) && m.with_dues === sheetDue.length, { dues: m.dues_total, n: m.with_dues });

console.log('\n── 5. daily operations');
const list = (await call('GET', '/members?status=expired')).data.members;
const target = list.find((x: any) => x.essl_id && /^\d+$/.test(x.essl_id));
const plans = (await call('GET', '/plans')).data;
r = await call('POST', `/members/${target.id}/renew`, { plan_id: plans[0].id, paid: plans[0].price, mode: 'upi', reference: 'TEST123' });
check('renew expired member', r.status === 200 && r.data.payment?.receipt_no === 'CG-000001', r.data);
const after = (await call('GET', `/members/${target.id}`)).data.summary;
check('renewed member is active again', after.status !== 'expired' && after.access === true, after.status);
r = await call('GET', `/payments/${r.data.payment.id}/receipt`);
check('receipt data', r.data.payment?.receipt_no === 'CG-000001');
r = await call('POST', '/members', { name: 'E2E Test Person', mobile: '9999900000', plan_id: plans[0].id, paid: 500 });
check('add member without device ID', r.status === 200);
const newId = r.data.id;
const nm = (await call('GET', `/members/${newId}`)).data.summary;
check('partial payment → dues', nm.due === plans[0].price - 500, nm.due);
r = await call('POST', `/members/${newId}/payments`, { amount: nm.due, mode: 'cash' });
check('collect dues', r.status === 200 && (await call('GET', `/members/${newId}`)).data.summary.due === 0);
r = await call('POST', '/members', { name: 'Dup', essl_id: '1' });
check('duplicate device ID rejected', r.status === 409);
r = await call('POST', `/members/${newId}/freeze`, { until: '2099-01-01' });
check('freeze → frozen', (await call('GET', `/members/${newId}`)).data.summary.status === 'frozen');
r = await call('POST', `/members/${newId}/unfreeze`, {});
check('unfreeze', (await call('GET', `/members/${newId}`)).data.summary.status !== 'frozen');
r = await call('GET', '/renewals');
check('renewals worklist', r.status === 200 && r.data.members.length > 50, r.data.members?.length);
r = await call('GET', '/attendance');
check('attendance today (device punches linked)', r.status === 200 && r.data.visitors >= 1, r.data.visitors);
r = await call('GET', '/access/preview');
const blocks = r.data.filter((x: any) => x.action === 'block').length;
check('access preview lists expired members to block', blocks > 300 && !r.data.some((x: any) => /^CG/i.test(x.essl_id)), blocks);
const csv = await fetch(BASE + '/export/members.csv', { headers: { Cookie: cookie } });
check('CSV export', csv.status === 200 && (await csv.text()).split('\n').length > 600);
r = await call('GET', '/device');
check('device page data', r.status === 200 && r.data.coverage.backed_up >= 600, r.data.coverage);

console.log('\n── 6. roles');
await call('POST', '/auth/staff', { name: 'Front Desk', username: 'desk', password: 'desk-pass-123', role: 'staff' });
const ownerCookie = cookie;
cookie = '';
await call('POST', '/auth/login', { username: 'desk', password: 'desk-pass-123' });
const staffCookie = cookie;
check('staff signed in', staffCookie.startsWith('cg_admin=') && staffCookie !== ownerCookie);
check('staff can list members', (await call('GET', '/members', undefined, staffCookie)).status === 200);
check('staff cannot queue device commands', (await call('POST', '/device/commands', { action: 'reboot' }, staffCookie)).status === 403);
check('staff cannot change access settings', (await call('PUT', '/settings/access', { auto_enforce: true }, staffCookie)).status === 403);
check('staff cannot void payments', (await call('POST', '/payments/1/void', { reason: 'x' }, staffCookie)).status === 403);
cookie = ownerCookie;
const staffRow = (await call('GET', '/auth/staff')).data.find((s: any) => s.username === 'desk');
await call('PATCH', `/auth/staff/${staffRow.id}`, { active: false });
check('disabled staff session stops working immediately', (await call('GET', '/members', undefined, staffCookie)).status === 401);

console.log('\n── cleanup: cancel test-queued commands, remove test member, re-approve device');
sql(`UPDATE device_commands SET status='cancelled', result='e2e test' WHERE status IN ('pending','sent')`);
await call('DELETE', `/members/${newId}?keepDevice=1`);
sql(`UPDATE device_commands SET status='cancelled', result='e2e test' WHERE status IN ('pending','sent')`);
sql(`UPDATE devices SET approved=1 WHERE sn='CUB7252100258'`);
check('no pending device commands left', sql(`SELECT COUNT(*) n FROM device_commands WHERE status IN ('pending','sent')`)[0].n === 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
