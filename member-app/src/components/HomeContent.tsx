// Gym content blocks for the member home: carousel, news/events, shop, gallery, bell.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Bell, CalendarDays, ChevronRight, ExternalLink, Images, Megaphone, ShoppingBag, Tag } from 'lucide-react';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { img, isExternal, KIND_LABEL, type Album, type Banner, type Post, type Product } from '../lib/content';
import { Sheet, Spinner, useAction } from './ui';

/** Button/link to an in-app page or an external https URL. */
export function CtaLink({ link, children, className, onClick }: { link: string; children: ReactNode; className?: string; onClick?: () => void }) {
  if (isExternal(link)) return <a href={link} target="_blank" rel="noopener noreferrer" className={className} onClick={onClick}>{children}<ExternalLink className="w-3.5 h-3.5" /></a>;
  return <Link to={link} className={className} onClick={onClick}>{children}</Link>;
}

const Section = ({ title, to, children }: { title: string; to?: string; children: ReactNode }) => (
  <section>
    <div className="flex items-center justify-between mb-3 mt-2">
      <h2 className="font-display font-semibold text-lg">{title}</h2>
      {to && <Link to={to} className="text-sm font-semibold text-lime-700 dark:text-lime flex items-center gap-0.5 py-2.5 -my-2.5 pl-3">See all<ChevronRight className="w-4 h-4" /></Link>}
    </div>
    {children}
  </section>
);

// ── Carousel ────────────────────────────────────────────────────────────
export function Carousel({ banners }: { banners: Banner[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const paused = useRef(false);
  useEffect(() => {
    if (banners.length < 2) return;
    const t = setInterval(() => {
      const el = ref.current;
      if (!el || paused.current || document.hidden) return;
      const next = (Math.round(el.scrollLeft / el.clientWidth) + 1) % banners.length;
      el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
    }, 5000);
    return () => clearInterval(t);
  }, [banners.length]);
  if (!banners.length) return null;
  return (
    <div className="relative -mx-4 sm:mx-0">
      <div ref={ref} className="scroll-x flex snap-x snap-mandatory sm:rounded-3xl"
        onScroll={(e) => setI(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))}
        onPointerDown={() => { paused.current = true; }} onPointerUp={() => { setTimeout(() => { paused.current = false; }, 4000); }}>
        {banners.map((b) => {
          const inner = (
            <div className="relative aspect-[16/9] sm:aspect-[21/9] rounded-3xl sm:rounded-none overflow-hidden bg-ink-900 isolate">
              {b.image_key ? <img src={img(b.image_key)} alt="" className="absolute inset-0 w-full h-full object-cover -z-10" />
                : <div className="absolute -right-12 -top-12 w-52 h-52 rounded-full bg-lime/15 -z-10" />}
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/15 to-transparent -z-10" />
              <div className="absolute inset-x-0 bottom-0 p-4 sm:p-6">
                <p className="font-display font-bold text-white text-xl sm:text-2xl leading-tight">{b.title}</p>
                {b.subtitle && <p className="text-sm text-white/80 mt-1 line-clamp-2">{b.subtitle}</p>}
                {b.cta_link && <span className="inline-flex items-center gap-1 mt-3 rounded-full bg-lime text-ink-900 text-xs font-bold px-3.5 py-2">{b.cta_label || 'Explore'}<ArrowRight className="w-3.5 h-3.5" /></span>}
              </div>
            </div>
          );
          return (
            <div key={b.id} className="snap-center shrink-0 w-full px-4 sm:px-0">
              {b.cta_link ? <CtaLink link={b.cta_link} className="block">{inner}</CtaLink> : inner}
            </div>
          );
        })}
      </div>
      {banners.length > 1 && (
        <div className="flex justify-center gap-1.5 mt-2.5">
          {banners.map((b, k) => <span key={b.id} className={`h-1.5 rounded-full transition-all ${k === i ? 'w-5 bg-lime' : 'w-1.5 bg-black/15 dark:bg-white/20'}`} />)}
        </div>
      )}
    </div>
  );
}

// ── Posts ───────────────────────────────────────────────────────────────
const KIND_CLS = { notice: 'bg-info/15 text-blue-700 dark:text-info', event: 'bg-lime text-ink-900', offer: 'bg-warn/20 text-amber-700 dark:text-warn' };
export const KindBadge = ({ kind }: { kind: Post['kind'] }) => <span className={`badge ${KIND_CLS[kind]}`}>{KIND_LABEL[kind]}</span>;

function DateTile({ d }: { d: string }) {
  const dt = new Date(d + 'T00:00:00');
  return (
    <div className="w-12 shrink-0 self-start rounded-2xl bg-lime text-ink-900 text-center py-1.5">
      <p className="text-[10px] font-bold uppercase">{dt.toLocaleString('en-IN', { month: 'short' })}</p>
      <p className="font-display text-xl font-bold leading-none">{dt.getDate()}</p>
    </div>
  );
}

export function PostCard({ p, onOpen, wide }: { p: Post; onOpen: () => void; wide?: boolean }) {
  return (
    <button onClick={onOpen} className={`card overflow-hidden text-left flex flex-col shrink-0 snap-start active:scale-[.99] transition ${wide ? 'w-full' : 'w-[78%] sm:w-72'}`}>
      {p.image_key ? <img src={img(p.image_key)} alt="" className="w-full aspect-[16/9] object-cover bg-ink-900" loading="lazy" /> : null}
      <div className="p-4 flex gap-3 flex-1">
        {p.kind === 'event' && p.event_date ? <DateTile d={p.event_date} /> : !p.image_key ? (
          <div className="w-10 h-10 shrink-0 rounded-2xl bg-lime/20 text-lime-700 dark:text-lime flex items-center justify-center">{p.kind === 'offer' ? <Tag className="w-5 h-5" /> : <Megaphone className="w-5 h-5" />}</div>
        ) : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 mb-1"><KindBadge kind={p.kind} />{p.kind === 'event' && p.event_time && <span className="text-[11px] muted">{p.event_time}</span>}</div>
          <p className="font-semibold leading-snug line-clamp-2">{p.title}</p>
          {p.body && <p className="text-sm muted mt-0.5 line-clamp-2">{p.body}</p>}
        </div>
      </div>
    </button>
  );
}

export function PostSheet({ post, onClose }: { post: Post | null; onClose: () => void }) {
  return (
    <Sheet open={!!post} onClose={onClose} title={post ? KIND_LABEL[post.kind] : ''}
      footer={post?.cta_link ? <CtaLink link={post.cta_link} onClick={onClose} className="btn btn-primary w-full">{post.cta_label || 'Learn more'}</CtaLink> : undefined}>
      {post && (
        <div className="space-y-3">
          {post.image_key && <img src={img(post.image_key)} alt="" className="w-full rounded-2xl bg-ink-900" />}
          <h3 className="font-display text-xl font-bold leading-tight">{post.title}</h3>
          {post.kind === 'event' && post.event_date && (
            <p className="flex items-center gap-2 text-sm font-semibold text-lime-700 dark:text-lime"><CalendarDays className="w-4 h-4" />{date(post.event_date)}{post.event_time ? ` · ${post.event_time}` : ''}</p>
          )}
          {post.body && <p className="text-sm leading-relaxed whitespace-pre-line">{post.body}</p>}
          <p className="text-xs muted">Posted {date(post.created_at.slice(0, 10))}</p>
        </div>
      )}
    </Sheet>
  );
}

export function NewsStrip({ posts }: { posts: Post[] }) {
  const [open, setOpen] = useState<Post | null>(null);
  if (!posts.length) return null;
  const events = posts.filter((p) => p.kind === 'event').length;
  return (
    <Section title={events && events === posts.length ? 'Upcoming events' : 'News & events'} to="/news">
      <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 snap-x snap-mandatory pb-1">
        {posts.map((p) => <PostCard key={p.id} p={p} onOpen={() => setOpen(p)} wide={posts.length === 1} />)}
      </div>
      <PostSheet post={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

// ── Shop ────────────────────────────────────────────────────────────────
export function ProductTile({ p, onOpen }: { p: Product; onOpen: () => void }) {
  const off = p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
  return (
    <button onClick={onOpen} className="card overflow-hidden text-left flex flex-col active:scale-[.99] transition">
      <div className="relative aspect-square bg-paper dark:bg-ink-900">
        {p.image_key ? <img src={img(p.image_key)} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center muted"><ShoppingBag className="w-8 h-8" /></div>}
        {off > 0 && <span className="absolute top-2 left-2 badge bg-lime text-ink-900">{off}% off</span>}
        {!p.in_stock && <span className="absolute inset-0 bg-black/50 flex items-center justify-center text-white text-xs font-bold uppercase">Out of stock</span>}
      </div>
      <div className="p-3">
        <p className="text-sm font-semibold leading-snug line-clamp-2 min-h-[2.5em]">{p.name}</p>
        <p className="mt-1"><b>{money(p.price)}</b>{off > 0 && <span className="text-xs muted line-through ml-1.5">{money(p.mrp)}</span>}</p>
      </div>
    </button>
  );
}

export function ProductSheet({ product, onClose, onReserved }: { product: Product | null; onClose: () => void; onReserved?: () => void }) {
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const { busy, run } = useAction();
  useEffect(() => { setQty(1); setNote(''); }, [product?.id]);
  const p = product;
  return (
    <Sheet open={!!p} onClose={onClose} title="Shop"
      footer={p && (p.in_stock ? (
        <button className="btn btn-primary w-full" disabled={busy} onClick={() => run(() => api.post(`/content/products/${p.id}/enquire`, { qty, note }), 'Reserved — collect it at the front desk 🛍️').then((r) => { if (r) { onReserved?.(); onClose(); } })}>
          {busy && <Spinner className="w-4 h-4" />}Reserve · pay at desk {money(p.price * qty)}
        </button>
      ) : <p className="text-center text-sm muted">Out of stock — ask at the desk when it's back.</p>)}>
      {p && (
        <div className="space-y-3">
          {p.image_key && <img src={img(p.image_key)} alt="" className="w-full aspect-square object-cover rounded-2xl bg-ink-900" />}
          {p.category && <p className="text-[11px] muted uppercase tracking-wide">{p.category}</p>}
          <h3 className="font-display text-xl font-bold leading-tight">{p.name}</h3>
          <p className="text-lg"><b>{money(p.price)}</b>{p.mrp && p.mrp > p.price ? <span className="text-sm muted line-through ml-2">{money(p.mrp)}</span> : null}</p>
          {p.description && <p className="text-sm leading-relaxed whitespace-pre-line muted">{p.description}</p>}
          {!!p.in_stock && (
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold flex-1">Quantity</span>
              <div className="flex items-center gap-1 rounded-full border border-paper-line dark:border-ink-600 p-1">
                <button className="icon-btn w-8 h-8" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Less">−</button>
                <span className="w-6 text-center font-bold">{qty}</span>
                <button className="icon-btn w-8 h-8" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="More">+</button>
              </div>
            </div>
          )}
          {!!p.in_stock && <input className="input" placeholder="Note for the desk (flavour, size…)" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} />}
        </div>
      )}
    </Sheet>
  );
}

export function ShopStrip({ products }: { products: Product[] }) {
  const [open, setOpen] = useState<Product | null>(null);
  if (!products.length) return null;
  return (
    <Section title="Gym shop" to="/shop">
      <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 snap-x pb-1">
        {products.map((p) => <div key={p.id} className="w-36 sm:w-44 shrink-0 snap-start flex"><ProductTile p={p} onOpen={() => setOpen(p)} /></div>)}
      </div>
      <ProductSheet product={open} onClose={() => setOpen(null)} />
    </Section>
  );
}

// ── Gallery ─────────────────────────────────────────────────────────────
export function AlbumTile({ a, className = '' }: { a: Album; className?: string }) {
  return (
    <Link to={`/gallery/${a.id}`} className={`relative block rounded-3xl overflow-hidden bg-ink-900 isolate ${className}`}>
      {a.cover ? <img src={img(a.cover)} alt="" className="absolute inset-0 w-full h-full object-cover -z-10" loading="lazy" /> : <Images className="w-8 h-8 m-auto text-ink-300" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent -z-10" />
      <div className="absolute inset-x-0 bottom-0 p-3">
        <p className="font-semibold text-white text-sm leading-tight line-clamp-2">{a.title}</p>
        <p className="text-[11px] text-white/70">{a.photos} photos{a.event_date ? ` · ${date(a.event_date, false)}` : ''}</p>
      </div>
    </Link>
  );
}

export function GalleryStrip({ albums }: { albums: Album[] }) {
  if (!albums.length) return null;
  return (
    <Section title="Gallery" to="/gallery">
      <div className="scroll-x -mx-4 px-4 sm:mx-0 sm:px-0 flex gap-3 snap-x pb-1">
        {albums.map((a) => <AlbumTile key={a.id} a={a} className="w-40 sm:w-52 aspect-[4/5] shrink-0 snap-start" />)}
      </div>
    </Section>
  );
}

// ── Bell ────────────────────────────────────────────────────────────────
export function BellButton({ unread }: { unread: number }) {
  return (
    <Link to="/news?tab=alerts" className="relative icon-btn w-12 h-12 card" aria-label={unread ? `${unread} new notifications` : 'Notifications'}>
      <Bell className="w-5 h-5" />
      {unread > 0 && <span className="absolute -top-0.5 -right-0.5 min-w-[20px] h-5 px-1 rounded-full bg-bad text-white text-[11px] font-bold flex items-center justify-center">{unread > 9 ? '9+' : unread}</span>}
    </Link>
  );
}
