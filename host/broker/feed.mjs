// The live feed of a server process (the temporary broker; the gateway reuses it). With TB_FEED_HUB set (the Mac mini)
// it listens to host/feed-hub.mjs, the one reader of the platform; otherwise it reads the platform's quotes table
// every 100 ms, as host/recorder.mjs does, and hands every good answer to onQuotes([[sym, bid, ask, tMs], …]). A failed
// read hands nothing, so the market core's feedAlive() turns false 10 s after the last good one. The URL carries the
// API key: it is never logged, and neither is anything built from it (errors are logged by message, rarely).
import { parseQuotes } from '../../server/legacy.js';
import { subscribeFeed } from '../feed-client.mjs';

export function createFeed({ key = process.env.LEGACY_API_KEY, base = process.env.LEGACY_BASE || 'https://trade.capitalsvision.com/gcp/api', every = 100,
  onQuotes, log = s => console.error(new Date().toISOString(), s), fetch: get = globalThis.fetch } = {}) {
  // on the Mac mini every process listens to the one reader of the platform (host/feed-hub.mjs, TB_FEED_HUB)
  if (process.env.TB_FEED_HUB && get === globalThis.fetch) {
    let sub = null;
    // only an answer read within the last second feeds execution: the hub replays its last answer to a new listener, which
    // after a restart during a platform outage would otherwise look live for 10 s
    return { start() { sub = subscribeFeed({ onRows: (rows, at) => { if (Date.now() - at <= 1000) onQuotes(rows); }, log }); return this; }, async stop() { if (sub) sub.close(); } };
  }
  if (!key) throw new Error('feed: LEGACY_API_KEY is not set');
  const url = `${base}/quotes?apiKey=${encodeURIComponent(key)}`;
  let stop = false, errs = 0, done = null;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function poll() {
    let rows;
    try {
      const r = await get(url, { signal: AbortSignal.timeout(5000) });
      if (!r.ok) { await r.arrayBuffer().catch(() => {}); throw new Error(`Platform answered ${r.status}`); } // the body is read, so the connection is freed
      rows = parseQuotes(await r.text());
    } catch (e) { errs++; if (errs === 1 || errs % 600 === 0) log(`feed: ${e.name === 'TimeoutError' ? 'platform timeout' : e.message} (${errs} failed reads)`); return; }
    if (errs) { log(`feed: platform back after ${errs} failed reads`); errs = 0; }
    try { onQuotes(rows); } catch (e) { log(`feed: quotes handler failed (${e.name})`); }
  }
  return {
    start() {
      done = (async () => { while (!stop) { const t0 = Date.now(); await poll(); const w = every - (Date.now() - t0); if (w > 0) await sleep(w); } })();
      return this;
    },
    async stop() { stop = true; await done; },
  };
}
