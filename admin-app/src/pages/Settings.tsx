import { useEffect, useState } from 'react';
import { CheckCircle2, FileSpreadsheet, Upload, UserPlus } from 'lucide-react';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import type { Settings as S } from '../lib/types';
import { chunk, parseWorkbook, type Parsed } from '../lib/excelImport';
import { ErrorBox, Field, Modal, PageLoader, Segmented, SectionTitle, Spinner, useAction, useLoad, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useSession } from '../lib/session';

type Tab = 'gym' | 'access' | 'push' | 'import' | 'staff' | 'account' | 'audit'; // announcements moved to /content

export default function SettingsPage() {
  const { can } = useSession();
  const [tab, setTab] = useState<Tab>('gym');
  const { data, error, reload } = useLoad(() => api.get<S>('/settings'));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const admin = can('owner', 'admin');
  const options: { value: Tab; label: string }[] = [
    { value: 'gym', label: 'Gym & UPI' },
    ...(admin ? [{ value: 'access' as Tab, label: 'Access rules' }, { value: 'push' as Tab, label: 'Renewal reminders' },
      { value: 'import' as Tab, label: 'Import Excel' }, { value: 'staff' as Tab, label: 'Staff logins' }] : []),
    { value: 'account', label: 'My password' },
    ...(admin ? [{ value: 'audit' as Tab, label: 'Audit log' }] : []),
  ];
  return (
    <>
      <PageHeader title="Settings" />
      <div className="mb-5"><Segmented value={tab} options={options} onChange={setTab} /></div>
      {tab === 'gym' && <GymTab s={data} onSaved={reload} readOnly={!admin} />}
      {tab === 'access' && <AccessTab s={data} onSaved={reload} />}
      {tab === 'push' && <RenewalPushTab s={data} onSaved={reload} />}
      {tab === 'import' && <ImportTab />}
      {tab === 'staff' && <StaffTab />}
      {tab === 'account' && <AccountTab />}
      {tab === 'audit' && <AuditTab />}
    </>
  );
}

function GymTab({ s, onSaved, readOnly }: { s: S; onSaved: () => void; readOnly: boolean }) {
  const { busy, run } = useAction();
  const [gym, setGym] = useState(s.gym);
  const [upi, setUpi] = useState(s.upi);
  const [rem, setRem] = useState(s.reminders);
  const [rec, setRec] = useState(s.receipt);
  const { can } = useSession();
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="card card-pad space-y-4">
        <SectionTitle title="Gym details" />
        <Field label="Gym name"><input className="input" value={gym.name} disabled={readOnly} onChange={(e) => setGym({ ...gym, name: e.target.value })} /></Field>
        <Field label="Tagline (member app)"><input className="input" value={gym.tagline} disabled={readOnly} onChange={(e) => setGym({ ...gym, tagline: e.target.value })} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone"><input className="input" value={gym.phone} disabled={readOnly} onChange={(e) => setGym({ ...gym, phone: e.target.value })} /></Field>
          <Field label="Address"><input className="input" value={gym.address} disabled={readOnly} onChange={(e) => setGym({ ...gym, address: e.target.value })} /></Field>
        </div>
        {!readOnly && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put('/settings/gym', gym), 'Saved').then(onSaved)}>Save</button>}
      </div>
      <div className="card card-pad space-y-4">
        <SectionTitle title="UPI for member payments" />
        <p className="text-sm muted -mt-2">Members see a UPI QR for this ID in their app; you confirm the payment under Payments → To verify.</p>
        <Field label="UPI ID (VPA)"><input className="input" placeholder="challengegym@okicici" value={upi.vpa} disabled={readOnly} onChange={(e) => setUpi({ ...upi, vpa: e.target.value })} /></Field>
        <Field label="Payee name"><input className="input" value={upi.payee} disabled={readOnly} onChange={(e) => setUpi({ ...upi, payee: e.target.value })} /></Field>
        {!readOnly && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put('/settings/upi', upi), 'Saved').then(onSaved)}>Save</button>}
      </div>
      <div className="card card-pad space-y-4">
        <SectionTitle title="Expiry reminders" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="'Near expiry' within (days)"><input type="number" className="input" value={rem.near_days} disabled={readOnly} onChange={(e) => setRem({ ...rem, near_days: Number(e.target.value) })} /></Field>
          <Field label="'Expiring soon' within (days)"><input type="number" className="input" value={rem.soon_days} disabled={readOnly} onChange={(e) => setRem({ ...rem, soon_days: Number(e.target.value) })} /></Field>
        </div>
        {!readOnly && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put('/settings/reminders', rem), 'Saved').then(onSaved)}>Save</button>}
      </div>
      <div className="card card-pad space-y-4">
        <SectionTitle title="Receipt numbering" />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Prefix"><input className="input" value={rec.prefix} disabled={!can('owner')} onChange={(e) => setRec({ ...rec, prefix: e.target.value })} /></Field>
          <Field label="Next number"><input type="number" className="input" value={rec.next} disabled={!can('owner')} onChange={(e) => setRec({ ...rec, next: Number(e.target.value) })} /></Field>
        </div>
        <p className="text-xs muted">Next receipt: {rec.prefix}-{String(rec.next).padStart(6, '0')}</p>
        {can('owner') && <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put('/settings/receipt', rec), 'Saved').then(onSaved)}>Save</button>}
      </div>
    </div>
  );
}

function AccessTab({ s, onSaved }: { s: S; onSaved: () => void }) {
  const { busy, run } = useAction();
  const [a, setA] = useState({ ...s.access, prefixes: s.access.staff_prefixes.join(', ') });
  return (
    <div className="card card-pad max-w-2xl space-y-4">
      <SectionTitle title="Door access rules" />
      <Field label="Grace period after expiry (days)" hint="Members keep door access this many days after their end date.">
        <input type="number" min={0} max={30} className="input" value={a.grace_days} onChange={(e) => setA({ ...a, grace_days: Number(e.target.value) })} /></Field>
      <Field label="Staff ID prefixes" hint="IDs starting with these are staff and never auto-blocked (comma separated).">
        <input className="input" value={a.prefixes} onChange={(e) => setA({ ...a, prefixes: e.target.value })} /></Field>
      <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] p-4 text-sm">
        <p className="font-semibold">Blocking method: remove + restore</p>
        <p className="muted mt-1">Tested on your X990: changing a user's group does not stop the door. Expired members are removed from the device after their fingerprint is backed up to the cloud, and restored instantly on renewal — no re-enrolment.</p>
      </div>
      <p className="text-sm">Automatic blocking is <b>{s.access.auto_enforce ? 'ON' : 'OFF'}</b> — switch it on the Device page after reviewing pending changes.</p>
      <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.put('/settings/access', {
        grace_days: a.grace_days, staff_prefixes: a.prefixes.split(',').map((x) => x.trim()).filter(Boolean), auto_enforce: s.access.auto_enforce,
      }), 'Saved').then(onSaved)}>Save</button>
    </div>
  );
}

interface RenewalPushStatus {
  push_ready: boolean;
  log: S['renewal_push_log'];
  due_today: { member_id: number; name: string; end_date: string }[];
  due_count: number;
  preview: { title: string; body: string };
}

const hourLabel = (h: number) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;

function RenewalPushTab({ s, onSaved }: { s: S; onSaved: () => void }) {
  const { busy, run } = useAction();
  const toast = useToast();
  const [f, setF] = useState({ ...s.renewal_push, lines: s.renewal_push.motivation.join('\n') });
  const { data: st, reload } = useLoad(() => api.get<RenewalPushStatus>('/renewal-push'));
  const body = () => ({ ...f, motivation: f.lines.split('\n').map((x) => x.trim()).filter(Boolean) });
  const save = () => run(() => api.put('/settings/renewal_push', body()), 'Saved').then(() => { onSaved(); void reload(); });
  const log = st?.log ?? s.renewal_push_log;
  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="card card-pad space-y-4 lg:col-span-3 min-w-0">
        <SectionTitle title="Renewal reminders on members' phones" />
        <p className="text-sm muted -mt-2">Once a day, every member-app user whose membership ends within the window gets a phone notification with their days left, plus a motivational line that changes daily.</p>
        <label className="flex items-center gap-3 rounded-2xl bg-black/[.03] dark:bg-white/[.04] p-4 cursor-pointer">
          <input type="checkbox" className="w-5 h-5 accent-lime-600" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />
          <span className="text-sm"><b>Send daily reminders</b><span className="block muted">{f.enabled ? `On — every day at ${hourLabel(f.send_hour)}` : 'Off'}</span></span>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start reminding (days before end)" hint="1–30. 7 = daily from 7 days before until the last day.">
            <input type="number" min={1} max={30} className="input" value={f.days_before} onChange={(e) => setF({ ...f, days_before: Number(e.target.value) })} /></Field>
          <Field label="Send at">
            <select className="input" value={f.send_hour} onChange={(e) => setF({ ...f, send_hour: Number(e.target.value) })}>
              {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{hourLabel(h)}</option>)}
            </select></Field>
        </div>
        <Field label="Title" hint="Placeholders: {name} {days} {when} {end_date} {gym} — {when} reads “in 5 days”, “tomorrow” or “today”.">
          <input className="input" maxLength={120} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Message">
          <textarea className="input" rows={3} maxLength={300} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></Field>
        <Field label="Motivational lines (one per line)" hint="One line is added each day, rotating through the list.">
          <textarea className="input" rows={6} value={f.lines} onChange={(e) => setF({ ...f, lines: e.target.value })} /></Field>
        <button className="btn btn-primary" disabled={busy} onClick={save}>Save</button>
      </div>

      <div className="space-y-4 lg:col-span-2 min-w-0">
        {st && !st.push_ready && <div className="card card-pad text-sm border-warn/40 dark:border-warn/40">Phone notifications are not set up on the server (VAPID keys missing), so nothing can be sent yet.</div>}
        <div className="card card-pad space-y-3">
          <SectionTitle title="Preview (saved settings)" />
          <div className="rounded-2xl bg-ink-900 text-white p-4 flex gap-3">
            <img src="/favicon-128.png" alt="" className="w-9 h-9 rounded-xl bg-ink-800 p-1 shrink-0" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{st?.preview.title ?? '…'}</p>
              <p className="text-ink-300 whitespace-pre-line mt-0.5">{st?.preview.body}</p>
            </div>
          </div>
        </div>
        <div className="card card-pad space-y-3">
          <SectionTitle title="Today" action={<span className="text-xs muted">{st ? `${st.due_count} due` : ''}</span>} />
          <p className="text-sm">{log.day ? <>Last sent <b>{ago(log.at)}</b> to {log.members} member{log.members === 1 ? '' : 's'} ({log.sent} phone{log.sent === 1 ? '' : 's'}{log.failed ? `, ${log.failed} failed` : ''}).</> : 'Not sent yet.'}</p>
          {st && st.due_count > 0 ? (
            <ul className="text-sm divide-y divide-paper-line dark:divide-ink-700 max-h-56 overflow-y-auto">
              {st.due_today.map((m) => <li key={m.member_id} className="py-1.5 flex justify-between gap-3"><span className="truncate">{m.name}</span><span className="muted shrink-0">ends {m.end_date.slice(5)}</span></li>)}
            </ul>
          ) : st && <p className="text-sm muted">Nobody left to remind today — members need the app with notifications turned on, and a plan ending within {s.renewal_push.days_before} days.</p>}
          <button className="btn btn-outline w-full" disabled={busy || !st?.push_ready || !st?.due_count}
            onClick={() => run(() => api.post<{ run: { members: number; sent: number; failed: number } }>('/renewal-push/send')).then((r) => {
              if (r) toast('ok', `Sent to ${r.run.members} member${r.run.members === 1 ? '' : 's'} (${r.run.sent} phone${r.run.sent === 1 ? '' : 's'}${r.run.failed ? `, ${r.run.failed} failed` : ''})`);
              onSaved(); void reload();
            })}>Send today's reminders now</button>
        </div>
      </div>
    </div>
  );
}

interface ImportReport {
  members_new: number; members_updated: number; terms_new: number; payments_new: number; followups_new: number; dues_adjusted: number;
  shared_ids: { essl_id: string; kept: string; separated: string[] }[]; no_end_date: { essl_id: string; name: string }[]; not_on_device: string[];
}

function ImportTab() {
  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [phase, setPhase] = useState<'idle' | 'parsing' | 'preview' | 'importing' | 'done'>('idle');
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState<string | null>(null);

  async function send(commit: boolean) {
    if (!parsed) return;
    const parts = chunk(parsed);
    const total: ImportReport = { members_new: 0, members_updated: 0, terms_new: 0, payments_new: 0, followups_new: 0, dues_adjusted: 0, shared_ids: [], no_end_date: [], not_on_device: [] };
    for (let i = 0; i < parts.length; i++) {
      const r = await api.post<ImportReport>('/import/excel', { ...parts[i], commit });
      for (const k of ['members_new', 'members_updated', 'terms_new', 'payments_new', 'followups_new', 'dues_adjusted'] as const) total[k] += r[k];
      total.shared_ids.push(...r.shared_ids); total.no_end_date.push(...r.no_end_date); total.not_on_device.push(...r.not_on_device);
      setProgress(Math.round(((i + 1) / parts.length) * 100));
    }
    return total;
  }

  async function pick(f?: File) {
    if (!f) return;
    setFile(f); setErr(null); setReport(null); setPhase('parsing');
    try {
      const p = await parseWorkbook(f);
      setParsed(p);
      setProgress(0);
      const r = await send(false);
      setReport(r ?? null);
      setPhase('preview');
    } catch (e) {
      setErr((e as Error).message); setPhase('idle');
    }
  }

  async function commit() {
    setPhase('importing'); setProgress(0); setErr(null);
    try { setReport((await send(true)) ?? null); setPhase('done'); } catch (e) { setErr((e as Error).message); setPhase('preview'); }
  }

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card card-pad lg:col-span-1 space-y-4">
        <SectionTitle title="Import master sheet" />
        <p className="text-sm muted">Upload <b>GYM_Membership_System.xlsx</b>. Reads <i>Master Data</i>, <i>Payment History</i> and <i>Follow-ups</i>. Safe to re-import after editing the sheet — only new members, plans, payments and calls are added.</p>
        <label className="flex flex-col items-center justify-center gap-2 rounded-3xl border-2 border-dashed border-paper-line dark:border-ink-600 py-10 cursor-pointer hover:border-lime transition">
          <FileSpreadsheet className="w-8 h-8 text-lime-700 dark:text-lime" />
          <span className="text-sm font-semibold">{file ? file.name : 'Choose .xlsx file'}</span>
          <span className="text-xs muted">Parsed on this computer</span>
          <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </label>
        {err && <p className="text-sm text-bad">{err}</p>}
        {parsed && <p className="text-xs muted">Found {parsed.members.length} members · {parsed.payments.length} payments · {parsed.followups.length} follow-ups</p>}
        {parsed?.warnings.map((w) => <p key={w} className="text-xs text-warn">{w}</p>)}
      </div>

      <div className="card card-pad lg:col-span-2">
        {phase === 'idle' && <p className="text-sm muted py-10 text-center">Choose the Excel file to see a preview. Nothing is saved until you confirm.</p>}
        {(phase === 'parsing' || phase === 'importing') && (
          <div className="py-10 text-center"><Spinner className="w-7 h-7 mx-auto" /><p className="text-sm mt-3">{phase === 'parsing' ? 'Checking' : 'Importing'}… {progress}%</p>
            <div className="h-2 rounded-full bg-black/5 dark:bg-white/10 mt-3 max-w-xs mx-auto overflow-hidden"><div className="h-full bg-lime transition-all" style={{ width: `${progress}%` }} /></div></div>
        )}
        {report && (phase === 'preview' || phase === 'done') && (
          <div>
            <div className="flex items-center gap-2 mb-4">{phase === 'done' ? <><CheckCircle2 className="w-5 h-5 text-ok" /><p className="font-semibold">Import complete</p></> : <p className="font-semibold">Preview — this will be added</p>}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-4">
              {[['New members', report.members_new], ['Existing updated', report.members_updated], ['Membership terms', report.terms_new], ['Payments', report.payments_new], ['Follow-ups', report.followups_new], ['Dues matched to sheet', report.dues_adjusted]].map(([k, v]) => (
                <div key={k as string} className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] p-3"><p className="text-xs muted">{k}</p><p className="font-display text-xl font-bold">{v}</p></div>
              ))}
            </div>
            {report.shared_ids.length > 0 && (
              <div className="rounded-2xl bg-warn/10 p-4 mb-3 text-sm">
                <p className="font-semibold text-amber-700 dark:text-warn">Device IDs shared by two people in the sheet</p>
                <ul className="mt-1 muted">{report.shared_ids.map((x) => <li key={x.essl_id}>#{x.essl_id}: keeps <b>{x.kept}</b>; {x.separated.join(', ')} imported without an ID — give them a new ID and enrol on the device.</li>)}</ul>
              </div>
            )}
            {report.no_end_date.length > 0 && (
              <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] p-4 mb-3 text-sm">
                <p className="font-semibold">{report.no_end_date.length} members have no start/end date — imported without a plan</p>
                <p className="muted text-xs mt-1">{report.no_end_date.slice(0, 20).map((x) => `${x.name} (#${x.essl_id})`).join(', ')}{report.no_end_date.length > 20 ? '…' : ''}</p>
              </div>
            )}
            {report.not_on_device.length > 0 && <p className="text-xs muted mb-3">{report.not_on_device.length} IDs are not on the device roster yet: {report.not_on_device.slice(0, 25).join(', ')}{report.not_on_device.length > 25 ? '…' : ''}</p>}
            {phase === 'preview' && <button className="btn btn-primary" onClick={commit}><Upload className="w-4 h-4" />Import now</button>}
            {phase === 'done' && <p className="text-sm muted">Imported members start with device state "unknown". Door access changes only after you switch on automatic blocking on the Device page.</p>}
          </div>
        )}
      </div>
    </div>
  );
}

interface Staff { id: number; role: string; username: string; display_name: string; active: number; last_login_at: string | null }

function StaffTab() {
  const { session, can } = useSession();
  const { data, reload } = useLoad(() => api.get<Staff[]>('/auth/staff'));
  const { busy, run } = useAction();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', username: '', password: '', role: 'staff' });
  const [reset, setReset] = useState<Staff | null>(null);
  const [pw, setPw] = useState('');
  return (
    <div className="card overflow-hidden max-w-3xl">
      <div className="flex items-center justify-between px-4 py-3"><p className="font-semibold">Staff logins</p><button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}><UserPlus className="w-4 h-4" />Add</button></div>
      <p className="text-xs muted px-4 pb-3"><b>Staff</b>: members, renewals, payments, attendance. <b>Admin</b>: + plans, settings, device, import, voids. <b>Owner</b>: everything incl. auto-blocking & agents.</p>
      <ul>
        {(data ?? []).map((u) => (
          <li key={u.id} className="flex flex-wrap items-center gap-3 px-4 py-3 border-t border-paper-line dark:border-ink-700">
            <div className="flex-1 min-w-[160px]"><p className="font-semibold">{u.display_name} <span className="muted text-xs font-normal">@{u.username}</span></p>
              <p className="text-xs muted capitalize">{u.role} · last sign-in {ago(u.last_login_at)}</p></div>
            {!u.active && <span className="badge bg-bad/15 text-bad">disabled</span>}
            {u.id !== session?.aid && u.role !== 'owner' && <>
              <button className="btn btn-ghost btn-sm" onClick={() => { setPw(''); setReset(u); }}>Reset password</button>
              <button className="btn btn-outline btn-sm" onClick={() => run(() => api.patch(`/auth/staff/${u.id}`, { active: !u.active }), u.active ? 'Disabled' : 'Enabled').then(reload)}>{u.active ? 'Disable' : 'Enable'}</button>
            </>}
          </li>
        ))}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Add staff login"
        footer={<><button className="btn btn-outline" onClick={() => setOpen(false)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={() => run(() => api.post('/auth/staff', f), 'Login created').then((r) => { if (r) { setOpen(false); setF({ name: '', username: '', password: '', role: 'staff' }); void reload(); } })}>Create</button></>}>
        <div className="space-y-3">
          <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Username"><input className="input" value={f.username} onChange={(e) => setF({ ...f, username: e.target.value.toLowerCase() })} autoCapitalize="none" /></Field>
          <Field label="Password (min 8)"><input className="input" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></Field>
          <Field label="Role"><select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}><option value="staff">Staff (front desk)</option>{can('owner') && <option value="admin">Admin</option>}</select></Field>
        </div>
      </Modal>
      <Modal open={!!reset} onClose={() => setReset(null)} title={`Reset password — ${reset?.display_name}`}
        footer={<><button className="btn btn-outline" onClick={() => setReset(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || pw.length < 8} onClick={() => run(() => api.patch(`/auth/staff/${reset!.id}`, { password: pw }), 'Password reset').then(() => setReset(null))}>Save</button></>}>
        <Field label="New password (min 8)"><input className="input" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      </Modal>
    </div>
  );
}

function AccountTab() {
  const { busy, run } = useAction();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const mismatch = f.confirm && f.next !== f.confirm;
  return (
    <div className="card card-pad max-w-md space-y-3">
      <SectionTitle title="Change my password" />
      <Field label="Current password"><input type="password" className="input" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /></Field>
      <Field label="New password (min 8)"><input type="password" className="input" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" /></Field>
      <Field label="Confirm new password"><input type="password" className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></Field>
      {mismatch && <p className="text-xs text-bad">Passwords don't match.</p>}
      <button className="btn btn-primary" disabled={busy || !f.next || !!mismatch} onClick={() => run(() => api.post('/auth/change-password', { current: f.current, next: f.next }), 'Password changed').then((r) => r && setF({ current: '', next: '', confirm: '' }))}>Update password</button>
    </div>
  );
}

function AuditTab() {
  const { data } = useLoad(() => api.get<{ id: number; actor: string; action: string; entity: string; entity_id: string; detail: string; at: string }[]>('/audit'));
  const [rows, setRows] = useState(50);
  useEffect(() => setRows(50), [data]);
  if (!data) return <PageLoader />;
  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="table">
          <thead><tr><th>When</th><th>Who</th><th>Action</th><th>Details</th></tr></thead>
          <tbody>{data.slice(0, rows).map((a) => (
            <tr key={a.id}><td className="whitespace-nowrap text-xs muted">{ago(a.at)}</td><td className="text-xs">{a.actor}</td>
              <td className="text-xs font-semibold">{a.action}{a.entity_id ? ` #${a.entity_id}` : ''}</td><td className="text-xs muted max-w-md truncate">{a.detail}</td></tr>
          ))}</tbody>
        </table>
      </div>
      {data.length > rows && <div className="p-3 text-center"><button className="btn btn-outline btn-sm" onClick={() => setRows(rows + 100)}>More</button></div>}
    </div>
  );
}
