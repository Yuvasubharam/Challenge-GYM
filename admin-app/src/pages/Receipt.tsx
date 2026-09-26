import { useParams } from 'react-router-dom';
import { Dumbbell, MessageCircle, Printer } from 'lucide-react';
import { api } from '../lib/api';
import { date, money, waLink } from '../lib/format';
import { ErrorBox, PageLoader, useLoad } from '../components/ui';

interface R {
  payment: { id: number; amount: number; mode: string; paid_on: string; receipt_no: string; reference: string | null; entry_type: string; handled_by: string; remarks: string | null;
    name: string; essl_id: string; mobile: string | null; category: string | null; duration_label: string | null; start_date: string | null; end_date: string | null; status: string };
  gym: { name: string; phone: string; address: string };
}

export default function Receipt() {
  const { id } = useParams();
  const { data, error } = useLoad(() => api.get<R>(`/payments/${id}/receipt`), [id]);
  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!data) return <PageLoader />;
  const { payment: p, gym } = data;
  const text = `${gym.name} receipt ${p.receipt_no}: ${money(p.amount)} received from ${p.name} (#${p.essl_id}) on ${date(p.paid_on)} via ${p.mode.toUpperCase()}.${p.end_date ? ` Membership valid till ${date(p.end_date)}.` : ''} Thank you!`;
  return (
    <div className="min-h-dvh bg-paper dark:bg-ink-900 py-8 px-4">
      <div className="max-w-md mx-auto bg-white text-ink-900 rounded-4xl shadow-card overflow-hidden print:shadow-none print:rounded-none">
        <div className="bg-ink-900 text-white p-6 flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-lime text-ink-900 flex items-center justify-center"><Dumbbell className="w-6 h-6" /></div>
          <div className="flex-1"><p className="font-display font-bold text-lg">{gym.name}</p><p className="text-xs text-ink-300">{gym.address}{gym.phone ? ` · ${gym.phone}` : ''}</p></div>
        </div>
        <div className="p-6">
          <div className="flex justify-between items-start">
            <div><p className="text-xs text-ink-400 font-semibold uppercase tracking-wide">Payment receipt</p><p className="font-mono font-bold mt-1">{p.receipt_no}</p></div>
            <p className="text-sm text-ink-400">{date(p.paid_on)}</p>
          </div>
          <div className="my-6 text-center py-6 rounded-3xl bg-lime/20">
            <p className="text-xs text-ink-500 font-semibold">Amount received</p>
            <p className="font-display text-4xl font-bold mt-1">{money(p.amount)}</p>
            <p className="text-xs text-ink-500 mt-1 uppercase">{p.mode}{p.reference ? ` · ${p.reference}` : ''}</p>
          </div>
          <dl className="text-sm space-y-2.5">
            {[['Member', `${p.name}`], ['Member ID', p.essl_id], ['Mobile', p.mobile ?? '—'], ['For', `${p.category ?? 'Membership'}${p.duration_label ? ` · ${p.duration_label}` : ''} (${p.entry_type})`],
              ['Valid', p.start_date ? `${date(p.start_date)} → ${date(p.end_date)}` : '—'], ['Received by', p.handled_by ?? '—']].map(([k, v]) => (
              <div key={k} className="flex justify-between gap-4 border-b border-dashed border-ink-100 pb-2"><dt className="text-ink-400">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>
            ))}
          </dl>
          {p.status !== 'confirmed' && <p className="mt-4 text-center text-bad font-bold uppercase">Void</p>}
          <p className="text-center text-xs text-ink-400 mt-6">Thank you for training with us 💪</p>
        </div>
      </div>
      <div className="max-w-md mx-auto flex gap-2 mt-4 no-print">
        <button className="btn btn-dark flex-1" onClick={() => window.print()}><Printer className="w-4 h-4" />Print</button>
        {p.mobile && <a className="btn flex-1 bg-[#25D366] text-white" href={waLink(p.mobile, text)} target="_blank" rel="noreferrer"><MessageCircle className="w-4 h-4" />Send on WhatsApp</a>}
      </div>
    </div>
  );
}
