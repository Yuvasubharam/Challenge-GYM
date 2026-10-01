// Shown right after sign-in, before the app, when the member still has the default/desk password
// or the gym has no mobile number for them.
import { useState, type FormEvent } from 'react';
import { Eye, EyeOff, KeyRound, LogOut, Smartphone } from 'lucide-react';
import { api } from '../lib/api';
import { useSession } from '../lib/session';
import { Field, Spinner } from '../components/ui';

export default function AccountSetup() {
  const { session, refresh, logout } = useSession();
  const s = session!;
  const [f, setF] = useState({ password: '', confirm: '', mobile: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (s.must_change_password && f.password !== f.confirm) { setError("Passwords don't match"); return; }
    setBusy(true);
    try {
      await api.post('/auth/setup', { password: s.must_change_password ? f.password : undefined, mobile: s.needs_mobile ? f.mobile : undefined });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const title = s.must_change_password && s.needs_mobile ? 'Secure your account' : s.must_change_password ? 'Set your own password' : 'Add your mobile number';
  return (
    <div className="min-h-dvh bg-ink-900 text-white flex items-center justify-center px-6 py-10">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 [&_.label]:text-ink-300 [&_.input]:bg-ink-850 [&_.input]:border-ink-600 [&_.input]:text-white">
        <img src="/favicon-128.png" alt="Challenge Gym logo" className="w-12 h-12 object-contain rounded-2xl bg-ink-950/70 p-1.5" />
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-ink-300 text-sm mt-2">Hi {s.name.split(' ')[0]}! {s.must_change_password
            ? <>You signed in with a temporary password. Choose your own so only you can open your account.</>
            : <>The gym doesn't have your mobile number yet — add it so we can reach you about your membership.</>}</p>
        </div>

        {s.must_change_password && <>
          <Field label="New password (min 6)">
            <div className="relative">
              <input className="input pr-12" type={show ? 'text' : 'password'} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })}
                required minLength={6} autoComplete="new-password" autoFocus />
              <button type="button" className="absolute right-1 top-1/2 -translate-y-1/2 icon-btn text-ink-300" onClick={() => setShow(!show)} aria-label="Show password">
                {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm new password">
            <input className="input" type={show ? 'text' : 'password'} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required autoComplete="new-password" />
          </Field>
        </>}

        {s.needs_mobile && (
          <Field label="Mobile number" hint="10 digits — you can also sign in with it">
            <div className="relative">
              <Smartphone className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-ink-300" />
              <input className="input pl-11" value={f.mobile} onChange={(e) => setF({ ...f, mobile: e.target.value.replace(/[^\d]/g, '').slice(0, 10) })}
                required inputMode="numeric" autoComplete="tel" pattern="[6-9][0-9]{9}" title="10-digit mobile number" placeholder="98xxxxxxxx" autoFocus={!s.must_change_password} />
            </div>
          </Field>
        )}

        {error && <p className="text-sm text-bad bg-bad/10 rounded-2xl px-4 py-3">{error}</p>}
        <button className="btn btn-primary btn-lg w-full" disabled={busy}>{busy ? <Spinner className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}Save & continue</button>
        <button type="button" className="btn btn-lg w-full bg-white/5 text-ink-300 hover:bg-white/10" onClick={() => void logout()}><LogOut className="w-4 h-4" />Sign out</button>
      </form>
    </div>
  );
}
