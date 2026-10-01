// Renewal clears a manual door override and restores access by the new end date (admin worker running locally).
//   npx tsx test/renewal-override-e2e.ts
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { signToken } from '../src/lib/crypto';

const ADMIN = 'http://127.0.0.1:8788/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
// Local wrangler can hand back SQL NULL as the string 'null'.
const ov = (v: unknown) => (v === 'allow' || v === 'deny' ? v : null);
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${JSON.stringify(detail).slice(0, 400)}`); }
};
const secret = /^JWT_SECRET\s*=\s*"?([^"\r\n]+)/m.exec(readFileSync('.dev.vars', 'utf8'))![1];
const owner = sql(`SELECT id, display_name AS name FROM accounts WHERE role='owner' AND active=1 LIMIT 1`)[0];
const cookie = `cg_admin=${await signToken({ aid: owner.id, role: 'owner', mid: null, name: owner.name, aud: 'admin' }, secret, 600)}`;
const call = async (method: string, path: string, body?: unknown) => {
  const r = await fetch(ADMIN + path, { method, headers: { Cookie: cookie, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, data: await r.json() as any };
};

// An expired, non-staff member with a device ID and no command in flight.
const m = sql(`SELECT m.id, m.essl_id FROM members m WHERE m.archived=0 AND m.is_staff=0 AND m.essl_id GLOB '[1-9]*'
               AND (SELECT MAX(end_date) FROM memberships WHERE member_id=m.id AND status='active') < date('now','-40 days')
               AND NOT EXISTS (SELECT 1 FROM device_commands c WHERE c.essl_id=m.essl_id AND c.status IN ('pending','sent')) LIMIT 1`)[0];
const plan = sql(`SELECT id FROM plans WHERE active=1 ORDER BY price LIMIT 1`)[0];
const before = sql(`SELECT access_override, device_state FROM members WHERE id=${m.id}`)[0];
const planIds = sql(`SELECT group_concat(id) AS ids FROM memberships WHERE member_id=${m.id}`)[0].ids;
console.log(`member #${m.essl_id} (id ${m.id}), plan ${plan.id}`);

try {
  // Desk had blocked the member by hand; the device already has them removed.
  sql(`UPDATE members SET access_override='deny', device_state='removed' WHERE id=${m.id}`);
  let r = await call('GET', `/members/${m.id}`);
  check('before: door blocked (manual)', r.data.summary.access === false && r.data.summary.access_override === 'deny', r.data.summary);

  r = await call('POST', `/members/${m.id}/renew`, { plan_id: plan.id, paid: 0 });
  check('renew ok', r.status === 200, r.data);
  check('renewal reports the removed override', r.data.override_cleared === 'deny', r.data);
  check('unblock queued for the device', typeof r.data.device_command === 'number', r.data);
  const cmd = sql(`SELECT action, reason FROM device_commands WHERE id=${r.data.device_command ?? 0}`)[0];
  check('command is an unblock (access restored)', cmd?.action === 'unblock' && cmd.reason === 'access restored', cmd);
  r = await call('GET', `/members/${m.id}`);
  check('after: override gone, door allowed by the new end date', r.data.summary.access_override === null && r.data.summary.access === true, r.data.summary);

  // A manual "allow" is also removed by renewal, so the member is blocked again at the new expiry.
  sql(`UPDATE members SET access_override='allow' WHERE id=${m.id}`);
  r = await call('POST', `/members/${m.id}/renew`, { plan_id: plan.id, paid: 0 });
  check('second renewal removes a manual allow', r.data.override_cleared === 'allow' && ov(sql(`SELECT access_override FROM members WHERE id=${m.id}`)[0].access_override) === null, r.data);
  check('no device command needed (already allowed)', r.data.device_command === null || typeof r.data.device_command === 'number', r.data);
} finally {
  // Put the member back exactly as found.
  sql(`DELETE FROM device_commands WHERE essl_id='${m.essl_id}' AND created_at >= date('now','-1 day') AND status IN ('pending','cancelled');
       DELETE FROM payments WHERE member_id=${m.id} AND membership_id NOT IN (${planIds});
       DELETE FROM coupon_redemptions WHERE member_id=${m.id} AND membership_id NOT IN (${planIds});
       DELETE FROM memberships WHERE member_id=${m.id} AND id NOT IN (${planIds});
       UPDATE members SET access_override=${ov(before.access_override) ? `'${before.access_override}'` : 'NULL'}, device_state='${before.device_state}' WHERE id=${m.id}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
