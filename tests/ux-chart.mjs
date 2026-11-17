// UX test 09.11.2026 (Trade), the chart part: the next order's lines only while the ticket previews (F7), the position's
// line wins the grab over the ticket's at the same level and its release says what the account did (F16), no NaN in a
// chart label (F13), every Market watch row named for a screen reader (F17), the honest leverage text (F3).
const frame = page => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
// a buy EURUSD position whose stop sits exactly on the ticket's stop (buy, market, SL 20 pips)
const setup = page => page.evaluate(() => {
  T.reset(); setSymbol('EURUSD'); fullChart && fullChart(true);
  Object.assign(S.tk, { side: 'buy', ot: 'market', useSL: true, sl: 20, useTP: true, tp: 40, sm: 'lots', lots: .1 });
  const k = tkCalc();
  const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true, pmDone: true });
  p.sl = +k.sl.toFixed(5);
  changed('pos'); frame(true, true); T.clearToasts();
  return { id: p.id, sl: p.sl };
});

export const tests = [
  {
    name: 'UXC1 chart: the ticket lines show only while the ticket previews and say they are the next order',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await setup(page);
      await frame(page);
      const on = await page.evaluate(() => { window.tkPreviewActive = () => true; dirty.lines = true; frame(true); return lines.filter(L => L.kind.startsWith('tk-')).map(L => [L.kind, L.line.options().title]); });
      const sl = on.find(x => x[0] === 'tk-sl'), tp0 = on.find(x => x[0] === 'tk-tp');
      t.ok(sl && /^SL · after order −\$[\d,.]+$/.test(sl[1]), 'the ticket stop says after order: ' + (sl && sl[1]));
      // with the position open the ticket adds to it and keeps the position's (absent) target; flat, it draws its own
      const tp = tp0 || await page.evaluate(() => { S.positions = []; changed('pos'); frame(true); const L = lines.find(x => x.kind === 'tk-tp'); return L && ['tk-tp', L.line.options().title]; });
      t.ok(tp && /^TP · after order \+\$[\d,.]+$/.test(tp[1]), 'the ticket target says after order: ' + (tp && tp[1]));
      if (!tp0) await setup(page);
      const off = await page.evaluate(() => { window.tkPreviewActive = () => false; frame(true); return { tk: lines.filter(L => L.kind.startsWith('tk-')).length, pos: lines.filter(L => L.kind === 'pos-sl').map(L => L.line.options().title) }; });
      t.eq(off.tk, 0, 'no ticket line while the ticket does not preview');
      t.ok(off.pos.length === 1 && off.pos[0] === 'SL', 'the position stop stays, titled SL only (09.11.2026): ' + off.pos);
      const back = await page.evaluate(() => { window.tkPreviewActive = () => true; frame(true); return lines.filter(L => L.kind.startsWith('tk-')).length; });
      t.ok(back >= 1, 'the ticket previews again: its lines come back: ' + back);
      t.noErrors(page);
    }
  },
  {
    name: 'UXC2 chart: a position stop on the ticket stop: the grab takes the position, the release says where it moved',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const p = await setup(page);
      await frame(page);
      const r = await page.evaluate(sl => {
        window.tkPreviewActive = () => true; dirty.lines = true; frame(true); // the user works in the ticket (ticket.js tkPreviewActive)
        const a = lines.find(L => L.kind === 'pos-sl'), b = lines.find(L => L.kind === 'tk-sl');
        const y = candle.priceToCoordinate(sl);
        return { y, same: a && b && a.line.options().price === b.line.options().price, kind: y == null ? null : priceLineHit(y, false)?.kind, dbg: JSON.stringify({ y, h: pricePaneH(), L: lines.map(L => [L.kind, L.drag, candle.priceToCoordinate(L.line.options().price)]) }) };
      }, p.sl);
      t.ok(r.same, 'the two stops are on the same price');
      t.eq(r.kind, 'pos-sl', 'the hit-test picks the position stop ' + r.dbg);
      // drag it 20 px down with the mouse and release
      const g = await page.evaluate(sl => { const b = $('#chart').getBoundingClientRect(), y = candle.priceToCoordinate(sl); return { x: b.left + b.width * .5, y: b.top + y }; }, p.sl);
      await page.mouse.move(g.x, g.y); await page.mouse.down();
      t.eq(await page.evaluate(() => drag && drag.kind), 'pos-sl', 'the mouse holds the position stop');
      for (let i = 1; i <= 5; i++) await page.mouse.move(g.x, g.y + 4 * i);
      await page.mouse.up();
      const after = await page.evaluate(id => ({ sl: S.positions.find(x => x.id === id).sl, tk: S.tk.sl, toasts: T.toasts() }), p.id);
      t.ok(after.sl < p.sl, `the position stop moved down: ${p.sl} → ${after.sl}`);
      t.eq(after.tk, 20, 'the ticket stop is untouched');
      const ts = after.toasts.find(x => x.title.startsWith('SL #'));
      t.ok(ts && ts.title === `SL #${p.id} moved to ${after.sl.toFixed(5)}`, 'the release says where the stop went: ' + JSON.stringify(after.toasts));
      // a refusal says why: a stop above the bid
      await page.evaluate(() => T.clearToasts());
      const ref = await page.evaluate(id => { const r = modifyPosition(id, { sl: Engine.quote('EURUSD').bid + .001 }); return { r, toasts: T.toasts() }; }, p.id);
      t.ok(ref.r === false && ref.toasts.length >= 1 && !/moved to/.test(ref.toasts[0].title), 'a refused stop gives the reason: ' + JSON.stringify(ref.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'UXC3 chart: no label on the chart reads NaN (a size under the minimum, a risk that is not a number)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await setup(page);
      const r = await page.evaluate(() => {
        window.tkPreviewActive = () => true; // the user works in the ticket (ticket.js tkPreviewActive)
        S.tk.lots = .001; dirty.lines = true; frame(true);
        const a = lines.map(L => L.line.options().title);
        linesTick({ ...tkCalc(), riskUsd: NaN, rewUsd: NaN });
        const b = lines.map(L => L.line.options().title);
        linesTick({ ...tkCalc(), riskUsd: Infinity, rewUsd: undefined });
        return { a, b, c: lines.map(L => L.line.options().title) };
      });
      for (const k of ['a', 'b', 'c']) t.ok(!r[k].some(s => /NaN|Infinity|undefined/.test(s)), `no NaN in the line titles (${k}): ${JSON.stringify(r[k])}`);
      t.ok(r.b.some(s => s === 'SL · after order —'), 'a risk that is not a number reads —: ' + JSON.stringify(r.b));
      t.noErrors(page);
    }
  },
  {
    name: 'UXC4 Market watch: every row is a button named with its symbol, bid, ask and spread (from its content)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(() => { setSymbol('EURUSD'); frame(true); });
      await frame(page);
      const r = await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#wl .wl-row')], q = Engine.quote('EURUSD');
        const words = x => [...x.querySelectorAll(':scope > .wl-sym > [data-sr]')].map(e => e.dataset.sr).join();
        const bad = rows.filter(x => words(x) !== 'bid,ask,sp,chg,tm').map(x => x.dataset.sym);
        const eu = rows.find(x => x.dataset.sym === 'EURUSD').querySelector('[data-f=bid]');
        return { n: rows.length, bad, bidCell: eu.textContent, bid: fp('EURUSD', q.bid), ask: fp('EURUSD', q.ask), sp: q.spread.toFixed(1) };
      });
      t.ok(r.n > 0 && !r.bad.length, `every row says bid, ask, spread to a screen reader (${r.n} rows; without: ${r.bad.slice(0, 5)})`);
      t.eq(r.bidCell, r.bid, 'the bid cell keeps its own text');
      // the accessible name the browser computes
      const snap = await page.locator('#wl .wl-row[data-sym="EURUSD"]').ariaSnapshot();
      const m = snap.match(/button "([^"]*)"/), name = m ? m[1].replace(/\s+/g, ' ').replace(/ ,/g, ',') : snap;
      t.ok(name.startsWith(`EUR/USD, bid ${r.bid}, ask ${r.ask}, spread ${r.sp}, 24 h change `), 'EUR/USD row name: ' + name);
      t.noErrors(page);
    }
  },
  {
    name: 'UXC5 Specifications: leverage without a jurisdiction cap names the EU limit it is above',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const s = await page.evaluate(() => { T.reset(); S.set.jur = 'none'; S.set.lev = 0; const d = document.createElement('div'); d.innerHTML = instrCard('EURUSD'); return d.textContent; });
      t.ok(/1:\d+ \(sheet default; maximum 1:\d+\) · no EU limit \(ESMA caps major pairs at 1:30\)/.test(s), 'the leverage line says no EU limit and the ESMA cap');
      t.ok(!/no jurisdiction cap/.test(s), 'and no longer says no jurisdiction cap');
      t.noErrors(page);
    }
  },
  {
    name: 'UXC6 chart, live: a dragged stop says it moved only once the execution server confirms it',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const until = (fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms });
      const p0 = await page.evaluate(async () => {
        const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }); if (!p) return null;
        const q = Engine.quote('EURUSD'), lo = candle.coordinateToPrice(pricePaneH() - 10);
        const sl = +(lo != null && lo < q.bid ? q.bid - (q.bid - lo) * .5 : q.bid - 10 * M('EURUSD').pip).toFixed(5);
        return { id: p.id, ok: await modifyPosition(p.id, { sl }), sl };
      });
      t.ok(p0 && p0.ok, 'a position with a stop: ' + JSON.stringify(p0));
      await until(sl => S.positions[0] && S.positions[0].sl === sl, p0.sl);
      await page.evaluate(() => { T.clearToasts(); fullChart(true); dirty.lines = true; frame(true); });
      page.tl.hold();
      let g = null;
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(150);
        g = await page.evaluate(sl => { const r = $('#chart').getBoundingClientRect(), y = candle.priceToCoordinate(sl); return y == null ? null : { x: r.left + r.width * .5, y: r.top + y, y2: r.top + Math.min(y + 20, pricePaneH() - 2) }; }, p0.sl) || g;
        await page.mouse.move(g.x, g.y); await page.mouse.down();
        if (await page.evaluate(() => drag && drag.kind === 'pos-sl')) break;
        await page.mouse.up();
      }
      for (let i = 1; i <= 6; i++) await page.mouse.move(g.x, g.y + (g.y2 - g.y) * i / 6);
      await page.mouse.up();
      await until(() => lines.some(L => L.kind === 'pos-sl' && / · Sent$/.test(L.line.options().title)));
      t.ok(!(await page.evaluate(() => T.toasts())).some(x => /moved to/.test(x.title)), 'nothing says moved while the server has not answered');
      page.tl.release();
      await until(() => T.toasts().some(x => /^SL #\S+ moved to /.test(x.title)));
      const r = await page.evaluate(id => ({ sl: S.positions.find(p => p.id === id).sl, toasts: T.toasts() }), p0.id);
      t.ok(r.toasts.some(x => x.title === `SL #${p0.id} moved to ${r.sl.toFixed(5)}`), 'the confirmed stop is said: ' + JSON.stringify(r.toasts));
      t.noErrors(page);
    }
  }
];
