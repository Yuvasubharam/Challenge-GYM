import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Search, ShieldAlert, Smartphone, UserPlus, Users } from 'lucide-react';
import { api, qs } from '../lib/api';
import { ago, date, daysLeftLabel, money } from '../lib/format';
import type { MemberSummary } from '../lib/types';
import { Empty, ErrorBox, PageLoader, Segmented, StatusBadge, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { AddMemberModal } from '../components/MemberForms';
import { EditableAvatar } from '../components/PhotoCapture';
import { useSession } from '../lib/session';

const FILTERS = [
  { value: '', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring_all', label: 'Expiring ≤30d' },
  { value: 'expired', label: 'Expired' },
  { value: 'dues', label: 'Dues' },
  { value: 'frozen', label: 'Frozen' },
  { value: 'none', label: 'No plan' },
  { value: 'staff', label: 'Staff' },
  { value: 'unsynced', label: 'Device out of sync' },
  { value: 'app_users', label: 'App users' },
  { value: 'app_off', label: 'App off' },
  { value: 'no_consent', label: 'No consent' },
];

// Phone icon for members with a member-app account; tooltip says when they last signed in.
const AppBadge = ({ m }: { m: MemberSummary }) => !m.app_user ? null : (
  <span title={m.app_last_login ? `Member app · last login ${ago(m.app_last_login)}` : 'Member app account · never logged in'}>
    <Smartphone className={`w-3.5 h-3.5 shrink-0 ${m.app_last_login ? 'text-lime-700 dark:text-lime' : 'muted'}`} />
  </span>
);

const PAGE = 60;

export default function Members() {
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const { can } = useSession();
  const status = params.get('status') ?? '';
  const sort = params.get('sort') ?? 'name';
  const [q, setQ] = useState(params.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [limit, setLimit] = useState(PAGE);
  const [adding, setAdding] = useState(params.get('new') === '1');

  useEffect(() => { const t = setTimeout(() => setDebounced(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => setLimit(PAGE), [debounced, status, sort]);

  // Load everything once per filter; search runs locally for instant results at gym scale.
  const { data, error, reload, setData } = useLoad(() => api.get<{ total: number; members: MemberSummary[] }>(`/members${qs({ status, sort })}`), [status, sort]);

  const list = useMemo(() => {
    const all = data?.members ?? [];
    const s = debounced.trim().toLowerCase();
    if (!s) return all;
    return all.filter((m) => m.name.toLowerCase().includes(s) || (m.mobile ?? '').includes(s) || (m.essl_id ?? '').toLowerCase().startsWith(s));
  }, [data, debounced]);

  const setPhoto = (id: number) => (photo_key: string) =>
    setData((d) => d && { ...d, members: d.members.map((x) => (x.id === id ? { ...x, photo_key } : x)) });
  const setParam = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); p.delete('new'); setParams(p, { replace: true }); };

  return (
    <>
      <PageHeader title="Members" subtitle={data ? `${list.length} of ${data.total}` : undefined}
        actions={<>
          {can('owner', 'admin') && <a className="btn btn-outline" href="/api/export/members.csv"><Download className="w-4 h-4" /><span className="hidden sm:inline">Export</span></a>}
          <button className="btn btn-primary" onClick={() => setAdding(true)}><UserPlus className="w-4 h-4" />Add member</button>
        </>} />

      <div className="flex flex-col sm:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 muted" />
          <input className="input pl-11" placeholder="Search name, mobile or device ID" value={q} onChange={(e) => setQ(e.target.value)} type="search" />
        </div>
        <select className="input sm:w-48" value={sort} onChange={(e) => setParam('sort', e.target.value)} aria-label="Sort">
          <option value="name">Sort: Name</option><option value="end">Sort: End date</option><option value="id">Sort: Device ID</option><option value="recent">Sort: Last visit</option><option value="app">Sort: Last app login</option>
        </select>
      </div>
      <div className="mb-5"><Segmented value={status} options={FILTERS} onChange={(v) => setParam('status', v)} /></div>

      {error ? <ErrorBox error={error} onRetry={reload} /> : !data ? <PageLoader /> : list.length === 0 ? (
        <div className="card"><Empty icon={<Users className="w-6 h-6" />} title="No members found" hint={debounced ? 'Try a different search.' : 'Import your Excel sheet from Settings, or add a member.'} /></div>
      ) : (
        <>
          {/* Desktop / tablet table */}
          <div className="card hidden md:block overflow-hidden">
            <div className="overflow-x-auto">
              <table className="table">
                <thead><tr><th>Member</th><th>ID</th><th>Plan</th><th>Ends</th><th>Status</th><th className="text-right">Dues</th><th>Last visit</th><th>Door</th></tr></thead>
                <tbody>
                  {list.slice(0, limit).map((m) => (
                    <tr key={m.id} className="cursor-pointer" onClick={() => nav(`/members/${m.id}`)}>
                      <td>
                        <div className="flex items-center gap-3 min-w-[180px]">
                          <EditableAvatar memberId={m.id} name={m.name} photo={m.photo_key} size={36} onChange={setPhoto(m.id)} />
                          <div className="min-w-0"><div className="flex items-center gap-1.5"><p className="font-semibold truncate">{m.name}</p><AppBadge m={m} /></div>
                            <p className="text-xs muted">{m.mobile ?? '—'}{status === 'app_users' && ` · app ${m.app_last_login ? ago(m.app_last_login) : 'never logged in'}`}</p></div>
                        </div>
                      </td>
                      <td className="font-mono text-xs">{m.essl_id ?? <span className="text-warn">none</span>}</td>
                      <td className="text-xs">{m.category ?? '—'}<br /><span className="muted">{m.duration_label}</span></td>
                      <td className="whitespace-nowrap">{date(m.end_date)}<br /><span className="text-xs muted">{m.status !== 'staff' ? daysLeftLabel(m.days_left) : ''}</span></td>
                      <td><StatusBadge status={m.status} /></td>
                      <td className={`text-right font-semibold ${m.due ? 'text-warn' : 'muted'}`}>{m.due ? money(m.due) : '—'}</td>
                      <td className="text-xs muted whitespace-nowrap">{date(m.last_visit)}</td>
                      <td>{!m.device_in_sync ? <span title="Device state differs from membership"><ShieldAlert className="w-4 h-4 text-warn" /></span>
                        : <span className={`text-xs font-semibold ${m.access ? 'text-green-600 dark:text-ok' : 'muted'}`}>{m.access ? 'Allowed' : 'Blocked'}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Phone cards (reference "Today Plan" list style) */}
          <ul className="md:hidden space-y-2.5">
            {list.slice(0, limit).map((m) => (
              <li key={m.id}>
                <Link to={`/members/${m.id}`} className="card p-3.5 flex items-center gap-3">
                  <EditableAvatar memberId={m.id} name={m.name} photo={m.photo_key} size={44} onChange={setPhoto(m.id)} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2"><p className="font-semibold truncate">{m.name}</p><AppBadge m={m} />{!m.device_in_sync && <ShieldAlert className="w-3.5 h-3.5 text-warn shrink-0" />}</div>
                    <p className="text-xs muted truncate">#{m.essl_id ?? '—'} · {m.category ?? 'No plan'}{m.duration_label ? ` · ${m.duration_label}` : ''}{status === 'app_users' ? ` · app ${m.app_last_login ? ago(m.app_last_login) : 'never'}` : ''}</p>
                    {m.pct_elapsed !== null && m.status !== 'staff' && (
                      <div className="mt-2 h-1.5 rounded-full bg-black/5 dark:bg-white/10 overflow-hidden">
                        <div className={`h-full rounded-full ${m.status === 'expired' ? 'bg-bad' : m.status === 'expiring' ? 'bg-warn' : 'bg-lime'}`} style={{ width: `${m.pct_elapsed}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="text-right shrink-0">
                    <StatusBadge status={m.status} />
                    <p className="text-[11px] muted mt-1.5">{m.status === 'staff' ? '' : daysLeftLabel(m.days_left)}</p>
                    {m.due > 0 && <p className="text-[11px] font-semibold text-warn">{money(m.due)} due</p>}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {list.length > limit && (
            <div className="flex justify-center mt-5"><button className="btn btn-outline" onClick={() => setLimit(limit + PAGE)}>Show more ({list.length - limit})</button></div>
          )}
        </>
      )}

      <AddMemberModal open={adding} onClose={() => { setAdding(false); setParam('new', ''); }} onDone={(id) => { setAdding(false); nav(`/members/${id}?consent=1`); }} />
    </>
  );
}
