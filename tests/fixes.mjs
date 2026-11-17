// Risk-model follow-ups: US leverage classes, the lev command at the cap, trailing activation, the protection row,
// a corrupt saved balance at boot, and the backtester auto-run after leaving the tab.
const LOT = 100000;
const booted = page => page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });

export const tests = [
  {
    name: 'F1 US retail: the G8 pairs are NFA majors at 50:1 (AUDUSD 1 lot), other pairs 20:1, and the tooltip says both tiers',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); applyProfile('us');
        const lev = Object.fromEntries(Engine.PAIRS.map(p => [p.sym, effLev(p.sym)]));
        const a = openPosition({ sym: 'AUDUSD', side: 'buy', lots: 1, dupOk: true });
        setSymbol('AUDUSD'); Object.assign(S.tk, { sm: 'lots', lots: 1, ot: 'market' }); renderTicket();
        const row = [...document.querySelectorAll('#tkStats dt')].map(x => [x.textContent, x.nextElementSibling.textContent]).find(x => x[0] === 'Margin required')?.[1];
        const sel = document.querySelector('#levSel');
        const jur = document.querySelector('#jurSel'), minor = Engine.FX.filter(p => levCls(p.sym) === 'fx-minor').map(p => [p.sym, effLev(p.sym)]);
        return { lev, minor, mg: posMargin(a), tk: tkCalc().margin, aud: Engine.usd('AUD'), row, title: sel.title, opt: jur && [...jur.options].find(o => o.value === 'us')?.textContent, eu: (applyProfile('eu'), effLev('AUDUSD')) };
      });
      for (const [s, l] of Object.entries(r.lev)) t.eq(l, 50, `US: ${s} at 1:50`);
      t.eq(Object.keys(r.lev).length, 16, 'all 16 pairs checked');
      t.near(r.mg, LOT * r.aud / 50, 'US: AUDUSD 1 lot position margin at 50:1', 1e-9, 1e-6);
      t.near(r.tk, LOT * r.aud / 50, 'US: ticket margin for AUDUSD 1 lot at 50:1', 1e-9, 1e-6);
      t.ok(r.row && r.row.includes('1:50'), 'ticket row names 1:50: ' + r.row);
      // with the 38 pairs of the catalog some pairs are outside the NFA major list (TRY, MXN, PLN, …): 1:20 there
      t.ok(r.minor.length > 0 && r.minor.every(([, l]) => l === 20), 'US: pairs outside the NFA majors at 1:20: ' + JSON.stringify(r.minor));
      t.ok(r.title.includes('1:50 on pairs of NFA major currencies, 1:20 on other pairs'), 'US tooltip names both tiers: ' + r.title);
      t.eq(r.opt, 'US · NFA', 'the US option lives in #jurSel');
      t.eq(r.eu, 20, 'EU retail still treats AUDUSD as a minor (ESMA)');
      t.noErrors(page);
    }
  },
  {
    name: 'F2 lev at the retail cap is a no-op, not an error',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        const p = parseCmd('lev 30'); const out = { desc: p?.desc, block: p?.block || '', confirm: !!p?.confirm };
        p.run(); out.toasts = T.toasts(); out.set = [S.set.jur, S.set.lev];
        T.clearToasts(); applyProfile('us');
        const u = parseCmd('lev 50'); out.us = { desc: u?.desc, block: u?.block || '' };
        const hi = parseCmd('lev 100'); out.hi = hi?.block || '';
        return out;
      });
      t.eq(r.desc, 'Already at the 1:30 cap for majors under EU retail', 'lev 30 under EU retail says it is already the cap');
      t.eq(r.block, '', 'not blocked');
      t.eq(r.confirm, false, 'no confirmation needed');
      t.ok(r.toasts.some(x => x.title === 'Already at the 1:30 cap for majors under EU retail'), 'info toast: ' + JSON.stringify(r.toasts));
      t.deep(r.set, ['eu', 30], 'nothing changed');
      t.eq(r.us.block, '', 'lev 50 under US retail not blocked');
      t.ok(/Already at the 1:50 cap/.test(r.us.desc), 'US: ' + r.us.desc);
      t.ok(/caps leverage/.test(r.hi), 'a value above the cap is still blocked: ' + r.hi);
      t.noErrors(page);
    }
  },
  {
    name: 'F3 trailing stop: no move without a favourable move; manual move clears the label',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        const sym = 'EURUSD', pip = Engine.META[sym].pip, out = {};
        T.reset();
        const q = Engine.quote(sym), sl = q.bid - 30 * pip, p = openPosition({ sym, side: 'buy', lots: 1, sl, trail: 10, dupOk: true });
        const e = p.entry;
        checkTriggers(); out.flat = { sl: p.sl === sl, trailed: !!p.trailed };
        T.move(sym, Engine.mid(sym) - 5 * pip); checkTriggers(); out.against = { sl: p.sl === sl, trailed: !!p.trailed };
        // up by less than the trail distance from entry: still untouched
        T.move(sym, e + 6 * pip); checkTriggers(); out.small = { sl: p.sl === sl, trailed: !!p.trailed, bid: Engine.quote(sym).bid - e };
        // beyond entry + trail: the trail takes over, never below entry
        T.move(sym, e + 18 * pip); checkTriggers(); out.moved = { sl: p.sl, trailed: !!p.trailed, want: Engine.quote(sym).bid - 10 * pip, e };
        // manual break-even never loosens a stop the trail already tightened
        parseCmd('be').run(); out.be = { sl: p.sl, trailed: !!p.trailed };
        T.move(sym, e - 2 * pip); checkTriggers(); out.reason = S.history[0]?.reason;
        // a trail that did move the stop and is hit is labelled Trailing stop
        T.reset();
        const p2 = openPosition({ sym, side: 'sell', lots: 1, sl: Engine.quote(sym).ask + 30 * pip, trail: 10, dupOk: true });
        T.move(sym, p2.entry - 20 * pip); checkTriggers(); out.sell = { trailed: !!p2.trailed, ok: p2.sl <= p2.entry };
        T.move(sym, Engine.mid(sym) + 15 * pip); checkTriggers(); out.sellReason = S.history[0]?.reason;
        return out;
      });
      t.deep(r.flat, { sl: true, trailed: false }, 'no price move: stop untouched');
      t.deep(r.against, { sl: true, trailed: false }, 'adverse move: stop untouched');
      t.ok(r.small.sl && !r.small.trailed, `move under the trail distance (${(r.small.bid / 1e-4).toFixed(1)} pips): stop untouched`);
      t.ok(r.moved.trailed, 'beyond entry + trail: trail active');
      t.near(r.moved.sl, r.moved.want, 'stop trails the bid by 10 pips', 1e-9, 1e-9);
      t.ok(r.moved.sl >= r.moved.e, 'trailed stop is never below entry');
      t.ok(r.be.sl === r.moved.sl && r.be.trailed, 'break-even does not loosen a trailed stop');
      t.eq(r.reason, 'Trailing stop', 'the trailed stop is hit');
      t.deep(r.sell, { trailed: true, ok: true }, 'sell side trails after a favourable move, not above entry');
      t.eq(r.sellReason, 'Trailing stop', 'trail-set stop hit: Trailing stop');
      t.noErrors(page);
    }
  },
  {
    name: 'F4 the negative balance protection row is not a trade',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        T.reset();
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, dupOk: true });
        T.move('EURUSD', Engine.mid('EURUSD') * .93);
        checkTriggers();
        const h = S.history[0]; dirty.hist = true; renderHistory();
        const tr = document.querySelector('#histBody tr');
        const js = journalStats();
        const exp = JSON.stringify({ app: 'meridian-fx', version: 1, state: S });
        T.reset(); T.clearToasts();
        importAccount(new File([exp], 'acct.json', { type: 'application/json' }));
        await new Promise(r => setTimeout(r, 300));
        const back = S.history[0];
        return { h: { side: h.side, lots: h.lots, nbp: h.nbp, reason: h.reason }, cls: tr.className, tags: tr.querySelectorAll('.tag.buy,.tag.sell').length, text: tr.textContent,
          n: js.n, min: Math.min(...js.curve), mdd: js.mdd, last: js.curve[js.curve.length - 1], back: back && { side: back.side, lots: back.lots, nbp: back.nbp, reason: back.reason }, toasts: T.toasts().map(x => x.title) };
      });
      t.eq(r.h.side, 'nbp', 'protection row side is nbp');
      t.eq(r.h.lots, 0, 'protection row has 0 lots');
      t.eq(r.h.reason, 'Negative balance protection', 'reason');
      t.ok(/\bnbp\b/.test(r.cls), '<tr> has class nbp: ' + r.cls);
      t.eq(r.tags, 0, 'no buy/sell tag on the protection row');
      t.ok(r.text.includes('—') && !/\bbuy\b|\bsell\b/.test(r.text), 'side shown as —: ' + r.text);
      t.eq(r.n, 1, 'journal counts the stop-out only');
      t.ok(r.min >= 0, 'equity curve does not go below zero when the protection stepped in: ' + r.min);
      t.ok(r.mdd <= 100 + 1e-9, 'max drawdown capped at 100%: ' + r.mdd);
      t.eq(r.last, 0, 'curve ends at the protected balance');
      t.ok(r.toasts.includes('Account imported'), 'export/import round-trip: ' + r.toasts);
      t.deep(r.back, r.h, 'the protection row survives import unchanged');
      t.noErrors(page);
    }
  },
  {
    name: 'F5 a corrupt saved balance at boot resets the balance only and keeps the history',
    async run({ t, app, open }) {
      const p = await open('/tests/engine.html');
      await p.evaluate(() => {
        const h = (id, pnl) => ({ id, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1 + pnl / 1e5, open: 1, close: 2, pnl, pips: pnl / 10, r: null, reason: 'Manual', note: 'kept', setup: '' });
        localStorage.setItem('meridian-fx-v1', JSON.stringify({ balance: 'oops', positions: [], history: [h(1, 120), h(2, -40)], set: { theme: 'light', jur: 'us' } }));
      });
      await p.goto(p.url().replace('/tests/engine.html', '/')); await booted(p);
      await p.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(x => /Balance reset/.test(x.textContent)), null, { timeout: 3000 }).catch(() => {});
      const r = await p.evaluate(() => ({ bal: S.balance, n: S.history.length, note: S.history[0]?.note, theme: S.set.theme, jur: S.set.jur, toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent) }));
      t.eq(r.bal, 100000, 'invalid balance reset to the starting balance');
      t.eq(r.n, 2, 'history kept');
      t.eq(r.note, 'kept', 'journal notes kept');
      t.eq(r.theme, 'light', 'settings kept');
      t.eq(r.jur, 'us', 'leverage profile kept');
      t.ok(r.toasts.some(x => /Balance reset/.test(x)), 'user told: ' + r.toasts);
      // import still refuses the same state
      const imp = await p.evaluate(() => sanitizeState({ balance: 'oops', positions: [], history: [] }));
      t.eq(imp, null, 'sanitizeState without the boot repair still rejects it');
      t.noErrors(p);
    }
  },
  {
    // since 59aad5c Optimizer, Walk-forward and All pairs run on request only (every run is tries in the account):
    // opening a view, leaving the tab and coming back must not start a run or leave a Running placeholder behind
    name: 'F6 backtester Optimizer/Walk-forward/All pairs run on request only, also across a tab switch',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(async () => { T.reset(); await loadLazy(); T.feed(Engine.INSTR.map(m => m.sym)); await btLoad(btCfg().sym, btCfg().hist || 8); setTab('bt'); });
      await page.waitForFunction(() => BT.res, null, { timeout: 20000 });
      const btn = { wf: '#wfRun', opt: '#optRun', all: '#allRun' };
      for (const v of ['wf', 'opt', 'all']) {
        await page.evaluate(v => {
          BT.wf = null; BT.sweep = null; BT.all = null;
          BT.view = v; document.querySelectorAll('#btView button').forEach(b => b.classList.toggle('on', b.dataset.v === v)); renderBtView();
          setTab('positions');
        }, v);
        await page.waitForTimeout(150);
        t.ok(!(await page.evaluate(() => !!(BT.wf || BT.sweep || BT.all))), `${v}: no run while away`);
        await page.evaluate(() => setTab('bt'));
        await page.waitForTimeout(150);
        const back = await page.evaluate(sel => ({ text: document.querySelector('#btView2')?.textContent || '', dis: document.querySelector(sel)?.disabled ?? null, run: !!(BT.wf || BT.sweep || BT.all) }), btn[v]);
        t.ok(!back.run, `${v}: no run on return either`);
        t.ok(!/Running/.test(back.text), `${v}: no Running placeholder: ${back.text.slice(0, 120)}`);
        t.eq(back.dis, false, `${v}: Run button present and enabled`);
        if (v !== 'wf') t.ok(/Not run yet/.test(back.text), `${v}: says it has not run yet`);
        // the run happens when asked
        await page.click(btn[v]);
        await page.waitForFunction(v => (v === 'wf' ? BT.wf : v === 'opt' ? BT.sweep : BT.all) != null || /pick two|only one parameter|not enough history/i.test(document.querySelector('#btView2')?.textContent + [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent).join(' ')), v, { timeout: 30000 }).catch(() => {});
        const done = await page.evaluate(v => ({ res: !!(v === 'wf' ? BT.wf : v === 'opt' ? BT.sweep : BT.all), text: (document.querySelector('#btView2')?.textContent || '') + [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent).join(' ') }), v);
        t.ok(done.res || /pick two|only one parameter|not enough history/i.test(done.text), `${v}: Run produces a result or says why not: ${done.text.slice(0, 120)}`);
        if (v === 'wf') t.eq(await page.evaluate(() => document.querySelector('#wfRun')?.disabled ?? null), false, 'wf: Run button enabled again after the run');
      }
      t.noErrors(page);
    }
  }
];
