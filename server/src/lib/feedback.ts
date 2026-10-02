// Member feedback surveys + grievances — shared by the admin API, the member API and the admin cron.
//   • A survey "round" asks every app member to rate the active questions 1–5. Ratings of 3 or lower
//     need a short "what should we improve?" note, so management hears why.
//   • Rounds open on a schedule (every 1, 2 or 3 months) from the admin worker's hourly cron, or right
//     away when the owner presses "Send survey now". A round stays open for `days_open` days.
import type { Env } from '../env';
import { tzOffset } from '../env';
import { all, assert, first, getSettings, run } from './db';
import { addDays, addMonths, today as todayOf } from './dates';
export { DEFAULT_FEEDBACK, type FeedbackSettings } from './feedbackDefaults';

export const CATEGORIES = ['gym', 'equipment', 'cleanliness', 'staff', 'app', 'other'] as const;
export const ISSUE_STATUS = ['open', 'in_progress', 'resolved', 'closed'] as const;

export interface RoundQuestion { id: number; text: string; category: string }
export interface RoundRow { id: number; title: string; kind: string; questions: string; closes_on: string | null; created_by: string | null; created_at: string }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Open a new survey round with the current active questions (earlier open rounds are closed). */
export async function openRound(env: Env, kind: 'scheduled' | 'instant', by: string, title?: string | null): Promise<number> {
  const s = (await getSettings(env.DB)).feedback;
  const today = todayOf(tzOffset(env));
  const questions = await all<RoundQuestion>(env.DB, `SELECT id, text, category FROM feedback_questions WHERE active=1 ORDER BY sort, id`);
  if (!questions.length) throw new Error('Add at least one active question first');
  await run(env.DB, `UPDATE feedback_rounds SET closes_on=? WHERE closes_on IS NULL OR closes_on >= ?`, addDays(today, -1), today);
  const [y, m] = today.split('-').map(Number);
  const r = await first<{ id: number }>(env.DB,
    `INSERT INTO feedback_rounds (title, kind, questions, closes_on, created_by) VALUES (?, ?, ?, ?, ?) RETURNING id`,
    title?.trim() || `Feedback — ${MONTHS[m - 1]} ${y}`, kind, JSON.stringify(questions), addDays(today, Math.max(1, s.days_open) - 1), by);
  return r!.id;
}

/** The round members are asked about today (newest round that is still open), or null. */
export async function currentRound(env: Env): Promise<(RoundRow & { list: RoundQuestion[] }) | null> {
  const today = todayOf(tzOffset(env));
  const r = await first<RoundRow>(env.DB, `SELECT * FROM feedback_rounds WHERE closes_on >= ? ORDER BY id DESC LIMIT 1`, today);
  return r ? { ...r, list: JSON.parse(r.questions) as RoundQuestion[] } : null;
}

/** Hourly (admin worker cron): open the next scheduled round when one is due. */
export async function feedbackCron(env: Env): Promise<{ opened: number } | { skipped: string }> {
  const s = (await getSettings(env.DB)).feedback;
  if (!s.every_months) return { skipped: 'manual only' };
  const today = todayOf(tzOffset(env));
  const last = await first<{ created_at: string }>(env.DB, `SELECT created_at FROM feedback_rounds ORDER BY id DESC LIMIT 1`);
  // Due when the last round (scheduled or sent by hand) started at least N months ago.
  if (last && addMonths(last.created_at.slice(0, 10), s.every_months) > today) return { skipped: 'not due' };
  if (!(await first(env.DB, `SELECT 1 FROM feedback_questions WHERE active=1`))) return { skipped: 'no active questions' };
  return { opened: await openRound(env, 'scheduled', 'schedule') };
}

/** Validate a member's answers against the round: every question rated 1–5, a note for ratings ≤ 3. */
export function checkAnswers(questions: RoundQuestion[], raw: unknown): { question_id: number; question: string; category: string; rating: number; improvement: string | null }[] {
  const list = Array.isArray(raw) ? raw as { question_id?: unknown; rating?: unknown; improvement?: unknown }[] : [];
  return questions.map((q) => {
    const a = list.find((x) => Number(x.question_id) === q.id);
    const rating = Number(a?.rating);
    assert(Number.isInteger(rating) && rating >= 1 && rating <= 5, 400, `Please rate “${q.text}”`);
    const improvement = typeof a?.improvement === 'string' ? a.improvement.trim().slice(0, 600) : '';
    assert(rating > 3 || improvement.length >= 3, 400, `Tell us what we can improve about “${q.text}”`);
    return { question_id: q.id, question: q.text, category: q.category, rating, improvement: improvement || null };
  });
}
