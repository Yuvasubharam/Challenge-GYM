// Invites members who use the app in a browser tab to install it, so it opens full screen from
// the home screen like a native app (no address bar). Android: one-tap install. iPhone: Safari has
// no install API, so it shows the two taps (Share → Add to Home Screen) instead.
import { useEffect, useState } from 'react';
import { Download, Share, SquarePlus, X } from 'lucide-react';
import { canPromptInstall, isInstalled, isIos, onInstallChange, promptInstall } from '../lib/install';

const SNOOZE_KEY = 'cg_install_prompt_snoozed_until';
const SNOOZE_DAYS = 7;
const snoozed = () => { try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now(); } catch { return false; } };
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000)); } catch { /* private mode */ } };

export default function InstallPrompt() {
  const [mode, setMode] = useState<null | 'android' | 'ios'>(null);

  useEffect(() => {
    if (isInstalled() || snoozed()) return;
    const decide = () => setMode(canPromptInstall() ? 'android' : isIos() ? 'ios' : null);
    const t = setTimeout(decide, 800);
    const off = onInstallChange(() => setMode(isInstalled() ? null : canPromptInstall() ? 'android' : isIos() ? 'ios' : null));
    return () => { clearTimeout(t); off(); };
  }, []);

  if (!mode) return null;
  const later = () => { snooze(); setMode(null); };

  return (
    <div className="fixed inset-x-0 top-[max(env(safe-area-inset-top),0.75rem)] z-50 px-4 pointer-events-none" role="dialog" aria-label="Install the app">
      <div className="pointer-events-auto mx-auto max-w-sm rounded-3xl bg-ink-900 text-white border border-ink-700 shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <img src="/favicon-128.png" alt="" className="w-10 h-10 rounded-2xl bg-ink-950 p-1 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Install the Challenge Gym app</p>
            {mode === 'android'
              ? <p className="text-sm text-ink-300 mt-0.5">Opens full screen from your home screen — faster, and you stay signed in.</p>
              : <p className="text-sm text-ink-300 mt-0.5">Tap <Share className="inline w-4 h-4 -mt-1 text-info" /> <b className="text-white">Share</b>, then <SquarePlus className="inline w-4 h-4 -mt-1" /> <b className="text-white">Add to Home Screen</b>. It then opens full screen, and phone notifications work.</p>}
          </div>
          <button className="text-ink-300 hover:text-white -mr-2.5 -mt-2.5 p-2.5" onClick={later} aria-label="Not now"><X className="w-4 h-4" /></button>
        </div>
        {mode === 'android' && (
          <div className="flex gap-2 mt-4">
            <button className="btn flex-1 bg-white/10 text-white hover:bg-white/15" onClick={later}>Not now</button>
            <button className="btn btn-primary flex-1" onClick={() => void promptInstall().then((ok) => { if (!ok) later(); else setMode(null); })}><Download className="w-4 h-4" />Install</button>
          </div>
        )}
      </div>
    </div>
  );
}
