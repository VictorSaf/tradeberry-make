// Valul 1, v1-bt (.mace/design/wave1-honest-stats.md; decision 37): the honest backtest report. N in the DSR counts
// every try recorded in the account (any template, instrument, timeframe); costs are the account's (costModel of
// trade.js) or declared ones; Sharpe annualised on the bars observed per year; PBO counts logits <= 0; the Edge check
// has no look-ahead; the leverage label names the cap that binds; a plain-language verdict row.
// Expected values are worked out here (paper example, the sheet through costModel, the bar timestamps).
const lazy = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof runBacktest === 'function', null, { timeout: 30000 });
// the test runner's platform feed (T.feed) for syms, with the backtest history of `load` fetched, so a run is synchronous
const feed = (page, syms, load = syms) => page.evaluate(async ([syms, load]) => { T.feed(syms); for (const s of load) await btLoad(s, btCfg().hist || 8); }, [syms, load]);
const setUp = async page => {
  await page.evaluate(() => { T.reset(); S.set.lev = null; S.set.jur = 'eu'; S.set.comm = 0; });
  const cr = await page.evaluate(() => Engine.INSTR.find(m => isCrypto(m.sym)).sym);
  await feed(page, await page.evaluate(() => Engine.INSTR.map(m => m.sym)), ['EURUSD', 'GBPUSD', 'US.500', cr]);
};
const openBt = async page => {
  await page.evaluate(() => setTab('bt'));
  await page.waitForFunction(() => !!document.querySelector('#btCfg #btSym') && BT.res, null, { timeout: 30000 });
};

export const tests = [
  {
    name: 'VBT1 DSR of the Bailey & López de Prado (2014) example = 0.9004',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page);
      // N = 100 tries, annualised cross-try variance 1/2, best annualised SR 2.5, 1250 daily observations, skew −3, kurtosis 10
      const r = await page.evaluate(() => ({ dsr: btDSR(2.5 / Math.sqrt(250), 1250, -3, 10, 100, .5 / 250), sr0: btSR0(100, .5 / 250) * Math.sqrt(250) }));
      t.near(r.dsr, .9004, 'DSR', 0, 5e-4);
      t.near(r.sr0, Math.sqrt(.5) * ((1 - .5772156649) * 2.326348 + .5772156649 * 2.680210), 'SR0 annualised = √V × the expected-maximum factor', 1e-4);
      t.noErrors(page);
    }
  },
  {
    name: 'VBT2 N = every try in the account: ema on EURUSD/15, GBPUSD/15, EURUSD/60 → N = 3; "Run on all FX" records 38',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page); await openBt(page);
      const r = await page.evaluate(() => {
        const c = btCfg(); c.trials = []; applyTemplate('ema');
        const run = (sym, tf) => { c.sym = sym; c.tf = tf; renderBtConfig(); btRunAll(); return btHonest(BT.res).N; };
        const n = [run('EURUSD', 15), run('GBPUSD', 15), run('EURUSD', 60)];
        const txt = document.querySelector('#btHonest').innerText;
        c.trials = []; c.sym = 'EURUSD'; c.tf = 15; renderBtConfig();
        document.querySelector('#btAll').click();
        return { n, txt };
      });
      // the pairs' weeks before the live week are fetched one pair after another: wait for the table
      await page.waitForFunction(() => document.querySelectorAll('#allBody .all-tr').length === Engine.FX.length, null, { timeout: 60000 });
      Object.assign(r, await page.evaluate(() => ({ all: btTrials().length, fx: Engine.FX.length, rows: document.querySelectorAll('#allBody .all-tr').length, label: document.querySelector('#btAll').textContent, allTxt: document.querySelector('#allBody').innerText })));
      t.deep(r.n, [1, 2, 3], 'N grows across instruments and timeframes');
      t.ok(/\b3\b/.test(r.txt) && /account/i.test(r.txt), 'the report says 3 tries in the account: ' + r.txt.slice(0, 400));
      t.eq(r.fx, 38, '38 FX pairs in the catalog');
      t.eq(r.all, 38, 'running on all FX records 38 tries');
      t.eq(r.rows, 38, '38 rows in the all-pairs table');
      t.ok(/all FX/i.test(r.label) && !/G8/.test(r.label), 'button: run on all FX pairs: ' + r.label);
      t.ok(!/\b16\b/.test(r.allTxt.split('\n')[0]), 'the note does not speak of 16 pairs');
      t.noErrors(page);
    }
  },
  {
    name: 'VBT3 costMode "account" (default) = costModel: commission, swap at each rollover crossed, spread at the fill; "declared" uses the declared values',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      const r = await page.evaluate(() => {
        S.set.comm = 4; // the account's extra commission: part of the account's costs
        const out = { def: BT_DEF.costMode, hasComm: 'comm' in BT_DEF, cfgMode: btCfg().costMode };
        const one = (sym, over) => {
          const c = Object.assign(JSON.parse(JSON.stringify(BT_DEF)), { slip: 0, slK: 4, tf: 60 }, over), m = Engine.META[sym], q = Engine.usd(m.quote), cm = costModel(sym);
          const res = runBacktest(c, sym), byT = new Map(Engine.aggregate(sym, c.tf, 100000).map(b => [b.time, b]));
          return res.trades.map(x => {
            const d = x.side === 'buy' ? 1 : -1, gross = (x.xp - x.ep) * d * x.lots * m.size * q, b = byT.get(x.et);
            let swA = 0, nights = 0; for (let r = nextRollover(x.et, sym); r <= x.xt; r = nextRollover(r, sym)) { swA += cm.swapNight(x.side, x.lots, x.ep, r); nights += rolloverNights(r, sym); }
            return { side: x.side, lots: x.lots, comm: x.comm, swap: x.swap, net: gross - x.pnl, commA: cm.commRT(x.lots), swA, nights, sp: b && d > 0 ? x.ep - b.open : null, spA: cm.spreadAt(x.et), pip: m.pip };
          });
        };
        out.eu = one('EURUSD'); out.us = one('US.500', { tf: 15, slK: 2 });
        out.dec = one('EURUSD', { costMode: 'declared', dSpread: 1.5, dComm: 6, dSwapL: -2, dSwapS: -1 });
        return out;
      });
      t.eq(r.def, 'account', 'BT_DEF.costMode = account');
      t.eq(r.hasComm, false, 'BT_DEF has no commission of its own any more');
      t.eq(r.cfgMode, 'account', 'btCfg() defaults to the account costs');
      for (const [lab, L] of [['EURUSD', r.eu], ['US.500', r.us]]) {
        t.ok(L.length > 0, lab + ': trades');
        for (const x of L) {
          t.near(x.comm, x.commA, `${lab}: commission = costModel commRT(${x.lots})`, 1e-12, 1e-9);
          t.near(x.swap, x.swA, `${lab}: swap = Σ costModel swapNight over the rollovers crossed`, 1e-12, 1e-9);
          t.near(x.net, x.comm - x.swap, `${lab}: gross − net = commission − swap`, 1e-9, 1e-6);
          if (x.sp != null) t.near(x.sp, x.spA, `${lab}: buy fills at bid + costModel spreadAt`, 1e-9, 1e-12);
        }
      }
      t.ok(r.eu.some(x => x.comm > 0) && r.eu.every(x => Math.abs(x.comm - 4 * x.lots) < 1e-9), 'the account extra $4/lot is charged');
      t.ok(r.dec.length > 0, 'declared: trades');
      for (const x of r.dec) {
        t.near(x.comm, 6 * x.lots, 'declared commission $6/lot', 1e-12, 1e-9);
        t.near(x.swap, x.nights * (x.side === 'buy' ? -2 : -1) * x.lots, 'declared swap per lot a night × nights', 1e-12, 1e-9);
        if (x.sp != null) t.near(x.sp, 1.5 * x.pip, 'declared spread 1.5 pips', 1e-9, 1e-12);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'VBT4 swap ×3 over a Wednesday (FX), in both cost modes',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      const r = await page.evaluate(() => {
        const Z = s => Date.parse(s) / 1000, sym = 'EURUSD';
        const K = btCosts({ ...btCfg(), costMode: 'account' }, sym), D = btCosts({ ...btCfg(), costMode: 'declared', dSpread: 1, dComm: 0, dSwapL: -2, dSwapS: -1 }, sym);
        const cm = costModel(sym), tue = Z('2026-10-20T21:00:00Z');
        return {
          tue: K.swap(1, 1, 1.1, Z('2026-10-20T12:00:00Z'), Z('2026-10-21T12:00:00Z')), wed: K.swap(1, 1, 1.1, Z('2026-10-21T12:00:00Z'), Z('2026-10-22T12:00:00Z')),
          one: cm.swapNight('buy', 1, 1.1, tue), dTue: D.swap(1, 1, 1.1, Z('2026-10-20T12:00:00Z'), Z('2026-10-21T12:00:00Z')), dWed: D.swap(1, 1, 1.1, Z('2026-10-21T12:00:00Z'), Z('2026-10-22T12:00:00Z'))
        };
      });
      t.ok(r.one !== 0, 'EURUSD has a swap on the sheet');
      t.near(r.tue, r.one, 'Tuesday rollover: one night', 1e-12, 1e-12);
      t.near(r.wed, 3 * r.one, 'Wednesday rollover: three nights', 1e-12, 1e-12);
      t.near(r.dTue, -2, 'declared: one night', 1e-12, 1e-12);
      t.near(r.dWed, -6, 'declared: Wednesday triple', 1e-12, 1e-12);
      t.noErrors(page);
    }
  },
  {
    name: 'VBT5 Sharpe annualised on the bars observed per year (±1%), not on a 260- or 365-day calendar',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      const r = await page.evaluate(() => {
        const cr = Engine.INSTR.find(m => isCrypto(m.sym)).sym, out = {};
        for (const sym of ['EURUSD', cr, 'US.500']) {
          const c = Object.assign(JSON.parse(JSON.stringify(BT_DEF)), { tf: 15 }), res = runBacktest(c, sym), b = btBars(sym, 15, c.hist).bars;
          const from = b.findIndex(x => x.time === res.from), to = b.findIndex(x => x.time === res.to);
          const n = to - from + 1, span = (b[to].time + 900 - b[from].time) / (365.25 * 86400);
          const x = res.ret, mu = x.reduce((a, v) => a + v, 0) / x.length, sd = Math.sqrt(x.reduce((a, v) => a + (v - mu) ** 2, 0) / (x.length - 1));
          out[sym] = { n, nBars: res.nBars, want: n / span, got: res.stats.perYear, sharpe: res.stats.sharpe, sr: mu / sd };
        }
        out.cr = cr; return out;
      });
      for (const [k, v] of Object.entries(r)) {
        if (k === 'cr') continue;
        t.eq(v.n, v.nBars, k + ': bar count');
        t.near(v.got, v.want, k + ': perYear = bars / span in years', .01);
        t.near(v.sharpe, v.sr * Math.sqrt(v.got), k + ': Sharpe = per-bar SR × √perYear', 1e-9, 1e-12);
      }
      t.near(r[r.cr].got, 365.25 * 96, 'crypto 24/7: 96 bars a day all year', .01);
      t.ok(r.EURUSD.got < .8 * 365.25 * 96, 'FX: fewer bars a year (weekend closed): ' + r.EURUSD.got);
      t.ok(r['US.500'].got < r.EURUSD.got, 'an index session has fewer bars than FX');
      t.noErrors(page);
    }
  },
  {
    name: 'VBT6 PBO counts logits ≤ 0 (λ = 0 is not a win); the report says "at or below the median"',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page); await openBt(page);
      const r = await page.evaluate(() => {
        // 3 cells × 2 blocks, per-block Sharpe proportional to a: A (3, 2), B (1, 1), C (2, 3). The best cell on one
        // block lands exactly in the middle on the other in both splits: logit 0 every time
        const blk = a => [a + 1, a - 1, a + 1, a - 1].map(v => v / 100);
        const pb = btPBO([[blk(3), blk(2)], [blk(1), blk(1)], [blk(2), blk(3)]]);
        BT.pbo = { key: btKey(BT.res.cfg), x: 'emaF', y: 'emaS', pbo: .5, logit: 0, splits: 6, cells: 3, blocks: 2, clusters: 2 };
        renderHonest();
        const txt = document.querySelector('#btHonest').innerText; BT.pbo = null; renderHonest();
        return { pb, txt };
      });
      t.near(r.pb.logit, 0, 'median logit 0', 0, 1e-12);
      t.ok(r.pb.pbo >= .5, 'PBO with logit 0 on every split ≥ .5: ' + r.pb.pbo);
      t.ok(/at or below the median/.test(r.txt), 'report: at or below the median');
      t.ok(!/landed below the median/.test(r.txt), 'no "below the median" without "or at"');
      t.noErrors(page);
    }
  },
  {
    name: 'VBT7 Edge check scSignals has no look-ahead: a prefix of the bars gives the same signals',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page);
      const r = await page.evaluate(() => {
        const k = Engine.aggregate('EURUSD', 15, 700), full = scSignals(k).out, bad = [], fired = {};
        for (const s in full) fired[s] = full[s].filter(Boolean).length;
        for (const m of [150, 250, 350, k.length - 1]) {
          const part = scSignals(k.slice(0, m)).out;
          for (const s in full) for (let i = 0; i < m; i++) if (part[s][i] !== full[s][i]) { bad.push(`${s}@${i}/${m}`); break; }
        }
        return { n: k.length, bad, fired };
      });
      t.ok(r.n > 400, 'enough bars: ' + r.n);
      t.ok(r.fired.sqz > 0, 'the squeeze signal fires: ' + r.fired.sqz);
      t.deep(r.bad, [], 'every signal is prefix-invariant');
      t.noErrors(page);
    }
  },
  {
    name: 'VBT8 report: a plain-language verdict row, "illustrative" at most once, the leverage label names the cap that binds',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page); await openBt(page);
      const r = await page.evaluate(() => {
        const c = btCfg(); c.sym = 'EURUSD'; c.tf = 15; renderBtConfig(); btRunAll();
        const out = document.querySelector('#btOut'), v = document.querySelector('#btVerdict');
        const fx = { out: out.textContent, // the costs and sizing sit in a folded block: read as text, not as shown
           cfg: document.querySelector('#btCfg').innerText, verdict: v ? v.innerText : '', ill: (out.innerText.match(/illustrative/gi) || []).length, lev: BT.res.lev, levX: BT.res.levX };
        c.sym = 'US.500'; renderBtConfig(); btRunAll();
        const us = { out: document.querySelector('#btOut').textContent, cfg: document.querySelector('#btCfg').innerText, lev: BT.res.lev, levX: BT.res.levX };
        c.costMode = 'declared'; renderBtConfig(); const dec = { cfg: document.querySelector('#btCfg').innerText, inputs: ['#btDSp', '#btDComm', '#btDSwL', '#btDSwS'].map(s => !!document.querySelector(s)) };
        c.costMode = 'account'; renderBtConfig();
        return { fx, us, dec };
      });
      t.ok(r.fx.verdict.length > 30, 'verdict row present: ' + r.fx.verdict);
      t.ok(/^Verdict/i.test(r.fx.verdict), 'starts with "Verdict"');
      t.ok(/luck|edge/i.test(r.fx.verdict) && !/\b(DSR|PSR|PBO)\b/.test(r.fx.verdict.split('(')[0]), 'plain words first, statistics only in brackets: ' + r.fx.verdict);
      t.ok(r.fx.ill <= 1, '"illustrative" at most once: ' + r.fx.ill);
      t.deep([r.fx.lev, r.fx.levX], [30, 25], 'EURUSD EU retail: 1:30 leverage, 25× per-order cap binds');
      t.ok(/25× equity/.test(r.fx.out) && /1:30/.test(r.fx.out) && /per-order cap/.test(r.fx.out), 'report names the 25× cap and why: ' + r.fx.out.slice(0, 900));
      t.ok(/25× equity/.test(r.fx.cfg) && /per-order cap/.test(r.fx.cfg), 'config names the 25× cap');
      t.deep([r.us.lev, r.us.levX], [20, 20], 'US.500: 1:20 binds');
      t.ok(/20× equity/.test(r.us.out) && /1:20 leverage/.test(r.us.out), 'report: 20× equity from the 1:20 leverage');
      t.ok(/news/i.test(r.fx.cfg) && /not in the backtest/i.test(r.fx.cfg), 'news widening declared as not in the backtest');
      t.ok(/account/i.test(r.fx.cfg), 'config: account costs');
      t.deep(r.dec.inputs, [true, true, true, true], 'declared mode: spread, commission, swap long / short inputs');
      t.ok(/declared/i.test(r.dec.cfg), 'declared costs named');
      t.ok(!/\b(NaN|undefined|null)\b/.test(r.fx.out + r.fx.cfg + r.us.out + r.dec.cfg), 'no NaN/undefined/null');
      t.noErrors(page);
    }
  }
];
