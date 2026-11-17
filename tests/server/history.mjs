// Server history windows + shared datafeed limiter (server/legacy.js), no browser: globalThis.fetch is replaced by a fake
// platform that counts requests, honours cf.cacheTtl like host/server.mjs does, and (like the real one) ignores `from`.
// Usage, from 2-cod-sursa:  node tests/server/history.mjs   (exit code 1 on any failure)
import { historyWindow, history, _lim } from '../../server/legacy.js';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const W1 = 604800, nowS = () => Math.floor(Date.now() / 1000);

let reqs = [], memo = new Map(), clock = 1e6, pending = [], clockStarts = [], mode = 'bars';
let bodyOverride = null;
const fake = async (url, init = {}) => {
  url = String(url);
  if (url.includes('/symbol_info')) return Response.json({ symbol: ['EURUSD'], ticker: ['EUR A0-FX'], pricescale: [100000] });
  const ttl = init.cf && init.cf.cacheTtl;
  if (ttl && memo.has(url)) return Response.json(memo.get(url));
  const q = new URL(url).searchParams, from = +q.get('from'), to = +q.get('to');
  reqs.push({ from, to, ttl, at: clock }); clockStarts.push(clock);
  let body = { s: 'no_data' };
  if (bodyOverride) body = bodyOverride(init);
  else if (mode === 'bars') { // 3 bars before `from` (the platform ignores it) and 3 inside the window
    const t = [from - 180, from - 120, from - 60, from, from + 60, from + 120].filter(x => x <= to);
    body = { s: 'ok', t, o: t.map(() => 1.1), h: t.map(() => 1.2), l: t.map(() => 1.0), c: t.map(() => 1.1) };
  }
  if (ttl) memo.set(url, body);
  return Response.json(body);
};
globalThis.fetch = fake;
// fake clock: a wait advances it at once and fires on the next macrotask (all same-tick enqueues are in by then)
const fastClock = () => { _lim.now = () => clock; _lim.wait = (ms, f) => { clock += ms; setImmediate(f); }; };
const reset = (m = 'bars') => { reqs = []; memo = new Map(); clockStarts = []; mode = m; clock += 10000; _lim.forget(); fastClock(); };

// SH1: aligned window, one platform request for two `before` in the same window; bars outside [from, to) cut locally
{
  reset(); const T = nowS() - 20 * 86400, from = Math.floor((T - 1) / W1) * W1;
  const a = await historyWindow('EURUSD', 1, T), b = await historyWindow('EURUSD', 1, from + 100);
  ok(reqs.length === 1, 'SH1 one platform request for two calls in one window: ' + reqs.length);
  ok(reqs[0].from === from && reqs[0].to === from + W1, 'SH1 asks the aligned window: ' + JSON.stringify(reqs[0]));
  ok(a.from === from && a.to === from + W1 && a.more === true, 'SH1 from/to/more in the answer');
  ok(a.t0 === from && a.c.length === 3 && a.sym === 'EURUSD' && b.t0 === from, 'SH1 bars before `from` are cut: t0=' + a.t0 + ' n=' + a.c.length);
  ok(reqs[0].ttl === 86400, 'SH1 a closed window sits at the edge for a day: ' + reqs[0].ttl);
  reset(); const cur = await historyWindow('EURUSD', 1, nowS());
  ok(reqs[0].ttl === 30 && cur.to === reqs[0].to && cur.to % 30 === 0 && cur.to >= nowS() && cur.to - nowS() <= 30 && cur.to - cur.from <= W1, 'SH1 the window holding now: 30 s, asked up to the next 30-second mark: ' + (cur.to - nowS()));
  const n0 = reqs.length, again = await historyWindow('EURUSD', 1, nowS());
  ok(again.to !== cur.to || reqs.length === n0, 'SH1 a second viewer within the 30 s is answered from the cache: ' + (reqs.length - n0));
  reset(); const h = await historyWindow('EURUSD', 60, nowS() - 400 * 86400);
  ok(reqs[0].to - reqs[0].from === 31536000 && h.from % 31536000 === 0, 'SH1 1-hour windows are 365 days');
}
// SH2: no candle → more false; before beyond the cap → no request at all
{
  reset('empty'); const e = await historyWindow('EURUSD', 1, nowS() - 20 * 86400);
  ok(e.more === false && e.c.length === 0, 'SH2 empty answer → more false, no bars');
  reset(); const o1 = await historyWindow('EURUSD', 1, nowS() - 401 * 86400), o2 = await historyWindow('EURUSD', 60, 1640995200);
  ok(reqs.length === 0 && o1.more === false && o2.more === false && o1.c.length === 0, 'SH2 before older than the cap: no request, more false (' + reqs.length + ')');
  let st = 0; try { await historyWindow('NOPE', 1, nowS()); } catch (x) { st = x.status; }
  ok(st === 404, 'SH2 unknown instrument is not answered with bars');
}
// SH3: 6 background + 2 startup in one tick → startup first, at most 2 starts in any 1000 ms
{
  reset(); const order = [], T = nowS() - 30 * 86400;
  const bg = Array.from({ length: 6 }, (_, i) => historyWindow('EURUSD', 1, T - i * W1, 1).then(() => order.push('bg')));
  const st = [0, 1].map(i => history('EURUSD', i + 1, 1).then(() => order.push('st')));
  await Promise.all([...bg, ...st]);
  ok(order.slice(0, 2).join() === 'st,st', 'SH3 startup requests start first: ' + order.join());
  ok(reqs.length === 8, 'SH3 8 requests: ' + reqs.length);
  const worst = Math.max(...clockStarts.map(s => clockStarts.filter(x => x >= s && x < s + 1000).length));
  ok(worst <= 2, 'SH3 at most 2 starts in a 1000 ms window: ' + worst);
}
// SH4: an entry that waits over 30 s is refused with 503
{
  reset(); const timers = [];
  _lim.now = () => clock; _lim.wait = (ms, f) => timers.push({ at: clock + ms, f });
  const T = nowS() - 30 * 86400, ps = [0, 1, 2].map(i => historyWindow('EURUSD', 1, T - i * W1, 1).then(() => 'ok', x => x));
  const tick = async () => { for (let i = 0; i < 20; i++) await new Promise(r => setImmediate(r)); };
  await tick(); for (const t of timers.splice(0)) t.f(); await tick(); // first pump: 2 start, the third waits
  clock += 31000; for (const t of timers.splice(0)) t.f(); await tick(); // jump past 30 s, wake the pump
  const r = await Promise.all(ps);
  ok(r[2] && r[2].status === 503 && /Platform busy/.test(r[2].message), 'SH4 waiter over 30 s → 503: ' + (r[2] && (r[2].status || r[2])));
  ok(r[0] === 'ok', 'SH4 the first request was served');
}
// SH5: repeats within the TTL spend no limiter slot; concurrent identical calls make one platform request
{
  reset(); const T = nowS() - 40 * 86400; let slots = 0; const w0 = _lim.wait; _lim.wait = (ms, f) => { slots++; w0(ms, f); };
  const [a, b] = await Promise.all([historyWindow('EURUSD', 1, T), historyWindow('EURUSD', 1, T - 5)]);
  ok(reqs.length === 1 && a.c.length === b.c.length, 'SH5 two concurrent identical calls: one platform request: ' + reqs.length);
  const s0 = slots; for (let i = 0; i < 5; i++) await historyWindow('EURUSD', 1, T);
  ok(slots === s0 && reqs.length === 1, 'SH5 repeats within the TTL spend no limiter slot: ' + (slots - s0) + ' waits, ' + reqs.length + ' requests');
  _lim.wait = w0;
}
// SH6: an error body is an error (502), not "no more history"; it is not kept, and is re-asked past the cache once
{
  reset(); bodyOverride = init => ({ s: 'error', errmsg: 'boom' });
  let st = 0; try { await historyWindow('EURUSD', 1, nowS() - 50 * 86400); } catch (x) { st = x.status; }
  ok(st === 502, 'SH6 {s:"error"} → 502, not more:false: ' + st);
  const n = reqs.length; bodyOverride = null;
  const good = await historyWindow('EURUSD', 1, nowS() - 50 * 86400);
  ok(good.more === true && reqs.length === n + 1, 'SH6 the failure was not kept: the next call asks again and gets bars');
  bodyOverride = null;
}
// SH7: the answer map is bounded by bytes; history() also refuses an error body
{
  reset(); _lim.budget = 3 * (200 + 40 * 3); const T = nowS() - 60 * 86400; // room for ~3 windows of 3 bars
  for (let i = 0; i < 10; i++) await historyWindow('EURUSD', 1, T - i * W1);
  const [n, bytes] = _lim.held(); ok(n <= 3 && bytes <= _lim.budget, 'SH7 the map stays under its budget: ' + n + ' entries, ' + bytes + ' bytes');
  _lim.budget = 4e6; reset(); bodyOverride = () => ({ s: 'error' });
  let st = 0; try { await history('EURUSD', 1, 1); } catch (x) { st = x.status; }
  ok(st === 502, 'SH7 history() with an error body → 502, not "no more pages": ' + st); bodyOverride = null;
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
