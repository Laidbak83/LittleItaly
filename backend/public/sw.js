// Service worker minimal : nécessaire pour installer l'écran d'administration sur le téléphone.
// Il ne met rien en cache : les commandes et les chiffres sont toujours lus en direct.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
