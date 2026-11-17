// Market core (core/market.js) in Node against Engine in the browser (tests/engine.html), and the core's feed rules.
// Usage, from 2-cod-sursa:  node tests/server/market-core.mjs   (exit code 1 on any failure)
import { chromium } from 'playwright';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { MarketCore, CATALOG } from '../../core/market.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SYMS = ['EURUSD', 'USDJPY', 'GBPUSD', 'EURHUF', 'USDTRY', 'AUDNZD', 'US.500', 'DE.30', 'US.100', 'FTSE.100',
  'GOLD', 'OIL', 'BTCUSD', 'ETHUSD', 'BTCEUR', 'XRPUSD', 'AAPL.US', 'AMZN.US', 'BA.US', 'BUNDDE.10'];
const NO_ASK = new Set(['EURHUF', 'DE.30', 'GOLD', 'AAPL.US']); // ask = bid + the sheet (night/default spread); none jittered
const MOMENTS = {
  'Monday 08:00 UTC': '2026-11-02T08:00:00Z',
  'Friday 21:59 UTC': '2026-11-06T21:59:00Z',
  'Friday 22:01 UTC': '2026-11-06T22:01:00Z',
  'Saturday': '2026-11-07T12:00:00Z',
  'March DST change': '2026-03-29T01:00:30Z',
  'rollover 17:00 New York': '2026-11-04T22:00:00Z'
};
// one deterministic row per symbol: the sheet's seed bid, a spread of 3–11 points, 3 s old
const rowsAt = ms => SYMS.map((s, i) => {
  const r = CATALOG.instr.find(x => x.sym === s), bid = r.seed.bid, ask = NO_ASK.has(s) ? null : +(bid + (3 + i % 9) * r.point).toFixed(r.digits);
  return [s, bid, ask, ms - 3000];
});
const pick = q => q && { bid: q.bid, ask: q.ask, spread: q.spread, open: q.open, why: q.why, sp: q.sp, t: q.t };

console.log('MC1 Engine (browser) and MarketCore (Node): same quotes, sessions and offsets for 20 symbols at 6 moments');
const browser = await chromium.launch();
try {
  for (const [name, iso] of Object.entries(MOMENTS)) {
    const ms = Date.parse(iso), rows = rowsAt(ms);
    const page = await browser.newPage();
    const errs = []; page.on('pageerror', e => errs.push(e.message));
    await page.clock.setFixedTime(new Date(ms));
    await page.goto(pathToFileURL(join(ROOT, 'tests', 'engine.html')).href + '?seed=7');
    const eng = await page.evaluate(async ({ rows, syms }) => {
      await Engine.init();
      let cb = null;
      Engine.setFeed({ realTime: true, has: s => syms.includes(s), onTicks: f => { cb = f; }, alive: () => true });
      for (const [s, b, a, t] of rows) cb(s, b, t, a == null ? undefined : a);
      const t = Date.now() / 1000;
      return { q: syms.map(s => Engine.quote(s)), sess: syms.map(s => Engine.session(s, t)), off: [Engine.serverOffset(t), Engine.nyOffset(t)], usd: ['JPY', 'EUR', 'HUF', 'TRY'].map(c => Engine.usd(c)) };
    }, { rows, syms: SYMS });
    await page.close();
    const mk = MarketCore.create({ catalog: CATALOG, now: () => ms });
    mk.setQuotes(rows);
    const t = ms / 1000;
    let same = 0;
    SYMS.forEach((s, i) => {
      const a = pick(eng.q[i]), b = pick(mk.quote(s));
      if (JSON.stringify(a) === JSON.stringify(b)) same++; else ok(false, `${name} ${s}: engine ${JSON.stringify(a)} ≠ core ${JSON.stringify(b)}`);
      ok(JSON.stringify(eng.sess[i]) === JSON.stringify(mk.session(s, t)), `${name} ${s} session: ${JSON.stringify(eng.sess[i])} ≠ ${JSON.stringify(mk.session(s, t))}`);
    });
    ok(same === SYMS.length, `${name}: ${same}/${SYMS.length} quotes identical`);
    ok(eng.off[0] === mk.serverOffset(t) && eng.off[1] === mk.nyOffset(t), `${name} offsets: engine ${eng.off} core ${[mk.serverOffset(t), mk.nyOffset(t)]}`);
    ok(JSON.stringify(eng.usd) === JSON.stringify(['JPY', 'EUR', 'HUF', 'TRY'].map(c => mk.usd(c))), `${name} usd: engine ${eng.usd}`);
    ok(!errs.length, `${name}: page errors ${errs.join('; ')}`);
    const open = eng.q.filter(q => q.open).length;
    console.log(`  ${name}: ${same}/${SYMS.length} identical, ${open} open, sp ${[...new Set(eng.q.map(q => q.sp))].join('/')}`);
    // the moments mean something: FX open Monday and Friday 21:59, closed at 22:01 and Saturday; night spread at the rollover
    const fxOpen = eng.q[0].open;
    if (/Monday|21:59/.test(name)) ok(fxOpen, `${name}: EURUSD open`);
    if (/22:01|Saturday|DST/.test(name)) ok(!fxOpen && eng.q[0].why === 'closed', `${name}: EURUSD closed`);
    if (/Saturday|DST/.test(name)) ok(eng.q[12].open, `${name}: BTCUSD open (24/7)`);
    if (/rollover/.test(name)) ok(eng.q[SYMS.indexOf('EURHUF')].sp === 'night' && mk.quote('EURHUF').sp === 'night', `${name}: night spread`);
  }
} finally { await browser.close(); }

console.log('MC2 usd(ccy) from the quoted pairs');
{
  const ms = Date.parse(MOMENTS['Monday 08:00 UTC']), mk = MarketCore.create({ catalog: CATALOG, now: () => ms });
  mk.setQuotes(rowsAt(ms));
  ok(mk.usd('JPY') === 1 / mk.quote('USDJPY').mid, `usd(JPY) = 1/mid(USDJPY): ${mk.usd('JPY')}`);
  ok(mk.usd('EUR') === mk.quote('EURUSD').mid, 'usd(EUR) = mid(EURUSD)');
  ok(mk.usd('HUF') === mk.quote('EURUSD').mid / mk.quote('EURHUF').mid, 'usd(HUF) = EURUSD / EURHUF');
  ok(mk.usd('USD') === 1 && Number.isNaN(mk.usd('SEK')), 'usd(USD) = 1; a currency with no pair quoted: NaN');
}

console.log('MC3 off quotes: no tick for over 120 s (the sheet offQ wins where it sets one)');
{
  let ms = Date.parse('2026-11-02T16:00:00Z'); // Monday, US stocks open
  const mk = MarketCore.create({ catalog: CATALOG, now: () => ms }), t0 = ms;
  ok(!CATALOG.instr.find(r => r.sym === 'AMZN.US').offQ && CATALOG.instr.find(r => r.sym === 'EURUSD').offQ === 10, 'AMZN.US has no offQ, EURUSD has 10 s');
  mk.setQuotes([['AMZN.US', 250, 250.05, t0], ['EURUSD', 1.1, 1.10012, t0]]);
  let a = mk.quote('AMZN.US');
  ok(a.open && !a.off && a.why === '', 'fresh: open, not off');
  ms = t0 + 11000; mk.setQuotes([]);
  a = mk.quote('EURUSD');
  ok(a.off && !a.open && a.why === 'off quotes', 'EURUSD 11 s old: off quotes (offQ 10)');
  ms = t0 + 119000; mk.setQuotes([]);
  a = mk.quote('AMZN.US');
  ok(a.open && !a.off, 'AMZN.US 119 s old: still quoted');
  ms = t0 + 121000; mk.setQuotes([]);
  a = mk.quote('AMZN.US');
  ok(a.off === true && a.open === false && a.why === 'off quotes', `AMZN.US 121 s old: off ${a.off} open ${a.open} ${a.why}`);
  const n = mk.quote('MSFT.US');
  ok(n.off && !n.open && Number.isNaN(n.bid), 'never quoted: off quotes, bid NaN');
  ok(mk.quote('NOPE') === undefined, 'unknown symbol: undefined');
}

console.log('MC4 feedAlive: false after 10 s without setQuotes');
{
  let ms = Date.parse('2026-11-02T16:00:00Z');
  const mk = MarketCore.create({ catalog: CATALOG, now: () => ms }), t0 = ms;
  ok(!mk.feedAlive(), 'no setQuotes yet: not alive');
  mk.setQuotes([['BTCUSD', 70000, 70010, t0]]);
  ok(mk.feedAlive(), 'just answered: alive');
  ms = t0 + 10000; ok(mk.feedAlive(), '10 s: alive');
  ms = t0 + 10001; ok(!mk.feedAlive(), '10.001 s: not alive');
  const q = mk.quote('BTCUSD');
  ok(!q.open && q.why === 'no feed', `no feed closes the quote: ${q.why}`);
  mk.setQuotes([]); ok(mk.feedAlive(), 'an empty answer is still an answer: alive again');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
