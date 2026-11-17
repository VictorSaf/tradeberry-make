// The browser as a view over the server account (spec 2026-11-02 §Browserul, task 10): the page is signed in, its account
// is on the test broker through the test gateway (tests/fixtures/live-env.mjs), and its socket goes through the test's
// proxy (page.tl: hold / release / cut / mend, sent). Nothing in these tests executes in the browser.
const until = async (page, fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms });
// the broker's account of this page (a shared login: one account per browser device)
const acctOf = async page => page.live.acct('u1-' + await page.evaluate(() => localStorage.getItem('tb-device')));
const ticketBuy = (page, lots) => page.evaluate(lots => { const t = S.tk; t.side = 'buy'; t.ot = 'market'; t.sm = 'lots'; t.lots = lots; t.useSL = t.useTP = t.useTrail = false; syncTicketInputs(); renderTicket(); }, lots);

export const tests = [
  {
    name: 'TL1 trade-link: a Buy shows Sent, then the position once the server reports the fill',
    async run({ t, app }) {
      const page = await app('', { live: true });
      t.ok(await page.evaluate(() => TradeLink.live && TradeLink.up), 'the page is linked to the execution server');
      await ticketBuy(page, 0.1);
      page.tl.hold();
      await page.evaluate(() => $('#tkSubmit').click());
      await until(page, () => !!document.querySelector('#posBody tr.tl-sent'));
      const mid = await page.evaluate(() => ({ sent: document.querySelector('#posBody tr.tl-sent').textContent, n: S.positions.length, rows: document.querySelectorAll('#posBody tr[data-id]').length }));
      t.ok(/Sent/.test(mid.sent) && /Buy 0\.10 EUR\/USD/.test(mid.sent), 'the positions table shows the order as Sent: ' + mid.sent);
      t.eq(mid.n, 0, 'no position before the server reports the fill');
      t.eq(mid.rows, 0, 'no position row before the fill');
      t.ok(page.tl.sent.some(c => c.op === 'order' && c.sym === 'EURUSD' && c.side === 'buy' && c.lots === 0.1), 'one order command went to the gateway');
      page.tl.release();
      await until(page, () => S.positions.length === 1 && !document.querySelector('#posBody tr.tl-sent') && document.querySelectorAll('#posBody tr[data-id]').length === 1);
      const p = await page.evaluate(() => { const p = S.positions[0]; return { id: p.id, lots: p.lots, entry: p.entry, side: p.side }; });
      const b = (await acctOf(page)).acct.positions;
      t.eq(b.length, 1, 'the broker holds the position');
      t.deep(p, { id: b[0].id, lots: b[0].lots, entry: b[0].entry, side: b[0].side }, 'the page shows the broker\'s position');
      t.ok((await page.evaluate(() => S.fills[0] && S.fills[0].pos)) === b[0].id, 'the fill receipt came with the exec event');
      t.noErrors(page);
    }
  },
  {
    name: 'TL2 trade-link: a margin refusal from the server shows today\'s toast and text',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const r = await page.evaluate(async () => {
        T.clearToasts();
        await applyProfile('eu');
        await new Promise(r => setTimeout(r, 300));
        const a = await openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true });
        T.clearToasts();
        const b = await openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true });
        return { a: !!a, b, toasts: T.toasts(), n: S.positions.length, last: lastReject };
      });
      t.ok(r.a, 'the first 20 lots fill (margin 1:30 within the free margin)');
      t.eq(r.b, null, 'the second order is refused: openPosition resolves null');
      const m = r.toasts.find(x => x.title === 'Insufficient margin');
      t.ok(!!m, 'the refusal toast has today\'s title: ' + JSON.stringify(r.toasts));
      t.ok(m && /^Needs \$[\d,]+(\.\d\d)? · free \$[\d,]+(\.\d\d)?$/.test(m.body), 'and today\'s text (Needs … · free …): ' + (m && m.body));
      t.eq(r.n, 1, 'only the first position is open');
      t.noErrors(page);
    }
  },
  {
    name: 'TL3 trade-link: dragging a stop sends one modify on release; the line stays at the new level once confirmed',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const p0 = await page.evaluate(async () => {
        const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }); if (!p) return null;
        // a stop inside the visible price range (between the bid and the bottom of the price pane)
        const q = Engine.quote('EURUSD'), yb = candle.priceToCoordinate(q.bid), lo = candle.coordinateToPrice(pricePaneH() - 10);
        const sl = +(yb != null && lo != null && lo < q.bid ? q.bid - (q.bid - lo) * .5 : q.bid - 10 * M('EURUSD').pip).toFixed(5);
        const ok = await modifyPosition(p.id, { sl });
        return { id: p.id, ok, sl };
      });
      t.ok(p0 && p0.ok, 'a position with a stop: ' + JSON.stringify(p0));
      await until(page, sl => S.positions[0] && S.positions[0].sl === sl, p0.sl).catch(async e => { throw new Error('stop not shown: ' + JSON.stringify(await page.evaluate(() => ({ p: S.positions, o: S.orders }))) + ' broker ' + JSON.stringify((await acctOf(page)).acct.positions.map(p => ({ sl: p.sl, link: p.slLink })))); });
      await page.evaluate(() => { T.clearToasts(); $('#toasts').style.display = 'none'; fullChart(true); dirty.lines = true; frame(true); });
      const geo = await page.evaluate(sl => { const r = $('#chart').getBoundingClientRect(), y = candle.priceToCoordinate(sl), y2 = y == null ? null : Math.min(y + 20, pricePaneH() - 2); return y == null ? null : { x: r.left + r.width * .5, y: r.top + y, y2: r.top + y2 }; }, p0.sl);
      t.ok(!!geo, 'the stop line is on the chart');
      const n0 = page.tl.sent.filter(c => c.op === 'modify').length;
      page.tl.hold();
      // the price scale may still settle after the line appears: grab again until the stop line is held
      let g = geo;
      for (let i = 0; i < 10; i++) {
        await page.waitForTimeout(150);
        g = await page.evaluate(sl => { const r = $('#chart').getBoundingClientRect(), y = candle.priceToCoordinate(sl); return y == null ? null : { x: r.left + r.width * .5, y: r.top + y, y2: r.top + Math.min(y + 20, pricePaneH() - 2) }; }, p0.sl) || g;
        await page.mouse.move(g.x, g.y); await page.mouse.down();
        if (await page.evaluate(() => drag && drag.kind === 'pos-sl')) break;
        await page.mouse.up();
      }
      geo.y = g.y; geo.y2 = g.y2;
      for (let i = 1; i <= 6; i++) await page.mouse.move(geo.x, geo.y + (geo.y2 - geo.y) * i / 6);
      t.eq(page.tl.sent.filter(c => c.op === 'modify').length, n0, 'nothing is sent while the line moves');
      const dbg = await page.evaluate(g => ({ drag: drag && drag.kind, at: document.elementFromPoint(g.x, g.y)?.outerHTML.slice(0, 120), lines: lines.map(L => [L.kind, L.line.options().price]), geo: g }), geo);
      await page.mouse.up();
      await until(page, () => lines.some(L => L.kind === 'pos-sl' && / · Sent$/.test(L.line.options().title))).catch(async e => { throw new Error('no Sent: ' + JSON.stringify(dbg) + ' mods ' + JSON.stringify(page.tl.sent.filter(c => c.op === 'modify'))); });
      const mods = page.tl.sent.filter(c => c.op === 'modify').slice(n0);
      t.eq(mods.length, 1, 'one modify on release');
      t.ok(mods[0] && mods[0].posId === p0.id && mods[0].sl < p0.sl, 'the modify carries the new stop: ' + JSON.stringify(mods[0]));
      t.eq(await page.evaluate(() => S.positions[0].sl), p0.sl, 'the position keeps its stop until the server confirms');
      page.tl.release();
      await until(page, sl => S.positions[0].sl === sl, mods[0].sl);
      await page.evaluate(() => frame(true));
      const after = await page.evaluate(() => { const L = lines.find(x => x.kind === 'pos-sl'); return { px: L.line.options().price, title: L.line.options().title, sl: S.positions[0].sl }; });
      t.eq(after.px, mods[0].sl, 'the line stays at the new level');
      t.ok(!/Sent/.test(after.title), 'and no longer says Sent: ' + after.title);
      const b = (await acctOf(page)).acct.positions[0];
      t.eq(b.sl, mods[0].sl, 'the broker holds the new stop');
      t.noErrors(page);
    }
  },
  {
    name: 'TL8 trade-link: the readouts come from the broker: fill receipts and order log (records), the history window, the peak',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const r = await page.evaluate(async () => {
        const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true });
        const o = await placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(Engine.quote('EURUSD').ask - 0.01).toFixed(5), lots: 0.1, tif: 'GTC', dupOk: true });
        await cancelOrder(o.id);
        await closePosition(p.id);
        await TradeLink.history(); await TradeLink.records();
        return { fills: S.fills.length, kinds: S.fills.map(f => f.kind), log: S.ordLog.map(x => x.status), hist: S.history.length, peak: S.peak };
      });
      const b = (await acctOf(page)).acct;
      t.ok(r.fills >= 2 && r.kinds.includes('open') && r.kinds.includes('close'), 'the fill receipts (open, close): ' + JSON.stringify(r.kinds));
      t.ok(r.log.includes('cancelled'), 'the order log holds the cancelled order: ' + JSON.stringify(r.log));
      t.ok(r.hist >= 1, 'the history row');
      t.eq(r.peak, b.peak, "the peak is the broker's");
      t.ok(page.tl.sent.some(c => c.op === 'history' && c.size === 500), 'the history asks the newest 500 rows');
      t.noErrors(page);
    }
  },
  {
    name: 'TL9 trade-link: an order whose answer is late opens normally (no fixed 3 s); one unanswered past 3 s is not sent again after a reconnect',
    async run({ t, app }) {
      const page = await app('', { live: true });
      page.tl.hold();
      const pr = page.evaluate(() => openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }).then(p => p && p.id));
      await new Promise(r => setTimeout(r, 4000));
      page.tl.release();
      t.ok(await pr > 0, 'the position comes with its event, after 4 s');
      page.tl.hold();
      await page.evaluate(() => { window.__late = openPosition({ sym: 'EURUSD', side: 'sell', lots: 0.1, dupOk: true }).then(p => p); T.clearToasts(); });
      await new Promise(r => setTimeout(r, 300));
      page.tl.cut(); page.tl.release();
      await new Promise(r => setTimeout(r, 3500));
      page.tl.mend();
      await until(page, () => TradeLink.up, null, 40000);
      const late = await page.evaluate(async () => ({ v: await window.__late, toasts: T.toasts() }));
      t.eq(late.v, null, 'the old command is answered here');
      t.ok(late.toasts.some(x => /connection dropped before the execution server answered: check the account/.test(x.body)), 'and the toast says check the account: ' + JSON.stringify(late.toasts.map(x => x.body)));
      t.eq(page.tl.sent.filter(c => c.op === 'order' && c.side === 'sell').length, 1, 'it was not sent a second time');
      t.noErrors(page);
    }
  },
  {
    name: 'TL4 trade-link: the link down shows "Execution server unreachable" and disables the order buttons',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await ticketBuy(page, 0.1);
      t.eq(await page.evaluate(() => $('#tkSubmit').disabled), false, 'the order button works while linked');
      page.tl.cut();
      await until(page, () => !$('#tlBar').hidden && /Execution server unreachable/.test($('#tlBar').textContent));
      await page.evaluate(() => { renderTicket(); frame(true); });
      const r = await page.evaluate(async () => ({ bar: $('#tlBar').textContent, sub: $('#tkSubmit').disabled, qb: $('#qBuy').disabled, qs: $('#qSell').disabled, why: $('#qBuy').title, open: await openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }), toasts: T.toasts() }));
      t.ok(/^Execution server unreachable: orders cannot be sent/.test(r.bar), 'the bar says so: ' + r.bar);
      t.ok(r.sub && r.qb && r.qs, 'the order button and the quick-trade buttons are disabled');
      t.eq(r.why, 'Execution server unreachable', 'the quick-trade buttons say why');
      t.eq(r.open, null, 'a command from elsewhere (keyboard, DOM) is refused');
      t.ok(r.toasts.some(x => x.body === 'Execution server unreachable'), 'and says why');
      page.tl.mend();
      await until(page, () => TradeLink.up && $('#tlBar').hidden, null, 40000);
      await page.evaluate(() => { renderTicket(); frame(true); });
      t.eq(await page.evaluate(() => $('#tkSubmit').disabled), false, 'linked again: the order button works');
      t.noErrors(page);
    }
  },
  {
    name: 'TL5 trade-link: Help › Import loads only the interface preferences, never the balance or the positions',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.evaluate(async () => { await openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }); });
      await until(page, () => S.positions.length === 1);
      const before = await page.evaluate(() => ({ jur: S.set.jur, bal: S.balance, pos: S.positions.map(p => [p.id, p.lots, p.entry]), hist: S.history.length, theme: S.set.theme, fav: S.set.fav.slice() }));
      const file = { app: 'meridian-fx', version: 1, state: { balance: 5, peak: 5, positions: [{ id: 99, sym: 'GBPUSD', side: 'sell', lots: 3, entry: 1.3, open: 0 }], orders: [], history: [{ id: 98, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1, exit: 1.1, open: 0, close: 1, pnl: 10000, pips: 1000, reason: 'Take profit' }], alerts: [],
        set: { ...JSON.parse(JSON.stringify(await page.evaluate(() => S.set))), theme: before.theme === 'dark' ? 'light' : 'dark', fav: ['GBPUSD', 'USDJPY'], jur: 'us' }, tk: { lots: 2 } } };
      await page.setInputFiles('#importFile', { name: 'prefs.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(file)) });
      await until(page, () => T.toasts().some(x => x.title === 'Preferences imported'));
      const after = await page.evaluate(() => ({ bal: S.balance, pos: S.positions.map(p => [p.id, p.lots, p.entry]), hist: S.history.length, theme: S.set.theme, fav: S.set.fav.slice(), jur: S.set.jur }));
      t.eq(after.bal, before.bal, 'the balance is the server\'s');
      t.deep(after.pos, before.pos, 'the positions are the server\'s');
      t.eq(after.hist, before.hist, 'the history is the server\'s');
      t.ok(after.theme !== before.theme && after.fav.join() === 'GBPUSD,USDJPY', 'the preferences came from the file');
      t.eq(after.jur, before.jur, 'an execution setting (jurisdiction) is not imported');
      const b = (await acctOf(page)).acct;
      t.eq(b.positions.length, 1, 'the broker account did not change');
      t.noErrors(page);
    }
  },
  {
    name: 'TL7 trade-link: OCO with an order already working: it joins the group at the broker, then the new one goes; one fills, the other leaves',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const L = page.live, [b0] = L.Q.EURUSD;
      const r = await page.evaluate(async b0 => {
        const a = await placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'stop', price: +(b0 + .002).toFixed(5), lots: .1, dupOk: true });
        const b = a && await placeOrder({ sym: 'EURUSD', side: 'sell', ot: 'stop', price: +(b0 - .002).toFixed(5), lots: .1, oca: a.id, dupOk: true });
        return { a: a && a.id, b: b && b.id, n: S.orders.length, toasts: T.toasts().map(x => x.title + ' | ' + x.body) };
      }, b0);
      t.ok(r.a && r.b, 'both orders placed: ' + JSON.stringify(r));
      const mod = page.tl.sent.find(c => c.op === 'modify' && c.id === r.a), ord = page.tl.sent.filter(c => c.op === 'order').pop();
      t.ok(mod && mod.oca && ord && ord.oca === mod.oca, 'the working order joined first, the new one carries the same group: ' + JSON.stringify([mod, ord]));
      t.ok(r.toasts.some(x => /OCO with #/.test(x)), 'the placement says OCO with the first order: ' + JSON.stringify(r.toasts));
      L.quote('EURUSD', +(b0 + .0021).toFixed(5), +(b0 + .0022).toFixed(5));
      await until(page, () => S.positions.length === 1 && S.orders.length === 0);
      t.eq(await page.evaluate(() => S.ordLog.some(o => o.status === 'cancelled' && /OCO/.test(o.why || ''))), true, 'the other one left the book by OCO');
      L.quote('EURUSD', 1.16, 1.16008);
      t.noErrors(page);
    }
  },
  {
    name: 'TL6 trade-link: Reset on a demo account brings the server account back to 100000',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.evaluate(async () => { await openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); });
      await until(page, () => S.positions.length === 1 && TradeLink.type === 'demo');
      t.eq(await page.evaluate(() => $('#resetAcct').hidden), false, 'a demo account has Reset');
      await page.evaluate(() => { $('#resetAcct').click(); document.querySelector('#confirmDlg [data-cf=ok]')?.click(); });
      await until(page, () => S.positions.length === 0 && S.balance === 100000 && !S.history.length);
      t.eq((await acctOf(page)).acct.balance, 100000, 'the broker account is back to 100000');
      t.noErrors(page);
    }
  },
  {
    name: 'TL6b trade-link: on a live account the Reset control is absent',
    pending: 'every account is demo now: no live account can be made through the gateway in the test world',
    async run({ t, app }) {
      const live = await app('', { live: { user: 2 } });
      await until(live, () => TradeLink.type === 'live');
      t.eq(await live.evaluate(() => $('#resetAcct').hidden), true, 'a live account has no Reset');
    }
  },
];
