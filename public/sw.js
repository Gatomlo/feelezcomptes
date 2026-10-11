// Service worker minimal : rend l'app installable sur mobile (critère requis par
// Chrome/Android). Pas de mise en cache hors-ligne volontaire, car les données du
// budget sont chargées dynamiquement depuis le serveur à chaque ouverture — un cache
// agressif ici risquerait de servir une version périmée de l'app ou de ses données.
self.addEventListener('install', function (e) {
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  self.clients.claim();
});

self.addEventListener('fetch', function (e) {
  e.respondWith(fetch(e.request));
});
