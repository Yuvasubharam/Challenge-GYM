import { useState } from 'react';
import { Pencil, Plus, Tags } from 'lucide-react';
import { api } from '../lib/api';
import { money } from '../lib/format';
import type { Plan } from '../lib/types';
import { Empty, ErrorBox, Field, Modal, PageLoader, useAction, useLoad } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useSession } from '../lib/session';

const blank = { name: '', category: 'Strength', duration_months: '1', duration_days: '0', price: '', sort: '100' };

export default function Plans() {
  const { can } = useSession();
  const { data, error, reload } = useLoad(() => api.get<Plan[]>('/plans'));
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Plan | 'new' | null>(null);
  const [f, setF] = useState(blank);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const admin = can('owner', 'admin');
  const cats = [...new Set(data.map((p) => p.category))];
  const open = (p: Plan | 'new') => {
    setEdit(p);
    setF(p === 'new' ? blank : { name: p.name, category: p.category, duration_months: String(p.duration_months), duration_days: String(p.duration_days), price: String(p.price), sort: String(p.sort) });
  };
  const save = () => {
    const body = { ...f, duration_months: Number(f.duration_months), duration_days: Number(f.duration_days), price: Number(f.price), sort: Number(f.sort) };
    return run(() => (edit === 'new' ? api.post('/plans', body) : api.patch(`/plans/${(edit as Plan).id}`, body)), 'Plan saved').then((r) => { if (r) { setEdit(null); void reload(); } });
  };
  return (
    <>
      <PageHeader title="Plans & pricing" subtitle="Used when adding or renewing members. The price can still be changed per member for discounts."
        actions={admin && <button className="btn btn-primary" onClick={() => open('new')}><Plus className="w-4 h-4" />New plan</button>} />
      {data.length === 0 ? <div className="card"><Empty icon={<Tags className="w-6 h-6" />} title="No plans yet" /></div> : cats.map((cat) => (
        <div key={cat} className="mb-6">
          <h2 className="font-display font-semibold mb-3">{cat}</h2>
          <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
            {data.filter((p) => p.category === cat).map((p) => (
              <div key={p.id} className={`card card-pad relative ${p.active ? '' : 'opacity-50'}`}>
                <p className="text-xs muted font-semibold">{p.duration_months ? `${p.duration_months} month${p.duration_months > 1 ? 's' : ''}` : ''}{p.duration_days ? ` ${p.duration_days} days` : ''}</p>
                <p className="font-display text-2xl font-bold mt-1">{money(p.price)}</p>
                <p className="text-sm mt-1 truncate">{p.name}</p>
                {p.duration_months > 0 && <p className="text-xs muted mt-2">{money(Math.round(p.price / p.duration_months))}/month</p>}
                {!p.active && <span className="badge bg-black/5 dark:bg-white/10 mt-2">hidden</span>}
                {admin && <button className="icon-btn absolute top-3 right-3" onClick={() => open(p)} aria-label="Edit"><Pencil className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        </div>
      ))}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? 'New plan' : 'Edit plan'}
        footer={<>
          {edit && edit !== 'new' && <button className="btn btn-ghost mr-auto" onClick={() => run(() => api.patch(`/plans/${edit.id}`, { active: !edit.active }), edit.active ? 'Plan hidden' : 'Plan shown').then(() => { setEdit(null); void reload(); })}>{edit.active ? 'Hide plan' : 'Show plan'}</button>}
          <button className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>Save</button></>}>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name" className="col-span-2"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Strength — 3 Months" /></Field>
          <Field label="Category"><input className="input" list="cats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /><datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
          <Field label="Price (₹)"><input type="number" className="input" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
          <Field label="Months"><input type="number" min={0} className="input" value={f.duration_months} onChange={(e) => setF({ ...f, duration_months: e.target.value })} /></Field>
          <Field label="+ Days"><input type="number" min={0} className="input" value={f.duration_days} onChange={(e) => setF({ ...f, duration_days: e.target.value })} /></Field>
          <Field label="Sort order" className="col-span-2"><input type="number" className="input" value={f.sort} onChange={(e) => setF({ ...f, sort: e.target.value })} /></Field>
        </div>
      </Modal>
    </>
  );
}
