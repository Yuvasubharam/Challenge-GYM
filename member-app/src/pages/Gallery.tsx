import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ChevronLeft, ChevronRight, Images, X } from 'lucide-react';
import { api } from '../lib/api';
import { date } from '../lib/format';
import { img, type Album } from '../lib/content';
import { ErrorBox, PageLoader, useLoad } from '../components/ui';
import { AlbumTile } from '../components/HomeContent';

export default function Gallery() {
  const { id } = useParams();
  return id ? <AlbumPage id={Number(id)} /> : <Albums />;
}

const Back = ({ to, title, sub }: { to: string; title: string; sub?: string }) => (
  <header className="flex items-center gap-2 pt-1">
    <Link to={to} className="icon-btn -ml-2" aria-label="Back"><ArrowLeft className="w-5 h-5" /></Link>
    <div className="min-w-0"><h1 className="text-2xl font-bold truncate">{title}</h1>{sub && <p className="text-sm muted">{sub}</p>}</div>
  </header>
);

function Albums() {
  const { data, error, reload } = useLoad(() => api.get<Album[]>('/content/albums'));
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-4">
      <Back to="/" title="Gallery" sub="Moments from Challenge Gym events" />
      {data.length === 0 ? (
        <div className="card card-pad text-center py-12"><Images className="w-8 h-8 mx-auto muted" /><p className="font-semibold mt-3">No photos yet</p></div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">{data.map((a) => <AlbumTile key={a.id} a={a} className="aspect-[4/5]" />)}</div>
      )}
    </div>
  );
}

interface Photo { id: number; image_key: string; caption: string | null }

function AlbumPage({ id }: { id: number }) {
  const { data, error, reload } = useLoad(() => api.get<{ album: { title: string; description: string | null; event_date: string | null }; photos: Photo[] }>(`/content/albums/${id}`), [id]);
  const [view, setView] = useState<number | null>(null);
  const touchX = useRef(0);
  const photos = data?.photos ?? [];
  useEffect(() => {
    if (view === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setView(null);
      if (e.key === 'ArrowRight') setView((v) => (v === null ? v : (v + 1) % photos.length));
      if (e.key === 'ArrowLeft') setView((v) => (v === null ? v : (v - 1 + photos.length) % photos.length));
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [view, photos.length]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  const cur = view !== null ? photos[view] : null;

  return (
    <div className="space-y-4">
      <Back to="/gallery" title={data.album.title} sub={[data.album.event_date && date(data.album.event_date), `${photos.length} photos`].filter(Boolean).join(' · ')} />
      {data.album.description && <p className="text-sm muted whitespace-pre-line">{data.album.description}</p>}
      <div className="grid grid-cols-3 gap-1.5 sm:gap-2">
        {photos.map((p, i) => (
          <button key={p.id} onClick={() => setView(i)} className="aspect-square rounded-xl overflow-hidden bg-ink-900">
            <img src={img(p.image_key)} alt={p.caption ?? ''} className="w-full h-full object-cover" loading="lazy" />
          </button>
        ))}
      </div>
      {cur && (
        <div className="fixed inset-0 z-[80] bg-black flex flex-col" role="dialog" aria-label="Photo viewer"
          onTouchStart={(e) => { touchX.current = e.touches[0].clientX; }}
          onTouchEnd={(e) => { const dx = e.changedTouches[0].clientX - touchX.current; if (Math.abs(dx) > 50) setView((v) => (v === null ? v : (v + (dx < 0 ? 1 : -1) + photos.length) % photos.length)); }}>
          <div className="flex items-center justify-between p-3 text-white pt-[max(env(safe-area-inset-top),0.75rem)]">
            <span className="text-sm">{view! + 1} / {photos.length}</span>
            <button className="icon-btn text-white" onClick={() => setView(null)} aria-label="Close"><X className="w-6 h-6" /></button>
          </div>
          <div className="flex-1 flex items-center justify-center relative min-h-0">
            <img src={img(cur.image_key)} alt={cur.caption ?? ''} className="max-w-full max-h-full object-contain" />
            {photos.length > 1 && <>
              <button className="hidden sm:flex absolute left-3 icon-btn bg-white/10 text-white" onClick={() => setView((view! - 1 + photos.length) % photos.length)} aria-label="Previous"><ChevronLeft className="w-6 h-6" /></button>
              <button className="hidden sm:flex absolute right-3 icon-btn bg-white/10 text-white" onClick={() => setView((view! + 1) % photos.length)} aria-label="Next"><ChevronRight className="w-6 h-6" /></button>
            </>}
          </div>
          {cur.caption && <p className="text-center text-white/80 text-sm p-4 safe-bottom">{cur.caption}</p>}
        </div>
      )}
    </div>
  );
}
