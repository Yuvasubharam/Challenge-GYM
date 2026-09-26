import { useState, type FormEvent } from 'react';
import { ArrowRight, Dumbbell, Eye, EyeOff, Fingerprint, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Field, Spinner } from '../components/ui';

type Mode = 'intro' | 'login' | 'activate';

export default function Welcome() {
  const { refresh } = useSession();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('cg-seen') ? 'login' : 'intro'));
  const [f, setF] = useState({ id: '', password: '', mobile: '', memberId: '', confirm: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => { try { const m = sessionStorage.getItem('cg-app-disabled'); sessionStorage.removeItem('cg-app-disabled'); return m; } catch { return null; } });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = (m: Mode) => { setError(null); setMode(m); try { localStorage.setItem('cg-seen', '1'); } catch { /* ignore */ } };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (mode === 'activate' && f.password !== f.confirm) { setError("Passwords don't match"); return; }
    setBusy(true);
    try {
      if (mode === 'login') await api.post('/auth/login', { id: f.id.trim(), password: f.password });
      else await api.post('/auth/activate', { mobile: f.mobile, memberId: f.memberId.trim(), password: f.password });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-ink-900 text-white flex flex-col lg:flex-row">
      {/* Hero — reference onboarding: big statement with lime-highlighted "Health" */}
      <div className={`relative overflow-hidden isolate flex flex-col justify-end lg:justify-center lg:w-1/2 px-6 sm:px-10 lg:px-16 pt-16 pb-10 ${mode === 'intro' ? 'flex-1' : 'min-h-[34dvh] lg:min-h-dvh'}`}>
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-lime/25 blur-3xl -z-10 pointer-events-none" />
        <div className="absolute top-16 right-8 w-56 h-56 rounded-full border-[36px] border-lime/15 -z-10 pointer-events-none" />
        <div className="absolute bottom-24 -left-16 w-48 h-48 rounded-full border-[28px] border-white/5 -z-10 pointer-events-none" />
        <div className="relative">
          <div className="flex items-center gap-2.5 mb-10">
            <div className="w-11 h-11 rounded-2xl bg-lime text-ink-900 flex items-center justify-center"><Dumbbell className="w-6 h-6" strokeWidth={2.5} /></div>
            <span className="font-display font-bold text-lg">Challenge Gym</span>
          </div>
          <h1 className={`font-bold leading-[1.1] ${mode === 'intro' ? 'text-[2.6rem] sm:text-5xl' : 'text-3xl sm:text-4xl'} lg:text-5xl`}>
            Wherever you are<br /><span className="relative inline-block"><span className="relative z-10">Health</span><span className="absolute left-0 right-0 bottom-1 h-3 bg-lime/80 -z-0 rounded" /></span> is number one
          </h1>
          <p className="text-ink-300 mt-4 max-w-sm">There is no instant way to a healthy life. Track your plan, visits and payments — all in one place.</p>
        </div>
      </div>

      <div className={`relative lg:w-1/2 lg:flex lg:items-center lg:justify-center ${mode === 'intro' ? '' : 'flex-1'}`}>
        <div className="w-full max-w-md mx-auto px-6 sm:px-10 pb-[max(env(safe-area-inset-bottom),2rem)] pt-2">
          {mode === 'intro' ? (
            <div className="space-y-3">
              <div className="flex gap-1.5 mb-6"><span className="w-8 h-1.5 rounded-full bg-lime" /><span className="w-3 h-1.5 rounded-full bg-white/20" /></div>
              <button className="btn btn-primary btn-lg w-full" onClick={() => go('login')}>Get started<ArrowRight className="w-5 h-5" /></button>
              <button className="btn btn-lg w-full bg-white/10 text-white hover:bg-white/15" onClick={() => go('activate')}>First time here? Activate account</button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4 [&_.label]:text-ink-300 [&_.input]:bg-ink-850 [&_.input]:border-ink-600 [&_.input]:text-white">
              <div className="flex rounded-full bg-white/5 p-1 mb-2">
                {(['login', 'activate'] as const).map((m) => (
                  <button type="button" key={m} onClick={() => go(m)} className={`flex-1 h-10 rounded-full text-sm font-semibold transition ${mode === m ? 'bg-lime text-ink-900' : 'text-ink-300'}`}>
                    {m === 'login' ? 'Sign in' : 'First time'}
                  </button>
                ))}
              </div>
              {mode === 'login' ? (
                <Field label="Mobile number or member ID"><input className="input" value={f.id} onChange={set('id')} required autoComplete="username" inputMode="text" autoCapitalize="none" placeholder="98xxxxxxxx, 643 or CGA5" /></Field>
              ) : (
                <>
                  <p className="text-sm text-ink-300">Use the mobile number you gave the gym and your <b className="text-white">member ID</b> (the number you use on the fingerprint machine — it's on your receipt).</p>
                  <Field label="Mobile number"><input className="input" value={f.mobile} onChange={set('mobile')} required inputMode="tel" autoComplete="tel" pattern="[0-9 +]{10,14}" /></Field>
                  <Field label="Member ID" hint="Up to 5 digits, or letters + digits like CGA5"><input className="input uppercase" value={f.memberId} onChange={(e) => setF({ ...f, memberId: e.target.value.toUpperCase().replace(/\s/g, '') })} required autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="e.g. 643 or CGA5" pattern="(?:[1-9][0-9]{0,4}|[A-Za-z]{1,4}[0-9]{1,5})" maxLength={9} title="Up to 5 digits (e.g. 643) or letters + digits (e.g. CGA5)" /></Field>
                </>
              )}
              <Field label={mode === 'login' ? 'Password' : 'Create a password (min 6)'}>
                <div className="relative">
                  <input className="input pr-12" type={show ? 'text' : 'password'} value={f.password} onChange={set('password')} required minLength={mode === 'activate' ? 6 : 1}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'} />
                  <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn text-ink-300" onClick={() => setShow(!show)} aria-label="Show password">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              {mode === 'activate' && <Field label="Confirm password"><input className="input" type={show ? 'text' : 'password'} value={f.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>}
              {error && <p className="text-sm text-bad bg-bad/10 rounded-2xl px-4 py-3">{error}</p>}
              <button className="btn btn-primary btn-lg w-full" disabled={busy}>{busy && <Spinner className="w-4 h-4" />}{mode === 'login' ? 'Sign in' : 'Activate & sign in'}</button>
              <p className="text-center text-xs text-ink-400 flex items-center justify-center gap-1.5 pt-1">
                {mode === 'login' ? <><ShieldCheck className="w-3.5 h-3.5" />Forgot password? Ask the front desk to reset it.</> : <><Fingerprint className="w-3.5 h-3.5" />Your member ID = your fingerprint ID</>}
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
