// Observatory, usefulness (P2) for the Volatility clock (review 24.10). The typical move is the next hour's (the
// variances of the coming 60 one-minute steps added, closed minutes left out), shown at ±1σ and ±2σ with how often
// past hours actually went beyond ±2σ (fat tails), and the usual profile is the median of the days, with their number.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z'), FRI = new Date('2026-10-23T20:30:00Z');
async function obsApp(app, clock, opts = {}) {
  const page = await app('', { clock, ...opts });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = { show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); } };
  });
  return page;
}
// by hand, in the page: the median-of-days profile, the next hour's σ and the ±2σ tail count
const HAND = () => {
  const sym = S.set.sym, a = Engine.candles[sym], T0 = a.map(k => k.time), now = Engine.simTime, c = OBS.clk;
  const day0 = Math.floor(now / 86400) * 86400, hEnd = Math.max(day0, c.dayStart);
  const g = Array.from({ length: 96 }, () => new Map()), sum = Array(96).fill(0), cnt = Array(96).fill(0);
  for (let i = 1; i < a.length; i++) {
    if (isGapAt(T0, i) || a[i].time >= hEnd) continue;
    const t = a[i].time, sl = Math.floor((t % 86400) / 900), d = Math.floor(t / 86400), r = Math.abs(Math.log(a[i].close / a[i - 1].close));
    const e = g[sl].get(d) || [0, 0]; e[0] += r; e[1]++; g[sl].set(d, e); sum[sl] += r; cnt[sl]++;
  }
  const med = x => { const s = x.slice().sort((p, q) => p - q), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const prof = g.map(m => med([...m.values()].map(([s, n]) => s / n)) * 1e4), mean = sum.map((v, k) => cnt[k] ? v / cnt[k] * 1e4 : 0);
  const sd = k => prof[k] / 1e4 * Math.sqrt(Math.PI / 2), m = M(sym), px = Engine.quote(sym).mid;
  let v = 0, open = 0;
  for (let j = 0; j < 60; j++) { const t = now + j * 60; if (!Engine.isOpen(sym, t)) continue; open++; v += sd(Math.floor((t % 86400) / 900)) ** 2; }
  const sig = Math.sqrt(v) * px / m.pip;
  // non-overlapping gap-free 60-minute windows before the trading day: the move against ±2σ of its own minutes
  let n = 0, k = 0;
  for (let i = 0; i + 60 < a.length;) {
    if (a[i + 60].time >= c.dayStart) break;
    let ok = a[i + 60].time - a[i].time === 3600, s2 = 0;
    for (let j = i + 1; ok && j <= i + 60; j++) { if (isGapAt(T0, j)) ok = false; else s2 += sd(Math.floor((a[j].time % 86400) / 900)) ** 2; }
    if (!ok || !(s2 > 0)) { i++; continue; }
    n++; if (Math.abs(Math.log(a[i + 60].close / a[i].close)) > 2 * Math.sqrt(s2)) k++; i += 60;
  }
  return { prof, mean, nd: g.map(m2 => m2.size), sig, open, n, k };
};

export const tests = [
  {
    name: 'OP22 Volatility clock: the typical move is the next hour (sum of the coming minutes\' variances), closed minutes left out',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(h => {
        setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false });
        return { txt: b.textContent, lab: [...b.querySelectorAll('.ins label')].map(x => x.textContent), nh: OBS.clk.nextH, hand: eval(h)() };
      }, `(${HAND})`);
      t.near(r.nh.sig, r.hand.sig, 'next-hour σ = √(Σ σ² of the next 60 minutes)', 1e-9, 1e-9);
      t.eq(r.nh.min, 60, 'a full hour of trading on Wednesday');
      t.ok(r.lab.some(l => /^Next hour/.test(l)), 'labelled as the next hour: ' + r.lab);
      t.ok(new RegExp(`±${r.hand.sig.toFixed(0)} pips`).test(r.txt), `±${r.hand.sig.toFixed(0)} pips shown: ` + (r.txt.match(/Next hour.{0,260}/) || [''])[0]);
      t.ok(/until 15:00 UTC/.test(r.txt), 'the hour is named (until 15:00 UTC)');
      t.noErrors(page);
      // Friday 20:30: the market closes at 21:00, only 30 minutes of the hour trade
      const f = await obsApp(app, FRI);
      const q = await f.evaluate(h => { setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }); return { txt: b.textContent, nh: OBS.clk.nextH, hand: eval(h)() }; }, `(${HAND})`);
      t.eq(q.nh.min, 30, 'only the 30 open minutes count'); t.eq(q.hand.open, 30, 'by hand: 30 open minutes');
      t.near(q.nh.sig, q.hand.sig, 'Friday next-hour σ', 1e-9, 1e-9);
      t.ok(/Only 30 minutes of trading/.test(q.txt), 'the short hour is said: ' + (q.txt.match(/Next hour.{0,300}/) || [''])[0]);
      t.noErrors(f);
    }
  },
  {
    name: 'OP23 Volatility clock: ±2σ beside ±1σ, with how often past hours went beyond ±2σ (n shown, fat tails said)',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(h => { setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }); return { txt: b.textContent, nh: OBS.clk.nextH, tail: OBS.clk.tail, hand: eval(h)() }; }, `(${HAND})`);
      t.near(r.nh.sig2, 2 * r.nh.sig, '2σ = twice 1σ', 1e-12);
      t.ok(new RegExp(`±${r.nh.sig.toFixed(0)} pips \\(1σ\\)`).test(r.txt) && new RegExp(`±${r.nh.sig2.toFixed(0)} pips \\(2σ\\)`).test(r.txt), 'both bands in the text: ' + (r.txt.match(/Next hour.{0,300}/) || [''])[0]);
      t.eq(r.tail.n, r.hand.n, 'past hours checked'); t.eq(r.tail.k, r.hand.k, 'past hours beyond ±2σ');
      t.ok(r.tail.n >= 40, 'enough past hours to check: ' + r.tail.n);
      t.ok(new RegExp(`${r.tail.k} of ${r.tail.n} past hours`).test(r.txt) && /normal curve/.test(r.txt) && /fat tails/.test(r.txt), 'tail count with n and the fat-tail note: ' + (r.txt.match(/Next hour.{0,500}/) || [''])[0]);
      t.ok(!/will|expect(ed)? to/i.test((r.txt.match(/Next hour.{0,500}/) || [''])[0]), 'no forecast wording');
      t.noErrors(page);
      const s = await obsApp(app, SAT);
      const c = await s.evaluate(() => { setSymbol('EURUSD'); return OQ.show('clock', { clkAll: false }).textContent; });
      t.ok(!/2σ/.test(c) && !/Next hour ·/.test(c), 'closed: no bands');
      t.noErrors(s);
    }
  },
  {
    name: 'OP24 Volatility clock: the usual profile is the median of the days (robust to one agitated day), with the number of days',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(h => {
        setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }), hand = eval(h)(), c = OBS.clk;
        const res = { txt: b.textContent, avg: c.avg, mean: c.mean, nd: c.nd, curSl: c.curSl, hand };
        // one agitated day: every return of the second-to-last full day ×10 in one slot moves the mean, the median barely
        const a = Engine.candles.EURUSD, d = Math.floor(Engine.simTime / 86400) - 2, sl = c.curSl, idx = [];
        for (let i = 1; i < a.length; i++) if (Math.floor(a[i].time / 86400) === d && Math.floor((a[i].time % 86400) / 900) === sl) idx.push(i);
        // the other days' own averages in that slot: with one day pushed up, a median of 3 or more days cannot pass the largest of them
        const T0 = a.map(k => k.time), day0 = Math.floor(Engine.simTime / 86400) * 86400, per = new Map();
        for (let i = 1; i < a.length; i++) { const tt = a[i].time, dd = Math.floor(tt / 86400); if (tt >= day0 || dd === d || isGapAt(T0, i) || Math.floor((tt % 86400) / 900) !== sl) continue; const e = per.get(dd) || [0, 0]; e[0] += Math.abs(Math.log(a[i].close / a[i - 1].close)); e[1]++; per.set(dd, e); }
        res.others = [...per.values()].map(e => e[0] / e[1] * 1e4);
        const keep = idx.map(i => ({ ...a[i] }));
        const r0 = idx.map(i => a[i].close / a[i - 1].close);
        idx.forEach((i, j) => { a[i] = { ...a[i], close: a[i - 1].close * Math.exp(10 * Math.log(r0[j])) }; });
        OQ.show('clock', { clkAll: false }); res.ag = { n: idx.length, avg: OBS.clk.avg[sl], mean: OBS.clk.mean[sl], h2: eval(h)() };
        idx.forEach((i, j) => { a[i] = keep[j]; });
        return res;
      }, `(${HAND})`);
      r.avg.forEach((v, k) => t.near(v, r.hand.prof[k], `slot ${k}: median of the days' averages`, 1e-9, 1e-12));
      r.mean.forEach((v, k) => t.near(v, r.hand.mean[k], `slot ${k}: pooled mean kept beside it`, 1e-9, 1e-12));
      t.deep(r.nd, r.hand.nd, 'days per slot');
      t.ok(new RegExp(`median of ${r.nd[r.curSl]} days`).test(r.txt), 'the number of days is said: ' + (r.txt.match(/Petals.{0,260}/) || [''])[0]);
      t.ok(r.ag.n > 0, 'the agitated day has bars in the slot');
      t.near(r.ag.avg, r.ag.h2.prof[r.curSl], 'agitated: still the median', 1e-9, 1e-12);
      // the mean follows the agitated day without bound; the median is held by the other days (bounded by the largest of them)
      const dMean = r.ag.mean / r.mean[r.curSl], top = Math.max(...r.others);
      t.ok(dMean > 1.5, `one agitated day moves the mean ×${dMean.toFixed(2)}`);
      t.ok(r.others.length >= 2, `at least 3 days in the slot (${r.others.length + 1})`);
      t.ok(r.ag.avg <= top + 1e-9, `the median stays within the other days: ${r.ag.avg.toFixed(3)} ≤ ${top.toFixed(3)} (mean ${r.ag.mean.toFixed(3)})`);
      t.noErrors(page);
    }
  }
];
