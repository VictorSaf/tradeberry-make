/* The one reader of the platform's quotes table on the Mac mini (launchd com.victor.tradeberry-feed). Before it, the
   recorder, the relay, the broker and the gateway each read it every 100 ms: four times the traffic for the same answer.
   Now this process reads it every 100 ms and hands every answer to the local processes that listen (127.0.0.1 only,
   TB_FEED_HUB, default 127.0.0.1:8799): one JSON line per read,
     {at, q: [[sym, bid, ask, tMs], …]}   every good answer, whole (each listener keeps its own "what changed")
     {at, err}                            a failed read (at: the last good answer's time, 0 if none)
   A listener that connects gets the last good answer at once if it is under 10 s old. A listener that stops reading is
   dropped before its backlog passes 4 MB; it reconnects (host/feed-client.mjs). The URL carries the API key: it is never
   logged, nor anything built from it.
   Usage: node host/feed-hub.mjs (LEGACY_API_KEY, LEGACY_BASE?, TB_FEED_HUB?). Exports startHub for the tests. */
import net from 'node:net';
import { parseQuotes } from '../server/legacy.js';

const MAX_BACKLOG = 4 << 20;
export function hubAddr(v = process.env.TB_FEED_HUB) { const [h, p] = String(v || '127.0.0.1:8799').split(':'); return { host: h || '127.0.0.1', port: +p || 8799 }; }

export async function startHub({ key = process.env.LEGACY_API_KEY, base = process.env.LEGACY_BASE || 'https://trade.capitalsvision.com/gcp/api',
  every = 100, addr = hubAddr(), fetch: get = globalThis.fetch, log = s => console.error(new Date().toISOString(), 'feed-hub: ' + s) } = {}) {
  if (!key) throw new Error('feed-hub: LEGACY_API_KEY is not set');
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(addr.host)) throw new Error('feed-hub: listens on loopback only');
  const url = `${base}/quotes?apiKey=${encodeURIComponent(key)}`;
  const socks = new Set();
  let last = null, okAt = 0, errs = 0, stop = false, reads = 0;
  const send = (s, line) => { if (s.writableLength > MAX_BACKLOG) { socks.delete(s); s.destroy(); return; } s.write(line); };
  const all = msg => { const line = JSON.stringify(msg) + '\n'; for (const s of socks) send(s, line); };
  const server = net.createServer(s => {
    socks.add(s); s.setNoDelay(true);
    const drop = () => socks.delete(s); s.on('close', drop); s.on('error', drop); s.on('data', () => {}); // listeners only listen
    if (last && Date.now() - okAt < 10000) send(s, JSON.stringify({ at: okAt, q: last }) + '\n');
  });
  await new Promise((res, rej) => { server.once('error', rej); server.listen(addr.port, addr.host, res); });
  async function poll() {
    try {
      const r = await get(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) { await r.arrayBuffer().catch(() => {}); throw new Error(`platform answered ${r.status}`); } // body read: the connection is freed
      last = parseQuotes(await r.text()); okAt = Date.now(); reads++;
      if (errs) { log(`platform back after ${errs} failed reads`); errs = 0; }
      all({ at: okAt, q: last });
    } catch (e) {
      errs++; if (errs === 1 || errs % 600 === 0) log(`${e.name === 'TimeoutError' ? 'platform timeout' : String(e.message).split(key).join('***').split(encodeURIComponent(key)).join('***')} (${errs} failed reads)`);
      all({ at: okAt, err: e.name === 'TimeoutError' ? 'Platform timeout' : 'Platform unavailable' });
    }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const done = (async () => { while (!stop) { const t0 = Date.now(); await poll(); const w = every - (Date.now() - t0); if (w > 0) await sleep(w); } })();
  return {
    port: server.address().port,
    get listeners() { return socks.size; }, get reads() { return reads; },
    async close() { stop = true; await done; for (const s of socks) s.destroy(); socks.clear(); await new Promise(r => server.close(r)); },
  };
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) {
  const h = await startHub();
  console.log(new Date().toISOString(), `feed-hub: reading the platform every 100 ms, serving 127.0.0.1:${h.port}`);
  setInterval(() => console.log(new Date().toISOString(), `feed-hub: ${h.reads} reads since start, ${h.listeners} listeners`), 600000).unref();
  const end = async () => { await h.close(); console.log(new Date().toISOString(), 'feed-hub: stopped'); process.exit(0); };
  process.on('SIGTERM', end); process.on('SIGINT', end);
}
