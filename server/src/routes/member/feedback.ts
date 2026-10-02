// Member side of feedback: the open survey round (popup + Feedback page) and grievances.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { requireMember } from '../../lib/auth';
import { all, assert, first, getSettings, str } from '../../lib/db';
import { checkAnswers, currentRound } from '../../lib/feedback';

export const memberFeedback = new Hono<AppEnv>();
memberFeedback.use('*', requireMember());

const mid = (c: { get: (k: 'session') => { mid: number | null } }) => c.get('session').mid!;

/** The survey to answer now (null when none is open or it's already answered), issue types, my issues. */
memberFeedback.get('/', async (c) => {
  const id = mid(c);
  const [round, s, issues] = await Promise.all([
    currentRound(c.env),
    getSettings(c.env.DB),
    all(c.env.DB, `SELECT id, type, subject, description, status, reply, created_at, updated_at, resolved_at FROM grievances WHERE member_id=? ORDER BY id DESC LIMIT 50`, id),
  ]);
  const answered = round ? !!(await first(c.env.DB, `SELECT 1 FROM feedback_responses WHERE round_id=? AND member_id=?`, round.id, id)) : false;
  return c.json({
    survey: round && !answered ? { id: round.id, title: round.title, closes_on: round.closes_on, questions: round.list } : null,
    answered_round: round && answered ? { id: round.id, title: round.title } : null,
    grievance_types: s.feedback.grievance_types,
    issues,
  });
});

/** Just "is there a survey to answer?" — for the popup on app start (2 indexed reads). */
memberFeedback.get('/pending', async (c) => {
  const round = await currentRound(c.env);
  if (!round) return c.json({ survey: null });
  const answered = await first(c.env.DB, `SELECT 1 FROM feedback_responses WHERE round_id=? AND member_id=?`, round.id, mid(c));
  return c.json({ survey: answered ? null : { id: round.id, title: round.title, closes_on: round.closes_on, questions: round.list } });
});

/** Submit the survey: every question rated 1–5; ratings ≤ 3 need an improvement note. */
memberFeedback.post('/surveys/:id', async (c) => {
  const id = mid(c);
  const round = await currentRound(c.env);
  assert(round && round.id === Number(c.req.param('id')), 400, 'This survey has closed — thank you anyway!');
  const b = await c.req.json();
  const answers = checkAnswers(round.list, b.answers);
  assert(!(await first(c.env.DB, `SELECT 1 FROM feedback_responses WHERE round_id=? AND member_id=?`, round.id, id)), 409, 'You already answered this survey — thank you!');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO feedback_responses (round_id, member_id, comment) VALUES (?, ?, ?) RETURNING id`, round.id, id, str(b.comment, 1000));
  const stmt = c.env.DB.prepare(`INSERT INTO feedback_answers (response_id, question_id, question, category, rating, improvement) VALUES (?, ?, ?, ?, ?, ?)`);
  await c.env.DB.batch(answers.map((a) => stmt.bind(r!.id, a.question_id, a.question, a.category, a.rating, a.improvement)));
  return c.json({ ok: true });
});

/** Raise a grievance. */
memberFeedback.post('/issues', async (c) => {
  const b = await c.req.json();
  const s = await getSettings(c.env.DB);
  const type = str(b.type, 60);
  assert(type && s.feedback.grievance_types.includes(type), 400, 'Choose the type of issue');
  const subject = str(b.subject, 120);
  const description = str(b.description, 2000);
  assert(subject && subject.length >= 3, 400, 'Add a short subject');
  assert(description && description.length >= 10, 400, 'Describe the issue in a few words (at least 10 characters)');
  const open = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM grievances WHERE member_id=? AND status IN ('open','in_progress')`, mid(c));
  assert((open?.n ?? 0) < 10, 429, 'You already have 10 open issues — the desk will get back to you soon.');
  const r = await first<{ id: number }>(c.env.DB,
    `INSERT INTO grievances (member_id, type, subject, description) VALUES (?, ?, ?, ?) RETURNING id`, mid(c), type, subject, description);
  return c.json({ id: r!.id });
});
