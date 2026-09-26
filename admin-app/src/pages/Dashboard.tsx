import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, ArrowUpRight, CalendarCheck2, Cpu, IndianRupee, Phone, Plus, UserPlus, Users, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { ago, date, daysLeftLabel, money, moneyShort, monthLabel, waLink } from '../lib/format';
import { ErrorBox, PageLoader, Ring, SectionTitle, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useSession } from '../lib/session';

interface Dash {
  today: string;
  members: Record<string, number>;
  money: { today: number; month: number; year: number; all_time: number; renewals_month: number };
  pending_claims: { n: number; total: number };
  months: { ym: string; new_members: number; renewals: number; payments: number; revenue: number }[];
  due_soon: { id: number; name: string; essl_id: string; mobile: string; end_date: string; days_left: number; category: string; duration_label: string; price: number }[];
  attendance: { today: number; last14: { day: string; visitors: number }[]; hourly: { hour: string; n: number }[]; expired_but_entered: { member_id: number; name: string; essl_id: string }[] };
  recent_payments: { id: number; amount: number; mode: string; paid_on: string; name: string; member_id: number; receipt_no: string }[];
  followups_due: number;
  device: { sn?: string; last_seen_at?: string; last_seen_via?: string; user_count?: number; queue?: { pending: number; failed: number }; agent?: { last_seen_at: string } };
}

const tooltipStyle = { background: '#0E0F11', border: '1px solid #2A2E33', borderRadius: 14, color: '#fff', fontSize: 12 };

function Kpi({ label, value, sub, tone, to }: { label: string; value: string | number; sub?: string; tone?: 'lime' | 'warn' | 'bad' | 'info'; to?: string }) {
  const dot = { lime: 'bg-lime', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info' }[tone ?? 'lime'];
  const body = (
    <div className="card card-pad h-full hover:border-ink-300 dark:hover:border-ink-500 transition">
      <div className="flex items-center gap-2 text-xs font-semibold muted"><span className={`w-2 h-2 rounded-full ${dot}`} />{label}</div>
      <p className="kpi mt-3">{value}</p>
      {sub && <p className="text-xs muted mt-2">{sub}</p>}
    </div>
  );
  return to ? <Link to={to} className="block">{body}</Link> : body;
}

export default function Dashboard() {
  const { session } = useSession();
  const { data: d, error, reload } = useLoad(() => api.get<Dash>('/dashboard'));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return <PageLoader />;

  const m = d.members;
  const paying = m.active + m.near_expiry + m.expiring;
  const activePct = m.total ? Math.round((paying / Math.max(1, m.total - m.staff)) * 100) : 0;
  const deviceOnline = d.device.last_seen_at && Date.now() - new Date(d.device.last_seen_at).getTime() < 10 * 60_000;
  const agentOnline = d.device.agent?.last_seen_at && Date.now() - new Date(d.device.agent.last_seen_at).getTime() < 5 * 60_000;
  const hour = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 13));
  const greet = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <>
      <PageHeader title={`${greet}, ${session?.name.split(' ')[0]}`} subtitle={date(d.today)}
        actions={<>
          <Link to="/members?new=1" className="btn btn-primary"><UserPlus className="w-4 h-4" />Add member</Link>
          <Link to="/payments?new=1" className="btn btn-outline"><Plus className="w-4 h-4" />Payment</Link>
        </>} />

      {/* Hero row — dark card with ring like the reference "Health Grade" */}
      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <div className="card-ink p-5 lg:col-span-2 flex flex-col sm:flex-row gap-5 sm:items-center relative overflow-hidden isolate">
          <div className="absolute -right-20 -top-20 w-64 h-64 rounded-full bg-lime/10 -z-10 pointer-events-none" />
          <Ring value={activePct} size={112} stroke={11}>
            <div><p className="font-display text-2xl font-bold text-white">{activePct}%</p><p className="text-[10px] text-ink-300 -mt-0.5">active</p></div>
          </Ring>
          <div className="flex-1 relative">
            <p className="text-ink-300 text-sm">Paying members</p>
            <p className="font-display text-4xl font-bold text-white mt-1">{paying}<span className="text-ink-400 text-xl font-semibold"> / {m.total - m.staff}</span></p>
            <div className="flex flex-wrap gap-2 mt-4">
              <span className="badge bg-lime text-ink-900">{m.new_this_month} new this month</span>
              <span className="badge bg-white/10 text-white">{d.money.renewals_month} renewals</span>
              <span className="badge bg-white/10 text-white">{m.male} M · {m.female} F</span>
            </div>
          </div>
          <div className="relative grid grid-cols-2 sm:grid-cols-1 gap-3 sm:w-44">
            <div className="rounded-2xl bg-ink-800 border border-white/5 p-3">
              <p className="text-[11px] text-ink-300 flex items-center gap-1"><CalendarCheck2 className="w-3.5 h-3.5" />In today</p>
              <p className="font-display text-2xl font-bold text-lime">{d.attendance.today}</p>
            </div>
            <div className="rounded-2xl bg-ink-800 border border-white/5 p-3">
              <p className="text-[11px] text-ink-300 flex items-center gap-1"><IndianRupee className="w-3.5 h-3.5" />Collected today</p>
              <p className="font-display text-2xl font-bold text-white">{moneyShort(d.money.today)}</p>
            </div>
          </div>
        </div>

        <Link to="/device" className="card card-pad flex flex-col justify-between hover:border-ink-300 dark:hover:border-ink-500 transition">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold"><Cpu className="w-5 h-5" />Door device</div>
            <ArrowUpRight className="w-4 h-4 muted" />
          </div>
          <div className="mt-4 space-y-2.5 text-sm">
            <div className="flex justify-between"><span className="muted">eSSL X990</span>
              <span className={`badge ${deviceOnline ? 'bg-ok/15 text-green-700 dark:text-ok' : 'bg-bad/15 text-red-700 dark:text-bad'}`}>{deviceOnline ? `Online · ${d.device.last_seen_via}` : 'Offline'}</span></div>
            <div className="flex justify-between"><span className="muted">PC agent</span>
              <span className={`badge ${agentOnline ? 'bg-ok/15 text-green-700 dark:text-ok' : 'bg-ink-300/20 muted'}`}>{agentOnline ? 'Online' : `Last ${ago(d.device.agent?.last_seen_at)}`}</span></div>
            <div className="flex justify-between"><span className="muted">Queued commands</span><span className="font-semibold">{d.device.queue?.pending ?? 0}</span></div>
            <div className="flex justify-between"><span className="muted">Out of sync members</span><span className={`font-semibold ${m.device_unsynced ? 'text-warn' : ''}`}>{m.device_unsynced}</span></div>
          </div>
        </Link>
      </div>

      {d.attendance.expired_but_entered.length > 0 && (
        <div className="card card-pad mb-4 border-bad/40 dark:border-bad/40 flex gap-3 items-start">
          <AlertTriangle className="w-5 h-5 text-bad shrink-0 mt-0.5" />
          <div className="text-sm">
            <p className="font-semibold">Expired members entered today</p>
            <p className="muted mt-1">{d.attendance.expired_but_entered.map((x, i) => (
              <span key={x.member_id}>{i > 0 && ', '}<Link className="underline underline-offset-2" to={`/members/${x.member_id}`}>{x.name} ({x.essl_id})</Link></span>
            ))}. Turn on automatic blocking on the Device page to stop this.</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-6 gap-3 sm:gap-4 mb-6">
        <Kpi label="Total members" value={m.total} sub={`${m.staff} staff`} to="/members" />
        <Kpi label="Expiring ≤7 days" value={m.expiring} tone="warn" sub="call today" to="/renewals" />
        <Kpi label="Near expiry" value={m.near_expiry} tone="info" sub="8–30 days" to="/members?status=near_expiry" />
        <Kpi label="Expired" value={m.expired} tone="bad" sub="win-back list" to="/members?status=expired" />
        <Kpi label="This month" value={moneyShort(d.money.month)} sub={`${moneyShort(d.money.year)} this year`} to="/payments" />
        <Kpi label="Pending dues" value={moneyShort(m.dues_total)} tone="warn" sub={`${m.with_dues} members`} to="/members?status=dues" />
      </div>

      <div className="grid gap-4 lg:grid-cols-5 mb-6">
        <div className="card card-pad lg:col-span-3">
          <SectionTitle title="Revenue — last 12 months" action={<span className="text-sm font-semibold">{money(d.months.reduce((s, x) => s + x.revenue, 0))}</span>} />
          <div className="h-64 -ml-3">
            <ResponsiveContainer>
              <BarChart data={d.months.map((x) => ({ ...x, label: monthLabel(x.ym) }))}>
                <CartesianGrid vertical={false} strokeOpacity={0.12} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} tick={{ fill: '#9BA1A6' }} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={48} tick={{ fill: '#9BA1A6' }} tickFormatter={(v) => moneyShort(v)} />
                <Tooltip cursor={{ fill: 'rgba(200,241,53,.08)' }} contentStyle={tooltipStyle} formatter={(v) => [money(Number(v)), 'Revenue']} />
                <Bar dataKey="revenue" fill="#C8F135" radius={[8, 8, 3, 3]} maxBarSize={36} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="card card-pad lg:col-span-2">
          <SectionTitle title="Visitors — last 14 days" action={<Link to="/attendance" className="text-xs font-semibold muted hover:underline">Details</Link>} />
          <div className="h-64 -ml-3">
            <ResponsiveContainer>
              <BarChart data={d.attendance.last14.map((x) => ({ ...x, label: date(x.day, false) }))}>
                <CartesianGrid vertical={false} strokeOpacity={0.12} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={10} interval={1} tick={{ fill: '#9BA1A6' }} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} width={32} tick={{ fill: '#9BA1A6' }} />
                <Tooltip cursor={{ fill: 'rgba(200,241,53,.08)' }} contentStyle={tooltipStyle} formatter={(v) => [Number(v), 'Visitors']} />
                <Bar dataKey="visitors" fill="#5D6268" radius={[8, 8, 3, 3]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="card card-pad">
          <SectionTitle title="Renewals due" action={<Link to="/renewals" className="text-xs font-semibold muted hover:underline">All {m.expiring + m.near_expiry}</Link>} />
          {d.due_soon.length === 0 ? <p className="muted text-sm py-6 text-center">Nobody is due in the next 30 days.</p> : (
            <ul className="-mx-1">
              {d.due_soon.map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-1 py-2.5 border-t first:border-t-0 border-paper-line dark:border-ink-700">
                  <div className={`w-12 text-center rounded-2xl py-1.5 ${x.days_left <= 3 ? 'bg-bad/15 text-bad' : x.days_left <= 7 ? 'bg-warn/15 text-warn' : 'bg-black/5 dark:bg-white/5'}`}>
                    <p className="font-display font-bold leading-none">{x.days_left}</p><p className="text-[9px] font-semibold uppercase">days</p>
                  </div>
                  <Link to={`/members/${x.id}`} className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{x.name} <span className="muted font-normal">#{x.essl_id}</span></p>
                    <p className="text-xs muted truncate">{x.category} · {x.duration_label} · ends {date(x.end_date, false)}</p>
                  </Link>
                  {x.mobile && <a href={`tel:${x.mobile}`} className="icon-btn" aria-label="Call"><Phone className="w-4 h-4" /></a>}
                  {x.mobile && <a href={waLink(x.mobile, `Hi ${x.name}, your Challenge Gym membership ${daysLeftLabel(x.days_left).toLowerCase()} (${date(x.end_date)}). Renew at the front desk or pay by UPI in the member app.`)}
                    target="_blank" rel="noreferrer" className="btn btn-sm bg-[#25D366]/15 text-green-700 dark:text-[#25D366]">WhatsApp</a>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="card card-pad">
          <SectionTitle title="Recent payments" action={
            d.pending_claims.n > 0
              ? <Link to="/payments?tab=pending" className="badge bg-warn/15 text-amber-700 dark:text-warn">{d.pending_claims.n} UPI to verify</Link>
              : <Link to="/payments" className="text-xs font-semibold muted hover:underline">Ledger</Link>} />
          {d.recent_payments.length === 0 ? <p className="muted text-sm py-6 text-center">No payments recorded yet.</p> : (
            <ul>
              {d.recent_payments.map((p) => (
                <li key={p.id} className="flex items-center gap-3 py-2.5 border-t first:border-t-0 border-paper-line dark:border-ink-700">
                  <div className="w-9 h-9 rounded-full bg-lime/20 text-lime-700 dark:text-lime flex items-center justify-center"><Wallet className="w-4 h-4" /></div>
                  <Link to={`/members/${p.member_id}`} className="flex-1 min-w-0">
                    <p className="font-semibold truncate">{p.name}</p>
                    <p className="text-xs muted">{date(p.paid_on)} · {p.mode.toUpperCase()}{p.receipt_no ? ` · ${p.receipt_no}` : ''}</p>
                  </Link>
                  <p className="font-display font-bold">{money(p.amount)}</p>
                </li>
              ))}
            </ul>
          )}
          {d.followups_due > 0 && (
            <Link to="/renewals" className="mt-3 flex items-center gap-2 text-sm rounded-2xl bg-black/5 dark:bg-white/5 px-4 py-3">
              <Users className="w-4 h-4" />{d.followups_due} follow-up call{d.followups_due === 1 ? '' : 's'} scheduled for today
            </Link>
          )}
        </div>
      </div>
    </>
  );
}
