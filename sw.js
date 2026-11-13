// Nefes service worker: önce ağ, ağ yoksa önbellek. Böylece çevrimiçiyken hep güncel, çevrimdışıyken açılır.
const ONBELLEK = 'nefes-v1';
const KABUK = ['./', 'index.html', 'manifest.webmanifest', 'ikon-192.png', 'markalar.json', 'fiyatlar.json', 'kur.json', 'yiufe.json', 'yatirim.json'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(ONBELLEK).then(c => c.addAll(KABUK)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(k => Promise.all(k.filter(a => a !== ONBELLEK).map(a => caches.delete(a)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const yerel = url.origin === location.origin;
  const font = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (!yerel && !font) return;
  e.respondWith(
    fetch(e.request).then(cevap => {
      if (cevap.ok || cevap.type === 'opaque') { const kopya = cevap.clone(); caches.open(ONBELLEK).then(c => c.put(e.request, kopya)); }
      return cevap;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(c => c || caches.match('index.html')))
  );
});
