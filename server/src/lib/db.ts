import type { Env } from '../env';
import { DEFAULT_ACCESS, DEFAULT_REMINDERS, type AccessSettings, type ReminderSettings } from './membership';

export async function all<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T[]> {
  const r = await db.prepare(sql).bind(...params).all<T>();
  return r.results ?? [];
}

export async function first<T = Record<string, unknown>>(db: D1Database, sql: string, ...params: unknown[]): Promise<T | null> {
  return (await db.prepare(sql).bind(...params).first<T>()) ?? null;
}

export async function run(db: D1Database, sql: string, ...params: unknown[]) {
  return db.prepare(sql).bind(...params).run();
}

export const nowIso = () => new Date().toISOString();

// ── Settings ────────────────────────────────────────────────────────────
export interface GymSettings {
  gym: { name: string; tagline: string; phone: string; address: string };
  upi: { vpa: string; payee: string };
  access: AccessSettings;
  reminders: ReminderSettings;
  receipt: { prefix: string; next: number };
  renewal_push: RenewalPushSettings;
  /** Written by the daily reminder job, not by the settings form. */
  renewal_push_log: { day: string | null; at: string | null; members: number; sent: number; failed: number };
}

/** Daily phone reminder to app members whose membership ends within `days_before` days. */
export interface RenewalPushSettings {
  enabled: boolean;
  days_before: number;
  send_hour: number; // gym local time, 0–23
  /** Templates: {name} {days} {when} {end_date} {gym} */
  title: string;
  message: string;
  /** One line is appended per day, rotating, so the nudge changes daily. */
  motivation: string[];
}

export const DEFAULT_RENEWAL_PUSH: RenewalPushSettings = {
  enabled: false,
  days_before: 7,
  send_hour: 9,
  title: 'Hi {name}, your membership ends {when} ⏰',
  message: 'Renew before {end_date} to keep your streak going — tap to renew in the app or pay at the front desk.',
  motivation: [
    '💪 Every rep counts — see you at the gym today!',
    '🔥 Consistency beats motivation. Show up today.',
    '🏋️ Your future self will thank you for today’s workout.',
    '⚡ Don’t stop now — you’re closer than you think.',
    '🥇 Discipline today, results tomorrow.',
  ],
};

const DEFAULTS: GymSettings = {
  gym: { name: 'Challenge Gym', tagline: '', phone: '', address: '' },
  upi: { vpa: '', payee: 'Challenge Gym' },
  access: DEFAULT_ACCESS,
  reminders: DEFAULT_REMINDERS,
  receipt: { prefix: 'CG', next: 1 },
  renewal_push: DEFAULT_RENEWAL_PUSH,
  renewal_push_log: { day: null, at: null, members: 0, sent: 0, failed: 0 },
};

export async function getSettings(db: D1Database): Promise<GymSettings> {
  const rows = await all<{ key: string; value: string }>(db, 'SELECT key, value FROM settings');
  const out = structuredClone(DEFAULTS) as unknown as Record<string, unknown>;
  for (const r of rows) {
    try {
      const base = (out[r.key] ?? {}) as Record<string, unknown>;
      out[r.key] = { ...base, ...JSON.parse(r.value) };
    } catch {
      /* ignore malformed setting */
    }
  }
  return out as unknown as GymSettings;
}

export async function getAccessSettings(db: D1Database): Promise<AccessSettings> {
  const row = await first<{ value: string }>(db, `SELECT value FROM settings WHERE key='access'`);
  if (!row) return { ...DEFAULT_ACCESS, staff_prefixes: [...DEFAULT_ACCESS.staff_prefixes] };
  try {
    const parsed = JSON.parse(row.value) as Partial<AccessSettings>;
    return {
      ...DEFAULT_ACCESS,
      ...parsed,
      staff_prefixes: Array.isArray(parsed.staff_prefixes) ? parsed.staff_prefixes : [...DEFAULT_ACCESS.staff_prefixes],
    };
  } catch {
    return { ...DEFAULT_ACCESS, staff_prefixes: [...DEFAULT_ACCESS.staff_prefixes] };
  }
}

export async function putSetting(db: D1Database, key: keyof GymSettings, value: unknown) {
  await run(db, 'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, JSON.stringify(value));
}

/** Atomically reserve the next receipt number, e.g. CG-000123. */
export async function nextReceiptNo(db: D1Database): Promise<string> {
  const row = await first<{ value: string }>(
    db,
    `UPDATE settings SET value = json_set(value, '$.next', COALESCE(json_extract(value, '$.next'), 1) + 1)
     WHERE key = 'receipt' RETURNING value`,
  );
  const v = row ? JSON.parse(row.value) : { prefix: 'CG', next: 2 };
  return `${v.prefix}-${String(v.next - 1).padStart(6, '0')}`;
}

export async function audit(env: Env, actor: string | null, action: string, entity?: string, entityId?: string | number, detail?: unknown) {
  await run(
    env.DB,
    'INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES (?, ?, ?, ?, ?)',
    actor,
    action,
    entity ?? null,
    entityId != null ? String(entityId) : null,
    detail != null ? JSON.stringify(detail) : null,
  );
}

/** Link punches recorded before the member existed (or before their device ID was set). */
export async function relinkAttendance(db: D1Database) {
  await run(db, `UPDATE attendance SET member_id=(SELECT id FROM members m WHERE m.essl_id=attendance.essl_id AND m.archived=0)
                 WHERE member_id IS NULL OR member_id NOT IN (SELECT id FROM members WHERE archived=0 AND essl_id=attendance.essl_id)`);
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function assert(cond: unknown, status: number, message: string): asserts cond {
  if (!cond) throw new HttpError(status, message);
}

// Small input coercion helpers (keeps the API free of a validation dependency)
export const str = (v: unknown, max = 200): string | null => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
export const int = (v: unknown): number | null => {
  if (v === undefined || v === null || v === '') return null;
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? n : null;
};
export const isDateOrNull = (v: unknown): string | null =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !isNaN(Date.parse(v + 'T00:00:00Z')) ? v : null;
export const mobile = (v: unknown): string | null => {
  const s = str(v, 20);
  if (!s) return null;
  const digits = s.replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits || null;
};
