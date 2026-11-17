/* Local source against the live server: node tools/live-proxy.mjs [port]   (default 8790; TB_LIVE overrides the target)
   Serves the source files from this folder and forwards /api/* (HTTP and the WebSocket streams) to tb.oneaigency.com,
   so prices, sign-in, accounts and execution are the real ones. Origin is rewritten to the target's, because the server
   accepts state-changing requests only from its own pages. The session cookie is the live one (__Host-tb_s, Secure:
   the browser keeps it on http://localhost). Everything done here acts on the real account. */
import http from 'node:http';
import https from 'node:https';
import tls from 'node:tls';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const PORT = +(process.argv[2] || process.env.PORT || 8790);
const TARGET = new URL(process.env.TB_LIVE || 'https://tb.oneaigency.com');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8' };

// request headers for the target: its own host and origin; hop-by-hop headers dropped
function upstreamHeaders(h) {
  const out = { ...h, host: TARGET.host };
  if (out.origin) out.origin = TARGET.origin;
  if (out.referer) out.referer = TARGET.origin + new URL(out.referer).pathname;
  delete out.connection; delete out['keep-alive']; delete out['accept-encoding'];
  return out;
}

async function serveFile(req, res) {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = normalize(join(ROOT, p));
  if (!file.startsWith(ROOT) || /\/(\.git|node_modules|data)\//.test(file)) { res.writeHead(403).end(); return; }
  try {
    if (!(await stat(file)).isFile()) throw 0;
    if (res.headersSent) return;
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(await readFile(file));
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('Not found'); }
}

function proxy(req, res) {
  const up = https.request({ host: TARGET.hostname, port: TARGET.port || 443, method: req.method, path: req.url, headers: upstreamHeaders(req.headers), servername: TARGET.hostname }, r => {
    const h = { ...r.headers }; delete h['transfer-encoding'];
    res.writeHead(r.statusCode, h); r.pipe(res);
  });
  up.on('error', e => { if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'live server unreachable: ' + e.code })); });
  req.pipe(up);
}

// a page load asks the live server first: signed out → its login page; signed in → the local page, with the server's
// cookies (tb_u=1 wakes cloud.js up)
function page(req, res) {
  const up = https.request({ host: TARGET.hostname, port: TARGET.port || 443, method: 'GET', path: '/', headers: upstreamHeaders(req.headers), servername: TARGET.hostname }, r => {
    if (r.statusCode !== 200) { const h = { ...r.headers }; delete h['transfer-encoding']; res.writeHead(r.statusCode, h); r.pipe(res); return; }
    r.resume();
    if (r.headers['set-cookie']) res.setHeader('Set-Cookie', r.headers['set-cookie']);
    serveFile(req, res);
  });
  up.on('error', () => serveFile(req, res));
  up.end();
}
const isPage = req => req.method === 'GET' && (/\/$|\.html$/.test(new URL(req.url, 'http://x').pathname) || (req.headers.accept || '').includes('text/html'));
const server = http.createServer((req, res) => (req.url.startsWith('/api/') ? proxy(req, res) : isPage(req) ? page(req, res) : serveFile(req, res)));

// WebSocket (/api/stream, /api/trade): the upgrade request goes to the target over TLS, then the two sockets are piped
server.on('upgrade', (req, sock, head) => {
  if (!req.url.startsWith('/api/')) { sock.destroy(); return; }
  const up = tls.connect({ host: TARGET.hostname, port: +(TARGET.port || 443), servername: TARGET.hostname }, () => {
    const h = upstreamHeaders(req.headers); h.connection = 'Upgrade';
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n` + Object.entries(h).map(([k, v]) => `${k}: ${v}`).join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    if (process.env.TB_PROXY_DEBUG) up.once('data', b => console.log('[ws]', req.url.split('?')[0], 'cookie:', /tb_s=/.test(req.headers.cookie || ''), '→', String(b).split('\r\n')[0]));
    up.pipe(sock); sock.pipe(up);
  });
  const end = () => { up.destroy(); sock.destroy(); };
  up.on('error', end); sock.on('error', end); up.on('close', end); sock.on('close', end);
});

server.listen(PORT, '127.0.0.1', () => console.log(`live proxy: http://localhost:${PORT} → source in ${ROOT}, /api → ${TARGET.origin}`));
