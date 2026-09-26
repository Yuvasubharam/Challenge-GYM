// Gym-local calendar helpers. All business dates are plain 'YYYY-MM-DD' strings in the
// gym's timezone (IST has no DST, so a fixed offset is exact).

export const DEFAULT_OFFSET_MIN = 330;

const pad = (n: number) => String(n).padStart(2, '0');

export function localNow(offsetMin = DEFAULT_OFFSET_MIN, now = new Date()): Date {
  // A Date whose UTC fields hold the gym-local wall clock.
  return new Date(now.getTime() + offsetMin * 60_000);
}

export function today(offsetMin = DEFAULT_OFFSET_MIN, now = new Date()): string {
  const d = localNow(offsetMin, now);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function offsetSuffix(offsetMin = DEFAULT_OFFSET_MIN): string {
  const sign = offsetMin >= 0 ? '+' : '-';
  const a = Math.abs(offsetMin);
  return `${sign}${pad(Math.floor(a / 60))}:${pad(a % 60)}`;
}

/** Device wall-clock 'YYYY-MM-DD HH:MM:SS' → ISO with the gym offset. */
export function deviceTimeToIso(ts: string, offsetMin = DEFAULT_OFFSET_MIN): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(ts.trim());
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? '00'}${offsetSuffix(offsetMin)}`;
}

export function isDate(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function parse(s: string): Date {
  return new Date(s + 'T00:00:00Z');
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(s: string, n: number): string {
  const d = parse(s);
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

/** Same day-of-month n months later, clamped to month end (31-Aug + 1m = 30-Sep). */
export function addMonths(s: string, n: number): string {
  const d = parse(s);
  const day = d.getUTCDate();
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return fmt(target);
}

export function diffDays(a: string, b: string): number {
  return Math.round((parse(a).getTime() - parse(b).getTime()) / 86_400_000);
}

export function maxDate(a: string, b: string): string {
  return a >= b ? a : b;
}

export function monthRange(ym: string): { from: string; to: string } {
  const from = `${ym}-01`;
  return { from, to: addDays(addMonths(from, 1), -1) };
}
