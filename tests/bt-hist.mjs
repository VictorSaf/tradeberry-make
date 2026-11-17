// Backtester review (24.10.2026, history on demand 02.11.2026): longer history (the platform's own 1-minute prices, fetched at Run), closed bars only, no ATR jump
// at a reopening, tabs that do not run (and add tries) by themselves, the verdict on top, the per-trade Sharpe.
const WED = new Date('2026-10-21T14:00:00Z');
const lazy = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof runBacktest === 'function', null, { timeout: 30000 });

export const tests = [
  {
    name: 'BTH1 history: 8 weeks of platform prices join the live week without duplicates; no modelled weeks left',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: WED }); await lazy(page);
      const r = await page.evaluate(async () => {
        T.feed(['EURUSD']);
        const c = { ...JSON.parse(JSON.stringify(BT_DEF)), tf: 60 };
        await btLoad('EURUSD', 8);
        const live = Engine.candles.EURUSD, H = btBars('EURUSD', 15, 8), ts = H.src.map(b => b.time);
        const n1 = runBacktest(c, 'EURUSD', { hist: 1 }).trades.length, n8 = runBacktest(c, 'EURUSD', { hist: 8 }).trades.length;
        return { why: H.why, first: ts[0], want: Engine.simTime - 56 * 86400, sorted: ts.every((x, i) => !i || x > ts[i - 1]),
          liveIn: live.every(b => ts.includes(b.time)), lastLive: ts[ts.length - 1] === live[live.length - 1].time,
          call: T.feedLog[0], l0: live[0].time, hc: typeof BT_HC, syn: typeof btSynth, n1, n8 };
      });
      t.eq(r.why, null, 'a full 8-week run');
      t.ok(Math.abs(r.first - r.want) <= 86400, `the first bar is within a day of now - 56 days (${((r.first - r.want) / 3600).toFixed(1)} h)`);
      t.ok(r.sorted, 'ascending, no duplicate minute where the history meets the live week');
      t.ok(r.liveIn && r.lastLive, 'the live week is all there, to its last bar');
      t.ok(r.call && r.call.res === 1 && r.call.to === r.l0, 'liveRange asked for 1-minute bars up to the first engine bar');
      t.eq(r.hc, 'undefined', 'no BT_HC'); t.eq(r.syn, 'undefined', 'no btSynth');
      t.ok(r.n8 > r.n1, `1H EMA crossover: ${r.n8} trades on 8 weeks vs ${r.n1} on the live week`);
      t.noErrors(page);
    }
  },
  {
    name: 'BTH1b without a feed the backtester says so and does not run',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: WED }); await lazy(page);
      await page.evaluate(() => { setView('lab', 'bt'); openBacktester(); });
      await page.waitForFunction(() => /has no live feed/.test(document.querySelector('#btOut')?.textContent || ''), null, { timeout: 15000 });
      const r = await page.evaluate(() => ({ res: BT.res, txt: document.querySelector('#btOut').textContent }));
      t.eq(r.res, null, 'no result');
      t.ok(/Backtests run on the platform's prices\. EUR\/USD has no live feed right now\./.test(r.txt), r.txt);
      t.noErrors(page);
    }
  },
  {
    name: 'BTH1c a platform history shorter than asked: the run covers what is there and says so',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: WED }); await lazy(page);
      await page.evaluate(() => { T.feed(['EURUSD'], { startAgo: 20 }); setView('lab', 'bt'); openBacktester(); });
      await page.waitForFunction(() => !!BT.res, null, { timeout: 30000 });
      const r = await page.evaluate(() => ({ hist: BT.res.cfg.hist, txt: document.querySelector('#btOut').textContent, days: (BT.res.histTo - BT.res.histFrom) / 86400 }));
      t.eq(r.hist, 8, '8 weeks asked');
      t.ok(/The platform has 1-minute EUR\/USD prices only from .+; this run covers \d+ days\./.test(r.txt), 'only from: ' + (r.txt.match(/The platform has[^.]*\./) || [''])[0]);
      t.ok(Math.abs(r.days - 20) < 1.5, `about 20 days (${r.days.toFixed(1)})`);
      t.noErrors(page);
    }
  },
  {
    name: 'BTH1d the platform history fails: Could not load, Retry runs',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: WED }); await lazy(page);
      await page.evaluate(() => { T.feed(['EURUSD'], { fail: 1 }); setView('lab', 'bt'); openBacktester(); });
      await page.waitForFunction(() => /Could not load/.test(document.querySelector('#btOut')?.textContent || ''), null, { timeout: 15000 });
      const r0 = await page.evaluate(() => ({ res: BT.res, txt: document.querySelector('#btOut').textContent }));
      t.eq(r0.res, null, 'no result after the failure');
      t.ok(/Could not load EUR\/USD history from the platform\./.test(r0.txt), r0.txt);
      await page.click('#btRetry');
      await page.waitForFunction(() => !!BT.res, null, { timeout: 30000 });
      t.ok(await page.evaluate(() => T.feedLog.length === 2), 'Retry asked again');
      t.noErrors(page);
    }
  },
  {
    name: 'BTH1e Run on all FX pairs after a failed load keeps the failure and Retry, never the older result as if current',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: WED }); await lazy(page);
      await page.evaluate(() => { T.feed(['EURUSD'], { fail: 1 }); btCfg().hist = 1; setView('lab', 'bt'); openBacktester(); });
      await page.waitForFunction(() => !!BT.res && BT.res.cfg.hist === 1, null, { timeout: 30000 });
      await page.selectOption('#btHist', '8');
      await page.click('#btAll');
      await page.waitForFunction(() => /Could not load/.test(document.querySelector('#btOut')?.textContent || ''), null, { timeout: 15000 });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ view: BT.view, all: BT.all, retry: !!document.querySelector('#btRetry'), hist: BT.res && BT.res.cfg.hist }));
      t.ok(r.retry, 'the failure and its Retry stay on screen');
      t.ok(r.view !== 'all' && !r.all, 'the all-pairs run did not start on the live-week result: view ' + r.view);
      t.noErrors(page);
    }
  },
  {
    name: 'BTH2 the bar still forming is not traded; the ATR of a bar after a closed market is its own range',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: 'run' }); await lazy(page);
      const r = await page.evaluate(() => {
        T.feed(['EURUSD']);
        const H = btBars('EURUSD', 15, 1), last = H.bars[H.bars.length - 1];
        // a closed market inside the bars: the true range after it ignores the jump from the last close
        const bars = [{ time: 0, open: 1, high: 1.001, low: .999, close: 1 }];
        for (let i = 1; i < 20; i++) bars.push({ time: i * 900, open: 1, high: 1.001, low: .999, close: 1 });
        bars.push({ time: 19 * 900 + 2 * 86400, open: 1.05, high: 1.0505, low: 1.0495, close: 1.05 });
        const X = btSeries(bars, { ...BT_DEF.p }, 15), Y = btSeries(bars, { ...BT_DEF.p }, 0);
        return { closed: last.time + 900 <= Engine.simTime, atrGap: X.atr[20], atrJump: Y.atr[20], atrPrev: X.atr[19] };
      });
      t.ok(r.closed, 'the last bar of a run is closed');
      t.ok(Math.abs(r.atrGap - r.atrPrev) < r.atrPrev * .1, `after the gap the ATR stays near ${r.atrPrev.toFixed(5)} (${r.atrGap.toFixed(5)})`);
      t.ok(r.atrJump > r.atrPrev * 2, 'counting the jump would have blown it up');
      t.noErrors(page);
    }
  },
  {
    name: 'BTH3 Optimizer, Walk-forward and All FX pairs run only on request: opening them adds no try; verdict on top, once; per-trade Sharpe; IS/OOS header named',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: WED }); await lazy(page);
      await page.evaluate(() => { T.feed(['EURUSD']); setView('lab', 'bt'); openBacktester(); });
      await page.waitForFunction(() => !!BT.res && document.querySelector('#btVerdict'), null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const n0 = btTrials().length, seen = {};
        for (const v of ['opt', 'wf', 'all']) { BT.view = v; renderBtView(); await new Promise(r => setTimeout(r, 300)); seen[v] = document.querySelector('#btView2').textContent; }
        BT.view = 'trades'; renderBtView();
        const out = document.querySelector('#btOut'), sh = [...out.querySelectorAll('.kpi')].find(k => /Sharpe/.test(k.textContent));
        return { n0, n1: btTrials().length, seen, verdicts: out.querySelectorAll('.wf-verdict').length + (out.textContent.match(/too few to trust/gi) || []).length,
          top: out.querySelector('#btVerdict').compareDocumentPosition(out.querySelector('.bt-kpis')) & Node.DOCUMENT_POSITION_FOLLOWING,
          sharpe: sh && sh.textContent, th: out.querySelector('.oos thead th')?.textContent, hist: document.querySelector('#btHist')?.value, head: out.querySelector('.bt-head').textContent };
      });
      t.eq(r.n1, r.n0, 'opening the three tabs adds no try');
      t.ok(/Not run yet/.test(r.seen.opt) && /cells, each one more try/.test(r.seen.opt), 'Optimizer says what running it adds');
      t.ok(/Not run yet/.test(r.seen.all), 'All FX pairs waits for the button');
      t.ok(!/Running/.test(r.seen.wf), 'Walk-forward does not start by itself');
      t.eq(r.verdicts, 1, 'one verdict, no duplicate banner');
      t.ok(r.top, 'the verdict sits above the KPIs');
      t.ok(/Sharpe per trade/.test(r.sharpe) && !/-\d/.test(r.sharpe), 'the KPI is the per-trade Sharpe, typographic minus: ' + r.sharpe);
      t.eq(r.th, 'Measure', 'the IS/OOS first header is named');
      t.eq(r.hist, '8', 'History defaults to 8 weeks');
      t.ok(/platform prices/.test(r.head) && !/modelled|simulat|zero drift/i.test(r.head), 'the head says platform prices, nothing modelled: ' + r.head);
      t.noErrors(page);
    }
  }
];
