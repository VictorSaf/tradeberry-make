#!/usr/bin/env node
/* tradeBerry on its own machine: one Node process that does what Cloudflare Pages did.
   - Runs the same Pages Functions (functions/_middleware.js around functions/api/*.js) unchanged, with the same context:
     { request, env, params, data, next, waitUntil }. env.DB is a SQLite file (host/d1.mjs), env.RELAY the in-process
     quote stream (host/relay.mjs), LEGACY_API_KEY / LEGACY_BASE come from the environment.
   - Serves the built app (1-aplicatie-publicabila) as Pages did: index.html for /, ETag/304, unknown paths get the page.
   - Stands in for the two edge features server/ relies on: fetch(url, { cf: { cacheTtl } }) and caches.default, both kept
     in memory here.
   It listens on 127.0.0.1 only; the outside reaches it through a Cloudflare tunnel, which sets X-Forwarded-Proto and
   CF-Connecting-IP. Settings (environment): TB_PORT (8796), TB_APP (built app dir), TB_DB (SQLite file), TB_DATA (the recorder's ticks and the price archive: TB_DB's folder), TB_HOST (127.0.0.1),
   TB_GW_PORT (8797) and TB_GW_SECRET: /api/trade is forwarded to the execution gateway (host/gateway.mjs) after the
   sign-in, with x-tb-user / x-tb-device set here (whatever the visitor sent under x-tb-* is dropped) and the shared
   secret, which is never logged; without TB_GW_SECRET /api/trade answers 503. */
import http from 'node:http';
import net from 'node:net';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, readdirSync } from 'node:fs';
import { join, resolve, normalize, extname, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocketServer } from 'ws';
import { openD1 } from './d1.mjs';
import { makeRelay } from './relay.mjs';

const HERE = dirname(fileURLToPath(import.meta.url)), CODE = resolve(HERE, '..');
const PORT = +(process.env.TB_PORT || 8796), BIND = process.env.TB_HOST || '127.0.0.1';
// CF-Connecting-IP (login rate limit) and X-Forwarded-Proto are trusted only because nothing but the tunnel can connect
if (!/^(127\.0\.0\.1|::1|localhost)$/.test(BIND)) { console.error('TB_HOST must be a loopback address (the tunnel connects locally)'); process.exit(1); }
const APP = resolve(process.env.TB_APP || join(CODE, '..', '1-aplicatie-publicabila'));
const DBFILE = resolve(process.env.TB_DB || join(CODE, '.data', 'tradeberry.db'));
const UPGRADE = 'x-tb-upgrade-' + Math.random().toString(36).slice(2); // internal marker, never sent out
const GW_PORT = +(process.env.TB_GW_PORT || 8797), GW_SECRET = process.env.TB_GW_SECRET || '';

/* ---- edge stand-ins: fetch cache (cf.cacheTtl) and caches.default ---- */
// the history pages have keys that move with the clock, so expired entries are swept, not only replaced
const memo = new Map(); let memoBytes = 0; const MEMO_MAX = 48 * 1024 * 1024;
const sweep = () => { const t = Date.now(); for (const [k, v] of memo) if (v.until < t) { memo.delete(k); memoBytes -= v.body.byteLength; } };
setInterval(sweep, 60000).unref();
const keep = (k, v) => {
  if (v.body.byteLength > MEMO_MAX / 8) return;
  if (memo.has(k)) { memoBytes -= memo.get(k).body.byteLength; memo.delete(k); }
  memo.set(k, v); memoBytes += v.body.byteLength;
  for (const [ok, ov] of memo) { if (memoBytes <= MEMO_MAX) break; memo.delete(ok); memoBytes -= ov.body.byteLength; }
};
const fromMemo = k => { const v = memo.get(k); if (!v) return null; if (v.until < Date.now()) { memo.delete(k); memoBytes -= v.body.byteLength; return null; } return new Response(v.body.slice(0), { status: v.status, headers: v.headers }); };
const rawFetch = globalThis.fetch;
globalThis.fetch = async (input, init = {}) => {
  const ttl = init && init.cf && +init.cf.cacheTtl, method = (init && init.method) || (input instanceof Request ? input.method : 'GET');
  if (init && init.cf) { init = { ...init }; delete init.cf; }
  if (!(ttl > 0) || method !== 'GET') return rawFetch(input, init);
  const k = 'f:' + (input instanceof Request ? input.url : String(input));
  const hit = fromMemo(k); if (hit) return hit;
  const r = await rawFetch(input, { ...init, signal: init.signal || AbortSignal.timeout(120000) });
  if (!r.ok) return r;
  const body = await r.arrayBuffer();
  const v = { body, status: r.status, headers: [...r.headers].filter(([h]) => !/^(content-encoding|content-length|transfer-encoding)$/i.test(h)), until: Date.now() + ttl * 1000 };
  keep(k, v);
  return new Response(body.slice(0), { status: v.status, headers: v.headers });
};
globalThis.caches = { default: {
  async match(req) { return fromMemo('c:' + (req.url || String(req))); },
  async put(req, res) {
    const m = /max-age=(\d+)/.exec(res.headers.get('Cache-Control') || ''); if (!m) return;
    keep('c:' + (req.url || String(req)), { body: await res.arrayBuffer(), status: res.status, headers: [...res.headers], until: Date.now() + +m[1] * 1000 });
  },
} };

/* ---- env ---- */
const env = { DB: openD1(DBFILE), TB_DATA: process.env.TB_DATA || dirname(DBFILE), LEGACY_API_KEY: process.env.LEGACY_API_KEY || '', ...(process.env.LEGACY_BASE ? { LEGACY_BASE: process.env.LEGACY_BASE } : {}), ...(process.env.TB_FEED_HUB ? { TB_FEED_HUB: process.env.TB_FEED_HUB } : {}) };
const relay = makeRelay(env);
env.RELAY = { idFromName: n => n, get: () => ({ fetch: async () => new Response(null, { status: 200, headers: { [UPGRADE]: '1' } }) }) };
// functions/api/trade.js: the signed-in user (and device) whose upgrade goes on to the gateway
if (GW_SECRET) env.GATEWAY = { open: (user, device) => new Response(null, { status: 200, headers: { [UPGRADE]: 'trade', [UPGRADE + '-user']: String(user), [UPGRADE + '-device']: device || '' } }) };

/* ---- functions ---- */
const FN = join(CODE, 'functions');
const middleware = await import(pathToFileURL(join(FN, '_middleware.js')).href);
const routes = new Map();
for (const f of readdirSync(join(FN, 'api'))) if (f.endsWith('.js')) routes.set('/api/' + f.slice(0, -3), await import(pathToFileURL(join(FN, 'api', f)).href));
const METHODS = ['Get', 'Post', 'Put', 'Patch', 'Delete', 'Head', 'Options'];

/* ---- static app ---- */
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.map': 'application/json', '.gz': 'application/gzip', '.bin': 'application/octet-stream' };
function fileFor(pathname) {
  let p; try { p = decodeURIComponent(pathname); } catch (e) { return null; }
  if (p.includes('\0')) return null;
  if (p.endsWith('/')) p += 'index.html';
  const full = normalize(join(APP, p));
  if (full !== APP && !full.startsWith(APP + sep)) return null;
  try { const st = statSync(full); if (st.isFile()) return { full, st }; if (st.isDirectory()) { const i = join(full, 'index.html'), s2 = statSync(i); if (s2.isFile()) return { full: i, st: s2 }; } } catch (e) {}
  return null;
}
/* ---- the page's Content Security Policy (security audit 09.11.2026, F06) ----
   Enforced now: what cannot break the app (no framing by other sites, no plugins, no <base> rewrite, forms to this site).
   Report-only for now: the full policy, scripts from this site only plus the hash of each inline script of that very
   page (read from the file, so a build's MFX_BUILD line or a guide's script needs no list kept by hand). Its reports go
   to /api/csp (functions/api/csp.js, a line in server.log); once they stay quiet it becomes the enforced policy. */
const CSP_BASE = "object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'";
const inlineHashes = new Map();
function inlineHashesOf(full, etag) {
  const k = full + etag; if (inlineHashes.has(k)) return inlineHashes.get(k);
  const html = readFileSync(full, 'utf8'), out = [];
  for (const m of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) out.push(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
  const v = [...new Set(out)].join(' ');
  if (inlineHashes.size > 200) inlineHashes.clear();
  inlineHashes.set(k, v); return v;
}
const cspFull = (host, hashes) => `default-src 'self'; script-src 'self'${hashes ? ' ' + hashes : ''}; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; connect-src 'self' wss://${host}; frame-src 'self'; worker-src 'self'; manifest-src 'self'; ${CSP_BASE}; report-uri /api/csp`;

async function serveStatic(request) {
  const u = new URL(request.url);
  if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
  if (u.pathname.endsWith('/index.html')) return new Response(null, { status: 308, headers: { Location: u.pathname.slice(0, -10) + u.search } });
  // like Pages without a 404.html: a path that is not a file gets the app's page
  const f = fileFor(u.pathname) || fileFor('/');
  if (!f) return new Response('Not found', { status: 404 });
  const etag = `"${f.st.size.toString(36)}-${Math.floor(f.st.mtimeMs).toString(36)}"`;
  const h = { 'Content-Type': TYPES[extname(f.full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'public, max-age=0, must-revalidate', ETag: etag, 'X-Content-Type-Options': 'nosniff' };
  if (extname(f.full).toLowerCase() === '.html') {
    h['Content-Security-Policy'] = CSP_BASE;
    h['Content-Security-Policy-Report-Only'] = cspFull(u.host, inlineHashesOf(f.full, etag));
    h['Cross-Origin-Opener-Policy'] = 'same-origin';
    h['X-Frame-Options'] = 'SAMEORIGIN';
  }
  if ((request.headers.get('If-None-Match') || '').split(/\s*,\s*/).includes(etag)) return new Response(null, { status: 304, headers: h });
  return new Response(request.method === 'HEAD' ? null : readFileSync(f.full), { status: 200, headers: h });
}

/* ---- one request through middleware → function → static ---- */
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
async function handle(request) {
  const url = new URL(request.url), p = url.pathname, data = {};
  // as Pages did: a public address is HTTPS only (the tunnel says which one the visitor used)
  if (url.protocol === 'http:' && !LOCAL_HOST.test(url.host)) { url.protocol = 'https:'; return new Response(null, { status: 308, headers: { Location: url.href } }); }
  const route = routes.get(p);
  const runRoute = () => {
    if (!route) return serveStatic(request);
    const m = request.method[0] + request.method.slice(1).toLowerCase();
    const fn = route['onRequest' + m] || (m === 'Head' && route.onRequestGet) || route.onRequest;
    if (!fn) return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { 'Content-Type': 'application/json', Allow: METHODS.filter(x => route['onRequest' + x]).map(x => x.toUpperCase()).join(', ') } });
    return fn({ request, env, params: {}, data, next: () => serveStatic(request), waitUntil() {}, functionPath: p });
  };
  return middleware.onRequest({ request, env, params: {}, data, next: runRoute, waitUntil() {}, functionPath: p });
}

function toRequest(req, body) {
  if (!/^[A-Za-z0-9.\-:\[\]]{1,255}$/.test(req.headers.host || 'localhost')) throw Object.assign(new Error('Bad Host header'), { status: 400 });
  const proto = (req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https' ? 'https' : 'http';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) { if (k.startsWith(':')) continue; if (Array.isArray(v)) v.forEach(x => headers.append(k, x)); else if (v != null) headers.set(k, v); }
  return new Request(`${proto}://${req.headers.host || 'localhost'}${req.url}`, { method: req.method, headers, body: body && body.length ? body : undefined });
}

const MAX_BODY = 8 * 1024 * 1024;
const SEC_HEADERS = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), hid=(), bluetooth=()' };
const server = http.createServer(async (req, res) => {
  try {
    const chunks = []; let size = 0;
    if (req.method !== 'GET' && req.method !== 'HEAD') for await (const c of req) { size += c.length; if (size > MAX_BODY) { res.writeHead(413).end('Request too large'); return; } chunks.push(c); }
    const out = await handle(toRequest(req, Buffer.concat(chunks)));
    const headers = {};
    if ((req.headers['x-forwarded-proto'] || '') === 'https') headers['strict-transport-security'] = 'max-age=31536000; includeSubDomains';
    // on every answer (security audit 09.11.2026, F06); a function's own value wins
    Object.assign(headers, SEC_HEADERS);
    for (const [k, v] of out.headers) if (k !== 'set-cookie' && !k.startsWith('x-tb-upgrade-')) headers[k] = v;
    const cookies = out.headers.getSetCookie(); if (cookies.length) headers['set-cookie'] = cookies;
    if (out.headers.get(UPGRADE)) { res.writeHead(426, { 'Content-Type': 'application/json' }).end('{"error":"Expected a WebSocket"}'); return; }
    res.writeHead(out.status, headers);
    if (out.body && req.method !== 'HEAD') res.end(Buffer.from(await out.arrayBuffer())); else res.end();
  } catch (e) {
    if (e && e.status === 400) { if (!res.headersSent) res.writeHead(400); res.end(); return; }
    console.error(new Date().toISOString(), req.method, req.url, e && e.stack || e);
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end('{"error":"Server error"}');
  }
});

// WebSocket (/api/stream): the request goes through the same middleware and function; only their yes opens the socket
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', async (req, socket, head) => {
  socket.on('error', () => {}); // a visitor who hangs up mid-handshake must not take the process down
  const refuse = (code, text) => { if (!socket.writable) return socket.destroy(); try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch (e) { socket.destroy(); } };
  try {
    const out = await handle(toRequest(req));
    if (!out.headers.get(UPGRADE)) return refuse(out.status === 200 ? 400 : out.status, 'Refused');
    if (out.headers.get(UPGRADE) === 'trade') return toGateway(req, socket, head, out.headers.get(UPGRADE + '-user'), out.headers.get(UPGRADE + '-device'), refuse);
    if (relay.size >= 500) return refuse(503, 'Busy');
    if (socket.destroyed) return;
    wss.handleUpgrade(req, socket, head, ws => relay.add(ws));
  } catch (e) { console.error('upgrade', e); refuse(500, 'Server error'); }
});

// /api/trade: the upgrade request goes on to the gateway as it came, minus any x-tb-* header, Cookie and Authorization
// (the sign-in stays here), plus the signed-in user,
// the device and the secret; then the bytes flow both ways untouched (the gateway answers the handshake itself)
let gwSocks = 0; const GW_MAX = 2000;
function toGateway(req, socket, head, user, device, refuse) {
  if (!/^\d+$/.test(user || '') || !/^[a-z0-9]{0,40}$/.test(device || '')) return refuse(500, 'Server error');
  if (gwSocks >= GW_MAX) return refuse(503, 'Busy');
  gwSocks++; let counted = true; const uncount = () => { if (counted) { counted = false; gwSocks--; } };
  const up = net.connect(GW_PORT, '127.0.0.1');
  let open = false;
  up.on('connect', () => {
    open = true;
    const lines = ['GET /api/trade HTTP/1.1'];
    for (let i = 0; i < req.rawHeaders.length; i += 2) if (!/^(x-tb-.*|cookie|authorization)$/i.test(req.rawHeaders[i])) lines.push(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}`);
    lines.push(`x-tb-user: ${user}`, `x-tb-device: ${device || ''}`, `x-tb-gw-secret: ${GW_SECRET}`);
    // the session's token hash (never the token): the gateway checks that very session again every ~30 s (revoked: closed)
    const tok = /(?:^|;\s*)(?:__Host-)?tb_s=([0-9a-f]{64})(?:;|$)/.exec(req.headers.cookie || '');
    if (tok) lines.push(`x-tb-session: ${createHash('sha256').update(tok[1]).digest('hex')}`);
    up.write(lines.join('\r\n') + '\r\n\r\n');
    if (head && head.length) up.write(head);
    socket.pipe(up); up.pipe(socket);
  });
  up.on('error', () => { if (!open) refuse(503, 'Execution gateway unavailable'); else socket.destroy(); });
  up.on('close', () => { uncount(); socket.destroy(); });
  socket.on('close', () => { uncount(); up.destroy(); });
}

server.headersTimeout = 20000; server.requestTimeout = 60000; server.keepAliveTimeout = 65000;
server.listen(PORT, BIND, () => console.log(`${new Date().toISOString()} tradeBerry on http://${BIND}:${PORT} · app ${APP} · db ${DBFILE}`));
server.on('clientError', (e, socket) => { if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'); else socket.destroy(); });
process.on('uncaughtException', e => { console.error(new Date().toISOString(), 'uncaught', e && e.stack || e); });
const stop = () => { relay.close(); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 3000).unref(); };
process.on('SIGTERM', stop); process.on('SIGINT', stop);
