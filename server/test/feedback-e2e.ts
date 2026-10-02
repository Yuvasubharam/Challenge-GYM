// Feedback surveys + grievances (admin worker :8788 + member worker :8789, local D1 with 0017 applied).
//   npx tsx test/feedback-e2e.ts
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
const adminCookie = `cg_admin=${await signToken({ aid: owner.id, role: 'owner', mid: null, name: owner.name, aud: 'admin' }, secret, 900)}`;
async function call(base: string, method: string, path: string, body?: unknown, cookie = '') {
  const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const sc = r.headers.get('set-cookie');
  return { status: r.status, data: await r.json().catch(() => null) as any, cookie: sc ? sc.split(';')[0] : cookie };
}
const A = (m: string, p: string, b?: unknown) => call(ADMIN, m, p, b, adminCookie);

// A non-staff member with a fresh app login.
const m = sql(`SELECT m.id, m.essl_id, m.mobile FROM members m WHERE m.archived=0 AND m.is_staff=0 AND length(m.mobile)=10 AND m.essl_id GLOB '[1-9]*'
               AND (SELECT COUNT(*) FROM members x WHERE x.mobile=m.mobile)=1 ORDER BY m.id DESC LIMIT 1 OFFSET 2`)[0];
const roundsBefore = sql(`SELECT COALESCE(MAX(id),0) AS id FROM feedback_rounds`)[0].id;
sql(`DELETE FROM accounts WHERE member_id=${m.id}; DELETE FROM login_attempts; UPDATE members SET app_access=1 WHERE id=${m.id}`);
const login = await call(MEMBER, 'POST', '/auth/activate', { mobile: m.mobile, memberId: m.essl_id, password: 'secret1' });
const mc = login.cookie;
const M = (meth: string, p: string, b?: unknown) => call(MEMBER, meth, p, b, mc);
check(`member #${m.essl_id} signed in`, login.status === 200, login.data);

try {
  console.log('\n── survey');
  let r = await A('GET', '/feedback/questions');
  check('9 starter questions', r.data.questions.filter((q: any) => q.active).length === 9, r.data.questions?.length);
  r = await A('POST', '/feedback/rounds', {});
  const roundId = r.data.id;
  check('admin sends a survey now', r.status === 200 && roundId > roundsBefore, r.data);
  r = await M('GET', '/feedback/pending');
  const survey = r.data.survey;
  check('member is asked (popup)', survey?.id === roundId && survey.questions.length === 9, r.data);
  const answers = survey.questions.map((q: any, i: number) => ({ question_id: q.id, rating: i === 0 ? 2 : 5 }));
  r = await M('POST', `/feedback/surveys/${roundId}`, { answers });
  check('rating 2 without a note is refused', r.status === 400 && /improve/.test(r.data.error), r.data);
  r = await M('POST', `/feedback/surveys/${roundId}`, { answers: answers.slice(1) });
  check('a missing question is refused', r.status === 400 && /rate/i.test(r.data.error), r.data);
  answers[0].improvement = 'Two benches have torn padding, please fix';
  r = await M('POST', `/feedback/surveys/${roundId}`, { answers, comment: 'Great trainers overall' });
  check('submitted with the improvement note', r.status === 200, r.data);
  r = await M('POST', `/feedback/surveys/${roundId}`, { answers });
  check('cannot answer twice', r.status === 409, r.data);
  r = await M('GET', '/feedback/pending');
  check('no popup after answering', r.data.survey === null, r.data);
  r = await A('GET', `/feedback/rounds/${roundId}`);
  const q1 = r.data.questions[0];
  check('results: 1 response, low rating + note visible', r.data.responses === 1 && q1.avg === 2 && q1.dist[1] === 1 && q1.improvements[0].text.includes('benches'), q1);
  check('results: comment visible', r.data.comments[0]?.comment === 'Great trainers overall', r.data.comments);
  r = await A('POST', '/feedback/rounds', {});
  r = await M('GET', '/feedback/pending');
  check('a new survey asks again', r.data.survey?.id > roundId, r.data);

  console.log('\n── grievances');
  r = await M('POST', '/feedback/issues', { type: 'Not a type', subject: 'Test', description: 'Something long enough here' });
  check('unknown issue type refused', r.status === 400, r.data);
  r = await M('POST', '/feedback/issues', { type: 'Equipment', subject: 'Treadmill 3', description: 'Belt slips at speed above 8 km/h' });
  const issueId = r.data.id;
  check('member raises an issue', r.status === 200 && issueId > 0, r.data);
  r = await A('GET', '/feedback/issues');
  check('admin sees it under Needs action', r.data.issues.some((i: any) => i.id === issueId && i.status === 'open' && i.essl_id === m.essl_id), r.data.counts);
  r = await A('PATCH', `/feedback/issues/${issueId}`, { status: 'resolved', reply: 'Belt replaced today — thanks for flagging!' });
  check('admin replies + resolves', r.status === 200, r.data);
  r = await M('GET', '/feedback');
  const mine = r.data.issues.find((i: any) => i.id === issueId);
  check('member sees the reply and status', mine?.status === 'resolved' && /Belt replaced/.test(mine.reply) && !!mine.resolved_at, mine);
  check('issue types come from settings', r.data.grievance_types.includes('Equipment'), r.data.grievance_types);

  console.log('\n── settings');
  r = await A('PUT', '/settings/feedback', { every_months: 3, days_open: 10, grievance_types: ['Equipment', 'Other', 'Equipment', ' '] });
  r = await A('GET', '/settings');
  check('frequency + types saved (deduped, blanks dropped)', r.data.feedback.every_months === 3 && r.data.feedback.days_open === 10 && r.data.feedback.grievance_types.join() === 'Equipment,Other', r.data.feedback);
  r = await A('PUT', '/settings/feedback', { every_months: 7 });
  r = await A('GET', '/settings');
  check('invalid frequency ignored', r.data.feedback.every_months === 3, r.data.feedback);
} finally {
  sql(`DELETE FROM feedback_rounds WHERE id > ${roundsBefore}; DELETE FROM grievances WHERE member_id=${m.id}; DELETE FROM accounts WHERE member_id=${m.id};
       DELETE FROM settings WHERE key='feedback'`);
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
