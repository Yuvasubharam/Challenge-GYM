// Daily "your membership ends in N days" phone reminder for member-app users.
//
// Pushes are payload-less (see content.ts), so the job only records "reminded today" per member
// in push_reminders and wakes their phones; the service worker then asks the member API what to
// show and gets that member's own message from reminderFor(). Each member gets at most one
// reminder per day however often the job runs.
import type { Env } from '../env';
import { tzOffset } from '../env';
import { all, first, getSettings, nowIso, putSetting, type RenewalPushSettings } from './db';
import { addDays, today as todayOf } from './dates';
import { daysLeft, isFrozen } from './membership';
import { pushConfigured, wakeSubscriptions } from './content';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const shortDate = (d: string) => `${Number(d.slice(8, 10))} ${MONTHS[Number(d.slice(5, 7)) - 1]}`;

/** The notification one member sees on `today`. */
export function renderReminder(s: RenewalPushSettings, gymName: string, m: { name: string; end_date: string }, today: string) {
  const days = daysLeft(m.end_date, today) ?? 0;
  const vars: Record<string, string> = {
    name: m.name.trim().split(/\s+/)[0] ?? m.name,
    days: String(days),
    when: days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`,
    end_date: shortDate(m.end_date),
    gym: gymName,
  };
  const fill = (t: string) => t.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);
  // Same motivation line for everyone on a given day, a different one the next day.
  const dayNo = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
  const line = s.motivation.length ? s.motivation[dayNo % s.motivation.length] : '';
  return { title: fill(s.title).slice(0, 120), body: [fill(s.message), line].filter(Boolean).join('\n').slice(0, 400) };
}

interface Target { sub_id: number; endpoint: string; member_id: number; name: string; end_date: string }

/**
 * App members with a phone subscription whose current membership ends within the window
 * (today … today + days_before). Frozen and staff members are skipped. Reads ≈ subscriptions × 3 rows.
 */
export async function renewalTargets(env: Env, s: RenewalPushSettings, today: string): Promise<Target[]> {
  const rows = await all<Target & { frozen_from: string | null; frozen_until: string | null; reminded: number }>(env.DB,
    `SELECT s.id AS sub_id, s.endpoint, m.id AS member_id, m.name, m.frozen_from, m.frozen_until,
            (SELECT MAX(end_date) FROM memberships WHERE member_id=m.id AND status='active') AS end_date,
            EXISTS(SELECT 1 FROM push_reminders r WHERE r.member_id=m.id AND r.day=?) AS reminded
     FROM push_subscriptions s JOIN members m ON m.id=s.member_id
     WHERE m.archived=0 AND m.is_staff=0 AND m.app_access=1`, today);
  const last = addDays(today, s.days_before);
  return rows.filter((r) => r.end_date && r.end_date >= today && r.end_date <= last && !isFrozen(r, today) && !r.reminded);
}

/** Send today's reminders now (idempotent per member per day). */
export async function sendRenewalReminders(env: Env, opts: { force?: boolean } = {}) {
  const settings = await getSettings(env.DB);
  const s = settings.renewal_push;
  const today = todayOf(tzOffset(env));
  if (!s.enabled && !opts.force) return { skipped: 'reminders are switched off' };
  if (!pushConfigured(env)) return { skipped: 'phone notifications are not set up (VAPID keys missing)' };
  const targets = await renewalTargets(env, s, today);
  const members = [...new Set(targets.map((t) => t.member_id))];
  const at = nowIso();
  // Record first, then wake: the phone's service worker looks this row up to build the message.
  for (let i = 0; i < members.length; i += 50) {
    await env.DB.batch(members.slice(i, i + 50).map((id) =>
      env.DB.prepare(`INSERT OR IGNORE INTO push_reminders (member_id, day, sent_at) VALUES (?, ?, ?)`).bind(id, today, at)));
  }
  let sent = 0, failed = 0;
  for (let i = 0; i < targets.length; i += 40) {
    const r = await wakeSubscriptions(env, targets.slice(i, i + 40).map((t) => ({ id: t.sub_id, endpoint: t.endpoint })));
    sent += r.sent; failed += r.failed;
  }
  const prev = settings.renewal_push_log;
  const log = prev.day === today
    ? { day: today, at, members: prev.members + members.length, sent: prev.sent + sent, failed: prev.failed + failed }
    : { day: today, at, members: members.length, sent, failed };
  await putSetting(env.DB, 'renewal_push_log', log);
  return { ...log, run: { members: members.length, sent, failed } };
}

/** Cron entry point (hourly): send once per day, at or after the configured hour. */
export async function renewalCron(env: Env) {
  const settings = await getSettings(env.DB);
  if (!settings.renewal_push.enabled) return { skipped: 'off' };
  const today = todayOf(tzOffset(env));
  const hour = new Date(Date.now() + tzOffset(env) * 60_000).getUTCHours();
  if (hour < settings.renewal_push.send_hour || settings.renewal_push_log.day === today) return { skipped: 'not due' };
  return sendRenewalReminders(env);
}

/**
 * For the member's service worker: this member's reminder if it is the newest thing pushed to them
 * (i.e. sent after the latest announcement push), within the last 20 hours.
 */
export async function reminderFor(env: Env, memberId: number, latestPostPushedAt: string | null) {
  const r = await first<{ day: string; sent_at: string }>(env.DB,
    `SELECT day, sent_at FROM push_reminders WHERE member_id=? ORDER BY day DESC LIMIT 1`, memberId);
  if (!r || (latestPostPushedAt && latestPostPushedAt > r.sent_at) || Date.now() - Date.parse(r.sent_at) > 20 * 3600_000) return null;
  const m = await first<{ name: string; end_date: string | null }>(env.DB,
    `SELECT m.name, (SELECT MAX(end_date) FROM memberships WHERE member_id=m.id AND status='active') AS end_date FROM members m WHERE m.id=?`, memberId);
  if (!m?.end_date) return null;
  const settings = await getSettings(env.DB);
  const msg = renderReminder(settings.renewal_push, settings.gym.name, { name: m.name, end_date: m.end_date }, r.day);
  return { id: `renew-${r.day}`, kind: 'renewal', title: msg.title, body: msg.body, image_key: null, cta_link: '/plan', sent_at: r.sent_at };
}
