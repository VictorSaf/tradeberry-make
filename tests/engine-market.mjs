// Engine on the catalog (.mace/design/catalog.md §2–3, contract C2): 265 instruments, 15 currencies, sessions in
// server time (EET/EEST), the canonical lazy non-FX path, PIVOT ON BID, spreads from the sheet, the feed seam. Every
// page here is the bare engine (tests/engine.html: catalog.js + engine.js) with a pinned clock; expected values are
// worked out from catalog.js, not read back from the engine.
const U = s => Date.parse(s) / 1000;
const FRI = '2026-10-16T10:30:00Z';  // Friday, EEST (server = UTC+3): FX and indices open, US stocks closed
const STK = '2026-10-16T14:00:00Z';  // Friday, US stocks open (13:35–19:55 UTC)
const at = (clock, seed) => ({ path: '/tests/engine.html' + (seed != null ? '?seed=' + seed : ''), clock: new Date(clock) });
async function eng(open, clock, seed = 21) { const o = at(clock, seed); const p = await open(o.path, { clock: o.clock }); await p.evaluate(() => Engine.init()); return p; }

export const tests = [
  {
    name: 'EM1 catalog engine: 265 instruments, PAIRS = the G8 16, 15 currencies, VERSION 2, no rates fetch; same seed + clock + catalog = same market',
    async run({ t, open }) {
      const reqs = [];
      const o = at(FRI, 21), a = await open(o.path, { clock: o.clock });
      a.on('request', r => reqs.push(r.url()));
      const pick = ['EURUSD', 'USDJPY', 'USDTRY', 'EURHUF', 'US.500', 'GOLD', 'BTCUSD', 'BTCEUR', 'DE.30', 'AAPL.US'];
      const run = async page => page.evaluate(async pick => {
        if (!Engine.simTime) await Engine.init();
        const h = Object.fromEntries(pick.map(s => [s, Engine.candles[s].slice(-120).map(c => [c.time, c.open, c.high, c.low, c.close])]));
        Engine.hot(pick); Engine.speed = 60;
        for (let i = 0; i < 120; i++) Engine.tick(250);
        return { h, after: Object.fromEntries(pick.map(s => [s, Engine.candles[s].slice(-20).map(c => [c.time, c.open, c.close])])), q: pick.map(s => Engine.quote(s).bid),
          meta: { n: Engine.INSTR.length, fx: Engine.FX.length, pairs: Engine.PAIRS.map(p => p.sym), ccy: Engine.CCY, all: Engine.CCY_ALL.length, v: Engine.VERSION, src: Engine.source,
            label: Engine.SNAP_LABEL, legacy: Object.keys(Engine.LEGACY_META), retired: Object.values(Engine.LEGACY_META).every(m => m.retired), cat: CATALOG.instr.length, syms: Engine.INSTR.every(m => CATALOG.instr.some(r => r.sym === m.sym)) } };
      }, pick);
      const r1 = await run(a);
      const b = await eng(open, FRI, 21), r2 = await run(b);
      const c = await eng(open, FRI, 22), r3 = await run(c);
      t.eq(r1.meta.n, 265, 'INSTR = the 265 of the catalog'); t.eq(r1.meta.cat, 265, 'catalog size'); t.ok(r1.meta.syms, 'every INSTR row is a catalog row');
      t.eq(r1.meta.fx, 38, 'Engine.FX = 38 pairs');
      t.deep(r1.meta.pairs, ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF', 'EURAUD', 'GBPCHF', 'CADJPY', 'AUDNZD'], 'PAIRS stays the G8 16, in order');
      t.deep(r1.meta.ccy, ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'], 'CCY stays the G8'); t.eq(r1.meta.all, 15, 'CCY_ALL = 15 currencies');
      t.eq(r1.meta.v, 2, 'VERSION 2'); t.eq(r1.meta.src, 'snapshot', 'source: the platform snapshot');
      t.ok(/^Starting level: bid 2026-10-20 13:19 UTC from the broker platform/.test(r1.meta.label) && /simulated since, zero drift/.test(r1.meta.label), 'SNAP_LABEL: ' + r1.meta.label);
      t.deep(r1.meta.legacy, ['XAUUSD', 'US500', 'GER40', 'UK100', 'WTI', 'BTCUSD'], 'LEGACY_META keeps the six v14 CFDs'); t.ok(r1.meta.retired, 'marked retired');
      t.deep(reqs.filter(u => !/\/(catalog|engine)\.js$|engine\.html/.test(u)), [], 'the engine fetches nothing (no ECB rates)');
      for (const s of pick) { t.deep(r2.h[s], r1.h[s], s + ': same history'); t.deep(r2.after[s], r1.after[s], s + ': same bars after the ticks'); }
      t.deep(r2.q, r1.q, 'same bids');
      t.ok(pick.filter(s => JSON.stringify(r3.h[s]) !== JSON.stringify(r1.h[s])).length >= 8, 'another seed builds another market');
      t.noErrors(a); t.noErrors(b); t.noErrors(c);
    }
  },
  {
    name: 'EM2 hot/cold invariance: a bar opens on the same canonical level whether the instrument was hot, cold or rebuilt on access',
    async run({ t, open }) {
      const syms = ['US.500', 'GOLD', 'NATGAS', 'BTCUSD', 'BTCEUR', 'AAPL.US'];
      const go = (page, how) => page.evaluate(({ syms, how }) => {
        Engine.speed = 60;
        if (how === 'hot') { Engine.hot(syms); syms.forEach(s => Engine.candles[s]); }
        if (how === 'mixed') { Engine.hot(syms); syms.forEach(s => Engine.candles[s]); }
        for (let i = 0; i < 240; i++) {
          if (how === 'hot') syms.forEach(s => Engine.candles[s]);
          if (how === 'mixed' && i === 40) Engine.hot([]);
          Engine.tick(250);
        }
        const hotNow = Engine.hotSet;
        const out = Object.fromEntries(syms.map(s => [s, Engine.candles[s].slice(-200).map(c => [c.time, c.open])]));
        return { out, px: syms.map(s => Engine.mid(s)), t: Engine.simTime, hotNow };
      }, { syms, how });
      const A = await go(await eng(open, STK, 31), 'hot'), B = await go(await eng(open, STK, 31), 'cold'), C = await go(await eng(open, STK, 31), 'mixed');
      t.eq(A.t, B.t, 'same clock'); t.ok(A.hotNow.length === syms.length, 'all hot in A: ' + A.hotNow);
      for (const s of syms) {
        const a = A.out[s], b = B.out[s], c = C.out[s];
        t.ok(a.length > 150, s + ': bars after an hour: ' + a.length);
        t.deep(b.map(x => x[0]), a.map(x => x[0]), s + ': same bar times hot / cold');
        t.deep(c.map(x => x[0]), a.map(x => x[0]), s + ': same bar times hot / evicted and rebuilt');
        const worst = Math.max(...a.map((x, i) => Math.max(Math.abs(x[1] / b[i][1] - 1), Math.abs(x[1] / c[i][1] - 1))));
        t.ok(worst < 1e-12, `${s}: bar opens equal across hot, cold, rebuilt (worst rel ${worst})`);
      }
      A.px.forEach((v, i) => { t.near(B.px[i], v, syms[i] + ' price now, cold', 1e-12); t.near(C.px[i], v, syms[i] + ' price now, rebuilt', 1e-12); });
    }
  },
  {
    name: 'EM3 triangular consistency on the 38 pairs (incl. the 8 new currencies) and the EUR crypto = USD crypto / EURUSD',
    async run({ t, open }) {
      const page = await eng(open, FRI, 41);
      const r = await page.evaluate(() => {
        Engine.speed = 60; Engine.hot(['BTCEUR', 'ETHEUR', 'BTCUSD', 'ETHUSD']);
        for (let i = 0; i < 80; i++) { Engine.candles.BTCEUR; Engine.candles.ETHEUR; Engine.tick(250); }
        Engine.jump('TRY', .01); Engine.jump('EUR', -.002);
        const px = Engine.FX.map(m => [m.sym, Engine.mid(m.sym) / (Engine.usd(m.base) / Engine.usd(m.quote)) - 1]);
        const close = s => new Map(Engine.candles[s].map(c => [c.time, c.open]));
        const tri = (x, y, z, inv) => { const X = close(x), Y = close(y), Z = close(z); let n = 0, w = 0; for (const [tm, v] of X) if (Y.has(tm) && Z.has(tm)) { n++; w = Math.max(w, Math.abs(v / (inv ? Y.get(tm) / Z.get(tm) : Y.get(tm) * Z.get(tm)) - 1)); } return [n, w]; };
        return {
          px, b: [Engine.mid('BTCEUR') / (Engine.mid('BTCUSD') / Engine.mid('EURUSD')) - 1, Engine.mid('ETHEUR') / (Engine.mid('ETHUSD') / Engine.mid('EURUSD')) - 1],
          ej: tri('EURJPY', 'EURUSD', 'USDJPY'), et: tri('EURTRY', 'EURUSD', 'USDTRY'), gc: tri('GBPCHF', 'GBPUSD', 'USDCHF'), be: tri('BTCEUR', 'BTCUSD', 'EURUSD', true),
          huf: Engine.mid('EURHUF') / (Engine.usd('EUR') / Engine.usd('HUF')) - 1, usdHuf: Engine.usd('HUF'), eurusd0: CATALOG.instr.find(r => r.sym === 'EURUSD').seed.bid
        };
      });
      t.eq(r.px.length, 38, '38 pairs');
      for (const [s, d] of r.px) t.ok(Math.abs(d) < 1e-12, `${s} = usd(base) / usd(quote): ${d}`);
      r.b.forEach(d => t.ok(Math.abs(d) < 1e-12, 'EUR crypto = USD crypto / EURUSD now: ' + d));
      for (const k of ['ej', 'et', 'gc', 'be']) { t.ok(r[k][0] > 1000, k + ': matched bars ' + r[k][0]); t.ok(r[k][1] < 1e-9, k + ': bar opens triangular, worst ' + r[k][1]); }
      t.ok(Math.abs(r.huf) < 1e-12 && r.usdHuf > 0, 'HUF converts through EURHUF × EURUSD');
      t.noErrors(page);
    }
  },
  {
    name: 'EM4 zero drift: probeX is a martingale on every class (FX old and new, index, metal, energy, agri, rates, stock, crypto USD and EUR)',
    async run({ t, open }) {
      const page = await eng(open, STK, 51);
      const r = await page.evaluate(() => ['EURUSD', 'USDTRY', 'US.500', 'GOLD', 'OIL', 'CORN', 'BUNDDE.10', 'AAPL.US', 'BTCUSD', 'XRPEUR'].map(s => [s, Engine.probeX(s, 3000, 60, 5)]));
      for (const [s, p] of r) {
        t.ok(p && p.n === 3000, s + ': probe ran');
        t.ok(Math.abs(p.mean) <= 4 * p.se + 1e-15, `${s}: mean ${p.mean.toExponential(2)} within 4 se (${p.se.toExponential(2)})`);
        if (!p.log) t.ok(Math.abs(p.mean) < Math.max(p.ito / 3, 4 * p.se), `${s}: no Itô drift left (½σ²T = ${p.ito.toExponential(2)})`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'EM5 sessions: server time EET/EEST, stocks closed at night with a gap at the reopening, crypto 24/7, FX weekend with a gap',
    async run({ t, open }) {
      const page = await eng(open, '2026-10-19T14:00:00Z', 61); // Monday, stocks open
      const r = await page.evaluate(() => {
        const s = (sym, iso) => { const x = Engine.session(sym, Date.parse(iso) / 1000); return x && { open: x.open, opensAt: x.opensAt && new Date(x.opensAt * 1000).toISOString(), closesAt: x.closesAt && new Date(x.closesAt * 1000).toISOString() }; };
        const io = (sym, iso) => Engine.isOpen(sym, Date.parse(iso) / 1000);
        const stocks = Engine.INSTR.filter(m => m.group === 'stock' && m.exch !== 'OTC').slice(0, 40).map(m => m.sym);
        let gaps = [], inSess = true;
        for (const sym of stocks) {
          const a = Engine.candles[sym], sg = CATALOG.instr.find(x => x.sym === sym).seed.sGap;
          for (let i = 1; i < a.length; i++) if (a[i].time - a[i - 1].time > 3600) gaps.push(Math.abs(Math.log(a[i].open / a[i - 1].close)) / sg);
          if (!a.every(c => Engine.isOpen(sym, c.time))) inSess = false;
        }
        const fx = []; for (const m of Engine.FX) { const a = Engine.candles[m.sym], sg = CATALOG.instr.find(x => x.sym === m.sym).seed.sGap; if (sg > 0) for (let i = 1; i < a.length; i++) if (a[i].time - a[i - 1].time > 86400) fx.push(Math.abs(Math.log(a[i].open / a[i - 1].close)) / sg); }
        const btc = Engine.candles.BTCUSD, sat = btc.filter(c => new Date(c.time * 1000).getUTCDay() === 6).length;
        const eur = Engine.candles.EURUSD, eurSat = eur.filter(c => new Date(c.time * 1000).getUTCDay() === 6).length;
        return {
          aa: [s('AA.US', '2026-10-16T10:30:00Z'), s('AA.US', '2026-10-16T14:00:00Z'), s('AA.US', '2026-10-16T20:00:00Z'), s('AA.US', '2026-10-26T15:00:00Z')],
          io: [io('AA.US', '2026-10-16T13:34:59Z'), io('AA.US', '2026-10-16T13:35:00Z'), io('AA.US', '2026-10-16T19:54:59Z'), io('AA.US', '2026-10-16T19:55:00Z'), io('AA.US', '2026-10-26T13:40:00Z'), io('AA.US', '2026-10-26T14:40:00Z'),
            io('BTCUSD', '2026-10-17T12:00:00Z'), io('EURUSD', '2026-10-17T12:00:00Z'), io('EURUSD', '2026-10-16T20:59:59Z'), io('EURUSD', '2026-10-16T21:00:00Z'), io('EURUSD', '2026-10-18T20:59:00Z'), io('EURUSD', '2026-10-18T21:00:00Z'),
            io('US.500', '2026-10-16T21:00:00Z'), io('US.500', '2026-10-16T20:54:00Z'), io('CORN', '2026-10-19T14:00:00Z')],
          fxs: s('EURUSD', '2026-10-17T12:00:00Z'), btc: s('BTCUSD', '2026-10-17T12:00:00Z'), corn: CATALOG.instr.find(x => x.sym === 'CORN').sess.filter(w => w[0] === 2),
          gaps, inSess, fx, sat, eurSat, n: stocks.length
        };
      });
      t.deep(r.aa[0], { open: false, opensAt: '2026-10-16T13:35:00.000Z', closesAt: '2026-10-16T19:55:00.000Z' }, 'AA.US before the cash session (16:35 server = 13:35 UTC)');
      t.deep(r.aa[1], { open: true, opensAt: '2026-10-19T13:35:00.000Z', closesAt: '2026-10-16T19:55:00.000Z' }, 'AA.US in session; next opening Monday');
      t.deep(r.aa[2], { open: false, opensAt: '2026-10-19T13:35:00.000Z', closesAt: '2026-10-19T19:55:00.000Z' }, 'AA.US after Friday close: opens Monday');
      t.deep(r.aa[3], { open: true, opensAt: '2026-10-27T14:35:00.000Z', closesAt: '2026-10-26T20:55:00.000Z' }, 'after 25.10 (EET, UTC+2) the session is 14:35–20:55 UTC');
      t.deep(r.io, [false, true, true, false, false, true, true, false, true, false, false, true, false, true, true], 'isOpen at the edges (end exclusive), crypto Saturday, FX weekend, US.500 break');
      t.deep(r.fxs, { open: false, opensAt: '2026-10-18T21:00:00.000Z', closesAt: '2026-10-23T21:00:00.000Z' }, 'FX weekend: opens Monday 00:00 server = Sunday 21:00 UTC');
      t.deep(r.btc, { open: true, opensAt: null, closesAt: null }, 'crypto 24/7');
      t.ok(r.corn.length === 2, 'CORN has two windows on Monday: ' + JSON.stringify(r.corn));
      t.ok(r.inSess, 'every stock bar is inside its session');
      t.ok(r.gaps.length >= r.n * 3, 'overnight reopenings in a week of stock history: ' + r.gaps.length);
      const mg = r.gaps.reduce((a, b) => a + b, 0) / r.gaps.length;
      t.ok(mg > .3 && mg < 2.5, `stock reopening gaps on the sGap scale: mean |gap| / sGap = ${mg.toFixed(2)} (E|N(0,1)| = 0.80)`);
      t.ok(r.fx.length >= 37, 'a weekend gap on every pair with a sheet gap (USDTRY has 0): ' + r.fx.length);
      const mf = r.fx.reduce((a, b) => a + b, 0) / r.fx.length;
      t.ok(mf > .3 && mf < 2.5, `FX weekend gaps on the sGap scale: ${mf.toFixed(2)}`);
      t.ok(r.sat > 1000, 'BTC has Saturday bars: ' + r.sat); t.eq(r.eurSat, 0, 'EURUSD has no Saturday bars');
      t.noErrors(page);
      // live: a stock frozen after its close, quoted closed, no new bars; the open shows the gap at the reopening
      const p2 = await eng(open, '2026-10-16T19:50:00Z', 62);
      const z = await p2.evaluate(() => {
        Engine.hot(['AA.US']); Engine.candles['AA.US'];
        Engine.speed = 60; for (let i = 0; i < 60; i++) { Engine.candles['AA.US']; Engine.tick(250); }
        const q1 = Engine.quote('AA.US'), n1 = Engine.candles['AA.US'].length, last = Engine.candles['AA.US'].at(-1);
        for (let i = 0; i < 60; i++) { Engine.candles['AA.US']; Engine.tick(250); }
        const q2 = Engine.quote('AA.US'), n2 = Engine.candles['AA.US'].length;
        return { q1, q2, n1, n2, lastT: new Date(last.time * 1000).toISOString(), t: new Date(Engine.simTime * 1000).toISOString() };
      });
      t.eq(z.lastT, '2026-10-16T19:54:00.000Z', 'last stock bar is the minute before the close'); t.eq(z.n2, z.n1, 'no bars while closed');
      t.eq(z.q1.open, false, 'quoted closed'); t.eq(z.q2.bid, z.q1.bid, 'frozen while closed'); t.eq(z.q1.why, 'closed', 'reason');
      t.noErrors(p2);
    }
  },
  {
    name: 'EM6 spreads from the sheet: Default, Night 23–01 server Mon–Fri, News on the instrument currencies, crypto variation; no widening by regime or rollover',
    async run({ t, open }) {
      const day = await eng(open, FRI, 71);
      const a = await day.evaluate(() => {
        const sp = s => { const q = Engine.quote(s); return [q.sp, Math.round((q.ask - q.bid) / Engine.META[s].point * 1000) / 1000, q.mid === q.bid]; };
        const out = { eur: sp('EURUSD'), jpy: sp('USDJPY'), de: sp('DE.30'), us: sp('US.500'), spreads: [], btc: [], xrp: [], eurDisp: Engine.quote('EURUSD').spread };
        Engine.setNewsMult('EUR', 3, Engine.simTime + 120);
        out.news = { eur: sp('EURUSD'), jpy: sp('USDJPY'), de: sp('DE.30'), us: sp('US.500'), btceur: Engine.quote('BTCEUR').sp };
        Engine.speed = 60; for (let i = 0; i < 12; i++) Engine.tick(250);
        out.after = sp('EURUSD');
        for (let i = 0; i < 200; i++) { Engine.speed = 1; Engine.tick(1000); out.spreads.push(sp('EURUSD')[1]); out.btc.push(sp('BTCUSD')[1]); out.xrp.push(sp('XRPUSD')[1]); }
        out.regime = Engine.regime;
        return out;
      });
      const P = s => CAT[s];
      const CAT = await day.evaluate(() => Object.fromEntries(['EURUSD', 'USDJPY', 'DE.30', 'US.500', 'BTCUSD', 'XRPUSD'].map(s => [s, CATALOG.instr.find(r => r.sym === s).p])));
      t.deep(a.eur, ['default', P('EURUSD').spread[0], true], 'EURUSD: Default spread in points, ask = bid + spread, mid = bid (pivot)');
      t.near(a.eurDisp, P('EURUSD').spread[0] / 10, 'displayed in pips (5 digits: 10 points a pip)', 1e-9);
      t.deep(a.de, ['default', P('DE.30').spread[0], true], 'DE.30 Default');
      t.deep(a.news.eur, ['news', P('EURUSD').spread[2], true], 'EUR news: EURUSD on its News spread');
      t.deep(a.news.de, ['news', P('DE.30').spread[2], true], 'EUR news: DE.30 (profit currency EUR) on News');
      t.eq(a.news.jpy[0], 'default', 'USDJPY untouched'); t.eq(a.news.us[0], 'default', 'US.500 untouched'); t.eq(a.news.btceur, 'news', 'BTCEUR (EUR) on News');
      t.deep(a.after, ['default', P('EURUSD').spread[0], true], 'back to Default when the news window ends');
      t.ok(a.spreads.every(v => v === P('EURUSD').spread[0]), 'EURUSD spread constant over 200 s whatever the regime (' + a.regime.toFixed(2) + ')');
      const [b0, [lo, hi]] = [P('BTCUSD').spread[0], (P('BTCUSD').jit || [[0, 0]])[0]];
      t.ok(a.btc.every(v => v >= b0 + lo - 1e-6 && v <= b0 + hi + 1e-6), 'BTC spread within base + [lo, hi]');
      const [x0, [xl, xh]] = [P('XRPUSD').spread[0], P('XRPUSD').jit[0]];
      t.ok(a.xrp.every(v => v >= x0 + xl - 1e-6 && v <= x0 + xh + 1e-6) && new Set(a.xrp).size > 20, 'XRP spread varies per second within base + [' + xl + ', ' + xh + ']');
      t.noErrors(day);
      // Night: Thursday 20:30 UTC = 23:30 server; Wednesday 21:05 UTC = 00:05 server Thursday (also the NY rollover: no ×3)
      for (const [iso, want] of [['2026-10-15T20:30:00Z', 'night'], ['2026-10-14T21:05:00Z', 'night'], ['2026-10-15T22:00:00Z', 'default'], ['2026-10-18T21:30:00Z', 'night'], ['2026-10-17T21:30:00Z', 'default']]) {
        const p = await eng(open, iso, 72);
        const q = await p.evaluate(() => { const q = Engine.quote('EURUSD'), k = Engine.quote('US.500'); return [q.sp, Math.round((q.ask - q.bid) / 1e-5), k.sp, Math.round((k.ask - k.bid) / .01)]; });
        const k = want === 'night' ? 1 : 0;
        t.deep(q, [want, P('EURUSD').spread[k], want, P('US.500').spread[k]], iso + ': ' + want);
        t.noErrors(p);
      }
    }
  },
  {
    name: 'EM7 feed seam: fed symbols take the feed bid (ask = bid + spread), one q per batch, off quotes when stale, speed locked to 1, optional history',
    async run({ t, open }) {
      const page = await eng(open, FRI, 81);
      const r = await page.evaluate(async () => {
        let cb = null, qn = 0;
        Engine.on('q', () => qn++);
        const hist = [{ time: Engine.simTime - 120 - Engine.simTime % 60, open: 7400, high: 7410, low: 7390, close: 7405 }, { time: Engine.simTime - 60 - Engine.simTime % 60, open: 7405, high: 7406, low: 7401, close: 7402 }];
        const ad = { has: s => s === 'EURUSD' || s === 'US.500', onTicks: f => { cb = f; }, history: s => (s === 'US.500' ? hist : null) };
        let bad = ''; try { Engine.setFeed({ has: () => true }); } catch (e) { bad = e.message; }
        Engine.speed = 300; Engine.setFeed(ad);
        const sp0 = Engine.speed; Engine.speed = 300; const sp1 = Engine.speed;
        const now = Date.now();
        cb('EURUSD', 1.2, now); cb('US.500', 7000, now); cb('EURUSD', 1.2001, now); cb('NOPE', 5, now); cb('GBPUSD', 2, now);
        const before = qn; await Promise.resolve(); await new Promise(r => setTimeout(r, 0)); const qBatch = qn - before;
        const q = Engine.quote('EURUSD'), k = Engine.quote('US.500'), g = Engine.quote('GBPUSD');
        const usHist = Engine.candles['US.500'].slice(0, 2).map(c => c.close);
        Engine.tick(250); Engine.tick(250);
        const q2 = Engine.quote('EURUSD');
        cb('EURUSD', 1.21, now - 60000);
        const stale = Engine.quote('EURUSD');
        Engine.setFeed(null);
        const off = Engine.quote('EURUSD');
        return { bad, sp0, sp1, qBatch, q, k, gBid: g.bid, usHist, q2, stale, off, feedOff: Engine.feed };
      });
      t.ok(/has\(sym\) and onTicks/.test(r.bad), 'an adapter without onTicks is refused: ' + r.bad);
      t.eq(r.sp0, 1, 'speed drops to 1 with a feed'); t.eq(r.sp1, 1, 'and stays locked at 1');
      t.eq(r.qBatch, 1, 'one q for the batch of ticks');
      t.near(r.q.bid, 1.2001, 'EURUSD bid from the feed', 1e-12); t.near(r.q.ask, 1.2001 + 12e-5, 'ask = bid + the sheet spread', 1e-12); t.eq(r.q.open, true, 'fresh: open');
      t.near(r.k.bid, 7000, 'US.500 bid from the feed', 1e-12);
      t.ok(Math.abs(r.gBid - 2) > .1, 'a symbol the feed does not have stays simulated');
      t.deep(r.usHist, [7405, 7402], 'history from the adapter replaces the simulated bars');
      t.near(r.q2.bid, 1.2001, 'the clock does not move a fed symbol', 1e-12);
      t.deep([r.stale.open, r.stale.why], [false, 'off quotes'], 'older than offQ: off quotes');
      t.ok(Math.abs(r.off.bid - 1.21) > 1e-6 && r.feedOff === false, 'setFeed(null) returns to the simulation');
      t.noErrors(page);
    }
  },
  {
    name: 'EM7b real prices (livefeed): the wall clock, the feed ask, bars in the tick minute, history merged, no feed closes, init kept',
    async run({ t, open }) {
      const page = await eng(open, FRI, 82);
      const r = await page.evaluate(async () => {
        let cb = null, up = true, wanted = [];
        const before = Engine.candles.EURUSD.length;
        Engine.simTime; Engine.speed = 1;
        Engine.setFeed({ realTime: true, has: s => s === 'EURUSD' || s === 'US.500', onTicks: f => { cb = f; }, alive: () => up, want: s => wanted.push(s) });
        const cleared = Engine.candles.EURUSD.length;
        const now = Date.now(), m0 = Math.floor(now / 60000) * 60;
        cb('EURUSD', 1.2, now, 1.20013); cb('US.500', 7000, now, 7003);
        await Promise.resolve();
        const q = Engine.quote('EURUSD'), k = Engine.quote('US.500');
        const clock = Math.abs(Engine.simTime - now / 1000) < 2;
        cb('EURUSD', 1.19, now - 3600000, 1.19012); // an older tick: no bar in the past, the quote takes it
        const bars1 = Engine.candles.EURUSD.map(c => [c.time, c.close]);
        const h = [{ time: m0 - 120, open: 1.1, high: 1.2, low: 1.05, close: 1.15 }, { time: m0 - 60, open: 1.15, high: 1.16, low: 1.14, close: 1.155 }];
        const hOk = Engine.feedHistory('EURUSD', h);
        const merged = Engine.candles.EURUSD.map(c => c.time - m0);
        Engine.tick(250); const tickClock = Math.abs(Engine.simTime - Date.now() / 1000) < 2;
        await Engine.init({ L: {}, simTime: 1.7e9, regime: 0 }); const kept = Engine.realTime && Engine.candles.EURUSD.length === merged.length;
        up = false; const d = Engine.quote('EURUSD');
        Engine.setFeed(null);
        return { before, cleared, q, k, clock, bars1, hOk, merged, tickClock, kept, d: [d.open, d.why], wanted: [...new Set(wanted)], m0, rtOff: Engine.realTime };
      });
      t.ok(r.before > 100 && r.cleared === 0, 'the simulated history of a fed instrument is dropped');
      t.near(r.q.ask, 1.20013, 'the ask is the feed ask', 1e-12); t.near(r.q.spread, 1.3, 'the spread follows it (pips)', 1e-9);
      t.near(r.k.ask - r.k.bid, 3, 'US.500 spread from the feed', 1e-9);
      t.ok(r.clock && r.tickClock, 'the clock is the wall clock');
      t.deep(r.bars1, [[r.m0, 1.2]], 'one bar, in the minute of the tick; an older tick adds no bar');
      t.ok(r.hOk && r.merged.join() === '-120,-60,0', 'history goes before the bar the ticks are building: ' + r.merged.join());
      t.ok(r.kept, 'init does not rebuild the market while real prices run');
      t.deep(r.d, [false, 'no feed'], 'alive() false: the instrument is closed, "no feed"');
      t.ok(r.wanted.includes('EURUSD'), 'reading the candles asks the adapter for history');
      t.eq(r.rtOff, false, 'setFeed(null) leaves real time');
      t.noErrors(page);
    }
  },
  {
    name: 'EM7d hourly history (livefeed): 1H/4H read the platform hourly bars before the 1-minute history, whole buckets only, the minute bars unchanged after',
    async run({ t, open }) {
      const page = await eng(open, FRI, 83);
      const r = await page.evaluate(async () => {
        Engine.speed = 1;
        Engine.setFeed({ realTime: true, has: s => s === 'EURUSD', onTicks: () => {}, alive: () => true, want: () => {} });
        const H = 3600, now = Math.floor(Date.now() / 1000), m0 = Math.floor(now / 60) * 60;
        // 1-minute bars for the last 3 h 30 min (starting mid-hour), hourly bars for 30 days before and over it
        const mins = []; for (let x = m0 - 210 * 60; x <= m0; x += 60) mins.push({ time: x, open: 1.2, high: 1.201, low: 1.199, close: 1.2 });
        const hrs = []; for (let x = Math.floor((m0 - 30 * 86400) / H) * H; x <= m0; x += H) hrs.push({ time: x, open: 1.1, high: 1.11, low: 1.09, close: 1.1 });
        Engine.feedHistory('EURUSD', mins);
        const minOnly = Engine.aggregate('EURUSD', 240, 220).map(b => [b.time, b.close]);
        const bad = Engine.feedHourly('EURUSD', [{ time: 1, open: -1, high: 1, low: 1, close: 1 }]);
        const ok = Engine.feedHourly('EURUSD', hrs);
        const a4 = Engine.aggregate('EURUSD', 240, 220), a1 = Engine.aggregate('EURUSD', 60, 400), a15 = Engine.aggregate('EURUSD', 15, 400);
        const cut = Math.ceil(mins[0].time / H) * H;
        const fromMin1 = a1.filter(b => b.time >= cut), fromHr1 = a1.filter(b => b.time < cut);
        const notFed = Engine.feedHourly('GBPUSD', hrs);
        Engine.setFeed(null);
        return { minOnly, bad, ok, n4: a4.length, sorted: a4.every((b, i) => !i || b.time > a4[i - 1].time), tail: a4.slice(-1).map(b => [b.time, b.close]),
          minClose: fromMin1.every(b => b.close === 1.2), hrClose: fromHr1.length > 390 && fromHr1.every(b => b.close === 1.1), n15: a15.length, notFed };
      });
      t.ok(r.minOnly.length <= 3, '1-minute history alone: a few 4H bars (' + r.minOnly.length + ')');
      t.eq(r.bad, false, 'bars with a bad price are refused');
      t.eq(r.ok, true, 'the hourly bars are taken');
      t.ok(r.n4 >= 170 && r.sorted, '4H: 30 days of bars, in order (' + r.n4 + ')');
      t.deep(r.tail, r.minOnly.slice(-1), 'the newest 4H bar still comes from the 1-minute bars');
      t.ok(r.minClose && r.hrClose, '1H: the minute bars from the first whole hour they cover, the hourly bars before it');
      t.ok(r.n15 < 20, '15m and below ignore the hourly bars (' + r.n15 + ')');
      t.eq(r.notFed, false, 'an instrument the feed does not have takes no hourly bars');
      t.noErrors(page);
    }
  },
  {
    name: 'EM7c server: the platform CSV parses (a refused key is an error), history packs and unpacks to the same bars',
    async run({ t }) {
      const { parseQuotes, packBars } = await import('../server/legacy.js');
      const q = parseQuotes('instrument, bid, ask, timestamp\nEURUSD, 1.12146, 1.12158, 1792966726148\nBAD ROW\nUS.500, 7451.5, 7454.5, 1792966725992\nX, -1, 2, 3\n');
      t.deep(q, [['EURUSD', 1.12146, 1.12158, 1792966726148], ['US.500', 7451.5, 7454.5, 1792966725992]], 'rows parse; bad rows are skipped');
      let e = ''; try { parseQuotes('Invalid apiKey: x'); } catch (x) { e = x.message; }
      t.ok(/refused the API key/.test(e), 'a refused key is an error, not an empty feed: ' + e);
      const j = { s: 'ok', t: [600, 660, 840], o: [1.1, 1.12, 1.13], h: [1.125, 1.13, 1.14], l: [1.09, 1.11, 1.12], c: [1.12, 1.125, 1.135] };
      const p = packBars('EURUSD', 100000, j, 0);
      let c = 0, tt = p.t0; const out = p.c.map((d, i) => { c += d; if (i) tt += p.dt[i - 1] * 60; return [tt, (c - p.o[i]) / p.ps, (c + p.h[i]) / p.ps, (c - p.l[i]) / p.ps, c / p.ps]; });
      t.deep(out.map(b => b.map(v => Math.round(v * 1e6) / 1e6)), [[600, 1.1, 1.125, 1.09, 1.12], [660, 1.12, 1.13, 1.11, 1.125], [840, 1.13, 1.14, 1.12, 1.135]], 'the packed bars decode to the platform bars');
      t.eq(packBars('X', 100, { s: 'no_data' }, 0).c.length, 0, 'no data: no bars');
    }
  },
  {
    name: 'EM8 snapshot: v14 fields; 15 currencies + non-FX levels resume; a v14 snapshot keeps the G8 and starts the rest from the seed',
    async run({ t, open }) {
      const a = await eng(open, FRI, 91);
      const snap = await a.evaluate(() => { Engine.speed = 60; for (let i = 0; i < 40; i++) Engine.tick(250); Engine.jumpX('DE.30', .01); Engine.jump('TRY', .02); return Engine.snapshot(); });
      t.deep(Object.keys(snap).sort(), ['L', 'rateDate', 'regime', 'seed', 'simTime', 'source'], 'snapshot fields as in v14');
      const b = await open('/tests/engine.html');
      const r = await b.evaluate(async snap => {
        await Engine.init(snap);
        const full = { de: Engine.mid('DE.30'), try: Engine.mid('USDTRY'), eur: Engine.mid('EURUSD'), deLast: Engine.candles['DE.30'].at(-1).close, t: Engine.simTime };
        const v14 = { ...snap, L: { ...Object.fromEntries(Engine.CCY.map(c => [c, snap.L[c]])), XAUUSD: 8.29, BTCUSD: 11.5 } };
        await Engine.init(v14);
        const seed = s => CATALOG.instr.find(x => x.sym === s).seed.bid;
        const old = { eur: Engine.mid('EURUSD'), de: Engine.mid('DE.30') / seed('DE.30'), btc: Engine.mid('BTCUSD') / seed('BTCUSD'), try: Engine.mid('USDTRY') / seed('USDTRY'), nox: !('XAUUSD' in Engine.META) };
        await Engine.init({ ...snap, L: { ...snap.L, 'DE.30': snap.L['DE.30'] + 6, 'US.500': 'x' } });
        const bad = { de: Engine.mid('DE.30') / seed('DE.30'), us: Engine.mid('US.500') / seed('US.500'), gold: Engine.mid('GOLD') };
        return { full, old, bad, keys: Object.keys(snap.L).length, n: Engine.INSTR.filter(m => m.kind !== 'fx' && !m.seed.derived).length };
      }, snap);
      t.eq(r.keys, 15 + r.n, 'L: 15 currencies + every non-derived non-FX instrument');
      t.near(r.full.de, Math.exp(snap.L['DE.30']), 'DE.30 resumes at its saved level', 1e-12);
      t.near(r.full.try, Math.exp(-snap.L.TRY), 'USDTRY resumes (a new currency)', 1e-12);
      t.near(r.full.eur, Math.exp(snap.L.EUR), 'EURUSD resumes', 1e-12);
      t.near(r.old.eur, Math.exp(snap.L.EUR), 'v14 snapshot: the G8 resume', 1e-12);
      t.near(r.old.de, 1, 'v14 snapshot: DE.30 starts at the seed', 1e-9); t.near(r.old.btc, 1, 'v14 snapshot: its illustrative BTCUSD level is ignored', 1e-9);
      t.near(r.old.try, 1, 'v14 snapshot: TRY starts at the seed', 1e-9); t.ok(r.old.nox, 'no XAUUSD in META');
      t.near(r.bad.de, 1, 'a level e^6 away is ignored', 1e-9); t.near(r.bad.us, 1, 'a non-number is ignored', 1e-9);
      t.noErrors(a); t.noErrors(b);
    }
  },
  {
    name: 'EM9 CPU budget: at speed 300 with 40 non-FX instruments hot, the mean engine frame stays under 4 ms',
    async run({ t, open }) {
      const page = await eng(open, STK, 99);
      const r = await page.evaluate(() => {
        const hot = Engine.INSTR.filter(m => m.kind !== 'fx' && Engine.isOpen(m.sym)).slice(0, 40).map(m => m.sym);
        Engine.hot(hot); hot.forEach(s => Engine.candles[s]);
        Engine.speed = 300;
        for (let i = 0; i < 20; i++) { hot.forEach(s => Engine.quote(s)); Engine.tick(250); }
        const T = [];
        for (let i = 0; i < 200; i++) {
          const t0 = performance.now();
          Engine.tick(250);
          for (const s of hot) Engine.quote(s);
          T.push(performance.now() - t0);
        }
        T.sort((a, b) => a - b);
        return { n: hot.length, hotNow: Engine.hotSet.length, mean: T.reduce((a, b) => a + b, 0) / T.length, p95: T[Math.floor(T.length * .95)] };
      });
      t.eq(r.n, 40, '40 instruments'); t.eq(r.hotNow, 40, 'all 40 hot');
      t.ok(r.mean < 4, `mean frame ${r.mean.toFixed(2)} ms (p95 ${r.p95.toFixed(2)} ms)`);
      t.noErrors(page);
    }
  }
];
