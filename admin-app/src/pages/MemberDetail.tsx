import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArchiveRestore, ArrowLeft, Ban, CheckCircle2, FileSignature, Cpu, KeyRound, MessageCircle, MoreHorizontal, Pencil, Phone, Printer,
  RefreshCw, Smartphone, Snowflake, Trash2, Wallet, Activity,
} from 'lucide-react';
import { api } from '../lib/api';
import { ago, date, daysLeftLabel, money, time, todayLocal, waLink } from '../lib/format';
import type { DeviceCommand, MemberSummary, Membership, Payment } from '../lib/types';
import { Confirm, ErrorBox, Field, Modal, PageLoader, Ring, Segmented, Spinner, StatusBadge, useAction, useLoad, useToast } from '../components/ui';
import { PaymentModal, RenewModal } from '../components/MemberForms';
import { EditableAvatar } from '../components/PhotoCapture';
import { ConsentCard, ConsentModal, type StoredConsent } from '../components/Consent';
import { useSession } from '../lib/session';

interface Detail {
  member: Record<string, any>;
  summary: MemberSummary;
  memberships: Membership[];
  payments: Payment[];
  attendance: { day: string; first_in: string; last_out: string; punches: number }[];
  followups: { id: number; call_date: string; status: string; priority: string; remarks: string | null; next_date: string | null; handled_by: string }[];
  commands: DeviceCommand[];
  account: { id: number; active: number; last_login_at: string | null; must_change_password: number } | null;
  device: { essl_id: string; name: string; privilege: number; fp_count: number | null; on_device: number; templates_backed_up: number; seen_at: string } | null;
  consent: StoredConsent | null;
}

type Tab = 'plans' | 'payments' | 'attendance' | 'fitness' | 'followups' | 'device';

type CommandOutcome = { status: string; result: string | null };
/** Poll a device command until the X990 answers; gives up after ~45 s (device offline → it stays queued). */
async function waitForCommand(cmdId: number, timeoutMs = 45_000): Promise<CommandOutcome> {
  const until = Date.now() + timeoutMs;
  let last: CommandOutcome = { status: 'pending', result: null };
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 2000));
    last = await api.get<CommandOutcome>(`/device/commands/${cmdId}`);
    if (last.status !== 'pending' && last.status !== 'sent') return last;
  }
  return last;
}

export default function MemberDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const { can } = useSession();
  const { data: d, error, reload } = useLoad(() => api.get<Detail>(`/members/${id}`), [id]);
  const [tab, setTab] = useState<Tab>('plans');
  const [modal, setModal] = useState<null | 'renew' | 'pay' | 'edit' | 'freeze' | 'password' | 'archive' | 'delete' | 'consent' | 'followup' | 'menu'>(null);
  const { busy, run } = useAction();
  const toast = useToast();
  const [syncing, setSyncing] = useState(false);
  const [params, setParams] = useSearchParams();
  // Straight after "Add member": open the consent for signing (?consent=1), once.
  const askConsent = params.get('consent') === '1';
  useEffect(() => {
    if (!askConsent || !d) return;
    if (!d.consent && !d.summary.is_staff) setModal('consent');
    setParams((p) => { p.delete('consent'); return p; }, { replace: true });
  }, [askConsent, d, setParams]);

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d) return <PageLoader />;
  const s = d.summary;
  const m = d.member;
  const close = () => setModal(null);
  const done = () => { close(); void reload(); };

  const left = s.days_left ?? 0;
  const ringPct = s.status === 'staff' ? 100 : s.pct_elapsed === null ? 0 : 100 - s.pct_elapsed;
  const tone = s.status === 'expired' ? 'bad' : s.status === 'expiring' ? 'warn' : 'lime';

  // Access changes go straight to the door device; wait for its answer (usually 1–10 s over ADMS)
  // so the admin sees whether it actually applied instead of a "doesn't match — Sync now" banner.
  const pushToDevice = async (post: () => Promise<{ device_command: number | null }>, label: string) => {
    const r = await run(post);
    if (r) await reportDevice(r.device_command, label);
  };
  const reportDevice = async (cmd: number | null, label: string) => {
    if (!cmd) { toast('ok', `${label} — door device already up to date`); void reload(); return; }
    setSyncing(true);
    try {
      const out = await waitForCommand(cmd);
      if (out.status === 'done') toast('ok', `${label} — door device updated`);
      else if (out.status === 'failed' || out.status === 'cancelled') toast('error', `Door device did not apply it: ${out.result ?? out.status}. Try "Sync now".`);
      else toast('error', 'Door device has not confirmed yet (offline?). It will apply automatically when it reconnects.');
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSyncing(false);
      void reload();
    }
  };
  const setAccess = (override: 'allow' | 'deny' | null) =>
    pushToDevice(() => api.post(`/members/${id}/access`, { override }),
      override === 'deny' ? 'Access blocked' : override === 'allow' ? 'Access allowed' : 'Following membership again');

  return (
    <>
      <button onClick={() => nav(-1)} className="btn btn-ghost -ml-3 mb-3"><ArrowLeft className="w-4 h-4" />Back</button>

      {/* Hero — dark card with ring (reference style) */}
      <div className="card-ink p-5 sm:p-6 mb-4 relative overflow-hidden isolate">
        <div className="absolute -right-24 -bottom-24 w-72 h-72 rounded-full bg-lime/10 -z-10 pointer-events-none" />
        <div className="relative flex flex-col lg:flex-row gap-5 lg:items-center">
          <div className="flex items-center gap-4 flex-1 min-w-0">
            <EditableAvatar memberId={Number(id)} name={s.name} photo={s.photo_key} size={72} onChange={() => void reload()} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-2xl sm:text-3xl font-bold text-white truncate">{s.name}</h1><StatusBadge status={s.status} /></div>
              <p className="text-ink-300 text-sm mt-1">ID <span className="font-mono text-white">{s.essl_id ?? '—'}</span> · {s.mobile ?? 'no mobile'} · joined {date(s.join_date)}</p>
              {m.archived ? <p className="badge bg-bad/20 text-bad mt-2">Archived</p> : null}
              {!s.app_access && <p className="badge bg-warn/20 text-warn mt-2 ml-1"><Smartphone className="w-3 h-3" />Member app off</p>}
              {m.notes && <p className="text-xs text-ink-300 mt-2 max-w-xl">{m.notes}</p>}
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Ring value={ringPct} size={96} stroke={10} tone={tone}>
              <div>{s.status === 'staff' ? <p className="font-display font-bold text-white text-sm">Staff</p> : <>
                <p className="font-display text-2xl font-bold text-white leading-none">{s.days_left === null ? '—' : Math.abs(left)}</p>
                <p className="text-[10px] text-ink-300 mt-0.5">{left < 0 ? 'days over' : 'days left'}</p></>}</div>
            </Ring>
            <div className="text-sm space-y-1">
              <p className="text-ink-300">Plan <span className="text-white font-semibold">{s.category ?? '—'} {s.duration_label && `· ${s.duration_label}`}</span></p>
              <p className="text-ink-300">Ends <span className="text-white font-semibold">{date(s.end_date)}</span></p>
              <p className="text-ink-300">Dues <span className={`font-semibold ${s.due ? 'text-warn' : 'text-white'}`}>{money(s.due)}</span></p>
              <p className="text-ink-300">Door <span className={`font-semibold ${s.access ? 'text-lime' : 'text-bad'}`}>{s.access ? 'Allowed' : 'Blocked'}</span>
                {s.access_override && <span className="text-[10px] ml-1 text-warn">(manual)</span>}</p>
            </div>
          </div>
        </div>

        <div className="relative flex flex-wrap gap-2 mt-5">
          {!m.archived && <button className="btn btn-primary" onClick={() => setModal('renew')}><RefreshCw className="w-4 h-4" />Renew</button>}
          {!m.archived && <button className="btn bg-white/10 text-white hover:bg-white/15" onClick={() => setModal('pay')}><Wallet className="w-4 h-4" />Collect{s.due > 0 && ` ${money(s.due)}`}</button>}
          {s.mobile && <a className="btn bg-white/10 text-white hover:bg-white/15" href={`tel:${s.mobile}`}><Phone className="w-4 h-4" /><span className="hidden sm:inline">Call</span></a>}
          {s.mobile && <a className="btn bg-white/10 text-white hover:bg-white/15" target="_blank" rel="noreferrer"
            href={waLink(s.mobile, `Hi ${s.name}, this is Challenge Gym. Your membership ${daysLeftLabel(s.days_left).toLowerCase()}${s.end_date ? ` (${date(s.end_date)})` : ''}.${s.due ? ` Pending dues: ${money(s.due)}.` : ''}`)}>
            <MessageCircle className="w-4 h-4" /><span className="hidden sm:inline">WhatsApp</span></a>}
          <button className="btn bg-white/10 text-white hover:bg-white/15" onClick={() => setModal('menu')}><MoreHorizontal className="w-4 h-4" />More</button>
        </div>
      </div>

      {!d.consent && !s.is_staff && !m.archived && (
        <div className="card card-pad mb-4 flex flex-wrap items-center gap-3 border-warn/40 dark:border-warn/40">
          <FileSignature className="w-5 h-5 text-warn shrink-0" />
          <p className="text-sm flex-1">Risk consent not signed yet.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setModal('consent')}>Sign now</button>
        </div>
      )}
      {d.consent && <ConsentCard consent={d.consent} name={s.name} onSign={() => setModal('consent')} />}

      {syncing ? (
        <div className="card card-pad mb-4 flex items-center gap-3">
          <Spinner className="w-5 h-5 text-lime-700 dark:text-lime" />
          <p className="text-sm flex-1">Updating the door device…</p>
        </div>
      ) : !s.device_in_sync && s.essl_id && (
        <div className="card card-pad mb-4 flex flex-wrap items-center gap-3 border-warn/40 dark:border-warn/40">
          <Cpu className="w-5 h-5 text-warn" />
          <p className="text-sm flex-1">Door device doesn't match the membership yet ({d.summary.access ? 'should be allowed' : 'should be blocked'}; device: {s.device_state}).
            {d.commands.some((c) => c.status === 'pending' || c.status === 'sent') ? ' A command is queued.' : ''}</p>
          <button className="btn btn-outline btn-sm" disabled={busy} onClick={() => pushToDevice(() => api.post(`/members/${id}/device-sync`), 'Synced')}>Sync now</button>
        </div>
      )}

      <div className="mb-4">
        <Segmented<Tab> value={tab} onChange={setTab} options={[
          { value: 'plans', label: 'Plans', count: d.memberships.length },
          { value: 'payments', label: 'Payments', count: d.payments.length },
          { value: 'attendance', label: 'Attendance', count: d.attendance.length },
          { value: 'fitness', label: 'Fitness' },
          { value: 'followups', label: 'Follow-ups', count: d.followups.length },
          { value: 'device', label: 'Device' },
        ]} />
      </div>

      {tab === 'plans' && <PlansTab d={d} memberId={Number(id)} onChange={reload} />}
      {tab === 'payments' && <PaymentsTab d={d} />}
      {tab === 'attendance' && <AttendanceTab d={d} />}
      {tab === 'fitness' && <FitnessTab memberId={Number(id)} />}
      {tab === 'followups' && <FollowupsTab d={d} onAdd={() => setModal('followup')} />}
      {tab === 'device' && <DeviceTab d={d} />}

      <RenewModal open={modal === 'renew'} onClose={close} memberId={Number(id)} currentEnd={s.end_date} name={s.name} override={s.access_override}
        onDone={(r) => { close(); if (r) void reportDevice(r.device_command, r.override_cleared ? `Renewed, manual ${r.override_cleared === 'deny' ? 'block' : 'allow'} removed` : 'Renewed'); else void reload(); }} />
      <PaymentModal open={modal === 'pay'} onClose={close} onDone={(pid) => { done(); if (pid) window.open(`/receipt/${pid}`, '_blank'); }} memberId={Number(id)} due={s.due} name={s.name} />
      <EditModal open={modal === 'edit'} onClose={close} onDone={done} member={m} />
      <FreezeModal open={modal === 'freeze'} onClose={close} onDone={done} memberId={Number(id)} frozen={!!m.frozen_until} />
      <PasswordModal open={modal === 'password'} onClose={() => { close(); void reload(); }} memberId={Number(id)} account={d.account} esslId={s.essl_id} />
      <ConsentModal open={modal === 'consent'} onClose={close} onSigned={done} memberId={Number(id)} name={s.name} />
      <FollowupModal open={modal === 'followup'} onClose={close} onDone={done} memberId={Number(id)} />
      <Confirm open={modal === 'archive'} onClose={close} danger busy={busy} confirmLabel={m.archived ? 'Restore' : 'Archive member'}
        title={m.archived ? 'Restore member?' : 'Archive this member?'}
        message={m.archived ? 'They will appear in lists again and door access follows their membership.' :
          <>They will be removed from the door device and hidden from lists. Payments and attendance history are kept. Fingerprints stay backed up, so restoring later needs no re-enrolment.</>}
        onConfirm={() => run(() => (m.archived ? api.post(`/members/${id}/restore`) : api.del(`/members/${id}`)),
          m.archived ? 'Member restored' : 'Member archived').then(done)} />

      {modal === 'delete' && <DeleteModal memberId={Number(id)} onClose={close} onDeleted={() => nav('/members', { replace: true })} />}

      <Modal open={modal === 'menu'} onClose={close} title="More actions">
        <div className="grid gap-2">
          <MenuItem icon={<Pencil />} label="Edit profile" onClick={() => setModal('edit')} />
          <MenuItem icon={<Snowflake />} label={m.frozen_until ? `Unfreeze (frozen till ${date(m.frozen_until)})` : 'Freeze membership'} onClick={() => setModal('freeze')} />
          {s.access_override !== 'deny' && <MenuItem icon={<Ban />} label="Block door access now" hint="Overrides membership until cleared" onClick={() => { close(); void setAccess('deny'); }} />}
          {s.access_override !== 'allow' && <MenuItem icon={<CheckCircle2 />} label="Always allow door access" hint="e.g. trainer, trial, grace" onClick={() => { close(); void setAccess('allow'); }} />}
          {s.access_override && <MenuItem icon={<RefreshCw />} label="Clear manual access override" onClick={() => { close(); void setAccess(null); }} />}
          {s.essl_id && <MenuItem icon={<Cpu />} label="Push to device now" onClick={() => { close(); void run(() => api.post(`/members/${id}/device-sync`), 'Device sync queued').then(reload); }} />}
          {can('owner', 'admin') && <MenuItem icon={<Smartphone />} label={s.app_access ? 'Turn member app OFF' : 'Turn member app ON'}
            hint={s.app_access ? 'Blocks the diet/workout app and signs them out' : 'Allow the member app again'}
            danger={!!s.app_access} onClick={() => { close(); void run(() => api.post(`/members/${id}/app-access`, { enabled: !s.app_access }), s.app_access ? 'Member app turned off' : 'Member app turned on').then(reload); }} />}
          {can('owner', 'admin') && <MenuItem icon={<KeyRound />} label={d.account ? 'Reset member app password' : 'Create member app login'} onClick={() => setModal('password')} />}
          <MenuItem icon={<FileSignature />} label={d.consent ? 'Sign risk consent again' : 'Sign risk consent'} hint="English · తెలుగు · हिन्दी" onClick={() => setModal('consent')} />
          <MenuItem icon={<MessageCircle />} label="Log a follow-up call" onClick={() => setModal('followup')} />
          {can('owner', 'admin') && <MenuItem icon={m.archived ? <ArchiveRestore /> : <Trash2 />} danger={!m.archived} label={m.archived ? 'Restore member' : 'Archive member'} onClick={() => setModal('archive')} />}
          {can('owner') && <MenuItem icon={<Trash2 />} danger label="Delete permanently" hint="Lead lost for good: erase all data and free the device ID" onClick={() => setModal('delete')} />}
        </div>
      </Modal>
    </>
  );
}

function MenuItem({ icon, label, hint, onClick, danger }: { icon: React.ReactElement; label: string; hint?: string; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-left hover:bg-black/5 dark:hover:bg-white/5 ${danger ? 'text-bad' : ''}`}>
      <span className="[&>svg]:w-5 [&>svg]:h-5 opacity-80">{icon}</span>
      <span className="flex-1"><span className="font-semibold text-sm block">{label}</span>{hint && <span className="text-xs muted">{hint}</span>}</span>
    </button>
  );
}

function PlansTab({ d, memberId, onChange }: { d: Detail; memberId: number; onChange: () => void }) {
  const { can } = useSession();
  const { run } = useAction();
  const [editing, setEditing] = useState<Membership | null>(null);
  const [f, setF] = useState({ start_date: '', end_date: '', price: '' });
  if (!d.memberships.length) return <div className="card card-pad text-sm muted text-center py-10">No membership yet — use Renew to start one.</div>;
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {d.memberships.map((t) => (
        <div key={t.id} className={`card card-pad ${t.status === 'cancelled' ? 'opacity-50' : ''}`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{t.category ?? 'Membership'} · {t.duration_label}</p>
              <p className="text-sm muted mt-0.5">{date(t.start_date)} → {date(t.end_date)}</p>
            </div>
            <span className={`badge ${t.kind === 'renewal' ? 'bg-lime/20 text-lime-800 dark:text-lime' : 'bg-black/5 dark:bg-white/10'}`}>{t.status === 'cancelled' ? 'cancelled' : t.kind}</span>
          </div>
          <div className="flex gap-6 mt-4 text-sm">
            <div><p className="text-xs muted">Billed</p><p className="font-semibold">{money(t.price)}{t.discount > 0 && <span className="text-xs muted line-through ml-1.5 font-normal">{money(t.list_price)}</span>}</p></div>
            <div><p className="text-xs muted">Paid</p><p className="font-semibold">{money(t.paid)}</p></div>
            <div><p className="text-xs muted">Due</p><p className={`font-semibold ${t.due ? 'text-warn' : ''}`}>{money(t.due)}</p></div>
            {t.pt_amount > 0 && <div><p className="text-xs muted">PT</p><p className="font-semibold">{money(t.pt_amount)}</p></div>}
          </div>
          {(t.discount > 0 || t.bonus_days > 0) && (
            <p className="text-xs font-semibold text-lime-700 dark:text-lime mt-3">
              {t.discount_note ?? [t.discount ? `Saved ${money(t.discount)}` : '', t.bonus_days ? `+${t.bonus_days} free days` : ''].filter(Boolean).join(' · ')}
            </p>
          )}
          {t.notes && t.notes !== t.discount_note && <p className="text-xs muted mt-1">{t.notes}</p>}
          {can('owner', 'admin') && t.status === 'active' && (
            <button className="btn btn-ghost btn-sm mt-2 -ml-3" onClick={() => { setEditing(t); setF({ start_date: t.start_date, end_date: t.end_date, price: String(t.price) }); }}><Pencil className="w-3.5 h-3.5" />Correct</button>
          )}
        </div>
      ))}
      <Modal open={!!editing} onClose={() => setEditing(null)} title="Correct membership term"
        footer={<>
          <button className="btn btn-danger mr-auto" onClick={() => run(() => api.patch(`/members/${memberId}/memberships/${editing!.id}`, { status: 'cancelled' }), 'Term cancelled').then(() => { setEditing(null); onChange(); })}>Cancel term</button>
          <button className="btn btn-primary" onClick={() => run(() => api.patch(`/members/${memberId}/memberships/${editing!.id}`, { ...f, price: Number(f.price) }), 'Term updated').then(() => { setEditing(null); onChange(); })}>Save</button>
        </>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input type="date" className="input" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></Field>
          <Field label="End"><input type="date" className="input" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></Field>
          <Field label="Billed (₹)" className="col-span-2"><input type="number" className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </div>
        <p className="text-xs muted mt-3">Changing the end date updates door access automatically.</p>
      </Modal>
    </div>
  );
}

function PaymentsTab({ d }: { d: Detail }) {
  if (!d.payments.length) return <div className="card card-pad text-sm muted text-center py-10">No payments recorded.</div>;
  return (
    <div className="card overflow-hidden">
      <ul>
        {d.payments.map((p) => (
          <li key={p.id} className={`flex items-center gap-3 px-4 py-3 border-t first:border-t-0 border-paper-line dark:border-ink-700 ${p.status === 'rejected' ? 'opacity-50 line-through' : ''}`}>
            <div className="flex-1 min-w-0">
              <p className="font-semibold">{money(p.amount)} <span className="text-xs muted font-normal uppercase">{p.mode} · {p.entry_type}</span></p>
              <p className="text-xs muted truncate">{date(p.paid_on)}{p.receipt_no ? ` · ${p.receipt_no}` : ''}{p.reference ? ` · ${p.reference}` : ''}{p.remarks ? ` · ${p.remarks}` : ''}</p>
            </div>
            {p.status === 'pending' && <span className="badge bg-warn/15 text-amber-700 dark:text-warn">verify</span>}
            {p.status === 'confirmed' && <Link to={`/receipt/${p.id}`} target="_blank" className="icon-btn" aria-label="Receipt"><Printer className="w-4 h-4" /></Link>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function AttendanceTab({ d }: { d: Detail }) {
  // 12-week heatmap (Mon-first columns)
  const days = useMemo(() => new Set(d.attendance.map((a) => a.day)), [d.attendance]);
  const today = todayLocal();
  const cells: string[] = [];
  const end = new Date(today + 'T00:00:00Z');
  const start = new Date(end); start.setUTCDate(end.getUTCDate() - 83 - ((end.getUTCDay() + 6) % 7));
  for (let t = new Date(start); t <= end; t.setUTCDate(t.getUTCDate() + 1)) cells.push(t.toISOString().slice(0, 10));
  const last30 = d.attendance.filter((a) => a.day >= new Date(Date.parse(today) - 29 * 86400000).toISOString().slice(0, 10)).length;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad lg:col-span-2">
        <div className="flex items-end justify-between mb-4">
          <div><p className="font-semibold">Last 12 weeks</p><p className="text-xs muted">{last30} visits in the last 30 days</p></div>
          <div className="flex items-center gap-1.5 text-[10px] muted">less<span className="w-3 h-3 rounded bg-black/5 dark:bg-white/10" /><span className="w-3 h-3 rounded bg-lime" />visit</div>
        </div>
        <div className="scroll-x">
          <div className="grid grid-rows-7 grid-flow-col gap-1 w-max">
            {cells.map((c) => <div key={c} title={date(c)} className={`w-4 h-4 sm:w-5 sm:h-5 rounded-md ${days.has(c) ? 'bg-lime' : 'bg-black/5 dark:bg-white/10'} ${c === today ? 'ring-2 ring-ink-400' : ''}`} />)}
          </div>
        </div>
      </div>
      <div className="card card-pad">
        <p className="font-semibold mb-3">Recent visits</p>
        {d.attendance.length === 0 ? <p className="text-sm muted">No punches recorded.</p> : (
          <ul className="space-y-2 text-sm max-h-72 overflow-y-auto">
            {d.attendance.slice(0, 30).map((a) => (
              <li key={a.day} className="flex justify-between"><span>{date(a.day)}</span><span className="muted">{time(a.first_in)}{a.punches > 1 ? ` – ${time(a.last_out)}` : ''}</span></li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FollowupsTab({ d, onAdd }: { d: Detail; onAdd: () => void }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex justify-between items-center px-4 py-3"><p className="font-semibold">Call log</p><button className="btn btn-outline btn-sm" onClick={onAdd}>Log call</button></div>
      {d.followups.length === 0 ? <p className="text-sm muted px-4 pb-6">No follow-ups yet.</p> : (
        <ul>
          {d.followups.map((f) => (
            <li key={f.id} className="px-4 py-3 border-t border-paper-line dark:border-ink-700 text-sm">
              <div className="flex justify-between gap-2"><span className="font-semibold">{date(f.call_date)}</span><span className="badge bg-black/5 dark:bg-white/10">{f.status}</span></div>
              {f.remarks && <p className="muted mt-1">{f.remarks}</p>}
              <p className="text-xs muted mt-1">{f.handled_by}{f.next_date ? ` · next call ${date(f.next_date)}` : ''}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeviceTab({ d }: { d: Detail }) {
  const dev = d.device;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad space-y-2.5 text-sm">
        <p className="font-semibold mb-1">On the X990</p>
        <Row k="State in app" v={d.summary.device_state} />
        <Row k="Seen on device" v={dev ? (dev.on_device ? 'Yes' : 'Removed') : 'Not yet synced'} />
        <Row k="Name on device" v={dev?.name ?? '—'} />
        <Row k="Fingerprints" v={dev?.fp_count ?? '—'} />
        <Row k="Cloud backup" v={dev?.templates_backed_up ? `${dev.templates_backed_up} template(s)` : 'None'} />
        {dev && dev.privilege !== 0 && <p className="text-xs text-bad">⚠ Has admin rights on the device menu.</p>}
      </div>
      <div className="card lg:col-span-2 overflow-hidden">
        <p className="font-semibold px-4 pt-4 pb-2">Command history</p>
        {d.commands.length === 0 ? <p className="text-sm muted px-4 pb-6">No device commands yet.</p> : (
          <ul>
            {d.commands.map((c) => (
              <li key={c.id} className="px-4 py-2.5 border-t border-paper-line dark:border-ink-700 text-sm flex gap-3 items-center">
                <span className={`w-2 h-2 rounded-full shrink-0 ${c.status === 'done' ? 'bg-ok' : c.status === 'failed' ? 'bg-bad' : c.status === 'cancelled' ? 'bg-ink-400' : 'bg-warn'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold capitalize">{c.action.replace('_', ' ')} <span className="muted font-normal">· {c.reason}</span></p>
                  <p className="text-xs muted truncate">{c.status}{c.channel ? ` via ${c.channel}` : ''} · {ago(c.created_at)}{c.result ? ` · ${c.result}` : ''}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => <div className="flex justify-between gap-3"><span className="muted">{k}</span><span className="font-medium text-right capitalize">{v}</span></div>;

function EditModal({ open, onClose, onDone, member }: { open: boolean; onClose: () => void; onDone: () => void; member: Record<string, any> }) {
  const { busy, run } = useAction();
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? member[k] ?? '';
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={() => { setF({}); onClose(); }} title="Edit profile" wide
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.patch(`/members/${member.id}`, f), 'Profile saved').then((r) => { if (r) { setF({}); onDone(); } })}>{busy && <Spinner className="w-4 h-4" />}Save</button></>}>
      <div className="grid sm:grid-cols-2 gap-3">
        <Field label="Full name"><input className="input" value={v('name')} onChange={set('name')} /></Field>
        <Field label="Mobile"><input className="input" value={v('mobile')} onChange={set('mobile')} /></Field>
        <Field label="Member ID" hint="Up to 5 digits or e.g. CGA5. Changing it re-creates the user on the device"><input className="input uppercase" value={v('essl_id')} onChange={(e) => setF({ ...f, essl_id: e.target.value.toUpperCase().replace(/\s/g, '') })} pattern="(?:[1-9][0-9]{0,4}|[A-Za-z]{1,4}[0-9]{1,5})" maxLength={9} /></Field>
        <Field label="Gender"><select className="input" value={v('gender')} onChange={set('gender')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
        <Field label="Date of birth"><input type="date" className="input" value={v('dob')} onChange={set('dob')} /></Field>
        <Field label="Joined"><input type="date" className="input" value={v('join_date')} onChange={set('join_date')} /></Field>
        <Field label="Email"><input type="email" className="input" value={v('email')} onChange={set('email')} /></Field>
        <Field label="Emergency contact"><input className="input" value={v('emergency_contact')} onChange={set('emergency_contact')} /></Field>
        <Field label="Address" className="sm:col-span-2"><input className="input" value={v('address')} onChange={set('address')} /></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className="input" rows={3} value={v('notes')} onChange={set('notes')} /></Field>
      </div>
    </Modal>
  );
}

function FreezeModal({ open, onClose, onDone, memberId, frozen }: { open: boolean; onClose: () => void; onDone: () => void; memberId: number; frozen: boolean }) {
  const { busy, run } = useAction();
  const [until, setUntil] = useState('');
  return (
    <Modal open={open} onClose={onClose} title={frozen ? 'Unfreeze membership' : 'Freeze membership'}
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || (!frozen && !until)} onClick={() =>
          run(() => api.post(`/members/${memberId}/${frozen ? 'unfreeze' : 'freeze'}`, frozen ? {} : { until }), frozen ? 'Unfrozen — end date extended' : 'Membership frozen').then((r) => r && onDone())}>
          {frozen ? 'Unfreeze now' : 'Freeze'}</button></>}>
      {frozen ? <p className="text-sm muted">The end date will be extended by the number of days the membership was frozen, and door access returns.</p> : (
        <div className="space-y-3">
          <p className="text-sm muted">Door access is paused while frozen. When you unfreeze, the end date is extended by the frozen days.</p>
          <Field label="Frozen until"><input type="date" className="input" value={until} min={todayLocal()} onChange={(e) => setUntil(e.target.value)} /></Field>
        </div>
      )}
    </Modal>
  );
}

/** Forgotten password: back to the member ID (default) or a password the desk chooses; the member sets their own on next sign-in. */
function PasswordModal({ open, onClose, memberId, account, esslId }: { open: boolean; onClose: () => void; memberId: number; account: Detail['account']; esslId: string | null }) {
  const { busy, run } = useAction();
  const [pw, setPw] = useState('');
  const reset = (body: object, ok: string) => run(() => api.post(`/members/${memberId}/reset-password`, body), ok).then((r) => { if (r) { setPw(''); onClose(); } });
  return (
    <Modal open={open} onClose={onClose} title={account ? 'Reset member app password' : 'Create member app login'}
      footer={<button className="btn btn-outline" onClick={onClose}>Close</button>}>
      <div className="space-y-4">
        <p className="text-sm muted">
          {account ? <>Last sign-in: <b>{account.last_login_at ? ago(account.last_login_at) : 'never'}</b>{account.must_change_password ? ' · still on a temporary password' : ''}. </> : null}
          The member signs in with their member ID or mobile, and must choose their own password right after.
        </p>
        {esslId && (
          <div className="rounded-2xl bg-lime/10 border border-lime/30 p-4">
            <p className="text-sm">Reset to the default — user ID <b className="font-mono">{esslId}</b>, password <b className="font-mono">{esslId}</b></p>
            <button className="btn btn-primary w-full mt-3" disabled={busy}
              onClick={() => void reset({ to_default: true }, `Password reset — tell the member to sign in with ${esslId} / ${esslId}`)}>Reset to member ID</button>
          </div>
        )}
        <div>
          <Field label={esslId ? 'Or set a temporary password (min 6)' : 'Temporary password (min 6)'}>
            <input className="input" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="off" />
          </Field>
          <button className="btn btn-outline w-full mt-3" disabled={busy || pw.length < 6}
            onClick={() => void reset({ password: pw }, 'Password set — share it with the member')}>Set this password</button>
        </div>
      </div>
    </Modal>
  );
}

interface DeletePreview { name: string; essl_id: string | null; archived: boolean; pin_shared: boolean; plans: number; payments: number; paid: number; visits: number; fingerprints: number }

function DeleteModal({ memberId, onClose, onDeleted }: { memberId: number; onClose: () => void; onDeleted: () => void }) {
  const { busy, run } = useAction();
  const { data: p, error } = useLoad(() => api.get<DeletePreview>(`/members/${memberId}/delete-preview`), [memberId]);
  const [typed, setTyped] = useState('');
  const expect = p ? (p.essl_id ?? p.name) : '';
  const ok = !!p && typed.trim().toUpperCase() === expect.trim().toUpperCase();
  const del = () => run(() => api.del<{ device_command: number | null }>(`/members/${memberId}/permanent`, { confirm: typed }),
    p?.essl_id && !p.pin_shared ? `Deleted — removing ID ${p.essl_id} from the door device` : 'Member deleted').then((r) => { if (r) onDeleted(); });
  return (
    <Modal open onClose={onClose} title="Delete member permanently?"
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn bg-bad text-white hover:bg-red-600" disabled={busy || !ok} onClick={() => void del()}>{busy && <Spinner className="w-4 h-4" />}Delete forever</button></>}>
      {error ? <ErrorBox error={error} /> : !p ? <div className="py-6 flex justify-center"><Spinner /></div> : (
        <div className="space-y-4 text-sm">
          <p>This <b>cannot be undone</b>. Use it only when {p.name} is gone for good — otherwise <b>Archive</b> keeps their history.</p>
          <ul className="rounded-2xl bg-bad/10 p-4 space-y-1.5">
            <li>• Profile, member app login and fitness logs</li>
            <li>• {p.plans} plan{p.plans === 1 ? '' : 's'} and {p.payments} payment{p.payments === 1 ? '' : 's'} ({money(p.paid)}) — <b>removed from revenue reports</b></li>
            <li>• {p.visits} attendance record{p.visits === 1 ? '' : 's'}</li>
            {p.essl_id && !p.pin_shared && <li>• User {p.essl_id} deleted from the door device{p.fingerprints ? ` with ${p.fingerprints} backed-up fingerprint${p.fingerprints === 1 ? '' : 's'}` : ''} — the ID is free for a new member</li>}
          </ul>
          {p.pin_shared && <p className="text-warn">ID {p.essl_id} now belongs to another member, so the door device and that member's data are left untouched.</p>}
          <Field label={p.essl_id ? `Type the member ID (${p.essl_id}) to confirm` : `Type the name (${p.name}) to confirm`}>
            <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </Field>
        </div>
      )}
    </Modal>
  );
}

function FollowupModal({ open, onClose, onDone, memberId }: { open: boolean; onClose: () => void; onDone: () => void; memberId: number }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ status: 'open', priority: 'medium', remarks: '', next_date: '' });
  return (
    <Modal open={open} onClose={onClose} title="Log follow-up call"
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post('/followups', { ...f, member_id: memberId, call_date: todayLocal() }), 'Follow-up saved').then((r) => { if (r) { setF({ status: 'open', priority: 'medium', remarks: '', next_date: '' }); onDone(); } })}>Save</button></>}>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Outcome"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
          <option value="open">Call back</option><option value="converted">Will renew</option><option value="lost">Not coming back</option><option value="closed">Closed</option></select></Field>
        <Field label="Priority"><select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
          <option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select></Field>
        <Field label="Next call" className="col-span-2"><input type="date" className="input" value={f.next_date} onChange={(e) => setF({ ...f, next_date: e.target.value })} /></Field>
        <Field label="Remarks" className="col-span-2"><textarea className="input" rows={3} value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} placeholder="Not answered, busy, changed gym…" /></Field>
      </div>
    </Modal>
  );
}

interface FitnessData {
  profile: { height_cm: number; weight_kg: number; start_weight_kg: number; target_weight_kg: number | null; goal: string; activity: string; workouts_per_week: number;
    diet_pref: string | null; kcal_target: number; protein_g: number; onboarded_at: string | null } | null;
  bmi: { bmi: number; category: string } | null;
  days: { day: string; kcal_in: number; kcal_out: number; workouts: number }[];
  workouts: { day: string; name: string; sets: string | null; duration_min: number; kcal: number; best_e1rm: number | null }[];
  weights: { day: string; weight_kg: number }[];
}
const GOAL: Record<string, string> = { lose_weight: 'Lose weight', gain_weight: 'Gain weight', build_muscle: 'Build muscle', maintain: 'Maintain', get_fit: 'Improve fitness' };

/** Read-only view of the member's tracker — for trainers giving advice at the desk. */
function FitnessTab({ memberId }: { memberId: number }) {
  const { data, error } = useLoad(() => api.get<FitnessData>(`/members/${memberId}/fitness`), [memberId]);
  if (error) return <ErrorBox error={error} />;
  if (!data) return <PageLoader />;
  const p = data.profile;
  if (!p?.onboarded_at) return <div className="card card-pad text-sm muted text-center py-10"><Activity className="w-6 h-6 mx-auto mb-2" />This member hasn't set up the fitness tracker in the member app yet.</div>;
  const change = Math.round((p.weight_kg - p.start_weight_kg) * 10) / 10;
  const sets = (s: string | null) => (s ? (JSON.parse(s) as { reps: number; kg: number }[]).map((x) => `${x.reps}×${x.kg || 'BW'}`).join(' · ') : '');
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad space-y-2.5 text-sm">
        <p className="font-semibold mb-1">Profile</p>
        <Row k="Goal" v={GOAL[p.goal] ?? p.goal} />
        <Row k="BMI" v={data.bmi ? `${data.bmi.bmi} · ${data.bmi.category}` : '—'} />
        <Row k="Height" v={`${p.height_cm} cm`} />
        <Row k="Weight" v={`${p.weight_kg} kg (${change > 0 ? '+' : ''}${change} since start)`} />
        {p.target_weight_kg && <Row k="Target" v={`${p.target_weight_kg} kg`} />}
        <Row k="Daily target" v={`${p.kcal_target} kcal · ${p.protein_g} g protein`} />
        <Row k="Workouts / week" v={p.workouts_per_week} />
        {p.diet_pref && <Row k="Diet" v={p.diet_pref.split(',').map((d) => ({ veg: 'Vegetarian', egg: 'Eggetarian', nonveg: 'Non-veg', vegan: 'Vegan' } as Record<string, string>)[d] ?? d).join(' + ')} />}
      </div>
      <div className="card overflow-hidden">
        <p className="font-semibold px-4 pt-4 pb-2">Last 14 days</p>
        {data.days.length === 0 ? <p className="text-sm muted px-4 pb-6">Nothing logged recently.</p> : (
          <table className="table"><thead><tr><th>Day</th><th className="text-right">Eaten</th><th className="text-right">Burned</th><th className="text-right">Workouts</th></tr></thead>
            <tbody>{data.days.map((x) => (
              <tr key={x.day}><td className="text-xs">{date(x.day, false)}</td><td className="text-right">{Math.round(x.kcal_in)}</td><td className="text-right">{Math.round(x.kcal_out)}</td><td className="text-right">{x.workouts}</td></tr>
            ))}</tbody></table>
        )}
      </div>
      <div className="card overflow-hidden">
        <p className="font-semibold px-4 pt-4 pb-2">Recent workouts</p>
        {data.workouts.length === 0 ? <p className="text-sm muted px-4 pb-6">No workouts logged.</p> : (
          <ul>{data.workouts.map((w, i) => (
            <li key={i} className="px-4 py-2.5 border-t border-paper-line dark:border-ink-700 text-sm">
              <div className="flex justify-between gap-2"><span className="font-semibold truncate">{w.name}</span><span className="text-xs muted shrink-0">{date(w.day, false)}</span></div>
              <p className="text-xs muted truncate">{sets(w.sets) || `${w.duration_min} min`} · {Math.round(w.kcal)} kcal{w.best_e1rm ? ` · e1RM ${w.best_e1rm} kg` : ''}</p>
            </li>
          ))}</ul>
        )}
      </div>
    </div>
  );
}
