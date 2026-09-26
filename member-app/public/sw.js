// Minimal app-shell cache. API calls are never cached (always live data).
const CACHE = 'cg-member-v2';

// Phone notifications: pushes carry no payload, so fetch the latest post from the API.
self.addEventListener('push', (e) => {
  e.waitUntil((async () => {
    let n = null;
    try {
      const res = await fetch('/api/content/notifications/latest', { credentials: 'same-origin', cache: 'no-store' });
      if (res.ok) n = await res.json();
    } catch { /* offline or signed out */ }
    const title = n?.title || 'Challenge Gym';
    await self.registration.showNotification(title, {
      body: n?.body ? String(n.body).slice(0, 180) : 'New update from your gym',
      icon: '/icon.svg',
      badge: '/icon.svg',
      image: n?.image_key ? `/api/content/img/${n.image_key}` : undefined,
      tag: n?.id ? `post-${n.id}` : 'cg-news',
      data: { url: n?.cta_link && n.cta_link.startsWith('/') ? n.cta_link : '/news?tab=alerts' },
    });
  })());
});
self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) if ('focus' in c) { c.navigate?.(url)?.catch?.(() => undefined); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
self.addEventListener('install', (e) => { self.skipWaiting(); e.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/', '/icon.svg', '/manifest.webmanifest']))); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('/')));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res;
    })));
  }
});
