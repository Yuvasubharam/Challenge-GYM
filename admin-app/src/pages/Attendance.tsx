import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CalendarCheck2, ChevronLeft, ChevronRight, Download, Plus } from 'lucide-react';
import { api, qs } from '../lib/api';
import { date, time, todayLocal, waLink } from '../lib/format';
import { Empty, ErrorBox, Field, Modal, PageLoader, SectionTitle, useAction, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { MemberPicker } from './Payments';
import type { MemberSummary } from '../lib/types';

interface Day { date: string; visitors: number; rows: { essl_id: string; member_id: number | null; name: string | null; is_staff: number; first_in: string; last_punch: string; punches: number; end_date: string | null }[] }
interface Report { daily: { day: string; visitors: number }[]; top: { id: number; name: string; essl_id: string; days: number }[]; inactive_active_members: { id: number; name: string; essl_id: string; mobile: string; last_visit: string | null }[] }

const shift = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

export default function Attendance() {
  const [day, setDay] = useState(todayLocal());
  const { data, error, reload } = useLoad(() => api.get<Day>(`/attendance${qs({ date: day })}`), [day]);
  const { data: rep } = useLoad(() => api.get<Report>('/attendance/report'));
  const [picker, setPicker] = useState(false);
  const [manual, setManual] = useState<MemberSummary | null>(null);
  const [mtime, setMtime] = useState('');
  const { busy, run } = useAction();
  const isToday = day === todayLocal();

  return (
    <>
      <PageHeader title="Attendance" subtitle="From the X990 in real time (cloud) or via the gym PC agent."
        actions={<>
          <a className="btn btn-outline" href="/api/export/attendance.csv"><Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span></a>
          <button className="btn btn-primary" onClick={() => setPicker(true)}><Plus className="w-4 h-4" />Manual entry</button>
        </>} />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <div className="card-ink p-4 flex items-center gap-3">
            <button className="icon-btn text-white" onClick={() => setDay(shift(day, -1))} aria-label="Previous day"><ChevronLeft className="w-5 h-5" /></button>
            <div className="flex-1 text-center">
              <p className="text-ink-300 text-xs">{isToday ? 'Today' : 'Day'}</p>
              <input type="date" className="bg-transparent text-white font-display font-bold text-lg text-center outline-none" value={day} max={todayLocal()} onChange={(e) => e.target.value && setDay(e.target.value)} />
            </div>
            <div className="text-right pr-2"><p className="font-display text-3xl font-bold text-lime">{data?.visitors ?? '–'}</p><p className="text-[10px] text-ink-300">visitors</p></div>
            <button className="icon-btn text-white disabled:opacity-30" disabled={isToday} onClick={() => setDay(shift(day, 1))} aria-label="Next day"><ChevronRight className="w-5 h-5" /></button>
          </div>

          {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <PageLoader /> : data.rows.length === 0 ? (
            <div className="card"><Empty icon={<CalendarCheck2 className="w-6 h-6" />} title="No check-ins" hint={isToday ? 'Punches appear here seconds after a member scans.' : undefined} /></div>
          ) : (
            <div className="card overflow-hidden">
              <table className="table">
                <thead><tr><th>Member</th><th>In</th><th className="hidden sm:table-cell">Last punch</th><th>Plan</th></tr></thead>
                <tbody>
                  {data.rows.map((r) => {
                    const expired = !r.is_staff && !!r.member_id && (!r.end_date || r.end_date < day);
                    return (
                      <tr key={r.essl_id}>
                        <td>{r.member_id ? <Link className="font-semibold hover:underline" to={`/members/${r.member_id}`}>{r.name}</Link>
                          : r.name ? <span className="font-semibold" title="On the device but not a member in the app">{r.name}</span>
                          : <span className="text-warn">Unknown ID</span>}
                          <span className="text-xs muted ml-1.5">#{r.essl_id}</span></td>
                        <td className="whitespace-nowrap">{time(r.first_in)}</td>
                        <td className="whitespace-nowrap hidden sm:table-cell muted">{r.punches > 1 ? time(r.last_punch) : '—'}</td>
                        <td>{r.is_staff ? <span className="badge bg-lime/20 text-lime-800 dark:text-lime">staff</span>
                          : expired ? <span className="badge bg-bad/15 text-red-700 dark:text-bad">expired</span>
                          : !r.member_id ? <span className="badge bg-warn/15 text-amber-700 dark:text-warn">not a member</span>
                          : <span className="text-xs muted">till {date(r.end_date, false)}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="card card-pad">
            <SectionTitle title="Last 30 days" />
            <div className="h-44 -ml-3">
              <ResponsiveContainer>
                <BarChart data={(rep?.daily ?? []).map((d) => ({ ...d, label: date(d.day, false) }))}>
                  <CartesianGrid vertical={false} strokeOpacity={0.12} />
                  <XAxis dataKey="label" hide />
                  <YAxis tickLine={false} axisLine={false} fontSize={11} width={30} tick={{ fill: '#9BA1A6' }} />
                  <Tooltip cursor={{ fill: 'rgba(200,241,53,.08)' }} contentStyle={{ background: '#0E0F11', border: '1px solid #2A2E33', borderRadius: 14, color: '#fff', fontSize: 12 }} formatter={(v) => [Number(v), 'Visitors']} />
                  <Bar dataKey="visitors" fill="#C8F135" radius={[6, 6, 2, 2]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
          <div className="card card-pad">
            <SectionTitle title="Most regular (30d)" />
            <ol className="space-y-2 text-sm">
              {(rep?.top ?? []).slice(0, 8).map((t, i) => (
                <li key={t.id} className="flex items-center gap-3"><span className="w-5 text-xs muted">{i + 1}</span>
                  <Link to={`/members/${t.id}`} className="flex-1 truncate hover:underline">{t.name}</Link><span className="font-semibold">{t.days}d</span></li>
              ))}
            </ol>
          </div>
          <div className="card card-pad">
            <SectionTitle title="Paid but not coming (10d+)" />
            <p className="text-xs muted -mt-2 mb-3">A friendly nudge keeps them renewing.</p>
            <ul className="space-y-2 text-sm">
              {(rep?.inactive_active_members ?? []).slice(0, 10).map((m) => (
                <li key={m.id} className="flex items-center gap-2">
                  <Link to={`/members/${m.id}`} className="flex-1 truncate hover:underline">{m.name}</Link>
                  <span className="text-xs muted">{m.last_visit ? date(m.last_visit, false) : 'never'}</span>
                  {m.mobile && <a className="text-xs font-semibold text-green-700 dark:text-[#25D366]" target="_blank" rel="noreferrer" href={waLink(m.mobile, `Hi ${m.name}, we miss you at Challenge Gym! 💪 See you this week?`)}>Nudge</a>}
                </li>
              ))}
              {rep && rep.inactive_active_members.length === 0 && <li className="muted text-xs">Everyone is showing up. 🎉</li>}
            </ul>
          </div>
        </div>
      </div>

      <MemberPicker open={picker} onClose={() => setPicker(false)} onPick={(m) => { setPicker(false); setMtime(''); setManual(m); }} />
      <Modal open={!!manual} onClose={() => setManual(null)} title={`Manual check-in — ${manual?.name ?? ''}`}
        footer={<><button className="btn btn-outline" onClick={() => setManual(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post('/attendance/manual', { member_id: manual!.id, date: day, time: mtime || undefined }), 'Check-in added').then(() => { setManual(null); void reload(); })}>Add</button></>}>
        <p className="text-sm muted mb-3">For when the scanner was down or a finger didn't read. Logged in the audit trail.</p>
        <Field label={`Time on ${date(day)}`} hint="Leave empty for now"><input type="time" className="input" value={mtime} onChange={(e) => setMtime(e.target.value)} /></Field>
      </Modal>
    </>
  );
}
