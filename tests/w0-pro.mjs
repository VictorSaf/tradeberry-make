// Wave 0 · pro.js: the coach reads the one trade model (tradesOf / netPnl / REVENGE_MIN) and gives no verdict on tiny
// groups; the depth ladder says its sizes are illustrative, speaks the instrument's unit and respects One-click.
// Frozen market (speed 0).
// a closed history row (newest first in S.history); open / close in sim seconds
const ROW = `(o) => Object.assign({ sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, pips: 0, r: 1, comm: 0, swap: 0, reason: 'Manual', note: '', setup: '', ctx: [], news: [] }, o)`;
const TUE_FX = new Date('2026-10-20T10:00:00Z'); // Tuesday: FX and GOLD open, US stocks closed (13:35–19:55 UTC)
export const tests = [
  {
    name: 'W0P1 coach: partial closes are one trade, P&L is net of commission, no hold-time verdict at n=2',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(ROW => {
        T.reset(); const row = eval(ROW), t0 = Engine.simTime - 86400 * 3, H = 3600;
        // one position closed in 3 parts: still only one trade, so the coach waits for 2 more
        S.history = [row({ id: 1, pnl: 10, open: t0, close: t0 + 300 }), row({ id: 1, pnl: 10, open: t0, close: t0 + 200 }), row({ id: 1, pnl: 10, open: t0, close: t0 + 100 })];
        const parts = coachInsights().map(x => x.t).join(' | ');
        // 2 winners held 5 minutes, 2 losers held 5 hours: a 60x gap, but n=2 per group is not evidence
        S.history = [
          row({ id: 4, pnl: -50, open: t0 + 4 * H * 6, close: t0 + 4 * H * 6 + 5 * H }), row({ id: 3, pnl: -50, open: t0 + 3 * H * 6, close: t0 + 3 * H * 6 + 5 * H }),
          row({ id: 2, pnl: 40, open: t0 + 2 * H * 6, close: t0 + 2 * H * 6 + 300 }), row({ id: 1, pnl: 40, open: t0 + H * 6, close: t0 + H * 6 + 300 })];
        const small = coachInsights().map(x => x.t).join(' | ');
        // the same shape at n=10 per group does get the verdict
        const big = [];
        for (let i = 0; i < 20; i++) { const o = t0 + i * H * 6, win = i % 2 === 0; big.unshift(row({ id: 10 + i, pnl: win ? 40 : -50, open: o, close: o + (win ? 300 : 5 * H) })); }
        S.history = big; const many = coachInsights().map(x => x.t).join(' | ');
        // commission: +$5 gross with $8 commission is a loss (3 trades, all gross winners, all net losers)
        S.history = [3, 2, 1].map(i => row({ id: i, pnl: 5, comm: 8, r: null, open: t0 + i * H * 6, close: t0 + i * H * 6 + 600 }));
        const comm = coachInsights().map(x => x.t).join(' | ');
        // revenge: an entry 7 minutes after a losing close counts (REVENGE_MIN = 10), 12 minutes does not
        const rv = gap => { S.history = [row({ id: 3, pnl: -20, open: t0 + 2 * H + gap, close: t0 + 3 * H }), row({ id: 2, pnl: -20, open: t0 + H + gap, close: t0 + 2 * H }), row({ id: 1, pnl: -20, open: t0, close: t0 + H })]; return coachInsights().map(x => x.t).join(' | '); };
        return { parts, small, many, comm, rv7: rv(7 * 60), rv12: rv(12 * 60), rmin: REVENGE_MIN };
      }, ROW);
      t.ok(/Close 2 more trades/.test(r.parts), 'a position in 3 parts is 1 trade: ' + r.parts);
      t.ok(!/hold losers|let winners run/.test(r.small), 'no hold-time verdict at n=2: ' + r.small);
      t.ok(/You hold losers/.test(r.many), 'hold-time verdict at n=10 per group: ' + r.many);
      t.ok(/3 of 3 trades had no stop loss \(net −\$9\.00\)/.test(r.comm), 'no-stop line is net of commission: ' + r.comm);
      t.ok(new RegExp(`2 trades were opened within ${r.rmin} minutes of a loss`).test(r.rv7), 'revenge window = REVENGE_MIN: ' + r.rv7);
      t.ok(!/opened within/.test(r.rv12), 'outside the window: no revenge line: ' + r.rv12);
      t.noErrors(page);
    }
  },
  {
    name: 'W0P2 depth ladder: labelled illustrative, spread and step in the instrument unit, centre at the true midpoint, One-click off only fills in the ticket',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset(); S.set.oneClick = false; Object.assign(S.tk, { ot: 'market', price: null, side: 'buy', sm: 'lots', lots: .5 }); renderDom();
        const ill = document.getElementById('domIll'), sprFx = document.getElementById('domSpr').textContent, q0 = Engine.quote('EURUSD');
        const pick = side => [...document.querySelectorAll(`#dom .dom-row.${side}`)].find(x => x.dataset.price);
        const row = pick('bid'), px = +row.dataset.price;
        domClick({ target: row, shiftKey: false });
        const off = { orders: S.orders.length, positions: S.positions.length, ot: S.tk.ot, side: S.tk.side, price: S.tk.price, field: document.getElementById('tkPrice').value, toasts: T.toasts().map(x => x.title) };
        const ask = pick('ask'); domClick({ target: ask, shiftKey: true });
        const shift = { orders: S.orders.length, ot: S.tk.ot, side: S.tk.side, price: S.tk.price, want: +ask.dataset.price };
        // One-click on: the order goes out at the clicked level, sized as the ticket would size that order
        S.set.oneClick = true; Object.assign(S.tk, { ot: 'market', price: null, sm: 'risk', risk: 1, useSL: true, sl: 20 });
        const want = tkCalc().lots; const row2 = pick('bid'); domClick({ target: row2, shiftKey: false });
        const on = S.orders[0] && { ot: S.orders[0].ot, side: S.orders[0].side, price: S.orders[0].price, lots: S.orders[0].lots, want, px: +row2.dataset.price, tkOt: S.tk.ot };
        S.orders = []; S.set.oneClick = false;
        setSymbol('GOLD'); renderDom(); const sprCfd = document.getElementById('domSpr').textContent;
        const bids = [...document.querySelectorAll('#dom .dom-row.bid')].map(x => +x.dataset.price).slice(0, 3), stepTxt = [...document.querySelectorAll('#domStep button')].map(b => b.textContent);
        const sz = [...document.querySelectorAll('#dom .dom-row.bid .bq em')].map(e => e.textContent)[0];
        return { ill: ill && ill.textContent, illVisible: !!(ill && !ill.hidden && getComputedStyle(ill).display !== 'none' && getComputedStyle(ill).visibility !== 'hidden'), sprFx, midFx: ((q0.bid + q0.ask) / 2).toFixed(6), sprCfd, bids, stepTxt, sz, px, off, shift, on };
      });
      t.eq(r.ill, 'Illustrative depth — fills ignore size', 'visible label text'); t.ok(r.illVisible, 'label is visible');
      t.ok(/^spread [\d.]+ pip · mid [\d.]+$/.test(r.sprFx), 'FX spread in pips: ' + r.sprFx);
      t.ok(r.sprFx.endsWith('mid ' + r.midFx), `mid = (bid + ask) / 2 = ${r.midFx}: ${r.sprFx}`);
      t.ok(/spread [\d.]+ pt /.test(r.sprCfd) && !/pip/.test(r.sprCfd), 'CFD spread in points: ' + r.sprCfd);
      t.near(r.bids[0] - r.bids[1], 1, 'GOLD ladder levels 100 pt (1.00) apart, not one point', 1e-9, 1e-9);
      t.deep(r.stepTxt, ['1.00', '5.00', '10.00'], 'step buttons in price units on GOLD');
      t.ok(/^\d+(\.\d)?$/.test(r.sz), 'CFD sizes in lots, no "M": ' + r.sz);
      t.eq(r.off.orders, 0, 'One-click off: no order'); t.eq(r.off.positions, 0, 'One-click off: no position');
      t.eq(r.off.ot, 'limit', 'ticket set to limit'); t.eq(r.off.side, 'buy', 'bid level: buy'); t.near(r.off.price, r.px, 'ticket price = level', 1e-9, 1e-9);
      t.near(+r.off.field, r.px, 'price field shows the level', 1e-9, 1e-9);
      t.ok(r.off.toasts.includes('Ticket ready — not sent'), 'says it was not sent: ' + r.off.toasts);
      t.eq(r.shift.orders, 0, 'shift-click with One-click off: no order'); t.eq(r.shift.ot, 'stop', 'shift: stop'); t.eq(r.shift.side, 'buy', 'ask level + shift: buy stop'); t.near(r.shift.price, r.shift.want, 'stop price = level', 1e-9, 1e-9);
      t.ok(r.on, 'One-click on: order placed');
      t.eq(r.on.ot, 'limit', 'limit'); t.eq(r.on.side, 'buy', 'buy'); t.near(r.on.price, r.on.px, 'at the level', 1e-9, 1e-9); t.near(r.on.lots, r.on.want, 'ticket sizing', 1e-9, 1e-9);
      t.eq(r.on.tkOt, 'market', 'One-click on leaves the ticket alone');
      t.noErrors(page);
    }
  },
  {
    name: 'W0P4 closed session: the ladder and the chart overlay say the market is closed with the opening time, a ladder click sends nothing; measure in the instrument unit',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(() => {
        T.reset(); setSymbol('AAPL.US'); S.set.oneClick = true; renderDom();
        const why = marketWhy('AAPL.US'), spr = document.getElementById('domSpr').textContent, dom = document.getElementById('dom');
        const row = [...document.querySelectorAll('#dom .dom-row.bid')].find(x => x.dataset.price);
        domClick({ target: row, shiftKey: false });
        const closed = { why, spr, cls: dom.classList.contains('dom-closed'), orders: S.orders.length, toasts: T.toasts().map(x => x.title + ': ' + x.body), ovl: ovlSessionText('AAPL.US') };
        S.set.oneClick = false; S.set.tf = 15;
        const ms = measureText('AAPL.US', 340, 341.5, 3), mf = measureText('EURUSD', 1.1, 1.0985, 2), mi = measureText('US.500', 7400, 7410, 1);
        setSymbol('EURUSD'); renderDom();
        return { closed, ms, mf, mi, open: { spr: document.getElementById('domSpr').textContent, cls: dom.classList.contains('dom-closed'), ovl: ovlSessionText('EURUSD') } };
      });
      t.ok(/^Market closed — opens/.test(r.closed.why), 'AAPL.US closed at 10:00 UTC: ' + r.closed.why);
      t.ok(r.closed.spr.includes(r.closed.why.replace('Market closed — ', '')), 'ladder centre names the opening: ' + r.closed.spr);
      t.ok(r.closed.cls, 'ladder marked closed');
      t.eq(r.closed.orders, 0, 'a ladder click on a closed market sends nothing');
      t.ok(r.closed.toasts.some(x => x.startsWith('Market closed')), 'and says why: ' + r.closed.toasts);
      t.eq(r.closed.ovl, r.closed.why, 'chart overlay: closed with the opening');
      t.deep(r.ms, ['+150.0 pt  +0.441%', '3 bars · 45m', '+$1.50 per share'], 'measure on a stock: points, per share');
      t.deep(r.mf, ['−15.0 pips  −0.136%', '2 bars · 30m', '−$150.00 per lot'], 'measure on FX: pips, per lot');
      t.deep(r.mi, ['+1000.0 pt  +0.135%', '1 bar · 15m', '+$500.00 per lot'], 'measure on US.500: points, $50 per index point');
      t.ok(!r.open.cls && /mid/.test(r.open.spr), 'open market: normal ladder'); t.eq(r.open.ovl, '', 'overlay: nothing while open');
      t.noErrors(page);
    }
  },
  {
    name: 'W0P3 import keeps text exactly, shows it as text, and refuses numbers that are not finite with a reason',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(async () => {
        const wait = () => new Promise(r => setTimeout(r, 300));
        const quote = `Didn't wait — "rule" <5 pips & R>1`, long = 'x'.repeat(790) + ' <b>end</b>', evil = '<img src=x onerror="window.__xss=1">';
        T.reset(); T.clearToasts();
        S.history = [{ id: 7, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.101, pnl: 100, pips: 10, r: 1, comm: 0, swap: 0, open: Engine.simTime - 7200, close: Engine.simTime - 3600, reason: quote, note: long, setup: evil, ctx: [], news: [] }];
        const exp = JSON.stringify({ app: 'meridian-fx', version: 1, state: S });
        T.reset(); T.clearToasts();
        importAccount(new File([exp], 'a.json', { type: 'application/json' })); await wait();
        const h = S.history[0] || {};
        for (const tab of ['history', 'journal', 'behav']) { try { setTab(tab); } catch (e) { } }
        frame(true, true); await wait();
        const ok = { reason: h.reason, note: h.note, setup: h.setup, imgs: document.querySelectorAll('img[onerror]').length, xss: window.__xss, toasts: T.toasts().map(x => x.title + ': ' + x.body) };
        // a number that JSON turns into Infinity is refused, and the toast says where
        S.balance = 4321; T.clearToasts();
        importAccount(new File(['{"app":"meridian-fx","version":1,"state":{"balance":1000,"positions":[],"orders":[],"alerts":[],"history":[{"id":1,"pnl":1e309}]}}'], 'b.json', { type: 'application/json' })); await wait();
        const inf = { bal: S.balance, toasts: T.toasts().map(x => x.title + ': ' + x.body) };
        T.clearToasts();
        importAccount(new File(['{not json'], 'c.json', { type: 'application/json' })); await wait();
        return { ok, inf, junk: T.toasts().map(x => x.title + ': ' + x.body) };
      });
      t.eq(r.ok.reason, `Didn't wait — "rule" <5 pips & R>1`, 'quotes, < > and & survive the round trip');
      t.eq(r.ok.note.length, 801, 'an 800-character note is not cut');
      t.eq(r.ok.setup, undefined, 'a legacy setup field in an import is dropped by sanitizeState (the classification is gone)');
      t.eq(r.ok.imgs, 0, 'no <img onerror> in History, Journal or Behaviour');
      t.eq(r.ok.xss, undefined, 'the onerror handler never ran');
      t.ok(r.ok.toasts.some(x => x.startsWith('Account imported')), 'import reported: ' + r.ok.toasts);
      t.eq(r.inf.bal, 4321, '1e309: account unchanged');
      t.ok(r.inf.toasts.some(x => /Import failed: .*state\.history\[0\]\.pnl is not a finite number/.test(x)), '1e309: the toast names the field: ' + r.inf.toasts);
      t.ok(r.junk.some(x => /Import failed: .*not valid JSON/.test(x)), 'broken JSON: the toast says so: ' + r.junk);
      t.noErrors(page);
    }
  }
];
