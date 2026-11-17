/* A listener of host/feed-hub.mjs: connects to TB_FEED_HUB (127.0.0.1:8799), reads its JSON lines and hands them on:
   onRows([[sym, bid, ask, tMs], …], at) for a good answer, onErr(err, at) for a failed platform read. While the hub is not
   there it hands nothing (the market core's feedAlive() turns false after 10 s, as with a dead platform) and tries again
   every second; the first failure and every 600th are logged. */
import net from 'node:net';
import { hubAddr } from './feed-hub.mjs';

export function subscribeFeed({ addr = hubAddr(), onRows, onErr = () => {}, log = s => console.error(new Date().toISOString(), s), retryMs = 1000 } = {}) {
  let sock = null, stop = false, buf = '', fails = 0, timer = null;
  const handle = line => {
    let m; try { m = JSON.parse(line); } catch (e) { return; }
    try { if (Array.isArray(m.q)) onRows(m.q, m.at); else if (m.err) onErr(m.err, m.at); } catch (e) { log(`feed: quotes handler failed (${e.name})`); }
  };
  function connect() {
    if (stop) return;
    sock = net.connect(addr.port, addr.host);
    sock.setEncoding('utf8');
    sock.on('connect', () => { if (fails) log(`feed: hub back after ${fails} failed connects`); fails = 0; });
    sock.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); if (l) handle(l); } if (buf.length > 1 << 22) buf = ''; });
    sock.on('error', () => {});
    sock.on('close', () => {
      buf = ''; if (stop) return;
      fails++; if (fails === 1 || fails % 600 === 0) log(`feed: hub ${addr.host}:${addr.port} not reachable (${fails} tries)`);
      timer = setTimeout(connect, retryMs);
    });
  }
  connect();
  return { close() { stop = true; clearTimeout(timer); if (sock) sock.destroy(); } };
}
