/* tradeBerry service worker — app shell offline, network-first for the page. Fonts are local (vendor/fonts, audit
   09.11.2026 F16): the old CDN cache is removed. Only the app's own page is kept as the shell (F14): a guide or an API
   answer opened as a page is never stored in its place. */
const VERSION = /*V*/'dev'/*V*/;
const ASSETS = /*A*/['./']/*A*/;
const SHELL = `mfx-shell-${VERSION}`, ROOT = new URL('./', self.location).pathname;
const EXTRA = ['vendor/lightweight-charts-5.2.1.js', 'vendor/fonts/fonts.css', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/favicon-32.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(SHELL).then(c => c.addAll([...ASSETS, ...EXTRA].map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting())); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => (k.startsWith('mfx-shell-') && k !== SHELL) || k === 'mfx-cdn-v1').map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener('message', e => { if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION); });
self.addEventListener('fetch', e => {
  const r = e.request; if (r.method !== 'GET') return;
  const u = new URL(r.url);
  if (u.origin !== location.origin) return;
  if (r.mode === 'navigate') { e.respondWith(fetch(r, { cache: 'no-cache' }).then(res => { if (res.ok && u.pathname === ROOT && (res.headers.get('Content-Type') || '').startsWith('text/html')) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('./', copy)); } return res; }).catch(() => caches.match('./'))); return; }
  e.respondWith(caches.match(r).then(hit => hit || fetch(r)));
});
