// Admin side of feedback: grievances (view, reply, status), survey questions, survey rounds + results.
import { Hono } from 'hono';
import type { AppEnv } from '../../env';
import { actor, requireAdmin } from '../../lib/auth';
import { all, assert, audit, first, int, nowIso, run, str } from '../../lib/db';
import { CATEGORIES, ISSUE_STATUS, openRound, type RoundQuestion } from '../../lib/feedback';

export const feedbackAdmin = new Hono<AppEnv>();
feedbackAdmin.use('*', requireAdmin());

// ── Grievances ──────────────────────────────────────────────────────────
/** List with filters (status: open|in_progress|resolved|closed|active|all, type) and counts per status. */
feedbackAdmin.get('/issues', async (c) => {
  const status = c.req.query('status') ?? 'active';
  const type = c.req.query('type') ?? '';
  const where = status === 'all' ? '1=1' : status === 'active' ? `g.status IN ('open','in_progress')` : `g.status=?`;
  const args: unknown[] = status === 'all' || status === 'active' ? [] : [status];
  const rows = await all(c.env.DB,
    `SELECT g.*, m.name, m.essl_id, m.mobile FROM grievances g JOIN members m ON m.id=g.member_id
     WHERE ${where} AND (?='' OR g.type=?) ORDER BY CASE g.status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END, g.id DESC LIMIT 300`,
    ...args, type, type);
  const counts = await all<{ status: string; n: number }>(c.env.DB, `SELECT status, COUNT(*) AS n FROM grievances GROUP BY status`);
  return c.json({ issues: rows, counts: Object.fromEntries(counts.map((r) => [r.status, r.n])) });
});

/** Update status and/or the reply the member sees. */
feedbackAdmin.patch('/issues/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json();
  const cur = await first<{ status: string }>(c.env.DB, `SELECT status FROM grievances WHERE id=?`, id);
  assert(cur, 404, 'Issue not found');
  const status = (ISSUE_STATUS as readonly string[]).includes(b.status) ? b.status as string : cur.status;
  const reply = 'reply' in b ? str(b.reply, 2000) : undefined;
  const done = status === 'resolved' || status === 'closed';
  await run(c.env.DB,
    `UPDATE grievances SET status=?, reply=COALESCE(?, reply), handled_by=?, updated_at=?, resolved_at=CASE WHEN ? THEN COALESCE(resolved_at, ?) ELSE NULL END WHERE id=?`,
    status, reply ?? null, c.get('session').name, nowIso(), done ? 1 : 0, nowIso(), id);
  await audit(c.env, actor(c), 'grievance.update', 'grievance', id, { status, reply: reply ? 'updated' : undefined });
  return c.json({ ok: true });
});

// ── Questions ───────────────────────────────────────────────────────────
feedbackAdmin.get('/questions', async (c) =>
  c.json({ questions: await all(c.env.DB, `SELECT * FROM feedback_questions ORDER BY active DESC, sort, id`), categories: CATEGORIES }));

const questionValues = (b: Record<string, unknown>) => {
  const out: Record<string, unknown> = {};
  if ('text' in b) { const t = str(b.text, 160); assert(t && t.length >= 3, 400, 'Write the question'); out.text = t; }
  if ('category' in b) out.category = (CATEGORIES as readonly string[]).includes(String(b.category)) ? b.category : 'other';
  if ('active' in b) out.active = b.active ? 1 : 0;
  if ('sort' in b) out.sort = int(b.sort) ?? 0;
  return out;
};

feedbackAdmin.post('/questions', requireAdmin('owner', 'admin'), async (c) => {
  const v = questionValues(await c.req.json());
  assert(v.text, 400, 'Write the question');
  const next = (await first<{ n: number }>(c.env.DB, `SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM feedback_questions`))!.n;
  const r = await first<{ id: number }>(c.env.DB, `INSERT INTO feedback_questions (text, category, sort) VALUES (?, ?, ?) RETURNING id`, v.text, v.category ?? 'gym', next);
  await audit(c.env, actor(c), 'feedback.question.create', 'feedback_question', r!.id, v);
  return c.json({ id: r!.id });
});

feedbackAdmin.patch('/questions/:id', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const v = questionValues(await c.req.json());
  const keys = Object.keys(v);
  assert(keys.length, 400, 'Nothing to update');
  await run(c.env.DB, `UPDATE feedback_questions SET ${keys.map((k) => `${k}=?`).join(', ')} WHERE id=?`, ...keys.map((k) => v[k]), id);
  return c.json({ ok: true });
});

/** Swap a question with its neighbour (dir -1 up / 1 down) among active questions. */
feedbackAdmin.post('/questions/:id/move', requireAdmin('owner', 'admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const dir = (await c.req.json()).dir === -1 ? -1 : 1;
  const list = await all<{ id: number; sort: number }>(c.env.DB, `SELECT id, sort FROM feedback_questions WHERE active=1 ORDER BY sort, id`);
  const i = list.findIndex((q) => q.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return c.json({ ok: true });
  [list[i], list[j]] = [list[j], list[i]];
  await c.env.DB.batch(list.map((q, k) => c.env.DB.prepare(`UPDATE feedback_questions SET sort=? WHERE id=?`).bind(k + 1, q.id)));
  return c.json({ ok: true });
});

// ── Survey rounds ───────────────────────────────────────────────────────
feedbackAdmin.get('/rounds', async (c) => {
  const rows = await all(c.env.DB,
    `SELECT r.id, r.title, r.kind, r.closes_on, r.created_by, r.created_at,
            (SELECT COUNT(*) FROM feedback_responses x WHERE x.round_id=r.id) AS responses,
            (SELECT ROUND(AVG(a.rating), 2) FROM feedback_answers a JOIN feedback_responses x ON x.id=a.response_id WHERE x.round_id=r.id) AS avg_rating
     FROM feedback_rounds r ORDER BY r.id DESC LIMIT 36`);
  const app = await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM accounts WHERE role='member' AND active=1 AND last_login_at IS NOT NULL`);
  return c.json({ rounds: rows, app_members: app?.n ?? 0 });
});

/** One round: average + spread per question, improvement notes for low ratings, extra comments. */
feedbackAdmin.get('/rounds/:id', async (c) => {
  const id = Number(c.req.param('id'));
  const round = await first<{ id: number; title: string; questions: string; closes_on: string | null; created_at: string; kind: string }>(c.env.DB, `SELECT * FROM feedback_rounds WHERE id=?`, id);
  assert(round, 404, 'Survey not found');
  const answers = await all<{ question_id: number | null; question: string; category: string | null; rating: number; improvement: string | null; name: string; essl_id: string; created_at: string }>(c.env.DB,
    `SELECT a.question_id, a.question, a.category, a.rating, a.improvement, m.name, m.essl_id, x.created_at
     FROM feedback_answers a JOIN feedback_responses x ON x.id=a.response_id JOIN members m ON m.id=x.member_id WHERE x.round_id=?`, id);
  const comments = await all(c.env.DB,
    `SELECT x.comment, x.created_at, m.name, m.essl_id FROM feedback_responses x JOIN members m ON m.id=x.member_id WHERE x.round_id=? AND x.comment IS NOT NULL ORDER BY x.id DESC`, id);
  const responses = (await first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM feedback_responses WHERE round_id=?`, id))!.n;
  const questions = (JSON.parse(round.questions) as RoundQuestion[]).map((q) => {
    const rows = answers.filter((a) => a.question_id === q.id);
    const dist = [1, 2, 3, 4, 5].map((s) => rows.filter((a) => a.rating === s).length);
    return {
      ...q, count: rows.length, avg: rows.length ? Math.round((rows.reduce((s, a) => s + a.rating, 0) / rows.length) * 100) / 100 : null, dist,
      improvements: rows.filter((a) => a.improvement).sort((a, b) => a.rating - b.rating).map((a) => ({ rating: a.rating, text: a.improvement, name: a.name, essl_id: a.essl_id, at: a.created_at })),
    };
  });
  return c.json({ round: { id: round.id, title: round.title, kind: round.kind, closes_on: round.closes_on, created_at: round.created_at }, responses, questions, comments });
});

/** Send a survey now (closes any open one). */
feedbackAdmin.post('/rounds', requireAdmin('owner', 'admin'), async (c) => {
  const b = await c.req.json().catch(() => ({}));
  const id = await openRound(c.env, 'instant', actor(c), str(b.title, 80)).catch((e: Error) => { assert(false, 400, e.message); return 0; });
  await audit(c.env, actor(c), 'feedback.round.open', 'feedback_round', id, {});
  return c.json({ id });
});

/** Stop asking now (the round's results stay). */
feedbackAdmin.post('/rounds/:id/close', requireAdmin('owner', 'admin'), async (c) => {
  await run(c.env.DB, `UPDATE feedback_rounds SET closes_on=date('now','+330 minutes','-1 day') WHERE id=?`, Number(c.req.param('id')));
  return c.json({ ok: true });
});
