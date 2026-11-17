// lightweight-charts 5.2.1: the main chart with RSI as pane 1, markers through one createSeriesMarkers handle,
// draggable price lines, the 2x2 multi-chart, the basket chart, intrinsic-time candles and the licence notice in Help.
const booted = page => page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));

export const tests = [
  {
    name: 'L1 library is 5.2.1, RSI lives in pane 1 of the main chart, v4 hover order kept',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      // pane heights settle once the boot layout stops moving
      await page.waitForFunction(() => Math.abs(chart.panes()[1]?.getHeight() - 96) <= 1, null, { timeout: 3000 }).catch(() => {});
      const r = await page.evaluate(() => ({
        ver: LightweightCharts.version(),
        panes: chart.panes().length,
        rsiPane: sRsi.getPane().paneIndex(),
        candlePane: candle.getPane().paneIndex(),
        rsiH: chart.panes()[1]?.getHeight(),
        oldDiv: typeof window.rsiChart?.timeScale,
        onTop: chart.options().hoveredSeriesOnTop,
        sep: chart.options().layout.panes.separatorColor,
        line: cssv('--line'),
        rsiLines: sRsi.priceLines().map(l => l.options().price).sort()
      }));
      t.eq(r.ver, '5.2.1', 'library version');
      t.eq(r.panes, 2, 'main chart has a price pane and an RSI pane');
      t.eq(r.candlePane, 0, 'candles in pane 0');
      t.eq(r.rsiPane, 1, 'RSI in pane 1');
      t.ok(r.rsiH >= 40 && r.rsiH <= 120, 'RSI pane height near the old 96px strip: ' + r.rsiH);
      t.eq(r.oldDiv, 'undefined', 'no separate RSI chart instance');
      t.eq(r.onTop, false, 'hoveredSeriesOnTop off (v4 series order)');
      t.eq(r.sep, r.line, 'pane separator uses the --line token');
      t.deep(r.rsiLines, [30, 70], 'RSI 30/70 guide lines');
      // RSI off removes the pane, on brings it back with its data
      const o = await page.evaluate(async () => {
        S.set.ind.rsi = false; applyIndVis(); await new Promise(r => requestAnimationFrame(r));
        const off = chart.panes().length;
        S.set.ind.rsi = true; applyIndVis(); await new Promise(r => requestAnimationFrame(r));
        return { off, on: chart.panes().length, n: sRsi.data().length, bars: IND.rsi.filter(v => v != null).length, lines: sRsi.priceLines().length };
      });
      t.eq(o.off, 1, 'RSI off: one pane');
      t.eq(o.on, 2, 'RSI on: two panes');
      t.eq(o.n, o.bars, 'RSI series refilled after toggling');
      t.eq(o.lines, 2, 'RSI guide lines restored');
      t.noErrors(page);
    }
  },
  {
    name: 'L2 markers go through one series-markers handle; price lines mirror state',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        T.reset();
        const p = openPosition({ sym: S.set.sym, side: 'buy', lots: .5, dupOk: true });
        const q = Engine.quote(S.set.sym), pip = Engine.META[S.set.sym].pip;
        p.sl = q.bid - 40 * pip; p.tp = q.bid + 60 * pip;
        changed('pos'); setMarkers(); rebuildLines();
        const h1 = candleMarkers; setMarkers(); setMarkers();
        return { same: h1 === candleMarkers, n: candleMarkers.markers().length, arrow: candleMarkers.markers()[0]?.shape, pl: candle.priceLines().length, lines: lines.length, kinds: lines.map(l => l.kind) };
      });
      t.ok(r.same, 'markers handle is created once');
      t.ok(r.n >= 1 && r.arrow === 'arrowUp', 'entry arrow marker present: ' + r.n + ' ' + r.arrow);
      t.eq(r.pl, r.lines, 'price lines on the candle series match the line list');
      t.ok(r.kinds.includes('pos-sl') && r.kinds.includes('pos-tp'), 'SL and TP lines drawn');
      t.noErrors(page);
    }
  },
  {
    name: 'L3 SL line is draggable with the mouse; clicks in the RSI pane do not place levels',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300); // let autoSize and the pane heights follow the new viewport
      const r0 = await page.evaluate(async () => {
        T.reset(); S.set.ind.zones = false; Object.assign(S.tk, { useSL: false, useTP: false, ot: 'market' });
        const p = openPosition({ sym: S.set.sym, side: 'buy', lots: .5, dupOk: true });
        const q = Engine.quote(S.set.sym), pip = Engine.META[S.set.sym].pip;
        p.sl = +(q.bid - 15 * pip).toFixed(Engine.META[S.set.sym].digits); changed('pos'); rebuildLines();
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        // under load the pane heights and the autoscale settle a few frames later
        for (let i = 0; i < 60; i++) { const y = candle.priceToCoordinate(p.sl); if (y != null && y > 0 && y < chart.panes()[0].getHeight()) break; await new Promise(r => setTimeout(r, 50)); }
        const box = document.getElementById('chart').getBoundingClientRect();
        return { id: p.id, sl: p.sl, y: candle.priceToCoordinate(p.sl), x: box.left + 200, top: box.top, pip, h0: chart.panes()[0].getHeight() };
      });
      t.ok(r0.y != null && r0.y > 0 && r0.y < r0.h0, 'SL line visible in the price pane: ' + r0.y);
      await page.mouse.move(r0.x, r0.top + r0.y);
      await page.mouse.down();
      await page.mouse.move(r0.x, r0.top + r0.y + 20, { steps: 4 });
      await page.mouse.up();
      const sl = await page.evaluate(id => S.positions.find(p => p.id === id).sl, r0.id);
      t.ok(sl < r0.sl, `SL moved down by the drag: ${r0.sl} -> ${sl}`);
      // hline tool click inside the RSI pane is ignored
      const n = await page.evaluate(async () => {
        setTool('hline'); return (S.hlines[S.set.sym] || []).length;
      });
      const rsiY = r0.top + r0.h0 + 30;
      await page.mouse.click(r0.x, rsiY);
      const after = await page.evaluate(() => ({ n: (S.hlines[S.set.sym] || []).length, tool }));
      t.eq(after.n, n, 'no level added from a click in the RSI pane');
      t.noErrors(page);
    }
  },
  {
    name: 'L4 multi-chart 2x2, basket chart and intrinsic-time candles render on 5.2.1',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      const m = await page.evaluate(async () => {
        setLayout('4'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        T.reset(); const p = openPosition({ sym: MC.panes[0].cfg.sym, side: 'sell', lots: .2, dupOk: true }); mcTick(true);
        return MC.panes.map(p => ({ n: p.candle.data().length, e: p.e20.data().length, pl: p.candle.priceLines().length, cv: p.el.querySelectorAll('canvas').length, logo: !!p.el.querySelector('a[href*="tradingview"]') }));
      });
      t.eq(m.length, 3, 'three extra panes');
      for (const [i, p] of m.entries()) { t.ok(p.n > 100 && p.e === p.n, `pane ${i} has candles and EMA`); t.ok(p.cv > 0, `pane ${i} draws`); t.ok(!p.logo, `pane ${i} has no logo`); }
      t.ok(m[0].pl >= 1, 'position line in pane 0');
      await page.evaluate(() => setLayout('1'));
      // intrinsic-time candles on the main chart
      const it = await page.evaluate(async () => {
        S.set.type = 'it'; fullChart(true); setMarkers(); chartTick();
        await new Promise(r => requestAnimationFrame(r));
        const d = candle.data(), ok = d.every((b, i) => !i || b.time > d[i - 1].time);
        const out = { n: d.length, bars: bars.length, ok, rsi: sRsi.data().length, rsiPts: IND.rsi.filter(v => v != null).length };
        S.set.type = 'candles'; fullChart(true); return out;
      });
      t.ok(it.n > 10 && it.n === it.bars && it.ok, 'intrinsic-time candles ascending: ' + it.n);
      t.eq(it.rsi, it.rsiPts, 'RSI pane follows intrinsic-time bars (whitespace points are not listed by data())');
      // baskets (lazy tools, Observatory view)
      await page.evaluate(() => loadLazy());
      const bk = await page.evaluate(async () => {
        obsCfg().view = 'bask'; setTab('obs');
        for (let k = 0; k < 40 && !(typeof BK === "object" && BK.series); k++) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { n: BK.series?.data().length || 0, e: BK.ema?.data().length || 0, cv: document.querySelectorAll('#bkChart canvas').length };
      });
      t.ok(bk.n > 10 && bk.e === bk.n, 'basket candles + EMA: ' + bk.n);
      t.ok(bk.cv > 0, 'basket chart draws');
      t.noErrors(page);
    }
  },
  {
    name: 'L4b R:R zones and drawings stay in the price pane (nothing paints over RSI)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.waitForTimeout(300);
      const r = await page.evaluate(async () => {
        T.reset(); S.set.ind.zones = true; Object.assign(S.tk, { useSL: false, useTP: false, ot: 'market' });
        const p = openPosition({ sym: S.set.sym, side: 'buy', lots: .5, dupOk: true });
        p.sl = Engine.quote(S.set.sym).bid * .9; changed('pos'); // stop far below the visible range: its zone runs off the price pane
        drawOverlay();
        const cv = document.getElementById('ovl'), g = cv.getContext('2d'), dpr = devicePixelRatio || 1, h0 = pricePaneH();
        const px = (x, y) => g.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data[3];
        const ts = chart.timeScale(), lx = ts.logicalToCoordinate(bars.length - 1), xs = [lx + 3, (lx + ts.width()) / 2];
        return { above: xs.map(x => px(x, h0 - 4)), below: xs.map(x => px(x, h0 + 20)), toPt: toPoint(200, h0 + 20), hit: hitDrawing(200, h0 + 20) };
      });
      t.ok(r.above.some(a => a > 0), 'SL zone painted inside the price pane: ' + r.above);
      t.deep(r.below, [0, 0], 'nothing painted in the RSI pane');
      t.eq(r.toPt, null, 'drawing points cannot be placed in the RSI pane');
      t.eq(r.hit, null, 'no drawing hit test in the RSI pane');
      t.noErrors(page);
    }
  },
  {
    name: 'L5 licence: TradingView logo on the main chart and NOTICE text with link in Help',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const h = document.getElementById('help');
        const a = h.querySelector('a[href="https://www.tradingview.com/"]');
        return { logo: chart.options().layout.attributionLogo, link: !!a, txt: h.textContent, rel: a?.rel || '' };
      });
      t.eq(r.logo, true, 'attribution logo on the main chart');
      t.ok(r.link, 'Help links to tradingview.com');
      t.ok(/TradingView Lightweight Charts™/.test(r.txt) && /Copyright \(c\) 2025 TradingView, Inc\./.test(r.txt), 'NOTICE text in Help');
      t.ok(/Apache License 2\.0/.test(r.txt), 'licence named');
      t.ok(/noopener/.test(r.rel), 'external link opens safely');
      t.noErrors(page);
    }
  },
  {
    name: 'L6 up/down colours come from one source and follow the theme',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        const read = () => ({ c: candle.options().upColor, d: candle.options().downColor, tok: chartUpDn() });
        const a = read(); S.set.theme = S.set.theme === 'dark' ? 'light' : 'dark'; applyTheme(); await new Promise(r => requestAnimationFrame(r));
        const b = read(); return { a, b, cssUp: cssv('--up'), cssDn: cssv('--dn') };
      });
      t.eq(r.a.c, r.a.tok.up, 'candle up colour = chartUpDn().up');
      t.eq(r.a.d, r.a.tok.dn, 'candle down colour = chartUpDn().dn');
      t.eq(r.b.tok.up, r.cssUp, 'chartUpDn reads --up');
      t.eq(r.b.tok.dn, r.cssDn, 'chartUpDn reads --dn');
      t.eq(r.b.c, r.b.tok.up, 'after theme switch, candles follow');
      t.noErrors(page);
    }
  }
];
