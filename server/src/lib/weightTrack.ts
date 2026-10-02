// Weight tracking: weekly weigh-in status, trend against the member's goal, and the
// day/week/month series shown in the member app. Pure functions — callers load the rows.
import { addDays, diffDays } from './dates';
import type { Goal } from './fitness';

export interface WeightRow { day: string; weight_kg: number }
export type WeightView = 'day' | 'week' | 'month';
export type WeightStatus = 'reached' | 'on_track' | 'slow' | 'off_track' | 'steady' | 'drifting' | 'new';

/** A weigh-in is due once the last one is 7+ days old (or there is none). */
export const WEIGH_IN_EVERY = 7;

const r1 = (n: number) => Math.round(n * 10) / 10;

/** Weekly weigh-in status: when the member last weighed in and when the next one is due. */
export function weighIn(last: WeightRow | null, today: string) {
  const daysSince = last ? diffDays(today, last.day) : null;
  return {
    last_day: last?.day ?? null,
    last_kg: last?.weight_kg ?? null,
    days_since: daysSince,
    due: daysSince === null || daysSince >= WEIGH_IN_EVERY,
    next_due: last ? addDays(last.day, WEIGH_IN_EVERY) : today,
  };
}

/** Change (kg) between the latest entry and the newest entry at least `days` older, or null. */
function changeOver(rows: WeightRow[], days: number) {
  const last = rows[rows.length - 1];
  if (!last) return null;
  const cutoff = addDays(last.day, -days);
  const base = [...rows].reverse().find((r) => r.day <= cutoff);
  return base ? r1(last.weight_kg - base.weight_kg) : null;
}

/**
 * kg per week over the last 8 weeks (least-squares slope), from at least 2 entries spanning a week.
 * Daily weight swings 1–2 kg with water and food, so a fitted line is far steadier than first-vs-last.
 */
export function weeklyRate(rows: WeightRow[]) {
  if (rows.length < 2) return null;
  const end = rows[rows.length - 1].day;
  const recent = rows.filter((r) => diffDays(end, r.day) <= 56);
  if (recent.length < 2 || diffDays(end, recent[0].day) < 7) return null;
  const xs = recent.map((r) => diffDays(r.day, recent[0].day));
  const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
  const my = recent.reduce((a, r) => a + r.weight_kg, 0) / recent.length;
  let num = 0, den = 0;
  recent.forEach((r, i) => { num += (xs[i] - mx) * (r.weight_kg - my); den += (xs[i] - mx) ** 2; });
  return den ? Math.round((num / den) * 7 * 100) / 100 : null;
}

/**
 * Where the member stands against their goal. `rows` ascending by day.
 * - lose/gain with a target: reached / on_track (≥0.25 kg/wk the right way) / slow / off_track (moving away)
 * - maintain / no target: steady (within ±2 kg of start) or drifting
 */
export function weightTrend(rows: WeightRow[], p: { start_weight_kg: number | null; target_weight_kg: number | null; goal: Goal | null }, today: string) {
  const last = rows[rows.length - 1] ?? null;
  const current = last?.weight_kg ?? null;
  const start = p.start_weight_kg ?? rows[0]?.weight_kg ?? null;
  const target = p.target_weight_kg;
  const rate = weeklyRate(rows);
  const towards = target !== null && start !== null && target !== start ? Math.sign(target - start) : 0; // −1 lose, +1 gain
  const toGo = target !== null && current !== null ? r1(Math.abs(target - current)) : null;
  const changeTotal = start !== null && current !== null ? r1(current - start) : null;

  let status: WeightStatus = 'new';
  let eta: string | null = null;
  if (current !== null && rows.length >= 2) {
    if (towards && target !== null) {
      const reached = towards < 0 ? current <= target : current >= target;
      if (reached) status = 'reached';
      else if (rate === null) status = 'new';
      else {
        const good = rate * towards; // kg/week in the right direction
        status = good >= 0.25 ? 'on_track' : good > -0.1 ? 'slow' : 'off_track';
        // Only project a finish date when progress is real and the date is believable (≤ 2 years)
        if (good >= 0.1 && toGo !== null) {
          const weeks = Math.ceil(toGo / good);
          if (weeks <= 104) eta = addDays(today, weeks * 7);
        }
      }
    } else if (changeTotal !== null) {
      status = Math.abs(changeTotal) <= 2 ? 'steady' : 'drifting';
    }
  }
  return {
    current, start, target, goal: p.goal,
    change_total: changeTotal,
    change_7d: changeOver(rows, 7),
    change_30d: changeOver(rows, 30),
    weekly_rate: rate,
    to_go: toGo,
    status, eta,
    entries: rows.length,
    ...weighIn(last, today),
  };
}
export type WeightTrend = ReturnType<typeof weightTrend>;

/** Monday of the ISO week containing `day`. */
export function weekStart(day: string) {
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(day, -((dow + 6) % 7));
}

/** Entries as-is (day), or averaged per calendar week (Monday start) or month. `rows` ascending. */
export function bucketWeights(rows: WeightRow[], view: WeightView) {
  if (view === 'day') return rows.map((r) => ({ day: r.day, weight_kg: r.weight_kg, n: 1 }));
  const key = view === 'week' ? weekStart : (d: string) => `${d.slice(0, 7)}-01`;
  const m = new Map<string, { sum: number; n: number }>();
  for (const r of rows) {
    const k = key(r.day);
    const b = m.get(k) ?? { sum: 0, n: 0 };
    b.sum += r.weight_kg; b.n++;
    m.set(k, b);
  }
  return [...m].sort(([a], [b]) => a.localeCompare(b)).map(([day, b]) => ({ day, weight_kg: r1(b.sum / b.n), n: b.n }));
}

// ── Phone nudges ────────────────────────────────────────────────────────
export interface WeightPushSettings {
  enabled: boolean;
  weekday: number;   // 0 = Sunday … 6 = Saturday (gym local)
  send_hour: number; // 0–23 gym local
  /** Templates: {name} {gym} {current} {change} {to_go} {target} {days} */
  due_title: string;
  due_message: string;
  /** Rotating lines appended to the weigh-in reminder, chosen by the member's status. */
  on_track: string[];
  off_track: string[];
  reached: string[];
}

export const DEFAULT_WEIGHT_PUSH: WeightPushSettings = {
  enabled: false,
  weekday: 0,
  send_hour: 8,
  due_title: 'Weigh-in day, {name} ⚖️',
  due_message: 'Step on the scale before breakfast and log it in the app — 10 seconds keeps your goal on track.',
  on_track: [
    '🔥 {change} kg so far — you are right on pace. Keep going!',
    '💪 {to_go} kg to your {target} kg goal. Consistency is working.',
    '🏆 Great progress — this week, beat last week.',
  ],
  off_track: [
    '💡 Weight moves in waves — log today and let the trend guide you.',
    '🥗 Small wins count: one extra workout and tighter meals this week.',
    '🤝 Ask a trainer at the front desk to fine-tune your plan.',
  ],
  reached: [
    '🎉 You hit your goal! Set a new target in the app to keep the momentum.',
    '🥇 Goal reached — now hold it. Weekly weigh-ins keep it locked in.',
  ],
};

const fmtKg = (n: number | null) => (n === null ? '—' : `${n > 0 ? '+' : ''}${n}`);

/** The weigh-in notification for one member on `today`. Same rotating line for everyone on a given week. */
export function renderWeightNudge(s: WeightPushSettings, gymName: string, name: string, t: WeightTrend, today: string) {
  const vars: Record<string, string> = {
    name: name.trim().split(/\s+/)[0] ?? name,
    gym: gymName,
    current: t.current === null ? '—' : String(t.current),
    change: fmtKg(t.change_total),
    to_go: t.to_go === null ? '—' : String(t.to_go),
    target: t.target === null ? '—' : String(t.target),
    days: t.days_since === null ? '—' : String(t.days_since),
  };
  const fill = (x: string) => x.replace(/\{(\w+)\}/g, (all, k: string) => vars[k] ?? all);
  const pool = t.status === 'reached' ? s.reached
    : t.status === 'on_track' ? s.on_track
    : t.status === 'slow' || t.status === 'off_track' ? s.off_track
    : [];
  // Lines that need a target/change make no sense without one — skip them
  const usable = pool.filter((l) => !(/\{(to_go|target)\}/.test(l) && t.target === null) && !(/\{change\}/.test(l) && t.change_total === null));
  const weekNo = Math.floor(Date.parse(`${today}T00:00:00Z`) / (7 * 86_400_000));
  const line = usable.length ? fill(usable[weekNo % usable.length]) : '';
  return { title: fill(s.due_title).slice(0, 120), body: [fill(s.due_message), line].filter(Boolean).join('\n').slice(0, 400) };
}
