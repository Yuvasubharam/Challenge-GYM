import type { Env } from '../env';
import { tzOffset } from '../env';
import { all, first, getSettings, type GymSettings } from './db';
import { today as todayOf } from './dates';
import { accessAllowed, daysLeft, memberStatus, percentElapsed, type MemberStatus } from './membership';
import { cachedView } from './viewCache';

export interface MemberRow {
  id: number;
  essl_id: string | null;
  name: string;
  mobile: string | null;
  gender: string | null;
  join_date: string | null;
  is_staff: number;
  frozen_from: string | null;
  frozen_until: string | null;
  access_override: 'allow' | 'deny' | null;
  device_state: string;
  photo_key: string | null;
  app_access: number;
  app_user: number;
  app_last_login: string | null;
  has_consent: number;
  membership_id: number | null;
  start_date: string | null;
  end_date: string | null;
  category: string | null;
  duration_label: string | null;
  price: number | null;
  pt_included: number | null;
  due: number;
  last_visit: string | null;
}

export interface MemberSummary extends MemberRow {
  status: MemberStatus;
  days_left: number | null;
  pct_elapsed: number | null;
  access: boolean;
  device_in_sync: boolean;
}

// D1 bills per row read, so every per-member lookup below is a correlated subquery that
// walks an index (ix_memberships_active, ix_payments_membership, ix_attendance_member):
// ~7 rows per member. The old view/CTE/window-function forms read the whole tables —
// 2.4k rows for ONE member, 12k for the list (measured on prod, 2026-09-28).
const BASE = `
  SELECT m.id, m.essl_id, m.name, m.mobile, m.gender, m.join_date, m.is_staff, m.frozen_from, m.frozen_until,
         m.access_override, m.device_state, m.photo_key, m.app_access,
         cm.id AS membership_id, cm.start_date, cm.end_date, cm.category, cm.duration_label, cm.price, cm.pt_included,
         CASE WHEN acc.last_login_at IS NULL THEN 0 ELSE 1 END AS app_user, acc.last_login_at AS app_last_login,
         EXISTS(SELECT 1 FROM member_consents mc WHERE mc.member_id = m.id) AS has_consent,
         COALESCE((SELECT SUM(MAX(0, ms.price - COALESCE((SELECT SUM(p.amount) FROM payments p
                                                          WHERE p.membership_id = ms.id AND p.status = 'confirmed'), 0)))
                   FROM memberships ms WHERE ms.member_id = m.id AND ms.status = 'active'), 0) AS due,
         (SELECT MAX(a.day) FROM attendance a WHERE a.member_id = m.id) AS last_visit
  FROM members m
  LEFT JOIN memberships cm ON cm.id = (SELECT id FROM memberships WHERE member_id = m.id AND status = 'active'
                                       ORDER BY end_date DESC, id DESC LIMIT 1)
  LEFT JOIN accounts acc ON acc.member_id = m.id`;

export function summarize(r: MemberRow, today: string, s: GymSettings): MemberSummary {
  const access = accessAllowed(r, today, s.access);
  const onDevice = r.device_state === 'active' || r.device_state === 'unknown';
  return {
    ...r,
    status: memberStatus(r, today, s.reminders),
    days_left: daysLeft(r.end_date, today),
    pct_elapsed: r.start_date && r.end_date ? percentElapsed(r.start_date, r.end_date, today) : null,
    access,
    device_in_sync: !r.essl_id || access === onDevice,
  };
}

/** Cached ≤60 s and dropped on any admin write (see viewCache). Returns a copy: callers filter/sort it. */
export async function listMembers(env: Env, includeArchived = false): Promise<MemberSummary[]> {
  return [...(await cachedView(env, `members:${includeArchived ? 1 : 0}`, 60_000, () => loadMembers(env, includeArchived)))];
}

async function loadMembers(env: Env, includeArchived: boolean): Promise<MemberSummary[]> {
  const s = await getSettings(env.DB);
  const today = todayOf(tzOffset(env));
  const rows = await all<MemberRow>(env.DB, `${BASE} WHERE m.archived = ? ORDER BY m.name COLLATE NOCASE`, includeArchived ? 1 : 0);
  return rows.map((r) => summarize(r, today, s));
}

export async function getMemberSummary(env: Env, id: number): Promise<MemberSummary | null> {
  const s = await getSettings(env.DB);
  const r = await first<MemberRow>(env.DB, `${BASE} WHERE m.id = ?`, id);
  return r ? summarize(r, todayOf(tzOffset(env)), s) : null;
}
