const CACHE = 'hm-v4.1.1';
const ASSETS = ['./', './index.html', './manifest.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  if (
    e.request.url.includes('googleapis.com') ||
    e.request.url.includes('script.google.com') ||
    e.request.url.includes('accounts.google.com')
  ) return;

  const url = new URL(e.request.url);
  const isHTMLish = e.request.mode === 'navigate'
                 || url.pathname === '/' || url.pathname.endsWith('/')
                 || url.pathname.endsWith('.html')
                 || url.pathname.endsWith('.js')
                 || url.pathname.endsWith('.css')
                 || url.pathname.endsWith('.json');

  if (isHTMLish) {
    // Network-first: prende sempre l'ultima versione se online,
    // fallback alla cache se offline.
    e.respondWith(
      fetch(e.request)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(e.request, clone));
          return res;
        })
        .catch(() => caches.match(e.request).then(c => c || caches.match('./index.html')))
    );
    return;
  }

  // Cache-first per asset statici (immagini, icone, ecc.)
  e.respondWith(
    caches.match(e.request).then(cached => {
      if (cached) return cached;
      return fetch(e.request).then(res => {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, clone));
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
