// "Install the app" support. Chrome/Edge on Android fire beforeinstallprompt once, often before
// any React component exists, so the event is captured here at startup and handed out later.
interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // we show our own card instead of the mini-infobar
    deferred = e as InstallEvent;
    listeners.forEach((f) => f());
  });
  window.addEventListener('appinstalled', () => { deferred = null; listeners.forEach((f) => f()); });
}

/** Already running as an installed app (home-screen icon), i.e. full screen without browser bars. */
export const isInstalled = () =>
  window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches
  || (navigator as Navigator & { standalone?: boolean }).standalone === true;

export const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

export const canPromptInstall = () => !!deferred;

export function onInstallChange(f: () => void) { listeners.add(f); return () => { listeners.delete(f); }; }

/** Shows the browser's install dialog. Resolves true if the member installed the app. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  listeners.forEach((f) => f());
  return outcome === 'accepted';
}
