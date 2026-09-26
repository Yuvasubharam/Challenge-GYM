// End-to-end simulator for the device worker. Speaks the exact ADMS wire format of the
// eSSL X990 (firmware Ver 6.60, ZMM200_TFT) and the gym-PC agent API, and asserts DB effects.
//
//   npm run dev:device -- --test-scheduled      (terminal 1)
//   node test/adms-sim.mjs                      (terminal 2)
import { execFileSync } from 'node:child_process';
const WRANGLER = ['node_modules/wrangler/bin/wrangler.js'];

const BASE = process.env.DEVICE_URL ?? 'http://127.0.0.1:8790';
const SN = 'CUB7252100258';
const AGENT = process.env.AGENT_TOKEN ?? 'dev-agent-token';
let pass = 0, fail = 0;

function sql(q) {
  const out = execFileSync(process.execPath, [...WRANGLER, 'd1', 'execute', 'challenge-gym', '--local', '-c', 'wrangler.device.toml',
    '--persist-to', '.wrangler/state', '--json', '--command', q], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out)[0].results;
}
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name} ${detail}`); }
}
async function dev(path, init) {
  const r = await fetch(BASE + path, init);
  return { status: r.status, text: await r.text() };
}
const post = (path, body, headers = {}) => dev(path, { method: 'POST', body, headers: { 'Content-Type': 'text/plain', ...headers } });
const agent = (path, body) => fetch(BASE + '/agent' + path, {
  method: 'POST', headers: { Authorization: `Bearer ${AGENT}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}),
}).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }));
const cron = () => dev('/__scheduled?cron=*/5+*+*+*+*');
const poll = async () => (await dev(`/iclock/getrequest?SN=${SN}`)).text;
const cmds = (text) => text.split('\n').filter((l) => l.startsWith('C:')).map((l) => {
  const [, id, ...rest] = l.split(':'); return { id: Number(id), line: rest.join(':') };
});
const reply = (id, ret = 0, verb = 'DATA') => post(`/iclock/devicecmd?SN=${SN}`, `ID=${id}&Return=${ret}&CMD=${verb}\n`);

console.log('\n── seed');
execFileSync(process.execPath, [...WRANGLER, 'd1', 'execute', 'challenge-gym', '--local', '-c', 'wrangler.device.toml', '--persist-to', '.wrangler/state',
  '--file', 'test/fixtures/sim-seed.sql'], { stdio: 'ignore' });
check('fixture loaded', sql('SELECT COUNT(*) n FROM members')[0].n === 3);

console.log('\n── 1. handshake');
let r = await dev(`/iclock/cdata?SN=${SN}&options=all&pushver=2.2.14&language=69`);
check('returns GET OPTION', r.text.startsWith(`GET OPTION FROM: ${SN}`), r.text.slice(0, 60));
check('timezone 5.5 (IST)', r.text.includes('TimeZone=5.5'));
check('device auto-approved from allowlist', sql(`SELECT approved FROM devices WHERE sn='${SN}'`)[0]?.approved === 1);

console.log('\n── 2. attendance upload (ATTLOG, firmware 6.60 format)');
const att = '9001\t2026-09-26 10:25:45\t0\t1\t0\t0\t0\n9001\t2026-09-26 18:02:10\t1\t1\t0\t0\t0\nCGA5\t2026-09-26 10:30:00\t0\t1\t0\t0\t0\n';
r = await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, att);
check('device gets OK', r.status === 200 && r.text.startsWith('OK'), r.text);
let rows = sql(`SELECT * FROM attendance ORDER BY punched_at`);
check('3 punches stored', rows.length === 3, JSON.stringify(rows.length));
check('IST offset preserved (no 5.5h shift)', rows[0].punched_at === '2026-09-26T10:25:45+05:30', rows[0]?.punched_at);
check('punch linked to member', rows[0].member_id === 9001);
r = await post(`/iclock/cdata?SN=${SN}&table=ATTLOG&Stamp=9999`, att);
check('re-upload is idempotent', sql('SELECT COUNT(*) n FROM attendance')[0].n === 3);
r = await post(`/iclock/cdata?SN=FAKE0000001&table=ATTLOG`, '9001\t2026-09-26 11:00:00\t0\t1\t0\n');
check('unknown device SN is ignored', sql('SELECT COUNT(*) n FROM attendance')[0].n === 3 && r.text === 'OK');

console.log('\n── 3. expiry → reconcile queues block (staff protected)');
await cron();
let q = sql(`SELECT essl_id, action, status FROM device_commands ORDER BY id`);
check('block queued for expired 9002', q.some((c) => c.essl_id === '9002' && c.action === 'block'), JSON.stringify(q));
check('staff CGA5 NOT blocked despite expired plan', !q.some((c) => c.essl_id === 'CGA5'));
check('active 9001 untouched', !q.some((c) => c.essl_id === '9001'));

console.log('\n── 4. block flow: template backup first, then remove');
let c1 = cmds(await poll());
check('first delivers fingerprint backup query', c1.length === 1 && c1[0].line === 'DATA QUERY FINGERTMP PIN=9002', JSON.stringify(c1));
r = await post(`/iclock/cdata?SN=${SN}&table=OPERLOG&OpStamp=1`, 'FP PIN=9002\tFID=6\tSize=8\tValid=1\tTMP=TENTUzIxAAAF\n');
check('template stored in cloud', sql(`SELECT COUNT(*) n FROM bio_templates WHERE essl_id='9002'`)[0].n === 1);
await reply(c1[0].id);
let c2 = cmds(await poll());
check('then delivers DELETE', c2.length === 1 && c2[0].line === 'DATA DELETE USERINFO PIN=9002', JSON.stringify(c2));
await reply(c2[0].id);
check('member marked removed', sql(`SELECT device_state FROM members WHERE id=9002`)[0].device_state === 'removed');
check('command done', sql(`SELECT status FROM device_commands WHERE essl_id='9002' AND action='block'`)[0].status === 'done');
check('idle poll returns OK', (await poll()).trim() === 'OK');

console.log('\n── 5. renewal → unblock restores user + fingerprint (tab separated)');
sql(`INSERT INTO memberships (member_id, category, duration_label, start_date, end_date, price) VALUES (9002,'Strength','1 Month',date('now'),date('now','+30 day'),1500)`);
await cron();
let c3 = cmds(await poll());
check('2 lines: USERINFO + FINGERTMP', c3.length === 2, JSON.stringify(c3));
check('USERINFO uses TAB separators', c3[0]?.line === 'DATA UPDATE USERINFO PIN=9002\tName=Sim Expired\tPri=0\tPasswd=\tCard=\tGrp=1', JSON.stringify(c3[0]?.line));
check('FINGERTMP restores FID 6', c3[1]?.line === 'DATA UPDATE FINGERTMP PIN=9002\tFID=6\tSize=12\tValid=1\tTMP=TENTUzIxAAAF', JSON.stringify(c3[1]?.line));
check('no space-separated junk PINs possible', !c3.some((c) => / PIN=\S+ \S+=/.test(c.line)));
await reply(c3[0].id);
check('not done until every line answers', sql(`SELECT status FROM device_commands WHERE essl_id='9002' AND action='unblock'`)[0].status === 'sent');
await reply(c3[1].id);
check('member active again', sql(`SELECT device_state FROM members WHERE id=9002`)[0].device_state === 'active');

console.log('\n── 6. device error handling + stale requeue');
sql(`INSERT INTO device_commands (essl_id, action, payload) VALUES ('9001','upsert_user','{"name":"Sim Active"}')`);
let c4 = cmds(await poll());
await reply(c4[0].id, -1002);
check('non-zero Return marks failed', sql(`SELECT status FROM device_commands WHERE essl_id='9001' ORDER BY id DESC LIMIT 1`)[0].status === 'failed');
sql(`INSERT INTO device_commands (essl_id, action, payload, status, channel, attempts, sent_at) VALUES ('9001','upsert_user','{}','sent','adms',1,'2000-01-01T00:00:00Z')`);
await cron();
check('unanswered command requeued', sql(`SELECT status FROM device_commands WHERE sent_at='2000-01-01T00:00:00Z' OR (essl_id='9001' AND status='pending')`).some((x) => x.status === 'pending'));
sql(`UPDATE device_commands SET status='cancelled' WHERE status IN ('pending','sent')`);

console.log('\n── 7. agent path (TCP fallback via gym PC)');
let a = await fetch(BASE + '/agent/heartbeat', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' });
check('agent rejects bad token', a.status === 401);
a = await agent('/heartbeat', { device: { sn: SN, firmware: 'Ver 6.60', users: 683, fingers: 642, records: 27217 } });
check('heartbeat ok, returns block method', a.json?.ok && a.json.block_method === 'remove', JSON.stringify(a.json));
sql(`UPDATE memberships SET end_date=date('now','-5 day') WHERE member_id=9002`);
await cron();
a = await agent('/commands/claim', { max: 5 });
const blk = a.json?.commands?.find((x) => x.essl_id === '9002');
check('agent can claim block', blk?.action === 'block' && blk.method === 'remove', JSON.stringify(a.json));
check('ADMS cannot double-deliver a claimed command', !(await poll()).includes('9002'));
a = await agent(`/commands/${blk.id}/result`, { ok: true, result: 'deleted uid 7', templates: [{ fid: 3, size: 4, valid: 1, tmp: 'QUJDRA==' }] });
check('agent result accepted', a.json?.ok);
check('agent template backup stored', sql(`SELECT COUNT(*) n FROM bio_templates WHERE essl_id='9002'`)[0].n === 2);
check('member removed via agent', sql(`SELECT device_state FROM members WHERE id=9002`)[0].device_state === 'removed');
a = await agent('/attendance', { sn: SN, punches: [{ pin: '9001', time: '2026-09-25 07:00:00', status: 0, verify: 1 }] });
check('agent attendance ingest', a.json?.inserted === 1, JSON.stringify(a.json));

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
