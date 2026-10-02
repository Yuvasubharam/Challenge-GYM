// Weekly "weigh-in day" phone reminder for member-app users who use the fitness tracker.
//
// Same payload-less design as renewal reminders (renewalPush.ts): the job records "reminded on day"
// in weight_reminders and wakes phones; the service worker then asks the member API what to show
// and gets that member's own message (with their progress) from weightReminderFor().
// Members who already weighed in within the last few days are skipped — no nagging.
import type { Env } from '../env';
import { tzOffset } from '../env';
import { all, first, getSettings, nowIso, putSetting } from './db';
import { addDays, today as todayOf } from './dates';
import { pushConfigured, wakeSubscriptions } from './content';
import { renderWeightNudge, weightTrend, type WeightRow } from './weightTrack';
import type { Goal } from './fitness';

/** Skip members who logged within this many days of the weigh-in day. */
const RECENT_DAYS = 3;

interface Target { sub_id: number; endpoint: string; member_id: number; name: string }

/** App members with a phone subscription and a fitness profile who haven't weighed in recently. */
export async function weightTargets(env: Env, today: string): Promise<Target[]> {
  return all<Target>(env.DB,
    `SELECT s.id AS sub_id, s.endpoint, m.id AS member_id, m.name
     FROM push_subscriptions s JOIN members m ON m.id=s.member_id
     JOIN fitness_profiles p ON p.member_id=m.id AND p.onboarded_at IS NOT NULL
     WHERE m.archived=0 AND m.app_access=1
       AND NOT EXISTS(SELECT 1 FROM weight_logs w WHERE w.member_id=m.id AND w.day>?)
       AND NOT EXISTS(SELECT 1 FROM weight_reminders r WHERE r.member_id=m.id AND r.day=?)`,
    addDays(today, -RECENT_DAYS), today);
}

/** Send this week's weigh-in reminders now (idempotent per member per day). */
export async function sendWeightReminders(env: Env, opts: { force?: boolean } = {}) {
  const settings = await getSettings(env.DB);
  const today = todayOf(tzOffset(env));
  if (!settings.weight_push.enabled && !opts.force) return { skipped: 'weigh-in reminders are switched off' };
  if (!pushConfigured(env)) return { skipped: 'phone notifications are not set up (VAPID keys missing)' };
  const targets = await weightTargets(env, today);
  const members = [...new Set(targets.map((t) => t.member_id))];
  const at = nowIso();
  for (let i = 0; i < members.length; i += 50) {
    await env.DB.batch(members.slice(i, i + 50).map((id) =>
      env.DB.prepare(`INSERT OR IGNORE INTO weight_reminders (member_id, day, sent_at) VALUES (?, ?, ?)`).bind(id, today, at)));
  }
  let sent = 0, failed = 0;
  for (let i = 0; i < targets.length; i += 40) {
    const r = await wakeSubscriptions(env, targets.slice(i, i + 40).map((t) => ({ id: t.sub_id, endpoint: t.endpoint })));
    sent += r.sent; failed += r.failed;
  }
  const prev = settings.weight_push_log;
  const log = prev.day === today
    ? { day: today, at, members: prev.members + members.length, sent: prev.sent + sent, failed: prev.failed + failed }
    : { day: today, at, members: members.length, sent, failed };
  await putSetting(env.DB, 'weight_push_log', log);
  return { ...log, run: { members: members.length, sent, failed } };
}

/** Cron entry point (hourly): send once on the configured weekday, at or after the configured hour. */
export async function weightCron(env: Env) {
  const settings = await getSettings(env.DB);
  const s = settings.weight_push;
  if (!s.enabled) return { skipped: 'off' };
  const local = new Date(Date.now() + tzOffset(env) * 60_000);
  const today = todayOf(tzOffset(env));
  if (local.getUTCDay() !== s.weekday || local.getUTCHours() < s.send_hour || settings.weight_push_log.day === today) return { skipped: 'not due' };
  return sendWeightReminders(env);
}

/** One member's weight rows (ascending) + goal fields, for the trend. */
export async function memberWeights(env: Env, memberId: number) {
  const [rows, p] = await Promise.all([
    all<WeightRow>(env.DB, `SELECT day, weight_kg FROM weight_logs WHERE member_id=? ORDER BY day`, memberId),
    first<{ start_weight_kg: number | null; target_weight_kg: number | null; goal: Goal | null }>(env.DB,
      `SELECT start_weight_kg, target_weight_kg, goal FROM fitness_profiles WHERE member_id=?`, memberId),
  ]);
  return { rows, p: p ?? { start_weight_kg: null, target_weight_kg: null, goal: null } };
}

/** For the member's service worker: their weigh-in reminder if sent within the last 20 hours. */
export async function weightReminderFor(env: Env, memberId: number) {
  const r = await first<{ day: string; sent_at: string }>(env.DB,
    `SELECT day, sent_at FROM weight_reminders WHERE member_id=? ORDER BY day DESC LIMIT 1`, memberId);
  if (!r || Date.now() - Date.parse(r.sent_at) > 20 * 3600_000) return null;
  const [m, w, settings] = await Promise.all([
    first<{ name: string }>(env.DB, `SELECT name FROM members WHERE id=?`, memberId),
    memberWeights(env, memberId),
    getSettings(env.DB),
  ]);
  if (!m) return null;
  const msg = renderWeightNudge(settings.weight_push, settings.gym.name, m.name, weightTrend(w.rows, w.p, r.day), r.day);
  return { id: `weight-${r.day}`, kind: 'weight', title: msg.title, body: msg.body, image_key: null, cta_link: '/progress?log=weight', sent_at: r.sent_at };
}
