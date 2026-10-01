// Asks a signed-in member to turn on phone notifications (renewal reminders, gym news).
// Browsers — iPhone especially — only show the permission dialog from a tap, so this is a
// friendly in-app card with an Allow button rather than an automatic popup.
import { useEffect, useState } from 'react';
import { BellRing, X } from 'lucide-react';
import { api } from '../lib/api';
import { enablePush, pushState, pushSupported } from '../lib/content';
import { Spinner, useToast } from './ui';

const SNOOZE_KEY = 'cg_push_prompt_snoozed_until';
const SNOOZE_DAYS = 3;

const snoozed = () => { try { return Number(localStorage.getItem(SNOOZE_KEY) ?? 0) > Date.now(); } catch { return false; } };
const snooze = () => { try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 86_400_000)); } catch { /* private mode */ } };

export default function PushPrompt() {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    let alive = true;
    void (async () => {
      const state = await pushState().catch(() => 'unsupported' as const);
      if (state !== 'off') return;
      const { key } = await api.get<{ key: string | null }>('/content/push/key').catch(() => ({ key: null }));
      if (!key || !alive) return;
      // Already allowed on this phone (e.g. signed in again): re-subscribe quietly, no prompt needed.
      if (Notification.permission === 'granted') { await enablePush().catch(() => undefined); return; }
      if (!snoozed()) setTimeout(() => alive && setShow(true), 1200);
    })();
    return () => { alive = false; };
  }, []);

  if (!show) return null;
  const later = () => { snooze(); setShow(false); };
  const allow = async () => {
    setBusy(true);
    try {
      await enablePush();
      toast('ok', 'Notifications on 🔔');
      setShow(false);
    } catch (e) {
      toast('error', (e as Error).message);
      if (Notification.permission === 'denied') setShow(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    // Sits just above the floating nav, which grows by the iPhone home-bar inset.
    <div className="fixed inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),0.75rem)+4.75rem)] md:bottom-6 z-50 px-4 pointer-events-none" role="dialog" aria-label="Turn on notifications">
      <div className="pointer-events-auto mx-auto max-w-sm rounded-3xl bg-ink-900 text-white border border-ink-700 shadow-2xl p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-2xl bg-lime text-ink-900 flex items-center justify-center shrink-0"><BellRing className="w-5 h-5" /></div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold">Turn on notifications</p>
            <p className="text-sm text-ink-300 mt-0.5">Get a reminder before your membership ends, plus gym news, events and offers.</p>
          </div>
          <button className="text-ink-300 hover:text-white -mr-2.5 -mt-2.5 p-2.5" onClick={later} aria-label="Not now"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex gap-2 mt-4">
          <button className="btn flex-1 bg-white/10 text-white hover:bg-white/15" onClick={later}>Not now</button>
          <button className="btn btn-primary flex-1" disabled={busy} onClick={() => void allow()}>{busy && <Spinner className="w-4 h-4" />}Allow</button>
        </div>
      </div>
    </div>
  );
}
