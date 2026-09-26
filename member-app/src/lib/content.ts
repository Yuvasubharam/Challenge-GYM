import { api } from './api';

export type Kind = 'notice' | 'event' | 'offer';
export interface Post {
  id: number; kind: Kind; title: string; body: string | null; image_key: string | null; event_date: string | null; event_time: string | null;
  cta_label: string | null; cta_link: string | null; pinned: number; notify: number; created_at: string;
}
export interface Banner { id: number; title: string; subtitle: string | null; image_key: string | null; cta_label: string | null; cta_link: string | null }
export interface Product { id: number; name: string; description?: string | null; category: string | null; price: number; mrp: number | null; image_key: string | null; in_stock: number; featured?: number }
export interface Album { id: number; title: string; description?: string | null; event_date: string | null; cover: string | null; photos: number }
export interface HomeContent { banners: Banner[]; posts: Post[]; products: Product[]; albums: Album[]; unread: number }

export const img = (key: string | null | undefined) => (key ? `/api/content/img/${key}` : '');
export const isExternal = (link: string) => /^https:\/\//.test(link);

export const KIND_LABEL: Record<Kind, string> = { notice: 'Notice', event: 'Event', offer: 'Offer' };

// ── Phone notifications (web push) ──────────────────────────────────────
export const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

const keyBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration() {
  const existing = await navigator.serviceWorker.getRegistration();
  return existing ?? navigator.serviceWorker.register('/sw.js');
}

export async function pushState(): Promise<'unsupported' | 'denied' | 'on' | 'off'> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub ? 'on' : 'off';
}

export async function enablePush(): Promise<void> {
  if (!pushSupported()) throw new Error('This browser cannot receive notifications. On iPhone, add the app to your Home Screen first.');
  const { key } = await api.get<{ key: string | null }>('/content/push/key');
  if (!key) throw new Error('Notifications are not set up by the gym yet');
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('Notifications were blocked. Allow them in your browser settings.');
  const reg = await registration();
  await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
  await api.post('/content/push/subscribe', { endpoint: sub.endpoint });
}

export async function disablePush(): Promise<void> {
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await api.post('/content/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
  await sub.unsubscribe();
}
