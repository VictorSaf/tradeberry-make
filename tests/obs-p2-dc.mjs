// Observatory, usefulness (P2) for Intrinsic time and Déjà vu (review 24.10, task obs6a).
// Intrinsic time: distance to the reversal level (pips and × δ) with an alert at it, an auto δ (about 1–2 events per
// hour of trading on the history), a time axis under the zigzag with "last 80 of N events", leg durations in minutes of
// open market, the scaling law (events at δ, 2δ, 4δ against the random walk's ×4) and the history said in days and hours.
// Déjà vu: the unconditional cone (all windows, no match) behind the analogues, the coverage of the analogues' middle
// half in the past tests, a redraw on a new closed bar only (held while the pointer or focus is in the view), and the ↗
// button leaving a way back to the tool.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z');
async function obsApp(app, clock) {
  const page = await app('', { clock });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = {
      show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); },
      texts(fn) {
        const P = CanvasRenderingContext2D.prototype, ot = P.fillText, texts = [];
        P.fillText = function (s, x, y) { texts.push({ s: String(s), x, y }); return ot.apply(this, arguments); };
        try { fn(); } finally { P.fillText = ot; }
        return texts;
      }
    };
  });
  return page;
}

export const tests = [
  {
    name: 'OP61 Intrinsic time: distance to the reversal level in pips and × δ; "Alert at reversal" adds a price alert at that level',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); S.alerts = [];
        const b = OQ.show('dc', { dcTh: .1, dcAuto: false }), a = Engine.candles.EURUSD, th = .001;
        const { ev, ext } = dcEvents(a, th), last = ev[ev.length - 1], rev = last.type === 'up' ? ext * (1 - th) : ext * (1 + th);
        const cur = a[a.length - 1].close, pips = Math.abs(cur - rev) / M('EURUSD').pip, dd = Math.abs(cur - rev) / (ext * th);
        const kp = [...b.querySelectorAll('.obs-kpis .kpi')].find(k => /Reversal level/.test(k.querySelector('label').textContent));
        const act = b.querySelector('.dc-act'), btn = b.querySelector('[data-dc-alert]');
        const out = { rev, pips, dd, cond: last.type === 'up' ? 'below' : 'above', dc: { revPips: OBS.dc.revPips, revD: OBS.dc.revD, rev: OBS.dc.rev }, kp: kp.textContent, act: act && act.textContent, btn: btn && btn.textContent };
        btn.click();
        out.alerts = JSON.parse(JSON.stringify(S.alerts)); out.toasts = T.toasts();
        return out;
      });
      t.near(r.dc.rev, r.rev, 'reversal level', 1e-12);
      t.near(r.dc.revPips, r.pips, 'distance in pips', 1e-9);
      t.near(r.dc.revD, r.dd, 'distance in multiples of δ', 1e-9);
      t.ok(r.dd > 0 && r.dd <= 1.0000001, 'the price sits between the extreme and the reversal level: ' + r.dd);
      t.ok(r.kp.includes(`${r.pips.toFixed(1)} pips`) && r.kp.includes(`${r.dd.toFixed(2)} × δ`), 'the KPI says both distances: ' + r.kp);
      t.ok(r.act && r.act.includes(`${r.pips.toFixed(1)} pips`) && r.act.includes(`${r.dd.toFixed(2)} × δ`), 'the action line says both: ' + r.act);
      t.eq(r.btn, 'Alert at reversal', 'button label');
      t.eq(r.alerts.length, 1, 'one alert added');
      t.eq(r.alerts[0].sym, 'EURUSD', 'on the open pair');
      t.near(r.alerts[0].price, r.rev, 'at the reversal level', 1e-12);
      t.eq(r.alerts[0].cond, r.cond, 'on the side of the reversal');
      t.ok(r.toasts.some(x => x.title === 'Alert set'), 'the alert toast of the common mechanism: ' + JSON.stringify(r.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'OP62 Intrinsic time: auto δ gives 1–2 events per hour of trading on the history, its value shown; a fixed δ turns it off',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        for (const s of ['EURUSD', 'USDJPY', 'USDTRY']) {
          setSymbol(s); const b = OQ.show('dc', { dcAuto: true }), a = Engine.candles[s];
          const th = OBS.dc.th, { ev } = dcEvents(a, th), O = obsOpenT(a.map(k => k.time)), h = O[O.length - 1] / 3600;
          const auto = document.querySelector('#obsCtrl [data-k="dcAuto"]');
          const r1 = []; for (let i = 1; i < a.length; i++) if (!isGapAt(a.map(k => k.time), i)) r1.push(Math.log(a[i].close / a[i - 1].close));
          out[s] = { sd: stdev(r1), th, auto: OBS.dc.auto, rate: ev.length / h, shown: OBS.dc.rate, ctrl: document.getElementById('obsCtrl').textContent, on: auto && auto.classList.contains('on'), offs: [...document.querySelectorAll('#obsCtrl [data-k="dcTh"] button.on')].filter(x => !x.dataset.k).length, txt: b.textContent };
        }
        setSymbol('EURUSD'); OQ.show('dc', { dcAuto: true, dcTh: .1 });
        document.querySelector('#obsCtrl [data-k="dcTh"] button[data-val="0.2"]').click();
        out.after = { auto: obsCfg().dcAuto, th: obsCfg().dcTh, dc: OBS.dc.th, autoOn: document.querySelector('#obsCtrl [data-k="dcAuto"]').classList.contains('on') };
        document.querySelector('#obsCtrl [data-k="dcAuto"]').click();
        out.back = { auto: obsCfg().dcAuto, th: OBS.dc.th };
        return out;
      });
      for (const s of ['EURUSD', 'USDJPY', 'USDTRY']) {
        const x = r[s], pct = x.th * 100, lab = pct.toFixed(3) + '%';
        t.ok(x.auto, `${s}: auto on`);
        t.ok(x.rate >= 1 && x.rate <= 2, `${s}: ${x.rate.toFixed(2)} events per hour of trading at δ ${lab}`);
        t.near(x.shown, x.rate, `${s}: the rate shown is the rate at the auto δ`, 1e-9);
        t.ok(x.ctrl.includes(lab), `${s}: the control shows the auto δ ${lab}: ` + x.ctrl);
        t.ok(x.txt.includes(lab), `${s}: the view says the auto δ`);
        t.ok(x.on && x.offs === 0, `${s}: Auto marked, no fixed δ marked`);
      }
      // EUR/USD and USD/JPY can have near-equal σ (their order flips between seeds): only the clearly calmer USD/TRY is ranked
      t.ok(r.USDTRY.th < Math.min(r.EURUSD.th, r.USDJPY.th) && r.USDTRY.sd < Math.min(r.EURUSD.sd, r.USDJPY.sd), 'a calmer pair gets a smaller δ: ' + ['EURUSD', 'USDJPY', 'USDTRY'].map(s => `${s} δ ${r[s].th} σ ${r[s].sd.toExponential(2)}`).join(', '));
      t.deep(r.after, { auto: false, th: .2, dc: .002, autoOn: false }, 'a fixed δ turns auto off');
      t.ok(r.back.auto === true && r.back.th !== .002, 'Auto turns it back on');
      t.noErrors(page);
    }
  },
  {
    name: 'OP63 Intrinsic time: a UTC time axis under the zigzag and "last 80 of N events"; history in days and hours of trading',
    async run({ t, app }) {
      const page = await obsApp(app, SAT);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); let b;
        const texts = OQ.texts(() => { b = OQ.show('dc', { dcTh: .05, dcAuto: false }); }).map(x => x.s);
        // few events at a large δ: all of them are drawn and the axis says so
        const few = OQ.texts(() => OQ.show('dc', { dcTh: .1 })).map(x => x.s), nFew = dcEvents(Engine.candles.EURUSD, .001).ev.length;
        OQ.show('dc', { dcTh: .05 });
        const a = Engine.candles.EURUSD, { ev } = dcEvents(a, .0005), show = ev.slice(-80), O = obsOpenT(a.map(k => k.time));
        const txt = b.textContent, dj = OQ.show('deja', { dvTf: 15, dvW: 32, dvH: 12 }), djClosed = { cov: !!dj.querySelector('.dj-cov'), unc: OBS.dj && OBS.dj.unc.n > 0, live: obsKey() === OBS.key };
        return { djClosed, few, nFew, texts, N: ev.length, axis: OBS.dc.axis.map(x => ({ i: x.i, t: x.t })), want: OBS.dc.axis.map(x => show[x.i].extT), lab: OBS.dc.axis.map(x => dts(show[x.i].extT)), days: (a[a.length - 1].time - a[0].time) / 86400, hrs: O[O.length - 1] / 3600, txt };
      });
      t.ok(r.texts.includes(`last 80 of ${r.N} events`), 'the axis says how many events are drawn: ' + r.texts.filter(s => /events/.test(s)));
      t.ok(r.N > 80, 'more than 80 events at 0.05%: ' + r.N);
      t.ok(r.nFew <= 80 && r.few.includes(`all ${r.nFew} events`), 'all drawn when there are 80 or fewer: ' + r.few.filter(s => /events/.test(s)));
      t.ok(r.axis.length >= 3, 'at least 3 time ticks: ' + r.axis.length);
      t.deep(r.axis.map(x => x.t), r.want, 'each tick is the time of the extreme drawn there');
      for (const l of r.lab) t.ok(r.texts.includes(l), 'tick label drawn: ' + l);
      t.ok(r.texts.some(s => /UTC/.test(s)), 'the axis names its time zone');
      t.deep(r.djClosed, { cov: true, unc: true, live: true }, 'market closed: Déjà vu draws its reference cone and coverage, keyed on the closed bar');
      const hist = `History: ${Math.round(r.days)} days (${Math.round(r.hrs)} hours of trading)`;
      t.ok(r.txt.includes(hist), 'the history is said: ' + hist + ' in ' + (r.txt.match(/History[^)]*\)/) || [''])[0]);
      t.noErrors(page);
    }
  },
  {
    name: 'OP64 Intrinsic time: average leg duration and the current leg, in minutes of open market, with n',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); const b = OQ.show('dc', { dcTh: .1, dcAuto: false }), a = Engine.candles.EURUSD;
        const { ev, extI } = dcEvents(a, .001), O = obsOpenT(a.map(k => k.time)), d = [];
        for (let i = 0; i + 1 < ev.length; i++) d.push((O[ev[i + 1].extI] - O[ev[i].extI]) / 60);
        // the extreme index really is the bar of the extreme
        const okI = ev.every(e => a[e.extI].close === e.extP && a[e.extI].time === e.extT) && a[extI].close === dcEvents(a, .001).ext;
        const now = (O[O.length - 1] - O[ev[ev.length - 1].extI]) / 60;
        const blk = b.querySelector('.dc-legs');
        return { avg: d.reduce((s, x) => s + x, 0) / d.length, n: d.length, now, okI, dc: { legAvg: OBS.dc.legAvg, legN: OBS.dc.legN, legNow: OBS.dc.legNow }, txt: blk && blk.textContent };
      });
      t.ok(r.okI, 'extI points at the bar of each extreme');
      t.near(r.dc.legAvg, r.avg, 'average leg in open-market minutes', 1e-9);
      t.eq(r.dc.legN, r.n, 'n legs');
      t.near(r.dc.legNow, r.now, 'current leg: open-market minutes since its extreme', 1e-9);
      const fm = m => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`;
      t.ok(r.txt && r.txt.includes(fm(r.avg)) && r.txt.includes(fm(r.now)) && r.txt.includes(`n=${r.n}`), 'the block says both with n: ' + r.txt);
      t.noErrors(page);
    }
  },
  {
    name: 'OP65 Intrinsic time: scaling law, events at δ, 2δ, 4δ and their ratios against the random walk\'s ≈ 4, neutral reading',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); const b = OQ.show('dc', { dcTh: .05, dcAuto: false }), a = Engine.candles.EURUSD;
        const n = [.0005, .001, .002].map(th => dcEvents(a, th).ev.length);
        const tb = b.querySelector('.dc-scale');
        return { n, sc: OBS.dc.scale, txt: tb && tb.textContent, rows: tb ? [...tb.querySelectorAll('tbody tr')].map(x => x.textContent) : [] };
      });
      t.deep(r.sc.map(x => x.n), r.n, 'events counted at δ, 2δ, 4δ');
      t.near(r.sc[1].ratio, r.n[0] / r.n[1], 'ratio δ → 2δ', 1e-9);
      t.near(r.sc[2].ratio, r.n[1] / r.n[2], 'ratio 2δ → 4δ', 1e-9);
      t.eq(r.rows.length, 3, 'one row per δ');
      t.ok(r.rows[0].includes('0.05%') && r.rows[1].includes('0.10%') && r.rows[2].includes('0.20%'), 'the three thresholds: ' + r.rows);
      t.ok(r.rows[1].includes(`×${(r.n[0] / r.n[1]).toFixed(1)}`) || r.rows[1].includes(`÷${(r.n[0] / r.n[1]).toFixed(1)}`), 'the ratio shown: ' + r.rows[1]);
      t.ok(/random walk/.test(r.txt) && /≈ ?4|×4|4×/.test(r.txt), 'compared with the random walk: ' + r.txt);
      t.ok(!/(will|expect|predict|bullish|bearish|trend)/i.test(r.txt), 'neutral wording: ' + r.txt);
      for (const x of r.sc.slice(1)) t.ok(['near', 'above', 'below', 'thin'].includes(x.call), 'each ratio read against its noise: ' + x.call);
      t.noErrors(page);
    }
  },
  {
    name: 'OP66 Déjà vu: the unconditional cone (all windows, no match) behind the analogues, with n',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); OBS.djRel = null;
        const W = 32, Hh = 12, tf = 15; const b = OQ.show('deja', { dvTf: tf, dvW: W, dvH: Hh });
        const me = Engine.aggregate('EURUSD', tf, 4000), cl = me.map(k => k.close), N = cl.length, tNow = me[N - W].time, q = zpath(cl, N - W, W);
        const last = [];
        for (const p of Engine.PAIRS) {
          const bars = Engine.aggregate(p.sym, tf, 4000), c2 = bars.map(k => k.close);
          for (let a = 0; a + W + Hh <= c2.length && bars[a + W + Hh - 1].time < tNow; a += 5) { const z = zpath(c2, a, W); last.push(Math.log(c2[a + W + Hh - 1] / c2[a + W - 1]) / z.sr * q.sr); }
        }
        last.sort((x, y) => x - y);
        const u = OBS.dj.unc;
        return { n: last.length, lo: djQ(last, .25), med: djMedian(last), hi: djQ(last, .75), u: { n: u.n, lo: u.lo[Hh - 1], med: u.med[Hh - 1], hi: u.hi[Hh - 1], len: u.lo.length }, leg: b.querySelector('.dj-leg').textContent, txt: b.textContent };
      });
      t.eq(r.u.n, r.n, 'every window of the same length (stride 5) before the pattern');
      t.eq(r.u.len, 12, 'one band point per look-ahead bar');
      t.near(r.u.lo, r.lo, 'lower quartile at the last bar', 1e-9, 1e-12);
      t.near(r.u.med, r.med, 'median at the last bar', 1e-9, 1e-12);
      t.near(r.u.hi, r.hi, 'upper quartile at the last bar', 1e-9, 1e-12);
      t.ok(/all windows/.test(r.leg), 'legend names it: ' + r.leg);
      t.ok(r.txt.includes(`${r.n.toLocaleString('en-US')} windows`) || r.txt.includes(`${r.n} windows`), 'n of the reference is said');
      t.noErrors(page);
    }
  },
  {
    name: 'OP67 Déjà vu: coverage of the analogues\' middle half in the past tests (target 50%) next to the verdict',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); OBS.djRel = null;
        const b = OQ.show('deja', { dvTf: 15, dvW: 32, dvH: 12 }), cl = Engine.aggregate('EURUSD', 15, 4000).map(k => k.close);
        const log = OBS.djRel.log.map(x => { const s = x.ends.slice().sort((p, q) => p - q), mv = Math.log(cl[x.e + 12] / cl[x.e]); return { cov: x.cov, mv: x.mv, wantMv: mv, want: mv >= djQ(s, .25) && mv <= djQ(s, .75) }; });
        const el = b.querySelector('.dj-cov');
        return { log, cov: OBS.dj.cov, txt: el && el.textContent, tip: el && (el.dataset.tip || el.querySelector('[data-tip]')?.dataset.tip || ''), side: el && el.closest('.obs-side') !== null, after: el && el.previousElementSibling && el.previousElementSibling.classList.contains('dj-verdict') };
      });
      for (const x of r.log) { t.near(x.mv, x.wantMv, 'actual move logged', 1e-12); t.eq(x.cov, x.want, 'inside the middle half of its own analogues'); }
      const k = r.log.filter(x => x.want).length, pc = Math.round(k / r.log.length * 100);
      t.eq(r.cov.k, k, 'covered count'); t.eq(r.cov.n, r.log.length, 'n tests');
      t.ok(r.txt && r.txt.includes(`${pc}%`) && /target 50%/.test(r.txt) && r.txt.includes(`${r.log.length}`), 'coverage shown with target and n: ' + r.txt);
      t.ok(r.after, 'right after the verdict');
      t.noErrors(page);
    }
  },
  {
    name: 'OP68 Déjà vu: redrawn by obsTick on a new closed bar only, held while the pointer or focus is in the view',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); const out = { live: OBS_LIVE.includes('deja') };
        const b = OQ.show('deja', { dvTf: 15, dvW: 16, dvH: 6 }), a = Engine.candles.EURUSD, last = a[a.length - 1];
        const mark = () => { const m = document.createElement('i'); m.id = 'djMark'; b.querySelector('.dj-main').appendChild(m); };
        mark(); const c0 = last.close; last.close = c0 * 1.0001; obsTick(); out.sameBar = !!document.getElementById('djMark');
        // a new 15-minute bar: the previous one closed
        const t15 = (Math.floor(last.time / 900) + 1) * 900; a.push({ ...last, time: t15, open: last.close, high: last.close, low: last.close });
        obsTick(); out.newBar = !document.getElementById('djMark') && !!b.querySelector('#djCv');
        // focus inside the view: held, drawn on leaving
        mark(); b.querySelector('.dj-it').focus(); a.push({ ...last, time: t15 + 900 }); obsTick(); out.held = !!document.getElementById('djMark') && OBS.missed;
        document.activeElement.blur(); b.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        a.pop(); a.pop(); last.close = c0;
        return out;
      });
      t.ok(r.live, 'Déjà vu is a live view');
      t.ok(r.sameBar, 'a tick inside the same bar does not redraw');
      t.ok(r.newBar, 'a new bar redraws');
      t.ok(r.held, 'held while the focus is in the view (marked as missed)');
      t.noErrors(page);
    }
  },
  {
    name: 'OP69 Déjà vu: ↗ opens the match on the chart and leaves "← back to Déjà vu", which returns to the tool, pair and timeframe',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(async () => {
        setSymbol('EURUSD'); setTF(1); const b = OQ.show('deja', { dvTf: 15, dvW: 32, dvH: 12 });
        const j = OBS.dj.an.findIndex(o => o.s !== 'EURUSD'), o = OBS.dj.an[Math.max(0, j)];
        b.querySelectorAll('.dj-go')[Math.max(0, j)].click(); await new Promise(r => setTimeout(r, 200));
        const back = document.getElementById('djBack'), out = { view: currentView(), sym: S.set.sym, match: o.s, tf: S.set.tf, back: back && back.textContent, vis: back && back.getBoundingClientRect().width > 0 };
        back.querySelector('[data-dj-back]').click(); await new Promise(r => setTimeout(r, 200));
        out.after = { view: currentView(), tab: activeTab, obs: obsCfg().view, sym: S.set.sym, tf: S.set.tf, gone: !document.getElementById('djBack'), drawn: !!document.querySelector('#obsBody #djCv') };
        return out;
      });
      t.eq(r.view, 'trade', 'on the Trade view');
      t.eq(r.sym, r.match, 'the match pair'); t.eq(r.tf, 15, 'the tool\'s timeframe');
      t.ok(r.vis && /← back to Déjà vu/.test(r.back), 'a visible way back: ' + r.back);
      t.deep(r.after, { view: 'research', tab: 'obs', obs: 'deja', sym: 'EURUSD', tf: 1, gone: true, drawn: true }, 'back on Déjà vu with the pair and timeframe from before');
      t.noErrors(page);
    }
  }
];
