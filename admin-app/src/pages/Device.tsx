import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, Cloud, Copy, Cpu, KeyRound, Monitor, Power, RefreshCw, ShieldAlert, ShieldCheck, Trash2, UserX } from 'lucide-react';
import { api } from '../lib/api';
import { ago, date } from '../lib/format';
import type { DeviceCommand, Settings } from '../lib/types';
import { Confirm, ErrorBox, Field, Modal, PageLoader, SectionTitle, Segmented, Spinner, useAction, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useSession } from '../lib/session';

interface Change { member_id: number; essl_id: string; name: string; action: 'block' | 'unblock'; end_date: string | null }
interface DeviceInfo {
  devices: { sn: string; name: string | null; approved: number; firmware: string | null; last_ip: string | null; last_seen_at: string | null; last_seen_via: string | null; user_count: number | null; fp_count: number | null; att_count: number | null }[];
  agents: { id: number; name: string; last_seen_at: string | null; info: string | null }[];
  queue: { pending: number; sent: number; failed_24h: number; done_24h: number };
  recent: DeviceCommand[];
  pending_changes: { block: Change[]; unblock: Change[] };
  coverage: { on_device: number; with_fingers: number; backed_up: number; roster_at: string | null };
  orphans: { essl_id: string; name: string; privilege: number; fp_count: number | null }[];
  missing: { id: number; essl_id: string; name: string; device_state: string }[];
  privileged: { essl_id: string; name: string; privilege: number; is_staff: number | null }[];
}
type Tab = 'queue' | 'changes' | 'roster';

const online = (iso: string | null | undefined, min = 10) => !!iso && Date.now() - new Date(iso).getTime() < min * 60_000;
const dot = (s: string) => ({ done: 'bg-ok', failed: 'bg-bad', cancelled: 'bg-ink-400', sent: 'bg-info', pending: 'bg-warn' } as Record<string, string>)[s] ?? 'bg-ink-400';

export default function Device() {
  const { can } = useSession();
  const { data: d, error, reload } = useLoad(() => api.get<DeviceInfo>('/device'));
  const { data: settings, reload: reloadSettings } = useLoad(() => api.get<Settings>('/settings'));
  const [tab, setTab] = useState<Tab>('changes');
  const [ask, setAsk] = useState<null | 'enforce' | 'apply' | 'reboot' | 'cleanup'>(null);
  const [token, setToken] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { busy, run } = useAction();

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!d || !settings) return <PageLoader />;

  const dev = d.devices.find((x) => x.approved) ?? d.devices[0];
  const agent = d.agents[0];
  const enforce = settings.access.auto_enforce;
  const changes = [...d.pending_changes.block, ...d.pending_changes.unblock];
  const junk = d.orphans.filter((o) => /[\s=]|^_fixed_/.test(o.essl_id));
  const memberAdmins = d.privileged.filter((p) => !p.is_staff);
  const refresh = () => { void reload(); void reloadSettings(); };

  return (
    <>
      <PageHeader title="Door device" subtitle="eSSL X990 — the app decides who may enter; the device follows."
        actions={<button className="btn btn-outline" onClick={refresh}><RefreshCw className="w-4 h-4" />Refresh</button>} />

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <div className="card-ink p-5 lg:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-2xl bg-lime text-ink-900 flex items-center justify-center"><Cpu className="w-6 h-6" /></div>
              <div>
                <p className="font-display font-bold text-white text-lg">{dev?.name ?? 'eSSL X990'} <span className="text-ink-400 font-mono text-xs">{dev?.sn ?? 'not connected'}</span></p>
                <p className="text-xs text-ink-300">{dev?.firmware ?? '—'} · {dev?.last_ip ?? '—'}</p>
              </div>
            </div>
            <span className={`badge ${online(dev?.last_seen_at) ? 'bg-lime text-ink-900' : 'bg-bad/20 text-bad'}`}>{online(dev?.last_seen_at) ? `Online via ${dev?.last_seen_via}` : `Last seen ${ago(dev?.last_seen_at)}`}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-5">
            {[['Users', dev?.user_count], ['Fingerprints', dev?.fp_count], ['Backed up', `${d.coverage.backed_up}/${d.coverage.with_fingers}`], ['Punch logs', dev?.att_count]].map(([k, v]) => (
              <div key={k as string} className="rounded-2xl bg-white/5 p-3"><p className="text-[11px] text-ink-300">{k}</p><p className="font-display font-bold text-white text-xl">{v ?? '—'}</p></div>
            ))}
          </div>
          <div className="flex flex-wrap gap-4 mt-5 text-xs text-ink-300">
            <span className="flex items-center gap-1.5"><Cloud className="w-4 h-4" />Cloud (ADMS): {dev?.last_seen_via === 'adms' && online(dev?.last_seen_at) ? <b className="text-lime">connected</b> : 'not connected'}</span>
            <span className="flex items-center gap-1.5"><Monitor className="w-4 h-4" />PC agent: {agent ? (online(agent.last_seen_at, 3) ? <b className="text-lime">online</b> : `last ${ago(agent.last_seen_at)}`) : 'not set up'}</span>
            <span>Roster synced {ago(d.coverage.roster_at)}</span>
          </div>
        </div>

        <div className={`card card-pad flex flex-col ${enforce ? '' : 'border-warn/50 dark:border-warn/50'}`}>
          <div className="flex items-center gap-2 font-semibold">{enforce ? <ShieldCheck className="w-5 h-5 text-ok" /> : <ShieldAlert className="w-5 h-5 text-warn" />}Automatic blocking</div>
          <p className="text-sm muted mt-2 flex-1">{enforce
            ? 'On. Every 5 minutes expired members are removed from the device (fingerprints backed up) and renewed members are restored.'
            : `Off. ${d.pending_changes.block.length} expired members can still open the door. Review the list, then switch on.`}</p>
          <div className="text-xs muted mt-3">Grace period: {settings.access.grace_days} day(s) · Staff IDs: {settings.access.staff_prefixes.join(', ')}</div>
          {can('owner') && <button className={`btn mt-4 ${enforce ? 'btn-outline' : 'btn-primary'}`} onClick={() => setAsk('enforce')}>{enforce ? 'Switch off' : 'Review & switch on'}</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <Stat label="Queued" value={d.queue.pending ?? 0} />
        <Stat label="Awaiting device" value={d.queue.sent ?? 0} />
        <Stat label="Done (24h)" value={d.queue.done_24h ?? 0} />
        <Stat label="Failed (24h)" value={d.queue.failed_24h ?? 0} bad={(d.queue.failed_24h ?? 0) > 0} />
      </div>

      <div className="mb-4"><Segmented<Tab> value={tab} onChange={setTab} options={[
        { value: 'changes', label: 'Pending changes', count: changes.length },
        { value: 'queue', label: 'Command log' },
        { value: 'roster', label: 'Device roster issues', count: junk.length + memberAdmins.length + d.missing.length },
      ]} /></div>

      {tab === 'changes' && (
        <div className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-sm muted">What the device <b>should</b> change based on memberships right now.</p>
            {can('owner', 'admin') && changes.length > 0 && <button className="btn btn-primary btn-sm" onClick={() => setAsk('apply')}>Apply {changes.length} now</button>}
          </div>
          {changes.length === 0 ? <p className="px-4 pb-8 text-sm muted flex items-center gap-2"><CheckCircle2 className="w-4 h-4 text-ok" />Device matches all memberships.</p> : (
            <ul className="max-h-[480px] overflow-y-auto">
              {changes.map((c) => (
                <li key={c.member_id} className="flex items-center gap-3 px-4 py-2.5 border-t border-paper-line dark:border-ink-700 text-sm">
                  <span className={`badge ${c.action === 'block' ? 'bg-bad/15 text-red-700 dark:text-bad' : 'bg-ok/15 text-green-700 dark:text-ok'}`}>{c.action}</span>
                  <Link to={`/members/${c.member_id}`} className="flex-1 truncate hover:underline">{c.name} <span className="muted">#{c.essl_id}</span></Link>
                  <span className="text-xs muted">{c.end_date ? `ended ${date(c.end_date)}` : 'no plan'}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {tab === 'queue' && (
        <div className="card overflow-hidden">
          <ul>
            {d.recent.length === 0 && <li className="px-4 py-8 text-sm muted">No commands yet.</li>}
            {d.recent.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-2.5 border-t first:border-t-0 border-paper-line dark:border-ink-700 text-sm">
                <span className={`w-2 h-2 rounded-full shrink-0 ${dot(c.status)}`} />
                <div className="flex-1 min-w-0">
                  <p className="truncate"><b className="capitalize">{c.action.replace('_', ' ')}</b> {c.essl_id && <span className="muted">#{c.essl_id} {c.name}</span>}</p>
                  <p className="text-xs muted truncate">{c.status}{c.channel ? ` via ${c.channel}` : ''} · {ago(c.created_at)} · {c.reason}{c.result ? ` · ${c.result}` : ''}</p>
                </div>
                {can('owner', 'admin') && (c.status === 'pending' || c.status === 'sent') && <button className="btn btn-ghost btn-sm" onClick={() => run(() => api.post(`/device/commands/${c.id}/cancel`), 'Cancelled').then(reload)}>Cancel</button>}
                {can('owner', 'admin') && c.status === 'failed' && <button className="btn btn-outline btn-sm" onClick={() => run(() => api.post(`/device/commands/${c.id}/retry`), 'Retrying').then(reload)}>Retry</button>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {tab === 'roster' && (
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="card card-pad">
            <SectionTitle title="Members with device admin rights" />
            <p className="text-xs muted -mt-2 mb-3">They can open the device menu and change settings. Only staff should.</p>
            {memberAdmins.length === 0 ? <p className="text-sm muted">None 👍</p> : memberAdmins.map((p) => (
              <div key={p.essl_id} className="flex items-center gap-2 py-1.5 text-sm">
                <UserX className="w-4 h-4 text-bad" /><span className="flex-1">{p.name} <span className="muted">#{p.essl_id}</span></span>
                {can('owner') && <button className="btn btn-outline btn-sm" onClick={() => run(() => api.post('/device/demote', { essl_id: p.essl_id }), 'Admin rights removal queued').then(reload)}>Remove rights</button>}
              </div>
            ))}
          </div>
          <div className="card card-pad">
            <SectionTitle title="Junk / unknown device users" />
            <p className="text-xs muted -mt-2 mb-3">On the device but not members in the app. {junk.length} look like leftovers from the old system.</p>
            <ul className="max-h-72 overflow-y-auto text-sm space-y-1">
              {d.orphans.map((o) => (
                <li key={o.essl_id}><label className="flex items-center gap-2 py-1">
                  <input type="checkbox" className="accent-lime w-4 h-4" checked={selected.has(o.essl_id)} onChange={(e) => { const s = new Set(selected); if (e.target.checked) s.add(o.essl_id); else s.delete(o.essl_id); setSelected(s); }} />
                  <span className="font-mono text-xs flex-1 truncate">{o.essl_id}</span><span className="muted text-xs truncate max-w-[40%]">{o.name}</span>
                </label></li>
              ))}
            </ul>
            <div className="flex gap-2 mt-3">
              <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set(junk.map((j) => j.essl_id)))}>Select junk ({junk.length})</button>
              {can('owner', 'admin') && <button className="btn btn-danger btn-sm ml-auto" disabled={!selected.size} onClick={() => setAsk('cleanup')}><Trash2 className="w-3.5 h-3.5" />Remove {selected.size}</button>}
            </div>
          </div>
          <div className="card card-pad">
            <SectionTitle title="Members missing on device" />
            <p className="text-xs muted -mt-2 mb-3">Should have access but their ID isn't enrolled. Enrol a finger on the X990 with this ID.</p>
            <ul className="max-h-72 overflow-y-auto text-sm space-y-1.5">
              {d.missing.length === 0 ? <li className="muted">None</li> : d.missing.map((m) => (
                <li key={m.id} className="flex gap-2"><Link to={`/members/${m.id}`} className="flex-1 truncate hover:underline">{m.name}</Link><span className="font-mono text-xs muted">#{m.essl_id}</span></li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {can('owner') && (
        <div className="grid gap-4 lg:grid-cols-2 mt-6">
          <div className="card card-pad">
            <SectionTitle title="Gym PC agent" />
            <p className="text-sm muted mb-3">Backup path over the gym LAN (TCP 4370): runs commands if the cloud link is down, backs up fingerprints, uploads punches and reads eTimeTrack Lite. Outbound only — no port forwarding.</p>
            {d.agents.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm py-1.5">
                <span className={`w-2 h-2 rounded-full ${online(a.last_seen_at, 3) ? 'bg-ok' : 'bg-ink-400'}`} />
                <span className="flex-1">{a.name}</span><span className="text-xs muted">{ago(a.last_seen_at)}</span>
                {a.name !== 'default' && <button className="icon-btn" title="Revoke" onClick={() => run(() => api.del(`/device/agents/${a.id}`), 'Agent revoked').then(reload)}><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
            <button className="btn btn-outline btn-sm mt-3" onClick={() => run(() => api.post<{ token: string }>('/device/agents', { name: 'Front desk PC' })).then((r) => r && setToken(r.token))}><KeyRound className="w-4 h-4" />New agent token</button>
          </div>
          <div className="card card-pad">
            <SectionTitle title="Device actions" />
            <div className="flex flex-wrap gap-2">
              <button className="btn btn-outline btn-sm" onClick={() => run(() => api.post('/device/commands', { action: 'query_users', reason: 'manual roster refresh' }), 'Roster refresh queued').then(reload)}><RefreshCw className="w-4 h-4" />Refresh roster</button>
              <button className="btn btn-outline btn-sm" onClick={() => setAsk('reboot')}><Power className="w-4 h-4" />Restart device</button>
            </div>
            <p className="text-xs muted mt-3">Cloud link: set the X990 Cloud Server to this system's device address on port 80 (see setup guide).</p>
          </div>
        </div>
      )}

      <Confirm open={ask === 'enforce'} onClose={() => setAsk(null)} busy={busy} danger={enforce}
        title={enforce ? 'Switch off automatic blocking?' : 'Switch on automatic blocking?'} confirmLabel={enforce ? 'Switch off' : `Switch on`}
        message={enforce ? 'Expired members will keep door access until you switch this back on.' : <>
          <p>{d.pending_changes.block.length} expired members will be removed from the device over the next minutes (their fingerprints are backed up first, so renewal restores them instantly), and {d.pending_changes.unblock.length} will be restored.</p>
          <p className="mt-2">Staff IDs ({settings.access.staff_prefixes.join(', ')}) are never blocked.</p></>}
        onConfirm={() => run(() => api.put('/settings/access', { ...settings.access, auto_enforce: !enforce }), enforce ? 'Automatic blocking off' : 'Automatic blocking on').then(() => { setAsk(null); refresh(); })} />
      <Confirm open={ask === 'apply'} onClose={() => setAsk(null)} busy={busy} title={`Apply ${changes.length} changes now?`} confirmLabel="Apply"
        message="Queues the block/unblock commands immediately. The device picks them up within seconds (cloud) or on the agent's next cycle."
        onConfirm={() => run(() => api.post<{ queued: number }>('/access/apply', { limit: 500 }), 'Changes queued').then(() => { setAsk(null); void reload(); })} />
      <Confirm open={ask === 'reboot'} onClose={() => setAsk(null)} busy={busy} danger title="Restart the X990?" confirmLabel="Restart"
        message="The door scanner is unavailable for about a minute."
        onConfirm={() => run(() => api.post('/device/commands', { action: 'reboot', reason: 'manual restart' }), 'Restart queued').then(() => { setAsk(null); void reload(); })} />
      <Confirm open={ask === 'cleanup'} onClose={() => setAsk(null)} busy={busy} danger title={`Remove ${selected.size} users from the device?`} confirmLabel="Remove"
        message="These IDs are not members in the app. Removing them cannot be undone on the device (templates of junk IDs are not restored)."
        onConfirm={() => run(() => api.post('/device/cleanup', { pins: [...selected] }), 'Removal queued').then(() => { setAsk(null); setSelected(new Set()); void reload(); })} />
      <Modal open={!!token} onClose={() => setToken(null)} title="Agent token (shown once)">
        <p className="text-sm muted mb-3">Put this in <code>agent/.env</code> on the gym PC as <code>AGENT_TOKEN=…</code>. It won't be shown again.</p>
        <Field label="Token"><div className="flex gap-2"><input className="input font-mono text-xs" readOnly value={token ?? ''} onFocus={(e) => e.target.select()} />
          <button className="btn btn-outline" onClick={() => navigator.clipboard?.writeText(token ?? '')}><Copy className="w-4 h-4" /></button></div></Field>
        <p className="text-xs text-warn mt-3 flex gap-1.5"><AlertTriangle className="w-4 h-4 shrink-0" />Anyone with this token can control the door device.</p>
      </Modal>
      {busy && <div className="fixed bottom-24 right-6 lg:bottom-6"><Spinner /></div>}
    </>
  );
}

const Stat = ({ label, value, bad }: { label: string; value: number; bad?: boolean }) => (
  <div className="card p-4"><p className="text-xs muted font-semibold">{label}</p><p className={`font-display text-2xl font-bold mt-1 ${bad ? 'text-bad' : ''}`}>{value}</p></div>
);
