import { useState } from 'react';
import { ArrowLeft, ShoppingBag, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ago, money } from '../lib/format';
import { img, type Product } from '../lib/content';
import { ErrorBox, PageLoader, useAction, useLoad } from '../components/ui';
import { ProductSheet, ProductTile } from '../components/HomeContent';

interface Enquiry { id: number; qty: number; status: 'new' | 'done' | 'cancelled'; created_at: string; product_id: number; name: string; price: number; image_key: string | null }

export default function Shop() {
  const { data, error, reload } = useLoad(() => api.get<Product[]>('/content/products'));
  const { data: mine, reload: reloadMine } = useLoad(() => api.get<Enquiry[]>('/content/enquiries'));
  const [cat, setCat] = useState('');
  const [open, setOpen] = useState<Product | null>(null);
  const { run } = useAction();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const cats = [...new Set(data.map((p) => p.category).filter(Boolean))] as string[];
  const list = data.filter((p) => !cat || p.category === cat);
  const pending = (mine ?? []).filter((e) => e.status === 'new');

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 pt-1">
        <Link to="/" className="icon-btn -ml-2" aria-label="Back"><ArrowLeft className="w-5 h-5" /></Link>
        <div><h1 className="text-2xl font-bold">Gym shop</h1><p className="text-sm muted">Reserve here, pay & collect at the front desk.</p></div>
      </header>

      {pending.length > 0 && (
        <div className="card-ink p-4 space-y-2.5">
          <p className="text-xs font-semibold text-ink-300">Your reservations · collect at the desk</p>
          {pending.map((e) => (
            <div key={e.id} className="flex items-center gap-3">
              {e.image_key ? <img src={img(e.image_key)} alt="" className="w-10 h-10 rounded-xl object-cover" /> : <div className="w-10 h-10 rounded-xl bg-white/10" />}
              <div className="flex-1 min-w-0"><p className="text-sm text-white font-semibold truncate">{e.qty} × {e.name}</p><p className="text-[11px] text-ink-300">{money(e.price * e.qty)} · {ago(e.created_at)}</p></div>
              <button className="icon-btn w-8 h-8 text-ink-300" aria-label="Cancel reservation" onClick={() => run(() => api.post(`/content/enquiries/${e.id}/cancel`), 'Reservation cancelled').then(reloadMine)}><X className="w-4 h-4" /></button>
            </div>
          ))}
        </div>
      )}

      {cats.length > 1 && (
        <div className="scroll-x -mx-4 px-4"><div className="flex gap-2 w-max">
          <button className={`chip ${!cat ? 'chip-on' : ''}`} onClick={() => setCat('')}>All</button>
          {cats.map((c) => <button key={c} className={`chip ${cat === c ? 'chip-on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
        </div></div>
      )}

      {list.length === 0 ? (
        <div className="card card-pad text-center py-12"><ShoppingBag className="w-8 h-8 mx-auto muted" /><p className="font-semibold mt-3">Shop is empty right now</p><p className="text-sm muted">Check back soon.</p></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{list.map((p) => <ProductTile key={p.id} p={p} onOpen={() => setOpen(p)} />)}</div>
      )}
      <ProductSheet product={open} onClose={() => setOpen(null)} onReserved={reloadMine} />
    </div>
  );
}
