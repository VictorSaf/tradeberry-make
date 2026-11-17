// Backtester on the instrument catalog (v15, task c7; v1-bt: account costs = costModel): every cost comes from the sheet (spread Default /
// Night in points, swap in points or % a year, commission none) plus the account extra commission (S.set.comm); size
// within equity x effective leverage and the sheet's volume step / min / max; fixed stops in the instrument's own unit;
// fills only while the market is open. Expected values are worked out here from the sheet (Engine.META[sym].p), not
// read back from bt.js: commission and swap from gross minus net P&L, spread from the fill against the bar's bid open.
const lazy = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof runBacktest === 'function', null, { timeout: 30000 });
// the test runner's platform feed (T.feed) for syms, with the backtest history of `load` fetched, so a run is synchronous
const feed = (page, syms, load = syms) => page.evaluate(async ([syms, load]) => { T.feed(syms); for (const s of load) await btLoad(s, btCfg().hist || 8); }, [syms, load]);
// run one backtest in the page with the default settings plus `over`; per trade: lots, notional, commission, swap,
// equity before the trade, stop distance in the instrument's unit, the spread paid at entry, both times
async function bt(page, sym, over = {}) {
  return page.evaluate(([sym, over]) => {
    // the cost checks read the live engine's bars: the live week only (hist 1), no simulated weeks before it
    const c = Object.assign(JSON.parse(JSON.stringify(BT_DEF)), { hist: 1 }, over), m = Engine.META[sym], q = Engine.usd(m.quote), P = m.p;
    const res = runBacktest(c, sym), bars = Engine.aggregate(sym, c.tf, 100000), byT = new Map(bars.map(b => [b.time, b]));
    // the sheet's spread at t in price: Night 23:00–01:00 server time Monday to Friday, Default otherwise
    const night = t => { const l = t + Engine.serverOffset(t) * 3600, dow = ((Math.floor(l / 86400) + 4) % 7 + 7) % 7, mn = Math.floor((l % 86400) / 60); return dow >= 1 && dow <= 5 && (mn >= 1380 || mn < 60); };
    const sp = t => P.spread[night(t) ? 1 : 0] * m.point;
    // swap a night on `lots` at the entry price, from the sheet's unit
    const perNight = (side, lots, px) => { const v = P.swap[side === 'buy' ? 0 : 1]; return P.swap[2] === 'pts' ? v * m.point * m.size * lots * q : lots * m.size * px * q * v / 360; };
    const nights = (a, b) => { let n = 0; for (let r = nextRollover(a, sym); r <= b; r = nextRollover(r, sym)) n += rolloverNights(r, sym); return n; };
    let eq = 100000;
    const tr = res.trades.map(x => {
      const d = x.side === 'buy' ? 1 : -1, gross = (x.xp - x.ep) * d * x.lots * m.size * q, b = byT.get(x.et);
      const swapWant = nights(x.et, x.xt) * perNight(x.side, x.lots, x.ep);
      const row = {
        side: x.side, lots: x.lots, notional: x.lots * m.size * x.ep * q, cost: gross - x.pnl, swap: x.swap, swapWant, eq, et: x.et, xt: x.xt, reason: x.reason,
        stopPts: Math.abs(x.ep - x.stop0) / m.pip, entrySp: b ? (d > 0 ? x.ep - b.open - c.slip * m.pip : null) : NaN, spWant: sp(x.et),
        steps: x.lots / P.vol[2], openE: Engine.isOpen(sym, x.et), openX: Engine.isOpen(sym, x.xt - 1) || Engine.isOpen(sym, x.xt)
      };
      eq += x.pnl; return row;
    });
    return { tr, lev: effLev(sym), spread: m.spread, vol: P.vol, comm: P.comm, capped: res.capped, sized: res.sized, slFixPts: res.slFixPts };
  }, [sym, over]);
}
const setUp = async page => { await page.evaluate(() => { T.reset(); S.set.lev = null; S.set.jur = 'eu'; }); await feed(page, ['EURUSD', 'GOLD', 'US.500']); };

export const tests = [
  {
    name: 'PBT1 US.500 default backtest: commission from the sheet (none), extra $/lot when set, size on the sheet step within equity x 1:20',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      const r = await bt(page, 'US.500');
      t.ok(r.tr.length > 0, 'US.500: trades');
      t.eq(r.lev, 20, 'EU retail: 1:20 on a major index (sheet 1:100)');
      t.eq(r.comm, 0, 'the sheet charges no commission');
      for (const x of r.tr) {
        t.near(x.cost, -x.swap, `no commission by default, only the swap: cost ${x.cost} vs swap ${x.swap}`, 1e-9, 1e-6);
        t.ok(x.notional <= x.eq * r.lev * (1 + 1e-9), `notional $${x.notional.toFixed(0)} ≤ equity $${x.eq.toFixed(0)} x ${r.lev}`);
        t.ok(Math.abs(x.steps - Math.round(x.steps)) < 1e-6 && x.lots >= r.vol[0] - 1e-9 && x.lots <= r.vol[1] + 1e-9, `size on the sheet's ${r.vol[2]} step within [${r.vol[0]}, ${r.vol[1]}]: ${x.lots}`);
      }
      // v1-bt: the account's extra commission (Settings) is part of the account costs; a declared one replaces it
      await page.evaluate(() => { S.set.comm = 3; });
      const e = await bt(page, 'US.500');
      t.ok(e.tr.length > 0, 'trades with the account extra commission');
      for (const x of e.tr) t.near(x.cost + x.swap, 3 * x.lots, `account extra $3 per lot: ${x.cost + x.swap} on ${x.lots} lots`, 1e-9, 1e-6);
      await page.evaluate(() => { S.set.comm = 0; });
      const d = await bt(page, 'US.500', { costMode: 'declared', dComm: 5, dSpread: 0 });
      t.ok(d.tr.length > 0, 'trades with declared costs');
      for (const x of d.tr) t.near(x.cost + x.swap, 5 * x.lots, `declared $5 per lot: ${x.cost + x.swap} on ${x.lots} lots`, 1e-9, 1e-6);
      t.noErrors(page);
    }
  },
  {
    name: 'PBT2 GOLD fixed stop in points: a per-instrument default well above the 225-pt spread; EURUSD keeps 20 pips and no commission',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      const r = await bt(page, 'GOLD', { slMode: 'pips' });
      t.ok(r.tr.length > 0, 'GOLD: trades');
      t.ok(r.slFixPts > 4 * r.spread, `default fixed stop ${r.slFixPts} pt is not inside the ${r.spread}-pt spread`);
      for (const x of r.tr) {
        t.near(x.stopPts, r.slFixPts, 'every GOLD stop at the default distance', 1e-6);
        t.ok(x.notional <= x.eq * r.lev * (1 + 1e-9), `notional $${x.notional.toFixed(0)} ≤ equity x ${r.lev}`);
        t.ok(x.lots < 10, `plausible gold size for 1% of $100k: ${x.lots} lots`);
      }
      const f = await bt(page, 'EURUSD', { slMode: 'pips' });
      t.ok(f.tr.length > 0, 'EURUSD: trades');
      for (const x of f.tr) {
        t.near(x.stopPts, 20, 'EURUSD fixed stop stays 20 pips', 1e-6);
        t.near(x.cost, -x.swap, 'EURUSD: no commission on the sheet, only the swap', 1e-9, 1e-6);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'PBT3 leverage cap binds on GOLD at 5% risk: sizes capped at 1:20 and the report says so; a tight stop is warned about the spread',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      await page.evaluate(() => setTab('bt'));
      await page.waitForFunction(() => !!document.querySelector('#btCfg #btSym'), null, { timeout: 30000 });
      const r = await bt(page, 'GOLD', { slMode: 'pips', slPts: { GOLD: 1000 }, risk: 5 });
      t.ok(r.tr.length > 0, 'GOLD: trades');
      t.ok(r.capped > 0, `some sizes capped: ${r.capped} of ${r.sized}`);
      for (const x of r.tr) {
        t.ok(x.notional <= x.eq * r.lev * (1 + 1e-9), `notional $${x.notional.toFixed(0)} ≤ equity $${x.eq.toFixed(0)} x ${r.lev}`);
        t.ok(x.lots < 10, `no 50-lot gold trade: ${x.lots}`);
      }
      // the same through the UI: the report names the cap; the config states the sheet's costs; a 300-pt stop is
      // within 2x the 225-pt spread
      const ui = await page.evaluate(() => {
        const c = btCfg(); c.sym = 'GOLD'; c.slMode = 'pips'; c.slPts = { GOLD: 1000 }; c.risk = 5; renderBtConfig(); btRunAll();
        const cfg = document.querySelector('#btCfg').innerText, out = document.querySelector('#btOut').innerText;
        c.slPts = { GOLD: 300 }; c.risk = 1; renderBtConfig(); btRunAll();
        const tight = document.querySelector('#btOut').innerText, tightCfg = document.querySelector('#btCfg').innerText;
        c.sym = 'US.500'; renderBtConfig(); const us = document.querySelector('#btCfg').innerText;
        c.sym = 'EURUSD'; renderBtConfig(); const fx = document.querySelector('#btCfg').innerText;
        return { cfg, out, tight, tightCfg, us, fx };
      });
      t.ok(/leverage/i.test(ui.out) && /1:20/.test(ui.out) && /capped/i.test(ui.out), 'report says the leverage cap limited the size');
      t.ok(/spread/i.test(ui.tight) && /within 2×/.test(ui.tight), 'report warns that the stop is close to the spread');
      t.ok(/instrument sheet/i.test(ui.us) && /no commission|none/i.test(ui.us), 'config: commission from the instrument sheet (none)');
      t.ok(!/% of notional|illustrative/i.test(ui.us + ui.cfg), 'no invented % of notional commission any more');
      t.ok(/Stop \(points\)/.test(ui.cfg), 'non-FX fixed stop in points');
      t.ok(!/Extra commission/.test(ui.fx) && /Account costs/.test(ui.fx), 'no backtester commission of its own: the account costs');
      t.ok(/swap/i.test(ui.us) && /night/i.test(ui.us), 'config names the sheet swap and the night spread');
      t.ok(!/\b(NaN|undefined|null)\b/.test(ui.out + ui.cfg + ui.us + ui.fx + ui.tight), 'no NaN/undefined/null in the backtester');
      t.noErrors(page);
    }
  },
  {
    name: 'PBT4 sheet spread (Default / Night) at entry, swap per rollover from the sheet, fills only while the market is open',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await lazy(page); await setUp(page);
      // EURUSD 1H, no slippage: buys pay the spread of their entry minute; positions held over 17:00 New York pay the swap
      const f = await bt(page, 'EURUSD', { tf: 60, slip: 0, slK: 4 });
      const buys = f.tr.filter(x => x.side === 'buy' && x.entrySp != null);
      t.ok(buys.length > 0, 'EURUSD buys');
      for (const x of buys) t.near(x.entrySp, x.spWant, `buy at ${new Date(x.et * 1000).toISOString()}: ask − bid = the sheet spread`, 1e-6, 1e-9);
      const held = f.tr.filter(x => x.swapWant !== 0);
      t.ok(held.length > 0, 'some trades are held over a rollover');
      for (const x of f.tr) t.near(x.swap, x.swapWant, `swap = nights x the sheet's points: ${x.swap} vs ${x.swapWant}`, 1e-9, 1e-6);
      t.ok(held.every(x => x.swap < 0), 'EURUSD swap is negative both ways on the sheet');
      // US.500 trades only inside its session: entries and exits at times its market is open
      const u = await bt(page, 'US.500', { tf: 15 });
      t.ok(u.tr.length > 0, 'US.500: trades');
      for (const x of u.tr) {
        t.ok(x.openE, `entry ${new Date(x.et * 1000).toISOString()} while the market is open`);
        if (x.reason !== 'End of data') t.ok(x.openX, `exit (${x.reason}) ${new Date(x.xt * 1000).toISOString()} while the market is open`);
        t.near(x.swap, x.swapWant, 'US.500 swap: % a year of the notional / 360 a night', 1e-9, 1e-6);
      }
      t.noErrors(page);
    }
  }
];
