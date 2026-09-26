import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Fingerprint } from 'lucide-react';
import { api } from '../lib/api';
import { date, monthLabel, time, todayLocal } from '../lib/format';
import { ErrorBox, PageLoader, useLoad } from '../components/ui';

interface Att { month: string; days: { day: string; first_in: string; last_out: string; punches: number }[]; monthly: { ym: string; n: number }[] }

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return d.toISOString().slice(0, 7);
};
const DOW = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export default function Visits() {
  const today = todayLocal();
  const [month, setMonth] = useState(today.slice(0, 7));
  const { data, error, reload } = useLoad(() => api.get<Att>(`/me/attendance?month=${month}`), [month]);

  const cells = useMemo(() => {
    const [y, m] = month.split('-').map(Number);
    const first = new Date(Date.UTC(y, m - 1, 1));
    const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const lead = (first.getUTCDay() + 6) % 7;
    return [...Array(lead).fill(null), ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)];
  }, [month]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const visited = new Set(data?.days.map((d) => d.day));
  const max = Math.max(1, ...(data?.monthly.map((x) => x.n) ?? [1]));

  return (
    <div className="space-y-4">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">Visits</h1>

      <section className="card-ink p-5">
        <div className="flex items-center justify-between mb-4">
          <button className="icon-btn text-white" onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month"><ChevronLeft className="w-5 h-5" /></button>
          <div className="text-center">
            <p className="font-display font-bold text-white text-lg">{monthLabel(month).replace(' ', " '")}</p>
            <p className="text-xs text-ink-300">{data ? `${data.days.length} visit${data.days.length === 1 ? '' : 's'}` : '…'}</p>
          </div>
          <button className="icon-btn text-white disabled:opacity-30" disabled={month >= today.slice(0, 7)} onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month"><ChevronRight className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-7 gap-1.5 text-center">
          {DOW.map((d, i) => <div key={i} className="text-[11px] text-ink-400 font-semibold pb-1">{d}</div>)}
          {cells.map((c, i) => c === null ? <div key={`x${i}`} /> : (
            <div key={c} title={date(c)}
              className={`aspect-square rounded-xl flex items-center justify-center text-sm font-semibold
                ${visited.has(c) ? 'bg-lime text-ink-900' : c > today ? 'text-ink-600' : 'bg-white/5 text-ink-300'}
                ${c === today ? 'ring-2 ring-white/70' : ''}`}>
              {Number(c.slice(8))}
            </div>
          ))}
        </div>
      </section>

      <section className="card overflow-hidden">
        <p className="font-semibold px-4 pt-4 pb-2">Check-ins</p>
        {!data ? <PageLoader /> : data.days.length === 0 ? <p className="px-4 pb-6 text-sm muted">No visits this month.</p> : (
          <ul>
            {data.days.map((d) => (
              <li key={d.day} className="flex items-center gap-3 px-4 py-3 border-t border-paper-line dark:border-ink-700">
                <div className="w-10 h-10 rounded-2xl bg-lime/15 text-lime-700 dark:text-lime flex items-center justify-center"><Fingerprint className="w-5 h-5" /></div>
                <div className="flex-1"><p className="font-semibold">{date(d.day, false)}</p><p className="text-xs muted">{new Date(d.day + 'T00:00:00Z').toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'UTC' })}</p></div>
                <p className="text-sm text-right">{time(d.first_in)}{d.punches > 1 && <span className="block text-xs muted">to {time(d.last_out)}</span>}</p>
              </li>
            ))}
          </ul>
        )}
      </section>

      {data && data.monthly.length > 0 && (
        <section className="card card-pad">
          <p className="font-semibold mb-4">Last 12 months</p>
          <div className="flex items-end gap-1.5 h-32">
            {data.monthly.map((x) => (
              <button key={x.ym} onClick={() => setMonth(x.ym)} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group" title={`${monthLabel(x.ym)}: ${x.n} visits`}>
                <span className="text-[10px] muted opacity-0 group-hover:opacity-100">{x.n}</span>
                <div className={`w-full rounded-t-lg ${x.ym === month ? 'bg-lime' : 'bg-ink-300/40 dark:bg-ink-600'}`} style={{ height: `${(x.n / max) * 100}%`, minHeight: 4 }} />
                <span className="text-[10px] muted">{monthLabel(x.ym).slice(0, 3)}</span>
              </button>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
