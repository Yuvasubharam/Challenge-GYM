// Device-side expiry reset: an allowed member rejected at the door (ATTLOG status 254) is
// auto-queued for delete + re-add, and unblock clears the device record before restoring it.
// Non-destructive: uses a temporary member ZZ901 and removes it afterwards.
//   npm run dev:device      (terminal 1)
//   node test/device-reset-sim.mjs
import { execFileSync } from 'node:child_process';

const BASE = process.env.DEVICE_URL ?? 'http://127.0.0.1:8790';
let pass = 0, fail = 0;
const sql = (q) => JSON.parse(execFileSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', 'd1', 'execute', 'challenge-gym', '--local',
  '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }))[0].results;
const check = (name, cond, detail = '') => { if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); } };
const dev = async (path, init) => { const r = await fetch(BASE + path, init); return { status: r.status, text: await r.text() }; };
const post = (path, body) => dev(path, { method: 'POST', body, headers: { 'Content-Type': 'text/plain' } });

const SN = sql(`SELECT sn FROM devices WHERE approved=1 LIMIT 1`)[0]?.sn;
if (!SN) { console.log('No approved device in the local DB'); process.exit(1); }
const PIN = 'ZZ901';
const TMP = 'TBNTUzIxAAAFAAAA'.repeat(20);
const cleanup = () => sql(`DELETE FROM attendance WHERE essl_id='${PIN}'; DELETE FROM adms_lines WHERE command_id IN (SELECT id FROM device_commands WHERE essl_id='${PIN}');
  DELETE FROM device_commands WHERE essl_id='${PIN}'; DELETE FROM bio_templates WHERE essl_id='${PIN}'; DELETE FROM device_users WHERE essl_id='${PIN}'; DELETE FROM members WHERE essl_id='${PIN}'`);
cleanup();
// Leave other members' pending commands alone: this sim only answers lines for ZZ901
sql(`INSERT INTO members (essl_id, name, access_override, device_state) VALUES ('${PIN}', 'Reset Test', 'allow', 'active');
     INSERT INTO bio_templates (essl_id, fid, size, valid, tmp, source) VALUES ('${PIN}', 6, ${TMP.length}, 1, '${TMP}', 'adms');
     INSERT INTO device_users (essl_id, name, fp_count, on_device, source, seen_at) VALUES ('${PIN}', 'Reset Test', 1, 1, 'agent', '2026-10-01T00:00:00Z')`);

console.log('\n── rejected at the door');
const now = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 19).replace('T', ' ');
let r = await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, `${PIN}\t${now}\t254\t1\t0\t0\t0\n`);
check('punch accepted', r.status === 200 && r.text.startsWith('OK'), r.text);
let c = sql(`SELECT * FROM device_commands WHERE essl_id='${PIN}'`);
check('auto-heal queued one unblock', c.length === 1 && c[0].action === 'unblock' && c[0].created_by === 'auto-heal', JSON.stringify(c));
await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, `${PIN}\t${now.slice(0, 17)}59\t254\t1\t0\t0\t0\n`);
check('no duplicate on a second rejection', sql(`SELECT COUNT(*) n FROM device_commands WHERE essl_id='${PIN}'`)[0].n === 1);

console.log('\n── device picks it up');
let mine = [];
for (let i = 0; i < 10 && !mine.length; i++) {
  const text = (await dev(`/iclock/getrequest?SN=${SN}`)).text;
  const ids = new Set(sql(`SELECT l.seq FROM adms_lines l JOIN device_commands d ON d.id=l.command_id WHERE d.essl_id='${PIN}'`).map((x) => x.seq));
  mine = text.split('\n').filter((l) => l.startsWith('C:')).map((l) => { const [, id, ...rest] = l.split(':'); return { id: Number(id), line: rest.join(':') }; }).filter((x) => ids.has(x.id));
}
check('delete, then user, then fingerprint', mine.length === 3 && mine[0].line === `DATA DELETE USERINFO PIN=${PIN}` && mine[1].line.startsWith(`DATA UPDATE USERINFO PIN=${PIN}`) && mine[2].line.startsWith(`DATA UPDATE FINGERTMP PIN=${PIN}\tFID=6`), JSON.stringify(mine.map((m) => m.line.slice(0, 40))));
// Device answers: delete fails harmlessly on some firmware (-1), the rest succeed
await post(`/iclock/devicecmd?SN=${SN}`, mine.map((m, i) => `ID=${m.id}&Return=${i === 0 ? -1 : 0}&CMD=DATA`).join('\n') + '\n');
c = sql(`SELECT status, result FROM device_commands WHERE essl_id='${PIN}'`)[0];
check('command done even if delete returned non-zero', c.status === 'done' && c.result === 'ok', JSON.stringify(c));

console.log('\n── incomplete backup is never deleted');
sql(`UPDATE device_users SET fp_count=2 WHERE essl_id='${PIN}'; INSERT INTO device_commands (essl_id, action, payload, reason, created_by) VALUES ('${PIN}', 'unblock', '{"name":"Reset Test"}', 'test', 'sim')`);
mine = [];
for (let i = 0; i < 10 && !mine.length; i++) {
  const text = (await dev(`/iclock/getrequest?SN=${SN}`)).text;
  const ids = new Set(sql(`SELECT l.seq FROM adms_lines l JOIN device_commands d ON d.id=l.command_id WHERE d.essl_id='${PIN}' AND d.status='sent'`).map((x) => x.seq));
  mine = text.split('\n').filter((l) => l.startsWith('C:')).map((l) => { const [, id, ...rest] = l.split(':'); return { id: Number(id), line: rest.join(':') }; }).filter((x) => ids.has(x.id));
}
check('1 of 2 fingers backed up → plain update, no delete', mine.length === 2 && !mine.some((m) => m.line.startsWith('DATA DELETE')), JSON.stringify(mine.map((m) => m.line.slice(0, 40))));
await post(`/iclock/devicecmd?SN=${SN}`, mine.map((m) => `ID=${m.id}&Return=0&CMD=DATA`).join('\n') + '\n');

console.log('\n── expired members are not healed');
cleanup();
sql(`INSERT INTO members (essl_id, name, access_override, device_state) VALUES ('${PIN}', 'Reset Test', 'deny', 'removed')`);
await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, `${PIN}\t${now}\t254\t1\t0\t0\t0\n`);
check('denied member → nothing queued', sql(`SELECT COUNT(*) n FROM device_commands WHERE essl_id='${PIN}'`)[0].n === 0);

cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
