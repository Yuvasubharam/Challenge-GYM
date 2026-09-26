import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown, ArrowUp, BellRing, CalendarDays, Eye, EyeOff, ImagePlus, Images, Megaphone, Pencil, Pin, Plus, Send, ShoppingBag, Sparkles, Star, Trash2, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { ago, date, money } from '../lib/format';
import { Confirm, Empty, ErrorBox, Field, Modal, PageLoader, Segmented, Spinner, useAction, useLoad, useToast } from '../components/ui';
import { PageHeader } from '../components/Layout';
import { useSession } from '../lib/session';

// ── Types ───────────────────────────────────────────────────────────────
type Kind = 'notice' | 'event' | 'offer';
interface Post {
  id: number; kind: Kind; title: string; body: string | null; image_key: string | null; event_date: string | null; event_time: string | null;
  cta_label: string | null; cta_link: string | null; expires_on: string | null; pinned: number; published: number; notify: number;
  pushed_at: string | null; created_by: string | null; created_at: string;
}
interface Banner { id: number; title: string; subtitle: string | null; image_key: string | null; cta_label: string | null; cta_link: string | null; starts_on: string | null; ends_on: string | null; sort: number; active: number }
interface Product { id: number; name: string; description: string | null; category: string | null; price: number; mrp: number | null; image_key: string | null; in_stock: number; featured: number; active: number; sort: number; open_enquiries: number }
interface Enquiry { id: number; product: string; price: number; qty: number; note: string | null; status: 'new' | 'done' | 'cancelled'; member_name: string; essl_id: string | null; mobile: string | null; member_id: number; created_at: string; handled_by: string | null }
interface Album { id: number; title: string; description: string | null; event_date: string | null; cover_key: string | null; cover: string | null; published: number; photos: number }
interface Photo { id: number; image_key: string; caption: string | null }
interface Summary { posts: number; banners: number; products: number; enquiries: number; albums: number; push_devices: number; push_members: number; push_ready: boolean }

type Tab = 'posts' | 'carousel' | 'shop' | 'gallery';

export const img = (key: string | null | undefined) => (key ? `/api/content/img/${key}` : '');
const KIND: Record<Kind, { label: string; cls: string }> = {
  notice: { label: 'Notice', cls: 'bg-info/15 text-blue-700 dark:text-info' },
  event: { label: 'Event', cls: 'bg-lime/25 text-lime-800 dark:text-lime' },
  offer: { label: 'Offer', cls: 'bg-warn/15 text-amber-700 dark:text-warn' },
};
const LINKS = [
  { value: '', label: 'No button' },
  { value: '/plan', label: 'Renew / plans' },
  { value: '/shop', label: 'Shop' },
  { value: '/gallery', label: 'Gallery' },
  { value: '/news', label: 'News & events' },
  { value: '/train', label: 'Workouts' },
  { value: '/diet', label: 'Diet tracker' },
  { value: 'custom', label: 'Web link (https://)…' },
];

// ── Image upload (resized in the browser → small, fast R2 objects) ──────
async function shrink(file: File, max = 1600): Promise<Blob> {
  if (file.type === 'image/gif' || !file.type.startsWith('image/')) return file;
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 600_000) return file;
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * scale);
  cv.height = Math.round(bmp.height * scale);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  const out = await new Promise<Blob | null>((r) => cv.toBlob(r, 'image/webp', 0.82));
  return out && out.size < file.size ? out : file;
}
export const uploadImage = async (file: File) => (await api.upload<{ key: string }>('/content/upload', await shrink(file))).key;

function ImagePicker({ value, onChange, aspect = 'aspect-[16/9]', hint }: { value: string | null; onChange: (k: string | null) => void; aspect?: string; hint?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (f?: File) => {
    if (!f) return;
    setBusy(true);
    try { onChange(await uploadImage(f)); } catch (e) { toast('error', (e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div>
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
      {value ? (
        <div className={`relative ${aspect} rounded-2xl overflow-hidden bg-ink-900`}>
          <img src={img(value)} alt="" className="w-full h-full object-cover" />
          <div className="absolute top-2 right-2 flex gap-1.5">
            <button type="button" className="btn btn-sm bg-black/60 text-white" onClick={() => ref.current?.click()} disabled={busy}>{busy ? <Spinner className="w-4 h-4" /> : 'Replace'}</button>
            <button type="button" className="icon-btn bg-black/60 text-white" onClick={() => onChange(null)} aria-label="Remove image"><X className="w-4 h-4" /></button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => ref.current?.click()} disabled={busy}
          className={`w-full ${aspect} rounded-2xl border-2 border-dashed border-paper-line dark:border-ink-600 flex flex-col items-center justify-center gap-1.5 muted hover:border-lime hover:text-lime-700 dark:hover:text-lime transition`}>
          {busy ? <Spinner /> : <ImagePlus className="w-6 h-6" />}
          <span className="text-sm font-semibold">{busy ? 'Uploading…' : 'Add image'}</span>
          {hint && <span className="text-[11px]">{hint}</span>}
        </button>
      )}
    </div>
  );
}

function LinkPicker({ label, link, onLabel, onLink }: { label: string; link: string; onLabel: (v: string) => void; onLink: (v: string) => void }) {
  const preset = LINKS.some((l) => l.value === link && l.value !== 'custom') ? link : link ? 'custom' : '';
  const [mode, setMode] = useState(preset);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Field label="Button opens">
        <select className="input" value={mode} onChange={(e) => { setMode(e.target.value); onLink(e.target.value === 'custom' ? 'https://' : e.target.value); if (!e.target.value) onLabel(''); }}>
          {LINKS.map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
        </select>
      </Field>
      <Field label="Button text"><input className="input" value={label} disabled={!mode} onChange={(e) => onLabel(e.target.value)} placeholder={mode ? 'Learn more' : '—'} maxLength={30} /></Field>
      {mode === 'custom' && <Field label="Web link" className="col-span-2"><input className="input" value={link} onChange={(e) => onLink(e.target.value)} placeholder="https://instagram.com/…" /></Field>}
    </div>
  );
}

const Check = ({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode }) => (
  <label className="flex items-start gap-2 text-sm cursor-pointer"><input type="checkbox" className="accent-lime w-4 h-4 mt-0.5" checked={checked} onChange={(e) => onChange(e.target.checked)} /><span>{children}</span></label>
);

// ── Page ────────────────────────────────────────────────────────────────
export default function ContentPage() {
  const [tab, setTab] = useState<Tab>(() => (sessionStorage.getItem('cg-content-tab') as Tab) || 'posts');
  useEffect(() => { try { sessionStorage.setItem('cg-content-tab', tab); } catch { /* ignore */ } }, [tab]);
  const { data: sum, reload: reloadSum } = useLoad(() => api.get<Summary>('/content/summary'));
  return (
    <>
      <PageHeader title="Announcements & content" subtitle="Everything members see on their app home: news, events, offers, the carousel, shop and gallery." />
      {sum && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          <Tile icon={<Megaphone className="w-4 h-4" />} label="Live posts" value={sum.posts} />
          <Tile icon={<Sparkles className="w-4 h-4" />} label="Carousel slides" value={sum.banners} />
          <Tile icon={<ShoppingBag className="w-4 h-4" />} label="Products" value={sum.products} note={sum.enquiries ? `${sum.enquiries} new enquiries` : undefined} />
          <Tile icon={<BellRing className="w-4 h-4" />} label="Phones subscribed" value={sum.push_members} note={sum.push_ready ? undefined : 'Push keys not set'} />
        </div>
      )}
      <div className="mb-5">
        <Segmented value={tab} onChange={setTab} options={[
          { value: 'posts', label: 'Posts & events' },
          { value: 'carousel', label: 'Home carousel' },
          { value: 'shop', label: 'Shop', count: sum?.enquiries || undefined },
          { value: 'gallery', label: 'Gallery' },
        ]} />
      </div>
      {tab === 'posts' && <PostsTab pushReady={!!sum?.push_ready} phones={sum?.push_members ?? 0} onChange={reloadSum} />}
      {tab === 'carousel' && <CarouselTab onChange={reloadSum} />}
      {tab === 'shop' && <ShopTab onChange={reloadSum} />}
      {tab === 'gallery' && <GalleryTab onChange={reloadSum} />}
    </>
  );
}

const Tile = ({ icon, label, value, note }: { icon: ReactNode; label: string; value: number; note?: string }) => (
  <div className="card p-4">
    <p className="text-xs muted flex items-center gap-1.5">{icon}{label}</p>
    <p className="font-display text-2xl font-bold mt-1">{value}</p>
    {note && <p className="text-[11px] text-warn mt-0.5">{note}</p>}
  </div>
);

// ── Posts ───────────────────────────────────────────────────────────────
const blankPost = { kind: 'notice' as Kind, title: '', body: '', image_key: null as string | null, event_date: '', event_time: '', cta_label: '', cta_link: '', expires_on: '', pinned: false, notify: true, published: true };
type PostForm = typeof blankPost;

function PostsTab({ pushReady, phones, onChange }: { pushReady: boolean; phones: number; onChange: () => void }) {
  const { can } = useSession();
  const { data, error, reload } = useLoad(() => api.get<Post[]>('/content/posts'));
  const { busy, run } = useAction();
  const toast = useToast();
  const [edit, setEdit] = useState<{ id: number | null; f: PostForm } | null>(null);
  const [push, setPush] = useState(true);
  const [del, setDel] = useState<Post | null>(null);
  const [filter, setFilter] = useState<'all' | Kind>('all');
  const [sending, setSending] = useState<number | null>(null);
  const refresh = () => { void reload(); onChange(); };

  const sendPush = async (id: number) => {
    setSending(id);
    try {
      let after = 0, sent = 0, failed = 0;
      for (let i = 0; i < 100; i++) {
        const r = await api.post<{ sent: number; failed: number; next: number | null; total: number }>(`/content/posts/${id}/push`, { after });
        sent += r.sent; failed += r.failed;
        if (r.next === null) break;
        after = r.next;
      }
      toast('ok', `Sent to ${sent} phone${sent === 1 ? '' : 's'}${failed ? ` · ${failed} failed` : ''}`);
      void reload();
    } catch (e) {
      toast('error', (e as Error).message);
    } finally {
      setSending(null);
    }
  };

  const save = async () => {
    if (!edit) return;
    const f = edit.f;
    const body = { ...f, event_date: f.kind === 'event' ? f.event_date || null : null, event_time: f.kind === 'event' ? f.event_time : null, expires_on: f.expires_on || null, cta_link: f.cta_link || null, cta_label: f.cta_link ? f.cta_label || 'Learn more' : null };
    const r = await run(async () => edit.id ? (await api.patch(`/content/posts/${edit.id}`, body), { id: edit.id }) : api.post<{ id: number }>('/content/posts', body), edit.id ? 'Saved' : 'Published');
    if (!r) return;
    setEdit(null);
    refresh();
    if (!edit.id && f.published && push && pushReady && phones > 0) void sendPush(r.id);
  };

  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const list = data.filter((p) => filter === 'all' || p.kind === filter);
  const f = edit?.f;
  const set = (patch: Partial<PostForm>) => edit && setEdit({ ...edit, f: { ...edit.f, ...patch } });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented value={filter} onChange={setFilter} options={[
          { value: 'all', label: 'All', count: data.length },
          { value: 'notice', label: 'Notices', count: data.filter((p) => p.kind === 'notice').length },
          { value: 'event', label: 'Events', count: data.filter((p) => p.kind === 'event').length },
          { value: 'offer', label: 'Offers', count: data.filter((p) => p.kind === 'offer').length },
        ]} />
        <button className="btn btn-primary" onClick={() => { setPush(true); setEdit({ id: null, f: { ...blankPost } }); }}><Plus className="w-4 h-4" />New post</button>
      </div>

      {list.length === 0 ? (
        <div className="card"><Empty icon={<Megaphone className="w-6 h-6" />} title="Nothing posted yet" hint="Share gym news, holiday timings, upcoming events or offers. Add a photo to make it stand out." /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => (
            <article key={p.id} className={`card overflow-hidden flex flex-col ${p.published ? '' : 'opacity-60'}`}>
              {p.image_key && <img src={img(p.image_key)} alt="" className="w-full aspect-[16/9] object-cover bg-ink-900" loading="lazy" />}
              <div className="p-4 flex-1 flex flex-col">
                <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                  <span className={`badge ${KIND[p.kind].cls}`}>{KIND[p.kind].label}</span>
                  {!!p.pinned && <span className="badge bg-ink-300/20"><Pin className="w-3 h-3" />Pinned</span>}
                  {!p.published && <span className="badge bg-ink-300/20">Hidden</span>}
                  {!!p.notify && <span className="badge bg-ink-300/20" title="Appears in the members' notification bell"><BellRing className="w-3 h-3" />Bell</span>}
                  {p.pushed_at && <span className="badge bg-ok/15 text-green-700 dark:text-ok" title={`Sent ${ago(p.pushed_at)}`}><Send className="w-3 h-3" />Pushed</span>}
                </div>
                <p className="font-semibold leading-snug">{p.title}</p>
                {p.kind === 'event' && p.event_date && <p className="text-xs font-semibold text-lime-700 dark:text-lime mt-1 flex items-center gap-1"><CalendarDays className="w-3.5 h-3.5" />{date(p.event_date)}{p.event_time ? ` · ${p.event_time}` : ''}</p>}
                {p.body && <p className="text-sm muted mt-1 line-clamp-3 whitespace-pre-line">{p.body}</p>}
                <p className="text-[11px] muted mt-2">{p.created_by ?? '—'} · {date(p.created_at.slice(0, 10))}{p.expires_on ? ` · until ${date(p.expires_on)}` : ''}{p.cta_link ? ` · button → ${p.cta_link}` : ''}</p>
                <div className="flex items-center gap-1 mt-auto pt-3 -mb-1">
                  <button className="icon-btn" title="Edit" onClick={() => setEdit({ id: p.id, f: { kind: p.kind, title: p.title, body: p.body ?? '', image_key: p.image_key, event_date: p.event_date ?? '', event_time: p.event_time ?? '', cta_label: p.cta_label ?? '', cta_link: p.cta_link ?? '', expires_on: p.expires_on ?? '', pinned: !!p.pinned, notify: !!p.notify, published: !!p.published } })}><Pencil className="w-4 h-4" /></button>
                  <button className="icon-btn" title={p.pinned ? 'Unpin' : 'Pin to top'} onClick={() => run(() => api.patch(`/content/posts/${p.id}`, { pinned: !p.pinned })).then(refresh)}><Pin className={`w-4 h-4 ${p.pinned ? 'text-lime-700 dark:text-lime' : ''}`} /></button>
                  <button className="icon-btn" title={p.published ? 'Hide from members' : 'Show to members'} onClick={() => run(() => api.patch(`/content/posts/${p.id}`, { published: !p.published })).then(refresh)}>{p.published ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                  {can('owner', 'admin') && pushReady && !!p.published && (
                    <button className="btn btn-ghost btn-sm ml-auto" disabled={sending !== null || phones === 0} title={phones === 0 ? 'No member has turned on phone notifications yet' : `Send to ${phones} member phones`}
                      onClick={() => void sendPush(p.id)}>{sending === p.id ? <Spinner className="w-4 h-4" /> : <Send className="w-4 h-4" />}{p.pushed_at ? 'Resend' : 'Send to phones'}</button>
                  )}
                  <button className={`icon-btn text-bad ${can('owner', 'admin') && pushReady && p.published ? '' : 'ml-auto'}`} title="Delete" onClick={() => setDel(p)}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}

      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit post' : 'New post'} wide
        footer={<>
          <button className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !f?.title || (f?.kind === 'event' && !f.event_date)} onClick={() => void save()}>{busy && <Spinner className="w-4 h-4" />}{edit?.id ? 'Save' : f?.published ? 'Publish' : 'Save as hidden'}</button>
        </>}>
        {f && (
          <div className="space-y-4">
            <Segmented value={f.kind} onChange={(kind) => set({ kind })} options={[{ value: 'notice', label: '📢 Notice' }, { value: 'event', label: '🎉 Event' }, { value: 'offer', label: '🏷️ Offer' }]} />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-3">
                <Field label="Title"><input className="input" value={f.title} maxLength={120} onChange={(e) => set({ title: e.target.value })} placeholder={f.kind === 'event' ? 'Deadlift challenge – Sunday' : f.kind === 'offer' ? 'Diwali offer: 20% off 12 months' : 'Gym closed on 2 Oct'} /></Field>
                {f.kind === 'event' && (
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Event date"><input type="date" className="input" value={f.event_date} onChange={(e) => set({ event_date: e.target.value })} /></Field>
                    <Field label="Time (optional)"><input className="input" value={f.event_time} maxLength={40} onChange={(e) => set({ event_time: e.target.value })} placeholder="6:00 AM" /></Field>
                  </div>
                )}
                <Field label="Message"><textarea className="input" rows={5} value={f.body} maxLength={4000} onChange={(e) => set({ body: e.target.value })} /></Field>
              </div>
              <div className="space-y-3">
                <Field label="Image (optional)"><ImagePicker value={f.image_key} onChange={(image_key) => set({ image_key })} hint="Poster, event photo or offer banner" /></Field>
                <LinkPicker label={f.cta_label} link={f.cta_link} onLabel={(cta_label) => set({ cta_label })} onLink={(cta_link) => set({ cta_link })} />
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 items-end">
              <Field label="Hide automatically after" hint={f.kind === 'event' ? 'Events disappear after their date anyway.' : 'Leave empty to keep it up.'}><input type="date" className="input" value={f.expires_on} onChange={(e) => set({ expires_on: e.target.value })} /></Field>
              <div className="space-y-2 pb-1">
                <Check checked={f.pinned} onChange={(pinned) => set({ pinned })}>Pin to top</Check>
                <Check checked={f.published} onChange={(published) => set({ published })}>Visible to members</Check>
                <Check checked={f.notify} onChange={(notify) => set({ notify })}>Show in the notification bell 🔔</Check>
              </div>
            </div>
            {!edit?.id && f.published && (
              <div className="rounded-2xl bg-lime/10 border border-lime/30 p-3">
                {pushReady && phones > 0 && can('owner', 'admin') ? (
                  <Check checked={push} onChange={setPush}><b>Send to phones now</b> — {phones} member{phones === 1 ? '' : 's'} turned on notifications</Check>
                ) : (
                  <p className="text-xs muted">{!pushReady ? 'Phone notifications need VAPID keys on the server (see README).' : phones === 0 ? 'No member has turned on phone notifications yet — they can do it from the bell on their app.' : 'Only owners/admins can send phone notifications.'}</p>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>
      <Confirm open={!!del} title="Delete post?" danger confirmLabel="Delete" busy={busy} message={<>“{del?.title}” will be removed from the member app. To keep it for later, hide it instead.</>}
        onClose={() => setDel(null)} onConfirm={() => del && run(() => api.del(`/content/posts/${del.id}`), 'Deleted').then(() => { setDel(null); refresh(); })} />
    </>
  );
}

// ── Carousel ────────────────────────────────────────────────────────────
const blankBanner = { title: '', subtitle: '', image_key: null as string | null, cta_label: '', cta_link: '', starts_on: '', ends_on: '', active: true };
type BannerForm = typeof blankBanner;

function useReorder<T extends { id: number }>(path: string, rows: T[] | null, reload: () => void) {
  const { run } = useAction();
  return (i: number, dir: -1 | 1) => {
    if (!rows) return;
    const j = i + dir;
    if (j < 0 || j >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[i], ids[j]] = [ids[j], ids[i]];
    void run(() => api.post(`/content/${path}/order`, { ids })).then(reload);
  };
}

function CarouselTab({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useLoad(() => api.get<Banner[]>('/content/banners'));
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<{ id: number | null; f: BannerForm } | null>(null);
  const [del, setDel] = useState<Banner | null>(null);
  const refresh = () => { void reload(); onChange(); };
  const move = useReorder('banners', data, refresh);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const f = edit?.f;
  const set = (p: Partial<BannerForm>) => edit && setEdit({ ...edit, f: { ...edit.f, ...p } });
  const save = () => edit && run(() => {
    const b = { ...edit.f, starts_on: edit.f.starts_on || null, ends_on: edit.f.ends_on || null, cta_link: edit.f.cta_link || null, cta_label: edit.f.cta_link ? edit.f.cta_label || 'Explore' : null };
    return edit.id ? api.patch(`/content/banners/${edit.id}`, b) : api.post('/content/banners', b);
  }, 'Saved').then((r) => { if (r) { setEdit(null); refresh(); } });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm muted">Slides rotate at the top of the member home screen. Wide images (16:9) look best.</p>
        <button className="btn btn-primary" onClick={() => setEdit({ id: null, f: { ...blankBanner } })}><Plus className="w-4 h-4" />New slide</button>
      </div>
      {data.length === 0 ? (
        <div className="card"><Empty icon={<Sparkles className="w-6 h-6" />} title="No slides yet" hint="Promote a new batch, a transformation challenge, supplements or a festival offer." /></div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((b, i) => (
            <div key={b.id} className={`card overflow-hidden ${b.active ? '' : 'opacity-60'}`}>
              <BannerPreview b={b} />
              <div className="p-3 flex items-center gap-1">
                <span className="text-xs muted flex-1 truncate">
                  {b.active ? (b.starts_on || b.ends_on ? `${b.starts_on ? date(b.starts_on, false) : 'now'} → ${b.ends_on ? date(b.ends_on, false) : '∞'}` : 'Always on') : 'Off'}
                  {b.cta_link ? ` · → ${b.cta_link}` : ''}
                </span>
                <button className="icon-btn" title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></button>
                <button className="icon-btn" title="Move later" disabled={i === data.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                <button className="icon-btn" title={b.active ? 'Turn off' : 'Turn on'} onClick={() => run(() => api.patch(`/content/banners/${b.id}`, { active: !b.active })).then(refresh)}>{b.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}</button>
                <button className="icon-btn" title="Edit" onClick={() => setEdit({ id: b.id, f: { title: b.title, subtitle: b.subtitle ?? '', image_key: b.image_key, cta_label: b.cta_label ?? '', cta_link: b.cta_link ?? '', starts_on: b.starts_on ?? '', ends_on: b.ends_on ?? '', active: !!b.active } })}><Pencil className="w-4 h-4" /></button>
                <button className="icon-btn text-bad" title="Delete" onClick={() => setDel(b)}><Trash2 className="w-4 h-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit slide' : 'New slide'} wide
        footer={<><button className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !f?.title} onClick={() => void save()}>{busy && <Spinner className="w-4 h-4" />}Save</button></>}>
        {f && (
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-3">
              <Field label="Image"><ImagePicker value={f.image_key} onChange={(image_key) => set({ image_key })} hint="1600 × 900 recommended" /></Field>
              <p className="text-xs muted">Preview</p>
              <BannerPreview b={f} />
            </div>
            <div className="space-y-3">
              <Field label="Headline"><input className="input" value={f.title} maxLength={80} onChange={(e) => set({ title: e.target.value })} placeholder="New batch · 6 AM Zumba" /></Field>
              <Field label="Sub-text"><input className="input" value={f.subtitle} maxLength={160} onChange={(e) => set({ subtitle: e.target.value })} placeholder="First class free for members" /></Field>
              <LinkPicker label={f.cta_label} link={f.cta_link} onLabel={(cta_label) => set({ cta_label })} onLink={(cta_link) => set({ cta_link })} />
              <div className="grid grid-cols-2 gap-3">
                <Field label="Show from"><input type="date" className="input" value={f.starts_on} onChange={(e) => set({ starts_on: e.target.value })} /></Field>
                <Field label="Show until"><input type="date" className="input" value={f.ends_on} onChange={(e) => set({ ends_on: e.target.value })} /></Field>
              </div>
              <Check checked={f.active} onChange={(active) => set({ active })}>Slide is on</Check>
            </div>
          </div>
        )}
      </Modal>
      <Confirm open={!!del} title="Delete slide?" danger confirmLabel="Delete" busy={busy} message={<>“{del?.title}” will be removed from the carousel.</>}
        onClose={() => setDel(null)} onConfirm={() => del && run(() => api.del(`/content/banners/${del.id}`), 'Deleted').then(() => { setDel(null); refresh(); })} />
    </>
  );
}

function BannerPreview({ b }: { b: Pick<Banner, 'title' | 'subtitle' | 'image_key' | 'cta_label' | 'cta_link'> }) {
  return (
    <div className="relative aspect-[16/9] bg-ink-900 overflow-hidden isolate">
      {b.image_key ? <img src={img(b.image_key)} alt="" className="absolute inset-0 w-full h-full object-cover -z-10" />
        : <div className="absolute -right-10 -top-10 w-40 h-40 rounded-full bg-lime/15 -z-10" />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent -z-10" />
      <div className="absolute inset-x-0 bottom-0 p-4">
        <p className="font-display font-bold text-white text-lg leading-tight">{b.title || 'Headline'}</p>
        {b.subtitle && <p className="text-sm text-white/80 mt-0.5">{b.subtitle}</p>}
        {b.cta_link && <span className="inline-block mt-2 rounded-full bg-lime text-ink-900 text-xs font-bold px-3 py-1.5">{b.cta_label || 'Explore'}</span>}
      </div>
    </div>
  );
}

// ── Shop ────────────────────────────────────────────────────────────────
const blankProduct = { name: '', description: '', category: '', price: '' as number | '', mrp: '' as number | '', image_key: null as string | null, in_stock: true, featured: false, active: true };
type ProductForm = typeof blankProduct;

function ShopTab({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useLoad(() => api.get<Product[]>('/content/products'));
  const [view, setView] = useState<'products' | 'enquiries'>('products');
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<{ id: number | null; f: ProductForm } | null>(null);
  const [del, setDel] = useState<Product | null>(null);
  const refresh = () => { void reload(); onChange(); };
  const move = useReorder('products', data, refresh);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const open = data.reduce((s, p) => s + p.open_enquiries, 0);
  const cats = [...new Set(data.map((p) => p.category).filter(Boolean))] as string[];
  const f = edit?.f;
  const set = (p: Partial<ProductForm>) => edit && setEdit({ ...edit, f: { ...edit.f, ...p } });
  const save = () => edit && run(() => {
    const b = { ...edit.f, mrp: edit.f.mrp === '' ? null : edit.f.mrp };
    return edit.id ? api.patch(`/content/products/${edit.id}`, b) : api.post('/content/products', b);
  }, 'Saved').then((r) => { if (r) { setEdit(null); refresh(); } });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <Segmented value={view} onChange={setView} options={[{ value: 'products', label: 'Products', count: data.length }, { value: 'enquiries', label: 'Enquiries', count: open || undefined }]} />
        {view === 'products' && <button className="btn btn-primary" onClick={() => setEdit({ id: null, f: { ...blankProduct } })}><Plus className="w-4 h-4" />Add product</button>}
      </div>
      {view === 'enquiries' ? <Enquiries onChange={refresh} /> : data.length === 0 ? (
        <div className="card"><Empty icon={<ShoppingBag className="w-6 h-6" />} title="No products yet" hint="Showcase supplements, shakers, gloves or merch. Members tap “Reserve” and you hand it over at the desk." /></div>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {data.map((p, i) => (
            <div key={p.id} className={`card overflow-hidden flex flex-col ${p.active ? '' : 'opacity-50'}`}>
              <div className="relative aspect-square bg-paper dark:bg-ink-900">
                {p.image_key ? <img src={img(p.image_key)} alt="" className="w-full h-full object-cover" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center muted"><ShoppingBag className="w-8 h-8" /></div>}
                <div className="absolute top-2 left-2 flex gap-1">
                  {!!p.featured && <span className="badge bg-lime text-ink-900"><Star className="w-3 h-3" />Home</span>}
                  {!p.in_stock && <span className="badge bg-bad text-white">Out of stock</span>}
                </div>
                {p.open_enquiries > 0 && <button onClick={() => setView('enquiries')} className="absolute top-2 right-2 badge bg-warn text-ink-900">{p.open_enquiries} new</button>}
              </div>
              <div className="p-3 flex-1 flex flex-col">
                {p.category && <p className="text-[11px] muted uppercase tracking-wide">{p.category}</p>}
                <p className="font-semibold leading-snug line-clamp-2">{p.name}</p>
                <p className="mt-1"><b>{money(p.price)}</b>{p.mrp && p.mrp > p.price ? <span className="text-xs muted line-through ml-1.5">{money(p.mrp)}</span> : null}</p>
                <div className="flex items-center gap-0.5 mt-auto pt-2 -mx-1">
                  <button className="icon-btn" title="Edit" onClick={() => setEdit({ id: p.id, f: { name: p.name, description: p.description ?? '', category: p.category ?? '', price: p.price, mrp: p.mrp ?? '', image_key: p.image_key, in_stock: !!p.in_stock, featured: !!p.featured, active: !!p.active } })}><Pencil className="w-4 h-4" /></button>
                  <button className="icon-btn" title={p.featured ? 'Remove from home' : 'Feature on home'} onClick={() => run(() => api.patch(`/content/products/${p.id}`, { featured: !p.featured })).then(refresh)}><Star className={`w-4 h-4 ${p.featured ? 'fill-lime text-lime-700 dark:text-lime' : ''}`} /></button>
                  <button className="icon-btn" title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="w-4 h-4" /></button>
                  <button className="icon-btn" title="Move later" disabled={i === data.length - 1} onClick={() => move(i, 1)}><ArrowDown className="w-4 h-4" /></button>
                  <button className="icon-btn text-bad ml-auto" title="Delete" onClick={() => setDel(p)}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit product' : 'Add product'} wide
        footer={<><button className="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !f?.name || f?.price === ''} onClick={() => void save()}>{busy && <Spinner className="w-4 h-4" />}Save</button></>}>
        {f && (
          <div className="grid gap-4 sm:grid-cols-[220px_1fr]">
            <Field label="Photo"><ImagePicker value={f.image_key} onChange={(image_key) => set({ image_key })} aspect="aspect-square" /></Field>
            <div className="space-y-3">
              <Field label="Name"><input className="input" value={f.name} maxLength={100} onChange={(e) => set({ name: e.target.value })} placeholder="Whey protein 1 kg – chocolate" /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Price ₹"><input className="input" inputMode="numeric" value={f.price} onChange={(e) => set({ price: e.target.value === '' ? '' : Math.max(0, Number(e.target.value.replace(/\D/g, ''))) })} /></Field>
                <Field label="MRP ₹" hint="Optional"><input className="input" inputMode="numeric" value={f.mrp} onChange={(e) => set({ mrp: e.target.value === '' ? '' : Math.max(0, Number(e.target.value.replace(/\D/g, ''))) })} /></Field>
                <Field label="Category">
                  <input className="input" list="cg-cats" value={f.category} maxLength={40} onChange={(e) => set({ category: e.target.value })} placeholder="Supplements" />
                  <datalist id="cg-cats">{[...new Set([...cats, 'Supplements', 'Accessories', 'Apparel', 'Drinks'])].map((c) => <option key={c} value={c} />)}</datalist>
                </Field>
              </div>
              <Field label="Description"><textarea className="input" rows={3} value={f.description} maxLength={1500} onChange={(e) => set({ description: e.target.value })} /></Field>
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <Check checked={f.in_stock} onChange={(in_stock) => set({ in_stock })}>In stock</Check>
                <Check checked={f.featured} onChange={(featured) => set({ featured })}>Feature on member home</Check>
                <Check checked={f.active} onChange={(active) => set({ active })}>Visible in shop</Check>
              </div>
            </div>
          </div>
        )}
      </Modal>
      <Confirm open={!!del} title="Delete product?" danger confirmLabel="Delete" busy={busy} message={<>“{del?.name}” and its enquiries will be removed. To keep it, untick “Visible in shop” instead.</>}
        onClose={() => setDel(null)} onConfirm={() => del && run(() => api.del(`/content/products/${del.id}`), 'Deleted').then(() => { setDel(null); refresh(); })} />
    </>
  );
}

function Enquiries({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState<'new' | 'done' | 'cancelled'>('new');
  const { data, reload } = useLoad(() => api.get<Enquiry[]>(`/content/enquiries?status=${status}`), [status]);
  const { run } = useAction();
  const mark = (id: number, s: Enquiry['status']) => run(() => api.patch(`/content/enquiries/${id}`, { status: s })).then(() => { void reload(); onChange(); });
  return (
    <div className="card overflow-hidden">
      <div className="p-3 border-b border-paper-line dark:border-ink-700"><Segmented value={status} onChange={setStatus} options={[{ value: 'new', label: 'New' }, { value: 'done', label: 'Handed over' }, { value: 'cancelled', label: 'Cancelled' }]} /></div>
      {!data ? <PageLoader /> : data.length === 0 ? <p className="p-6 text-sm muted">No {status === 'new' ? 'new ' : ''}enquiries.</p> : (
        <div className="overflow-x-auto">
          <table className="table">
            <thead><tr><th>Member</th><th>Product</th><th>Qty</th><th>Amount</th><th>When</th><th /></tr></thead>
            <tbody>{data.map((e) => (
              <tr key={e.id}>
                <td><Link to={`/members/${e.member_id}`} className="font-semibold hover:underline">{e.member_name}</Link><p className="text-xs muted">{e.essl_id ?? '—'} · {e.mobile ?? 'no mobile'}</p></td>
                <td>{e.product}{e.note && <p className="text-xs muted">“{e.note}”</p>}</td>
                <td>{e.qty}</td>
                <td className="whitespace-nowrap">{money(e.price * e.qty)}</td>
                <td className="text-xs muted whitespace-nowrap">{ago(e.created_at)}{e.handled_by && status !== 'new' ? ` · ${e.handled_by}` : ''}</td>
                <td className="text-right whitespace-nowrap">
                  {e.status === 'new' ? <>
                    <button className="btn btn-primary btn-sm" onClick={() => void mark(e.id, 'done')}>Handed over</button>
                    <button className="btn btn-ghost btn-sm" onClick={() => void mark(e.id, 'cancelled')}>Cancel</button>
                  </> : <button className="btn btn-ghost btn-sm" onClick={() => void mark(e.id, 'new')}>Reopen</button>}
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Gallery ─────────────────────────────────────────────────────────────
function GalleryTab({ onChange }: { onChange: () => void }) {
  const { data, error, reload } = useLoad(() => api.get<Album[]>('/content/albums'));
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<{ id: number | null; title: string; description: string; event_date: string; published: boolean } | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const refresh = () => { void reload(); onChange(); };
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const album = data.find((a) => a.id === openId);
  if (album) return <AlbumView album={album} onBack={() => { setOpenId(null); refresh(); }} onEdit={() => setEdit({ id: album.id, title: album.title, description: album.description ?? '', event_date: album.event_date ?? '', published: !!album.published })} onChanged={refresh} editor={edit} setEditor={setEdit} />;

  const save = () => edit && run(async () => {
    const b = { title: edit.title, description: edit.description, event_date: edit.event_date || null, published: edit.published };
    if (edit.id) { await api.patch(`/content/albums/${edit.id}`, b); return edit.id; }
    return (await api.post<{ id: number }>('/content/albums', b)).id;
  }, 'Saved').then((id) => { if (id) { setEdit(null); refresh(); setOpenId(id); } });

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <p className="text-sm muted">One album per event — competitions, celebrations, transformations. Albums with photos appear in the member app.</p>
        <button className="btn btn-primary" onClick={() => setEdit({ id: null, title: '', description: '', event_date: '', published: true })}><Plus className="w-4 h-4" />New album</button>
      </div>
      {data.length === 0 ? (
        <div className="card"><Empty icon={<Images className="w-6 h-6" />} title="No albums yet" hint="Create an album, then drop in photos from the event." /></div>
      ) : (
        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
          {data.map((a) => (
            <button key={a.id} onClick={() => setOpenId(a.id)} className={`card overflow-hidden text-left group ${a.published ? '' : 'opacity-60'}`}>
              <div className="aspect-[4/3] bg-ink-900 overflow-hidden">
                {a.cover ? <img src={img(a.cover)} alt="" className="w-full h-full object-cover group-hover:scale-105 transition" loading="lazy" /> : <div className="w-full h-full flex items-center justify-center text-ink-300"><Images className="w-8 h-8" /></div>}
              </div>
              <div className="p-3">
                <p className="font-semibold truncate">{a.title}</p>
                <p className="text-xs muted">{a.photos} photo{a.photos === 1 ? '' : 's'}{a.event_date ? ` · ${date(a.event_date)}` : ''}{a.published ? '' : ' · hidden'}</p>
              </div>
            </button>
          ))}
        </div>
      )}
      <AlbumModal editor={edit} setEditor={setEdit} busy={busy} onSave={() => void save()} />
    </>
  );
}

type AlbumEditor = { id: number | null; title: string; description: string; event_date: string; published: boolean } | null;
function AlbumModal({ editor, setEditor, busy, onSave }: { editor: AlbumEditor; setEditor: (e: AlbumEditor) => void; busy: boolean; onSave: () => void }) {
  return (
    <Modal open={!!editor} onClose={() => setEditor(null)} title={editor?.id ? 'Edit album' : 'New album'}
      footer={<><button className="btn btn-outline" onClick={() => setEditor(null)}>Cancel</button><button className="btn btn-primary" disabled={busy || !editor?.title} onClick={onSave}>{busy && <Spinner className="w-4 h-4" />}{editor?.id ? 'Save' : 'Create & add photos'}</button></>}>
      {editor && (
        <div className="space-y-3">
          <Field label="Album title"><input className="input" value={editor.title} maxLength={100} onChange={(e) => setEditor({ ...editor, title: e.target.value })} placeholder="Powerlifting meet 2026" /></Field>
          <Field label="Event date"><input type="date" className="input" value={editor.event_date} onChange={(e) => setEditor({ ...editor, event_date: e.target.value })} /></Field>
          <Field label="Description (optional)"><textarea className="input" rows={3} value={editor.description} maxLength={1000} onChange={(e) => setEditor({ ...editor, description: e.target.value })} /></Field>
          <Check checked={editor.published} onChange={(published) => setEditor({ ...editor, published })}>Visible to members</Check>
        </div>
      )}
    </Modal>
  );
}

function AlbumView({ album, onBack, onEdit, onChanged, editor, setEditor }: { album: Album; onBack: () => void; onEdit: () => void; onChanged: () => void; editor: AlbumEditor; setEditor: (e: AlbumEditor) => void }) {
  const { data, reload } = useLoad(() => api.get<Photo[]>(`/content/albums/${album.id}/photos`), [album.id]);
  const { busy, run } = useAction();
  const toast = useToast();
  const ref = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [delAlbum, setDelAlbum] = useState(false);

  const addFiles = async (files: File[]) => {
    if (!files.length) return;
    setProgress({ done: 0, total: files.length });
    const keys: string[] = [];
    let failed = 0;
    // 3 uploads at a time
    const queue = [...files];
    await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
      for (let f = queue.shift(); f; f = queue.shift()) {
        try { keys.push(await uploadImage(f)); } catch { failed++; }
        setProgress((p) => p && { ...p, done: p.done + 1 });
      }
    }));
    if (keys.length) await run(() => api.post(`/content/albums/${album.id}/photos`, { keys }));
    setProgress(null);
    toast(failed ? 'error' : 'ok', `${keys.length} photo${keys.length === 1 ? '' : 's'} added${failed ? ` · ${failed} failed` : ''}`);
    void reload();
    onChanged();
  };
  const save = () => editor && run(() => api.patch(`/content/albums/${album.id}`, { title: editor.title, description: editor.description, event_date: editor.event_date || null, published: editor.published }), 'Saved')
    .then(() => { setEditor(null); onChanged(); });

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button className="btn btn-outline btn-sm" onClick={onBack}>← Albums</button>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-lg truncate">{album.title}</p>
          <p className="text-xs muted">{album.event_date ? date(album.event_date) : 'No date'} · {album.published ? 'Visible to members' : 'Hidden'}</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onEdit}><Pencil className="w-4 h-4" />Edit</button>
        <button className="btn btn-ghost btn-sm text-bad" onClick={() => setDelAlbum(true)}><Trash2 className="w-4 h-4" />Delete</button>
        <input ref={ref} type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addFiles([...(e.target.files ?? [])]); e.target.value = ''; }} />
        <button className="btn btn-primary btn-sm" disabled={!!progress} onClick={() => ref.current?.click()}>
          {progress ? <><Spinner className="w-4 h-4" />{progress.done}/{progress.total}</> : <><ImagePlus className="w-4 h-4" />Add photos</>}
        </button>
      </div>
      <div className="card p-3"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void addFiles([...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))); }}>
        {!data ? <PageLoader /> : data.length === 0 ? (
          <Empty icon={<ImagePlus className="w-6 h-6" />} title="Drop photos here" hint="Or use “Add photos”. They are resized automatically before upload." />
        ) : (
          <div className="grid gap-2 grid-cols-3 sm:grid-cols-4 lg:grid-cols-6">
            {data.map((p) => (
              <div key={p.id} className="relative group aspect-square rounded-xl overflow-hidden bg-ink-900">
                <img src={img(p.image_key)} alt={p.caption ?? ''} className="w-full h-full object-cover" loading="lazy" />
                <div className="absolute inset-x-0 bottom-0 p-1.5 flex gap-1 justify-end opacity-100 sm:opacity-0 group-hover:opacity-100 transition bg-gradient-to-t from-black/70">
                  <button className={`icon-btn w-8 h-8 text-white ${album.cover_key === p.image_key ? 'bg-lime text-ink-900' : 'bg-black/50'}`} title="Use as cover"
                    onClick={() => run(() => api.patch(`/content/albums/${album.id}`, { cover_key: p.image_key }), 'Cover set').then(onChanged)}><Star className="w-4 h-4" /></button>
                  <button className="icon-btn w-8 h-8 bg-black/50 text-white" title="Remove" disabled={busy}
                    onClick={() => run(() => api.del(`/content/photos/${p.id}`)).then(() => { void reload(); onChanged(); })}><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <AlbumModal editor={editor} setEditor={setEditor} busy={busy} onSave={() => void save()} />
      <Confirm open={delAlbum} title="Delete album?" danger confirmLabel="Delete album" busy={busy}
        message={<>“{album.title}” and all {data?.length ?? album.photos} photos will be deleted permanently.</>}
        onClose={() => setDelAlbum(false)} onConfirm={() => run(() => api.del(`/content/albums/${album.id}`), 'Album deleted').then(() => { setDelAlbum(false); onBack(); })} />
    </>
  );
}
