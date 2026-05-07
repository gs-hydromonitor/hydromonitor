const CACHE = 'hm-v4.3.1';
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

/* ─── BACKGROUND SYNC (invio differito quando torna la rete) ─── */
const HM_DB_NAME  = 'hm-db';
const HM_DB_STORE = 'pending';

function _hmOpen(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(HM_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(HM_DB_STORE)) {
        db.createObjectStore(HM_DB_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}
function _hmGetAll(db){
  return new Promise((res, rej) => {
    const tx = db.transaction(HM_DB_STORE, 'readonly');
    const r  = tx.objectStore(HM_DB_STORE).getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror   = () => rej(r.error);
  });
}
function _hmDelete(db, id){
  return new Promise((res, rej) => {
    const tx = db.transaction(HM_DB_STORE, 'readwrite');
    tx.objectStore(HM_DB_STORE).delete(id);
    tx.oncomplete = () => res();
    tx.onerror    = () => rej(tx.error);
  });
}

async function _hmProcessPending(){
  let db;
  try { db = await _hmOpen(); } catch(e){ return; }
  const items = await _hmGetAll(db);
  if (!items.length) return;

  for (const item of items) {
    const action = item.isEdit ? 'updateRecord' : 'appendData';
    const dataObj = item.isEdit
      ? { sheetId: item.sheetId, sheetTab: item.sheetTab, date: item.originalDate, rows: item.rows }
      : { sheetId: item.sheetId, sheetTab: item.sheetTab, rows: item.rows };
    const url = `${item.configUrl}?action=${action}&data=${encodeURIComponent(JSON.stringify(dataObj))}`;
    try {
      const res = await fetch(url, { method: 'GET', redirect: 'follow' });
      const txt = await res.text();
      let json = null;
      try { json = JSON.parse(txt); } catch(e){}
      if (json && json.ok) {
        await _hmDelete(db, item.id);
        // Notifica eventuali client aperti
        const clients = await self.clients.matchAll({ includeUncontrolled: true });
        clients.forEach(c => c.postMessage({ type: 'hm-sent', id: item.id }));
      }
    } catch(e) {
      // Network failure: l'item resta in coda, riproveremo al prossimo sync
    }
  }
}

self.addEventListener('sync', event => {
  if (event.tag === 'hm-pending-send') {
    event.waitUntil(_hmProcessPending());
  }
});
