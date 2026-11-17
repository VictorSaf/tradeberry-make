// Wave 1 · v1-stats: the shared honest-statistics helpers in shared.js (contract C1).
// wilson / wrTxt / brierParts / rwHit are pure; atrWilder takes bars; atr1h / sig1h read Engine.aggregate only.

// hourly bars ending in the last complete hour before simTime (each bar a range of `tr`, closes flat, so TR = range)
const STUB = () => {
  window.V1S = {
    real: Engine.aggregate,
    // n complete hours plus, if `open`, the hour in progress; tr(i) gives bar i's range
    stub(n, tr, open = true) {
      const now = Math.floor(Engine.simTime / 3600) * 3600, out = [];
      for (let i = 0; i < n; i++) { const r = tr(i); out.push({ time: now - (n - i) * 3600, open: 1, high: 1 + r / 2, low: 1 - r / 2, close: 1 }); }
      if (open) out.push({ time: now, open: 1, high: 1e3, low: 1e-3, close: 1 }); // a wild partial hour: must be ignored
      Engine.aggregate = () => out.map(b => ({ ...b }));
    },
    restore() { Engine.aggregate = V1S.real; }
  };
};
const bars = trs => trs.reduce((a, r) => (a.push({ time: a.length * 3600, open: 1, high: 1 + r / 2, low: 1 - r / 2, close: 1 }), a), [{ time: 0, open: 1, high: 1, low: 1, close: 1 }]);

export const tests = [
  {
    name: 'V1S1 wilson: 7/10 → [0.3968, 0.8922], 0/10 → [0, 0.2775], .lo/.hi alias, n = 0 → null; wrTxt prints rate, interval and n',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const a = wilson(7, 10), b = wilson(0, 10), c = wilson(10, 10), d = wilson(3, 10, 2.576);
        return { a: [...a], alo: a.lo, ahi: a.hi, b: [...b], c: [...c], d: [...d], z: wilson(0, 0), bad: wilson(NaN, 10),
          w: wrTxt(16, 26), w0: wrTxt(0, 0), w1: wrTxt(10, 10) };
      });
      t.near(r.a[0], 0.3968, 'wilson(7,10) low', 0, 5e-5); t.near(r.a[1], 0.8922, 'wilson(7,10) high', 0, 5e-5);
      t.eq(r.alo, r.a[0], '.lo is the low bound'); t.eq(r.ahi, r.a[1], '.hi is the high bound');
      t.eq(r.b[0], 0, 'wilson(0,10) low is exactly 0'); t.near(r.b[1], 0.2775, 'wilson(0,10) high', 0, 5e-5);
      t.near(r.c[0], 0.7225, 'wilson(10,10) low', 0, 5e-5); t.eq(r.c[1], 1, 'wilson(10,10) high is exactly 1');
      t.ok(r.d[0] < 0.3 - 0.14 && r.d[1] > 0.3 + 0.3, 'a wider z widens the interval: ' + r.d);
      t.eq(r.z, null, 'n = 0 → null'); t.eq(r.bad, null, 'a non-number → null');
      t.eq(r.w, '62% (43–78%) · n=26', 'wrTxt(16, 26)');
      t.eq(r.w0, '— · n=0', 'wrTxt with no trades');
      t.eq(r.w1, '100% (72–100%) · n=10', 'wrTxt(10, 10)');
      t.noErrors(page);
    }
  },
  {
    name: 'V1S2 brierParts: sample A (70%×10 with 7 wins + 30%×10 with 3) and B (90%×20 with 10) decompose exactly; one outcome → bss null',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const rows = (p, n, k) => Array.from({ length: n }, (_, i) => ({ p, y: i < k ? 1 : 0 }));
        const A = brierParts([...rows(.7, 10, 7), ...rows(.3, 10, 3)]), B = brierParts(rows(.9, 20, 10));
        const C = brierParts(rows(.6, 5, 5)), D = brierParts(rows(.6, 5, 0));
        // an uneven mix: the identity rel − res + unc = bs must still hold
        const E = brierParts([...rows(.1, 3, 1), ...rows(.4, 7, 2), ...rows(.8, 9, 8), { p: .55, y: true }, { p: 1.5, y: 1 }, { p: 'x', y: 0 }, null]);
        return { A, B, C, D, E, empty: brierParts([]), none: brierParts(null) };
      });
      const { A, B, E } = r;
      t.near(A.bs, .21, 'A bs', 0, 1e-12); t.near(A.base, .5, 'A base', 0, 1e-12); t.near(A.unc, .25, 'A unc', 0, 1e-12);
      t.near(A.rel, 0, 'A rel', 0, 1e-12); t.near(A.res, .04, 'A res', 0, 1e-12); t.near(A.bss, .16, 'A bss', 0, 1e-12);
      t.near(A.rel - A.res + A.unc, A.bs, 'A rel − res + unc = bs', 0, 1e-12); t.eq(A.n, 20, 'A n');
      t.eq(A.bins.length, 2, 'A has two bins'); t.deep(A.bins.map(b => [b.p, b.n, b.k]), [[.3, 10, 3], [.7, 10, 7]], 'A bins by forecast, ascending');
      t.near(B.bs, .41, 'B bs', 0, 1e-12); t.near(B.rel, .16, 'B rel', 0, 1e-12); t.near(B.res, 0, 'B res', 0, 1e-12); t.near(B.bss, -.64, 'B bss', 0, 1e-12);
      t.near(B.rel - B.res + B.unc, B.bs, 'B rel − res + unc = bs', 0, 1e-12);
      t.eq(r.C.base, 1, 'all wins → base 1'); t.eq(r.C.bss, null, 'base 1 → bss null'); t.eq(r.D.base, 0, 'all losses → base 0'); t.eq(r.D.bss, null, 'base 0 → bss null');
      t.eq(E.n, 20, 'invalid rows (p outside 0..1, not a number, null) are dropped'); t.near(E.rel - E.res + E.unc, E.bs, 'E rel − res + unc = bs', 0, 1e-12);
      t.eq(r.empty, null, 'no rows → null'); t.eq(r.none, null, 'not an array → null');
      t.noErrors(page);
    }
  },
  {
    name: 'V1S3 rwHit: a 1σ√h move → 0.3173, 2σ√h → 0.0455; the sign of the distance does not matter; bad inputs → null',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const s = .0012, h = 9, sd = s * Math.sqrt(h);
        return { one: rwHit(sd, s, h), two: rwHit(2 * sd, s, h), neg: rwHit(-sd, s, h), three: rwHit(3 * sd, s, h), zero: rwHit(0, s, h),
          bad: [rwHit(sd, 0, h), rwHit(sd, s, 0), rwHit(NaN, s, h), rwHit(sd, -s, h)] };
      });
      t.near(r.one, 0.3173, 'rwHit(σ√T)', 0, 5e-5); t.near(r.two, 0.0455, 'rwHit(2σ√T)', 0, 5e-5); t.near(r.three, 0.0027, 'rwHit(3σ√T)', 0, 5e-5);
      t.eq(r.neg, r.one, 'a negative distance gives the same probability'); t.eq(r.zero, 1, 'distance 0 → 1');
      t.deep(r.bad, [null, null, null, null], 'σ ≤ 0, hours ≤ 0 or NaN → null');
      t.noErrors(page);
    }
  },
  {
    name: 'V1S4 atrWilder: constant TR 1 → 1; 14 × 1 then 15 → 2.0; seeded by the SMA of the first n TRs; too few bars → null',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(bars => {
        const mk = trs => eval(bars)(trs);
        const gap = [{ time: 0, open: 1, high: 1.1, low: .9, close: 1 }, { time: 3600, open: 1.5, high: 1.6, low: 1.5, close: 1.55 }];
        return { c: atrWilder(mk(Array(30).fill(1))), s: atrWilder(mk([...Array(14).fill(1), 15])), seed: atrWilder(mk([...Array(13).fill(1), 15])),
          n3: atrWilder(mk([2, 4, 6, 8]), 3), few: atrWilder(mk(Array(13).fill(1))), none: atrWilder([]), bad: atrWilder(null),
          gap: atrWilder(gap, 1) };
      }, bars.toString());
      t.near(r.c, 1, 'constant TR 1 → 1', 0, 1e-12);
      t.near(r.s, 2, '14 × 1 then 15 → 2.0', 0, 1e-12);
      t.near(r.seed, 2, 'the first 14 TRs seed by their mean (13 × 1 + 15) / 14', 0, 1e-12);
      t.near(r.n3, (4 * 2 + 8) / 3, 'n = 3: seed (2+4+6)/3 = 4, then (4·2 + 8)/3', 0, 1e-12);
      t.eq(r.few, null, 'fewer than n TRs → null'); t.eq(r.none, null, 'no bars → null'); t.eq(r.bad, null, 'not an array → null');
      t.near(r.gap, .6, 'TR uses the previous close (gap up: 1.6 − 1.0)', 0, 1e-12);
      t.noErrors(page);
    }
  },
  {
    name: 'V1S5 atr1h / sig1h: the hour in progress is ignored, fewer than 15 complete hours → null, and the live value is Wilder on complete hours',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(STUB);
      const r = await page.evaluate(() => {
        const o = {};
        V1S.stub(20, () => .001); o.flat = atr1h('EURUSD'); o.sigFlat = sig1h('EURUSD');
        V1S.stub(20, () => .001, false); o.flatClosed = atr1h('EURUSD');
        V1S.stub(14, () => .001); o.short = atr1h('EURUSD'); o.sigShort = sig1h('EURUSD');
        V1S.stub(15, () => .001); o.just = atr1h('EURUSD');
        // closes alternating 1, 1.01: hourly log returns ±ln(1.01), RMS = ln(1.01)
        V1S.stub(30, () => .001); const st = Engine.aggregate();
        Engine.aggregate = () => st.map((b, i) => ({ ...b, close: i % 2 ? 1.01 : 1, high: Math.max(b.high, 1.01) }));
        o.sigAlt = sig1h('EURUSD');
        V1S.restore();
        o.unknown = [atr1h('NOPE'), sig1h('NOPE')];
        // the live market: same as Wilder over the complete hours aggregate returns
        const now = Engine.simTime, all = Engine.aggregate('EURUSD', 60, 500).filter(b => b.time + 3600 <= now);
        o.live = atr1h('EURUSD'); o.hours = all.length; o.liveSig = sig1h('EURUSD');
        o.ref = atrWilder(all.slice(-101));
        return o;
      });
      t.near(r.flat, .001, 'the wild partial hour does not reach the ATR', 0, 1e-12);
      t.near(r.flatClosed, .001, 'with no partial hour the result is the same', 0, 1e-12);
      t.eq(r.sigFlat, 0, 'flat closes → sigma 0');
      t.eq(r.short, null, '14 complete hours → null'); t.eq(r.sigShort, null, 'sig1h: 14 complete hours → null');
      t.near(r.just, .001, '15 complete hours are enough', 0, 1e-12);
      t.near(r.sigAlt, Math.log(1.01), 'sig1h is the zero-drift RMS of hourly log returns', 1e-12);
      t.deep(r.unknown, [null, null], 'an unknown symbol → null');
      t.ok(r.hours >= 101, 'the seeded history has more than 101 complete hours: ' + r.hours);
      {
        t.ok(r.live > 0, 'the live EURUSD ATR is positive: ' + r.live);
        t.near(r.live, r.ref, 'live atr1h = atrWilder over the last 101 complete hours', 1e-12);
        t.ok(r.liveSig > 0 && r.liveSig < .02, 'the live hourly sigma is a small positive fraction: ' + r.liveSig);
      }
      t.noErrors(page);
    }
  }
];
