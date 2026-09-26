const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inrCompact = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });

export const money = (n: number | null | undefined) => inr.format(n ?? 0);
export const moneyShort = (n: number | null | undefined) => `₹${inrCompact.format(n ?? 0)}`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' → '26 Sep 2026' (no timezone conversion — business dates are local). */
export function date(d: string | null | undefined, withYear = true): string {
  if (!d) return '—';
  const [y, m, day] = d.slice(0, 10).split('-');
  if (!y || !m || !day) return d;
  return `${Number(day)} ${MONTHS[Number(m) - 1]}${withYear ? ` ${y}` : ''}`;
}

/** ISO with offset → '6:42 PM' as shown on the gym wall clock. */
export function time(iso: string | null | undefined): string {
  if (!iso) return '—';
  const m = /T(\d{2}):(\d{2})/.exec(iso);
  if (!m) return iso;
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? 'AM' : 'PM'}`;
}

export const monthLabel = (ym: string) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(2, 4)}`;

export function ago(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export function daysLeftLabel(d: number | null | undefined): string {
  if (d === null || d === undefined) return 'No plan';
  if (d < 0) return `Expired ${-d} day${d === -1 ? '' : 's'} ago`;
  if (d === 0) return 'Ends today';
  return `${d} day${d === 1 ? '' : 's'} left`;
}

export function todayLocal(): string {
  const d = new Date(Date.now() + 330 * 60_000);
  return d.toISOString().slice(0, 10);
}

export const initials = (name: string) =>
  name.replace(/[^A-Za-z ]/g, ' ').trim().split(/\s+/).filter(Boolean).slice(-2).map((w) => w[0]).join('').toUpperCase() || '?';

export const waLink = (mobile: string | null | undefined, text: string) =>
  mobile ? `https://wa.me/91${mobile.replace(/\D/g, '').slice(-10)}?text=${encodeURIComponent(text)}` : undefined;
