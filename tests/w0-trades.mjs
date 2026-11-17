// Wave 0 · one trade model: history rows grouped by position id (tradesOf), net P&L after commission (netPnl),
// and the Behaviour / Exit Lab statistics built on it. Frozen market (speed 0: fills at the quote, no slippage).
export const tests = [
  {
    name: 'W0T1 tradesOf: one losing position closed in 3 steps is 1 trade; the tilt guard stays calm',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0; tiltCfg().on = true; Object.assign(tiltCfg(), { streak: 3, dayLoss: 3 }); S.tiltSt = { until: 0, trips: 0, overrides: 0, lastTrip: null };
        const sym = 'EURUSD', pip = Engine.META[sym].pip;
        const p = openPosition({ sym, side: 'buy', lots: 1, dupOk: true });
        T.move(sym, p.entry - 5 * pip);
        closePosition(p.id, 'Manual', .3); const mid = { tr: tradesOf(S.history) };
        closePosition(p.id, 'Manual', .5); closePosition(p.id, 'Manual');
        const tr = tradesOf(S.history), ts = tiltStatus();
        return { rows: S.history.length, mid: { n: mid.tr.length, complete: mid.tr[0]?.complete, lots: mid.tr[0]?.lots }, n: tr.length, x: tr[0], sumPnl: S.history.reduce((s, h) => s + h.pnl, 0), streak: ts.streak, armed: ts.armed, trips: S.tiltSt.trips, toasts: T.toasts().map(x => x.title), rev: REVENGE_MIN };
      });
      t.eq(r.rows, 3, 'three history rows');
      t.eq(r.mid.n, 1, 'after the first partial: one trade'); t.eq(r.mid.complete, false, 'still open: not complete'); t.near(r.mid.lots, .3, 'partial lots so far', 1e-9, 1e-9);
      t.eq(r.n, 1, 'one position = one trade');
      t.eq(r.x.parts, 3, 'three parts'); t.eq(r.x.complete, true, 'complete once flat'); t.near(r.x.lots, 1, 'lots summed', 1e-9, 1e-9);
      t.near(r.x.pnl, r.sumPnl, 'pnl summed', 1e-9, 1e-9); t.near(r.x.net, r.sumPnl, 'no commission: net = pnl', 1e-9, 1e-9);
      t.ok(r.x.net < 0, 'a losing trade');
      t.eq(r.streak, 1, 'one loss in a row, not three'); t.eq(r.armed, false, 'tilt guard not armed'); t.eq(r.trips, 0, 'no trip');
      t.ok(!r.toasts.includes('Tilt guard on'), 'no tilt toast: ' + r.toasts);
      t.eq(r.rev, 10, 'REVENGE_MIN = 10');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T2 overtrade: 2 positions closed in 3 parts each count as 2 trades, not 6',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0;
        const ids = ['EURUSD', 'GBPUSD'].map(sym => openPosition({ sym, side: 'buy', lots: 1, dupOk: true }).id);
        for (const id of ids) { closePosition(id, 'Manual', .3); closePosition(id, 'Manual', .5); closePosition(id, 'Manual'); }
        const ot2 = bhOvertrade();
        // and the flag still works on real trades: 4 more opens in the same hour (6 in the hour, usual pace 1.5)
        for (const sym of ['USDJPY', 'AUDUSD', 'USDCAD', 'NZDUSD']) openPosition({ sym, side: 'buy', lots: .1, dupOk: true }); // netting: four instruments, four opens
        return { rows: S.history.length, trades: tradesOf(S.history).length, ot2, ot6: bhOvertrade() };
      });
      t.eq(r.rows, 6, 'six history rows'); t.eq(r.trades, 2, 'two trades');
      t.eq(r.ot2, null, 'two opens in the hour: no overtrading flag');
      t.ok(r.ot6 && r.ot6[0] === 'overtrade' && /^7 trades in an hour/.test(r.ot6[1]), '6 distinct opens + this one = 7: ' + JSON.stringify(r.ot6));
      t.noErrors(page);
    }
  },
  {
    name: 'W0T3 commission: $20/lot on 2 lots with a +$16 move is a losing trade at net −$24.00 everywhere',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        T.reset(); S.set.comm = 20; tiltCfg().on = true;
        const sym = 'EURUSD', q0 = Engine.quote(sym);
        const p = openPosition({ sym, side: 'buy', lots: 2, dupOk: true, pm: { flags: [], codes: [], mine: ['A hunch, not my setup'], own: '', kill: '', timeStop: 0, conf: 60, mood: 'calm', broke: [], t: Engine.simTime, override: false } });
        // bid = entry + 16 / (2 lots × 100,000)
        const want = p.entry + 16 / 2e5; T.move(sym, Engine.mid(sym) + (want - Engine.quote(sym).bid));
        closePosition(p.id, 'Manual', .5); closePosition(p.id, 'Manual');
        const tr = tradesOf(S.history)[0], ts = tiltStatus();
        setTab('behav'); renderBehav();
        const L = BH_LAST, txt = document.getElementById('behav').textContent;
        await loadLazy(); const b = document.createElement('div'); drawExit(b, { exR: 'vol', exSrc: 'mine' });
        return { gross: tr.pnl, comm: tr.comm, net: tr.net, rowNet: S.history.reduce((s, h) => s + netPnl(h), 0), bal: S.balance - 100000, streak: ts.streak, dayPnl: ts.dayPnl,
          po: L.q.map(x => [x.n, x.net]), hrs: L.hrs, mood: L.moods.map(x => [x.m, x.n, x.w, x.net]), cal: L.calT, txt, lab: b.querySelector('[data-exsrc] [data-val="mine"]').textContent, q0: q0.spread };
      });
      t.near(r.gross, 16, 'gross pnl +16', 1e-6, 1e-4); t.near(r.comm, 40, 'commission $40', 1e-9, 1e-9);
      t.near(r.net, -24, 'net −24', 1e-6, 1e-4); t.near(r.rowNet, -24, 'netPnl over the rows', 1e-6, 1e-4); t.near(r.bal, -24, 'the account lost 24', 1e-6, 1e-4);
      t.eq(r.streak, 1, 'counted as a loss by the tilt guard'); t.near(r.dayPnl, -24, 'day P&L is net', 1e-6, 1e-4);
      // process vs outcome: [good/won, good/lost, poor/won, poor/lost]: no stop = poor process, lost
      t.eq(r.po[2][0], 0, 'not a win'); t.eq(r.po[3][0], 1, 'a poor-process loss'); t.near(r.po[3][1], -24, 'at net', 1e-6, 1e-4);
      t.deep(r.mood.map(x => [x[0], x[1], x[2]]), [['calm', 1, 0]], 'mood table: 1 trade, 0% won'); t.near(r.mood[0][3], -24, 'mood net', 1e-6, 1e-4);
      t.eq(r.cal, 1, 'one rated trade');
      t.ok(r.txt.includes('−$24.00'), 'Behaviour shows −$24.00');
      t.ok(!r.txt.includes('+$16') && !r.txt.includes('+$7.98'), 'no gross figure in Behaviour');
      t.eq(r.lab, 'My trades · 1', 'Exit Lab counts positions');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T4 tradesOf: the negative balance protection row is not a trade; order is newest close first',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0;
        const a = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), b = openPosition({ sym: 'GBPUSD', side: 'sell', lots: 1, dupOk: true });
        closePosition(a.id, 'Manual', .5); closePosition(b.id, 'Manual'); Engine.simTime += 60; closePosition(a.id, 'Manual');
        S.history.unshift({ id: S.nextId++, sym: 'EURUSD', side: 'nbp', lots: 0, entry: 1, exit: 1, open: Engine.simTime, close: Engine.simTime, pnl: 500, pips: 0, r: null, reason: 'Negative balance protection', note: '', setup: '', swap: 0, nbp: true });
        const tr = tradesOf(S.history);
        return { ids: tr.map(x => x.id), want: [a.id, b.id], nbp: tr.some(x => x.nbp || x.side === 'nbp'), parts: tr.map(x => x.parts), netOf: netPnl({ pnl: 10, comm: 3 }), netNo: netPnl({ pnl: 10 }), empty: tradesOf([]).length };
      });
      t.deep(r.ids, r.want, 'one per id, newest last-part close first'); t.deep(r.parts, [2, 1], 'parts');
      t.eq(r.nbp, false, 'NBP row excluded'); t.eq(r.netOf, 7, 'netPnl = pnl − comm'); t.eq(r.netNo, 10, 'missing comm = 0'); t.eq(r.empty, 0, 'empty history');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T5 Behaviour escapes free text: a close reason and a news tag with <img onerror> show as text',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0; window.__x = 0;
        const bad = '<img src=x onerror="window.__x=1">';
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true, pm: { flags: [], codes: [], mine: [], own: bad, kill: bad, timeStop: 0, conf: null, mood: null, broke: [], t: Engine.simTime, override: false } });
        p.news = [bad];
        closePosition(p.id, bad);
        setTab('behav'); renderBehav();
        const el = document.getElementById('behav');
        return { img: el.querySelectorAll('img').length, txt: el.textContent.split(bad).length - 1 };
      });
      await page.waitForTimeout(100);
      t.eq(r.img, 0, 'no <img> element in Behaviour');
      t.ok(r.txt >= 3, 'the raw text is shown (reason, news, expected, exit plan): ' + r.txt);
      t.eq(await page.evaluate(() => window.__x), 0, 'onerror never ran');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T6 a corrupt disposition state never blocks closePosition',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const out = [];
        for (const bad of ['x', null, { rg: 'a', ev: 'no' }, { rg: 1, rl: 0, pg: 0, pl: 0, ev: [null] }]) {
          T.reset(); S.set.comm = 0; S.dispo = bad;
          const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), q = openPosition({ sym: 'GBPUSD', side: 'buy', lots: 1, dupOk: true });
          let err = null; try { closePosition(p.id, 'Manual'); } catch (e) { err = String(e); }
          out.push({ err, closed: !S.positions.some(x => x.id === p.id), rows: S.history.length, ok: typeof S.dispo === 'object' && Array.isArray(S.dispo.ev) && Number.isFinite(S.dispo.rg) && Number.isFinite(S.dispo.pl), ds: (() => { try { return dispoStats().n; } catch (e) { return 'throws'; } })() });
          void q;
        }
        return out;
      });
      r.forEach((x, i) => {
        t.eq(x.err, null, `case ${i}: closePosition does not throw`); t.eq(x.closed, true, `case ${i}: position closed`); t.eq(x.rows, 1, `case ${i}: history row written`);
        t.eq(x.ok, true, `case ${i}: dispo state repaired`); t.ok(Number.isFinite(x.ds), `case ${i}: dispoStats works: ${x.ds}`);
      });
      t.noErrors(page);
    }
  },
  {
    name: 'W0T7 disposition judges the position at net; the post-mortem answer lands on every part',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 20; S.dispo = null;
        const sym = 'EURUSD';
        const p = openPosition({ sym, side: 'buy', lots: 2, dupOk: true, pm: { flags: [], codes: [], mine: [], own: 'my idea', kill: '', timeStop: 0, conf: null, mood: null, broke: [], t: Engine.simTime, override: false } });
        // Odean counts portfolios of two or more positions: a second one stays open (a paper loss after the commission)
        openPosition({ sym: 'GBPUSD', side: 'buy', lots: 1, dupOk: true });
        const want = p.entry + 16 / 2e5; T.move(sym, Engine.mid(sym) + (want - Engine.quote(sym).bid));
        closePosition(p.id, 'Manual', .5); const d1 = { ...S.dispo, ev: undefined };
        closePosition(p.id, 'Manual'); const d2 = { ...S.dispo, ev: undefined };
        setTab('behav'); renderBehav();
        document.querySelector(`#behav [data-hit="${p.id}"][data-v="1"]`).click();
        return { d1, d2, hit: S.history.map(h => h.pmHit), tr: tradesOf(S.history)[0].pmHit, on: !!document.querySelector(`#behav [data-hit="${p.id}"][data-v="1"].on`) };
      });
      t.deep([r.d1.rg, r.d1.rl, r.d2.rg, r.d2.rl], [0, 1, 0, 2], 'both sales of a net-losing position count as realised losses');
      t.deep(r.hit, [true, true], 'pmHit on both rows'); t.eq(r.tr, true, 'tradesOf carries it'); t.ok(r.on, 'the button shows the answer');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T8 an AAPL.US trade goes through the pre-mortem and the tilt guard in shares and points; an unknown symbol is refused cleanly',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-20T15:00:00Z') }); // Tuesday, US stocks open
      const r = await page.evaluate(async () => {
        T.reset(); S.set.jur = 'none'; S.set.lev = null; S.set.comm = 0;
        Object.assign(pmCfg(), { on: true, minRisk: .01, noSL: true }); Object.assign(tiltCfg(), { on: true, streak: 3, dayLoss: 50, cool: 15 }); S.tiltSt = { until: 0, trips: 0, overrides: 0, lastTrip: null };
        const out = {};
        out.unknown = openPosition({ sym: 'XAUUSD', side: 'buy', lots: 1, dupOk: true }); out.unknownWhy = lastReject;
        const sym = 'AAPL.US', q = Engine.quote(sym), sl = +(q.ask - 2).toFixed(2);
        out.spread = q.spread; out.stopPts = (q.ask - sl) / Engine.META[sym].pip;
        out.gated = openPosition({ sym, side: 'buy', lots: 10, sl, dupOk: true });
        const g = document.getElementById('pmGate');
        out.shown = !!g && !g.hidden; out.summary = g.querySelector('.pm-trade').textContent;
        out.flags = [...g.querySelectorAll('.pm-flags li')].map(x => x.textContent);
        g.querySelector('.pm-chip input').click(); document.getElementById('pmGo').click();
        const p = S.positions[0]; out.pos = p && { sym: p.sym, lots: p.lots, ctx: p.ctx, pm: !!p.pm };
        // three losing round trips (the spread alone) arm the tilt guard; the next trade gets the gate with the tilt banner
        for (let k = 0; k < 3; k++) { const x = openPosition({ sym, side: 'buy', lots: 1, dupOk: true, pmDone: true }); closePosition(x.id, 'Manual'); }
        const ts = tiltStatus(); out.tilt = { armed: ts.armed, streak: ts.streak };
        out.second = openPosition({ sym, side: 'buy', lots: 1, sl, dupOk: true });
        out.tiltShown = !g.hidden && !!g.querySelector('.pm-tilt'); out.summary2 = g.querySelector('.pm-trade').textContent;
        setSymbol(sym); out.warn = tkWarnings(tkCalc('buy')).find(w => /Tilt guard/.test(w)) || null;
        return out;
      });
      t.eq(r.unknown, null, 'a retired symbol is refused'); t.ok(/unknown instrument/i.test(r.unknownWhy), r.unknownWhy);
      t.eq(r.gated, null, 'the pre-mortem gate holds the trade'); t.ok(r.shown, 'gate shown');
      t.ok(/10 shares/.test(r.summary) && !/10\.00/.test(r.summary), 'size in shares: ' + r.summary);
      const cost = r.flags.find(f => /^Spread is/.test(f));
      t.ok(cost, 'cost flag: ' + r.flags.join(' | '));
      t.ok(cost.startsWith(`Spread is ${(r.spread / r.stopPts * 100).toFixed(0)}% of the stop distance`), 'spread vs stop in the same unit: ' + cost);
      t.ok(!r.flags.some(f => /pip/.test(f)), 'no pips on a stock: ' + r.flags.join(' | '));
      t.ok(r.pos && r.pos.sym === 'AAPL.US' && r.pos.lots === 10 && r.pos.pm && r.pos.ctx.includes('cost'), 'placed after the pre-mortem: ' + JSON.stringify(r.pos));
      t.deep(r.tilt, { armed: true, streak: 3 }, 'tilt guard armed by three losses');
      t.eq(r.second, null, 'next trade held'); t.ok(r.tiltShown, 'tilt banner in the gate'); t.ok(/1 share/.test(r.summary2) && !/shares/.test(r.summary2), 'one share: ' + r.summary2);
      t.ok(r.warn, 'ticket warning carries the tilt guard');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T9 sessions: a time stop on a closed market waits for the open (no refusal every second); red flag for a close within the hour',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-20T19:30:00Z') }); // AAPL.US closes at 19:55 UTC
      const r = await page.evaluate(() => {
        T.reset(); S.set.jur = 'none'; S.set.lev = null; S.set.comm = 0;
        const sym = 'AAPL.US', q = Engine.quote(sym), out = {};
        const flags = pmFlags({ sym, side: 'buy', lots: 1, sl: q.ask - 3 }, pmRisk({ sym, side: 'buy', lots: 1, sl: q.ask - 3 }));
        out.gap = (flags.find(f => f[0] === 'gap') || [])[1] || null;
        out.fxGap = pmFlags({ sym: 'EURUSD', side: 'buy', lots: 1 }, pmRisk({ sym: 'EURUSD', side: 'buy', lots: 1 })).some(f => f[0] === 'gap');
        const p = openPosition({ sym, side: 'buy', lots: 1, dupOk: true, pmDone: true }); p.timeStop = 60;
        Engine.jumpX(sym, -.02);
        Engine.speed = 600; for (let i = 0; i < 3; i++) Engine.tick(1000); Engine.speed = 0; // 19:30 → 20:00, past the close
        out.closed = !Engine.quote(sym).open;
        T.clearToasts(); lastReject = '';
        bhTick(); bhTick();
        out.open = S.positions.includes(p); out.titles = T.toasts().map(x => x.title); out.rej = lastReject;
        return out;
      });
      t.ok(r.gap && /closes in \d+ min/.test(r.gap) && /gap/.test(r.gap), 'close-within-the-hour flag: ' + r.gap);
      t.eq(r.fxGap, false, 'FX on a Tuesday: no close soon');
      t.ok(r.closed, 'market closed'); t.ok(r.open, 'the time stop waits'); t.deep(r.titles, [], 'no toast'); t.eq(r.rej, '', 'no refusal');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T10 drawings on dotted symbols: trendlines run on trading time, alerts sleep while the market is closed, moves in the unit',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-20T20:30:00Z') }); // US stocks closed, US.500 open
      const r = await page.evaluate(() => {
        const H = s => Date.parse(s) / 1000, a = { t: H('2026-10-19T15:00:00Z'), p: 100 }, b = { t: H('2026-10-20T15:00:00Z'), p: 110 };
        const out = {
          atClose: lineAt(a, b, H('2026-10-19T19:55:00Z'), 'AAPL.US'), inGap: lineAt(a, b, H('2026-10-19T23:00:00Z'), 'AAPL.US'),
          fx: lineAt(a, b, H('2026-10-20T03:00:00Z'), 'EURUSD'),
          mvStk: drMoveText('AAPL.US', 1.5), mvFx: drMoveText('EURUSD', .0015)
        };
        T.clearToasts();
        const now = Engine.simTime, mk = (sym, side) => ({ id: 'd' + sym, type: 'trend', pts: [{ t: now - 7200, p: Engine.quote(sym).bid * .9 }, { t: now - 3600, p: Engine.quote(sym).bid * .9 }], color: '#e8b04a', alert: true, side });
        S.drawings = { 'AAPL.US': [mk('AAPL.US', -1)], 'US.500': [mk('US.500', -1)] };
        checkDrawAlerts();
        out.titles = T.toasts().map(x => x.title); out.stk = S.drawings['AAPL.US'][0].done || false; out.idx = S.drawings['US.500'][0].done || false;
        return out;
      });
      t.near(r.atClose, 100 + 10 * 295 / 380, 'at the close: 4 h 55 of the 6 h 20 of trading time between the anchors', 1e-9, 1e-9);
      t.near(r.inGap, r.atClose, 'flat while the market is closed', 1e-9, 1e-9);
      t.near(r.fx, 100 + 10 * 12 / 24, 'FX on a weekday: time-linear', 1e-9, 1e-9);
      t.eq(r.mvStk, '+150.0 pt', 'stock move in points'); t.eq(r.mvFx, '+15.0 pips', 'FX move in pips');
      t.eq(r.stk, false, 'AAPL.US alert does not fire while closed'); t.eq(r.idx, true, 'US.500 alert fires on the crossing');
      t.deep(r.titles, ['Trendline alert · US.500'], 'one toast, on the dotted symbol');
      t.noErrors(page);
    }
  },
  {
    name: 'W0T11 chart long-press on a stock: size in shares, at the bid/ask; closed market shows why and offers only the alert',
    async run({ t, app }) {
      const out = [];
      for (const clock of ['2026-10-20T15:00:00Z', '2026-10-20T20:30:00Z']) {
        const page = await app('', { clock: new Date(clock) });
        out.push(await page.evaluate(async () => {
          T.reset(); S.set.jur = 'none'; S.set.lev = null; setSymbol('AAPL.US');
          for (let i = 0; i < 50 && typeof window.chartLongPress !== 'function'; i++) await new Promise(r => setTimeout(r, 100));
          await new Promise(r => setTimeout(r, 300));
          window.chartLongPress(innerWidth / 2, 200);
          const pop = document.querySelector('.lp-pop');
          return { head: pop && pop.querySelector('.lp-h').textContent, orders: pop ? pop.querySelectorAll('[data-sd]').length : -1, alert: pop ? pop.querySelectorAll('[data-al]').length : -1, text: pop && pop.textContent };
        }));
        t.noErrors(page);
      }
      t.ok(/\d+ shares?/.test(out[0].head) && !/lots/.test(out[0].head), 'open: size in shares: ' + out[0].head);
      t.eq(out[0].alert, 1, 'alert offered');
      t.eq(out[1].orders, 0, 'closed: no order buttons'); t.eq(out[1].alert, 1, 'closed: the alert stays');
      t.ok(/Market closed/.test(out[1].text) && /opens/.test(out[1].text), 'closed: says why: ' + out[1].text);
    }
  }
];
