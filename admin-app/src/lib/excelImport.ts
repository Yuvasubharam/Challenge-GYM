// Parses GYM_Membership_System.xlsx (sheets: "Master Data", "Payment History", "Follow-ups")
// into the normalised rows the admin API's /import/excel expects.
import type { WorkBook } from 'xlsx';

export interface SheetMember {
  row: number; essl_id: string; name: string; mobile?: string; gender?: string; join_date?: string;
  start_date?: string; end_date?: string; category?: string; duration_label?: string;
  total?: number; paid?: number; pending?: number; pt?: boolean; pt_amount?: number;
}
export interface SheetPayment { essl_id: string; name?: string; paid_on: string; amount: number; mode?: string; receipt_no?: string; entry_type?: string; remarks?: string; ref?: string }
export interface SheetFollowup { essl_id: string; name?: string; call_date: string; response?: string; next_date?: string; priority?: string; status?: string; remarks?: string; handled_by?: string }
export interface Parsed { members: SheetMember[]; payments: SheetPayment[]; followups: SheetFollowup[]; warnings: string[] }

const MON: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };

export function parseDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  if (v instanceof Date && !isNaN(v.getTime())) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2}|\d{4})$/.exec(s); // 01-Feb-26
  if (m) {
    const mon = MON[m[2].toLowerCase()];
    if (!mon) return undefined;
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mon}-${m[1].padStart(2, '0')}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s); // 01/02/2026 (Indian D/M/Y)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return undefined;
}

export function parseMoney(v: unknown): number | undefined {
  if (v === null || v === undefined) return undefined;
  const s = String(v).replace(/[₹,\s]/g, '');
  if (!s || /^[-—–]+$/.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

const clean = (v: unknown) => {
  if (v === null || v === undefined) return undefined;
  const s = String(v).trim();
  return s && !/^[—–-]+$/.test(s) ? s : undefined;
};

/** Find the header row (first row containing `mustHave`) and map rows to objects keyed by header. */
function rowsOf(XLSX: typeof import('xlsx'), wb: WorkBook, sheet: string, mustHave: string) {
  const ws = wb.Sheets[sheet];
  if (!ws) return { rows: [] as Record<string, unknown>[], found: false };
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: false });
  const h = grid.findIndex((r) => r.some((c) => String(c ?? '').trim() === mustHave));
  if (h < 0) return { rows: [], found: false };
  const header = grid[h].map((c) => String(c ?? '').trim());
  const rows = grid.slice(h + 1).map((r, i) => {
    const o: Record<string, unknown> = { __row: h + i + 2 };
    header.forEach((k, j) => { if (k) o[k] = r[j]; });
    return o;
  });
  return { rows, found: true };
}

export async function parseWorkbook(file: File): Promise<Parsed> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const warnings: string[] = [];

  const master = rowsOf(XLSX, wb, 'Master Data', 'ESSL ID');
  if (!master.found) throw new Error('Sheet "Master Data" with an "ESSL ID" column was not found.');
  const members: SheetMember[] = [];
  for (const r of master.rows) {
    const essl = clean(r['ESSL ID']);
    const name = clean(r['Member Name']);
    if (!essl || !name || !/^[A-Za-z0-9_-]{1,24}$/.test(essl)) continue; // skips TOTAL / legend rows
    const dur = clean(r['Duration']);
    members.push({
      row: r.__row as number,
      essl_id: essl,
      name,
      mobile: clean(r['Mobile'])?.replace(/\D/g, '').slice(-10),
      gender: clean(r['Gender'])?.toLowerCase(),
      join_date: parseDate(r['Join Date']) ?? parseDate(r['Start Date']),
      start_date: parseDate(r['Start Date']),
      end_date: parseDate(r['End Date']),
      category: clean(r['Membership Type']),
      duration_label: dur && /^\d+\s*(Month|Year|Day)/i.test(dur) ? dur : undefined,
      total: parseMoney(r['Total Amount (₹)']),
      paid: parseMoney(r['Paid (₹)']),
      pending: parseMoney(r['Pending (₹)']),
      pt: /^y/i.test(String(r['Personal Training'] ?? '')),
      pt_amount: parseMoney(r['PT Amount (₹)']),
    });
  }

  const pay = rowsOf(XLSX, wb, 'Payment History', 'ESSL ID');
  if (!pay.found) warnings.push('Sheet "Payment History" not found — only members and plans will be imported.');
  const payments: SheetPayment[] = [];
  for (const r of pay.rows) {
    const essl = clean(r['ESSL ID']);
    const paid_on = parseDate(r['Payment Date']);
    const amount = parseMoney(r['Amount Paid (₹)']);
    if (!essl || !paid_on || !amount) continue;
    payments.push({
      essl_id: essl, name: clean(r['Member Name']), paid_on, amount, mode: clean(r['Payment Mode']), receipt_no: clean(r['Receipt No.']),
      entry_type: clean(r['Entry Type']), remarks: clean(r['Remarks']), ref: clean(r['#']),
    });
  }

  const fu = rowsOf(XLSX, wb, 'Follow-ups', 'ESSL ID');
  const followups: SheetFollowup[] = [];
  for (const r of fu.rows) {
    const essl = clean(r['ESSL ID']);
    const call_date = parseDate(r['Call Date']);
    if (!essl || !call_date) continue;
    followups.push({
      essl_id: essl, name: clean(r['Member Name']), call_date, response: clean(r['Response']), next_date: parseDate(r['Next Follow-up']),
      priority: clean(r['Priority']), status: clean(r['Status']), remarks: clean(r['Remarks']), handled_by: clean(r['Handled By']),
    });
  }

  const ids = new Set(members.map((m) => m.essl_id));
  const orphanPays = payments.filter((p) => !ids.has(p.essl_id)).length;
  if (orphanPays) warnings.push(`${orphanPays} payment(s) belong to IDs not in Master Data and will be skipped.`);
  return { members, payments, followups, warnings };
}

/** Split into request-sized chunks, keeping each device ID's rows together. */
export function chunk(p: Parsed, size = 120) {
  const byId = new Map<string, SheetMember[]>();
  for (const m of p.members) byId.set(m.essl_id, [...(byId.get(m.essl_id) ?? []), m]);
  const chunks: { members: SheetMember[]; payments: SheetPayment[]; followups: SheetFollowup[] }[] = [];
  let cur: SheetMember[] = [];
  const flush = () => {
    if (!cur.length) return;
    const ids = new Set(cur.map((m) => m.essl_id));
    chunks.push({ members: cur, payments: p.payments.filter((x) => ids.has(x.essl_id)), followups: p.followups.filter((x) => ids.has(x.essl_id)) });
    cur = [];
  };
  for (const group of byId.values()) {
    if (cur.length + group.length > size) flush();
    cur.push(...group);
  }
  flush();
  return chunks;
}
