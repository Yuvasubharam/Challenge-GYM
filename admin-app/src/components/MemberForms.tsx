import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { date, money, todayLocal } from '../lib/format';
import type { Plan } from '../lib/types';
import { Ticket, X } from 'lucide-react';
import { Field, Modal, Spinner, useAction } from './ui';

const MODES = [
  { v: 'cash', l: 'Cash' }, { v: 'upi', l: 'UPI' }, { v: 'card', l: 'Card' }, { v: 'bank', l: 'Bank' },
];

export function usePlans() {
  const [plans, setPlans] = useState<Plan[]>([]);
  useEffect(() => { api.get<Plan[]>('/plans').then((p) => setPlans(p.filter((x) => x.active))).catch(() => undefined); }, []);
  return plans;
}

function addMonths(d: string, n: number) {
  const [y, m, day] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  t.setUTCDate(Math.min(day, last));
  return t.toISOString().slice(0, 10);
}
const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const endFor = (start: string, p?: Plan) => (p ? addDays(addMonths(start, p.duration_months), p.duration_days) : '');

/** Plan + discount + free days + payment block shared by "Add member" and "Renew". */
interface QuoteRes { list: number; manual_discount: number; coupon_discount: number; discount: number; total: number; bonus_days: number; note: string | null; coupon: { code: string; description: string | null; bonus_days: number } | null }

function TermFields({ plans, value, onChange, defaultStart, memberId }: {
  plans: Plan[]; defaultStart: string; memberId?: number;
  value: TermState;
  onChange: (v: TermState) => void;
}) {
  const plan = plans.find((p) => String(p.id) === value.plan_id);
  const start = value.start_date || defaultStart;
  const set = (k: keyof TermState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => onChange({ ...value, [k]: e.target.value });
  const categories = [...new Set(plans.map((p) => p.category))];
  const [q, setQ] = useState<QuoteRes | null>(null);
  const [couponErr, setCouponErr] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  // Live quote from the server (same maths used when saving). Debounced while typing.
  const key = JSON.stringify([value.plan_id, value.price, value.pt_amount, value.discount_type, value.discount_value, value.coupon_applied, value.extra_days]);
  useEffect(() => {
    if (!plan) { setQ(null); return; }
    const t = setTimeout(async () => {
      setChecking(true);
      try {
        const r = await api.post<QuoteRes>('/coupons/quote', { member_id: memberId, ...termBody(value) });
        setQ(r); setCouponErr(null);
      } catch (e) {
        // A coupon that no longer applies (e.g. plan changed) is dropped with the reason shown.
        if (value.coupon_applied) { setCouponErr((e as Error).message); onChange({ ...value, coupon_applied: '' }); }
      } finally { setChecking(false); }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const applyCoupon = async () => {
    const code = value.coupon_code.trim().toUpperCase();
    if (!code || !plan) return;
    setChecking(true);
    try {
      await api.post<QuoteRes>('/coupons/quote', { member_id: memberId, ...termBody({ ...value, coupon_applied: code }) });
      setCouponErr(null);
      onChange({ ...value, coupon_code: code, coupon_applied: code });
    } catch (e) { setCouponErr((e as Error).message); } finally { setChecking(false); }
  };

  const bonus = q?.bonus_days ?? 0;
  const ends = plan ? addDays(endFor(start, plan), bonus) : '';
  const total = q?.total ?? (Number(value.price || plan?.price || 0) + (Number(value.pt_amount) || 0));
  // Until staff edit it, 'Paid now' simply mirrors the bill (sent as pay_full; the server records the exact total).
  const paidShown = value.paid_touched ? value.paid : String(total);
  const paid = Number(paidShown) || 0;

  return (
    <div className="space-y-4">
      <Field label="Plan">
        <select className="input" value={value.plan_id} onChange={(e) => {
          const p = plans.find((x) => String(x.id) === e.target.value);
          onChange({ ...value, plan_id: e.target.value, price: p ? String(p.price) : '', paid_touched: false });
        }} required>
          <option value="">Choose a plan…</option>
          {categories.map((cat) => (
            <optgroup key={cat} label={cat}>
              {plans.filter((p) => p.category === cat).map((p) => <option key={p.id} value={p.id}>{p.name} — {money(p.price)}</option>)}
            </optgroup>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start date"><input type="date" className="input" value={start} onChange={set('start_date')} /></Field>
        <Field label="Ends on" hint={bonus ? `includes ${bonus} free day${bonus === 1 ? '' : 's'}` : undefined}>
          <input className={`input ${bonus ? 'text-lime-700 dark:text-lime font-semibold' : 'opacity-70'}`} value={plan ? date(ends) : '—'} readOnly tabIndex={-1} /></Field>
        <Field label="Plan price (₹)"><input type="number" inputMode="numeric" className="input" value={value.price} onChange={set('price')} min={0} /></Field>
        <Field label="Personal training (₹)"><input type="number" inputMode="numeric" className="input" value={value.pt_amount} onChange={set('pt_amount')} min={0} placeholder="0" /></Field>
      </div>

      {/* Discount */}
      <div>
        <span className="label">Discount</span>
        <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-1 mb-2">
          {([['none', 'None'], ['amount', '₹ off'], ['percent', '% off'], ['coupon', 'Coupon']] as const).map(([k, l]) => (
            <button type="button" key={k} onClick={() => onChange({ ...value, discount_type: k, ...(k !== 'coupon' ? { coupon_applied: '', coupon_code: '' } : {}), ...(k === 'none' || k === 'coupon' ? { discount_value: '' } : {}) })}
              className={`flex-1 h-9 rounded-full text-xs font-semibold transition ${value.discount_type === k ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : 'muted'}`}>{l}</button>
          ))}
        </div>
        {(value.discount_type === 'amount' || value.discount_type === 'percent') && (
          <div className="relative">
            <input type="number" inputMode="numeric" className="input pr-10" value={value.discount_value} min={0} max={value.discount_type === 'percent' ? 100 : undefined}
              placeholder={value.discount_type === 'percent' ? 'e.g. 10' : 'e.g. 500'} onChange={set('discount_value')} autoFocus />
            <span className="absolute right-4 top-1/2 -translate-y-1/2 muted text-sm">{value.discount_type === 'percent' ? '%' : '₹'}</span>
          </div>
        )}
        {value.discount_type === 'coupon' && (
          value.coupon_applied ? (
            <div className="flex items-center gap-2 rounded-2xl bg-lime/15 px-4 py-2.5">
              <Ticket className="w-4 h-4 text-lime-700 dark:text-lime" />
              <span className="flex-1 text-sm"><b className="font-mono">{value.coupon_applied}</b>{q?.coupon?.description ? ` · ${q.coupon.description}` : ''}
                {q ? <span className="block text-xs muted">{q.coupon_discount ? `−${money(q.coupon_discount)}` : ''}{q.coupon?.bonus_days ? `${q.coupon_discount ? ' · ' : ''}+${q.coupon.bonus_days} free days` : ''}</span> : null}</span>
              <button type="button" className="icon-btn w-8 h-8" aria-label="Remove coupon" onClick={() => onChange({ ...value, coupon_applied: '', coupon_code: '' })}><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <div className="flex gap-2">
              <input className="input font-mono uppercase" value={value.coupon_code} placeholder="Coupon code" onChange={(e) => onChange({ ...value, coupon_code: e.target.value.toUpperCase().replace(/\s/g, '') })}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void applyCoupon(); } }} />
              <button type="button" className="btn btn-dark" disabled={!value.coupon_code || checking || !plan} onClick={applyCoupon}>{checking ? <Spinner className="w-4 h-4" /> : 'Apply'}</button>
            </div>
          )
        )}
        {couponErr && <p className="text-xs text-bad mt-1.5">{couponErr}</p>}
      </div>

      {/* Free extra days */}
      <div>
        <span className="label">Free extra days</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {[0, 3, 5, 7, 12].map((d) => (
            <button type="button" key={d} className={`chip ${Number(value.extra_days || 0) === d ? 'chip-on' : ''}`} onClick={() => onChange({ ...value, extra_days: d ? String(d) : '' })}>{d ? `+${d}` : 'None'}</button>
          ))}
          <input type="number" inputMode="numeric" min={0} max={365} className="input h-8 w-24 text-sm" placeholder="Other" value={[3, 5, 7, 12].includes(Number(value.extra_days)) ? '' : value.extra_days}
            onChange={set('extra_days')} aria-label="Other number of free days" />
        </div>
      </div>

      <div className="rounded-3xl bg-black/[.03] dark:bg-white/[.04] p-4 space-y-3">
        <div className="space-y-1 text-sm">
          <div className="flex justify-between"><span className="muted">Plan{Number(value.pt_amount) ? ' + PT' : ''}</span><span>{money(q?.list ?? total)}</span></div>
          {!!q?.manual_discount && <div className="flex justify-between text-lime-700 dark:text-lime"><span>Discount ({value.discount_type === 'percent' ? `${value.discount_value}%` : 'flat'})</span><span>−{money(q.manual_discount)}</span></div>}
          {!!q?.coupon_discount && <div className="flex justify-between text-lime-700 dark:text-lime"><span>Coupon {value.coupon_applied}</span><span>−{money(q.coupon_discount)}</span></div>}
          {!!bonus && <div className="flex justify-between text-lime-700 dark:text-lime"><span>Free days</span><span>+{bonus} days</span></div>}
          <div className="flex justify-between items-baseline pt-1 border-t border-paper-line dark:border-ink-600">
            <span className="muted">Total billed</span><span className="font-display font-bold text-lg">{checking && !q ? '…' : money(total)}</span></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Paid now (₹)"><input type="number" inputMode="numeric" className="input" value={paidShown} onChange={(e) => onChange({ ...value, paid: e.target.value, paid_touched: true })} min={0} /></Field>
          <Field label="Mode">
            <select className="input" value={value.mode} onChange={set('mode')}>{MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</select>
          </Field>
        </div>
        {value.mode !== 'cash' && <Field label="Reference / UPI txn ID"><input className="input" value={value.reference} onChange={set('reference')} /></Field>}
        {paid < total && <p className="text-xs text-warn">Balance of {money(total - paid)} will show as dues.</p>}
        {paid > total && <p className="text-xs text-warn">Paid is more than the bill by {money(paid - total)}.</p>}
      </div>
    </div>
  );
}

interface TermState {
  plan_id: string; start_date: string; price: string; pt_amount: string; paid: string; paid_touched: boolean; mode: string; reference: string;
  discount_type: 'none' | 'amount' | 'percent' | 'coupon'; discount_value: string; coupon_code: string; coupon_applied: string; extra_days: string;
}
const emptyTerm: TermState = {
  plan_id: '', start_date: '', price: '', pt_amount: '', paid: '', paid_touched: false, mode: 'cash', reference: '',
  discount_type: 'none', discount_value: '', coupon_code: '', coupon_applied: '', extra_days: '',
};
const termBody = (t: TermState) => ({
  plan_id: Number(t.plan_id), start_date: t.start_date || undefined, price: t.price === '' ? undefined : Number(t.price),
  pt_amount: Number(t.pt_amount) || 0, mode: t.mode, reference: t.reference || undefined,
  ...(t.paid_touched ? { paid: Number(t.paid) || 0 } : { pay_full: true }),
  discount_type: t.discount_type === 'amount' || t.discount_type === 'percent' ? t.discount_type : 'none',
  discount_value: Number(t.discount_value) || 0,
  coupon_code: t.discount_type === 'coupon' && t.coupon_applied ? t.coupon_applied : undefined,
  extra_days: Number(t.extra_days) || 0,
});

export function AddMemberModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (id: number) => void }) {
  const plans = usePlans();
  const { busy, run } = useAction();
  const [f, setF] = useState({ name: '', mobile: '', essl_id: '', gender: '', dob: '', email: '', emergency_contact: '', notes: '' });
  const [term, setTerm] = useState(emptyTerm);
  const [withPlan, setWithPlan] = useState(true);

  useEffect(() => {
    if (!open) return;
    setF({ name: '', mobile: '', essl_id: '', gender: '', dob: '', email: '', emergency_contact: '', notes: '' });
    setTerm(emptyTerm);
    api.get<{ next: string }>('/members/next-id').then((r) => setF((x) => ({ ...x, essl_id: r.next }))).catch(() => undefined);
  }, [open]);

  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post<{ id: number }>('/members', { ...f, ...(withPlan ? termBody(term) : {}) }), 'Member added — device user queued');
    if (r) onDone(r.id);
  };

  return (
    <Modal open={open} onClose={onClose} title="Add member" wide
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button form="add-member" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="w-4 h-4" />}Save member</button></>}>
      <form id="add-member" onSubmit={submit} className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Full name"><input className="input" value={f.name} onChange={set('name')} required autoFocus /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Mobile"><input className="input" inputMode="tel" value={f.mobile} onChange={set('mobile')} pattern="[0-9 +]{10,14}" required /></Field>
            <Field label="Member ID" hint="Up to 5 digits or e.g. CGA5 — enrol this ID on the X990"><input className="input uppercase" value={f.essl_id} onChange={(e) => setF({ ...f, essl_id: e.target.value.toUpperCase().replace(/\s/g, '') })} pattern="(?:[1-9][0-9]{0,4}|[A-Za-z]{1,4}[0-9]{1,5})" maxLength={9} title="Up to 5 digits (e.g. 643) or letters + digits (e.g. CGA5)" /></Field>
            <Field label="Gender">
              <select className="input" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select>
            </Field>
            <Field label="Date of birth"><input type="date" className="input" value={f.dob} onChange={set('dob')} /></Field>
          </div>
          <Field label="Emergency contact"><input className="input" value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Name · phone" /></Field>
          <Field label="Notes"><textarea className="input" rows={2} value={f.notes} onChange={set('notes')} /></Field>
        </div>
        <div>
          <label className="flex items-center gap-2 text-sm font-semibold mb-4">
            <input type="checkbox" className="w-4 h-4 accent-lime" checked={withPlan} onChange={(e) => setWithPlan(e.target.checked)} />Start a membership now
          </label>
          {withPlan && <TermFields plans={plans} value={term} onChange={setTerm} defaultStart={todayLocal()} />}
        </div>
      </form>
    </Modal>
  );
}

export function RenewModal({ open, onClose, onDone, memberId, currentEnd, name }: {
  open: boolean; onClose: () => void; onDone: () => void; memberId: number; currentEnd: string | null; name: string;
}) {
  const plans = usePlans();
  const { busy, run } = useAction();
  const [term, setTerm] = useState(emptyTerm);
  const today = todayLocal();
  const defaultStart = useMemo(() => (currentEnd && currentEnd >= today ? currentEnd : today), [currentEnd, today]);
  useEffect(() => { if (open) setTerm({ ...emptyTerm, start_date: defaultStart }); }, [open, defaultStart]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post(`/members/${memberId}/renew`, termBody(term)), 'Renewed — door access restores automatically');
    if (r) onDone();
  };
  return (
    <Modal open={open} onClose={onClose} title={`Renew ${name}`}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button form="renew" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="w-4 h-4" />}Renew</button></>}>
      <form id="renew" onSubmit={submit}>
        {currentEnd && <p className="text-sm muted mb-4">Current plan ends {date(currentEnd)}. {currentEnd >= today ? 'The new term continues from that date — no days lost.' : 'It has lapsed, so the new term starts today.'}</p>}
        <TermFields plans={plans} value={term} onChange={setTerm} defaultStart={defaultStart} memberId={memberId} />
      </form>
    </Modal>
  );
}

export function PaymentModal({ open, onClose, onDone, memberId, due, name }: {
  open: boolean; onClose: () => void; onDone: (receiptId?: number) => void; memberId: number; due: number; name: string;
}) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ amount: '', mode: 'cash', reference: '', paid_on: todayLocal(), remarks: '' });
  useEffect(() => { if (open) setF({ amount: due > 0 ? String(due) : '', mode: 'cash', reference: '', paid_on: todayLocal(), remarks: '' }); }, [open, due]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const r = await run(() => api.post<{ id: number; receipt_no: string }>(`/members/${memberId}/payments`, { ...f, amount: Number(f.amount) }), 'Payment recorded');
    if (r) onDone(r.id);
  };
  return (
    <Modal open={open} onClose={onClose} title={`Collect payment — ${name}`}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button><button form="pay" className="btn btn-primary" disabled={busy}>{busy && <Spinner className="w-4 h-4" />}Record payment</button></>}>
      <form id="pay" onSubmit={submit} className="space-y-4">
        {due > 0 && <p className="text-sm rounded-2xl bg-warn/10 text-amber-700 dark:text-warn px-4 py-3">Outstanding dues: <b>{money(due)}</b></p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)"><input type="number" inputMode="numeric" className="input" value={f.amount} onChange={set('amount')} min={1} required autoFocus /></Field>
          <Field label="Mode"><select className="input" value={f.mode} onChange={set('mode')}>{MODES.map((m) => <option key={m.v} value={m.v}>{m.l}</option>)}</select></Field>
          <Field label="Date"><input type="date" className="input" value={f.paid_on} onChange={set('paid_on')} max={todayLocal()} /></Field>
          <Field label="Reference"><input className="input" value={f.reference} onChange={set('reference')} placeholder="UPI txn / cheque" /></Field>
        </div>
        <Field label="Remarks"><input className="input" value={f.remarks} onChange={set('remarks')} /></Field>
      </form>
    </Modal>
  );
}
