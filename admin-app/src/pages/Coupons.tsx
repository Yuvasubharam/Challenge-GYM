import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Copy, History, Pause, Pencil, Play, Plus, Shuffle, Ticket } from 'lucide-react';
import { api } from '../lib/api';
import { ago, date, money, todayLocal } from '../lib/format';
import type { Plan } from '../lib/types';
import { useSession } from '../lib/session';
import { Empty, ErrorBox, Field, Modal, PageLoader, Segmented, Spinner, useAction, useLoad, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { usePlans } from '../components/MemberForms';

type Kind = 'percent' | 'amount' | 'days';
type State = 'live' | 'scheduled' | 'expired' | 'used_up' | 'paused';
interface Coupon {
  id: number; code: string; description: string | null; kind: Kind; value: number; max_discount: number | null; min_amount: number | null; bonus_days: number;
  plan_ids: number[] | null; valid_from: string | null; valid_until: string | null; max_uses: number | null; per_member_limit: number;
  new_members_only: number; member_app: number; active: number; used: number; pending: number; total_discount: number; state: State; created_at: string;
}

const STATE: Record<State, { label: string; cls: string }> = {
  live: { label: 'Live', cls: 'bg-ok/15 text-green-700 dark:text-ok' },
  scheduled: { label: 'Scheduled', cls: 'bg-info/15 text-blue-700 dark:text-info' },
  expired: { label: 'Expired', cls: 'bg-ink-300/20 muted' },
  used_up: { label: 'Used up', cls: 'bg-warn/15 text-amber-700 dark:text-warn' },
  paused: { label: 'Paused', cls: 'bg-ink-300/20 muted' },
};

export function offerText(c: Pick<Coupon, 'kind' | 'value' | 'max_discount' | 'bonus_days' | 'min_amount'>) {
  const parts: string[] = [];
  if (c.kind === 'percent') parts.push(`${c.value}% off${c.max_discount ? ` (max ${money(c.max_discount)})` : ''}`);
  if (c.kind === 'amount') parts.push(`${money(c.value)} off`);
  if (c.bonus_days) parts.push(`+${c.bonus_days} free day${c.bonus_days === 1 ? '' : 's'}`);
  if (c.min_amount) parts.push(`on bills ≥ ${money(c.min_amount)}`);
  return parts.join(' · ');
}

export default function Coupons() {
  const { can } = useSession();
  const { data, error, reload } = useLoad(() => api.get<Coupon[]>('/coupons'));
  const plans = usePlans();
  const [filter, setFilter] = useState<'all' | State>('all');
  const [edit, setEdit] = useState<Coupon | 'new' | null>(null);
  const [history, setHistory] = useState<Coupon | null>(null);
  const { run } = useAction();
  const toast = useToast();
  const admin = can('owner', 'admin');
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const count = (s: State) => data.filter((c) => c.state === s).length;
  const list = filter === 'all' ? data : data.filter((c) => c.state === filter);

  return (
    <>
      <PageHeader title="Coupons" subtitle="Discount and free-day codes for new memberships and renewals — at the desk or in the member app."
        actions={admin && <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus className="w-4 h-4" />New coupon</button>} />
      <div className="mb-4"><Segmented value={filter} onChange={setFilter} options={[
        { value: 'all', label: 'All', count: data.length }, { value: 'live', label: 'Live', count: count('live') }, { value: 'scheduled', label: 'Scheduled', count: count('scheduled') },
        { value: 'used_up', label: 'Used up', count: count('used_up') }, { value: 'expired', label: 'Expired', count: count('expired') }, { value: 'paused', label: 'Paused', count: count('paused') },
      ]} /></div>

      {list.length === 0 ? (
        <div className="card"><Empty icon={<Ticket className="w-6 h-6" />} title={data.length ? 'No coupons here' : 'No coupons yet'}
          hint="Create codes like DIWALI25 (25% off), NEWYEAR500 (₹500 off) or BONUS7 (7 free days)."
          action={admin ? <button className="btn btn-primary" onClick={() => setEdit('new')}><Plus className="w-4 h-4" />New coupon</button> : undefined} /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {list.map((c) => (
            <div key={c.id} className={`card card-pad flex flex-col ${c.state === 'paused' || c.state === 'expired' ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <button className="font-mono font-bold text-lg tracking-wide flex items-center gap-2 hover:underline" title="Copy code"
                    onClick={() => { void navigator.clipboard?.writeText(c.code); toast('ok', `Copied ${c.code}`); }}>{c.code}<Copy className="w-3.5 h-3.5 muted" /></button>
                  {c.description && <p className="text-xs muted truncate">{c.description}</p>}
                </div>
                <span className={`badge ${STATE[c.state].cls}`}>{STATE[c.state].label}</span>
              </div>
              <p className="font-display font-bold text-lime-700 dark:text-lime mt-3">{offerText(c)}</p>
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] py-2"><p className="font-display font-bold">{c.used}{c.max_uses ? <span className="muted text-sm">/{c.max_uses}</span> : ''}</p><p className="text-[10px] muted">used</p></div>
                <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] py-2"><p className="font-display font-bold">{money(c.total_discount)}</p><p className="text-[10px] muted">discount given</p></div>
                <div className="rounded-2xl bg-black/[.03] dark:bg-white/[.04] py-2"><p className="font-display font-bold">{c.pending}</p><p className="text-[10px] muted">awaiting UPI</p></div>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-3 text-[11px]">
                <span className="badge bg-black/5 dark:bg-white/10">{c.valid_from || c.valid_until ? `${c.valid_from ? date(c.valid_from, false) : 'Now'} → ${c.valid_until ? date(c.valid_until) : 'no end'}` : 'No end date'}</span>
                <span className="badge bg-black/5 dark:bg-white/10">{c.per_member_limit}× per member</span>
                {c.plan_ids?.length ? <span className="badge bg-black/5 dark:bg-white/10">{c.plan_ids.length} plan{c.plan_ids.length > 1 ? 's' : ''}</span> : <span className="badge bg-black/5 dark:bg-white/10">All plans</span>}
                {!!c.new_members_only && <span className="badge bg-info/15 text-blue-700 dark:text-info">New members</span>}
                {!c.member_app && <span className="badge bg-black/5 dark:bg-white/10">Desk only</span>}
              </div>
              <div className="flex gap-1 mt-4 pt-3 border-t border-paper-line dark:border-ink-700">
                <button className="btn btn-ghost btn-sm" onClick={() => setHistory(c)}><History className="w-3.5 h-3.5" />Usage</button>
                {admin && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(c)}><Pencil className="w-3.5 h-3.5" />Edit</button>}
                {admin && <button className="btn btn-ghost btn-sm ml-auto" onClick={() => run(() => api.patch(`/coupons/${c.id}`, { active: !c.active }), c.active ? `${c.code} paused` : `${c.code} resumed`).then(reload)}>
                  {c.active ? <><Pause className="w-3.5 h-3.5" />Pause</> : <><Play className="w-3.5 h-3.5" />Resume</>}</button>}
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <CouponEditor coupon={edit} plans={plans} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void reload(); }} />}
      {history && <UsageModal coupon={history} onClose={() => setHistory(null)} />}
    </>
  );
}

const randomCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');

function CouponEditor({ coupon, plans, onClose, onSaved }: { coupon: Coupon | 'new'; plans: Plan[]; onClose: () => void; onSaved: () => void }) {
  const isNew = coupon === 'new';
  const c = isNew ? null : coupon;
  const [f, setF] = useState({
    code: c?.code ?? '', description: c?.description ?? '', kind: (c?.kind ?? 'percent') as Kind, value: c ? String(c.value) : '',
    max_discount: c?.max_discount ? String(c.max_discount) : '', min_amount: c?.min_amount ? String(c.min_amount) : '', bonus_days: c?.bonus_days ? String(c.bonus_days) : '',
    plan_ids: c?.plan_ids ?? [] as number[], valid_from: c?.valid_from ?? todayLocal(), valid_until: c?.valid_until ?? '', max_uses: c?.max_uses ? String(c.max_uses) : '',
    per_member_limit: String(c?.per_member_limit ?? 1), new_members_only: !!c?.new_members_only, member_app: c ? !!c.member_app : true, active: c ? !!c.active : true,
  });
  const { busy, run } = useAction();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const body = {
    ...f, value: Number(f.value) || 0, max_discount: Number(f.max_discount) || null, min_amount: Number(f.min_amount) || null, bonus_days: Number(f.bonus_days) || 0,
    max_uses: Number(f.max_uses) || null, per_member_limit: Number(f.per_member_limit) || 1, valid_from: f.valid_from || null, valid_until: f.valid_until || null,
  };
  const preview = offerText({ kind: f.kind, value: Number(f.value) || 0, max_discount: Number(f.max_discount) || null, bonus_days: Number(f.bonus_days) || 0, min_amount: Number(f.min_amount) || null });
  const cats = [...new Set(plans.map((p) => p.category))];
  const togglePlan = (id: number) => setF({ ...f, plan_ids: f.plan_ids.includes(id) ? f.plan_ids.filter((x) => x !== id) : [...f.plan_ids, id] });

  return (
    <Modal open onClose={onClose} title={isNew ? 'New coupon' : `Edit ${c!.code}`} wide
      footer={<><button className="btn btn-outline" onClick={onClose}>Cancel</button>
        <button className="btn btn-primary" disabled={busy || !f.code} onClick={() => run(() => (isNew ? api.post('/coupons', body) : api.patch(`/coupons/${c!.id}`, body)), 'Coupon saved').then((r) => r && onSaved())}>
          {busy && <Spinner className="w-4 h-4" />}Save coupon</button></>}>
      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <Field label="Code" hint="Members type this. Letters and digits, 3–24 characters.">
            <div className="flex gap-2">
              <input className="input font-mono uppercase tracking-wide" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} placeholder="DIWALI25" maxLength={24} />
              <button type="button" className="btn btn-outline" title="Random code" onClick={() => setF({ ...f, code: randomCode() })}><Shuffle className="w-4 h-4" /></button>
            </div>
          </Field>
          <Field label="Description (optional)"><input className="input" value={f.description} onChange={set('description')} placeholder="Diwali offer for renewals" /></Field>
          <div>
            <span className="label">What it gives</span>
            <div className="flex rounded-full bg-black/5 dark:bg-white/5 p-1">
              {([['percent', '% off'], ['amount', '₹ off'], ['days', 'Free days only']] as const).map(([k, l]) => (
                <button type="button" key={k} onClick={() => setF({ ...f, kind: k })}
                  className={`flex-1 h-9 rounded-full text-xs font-semibold ${f.kind === k ? 'bg-ink-900 text-white dark:bg-lime dark:text-ink-900' : 'muted'}`}>{l}</button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            {f.kind !== 'days' && <Field label={f.kind === 'percent' ? 'Percent off' : 'Amount off (₹)'}><input type="number" className="input" min={1} max={f.kind === 'percent' ? 100 : undefined} value={f.value} onChange={set('value')} /></Field>}
            {f.kind === 'percent' && <Field label="Max discount (₹)" hint="Optional cap"><input type="number" className="input" min={0} value={f.max_discount} onChange={set('max_discount')} /></Field>}
            <Field label="Free extra days" hint={f.kind === 'days' ? 'Required' : 'Optional bonus'}><input type="number" className="input" min={0} max={365} value={f.bonus_days} onChange={set('bonus_days')} /></Field>
            <Field label="Minimum bill (₹)" hint="Optional"><input type="number" className="input" min={0} value={f.min_amount} onChange={set('min_amount')} /></Field>
          </div>
          {preview && <p className="rounded-2xl bg-lime/15 px-4 py-3 text-sm font-semibold">{f.code || 'CODE'} → {preview}</p>}
        </div>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Valid from"><input type="date" className="input" value={f.valid_from} onChange={set('valid_from')} /></Field>
            <Field label="Valid until" hint="Empty = no end"><input type="date" className="input" value={f.valid_until} min={f.valid_from || undefined} onChange={set('valid_until')} /></Field>
            <Field label="Total uses" hint="Empty = unlimited"><input type="number" className="input" min={1} value={f.max_uses} onChange={set('max_uses')} /></Field>
            <Field label="Uses per member"><input type="number" className="input" min={1} value={f.per_member_limit} onChange={set('per_member_limit')} /></Field>
          </div>
          <div>
            <span className="label">Plans {f.plan_ids.length ? `(${f.plan_ids.length} selected)` : '(all plans)'}</span>
            <div className="max-h-44 overflow-y-auto rounded-2xl border border-paper-line dark:border-ink-600 p-2 space-y-2">
              {cats.map((cat) => (
                <div key={cat}>
                  <p className="text-[11px] font-semibold muted px-1">{cat}</p>
                  {plans.filter((p) => p.category === cat).map((p) => (
                    <label key={p.id} className="flex items-center gap-2 px-1 py-1 text-sm cursor-pointer">
                      <input type="checkbox" className="accent-lime w-4 h-4" checked={f.plan_ids.includes(p.id)} onChange={() => togglePlan(p.id)} />
                      <span className="flex-1">{p.name}</span><span className="muted text-xs">{money(p.price)}</span>
                    </label>
                  ))}
                </div>
              ))}
            </div>
          </div>
          <div className="space-y-2 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-lime w-4 h-4" checked={f.member_app} onChange={(e) => setF({ ...f, member_app: e.target.checked })} />Members can apply it themselves in the app</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-lime w-4 h-4" checked={f.new_members_only} onChange={(e) => setF({ ...f, new_members_only: e.target.checked })} />New members only (first membership)</label>
            <label className="flex items-center gap-2"><input type="checkbox" className="accent-lime w-4 h-4" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Active</label>
          </div>
        </div>
      </div>
    </Modal>
  );
}

interface Redemption { id: number; member_id: number; name: string; essl_id: string; discount: number; bonus_days: number; status: string; created_at: string; duration_label: string | null; category: string | null }

function UsageModal({ coupon, onClose }: { coupon: Coupon; onClose: () => void }) {
  const { data } = useLoad(() => api.get<Redemption[]>(`/coupons/${coupon.id}/redemptions`), [coupon.id]);
  return (
    <Modal open onClose={onClose} title={`${coupon.code} — usage`} wide>
      {!data ? <PageLoader /> : data.length === 0 ? <p className="text-sm muted py-6 text-center">Not used yet.</p> : (
        <table className="table">
          <thead><tr><th>Member</th><th>Plan</th><th className="text-right">Discount</th><th className="text-right">Free days</th><th>Status</th><th>When</th></tr></thead>
          <tbody>{data.map((r) => (
            <tr key={r.id}>
              <td><Link className="font-semibold hover:underline" to={`/members/${r.member_id}`} onClick={onClose}>{r.name}</Link> <span className="text-xs muted">#{r.essl_id}</span></td>
              <td className="text-xs">{r.category ? `${r.category} · ${r.duration_label}` : '—'}</td>
              <td className="text-right">{r.discount ? money(r.discount) : '—'}</td>
              <td className="text-right">{r.bonus_days || '—'}</td>
              <td><span className={`badge ${r.status === 'applied' ? 'bg-ok/15 text-green-700 dark:text-ok' : r.status === 'pending' ? 'bg-warn/15 text-amber-700 dark:text-warn' : 'bg-ink-300/20 muted'}`}>{r.status === 'pending' ? 'awaiting UPI' : r.status}</span></td>
              <td className="text-xs muted">{ago(r.created_at)}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
    </Modal>
  );
}
