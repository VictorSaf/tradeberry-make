/* The live quote stream, in the server's own process (env.RELAY, the shape functions/api/stream.js expects).
   While at least one browser is connected the platform's quotes table is read every 100 ms and each browser gets only the
   rows that changed, in the order they came: {at, q: [[sym, bid, ask, tMs], ...], all?: 1}; {at, err} while the platform
   does not answer. Nobody connected: no reads. */
import { parseQuotes } from '../server/legacy.js';
import { subscribeFeed } from './feed-client.mjs';

const TICK_MS = 100, BEAT_MS = 1000, MAX_BUFFER = 1 << 20, PING_MS = 30000;
const sleep = ms => new Promise(r => setTimeout(r, ms));

export function makeRelay(env) {
  const socks = new Set(), last = new Map();
  let running = false, okAt = 0, err = '', sentAt = 0;
  // a browser that stops reading is dropped before its backlog grows; one that vanished is found by the ping
  const send = (w, s) => { if (w.bufferedAmount > MAX_BUFFER) { socks.delete(w); try { w.terminate(); } catch (e) {} return; } try { w.send(s); } catch (e) { socks.delete(w); } };
  setInterval(() => { for (const w of socks) { if (w.tbDead) { socks.delete(w); w.terminate(); continue; } w.tbDead = true; try { w.ping(); } catch (e) {} } }, PING_MS).unref();
  const all = msg => { const s = JSON.stringify(msg); sentAt = Date.now(); for (const w of socks) send(w, s); };
  async function poll() {
    let rows = null;
    try {
      const r = await fetch(`${env.LEGACY_BASE || 'https://trade.capitalsvision.com/gcp/api'}/quotes?apiKey=${encodeURIComponent(env.LEGACY_API_KEY || '')}`, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) throw new Error(`Platform answered ${r.status}`);
      rows = parseQuotes(await r.text());
      okAt = Date.now(); err = '';
    } catch (e) { err = e.message || 'Platform unavailable'; }
    const now = Date.now();
    if (!rows) { if (now - sentAt >= BEAT_MS) all({ at: okAt, err }); return; }
    const q = [];
    for (const [s, bid, ask, t] of rows) {
      const k = last.get(s);
      if (k && k[0] === bid && k[1] === ask && k[2] === t) continue;
      last.set(s, [bid, ask, t]);
      q.push([s, bid, ask, t]);
    }
    q.sort((a, b) => a[3] - b[3]);
    if (q.length || now - sentAt >= BEAT_MS) all({ at: okAt, q });
  }
  // with TB_FEED_HUB (the Mac mini) the rows come from host/feed-hub.mjs, the one reader of the platform
  const fromRows = (rows, at) => {
    const now = Date.now(); okAt = at || now; err = '';
    const q = [];
    for (const [s, bid, ask, t] of rows) { const k = last.get(s); if (k && k[0] === bid && k[1] === ask && k[2] === t) continue; last.set(s, [bid, ask, t]); q.push([s, bid, ask, t]); }
    q.sort((a, b) => a[3] - b[3]);
    if (socks.size && (q.length || now - sentAt >= BEAT_MS)) all({ at: okAt, q });
  };
  let hubSub = null, hubBeat = null;
  if (env.TB_FEED_HUB) {
    hubSub = subscribeFeed({ onRows: fromRows, onErr: e => { err = e; if (socks.size && Date.now() - sentAt >= BEAT_MS) all({ at: okAt, err }); } });
    // the hub silent (stopped): the browsers still get their heartbeat with the reason
    hubBeat = setInterval(() => {
      if (!socks.size || Date.now() - sentAt < BEAT_MS) return;
      all(Date.now() - okAt > 3 * BEAT_MS ? { at: okAt, err: err || 'Price feed unavailable' } : { at: okAt, q: [] });
    }, BEAT_MS); hubBeat.unref();
  }
  async function loop() {
    if (running || !env.LEGACY_API_KEY || hubSub) return;
    running = true;
    try {
      while (socks.size) {
        const t0 = Date.now();
        await poll();
        const wait = TICK_MS - (Date.now() - t0);
        if (wait > 0) await sleep(wait);
      }
    } finally { running = false; }
  }
  return {
    get size() { return socks.size; },
    add(ws) {
      socks.add(ws);
      const drop = () => socks.delete(ws);
      ws.on('close', drop); ws.on('error', drop);
      ws.on('message', () => {}); // browsers only listen
      ws.on('pong', () => { ws.tbDead = false; });
      if (last.size && Date.now() - okAt < 10000) send(ws, JSON.stringify({ at: okAt, all: 1, q: [...last].map(([s, v]) => [s, ...v]) }));
      loop();
    },
    close() { if (hubSub) hubSub.close(); clearInterval(hubBeat); for (const w of socks) { try { w.close(1001); } catch (e) {} } socks.clear(); },
  };
}
