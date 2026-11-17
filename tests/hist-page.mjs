// Back-paging of the main chart (spec istoric-la-cerere, histpage.js): scrolling left asks the platform's history one
// server window at a time. /api/history is the fake of tests/fixtures/hist-mock.mjs (a 1-minute bar every minute, no
// weekends); the instruments are made "fed" as in EM7b: a realTime adapter, liveHas overridden, feedHistory with the same bars.
import { mockHistory, barAt, WIN } from './fixtures/hist-mock.mjs';

const W1 = WIN[1], SYMS = ['EURUSD', 'GBPUSD'];
const hist = (from, to) => { const a = []; for (let t = from; t < to; t += 60) a.push(barAt(t)); return a; };
// the fixture's candle for one tf bucket (what the platform's 1-minute bars make of it)
const bucket = (t, tf) => { const h = hist(t, t + tf * 60); return { time: t, open: h[0].open, high: Math.max(...h.map(b => b.high)), low: Math.min(...h.map(b => b.low)), close: h[h.length - 1].close }; };
// app with EURUSD and GBPUSD fed with `days` of 1-minute bars ending `lag` minutes before now, starting 7 minutes into a
// 15-minute bucket (as the real boot history starts mid-bucket); the chart on tf
async function fed(app, opts = {}, { tf = 15, days = 3, lag = 0, start = 0 } = {}) {
  const page = await app();
  const now = Math.floor(Date.now() / 1000), end = Math.floor(now / 60) * 60 - lag * 60;
  const log = await mockHistory(page, { step: 60, now, ...opts });
  const h = hist(Math.floor((start || end - days * 86400) / 900) * 900 + 420, end + 60);
  await page.evaluate(([syms, h, tf]) => {
    Engine.setFeed({ realTime: true, has: s => syms.includes(s), onTicks: () => {}, alive: () => true });
    window.liveHas = s => syms.includes(s);
    for (const s of syms) Engine.feedHistory(s, h);
    S.set.type = 'candles'; S.set.tf = tf; setSymbol('EURUSD');
  }, [SYMS, h, tf]);
  await page.waitForTimeout(100);
  return { page, log, now, end };
}
const snap = page => page.evaluate(() => {
  const d = candle.data(), r = chart.timeScale().getVisibleLogicalRange();
  return { n: bars.length, first: bars[0].time, times: d.map(b => b.time), asc: d.every((b, i) => !i || b.time > d[i - 1].time), r, right: bars[Math.floor(r.to)] && bars[Math.floor(r.to)].time, state: histPager.state };
});
const scrollLeft = (page, from = 5) => page.evaluate(f => chart.timeScale().setVisibleLogicalRange({ from: f, to: f + 160 }), from);
// the chart applies a view change on its next frame: wait one out before reading the range
const loaded = (page, n) => page.waitForFunction(n => bars.length > n && histPager.state === 'idle', n, { timeout: 10000 }).then(() => page.waitForTimeout(100));
const settle = page => page.waitForFunction(() => histPager.state !== 'loading', null, { timeout: 10000 });
const label = page => page.evaluate(() => { const l = document.querySelector('.hp-lbl'); return l && !l.hidden ? l.textContent.trim() : ''; });

export const tests = [
  {
    name: 'HP1 chart paging: scrolling left adds older candles (ascending, unique, no missing bucket at the seam), the candle at the right of the view stays',
    async run({ t, app }) {
      const { page, log } = await fed(app);
      const a = await snap(page);
      t.eq(log.reqs.length, 0, 'drawing the chart asks nothing');
      const r0 = await page.evaluate(() => bars[165].time); await scrollLeft(page);
      await loaded(page, a.n);
      const b = await snap(page);
      t.ok(b.first < a.first, `first time went back: ${a.first} -> ${b.first}`);
      t.ok(b.asc, 'ascending'); t.eq(new Set(b.times).size, b.times.length, 'unique');
      t.ok(b.times.every((x, i) => !i || x - b.times[i - 1] === 900), 'every 15-minute bucket, none missing (the seam included)');
      t.eq(b.right, r0, 'the candle at the right edge of the view is the same');
      const seam = await page.evaluate(t => { const b = bars.find(x => x.time === t), d = candle.data().find(x => x.time === t); return { b, d }; }, a.first);
      t.deep(seam.b, bucket(a.first, 15), 'the seam candle is the whole bucket from the platform, not the engine\'s partial one');
      t.deep([seam.d.open, seam.d.high, seam.d.low, seam.d.close], [seam.b.open, seam.b.high, seam.b.low, seam.b.close], 'and that is the candle drawn');
      t.ok(log.reqs.length >= 1 && log.reqs.every(q => q.p === 'bg' && q.res === '1' && q.sym === 'EURUSD'), 'one window of 1-minute bars: ' + JSON.stringify(log.reqs));
      await page.evaluate(() => fullChart(false)); const c = await snap(page);
      t.ok(c.n === b.n && c.first === b.first, 'a redraw keeps the older candles');
      t.noErrors(page);
    }
  },
  {
    name: 'HP2 chart paging: at the start of the platform history the label says so and scrolling asks nothing more',
    async run({ t, app }) {
      const nowS = Math.floor(Date.now() / 1000), first = Math.floor((nowS - 1) / W1) * W1 - W1; // history: the current window and the one before
      const { page, log } = await fed(app, { empty: w => w.from < first });
      for (let i = 0; i < 12 && (await page.evaluate(() => histPager.state)) !== 'start'; i++) { await scrollLeft(page); await page.waitForTimeout(60); await settle(page); }
      t.eq(await page.evaluate(() => histPager.state), 'start', 'state start');
      t.eq(await label(page), 'Start of platform history', 'label');
      t.eq(await page.evaluate(() => bars[0].time), first, 'every candle the platform has is drawn');
      const n = log.reqs.length; await scrollLeft(page, 2); await page.waitForTimeout(400);
      t.eq(log.reqs.length, n, 'no request after the start');
      t.noErrors(page);
    }
  },
  {
    name: 'HP3 chart paging: a 503 shows "Older prices unavailable" with Retry, nothing is asked until Retry, Retry loads and clears the label',
    async run({ t, app }) {
      const { page, log } = await fed(app, { fail503: () => true });
      const a = await snap(page);
      await scrollLeft(page); await page.waitForTimeout(60); await settle(page);
      t.eq(await page.evaluate(() => histPager.state), 'failed', 'state failed');
      t.ok((await label(page)).startsWith('Older prices unavailable'), 'label: ' + await label(page));
      t.eq(await page.evaluate(() => { const b = document.querySelector('.hp-lbl button'); return b && b.offsetWidth > 0 ? b.textContent : JSON.stringify(document.querySelector('.hp-lbl').outerHTML); }), 'Retry', 'Retry button');
      const n = log.reqs.length; await scrollLeft(page, 3); await page.waitForTimeout(400);
      t.eq(log.reqs.length, n, 'no request while failed');
      t.eq((await snap(page)).n, a.n, 'nothing glued');
      await page.click('.hp-lbl button');
      await loaded(page, a.n);
      t.ok(log.reqs.length > n, 'Retry asked again'); t.eq(await label(page), '', 'label gone');
      t.noErrors(page);
    }
  },
  {
    name: 'HP4 chart paging: switching instrument while a page is in the air glues nothing on the new instrument',
    async run({ t, app }) {
      const { page, log } = await fed(app, { delay: () => 500 });
      await scrollLeft(page);
      await page.waitForFunction(() => histPager.state === 'loading', null, { timeout: 5000 });
      await page.evaluate(() => setSymbol('GBPUSD'));
      await page.waitForTimeout(900);
      const r = await page.evaluate(() => ({ n: bars.length, agg: Engine.aggregate('GBPUSD', 15, 2200).length, first: bars[0].time, a0: Engine.aggregate('GBPUSD', 15, 2200)[0].time, buf: histPager.older().length, state: histPager.state, sym: S.set.sym }));
      t.eq(r.sym, 'GBPUSD', 'on GBPUSD');
      t.ok(r.n === r.agg && r.first === r.a0 && r.buf === 0, 'only GBPUSD\'s own candles: ' + JSON.stringify(r));
      t.eq(r.state, 'idle', 'state idle');
      t.ok(log.reqs.every(q => q.sym === 'EURUSD'), 'nothing asked for GBPUSD');
      t.noErrors(page);
    }
  },
  {
    name: 'HP5 chart paging: nothing is asked in a replay or in intrinsic time; in Heikin-Ashi the older candles are transformed',
    async run({ t, app }) {
      const { page, log } = await fed(app);
      await page.evaluate(() => { RP.state = 'open'; });
      await scrollLeft(page); await page.waitForTimeout(400);
      t.eq(log.reqs.length, 0, 'replay: no request');
      await page.evaluate(() => { RP.state = 'idle'; S.set.type = 'it'; fullChart(true); });
      await page.waitForTimeout(100); await scrollLeft(page, 2); await page.waitForTimeout(400);
      t.eq(log.reqs.length, 0, 'intrinsic time: no request');
      const n = await page.evaluate(() => { S.set.type = 'ha'; fullChart(true); return bars.length; });
      await page.waitForTimeout(100); await scrollLeft(page); // a fit's own range change is not a scroll: wait it out
      await loaded(page, n);
      const r = await page.evaluate(n => {
        const k = bars.length - n, d = candle.data(), c4 = b => (b.open + b.high + b.low + b.close) / 4, e = (a, b) => Math.abs(a - b) < 1e-9;
        let ok = e(d[0].open, (bars[0].open + bars[0].close) / 2) && e(d[0].close, c4(bars[0]));
        for (let i = 1; i <= k; i++) ok = ok && e(d[i].close, c4(bars[i])) && e(d[i].open, (d[i - 1].open + d[i - 1].close) / 2);
        return { k, ok, raw: e(d[1].close, bars[1].close) };
      }, n);
      t.ok(r.k > 0 && r.ok, 'older candles drawn as Heikin-Ashi: ' + JSON.stringify(r));
      t.ok(!r.raw, 'not the raw candles');
      t.noErrors(page);
    }
  },
  {
    name: 'HP6 chart paging: the rebuild at BARS_MAX + BARS_SLACK keeps the older candles, closes the seam without asking, keeps the view',
    async run({ t, app }) {
      const { page, log, end } = await fed(app, {}, { tf: 1, lag: 300 });
      const n0 = await page.evaluate(() => bars.length);
      await scrollLeft(page);
      await loaded(page, n0);
      const a = await snap(page), asked = log.reqs.length;
      await page.evaluate(h => Engine.feedHistory('EURUSD', h), hist(end - 3 * 86400, end + 301 * 60)); // 300 newer minutes: the series passes the cap
      await page.waitForFunction(t => bars[bars.length - 1].time >= t, end + 300 * 60, { timeout: 5000 });
      await page.waitForTimeout(300);
      const b = await snap(page);
      t.eq(b.first, a.first, 'the older candles stay');
      t.ok(b.times.every((x, i) => !i || x - b.times[i - 1] === 60), 'no missing minute at the seam');
      t.eq(b.right, a.right, 'the view stays on the same candles');
      t.eq(log.reqs.length, asked, 'the seam was closed from the chart\'s own candles');
      t.noErrors(page);
    }
  },
  {
    name: 'HP7 chart paging: at the buffer cap (20,000 candles below 1H) the label says the chart limit is reached and scrolling asks nothing more',
    async run({ t, app }) {
      const { page, log } = await fed(app, {}, { tf: 1 });
      for (let i = 0; i < 6 && (await page.evaluate(() => histPager.state)) !== 'limit'; i++) { await scrollLeft(page); await page.waitForTimeout(60); await settle(page); await page.waitForTimeout(60); }
      t.eq(await page.evaluate(() => histPager.state), 'limit', 'state limit');
      t.eq(await page.evaluate(() => histPager.older().length), 20000, 'the buffer at the cap');
      const n = log.reqs.length; await scrollLeft(page, 2); await page.waitForTimeout(400); // back at the left edge, where the label lives
      t.eq(log.reqs.length, n, 'no request at the limit');
      t.eq(await label(page), 'Chart limit reached — use a higher timeframe for older prices', 'label');
      t.eq(await page.evaluate(() => document.querySelectorAll('.hp-lbl button').length), 0, 'no Retry');
      await page.evaluate(() => setTF(5)); await page.waitForTimeout(100);
      t.ok((await page.evaluate(() => histPager.state)) === 'idle' && await label(page) === '', 'a new timeframe clears it');
      t.noErrors(page);
    }
  },
  {
    name: 'HP8 chart paging: a seam the chart cannot close is asked again; while it is missing or failed the older candles stay drawn and the failure shows with Retry wherever the view is',
    async run({ t, app }) {
      // the engine's history starts a day before the current server window: the first page reads the window before it only
      const nowS = Math.floor(Date.now() / 1000), cw = Math.floor((nowS - 1) / W1) * W1, gate = { block: false };
      const { page, log, end } = await fed(app, { fail503: w => gate.block && w.from === cw, failAlways: true }, { start: cw - 86400 });
      const n0 = await page.evaluate(() => bars.length);
      await scrollLeft(page); await loaded(page, n0);
      const first = await page.evaluate(() => bars[0].time);
      t.ok(log.reqs.every(q => q.from < cw), 'the current window was not read yet');
      gate.block = true;
      // the engine's history now starts inside the current window and the chart forgets what it drew: only the platform can close the seam
      await page.evaluate(h => { Engine.feedHistory('EURUSD', h); bars = bars.slice(-5); fullChart(false); chart.timeScale().setVisibleLogicalRange({ from: bars.length - 160, to: bars.length + 8 }); }, hist(cw + 900 + 420, end + 60));
      await page.waitForFunction(() => histPager.state === 'failed', null, { timeout: 10000 });
      t.eq(await page.evaluate(() => bars[0].time), first, 'the older candles stay drawn');
      t.ok((await label(page)).startsWith('Older prices unavailable'), 'failed label away from the left edge: ' + await label(page));
      const n1 = await page.evaluate(() => bars.length);
      gate.block = false;
      await page.click('.hp-lbl button'); await loaded(page, n1);
      const b = await snap(page);
      t.ok(b.first === first && b.times.every((x, i) => !i || x - b.times[i - 1] === 900), 'Retry closes the seam: every bucket, none missing');
      t.eq(await label(page), '', 'label gone');
      t.noErrors(page);
    }
  },
  {
    name: 'HP9 multi-chart paging: two panes on the same instrument and timeframe share one series of requests and the same older candles; another instrument asks for its own',
    async run({ t, app }) {
      const { page, log } = await fed(app);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(async () => {
        setLayout('4'); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        MC.panes[0].cfg.sym = 'EURUSD'; MC.panes[1].cfg.sym = 'EURUSD'; MC.panes[2].cfg.sym = 'GBPUSD';
        MC.panes.forEach(p => { p.cfg.tf = 15; mcFull(p, true); });
      });
      await page.waitForTimeout(200);
      t.eq(log.reqs.length, 0, 'drawing the panes asks nothing');
      const n0 = await page.evaluate(() => MC.panes.map(p => p.bars.length));
      const left = i => page.evaluate(i => { const p = MC.panes[i]; p.chart.timeScale().setVisibleLogicalRange({ from: 5, to: 165 }); }, i);
      const done = i => page.waitForFunction(([i, n]) => MC.panes[i].bars.length > n && MC.panes[i].pager.state === 'idle', [i, n0[i]], { timeout: 10000 }).then(() => page.waitForTimeout(100));
      await left(0); await done(0);
      const r0 = log.reqs.length;
      t.ok(r0 >= 1 && log.reqs.every(q => q.sym === 'EURUSD' && q.res === '1'), 'pane 0 asked 1-minute windows of EURUSD: ' + JSON.stringify(log.reqs));
      await left(1); await done(1);
      t.eq(log.reqs.length, r0, 'pane 1 (same instrument and timeframe) asked nothing more');
      const s = await page.evaluate(() => MC.panes.slice(0, 2).map(p => { const d = p.candle.data(); return { first: p.bars[0].time, n: p.bars.length, asc: d.every((b, i) => !i || b.time > d[i - 1].time), step: p.bars.every((b, i) => !i || b.time - p.bars[i - 1].time === 900) }; }));
      t.deep(s[0], s[1], 'the same older candles in both: ' + JSON.stringify(s));
      t.ok(s[0].asc && s[0].step, 'ascending, every bucket');
      t.ok(s[0].first < await page.evaluate(() => Engine.aggregate('EURUSD', 15, 900)[0].time), 'older than the engine\'s own');
      await left(2); await done(2);
      t.ok(log.reqs.length > r0 && log.reqs.slice(r0).every(q => q.sym === 'GBPUSD'), 'GBPUSD asked its own windows');
      t.eq(await page.evaluate(() => MC.panes[2].bars[0].time < Engine.aggregate('GBPUSD', 15, 900)[0].time), true, 'and drew them');
      t.noErrors(page);
    }  }
];
