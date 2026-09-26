export type Role = 'owner' | 'admin' | 'staff';
export interface Session { aid: number; role: Role; name: string }

export type MemberStatus = 'active' | 'near_expiry' | 'expiring' | 'expired' | 'frozen' | 'none' | 'staff';

export interface MemberSummary {
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
  device_state: 'unknown' | 'active' | 'blocked' | 'removed';
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
  status: MemberStatus;
  days_left: number | null;
  pct_elapsed: number | null;
  access: boolean;
  device_in_sync: boolean;
}

export interface Plan { id: number; name: string; category: string; duration_months: number; duration_days: number; price: number; active: number; sort: number }

export interface Payment {
  id: number; member_id: number; membership_id: number | null; amount: number; mode: string; paid_on: string;
  receipt_no: string | null; reference: string | null; proof_key: string | null; entry_type: string; status: 'confirmed' | 'pending' | 'rejected';
  handled_by: string | null; remarks: string | null; name?: string; essl_id?: string; mobile?: string;
  request_plan_id?: number | null; request_plan_name?: string | null;
}

export interface Membership {
  id: number; plan_id: number | null; category: string | null; duration_label: string | null; start_date: string; end_date: string;
  price: number; pt_included: number; pt_amount: number; kind: string; status: string; notes: string | null; paid: number | null; due: number | null;
  list_price: number | null; discount: number; discount_note: string | null; bonus_days: number;
}

export interface DeviceCommand {
  id: number; essl_id: string | null; action: string; status: string; channel: string | null; attempts?: number; result: string | null;
  reason: string | null; created_by?: string; created_at: string; done_at: string | null; name?: string | null;
}

export interface Settings {
  gym: { name: string; tagline: string; phone: string; address: string };
  upi: { vpa: string; payee: string };
  access: { grace_days: number; staff_prefixes: string[]; block_method: string; auto_enforce: boolean };
  reminders: { near_days: number; soon_days: number };
  receipt: { prefix: string; next: number };
}
