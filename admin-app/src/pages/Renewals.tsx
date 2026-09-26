import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BellRing, MessageCircle, Phone, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';
import { date, daysLeftLabel, money, todayLocal, waLink } from '../lib/format';
import type { MemberSummary } from '../lib/types';
import { Avatar, Empty, ErrorBox, Field, Modal, PageLoader, Segmented, StatusBadge, useAction, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { RenewModal } from '../components/MemberForms';

type Row = MemberSummary & { last_followup: { call_date: string; status: string; remarks: string; next_date: string | null } | null };
type Tab = 'today' | 'week' | 'month' | 'lapsed';

export default function Renewals() {
  const { data, error, reload } = useLoad(() => api.get<{ members: Row[] }>('/renewals'));
  const [tab, setTab] = useState<Tab>('today');
  const [renew, setRenew] = useState<Row | null>(null);
  const [log, setLog] = useState<Row | null>(null);

  const buckets = useMemo(() => {
    const rows = data?.members ?? [];
    const today = todayLocal();
    const callToday = (r: Row) => r.last_followup?.next_date ? r.last_followup.next_date <= today : true;
    return {
      today: rows.filter((r) => (r.days_left ?? 99) >= -7 && (r.days_left ?? 99) <= 3 && callToday(r) && r.last_followup?.status !== 'lost'),
      week: rows.filter((r) => (r.days_left ?? -1) >= 0 && (r.days_left ?? 99) <= 7),
      month: rows.filter((r) => (r.days_left ?? -1) > 7),
      lapsed: rows.filter((r) => (r.days_left ?? 0) < 0),
    };
  }, [data]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const list = buckets[tab];

  return (
    <>
      <PageHeader title="Renewals" subtitle="Call, remind and renew — expired members are blocked at the door automatically once enforcement is on." />
      <div className="mb-5">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: 'today', label: 'Call today', count: buckets.today.length },
          { value: 'week', label: 'This week', count: buckets.week.length },
          { value: 'month', label: '8–30 days', count: buckets.month.length },
          { value: 'lapsed', label: 'Lapsed (60d)', count: buckets.lapsed.length },
        ]} />
      </div>

      {list.length === 0 ? <div className="card"><Empty icon={<BellRing className="w-6 h-6" />} title="All caught up" hint="No one in this list right now." /></div> : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((r) => {
            const msg = `Hi ${r.name}, this is Challenge Gym 💪 Your ${r.category ?? ''} membership ${r.days_left !== null && r.days_left < 0 ? `ended on ${date(r.end_date)}` : `ends on ${date(r.end_date)}`}. Renew at the front desk or pay by UPI in the member app to keep your door access active.`;
            return (
              <div key={r.id} className="card card-pad flex flex-col">
                <div className="flex items-start gap-3">
                  <Avatar name={r.name} photo={r.photo_key} size={44} />
                  <Link to={`/members/${r.id}`} className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{r.name} <span className="muted font-normal text-sm">#{r.essl_id}</span></p>
                    <p className="text-xs muted">{r.category} · {r.duration_label} · {money(r.price)}</p>
                  </Link>
                  <StatusBadge status={r.status} />
                </div>
                <div className="flex items-center justify-between mt-3 text-sm">
                  <span className={`font-semibold ${(r.days_left ?? 0) < 0 ? 'text-bad' : (r.days_left ?? 0) <= 7 ? 'text-warn' : ''}`}>{daysLeftLabel(r.days_left)}</span>
                  <span className="muted text-xs">ends {date(r.end_date)}</span>
                </div>
                {r.last_followup && (
                  <p className="text-xs muted mt-2 rounded-2xl bg-black/[.03] dark:bg-white/[.04] px-3 py-2">
                    Last call {date(r.last_followup.call_date, false)}: {r.last_followup.remarks || r.last_followup.status}{r.last_followup.next_date ? ` · next ${date(r.last_followup.next_date, false)}` : ''}
                  </p>
                )}
                <div className="flex flex-wrap gap-2 mt-4 pt-3 border-t border-paper-line dark:border-ink-700">
                  {r.mobile && <a href={`tel:${r.mobile}`} className="btn btn-outline btn-sm" onClick={() => setTimeout(() => setLog(r), 800)}><Phone className="w-3.5 h-3.5" />Call</a>}
                  {r.mobile && <a href={waLink(r.mobile, msg)} target="_blank" rel="noreferrer" className="btn btn-sm bg-[#25D366]/15 text-green-700 dark:text-[#25D366]"><MessageCircle className="w-3.5 h-3.5" />WhatsApp</a>}
                  <button className="btn btn-ghost btn-sm" onClick={() => setLog(r)}>Log</button>
                  <button className="btn btn-primary btn-sm ml-auto" onClick={() => setRenew(r)}><RefreshCw className="w-3.5 h-3.5" />Renew</button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {renew && <RenewModal open onClose={() => setRenew(null)} onDone={() => { setRenew(null); void reload(); }} memberId={renew.id} currentEnd={renew.end_date} name={renew.name} />}
      {log && <QuickLog row={log} onClose={() => setLog(null)} onDone={() => { setLog(null); void reload(); }} />}
    </>
  );
}

const OUTCOMES = [
  { status: 'open', remarks: 'Not answered', next: 1 },
  { status: 'open', remarks: 'Busy / call later', next: 1 },
  { status: 'converted', remarks: 'Will renew', next: 2 },
  { status: 'open', remarks: 'Out of town', next: 7 },
  { status: 'lost', remarks: 'Discontinued', next: 0 },
  { status: 'lost', remarks: 'Changed gym', next: 0 },
];

function QuickLog({ row, onClose, onDone }: { row: Row; onClose: () => void; onDone: () => void }) {
  const { busy, run } = useAction();
  const [note, setNote] = useState('');
  const save = (o: (typeof OUTCOMES)[number]) => {
    const next = o.next ? new Date(Date.parse(todayLocal()) + o.next * 86400000).toISOString().slice(0, 10) : undefined;
    return run(() => api.post('/followups', { member_id: row.id, call_date: todayLocal(), status: o.status, remarks: note ? `${o.remarks} — ${note}` : o.remarks, next_date: next, priority: (row.days_left ?? 0) <= 3 ? 'high' : 'medium' }), 'Logged').then((r) => r && onDone());
  };
  return (
    <Modal open onClose={onClose} title={`Call outcome — ${row.name}`}>
      <Field label="Note (optional)"><input className="input mb-4" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-2">
        {OUTCOMES.map((o) => <button key={o.remarks} disabled={busy} className={`btn h-12 ${o.status === 'converted' ? 'btn-primary' : o.status === 'lost' ? 'btn-danger' : 'btn-outline'}`} onClick={() => save(o)}>{o.remarks}</button>)}
      </div>
    </Modal>
  );
}
