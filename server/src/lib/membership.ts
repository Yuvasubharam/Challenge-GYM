// Membership rules — pure functions shared by API, cron and tests.
import { addDays, addMonths, diffDays, maxDate } from './dates';

export type MemberStatus = 'active' | 'near_expiry' | 'expiring' | 'expired' | 'frozen' | 'none' | 'staff';

export interface AccessSettings {
  grace_days: number;
  staff_prefixes: string[];
  block_method: 'remove' | 'disable';
  auto_enforce: boolean;
}

export interface ReminderSettings {
  near_days: number;
  soon_days: number;
}

export const DEFAULT_ACCESS: AccessSettings = {
  grace_days: 0,
  staff_prefixes: ['CGA', 'CGC'],
  block_method: 'remove',
  auto_enforce: true,
};
export const DEFAULT_REMINDERS: ReminderSettings = { near_days: 30, soon_days: 7 };

export interface StatusInput {
  end_date: string | null;
  frozen_from?: string | null;
  frozen_until?: string | null;
  is_staff?: number | boolean;
  access_override?: 'allow' | 'deny' | null;
}

export function isFrozen(m: StatusInput, today: string): boolean {
  return !!m.frozen_until && m.frozen_until >= today && (!m.frozen_from || m.frozen_from <= today);
}

export function daysLeft(end: string | null, today: string): number | null {
  return end ? diffDays(end, today) : null;
}

export function memberStatus(m: StatusInput, today: string, r: ReminderSettings = DEFAULT_REMINDERS): MemberStatus {
  if (m.is_staff) return 'staff';
  if (isFrozen(m, today)) return 'frozen';
  const left = daysLeft(m.end_date, today);
  if (left === null) return 'none';
  if (left < 0) return 'expired';
  if (left <= r.soon_days) return 'expiring';
  if (left <= r.near_days) return 'near_expiry';
  return 'active';
}

/** Should the biometric device let this person in today? */
export function accessAllowed(m: StatusInput, today: string, a: AccessSettings = DEFAULT_ACCESS): boolean {
  if (m.access_override === 'deny') return false;
  if (m.access_override === 'allow') return true;
  if (m.is_staff) return true;
  if (isFrozen(m, today)) return false;
  if (!m.end_date) return false;
  return addDays(m.end_date, a.grace_days) >= today;
}

/**
 * Member (device) ID: up to 5 digits (1–99999), or letters followed by up to 5 digits
 * for staff/special IDs like CGA5, CGC12, T1. Stored upper-case.
 */
export const MEMBER_ID_RULE = /^(?:[1-9]\d{0,4}|[A-Z]{1,4}\d{1,5})$/;
export const MEMBER_ID_HINT = 'Member ID must be up to 5 digits (e.g. 643) or letters + digits (e.g. CGA5)';

export function normalizeMemberId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().toUpperCase().replace(/\s+/g, '');
  return s || null;
}

export const isMemberId = (s: string | null): s is string => !!s && MEMBER_ID_RULE.test(s);

export function isStaffCode(esslId: string | null | undefined, prefixes: string[]): boolean {
  if (!esslId) return false;
  const up = esslId.toUpperCase();
  return prefixes.some((p) => up.startsWith(p.toUpperCase()));
}

export interface PlanLike {
  duration_months: number;
  duration_days: number;
}

export function termEnd(start: string, plan: PlanLike): string {
  let end = start;
  if (plan.duration_months) end = addMonths(end, plan.duration_months);
  if (plan.duration_days) end = addDays(end, plan.duration_days);
  return end;
}

/**
 * Renewal start: continue from the current end date when renewing early (no lost days),
 * otherwise start today. Matches the gym's convention where a term ends on the same
 * calendar day the next one starts.
 */
export function renewalStart(currentEnd: string | null, today: string): string {
  if (!currentEnd) return today;
  return maxDate(currentEnd, today);
}

export function durationLabel(plan: PlanLike): string {
  if (plan.duration_months === 12 && !plan.duration_days) return '1 Year';
  if (plan.duration_months && !plan.duration_days) return `${plan.duration_months} Month`;
  if (!plan.duration_months && plan.duration_days) return `${plan.duration_days} Days`;
  return `${plan.duration_months} Month ${plan.duration_days} Days`;
}

/** Freeze extends the end date by the frozen span when it is lifted. */
export function unfreezeEnd(end: string, frozenFrom: string, unfreezeOn: string): string {
  const span = Math.max(0, diffDays(unfreezeOn, frozenFrom));
  return addDays(end, span);
}

export function percentElapsed(start: string, end: string, today: string): number {
  const total = diffDays(end, start);
  if (total <= 0) return 100;
  return Math.max(0, Math.min(100, Math.round((diffDays(today, start) / total) * 1000) / 10));
}
