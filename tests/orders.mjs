// Orders task: hybrid order model (position protections + OCO/stop-limit/GTD on entries), execution model, fill
// receipts, IBKR-style ticket figures, and the tester regressions (trail without a stop, NBP in the coach, DOM fit).
// Prices are forced with T.move on a frozen market (speed 0: fills at the quote, no slippage). T.move sets the bid
// (PIVOT ON BID, ask = bid + spread); the clock is pinned (clock: true, Friday 10:30 UTC) so FX is in session.
export const tests = [
  {
    name: 'O1 bracket: a buy limit with SL 20 / TP 40 fills with both levels measured from the fill, TP closes it',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym), price = +(q.ask - 10 * pip).toFixed(5);
        const o = placeOrder({ sym, side: 'buy', ot: 'limit', price, lots: 1, slPips: 20, tpPips: 40, trail: 0 });
        T.move(sym, price - 2 * pip); checkTriggers();
        const p = S.positions[0], out = { ret: !!o && o.id, pos: S.positions.length, orders: S.orders.length, sl: p && (p.entry - p.sl) / pip, tp: p && (p.tp - p.entry) / pip, src: p && p.src, log: S.ordLog?.[0]?.status };
        T.move(sym, p.tp + 2 * pip); checkTriggers();
        out.reason = S.history[0]?.reason; out.open = S.positions.length;
        return out;
      });
      t.ok(r.ret > 0, 'placeOrder returns the order');
      t.eq(r.pos, 1, 'limit filled'); t.eq(r.orders, 0, 'entry left the book');
      t.near(r.sl, 20, 'SL 20 pips below the fill', 1e-6, 1e-6); t.near(r.tp, 40, 'TP 40 pips above the fill', 1e-6, 1e-6);
      t.eq(r.src, r.ret, 'position remembers its entry order'); t.eq(r.log, 'filled', 'order log: filled');
      t.eq(r.reason, 'Take profit', 'TP closes the bracket'); t.eq(r.open, 0, 'closed');
      t.noErrors(page);
    }
  },
  {
    name: 'O2 multi-TP: TP1 closes half and moves the stop to break-even, TP2 closes the rest',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const sym = 'EURUSD', pip = Engine.META[sym].pip;
        const p = openPosition({ sym, side: 'buy', lots: 1, slPips: 20, tps: [{ pips: 20, pct: 50 }, { pips: 40, pct: 50 }], be: { at: null, off: 0, onTp: true }, dupOk: true });
        const out = { tps: p.tps.map(x => [x.lots, Math.round((x.price - p.entry) / pip), x.leg]), tp: (p.tp - p.entry) / pip };
        T.move(sym, p.entry + 22 * pip); checkTriggers();
        out.h1 = { reason: S.history[0]?.reason, lots: S.history[0]?.lots, leg: S.history[0]?.leg };
        out.after = { lots: p.lots, sl: p.sl, entry: p.entry, tps: p.tps.length, tp: (p.tp - p.entry) / pip };
        T.move(sym, p.entry + 42 * pip); checkTriggers();
        out.h2 = { reason: S.history[0]?.reason, lots: S.history[0]?.lots }; out.open = S.positions.length;
        // a 30/30/40 split on 0.05 lots: remainder rule gives 0.01/0.01/0.03; on 0.02 lots a leg is below 0.01 → rejected
        T.reset();
        const p2 = openPosition({ sym, side: 'sell', lots: .05, tps: [{ pips: 10, pct: 30 }, { pips: 20, pct: 30 }, { pips: 30, pct: 40 }], dupOk: true });
        out.split = p2 && p2.tps.map(x => x.lots);
        T.reset(); // netting: on top of p2 this order would add to it
        const p3 = openPosition({ sym, side: 'sell', lots: .02, tps: [{ pips: 10, pct: 30 }, { pips: 20, pct: 30 }, { pips: 30, pct: 40 }], dupOk: true });
        out.tiny = { p: p3, why: lastReject };
        // manual half close consumes the nearest target first
        T.reset();
        const p4 = openPosition({ sym, side: 'buy', lots: 1, tps: [{ pips: 20, pct: 50 }, { pips: 40, pct: 50 }], dupOk: true });
        closePosition(p4.id, 'Partial close', .5);
        out.half = { lots: p4.lots, tps: p4.tps.map(x => [x.leg, x.lots]) };
        return out;
      });
      t.deep(r.tps, [[.5, 20, 'TP1'], [.5, 40, 'TP2']], 'two legs of 0.50 lots at 20 and 40 pips');
      t.near(r.tp, 20, 'p.tp shows the nearest target', 1e-6, 1e-6);
      t.deep(r.h1, { reason: 'Take profit 1', lots: .5, leg: 'TP1' }, 'TP1 closes 0.50 lots');
      t.eq(r.after.lots, .5, 'half the position remains');
      t.eq(r.after.sl, r.after.entry, 'stop moved to break-even after TP1');
      t.eq(r.after.tps, 1, 'one target left'); t.near(r.after.tp, 40, 'p.tp now TP2', 1e-6, 1e-6);
      t.deep(r.h2, { reason: 'Take profit 2', lots: .5 }, 'TP2 closes the rest'); t.eq(r.open, 0, 'position closed');
      t.deep(r.split, [.01, .01, .03], 'remainder rule');
      t.ok(r.tiny.p === null && /TP\d is below the 0\.01-lot minimum/.test(r.tiny.why), 'leg under 0.01 lots rejected: ' + r.tiny.why);
      t.deep(r.half, { lots: .5, tps: [['TP2', .5]] }, 'manual ½ consumes TP1, the runner keeps TP2');
      t.noErrors(page);
    }
  },
  {
    name: 'O3 OCO on two entries: the buy stop fills, the sell stop is cancelled',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); T.clearToasts();
        const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym);
        const a = placeOrder({ sym, side: 'buy', ot: 'stop', price: +(q.ask + 10 * pip).toFixed(5), lots: 1, slPips: 20, tpPips: 30, trail: 0 });
        const b = placeOrder({ sym, side: 'sell', ot: 'stop', price: +(q.bid - 10 * pip).toFixed(5), lots: 1, slPips: 20, tpPips: 30, trail: 0, oca: a.id });
        const grp = [a.oca, b.oca];
        T.move(sym, q.mid + 15 * pip); checkTriggers();
        const p = S.positions[0], lg = S.ordLog.find(x => x.id === b.id);
        // the exits of the filled entry are its own (not part of the OCO group): the position keeps them
        return { grp, pos: S.positions.length, side: p?.side, sl: p?.sl != null, tp: p?.tp != null, orders: S.orders.length, b: lg && { status: lg.status, why: lg.why }, toasts: T.toasts().map(x => x.title + ': ' + x.body) };
      });
      t.ok(r.grp[0] && r.grp[0] === r.grp[1], 'both entries share one OCO group: ' + r.grp);
      t.eq(r.pos, 1, 'one position'); t.eq(r.side, 'buy', 'the buy stop filled');
      t.ok(r.sl && r.tp, 'filled entry keeps its SL and TP');
      t.eq(r.orders, 0, 'nothing left in the book');
      t.eq(r.b?.status, 'cancelled', 'sell stop cancelled'); t.ok(/OCO/.test(r.b?.why), 'reason names OCO: ' + r.b?.why);
      t.ok(r.toasts.some(x => /OCO/.test(x)), 'a toast says the sibling was cancelled: ' + r.toasts);
      t.noErrors(page);
    }
  },
  {
    name: 'O4 stop-limit: triggered by a jump beyond its limit it does not fill; it fills at or better than the limit',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym), stop = +(q.ask + 10 * pip).toFixed(5), limit = +(stop + 1 * pip).toFixed(5);
        const bad = placeOrder({ sym, side: 'buy', ot: 'stop', price: stop, limit: stop - 2 * pip, lots: 1 });
        const why = lastReject;
        const o = placeOrder({ sym, side: 'buy', ot: 'stop', price: stop, limit, lots: 1 });
        T.move(sym, q.mid + 15 * pip); checkTriggers();
        const mid = { status: o.status, pos: S.positions.length, inBook: S.orders.includes(o) };
        T.move(sym, q.mid + 10.5 * pip); const ask = Engine.quote(sym).ask; checkTriggers();
        const p = S.positions[0];
        return { bad, why, mid, pos: S.positions.length, entry: p?.entry, ask, limit, f: S.fills[0] && { ref: S.fills[0].ref, kind: S.fills[0].kind } };
      });
      t.eq(r.bad, null, 'limit below the stop of a buy stop-limit is rejected');
      t.ok(/at or above the stop price/.test(r.why), 'reason: ' + r.why);
      t.deep(r.mid, { status: 'triggered', pos: 0, inBook: true }, 'triggered, working as a limit, not filled');
      t.eq(r.pos, 1, 'fills when the ask comes back under the limit');
      t.ok(r.entry <= r.limit + 1e-12, `filled at ${r.entry}, not worse than the limit ${r.limit}`);
      t.deep(r.f, { ref: r.limit, kind: 'open' }, 'the receipt names the limit as the requested price');
      t.noErrors(page);
    }
  },
  {
    name: 'O5 GTD order expires (simulation UTC); DAY expires at 00:00 UTC',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); T.clearToasts();
        const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym), now = Engine.simTime;
        const early = placeOrder({ sym, side: 'buy', ot: 'limit', price: +(q.ask - 300 * pip).toFixed(5), lots: 1, tif: 'GTD', expires: now + 30 });
        const why = lastReject;
        const o = placeOrder({ sym, side: 'buy', ot: 'limit', price: +(q.ask - 300 * pip).toFixed(5), lots: 1, tif: 'GTD', expires: now + 120, dupOk: true });
        const day = placeOrder({ sym, side: 'sell', ot: 'limit', price: +(q.bid + 300 * pip).toFixed(5), lots: 1, tif: 'DAY' });
        const dayExp = day.expires;
        checkTriggers(); const still = S.orders.length;
        Engine.speed = 60; Engine.tick(3000); Engine.speed = 0; // 180 s of simulated time
        checkTriggers();
        const lg = S.ordLog.find(x => x.id === o.id);
        return { early, why, still, left: S.orders.map(x => x.id), day: day.id, dayExp, now, lg: lg && lg.status, toasts: T.toasts().map(x => x.title) };
      });
      t.eq(r.early, null, 'expiry under one minute is rejected'); t.ok(/at least one minute/.test(r.why), r.why);
      t.eq(r.still, 2, 'both working before expiry');
      t.eq(r.lg, 'expired', 'GTD order expired');
      t.deep(r.left, [r.day], 'the DAY order is still working');
      t.eq(r.dayExp, (Math.floor(r.now / 86400) + 1) * 86400, 'DAY expires at the next 00:00 UTC (simulation time)');
      t.ok(r.toasts.includes('Order expired'), 'toast: ' + r.toasts);
      t.noErrors(page);
    }
  },
  {
    name: 'O6 an old saved state migrates without loss (sl/tp/trail positions, slPips/tpPips orders)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym);
        const old = {
          balance: 100000, nextId: 10, history: [], alerts: [],
          positions: [
            { id: 1, sym, side: 'buy', lots: 1, entry: q.ask, sl: +(q.ask - 20 * pip).toFixed(5), tp: +(q.ask + 40 * pip).toFixed(5), trail: 15, open: Engine.simTime },
            { id: 2, sym, side: 'sell', lots: .5, entry: q.bid, sl: null, tp: null, trail: 12, open: Engine.simTime }
          ],
          orders: [{ id: 3, sym, side: 'buy', ot: 'limit', price: +(q.ask - 30 * pip).toFixed(5), lots: 1, slPips: 15, tpPips: 30, trail: 10, created: Engine.simTime }]
        };
        loadState(JSON.parse(JSON.stringify(old))); pmCfg().on = false; tiltCfg().on = false;
        const [a, b] = S.positions, o = S.orders[0];
        const out = { a: { sl: a.sl, tp: a.tp, trail: a.trail }, a0: { sl: old.positions[0].sl, tp: old.positions[0].tp, trail: 15 }, b: { sl: b.sl, trail: b.trail, want: b.entry + 12 * pip }, o: { slPips: o.slPips, tpPips: o.tpPips, trail: o.trail, tif: o.tif, status: o.status, price: o.price }, fills: Array.isArray(S.fills), log: Array.isArray(S.ordLog) };
        // the new fields survive export → import
        placeOrder({ sym, side: 'buy', ot: 'stop', price: +(q.ask + 20 * pip).toFixed(5), limit: +(q.ask + 21 * pip).toFixed(5), lots: 1, tif: 'GTD', expires: Engine.simTime + 7200, tps: [{ pips: 10, pct: 50 }, { pips: 20, pct: 50 }] });
        openPosition({ sym: 'GBPUSD', side: 'buy', lots: 1, tps: [{ pips: 20, pct: 50 }, { pips: 40, pct: 50 }], be: { at: 10, off: 1, onTp: false }, dupOk: true }); // netting: on EURUSD it would offset the open positions
        const exp = JSON.stringify({ app: 'meridian-fx', version: 1, state: S });
        T.reset(); importAccount(new File([exp], 'a.json', { type: 'application/json' }));
        await new Promise(r => setTimeout(r, 300)); pmCfg().on = false; tiltCfg().on = false;
        const sl = S.orders.find(x => x.limit != null), mp = S.positions.find(x => x.tps);
        out.back = { sl: sl && { limit: sl.limit, tif: sl.tif, tps: sl.tps.length }, mp: mp && { tps: mp.tps.length, be: mp.be && mp.be.at, tp: mp.tp === mp.tps[0].price }, a: S.positions[0] && S.positions[0].trail };
        return out;
      });
      t.deep(r.a, r.a0, 'position with sl/tp/trail keeps them');
      t.near(r.b.sl, r.b.want, 'trail-only position gets its protective stop at entry + trail', 1e-9, 1e-9);
      t.eq(r.b.trail, 12, 'trail kept');
      t.deep({ ...r.o, price: undefined }, { slPips: 15, tpPips: 30, trail: 10, tif: 'GTC', status: 'pending', price: undefined }, 'order keeps slPips/tpPips/trail, defaults to GTC');
      t.ok(r.fills && r.log, 'fills and order log initialised');
      t.deep(r.back.sl, { limit: r.back.sl?.limit, tif: 'GTD', tps: 2 }, 'stop-limit GTD with two targets survives export/import');
      t.ok(r.back.sl?.limit > 0, 'limit price kept');
      t.deep(r.back.mp, { tps: 2, be: 10, tp: true }, 'multi-TP position and break-even survive');
      t.noErrors(page);
    }
  },
  {
    name: 'O7 every fill has a receipt; the execution model is symmetric and declared; commission charged at the fill',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const def = { comm: S.set.comm, slip: S.set.slip, sd: S.set.slipSd, lat: S.set.latMs };
        S.set.comm = 5; // $5 per lot round turn, as in the backtester
        const sym = 'EURUSD', q = Engine.quote(sym), bal0 = S.balance;
        const p = openPosition({ sym, side: 'buy', lots: 2, dupOk: true });
        const f = S.fills[0], out = { def, f: { kind: f.kind, pos: f.pos, px: f.px, ref: f.ref, slip: f.slip, lat: f.lat, comm: f.comm, ask: f.ask }, ask: q.ask, comm: bal0 - S.balance, pfill: p.fills[0] === f.fid };
        closePosition(p.id);
        const h = S.history[0]; out.h = { fills: h.fills && h.fills.length, comm: h.comm, kind: S.fills[0].kind };
        renderReceipt(S.fills[0].fid);
        const dlg = document.getElementById('fillDlg');
        out.text = dlg && !dlg.hidden ? dlg.textContent : '';
        dlg.querySelector('[data-cf=cancel]').click(); out.closed = dlg.hidden;
        // with the market running the noise is symmetric with mean zero
        Engine.speed = 1; execSeed(7); const s = [];
        for (let i = 0; i < 4000; i++) s.push(execFill({ sym, side: i % 2 ? 'buy' : 'sell', kind: 'market' }).slip);
        Engine.speed = 0;
        const mean = s.reduce((a, b) => a + b, 0) / s.length, sd = Math.sqrt(s.reduce((a, b) => a + (b - mean) ** 2, 0) / s.length);
        out.sym = { mean, se: sd / Math.sqrt(s.length), up: s.filter(x => x > 0).length / s.filter(x => x !== 0).length, sd };
        // a limit is never filled worse than its price
        Engine.speed = 1; let worse = 0, filled = 0; const lim = Engine.quote(sym).ask;
        for (let i = 0; i < 2000; i++) { const x = execFill({ sym, side: 'buy', kind: 'limit', limit: lim, ref: lim }); if (x.ok) { filled++; if (x.px > lim + 1e-12) worse++; } }
        Engine.speed = 0; out.lim = { worse, filled };
        S.set.slip = 'off'; Engine.speed = 1; out.off = execFill({ sym, side: 'buy', kind: 'market' }); Engine.speed = 0; S.set.slip = 'sym';
        out.off = { slip: out.off.slip, lat: out.off.lat, px: out.off.px === Engine.quote(sym).ask };
        renderTicket(); out.note = document.getElementById('tkExecNote')?.textContent || '';
        S.set.comm = 0; renderTicket(); out.note0 = document.getElementById('tkExecNote')?.textContent || '';
        return out;
      });
      t.deep(r.def, { comm: 0, slip: 'sym', sd: .2, lat: 120 }, 'defaults: slippage on (σ 0.2 pip, 120 ms), no commission (spread-only)');
      t.eq(r.f.kind, 'open', 'opening fill recorded'); t.ok(r.pfill, 'position links its fill');
      t.eq(r.f.px, r.ask, 'paused market: filled at the ask'); t.eq(r.f.slip, 0, 'no slippage while paused'); t.eq(r.f.lat, 0, 'no latency while paused');
      t.near(r.comm, 10, 'commission $5/lot round turn charged at the fill (2 lots)', 1e-9, 1e-9); t.near(r.f.comm, 10, 'receipt shows it', 1e-9, 1e-9);
      t.eq(r.h.fills, 2, 'history row links the opening and closing fills'); t.near(r.h.comm, 10, 'history keeps the commission', 1e-9, 1e-9); t.eq(r.h.kind, 'close', 'closing fill');
      for (const k of ['Fill receipt', 'Requested', 'Filled', 'Slippage', 'Spread at fill', 'Latency', 'Commission', 'Gap', 'Model', 'all-or-nothing']) t.ok(r.text.includes(k), `receipt shows "${k}": ${r.text.slice(0, 300)}`);
      t.ok(r.closed, 'receipt closes');
      t.ok(Math.abs(r.sym.mean) < 3 * r.sym.se, `mean slippage ${r.sym.mean} within 3 SE ${r.sym.se}`);
      t.ok(r.sym.up > .47 && r.sym.up < .53, 'half the fills against, half in favour (of those off the 0.1-pip grid point): ' + r.sym.up);
      t.ok(r.sym.sd > .1 && r.sym.sd < .5, 'small: σ ≈ 0.2 pip: ' + r.sym.sd);
      t.ok(r.lim.filled > 500 && r.lim.worse === 0, `limits never fill worse (${r.lim.filled} fills)`);
      t.deep(r.off, { slip: 0, lat: 0, px: true }, 'slippage off: fills at the quote');
      t.ok(/all-or-nothing/i.test(r.note) && /symmetric/i.test(r.note) && /\$5\.00/.test(r.note), 'ticket declares the execution model: ' + r.note);
      t.ok(/no commission|spread-only/i.test(r.note0), 'default declared as spread-only: ' + r.note0);
      t.noErrors(page);
    }
  },
  {
    name: 'O8 trailing without a stop: protective stop at once at entry ∓ trail, on every entry path; Lab uses the same rule',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        T.reset();
        const p = openPosition({ sym, side: 'buy', lots: 1, trail: 15, dupOk: true });
        out.now = { sl: p.sl, want: p.entry - 15 * pip, risk: p.risk > 0 };
        T.move(sym, Engine.mid(sym) - 5 * pip); checkTriggers(); out.adverse = p.sl === out.now.sl;
        T.move(sym, p.entry + 10 * pip); checkTriggers(); out.follow = { sl: p.sl, want: Engine.quote(sym).bid - 15 * pip, trailed: p.trailed };
        T.move(sym, p.entry - 20 * pip); checkTriggers(); out.hit = { open: S.positions.length, reason: S.history[0]?.reason };
        // sell side, and every path that bypasses the ticket
        T.reset();
        const s = openPosition({ sym, side: 'sell', lots: 1, trail: 10, dupOk: true }); out.sell = { sl: s.sl, want: s.entry + 10 * pip };
        T.reset(); Object.assign(S.tk, { useSL: false, useTP: false, useTrail: true, trail: 12 }); S.set.oneClick = true;
        quickTrade('buy'); out.quick = S.positions[0] && (S.positions[0].entry - S.positions[0].sl) / pip;
        T.reset(); lastSent = null; submitTicket('sell'); out.ticket = S.positions[0] && (S.positions[0].sl - S.positions[0].entry) / pip;
        T.reset(); const q = Engine.quote(sym); renderDom();
        const row = [...document.querySelectorAll('#dom .dom-row.bid')].find(x => +x.dataset.price < q.bid - 3 * pip);
        domClick({ target: row, shiftKey: false }); out.dom = S.orders[0] && { trail: S.orders[0].trail, slPips: S.orders[0].slPips };
        T.move(sym, +row.dataset.price - (q.ask - q.bid) - 1 * pip); checkTriggers(); out.domFill = S.positions[0] && (S.positions[0].entry - S.positions[0].sl) / pip;
        for (let i = 0; i < 50 && typeof window.chartLongPress !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
        T.reset(); lastSent = null; window.chartLongPress(innerWidth / 2, 200);
        const lp = document.querySelector('.lp-pop .lp-b[data-sd]'); if (lp) lp.click(); out.gesture = S.orders[0] && { trail: S.orders[0].trail, slPips: S.orders[0].slPips };
        S.set.oneClick = false;
        // Lab: the Trail 1R rule is the live rule (trailNext) and 'Use' puts the ticket on trail-only
        await loadLazy();
        const d = 1, e = 1.1, R = .001; let stop = e - R;
        for (const best of [1.1002, 1.1009, 1.1005]) stop = trailNext(d, stop, best, R);
        out.rule = stop; exUse('trail'); out.use = { useSL: S.tk.useSL, useTrail: S.tk.useTrail, trail: S.tk.trail };
        out.labSrc = String(exSim).includes('trailNext');
        return out;
      });
      t.near(r.now.sl, r.now.want, 'buy: stop at entry − 15 pips immediately', 1e-12, 1e-12); t.ok(r.now.risk, 'risk is known (1R = trail)');
      t.ok(r.adverse, 'adverse move: stop does not move');
      t.near(r.follow.sl, r.follow.want, 'then follows 15 pips behind the bid', 1e-12, 1e-12); t.ok(r.follow.trailed, 'marked as trailed');
      t.eq(r.hit.open, 0, 'stop hit'); t.eq(r.hit.reason, 'Trailing stop', 'reason: Trailing stop');
      t.near(r.sell.sl, r.sell.want, 'sell: stop at entry + 10 pips', 1e-12, 1e-12);
      t.near(r.quick, 12, 'one-click quick trade: stop at once', 1e-6, 1e-6);
      t.near(r.ticket, 12, 'ticket: stop at once', 1e-6, 1e-6);
      t.deep(r.dom, { trail: 12, slPips: 0 }, 'DOM ladder order carries the trail');
      t.near(r.domFill, 12, 'DOM order fill: stop at once', 1e-6, 1e-6);
      t.deep(r.gesture, { trail: 12, slPips: 0 }, 'chart long-press order carries the trail');
      t.near(r.rule, 1.1009 - .001, 'Lab rule: stop = best − R, never loosened', 1e-12, 1e-12);
      t.deep(r.use, { useSL: false, useTrail: true, trail: 12 }, 'Lab "Use" keeps the ticket trail as 1R (trail-only, same rule as live)');
      t.ok(r.labSrc, 'Exit lab simulates with trailNext');
      t.noErrors(page);
    }
  },
  {
    name: 'O9 coach: the negative balance protection row is not a trade anywhere',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const base = { sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, pips: 0, r: null, reason: 'Manual', note: '', setup: '', swap: 0 };
        const nbp = { ...base, id: 90, side: 'nbp', lots: 0, pnl: 500, nbp: true, reason: 'Negative balance protection', open: Engine.simTime, close: Engine.simTime };
        S.history = [nbp, { ...base, id: 91, pnl: -50, r: -1, open: Engine.simTime - 900, close: Engine.simTime - 600 }, { ...base, id: 92, pnl: 30, r: .6, open: Engine.simTime - 4000, close: Engine.simTime - 3000 }];
        const a = coachInsights().map(x => x.t).join(' | ');
        S.history.push({ ...base, id: 93, pnl: -20, open: Engine.simTime - 9000, close: Engine.simTime - 8000 });
        const b = coachInsights().map(x => x.t).join(' | ');
        return { a, b };
      });
      t.ok(/Close 1 more trade\b/.test(r.a), 'two trades + the NBP row: one more trade needed: ' + r.a);
      t.ok(/1 of 3 trades had no stop loss/.test(r.b), 'no-stop count over trades only: ' + r.b);
      t.noErrors(page);
    }
  },
  {
    name: 'O10 ticket: Current / Change / Post-trade with pending orders, stop-out distance, blocks; command bar multi-TP and GTD',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym);
        openPosition({ sym: 'USDJPY', side: 'buy', lots: 2, dupOk: true });
        placeOrder({ sym: 'GBPUSD', side: 'buy', ot: 'limit', price: +(Engine.quote('GBPUSD').ask - 50 * Engine.META.GBPUSD.pip).toFixed(5), lots: 1 });
        setSymbol(sym); Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 1, useSL: true, sl: 20, useTP: true, tp: 40, useTrail: false });
        const k = renderTicket(), w = tkWhatIf(k), a = account();
        const pend = posMargin({ sym: 'GBPUSD', lots: 1 });
        const out = { w, a, margin: k.margin, pend, table: (document.getElementById('tkWhatIf')?.textContent || '') + ' ' + (document.getElementById('tkChkRows')?.textContent || '') };
        // move EURUSD by the shown stop-out distance (only after opening the trade): margin level ≈ 50%
        T.reset(); openPosition({ sym, side: 'buy', lots: 20, dupOk: true });
        S.tk.lots = 5; const k2 = tkCalc(), w2 = tkWhatIf(k2);
        openPosition({ sym, side: 'buy', lots: 5, dupOk: true });
        T.move(sym, Engine.mid(sym) - w2.so.pips * pip); out.level = account().level;
        // blocks: targets over 100%, stop-limit with the limit on the wrong side, expiry in the past
        T.reset(); S.tk.lots = 1;
        Object.assign(S.tkx, { split: true, tps: [{ pips: 20, pct: 70 }, { pips: 40, pct: 50 }] });
        out.b1 = tkBlocks(tkCalc()).map(x => x.btn);
        Object.assign(S.tkx, { split: false }); Object.assign(S.tk, { ot: 'stop', price: +(q.ask + 20 * pip).toFixed(5) }); Object.assign(S.tkx, { stopLimit: true, lmtOff: -2 });
        out.b2 = tkBlocks(tkCalc()).map(x => x.btn);
        Object.assign(S.tkx, { stopLimit: false, tif: 'GTD', gtdMin: 0 });
        out.b3 = tkBlocks(tkCalc()).map(x => x.btn);
        Object.assign(S.tkx, { tif: 'GTC' }); S.tk.ot = 'market';
        // command bar: tp 20,40 → two targets, gtd 2h on a limit
        const c1 = parseCmd('buy 1 eurusd sl 20 tp 20,40');
        out.c1 = { desc: c1.desc, block: c1.block, confirm: c1.confirm }; c1.run();
        const p = S.positions.find(x => x.sym === sym); out.c1p = p && p.tps && p.tps.map(x => [x.lots, Math.round((x.price - p.entry) / pip)]);
        const c2 = parseCmd(`sell eurusd 0.5 limit ${(q.bid + 30 * pip).toFixed(5)} sl 15 gtd 2h`);
        out.c2 = { desc: c2.desc, confirm: c2.confirm }; c2.run();
        const o = S.orders.find(x => x.sym === sym); out.c2o = o && { tif: o.tif, dt: o.expires - Engine.simTime };
        const c3 = parseCmd(`buy eurusd 1 stop ${(q.ask + 20 * pip).toFixed(5)} lmt ${(q.ask + 22 * pip).toFixed(5)}`);
        out.c3 = c3 && c3.desc;
        return out;
      });
      const { w, a } = r;
      t.near(w.cur.mg, r.a.mg, 'current margin = account margin', 1e-9, 1e-6);
      t.near(w.post.mg, a.mg + r.pend + r.margin, 'post-trade margin = current + pending (gross) + this order', 1e-9, 1e-6);
      t.near(w.post.level, w.post.eq / w.post.mg * 100, 'post-trade level = equity / margin', 1e-9, 1e-6);
      t.ok(w.chg.eq < 0, 'change in equity is the cost of the trade (spread + commission)');
      for (const k of ['Current', 'Change', 'Post-trade', 'Margin used', 'Margin level', 'Stop-out', 'Commission']) t.ok(r.table.includes(k), `what-if shows "${k}"`);
      t.ok(r.level > 48 && r.level < 52, 'moving by the stop-out distance lands at ≈ 50%: ' + r.level);
      t.ok(r.b1.some(x => /Targets add up to 120% — max 100%/.test(x)), 'split over 100% blocks: ' + r.b1);
      t.ok(r.b2.some(x => /Limit must be at or above the stop/.test(x)), 'stop-limit wrong side blocks: ' + r.b2);
      t.ok(r.b3.some(x => /Expiry/.test(x)), 'GTD in the past blocks: ' + r.b3);
      t.ok(r.c1.confirm && !r.c1.block && /TP 20p 50% · 40p 50%/.test(r.c1.desc), 'preview shows both targets: ' + r.c1.desc);
      t.deep(r.c1p, [[.5, 20], [.5, 40]], 'command opens a two-target position');
      t.ok(r.c2.confirm && /GTD/.test(r.c2.desc), 'preview shows GTD: ' + r.c2.desc);
      t.deep(r.c2o, { tif: 'GTD', dt: 7200 }, 'GTD 2h order placed');
      t.ok(/stop-limit/.test(r.c3), 'stop-limit preview: ' + r.c3);
      t.noErrors(page);
    }
  },
  {
    name: 'O11 tablet 820×1180: the depth ladder keeps at least 2 levels per side',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 820, height: 1180 });
      await page.waitForTimeout(400);
      const r = await page.evaluate(async () => {
        // the default ticket without warnings (a news warning adds a block of its own above the ladder)
        CAL.events = []; Object.assign(S.tk, { ot: 'market', useSL: true, useTP: true, useTrail: false, sm: 'lots', lots: 1 }); renderTicket();
        await new Promise(r => setTimeout(r, 300)); fitDom();
        const box = document.getElementById('dom'), rows = [...box.children], vis = () => rows.filter(x => x.style.display !== 'none').length;
        const n = vis();
        // sub-pixel rounding (fractional device pixels): the 2-level ladder overflows its box by 0.7 px at each end
        rows.forEach((x, i) => { x.style.display = Math.abs(i - DOM_N) <= 2 ? '' : 'none'; });
        const top = rows[DOM_N - 2].getBoundingClientRect().top, bot = rows[DOM_N + 2].getBoundingClientRect().bottom;
        box.getBoundingClientRect = () => ({ top: top + .7, bottom: bot - .7, left: 0, right: 100, width: 100, height: bot - top - 1.4 });
        fitDom(); const frac = vis();
        delete box.getBoundingClientRect; fitDom();
        return { n, frac, shown: !!box.offsetParent };
      });
      t.ok(r.shown, 'ladder visible at 820×1180');
      t.ok(r.n >= 5, `2+ levels per side (${r.n} rows incl. spread)`);
      t.eq(r.frac, 5, 'a 0.7 px rounding overflow keeps 2 levels per side');
      t.noErrors(page);
    }
  }
  ,
  {
    name: 'O12 netting: one position per instrument; same side adds at the weighted average and keeps its SL/TP, the other side reduces at the fill and realises P/L, a larger one reverses; old states merge first; baskets stay apart',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0;
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        const p = openPosition({ sym, side: 'buy', lots: 1, slPips: 20, tpPips: 40, dupOk: true }), e1 = p.entry, sl = p.sl, tp = p.tp;
        T.move(sym, Engine.mid(sym) + 10 * pip);
        const p2 = openPosition({ sym, side: 'buy', lots: 3, slPips: 5, tpPips: 5, dupOk: true });
        const e2 = S.fills[0].px;
        out.add = { same: p2 === p, n: S.positions.length, lots: p.lots, avg: Math.abs(p.entry - (e1 + 3 * e2) / 4) < 1e-9, sl: p.sl === sl, tp: p.tp === tp, kind: S.fills[0].kind, net: netLast };
        const h0 = S.history.length, entry = p.entry;
        openPosition({ sym, side: 'sell', lots: 1.5, dupOk: true });
        const h = S.history[0], f = S.fills[0];
        out.red = { rows: S.history.length - h0, lots: p.lots, reason: h.reason, entry: h.entry === entry, exit: h.exit === f.px, pnl: Math.abs(h.pnl - (f.px - entry) * 1.5 * 1e5) < 1e-6, net: netLast };
        const q = openPosition({ sym, side: 'sell', lots: 4, slPips: 30, dupOk: true });
        out.flip = { n: S.positions.length, side: q.side, lots: q.lots, sl: q.sl != null, net: netLast, closed: !S.positions.includes(p) };
        openPosition({ sym, side: 'buy', lots: 1.5, dupOk: true });
        out.close = { n: S.positions.length, net: netLast };
        // a state from before netting: two buys at different prices meet a sell as one position at the average
        T.reset(); S.set.comm = 0;
        const a = openPosition({ sym, side: 'buy', lots: 1, dupOk: true }), b = { ...a, id: S.nextId++, entry: a.entry + 20 * pip, lots: 2, fills: [] }; S.positions.push(b);
        const avg = (a.entry + 2 * b.entry) / 3;
        openPosition({ sym, side: 'sell', lots: 1, dupOk: true });
        out.merge = { n: S.positions.length, lots: S.positions[0].lots, avg: Math.abs(S.positions[0].entry - avg) < 1e-9, hEntry: Math.abs(S.history[0].entry - avg) < 1e-9 };
        // a basket leg never nets
        T.reset();
        openPosition({ sym, side: 'buy', lots: 1, dupOk: true }); openPosition({ sym, side: 'sell', lots: 1, basket: 'b1', bgid: 'g1', dupOk: true });
        out.basket = S.positions.length;
        return out;
      });
      t.deep(r.add, { same: true, n: 1, lots: 4, avg: true, sl: true, tp: true, kind: 'add', net: 'add' }, 'same side: one position, 4 lots at the weighted average, its own SL/TP kept');
      t.deep(r.red, { rows: 1, lots: 2.5, reason: 'Offset by sell order', entry: true, exit: true, pnl: true, net: 'reduce' }, 'other side: reduced at the fill, P/L realised on the average entry');
      t.deep(r.flip, { n: 1, side: 'sell', lots: 1.5, sl: true, net: 'flip', closed: true }, 'larger other side: closed and reversed with the order\'s SL');
      t.deep(r.close, { n: 0, net: 'close' }, 'equal other side: flat');
      t.deep(r.merge, { n: 1, lots: 2, avg: true, hEntry: true }, 'old state: same-side positions merge at the average before netting');
      t.eq(r.basket, 2, 'a basket leg stays a position of its own');
      t.noErrors(page);
    }
  },
  {
    name: 'O-UX92 a pending order: SL and TP edited in its Orders row (price or pips), refused on the wrong side or inside the spread, removable',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.waitForFunction(() => typeof setView === 'function', null, { timeout: 30000 });
      await page.evaluate(() => {
        T.reset(); S.orders = [];
        const q = Engine.quote('EURUSD'), pip = Engine.META.EURUSD.pip;
        placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.ask - 20 * pip).toFixed(5), lots: .1, slPips: 20, tpPips: 0, dupOk: true });
        setView('trade', 'orders');
      });
      await page.waitForSelector('#ordBody td[data-edit=tp]');
      const st = () => page.evaluate(() => [S.orders[0].slPips, S.orders[0].tpPips]);
      const price0 = await page.evaluate(() => S.orders[0].price);
      // a target by price: 30 pips above the order price
      await page.click('#ordBody td[data-edit=tp]'); await page.waitForSelector('.xp-pop');
      await page.fill('.xp-pop input', String(+(price0 + .003).toFixed(5)));
      await page.click('.xp-ok'); await page.waitForFunction(() => !document.querySelector('.xp-pop'));
      t.deep(await st(), [20, 30], 'TP set from a price: 30 pips from the fill');
      // a stop on the wrong side of the order price is refused with the reason
      await page.click('#ordBody td[data-edit=sl]'); await page.waitForSelector('.xp-pop');
      await page.fill('.xp-pop input', String(+(price0 + .001).toFixed(5)));
      t.ok((await page.textContent('.xp-err')).includes('below the order price') && await page.isDisabled('.xp-ok'), 'SL above a buy order price is refused');
      // inside the spread: the core's refusal
      await page.click('.xp-pop [data-u=pips]'); await page.fill('.xp-pop input', '0.5');
      t.ok((await page.textContent('.xp-err')).includes('spread'), 'SL inside the spread is refused');
      await page.fill('.xp-pop input', '35'); await page.keyboard.press('Enter'); await page.waitForFunction(() => !document.querySelector('.xp-pop'));
      t.deep(await st(), [35, 30], 'SL set in pips with Enter');
      await page.click('#ordBody td[data-edit=tp]'); await page.waitForSelector('.xp-pop'); await page.click('.xp-rm'); await page.waitForFunction(() => !document.querySelector('.xp-pop'));
      t.deep(await st(), [35, 0], 'TP removed');
      t.noErrors(page);
    }
  }
];
