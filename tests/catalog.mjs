// Catalog v15 (.mace/design/catalog.md §1–2, contract C1): tools/gen-catalog.mjs turns Victor's sheet (profile_default
// only) and the platform price snapshot into catalog.js. Expected values are worked out here from the raw data files and
// the design's rules, not read back from the generator's own intermediate results.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const ROOT = new URL('../', import.meta.url);
const read = p => readFile(new URL(p, ROOT), 'utf8');
const SHEET = JSON.parse(await read('tests/fixtures/instrument-specs-sheet-2026-10-20.json')).sheets;
const SNAP = JSON.parse(await read('tests/fixtures/price-snapshot-2026-10-20.json'));
const ROW = Object.fromEntries(SNAP.rows.map(r => [r[0], Object.fromEntries(SNAP.cols.map((c, i) => [c, r[i]]))]));
const gen = () => import('../tools/gen-catalog.mjs');
async function load() {
  const src = await read('catalog.js');
  return { src, C: new vm.Script(src + '\n;CATALOG').runInNewContext({}) };
}
const G8 = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF', 'EURAUD', 'GBPCHF', 'CADJPY', 'AUDNZD'];
const CCY15 = ['EUR', 'GBP', 'AUD', 'CHF', 'JPY', 'CAD', 'NZD', 'CZK', 'NOK', 'PLN', 'TRY', 'RON', 'HUF', 'SEK', 'MXN'];
// last active row per alias (profile_default has stale inactive duplicates and two active duplicates: ZM.US, UBER.US)
const lastActive = rows => { const o = {}; for (const r of rows) if (r.active === '1') o[r.alias] = r; return o; };

export const tests = [
  {
    name: 'CAT1 generator is deterministic and catalog.js is its exact output',
    async run({ t }) {
      const g = await gen(), { src } = await load();
      const a = g.generate(), b = g.generate();
      t.ok(a === b, 'two runs of generate() differ');
      t.ok(a === src, 'catalog.js is not the current output of tools/gen-catalog.mjs (run: node tools/gen-catalog.mjs)');
      t.ok(/generated[^\n]*do not edit/i.test(src.slice(0, 400)), 'header says generated — do not edit');
      t.ok(src.length < 140 * 1024, `catalog.js too big: ${src.length} bytes`);
    }
  },
  {
    name: 'CAT2 the set: 265 instruments of profile_default, counts by type, C1 shape, frozen',
    async run({ t }) {
      const { C } = await load();
      t.eq(C.v, 1, 'v'); t.eq(C.sheetDate, '2026-10-20', 'sheetDate'); t.eq(C.snapAt, '2026-10-20T13:19:26Z', 'snapAt'); t.eq(C.serverTz, 'EET', 'serverTz');
      t.eq(C.snapSrc, 'broker platform', 'snapSrc');
      t.eq(C.instr.length, 265, 'instrument count');
      const syms = C.instr.map(m => m.sym);
      t.eq(new Set(syms).size, 265, 'unique symbols');
      const main = lastActive(SHEET.main), prof = lastActive(SHEET.profile_default);
      const want = Object.keys(main).filter(a => prof[a] && prof[a].tradeStatus !== 'DISABLED' && ROW[a]);
      t.deep([...syms].sort(), want.sort(), 'set = active in main ∧ active in profile_default ∧ not DISABLED ∧ seeded');
      const by = k => C.instr.reduce((o, m) => (o[m[k]] = (o[m[k]] || 0) + 1, o), {});
      t.deep(Object.fromEntries(Object.entries(by('type')).sort()), { commodity: 15, crypto: 12, fx: 38, index: 14, stock: 186 }, 'counts by type');
      t.deep(Object.fromEntries(Object.entries(by('group')).sort()), { agri: 6, crypto: 12, energy: 4, fx: 38, index: 12, metal: 5, rates: 2, stock: 186 }, 'counts by group');
      t.eq(C.instr.filter(m => m.p.status === 'close').length, 15, 'CLOSE ONLY count');
      t.ok(C.instr.every(m => (m.kind === 'fx') === (m.type === 'fx') && (m.kind === 'fx' || m.kind === 'cfd')), 'kind fx|cfd');
      for (const s of G8) t.ok(syms.includes(s), 'G8 pair missing: ' + s);
      const keys = ['sym', 'type', 'kind', 'group', 'cls', 'desc', 'sector', 'exch', 'country', 'base', 'quote', 'digits', 'point', 'pip', 'unit', 'size', 'sizeUnit', 'lotName', 'sess', 'is247', 'fmt', 'offQ', 'seed', 'p'];
      const sk = ['bid', 't', 'live', 'sIn', 'sGap', 'lamJ', 'J', 'prof', 'beta', 'idio'], pk = ['status', 'lev', 'vol', 'minPend', 'maxDev', 'swap', 'comm', 'spread', 'jit'];
      const miss = C.instr.flatMap(m => [...keys.filter(k => !(k in m)), ...sk.filter(k => !(k in m.seed)).map(k => 'seed.' + k), ...pk.filter(k => !(k in m.p)).map(k => 'p.' + k)].map(k => m.sym + '.' + k));
      t.deep(miss, [], 'C1 fields present');
      t.ok(Object.isFrozen(C) && Object.isFrozen(C.instr) && C.instr.every(m => Object.isFrozen(m) && Object.isFrozen(m.p) && Object.isFrozen(m.seed) && Object.isFrozen(m.sess)), 'deep frozen');
      // classes for the jurisdiction cap
      const cls = s => C.instr.find(m => m.sym === s).cls;
      t.deep(['EURUSD', 'USDJPY', 'AUDUSD', 'EURHUF', 'GOLD', 'SILVER', 'US.500', 'AUS200', 'IBEX35.SP', 'BUNDDE.10', 'BTCUSD', 'AAPL.US'].map(cls),
        ['fx-major', 'fx-major', 'fx-minor', 'fx-minor', 'gold', 'commodity', 'index-major', 'index-major', 'index-minor', 'equity', 'crypto', 'equity'], 'cls');
      const one = s => C.instr.find(m => m.sym === s);
      const us = one('US.500'), ap = one('AAPL.US'), eu = one('EURUSD'), gd = one('GOLD');
      t.deep([us.size, us.sizeUnit, us.lotName, us.quote, us.digits, us.point, us.pip, us.unit], [50, 'point', 'lots', 'USD', 2, .01, .01, 'pt'], 'US.500 contract');
      t.deep([ap.size, ap.sizeUnit, ap.lotName, ap.exch, ap.country, ap.sector, ap.desc], [1, 'Shares', 'shares', 'NASDAQ', 'US', 'Technology', 'Apple Inc'], 'AAPL.US contract');
      t.deep([eu.base, eu.quote, eu.size, eu.sizeUnit, eu.lotName, eu.unit, eu.fmt, eu.offQ], ['EUR', 'USD', 100000, 'EUR', 'lots', 'pip', '#.##RRS', 10], 'EURUSD contract');
      t.deep([gd.group, gd.sizeUnit, gd.size], ['metal', 'Ounces', 100], 'GOLD contract');
      t.eq(one('ZM.US').offQ, null, 'offQuotesTime "-" → null'); t.eq(ap.offQ, 5, 'AAPL.US off quotes after 5 s');
    }
  },
  {
    name: 'CAT3 session parser: server-time windows, Sunday = 0, whole days, two windows, odd Thursday, midnight wrap',
    async run({ t }) {
      const { parseSessions: P } = await gen();
      const c = (s, want, w247 = false, msg = s) => { const r = P(s); t.deep(r.sess, want, msg); t.eq(r.is247, w247, msg + ' is247'); };
      c('1635-2255:2;1635-2255:3;1635-2255:4;1635-2255:5;1635-2255:6;', [1, 2, 3, 4, 5].map(d => [d, 995, 1375]), false, 'US stock');
      c('0000-0000:2;0000-0000:3;0000-0000:4;0000-0000:5;0000-0000:6;', [1, 2, 3, 4, 5].map(d => [d, 0, 1440]), false, 'FX Mon–Fri whole days');
      c('0000-0000:1;0000-0000:2;0000-0000:3;0000-0000:4;0000-0000:5;0000-0000:6;0000-0000:7;', [0, 1, 2, 3, 4, 5, 6].map(d => [d, 0, 1440]), true, 'crypto 24/7');
      c('0305-1545:2;1635-2055:2;0305-1545:3', [[1, 185, 945], [1, 995, 1255], [2, 185, 945]], false, 'CORN: two windows a day');
      c('0105-2355:2', [[1, 65, 1435]], false, 'US.500 one day');
      c('0405-1305:5;1410-2255:5;0405-1305:4;1410-2355:4', [[3, 245, 785], [3, 850, 1435], [4, 245, 785], [4, 850, 1375]], false, 'IND50: Thursday closes earlier, sorted by day');
      c('2200-0100:6', [[5, 1320, 1440], [6, 0, 60]], false, 'window across midnight splits into the next day');
      c('2200-0100:7', [[0, 0, 60], [6, 1320, 1440]], false, 'Saturday wrap goes to Sunday');
      c('1000-2400:3', [[2, 600, 1440]], false, '2400 end');
      c('', [], false, 'empty');
      c('0900-1900:2;;', [[1, 540, 1140]], false, 'stray separators');
      c('1000-1100:2;0900-1000:2', [[1, 540, 600], [1, 600, 660]], false, 'unsorted windows are sorted');
      // per-trading-day open hours and breaks (a break = a reopening after a pause, the week wraps around)
      const { sessionStats: H } = await gen();
      const h = s => { const r = H(P(s).sess); return [+r.hDay.toFixed(4), +r.breaksDay.toFixed(4)]; };
      t.deep(h('0000-0000:2;0000-0000:3;0000-0000:4;0000-0000:5;0000-0000:6;'), [24, .2], 'FX: one weekend break a week');
      t.deep(h('0000-0000:1;0000-0000:2;0000-0000:3;0000-0000:4;0000-0000:5;0000-0000:6;0000-0000:7;'), [24, 0], 'crypto: no break');
      t.deep(h('1635-2255:2;1635-2255:3;1635-2255:4;1635-2255:5;1635-2255:6;'), [+(380 / 60).toFixed(4), 1], 'stock: one break a day');
      t.deep(h('0305-1545:2;1635-2055:2;0305-1545:3;1635-2055:3'), [+((760 + 260) / 60).toFixed(4), 2], 'CORN: two breaks a day');
      // the catalog carries the parsed sheet sessions
      const { C } = await load();
      const one = s => C.instr.find(m => m.sym === s);
      t.deep(one('CORN').sess.slice(0, 2), [[1, 185, 945], [1, 995, 1255]], 'CORN in catalog');
      t.deep(one('IND50-NIF').sess.filter(w => w[0] === 4), [[4, 245, 785], [4, 850, 1375]], 'IND50-NIF Thursday in catalog');
      t.ok(C.instr.filter(m => m.is247).every(m => m.type === 'crypto') && C.instr.filter(m => m.type === 'crypto').every(m => m.is247), 'only crypto is 24/7');
    }
  },
  {
    name: 'CAT4 digits, point and pip on the 38 FX pairs; non-FX unit is the platform point',
    async run({ t }) {
      const { C } = await load();
      const fx = C.instr.filter(m => m.type === 'fx');
      t.eq(fx.length, 38, 'FX count');
      const main = lastActive(SHEET.main);
      for (const m of fx) {
        const d = parseInt(main[m.sym].digits);
        t.eq(m.digits, d, m.sym + ' digits');
        t.eq(m.point, +(10 ** -d).toFixed(d), m.sym + ' point');
        const pip = d % 2 ? +(10 ** -(d - 1)).toFixed(d - 1) : +(10 ** -d).toFixed(d);
        t.eq(m.pip, pip, m.sym + ' pip');
        t.eq(m.sym, m.base + m.quote, m.sym + ' base/quote');
      }
      const pip = s => C.instr.find(m => m.sym === s).pip;
      t.deep(['EURUSD', 'AUDUSD', 'USDCAD', 'USDJPY', 'CADJPY', 'GBPJPY', 'EURHUF', 'EURCZK', 'USDTRY', 'USDMXN', 'EURTRY'].map(pip), [.0001, .0001, .0001, .01, .01, .01, .01, .01, .0001, .0001, .0001], 'known pips');
      t.ok(C.instr.filter(m => m.type !== 'fx').every(m => m.pip === m.point && m.unit === 'pt'), 'non-FX: pip = point, unit pt');
    }
  },
  {
    name: 'CAT5 trading terms from profile_default: leverage, volumes, swap units, spreads + crypto jitter',
    async run({ t }) {
      const { C } = await load();
      const one = s => C.instr.find(m => m.sym === s).p;
      const prof = lastActive(SHEET.profile_default);
      t.deep(one('EURUSD').swap, [-9.217, parseFloat(prof.EURUSD.swapShort), 'pts'], 'EURUSD swap in points (sheet "pips")');
      t.deep(one('IBEX35.SP').swap, [-0.05, -0.05, 'pctYr'], 'IBEX35.SP: −5 %/yr of notional');
      t.ok(C.instr.every(m => m.p.swap[2] === (m.type === 'fx' ? 'pts' : 'pctYr')), 'swap unit by type');
      t.deep(one('EURUSD').lev, [500, 500], 'EURUSD 500:1'); t.deep(one('US.500').lev, [100, 100], 'US.500 100:1'); t.deep(one('AAPL.US').lev, [40, 40], 'AAPL 40:1');
      t.ok(C.instr.every(m => m.p.lev[0] > 0 && m.p.lev[0] <= m.p.lev[1]), 'default ≤ max leverage');
      t.deep(one('AAPL.US').vol, [1, 10000, 1], 'stock volumes'); t.deep(one('EURUSD').vol, [.01, 400, .01], 'FX volumes');
      t.deep([one('EURUSD').minPend, one('EURUSD').maxDev, one('EURUSD').comm], [parseFloat(prof.EURUSD.minPendingOrder), parseFloat(prof.EURUSD.maxDeviation), 0], 'min pending, max deviation, commission');
      t.deep(one('AUDCAD').spread, [20, 40, 60], 'AUDCAD default/night/news'); t.eq(one('AUDCAD').jit, null, 'no jitter on FX');
      t.deep(one('BTCEUR').spread.slice(0, 1), [32000], 'BTCEUR default base');
      t.deep(one('BTCEUR').jit[0], [-600, 600], 'BTCEUR default jitter');
      t.ok(one('BTCEUR').jit.length === 3 && one('BTCEUR').jit.every(j => j.length === 2 && j[0] <= 0 && j[1] >= 0), 'three [lo,hi] intervals');
      t.ok(C.instr.filter(m => m.p.jit).every(m => m.type === 'crypto'), 'jitter only on crypto');
      t.deep(['ZM.US', 'UBER.US'].map(s => one(s).spread), [[60, 120, 180], [100, 200, 300]], 'duplicate active rows: the last one wins');
      t.deep(one('EURAUD').spread, [25, 50, 75], 'inactive duplicate ignored');
      t.eq(one('EURTRY').status, 'close', 'EURTRY CLOSE ONLY'); t.eq(one('EURUSD').status, 'full', 'EURUSD FULL');
      t.ok(C.instr.every(m => m.p.spread.length === 3 && m.p.spread.every(x => Number.isFinite(x) && x > 0)), 'three positive spreads');
    }
  },
  {
    name: 'CAT6 FX: 15 currencies, K = 4 factors fitted on fxCorr (RMSE ≤ .08), pair volatility kept',
    async run({ t }) {
      const { C } = await load();
      t.deep(Object.keys(C.ccy).sort(), [...CCY15].sort(), '15 currencies (USD is the numeraire)');
      for (const c of CCY15) {
        const x = C.ccy[c];
        t.eq(x.load.length, 4, c + ' K=4');
        t.near(x.load.reduce((a, v) => a + v * v, 0) + x.idio * x.idio, 1, c + ' load²+idio² = 1', 1e-3, 1e-3);
        t.ok(x.vol > 0 && x.wk >= 0 && /^\d{24}$/.test(x.prof), c + ' vol/wk/prof');
      }
      const cov = (a, b) => a === 'USD' || b === 'USD' ? 0 : a === b ? C.ccy[a].vol ** 2 : C.ccy[a].vol * C.ccy[b].vol * C.ccy[a].load.reduce((s, v, k) => s + v * C.ccy[b].load[k], 0);
      const pc = (p, q) => { const [a, b] = [p.slice(0, 3), p.slice(3)], [c, d] = [q.slice(0, 3), q.slice(3)]; return cov(a, c) - cov(a, d) - cov(b, c) + cov(b, d); };
      const O = SNAP.fxOrder; let se = 0, n = 0, worstVol = 0;
      for (let i = 0; i < O.length; i++) {
        const vi = Math.sqrt(pc(O[i], O[i]));
        worstVol = Math.max(worstVol, Math.abs(vi / ROW[O[i]].s1h - 1));
        for (let j = i + 1; j < O.length; j++) { const r = pc(O[i], O[j]) / (vi * Math.sqrt(pc(O[j], O[j]))); se += (r - SNAP.fxCorr[i][j]) ** 2; n++; }
      }
      const rmse = Math.sqrt(se / n);
      console.log(`       FX correlation RMSE ${rmse.toFixed(4)} over ${n} pairs; worst pair-vol error ${(worstVol * 100).toFixed(1)} %`);
      t.ok(rmse <= .08, 'correlation RMSE ' + rmse);
      t.ok(worstVol < .25, 'pair hourly vol within 25 % of s1h: ' + worstVol);
      // reference levels (units per USD) consistent with the seed bids
      t.near(C.ccy.EUR.ref, 1 / ROW.EURUSD.bid, 'EUR ref', 1e-6); t.near(C.ccy.JPY.ref, ROW.USDJPY.bid, 'JPY ref', 1e-6);
      t.near(C.ccy.HUF.ref, ROW.EURHUF.bid / ROW.EURUSD.bid, 'HUF ref via EURHUF', 1e-6);
    }
  },
  {
    name: 'CAT7 seeds: bid/time from the snapshot, sIn from the daily target, Poisson jumps from kx, betas on 8 factors',
    async run({ t }) {
      const { C } = await load();
      const one = s => C.instr.find(m => m.sym === s);
      const { parseSessions, sessionStats } = await gen();
      let reported = 0, clipped = [];
      const lines = [];
      for (const m of C.instr) {
        const r = ROW[m.sym], s = m.seed;
        t.eq(s.bid, r.bid, m.sym + ' bid'); t.eq(s.t, r.t, m.sym + ' t'); t.eq(s.live, r.live, m.sym + ' live');
        t.eq(s.prof, r.prof24, m.sym + ' prof');
        const st = sessionStats(m.sess), H = st.hDay, nb = st.breaksDay;
        const gap = s.sGap == null ? 0 : s.sGap;
        // the daily variance target holds exactly (with the gap shrunk where the sheet's gap leaves no room)
        t.near(s.sIn ** 2 * H + nb * gap ** 2, r.sD ** 2, m.sym + ' daily variance', 2e-3);
        if (r.sGap != null && Math.abs(gap - r.sGap) > 1e-9) clipped.push(m.sym);
        const ratio = r.s1h * Math.sqrt(H) / Math.sqrt(Math.max(1e-30, r.sD ** 2 - nb * (r.sGap || 0) ** 2));
        if (ratio > 1.5) { reported++; lines.push(`${m.sym} ${Number.isFinite(ratio) && ratio < 1e6 ? ratio.toFixed(2) : '∞'}`); }
        const kx = Math.min(30, r.kx), phi = .3;
        if (kx > 0) { t.near(s.lamJ, 3 * phi * phi / kx, m.sym + ' lamJ', 2e-3); t.near(s.J, s.sIn * Math.sqrt(phi / s.lamJ), m.sym + ' J', 2e-3); }
        else t.deep([s.lamJ, s.J], [0, 0], m.sym + ' no jumps');
        if (m.type === 'fx') t.deep([s.beta, s.idio], [null, null], m.sym + ' FX moves on the currencies');
      }
      console.log(`       mean-reversion ratio s1h·√H / √(sD² − n·sGap²) above 1.5 on ${reported} of 265: ${lines.slice(0, 12).join(', ')}${lines.length > 12 ? ', …' : ''}`);
      console.log(`       gap shrunk to fit the daily target on ${clipped.length}: ${clipped.join(', ')}`);
      t.ok(clipped.includes('AAPL.US'), 'AAPL.US (sGap = sD on the sheet) is shrunk');
      t.deep([one('US.500').seed.sGap != null, one('BTCUSD').seed.sGap, one('BTCUSD').seed.prof != null], [true, null, true], 'gap only where there are breaks');
      t.eq(one('CORN').seed.lamJ, +(3 * .09 / 30).toPrecision(5), 'kx capped at 30 (CORN kx = 110)');
      // betas: unit vector on the factors themselves, R² ≤ .95 elsewhere, derived EUR crypto
      const F = SNAP.factors;
      F.slice(0, 6).forEach((f, i) => { t.deep(one(f).seed.beta, F.map((_, j) => +(i === j)), f + ' is its own factor'); t.eq(one(f).seed.idio, 0, f + ' idio'); });
      const CF = F.map((a, i) => F.map((b, j) => i === j ? 1 : SNAP.loadings[a] ? SNAP.loadings[a][j] : SNAP.loadings[b] ? SNAP.loadings[b][i] : SNAP.fxCorr[SNAP.fxOrder.indexOf(a)][SNAP.fxOrder.indexOf(b)]));
      for (const m of C.instr.filter(m => m.seed.beta && !F.includes(m.sym))) {
        const b = m.seed.beta, r2 = b.reduce((s, x, i) => s + x * b.reduce((u, y, j) => u + CF[i][j] * y, 0), 0);
        t.ok(r2 <= .95 + 2e-3, m.sym + ' R² ≤ .95: ' + r2);
        t.near(m.seed.idio, Math.sqrt(1 - r2), m.sym + ' idio = √(1 − R²)', 5e-3, 5e-3);
      }
      const ap = one('AAPL.US').seed.beta, r = SNAP.loadings['AAPL.US'];
      const fit = F.map((_, i) => ap.reduce((s, x, j) => s + CF[i][j] * x, 0));
      t.ok(fit.every((v, i) => Math.abs(v - r[i]) < .02) || ap.reduce((s, x, i) => s + x * fit[i], 0) > .9, 'AAPL beta reproduces its factor correlations');
      for (const c of ['BTC', 'ETH', 'LTC', 'XRP', 'BCH', 'DASH']) t.deep([one(c + 'EUR').seed.derived, one(c + 'EUR').seed.beta], [c + 'USD/EURUSD', null], c + 'EUR derived');
      t.ok(C.instr.filter(m => m.type !== 'fx' && !m.seed.derived).every(m => Array.isArray(m.seed.beta) && m.seed.beta.length === 8), 'non-FX betas on 8 factors');
      t.ok(C.instr.every(m => m.seed.sIn > 0), 'positive in-session vol everywhere');
    }
  },
  {
    name: 'CAT8 non-FX factors: Cholesky of the 6 conditioned on EURUSD/USDJPY',
    async run({ t }) {
      const { C } = await load();
      const F = SNAP.factors, f = C.factors;
      t.deep(f.names, F.slice(0, 6), 'factor names'); t.deep(f.fx, ['EURUSD', 'USDJPY'], 'conditioning FX');
      const CF = F.map((a, i) => F.map((b, j) => i === j ? 1 : SNAP.loadings[a] ? SNAP.loadings[a][j] : SNAP.loadings[b] ? SNAP.loadings[b][i] : SNAP.fxCorr[SNAP.fxOrder.indexOf(a)][SNAP.fxOrder.indexOf(b)]));
      // conditional covariance C66 − C62·C22⁻¹·C26 and regression C62·C22⁻¹, worked out here
      const det = 1 - CF[6][7] ** 2, inv = [[1 / det, -CF[6][7] / det], [-CF[6][7] / det, 1 / det]];
      const A = [0, 1, 2, 3, 4, 5].map(i => [0, 1].map(k => CF[i][6] * inv[0][k] + CF[i][7] * inv[1][k]));
      for (let i = 0; i < 6; i++) for (let k = 0; k < 2; k++) t.near(f.cond[i][k], A[i][k], `cond[${i}][${k}]`, 2e-3, 2e-3);
      const L = f.chol;
      t.ok(L.length === 6 && L.every((r, i) => r.length === 6 && r.every((v, j) => j <= i || v === 0)), 'lower triangular 6×6');
      let worst = 0;
      for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) {
        const want = CF[i][j] - (A[i][0] * CF[6][j] + A[i][1] * CF[7][j]);
        const got = L[i].reduce((s, v, k) => s + v * L[j][k], 0);
        worst = Math.max(worst, Math.abs(got - want));
      }
      t.ok(worst < .01, 'chol·cholᵀ = conditional covariance, worst ' + worst);
    }
  },
  {
    name: 'CAT9 wiring: catalog.js first in CORE and in index.html; no ECB/Frankfurter hooks; feed pill text',
    async run({ t, open }) {
      const html = await read('index.html'), sw = await read('sw.js'), build = await read('build.mjs');
      const srcs = [...html.matchAll(/<script src="([^"]+)"/g)].map(m => m[1]).filter(s => !s.startsWith('vendor/'));
      t.eq(srcs[0], 'catalog.js', 'catalog.js is the first local script'); t.eq(srcs[1], 'core/market.js', 'the market core right after it'); t.eq(srcs[2], 'engine.js', 'engine.js after the core');
      t.ok(/const CORE = \['catalog', 'core\/market', 'engine'/.test(build), "build.mjs CORE starts with 'catalog', 'core/market', 'engine'");
      t.ok(!/frankfurter/i.test(html) && !/frankfurter/i.test(sw), 'no Frankfurter preconnect or cache rule');
      t.ok(!/ECB/.test(html), 'no ECB text in index.html');
      t.ok(/id="feedPill"[^>]*>OFFLINE · no live prices</.test(html), 'feed pill says OFFLINE · no live prices');
      t.ok(!/simulat|synthetic|zero drift|>SIM\b/i.test(html.replace(/<script[\s\S]*?<\/script>/g, '')), 'no simulated wording in index.html');
      const page = await open('/');
      await page.waitForFunction(() => typeof Engine === 'object', null, { timeout: 30000 });
      const r = await page.evaluate(() => ({ n: CATALOG.instr.length, inWin: 'CATALOG' in window, frozen: Object.isFrozen(CATALOG) }));
      t.deep([r.n, r.frozen], [265, true], 'CATALOG is a global in the page');
      t.noErrors(page);
    }
  }
];
