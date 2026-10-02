// Receipt share link: admin creates it, anyone with the link sees the receipt (no login, no mobile).
//   npx tsx test/receipt-share-e2e.ts   (admin worker :8788 + member worker :8789)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { signToken } from '../src/lib/crypto';

const ADMIN = 'http://127.0.0.1:8788/api';
const MEMBER = 'http://127.0.0.1:8789/api';
let pass = 0, fail = 0;
const sql = (q: string) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name: string, cond: unknown, detail: unknown = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${JSON.stringify(detail).slice(0, 300)}`); }
};
const secret = /^JWT_SECRET\s*=\s*"?([^"\r\n]+)/m.exec(readFileSync('.dev.vars', 'utf8'))![1];
const owner = sql(`SELECT id, display_name AS name FROM accounts WHERE role='owner' AND active=1 LIMIT 1`)[0];
const cookie = `cg_admin=${await signToken({ aid: owner.id, role: 'owner', mid: null, name: owner.name, aud: 'admin' }, secret, 600)}`;
const pay = sql(`SELECT p.id, p.share_token, m.mobile FROM payments p JOIN members m ON m.id=p.member_id WHERE p.status='confirmed' AND m.mobile IS NOT NULL ORDER BY p.id DESC LIMIT 1`)[0];
const before = pay.share_token && pay.share_token !== 'null' ? pay.share_token : null; // local wrangler can return NULL as 'null'

try {
  const r1 = await fetch(`${ADMIN}/payments/${pay.id}/share`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  const t1 = (await r1.json() as { token: string }).token;
  check('admin gets a share token', r1.status === 200 && /^[A-Za-z0-9_-]{16}$/.test(t1), t1);
  const r2 = await fetch(`${ADMIN}/payments/${pay.id}/share`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{}' });
  check('same token on the next share (link stays valid)', (await r2.json() as { token: string }).token === t1);
  const anon = await fetch(`${ADMIN}/payments/${pay.id}/share`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  check('share needs an admin login', anon.status === 401, anon.status);

  const pub = await fetch(`${MEMBER}/r/${t1}`);
  const body = await pub.json() as { payment: Record<string, unknown>; gym: Record<string, unknown> };
  check('public link shows the receipt without login', pub.status === 200 && !!body.payment.name && body.payment.amount !== undefined && !!body.gym.name, body);
  check('mobile number is not exposed', !JSON.stringify(body).includes(String(pay.mobile)) && !('mobile' in body.payment), Object.keys(body.payment));
  const bad = await fetch(`${MEMBER}/r/not-a-real-token-123`);
  check('wrong token → 404', bad.status === 404, bad.status);
  const junk = await fetch(`${MEMBER}/r/x'%20OR%201=1`);
  check('malformed token → 404', junk.status === 404, junk.status);
} finally {
  sql(`UPDATE payments SET share_token=${before ? `'${before}'` : 'NULL'} WHERE id=${pay.id}`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
