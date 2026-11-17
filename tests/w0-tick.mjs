// Wave 0 · w0-tick: stops, orders, alerts and chart candles see every market sub-step (Engine.advance makes 5 s
// sub-steps; at 300× one 250 ms loop tick is 15 of them), plus the small trade.js fixes (BE done flag, ½ at the
// minimum lot, honest reason for a target hit at a loss). The loop is driven by hand inside one evaluate: the
// market is frozen (speed 0) between calls, so the app's own interval cannot interleave.
const START = 1760425200; // 2025-10-14 07:00 UTC
const RATES = [0.89222, 0.75491, 157.98, 0.83021, 1.447, 1.4207, 1.7855];

// one loop tick as app.js runs it (market, swap, checks, chart), at a given speed
const LOOP = () => {
  window.W0 = {
    tick(speed, n = 1) {
      for (let i = 0; i < n; i++) {
        Engine.speed = speed; Engine.tick(250); Engine.speed = 0;
        rolloverTick(); checkTriggers(); chartTick();
      }
    }
  };
};

export const tests = [
  {
    name: 'W0T1 at 300×, 60 positions with a 3-pip stop: no candle crosses a stop while its position stays open',
    async run({ t, app }) {
      const page = await app('?seed=11', { clock: true });
      await page.evaluate(LOOP);
      const r = await page.evaluate(() => {
        T.reset();
        const pairs = Engine.PAIRS.filter(p => Engine.quote(p.sym).spread < 2).map(p => p.sym), ids = [];
        for (let i = 0; i < 60; i++) {
          const sym = pairs[i % pairs.length], side = i % 2 ? 'sell' : 'buy';
          const p = openPosition({ sym, side, lots: .01, slPips: 3, dupOk: true, auto: true });
          if (p) ids.push({ id: p.id, sym, side, sl: p.sl, open: p.open });
        }
        const opened = ids.length;
        let miss = 0, hit = 0;
        for (let k = 0; k < 400 && S.positions.length; k++) W0.tick(300);
        for (const x of ids) {
          const from = Math.floor(x.open / 60) * 60 + 60; // the opening minute also holds prices from before the open
          const h = S.history.find(y => y.id === x.id);
          // open: every finished minute; closed: the minutes before the close (a close later than the crossing is a miss too)
          const until = h ? Math.floor(h.close / 60) * 60 : Engine.simTime;
          // a mid through the stop means the bid (buy) / ask (sell) was through it at that sub-step
          const through = Engine.candles[x.sym].some(c => c.time >= from && c.time + 60 <= until && (x.side === 'buy' ? c.low < x.sl : c.high > x.sl));
          if (h) hit++; if (through) miss++;
        }
        return { opened, miss, hit, open: S.positions.length };
      });
      t.eq(r.opened, 60, '60 positions opened');
      t.eq(r.miss, 0, `positions left open after a candle went through their stop (closed ${r.hit}, open ${r.open})`);
      t.ok(r.hit >= 30, 'most stops were reached: ' + r.hit);
      t.noErrors(page);
    }
  },
  {
    name: 'W0T2 at 300×, alerts at ±3/6/10 pips: every level a candle touched fires, each once; an alert already met is refused',
    async run({ t, app }) {
      const page = await app('?seed=12', { clock: true });
      await page.evaluate(LOOP);
      const r = await page.evaluate(() => {
        T.reset();
        const fired = {}, real = window.toast;
        window.toast = function (title, body) { if (/^Alert ·/.test(title)) fired[title + body.split(' · now')[0]] = (fired[title + body.split(' · now')[0]] || 0) + 1; return real.apply(this, arguments); };
        const syms = ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD'], made = [];
        for (const sym of syms) {
          const m = Engine.META[sym], mid = Engine.quote(sym).mid;
          for (const k of [3, 6, 10]) for (const s of [1, -1]) {
            const price = +(mid + s * k * m.pip).toFixed(m.digits), cond = s > 0 ? 'above' : 'below';
            addAlert(sym, price, cond);
            made.push({ sym, price, cond, t: Engine.simTime });
          }
        }
        const nMade = S.alerts.length;
        for (let k = 0; k < 160; k++) W0.tick(300);
        let missed = 0, twice = 0, falseFire = 0;
        for (const a of made) {
          const al = S.alerts.find(x => x.sym === a.sym && x.price === a.price && x.cond === a.cond);
          const from = Math.floor(a.t / 60) * 60 + 60;
          const touched = Engine.candles[a.sym].some(c => c.time >= from && (a.cond === 'above' ? c.high >= a.price : c.low <= a.price));
          const key = `Alert · ${pretty(a.sym)}Crossed ${a.cond} ${fp(a.sym, a.price)}`, n = fired[key] || 0;
          if (touched && !al.done) missed++;
          if (n > 1) twice++;
          if (al.done) { const c = Engine.candles[a.sym].find(x => x.time === Math.floor(al.at / 60) * 60); if (!(a.cond === 'above' ? c.high >= a.price : c.low <= a.price)) falseFire++; }
        }
        // already on the condition side: refused, nothing fires
        T.clearToasts();
        const m = Engine.META.EURUSD, mid = Engine.quote('EURUSD').mid, before = S.alerts.length;
        const ret = addAlert('EURUSD', +(mid - 5 * m.pip).toFixed(m.digits), 'above');
        checkTriggers();
        const toasts = T.toasts();
        // the confirmation names the condition asked for, not one guessed from the price
        const ok = addAlert('EURUSD', +(mid + 5 * m.pip).toFixed(m.digits), 'above');
        const okToast = T.toasts().pop();
        window.toast = real;
        return { nMade, missed, twice, falseFire, done: S.alerts.filter(a => a.done).length, refused: S.alerts.length === before + 1 && ret == null, toasts, ok: !!ok, okToast };
      });
      t.eq(r.nMade, 24, '24 alerts set');
      t.eq(r.missed, 0, `alerts whose level a candle touched but which did not fire (fired ${r.done})`);
      t.eq(r.twice, 0, 'no alert fired twice');
      t.eq(r.falseFire, 0, 'an alert fires only in a minute whose candle reached the level');
      t.ok(r.done >= 8, 'several alerts fired: ' + r.done);
      t.ok(r.refused, 'an alert already on its condition side is not added');
      t.ok(r.toasts.some(x => /already above/i.test(x.title + ' ' + x.body)), 'refusal says why: ' + JSON.stringify(r.toasts));
      t.ok(!r.toasts.some(x => /^Alert ·/.test(x.title)), 'and nothing fires');
      t.ok(r.ok && /above/.test(r.okToast.body), 'confirmation shows the condition: ' + JSON.stringify(r.okToast));
      t.noErrors(page);
    }
  },
  {
    name: 'W0T3 displayed bars equal Engine.aggregate after 300× on 1m (live) and 1800× on 15m (replay)',
    async run({ t, app }) {
      const page = await app('?seed=13', { clock: true });
      await page.evaluate(LOOP);
      const cmp = () => {
        const sym = S.set.sym, pip = Engine.META[sym].pip, ref = Engine.aggregate(sym, S.set.tf, 2200), n = Math.min(120, ref.length - 1);
        const a = bars.slice(-n), b = ref.slice(-n);
        let bad = 0, worst = 0;
        if (a.length !== b.length || a[a.length - 1].time !== b[b.length - 1].time) return { bad: -1, last: [a[a.length - 1].time, b[b.length - 1].time] };
        for (let i = 0; i < n; i++) {
          if (a[i].time !== b[i].time) { bad++; continue; }
          const d = Math.max(...['open', 'high', 'low', 'close'].map(k => Math.abs(a[i][k] - b[i][k]) / pip));
          if (d > .5) { bad++; worst = Math.max(worst, d); }
        }
        return { bad, worst, n, len: bars.length };
      };
      const live = await page.evaluate(cmp => { S.set.sym = 'EURUSD'; setTF(1); W0.tick(300, 220); return eval('(' + cmp + ')')(); }, cmp.toString());
      t.eq(live.bad, 0, 'live 1m bars differ from the engine (worst ' + live.worst + ' pips): ' + JSON.stringify(live));
      t.ok(live.len <= 2400, 'the bar series stays within its cap (2200 + 200 slack): ' + live.len);
      await page.evaluate(o => RP.open(o), { kind: 'sim', seed: 4821, start: START, rates: RATES, rateDate: '2026-10-15' });
      let f = null;
      for (let i = 0; i < 400 && !f; i++) {
        const rid = await page.evaluate(() => window.__mfxRpRid || null);
        f = rid && page.frames().find(x => x !== page.mainFrame() && x.url().includes('rid=' + rid));
        if (!f) await page.waitForTimeout(50);
      }
      t.ok(f, 'replay document opened');
      await f.waitForFunction(() => window.RP && RP.state === 'paused', null, { timeout: 30000 });
      const rp = await f.evaluate(cmp => {
        S.set.sym = 'EURUSD'; setTF(15);
        for (let i = 0; i < 160; i++) { Engine.replaySpeed = 1800; Engine.tick(250); Engine.replaySpeed = 0; chartTick(); }
        return eval('(' + cmp + ')')();
      }, cmp.toString());
      t.eq(rp.bad, 0, 'replay 15m bars differ from the engine (worst ' + rp.worst + ' pips): ' + JSON.stringify(rp));
      t.noErrors(page);
    }
  },
  {
    name: 'W0T4 break-even marks done only once it moved the stop; ½ at the minimum lot is a Close; a target at a loss says so',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        // BE at +5 pips with a +6 offset: at +5.5 the level is above the bid, nothing moves; at +8 it moves
        // (v15 pivots on the bid: T.move sets Engine.mid, which is the bid)
        let q = Engine.quote(sym);
        const p = openPosition({ sym, side: 'buy', lots: .1, slPips: 20, be: { at: 5, off: 6 }, dupOk: true });
        const sl0 = p.sl;
        T.move(sym, p.entry + 5.5 * pip); checkTriggers();
        out.be1 = { done: p.be.done, sl: p.sl === sl0 };
        T.move(sym, p.entry + 8 * pip); checkTriggers();
        out.be2 = { done: p.be.done, sl: (p.sl - p.entry) / pip };
        closePosition(p.id);
        // ½ on 0.01 lots (the minimum) is refused since UX 09.11 F10: nothing closes, the position stays
        const h = openPosition({ sym, side: 'sell', lots: .01, dupOk: true }), n0 = S.history.length;
        closePosition(h.id, 'Partial close', .5);
        out.half = { open: S.positions.some(x => x.id === h.id), added: S.history.length - n0 };
        closePosition(h.id);
        // a take profit below the entry of a buy (the price fell after the open): hit at a loss
        q = Engine.quote(sym);
        const b = openPosition({ sym, side: 'buy', lots: .1, dupOk: true });
        T.move(sym, b.entry - 15 * pip);
        b.tp = Engine.quote(sym).bid + 5 * pip; changed('pos');
        T.move(sym, b.entry - 8 * pip); checkTriggers();
        out.loss = { reason: S.history[0].reason, vol: S.history[0].vol, pnl: S.history[0].pnl, open: S.positions.some(x => x.id === b.id) };
        // a take profit above the entry keeps its name
        const c = openPosition({ sym, side: 'buy', lots: .1, tpPips: 5, dupOk: true });
        T.move(sym, c.tp + 2 * pip); checkTriggers();
        out.win = S.history[0].reason;
        return out;
      });
      t.deep(r.be1, { done: false, sl: true }, 'BE not reachable yet: stop unchanged and the rule still armed');
      t.eq(r.be2.done, true, 'BE done once the stop moved'); t.near(r.be2.sl, 6, 'stop at entry + 6 pips', 1e-6, 1e-6);
      t.deep(r.half, { open: true, added: 0 }, '½ at 0.01 lots is refused: the position stays, no history row');
      t.eq(r.loss.open, false, 'the target closed the position'); t.ok(r.loss.pnl < 0, 'at a loss');
      t.eq(r.loss.reason, 'Take profit · limit at a loss', 'honest reason for a target hit at a loss');
      t.eq(r.loss.vol, false, 'a target hit at a loss is still an automatic exit (not voluntary)');
      t.eq(r.win, 'Take profit', 'a target in profit is still a Take profit');
      t.noErrors(page);
    }
  }
];
