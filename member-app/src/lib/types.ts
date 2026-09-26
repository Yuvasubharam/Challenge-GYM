export type Status = 'active' | 'near_expiry' | 'expiring' | 'expired' | 'frozen' | 'none' | 'staff';

export interface Home {
  today: string;
  member: { id: number; essl_id: string | null; name: string; mobile: string | null; gender: string | null; dob: string | null; email: string | null;
    address: string | null; emergency_contact: string | null; join_date: string | null; photo_key: string | null; frozen_until: string | null };
  plan: { status: Status; days_left: number | null; pct_elapsed: number | null; start_date: string | null; end_date: string | null;
    category: string | null; duration_label: string | null; price: number | null; due: number; pt: boolean };
  door: { allowed: boolean; reason: string };
  visits: { today: boolean; streak: number; this_week: number; this_month: number; last_visit: string | null };
  pending_payments: { n: number; total: number };
  gym: { name: string; tagline: string; phone: string; address: string };
  upi: { vpa: string; payee: string } | null;
}

export interface Plan { id: number; name: string; category: string; duration_months: number; duration_days: number; price: number }

export interface MyPayment {
  id: number; amount: number; mode: string; paid_on: string; receipt_no: string | null; reference: string | null; entry_type: string;
  status: 'confirmed' | 'pending' | 'rejected'; remarks: string | null; request_plan_name: string | null;
  category: string | null; duration_label: string | null; start_date: string | null; end_date: string | null;
}
