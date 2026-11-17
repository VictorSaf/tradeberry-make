// A fake /api/history for the on-demand history tests (hist-range, hist-page): page.route answers each aligned window
// (7 days of 1-minute bars, 365 days of 1-hour bars) in the server's packed format with deterministic bars, one every `step` s.
export const WIN = { 1: 604800, 60: 31536000 };
export const bar = t => { const c = Math.round((1.1 + Math.sin(t / 50000) / 20) * 1e5); return { c, o: c - 3, h: c + 5, l: c - 7 }; };
// the bar as the page decodes it (livefeed.js unpack, price scale 1e5)
export const barAt = t => { const b = bar(t); return { time: t, open: b.o / 1e5, high: b.h / 1e5, low: b.l / 1e5, close: b.c / 1e5 }; };
// the server's packed format (server/legacy.js packBars), decoded by livefeed.js unpack
export function pack(from, to, step = 600, skip = false, sym = 'EURUSD') {
  const p = { sym, ps: 100000, t0: 0, dt: [], c: [], o: [], h: [], l: [] };
  if (skip) return p;
  let pt = 0, pc = 0;
  for (let t = Math.ceil(from / step) * step; t < to; t += step) { const b = bar(t); if (pt) p.dt.push((t - pt) / 60); else p.t0 = t; p.c.push(b.c - pc); p.o.push(b.c - b.o); p.h.push(b.h - b.c); p.l.push(b.c - b.l); pt = t; pc = b.c; }
  return p;
}
/* opts: step (s between bars), now (s: no bar at or after it), empty(w) / fail503(w) / delay(w) ms, with
   w = { from, res, sym, before, n: n0 - window index } (n0 lets a test number windows back from a fixed one); fail503
   fails a window's first request only unless failAlways. Returns a log: reqs [{ before, res, p, sym, from }], max/cur in flight. */
export async function mockHistory(page, opts = {}) {
  const { step = 600, now = Infinity, n0 = 0 } = opts, log = { reqs: [], max: 0, cur: 0 }, failed = new Set();
  await page.route('**/api/history**', async route => {
    const u = new URL(route.request().url()), before = +u.searchParams.get('before'), res = u.searchParams.get('res') === '60' ? 60 : 1, sym = u.searchParams.get('sym');
    const W = WIN[res], from = Math.floor((before - 1) / W) * W, w = { from, res, sym, before, n: n0 - Math.floor((before - 1) / W) };
    log.reqs.push({ before, res: u.searchParams.get('res'), p: u.searchParams.get('p'), sym, from });
    log.cur++; log.max = Math.max(log.max, log.cur);
    try {
      if (opts.delay) await new Promise(r => setTimeout(r, opts.delay(w)));
      if (opts.fail503 && opts.fail503(w) && (opts.failAlways || !failed.has(res + '|' + from))) { failed.add(res + '|' + from); return await route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Platform busy, try again"}' }); }
      const to = Math.min(from + W, now), skip = !!(opts.empty && opts.empty(w)), p = pack(from, to, step, skip, sym);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...p, from, to, more: p.c.length > 0 }) });
    } catch (e) { /* the page went away mid-answer */ } finally { log.cur--; }
  });
  return log;
}
