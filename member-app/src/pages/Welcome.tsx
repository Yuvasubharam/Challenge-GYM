import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, Fingerprint, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Field, Spinner } from '../components/ui';

// Every member has a login (user ID + first password = member ID), so there is no separate activation step.
type Mode = 'intro' | 'login';

export default function Welcome() {
  const { refresh } = useSession();
  const [mode, setMode] = useState<Mode>(() => (localStorage.getItem('cg-seen') ? 'login' : 'intro'));
  const [f, setF] = useState({ id: '', password: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(() => { try { const m = sessionStorage.getItem('cg-app-disabled'); sessionStorage.removeItem('cg-app-disabled'); return m; } catch { return null; } });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const go = (m: Mode) => { setError(null); setMode(m); try { localStorage.setItem('cg-seen', '1'); } catch { /* ignore */ } };

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await api.post('/auth/login', { id: f.id.trim(), password: f.password });
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
      <div className={`relative overflow-hidden isolate flex flex-col justify-end lg:justify-between lg:w-1/2 px-6 sm:px-10 lg:px-12 pt-16 pb-10 lg:py-12 ${mode === 'intro' ? 'flex-1' : 'min-h-[34dvh] lg:min-h-dvh'}`}>
        <div className="hidden lg:block absolute inset-0 opacity-10 pointer-events-none">
          <img src="/logo-transparent.webp" alt="" className="absolute left-[240px] top-1/2 -translate-y-1/2 w-[520px] h-[520px] object-contain" />
        </div>
        <div className="absolute -top-24 -right-24 w-80 h-80 rounded-full bg-lime/25 blur-3xl -z-10 pointer-events-none" />
        <div className="absolute top-16 right-8 w-56 h-56 rounded-full border-[36px] border-lime/15 -z-10 pointer-events-none" />
        <div className="absolute bottom-24 -left-16 w-48 h-48 rounded-full border-[28px] border-white/5 -z-10 pointer-events-none" />
        <div className="relative lg:flex lg:flex-1 lg:flex-col lg:justify-between">
          <div className="flex items-center gap-2.5 mb-10 lg:mb-0">
            <img src="/favicon-128.png" alt="Challenge Gym logo" className="w-11 h-11 object-contain rounded-2xl bg-ink-950/70 p-1.5" />
            <span className="font-display font-bold text-lg">Challenge Gym</span>
          </div>
          <div className="lg:mb-12">
            <h1 className={`font-bold leading-[1.12] lg:leading-tight ${mode === 'intro' ? 'text-[2.6rem] sm:text-5xl' : 'text-3xl sm:text-4xl'} lg:text-5xl`}>
              <span className="block">Wherever you are,</span>
              <span className="block"><span className="inline-block align-baseline bg-lime text-ink-900 px-2 rounded-md">health</span> is number one.</span>
            </h1>
            <p className="text-ink-300 mt-5 max-w-md">There is no instant way to a healthy life. Track your plan, visits and payments — all in one place.</p>
          </div>
        </div>
      </div>

      <div className={`relative lg:w-1/2 lg:flex lg:items-center lg:justify-center ${mode === 'intro' ? '' : 'flex-1'}`}>
        <div className="w-full max-w-md mx-auto px-6 sm:px-10 pb-[max(env(safe-area-inset-bottom),2rem)] pt-2">
          {mode === 'intro' ? (
            <div className="space-y-3">
              <div className="flex gap-1.5 mb-6"><span className="w-8 h-1.5 rounded-full bg-lime" /><span className="w-3 h-1.5 rounded-full bg-white/20" /></div>
              <button className="btn btn-primary btn-lg w-full" onClick={() => go('login')}>Get started<ArrowRight className="w-5 h-5" /></button>
            </div>
          ) : (
            <>
              <div className="mb-6">
                <h2 className="text-3xl font-bold">Welcome</h2>
                <p className="text-ink-300 text-sm mt-2">Sign in to your member account.</p>
              </div>
              <form onSubmit={submit} className="space-y-4 [&_.label]:text-ink-300 [&_.input]:bg-ink-850 [&_.input]:border-ink-600 [&_.input]:text-white">
                <div className="rounded-2xl bg-lime/10 border border-lime/20 px-4 py-3 text-sm flex gap-3">
                  <Fingerprint className="w-5 h-5 text-lime shrink-0 mt-0.5" />
                  <p className="text-ink-200"><b className="text-white">First time?</b> Your user ID and password are both your <b className="text-white">member ID</b> — the number you use on the fingerprint machine (e.g. 643). You'll set your own password after signing in.</p>
                </div>
                <Field label="Member ID or mobile number"><input className="input" value={f.id} onChange={set('id')} required autoComplete="username" inputMode="text" autoCapitalize="none" placeholder="643, CGA5 or 98xxxxxxxx" /></Field>
                <Field label="Password">
                  <div className="relative">
                    <input className="input pr-12" type={show ? 'text' : 'password'} value={f.password} onChange={set('password')} required autoComplete="current-password" />
                    <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn text-ink-300" onClick={() => setShow(!show)} aria-label="Show password">
                      {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </Field>
                {error && <p className="text-sm text-bad bg-bad/10 rounded-2xl px-4 py-3">{error}</p>}
                <button className="btn btn-primary btn-lg w-full" disabled={busy}>{busy && <Spinner className="w-4 h-4" />}Sign in</button>
                <p className="text-center text-xs text-ink-400 flex items-center justify-center gap-1.5 pt-1">
                  <ShieldCheck className="w-3.5 h-3.5" />Forgot password? Ask the front desk to reset it.
                </p>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
