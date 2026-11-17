// Wave 0 (app): manual actions do exactly what they say, and state from outside is validated field by field.
// Break-even only tightens, an inline stop edit keeps the trail, mass and destructive actions ask first (with what
// would be lost), Rev says it opens without protection, the ticket blocks a break-even offset at or past its trigger
// and warns on a take profit that books a loss, sanitizeState repairs or rejects the behaviour fields with a reason.
const setup = () => {
  window.W = {
    // wsVars applies the layout now: the empty Positions panel unfolds on a MutationObserver, after this script
    row: id => { frame(true); window.wsVars?.(); return document.querySelector(`#posBody tr[data-id="${id}"]`); },
    act: (id, a) => W.row(id).querySelector(`[data-act=${a}]`).click(),
    // inline edit of a cell in the positions table: click, type, blur
    edit(id, f, v) { const td = W.row(id).querySelector(`[data-edit=${f}]`); td.click(); const pop = document.querySelector('.xp-pop'), i = pop.querySelector('input'); i.value = v; i.dispatchEvent(new Event('input')); pop.querySelector(v === '' ? '.xp-rm' : '.xp-ok')?.click(); document.querySelector('.xp-pop')?.querySelector('.xp-c').click(); },
    dlg: () => { const d = document.getElementById('confirmDlg'); return d && !d.hidden ? { title: d.querySelector('h2').textContent, body: d.querySelector('.cf-body').textContent, ok: d.querySelector('[data-cf=ok]').textContent } : null; },
    ok: () => document.querySelector('#confirmDlg [data-cf=ok]').click(),
    cancel: () => document.querySelector('#confirmDlg [data-cf=cancel]').click(),
    last: () => T.toasts().pop() || {}
  };
};

export const tests = [
  {
    name: 'W0A1 manual break-even only tightens: a stop at +25 stays, no move before entry, the price decides (not swap)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(setup);
      const r = await page.evaluate(() => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        T.reset();
        const p = openPosition({ sym, side: 'buy', lots: 1, sl: Engine.quote(sym).bid - 20 * pip, dupOk: true });
        T.move(sym, p.entry + 40 * pip); p.sl = +(p.entry + 25 * pip).toFixed(5); const sl25 = p.sl;
        T.clearToasts(); W.act(p.id, 'be'); out.row = { same: p.sl === sl25, toast: W.last().title };
        T.clearToasts(); parseCmd('be').run(); out.cmd = { same: p.sl === sl25, toast: W.last() };
        // a fresh position: the bid is below entry, nothing to lock in
        T.reset();
        const q = openPosition({ sym, side: 'sell', lots: 1, dupOk: true });
        W.act(q.id, 'be'); out.early = { sl: q.sl, toast: W.last().title };
        // price past entry while swap makes the P&L negative: break-even is about the price
        T.move(sym, q.entry - 8 * pip); q.swap = -5000; T.clearToasts();
        W.act(q.id, 'be'); out.swap = { sl: q.sl, entry: q.entry, pnl: posPnl(q).pnl, toast: W.last().title };
        return out;
      });
      t.deep(r.row, { same: true, toast: 'Stop is already tighter than break-even' }, 'row BE keeps a stop at +25');
      t.ok(r.cmd.same, 'be command keeps a stop at +25');
      t.ok(/1 already tighter/.test(r.cmd.toast.body), 'be command says why: ' + r.cmd.toast.body);
      t.deep(r.early, { sl: null, toast: 'Price is not past entry yet' }, 'no break-even before price passes entry');
      t.ok(r.swap.pnl < 0 && r.swap.sl === r.swap.entry, 'price past entry with negative swap: stop to entry');
      t.eq(r.swap.toast, 'Stop at break-even', 'confirmation toast');
      t.noErrors(page);
    }
  },
  {
    name: 'W0A2 inline stop edit keeps the trailing stop; a trail that overrides the new level is announced',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(setup);
      const r = await page.evaluate(() => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        T.reset();
        const p = openPosition({ sym, side: 'buy', lots: 1, sl: Engine.quote(sym).bid - 30 * pip, trail: 10, dupOk: true });
        const lvl = +(Engine.quote(sym).bid - 20 * pip).toFixed(5);
        T.clearToasts(); W.edit(p.id, 'sl', String(lvl)); out.edit = { sl: p.sl, lvl, trail: p.trail };
        T.move(sym, p.entry + 25 * pip); checkTriggers(); out.after = { trailed: !!p.trailed, sl: p.sl, want: Engine.quote(sym).bid - 10 * pip };
        // a looser stop under an active trail: the trail is tighter and takes the stop back on the next check
        T.clearToasts(); W.edit(p.id, 'sl', (p.entry + 2 * pip).toFixed(5)); out.over = { trail: p.trail, toast: W.last() };
        checkTriggers(); out.overSl = { sl: p.sl, want: Engine.quote(sym).bid - 10 * pip };
        return out;
      });
      t.near(r.edit.sl, r.edit.lvl, 'stop moved to the typed level', 0, 1e-9);
      t.eq(r.edit.trail, 10, 'trail kept after the edit');
      t.ok(r.after.trailed, 'trail still follows the price after the edit');
      t.near(r.after.sl, r.after.want, 'stop trails the bid by 10 pips', 0, 1e-9);
      t.eq(r.over.trail, 10, 'trail kept');
      t.eq(r.over.toast.title, 'Trailing stop is tighter', 'user told the trail overrides the new level');
      t.near(r.overSl.sl, r.overSl.want, 'the trail takes the stop back', 0, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'W0A3 Close all / Shift+X / Reset / Load demo / Start clean / Clear ask first, with what would be lost',
    async run({ t, app }) {
      const page = await app('', { clock: true, demo: true });
      await page.evaluate(setup);
      await page.waitForFunction(() => document.getElementById('demoBtn'), null, { timeout: 10000 });
      const r = await page.evaluate(() => {
        const out = {};
        T.reset(); frame(true); out.disabled0 = document.getElementById('closeAll').disabled;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); openPosition({ sym: 'GBPUSD', side: 'sell', lots: 1, dupOk: true });
        frame(true); out.disabled2 = document.getElementById('closeAll').disabled;
        document.getElementById('closeAll').click(); out.ca = W.dlg(); out.caN = S.positions.length;
        W.cancel(); out.caCancel = S.positions.length;
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'X', shiftKey: true, bubbles: true })); out.sx = W.dlg(); out.sxN = S.positions.length;
        W.ok(); out.sxOk = S.positions.length;
        // Reset with closed trades
        out.hist = S.history.length;
        document.getElementById('resetAcct').click(); out.rs = W.dlg(); out.rsN = S.history.length; W.cancel();
        document.getElementById('demoBtn').click(); out.ld = W.dlg(); W.cancel();
        document.getElementById('demoClear').click(); out.sc = W.dlg(); out.scN = S.history.length; W.ok(); out.scOk = S.history.length;
        // an empty account still loses the saved layouts and settings of this device: one question (UX-2)
        document.getElementById('resetAcct').click(); out.rsEmpty = W.dlg(); W.ok();
        // Clear on the chart
        S.hlines[S.set.sym] = [Engine.mid(S.set.sym)]; addAlert(S.set.sym, Engine.mid(S.set.sym) * 1.01, 'above');
        document.querySelector('#toolSeg [data-tool=clear]').click(); out.cl = W.dlg(); out.clN = S.hlines[S.set.sym].length;
        W.ok(); out.clOk = S.hlines[S.set.sym].length;
        return out;
      });
      t.eq(r.disabled0, true, 'Close all disabled with no positions');
      t.eq(r.disabled2, false, 'Close all enabled with positions');
      t.ok(r.ca && /2 positions/.test(r.ca.title) && /floating/i.test(r.ca.body), 'Close all asks with count and P&L: ' + JSON.stringify(r.ca));
      t.eq(r.caN, 2, 'nothing closed before the answer'); t.eq(r.caCancel, 2, 'cancel keeps both');
      t.ok(r.sx && /2 positions/.test(r.sx.title), 'Shift+X asks too'); t.eq(r.sxN, 2, 'Shift+X waits'); t.eq(r.sxOk, 0, 'confirmed: all closed');
      t.ok(r.rs && /Export first/.test(r.rs.body) && /2 closed trades/.test(r.rs.body), 'Reset asks with the loss and Export first: ' + JSON.stringify(r.rs));
      t.eq(r.rsN, r.hist, 'Reset waits');
      t.ok(r.ld && /Export first/.test(r.ld.body), 'Load demo history asks: ' + JSON.stringify(r.ld));
      t.ok(r.sc && /Export first/.test(r.sc.body), 'Start clean asks'); t.eq(r.scN, 2, 'Start clean waits'); t.eq(r.scOk, 0, 'Start clean confirmed');
      t.ok(r.rsEmpty && /Saved layouts and settings/.test(r.rsEmpty.body), 'empty account: reset says the saved layouts go too');
      t.ok(r.cl && /1 level/.test(r.cl.body) && /1 alert/.test(r.cl.body), 'Clear lists what goes: ' + JSON.stringify(r.cl));
      t.eq(r.clN, 1, 'Clear waits'); t.eq(r.clOk, 0, 'Clear confirmed');
      t.noErrors(page);
    }
  },
  {
    name: 'W0A4 Rev asks, says the new position has no SL/TP, and reports a reverse that could not open',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(setup);
      const r = await page.evaluate(() => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        T.reset();
        const p = openPosition({ sym, side: 'buy', lots: 1, sl: Engine.quote(sym).bid - 20 * pip, tp: Engine.quote(sym).ask + 40 * pip, dupOk: true });
        W.act(p.id, 'rev'); out.dlg = W.dlg(); out.n = S.positions.length; W.ok();
        const n = S.positions[0]; out.after = { n: S.positions.length, side: n?.side, sl: n?.sl, tp: n?.tp, reason: S.history[0]?.reason };
        // the reverse leg refused: the first leg is closed, and the toast says so
        const op = window.openPosition; window.openPosition = () => { lastReject = 'insufficient margin (test)'; return null; };
        try { W.act(n.id, 'rev'); W.ok(); } finally { window.openPosition = op; }
        out.fail = { n: S.positions.length, toast: W.last() };
        return out;
      });
      t.ok(r.dlg && /without a stop loss or take profit/.test(r.dlg.body), 'confirmation says no SL/TP: ' + JSON.stringify(r.dlg));
      t.eq(r.n, 1, 'nothing happens before the answer');
      t.deep(r.after, { n: 1, side: 'sell', sl: null, tp: null, reason: 'Reversed' }, 'reversed into a sell without protection');
      t.eq(r.fail.n, 0, 'first leg closed');
      t.eq(r.fail.toast.title, 'Reverse incomplete', 'failure reported');
      t.ok(/insufficient margin \(test\)/.test(r.fail.toast.body) && /flat/.test(r.fail.toast.body), 'with the reason: ' + r.fail.toast.body);
      t.noErrors(page);
    }
  },
  {
    name: 'W0A5 ticket blocks a break-even offset at or past its trigger; a take profit that books a loss is a warning',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(setup);
      const r = await page.evaluate(() => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        T.reset(); setSymbol(sym);
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 1, useSL: true, sl: 20, useTP: true, tp: 40, useTrail: false });
        S.tkx = normTkx({ be: true, beAt: 10, beOff: 10 }); out.eq = tkBlocks(tkCalc()).map(b => b.btn);
        S.tkx = normTkx({ be: true, beAt: 10, beOff: 12 }); out.past = tkBlocks(tkCalc()).map(b => b.btn);
        S.tkx = normTkx({ be: true, beAt: 10, beOff: 2 }); out.fine = tkBlocks(tkCalc()).map(b => b.btn);
        S.tkx = normTkx(null);
        // a target smaller than the commission: gross profit, net loss
        const c0 = S.set.comm; S.set.comm = 7; S.tk.tp = .5;
        out.netW = tkWarnings(tkCalc()); out.netB = tkBlocks(tkCalc()).map(b => b.btn); S.set.comm = c0; S.tk.tp = 40;
        // inline TP on a losing position between the bid and the entry: accepted, with a warning
        const p = openPosition({ sym, side: 'buy', lots: 1, dupOk: true });
        T.move(sym, p.entry - 20 * pip); const lvl = +(p.entry - 10 * pip).toFixed(5);
        T.clearToasts(); W.edit(p.id, 'tp', String(lvl)); out.tp = { tp: p.tp, lvl, toast: W.last() };
        return out;
      });
      t.ok(r.eq.some(x => /offset must be below the trigger/.test(x)), 'offset = trigger blocked: ' + r.eq);
      t.ok(r.past.some(x => /offset must be below the trigger/.test(x)), 'offset > trigger blocked');
      t.ok(!r.fine.some(x => /offset/.test(x)), 'offset below trigger fine');
      t.ok(r.netW.some(x => /net loss/.test(x)), 'TP below the commission warns: ' + r.netW.join(' | '));
      t.ok(!r.netB.some(x => /net loss/.test(x)), 'only a warning, not a block');
      t.near(r.tp.tp, r.tp.lvl, 'loss-side TP accepted', 0, 1e-9);
      t.eq(r.tp.toast.title, 'Take profit below entry', 'loss-side TP warned');
      t.ok(/loss/.test(r.tp.toast.body), 'says it books a loss: ' + r.tp.toast.body);
      t.noErrors(page);
    }
  },
  {
    name: 'W0A6 sanitizeState validates dispo, tiltSt, bhScoreHist, pmSkip, pm.conf/mood, news; absurd values are rejected with a reason',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(setup);
      const r = await page.evaluate(() => {
        const q = Engine.quote('EURUSD'), out = {};
        const h = { id: 5, sym: 'EURUSD', side: 'buy', lots: 1, entry: q.bid, exit: q.bid, open: 1, close: 2, pnl: 10, note: 'n'.repeat(5000), reason: 'r'.repeat(500),
          news: ['USD CPI', 7, 'x'.repeat(500)], pm: { flags: [], conf: 95, mood: 'evil' } };
        const h2 = { ...h, id: 6, pm: { flags: [], conf: 60, mood: 'calm' }, news: [] };
        const raw = { balance: 100000, positions: [], history: [h, h2], dispo: { rg: 1, rl: 'x', pg: 2, pl: -1, ev: 5 }, pmSkip: [{ sym: 'FOO' }, { type: 'trade', t: 1, sym: 'EURUSD', side: 'buy', lots: 1, entry: q.mid, sl: q.mid - .002, tp: null, risk: 200, reward: null, flags: ['x'] }],
          tiltSt: { until: 'soon', trips: 2.5, overrides: 1, lastTrip: { a: 1 } }, bhScoreHist: [{ h: 1, s: 50 }, { h: 'a', s: 1 }, { h: 2, s: 500 }] };
        const opts = {}, s = sanitizeState(raw, opts);
        out.s = { dispo: s.dispo, pmSkip: s.pmSkip.length, skipSym: s.pmSkip[0]?.sym, tilt: s.tiltSt, bh: s.bhScoreHist,
          conf: s.history[0].pm.conf, mood: s.history[0].pm.mood, conf2: s.history[1].pm.conf, mood2: s.history[1].pm.mood,
          news: s.history[0].news, note: s.history[0].note.length, reason: s.history[0].reason.length, dropped: opts.dropped || [] };
        // absurd money and size: rejected, with the reason
        const o1 = {}; out.rich = sanitizeState({ balance: 5e12, positions: [] }, o1); out.richWhy = o1.reason || '';
        // EURUSD: the sheet allows 0.01–400 lots, so 5000 lots is refused (MAX_LOTS, 10,000, is only the largest sheet maximum)
        const o2 = {}, s2 = sanitizeState({ balance: 1e5, positions: [{ id: 1, sym: 'EURUSD', side: 'buy', lots: 5000, entry: q.mid }, { id: 2, sym: 'EURUSD', side: 'buy', lots: 1, entry: q.mid, swap: 1e15 }] }, o2);
        out.big = { n: s2.positions.length, dropped: o2.dropped || [] };
        // the imported state runs: a manual close goes through (dispoSale must not trip on a broken dispo)
        loadState({ balance: 100000, positions: [], dispo: { rg: 1, rl: 0, pg: 0, pl: 0, ev: 5 }, pmSkip: [{ sym: 'FOO' }] }); pmCfg().on = false; tiltCfg().on = false;
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); if (!p) return { why: lastReject, toasts: T.toasts() }; closePosition(p.id);
        out.closed = { open: S.positions.length, hist: S.history.length, ev: Array.isArray(S.dispo.ev) };
        return out;
      });
      if (r.why !== undefined) throw new Error('open refused: ' + JSON.stringify(r));
      t.deep(r.s.dispo, { rg: 1, rl: 0, pg: 2, pl: 0, ev: [] }, 'dispo repaired field by field');
      t.eq(r.s.pmSkip, 1, 'pmSkip keeps only valid records'); t.eq(r.s.skipSym, 'EURUSD', 'the valid one');
      t.deep(r.s.tilt, { until: 0, trips: 0, overrides: 1, lastTrip: null }, 'tiltSt repaired');
      t.deep(r.s.bh, [{ h: 1, s: 50 }], 'bhScoreHist keeps valid points');
      t.eq(r.s.conf, null, 'conf 95 out of 10..90'); t.eq(r.s.mood, null, 'unknown mood dropped');
      t.eq(r.s.conf2, 60, 'valid conf kept'); t.eq(r.s.mood2, 'calm', 'valid mood kept');
      t.deep(r.s.news, ['USD CPI'], 'news: short strings only');
      t.eq(r.s.note, 2000, 'note capped at 2000'); t.eq(r.s.reason, 120, 'reason capped at 120');
      t.ok(r.s.dropped.some(x => /dispo/.test(x)) && r.s.dropped.some(x => /pmSkip/.test(x)), 'repairs reported: ' + r.s.dropped.join(' | '));
      t.eq(r.rich, null, 'balance above 1e12 rejected'); t.ok(/balance/i.test(r.richWhy), 'with a reason: ' + r.richWhy);
      t.eq(r.big.n, 0, 'positions with absurd size or swap dropped');
      t.ok(r.big.dropped.some(x => /lots/.test(x)) && r.big.dropped.some(x => /swap/.test(x)), 'with reasons: ' + r.big.dropped.join(' | '));
      t.deep(r.closed, { open: 0, hist: 1, ev: true }, 'manual close works after the import');
      t.noErrors(page);
    }
  }
];
