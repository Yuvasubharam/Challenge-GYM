import { Link } from 'react-router-dom';
import { ArrowRight, CalendarDays, Clock3, DoorClosed, DoorOpen, Dumbbell, Flame, GlassWater, Scale, Snowflake, Utensils, Wallet } from 'lucide-react';
import { api } from '../lib/api';
import { date, money } from '../lib/format';
import { useHome } from '../lib/home';
import { useFit } from '../lib/fitctx';
import { GOAL_LABEL, type Day } from '../lib/fit';
import { Avatar, ErrorBox, PageLoader, Ring, StatusBadge, useAction, useLoad, useToast } from '../components/ui';
import type { HomeContent } from '../lib/content';
import { BellButton, Carousel, GalleryStrip, NewsStrip, ShopStrip } from '../components/HomeContent';

export default function Home() {
  const { home: h, error, reload } = useHome();
  const { fit, edit } = useFit();
  const { data: day, reload: reloadDay } = useLoad(() => api.get<Day>('/fit/day'));
  const { data: cms } = useLoad(() => api.get<HomeContent>('/content/home'));
  const { run } = useAction();
  const toast = useToast();
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  if (!h) return <PageLoader />;

  const hour = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(11, 13));
  const greet = hour < 12 ? 'Good Morning' : hour < 17 ? 'Good Afternoon' : 'Good Evening';
  const p = h.plan;
  const left = p.days_left ?? 0;
  const needsRenew = ['expiring', 'expired', 'none'].includes(p.status);
  const prof = fit?.profile;
  const t = day?.targets;
  const kcalPct = t?.kcal && day ? (day.eaten.kcal / (t.kcal + day.burned)) * 100 : 0;
  const addGlass = () => day && (day.water_ml >= 5000
    ? toast('ok', '5 L today — that is the daily maximum 💧')
    : run(() => api.put('/fit/water', { ml: Math.min(5000, day.water_ml + 250) }), '+1 glass of water 💧').then(reloadDay));

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-3 pt-1">
        <div className="min-w-0">
          <p className="text-sm muted flex items-center gap-1">{greet} <Flame className="w-4 h-4 text-orange-500" /></p>
          <h1 className="text-2xl sm:text-3xl font-bold truncate">{h.member.name}</h1>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <BellButton unread={cms?.unread ?? 0} />
          <Link to="/profile" aria-label="Profile"><Avatar name={h.member.name} hasPhoto={!!h.member.photo_key} size={48} /></Link>
        </div>
      </header>

      {cms && <Carousel banners={cms.banners} />}

      {/* Today — calories ring + macros (reference "Health Grade" card) */}
      {prof && t?.kcal && day ? (
        <Link to="/diet" className="block card-ink p-5 relative overflow-hidden isolate">
          <div className="absolute -right-16 -top-16 w-56 h-56 rounded-full bg-lime/10 -z-10 pointer-events-none" />
          <div className="relative flex items-center gap-5">
            <Ring value={kcalPct} size={124} stroke={12} tone={day.remaining !== null && day.remaining < 0 ? 'bad' : 'lime'}>
              <div><p className="font-display text-3xl font-bold text-white leading-none">{Math.abs(Math.round(day.remaining ?? 0))}</p>
                <p className="text-[10px] text-ink-300 mt-1">{(day.remaining ?? 0) < 0 ? 'kcal over' : 'kcal left'}</p></div>
            </Ring>
            <div className="flex-1 min-w-0 space-y-2.5">
              <p className="text-xs text-ink-300">Today · {GOAL_LABEL[prof.goal]}</p>
              <div className="grid grid-cols-2 gap-2">
                <Mini icon={<Utensils className="w-3.5 h-3.5" />} label="Eaten" value={Math.round(day.eaten.kcal)} />
                <Mini icon={<Flame className="w-3.5 h-3.5" />} label="Burned" value={Math.round(day.burned)} accent />
              </div>
              <div>
                <div className="flex justify-between text-[11px] text-ink-300"><span>Protein</span><span>{Math.round(day.eaten.protein)} / {t.protein_g} g</span></div>
                <div className="h-1.5 rounded-full bg-white/10 mt-1 overflow-hidden"><div className="h-full bg-lime rounded-full" style={{ width: `${Math.min(100, (day.eaten.protein / (t.protein_g || 1)) * 100)}%` }} /></div>
              </div>
            </div>
          </div>
        </Link>
      ) : !prof ? (
        <button onClick={edit} className="w-full card-ink p-5 text-left flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-lime text-ink-900 flex items-center justify-center"><Scale className="w-6 h-6" /></div>
          <div className="flex-1"><p className="font-display font-bold text-white">Get your BMI & daily targets</p><p className="text-sm text-ink-300">Takes 30 seconds</p></div>
          <ArrowRight className="w-5 h-5 text-ink-300" />
        </button>
      ) : null}

      {/* Quick actions */}
      <section className="grid grid-cols-4 gap-2">
        <Quick to="/diet" icon={<Utensils className="w-5 h-5" />} label="Food" />
        <Quick to="/train" icon={<Dumbbell className="w-5 h-5" />} label="Workout" />
        <button onClick={addGlass} className="card p-3 flex flex-col items-center gap-1.5 active:scale-95 transition">
          <span className="w-10 h-10 rounded-2xl bg-info/15 text-info flex items-center justify-center"><GlassWater className="w-5 h-5" /></span>
          <span className="text-[11px] font-semibold">{day ? `${(day.water_ml / 1000).toFixed(1)} L` : 'Water'}</span>
        </button>
        <Quick to="/progress" icon={<Scale className="w-5 h-5" />} label={prof ? `BMI ${prof.bmi}` : 'Weight'} />
      </section>

      {/* Membership + door */}
      <Link to="/plan" className={`block card card-pad ${h.door.allowed ? '' : 'border-bad/40 dark:border-bad/40'}`}>
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${h.door.allowed ? 'bg-lime text-ink-900' : 'bg-bad/15 text-bad'}`}>
            {p.status === 'frozen' ? <Snowflake className="w-6 h-6" /> : h.door.allowed ? <DoorOpen className="w-6 h-6" /> : <DoorClosed className="w-6 h-6" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2"><p className="font-semibold truncate">{p.category ?? 'Membership'}</p><StatusBadge status={p.status} /></div>
            <p className="text-sm muted">{p.status === 'staff' ? 'Staff access' : p.end_date
              ? <>{left < 0 ? 'Ended' : 'Valid till'} <span className="whitespace-nowrap">{date(p.end_date)}</span>{left >= 0 && <span className="whitespace-nowrap"> · {left} days left</span>}</>
              : 'No active plan'}</p>
          </div>
          <ArrowRight className="w-5 h-5 muted" />
        </div>
        {(needsRenew || p.due > 0) && p.status !== 'staff' && (
          <p className="mt-3 btn btn-primary w-full">{needsRenew ? 'Renew membership' : `Pay dues ${money(p.due)}`}</p>
        )}
      </Link>

      {h.pending_payments.n > 0 && (
        <Link to="/plan" className="card card-pad flex items-center gap-3 border-warn/40 dark:border-warn/40">
          <Clock3 className="w-5 h-5 text-warn shrink-0" /><p className="text-sm flex-1">{money(h.pending_payments.total)} payment waiting for confirmation.</p>
        </Link>
      )}
      {p.due > 0 && !needsRenew && (
        <Link to="/plan" className="card card-pad flex items-center gap-3"><Wallet className="w-5 h-5 text-warn shrink-0" /><p className="text-sm flex-1">Pending dues <b>{money(p.due)}</b></p></Link>
      )}

      <section className="grid grid-cols-3 gap-3">
        <Stat label="Visit streak" value={h.visits.streak} unit={h.visits.streak === 1 ? 'day' : 'days'} accent />
        <Stat label="This week" value={h.visits.this_week} unit="visits" />
        <Link to="/visits"><Stat label="This month" value={h.visits.this_month} unit="visits" /></Link>
      </section>

      {cms && <><NewsStrip posts={cms.posts} /><ShopStrip products={cms.products} /><GalleryStrip albums={cms.albums} /></>}
      <p className="flex items-center justify-center gap-1.5 text-xs muted pt-2"><CalendarDays className="w-3.5 h-3.5" />Member ID {h.member.essl_id ?? '—'}</p>
    </div>
  );
}

const Mini = ({ icon, label, value, accent }: { icon: React.ReactNode; label: string; value: number; accent?: boolean }) => (
  <div className="rounded-2xl bg-ink-800 border border-white/5 px-3 py-2">
    <p className="text-[10px] text-ink-300 flex items-center gap-1">{icon}{label}</p>
    <p className={`font-display font-bold text-lg leading-tight ${accent ? 'text-lime' : 'text-white'}`}>{value}</p>
  </div>
);

const Quick = ({ to, icon, label }: { to: string; icon: React.ReactNode; label: string }) => (
  <Link to={to} className="card p-3 flex flex-col items-center gap-1.5 active:scale-95 transition">
    <span className="w-10 h-10 rounded-2xl bg-lime/20 text-lime-700 dark:text-lime flex items-center justify-center">{icon}</span>
    <span className="text-[11px] font-semibold truncate max-w-full">{label}</span>
  </Link>
);

function Stat({ label, value, unit, accent }: { label: string; value: number; unit: string; accent?: boolean }) {
  return (
    <div className={`rounded-3xl p-3.5 h-full ${accent ? 'bg-lime text-ink-900' : 'card'}`}>
      <p className={`text-[11px] font-semibold ${accent ? 'text-ink-700' : 'muted'}`}>{label}</p>
      <p className="font-display text-2xl font-bold mt-1.5 leading-none">{value}</p>
      <p className={`text-[11px] mt-1 ${accent ? 'text-ink-700' : 'muted'}`}>{unit}</p>
    </div>
  );
}
