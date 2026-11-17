// Observatory, common layer + Constellation, Regime, Tapestry (review 24.10, errors P0).
// The 5 s refresh keeps focus and hover and stays still while the market is closed; the header says when the data is
// from; the glossary is per tool; tools that need FX say so (obsNeed); Tapestry's theme is Engine.strength and its
// hover follows the pair; Constellation reads direction (hedges), skips weekend gaps and leaves frozen quotes out;
// Regime measures n = lb bars, averages PE over the 5-minute grid offsets, skips gaps and flat quotes, and its
// noise band holds 90% of noise built from the same returns.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z'), MON = new Date('2026-10-26T00:30:00Z');
async function obsApp(app, clock, opts = {}) {
  const page = await app('', { clock, ...opts });
  // the workspace shell comes up after boot: wait for it, then open Research › Observatory (visible, so hover works)
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = {
      show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); },
      text: () => document.getElementById('obs').textContent,
      norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
      // the y of every fillRect drawn in a given colour
      rects(fn, colour) {
        const P = CanvasRenderingContext2D.prototype, o = P.fillRect, want = OQ.norm(colour), ys = [];
        P.fillRect = function (x, y, w, h) { if (OQ.norm(this.fillStyle) === want) ys.push(y); return o.apply(this, arguments); };
        try { fn(); } finally { P.fillRect = o; }
        return ys;
      },
      // a pair's quotes frozen over its last n bars
      freeze(sym, n) { const a = Engine.candles[sym], v = a[a.length - n - 1].close; for (const k of a.slice(-n - 1)) { k.open = k.high = k.low = k.close = v; } }
    };
  });
  return page;
}

export const tests = [
  {
    name: 'OC1 refresh: focus and hover survive the 5 s tick, the view stays still while FX is closed, and catches up on leave',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const b = OQ.show('const', { lb: 240 }), pill = b.querySelector('.pill'); pill.focus();
        OBS.key = ''; obsTick(); OBS.key = ''; obsTick();
        const kept = document.activeElement === pill && pill.isConnected;
        return { kept, missed: !!OBS.missed };
      });
      t.ok(r.kept, 'the focused pill is the same element after two ticks');
      t.noErrors(page);
      // the real loop on a moving market (clock running, open on Friday 10:30): 6 s of ticks change the data
      const run = await obsApp(app, 'run', { freeze: false });
      await run.evaluate(() => { const b = OQ.show('const', { lb: 240 }); window.OQpill = b.querySelector('.pill'); OQpill.focus(); });
      await run.waitForTimeout(6000);
      const live = await run.evaluate(() => ({ same: document.activeElement === OQpill && OQpill.isConnected, missed: !!OBS.missed, open: mktState().open }));
      t.ok(live.open, 'the market is open');
      t.ok(live.same, 'focus still on the same pill after 6 s of the real loop');
      t.ok(live.missed, 'a tick with new data was held back while the focus was inside');
      t.noErrors(run);
      // leaving: the skipped tick is drawn
      const after = await page.evaluate(async () => {
        const old = document.querySelector('#obsBody .pill'); OBS.missed = true; old.blur(); document.body.focus();
        await new Promise(r => setTimeout(r, 50));
        return { redrawn: !old.isConnected, missed: !!OBS.missed };
      });
      t.ok(after.redrawn && !after.missed, 'the view redraws once focus leaves it');
      // hover on the Tapestry canvas: the canvas stays
      await page.evaluate(() => OQ.show('tap', { tapLb: 240 }));
      const box = await page.locator('#tapCv').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 45);
      const hov = await page.evaluate(() => { const cv = document.getElementById('tapCv'); OBS.key = ''; obsTick(); return cv.isConnected && document.getElementById('tapCv') === cv; });
      t.ok(hov, 'the hovered Tapestry canvas is not replaced by a tick');
      await page.mouse.move(2, 2); await page.waitForTimeout(80);
      t.noErrors(page);
      // closed market: nothing changes, nothing is redrawn
      const p2 = await obsApp(app, SAT);
      const still = await p2.evaluate(() => { OQ.show('const', { lb: 240 }); const el = document.querySelector('#obsBody .obs-split'); OBS.key = ''; obsTick(); OBS.key = ''; obsTick(); return el.isConnected; });
      t.ok(still, 'with FX closed a tick does not redraw the view');
      t.noErrors(p2);
    }
  },
  {
    name: 'OC2 header: "as of" the last data, with the market state while FX is closed; "of trading" in the window texts',
    async run({ t, app }) {
      const page = await obsApp(app, SAT);
      const r = await page.evaluate(() => { const out = {}; for (const v of ['const', 'regime', 'tap', 'dc']) { OQ.show(v); out[v] = document.getElementById('obsHead').textContent; } out.tip = OBS_CTRL_TIP.lb[240]; out.node = document.querySelector('#obs') && (OQ.show('const', { lb: 240 }), document.querySelector('.cnode').dataset.tip); return out; });
      for (const v of ['const', 'regime', 'tap', 'dc']) t.ok(/as of Fri 20:59 UTC · FX closed · opens Sun 22:00 UTC/.test(r[v]), `${v} header: ` + r[v]);
      t.ok(/last 4 hours of trading/.test(r.tip), 'lb tip says of trading: ' + r.tip);
      t.ok(/Last 4 hours of trading/.test(r.node), 'node tip says of trading: ' + r.node);
      const p2 = await obsApp(app, WED);
      const h = await p2.evaluate(() => { OQ.show('const'); return document.getElementById('obsHead').textContent; });
      t.ok(/as of Wed 1[34]:\d\d UTC/.test(h) && !/closed/.test(h), 'open market header: ' + h);
      t.noErrors(page); t.noErrors(p2);
    }
  },
  {
    name: 'OC3 glossary per tool: "legs" and "basket" carry the meaning of the tool they are in; no promise the maths does not make',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(async () => {
        const tips = (view, word) => { OQ.show(view); obsEnhance(); return [...document.querySelectorAll('#obsBody .term')].filter(x => x.textContent.toLowerCase() === word).map(x => x.dataset.tip); };
        return { dcLegs: tips('dc', 'legs'), drvBasket: tips('drv', 'basket'), all: OBS_TERMS.map(x => x[1]).join(' ') };
      });
      t.ok(r.dcLegs.length && r.dcLegs.every(x => !/basket/i.test(x)), 'Intrinsic time legs are not basket legs: ' + r.dcLegs);
      t.ok(r.drvBasket.length && r.drvBasket.every(x => /eight/.test(x)), 'Drivers basket is the eight currencies: ' + r.drvBasket);
      t.ok(!/tend to continue/.test(r.all), 'Hurst is not sold as predictive');
      t.ok(!/pure random noise of the same length lands 90%/.test(r.all), 'noise band tip matches the band');
      t.noErrors(page);
    }
  },
  {
    name: 'OC4 guard: obsNeed names the tool and the instrument; Déjà vu on GOLD shows it with "Open EUR/USD" instead of crashing',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const ok = obsNeed('major', 'EURUSD'), fx = obsNeed('fx', 'USDTRY' in Engine.META ? 'USDTRY' : 'EURUSD');
        setSymbol('GOLD'); const b = OQ.show('deja'), txt = b.textContent, btn = b.querySelector('[data-obs-open]');
        btn.click();
        return { ok, fx, txt, sym: S.set.sym, after: document.getElementById('obsBody').textContent };
      });
      t.eq(r.ok, '', 'a major passes');
      t.eq(r.fx, '', 'an FX pair passes the FX guard');
      t.ok(/Déjà vu works on/.test(r.txt) && /Gold|GOLD/.test(r.txt) && /commodity/.test(r.txt) && /Open EUR\/USD/.test(r.txt), 'the message: ' + r.txt);
      t.ok(!/Could not compute/.test(r.txt), 'no crash');
      t.eq(r.sym, 'EURUSD', 'the button opens EUR/USD');
      t.ok(!/works on/.test(r.after), 'and the tool then runs');
      t.noErrors(page);
    }
  },
  {
    name: 'OC5 Tapestry: the theme is Engine.strength over the window (strongest and weakest), with the k/n consensus',
    async run({ t, app }) {
      for (const clock of [SAT, WED]) {
        const page = await obsApp(app, clock);
        const r = await page.evaluate(() => { const out = []; for (const lb of [240, 1440]) { const b = OQ.show('tap', { tapLb: lb }), th = [...b.querySelectorAll('.tap-theme b')].map(x => x.textContent), st = Engine.strength(lb); out.push({ th, hi: st[0].c, lo: st[st.length - 1].c, txt: b.querySelector('.tap-head').textContent }); } return out; });
        for (const x of r) {
          t.eq(x.th[0], `${x.hi} strength`, 'strongest = Engine.strength top');
          t.eq(x.th[1], `${x.lo} weakness`, 'weakest = Engine.strength bottom');
          t.ok(/same way on \d of \d pairs/.test(x.txt), 'consensus k/n kept: ' + x.txt);
        }
        t.noErrors(page);
      }
    }
  },
  {
    name: 'OC6 Tapestry: hover and click follow the pair (data-sym), not the row index, after the rows reorder',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      await page.evaluate(() => OQ.show('tap', { tapLb: 240, tapSort: 'ret' }));
      const box = await page.locator('#tapCv').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 30 * 12 + 15);
      const r = await page.evaluate(() => {
        const sym = OBS.tapHov && OBS.tapHov.sym, cv = document.getElementById('tapCv'), ds = cv.dataset.sym;
        // push it to the top: the sort by return moves its row
        const a = Engine.candles[sym]; a[a.length - 1].close *= 1.05;
        const ys = OQ.rects(() => obsDraw(), cssv('--s3')), data = OBS.tap.data, row = data.findIndex(d => d.s === sym);
        return { sym, ds, row, ys, rowsH: OBS.tap.rowsH, top: data[0].s };
      });
      t.ok(r.sym, 'a pair is hovered');
      t.eq(r.ds, r.sym, 'the canvas carries the hovered pair in data-sym');
      t.ok(r.row !== 12, 'the row moved (now ' + r.row + ')');
      t.ok(r.ys.length && r.ys.every(y => Math.round(y / r.rowsH) === r.row), `the highlight follows ${r.sym} to row ${r.row}: ${r.ys}`);
      // click on its new row opens it
      await page.mouse.click(box.x + box.width / 2, box.y + r.row * r.rowsH + 15);
      t.eq(await page.evaluate(() => S.set.sym), r.sym, 'click opens the pair drawn on that row');
      t.noErrors(page);
    }
  },
  {
    name: 'OC7 Constellation: "Your positions" reads direction — a hedge is not concentrated risk',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const { syms, C } = corrMatrix(1440); let best = null;
        for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) if (!best || Math.abs(C[i][j]) > Math.abs(best.r)) best = { a: syms[i], b: syms[j], r: C[i][j] };
        const side = (same) => { T.reset(); openPosition({ sym: best.a, side: 'buy', lots: .1, dupOk: true, pmDone: true }); openPosition({ sym: best.b, side: (best.r > 0) === same ? 'buy' : 'sell', lots: .1, dupOk: true, pmDone: true }); OQ.show('const', { lb: 1440 }); return document.getElementById('constSide').textContent; };
        return { best, same: side(true), hedge: side(false), n: S.positions.length };
      });
      t.ok(Math.abs(r.best.r) > .7, 'a strongly linked couple exists: ' + JSON.stringify(r.best));
      t.eq(r.n, 2, 'two positions');
      t.ok(/concentrated risk/.test(r.same), 'same bet twice is concentrated: ' + r.same);
      t.ok(!/concentrated risk/.test(r.hedge) && /hedge/i.test(r.hedge), 'opposite bets are a hedge: ' + r.hedge);
      t.noErrors(page);
    }
  },
  {
    name: 'OC8 Constellation and Regime skip the weekend gap; frozen quotes are left out with a mention, never "best diversifier"',
    async run({ t, app }) {
      const page = await obsApp(app, MON);
      const r = await page.evaluate(() => {
        const a = Engine.candles.EURUSD.slice(-241), T0 = a.map(k => k.time); let gaps = 0; for (let i = 1; i < T0.length; i++) if (isGapAt(T0, i)) gaps++;
        const { R } = corrMatrix(240);
        OQ.show('regime', { lb: 240 }); const rg = OBS.rgPts.find(p => p.s === 'EURUSD');
        return { gaps, len: R[0].length, rgN: rg.n, rgBars: rg.bars };
      });
      t.ok(r.gaps >= 1, 'the window crosses the weekend');
      t.eq(r.len, 240 - r.gaps, 'Constellation: the return across the gap is skipped');
      t.eq(r.rgBars, 240, 'Regime: n = lb bars');
      t.eq(r.rgN, 239 - r.gaps, 'Regime: Hurst returns skip the gap');
      const p2 = await obsApp(app, WED);
      const f = await p2.evaluate(() => {
        OQ.freeze('AUDNZD', 1445); const side = OQ.show('const', { lb: 1440 }) && document.getElementById('constSide').textContent;
        OQ.show('regime', { lb: 1440 }); const rg = document.getElementById('rgSide').textContent;
        return { side, rg, inMap: OBS.rgPts.some(p => p.s === 'AUDNZD') };
      });
      t.ok(!/AUD\/NZD sits furthest/.test(f.side), 'a frozen pair is not the best diversifier: ' + f.side);
      t.ok(/AUD\/NZD/.test(f.side) && /did not move/.test(f.side), 'it is named as left out: ' + f.side);
      t.ok(!f.inMap && /AUD\/NZD/.test(f.rg), 'Regime leaves the flat pair out and says so: ' + f.rg);
      t.noErrors(page); t.noErrors(p2);
    }
  },
  {
    name: 'OC9 Regime: one symbol in panel and sparkline; PE averages the 5-minute grid offsets; short history shows "—"; noise band holds 90%',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('GOLD'); OQ.show('regime', { lb: 1440 });
        const lab = document.querySelector('#rgSide .ins label').textContent, spark = OBS.rgSpark;
        // PE: the mean of the five offsets
        const a = Engine.candles.EURUSD.slice(-1440), segs = obsSegs(a.map(k => k.time), a.map(k => k.close));
        const avg = [0, 1, 2, 3, 4].map(o => obsPEoff(segs, o)).reduce((s, v) => s + v, 0) / 5, pe = obsPE(segs);
        const short = hurst(Array.from({ length: 30 }, (_, i) => Math.sin(i) * 1e-4));
        return { lab, spark, avg, pe, short, tipPE: OBS_CTRL_TIP_V.regime.lb[240] };
      });
      t.ok(/EUR\/USD/.test(r.lab) && r.spark === 'EURUSD', `panel and sparkline on one symbol: ${r.lab} / ${r.spark}`);
      t.near(r.pe, r.avg, 'PE = mean over the 5 offsets', 1e-12, 1e-12);
      t.eq(r.short, null, 'Hurst on 30 returns is not measured');
      t.ok(/5-minute/.test(r.tipPE) && /entropy/i.test(r.tipPE), 'the 4H tip says what entropy is computed on: ' + r.tipPE);
      // coverage: on past windows of this (pure noise) market, the band built from each window's own returns holds ~90%
      const cov = await page.evaluate(() => {
        let inH = 0, inP = 0, n = 0;
        for (const p of Engine.PAIRS) {
          const a = Engine.candles[p.sym];
          for (let e = a.length - 240; e - 240 >= 0 && n < 400; e -= 480) {
            const w = a.slice(e - 240, e), segs = obsSegs(w.map(k => k.time), w.map(k => k.close)), st = rgStats(segs);
            if (st.H == null || st.pe == null) continue;
            const b = rgBand([segs], 60, e); n++;
            if (st.H >= b.h.lo && st.H <= b.h.hi) inH++;
            if (st.pe >= b.pe.lo && st.pe <= b.pe.hi) inP++;
          }
        }
        return { n, h: inH / n, p: inP / n };
      });
      t.ok(cov.n >= 100, 'enough windows: ' + cov.n);
      t.ok(cov.h > .84 && cov.h < .96, 'Hurst band covers ~90%: ' + cov.h);
      t.ok(cov.p > .84 && cov.p < .96, 'PE band covers ~90%: ' + cov.p);
      const txt = await page.evaluate(() => (OQ.show('regime', { lb: 240 }), document.getElementById('rgSide').textContent));
      t.ok(!/—\s*$/.test(txt.trim().slice(0, 3)), 'renders');
      t.noErrors(page);
    }
  }
];
