// UX test of the Trade page, 09.11.2026 (.mace/research/ux-2026-11-09-trade/04-report.md), task core:
// F10 an honest "½": the half goes down to the instrument's step; under the minimum size nothing is sent and the
// toast says why; a close that takes the whole position is recorded as Manual, never as "Partial close"; the toast of
// a partial close says what is left. Same rule on the sandbox (trade.js closePos) and the live account (tlClose).
// halfLots(p) is the contract the ticket and the positions table use to grey "½" out.
// F3 (labels only, behaviour unchanged): the leverage texts say "sheet default 1:500 · no EU limit (ESMA caps EUR/USD
// at 1:30)" where they said "no jurisdiction cap".
const TUE = new Date('2026-10-20T10:00:00Z'); // Tuesday, FX open
const fresh = () => { T.reset(); S.set.jur = 'none'; S.set.lev = null; S.set.comm = 0; };
const until = async (page, fn, arg, ms = 10000) => page.waitForFunction(fn, arg, { timeout: ms });

export const tests = [
  {
    name: 'UXC1 CL ½ honest (sandbox): 0.01 refused with the reason, 0.10 → 0.05 left, 0.03 → 0.01 closed (down to the step), a whole close is Manual',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const sym = 'EURUSD', out = {};
        // 0.01 lots: '½' unavailable, refused, nothing closed
        const a = openPosition({ sym, side: 'buy', lots: .01, dupOk: true });
        out.halfA = halfLots(a); out.aId = a.id; T.clearToasts();
        const h0 = S.history.length;
        closePosition(a.id, 'Partial close', .5);
        out.a = { open: S.positions.includes(a), lots: a.lots, hist: S.history.length - h0, toasts: T.toasts(), why: lastReject };
        closePosition(a.id);
        // 0.10 lots: 0.05 closed, 0.05 left
        const b = openPosition({ sym, side: 'buy', lots: .1, dupOk: true });
        out.halfB = halfLots(b); T.clearToasts();
        closePosition(b.id, 'Partial close', .5);
        out.b = { open: S.positions.includes(b), lots: b.lots, closed: S.history[0].lots, reason: S.history[0].reason, toasts: T.toasts() };
        closePosition(b.id);
        // 0.03 lots: 0.01 closed (down to the step), 0.02 left
        const c = openPosition({ sym, side: 'sell', lots: .03, dupOk: true });
        out.halfC = halfLots(c);
        closePosition(c.id, 'Partial close', .5);
        out.c = { open: S.positions.includes(c), lots: c.lots, closed: S.history[0].lots, reason: S.history[0].reason };
        closePosition(c.id);
        // a part that takes everything closes the whole position, recorded as Manual
        const d = openPosition({ sym, side: 'buy', lots: .02, dupOk: true });
        closePosition(d.id, 'Partial close', 1);
        out.d = { open: S.positions.includes(d), closed: S.history[0].lots, reason: S.history[0].reason };
        out.partialFull = S.history.filter(h => h.reason === 'Partial close' && !h.leg).map(h => h.lots);
        out.none = halfLots(null);
        return out;
      }, fresh.toString());
      t.eq(r.halfA, 0, 'halfLots(0.01) = 0: ½ unavailable');
      t.deep([r.a.open, r.a.lots, r.a.hist], [true, .01, 0], '½ on 0.01: refused, the position stays, no history row');
      t.ok(r.a.toasts.some(x => x.title === "Can't close half" && x.body === `EUR/USD #${r.aId} is at the minimum size (0.01): use Close to close it all`), 'refusal toast: ' + JSON.stringify(r.a.toasts));
      t.ok(/minimum size/.test(r.a.why), 'lastReject says why: ' + r.a.why);
      t.eq(r.halfB, .05, 'halfLots(0.10) = 0.05');
      t.deep([r.b.open, r.b.lots, r.b.closed, r.b.reason], [true, .05, .05, 'Partial close'], '0.10: 0.05 closed as Partial close, 0.05 left');
      t.ok(r.b.toasts.some(x => x.title === 'Partial close: 0.05 of 0.10 closed, 0.05 left'), 'toast says what is left: ' + JSON.stringify(r.b.toasts));
      t.eq(r.halfC, .01, 'halfLots(0.03) = 0.01 (down to the step)');
      t.deep([r.c.open, r.c.lots, r.c.closed, r.c.reason], [true, .02, .01, 'Partial close'], '0.03: 0.01 closed, 0.02 left');
      t.deep([r.d.open, r.d.closed, r.d.reason], [false, .02, 'Manual'], 'a part that takes everything closes all, recorded as Manual');
      t.deep(r.partialFull, [.01, .05], 'no whole close is recorded as Partial close');
      t.eq(r.none, 0, 'halfLots(null) = 0');
      t.noErrors(page);
    }
  },
  {
    name: 'UXC2 CL ½ honest on shares: 1 share refused, 3 shares → 1 closed, 2 left',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-20T15:00:00Z') });
      const r = await page.evaluate(fresh => {
        eval(fresh)();
        const sym = 'AAPL.US', out = {};
        const a = openPosition({ sym, side: 'buy', lots: 1, dupOk: true });
        out.halfA = halfLots(a); T.clearToasts();
        closePosition(a.id, 'Partial close', .5);
        out.a = { open: S.positions.includes(a), toasts: T.toasts() };
        closePosition(a.id);
        const b = openPosition({ sym, side: 'buy', lots: 3, dupOk: true });
        out.halfB = halfLots(b);
        closePosition(b.id, 'Partial close', .5);
        out.b = { lots: b.lots, closed: S.history[0].lots, reason: S.history[0].reason };
        return out;
      }, fresh.toString());
      t.eq(r.halfA, 0, 'halfLots(1 share) = 0');
      t.ok(r.a.open && r.a.toasts.some(x => x.title === "Can't close half" && /is at the minimum size \(1\): use Close to close it all/.test(x.body)), '1 share: refused ' + JSON.stringify(r.a.toasts));
      t.eq(r.halfB, 1, 'halfLots(3 shares) = 1');
      t.deep(r.b, { lots: 2, closed: 1, reason: 'Partial close' }, '3 shares: 1 closed, 2 left');
      t.noErrors(page);
    }
  },
  {
    name: 'UXC3 CL ½ honest (live): 0.01 sends nothing, 0.10 sends lots 0.05, 0.03 sends lots 0.01; the toast says what is left',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const p = await page.evaluate(async () => { const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: .01, dupOk: true }); return p && p.id; });
      t.ok(p != null, 'position of 0.01 open');
      await until(page, id => S.positions.some(x => x.id === id), p);
      const n0 = page.tl.sent.length;
      const a = await page.evaluate(async id => { T.clearToasts(); const ok = await closePosition(id, 'Partial close', .5); return { ok, half: halfLots(S.positions.find(x => x.id === id)), open: S.positions.some(x => x.id === id), toasts: T.toasts() }; }, p);
      t.eq(page.tl.sent.slice(n0).filter(c => c.op === 'close').length, 0, '0.01: nothing sent');
      t.deep([a.ok, a.half, a.open], [false, 0, true], '0.01: refused, the position stays');
      t.ok(a.toasts.some(x => x.title === "Can't close half" && x.body === `EUR/USD #${p} is at the minimum size (0.01): use Close to close it all`), 'refusal toast: ' + JSON.stringify(a.toasts));
      await page.evaluate(id => closePosition(id), p);
      await until(page, id => !S.positions.some(x => x.id === id), p);
      // 0.10 → lots 0.05
      const q = await page.evaluate(async () => { const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true }); return p && p.id; });
      await until(page, id => S.positions.some(x => x.id === id), q);
      const n1 = page.tl.sent.length;
      await page.evaluate(id => { T.clearToasts(); return closePosition(id, 'Partial close', .5); }, q);
      const c1 = page.tl.sent.slice(n1).filter(c => c.op === 'close');
      t.ok(c1.length === 1 && c1[0].lots === .05 && c1[0].reason === 'Partial close', 'one close with lots 0.05: ' + JSON.stringify(c1));
      await until(page, id => { const p = S.positions.find(x => x.id === id); return p && p.lots === .05; }, q);
      await until(page, () => [...document.querySelectorAll('#toasts .toast b')].some(b => /^Partial close:/.test(b.textContent)));
      const t1 = await page.evaluate(() => T.toasts());
      t.ok(t1.some(x => x.title === 'Partial close: 0.05 of 0.10 closed, 0.05 left'), 'live toast says what is left: ' + JSON.stringify(t1));
      await page.evaluate(id => closePosition(id), q);
      await until(page, id => !S.positions.some(x => x.id === id), q);
      // 0.03 → lots 0.01
      const s = await page.evaluate(async () => { const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: .03, dupOk: true }); return p && p.id; });
      await until(page, id => S.positions.some(x => x.id === id), s);
      const n2 = page.tl.sent.length;
      await page.evaluate(id => closePosition(id, 'Partial close', .5), s);
      const c2 = page.tl.sent.slice(n2).filter(c => c.op === 'close');
      t.ok(c2.length === 1 && c2[0].lots === .01, 'one close with lots 0.01: ' + JSON.stringify(c2));
      // a part that takes everything: a whole close, reason Manual
      await until(page, id => { const p = S.positions.find(x => x.id === id); return p && p.lots === .02; }, s);
      const n3 = page.tl.sent.length;
      await page.evaluate(id => closePosition(id, 'Partial close', 1), s);
      const c3 = page.tl.sent.slice(n3).filter(c => c.op === 'close');
      t.ok(c3.length === 1 && c3[0].lots == null && c3[0].reason === 'Manual', 'a whole close goes as Manual, no lots: ' + JSON.stringify(c3));
      t.noErrors(page);
    }
  },
  {
    name: 'UXC4 F3 labels: with no jurisdiction cap the Lev title says the sheet default and that there is no EU limit',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(fresh => {
        eval(fresh)(); syncLevSel();
        const out = { title: $('#levSel') ? $('#levSel').title : null, lev: effLev('EURUSD') };
        S.set.jur = 'eu'; S.set.lev = 30; syncLevSel(); out.eu = $('#levSel').title;
        S.set.jur = 'none'; S.set.lev = null; syncLevSel();
        return out;
      }, fresh.toString());
      t.ok(/sheet default 1:500 · no EU limit \(ESMA caps EUR\/USD at 1:30\)/.test(r.title), 'Lev title: ' + r.title);
      t.ok(!/no jurisdiction cap/.test(r.title), 'no "no jurisdiction cap" any more');
      t.eq(r.lev, 500, 'behaviour unchanged: EURUSD still 1:500 with no cap');
      t.ok(/capped by EU retail/.test(r.eu), 'EU profile still named: ' + r.eu);
      t.noErrors(page);
    }
  },
  // ---- round 2 (core2, 09.11.2026): the testers' defects on round 1 ----
  {
    name: 'UXK1 CL live ½: the toast comes from the command (lots when sent, lots closed), also when the history row comes before the gateway pos event',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const id = await page.evaluate(async () => { const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true }); return p && p.id; });
      await until(page, id => S.positions.some(x => x.id === id), id);
      const ctl = page.tl, isPos = m => { try { const x = JSON.parse(m); return x.ev === 'pos' && x.pos && x.pos.id === id; } catch (e) { return false; } };
      ctl.hold();
      await page.evaluate(id => { T.clearToasts(); closePosition(id, 'Partial close', .5); }, id);
      // the server's messages go through in order, except the position's own 'pos' event, held back until the toast is out
      let toast = null;
      for (let i = 0; i < 200 && !toast; i++) {
        for (const q of ctl.queue.filter(([, m]) => !isPos(m))) { ctl.queue.splice(ctl.queue.indexOf(q), 1); q[0].send(q[1]); }
        await new Promise(r => setTimeout(r, 50));
        toast = await page.evaluate(() => T.toasts().find(x => /^Partial close/.test(x.title)) || null);
      }
      const posHeld = ctl.queue.some(([, m]) => isPos(m)), mirror = await page.evaluate(id => S.positions.find(x => x.id === id).lots, id);
      ctl.release();
      t.ok(posHeld && mirror === .1, `the pos event was still held when the toast came (mirror ${mirror}, held ${posHeld})`);
      t.eq(toast && toast.title, 'Partial close: 0.05 of 0.10 closed, 0.05 left', 'toast from the command, not from the mirror');
      await until(page, id => { const p = S.positions.find(x => x.id === id); return p && p.lots === .05; }, id);
      await page.evaluate(id => closePosition(id), id);
      await until(page, id => !S.positions.some(x => x.id === id), id);
      t.noErrors(page);
    }
  },
  {
    name: 'UXK2 CL closeLots: a whole close needs no instrument sheet (an unknown instrument still closes on the server); a part on it is refused without throwing',
    async run({ t, app }) {
      const page = await app('', { live: true });
      const r = await page.evaluate(async () => {
        const fake = { id: 987654, sym: 'ZZZQQQ', side: 'buy', lots: 1, entry: 1, fills: [] }, out = {};
        out.whole = closeLots(fake, 1); out.def = closeLots(fake); out.half = closeLots(fake, .5);
        try { partRefuse(fake, .5); out.why = lastReject; } catch (e) { out.err = String(e); }
        S.positions.push(fake);
        let pr; try { pr = tlClose(fake.id, 'Manual', 1); } catch (e) { out.err2 = String(e); }
        S.positions.splice(S.positions.indexOf(fake), 1);
        out.res = await pr;
        return out;
      });
      const sent = page.tl.sent.filter(c => c.op === 'close' && c.posId === 987654);
      t.deep([r.whole, r.def, r.half], [1, 1, 0], 'closeLots: whole = p.lots, part = 0 on an unknown instrument');
      t.ok(!r.err && !r.err2, 'no throw: ' + (r.err || r.err2 || ''));
      t.ok(/size rules are not known/.test(r.why || ''), 'the refusal says why: ' + r.why);
      t.ok(sent.length === 1 && sent[0].lots == null && sent[0].reason === 'Manual', 'the whole close went to the server as before: ' + JSON.stringify(sent));
      t.noErrors(page);
    }
  },
  {
    name: 'UXK3 CL ½ refused at the minimum size counts no voluntary sale and sends no meta (sandbox and live)',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const a = await page.evaluate(fresh => {
        eval(fresh)();
        let n = 0; const d0 = dispoSale; dispoSale = function () { n++; return d0.apply(this, arguments); };
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .01, dupOk: true });
        closePosition(p.id, 'Partial close', .5);
        const refused = n, open = S.positions.includes(p);
        const q = openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true });
        closePosition(q.id, 'Partial close', .5);
        const half = n; dispoSale = d0; closePosition(p.id); closePosition(q.id);
        return { refused, open, half };
      }, fresh.toString());
      t.deep([a.refused, a.open], [0, true], 'sandbox: a refused ½ counts no sale, the position stays');
      t.eq(a.half, 1, 'sandbox: a real ½ still counts');
      const live = await app('', { live: true });
      const id = await live.evaluate(async () => { const p = await openPosition({ sym: 'EURUSD', side: 'buy', lots: .01, dupOk: true }); return p && p.id; });
      await until(live, id => S.positions.some(x => x.id === id), id);
      const n0 = live.tl.sent.length;
      const b = await live.evaluate(async id => { let n = 0; const d0 = dispoSale; dispoSale = function () { n++; return d0.apply(this, arguments); }; const ok = await closePosition(id, 'Partial close', .5); dispoSale = d0; return { ok, n }; }, id);
      const after = live.tl.sent.slice(n0);
      t.deep([b.ok, b.n], [false, 0], 'live: refused, no sale counted');
      t.eq(after.filter(c => c.op === 'meta' || c.op === 'close').length, 0, 'live: no meta and no close sent: ' + JSON.stringify(after));
      await live.evaluate(id => closePosition(id), id);
      await until(live, id => !S.positions.some(x => x.id === id), id);
      t.noErrors(page); t.noErrors(live);
    }
  },
  {
    name: 'UXK4 BK ½ on a basket: the 20% check uses the lots the close really takes; the basket size follows the legs left',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(() => loadLazy());
      await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof bkCfg === 'function', null, { timeout: 30000 });
      const r = await page.evaluate(() => {
        T.reset(); S.bkPos = []; S.bkOrders = []; S.bkAlerts = []; S.bkHist = [];
        const b = bkGet('dxy'), c = bkCfg(); c.bkMode = 'lots'; c.bkSl = 'auto'; c.bkTp = 'auto'; c.bkTrail = 0; c.bkBe = 0; c.bkEntry = 'market';
        // small: a leg at the minimum size cannot be halved; the refusal names it
        c.bkLots = .1; bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        const g0 = S.bkPos[0], tiny = S.positions.filter(p => p.bgid === g0.gid && !closeLots(p, .5)).length;
        T.clearToasts(); bkHalf(g0.gid); const small = T.toasts().map(x => x.body).join(' | ');
        bkCloseGroup(g0.gid);
        c.bkLots = 2; bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        const g = S.bkPos[0], legs = S.positions.filter(p => p.bgid === g.gid);
        const want = legs.map(p => +(p.lots - closeLots(p, .5)).toFixed(2)), n0 = legs.reduce((a, p) => a + notionalUsd(p.sym, p.lots), 0), l0 = g.lots, r0 = g.risk;
        bkHalf(g.gid);
        const now = S.positions.filter(p => p.bgid === g.gid), n1 = now.reduce((a, p) => a + notionalUsd(p.sym, p.lots), 0);
        return { tiny, small, want, got: now.map(p => p.lots), l0, lots: g.lots, k: n1 / n0, r0, risk: g.risk };
      });
      if (r.tiny) t.ok(/none \(minimum size 0\.01\)/.test(r.small), 'a leg at the minimum size is named: ' + r.small);
      t.deep(r.got, r.want, 'each leg lost exactly closeLots(p, ½)');
      t.near(r.lots, r.l0 * r.k, 'basket size = before × notional left / notional before', 1e-3);
      t.ok(Math.abs(r.lots - r.l0 / 2) > 1e-9 || Math.abs(r.k - .5) < 1e-9, `not a blind halving (${r.l0} → ${r.lots}, k ${r.k})`);
      if (r.r0) t.near(r.risk, r.r0 * r.k, 'risk follows the same fraction', 1e-6);
      t.noErrors(page);
    }
  },
  {
    name: 'UXK5 F3 leverage kept after migration: the toast has no parentheses inside parentheses, same information',
    async run({ t, app }) {
      const page = await app('', { clock: TUE });
      const r = await page.evaluate(async () => {
        T.reset();
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true });
        const old = JSON.parse(JSON.stringify(S)); delete old.set.jur; old.set.lev = 100;
        store.set(old); loadState(); T.clearToasts();
        await new Promise(r => setTimeout(r, 50));
        const out = { plain: noCapText(), toast: T.toasts().find(x => /^Leverage kept at 1:100/.test(x.title)) || null };
        closePosition(S.positions.find(x => x.id === p.id).id);
        return out;
      });
      const body = r.toast ? r.toast.body : '';
      let depth = 0, max = 0; for (const ch of body) { if (ch === '(') max = Math.max(max, ++depth); else if (ch === ')') depth--; }
      t.ok(!!r.toast, 'the migration toast is shown');
      t.eq(max, 1, 'no parentheses inside parentheses: ' + body);
      t.ok(/keeps 1:100, never above an instrument's sheet maximum \(sheet default 1:500 · no EU limit; ESMA caps EUR\/USD at 1:30\)\. A retail cap can be set under Settings › Jurisdiction cap/.test(body), 'same information: ' + body);
      t.eq(r.plain, 'sheet default 1:500 · no EU limit (ESMA caps EUR/USD at 1:30)', 'the other leverage texts unchanged');
      t.noErrors(page);
    }
  },
  {
    name: 'UXK6 TL a static local page with an old tb_u=1 cookie (no /api: /api/me 404) keeps the local account and drops the cookie',
    async run({ t, open }) {
      const page = await open('/');
      const origin = new URL(page.url()).origin;
      await page.context().addCookies([{ name: 'tb_u', value: '1', url: origin }]);
      await page.reload();
      await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({ live: TradeLink.live, bar: (document.getElementById('tlBar') || {}).textContent || '', down: document.documentElement.classList.contains('tl-down'), blocks: tkBlocks(tkCalc()).map(b => b.btn) }));
      const ck = (await page.context().cookies(origin)).filter(c => c.name === 'tb_u' && c.value === '1');
      t.eq(r.live, false, 'TradeLink.live = false on a page without the API');
      t.ok(!/unreachable/i.test(r.bar) && !r.down, 'no "Execution server unreachable": ' + r.bar);
      t.ok(!r.blocks.includes('Execution server unreachable'), 'the order buttons are not blocked by the link: ' + JSON.stringify(r.blocks));
      t.eq(ck.length, 0, 'the stale tb_u cookie is removed on this host');
      t.noErrors(page);
    }
  }
];
