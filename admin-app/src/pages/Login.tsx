import { useEffect, useState, type FormEvent } from 'react';
import { Eye, EyeOff, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Field, Spinner } from '../components/ui';

export default function Login() {
  const { refresh } = useSession();
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [form, setForm] = useState({ username: '', password: '', name: '', setupToken: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.get<{ needsSetup: boolean }>('/auth/status').then((r) => setNeedsSetup(r.needsSetup)).catch(() => setNeedsSetup(false));
  }, []);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (needsSetup) await api.post('/auth/setup', form);
      else await api.post('/auth/login', { username: form.username, password: form.password });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh grid lg:grid-cols-2 bg-ink-900 text-white">
      <div className="hidden lg:flex relative overflow-hidden isolate flex-col justify-between p-12">
        <div className="hidden lg:block absolute inset-0 opacity-10 pointer-events-none">
          <img src="/logo-transparent.webp" alt="" className="absolute left-[240px] top-1/2 -translate-y-1/2 w-[520px] h-[520px] object-contain" />
        </div>
        <div className="absolute -top-40 -left-40 w-[520px] h-[520px] rounded-full bg-lime/20 blur-3xl -z-10 pointer-events-none" />
        <div className="absolute bottom-0 right-0 w-[420px] h-[420px] rounded-full border-[60px] border-lime/10 translate-x-1/3 translate-y-1/3 -z-10 pointer-events-none" />
        <div className="relative flex items-center gap-3">
          <img src="/favicon-128.png" alt="Challenge Gym logo" className="w-11 h-11 object-contain rounded-2xl bg-ink-950/70 p-1.5" />
          <span className="font-display font-bold text-xl">Challenge Gym</span>
        </div>
        <div className="relative">
          <h1 className="text-5xl font-bold leading-tight">Wherever you are,<br /><span className="bg-lime text-ink-900 px-2 rounded-lg">health</span> is number one.</h1>
          <p className="text-ink-300 mt-5 max-w-md">Members, renewals, payments, attendance and door access — one place, synced with your eSSL device.</p>
        </div>
        <p className="relative text-xs text-ink-400">Admin console · staff only</p>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <img src="/favicon-128.png" alt="Challenge Gym logo" className="w-11 h-11 object-contain rounded-2xl bg-ink-950/70 p-1.5" />
            <span className="font-display font-bold text-xl">Challenge Gym</span>
          </div>
          <h2 className="text-3xl font-bold">{needsSetup ? 'Set up owner account' : 'Welcome back'}</h2>
          <p className="text-ink-300 text-sm mt-2 mb-8">{needsSetup ? 'First run: create the owner login. You need the setup token from deployment.' : 'Sign in to the admin console.'}</p>

          {needsSetup === null ? <div className="flex justify-center py-10"><Spinner /></div> : (
            <div className="space-y-4 [&_.label]:text-ink-300 [&_.input]:bg-ink-850 [&_.input]:border-ink-600 [&_.input]:text-white">
              {needsSetup && <Field label="Your name"><input className="input" value={form.name} onChange={set('name')} required autoComplete="name" /></Field>}
              <Field label="Username"><input className="input" value={form.username} onChange={set('username')} required autoComplete="username" autoCapitalize="none" /></Field>
              <Field label="Password">
                <div className="relative">
                  <input className="input pr-12" type={show ? 'text' : 'password'} value={form.password} onChange={set('password')} required minLength={needsSetup ? 8 : 1}
                    autoComplete={needsSetup ? 'new-password' : 'current-password'} />
                  <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn text-ink-300" onClick={() => setShow(!show)} aria-label="Show password">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </Field>
              {needsSetup && <Field label="Setup token"><input className="input" value={form.setupToken} onChange={set('setupToken')} required autoComplete="off" /></Field>}
              {error && <p className="text-sm text-bad bg-bad/10 rounded-2xl px-4 py-3">{error}</p>}
              <button className="btn btn-primary btn-lg w-full mt-2" disabled={busy}>{busy && <Spinner className="w-4 h-4" />}{needsSetup ? 'Create owner & sign in' : 'Sign in'}</button>
              <p className="flex items-center justify-center gap-1.5 text-[11px] text-ink-400 pt-3"><ShieldCheck className="w-3.5 h-3.5" />Locked for 15 min after 5 wrong attempts</p>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
