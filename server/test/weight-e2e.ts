// Weight tracking API test: weekly weigh-in status, day/week/month history, trend, admin progress + reminder settings.
// Needs the member + admin workers running locally:  npx tsx test/weight-e2e.ts
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
const ist = (offsetDays = 0) => new Date(Date.now() + 330 * 60_000 + offsetDays * 86_400_000).toISOString().slice(0, 10);

console.log('\n── setup');
const m = sql(`SELECT m.id, m.essl_id, m.mobile FROM members m WHERE m.archived=0 AND length(m.mobile)=10
               AND (SELECT COUNT(*) FROM members x WHERE x.mobile=m.mobile)=1 ORDER BY m.id DESC LIMIT 1`)[0];
sql(`DELETE FROM accounts WHERE member_id=${m.id}; DELETE FROM fitness_profiles WHERE member_id=${m.id}; DELETE FROM weight_logs WHERE member_id=${m.id};
     DELETE FROM weight_reminders WHERE member_id=${m.id}; DELETE FROM login_attempts; UPDATE members SET app_access=1 WHERE id=${m.id}`);
let r = await call(MEMBER, 'POST', '/auth/activate', { mobile: m.mobile, memberId: m.essl_id, password: 'secret1' });
const mc = r.cookie;
check(`member #${m.essl_id} signed in`, r.status === 200, r.data);
// Throwaway admin login with the same password hash (removed at the end) — no real credentials needed
sql(`DELETE FROM accounts WHERE username='weight-e2e'; INSERT INTO accounts (role, username, display_name, password_hash)
     SELECT 'admin', 'weight-e2e', 'Weight e2e', password_hash FROM accounts WHERE member_id=${m.id}`);
const admin = (await call(ADMIN, 'POST', '/auth/login', { username: 'weight-e2e', password: 'secret1' })).cookie;

r = await call(MEMBER, 'GET', '/fit/profile', undefined, mc);
check('no weigh-in status before onboarding', r.data.weigh_in === null, r.data.weigh_in);
await call(MEMBER, 'PUT', '/fit/profile', { age: 30, gender: 'male', height_cm: 175, weight_kg: 90, target_weight_kg: 80, goal: 'lose_weight', activity: 'moderate', workouts_per_week: 4 }, mc);
r = await call(MEMBER, 'GET', '/fit/profile', undefined, mc);
check('onboarding counts as first weigh-in → not due', r.data.weigh_in?.due === false && r.data.weigh_in.days_since === 0, r.data.weigh_in);

console.log('\n── weekly history');
// Six weekly weigh-ins, 0.6 kg/week down, ending 7 days ago → due today
sql(`DELETE FROM weight_logs WHERE member_id=${m.id}; INSERT INTO weight_logs (member_id, day, weight_kg) VALUES
     ${[42, 35, 28, 21, 14, 7].map((d, i) => `(${m.id}, '${ist(-d)}', ${90 - i * 0.6})`).join(',')}`);
sql(`UPDATE fitness_profiles SET start_weight_kg=90, weight_kg=87 WHERE member_id=${m.id}`);
r = await call(MEMBER, 'GET', '/fit/profile', undefined, mc);
check('weigh-in due after 7 days', r.data.weigh_in?.due === true && r.data.weigh_in.days_since === 7, r.data.weigh_in);
r = await call(MEMBER, 'GET', '/fit/weight?view=day', undefined, mc);
const t = r.data.trend;
check('day view = each weigh-in', r.data.points.length === 6 && r.data.entries[0].day === ist(-7), r.data.points);
check('trend on track at −0.6 kg/week', t.status === 'on_track' && t.weekly_rate === -0.6 && t.change_total === -3 && t.to_go === 7, t);
check('ETA projected', typeof t.eta === 'string' && t.eta > ist(), t.eta);
r = await call(MEMBER, 'GET', '/fit/weight?view=week', undefined, mc);
check('week view averages per week', r.data.view === 'week' && r.data.points.length >= 6 && r.data.points.every((p: any) => p.n >= 1), r.data.points);
r = await call(MEMBER, 'GET', '/fit/weight?view=month', undefined, mc);
check('month view buckets by month', r.data.points.length >= 2 && r.data.points.every((p: any) => p.day.endsWith('-01')), r.data.points);

console.log('\n── log + delete');
r = await call(MEMBER, 'POST', '/fit/weight', { weight_kg: 86.2 }, mc);
check('logging returns trend, no longer due', r.data.trend?.due === false && r.data.trend.current === 86.2 && r.data.profile.weight_kg === 86.2, r.data.trend);
r = await call(MEMBER, 'POST', '/fit/weight', { weight_kg: 86, date: ist(1) }, mc);
check('future date rejected', r.status === 400);
await call(MEMBER, 'DELETE', `/fit/weight/${ist()}`, undefined, mc);
r = await call(MEMBER, 'GET', '/fit/profile', undefined, mc);
check('deleting newest entry restores previous weight on profile', r.data.profile.weight_kg === 87 && r.data.weigh_in.due === true, { w: r.data.profile.weight_kg, wi: r.data.weigh_in });

console.log('\n── admin');
r = await call(ADMIN, 'GET', '/fitness/weight-progress', undefined, admin);
const row = r.data.members?.find((x: any) => x.id === m.id);
check('progress row: −3 kg, 30%, overdue', row && row.change === -3 && row.good_change === 3 && row.progress === 30 && row.overdue === true, row);
check('totals count lost kg', r.data.totals.kg_lost >= 3, r.data.totals);
r = await call(ADMIN, 'PUT', '/settings/weight_push', { enabled: false, weekday: 0, send_hour: 8, due_title: 'Weigh-in, {name}!', on_track: ['{change} kg so far, {to_go} to go'] }, admin);
check('settings saved + clamped', r.status === 200 && r.data.value.due_title === 'Weigh-in, {name}!' && r.data.value.off_track.length > 0, r.data);
r = await call(ADMIN, 'GET', '/weight-push', undefined, admin);
check('preview renders progress line', r.status === 200 && /-3\.6 kg so far, 6\.4 to go/.test(r.data.preview.on_track.body), r.data.preview);

console.log('\n── reminder shown to the phone');
sql(`INSERT OR REPLACE INTO weight_reminders (member_id, day, sent_at) VALUES (${m.id}, '${ist()}', '${new Date().toISOString()}')`);
r = await call(MEMBER, 'GET', '/content/notifications/latest', undefined, mc);
check('service worker gets the weigh-in nudge', r.data?.kind === 'weight' && /^Weigh-in, \S+!$/.test(r.data.title) && r.data.cta_link === '/progress?log=weight' && !('sent_at' in r.data), r.data);
check('nudge carries own progress', /-3 kg so far, 7 to go/.test(r.data?.body ?? ''), r.data?.body);

sql(`DELETE FROM weight_reminders WHERE member_id=${m.id}; DELETE FROM settings WHERE key='weight_push'; DELETE FROM accounts WHERE username='weight-e2e'`);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
