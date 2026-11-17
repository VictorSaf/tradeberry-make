// Baskets: the money and execution errors of the Observatory review (24.10.2026, section 9) and the disaster stop.
// Each test reproduces the scenario measured in the review. The clock is pinned on a weekday (Fri 16.10 10:30 UTC,
// FX open) unless the test is about the closed market (the default clock: today is Saturday). The market is frozen
// (speed 0: fills at the quote) and the index is moved with Engine.jump on whole currencies.
const ready = async page => {
  await page.evaluate(() => loadLazy());
  await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof bkCfg === 'function', null, { timeout: 30000 });
  await page.evaluate(() => { T.reset(); S.bkPos = []; S.bkOrders = []; S.bkAlerts = []; S.bkHist = []; const c = bkCfg(); c.bkMode = 'risk'; c.bkRisk = .5; c.bkSl = 'auto'; c.bkTp = 'auto'; c.bkTrail = 0; c.bkBe = 0; c.bkEntry = 'market'; });
};
// draw the basket view on the Trade panel and wait for the chart
const show = async (page, sel = 'dxy') => page.evaluate(async sel => {
  const c = bkCfg(); c.bkSel = sel; c.bkPane = 'tr'; obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
  for (let k = 0; k < 40 && !(BK.series && document.querySelector('#bkChart')); k++) await new Promise(r => setTimeout(r, 50));
}, sel);
// shift the index of a basket by x (log units): its long side currencies move by x (USD alone on the long side: USD
// moves, i.e. every other currency by −x); the presets used here hold no USD next to another long currency
const MOVE = `window.bkMoveIdx = (g, x) => { const L = bkNorm(g.long); if (L.USD === 1) { Engine.jump('USD', x); return; } for (const k of Object.keys(L)) Engine.jump(k, x); };`;

export const tests = [
  {
    name: 'BKF1 snapshot: deleting or editing a custom basket, or "Chart my exposure", does not move an open group, a pending order or an alert',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const c = bkCfg();
        c.baskets.push({ id: 'c1', name: 'Mine', long: { EUR: 1 }, short: { USD: 1, JPY: 1 } });
        c.bkSel = 'c1';
        const b = bkGet('c1'), sz = bkSize(b, c, bkVol(b));
        bkExec(b, 'buy', sz, null, []);
        const g = S.bkPos[0], mv0 = bkGroupState(g).mv;
        bkPlace(b, 'sell', sz, null, [], 'limit', 30);
        S.bkAlerts.push(bkAlertRow(b, 20));
        // edit: the definition flips to a different index
        c.baskets[c.baskets.length - 1].long = { JPY: 1 }; c.baskets[c.baskets.length - 1].short = { EUR: 1, GBP: 1 };
        bkMonitor();
        const afterEdit = { open: S.bkPos.length, mv: bkGroupState(g).mv, ord: S.bkOrders.length, al: S.bkAlerts.length };
        // delete: bkGet would fall back on the DXY
        c.baskets = c.baskets.filter(x => x.id !== 'c1');
        bkMonitor();
        const afterDel = { open: S.bkPos.length, mv: bkGroupState(g).mv, ord: S.bkOrders.length, al: S.bkAlerts.length, hist: S.bkHist.length, ordTxt: bkOrdTxt(S.bkOrders[0]) };
        // "Chart my exposure" overwrites the myexp definition: a group opened on myexp keeps its own composition
        c.baskets.push({ id: 'myexp', name: 'My exposure', long: { GBP: 1 }, short: { USD: 1 } });
        const bx = bkGet('myexp'); bkExec(bx, 'buy', bkSize(bx, c, bkVol(bx)), null, []);
        const gx = S.bkPos.find(x => x.bid === 'myexp'), mx0 = bkGroupState(gx).mv;
        obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
        document.querySelector('[data-bk-exp]').click();
        bkMonitor();
        const afterExp = { open: S.bkPos.length, mv: bkGroupState(gx).mv, def: JSON.stringify(bkGet('myexp').long) };
        return { mv0, mx0, afterEdit, afterDel, afterExp, snap: [g.long, g.short] };
      });
      t.deep(r.snap, [{ EUR: 1 }, { USD: .5, JPY: .5 }], 'the group keeps the normalised weights it was opened with');
      t.eq(r.afterEdit.open, 2 - 1, 'edit: the group stays open');
      t.near(r.afterEdit.mv, r.mv0, 'edit: the group move is unchanged', 1e-9, 1e-6);
      t.eq(r.afterEdit.ord, 1, 'edit: the pending order does not trigger'); t.eq(r.afterEdit.al, 1, 'edit: the alert does not fire');
      t.eq(r.afterDel.open, 1, 'delete: the group stays open (no false "Basket stop")'); t.eq(r.afterDel.hist, 0, 'nothing in the basket record');
      t.near(r.afterDel.mv, r.mv0, 'delete: the group move is unchanged', 1e-9, 1e-6);
      t.eq(r.afterDel.ord, 1, 'delete: the pending order does not trigger'); t.eq(r.afterDel.al, 1, 'delete: the alert does not fire');
      t.ok(/to go/.test(r.afterDel.ordTxt), 'the order line still reads on its snapshot: ' + r.afterDel.ordTxt);
      t.eq(r.afterExp.open, 2, 'Chart my exposure: both groups stay open');
      t.near(r.afterExp.mv, r.mx0, 'Chart my exposure: the myexp group move is unchanged', 1e-9, 1e-6);
      t.noErrors(page);
    }
  },
  {
    name: 'BKF1b a group saved without a snapshot falls back on its definition; with the definition gone it is never closed automatically',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.evaluate(MOVE);
      const r = await page.evaluate(() => {
        const b = bkGet('dxy'), sz = bkSize(b, bkCfg(), bkVol(b));
        bkExec(b, 'buy', sz, null, []);
        const g = S.bkPos[0]; delete g.long; delete g.short; g.bid = 'gone'; g.legs = undefined;
        bkMoveIdx(bkGet('dxy'), -(g.sl + 20) / 1e4);
        bkMonitor(); bkMonitor();
        obsCfg().view = 'bask'; bkCfg().bkPane = 'tr'; setTab('obs'); renderObs(); obsDraw();
        return { open: S.bkPos.length, legs: S.positions.filter(p => p.bgid === g.gid).length, txt: bkStopTxt(g), html: document.querySelector('[data-bkg-st]')?.textContent || '' };
      });
      t.eq(r.open, 1, 'the group is not closed'); t.ok(r.legs > 0, 'its legs stay open');
      t.ok(/suspended/i.test(r.txt) && /deleted/i.test(r.txt), 'the stop line says why: ' + r.txt);
      t.ok(/suspended/i.test(r.html), 'and the panel shows it');
      t.noErrors(page);
    }
  },
  {
    name: 'BKF2 risk includes the entry cost: Risk % sizes on stop + spreads, the loss at the stop matches the risk shown, R:R is net',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.evaluate(MOVE);
      const r = await page.evaluate(() => {
        const out = {};
        for (const id of ['dxy', 'bloc']) {
          T.reset(); S.bkPos = []; S.bkHist = [];
          const b = bkGet(id), c = bkCfg(), sz = bkSize(b, c, bkVol(b)), eq = account().eq;
          bkExec(b, 'buy', sz, null, []);
          const g = S.bkPos[0];
          bkMoveIdx(b, -(sz.sl + .5) / 1e4); bkMonitor();
          out[id] = { risk: sz.risk, pct: sz.pct, bare: sz.lots * 1e5 * sz.sl / 1e4, cost: sz.cost, loss: -S.bkHist[0]?.pnl, eq, gCost: g.cost, closed: !S.bkPos.length, reason: S.bkHist[0]?.reason };
        }
        T.reset(); S.bkPos = []; S.bkHist = [];
        bkCfg().bkSel = 'bloc'; bkCfg().bkPane = 'tr'; obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
        out.txt = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        return out;
      });
      for (const id of ['dxy', 'bloc']) {
        const x = r[id];
        t.ok(x.cost > 0 && x.risk > x.bare, `${id}: risk includes the cost (${x.risk.toFixed(0)} > ${x.bare.toFixed(0)})`);
        t.near(x.risk, x.bare + x.cost, `${id}: risk = notional × stop + cost`, 1e-6, .01);
        t.ok(x.pct <= .5 + 1e-6 && x.pct > .45, `${id}: sized on 0.5% of equity with the cost: ${x.pct}`);
        t.ok(x.closed && x.reason === 'Basket stop', `${id}: closed by the stop`);
        t.ok(Math.abs(x.loss - x.risk) / x.risk < .1, `${id}: realised loss ${x.loss.toFixed(0)} within 10% of the risk shown ${x.risk.toFixed(0)}`);
        t.ok(x.gCost > 0, `${id}: the group keeps its entry cost in bp`);
      }
      t.ok(/net/i.test(r.txt) && /reward/i.test(r.txt), 'the R:R line is net of costs: ' + r.txt.slice(0, 400));
      t.noErrors(page);
    }
  },
  {
    name: 'BKF3 a close that cannot complete keeps the group as "close pending", writes nothing to the record and retries',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const b = bkGet('dxy'); bkExec(b, 'buy', bkSize(b, bkCfg(), bkVol(b)), null, []);
        const g = S.bkPos[0], legs = S.positions.filter(p => p.bgid === g.gid), stuck = legs[1].id;
        const orig = window.closePosition;
        window.closePosition = function (id, reason, frac) { if (id === stuck) return; return orig(id, reason, frac); };
        bkCloseGroup(g.gid);
        bkMonitor();
        const mid = { open: S.bkPos.length, state: bkStopTxt(S.bkPos[0] || {}), hist: S.bkHist.length, left: S.positions.filter(p => p.bgid === g.gid).length, closing: g.closing };
        window.closePosition = orig;
        BK.retry = {}; bkMonitor();
        return { mid, end: { open: S.bkPos.length, hist: S.bkHist.length, left: S.positions.length, pnl: S.bkHist[0]?.pnl, sum: S.history.reduce((a, h) => a + h.pnl, 0), reason: S.bkHist[0]?.reason } };
      });
      t.eq(r.mid.open, 1, 'the group stays while a leg is open'); t.eq(r.mid.left, 1, 'one leg left'); t.eq(r.mid.hist, 0, 'nothing in the record yet');
      t.ok(/close pending/i.test(r.mid.state), 'the group says "close pending": ' + r.mid.state);
      t.eq(r.end.open, 0, 'the retry closes the rest'); t.eq(r.end.left, 0, 'no leg left'); t.eq(r.end.hist, 1, 'one record, written once');
      t.near(r.end.pnl, r.end.sum, 'the record holds the P&L of every leg', 1e-9, 1e-6);
      t.eq(r.end.reason, 'Basket close', 'with the original reason');
      t.noErrors(page);
    }
  },
  {
    name: 'BKF4 Risk % without a stop: Buy/Sell disabled with "a stop is needed to size on risk", nothing opens',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(async () => {
        const c = bkCfg(); c.bkSl = 0; c.bkLots = 15;
        c.bkSel = 'dxy'; c.bkPane = 'tr'; obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
        const btns = [...document.querySelectorAll('[data-bk-trade]')].map(b => b.disabled);
        const txt = document.querySelector('.bk-pn:not([hidden])').textContent;
        bkTrade('buy');
        return { btns, need: /a stop is needed to size on risk/.test(txt), open: S.positions.length + S.bkPos.length };
      });
      t.deep(r.btns, [true, true], 'both buttons disabled'); t.ok(r.need, 'the reason is shown'); t.eq(r.open, 0, 'nothing opened');
      t.noErrors(page);
    }
  },
  {
    name: 'BKF5 partial fill rolls back; a leg closed by hand splits the group into single positions',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const b = bkGet('dxy'), sz = bkSize(b, bkCfg(), bkVol(b)), legs = bkLegs(b, sz.lots, 'buy');
        const orig = window.openPosition; let k = 0;
        window.openPosition = function (o) { if (o.bgid && ++k === 3) { toast('Order rejected', 'x', 'dn'); return null; } return orig(o); };
        T.clearToasts(); bkExec(b, 'buy', sz, null, []);
        window.openPosition = orig;
        const roll = { pos: S.positions.length, groups: S.bkPos.length, hist: S.bkHist.length, closed: S.history.length, toast: T.toasts().map(x => x.title + ' | ' + x.body).join(' || '), n: legs.length };
        // a full basket, then one leg closed from the dock
        bkExec(b, 'buy', sz, null, []);
        const g = S.bkPos[0], gl = S.positions.filter(p => p.bgid === g.gid);
        T.clearToasts(); closePosition(gl[0].id, 'Manual'); bkMonitor();
        return { roll, split: { groups: S.bkPos.length, left: S.positions.length, bgid: S.positions.filter(p => p.bgid).length, sl: S.positions.every(p => p.sl != null), n: gl.length, hist: S.bkHist.length,
          toast: T.toasts().map(x => x.title + ' | ' + x.body).join(' || ') } };
      });
      t.eq(r.roll.pos, 0, 'rollback: no leg left open'); t.eq(r.roll.groups, 0, 'no group'); t.eq(r.roll.closed, r.roll.n - 1, 'the filled legs (all but the third) were closed');
      t.ok(r.roll.toast.includes(`Not opened: ${r.roll.n - 1} of ${r.roll.n} legs filled, the filled legs were closed`), 'rollback toast: ' + r.roll.toast);
      t.eq(r.split.groups, 0, 'split: the group is gone'); t.eq(r.split.left, r.split.n - 1, 'the other legs stay open'); t.eq(r.split.bgid, 0, 'as single positions');
      t.ok(r.split.sl, 'each keeps its disaster stop'); t.eq(r.split.hist, 0, 'no partial result in the basket record');
      t.ok(/single positions/i.test(r.split.toast), 'the toast says so: ' + r.split.toast);
      t.noErrors(page);
    }
  },
  {
    name: 'BKF6 break-even: disabled until the move pays the costs, then the stop sits at +cost and closes as "Break-even"',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.evaluate(MOVE);
      await show(page);
      const r = await page.evaluate(() => {
        const b = bkGet('dxy'); bkExec(b, 'buy', bkSize(b, bkCfg(), bkVol(b)), null, []); obsDraw();
        const g = S.bkPos[0], btn = () => document.querySelector(`[data-bk-be="${g.gid}"]`);
        const out = { cost: g.cost, dis0: btn().disabled, tip: btn().getAttribute('data-tip') || btn().title };
        btn().click(); out.beAfterDisabledClick = !!g.beSet;
        bkMoveIdx(b, (g.cost + 5) / 1e4); bkMonitor(); obsDraw();
        out.dis1 = btn().disabled; btn().click(); out.beSet = !!g.beSet; out.stop = bkStopMv(g);
        bkMoveIdx(b, -5.1 / 1e4); bkMonitor();
        out.closed = !S.bkPos.length; out.reason = S.bkHist[0]?.reason; out.pnl = S.bkHist[0]?.pnl; out.notional = g.lots * 1e5;
        return out;
      });
      t.ok(r.cost > 0, 'entry cost in bp: ' + r.cost);
      t.ok(r.dis0, 'BE disabled at the open (move ≤ cost)'); t.ok(!r.beAfterDisabledClick, 'a click does nothing');
      t.ok(/spread/i.test(r.tip) && /paid/i.test(r.tip), 'tooltip says the spreads are already paid: ' + r.tip);
      t.ok(!r.dis1, 'enabled once the move is above the cost'); t.ok(r.beSet, 'BE set');
      t.near(r.stop, r.cost, 'the stop sits at +cost on the index', 1e-9, 1e-9);
      t.ok(r.closed, 'closed when the index came back'); t.eq(r.reason, 'Break-even', 'reason "Break-even"');
      t.ok(Math.abs(r.pnl) < r.notional * 1e-4, `about flat at break-even, the spreads included: ${r.pnl.toFixed(2)} on ${r.notional}`);
      t.noErrors(page);
    }
  },
  {
    name: 'BKF7+8 one data path: 3D KPI shows a value, header = last candle = the base of the stop/target levels, header updates on tick',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.evaluate(MOVE);
      await show(page);
      const r = await page.evaluate(() => {
        // the boot may switch to its own tab after the lazy tools load: bkTick only runs on the Observatory
        if (activeTab !== 'obs') { setTab('obs'); renderObs(); obsDraw(); }
        const kp = [...document.querySelectorAll('.bk .obs-kpis .kpi, .bk .obs-kpis > *')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        const head = () => +document.querySelector('[data-bk-idx]').textContent;
        const last = () => { const d = BK.series.data(); return d[d.length - 1].close; };
        const out = { kp, len: Engine.candles.EURUSD.length, h0: head(), c0: last(), prev: BK.prev && BK.prev.buy.sl, sl: bkSize(bkGet('dxy'), bkCfg(), bkVol(bkGet('dxy'))).sl };
        bkMoveIdx(bkGet('dxy'), 30 / 1e4); bkTick();
        out.h1 = head(); out.c1 = last(); out.prev1 = BK.prev && BK.prev.buy.sl;
        out.lv = document.querySelector('.bk-lv')?.textContent || '';
        return out;
      });
      const d3 = r.kp.find(x => /3D/.test(x)) || '';
      t.ok(r.len >= 4321 && d3 && !/—/.test(d3), '3D KPI has a value: ' + d3);
      t.near(r.h0, r.c0, 'header = last candle of the chart', 0, 6e-4);
      t.near(r.prev, r.h0 * Math.exp(-r.sl / 1e4), 'buy stop level from the same base', 0, 2e-3);
      t.ok(r.h1 > r.h0 + .2, `header updates on tick (${r.h0} → ${r.h1})`);
      t.near(r.h1, r.c1, 'still the last candle', 0, 6e-4);
      t.near(r.prev1, r.c1 * Math.exp(-r.sl / 1e4), 'levels follow the same base on tick', 0, 2e-3);
      t.ok(r.lv.includes(r.prev1.toFixed(3)), 'level text updated: ' + r.lv);
      t.noErrors(page);
    }
  },
  {
    name: 'BKF9 closed market (Saturday): market buttons disabled with the opening time, "Not filled" toast, pending orders allowed',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-17T12:00:00Z') }); // a Saturday: FX closed whatever day the suite runs
      await ready(page);
      await show(page);
      const r = await page.evaluate(() => {
        const open = mktState('EURUSD').open;
        const pane = () => document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        const btns = [...document.querySelectorAll('[data-bk-trade]')].map(b => b.disabled), txt = pane(), lab = mktState('EURUSD').label;
        T.clearToasts(); const b = bkGet('dxy'); bkExec(b, 'buy', bkSize(b, bkCfg(), bkVol(b)), null, []);
        const toasts = T.toasts().map(x => x.title + ' | ' + x.body).join(' || '), groups = S.bkPos.length;
        bkCfg().bkEntry = 'limit'; obsDraw();
        const pb = [...document.querySelectorAll('[data-bk-trade]')].map(b => b.disabled), ptxt = pane();
        bkTrade('buy');
        return { open, btns, txt, lab, toasts, groups, pb, ptxt, ord: S.bkOrders.length };
      });
      t.ok(!r.open, 'the clock is on a closed FX market');
      t.deep(r.btns, [true, true], 'market buttons disabled'); t.ok(r.lab && r.txt.includes(r.lab), 'the panel shows ' + r.lab);
      t.ok(/Not filled/.test(r.toasts) && !/Bought/.test(r.toasts), 'toast "Not filled": ' + r.toasts); t.eq(r.groups, 0, 'no group');
      t.deep(r.pb, [false, false], 'pending entries allowed'); t.ok(/fills at the reopening gap/.test(r.ptxt), 'with the note');
      t.eq(r.ord, 1, 'the pending order is placed');
      t.noErrors(page);
    }
  },
  {
    name: 'BKF10 the data window comes from EUR/USD, not the symbol on the main chart',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const b = bkGet('riskon'), c = bkCfg();
        const a = { vol: bkVol(b), sz: bkSize(b, c, bkVol(b)).sl };
        const cfd = Object.keys(Engine.candles).filter(s => M(s) && M(s).kind === 'cfd').sort((x, y) => Engine.candles[x].length - Engine.candles[y].length)[0];
        // a short history on the charted instrument (a CFD with few sessions): cut it to 500 bars for the check
        S.set.sym = cfd; const arr = Engine.candles[cfd], cut = arr.splice(0, Math.max(0, arr.length - 500));
        const z = { vol: bkVol(b), sz: bkSize(b, c, bkVol(b)).sl }, n = arr.length;
        obsCfg().view = 'bask'; c.bkSel = 'riskon'; setTab('obs'); renderObs(); obsDraw();
        const d3 = [...document.querySelectorAll('.bk .obs-kpis .kpi')].map(x => x.textContent).find(x => /3D/.test(x));
        arr.unshift(...cut);
        return { a, z, cfd, n, fx: Engine.candles.EURUSD.length, d3 };
      });
      t.ok(r.n !== r.fx, `the CFD ${r.cfd} has another history length (${r.n} vs ${r.fx})`);
      t.near(r.z.vol, r.a.vol, 'volatility unchanged', 1e-12, 1e-15); t.eq(r.z.sz, r.a.sz, 'auto stop unchanged');
      t.ok(r.d3 && !/—/.test(r.d3), '3D KPI still computed on the EUR/USD window: ' + r.d3);
      t.noErrors(page);
    }
  },
  {
    name: 'BKF11 ½ is refused when a leg would be cut more than ±20% away from half; a normal size halves every leg',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const b = bkGet('dxy'), c = bkCfg(); c.bkMode = 'lots'; c.bkLots = .1;
        bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        const g = S.bkPos[0], before = S.positions.map(p => p.lots).join();
        T.clearToasts(); bkHalf(g.gid);
        const small = { same: S.positions.map(p => p.lots).join() === before, lots: g.lots, toast: T.toasts().map(x => x.title + ' | ' + x.body).join(' || ') };
        bkCloseGroup(g.gid);
        c.bkLots = 2; bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        const g2 = S.bkPos[0], l0 = S.positions.filter(p => p.bgid === g2.gid).map(p => p.lots);
        bkHalf(g2.gid);
        const l1 = S.positions.filter(p => p.bgid === g2.gid).map(p => p.lots);
        bkMonitor();
        return { small, l0, l1, open: S.bkPos.length, glots: g2.lots };
      });
      t.ok(r.small.same, 'small size: no leg touched'); t.eq(r.small.lots, .1, 'group size unchanged');
      t.ok(/½|half/i.test(r.small.toast) && /20%/.test(r.small.toast), 'refusal toast: ' + r.small.toast);
      t.ok(r.l1.every((x, i) => Math.abs(x / r.l0[i] - .5) <= .1 + 1e-9), `normal size halves each leg: ${r.l0} → ${r.l1}`);
      t.eq(r.open, 1, 'the halved group is still one group (no split)'); t.near(r.glots, 1, 'group size ≈ halved: it follows the legs left after the round-down close (UX 09.11 round 2)', .05);
      t.noErrors(page);
    }
  },
  {
    name: 'BKF12 disaster stop: each leg carries an SL at 3 × the basket stop from its entry; none without a basket stop; the ticket says so',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page, 'riskon');
      const r = await page.evaluate(() => {
        const b = bkGet('riskon'), c = bkCfg(), sz = bkSize(b, c, bkVol(b));
        bkExec(b, 'sell', sz, null, []);
        const g = S.bkPos[0], legs = S.positions.filter(p => p.bgid === g.gid).map(p => { const q = Engine.quote(p.sym); return { d: p.side === 'buy' ? 1 : -1, rel: (p.entry - p.sl) / p.entry, sl: p.sl, sp: 3 * (q.ask - q.bid) / p.entry }; });
        const txt = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        bkCloseGroup(g.gid);
        c.bkMode = 'lots'; c.bkLots = 1; c.bkSl = 0; bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        return { sl: sz.sl, legs, txt, none: S.positions.every(p => p.sl == null), n: S.positions.length };
      });
      t.ok(r.legs.length >= 4, 'legs open: ' + r.legs.length);
      // 3 × the basket stop, never closer than 3 spreads of the leg (so a tight basket stop cannot sit inside a spread)
      for (const l of r.legs) t.near(l.d * l.rel, Math.max(3 * r.sl / 1e4, l.sp), 'leg SL at 3 × stop (at least 3 spreads) on the losing side', .01, 1e-7);
      t.ok(r.txt.includes('Basket stop is managed by this tab; each leg also carries a wide disaster stop.'), 'ticket text');
      t.ok(r.n > 0 && r.none, 'no basket stop: no disaster stop');
      t.noErrors(page);
    }
  }
];
