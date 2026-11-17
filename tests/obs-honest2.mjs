// Observatory, honesty (P1) and UI (P3) for Intrinsic time, Déjà vu, Recurrence, Drivers and the Volatility clock
// (review 24.10). Intrinsic time says "last leg", keeps up/down colours for directions only, colours the heartbeat
// only outside its Poisson band, gives the overshoot its n and interval, measures the coastline as a length and draws
// the price now and the reversal level. Déjà vu tests the statistic it shows (sign of the median of the rescaled
// matches), on non-overlapping look-aheads, walk-forward, with an interval widened for the tool's 27 settings; the
// distance has a reference. Recurrence divides out the hour-of-day rhythm, builds its band from 120 shuffles with the
// three checks corrected, says "borderline", keeps "Now resembles" to sizes. Drivers needs >60% and >1 bp to name a
// leader and says how often each leg led before. The clock reads peaks by hour, hides "running at" under 15 bars,
// keeps its scale on the profile and counts today from the trading-day start.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z'), WED0 = new Date('2026-10-21T21:08:00Z');
async function obsApp(app, clock, opts = {}) {
  const page = await app('', { clock, ...opts });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = {
      show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); },
      // every fillText / arc while fn runs
      calls(fn) {
        const P = CanvasRenderingContext2D.prototype, ot = P.fillText, texts = [];
        P.fillText = function (s, x, y) { texts.push({ s: String(s), x, y, c: this.fillStyle }); return ot.apply(this, arguments); };
        try { fn(); } finally { P.fillText = ot; }
        return { texts };
      }
    };
  });
  return page;
}
const ASCII_MINUS = /(^|[\s(])-\d/;
const djMedian = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; };

export const tests = [
  {
    name: 'OH21 Intrinsic time: "last leg" not trend; neutral heartbeat and overshoot; Poisson band; overshoot n and interval; coastline as a length; price now and reversal drawn',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD');
        let b;
        const cv = OQ.calls(() => { b = OQ.show('dc', { dcTh: .1 }); });
        const kp = [...b.querySelectorAll('.obs-kpis .kpi')].map(k => ({ l: k.querySelector('label').textContent, v: k.querySelector('b').innerHTML, cls: k.querySelector('b').className, tip: k.dataset.tip || '' }));
        const out = { kp, txt: b.textContent, dc: OBS.dc, texts: cv.texts.map(x => x.s) };
        // the Poisson band by hand: 95% central of Poisson(λ)
        const lam = OBS.dc.lam; let p = Math.exp(-lam), c = p, k = 0, lo = null; while (c < .025) { k++; p *= lam / k; c += p; } lo = k; while (c < .975) { k++; p *= lam / k; c += p; }
        out.band = [lo, k];
        return out;
      });
      const K = l => r.kp.find(k => k.l.startsWith(l)) || { l: '', v: '', cls: '', tip: '' };
      t.ok(!/trend/i.test(r.txt), 'no "trend" anywhere: ' + r.txt.slice(0, 400));
      t.ok(/Last leg/.test(K('Last leg').l) && /(up|down)/.test(K('Last leg').v) && /0\.10%/.test(K('Last leg').v), 'Last leg: up/down δ: ' + K('Last leg').v);
      const hb = K('Heartbeat');
      t.ok(!/\b(up|dn)\b/.test(hb.cls), 'heartbeat has no up/down colour: ' + hb.cls);
      t.ok(!/\b(up|dn)\b/.test(K('Overshoot so far').cls), 'overshoot so far: no up/down colour');
      t.deep(r.dc.band, r.band, 'heartbeat band = 95% of Poisson(λ = average rate × 6 h)');
      t.eq(r.dc.hot, r.dc.recent < r.band[0] || r.dc.recent > r.band[1], 'coloured only outside the band');
      t.ok(/\bacc\b/.test(hb.cls) === r.dc.hot, 'accent only when outside: ' + hb.cls);
      t.ok(/expected/.test(hb.tip) && new RegExp(`${r.band[0]}–${r.band[1]}`).test(hb.tip), 'the band is said: ' + hb.tip);
      const os = K('Avg overshoot');
      t.ok(new RegExp(`n=${r.dc.osN}`).test(os.v + os.tip) && /95%/.test(os.tip), 'overshoot with n and interval: ' + os.v + ' | ' + os.tip);
      const co = K('Coastline');
      t.ok(!/net move/.test(co.v) && /%/.test(co.v), 'coastline is a length, not a ratio to the net move: ' + co.v);
      t.near(r.dc.coast * 100, parseFloat(co.v), 'coastline value', .06);
      const al = K('Average leg');
      t.ok(/ends at/.test(al.l) && /(pips|pt)/.test(al.v), 'average leg: the price where it ends and its length in pips: ' + al.l + ' ' + al.v);
      t.ok(/\bacc\b/.test(K('Reversal level').cls), 'the reversal level is highlighted: ' + K('Reversal level').cls);
      t.ok(r.texts.some(s => /^now /.test(s)) && r.texts.some(s => /^reversal /.test(s)), 'the chart labels the price now and the reversal level: ' + r.texts.filter(s => /now|reversal|avg/.test(s)));
      t.ok(!/shaded segments/.test(r.txt) && /0\.10%/.test(r.txt) && !/0\.1%/.test(r.txt), 'thick segments, δ with two decimals');
      // y ticks are round: every price label is a multiple of the tick step
      const ticks = r.texts.filter(s => /^\d+\.\d+$/.test(s)).map(Number), st = ticks.length > 1 ? Math.abs(ticks[1] - ticks[0]) : 0;
      t.ok(ticks.length >= 3 && ticks.every(v => Math.abs(v / st - Math.round(v / st)) < 1e-6), 'round ticks: ' + ticks);
      t.noErrors(page);
    }
  },
  {
    name: 'OH22 Déjà vu: the test scores the shown statistic, walk-forward, non-overlapping look-aheads, corrected interval; distance reference; true median; no simulated wording',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); OBS.djRel = null;
        const t0 = performance.now(); const b = OQ.show('deja', { dvTf: 15, dvW: 32, dvH: 12 }), ms = performance.now() - t0, dj = OBS.dj;
        const v = b.querySelector('.dj-verdict');
        const out = { ms, log: dj.log, step: dj.step, Hh: 12, tests: dj.tests, hits: dj.hits, med: dj.med, ends: dj.ends, txt: b.textContent, vtip: v.dataset.tip || '', vtxt: v.textContent, dRef: dj.dRef, z: DJ_Z, sim: obsSim() };
        out.medAll = djMedian([1, 2, 3, 4]); out.medOdd = djMedian([5, 1, 3]);
        // a verdict on a pinned record: 15 of 20 is 75% but not an edge once corrected for 27 settings
        out.ci95 = wilson(15, 20); out.ciC = wilson(15, 20, DJ_Z);
        return out;
      });
      t.ok(r.ms < 1500, `drawn in ${r.ms.toFixed(0)} ms`);
      t.ok(r.log.length === r.tests && r.tests >= 20, 'tests logged: ' + r.tests);
      for (const x of r.log) {
        t.ok(x.maxEnd < x.t0, `test at ${x.e}: every analogue (with its look-ahead) ended before the test pattern started`);
        t.eq(x.pred, Math.sign(djMedian(x.ends)), `test at ${x.e}: the prediction is the sign of the median of the rescaled ends`);
      }
      for (let i = 1; i < r.log.length; i++) t.ok(r.log[i - 1].e - r.log[i].e >= r.Hh, 'look-aheads do not overlap');
      t.eq(r.hits, r.log.filter(x => x.pred === x.act).length, 'hits counted from the log');
      t.eq(r.med, djMedian(r.ends), 'the median shown is the median of the shown ends');
      t.eq(r.medAll, 2.5, 'even count: the mean of the two middle values'); t.eq(r.medOdd, 3, 'odd count');
      t.ok(r.z > 3 && r.z < 3.2, 'z for 27 settings: ' + r.z);
      t.ok(r.ci95[0] > .5 && r.ciC[0] < .5, '15/20 clears 95% but not the corrected interval');
      t.ok(/27 settings/.test(r.vtip) || /27 settings/.test(r.txt), 'the correction is said: ' + r.vtip);
      t.ok(!/simulat|synthetic|zero drift|by construction/i.test(r.txt + r.vtip), 'the wording is not source-specific: never says simulated / zero drift');
      t.ok(r.dRef > 0 && /random window/.test(r.txt), 'the distance has a reference: ' + r.dRef);
      t.ok(!/rescaled to [^ ]+ current volatility/.test(r.txt) && /bar returns|bar volatility/.test(r.txt), 'rescaling described as it is computed');
      t.noErrors(page);
      // the verdict wording with a replay of real bars: not "simulated"
      const said = await page.evaluate(() => { const d = Object.getOwnPropertyDescriptor(Engine, 'source'); Object.defineProperty(Engine, 'source', { get: () => 'replay-bars', configurable: true }); const s = obsSim(); if (d) Object.defineProperty(Engine, 'source', d); return s; });
      t.ok(!said, 'replayed real bars are not called simulated');
    }
  },
  {
    name: 'OH23 Recurrence: hour-of-day rhythm divided out; 120 shuffles with corrected checks; borderline; sizes only in Now resembles; neutral "none"; legend in binary mode',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); OBS.rpBand = null;
        const t0 = performance.now(); let b = OQ.show('rp', { rpTf: 15, rpMode: 'grad' }); const ms = performance.now() - t0;
        const prof = rpSeason('EURUSD'), bars = Engine.aggregate('EURUSD', 15, 260), cl = bars.map(k => k.close);
        const raw = logret(cl).map((x, i) => x / prof[new Date(bars[i + 1].time * 1000).getUTCHours()]), sd = stdev(raw);
        const out = { ms, n: OBS.rpBand.n, cov: OBS.rpBand.cov, rIn: OBS.rpIn, want: raw.map(x => x / sd), prof: [...prof], txt: b.textContent };
        out.near = [...b.querySelectorAll('.rp-it')].map(x => x.lastElementChild.textContent + ' | ' + x.dataset.tip);
        out.verdict = b.querySelector('.dj-verdict').className;
        out.leg = b.querySelector('.rp-leg').textContent;
        b = OQ.show('rp', { rpMode: 'bin' }); out.legBin = b.querySelector('.rp-leg').textContent;
        // borderline by construction
        out.say = [rpCall({ v: .5, lo90: .3, hi90: .45, lo: .25, hi: .55 }), rpCall({ v: .6, lo90: .3, hi90: .45, lo: .25, hi: .55 }), rpCall({ v: .4, lo90: .3, hi90: .45, lo: .25, hi: .55 })];
        // across the 16 pairs: no green verdict
        out.cls = []; for (const p of Engine.PAIRS) { setSymbol(p.sym); out.cls.push(OQ.show('rp', { rpTf: 15, rpMode: 'grad' }).querySelector('.dj-verdict').className); }
        return out;
      });
      t.ok(r.ms < 900, `first draw with 120 shuffles in ${r.ms.toFixed(0)} ms`);
      t.ok(r.n >= 100, 'band from ≥ 100 shuffles: ' + r.n);
      t.ok(r.cov > .9 && r.cov < 1, 'its coverage: ' + r.cov);
      t.ok(new RegExp(`${r.n} shuffled`).test(r.txt), 'the number of shuffles is said');
      t.eq(r.rIn.length, r.want.length, 'deseasonalised returns');
      r.want.forEach((v, i) => { if (i < 5 || i > r.want.length - 3) t.near(r.rIn[i], v, `return ${i} / hourly profile`, 1e-9); });
      t.ok(r.prof.length === 24 && r.prof.every(v => v > 0), 'a profile for every hour');
      t.ok(/hour of (the )?day/.test(r.txt), 'the text says the daily rhythm is divided out');
      t.deep(r.say, ['borderline', 'above', 'inside'], 'between the 90% and the corrected band: borderline');
      t.ok(!/not their direction/.test(r.txt) && /(likely|hypothesis|probably)/i.test(r.txt + r.verdict), 'size not direction as a hypothesis');
      for (const x of r.near) t.ok(!/(^|\s)[+−-]\d/.test(x), 'Now resembles: no signed moves: ' + x);
      t.ok(r.cls.every(c => !/\b(ok|none)\b/.test(c)), 'verdicts neutral or accent, never green/yellow: ' + [...new Set(r.cls)]);
      t.ok(/similar/.test(r.leg) && /recurrence/.test(r.legBin) && !/similar.*different/.test(r.legBin), 'legend per mode: ' + r.legBin);
      t.noErrors(page);
    }
  },
  {
    name: 'OH24 Drivers: a leader needs >60% and >1 bp; the usual leader over past 4H windows; "of trading"; one minus sign; unsaturated board',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const mt = M('GBPJPY');
        const lead = [drvLead(-0.7e-4, -0.2e-4, mt), drvLead(3e-4, 2.2e-4, mt), drvLead(3e-4, 1.9e-4, mt), drvLead(-0.5e-4, 3e-4, mt)];
        setSymbol('GBPJPY'); const b = OQ.show('drv');
        const w = [...b.querySelectorAll('.cb-row .drv-bar i')].map(i => parseFloat(i.style.width));
        return { lead, base: OBS.drv.base, txt: b.textContent, verdict: b.querySelector('.drv-verdict').textContent, w, led: [...b.querySelectorAll('.drv-tbl .brx-t')].map(x => x.textContent) };
      });
      t.deep(r.lead, [null, null, 'GBP', 'JPY'], '−0.7 bp is too small; 58% is shared; 61% leads; the larger leg above 1 bp');
      t.ok(r.base && r.base.n >= 10, 'past 4H windows counted: ' + JSON.stringify(r.base));
      t.ok(/of (the )?\d+ earlier 4-hour windows/.test(r.verdict) && /usually|Before/.test(r.verdict), 'the usual leader: ' + r.verdict);
      t.ok(/last 4 hours of trading/.test(r.verdict), '"of trading": ' + r.verdict);
      t.ok(!ASCII_MINUS.test(r.txt), 'no ASCII minus before a number: ' + (r.txt.match(/.{20}(^|[\s(])-\d.{10}/) || [''])[0]);
      t.near(Math.max(...r.w), 50, 'the largest board bar reaches the end of its half', 1e-6);
      t.ok(r.w.filter(x => x >= 49.99).length === 1 || r.w.filter(x => x >= 49.99).length === 2, 'only the extreme bars are full: ' + r.w);
      t.ok(r.led.every(x => /-led$|Shared|Offsetting|Small/.test(x)), 'labels: ' + r.led);
      t.noErrors(page);
    }
  },
  {
    name: 'OH25 Volatility clock: peak and quietest by hour; "running at" with n and hidden under 15 bars; fixed scale; today from the trading-day start; catalog note',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }), c = OBS.clk;
        return { txt: b.textContent, c: { hourAvg: c.hourAvg, hiH: c.hiH, loH: c.loH, mxv: c.mxv, avg: c.avg, dayStart: c.dayStart, run: c.run }, now: Engine.simTime, ny: Engine.nyOffset(Engine.simTime) };
      });
      const hmax = r.c.hourAvg.indexOf(Math.max(...r.c.hourAvg)), hmin = r.c.hourAvg.indexOf(Math.min(...r.c.hourAvg.filter(v => v > 0)));
      t.eq(r.c.hiH, hmax, 'peak hour'); t.eq(r.c.loH, hmin, 'quietest hour');
      const hh = h => String(h).padStart(2, '0') + ':00';
      t.ok(new RegExp(`Peak ${hh(hmax)}–${hh((hmax + 1) % 24)} UTC`).test(r.txt) && new RegExp(`Quietest ${hh(hmin)}–${hh((hmin + 1) % 24)} UTC`).test(r.txt), 'by hour in the text: ' + (r.txt.match(/Peak.{0,90}/) || [''])[0]);
      t.near(r.c.mxv, Math.max(...r.c.avg), 'the scale is the profile maximum', 1e-12);
      const roll = 17 - r.ny, want = Math.floor((r.now - roll * 3600) / 86400) * 86400 + roll * 3600;
      t.eq(r.c.dayStart, want, 'today starts at 17:00 New York (' + roll + ':00 UTC)');
      t.ok(r.c.run && r.c.run.n >= 15 && new RegExp(`${r.c.run.n} one-minute bars`).test(r.txt), '"running at" with n: ' + JSON.stringify(r.c.run));
      t.ok(/catalog/.test(r.txt), 'the simulated profile comes from the catalog');
      t.noErrors(page);
      // eight minutes after the 21:00 rollover: too few bars to compare
      const p2 = await obsApp(app, WED0);
      const q = await p2.evaluate(() => { setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }); return { txt: b.textContent, run: OBS.clk.run, ds: OBS.clk.dayStart, now: Engine.simTime }; });
      t.ok(q.now - q.ds < 900, 'the trading day has just started: ' + (q.now - q.ds) / 60 + ' min');
      t.ok(!/running at/.test(q.txt) && /too few/.test(q.txt), 'hidden under 15 bars: ' + (q.txt.match(/Now.{0,200}/) || [''])[0]);
      t.noErrors(p2);
      const p3 = await obsApp(app, SAT);
      const s = await p3.evaluate(() => { setSymbol('EURUSD'); return OQ.show('clock', { clkAll: false }).textContent; });
      t.ok(!/running at/.test(s), 'closed: nothing running');
      t.noErrors(p3);
    }
  }
];
