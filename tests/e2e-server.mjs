// End to end: the account on the server seen from the browsers (spec 2026-11-02, task 12). The account is user 2's
// ('solo', personal: one account u2 whatever the browser), on the test broker through the test gateway; the pages are
// real browsers (one Playwright context each), the prices the fake platform's (tests/fixtures/live-env.mjs).
// E2E1 and E2E2 run in the suite's live world; E2E3 starts its own, with the broker and the gateway as processes it
// kills (SIGKILL) and starts again. Run alone: node tests/run.mjs E2E
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLive } from './fixtures/live-env.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const until = async (page, fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms });
const wait = ms => new Promise(r => setTimeout(r, ms));
const poll = async (fn, ms = 10000, what = 'condition') => { for (const t = Date.now(); Date.now() - t < ms; await wait(50)) { const v = await fn(); if (v) return v; } throw new Error('timed out waiting for ' + what); };
const SOLO = { user: 2 };
const posOf = A => A.acct.positions.map(p => ({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, sl: p.sl ?? null }));
const pagePos = page => page.evaluate(() => S.positions.map(p => ({ id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, sl: p.sl ?? null })).sort((a, b) => a.id - b.id));
// the account flat again (what an earlier test left open is closed through the gateway)
const flat = async page => {
  await page.evaluate(async () => { for (const p of S.positions.slice()) await closePosition(p.id); for (const o of S.orders.slice()) await cancelOrder(o.id); });
  await until(page, () => S.positions.length === 0 && S.orders.length === 0);
};

export const tests = [
  {
    name: 'E2E1 server account: a stop loss hit while every browser is closed is in the history at the time it was hit',
    async run({ t, app }) {
      const a = await app('', { live: SOLO }), b = await app('', { live: SOLO });
      const L = a.live, [b0] = L.Q.EURUSD;
      await flat(a);
      const sl = +(b0 - .002).toFixed(5);
      const p = await a.evaluate(sl => openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, sl, dupOk: true }), sl);
      t.ok(p && p.id, 'a position with a stop loss');
      await until(b, ({ id, sl }) => S.positions.some(x => x.id === id && x.sl === sl), { id: p.id, sl });
      t.eq(L.acct('u2').acct.positions.find(x => x.id === p.id)?.sl, sl, 'the broker holds the stop');
      // both browsers closed, then the price goes through the stop
      await a.context().close(); await b.context().close();
      await wait(500);
      const hitAt = L.clock();
      L.quote('EURUSD', +(sl - .0005).toFixed(5), +(sl - .0004).toFixed(5));
      await poll(() => !L.acct('u2').acct.positions.some(x => x.id === p.id), 5000, 'the broker to stop the position out');
      const hitDone = L.clock();
      L.quote('EURUSD', 1.16, 1.16008);
      await wait(3000); // the page opens well after the stop: its own time cannot pass for the stop's
      const c = await app('', { live: SOLO });
      const openedAt = L.clock();
      await until(c, id => S.history.some(h => h.id === id), p.id);
      const h = await c.evaluate(id => { const h = S.history.find(h => h.id === id); return { reason: h.reason, exit: h.exit, close: h.close, n: S.positions.filter(x => x.id === id).length }; }, p.id);
      t.eq(h.n, 0, 'the position is gone from the reopened page');
      t.ok(/stop/i.test(h.reason), 'the history row is the stop loss: ' + h.reason);
      t.ok(h.exit <= sl && h.exit >= sl - .0006, `the exit is at the price that went through the stop (${sl}): ${h.exit}`);
      const closeMs = h.close * 1000;
      t.ok(closeMs >= hitAt - 1000 && closeMs <= hitDone + 1000, `the exit time is when the stop was hit (${new Date(hitAt).toISOString()}): ${new Date(closeMs).toISOString()}`);
      t.ok(openedAt - closeMs > 2500, 'not the time the page was opened');
      // what the History tab shows for it
      const row = await c.evaluate(id => {
        setTab('history'); dirty.hist = true; renderHistory();
        const i = S.history.findIndex(h => h.id === id), h = S.history[i], tds = [...$('#histBody').children[i].children].map(td => td.textContent);
        return { closed: tds[0], exit: tds[5], reason: tds[9].replace(/ Receipt$/, '').replace(/ · gap [\d.]+$/, ''), want: [dts(h.close), fp(h.sym, h.exit), h.reason] };
      }, p.id);
      t.deep([row.closed, row.exit, row.reason], row.want, 'the History tab shows that time, that exit and that reason');
      t.noErrors(c);
    }
  },
  {
    name: 'E2E2 server account: two browsers change the stop in the same second; both show the last confirmed one',
    async run({ t, app }) {
      const a = await app('', { live: SOLO }), b = await app('', { live: SOLO });
      const L = a.live, [b0] = L.Q.EURUSD;
      await flat(a);
      const p = await a.evaluate(sl => openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, sl, dupOk: true }), +(b0 - .003).toFixed(5));
      t.ok(p && p.id, 'a position with a stop loss');
      await until(b, id => S.positions.some(x => x.id === id && x.sl != null), p.id);
      const slA = +(b0 - .0021).toFixed(5), slB = +(b0 - .0017).toFixed(5);
      const [ra, rb] = await Promise.all([
        a.evaluate(({ id, sl }) => modifyPosition(id, { sl }).then(r => ({ r: !!r, t: Date.now() })), { id: p.id, sl: slA }),
        b.evaluate(({ id, sl }) => modifyPosition(id, { sl }).then(r => ({ r: !!r, t: Date.now() })), { id: p.id, sl: slB })
      ]);
      const sentA = a.tl.sent.filter(c => c.op === 'modify').pop(), sentB = b.tl.sent.filter(c => c.op === 'modify').pop();
      t.ok(sentA && sentB && sentA.sl === slA && sentB.sl === slB, 'both modifies went out: ' + JSON.stringify([sentA, sentB]));
      // fixed 03.11.2026 (final review): the second G goes against the first one's ClOrdID while it is unanswered, so
      // neither is refused ('Not found · Order not found' before); the last one confirmed stands
      t.ok(ra.r && rb.r, 'both are confirmed, no false refusal: ' + JSON.stringify([ra, rb]));
      // the broker holds the last one it confirmed; settle, then both pages must show exactly that
      await wait(1000);
      const final = L.acct('u2').acct.positions.find(x => x.id === p.id).sl;
      t.ok(final === slA || final === slB, `the broker's stop is one of the two commands: ${final}`);
      if (!ra.r) t.eq(final, slB, 'A was refused: B\'s is the stop'); if (!rb.r) t.eq(final, slA, 'B was refused: A\'s is the stop');
      for (const [n, pg] of [['A', a], ['B', b]]) {
        await until(pg, ({ id, sl }) => S.positions.find(x => x.id === id)?.sl === sl, { id: p.id, sl: final }).catch(async () => { throw new Error(`page ${n} shows ${await pg.evaluate(id => S.positions.find(x => x.id === id)?.sl, p.id)}, the broker ${final}`); });
        await pg.evaluate(() => { renderPositions?.(); frame(true); });
        const v = await pg.evaluate(id => ({ sent: !!document.querySelector('#posBody tr.tl-sent'), line: (lines.find(L => L.kind === 'pos-sl') || null)?.line.options().price ?? null, sl: S.positions.find(x => x.id === id).sl }), p.id);
        t.eq(v.sent, false, `page ${n}: nothing left as Sent`);
        t.ok(v.line == null || v.line === final, `page ${n}: the chart's stop line is the broker's (${final}): ${v.line}`);
      }
      await flat(a);
      t.noErrors(a); t.noErrors(b);
    }
  },
  {
    name: 'E2E3 server account: broker and gateway killed (-9) and started again with positions open: same positions, same balance, nothing doubled',
    async run({ t, app }) {
      const W = await startLive(ROOT, { procs: true });
      try {
        const page = await app('', { live: { ...SOLO, world: W } });
        const [e0] = W.Q.EURUSD, [g0] = W.Q.GBPUSD;
        const r = await page.evaluate(async ({ e0, g0 }) => {
          const p1 = await openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, sl: +(e0 - .003).toFixed(5), dupOk: true });
          const p2 = await openPosition({ sym: 'GBPUSD', side: 'sell', lots: .2, dupOk: true });
          const o1 = await placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(e0 - .005).toFixed(5), lots: .1, dupOk: true });
          return { p1: p1 && p1.id, p2: p2 && p2.id, o1: o1 && o1.id };
        }, { e0, g0 });
        t.ok(r.p1 && r.p2 && r.o1, 'two positions and a working order: ' + JSON.stringify(r));
        await until(page, () => S.positions.length === 2 && S.orders.length === 1);
        // a third order in flight when everything dies: the broker has filled it, the page has no answer yet
        page.tl.hold();
        const third = page.evaluate(() => openPosition({ sym: 'USDJPY', side: 'buy', lots: .1, dupOk: true }).then(p => p && p.id));
        await poll(() => W.acct('u2')?.acct.positions.length === 3, 5000, 'the broker to fill the third order');
        const before = W.acct('u2').acct, fills0 = W.B.fills('u2'), trades0 = W.B.trades('u2').length;
        // the page's link watch: every change of what it shows about the link
        await page.evaluate(() => { window._link = []; let last = null; setInterval(() => { const s = (TradeLink.up ? 'up' : 'down') + '|' + ($('#tlBar').hidden ? '' : $('#tlBar').textContent); if (s !== last) { last = s; window._link.push(s); } }, 50); });
        await Promise.all([W.G.kill(), W.B.kill()]);
        page.tl.queue.length = 0; page.tl.held = false; // what the dead gateway had answered never reaches the page
        await until(page, () => window._link.some(s => /^down\|Execution server unreachable/.test(s)), null, 10000);
        await wait(1500);
        await W.B.start(); await W.G.start();
        await poll(() => W.G.link === 'up', 15000, 'the gateway to link to the broker again');
        await until(page, () => TradeLink.up && $('#tlBar').hidden, null, 40000);
        const id3 = await third;
        await until(page, () => S.positions.length === 3);
        await wait(500);
        const after = W.acct('u2').acct;
        // M8 (final review): an unanswered command older than 3 s is not sent again after the reconnect; the page answers it
        // "check the account", and the account it shows (the snapshot) holds the position the broker filled
        t.eq(id3, null, 'the order in flight past 3 s is answered "check the account", not sent again');
        t.ok(await page.evaluate(() => T.toasts().some(x => /check the account/.test(x.body))), 'the toast says to check the account');
        t.deep(posOf({ acct: after }), posOf({ acct: before }), 'the broker holds the same positions');
        t.eq(after.balance, before.balance, 'and the same balance');
        t.deep(after.orders.map(o => o.clOrdId), before.orders.map(o => o.clOrdId), 'and the same working orders');
        t.eq(W.B.fills('u2'), fills0, 'no fill doubled (the order in flight was not executed again)');
        t.eq(W.B.trades('u2').length, trades0, 'no trade booked by the restart');
        t.ok(after.positions.some(p => p.sym === 'USDJPY'), 'the broker filled the order in flight once, and the page shows it');
        const shown = await page.evaluate(() => ({ bal: S.balance, n: S.positions.length, ids: new Set(S.positions.map(p => p.id)).size, ord: S.orders.map(o => o.id) }));
        t.deep(await pagePos(page), posOf({ acct: after }).sort((a, b) => a.id - b.id), 'the page shows the broker\'s positions');
        t.eq(shown.ids, shown.n, 'no position shown twice');
        t.eq(shown.bal, after.balance, 'the page shows the broker\'s balance');
        t.deep(shown.ord, after.orders.map(o => o.clOrdId), 'and its working order');
        const seq = await page.evaluate(() => window._link);
        const iDown = seq.findIndex(s => s.startsWith('down|')), iUp = seq.findIndex((s, i) => i > iDown && s === 'up|');
        t.ok(iDown >= 0 && iUp > iDown, 'the page showed the link down, then up: ' + JSON.stringify(seq));
        // and it trades again: one command, one effect (a buy on the EURUSD long adds to it: netting)
        const p4 = await page.evaluate(() => openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true }).then(p => p && p.id));
        t.eq(p4, r.p1, 'an order after the restart fills (it adds to the EURUSD long)');
        await poll(() => W.B.fills('u2') === fills0 + 1, 5000, 'its fill at the broker');
        await wait(500);
        t.eq(W.B.fills('u2'), fills0 + 1, 'one fill for it');
        t.near(W.acct('u2').acct.positions.find(p => p.id === r.p1).lots, .2, 'the long holds 0.10 + 0.10 lots');
        t.noErrors(page);
      } finally { await W.close(); }
    }
  },
];
