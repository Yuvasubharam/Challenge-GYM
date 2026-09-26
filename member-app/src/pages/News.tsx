import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, BellOff, BellRing, Megaphone, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { ago } from '../lib/format';
import { disablePush, enablePush, img, pushState, type Kind, type Post } from '../lib/content';
import { ErrorBox, PageLoader, Spinner, useAction, useLoad } from '../components/ui';
import { KindBadge, PostCard, PostSheet } from '../components/HomeContent';

type Tab = 'all' | Kind | 'alerts';

export default function News() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'all';
  const setTab = (t: Tab) => setParams(t === 'all' ? {} : { tab: t }, { replace: true });
  const [open, setOpen] = useState<Post | null>(null);

  return (
    <div className="space-y-4">
      <header className="flex items-center gap-2 pt-1">
        <Link to="/" className="icon-btn -ml-2" aria-label="Back"><ArrowLeft className="w-5 h-5" /></Link>
        <h1 className="text-2xl font-bold">News & events</h1>
      </header>
      <div className="scroll-x -mx-4 px-4"><div className="flex gap-2 w-max">
        {([['all', 'All'], ['event', 'Events'], ['offer', 'Offers'], ['notice', 'Notices'], ['alerts', '🔔 Notifications']] as [Tab, string][]).map(([v, l]) => (
          <button key={v} className={`chip ${tab === v ? 'chip-on' : ''}`} onClick={() => setTab(v)}>{l}</button>
        ))}
      </div></div>
      {tab === 'alerts' ? <Alerts onOpen={setOpen} /> : <Posts kind={tab === 'all' ? null : tab} onOpen={setOpen} />}
      <PostSheet post={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function Posts({ kind, onOpen }: { kind: Kind | null; onOpen: (p: Post) => void }) {
  const { data, error, reload } = useLoad(() => api.get<Post[]>(`/content/posts${kind ? `?kind=${kind}` : ''}`), [kind]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  if (!data.length) return <div className="card card-pad text-center py-12"><Megaphone className="w-8 h-8 mx-auto muted" /><p className="font-semibold mt-3">Nothing here right now</p></div>;
  return <div className="grid sm:grid-cols-2 gap-3">{data.map((p) => <PostCard key={p.id} p={p} wide onOpen={() => onOpen(p)} />)}</div>;
}

function Alerts({ onOpen }: { onOpen: (p: Post) => void }) {
  const { data, error, reload } = useLoad(() => api.get<{ items: Post[]; last_seen_id: number }>('/content/notifications'));
  const [seenBefore, setSeenBefore] = useState<number | null>(null);
  useEffect(() => {
    if (!data) return;
    if (seenBefore === null) setSeenBefore(data.last_seen_id);
    const top = data.items[0]?.id ?? 0;
    if (top > data.last_seen_id) void api.post('/content/notifications/seen', { id: top }).then(() => window.dispatchEvent(new Event('cg-notices-seen')));
  }, [data, seenBefore]);
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!data) return <PageLoader />;
  return (
    <div className="space-y-3">
      <PushCard />
      {data.items.length === 0 ? <p className="text-sm muted text-center py-8">No notifications yet.</p> : (
        <div className="card overflow-hidden">
          {data.items.map((p) => {
            const isNew = p.id > (seenBefore ?? data.last_seen_id);
            return (
              <button key={p.id} onClick={() => onOpen(p)} className={`w-full text-left flex gap-3 px-4 py-3 border-t first:border-t-0 border-paper-line dark:border-ink-700 ${isNew ? 'bg-lime/10' : ''}`}>
                {p.image_key ? <img src={img(p.image_key)} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" /> : <div className="w-12 h-12 rounded-xl bg-lime/20 text-lime-700 dark:text-lime flex items-center justify-center shrink-0"><BellRing className="w-5 h-5" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5"><KindBadge kind={p.kind} />{isNew && <span className="w-2 h-2 rounded-full bg-bad" />}<span className="text-[11px] muted ml-auto">{ago(p.created_at)}</span></div>
                  <p className="font-semibold text-sm mt-1 leading-snug">{p.title}</p>
                  {p.body && <p className="text-xs muted line-clamp-2 mt-0.5">{p.body}</p>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PushCard() {
  const [state, setState] = useState<'unsupported' | 'denied' | 'on' | 'off' | null>(null);
  const { busy, run } = useAction();
  useEffect(() => { void pushState().then(setState).catch(() => setState('unsupported')); }, []);
  if (state === null) return null;
  if (state === 'unsupported') return (
    <div className="card card-pad flex gap-3 text-sm"><Smartphone className="w-5 h-5 muted shrink-0" /><p className="muted">To get alerts on your phone, open this app from your Home Screen (Add to Home Screen) in Chrome or Safari.</p></div>
  );
  if (state === 'denied') return (
    <div className="card card-pad flex gap-3 text-sm"><BellOff className="w-5 h-5 text-warn shrink-0" /><p className="muted">Notifications are blocked for this app. Allow them in your browser/site settings to get gym alerts.</p></div>
  );
  return (
    <div className="card-ink p-4 flex items-center gap-3">
      <div className={`w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 ${state === 'on' ? 'bg-lime text-ink-900' : 'bg-white/10 text-white'}`}>{state === 'on' ? <BellRing className="w-5 h-5" /> : <BellOff className="w-5 h-5" />}</div>
      <div className="flex-1 min-w-0">
        <p className="font-semibold text-white">Phone notifications {state === 'on' ? 'on' : 'off'}</p>
        <p className="text-xs text-ink-300">{state === 'on' ? 'You\'ll get gym news and events on this device.' : 'Get events, offers and holiday timings instantly.'}</p>
      </div>
      <button className={`btn btn-sm ${state === 'on' ? 'btn-outline text-white border-ink-600' : 'btn-primary'}`} disabled={busy}
        onClick={() => run(async () => { if (state === 'on') await disablePush(); else await enablePush(); setState(await pushState()); }, state === 'on' ? 'Notifications turned off' : 'Notifications on 🔔')}>
        {busy && <Spinner className="w-4 h-4" />}{state === 'on' ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  );
}
