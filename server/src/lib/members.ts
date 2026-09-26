import type { Env } from '../env';
import { tzOffset } from '../env';
import { all, first, getSettings, type GymSettings } from './db';
import { today as todayOf } from './dates';
import { accessAllowed, daysLeft, memberStatus, percentElapsed, type MemberStatus } from './membership';

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

const BASE = `
  SELECT m.id, m.essl_id, m.name, m.mobile, m.gender, m.join_date, m.is_staff, m.frozen_from, m.frozen_until,
         m.access_override, m.device_state, m.photo_key, m.app_access,
         cm.id AS membership_id, cm.start_date, cm.end_date, cm.category, cm.duration_label, cm.price, cm.pt_included,
         COALESCE(d.due, 0) AS due,
         (SELECT MAX(a.day) FROM attendance a WHERE a.member_id = m.id) AS last_visit
  FROM members m
  LEFT JOIN v_current_membership cm ON cm.member_id = m.id
  LEFT JOIN v_member_dues d ON d.member_id = m.id`;

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

export async function listMembers(env: Env, includeArchived = false): Promise<MemberSummary[]> {
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
