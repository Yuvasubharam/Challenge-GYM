// Public receipt page (no login): https://challengegym.in/r/<token> — the link the desk sends into the
// member's WhatsApp chat together with the receipt message.
import { useEffect, useState } from 'react';
import { Dumbbell, Printer, Smartphone } from 'lucide-react';
import { date, money } from '../lib/format';
import { PageLoader } from '../components/ui';

interface R {
  payment: { amount: number; mode: string; paid_on: string; receipt_no: string; reference: string | null; entry_type: string; status: string;
    name: string; essl_id: string; category: string | null; duration_label: string | null; start_date: string | null; end_date: string | null };
  gym: { name: string; phone: string; address: string };
}

export default function PublicReceipt({ token }: { token: string }) {
  const [data, setData] = useState<R | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    fetch(`/api/r/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() as Promise<R> : Promise.reject(new Error(String(r.status)))))
      .then((d) => { setData(d); document.title = `Receipt ${d.payment.receipt_no} · ${d.gym.name}`; })
      .catch(() => setMissing(true));
  }, [token]);

  if (missing) {
    return (
      <div className="min-h-dvh bg-paper dark:bg-ink-900 flex items-center justify-center p-6 text-center">
        <div><p className="font-display text-xl font-bold">Receipt not found</p><p className="text-sm muted mt-2">The link may be incomplete. Ask the gym desk to send it again.</p></div>
      </div>
    );
  }
  if (!data) return <PageLoader />;
  const { payment: p, gym } = data;
  const plan = `${p.category ?? 'Membership'}${p.duration_label ? ` · ${p.duration_label}` : ''}`;
  const rows: [string, string][] = [
    ['Member', p.name], ['Member ID', p.essl_id], ['For', `${plan} (${p.entry_type})`], ['Valid', p.start_date ? `${date(p.start_date)} → ${date(p.end_date)}` : '—'],
  ];
  return (
    <div className="min-h-dvh bg-paper dark:bg-ink-900 px-4 py-6">
      <div className="max-w-md mx-auto">
        <div className="bg-white text-ink-900 rounded-4xl shadow-card overflow-hidden print:shadow-none">
          <div className="bg-ink-900 text-white p-6 flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-lime text-ink-900 flex items-center justify-center"><Dumbbell className="w-6 h-6" /></div>
            <div><p className="font-display font-bold text-lg">{gym.name}</p><p className="text-xs text-ink-300">{gym.address}{gym.phone ? ` · ${gym.phone}` : ''}</p></div>
          </div>
          <div className="p-6">
            <div className="flex justify-between">
              <div><p className="text-xs text-ink-400 font-semibold uppercase tracking-wide">Payment receipt</p><p className="font-mono font-bold mt-1">{p.receipt_no}</p></div>
              <p className="text-sm text-ink-400">{date(p.paid_on)}</p>
            </div>
            <div className="my-6 text-center py-6 rounded-3xl bg-lime/25">
              <p className="text-xs text-ink-500 font-semibold">Amount received</p>
              <p className="font-display text-4xl font-bold mt-1">{money(p.amount)}</p>
              <p className="text-xs text-ink-500 uppercase mt-1">{p.mode}{p.reference ? ` · ${p.reference}` : ''}</p>
            </div>
            <dl className="text-sm space-y-2.5">
              {rows.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4 border-b border-dashed border-ink-100 pb-2"><dt className="text-ink-400">{k}</dt><dd className="font-semibold text-right">{v}</dd></div>
              ))}
            </dl>
            {p.status !== 'confirmed' && <p className="mt-4 text-center text-bad font-bold uppercase">Void — this receipt was cancelled</p>}
            <p className="text-center text-xs text-ink-400 mt-6">Thank you for training with us 💪</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 mt-4 no-print">
          <button className="btn btn-dark" onClick={() => window.print()}><Printer className="w-4 h-4" />Print / save PDF</button>
          <a className="btn btn-outline" href="/"><Smartphone className="w-4 h-4" />Open the app</a>
        </div>
      </div>
    </div>
  );
}
