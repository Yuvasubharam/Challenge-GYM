import { useEffect, useState } from 'react';
import { CalendarCheck2, Camera, ChevronRight, CreditCard, KeyRound, LogOut, MapPin, Moon, Phone, Sun, Target, UserRound } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useFit } from '../lib/fitctx';
import { GOAL_LABEL } from '../lib/fit';
import { api } from '../lib/api';
import { processPhoto } from '../lib/photo';
import { date } from '../lib/format';
import { useHome } from '../lib/home';
import { useSession, useTheme } from '../lib/session';
import { Avatar, Field, PageLoader, Sheet, Spinner, useAction } from '../components/ui';

export default function Profile() {
  const { home, reload } = useHome();
  const { logout } = useSession();
  const { dark, toggle } = useTheme();
  const { busy, run } = useAction();
  const { fit, edit } = useFit();
  const nav = useNavigate();
  const [sheet, setSheet] = useState<null | 'details' | 'password'>(null);
  const [photoV, setPhotoV] = useState(0);
  if (!home) return <PageLoader />;
  const m = home.member;

  const upload = async (file?: File) => {
    if (!file) return;
    // Cropped + resized to a small square WebP on the phone before upload (~30 KB instead of MBs).
    const r = await run(async () => api.upload('/me/photo', await processPhoto(file)), 'Photo updated');
    if (r) { setPhotoV(Date.now()); void reload(); }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl sm:text-3xl font-bold pt-1">Profile</h1>

      <section className="card-ink p-6 flex flex-col items-center text-center">
        <label className="relative cursor-pointer">
          <Avatar name={m.name} hasPhoto={!!m.photo_key} size={96} version={photoV} />
          <span className="absolute bottom-0 right-0 w-9 h-9 rounded-full bg-lime text-ink-900 flex items-center justify-center border-4 border-ink-900">
            {busy ? <Spinner className="w-4 h-4" /> : <Camera className="w-4 h-4" />}
          </span>
          <input type="file" accept="image/*" className="hidden" onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
        <p className="font-display text-xl font-bold text-white mt-4">{m.name}</p>
        <p className="text-sm text-ink-300">Member ID <span className="font-mono text-lime">{m.essl_id ?? '—'}</span> · since {date(m.join_date)}</p>
      </section>

      <section className="card overflow-hidden">
        <Row icon={<Target />} label="Fitness profile & goals" hint={fit?.profile ? `${GOAL_LABEL[fit.profile.goal]} · BMI ${fit.profile.bmi} · ${fit.profile.targets.kcal} kcal/day` : 'Set age, height, weight and goal'} onClick={edit} />
        <Row icon={<CreditCard />} label="Membership & payments" hint={home.plan.category ?? 'Renew, pay dues, receipts'} onClick={() => nav('/plan')} />
        <Row icon={<CalendarCheck2 />} label="Gym visits" hint={`${home.visits.this_month} check-ins this month`} onClick={() => nav('/visits')} />
      </section>

      <section className="card overflow-hidden">
        <Row icon={<UserRound />} label="Personal details" hint={[m.mobile, m.email].filter(Boolean).join(' · ') || 'Add email, birthday, emergency contact'} onClick={() => setSheet('details')} />
        <Row icon={<KeyRound />} label="Change password" onClick={() => setSheet('password')} />
        <Row icon={dark ? <Sun /> : <Moon />} label={dark ? 'Light mode' : 'Dark mode'} onClick={toggle} />
      </section>

      <section className="card overflow-hidden">
        <div className="px-4 pt-4 pb-1 text-xs font-semibold muted uppercase tracking-wide">{home.gym.name}</div>
        {home.gym.phone && <Row icon={<Phone />} label="Call the front desk" hint={home.gym.phone} href={`tel:${home.gym.phone}`} />}
        {home.gym.address && <Row icon={<MapPin />} label="Address" hint={home.gym.address} href={`https://maps.google.com/?q=${encodeURIComponent(home.gym.address)}`} />}
        <p className="px-4 py-3 text-xs muted border-t border-paper-line dark:border-ink-700">To change your name, mobile or plan, please visit the front desk.</p>
      </section>

      <button className="btn btn-outline w-full h-12 text-bad" onClick={logout}><LogOut className="w-4 h-4" />Sign out</button>

      {sheet === 'details' && <DetailsSheet onClose={() => setSheet(null)} onSaved={() => { setSheet(null); void reload(); }} />}
      {sheet === 'password' && <PasswordSheet onClose={() => setSheet(null)} />}
    </div>
  );
}

function Row({ icon, label, hint, onClick, href }: { icon: React.ReactElement; label: string; hint?: string; onClick?: () => void; href?: string }) {
  const body = (
    <>
      <span className="w-10 h-10 rounded-2xl bg-black/5 dark:bg-white/5 flex items-center justify-center [&>svg]:w-5 [&>svg]:h-5">{icon}</span>
      <span className="flex-1 min-w-0 text-left"><span className="block font-semibold text-sm">{label}</span>{hint && <span className="block text-xs muted truncate">{hint}</span>}</span>
      <ChevronRight className="w-4 h-4 muted" />
    </>
  );
  const cls = 'w-full flex items-center gap-3 px-4 py-3 border-t first:border-t-0 border-paper-line dark:border-ink-700 hover:bg-black/[.02] dark:hover:bg-white/[.03]';
  return href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer" className={cls}>{body}</a> : <button onClick={onClick} className={cls}>{body}</button>;
}

function DetailsSheet({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { home } = useHome();
  const { busy, run } = useAction();
  const m = home!.member;
  const [f, setF] = useState({ gender: m.gender ?? '', dob: m.dob ?? '', email: m.email ?? '', emergency_contact: m.emergency_contact ?? '', address: m.address ?? '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Sheet open onClose={onClose} title="Personal details"
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy} onClick={() => run(() => api.patch('/me', f), 'Saved').then((r) => r && onSaved())}>{busy && <Spinner className="w-4 h-4" />}Save</button>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input className="input opacity-60" value={m.name} readOnly /></Field>
          <Field label="Mobile"><input className="input opacity-60" value={m.mobile ?? ''} readOnly /></Field>
          <Field label="Gender"><select className="input" value={f.gender} onChange={set('gender')}><option value="">—</option><option value="male">Male</option><option value="female">Female</option><option value="other">Other</option></select></Field>
          <Field label="Birthday"><input type="date" className="input" value={f.dob} onChange={set('dob')} /></Field>
        </div>
        <Field label="Email"><input type="email" className="input" value={f.email} onChange={set('email')} autoComplete="email" /></Field>
        <Field label="Emergency contact" hint="Name and phone number"><input className="input" value={f.emergency_contact} onChange={set('emergency_contact')} /></Field>
        <Field label="Address"><input className="input" value={f.address} onChange={set('address')} autoComplete="street-address" /></Field>
      </div>
    </Sheet>
  );
}

function PasswordSheet({ onClose }: { onClose: () => void }) {
  const { busy, run } = useAction();
  const [f, setF] = useState({ current: '', next: '', confirm: '' });
  const [err, setErr] = useState('');
  useEffect(() => setErr(f.confirm && f.next !== f.confirm ? "Passwords don't match" : ''), [f]);
  return (
    <Sheet open onClose={onClose} title="Change password"
      footer={<button className="btn btn-primary btn-lg w-full" disabled={busy || !!err || f.next.length < 6} onClick={() => run(() => api.post('/auth/change-password', { current: f.current, next: f.next }), 'Password changed').then((r) => r && onClose())}>Update password</button>}>
      <div className="space-y-3">
        <Field label="Current password"><input type="password" className="input" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} autoComplete="current-password" /></Field>
        <Field label="New password (min 6)"><input type="password" className="input" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Confirm new password"><input type="password" className="input" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></Field>
        {err && <p className="text-xs text-bad">{err}</p>}
      </div>
    </Sheet>
  );
}
