/* tradeBerry service worker — app shell offline, network-first for the page, cached CDN libraries */
const VERSION = /*V*/'dev'/*V*/;
const ASSETS = /*A*/['./']/*A*/;
const SHELL = `mfx-shell-${VERSION}`, CDN = 'mfx-cdn-v1';
const EXTRA = ['vendor/lightweight-charts-5.2.1.js', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll([...ASSETS, ...EXTRA].map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('mfx-shell-') && k !== SHELL).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (/fontshare\.com|fonts\.(googleapis|gstatic)\.com/.test(u.hostname)) {
    e.respondWith(caches.open(CDN).then(async c => { const hit = await c.match(r); const net = fetch(r).then(res => { if (res.ok || res.type === 'opaque') c.put(r, res.clone()); return res; }).catch(() => hit); return hit || net; }));
    return;
  }
  if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('./', copy)); } return res; }).catch(() => caches.match('./'))); return; }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r)));
});
