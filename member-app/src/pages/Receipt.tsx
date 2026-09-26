import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Dumbbell, Share2 } from 'lucide-react';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { ErrorBox, PageLoader, useLoad } from '../components/ui';

interface R {
  payment: { id: number; amount: number; mode: string; paid_on: string; receipt_no: string; reference: string | null; entry_type: string;
    name: string; essl_id: string; category: string | null; duration_label: string | null; start_date: string | null; end_date: string | null };
  gym: { name: string; phone: string; address: string };
}

export default function Receipt() {
  const { id } = useParams();
  const nav = useNavigate();
  const { data, error } = useLoad(() => api.get<R>(`/me/receipt/${id}`), [id]);
  if (error) return <div className="p-6"><ErrorBox error={error} /></div>;
  if (!data) return <PageLoader />;
  const { payment: p, gym } = data;
  const text = `${gym.name} receipt ${p.receipt_no}: ${money(p.amount)} paid on ${date(p.paid_on)}${p.end_date ? `, valid till ${date(p.end_date)}` : ''}.`;
  return (
    <div className="min-h-dvh bg-paper dark:bg-ink-900 px-4 py-6">
      <div className="max-w-md mx-auto">
        <button className="btn btn-ghost -ml-3 mb-3 no-print" onClick={() => nav(-1)}><ArrowLeft className="w-4 h-4" />Back</button>
        <div className="bg-white text-ink-900 rounded-4xl shadow-card overflow-hidden">
          <div className="bg-ink-900 text-white p-6 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-lime text-ink-900 flex items-center justify-center"><Dumbbell className="w-6 h-6" /></div>
            <div><p className="font-display font-bold text-lg">{gym.name}</p><p className="text-xs text-ink-300">{gym.address}</p></div>
          </div>
          <div className="p-6">
            <div className="flex justify-between"><div><p className="text-xs text-ink-400 font-semibold uppercase">Receipt</p><p className="font-mono font-bold">{p.receipt_no}</p></div><p className="text-sm text-ink-400">{date(p.paid_on)}</p></div>
            <div className="my-6 text-center py-6 rounded-3xl bg-lime/25"><p className="text-xs text-ink-500 font-semibold">Paid</p><p className="font-display text-4xl font-bold">{money(p.amount)}</p><p className="text-xs text-ink-500 uppercase mt-1">{p.mode}{p.reference ? ` · ${p.reference}` : ''}</p></div>
            <dl className="text-sm space-y-2.5">
              {[['Member', p.name], ['Member ID', p.essl_id], ['For', `${p.category ?? 'Membership'}${p.duration_label ? ` · ${p.duration_label}` : ''}`], ['Valid', p.start_date ? `${date(p.start_date)} → ${date(p.end_date)}` : '—']].map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-dashed border-ink-100 pb-2"><dt className="text-ink-400">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>
              ))}
            </dl>
          </div>
        </div>
        {'share' in navigator && <button className="btn btn-dark w-full mt-4 no-print" onClick={() => navigator.share({ title: 'Receipt', text }).catch(() => undefined)}><Share2 className="w-4 h-4" />Share</button>}
      </div>
    </div>
  );
}
