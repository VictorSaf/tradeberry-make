// The gateway's WebSocket server (127.0.0.1:8797, path /api/trade): browsers reach it only through host/server.mjs,
// which signs them in and forwards the upgrade with x-tb-user, x-tb-device and x-tb-gw-secret (env TB_GW_SECRET). A
// connection without the right secret is refused (403) before anything else is read; the secret is never logged.
// Each socket belongs to one broker account (resolve(user, device)); every event of that account goes to all its
// sockets and to no other. Messages are JSON: commands { op, cid, … } in, replies { cid, ok, … } and events { ev, … } out.
// More than 10 sockets on one account: the 11th is accepted and closed at once with 4029 and a text the browser shows
// (not an endless "unreachable"). check(sess) every checkMs (30 s): false (a revoked session, a disabled user) closes the
// socket with 4401. A login refused with a text meant for the user (code MOVING: the migration has not moved its account
// yet) is accepted and closed with 4503 and that text. setLive(account, user, n): the open sockets of an account, at every
// open and close and again at every check (the administration's "on a device now").
import http from 'node:http';
import { timingSafeEqual, createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const { WebSocketServer } = createRequire(import.meta.url)('ws');
const MAX_BUFFER = 1 << 20, PING_MS = 30000, MAX_SOCKS = 2000, PER_ACCOUNT = 10, CHECK_MS = 30000;
export const TOO_MANY = 'This account is open in 10 tabs or devices already: close one of them to trade here.';
export const SIGNED_OUT = 'Signed out: sign in again to trade.';
const digest = s => createHash('sha256').update(String(s)).digest();
const sameSecret = (a, b) => typeof a === 'string' && timingSafeEqual(digest(a), digest(b));

export function createWsServer({ port, host = '127.0.0.1', secret, resolve, onOpen, onCommand, log, check = null, setLive = () => {}, checkMs = CHECK_MS }) {
  if (!secret) throw new Error('gateway: TB_GW_SECRET is not set');
  const byAcct = new Map(), all = new Set();
  const server = http.createServer((req, res) => res.writeHead(426, { 'Content-Type': 'application/json' }).end('{"error":"Expected a WebSocket"}'));
  const wss = new WebSocketServer({ noServer: true, maxPayload: 16384 });
  const refuse = (socket, code, text) => { try { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); } };
  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const h = req.headers;
    if (!sameSecret(h['x-tb-gw-secret'], secret)) return refuse(socket, 403, 'Forbidden');
    if (new URL(req.url, 'http://x').pathname !== '/api/trade') return refuse(socket, 404, 'Not Found');
    if (all.size >= MAX_SOCKS) return refuse(socket, 503, 'Busy');
    const user = /^\d{1,12}$/.test(h['x-tb-user'] || '') ? +h['x-tb-user'] : null;
    let r;
    try { r = resolve(user, h['x-tb-device'] || ''); } catch (e) { log(`ws: account lookup failed (${e.name})`); return refuse(socket, 500, 'Server error'); }
    if (r.error && r.code === 'MOVING') return wss.handleUpgrade(req, socket, head, ws => { try { ws.close(4503, String(r.error).slice(0, 120)); } catch { ws.terminate(); } });
    if (r.error) return refuse(socket, r.status || 403, r.status === 400 ? 'Bad Request' : 'Forbidden');
    if ((byAcct.get(r.account)?.size || 0) >= PER_ACCOUNT) return wss.handleUpgrade(req, socket, head, ws => { try { ws.close(4029, TOO_MANY); } catch { ws.terminate(); } });
    const token = /^[0-9a-f]{64}$/.test(h['x-tb-session'] || '') ? h['x-tb-session'] : null;
    wss.handleUpgrade(req, socket, head, ws => {
      const sess = { ws, account: r.account, user, token, created: r.created, alive: true,
        send(o) { if (ws.readyState !== 1) return; if (ws.bufferedAmount > MAX_BUFFER) { ws.terminate(); return; } try { ws.send(JSON.stringify(o)); } catch {} } };
      all.add(sess);
      let set = byAcct.get(sess.account); if (!set) byAcct.set(sess.account, set = new Set()); set.add(sess);
      setLive(sess.account, user, set.size);
      ws.on('pong', () => { sess.alive = true; });
      ws.on('error', () => {});
      ws.on('close', () => { all.delete(sess); set.delete(sess); if (!set.size) byAcct.delete(sess.account); sess.closed = true; setLive(sess.account, user, set.size); });
      ws.on('message', d => {
        let cmd; try { cmd = JSON.parse(d); } catch { return sess.send({ cid: null, ok: false, code: 'BAD_JSON', text: 'Not JSON' }); }
        if (!cmd || typeof cmd !== 'object' || Array.isArray(cmd)) return sess.send({ cid: null, ok: false, code: 'BAD_JSON', text: 'Not a command' });
        try { onCommand(sess, cmd); } catch (e) { log(`ws: command ${String(cmd.op).slice(0, 20)} failed (${e.message})`); sess.send({ cid: cmd.cid ?? null, ok: false, code: 'ERROR', text: 'Gateway error' }); }
      });
      try { onOpen(sess); } catch (e) { log(`ws: open failed (${e.message})`); }
    });
  });
  const ping = setInterval(() => { for (const s of all) { if (!s.alive) { s.ws.terminate(); continue; } s.alive = false; try { s.ws.ping(); } catch {} } }, PING_MS);
  ping.unref();
  const recheck = setInterval(() => {
    for (const [a, set] of byAcct) { const u = set.values().next().value; if (u) setLive(a, u.user, set.size); }
    if (check) for (const s of all) { let okS = true; try { okS = check(s); } catch (e) { log(`ws: session check failed (${e.name})`); } if (!okS) { try { s.ws.close(4401, SIGNED_OUT); } catch { s.ws.terminate(); } } }
  }, checkMs || CHECK_MS);
  recheck.unref();
  const ready = new Promise((res, rej) => { server.once('error', rej); server.listen(port, host, () => res(server.address().port)); });
  return {
    ready,
    // every socket of an account (or all sockets)
    to: (account, o) => { for (const s of byAcct.get(account) || []) s.send(o); },
    all: o => { for (const s of all) s.send(o); },
    sessions: () => [...all],
    accounts: () => [...byAcct.keys()],
    close: () => new Promise(r => { clearInterval(ping); clearInterval(recheck); for (const s of all) { try { s.ws.close(1001); } catch {} } wss.close(); server.close(() => r()); server.closeAllConnections?.(); }),
  };
}
