// Service worker : rend l'app installable et utilisable sans réseau.
// - Fichiers de l'interface : réseau d'abord (version à jour), copie en cache si le
//   réseau manque ou traîne plus de 4 s (réseau instable).
// - Polices Google : cache d'abord.
// - /api/… : jamais touché ici ; l'app garde elle-même ses données (localStorage) et
//   les synchronise au retour du réseau.
// - Notifications push : « Avez-vous dépensé … ? » pour les dépenses planifiées (Oui / Reporter / Annuler).
// Changer VERSION quand la liste FILES change.
var VERSION = 'fl-v5';
var FILES = ['./', 'index.html', 'app.js', 'styles.css', 'manifest.json', 'logo.svg', 'logo.png', 'icon-192.png', 'icon-384.png', 'icon-maskable-512.png', 'apple-touch-icon.png'];
var TIMEOUT_MS = 4000;

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION && k !== 'fl-fonts'; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

function networkFirst(req, cacheKey) {
  return caches.open(VERSION).then(function (cache) {
    var fromCache = function () {
      return cache.match(cacheKey || req, { ignoreSearch: true }).then(function (r) { return r || cache.match('./'); });
    };
    return new Promise(function (resolve) {
      var done = false;
      var finish = function (r) { if (!done && r) { done = true; resolve(r); } };
      var timer = setTimeout(function () { fromCache().then(function (r) { finish(r); }); }, TIMEOUT_MS);
      fetch(req).then(function (res) {
        if (res.ok) cache.put(cacheKey || req, res.clone());
        clearTimeout(timer);
        if (done) return;
        done = true;
        resolve(res);
      }).catch(function () {
        clearTimeout(timer);
        fromCache().then(function (r) { if (!done) { done = true; resolve(r || Response.error()); } });
      });
    });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin === location.origin) {
    var scope = new URL(self.registration.scope).pathname;
    if (url.pathname.indexOf(scope + 'api/') === 0) return;
    // Pages (y compris le raccourci ?action=…) : une seule entrée « ./ » en cache.
    e.respondWith(networkFirst(req, req.mode === 'navigate' ? './' : null));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(caches.open('fl-fonts').then(function (cache) {
      return cache.match(req).then(function (hit) {
        return hit || fetch(req).then(function (res) { cache.put(req, res.clone()); return res; });
      });
    }));
  }
});

// --- Notifications push des dépenses planifiées ---
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) {}
  var actions = data.id ? [{ action: 'yes', title: 'Oui' }, { action: 'later', title: 'Reporter' }, { action: 'no', title: 'Annuler' }] : [];
  e.waitUntil(self.registration.showNotification(data.title || 'Fée Lezcomptes', {
    body: data.body || '',
    tag: data.id ? 'planned-' + data.id : 'fl-info',
    icon: 'icon-192.png',
    badge: 'icon-192.png',
    data: { id: data.id || '' },
    actions: actions
  }));
});

function openApp(query) {
  var target = new URL(self.registration.scope);
  target.search = query || '';
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ('focus' in list[i]) { list[i].navigate(target.href); return list[i].focus(); }
    }
    return self.clients.openWindow(target.href);
  });
}

self.addEventListener('notificationclick', function (e) {
  var n = e.notification, id = n.data && n.data.id;
  n.close();
  var base = self.registration.scope;
  // Oui / Annuler : appliqués directement sur le serveur ; en cas d'échec (hors ligne,
  // session expirée), on ouvre l'appli sur la question pour répondre à la main.
  if (id && (e.action === 'yes' || e.action === 'no')) {
    e.waitUntil(fetch(base + 'api/planned/' + encodeURIComponent(id) + '/' + (e.action === 'yes' ? 'confirm' : 'cancel'), { method: 'POST', credentials: 'same-origin' })
      .then(function (r) { if (!r.ok) return openApp('?action=planifies&id=' + encodeURIComponent(id)); })
      .catch(function () { return openApp('?action=planifies&id=' + encodeURIComponent(id)); }));
    return;
  }
  if (id && e.action === 'later') { e.waitUntil(openApp('?action=planifies&id=' + encodeURIComponent(id) + '&rep=1')); return; }
  e.waitUntil(openApp(id ? '?action=planifies&id=' + encodeURIComponent(id) : ''));
});
