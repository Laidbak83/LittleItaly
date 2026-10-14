// Service worker minimal : nécessaire pour installer l'écran d'administration sur le téléphone.
// Il ne met rien en cache : les commandes et les chiffres sont toujours lus en direct.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});

// Notifications push du patron (nouvelle commande, retard, bilan du soir).
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { /* message non JSON : on affiche le texte brut */ }
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    data: { url: data.url || '/admin' },
  };
  if (data.tag) { options.tag = data.tag; options.renotify = true; } // renotify exige un tag
  event.waitUntil(self.registration.showNotification(data.title || 'Little Italy', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/admin';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow(url);
    }),
  );
});
