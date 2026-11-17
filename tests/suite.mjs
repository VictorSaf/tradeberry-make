// Test cases: money (P&L, margin, stop-out, order triggers), external data (sanitizeState, import), order-entry
// safety, the opt-in demo and the seeded engine. Expected values are computed here from raw quotes and catalog.js,
// not by app code. Trading pages pin the clock (clock: true, Friday 10:30 UTC) so the FX market is open (v15
// sessions: nothing trades over the weekend). PIVOT ON BID: T.move sets the bid; ask = bid + the sheet's spread.
const LOT = 100000;
// USD value of one unit of the quote currency, from mids only
const quoteUsd = (sym, mids) => sym.endsWith('USD') ? 1 : sym === 'USDJPY' ? 1 / mids.USDJPY : sym === 'EURGBP' ? mids.GBPUSD : NaN;
const PIP = { EURUSD: .0001, USDJPY: .01, EURGBP: .0001 };
// usdFmt-style signed dollars, two decimals
const usd2 = v => (v < 0 ? '−' : '+') + '$' + Math.abs(v).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const BASE_USD = (sym, mids) => sym.startsWith('USD') ? 1 : sym.startsWith('EUR') ? mids.EURUSD : NaN;

export const tests = [
  {
    name: '01 pip value and P&L (EURUSD, USDJPY, EURGBP)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      for (const sym of ['EURUSD', 'USDJPY', 'EURGBP']) {
        for (const side of ['buy', 'sell']) {
          const r = await page.evaluate(({ sym, side }) => {
            T.reset();
            const mids = () => ({ EURUSD: Engine.mid('EURUSD'), USDJPY: Engine.mid('USDJPY'), GBPUSD: Engine.mid('GBPUSD') });
            const pv = pipValue(sym, 1), m0 = mids(), q0 = Engine.quote(sym);
            const p = openPosition({ sym, side, lots: 1.37, dupOk: true });
            // move 35 pips in favour of a buy (against a sell)
            T.move(sym, q0.mid + 35 * Engine.META[sym].pip);
            const q1 = Engine.quote(sym), m1 = mids(), fl = posPnl(p), bal0 = S.balance;
            closePosition(p.id, 'Manual');
            return { pv, m0, q0, m1, q1, entry: p.entry, fl, bal: S.balance - bal0, h: S.history[0], open: S.positions.length };
          }, { sym, side });
          t.near(r.pv, LOT * PIP[sym] * quoteUsd(sym, r.m0), `${sym} pip value per lot`);
          t.near(r.entry, side === 'buy' ? r.q0.ask : r.q0.bid, `${sym} ${side} entry side (on the instrument's grid)`, 0, 6e-5 * (sym.endsWith('JPY') ? 100 : 1) / 10);
          const exit = side === 'buy' ? r.q1.bid : r.q1.ask, d = side === 'buy' ? 1 : -1;
          const pnl = (exit - r.entry) * d * 1.37 * LOT * quoteUsd(sym, r.m1);
          t.near(r.fl.pnl, pnl, `${sym} ${side} floating P&L`, 1e-9, 1e-6);
          t.near(r.fl.pips, (exit - r.entry) * d / PIP[sym], `${sym} ${side} pips`, 1e-9, 1e-9);
          // the close fills on the instrument's grid: the booked P&L is the one the shown prices make
          const exitG = +exit.toFixed(sym.endsWith('JPY') ? 3 : 5), pnlG = (exitG - r.entry) * d * 1.37 * LOT * quoteUsd(sym, r.m1);
          t.near(r.bal, pnlG, `${sym} ${side} balance change on close`, 1e-9, 1e-6);
          t.near(r.h.pnl, pnlG, `${sym} ${side} history P&L`, 1e-9, 1e-6);
          t.near(r.h.exit, exit, `${sym} ${side} exit price`, 0, 6e-5 * (sym.endsWith('JPY') ? 100 : 1) / 10);
          t.eq(r.open, 0, `${sym} ${side} position closed`);
          t.ok(side === 'buy' ? pnl > 0 : pnl < 0, `${sym} ${side} sign of P&L after an up move`);
        }
      }
      t.noErrors(page);
    }
  },
  {
    name: '02 margin and margin level',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); // default profile: EU retail, majors at 1:30
        const mids = { EURUSD: Engine.mid('EURUSD'), USDJPY: Engine.mid('USDJPY'), GBPUSD: Engine.mid('GBPUSD') };
        const ps = [['EURUSD', 'buy', 2], ['USDJPY', 'sell', 3], ['EURGBP', 'buy', 1.5]].map(([sym, side, lots]) => openPosition({ sym, side, lots, dupOk: true }));
        const a30 = account(), fl = ps.reduce((s, p) => s + posPnl(p).pnl, 0);
        // the initial margin is fixed per position (decision 35): a profile change goes through applyProfile, which rescales it
        applyProfile('sim:100'); const a100 = account();
        applyProfile('none:200'); const a200 = account();
        return { mids, a30, a100, a200, fl, n: S.positions.length, bal: S.balance };
      });
      t.eq(r.n, 3, 'three positions open');
      const notional = 2 * LOT * BASE_USD('EURUSD', r.mids) + 3 * LOT * 1 + 1.5 * LOT * BASE_USD('EURGBP', r.mids);
      t.near(r.a30.mg, notional / 30, 'used margin under EU retail (majors 1:30)', 1e-9, 1e-6);
      t.near(r.a30.eq, r.bal + r.fl, 'equity = balance + floating', 1e-12, 1e-6);
      t.near(r.a30.free, r.a30.eq - r.a30.mg, 'free margin', 1e-9, 1e-6);
      t.near(r.a30.level, r.a30.eq / r.a30.mg * 100, 'margin level %', 1e-9, 1e-9);
      t.near(r.a100.mg, notional / 100, 'unrestricted simulation at 1:100', 1e-9, 1e-6);
      t.near(r.a200.mg, notional / 200, 'margin halves at 1:200', 1e-9, 1e-6);
      t.ok(r.a30.fl < 0, 'fresh positions are down by the spread');
      t.noErrors(page);
    }
  },
  {
    name: '03 stop-out below 50% closes the worst position first',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const a = openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, dupOk: true });
        const b = openPosition({ sym: 'USDJPY', side: 'buy', lots: 10, dupOk: true });
        a.entry = Engine.quote('EURUSD').bid + .0720; // 720 pips x $100/pip = -$72,000 floating; EU retail margin ~$70k
        const before = account().level;
        checkTriggers();
        return { before, after: account().level, open: S.positions.map(p => p.id), a: a.id, b: b.id, h: S.history.map(h => [h.id, h.reason]) };
      });
      t.ok(r.before < 50, `margin level before the check is below 50% (${r.before.toFixed(1)}%)`);
      t.deep(r.h, [[r.a, 'Stop-out']], 'only the worst position is stopped out');
      t.deep(r.open, [r.b], 'the other position stays open');
      t.ok(r.after >= 50, `margin level after stop-out is back above 50% (${r.after.toFixed(1)}%)`);
      t.noErrors(page);
    }
  },
  {
    name: '04 pending limit/stop fill on the correct side; a refused fill cancels the order',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      // limits: the other side of the quote reaches the price first (must not fill); stops: the own side reaches it
      // first while the other side has not (must fill). Between the two, a straddle (bid < price < ask) decides.
      for (const [side, ot] of [['buy', 'limit'], ['buy', 'stop'], ['sell', 'limit'], ['sell', 'stop']]) {
        const r = await page.evaluate(({ side, ot }) => {
          T.reset();
          const sym = 'EURUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym), sp = q.ask - q.bid, h = sp / 2, eps = h / 2;
          const d = side === 'buy' ? 1 : -1, touch = d > 0 ? q.ask : q.bid, sgn = ot === 'limit' ? -d : d;
          const price = +(touch + sgn * 10 * pip).toFixed(5);
          placeOrder({ sym, side, ot, price, lots: .5, slPips: 0, tpPips: 0, trail: 0 });
          const placed = S.orders.length, res = { placed, price };
          const own = () => { const x = Engine.quote(sym); return d > 0 ? x.ask : x.bid; };
          const other = () => { const x = Engine.quote(sym); return d > 0 ? x.bid : x.ask; };
          const ownTo = x => T.move(sym, d > 0 ? x - sp : x); // put the own side of the quote at x (T.move sets the bid)
          if (ot === 'limit') {
            ownTo(price + d * h); // straddle: the other side is through the limit, the own side is not
            res.setup = d > 0 ? other() <= price && own() > price : other() >= price && own() < price;
            checkTriggers(); res.early = S.positions.length;
            ownTo(price - d * eps); // own side through the limit
          } else {
            ownTo(price - d * eps); // own side just short of the stop
            checkTriggers(); res.early = S.positions.length;
            ownTo(price + d * h); // straddle: own side through the stop, the other side is not
            res.setup = d > 0 ? own() >= price && other() < price : own() <= price && other() > price;
          }
          res.fillAt = own(); checkTriggers();
          return { ...res, n: S.positions.length, orders: S.orders.length, entry: S.positions[0]?.entry, side: S.positions[0]?.side };
        }, { side, ot });
        const tag = `${side} ${ot}`, own = side === 'buy' ? 'ask' : 'bid';
        t.eq(r.placed, 1, `${tag} placed`);
        t.ok(r.setup, `${tag}: straddle set up (bid < price < ask)`);
        t.eq(r.early, 0, ot === 'limit' ? `${tag} does not fill when only the ${side === 'buy' ? 'bid' : 'ask'} reaches the price` : `${tag} does not fill before the ${own} reaches the price`);
        t.eq(r.n, 1, `${tag} fills when the ${own} reaches the price`);
        t.eq(r.side, side, `${tag} opens a ${side}`);
        t.eq(r.orders, 0, `${tag} leaves the book after filling`);
        t.near(r.entry, r.fillAt, `${tag} fills at the ${own}`, 1e-9, 1e-9);
      }
      // a fill refused for margin: the order is removed and a toast says so
      const r = await page.evaluate(() => {
        T.reset(); S.set.lev = 30;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true }); // uses ~$75k of margin
        const sym = 'GBPUSD', pip = Engine.META[sym].pip, q = Engine.quote(sym), price = +(q.ask - 5 * pip).toFixed(5);
        placeOrder({ sym, side: 'buy', ot: 'limit', price, lots: 10, slPips: 0, tpPips: 0, trail: 0 });
        const placed = S.orders.length; T.clearToasts();
        T.move(sym, price - (q.ask - q.bid));
        checkTriggers();
        return { placed, orders: S.orders.length, pos: S.positions.map(p => p.sym), toasts: T.toasts() };
      });
      t.eq(r.placed, 1, 'oversized limit order accepted into the book');
      t.eq(r.orders, 0, 'refused fill removes the order');
      t.deep(r.pos, ['EURUSD'], 'no GBPUSD position after a refused fill');
      const c = r.toasts.find(x => x.title === 'Pending order cancelled');
      t.ok(c, 'toast "Pending order cancelled" shown: ' + JSON.stringify(r.toasts));
      t.ok(/insufficient margin/i.test(c.body), 'cancel toast names the margin reason: ' + c.body);
      t.noErrors(page);
    }
  },
  {
    name: '05 SL/TP: buy triggers on bid, sell triggers on ask',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      for (const side of ['buy', 'sell']) {
        const r = await page.evaluate(side => {
          const sym = 'USDJPY', pip = Engine.META[sym].pip, d = side === 'buy' ? 1 : -1, res = {};
          // SL at the midpoint of the quote: the closing side (bid for a buy, ask for a sell) is already through it, the other is not
          T.reset();
          const midpt = x => (x.bid + x.ask) / 2;
          let p = openPosition({ sym, side, lots: 1, dupOk: true }), q = Engine.quote(sym);
          p.sl = midpt(q); checkTriggers();
          res.sl = { h: S.history[0] && [S.history[0].reason, S.history[0].exit], q, open: S.positions.length };
          // TP at the midpoint: the opening side is through it, the closing side is not -> stays open
          T.reset();
          p = openPosition({ sym, side, lots: 1, dupOk: true }); q = Engine.quote(sym);
          p.tp = midpt(q); checkTriggers();
          res.tpEarly = S.positions.length;
          // closing side reaches the TP, past the entry (a target in profit); T.move sets the bid, a sell closes on the ask
          T.move(sym, p.entry + d * .2 * pip - (d > 0 ? 0 : q.ask - q.bid));
          const q2 = Engine.quote(sym); checkTriggers();
          res.tp = { h: S.history[0] && [S.history[0].reason, S.history[0].exit], q: q2, open: S.positions.length };
          return res;
        }, side);
        const close = q => side === 'buy' ? q.bid : q.ask;
        t.eq(r.sl.open, 0, `${side} SL closes when the ${side === 'buy' ? 'bid' : 'ask'} crosses it`);
        t.eq(r.sl.h[0], 'Stop loss', `${side} SL reason`); t.near(r.sl.h[1], close(r.sl.q), `${side} SL exit price`, 1e-9, 1e-9);
        t.eq(r.tpEarly, 1, `${side} TP does not trigger on the ${side === 'buy' ? 'ask' : 'bid'}`);
        t.eq(r.tp.open, 0, `${side} TP closes when the ${side === 'buy' ? 'bid' : 'ask'} reaches it`);
        t.eq(r.tp.h[0], 'Take profit', `${side} TP reason`); t.near(r.tp.h[1], close(r.tp.q), `${side} TP exit price`, 1e-9, 1e-9);
      }
      t.noErrors(page);
    }
  },
  {
    name: '06 sanitizeState: prototype, lots, enums, duplicate ids',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const raw = JSON.parse(`{"__proto__": {"polluted": "yes"}, "balance": 5000, "nextId": 3,
          "positions": [
            {"id": 7, "sym": "EURUSD", "side": "buy", "lots": 1, "entry": 1.1},
            {"id": 7, "sym": "USDJPY", "side": "sell", "lots": 2, "entry": 150},
            {"id": 8, "sym": "EURUSD", "side": "buy", "lots": "1", "entry": 1.1},
            {"id": 9, "sym": "EURUSD", "side": "buy", "lots": -1, "entry": 1.1},
            {"id": 10, "sym": "EURUSD", "side": "buy", "lots": 0, "entry": 1.1},
            {"id": 11, "sym": "EURUSD", "side": "buy", "lots": 1, "entry": 1.1, "constructor": {"prototype": {"polluted": "yes"}}}
          ],
          "orders": [{"id": 7, "sym": "EURUSD", "side": "buy", "ot": "limit", "price": 1.05, "lots": 1}],
          "history": [], "alerts": [{"id": 11, "sym": "EURUSD", "price": 1.2, "cond": "above"}],
          "set": {"lev": 0, "tf": 0, "speed": 0, "sym": "XXXYYY", "theme": "<b>"}}`);
        const s = sanitizeState(raw);
        loadState(raw);
        const ids = [...S.positions, ...S.orders, ...S.alerts].map(x => x.id), uniq = l => new Set(l.map(x => x.id)).size === l.length;
        return {
          proto: Object.getPrototypeOf(s) === Object.prototype, polluted: s.polluted, globalPolluted: ({}).polluted,
          posProto: s.positions.every(p => Object.getPrototypeOf(p) === Object.prototype && p.polluted === undefined && !Object.prototype.hasOwnProperty.call(p, 'constructor')),
          lots: s.positions.map(p => p.lots), syms: s.positions.map(p => p.sym), setKeys: Object.keys(s.set),
          lev: S.set.lev, jur: S.set.jur, def: { lev: DEF.set.lev, jur: DEF.set.jur }, tf: S.set.tf, sym: S.set.sym, theme: S.set.theme, ids, unique: [S.positions, S.orders, S.alerts].every(uniq), posIds: S.positions.map(x => x.id), nextId: S.nextId, maxId: Math.max(...ids),
          nullish: sanitizeState(null), arr: sanitizeState([1, 2])
        };
      });
      t.ok(r.proto, 'result keeps Object.prototype');
      t.eq(r.polluted, undefined, '__proto__ payload does not reach the result');
      t.eq(r.globalPolluted, undefined, 'Object.prototype not polluted');
      t.ok(r.posProto, 'records keep a plain prototype and lose constructor keys');
      t.deep(r.lots, [1, 2, 1], 'text, negative and zero lots are dropped');
      t.deep(r.syms, ['EURUSD', 'USDJPY', 'EURUSD'], 'valid positions kept in order');
      t.deep(r.setKeys, [], 'invalid lev/tf/speed/sym/theme are removed');
      t.eq(r.lev, r.def.lev, 'lev=0 resets to the default');
      t.eq(r.jur, r.def.jur, 'the default jurisdiction');
      t.eq(r.tf, 15, 'tf=0 resets to the default 15');
      t.eq(r.sym, 'EURUSD', 'unknown symbol resets');
      t.eq(r.theme, 'dark', 'bad theme resets');
      t.ok(r.unique, 'ids are unique within each list after load: ' + r.ids);
      t.eq(r.posIds[0], 7, 'the first holder of a duplicate id keeps it');
      t.ok(r.posIds[1] !== 7, 'the duplicate position id is renumbered');
      t.ok(r.nextId > r.maxId, 'nextId is above every id in use');
      t.eq(r.nullish, null, 'null state is rejected');
      t.eq(r.arr, null, 'array state is rejected');
      t.noErrors(page);
    }
  },
  {
    name: '07 importAccount with an XSS payload does not execute',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(() => {
        const x = '<img src=x onerror="window.__xss=(window.__xss||0)+1">';
        const st = {
          __proto__: null, balance: 123456, positions: [{ id: 1, sym: 'EURUSD', side: 'buy', lots: 1, entry: Engine.mid('EURUSD'), note: x }],
          orders: [], alerts: [{ id: 3, sym: 'EURUSD', price: 9, cond: 'above', note: x }],
          history: [{ id: 2, sym: 'EURUSD', side: 'sell', lots: 1, entry: 1.1, exit: 1.09, pnl: 1000, pips: 100, open: 1, close: 2, reason: x, note: x, setup: x }],
          set: { theme: x, sym: x }, tk: { side: x }
        };
        const json = `{"app":"meridian-fx","version":1,"state":${JSON.stringify(st).replace('{', '{"__proto__":{"polluted":1},')}}`;
        importAccount(new File([json], 'evil.json', { type: 'application/json' }));
      });
      await page.waitForFunction(() => S.balance === 123456, null, { timeout: 5000 });
      // render every surface that shows imported text
      await page.evaluate(() => { for (const tab of ['positions', 'history', 'alerts', 'journal']) { try { setTab(tab); } catch (e) { } } frame(true, true); });
      await page.waitForTimeout(600);
      const r = await page.evaluate(() => ({
        xss: window.__xss, imgs: document.querySelectorAll('img[onerror]').length, polluted: ({}).polluted,
        reason: S.history[0]?.reason, theme: S.set.theme, sym: S.set.sym, side: S.tk.side, toasts: T.toasts().map(x => x.title)
      }));
      t.ok(r.toasts.includes('Account imported'), 'import reported: ' + r.toasts);
      t.eq(r.xss, undefined, 'onerror handler never ran');
      t.eq(r.imgs, 0, 'no injected <img onerror> in the DOM');
      t.eq(r.polluted, undefined, 'Object.prototype not polluted');
      t.eq(r.reason, '<img src=x onerror="window.__xss=(window.__xss||0)+1">', 'imported text kept as written (shown as text, never parsed)');
      t.eq(r.theme, 'dark', 'bad theme rejected');
      t.eq(r.sym, 'EURUSD', 'bad symbol rejected');
      t.eq(r.side, 'buy', 'bad ticket side rejected');
      t.noErrors(page);
    }
  },
  {
    name: '08 ticket blocks oversize and margin, command bar needs a second Enter, one-click off by default',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const out = {};
        out.oneClick = S.set.oneClick;
        T.reset();
        // 500 lots (sheet maximum 400): blocked on the button and in submitTicket
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 500, useSL: true, sl: 20, useTP: false });
        renderTicket();
        out.big = { disabled: document.querySelector('#tkSubmit').disabled, label: document.querySelector('#tkSubmit').textContent, why: tkBlocks(tkCalc()).map(b => b.why) };
        submitTicket(); out.big.pos = S.positions.length; out.big.toast = T.toasts().map(x => x.title);
        out.bigDirect = openPosition({ sym: 'EURUSD', side: 'buy', lots: 500, dupOk: true });
        // insufficient margin: 1:30 with ~$75k already used, then 10 lots GBPUSD needs ~$44k
        T.reset(); S.set.lev = 30;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true });
        setSymbol('GBPUSD'); Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 10, useSL: true, sl: 20, useTP: false });
        renderTicket();
        out.mg = { disabled: document.querySelector('#tkSubmit').disabled, label: document.querySelector('#tkSubmit').textContent };
        submitTicket(); out.mg.pos = S.positions.map(p => p.sym);
        out.mgDirect = openPosition({ sym: 'GBPUSD', side: 'buy', lots: 10, dupOk: true });
        out.mg.toasts = T.toasts().map(x => x.title);
        // one-click off: the quick-trade button only fills in the ticket
        T.reset(); setSymbol('EURUSD');
        document.querySelector('#qLots').value = '0.25';
        quickTrade('buy');
        out.quick = { pos: S.positions.length, toasts: T.toasts().map(x => x.title), lots: S.tk.lots };
        T.reset();
        return out;
      });
      t.eq(r.oneClick, false, 'one-click trading is off on a fresh account');
      t.ok(r.big.disabled, 'order button disabled at 500 lots');
      t.ok(/^(Insufficient margin|Maximum size)/.test(r.big.label), 'button names the block: ' + r.big.label);
      t.ok(r.big.why.some(x => /Maximum size is 400 lots per order/.test(x)), 'the sheet maximum (EURUSD 400 lots) listed among the blocks: ' + r.big.why);
      t.eq(r.big.pos, 0, 'submitTicket does not execute 500 lots');
      t.ok(r.big.toast.includes('Order blocked'), 'blocked toast shown');
      t.eq(r.bigDirect, null, 'openPosition refuses 500 lots');
      t.ok(r.mg.disabled, 'order button disabled on insufficient margin');
      t.ok(/Insufficient margin/.test(r.mg.label), 'button names the margin block: ' + r.mg.label);
      t.deep(r.mg.pos, ['EURUSD'], 'submitTicket does not execute without margin');
      t.eq(r.mgDirect, null, 'openPosition refuses without margin');
      t.ok(r.mg.toasts.includes('Insufficient margin'), 'margin toast shown: ' + r.mg.toasts);
      t.eq(r.quick.pos, 0, 'quick trade with one-click off sends nothing');
      t.ok(r.quick.toasts.includes('Ticket ready — not sent'), 'quick trade only prepares the ticket: ' + r.quick.toasts);
      t.eq(r.quick.lots, .25, 'quick trade size copied into the ticket');

      // command bar: ⌘K / Ctrl+K, first Enter only arms the order, second Enter sends it
      await page.evaluate(() => { document.activeElement?.blur?.(); document.body.focus(); });
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.waitForFunction(() => !document.getElementById('cmd').hidden, null, { timeout: 3000 });
      await page.keyboard.type('buy 0.37 eurusd sl 20');
      await page.keyboard.press('Enter');
      const armed = await page.evaluate(() => ({ pos: S.positions.length, open: !document.getElementById('cmd').hidden, list: document.getElementById('cmdList').textContent }));
      t.eq(armed.pos, 0, 'first Enter does not trade');
      t.ok(armed.open && /Confirm/.test(armed.list), 'first Enter asks for confirmation: ' + armed.list.slice(0, 120));
      await page.keyboard.press('Enter');
      const sent = await page.evaluate(() => S.positions.map(p => [p.sym, p.side, p.lots]));
      t.deep(sent, [['EURUSD', 'buy', .37]], 'second Enter sends the order');
      // a blocked command never runs, even on repeated Enter
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+k' : 'Control+k');
      await page.keyboard.type('buy 500 eurusd');
      await page.keyboard.press('Enter'); await page.keyboard.press('Enter');
      t.eq(await page.evaluate(() => S.positions.length), 1, 'blocked command does not trade');
      t.noErrors(page);
    }
  },
  {
    name: '09 demo is opt-in and labelled',
    async run({ t, app }) {
      const plain = await app('', { freeze: false });
      await plain.waitForTimeout(1200); // past the demo loader's delay
      const a = await plain.evaluate(() => ({ h: S.history.length, p: S.positions.length, o: S.orders.length, bal: S.balance, demo: document.documentElement.dataset.demo, sd: S.demo }));
      t.deep(a, { h: 0, p: 0, o: 0, bal: 100000, demo: undefined, sd: undefined }, 'without ?demo=1 the account is empty');
      const demo = await app('?demo=1', { freeze: false, demo: true });
      await demo.waitForFunction(() => document.documentElement.hasAttribute('data-demo'), null, { timeout: 8000 });
      const b = await demo.evaluate(() => ({ h: S.history.length, demo: !!S.demo }));
      t.ok(b.h > 0 && b.demo, 'with ?demo=1 the synthetic history is loaded and flagged');
      // Start clean removes the label
      await demo.evaluate(() => clearDemoHistory());
      t.eq(await demo.evaluate(() => document.documentElement.hasAttribute('data-demo')), false, 'Start clean removes html[data-demo]');
      t.noErrors(plain); t.noErrors(demo);
    }
  },
  {
    name: '10 seeded engine: same seed, same prices',
    async run({ t, open }) {
      const N = 400;
      const run = async (how, seed) => {
        const page = await open('/tests/engine.html' + (how === 'url' && seed != null ? `?seed=${seed}` : ''), { clock: true });
        return page.evaluate(async ({ how, seed, N }) => {
          if (how === 'api' && seed != null) Engine.setSeed(seed);
          await Engine.init();
          const hist = Engine.candles.EURUSD.slice(-50).map(c => c.close);
          for (let i = 0; i < N; i++) Engine.tick(250);
          return { hist, px: Engine.PAIRS.map(p => Engine.quote(p.sym).bid), regime: Engine.regime, seed: Engine.seed };
        }, { how, seed, N });
      };
      const a = await run('url', 42), b = await run('url', 42), c = await run('api', 42), d = await run('url', 43);
      t.eq(a.seed, 42, '?seed=42 is picked up');
      t.deep(a.hist, b.hist, 'same seed: same history');
      t.deep(a.px, b.px, `same seed: same prices after ${N} ticks`);
      t.eq(a.regime, b.regime, 'same seed: same vol regime');
      t.deep(c.px, a.px, 'Engine.setSeed(42) before init = ?seed=42');
      t.ok(JSON.stringify(d.px) !== JSON.stringify(a.px), 'different seed: different prices');
      const u1 = await run('none'), u2 = await run('none');
      t.eq(u1.seed, null, 'no seed by default');
      t.ok(JSON.stringify(u1.px) !== JSON.stringify(u2.px), 'without a seed the market stays random');
    }
  },
  {
    name: '11 seeded app boot: same history across boots',
    async run({ t, open }) {
      const boot = async q => {
        const page = await open('/' + q, { clock: true });
        await page.waitForFunction(() => typeof S === 'object' && S, null, { timeout: 30000 });
        return page.evaluate(() => Engine.PAIRS.map(p => Engine.candles[p.sym].slice(-200, -2).map(c => c.close)));
      };
      const a = await boot('?seed=7'), b = await boot('?seed=7');
      t.deep(a, b, 'two boots with ?seed=7 build identical candle history');
    }
  },
  {
    name: '12 effective leverage: the sheet (EURUSD 500:1) under no cap, the jurisdiction caps by class, the choice up to the sheet maximum',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); syncLevSel(); // the harness account: EU retail (T.reset sets S.set directly; the selects follow)
        const cls = Object.fromEntries(Engine.PAIRS.map(p => [p.sym, p.cls]));
        const eur = Engine.usd('EUR'), aud = Engine.usd('AUD');
        const out = { cls, eur, aud, jur: S.set.jur, sel: document.querySelector('#levSel').value, jsel: document.querySelector('#jurSel')?.value };
        const e = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), a = openPosition({ sym: 'AUDUSD', side: 'buy', lots: 1, dupOk: true });
        const mg = () => [posMargin(e), posMargin(a)];
        out.eu = mg();
        setSymbol('AUDUSD'); Object.assign(S.tk, { sm: 'lots', lots: 1, ot: 'market' }); renderTicket();
        out.tkMargin = tkCalc().margin;
        out.tkRow = [...document.querySelectorAll('#tkStats dt')].map(x => [x.textContent, x.nextElementSibling.textContent]).find(x => x[0] === 'Margin required')?.[1];
        const prof = {};
        for (const k of ['uk', 'au', 'us', 'none:default', 'none:100', 'none:30']) { applyProfile(k); prof[k] = mg(); }
        // the initial margin under a profile not applied: posMargin(p, set)
        { const set = { ...S.set, jur: 'eu', lev: 500 }; prof.euIgnoresChoice = [posMargin(e, set), posMargin(a, set)]; }
        out.opts = [...document.querySelector('#levSel').options].map(o => [o.value, o.textContent]);
        out.jopts = [...document.querySelector('#jurSel').options].map(o => [o.value, o.textContent]);
        return { ...out, prof };
      });
      const majors = ['EURUSD', 'GBPUSD', 'USDJPY', 'USDCHF', 'USDCAD', 'EURGBP', 'EURJPY', 'GBPJPY', 'EURCHF', 'GBPCHF', 'CADJPY'];
      const minors = ['AUDUSD', 'NZDUSD', 'AUDJPY', 'AUDNZD', 'EURAUD'];
      for (const s of majors) t.eq(r.cls[s], 'fx-major', `${s} is fx-major`);
      for (const s of minors) t.eq(r.cls[s], 'fx-minor', `${s} is fx-minor`);
      t.eq(r.jur, 'eu', 'harness account: EU retail');
      t.eq(r.sel, '30', '#levSel shows the leverage kept under EU retail');
      t.eq(r.jsel, 'eu', '#jurSel shows the EU cap');
      t.near(r.eu[0], LOT * r.eur / 30, 'EU: EURUSD 1 lot margin at 30:1', 1e-9, 1e-6);
      t.near(r.eu[1], LOT * r.aud / 20, 'EU: AUDUSD 1 lot margin at 20:1', 1e-9, 1e-6);
      t.near(r.tkMargin, LOT * r.aud / 20, 'ticket margin uses the per-symbol leverage', 1e-9, 1e-6);
      t.ok(r.tkRow && r.tkRow.includes('1:20'), 'ticket margin row names the leverage used: ' + r.tkRow);
      // the sheet: 500:1 on both pairs; a choice applies up to the sheet maximum
      const want = { uk: [30, 20], au: [30, 20], us: [50, 50], 'none:default': [500, 500], 'none:100': [100, 100], 'none:30': [30, 30], euIgnoresChoice: [30, 20] };
      for (const [k, [le, la]] of Object.entries(want)) {
        t.near(r.prof[k][0], LOT * r.eur / le, `${k}: EURUSD at 1:${le}`, 1e-9, 1e-6);
        t.near(r.prof[k][1], LOT * r.aud / la, `${k}: AUDUSD at 1:${la}`, 1e-9, 1e-6);
      }
      t.deep(r.opts[0], ['default', 'Sheet default'], '#levSel: Sheet default first');
      t.ok(['30', '100', '500'].every(v => r.opts.some(o => o[0] === v && o[1] === '1:' + v)), '#levSel offers the choices 1:30 … 1:500: ' + JSON.stringify(r.opts));
      t.deep(r.jopts.map(o => o[0]), ['none', 'eu', 'uk', 'au', 'us'], '#jurSel: none and the four retail regimes, no pro / sim');
      t.noErrors(page);
    }
  },
  {
    name: '13 a leverage or cap change with open positions shows the resulting margin level first',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const pick = (id, v) => page.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);
      // no positions: applies at once
      await page.evaluate(() => T.reset());
      await pick('jurSel', 'none'); await pick('levSel', '200');
      t.deep(await page.evaluate(() => [S.set.jur, S.set.lev]), ['none', 200], 'flat account: cap and leverage applied directly');
      const before = await page.evaluate(() => { openPosition({ sym: 'AUDUSD', side: 'buy', lots: 20, dupOk: true }); const a = account(); return { level: a.level, eq: a.eq, n: Engine.usd('AUD') }; });
      await pick('jurSel', 'eu');
      const dlg = await page.evaluate(() => { const d = document.querySelector('#confirmDlg'); return { open: !!d && !d.hidden, text: d?.textContent || '', jur: S.set.jur, lev: S.set.lev }; });
      t.ok(dlg.open, 'an in-page confirmation opens');
      t.deep([dlg.jur, dlg.lev], ['none', 200], 'nothing changes before confirming');
      const lvl = before.eq / (20 * LOT * before.n / 20) * 100;
      t.ok(dlg.text.includes(Math.round(lvl).toLocaleString('en-US') + '%'), `dialog shows the resulting margin level ${lvl.toFixed(0)}%: ${dlg.text}`);
      await page.click('#confirmDlg [data-cf=cancel]');
      await page.waitForTimeout(400);
      t.deep(await page.evaluate(() => [S.set.jur, S.set.lev, S.positions.length, document.querySelector('#levSel').value, document.querySelector('#jurSel').value]), ['none', 200, 1, '200', 'none'], 'cancel keeps the settings and the selects');
      // a change that would push the level under 50% says so
      const lowWarn = await page.evaluate(() => { const p = S.positions[0]; p.entry = Engine.quote(p.sym).bid + .04; return account().level; });
      await pick('jurSel', 'eu');
      const low = await page.evaluate(() => document.querySelector('#confirmDlg').textContent);
      t.ok(lowWarn > 50 && /stop-out/i.test(low), 'a resulting level under 50% is called a stop-out: ' + low);
      await page.click('#confirmDlg [data-cf=cancel]');
      await page.evaluate(() => { const p = S.positions[0]; p.entry = Engine.quote(p.sym).ask; });
      await pick('levSel', '100');
      await page.click('#confirmDlg [data-cf=ok]');
      t.deep(await page.evaluate(() => [S.set.jur, S.set.lev, effLev('AUDUSD')]), ['none', 100, 100], 'confirm applies the leverage choice');
      t.noErrors(page);
    }
  },
  {
    name: '14 stop-out threshold: 52% holds, 48% closes',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const run = target => page.evaluate(target => {
        T.reset();
        const a = openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, dupOk: true });
        const b = openPosition({ sym: 'USDJPY', side: 'buy', lots: 10, dupOk: true });
        // set EURUSD's entry so the margin level lands exactly on the target
        const ac = account(), need = target / 100 * ac.mg - S.balance - posPnl(b).pnl;
        a.entry = Engine.quote('EURUSD').bid - need / (10 * LOT);
        const level = account().level;
        checkTriggers();
        return { level, open: S.positions.length, h: S.history.map(h => h.reason) };
      }, target);
      const hold = await run(52), cut = await run(48);
      t.near(hold.level, 52, 'setup at 52%', 1e-6, 1e-6);
      t.eq(hold.open, 2, 'margin level 52% does not stop out');
      t.deep(hold.h, [], 'nothing in history at 52%');
      t.near(cut.level, 48, 'setup at 48%', 1e-6, 1e-6);
      t.eq(cut.open, 1, 'margin level 48% stops out one position');
      t.deep(cut.h, ['Stop-out'], 'stop-out recorded at 48%');
      t.noErrors(page);
    }
  },
  {
    name: '15 negative balance protection after a gap',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true });
        T.move('EURUSD', Engine.mid('EURUSD') * .93); // a 7% gap against 20 lots is about −$160k on $100k
        const eq0 = account().eq;
        checkTriggers();
        return { eq0, bal: S.balance, eq: account().eq, open: S.positions.length, h: S.history.slice(0, 2).map(h => ({ reason: h.reason, pnl: h.pnl, id: h.id })), id: p.id };
      });
      t.ok(r.eq0 < 0, `equity is negative after the gap (${r.eq0.toFixed(0)})`);
      t.eq(r.open, 0, 'all positions stopped out');
      t.eq(r.bal, 0, 'balance brought back to 0');
      t.eq(r.eq, 0, 'equity 0');
      t.eq(r.h[1]?.reason, 'Stop-out', 'stop-out recorded');
      t.eq(r.h[0]?.reason, 'Negative balance protection', 'protection entry recorded');
      t.near(r.h[0].pnl, -(100000 + r.h[1].pnl), 'protection covers exactly the negative balance', 1e-9, 1e-6);
      t.ok(r.h[0].id !== r.h[1].id, 'protection entry has its own id');
      t.noErrors(page);
    }
  },
  {
    name: '16 swap from the sheet: rollover at 17:00 New York, once per rollover, triple on Wednesday',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-15T10:30:00Z') }); // Thursday: FX open on both sides of the rollover
      const pure = await page.evaluate(() => {
        const u = s => Date.parse(s) / 1000;
        return {
          summer: nextRollover(u('2026-10-19T12:00:00Z')) === u('2026-10-19T21:00:00Z'),
          winter: nextRollover(u('2026-11-10T12:00:00Z')) === u('2026-11-10T22:00:00Z'),
          after: nextRollover(u('2026-10-19T21:00:00Z')) === u('2026-10-20T21:00:00Z'),
          weekend: nextRollover(u('2026-10-23T21:30:00Z'), 'EURUSD') === u('2026-10-26T21:00:00Z'),
          daily: nextRollover(u('2026-10-23T21:30:00Z')) === u('2026-10-24T21:00:00Z'),
          dstStart: nextRollover(u('2026-03-09T12:00:00Z')) === u('2026-03-09T21:00:00Z'),
          nights: ['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23', '2026-10-24'].map(d => rolloverNights(u(d + 'T21:00:00Z'), 'EURUSD')),
          label: SWAP_LABEL
        };
      });
      t.ok(pure.summer && pure.after && pure.dstStart, 'EDT: 17:00 New York is 21:00 UTC');
      t.ok(pure.winter, 'EST: 17:00 New York is 22:00 UTC');
      t.ok(pure.weekend, 'no FX rollover on Saturday or Sunday'); t.ok(pure.daily, 'the rollover clock itself runs every day (crypto)');
      t.deep(pure.nights, [1, 1, 3, 1, 1, 0], 'Wednesday rollover counts three nights on FX');
      t.ok(/instrument sheet/.test(pure.label), 'swap labelled as the sheet: ' + pure.label);
      const r = await page.evaluate(() => {
        T.reset();
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        const row = CATALOG.instr.find(x => x.sym === 'EURUSD'), nr = nextRollover(Engine.simTime, 'EURUSD');
        rolloverTick();
        Engine.speed = 600; let pre = null, at = null, n = 0;
        while (Engine.simTime < nr + 3600 && n++ < 5000) {
          const before = p.swap || 0; Engine.tick(1000); rolloverTick();
          if (before === 0 && p.swap) at = { t: Engine.simTime };
          if (Engine.simTime < nr) pre = p.swap || 0;
        }
        Engine.speed = 0;
        const swap = p.swap, raw = (posPnl(p).exit - p.entry) * LOT, fl = posPnl(p).pnl;
        rolloverTick(); const again = p.swap;
        const bal0 = S.balance; closePosition(p.id);
        return { entry: p.entry, pre, at, nr, swap, again, pts: row.p.swap[0], point: row.point, nights: rolloverNights(nr, 'EURUSD'), raw, fl, h: S.history[0], bal: S.balance - bal0 };
      });
      t.eq(r.pre, 0, 'no swap before the rollover');
      t.ok(r.at && r.at.t >= r.nr, 'swap charged at the rollover');
      t.near(r.swap, r.pts * r.point * LOT * r.nights, 'swap = sheet points × point × 100,000 (USD quote) × nights', 1e-9, 1e-9);
      t.ok(r.swap < 0, 'long EUR/USD pays (negative on the sheet)');
      t.eq(r.again, r.swap, 'charged once per rollover');
      t.near(r.fl, r.raw + r.swap, 'floating P&L includes swap', 1e-9, 1e-6);
      t.near(r.h.swap, r.swap, 'history keeps the swap', 1e-12, 1e-9);
      t.near(r.h.pnl, (r.h.exit - r.entry) * LOT + r.swap, 'closed P&L includes swap (from the fill prices as shown)', 1e-9, 1e-6);
      t.near(r.bal, r.h.pnl, 'balance moves by the P&L including swap', 1e-9, 1e-6);
      t.noErrors(page);
    }
  },
  {
    name: '17 resumed market on a Wednesday: triple swap and ticket swap rows',
    async run({ t, app }) {
      const snap = { L: { EUR: Math.log(1.16), GBP: Math.log(1.33), JPY: Math.log(1 / 151), CHF: Math.log(1.25), AUD: Math.log(.66), CAD: Math.log(1 / 1.39), NZD: Math.log(.58) }, simTime: Date.parse('2026-10-21T20:50:00Z') / 1000, regime: .1, source: 'fallback', rateDate: '2026-10-15' };
      const init = { fn: snap => { document.addEventListener('DOMContentLoaded', () => { store.getMarket = () => snap; }); }, arg: snap };
      const page = await app('', { init });
      const r = await page.evaluate(() => {
        T.reset();
        const res = { t0: Engine.simTime, eur: Engine.mid('EURUSD'), regime: Engine.regime };
        setSymbol('GBPJPY'); Object.assign(S.tk, { side: 'sell', sm: 'lots', lots: 2, ot: 'market' }); renderTicket();
        res.rows = Object.fromEntries([...document.querySelectorAll('#tkStats dt')].map(x => [x.textContent, x.nextElementSibling.textContent]));
        res.night = swapPerNight('GBPJPY', 'sell', 2);
        const p = openPosition({ sym: 'GBPJPY', side: 'sell', lots: 2, dupOk: true });
        Engine.speed = 60; let n = 0, at = null;
        while (Engine.simTime < res.t0 + 1200 && n++ < 100) { Engine.tick(1000); rolloverTick(); if (p.swap && !at) at = Engine.usd('JPY'); }
        Engine.speed = 0;
        const row = CATALOG.instr.find(x => x.sym === 'GBPJPY');
        res.swap = p.swap; res.at = at; res.pts = row.p.swap[1]; res.point = row.point;
        return res;
      });
      t.near(r.t0, snap.simTime, 'clock resumes from the snapshot', 0, 5);
      t.near(r.eur, 1.16, 'price resumes from the snapshot', 1e-3);
      t.near(r.regime, .1, 'vol regime resumes', 0, .05);
      t.ok('Swap / night' in r.rows && 'To next triple' in r.rows, 'ticket shows swap rows: ' + Object.keys(r.rows));
      t.ok(r.rows['Swap / night'].includes(usd2(r.night)), `swap row shows the nightly amount ${r.night}: ${r.rows['Swap / night']}`);
      t.ok(/^\d+m \d\ds$/.test(r.rows['To next triple']), 'next triple is minutes away: ' + r.rows['To next triple']);
      t.ok(Object.values(r.rows).some(v => /instrument sheet/.test(v)), 'ticket names the sheet as the swap source');
      t.near(r.swap, 2 * r.pts * r.point * LOT * r.at * 3, 'Wednesday rollover charges three nights (sheet points × point × size × usd(JPY))', 1e-9, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: '18 spread from the sheet: Default, Night (23:00–01:00 server, Mon–Fri), News on the currencies of a high-impact release',
    async run({ t, open, app }) {
      const page = await open('/tests/engine.html');
      const r = await page.evaluate(async () => {
        const L = { EUR: Math.log(1.16), GBP: Math.log(1.33), JPY: Math.log(1 / 151), CHF: Math.log(1.25), AUD: Math.log(.66), CAD: Math.log(1 / 1.39), NZD: Math.log(.58) };
        const pts = s => Engine.quote(s).spread * Engine.META[s].pip / Engine.META[s].point;
        const at = async iso => { await Engine.init({ L, simTime: Date.parse(iso) / 1000, regime: 0, source: 'fallback', rateDate: '2026-10-15' }); const q = Engine.quote('EURUSD'); return [q.sp, +pts('EURUSD').toFixed(6)]; };
        const out = { day: [] };
        // 19:59 / 20:00 / 21:59 / 22:00 UTC on a Wednesday in EEST = 22:59 / 23:00 / 00:59 / 01:00 server
        for (const x of ['19:59:00', '20:00:00', '21:59:00', '22:00:00']) out.day.push(await at('2026-10-21T' + x + 'Z'));
        out.sheet = Engine.META.EURUSD.p.spread;
        await at('2026-10-21T12:00:00Z');
        Engine.setNewsMult('JPY', 3, Engine.simTime + 120);
        out.news = { jpy: [Engine.quote('USDJPY').sp, pts('USDJPY')], eur: Engine.quote('EURUSD').sp, sheet: Engine.META.USDJPY.p.spread };
        Engine.speed = 1; for (let i = 0; i < 4; i++) Engine.tick(60000);
        out.after = Engine.quote('USDJPY').sp;
        return out;
      });
      const [def, night] = r.sheet;
      t.deep(r.day, [['default', def], ['night', night], ['night', night], ['default', def]], 'Night spread from 23:00 to 01:00 server time');
      t.deep(r.news.jpy, ['news', r.news.sheet[2]], 'News spread on the currency involved');
      t.eq(r.news.eur, 'default', 'other currencies unaffected');
      t.eq(r.after, 'default', 'News ends with the release window');
      // the app's calendar puts the currencies of a high-impact release on their News spread within ±2 minutes
      const pg = await app('', { clock: true });
      const n = await pg.evaluate(() => {
        CAL.events = [{ id: 'x', t: Engine.simTime + 90, ccy: 'CAD', name: 'Employment Change', impact: 'hi', unit: 'K', fc: 20, prev: 18, sd: 18, done: false, actual: null }];
        for (let i = 0; i < 10; i++) CAL.events.push({ id: 'y' + i, t: Engine.simTime + 86400, ccy: 'USD', name: 'x', impact: 'lo', unit: '', fc: null, prev: null, done: false });
        const far = Engine.quote('USDCAD').sp;
        calTick();
        return { far, near: Engine.quote('USDCAD').sp, other: Engine.quote('EURGBP').sp };
      });
      t.eq(n.far, 'default', 'Default before the ±2 minute window');
      t.eq(n.near, 'news', 'USD/CAD on its News spread ahead of a high-impact CAD release');
      t.eq(n.other, 'default', 'EUR/GBP unaffected');
      t.noErrors(page); t.noErrors(pg);
    }
  },
  {
    name: '19 snapshot and resume, invalid snapshots ignored, hooks to the store',
    async run({ t, open, app }) {
      const a = await open('/tests/engine.html');
      const snap = await a.evaluate(async () => { await Engine.init(); for (let i = 0; i < 40; i++) Engine.tick(250); return Engine.snapshot(); });
      t.deep(Object.keys(snap).sort(), ['L', 'rateDate', 'regime', 'seed', 'simTime', 'source'], 'snapshot fields');
      const b = await open('/tests/engine.html');
      const r = await b.evaluate(async snap => {
        await Engine.init(snap);
        const res = { simTime: Engine.simTime, regime: Engine.regime, mids: Engine.PAIRS.map(p => [Engine.mid(p.sym), Engine.candles[p.sym].at(-1).close]), want: Engine.PAIRS.map(p => Math.exp((p.base === 'USD' ? 0 : snap.L[p.base]) - (p.quote === 'USD' ? 0 : snap.L[p.quote]))) };
        const bad = [];
        for (const s of [{ ...snap, L: { ...snap.L, EUR: 'x' } }, { ...snap, simTime: -5 }, { ...snap, L: null }, 'nope', { ...snap, regime: NaN }]) { await Engine.init(s); bad.push(Math.abs(Engine.simTime - Date.now() / 1000) < 120); }
        res.bad = bad;
        const fut = { ...snap, simTime: snap.simTime + 86400 * 3 }; await Engine.init(fut); res.fut = Engine.simTime === fut.simTime;
        return res;
      }, snap);
      t.eq(r.simTime, snap.simTime, 'clock resumes exactly');
      t.eq(r.regime, snap.regime, 'regime resumes');
      r.mids.forEach(([m, c], i) => { t.near(m, r.want[i], 'mid from the snapshot levels', 1e-12); t.near(c, m, 'last candle closes at the resumed price', 1e-12); });
      t.deep(r.bad, [true, true, true, true, true], 'invalid snapshots fall back to a fresh market');
      t.ok(r.fut, 'a snapshot ahead of the wall clock keeps its time (no clock going back)');
      // app: market saved every 20 ticks and on pagehide, state flushed with it
      const init = { fn: () => { document.addEventListener('DOMContentLoaded', () => { window.__ms = []; store.setMarket = s => window.__ms.push(s); }); }, arg: null };
      const pg = await app('', { clock: true, init });
      await pg.waitForFunction(() => window.__ms.length >= 1, null, { timeout: 9000 });
      const h = await pg.evaluate(() => {
        T.reset(); const n0 = window.__ms.length;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .5, dupOk: true });
        window.dispatchEvent(new Event('pagehide'));
        return { n: window.__ms.length - n0, last: window.__ms.at(-1), stored: store.get()?.positions?.length, simTime: Engine.simTime };
      });
      t.eq(h.n, 1, 'pagehide saves the market');
      t.ok(Math.abs(h.last.simTime - h.simTime) < 1e-6, 'saved snapshot is current');
      t.eq(h.stored, 1, 'pagehide flushes the account state at once');
      t.noErrors(a); t.noErrors(b); t.noErrors(pg);
    }
  },
  {
    name: '20 trailing stop label only after the trail moved the stop',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        // up: pips the price first moves in favour (the trail starts at entry + trail)
        const sym = 'EURUSD', pip = Engine.META[sym].pip, run = (trail, slPips, up) => {
          T.reset();
          const q = Engine.quote(sym), sl = q.bid - slPips * pip, p = openPosition({ sym, side: 'buy', lots: 1, sl, trail, dupOk: true });
          checkTriggers(); const early = p.sl !== sl;
          if (up) { T.move(sym, p.entry + up * pip); checkTriggers(); }
          const moved = p.sl !== sl;
          T.move(sym, Engine.mid(sym) - (Math.max(trail, slPips) + 5 + up) * pip); checkTriggers();
          return { early, moved, reason: S.history[0]?.reason };
        };
        return { still: run(50, 10, 0), flat: run(10, 30, 0), moved: run(10, 30, 15) };
      });
      t.eq(r.still.moved, false, 'trail wider than the stop leaves it alone');
      t.eq(r.still.reason, 'Stop loss', 'unmoved stop is labelled Stop loss');
      t.eq(r.flat.moved, false, 'a tighter trail does not move the stop before price moves in favour');
      t.eq(r.flat.reason, 'Stop loss', 'stop never trailed: Stop loss');
      t.eq(r.moved.early, false, 'no move at entry');
      t.eq(r.moved.moved, true, 'after a favourable move beyond the trail distance the stop trails');
      t.eq(r.moved.reason, 'Trailing stop', 'moved stop is labelled Trailing stop');
      t.noErrors(page);
    }
  },
  {
    name: '21 equity curve starts from balance minus closed P&L',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const c = await page.evaluate(() => {
        T.reset(); S.balance = 37000;
        S.history = [500, -200, 300].map((pnl, i) => ({ id: 90 + i, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, open: 1, close: 2, pnl, pips: 0, r: null, reason: 'Manual', note: '', setup: '' }));
        return journalStats().curve;
      });
      t.deep(c, [36400, 36700, 36500, 37000], 'curve runs from balance − Σ P&L to the balance');
      t.noErrors(page);
    }
  },
  {
    name: '22 markup in real display paths stays text',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        S.history.unshift({ id: 77, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, open: 1, close: 2, pnl: 0, pips: 0, r: null, reason: '<img id=xr src=x>', note: '"><img id=xn src=x>', setup: '' });
        changed('hist'); renderHistory(); setTab('journal'); renderJournal();
        askConfirm({ title: '<b id=xt>t</b>', body: '<i id=xb>b</i>', ok: '<u id=xo>o</u>', onOk: () => {} });
        const found = document.querySelectorAll('#xr,#xn,#xt,#xb,#xo').length;
        const txt = { hist: document.querySelector('#histBody').textContent, note: document.querySelector('#jList [data-j=note]')?.value, dlg: document.querySelector('#confirmDlg').textContent };
        document.querySelector('#confirmDlg [data-cf=cancel]').click(); setTab('positions');
        return { found, txt };
      });
      t.eq(r.found, 0, 'no element created from markup');
      t.ok(r.txt.hist.includes('<img id=xr src=x>'), 'history reason shown as text');
      t.eq(r.txt.note, '"><img id=xn src=x>', 'journal note kept as text');
      t.ok(r.txt.dlg.includes('<b id=xt>t</b>') && r.txt.dlg.includes('<i id=xb>b</i>'), 'dialog shows markup as text');
      t.noErrors(page);
    }
  },
  {
    name: '23 import rejects a negative or invalid balance',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      for (const bal of ['-5000', '"5000"', 'null', '-0.01']) {
        const r = await page.evaluate(async bal => {
          T.reset(); S.balance = 4321; T.clearToasts();
          const json = `{"app":"meridian-fx","version":1,"state":{"balance":${bal},"positions":[],"orders":[],"history":[],"alerts":[]}}`;
          importAccount(new File([json], 'bad.json', { type: 'application/json' }));
          await new Promise(r => setTimeout(r, 300));
          return { bal: S.balance, toasts: T.toasts().map(x => x.title), san: sanitizeState(JSON.parse(json).state) };
        }, bal);
        t.eq(r.bal, 4321, `balance ${bal}: account unchanged`);
        t.ok(r.toasts.includes('Import failed'), `balance ${bal}: import failed toast: ${r.toasts}`);
        t.eq(r.san, null, `balance ${bal}: sanitizeState rejects the state`);
      }
      t.noErrors(page);
    }
  },
  {
    name: '24 setSeed after init keeps the vol regime',
    async run({ t, open }) {
      const page = await open('/tests/engine.html');
      const r = await page.evaluate(async () => { await Engine.init(); Engine.speed = 60; for (let i = 0; i < 200; i++) Engine.tick(1000); const a = Engine.regime; Engine.setSeed(5); return { a, b: Engine.regime, seed: Engine.seed }; });
      t.ok(r.a !== 0, 'regime moved during the run');
      t.eq(r.b, r.a, 'setSeed after init does not reset the regime');
      t.eq(r.seed, 5, 'seed applied');
    }
  },
  {
    name: '25 negative balance protection after any close (gap through the stop loss, manual close)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const mid = Engine.mid('EURUSD'), pip = Engine.META.EURUSD.pip;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, sl: mid - 20 * pip, dupOk: true });
        T.move('EURUSD', mid * .93);
        checkTriggers();
        const sl = { bal: S.balance, open: S.positions.length, h: S.history.slice(0, 2).map(h => ({ reason: h.reason, pnl: h.pnl })) };
        const exp = JSON.stringify({ app: 'meridian-fx', version: 1, state: S });
        T.reset();
        const p = openPosition({ sym: 'GBPUSD', side: 'sell', lots: 18, dupOk: true });
        T.move('GBPUSD', Engine.mid('GBPUSD') * 1.08);
        closePosition(p.id); // manual close straight through the loss, before the stop-out sees it
        const man0 = S.balance; checkTriggers();
        return { sl, exp, man: { bal0: man0, bal: S.balance, h: S.history.slice(0, 2).map(h => ({ reason: h.reason, pnl: h.pnl })) } };
      });
      t.eq(r.sl.open, 0, 'stop loss closed the position');
      t.eq(r.sl.bal, 0, 'gap through the stop loss: balance brought back to 0');
      t.eq(r.sl.h[1]?.reason, 'Stop loss', 'stop loss recorded');
      t.eq(r.sl.h[0]?.reason, 'Negative balance protection', 'protection recorded after the stop loss');
      t.near(r.sl.h[0].pnl, -(100000 + r.sl.h[1].pnl), 'protection covers the negative balance', 1e-9, 1e-6);
      t.ok(r.man.bal0 < 0, `manual close left the balance negative (${r.man.bal0.toFixed(0)})`);
      t.eq(r.man.bal, 0, 'manual close: balance brought back to 0');
      t.deep(r.man.h.map(h => h.reason), ['Negative balance protection', 'Manual'], 'protection recorded after the manual close');
      // the protected account round-trips through Export/Import
      const imp = await page.evaluate(async json => {
        T.reset(); T.clearToasts();
        importAccount(new File([json], 'acct.json', { type: 'application/json' }));
        await new Promise(r => setTimeout(r, 300));
        return { bal: S.balance, toasts: T.toasts().map(x => x.title), h: S.history[0]?.reason, neg: sanitizeState({ balance: -500, positions: [{ id: 1, sym: 'EURUSD', side: 'buy', lots: 1, entry: Engine.mid('EURUSD') }], history: [] })?.balance };
      }, r.exp);
      t.ok(imp.toasts.includes('Account imported'), `protected account imports: ${imp.toasts}`);
      t.eq(imp.bal, 0, 'imported balance 0');
      t.eq(imp.h, 'Negative balance protection', 'imported history keeps the protection entry');
      t.eq(imp.neg, -500, 'a negative balance with open positions is a valid state');
      t.noErrors(page);
    }
  },
  {
    name: '26 a state saved before leverage profiles keeps its leverage on import',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      for (const [sym, lots, n] of [['AUDUSD', 30, 4], ['EURUSD', 10, 5]]) {
        const r = await page.evaluate(async ([sym, lots, n]) => {
          T.reset(); applyProfile('sim:100');
          for (let i = 0; i < n; i++) openPosition({ sym, side: 'buy', lots, dupOk: true });
          const lv0 = account().level, st = JSON.parse(JSON.stringify(S));
          delete st.set.jur; // what a pre-profile export looked like
          T.reset(); T.clearToasts();
          importAccount(new File([JSON.stringify({ app: 'meridian-fx', version: 1, state: st })], 'old.json', { type: 'application/json' }));
          await new Promise(r => setTimeout(r, 300));
          const lv1 = account().level; checkTriggers();
          return { lv0, lv1, jur: S.set.jur, noCap: jurOf(S.set) === JUR.none, eff: effLev(sym), lev: S.set.lev, open: S.positions.length, h: S.history.map(h => h.reason), toasts: T.toasts().map(x => x.title), sel: document.querySelector('#levSel').value };
        }, [sym, lots, n]);
        t.ok(r.lv0 > 100 && r.lv0 < 250, `${sym} ${lots * n} lots at 1:100: margin level ${r.lv0.toFixed(0)}%`);
        t.ok(r.noCap, `${sym}: legacy state maps to no jurisdiction cap (${r.jur})`);
        t.eq(r.lev, 100, `${sym}: leverage 1:100 kept`); t.eq(r.eff, 100, `${sym}: effective leverage 1:100`);
        t.near(r.lv1, r.lv0, `${sym}: margin level unchanged by the import`, 1e-9, 1e-6);
        t.eq(r.open, 1, `${sym}: no stop-out after the import (netting: the ${n} buys are one position)`);
        t.deep(r.h, [], `${sym}: nothing closed`);
        t.ok(r.toasts.includes('Leverage kept at 1:100'), `${sym}: user told about the leverage: ${r.toasts}`);
        t.eq(r.sel, '100', `${sym}: Lev selector shows the kept leverage`);
      }
      const flat = await page.evaluate(() => { T.reset(); loadState({ balance: 5000, positions: [], history: [], set: { lev: 100 } }); return { jur: S.set.jur, lev: S.set.lev, def: { jur: DEF.set.jur, lev: DEF.set.lev } }; });
      t.deep({ jur: flat.jur, lev: flat.lev }, flat.def, 'a legacy state without positions takes the default');
      t.noErrors(page);
    }
  }
];
