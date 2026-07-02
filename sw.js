// Pasto admin PWA service worker — order-alert web push.
// Scope is site root (/) so it covers /admin. Registered from js/admin.js.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (_) {}
  const title = d.title || '🍝 New order';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || '',
      tag: d.tag || 'order',       // same order collapses instead of stacking
      renotify: true,              // ...but still buzzes on each re-alert
      requireInteraction: true,    // stays until tapped (Android)
      icon: '/assets/logo-icon.png',
      badge: '/assets/logo-icon.png',
      data: { orderId: d.orderId || null }
    })
  );
  if (self.registration.setAppBadge) {
    self.registration.setAppBadge(1).catch(() => {});
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const orderId = event.notification.data && event.notification.data.orderId;
  const url = orderId ? `/admin?order=${orderId}` : '/admin';
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of wins) {
      if (c.url.includes('/admin')) {
        await c.focus();
        if ('navigate' in c) { try { await c.navigate(url); } catch (_) {} }
        return;
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
