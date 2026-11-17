// Account model on the instrument sheet (.mace/design/catalog.md §4, contract C3): leverage = min(sheet [or the
// user's choice, capped at the sheet maximum], optional jurisdiction cap), trade status (full / close only / off),
// sessions (refusals with the opening time, triggers and stop-out only on open markets), volumes from the sheet,
// minimum pending distance, maximum deviation (requote), swap in points or % a year / 360, commission.
// Expected values are worked out here from catalog.js and raw quotes, not read back from trade.js.
const TUE_FX = new Date('2026-10-20T10:00:00Z');   // Tuesday, EEST: FX and US.500 open, US stocks closed (13:35–19:55 UTC)
const TUE_STK = new Date('2026-10-20T15:00:00Z');  // US stocks open
const TUE_PRE = new Date('2026-10-20T13:34:00Z');  // one minute before the US stock open
const WED_ROLL = new Date('2026-10-21T20:58:00Z'); // two minutes before the Wednesday rollover (17:00 New York, EDT)
// a flat account with no jurisdiction cap and the sheet's own leverage
const fresh = () => { T.reset(); S.set.jur = 'none'; S.set.lev = null; S.set.comm = 0; };

export const tests = [
  {
    name: 'AC1 leverage: sheet default (EURUSD 500:1), choice capped at the sheet maximum, optional jurisdiction cap per class',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const L = syms => Object.fromEntries(syms.map(s => [s, effLev(s)]));
        const all = ['EURUSD', 'AUDUSD', 'EURRON', 'EURTRY', 'US.500', 'IBEX35.SP', 'GOLD', 'OIL', 'BTCUSD', 'ETHUSD', 'AAPL.US', 'RACE.US', 'BUNDDE.10'];
        const out = { jurKeys: Object.keys(JUR), none: L(all) };
        S.set.lev = 500; out.c500 = L(all);
        S.set.lev = 30; out.c30 = L(all);
        S.set.lev = null;
        for (const j of ['eu', 'uk', 'au', 'us']) { S.set.jur = j; out[j] = L(all); out[j + 'St'] = Object.fromEntries(all.map(s => [s, tradeStatus(s)])); }
        S.set.jur = 'eu'; S.set.lev = 500; out.euChoice = L(['EURUSD', 'AUDUSD']);
        // margin = notional / effective leverage; notional: lots × size × usd(base) on FX, lots × size × bid × usd(quote) otherwise
        eval(fresh)();
        const e = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), u = openPosition({ sym: 'US.500', side: 'buy', lots: 1, dupOk: true });
        out.mg = { e: posMargin(e), u: posMargin(u), eur: Engine.usd('EUR'), us500: Engine.quote('US.500').bid, acct: account().mg };
        out.notional = { e: notionalUsd('EURUSD', 1), u: notionalUsd('US.500', 2) };
        return out;
      }, fresh.toString());
      t.deep(r.jurKeys, ['none', 'eu', 'uk', 'au', 'us'], 'JUR: none plus the four retail regimes (no pro / sim)');
      t.deep(r.none, { EURUSD: 500, AUDUSD: 500, EURRON: 200, EURTRY: 500, 'US.500': 100, 'IBEX35.SP': 100, GOLD: 50, OIL: 40, BTCUSD: 10, ETHUSD: 5, 'AAPL.US': 40, 'RACE.US': 5, 'BUNDDE.10': 100 }, 'no cap: the sheet default');
      t.eq(r.c500.EURRON, 500, 'a choice above the default goes up to the sheet maximum (EURRON 200/500)');
      t.eq(r.c500.BTCUSD, 10, 'never above the sheet maximum');
      t.deep([r.c30.EURUSD, r.c30.BTCUSD, r.c30['AAPL.US'], r.c30['RACE.US']], [30, 10, 30, 5], 'a lower choice applies where the sheet allows more');
      t.deep(r.eu, { EURUSD: 30, AUDUSD: 20, EURRON: 20, EURTRY: 20, 'US.500': 20, 'IBEX35.SP': 10, GOLD: 20, OIL: 10, BTCUSD: 2, ETHUSD: 2, 'AAPL.US': 5, 'RACE.US': 5, 'BUNDDE.10': 5 }, 'EU: ESMA Annex I caps by class (equity 5:1, rates as equity)');
      t.eq(r.uk.BTCUSD, 2, 'UK: the ESMA cap is still the margin of a crypto position');
      t.eq(r.ukSt.BTCUSD, 'off', 'UK retail: no crypto derivatives');
      t.eq(r.ukSt.EURUSD, 'full', 'UK: FX offered');
      t.deep(r.au, r.eu, 'AU: the ESMA caps');
      t.deep([r.us.EURUSD, r.us.AUDUSD, r.us.EURTRY], [50, 50, 20], 'US: 50:1 on NFA majors, 20:1 otherwise');
      t.eq(r.usSt['US.500'], 'off', 'US retail: no CFDs'); t.eq(r.usSt['AAPL.US'], 'off', 'US retail: no stock CFDs');
      t.deep(r.euChoice, { EURUSD: 30, AUDUSD: 20 }, 'a choice never lifts a jurisdiction cap');
      t.near(r.mg.e, 100000 * r.mg.eur / 500, 'EURUSD 1 lot margin at 500:1', 1e-9, 1e-6);
      t.near(r.mg.u, 50 * r.mg.us500 / 100, 'US.500 1 lot margin: 50 × bid / 100', 1e-9, 1e-6);
      t.near(r.mg.acct, r.mg.e + r.mg.u, 'account margin is the sum', 1e-9, 1e-6);
      t.near(r.notional.u, 2 * 50 * r.mg.us500, 'US.500 notional on its contract size 50', 1e-9, 1e-6);
      t.noErrors(page);
    }
  },
  {
    name: 'AC2 #levSel is the leverage choice (Sheet default), #jurSel in Settings is the cap, built from JS; a change with positions asks first',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const pick = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
      await page.evaluate(fresh => { eval(fresh)(); syncLevSel(); }, fresh.toString());
      const ui = await page.evaluate(() => {
        const l = document.getElementById('levSel'), j = document.getElementById('jurSel');
        return { lev: [...l.options].map(o => [o.value, o.textContent]), levV: l.value, jur: j && [...j.options].map(o => [o.value, o.textContent]), jurV: j && j.value, inHelp: !!j && !!j.closest('#help .help-set'), label: j && j.closest('label')?.textContent };
      });
      t.deep(ui.lev[0], ['default', 'Sheet default'], 'first option: the sheet default');
      t.ok(ui.lev.slice(1).every(([v, x]) => /^\d+$/.test(v) && x === '1:' + v), 'then the choices 1:N: ' + JSON.stringify(ui.lev));
      t.eq(ui.levV, 'default', 'lev null shows Sheet default');
      t.deep(ui.jur.map(x => x[0]), ['none', 'eu', 'uk', 'au', 'us'], '#jurSel options');
      t.eq(ui.jurV, 'none', 'no cap selected');
      t.ok(ui.inHelp, '#jurSel sits in Settings');
      t.ok(/cap/i.test(ui.label), 'labelled as a cap: ' + ui.label);
      const html = await page.evaluate(() => fetch('/index.html').then(r => r.text()));
      t.ok(!html.includes('jurSel'), '#jurSel is not in index.html');
      // flat account: applies at once
      await pick('levSel', '200');
      t.deep(await page.evaluate(() => [S.set.jur, S.set.lev, effLev('EURUSD')]), ['none', 200, 200], 'choice 1:200 applied');
      await pick('levSel', 'default');
      t.deep(await page.evaluate(() => [S.set.lev, effLev('EURUSD')]), [null, 500], 'back to the sheet default');
      // with a position: the cap asks first, with the resulting margin
      const before = await page.evaluate(() => { openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true }); const a = account(); return { eq: a.eq, eur: Engine.usd('EUR') }; });
      await pick('jurSel', 'eu');
      const dlg = await page.evaluate(() => { const d = document.querySelector('#confirmDlg'); return { open: !!d && !d.hidden, text: d?.textContent || '', jur: S.set.jur, sel: document.getElementById('jurSel').value }; });
      t.ok(dlg.open, 'confirmation opens');
      t.deep([dlg.jur, dlg.sel], ['none', 'none'], 'nothing changes before confirming');
      const lvl = before.eq / (20 * 100000 * before.eur / 30) * 100;
      t.ok(dlg.text.includes(Math.round(lvl).toLocaleString('en-US') + '%'), `dialog shows the resulting margin level ${lvl.toFixed(0)}%: ${dlg.text}`);
      await page.click('#confirmDlg [data-cf=ok]');
      t.deep(await page.evaluate(() => [S.set.jur, document.getElementById('jurSel').value, effLev('EURUSD')]), ['eu', 'eu', 30], 'confirm applies the EU cap');
      t.noErrors(page);
    }
  },
  {
    name: 'AC3 sessions: a closed stock refuses open, order and close with the opening time; triggers and stop-out wait for the open; a stop fills at the first quote with the gap marked',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(fresh => {
        eval(fresh)(); T.clearToasts();
        const sym = 'AAPL.US', q = Engine.quote(sym), out = { open: q.open, st: tradeStatus(sym) };
        out.pos = openPosition({ sym, side: 'buy', lots: 1, dupOk: true }); out.why = lastReject; out.toast = T.toasts()[0];
        out.ord = placeOrder({ sym, side: 'buy', ot: 'limit', price: +(q.ask * .9).toFixed(2), lots: 1 }); out.ordWhy = lastReject;
        // a position held over the close (as from a session before): closing it waits for the open
        const p = { id: S.nextId++, sym, side: 'buy', lots: 10, entry: q.ask, sl: null, tp: null, trail: 0, swap: 0, comm: 0, open: Engine.simTime - 86400, risk: null, src: null, fills: [] };
        S.positions.push(p);
        closePosition(p.id); out.closeWhy = lastReject; out.still = S.positions.includes(p);
        // its stop already crossed: nothing happens while closed; the stop can still be moved
        p.sl = q.bid + 5; checkTriggers(); out.slKept = S.positions.includes(p);
        p.sl = q.bid + 6; out.slMoved = p.sl === q.bid + 6;
        // stop-out: margin level under 50% closes only what is open (EURUSD), never the closed stock
        const e = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        p.entry = q.bid * 300; out.level = account().level; checkTriggers();
        out.after = { pos: S.positions.map(x => x.sym), h: S.history.map(h => [h.sym, h.reason]) };
        out.e = e && e.id;
        return out;
      }, fresh.toString());
      t.eq(r.open, false, 'AAPL.US is closed at 10:00 UTC'); t.eq(r.st, 'full', 'its trade status is still full');
      t.eq(r.pos, null, 'openPosition refused');
      t.ok(/^market closed — opens (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d\d:\d\d \(local\) \/ 13:35 UTC/.test(r.why), 'refusal names the opening time: ' + r.why);
      t.ok(r.toast && r.toast.title === 'Market closed' && /13:35 UTC/.test(r.toast.body), 'toast: ' + JSON.stringify(r.toast));
      t.eq(r.ord, null, 'placeOrder refused'); t.ok(/market closed/.test(r.ordWhy), r.ordWhy);
      t.ok(r.still && /market closed/.test(r.closeWhy), 'closePosition refused while closed: ' + r.closeWhy);
      t.ok(r.slKept, 'a crossed stop does not fill while the market is closed'); t.ok(r.slMoved, 'SL can be modified while closed');
      t.ok(r.level < 50, 'margin level under 50%: ' + r.level);
      t.deep(r.after, { pos: ['AAPL.US'], h: [['EURUSD', 'Stop-out']] }, 'stop-out closes only positions on open markets');
      t.noErrors(page);
      // the open: the crossed stop fills at the first quote, gap marked
      const pg = await app('', { clock: TUE_PRE });
      const g = await pg.evaluate(fresh => {
        eval(fresh)();
        const sym = 'AAPL.US', q = Engine.quote(sym);
        const p = { id: S.nextId++, sym, side: 'buy', lots: 5, entry: q.ask, sl: +(q.bid * 1.08).toFixed(2), tp: null, trail: 0, swap: 0, comm: 0, open: Engine.simTime - 86400, risk: null, src: null, fills: [] };
        S.positions.push(p); checkTriggers();
        const pre = { open: Engine.quote(sym).open, held: S.positions.includes(p) };
        Engine.speed = 60; for (let i = 0; i < 4 && S.positions.includes(p); i++) Engine.tick(1000); Engine.speed = 0;
        const h = S.history[0], f = S.fills[0];
        return { pre, open: Engine.quote(sym).open, gone: !S.positions.includes(p), h: h && { reason: h.reason, gap: h.gap, exit: h.exit }, sl: p.sl, f: f && { kind: f.kind, gap: f.gap } };
      }, fresh.toString());
      t.deep(g.pre, { open: false, held: true }, 'before the open: closed, position held');
      t.ok(g.open && g.gone, 'at the open the stop fills');
      t.eq(g.h?.reason, 'Stop loss', 'closed by its stop'); t.ok(g.h?.gap && g.h.exit < g.sl, `filled at the first quote ${g.h?.exit}, below the stop ${g.sl}, gap marked`);
      t.noErrors(pg);
    }
  },
  {
    name: 'AC4 volumes from the sheet: shares in steps of 1 (min 1), FX in 0.01, partial closes on the step; the per-order maximum from the sheet',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_STK });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const out = { norm: [normLots('AAPL.US', 2.4), normLots('AAPL.US', 2.6), normLots('EURUSD', .123), normLots('XRPUSD', 260), normLots('EURUSD', 1.005)] };
        out.open = Engine.quote('AAPL.US').open;
        const a = openPosition({ sym: 'AAPL.US', side: 'buy', lots: 2.4, dupOk: true }); out.a = a && a.lots;
        out.small = openPosition({ sym: 'AAPL.US', side: 'buy', lots: .4, dupOk: true }); out.smallWhy = lastReject;
        out.big = openPosition({ sym: 'EURUSD', side: 'buy', lots: 401, dupOk: true }); out.bigWhy = lastReject;
        out.capsAapl = orderCaps('AAPL.US', 10001);
        closePosition(a.id); // netting: a sell would offset the open buy
        const b = openPosition({ sym: 'AAPL.US', side: 'sell', lots: 3, dupOk: true });
        // UX 09.11 F10: ½ rounds down to the step and is refused under the minimum size (nothing closes)
        closePosition(b.id, 'Partial close', .5); out.half = { left: b.lots, closed: S.history[0].lots };
        closePosition(b.id, 'Partial close', .5); out.second = { left: b.lots, closed: S.history[0].lots, reason: S.history[0].reason };
        const n0 = S.history.length; closePosition(b.id, 'Partial close', .5); out.last = { open: S.positions.includes(b), added: S.history.length - n0 };
        const f = openPosition({ sym: 'EURUSD', side: 'buy', lots: .03, dupOk: true });
        closePosition(f.id, 'Partial close', .5); out.fx = { left: f.lots, closed: S.history[0].lots };
        return out;
      }, fresh.toString());
      t.deep(r.norm, [2, 3, .12, 300, 1.01], 'normLots rounds to the sheet step');
      t.ok(r.open, 'AAPL.US open at 15:00 UTC');
      t.eq(r.a, 2, '2.4 shares become 2');
      t.eq(r.small, null, 'under the minimum: refused'); t.ok(/Minimum size is 1 share/.test(r.smallWhy), r.smallWhy);
      t.eq(r.big, null, 'above the sheet maximum: refused'); t.ok(/Maximum size is 400 lots per order/.test(r.bigWhy), r.bigWhy);
      t.ok(/Maximum size is 10,000 shares per order/.test(r.capsAapl), r.capsAapl);
      t.deep(r.half, { left: 2, closed: 1 }, 'half of 3 shares closes 1 (rounded down to the step), 2 left');
      t.deep(r.second, { left: 1, closed: 1, reason: 'Partial close' }, 'half of 2 shares closes 1');
      t.deep(r.last, { open: true, added: 0 }, 'half of the last share is refused: the position stays, nothing is closed');
      t.deep(r.fx, { left: .02, closed: .01 }, 'FX partials round down on 0.01');
      t.noErrors(page);
    }
  },
  {
    name: 'AC5 CLOSE ONLY: no new position or order, reductions and closes go through',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const sym = 'NZDCHF', q = Engine.quote(sym), out = { st: tradeStatus(sym), avail: isAvailable(sym), co: closeOnly(sym), open: q.open };
        out.pos = openPosition({ sym, side: 'buy', lots: 1, dupOk: true }); out.why = lastReject;
        out.ord = placeOrder({ sym, side: 'buy', ot: 'limit', price: +(q.ask - .01).toFixed(5), lots: 1 }); out.ordWhy = lastReject;
        const p = { id: S.nextId++, sym, side: 'sell', lots: 1, entry: q.bid, sl: null, tp: null, trail: 0, swap: 0, comm: 0, open: Engine.simTime - 600, risk: null, src: null, fills: [] };
        S.positions.push(p);
        closePosition(p.id, 'Partial close', .5); out.red = p.lots;
        closePosition(p.id); out.closed = !S.positions.includes(p);
        out.full = tradeStatus('EURUSD');
        return out;
      }, fresh.toString());
      t.deep([r.st, r.avail, r.co, r.open], ['close', false, true, true], 'NZDCHF: close only on the sheet, market open');
      t.eq(r.pos, null, 'no new position'); t.ok(/close only/.test(r.why), r.why);
      t.eq(r.ord, null, 'no new order'); t.ok(/close only/.test(r.ordWhy), r.ordWhy);
      t.eq(r.red, .5, 'reduction allowed'); t.ok(r.closed, 'close allowed');
      t.eq(r.full, 'full', 'EURUSD full');
      t.noErrors(page);
    }
  },
  {
    name: 'AC6 swap from the sheet: points on FX, % a year / 360 elsewhere; triple Wednesday (FX), Friday (rest), crypto every night',
    async run({ t, app }) {
      const page = await app('', { clock: WED_ROLL });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const u = s => Date.parse(s) / 1000, N = (s, d) => rolloverNights(u(d + 'T21:00:00Z'), s);
        const days = ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25'];
        const out = {
          nights: Object.fromEntries(['EURUSD', 'US.500', 'BTCUSD'].map(s => [s, days.map(d => N(s, d))])),
          next: { any: nextRollover(u('2026-10-24T12:00:00Z')) === u('2026-10-24T21:00:00Z'), fx: nextRollover(u('2026-10-24T12:00:00Z'), 'EURUSD') === u('2026-10-26T21:00:00Z'), winter: nextRollover(u('2026-11-10T12:00:00Z'), 'EURUSD') === u('2026-11-10T22:00:00Z') },
          tri: { fx: nextTriple(u('2026-10-19T12:00:00Z'), 'EURUSD') === u('2026-10-21T21:00:00Z'), idx: nextTriple(u('2026-10-19T12:00:00Z'), 'US.500') === u('2026-10-23T21:00:00Z'), btc: nextTriple(u('2026-10-19T12:00:00Z'), 'BTCUSD') === Infinity },
          per: {
            eurL: swapPerNight('EURUSD', 'buy', 1), eurS: swapPerNight('EURUSD', 'sell', 2),
            gj: swapPerNight('GBPJPY', 'sell', 1), gjWant: CATALOG.instr.find(x => x.sym === 'GBPJPY').p.swap[1] * Engine.META.GBPJPY.point * 100000 * Engine.usd('JPY'),
            ibex: swapPerNight('IBEX35.SP', 'buy', 1), ibexN: 1 * 1 * Engine.quote('IBEX35.SP').bid * Engine.usd('EUR'),
            btcS: swapPerNight('BTCUSD', 'sell', .5), btcN: .5 * Engine.quote('BTCUSD').bid
          }
        };
        // accrual at the Wednesday rollover; a closed index position is still financed
        const e = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), b = openPosition({ sym: 'BTCUSD', side: 'buy', lots: .1, dupOk: true });
        const q = Engine.quote('US.500');
        const x = { id: S.nextId++, sym: 'US.500', side: 'sell', lots: 2, entry: q.bid, sl: null, tp: null, trail: 0, swap: 0, comm: 0, open: Engine.simTime - 600, risk: null, src: null, fills: [] };
        S.positions.push(x);
        rolloverTick(); const pre = [e.swap, b.swap, x.swap];
        Engine.speed = 60; let nb = null, nx = null;
        for (let i = 0; i < 6; i++) { Engine.tick(1000); rolloverTick(); if (b.swap && nb == null) { nb = notionalUsd('BTCUSD', .1); nx = notionalUsd('US.500', 2); } }
        Engine.speed = 0;
        out.acc = { pre, e: e.swap, b: b.swap, x: x.swap, nb, nx, t: Engine.simTime };
        return out;
      }, fresh.toString());
      t.deep(r.nights.EURUSD, [1, 1, 3, 1, 1, 0, 0], 'FX: triple on Wednesday, nothing at the weekend');
      t.deep(r.nights['US.500'], [1, 1, 1, 1, 3, 0, 0], 'index: triple on Friday');
      t.deep(r.nights.BTCUSD, [1, 1, 1, 1, 1, 1, 1], 'crypto: every night, no triple');
      t.ok(r.next.any && r.next.fx && r.next.winter, 'rollover 17:00 New York (21:00 UTC EDT, 22:00 EST); FX skips the weekend');
      t.ok(r.tri.fx && r.tri.idx, 'next triple: Wednesday for FX, Friday for an index'); t.ok(r.tri.btc, 'crypto has no triple (Infinity)');
      t.near(r.per.eurL, -9.217 * 1e-5 * 100000, 'EURUSD long: −9.217 points × point × size', 1e-9, 1e-9);
      t.near(r.per.eurS, 2 * -8.771 * 1e-5 * 100000, 'EURUSD short 2 lots: −8.771 points', 1e-9, 1e-9);
      t.near(r.per.gj, r.per.gjWant, 'GBPJPY short: points × point × size × usd(JPY)', 1e-9, 1e-12);
      t.near(r.per.ibex, r.per.ibexN * -0.05 / 360, 'IBEX35.SP: notional × (−0.05) / 360 a night', 1e-9, 1e-9);
      t.near(r.per.btcS, r.per.btcN * -0.105 / 360, 'BTCUSD short: notional × (−0.105) / 360', 1e-9, 1e-9);
      t.deep(r.acc.pre, [0, 0, 0], 'nothing before the rollover');
      t.near(r.acc.e, -9.217 * 3, 'EURUSD: three nights on Wednesday', 1e-9, 1e-9);
      t.near(r.acc.b, r.acc.nb * -0.41 / 360, 'BTCUSD: one night', 1e-3);
      t.near(r.acc.x, r.acc.nx * -0.05 / 360, 'US.500 short: one night on Wednesday, while its market is closed', 1e-3);
      t.noErrors(page);
    }
  },
  {
    name: 'AC7 minimum pending distance and maximum deviation (requote); stops and limits are not requoted; commission = sheet + extra',
    async run({ t, app }) {
      const page = await app('', { clock: TUE_FX });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const sym = 'EURUSD', q = Engine.quote(sym), pt = Engine.META[sym].point, out = {};
        out.near = placeOrder({ sym, side: 'buy', ot: 'limit', price: +(q.ask - 10 * pt).toFixed(5), lots: 1 }); out.nearWhy = lastReject;
        out.ok = !!placeOrder({ sym, side: 'buy', ot: 'limit', price: +(q.ask - 13 * pt).toFixed(5), lots: 1 });
        out.stopNear = placeOrder({ sym, side: 'sell', ot: 'stop', price: +(q.bid - 11 * pt).toFixed(5), lots: 1 });
        const u = Engine.quote('US.500');
        out.idx = placeOrder({ sym: 'US.500', side: 'sell', ot: 'limit', price: +(u.bid + 2.5).toFixed(2), lots: 1 }); out.idxWhy = lastReject;
        // requote: σ 5 pips of fill noise against a 6-point maximum deviation
        S.orders = []; Engine.speed = 1; execSeed(11); S.set.slipSd = 5;
        let req = 0, why = '', ok = 0;
        for (let i = 0; i < 20; i++) { const p = openPosition({ sym, side: i % 2 ? 'buy' : 'sell', lots: .1, dupOk: true }); if (p) ok++; else if (/^requote/.test(lastReject)) { req++; why = lastReject; } }
        out.req = { req, ok, why, devs: S.fills.filter(f => f.kind === 'open').map(f => Math.abs(f.slip) * 10) };
        let stopOk = 0, limOk = 0;
        for (let i = 0; i < 20; i++) { if (execFill({ sym, side: 'sell', kind: 'stop', ref: q.bid }).ok) stopOk++; }
        out.stopOk = stopOk;
        Engine.speed = 0; S.set.slipSd = .2; execSeed(null);
        // commission: sheet (0 on every instrument) + the simulation's extra per lot round turn
        S.positions = []; S.set.comm = 4; const bal = S.balance;
        const c = openPosition({ sym, side: 'buy', lots: 2, dupOk: true }); out.comm = { pos: c.comm, bal: bal - S.balance, of: commOf(2, sym), sheet: Engine.META[sym].p.comm };
        return out;
      }, fresh.toString());
      t.eq(r.near, null, 'buy limit 10 points away: refused (EURUSD min 12 points)');
      t.ok(/^order rejected \(Too close to the market: at least 12 points/.test(r.nearWhy), r.nearWhy);
      t.ok(r.ok, '13 points away: accepted'); t.eq(r.stopNear, null, 'a stop entry 11 points away: refused');
      t.eq(r.idx, null, 'US.500 sell limit 2.50 above: refused (min 300 points = 3.00)'); t.ok(/at least 300 points/.test(r.idxWhy), r.idxWhy);
      t.ok(r.req.req > 10, `most market fills requoted (${r.req.req} of 20)`);
      t.ok(/^requote — price moved \d+ pts$/.test(r.req.why), 'reason: ' + r.req.why);
      t.ok(r.req.devs.every(d => d <= 6 + 1e-9), 'every accepted market fill is within 6 points: ' + r.req.devs.map(d => d.toFixed(1)));
      t.eq(r.stopOk, 20, 'stop fills are never requoted');
      t.deep(r.comm, { pos: 8, bal: 8, of: 8, sheet: 0 }, 'commission: 0 from the sheet + $4 per lot extra');
      t.noErrors(page);
    }
  }
];
