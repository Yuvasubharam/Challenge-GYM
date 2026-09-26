import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Check, Download, Image, Plus, Printer, ReceiptIndianRupee, Search, X } from 'lucide-react';
import { api, qs } from '../lib/api';
import { date, money, todayLocal } from '../lib/format';
import type { MemberSummary, Payment } from '../lib/types';
import { Avatar, Confirm, Empty, ErrorBox, Field, Modal, PageLoader, Segmented, useAction, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { PaymentModal } from '../components/MemberForms';
import { useSession } from '../lib/session';

type Tab = 'confirmed' | 'pending' | 'rejected';
interface Ledger { from: string; to: string; total: number; count: number; by_mode: Record<string, number>; payments: Payment[] }

const monthStart = () => `${todayLocal().slice(0, 7)}-01`;

export default function Payments() {
  const [params, setParams] = useSearchParams();
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>((params.get('tab') as Tab) ?? 'confirmed');
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(todayLocal());
  const [mode, setMode] = useState('');
  const [q, setQ] = useState('');
  const [picker, setPicker] = useState(params.get('new') === '1');
  const [payFor, setPayFor] = useState<MemberSummary | null>(null);
  const [rejecting, setRejecting] = useState<Payment | null>(null);
  const [voiding, setVoiding] = useState<Payment | null>(null);
  const [reason, setReason] = useState('');
  const { busy, run } = useAction();

  const { data, error, reload } = useLoad(() => api.get<Ledger>(`/payments${qs({ status: tab, from, to, mode })}`), [tab, from, to, mode]);
  const pendingCount = useLoad(() => api.get<Ledger>('/payments?status=pending'), [data]).data?.count ?? 0;

  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    const all = data?.payments ?? [];
    return s ? all.filter((p) => p.name?.toLowerCase().includes(s) || p.essl_id === s || (p.receipt_no ?? '').toLowerCase().includes(s) || (p.mobile ?? '').includes(s)) : all;
  }, [data, q]);

  const confirm = (p: Payment) => run(() => api.post(`/payments/${p.id}/confirm`),
    p.request_plan_name ? `Confirmed — ${p.name} renewed (${p.request_plan_name})` : `Confirmed ${money(p.amount)} from ${p.name}`).then(reload);

  return (
    <>
      <PageHeader title="Payments" subtitle="Every rupee with a receipt number. UPI payments from the member app wait here for your check."
        actions={<>
          {can('owner', 'admin') && <a className="btn btn-outline" href="/api/export/payments.csv"><Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span></a>}
          <button className="btn btn-primary" onClick={() => setPicker(true)}><Plus className="w-4 h-4" />New payment</button>
        </>} />

      <div className="mb-4">
        <Segmented<Tab> value={tab} onChange={(t) => { setTab(t); setParams(t === 'confirmed' ? {} : { tab: t }, { replace: true }); }} options={[
          { value: 'confirmed', label: 'Ledger' },
          { value: 'pending', label: 'To verify', count: pendingCount },
          { value: 'rejected', label: 'Rejected / void' },
        ]} />
      </div>

      {tab !== 'pending' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
          <Field label="From"><input type="date" className="input" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="To"><input type="date" className="input" value={to} min={from} max={todayLocal()} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Mode"><select className="input" value={mode} onChange={(e) => setMode(e.target.value)}><option value="">All</option><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option><option value="bank">Bank</option></select></Field>
          <Field label="Search"><div className="relative"><Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 muted" /><input className="input pl-10" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name, ID, receipt" /></div></Field>
        </div>
      )}

      {data && tab === 'confirmed' && (
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 mb-4">
          <div className="card-ink p-4 col-span-2 lg:col-span-1"><p className="text-xs text-ink-300">Total collected</p><p className="kpi text-lime mt-2">{money(data.total)}</p><p className="text-xs text-ink-300 mt-1">{data.count} payments</p></div>
          {['cash', 'upi', 'card', 'bank'].map((m) => (
            <div key={m} className="card p-4"><p className="text-xs muted uppercase font-semibold">{m}</p><p className="font-display text-xl font-bold mt-2">{money(data.by_mode[m] ?? 0)}</p></div>
          ))}
        </div>
      )}

      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <PageLoader /> : rows.length === 0 ? (
        <div className="card"><Empty icon={<ReceiptIndianRupee className="w-6 h-6" />} title={tab === 'pending' ? 'Nothing to verify' : 'No payments in this range'} /></div>
      ) : (
        <div className="card overflow-hidden">
          <ul>
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap sm:flex-nowrap items-center gap-3 px-4 py-3 border-t first:border-t-0 border-paper-line dark:border-ink-700">
                <div className="flex-1 min-w-[180px]">
                  <Link to={`/members/${p.member_id}`} className="font-semibold hover:underline">{p.name}</Link> <span className="text-xs muted">#{p.essl_id}</span>
                  <p className="text-xs muted">{date(p.paid_on)} · {p.mode.toUpperCase()} · {p.entry_type}{p.receipt_no ? ` · ${p.receipt_no}` : ''}{p.reference ? ` · ref ${p.reference}` : ''}</p>
                  {p.request_plan_name && p.status === 'pending' && <p className="text-xs font-semibold text-lime-700 dark:text-lime mt-0.5">Renewal request: {p.request_plan_name} — confirming renews the plan and restores door access</p>}
                  {p.remarks && <p className="text-xs muted truncate">{p.remarks}</p>}
                </div>
                <p className="font-display font-bold text-lg">{money(p.amount)}</p>
                <div className="flex gap-1">
                  {p.proof_key && <a className="icon-btn" href={`/api/files/${p.proof_key}`} target="_blank" rel="noreferrer" title="Payment screenshot"><Image className="w-4 h-4" /></a>}
                  {p.status === 'pending' && <>
                    <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => confirm(p)}><Check className="w-3.5 h-3.5" />Received</button>
                    <button className="btn btn-danger btn-sm" onClick={() => { setReason(''); setRejecting(p); }}><X className="w-3.5 h-3.5" /></button>
                  </>}
                  {p.status === 'confirmed' && <Link className="icon-btn" to={`/receipt/${p.id}`} target="_blank" title="Print receipt"><Printer className="w-4 h-4" /></Link>}
                  {p.status === 'confirmed' && can('owner', 'admin') && <button className="icon-btn text-bad" title="Void" onClick={() => { setReason(''); setVoiding(p); }}><X className="w-4 h-4" /></button>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <MemberPicker open={picker} onClose={() => setPicker(false)} onPick={(m) => { setPicker(false); setPayFor(m); }} />
      {payFor && <PaymentModal open onClose={() => setPayFor(null)} memberId={payFor.id} due={payFor.due} name={payFor.name}
        onDone={(pid) => { setPayFor(null); void reload(); if (pid) window.open(`/receipt/${pid}`, '_blank'); }} />}

      <Modal open={!!rejecting} onClose={() => setRejecting(null)} title="Reject UPI claim"
        footer={<><button className="btn btn-outline" onClick={() => setRejecting(null)}>Cancel</button>
          <button className="btn bg-bad text-white" disabled={busy} onClick={() => run(() => api.post(`/payments/${rejecting!.id}/reject`, { reason }), 'Claim rejected').then(() => { setRejecting(null); void reload(); })}>Reject</button></>}>
        <Field label="Reason (member will see this)"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Not received in bank" /></Field>
      </Modal>
      <Confirm open={!!voiding} onClose={() => setVoiding(null)} danger busy={busy} title="Void this payment?" confirmLabel="Void payment"
        message={<div className="space-y-3"><p>{voiding && `${money(voiding.amount)} from ${voiding.name} (${voiding.receipt_no ?? 'no receipt'})`} will be excluded from totals and dues. This is logged.</p>
          <input className="input" placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} /></div>}
        onConfirm={() => reason && run(() => api.post(`/payments/${voiding!.id}/void`, { reason }), 'Payment voided').then(() => { setVoiding(null); void reload(); })} />
    </>
  );
}

export function MemberPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (m: MemberSummary) => void }) {
  const [q, setQ] = useState('');
  const [list, setList] = useState<MemberSummary[]>([]);
  useEffect(() => { if (open && !list.length) api.get<{ members: MemberSummary[] }>('/members').then((r) => setList(r.members)).catch(() => undefined); }, [open, list.length]);
  const s = q.trim().toLowerCase();
  const hits = s ? list.filter((m) => m.name.toLowerCase().includes(s) || (m.mobile ?? '').includes(s) || (m.essl_id ?? '').toLowerCase() === s).slice(0, 30)
    : [...list].filter((m) => m.due > 0).slice(0, 30);
  return (
    <Modal open={open} onClose={onClose} title="Who is paying?">
      <input className="input mb-3" autoFocus placeholder="Name, mobile or device ID" value={q} onChange={(e) => setQ(e.target.value)} />
      {!s && <p className="text-xs muted mb-2">Members with dues</p>}
      <ul className="-mx-2">
        {hits.map((m) => (
          <li key={m.id}><button className="w-full flex items-center gap-3 rounded-2xl px-2 py-2 hover:bg-black/5 dark:hover:bg-white/5 text-left" onClick={() => onPick(m)}>
            <Avatar name={m.name} photo={m.photo_key} size={36} />
            <span className="flex-1 min-w-0"><span className="font-semibold block truncate">{m.name}</span><span className="text-xs muted">#{m.essl_id} · {m.mobile}</span></span>
            {m.due > 0 && <span className="text-xs font-semibold text-warn">{money(m.due)}</span>}
          </button></li>
        ))}
        {s && hits.length === 0 && <li className="text-sm muted px-2 py-4">No match.</li>}
      </ul>
    </Modal>
  );
}
