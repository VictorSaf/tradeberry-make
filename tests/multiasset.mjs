// Multi-asset engine on the catalog (v15, .mace/design/catalog.md §2–3 and §6): the instrument model the modules read,
// the paths of the non-FX instruments against the catalog's factor model, and the determinism reference of the FX
// market (fx-seed7.json, VERSION 2). The v14 tests of the six illustrative CFDs (A1–A3, A6, A8–A11: account maths,
// profiles, state import, ticket) went with those CFDs (rule 5); the account on the catalog is tested in
// tests/account.mjs (c3), the state migration in tests/migration.mjs (c4). Expected values come from catalog.js.
import { readFile } from 'node:fs/promises';
const FX7 = JSON.parse(await readFile(new URL('./fixtures/fx-seed7.json', import.meta.url), 'utf8'));
const G8 = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'AUDUSD', 'USDCAD', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF', 'EURAUD', 'GBPCHF', 'CADJPY', 'AUDNZD'];

export const tests = [
  {
    name: 'MA0 instrument model on the catalog: META contract (v14 fields kept), INSTR order, pips, CFDS = the 227 non-FX',
    async run({ t, open }) {
      const page = await open('/tests/engine.html', { clock: true });
      const r = await page.evaluate(async () => {
        await Engine.init();
        const keys = ['sym', 'kind', 'label', 'short', 'group', 'cls', 'base', 'quote', 'size', 'pip', 'point', 'unit', 'tick', 'digits', 'spread', 'lotName', 'minLot', 'lotStep', 'maxLot', 'newsCcy', 'fin', 'div', 'sessions', 'sess', 'is247', 'p', 'seed', 'desc'];
        const miss = Engine.INSTR.flatMap(m => keys.filter(k => !(k in m)).map(k => m.sym + '.' + k));
        const cat = Object.fromEntries(CATALOG.instr.map(x => [x.sym, x]));
        const diff = Engine.INSTR.filter(m => ['digits', 'point', 'pip', 'size', 'group', 'cls', 'base', 'quote', 'lotName'].some(k => m[k] !== cat[m.sym][k])).map(m => m.sym);
        const pick = m => ({ kind: m.kind, label: m.label, short: m.short, unit: m.unit, tick: m.tick, pip: m.pip, digits: m.digits, size: m.size, news: m.newsCcy, group: m.group, spread: m.spread, minLot: m.minLot, lotStep: m.lotStep, lotName: m.lotName, div: m.div });
        return {
          miss, diff, n: Engine.INSTR.length, meta: Object.keys(Engine.META).length, frozen: Engine.INSTR.every(m => Object.isFrozen(m)),
          order: Engine.INSTR.slice(0, 16).map(m => m.sym), fxOrder: Engine.FX.slice(0, 16).map(m => m.sym), cfds: Engine.CFDS.length, cfdKinds: [...new Set(Engine.CFDS.map(m => m.kind))],
          label: Engine.CFD_REF_LABEL === Engine.SNAP_LABEL,
          pips: Engine.FX.map(m => [m.sym, m.digits, m.pip]),
          eur: pick(Engine.META.EURUSD), de: pick(Engine.META['DE.30']), aapl: pick(Engine.META['AAPL.US']), eurSp: cat.EURUSD.p.spread[0],
          sess: Engine.INSTR.every(m => Array.isArray(m.sessions) && m.sessions.length && m.sessions.every(x => typeof x.name === 'string' && x.from >= 0 && x.to <= 24 && x.from < x.to)),
          close: Engine.INSTR.filter(m => m.p.status === 'close').length
        };
      });
      t.deep(r.miss, [], 'every instrument carries the v14 fields and the sheet fields');
      t.deep(r.diff, [], 'contract fields equal the catalog');
      t.eq(r.n, 265, '265 instruments'); t.eq(r.meta, 265, 'META has every instrument'); t.ok(r.frozen, 'instrument objects are frozen');
      t.deep(r.order, G8, 'INSTR starts with the G8 16'); t.deep(r.fxOrder, G8, 'so does Engine.FX');
      t.eq(r.cfds, 227, 'CFDS = 265 − 38 FX'); t.deep(r.cfdKinds, ['cfd'], "everything not FX keeps kind 'cfd'");
      t.ok(r.label, 'CFD_REF_LABEL is SNAP_LABEL (alias)');
      for (const [s, d, pip] of r.pips) t.near(pip, d % 2 ? 10 ** -(d - 1) : 10 ** -d, s + ' pip from its digits', 1e-12);
      t.deep(r.eur, { kind: 'fx', label: 'EUR/USD', short: 'EUR/USD', unit: 'pip', tick: .00001, pip: .0001, digits: 5, size: 100000, news: ['EUR', 'USD'], group: 'fx', spread: r.eurSp / 10, minLot: .01, lotStep: .01, lotName: 'lots', div: null }, 'EURUSD in the v14 shape (spread in pips)');
      t.deep(r.de, { kind: 'cfd', label: r.de.label, short: 'DE.30', unit: 'pt', tick: .1, pip: .1, digits: 1, size: 25, news: ['EUR'], group: 'index', spread: r.de.spread, minLot: .01, lotStep: .01, lotName: 'lots', div: 'excluded' }, 'DE.30');
      t.deep([r.aapl.lotName, r.aapl.minLot, r.aapl.lotStep, r.aapl.news, r.aapl.unit], ['shares', 1, 1, ['USD'], 'pt'], 'AAPL.US in shares, step 1');
      t.ok(r.sess, 'v14 sessions: UTC windows'); t.eq(r.close, 15, '15 CLOSE ONLY');
      t.noErrors(page);
    }
  },
  {
    name: 'MA4 non-FX paths follow the catalog factor model: correlations to the fitted exposures, volatility to sIn, fat tails',
    async run({ t, open }) {
      const page = await open('/tests/engine.html?seed=11', { clock: new Date('2026-10-19T19:00:00Z') });
      const r = await page.evaluate(async () => {
        await Engine.init();
        const C = CATALOG, F = C.factors, cat = Object.fromEntries(C.instr.map(x => [x.sym, x]));
        const lE = C.ccy.EUR.load, lJ = C.ccy.JPY.load, rz = -lE.reduce((s, v, k) => s + v * lJ[k], 0);
        // the normalised exposures of an instrument: a on (z EURUSD, z USDJPY), c on the 6 orthogonal non-FX innovations
        const ex = s => {
          const sd = cat[s].seed, b = sd.beta || [0, 0, 0, 0, 0, 0, 0, 0], a = [b[6], b[7]], c = new Array(6).fill(0);
          for (let k = 0; k < 6; k++) { a[0] += b[k] * F.cond[k][0]; a[1] += b[k] * F.cond[k][1]; for (let j = 0; j < 6; j++) c[j] += b[k] * F.chol[k][j]; }
          const id = sd.idio == null ? 1 : sd.idio, V = a[0] ** 2 + a[1] ** 2 + 2 * rz * a[0] * a[1] + c.reduce((x, v) => x + v * v, 0) + id * id, q = 1 / Math.sqrt(V);
          return { a: a.map(v => v * q), c: c.map(v => v * q) };
        };
        const model = (x, y) => {
          if (y === 'EURUSD' || y === 'USDJPY') { const e = ex(x); return y === 'EURUSD' ? e.a[0] + rz * e.a[1] : rz * e.a[0] + e.a[1]; }
          const i = ex(x), j = ex(y);
          return i.a[0] * j.a[0] + i.a[1] * j.a[1] + rz * (i.a[0] * j.a[1] + i.a[1] * j.a[0]) + i.c.reduce((s, v, k) => s + v * j.c[k], 0);
        };
        const ret = s => { const a = Engine.candles[s], o = new Map(); for (let i = 1; i < a.length; i++) if (a[i].time - a[i - 1].time === 60) o.set(a[i].time, Math.log(a[i].close / a[i - 1].close)); return o; };
        const R = {};
        const corr = (x, y) => {
          const X = R[x] || (R[x] = ret(x)), Y = R[y] || (R[y] = ret(y)), a = [], b = [];
          for (const [tm, v] of X) if (Y.has(tm)) { a.push(v); b.push(Y.get(tm)); }
          return [Engine.corr(a, b), a.length];
        };
        const P = [['US.500', 'US.100'], ['US.500', 'DE.30'], ['DE.30', 'EU.50'], ['GOLD', 'SILVER'], ['AAPL.US', 'US.100'], ['GOLD', 'USDJPY'], ['US.500', 'USDJPY'], ['GOLD', 'EURUSD'], ['OIL', 'US.500']];
        const cs = P.map(([x, y]) => { const [v, n] = corr(x, y); return [x + '/' + y, v, model(x, y), n]; });
        const sdv = a => { const m = a.reduce((x, y) => x + y, 0) / a.length; return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); };
        const kurt = a => { const m = a.reduce((x, y) => x + y, 0) / a.length, v = a.reduce((x, y) => x + (y - m) ** 2, 0) / a.length; return a.reduce((x, y) => x + (y - m) ** 4, 0) / a.length / v / v - 3; };
        const vols = ['US.500', 'GOLD', 'BTCUSD', 'AAPL.US', 'OIL', 'CORN'].map(s => { const v = [...(R[s] || (R[s] = ret(s))).values()]; return [s, sdv(v) / (cat[s].seed.sIn / Math.sqrt(60)), kurt(v), v.length]; });
        return { cs, vols };
      });
      for (const [k, v, m, n] of r.cs) {
        t.ok(n > 1500, k + ': matched minutes ' + n);
        // .15: a week of 1-minute returns with jumps scatters by about ±.08 across seeds; idiosyncratic jumps and
        // regimes (the v15 WIP) diluted these by about a third (US.500/US.100 .56 vs .88)
        t.ok(Math.abs(v - m) <= .15, `corr ${k}: ${v.toFixed(3)} vs the catalog model ${m.toFixed(3)}`);
      }
      for (const [s, ratio, k, n] of r.vols) {
        t.ok(n > 1500, s + ' returns: ' + n);
        t.ok(ratio > .7 && ratio < 1.4, `${s}: realised 1-minute σ / (sIn/√60) = ${ratio.toFixed(2)}`);
        t.ok(k > 3, `${s}: fat tails, excess kurtosis ${k.toFixed(1)}`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'MA5 FX market of ?seed=7 is bit-identical to the VERSION 2 reference (determinism: seed + clock + catalog)',
    async run({ t, open }) {
      const page = await open('/tests/engine.html?seed=7', { clock: true });
      const r = await page.evaluate(async () => {
        await Engine.init();
        const syms = Engine.PAIRS.map(p => p.sym);
        const hist = Object.fromEntries(syms.map(s => [s, Engine.candles[s].slice(-200).map(c => c.close)]));
        const t0 = Engine.simTime;
        Engine.speed = 60;
        for (let i = 0; i < 300; i++) Engine.tick(250);
        const after = Object.fromEntries(syms.map(s => [s, Engine.candles[s].slice(-30).map(c => [c.time, c.open, c.high, c.low, c.close])]));
        return { ev: Engine.VERSION, seed: Engine.seed, source: Engine.source, t0, t1: Engine.simTime, regime: Engine.regime, hist, after, bids: syms.map(s => Engine.quote(s).bid) };
      });
      t.eq(r.ev, FX7.ev, 'reference written by this VERSION of the maths (bump VERSION and rerun make-fx-seed7.mjs on a change)');
      t.eq(r.source, FX7.source, 'source'); t.eq(r.t0, FX7.t0, 'same start'); t.eq(r.t1, FX7.t1, 'same clock after the ticks');
      t.eq(Object.keys(r.hist).length, 16, 'all 16 pairs');
      for (const s of Object.keys(FX7.hist)) t.deep(r.hist[s], FX7.hist[s], s + ': last 200 closes of the history');
      for (const s of Object.keys(FX7.after)) t.deep(r.after[s], FX7.after[s], s + ': 30 bars after 300 ticks');
      t.deep(r.bids, FX7.bids, 'bids after the ticks'); t.eq(r.regime, FX7.regime, 'vol regime');
      t.noErrors(page);
    }
  }
];
