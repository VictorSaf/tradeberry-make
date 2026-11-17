// Catalog v15 migration (.mace/design/catalog.md §6, rule 5): a v14 account with positions, orders, alerts, lines and
// drawings on the six retired CFDs loads with those positions closed (at the last saved price, else at the entry with
// P&L 0 and the swap kept), the orders cancelled, the rest removed and every step reported; the history is kept and
// rendered. Settings: jur eu/uk/au/us kept, pro/sim → none with the leverage kept as the choice, S.catv = 1.
const booted = page => page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
const RETIRED = 'Instrument retired (catalog v15)';

// a v14 account (no catv) and a v14 market snapshot (the G8 currencies plus the old CFD log prices)
function v14(mk) {
  const L = mk.L, eur = mk.eurusd;
  const pos = (id, sym, side, lots, entry, extra = {}) => ({ id, sym, side, lots, entry, sl: null, tp: null, trail: 0, open: mk.simTime - 3600, swap: 0, ...extra });
  return {
    state: {
      balance: 100000, peak: 100000, nextId: 20,
      positions: [pos(1, 'XAUUSD', 'buy', 1, 2400, { swap: -5, risk: 1000 }), pos(2, 'US500', 'sell', 2, 5800), pos(3, 'EURUSD', 'buy', 1, +eur.toFixed(5)), pos(4, 'BTCUSD', 'buy', .5, 60000)],
      orders: [{ id: 5, sym: 'XAUUSD', side: 'buy', ot: 'limit', price: 2300, lots: 1, slPips: 0, tpPips: 0, trail: 0, created: mk.simTime },
        { id: 6, sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(eur * .98).toFixed(5), lots: 1, slPips: 0, tpPips: 0, trail: 0, created: mk.simTime }],
      history: [{ id: 7, sym: 'GER40', side: 'buy', lots: 1, entry: 19000, exit: 19050, open: 1, close: 2, pnl: 50, pips: 50, r: null, reason: 'Manual', note: 'old dax', setup: '' },
        { id: 8, sym: 'EURUSD', side: 'sell', lots: 1, entry: 1.1, exit: 1.099, open: 1, close: 2, pnl: 100, pips: 10, r: null, reason: 'Manual', note: '', setup: '' }],
      alerts: [{ id: 9, sym: 'XAUUSD', price: 2500, cond: 'above', done: false }, { id: 10, sym: 'EURUSD', price: +(eur * 1.01).toFixed(5), cond: 'above', done: false }],
      hlines: { XAUUSD: [2400], EURUSD: [1.1] },
      drawings: { US500: [{ type: 'hline', pts: [{ t: mk.simTime, p: 5800 }] }], EURUSD: [] },
      set: { sym: 'XAUUSD', jur: 'eu', lev: 30, wl: 'metal', theme: 'light' }
    },
    market: { simTime: mk.simTime, regime: mk.regime, seed: mk.seed, rateDate: mk.rateDate, L: { ...Object.fromEntries(['USD', 'EUR', 'JPY', 'GBP', 'CHF', 'AUD', 'CAD', 'NZD'].map(c => [c, L[c]])), XAUUSD: Math.log(2450), US500: Math.log(5790), GER40: Math.log(19000), UK100: Math.log(8000), WTI: Math.log(70), BTCUSD: Math.log(61000) }, source: 'ecb' }
  };
}

export const tests = [
  {
    name: 'MG1 a v14 account on the retired CFDs boots: positions closed at the saved price with the reason, history kept and rendered, orders cancelled, jur eu kept',
    async run({ t, open }) {
      const p = await open('/tests/engine.html');
      const mk = await p.evaluate(async () => { await Engine.init(null); return { ...Engine.snapshot(), eurusd: Engine.mid('EURUSD') }; });
      const { state, market } = v14(mk);
      await p.evaluate(({ state, market }) => {
        localStorage.setItem('meridian-fx-v1', JSON.stringify(state));
        localStorage.setItem('meridian-fx-shell', JSON.stringify({ market: { savedAt: Date.now(), snap: market } }));
      }, { state, market });
      const errs = []; p.on('pageerror', e => errs.push(String(e)));
      await p.goto(p.url().replace('/tests/engine.html', '/')); await booted(p);
      const p2 = p;
      await p2.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(x => /retired/i.test(x.textContent)), null, { timeout: 3000 }).catch(() => {});
      const r = await p2.evaluate(() => {
        setTab && setTab('hist'); try { renderHistory(); } catch (e) { return { err: String(e) }; }
        const usd = c => Engine.usd(c);
        return {
          pos: S.positions.map(x => x.sym), ord: S.orders.map(x => x.sym), al: S.alerts.map(x => x.sym), hl: Object.keys(S.hlines), dr: Object.keys(S.drawings || {}),
          hist: S.history.map(h => ({ id: h.id, sym: h.sym, pnl: h.pnl, exit: h.exit, reason: h.reason, swap: h.swap })), bal: S.balance, jur: S.set.jur, lev: S.set.lev, sym: S.set.sym, catv: S.catv,
          rows: [...document.querySelectorAll('#histBody tr')].map(x => x.textContent), toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent),
          gbp: usd('GBP')
        };
      });
      if (r.err) throw new Error('history render failed: ' + r.err);
      t.deep(r.pos, ['EURUSD'], 'only the EURUSD position stays open: ' + JSON.stringify(r).slice(0, 1500));
      t.deep(r.ord, ['EURUSD'], 'the XAUUSD order is cancelled');
      t.deep(r.al, ['EURUSD'], 'the XAUUSD alert is removed');
      t.deep(r.hl, ['EURUSD'], 'the XAUUSD lines are removed');
      t.ok(!r.dr.includes('US500'), 'the US500 drawings are removed: ' + r.dr);
      const by = id => r.hist.find(h => h.id === id);
      t.eq(by(1)?.reason, 'Instrument retired (catalog v15)', 'XAUUSD closed with the reason');
      t.near(by(1).exit, 2450, 'XAUUSD at the last saved price', 1e-9);
      t.near(by(1).pnl, 50 * 100 - 5, 'XAUUSD P&L: 50 × 100 oz, swap −5 kept', 1e-9, 1e-6);
      t.near(by(2).pnl, 20, 'US500 short 2 lots, 10 points down: +$20', 1e-9, 1e-6);
      t.eq(by(4)?.reason, RETIRED, 'the v14 BTCUSD (no catv) is retired too');
      t.near(by(4).pnl, 500, 'BTCUSD 0.5 lot +1000 at the saved price', 1e-9, 1e-6);
      t.ok(by(7) && by(8), 'old history rows kept (GER40 and EURUSD)');
      t.near(r.bal, 100000 + 4995 + 20 + 500, 'balance credited with the closes', 1e-9, 1e-6);
      t.eq(r.jur, 'eu', 'jurisdiction eu kept'); t.eq(r.lev, 30, 'lev 30 kept under eu');
      t.eq(r.sym, 'EURUSD', 'chart moved off the retired symbol');
      t.eq(r.catv, 1, 'S.catv = 1');
      t.ok(r.rows.some(x => /XAUUSD/.test(x) && /2450/.test(x)), 'history panel renders the retired XAUUSD row: ' + r.rows.slice(0, 3).join(' | '));
      t.ok(r.rows.some(x => /GER40/.test(x)), 'history panel renders the old GER40 row');
      t.ok(r.toasts.some(x => /retired/i.test(x)), 'the user is told: ' + r.toasts.join(' | '));
      t.ok(!r.toasts.some(x => /not valid/.test(x)), 'retirement is not reported as invalid data: ' + r.toasts.join(' | '));
      t.deep(errs, [], 'no page errors');
      // the migrated account saves with catv 1: a reload keeps the new BTCUSD and does not retire anything again
      const again = await p2.evaluate(() => { const o = {}; const s = sanitizeState(JSON.parse(JSON.stringify(S)), o); return { n: s.positions.length, h: s.history.length, d: o.dropped || [] }; });
      t.deep(again, { n: 1, h: r.hist.length, d: [] }, 'a second pass changes nothing');
    }
  },
  {
    name: 'MG2 sanitizeState: settings migration (pro/sim → none, lev nullable, fav, wlOpen, wl on groups), catv, BTCUSD kept with catv, entry fallback without a saved price',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(() => {
        const sz = (set, extra = {}) => { const o = {}; const s = sanitizeState({ balance: 1e5, positions: [], set, ...extra }, o); return { set: s.set, catv: s.catv, d: o.dropped || [] }; };
        const q = Engine.quote('BTCUSD'), e = Engine.quote('EURUSD');
        const out = {
          pro: sz({ jur: 'pro', lev: 200 }).set, sim: sz({ jur: 'sim', lev: 100 }).set, simBad: sz({ jur: 'sim', lev: 7 }).set, us: sz({ jur: 'us', lev: 50 }).set,
          none: sz({ jur: 'none', lev: null }).set, bad: sz({ jur: 'xx', lev: 'a' }).set, old: sz({ lev: 100 }).set,
          fav: sz({ fav: ['EURUSD', 'EURUSD', 'XAUUSD', 7, 'AAPL.US', ...Engine.INSTR.slice(0, 80).map(m => m.sym)] }).set.fav,
          favBad: sz({ fav: 'EURUSD' }).set.fav,
          wlo: sz({ wlOpen: { fav: true, fx: false, 'stock:Technology': true, bad: 3, ['x'.repeat(80)]: true } }).set.wlOpen,
          wloBad: sz({ wlOpen: [1] }).set.wlOpen,
          wl: ['stock', 'agri', 'rates', 'fav', 'all', 'fx', 'metal', 'foo'].map(w => sz({ wl: w }).set.wl),
          catv: sz({}).catv
        };
        // a v15 account (catv 1) keeps its BTCUSD position
        { const o = {}; const s = sanitizeState({ balance: 1e5, catv: 1, positions: [{ id: 1, sym: 'BTCUSD', side: 'buy', lots: .5, entry: q.ask }] }, o); out.btc = { n: s.positions.length, d: o.dropped || [] }; }
        // no saved price (the market is already v15): closed at the entry, P&L = the swap only
        { const o = { market: Engine.snapshot() }; const s = sanitizeState({ balance: 1e5, positions: [{ id: 1, sym: 'WTI', side: 'buy', lots: 2, entry: 70, swap: -3 }, { id: 2, sym: 'BTCUSD', side: 'sell', lots: 1, entry: 60000 }] }, o);
          out.fb = { bal: s.balance, h: s.history.map(h => [h.sym, h.exit, h.pnl, h.reason]), d: o.dropped || [], mig: o.migrated || [] }; }
        // sizes follow the sheet: EURUSD 400 lots max, stocks whole shares
        const okp = (sym, lots, px) => { const o = {}; return sanitizeState({ balance: 1e5, catv: 1, positions: [{ id: 1, sym, side: 'buy', lots, entry: px }] }, o).positions.length; };
        const a = Engine.quote('AAPL.US');
        out.lots = [okp('EURUSD', 400, e.ask), okp('EURUSD', 401, e.ask), okp('AAPL.US', 3, a.ask), okp('AAPL.US', 1.5, a.ask), okp('BTCUSD', 11, q.ask)];
        // an import whose retirement close makes a flat negative balance is not refused (protection zeroes it)
        { const o = { market: { L: { XAUUSD: Math.log(1000) } } }; out.neg = !!sanitizeState({ balance: 1000, positions: [{ id: 1, sym: 'XAUUSD', side: 'buy', lots: 1, entry: 2400 }] }, o); }
        return out;
      });
      t.deep([r.pro.jur, r.pro.lev], ['none', 200], 'pro → none, 1:200 kept as the choice');
      t.deep([r.sim.jur, r.sim.lev], ['none', 100], 'sim → none, 1:100 kept');
      t.deep([r.simBad.jur, 'lev' in r.simBad], ['none', false], 'sim with an invalid lev → none, lev left to the default');
      t.deep([r.us.jur, r.us.lev], ['us', 50], 'us kept');
      t.deep([r.none.jur, r.none.lev], ['none', null], 'none with lev null (sheet default) kept');
      t.deep(['jur' in r.bad, 'lev' in r.bad], [false, false], 'unknown jur and lev dropped');
      t.deep(['jur' in r.old, r.old.lev], [false, 100], 'a state from before the profiles: sanitizeState adds no jur (loadState decides, suite 26)');
      t.eq(r.fav[0], 'EURUSD', 'fav keeps known symbols'); t.eq(new Set(r.fav).size, r.fav.length, 'fav without duplicates');
      t.ok(!r.fav.includes('XAUUSD') && !r.fav.includes(7), 'fav drops unknown entries'); t.eq(r.fav.length, 50, 'fav capped at 50');
      t.eq(r.favBad, undefined, 'fav not a list: dropped');
      t.deep(r.wlo, { fav: true, fx: false, 'stock:Technology': true }, 'wlOpen keeps short keys with boolean values');
      t.eq(r.wloBad, undefined, 'wlOpen not an object: dropped');
      t.deep(r.wl, ['stock', 'agri', 'rates', 'fav', 'all', 'fx', 'metal', undefined], 'wl on the catalog groups');
      t.eq(r.catv, 1, 'catv 1 on every sanitized state');
      t.deep(r.btc, { n: 1, d: [] }, 'BTCUSD position of a v15 account kept');
      t.near(r.fb.bal, 1e5 - 3, 'closed at the entry: balance changes by the swap only', 1e-12, 1e-9);
      t.deep(r.fb.h.map(h => [h[0], h[2], h[3]]), [['WTI', -3, RETIRED], ['BTCUSD', 0, RETIRED]], 'P&L 0 + swap, with the reason');
      t.eq(r.fb.h[0][1], 70, 'exit = entry when no saved price');
      t.ok(r.fb.d.length >= 2 && r.fb.mig.length === r.fb.d.length && r.fb.d.every(x => /retired/i.test(x)), 'messages in opts.dropped (and opts.migrated): ' + r.fb.d.join(' | '));
      t.deep(r.lots, [1, 0, 1, 0, 0], 'okLots on the sheet volumes (EURUSD ≤ 400, whole shares, BTCUSD ≤ 10)');
      t.eq(r.neg, true, 'a retirement loss below zero does not refuse the import');
      t.noErrors(page);
    }
  },
  {
    name: 'MG3 the feed pill says no live prices when offline; DEF is a fresh account without a jurisdiction cap',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(() => ({ text: document.getElementById('feedPill').textContent, title: document.getElementById('feedPill').title, label: Engine.SNAP_LABEL,
        def: [DEF.set.jur, DEF.set.lev, DEF.catv, Array.isArray(DEF.set.fav), JSON.stringify(DEF.set.wlOpen)],
        open: (() => { const k = S.set.wlOpen; S.set.wlOpen = JSON.parse(JSON.stringify(DEF.set.wlOpen)); S.set.fav = []; buildWatch(); renderWatch(); const g = [...wlOpen()]; S.set.wlOpen = k; return g; })() }));
      t.eq(r.text, 'OFFLINE · no live prices', 'pill text');
      t.eq(r.title, 'No live prices from the broker platform', 'pill title names the missing source');
      t.ok(!/ECB|offline seed|simulat|synthetic|SIM\b/i.test(r.text + r.title), 'no ECB / offline seed / simulated wording');
      t.deep(r.def, ['none', null, 1, true, '{}'], 'DEF: jur none, lev null (sheet default), catv 1, fav [], no folding chosen yet');
      t.deep(r.open, ['fav', 'fx'], 'with no folding chosen, Favourites and FX are open (the folding list is the phone\'s; desktop All lists everything)');
      t.noErrors(page);
    }
  }
  ,{
    name: 'MG4 ticket lots stepper follows the sheet volume: 0.01 steps on EURUSD, whole shares on AAPL.US, within [min, max]',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(() => {
        const click = dir => document.querySelector(`.ticket [data-step="lots:${dir}"]`).click(), out = {};
        setSymbol('EURUSD'); S.tk.lots = .5; click(1); out.eu = S.tk.lots; S.tk.lots = 1; click(1); out.eu1 = S.tk.lots; S.tk.lots = .01; click(-1); out.euMin = S.tk.lots; S.tk.lots = 400; click(1); out.euMax = S.tk.lots;
        setSymbol('AAPL.US'); S.tk.lots = 3; click(1); out.aa = S.tk.lots; S.tk.lots = 1; click(-1); out.aaMin = S.tk.lots; S.tk.lots = 100; click(1); out.aa100 = S.tk.lots;
        return out;
      });
      t.deep(r, { eu: .51, eu1: 1.1, euMin: .01, euMax: 400, aa: 4, aaMin: 1, aa100: 110 }, 'stepper on the sheet step');
      t.noErrors(page);
    }
  }
];
