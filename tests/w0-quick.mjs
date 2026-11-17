// Wave 0 · quick fixes: Observatory Constellation with CFDs, margin and position-size calculators on the profile,
// Journal on the one-trade model, Challenge (read-only guard, breach log, daily meter class, cumulative risk at the
// stop, phase 2 from the initial capital, chSample at net, import bounds) and the multi-chart pane selector.
// Frozen market (speed 0: fills at the quote, no slippage).

// move EURUSD so a buy's bid sits at entry + usd / (lots × 100,000)
const MOVE = () => {
  window.QK = {
    bidTo(p, usd) { const want = p.entry + usd / (p.lots * 1e5); T.move('EURUSD', Engine.mid('EURUSD') + (want - Engine.quote('EURUSD').bid)); },
    // a select gets the option when the list in use does not carry it yet (the watchlist groups are another task's)
    calc(id, v) { const el = document.getElementById(id); if (el.tagName === 'SELECT' && ![...el.options].some(o => o.value === v)) el.add(new Option(v, v)); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); },
    out: id => [...document.querySelectorAll(`#${id} > div`)].map(d => [d.querySelector('span')?.textContent || '', d.querySelector('b')?.textContent || d.textContent])
  };
};
// clock: a Date pins Date.now (sessions: GOLD and the indices trade 01:05–23:55 server time, US stocks 13:35–19:55 UTC)
async function qApp(app, clock = FRI_1030) { const page = await app('', { clock }); await page.evaluate(MOVE); return page; }
const FRI_1030 = new Date('2026-10-16T10:30:00Z'), FRI_1500 = new Date('2026-10-16T15:00:00Z');
// a second page in the same context (shared storage): read-only while the first one holds the writer lock
async function second(a) {
  const b = await a.context().newPage();
  b.errors = []; b.on('pageerror', e => b.errors.push(String(e)));
  b.on('dialog', d => { b.errors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  await b.goto(a.url());
  await b.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
  return b;
}

export const tests = [
  {
    name: 'W0Q1 Constellation with GOLD held: the tree draws and "Your positions" names what is left out (G8 currencies only)',
    async run({ t, app }) {
      const page = await qApp(app, FRI_1030);
      const r = await page.evaluate(async () => {
        T.reset(); await loadLazy();
        for (const sym of ['EURUSD', 'GBPUSD', 'GOLD']) openPosition({ sym, side: 'buy', lots: sym === 'GOLD' ? .01 : .1, dupOk: true });
        obsCfg().view = 'const'; setTab('obs'); renderObs();
        const body = document.getElementById('obsBody'), side = document.getElementById('constSide');
        return { n: S.positions.length, err: /Could not compute/.test(body.textContent), svg: !!body.querySelector('svg'), side: side ? side.textContent : '', gold: pretty('GOLD') };
      });
      t.eq(r.n, 3, 'three positions open');
      t.ok(!r.err && r.svg, 'the tree is drawn');
      t.ok(r.side.includes(r.gold) && /not (part of|included in) (the|this) tree/i.test(r.side), 'the side panel says GOLD is not in the tree: ' + r.side);
      t.ok(/G8 currencies/.test(r.side), 'the tree is named as the G8 currencies: ' + r.side);
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q2 margin calculator: effective leverage (sheet, jurisdiction cap), read-only under a cap, editable to the sheet maximum without one, 0 is refused',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); S.set.lev = null; S.set.jur = 'eu'; setTab('calc'); renderCalcs();
        const lev = document.getElementById('pvLev'), tag = () => document.getElementById('pvLevTag')?.textContent || '';
        QK.calc('pvSym', 'EURUSD');
        const eu = { v: lev.value, ro: lev.readOnly, tag: tag(), out: QK.out('pvOut'), n: notionalUsd('EURUSD', 1) };
        QK.calc('pvSym', 'GOLD');
        const gold = { v: lev.value, tag: tag(), out: QK.out('pvOut'), n: notionalUsd('GOLD', 1), units: (QK.out('pvOut').find(x => x[0] === 'Units') || [])[1] };
        QK.calc('pvLev', '500'); const goldTyped = { v: lev.value };
        S.set.jur = 'none'; S.set.lev = null; QK.calc('pvSym', 'EURUSD');
        const none = { v: lev.value, ro: lev.readOnly, tag: tag() };
        QK.calc('pvLev', '400'); const n400 = { out: QK.out('pvOut'), txt: document.getElementById('pvOut').textContent, n: notionalUsd('EURUSD', 1) };
        QK.calc('pvLev', '0'); const zero = { txt: document.getElementById('pvOut').textContent, out: QK.out('pvOut') };
        QK.calc('pvLev', '900'); const high = { txt: document.getElementById('pvOut').textContent };
        S.set.lev = 200; QK.calc('pvSym', 'GOLD'); const choice = { v: lev.value, tag: tag() };
        return { eu, gold, goldTyped, none, n400, zero, high, choice };
      });
      const margin = out => (out.find(x => x[0] === 'Margin') || [])[1];
      const usd = v => '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      t.eq(r.eu.v, '30', 'EU retail EUR/USD: 1:30 (sheet 1:500, capped)'); t.eq(r.eu.ro, true, 'read-only under a jurisdiction cap');
      t.ok(/EU retail 1:30/.test(r.eu.tag), 'label names the cap: ' + r.eu.tag);
      t.eq(margin(r.eu.out), usd(r.eu.n / 30), 'margin = notional / 30');
      t.eq(r.gold.v, '20', 'EU retail GOLD: 1:20 (sheet 1:50)'); t.ok(/EU retail 1:20/.test(r.gold.tag), 'gold label: ' + r.gold.tag);
      t.eq(margin(r.gold.out), usd(r.gold.n / 20), 'gold margin = notional / 20');
      t.ok(/Ounces/.test(r.gold.units || ''), 'GOLD units from the sheet: ' + r.gold.units);
      t.eq(r.goldTyped.v, '20', 'a capped leverage cannot be typed over');
      t.eq(r.none.v, '500', 'no cap: the sheet default'); t.eq(r.none.ro, false, 'editable without a cap'); t.ok(/sheet/i.test(r.none.tag) && /1:500/.test(r.none.tag), 'label: ' + r.none.tag);
      t.eq(margin(r.n400.out), usd(r.n400.n / 400), '1:400 what-if margin');
      t.ok(/what-if/.test(r.n400.txt) && /1:500/.test(r.n400.txt), 'the account leverage is named next to a what-if: ' + r.n400.txt);
      t.ok(/at least 1:1/i.test(r.zero.txt) && !margin(r.zero.out), 'leverage 0 is refused, no margin shown: ' + r.zero.txt);
      t.ok(/1:500/.test(r.high.txt) && /maximum/i.test(r.high.txt), 'above the sheet maximum is refused: ' + r.high.txt);
      t.eq(r.choice.v, '50', 'a 1:200 choice is held to the GOLD sheet maximum 1:50');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q3 position size: floored to the sheet step, figures from the shown size, inline validation, margin at profile, sheet min/max and caps',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); setTab('calc'); renderCalcs();
        QK.calc('cpSym', 'EURUSD'); QK.calc('cpAcc', '100000'); QK.calc('cpRisk', '1'); QK.calc('cpSL', '7');
        const a = { out: QK.out('cpOut'), n: notionalUsd('EURUSD', 14.28) };
        QK.calc('cpRisk', '0'); const noRisk = document.getElementById('cpOut').textContent;
        QK.calc('cpRisk', '1'); QK.calc('cpSL', '0'); const noSl = document.getElementById('cpOut').textContent;
        QK.calc('cpSL', '0.2'); const big = document.getElementById('cpOut').textContent;
        QK.calc('cpRisk', '0.001'); QK.calc('cpSL', '25'); const tiny = document.getElementById('cpOut').textContent;
        // a stock: whole shares, a stop in points ($0.01 each per share)
        QK.calc('cpSym', 'AAPL.US'); QK.calc('cpRisk', '1'); QK.calc('cpSL', '70');
        const sh = { out: QK.out('cpOut'), unit: document.getElementById('cpUnit').textContent };
        return { a, noRisk, noSl, big, tiny, sh };
      });
      const v = (out, name) => (out.find(x => x[0].startsWith(name)) || [])[1];
      t.eq(v(r.a.out, 'Position size'), '14.28 lots', '1000 / 70 = 14.2857 is floored to the 0.01 step, not rounded up');
      t.eq(v(r.a.out, 'Amount at risk'), '$999.60', 'risk from the shown size: 14.28 × 7 × $10');
      t.ok(/^\$/.test(v(r.a.out, 'Margin at profile') || ''), 'margin at profile row: ' + JSON.stringify(r.a.out));
      t.ok((v(r.a.out, 'Margin at profile') || '').startsWith('$' + (r.a.n / 30).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })), 'margin = notional / 30 (EU retail)');
      t.ok(/risk.*above 0/i.test(r.noRisk) && !/lots/.test(r.noRisk), 'risk 0: inline message, no size: ' + r.noRisk);
      t.ok(/stop.*above 0/i.test(r.noSl) && !/lots/.test(r.noSl), 'stop 0: inline message, no size: ' + r.noSl);
      t.ok(/Maximum size is 400 lots/.test(r.big), 'above the sheet maximum: warned: ' + r.big);
      t.ok(/25× equity/.test(r.big), 'above 25× equity notional: warned: ' + r.big);
      t.ok(/Minimum size is 0\.01 lots/.test(r.tiny) && /below/i.test(r.tiny), 'below the sheet minimum: warned: ' + r.tiny);
      t.eq(r.sh.unit, 'pt', 'stock stop in points');
      t.eq(v(r.sh.out, 'Position size'), '1,428 shares', '1000 / 0.70 = 1428.6 floored to whole shares');
      t.eq(v(r.sh.out, 'Amount at risk'), '$999.60', '1428 × $0.70');
      t.ok(!/NaN|undefined/.test(JSON.stringify(r.sh.out)), 'no NaN on a stock: ' + JSON.stringify(r.sh.out));
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q4 Journal: one position closed in 2 parts with commission is 1 losing trade at net; empty state shows —; free text escaped',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); setTab('journal'); renderJournal();
        const kp = () => Object.fromEntries([...document.querySelectorAll('#kpis .kpi')].map(k => [k.querySelector('label').textContent, k.querySelector('b').textContent]));
        const empty = kp();
        S.set.comm = 20;
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 2, dupOk: true });
        QK.bidTo(p, 16);
        closePosition(p.id, 'Manual', .5); closePosition(p.id, 'Manual');
        S.history[S.history.length - 1].note = '"><i id="pwnNote">x</i>';
        S.history[0].reason = '<i id="pwnReason">x</i>';
        dirty.hist = true; renderHistory(); renderJournal();
        const s = journalStats(), items = [...document.querySelectorAll('#jList .jitem')];
        return { empty, k: kp(), n: s.n, net: s.net, curve: s.curve[s.curve.length - 1] - s.curve[0], items: items.length, itemPnl: items[0]?.querySelector('.top > span:last-child')?.textContent,
          note: items[0]?.querySelector('[data-j=note]')?.value, pwn: !!document.getElementById('pwnNote') || !!document.getElementById('pwnReason'), bal: S.balance - 100000 };
      });
      for (const k of ['Net P&L', 'Win rate', 'Profit factor', 'Avg win', 'Avg loss', 'Expectancy', 'Avg R', 'Max drawdown', 'Best / worst']) t.eq(r.empty[k], '—', `empty ${k}`);
      t.eq(r.empty.Trades, '0', 'empty: 0 trades');
      t.eq(r.n, 1, 'two partial closes = one trade');
      t.near(r.net, -24, 'net −24', 1e-6, 1e-4); t.near(r.bal, -24, 'the account lost 24', 1e-6, 1e-4);
      t.near(r.curve, -24, 'the curve moves by the net', 1e-6, 1e-4);
      t.eq(r.k['Net P&L'], '−$24.00', 'Net P&L KPI'); t.eq(r.k.Trades, '1', 'Trades KPI'); t.eq(r.k['Win rate'], '0% (0–79%) · n=1', 'a losing trade, with its Wilson interval');
      t.eq(r.items, 1, 'one journal item'); t.eq(r.itemPnl, '−$24.00', 'item at net');
      t.eq(r.note, '"><i id="pwnNote">x</i>', 'note shown as typed');
      t.ok(!r.pwn, 'no markup injected from note or reason');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q5 Challenge read-only tab: start, stop, new, preset and custom save refused with no state change; controls disabled',
    async run({ t, app }) {
      const a = await qApp(app);
      await a.evaluate(async () => { T.reset(); S.chal = null; chCfg(); persistNow(); await store.flush(); });
      const b = await second(a);
      await b.waitForFunction(() => store.readOnly(), null, { timeout: 8000 });
      const r = await b.evaluate(async () => {
        document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
        setTab('chal'); renderChal();
        const before = JSON.stringify(S.chal), dis = {};
        // persist.js disables the listed controls on its next ui pass; the challenge panel renders them disabled too
        for (const id of ['chStartB', 'chPreset']) { const el = document.getElementById(id); dis[id] = el ? el.disabled : 'missing'; }
        const st = chStart('2s-static'), stop = chStop();
        const btn = document.getElementById('chStartB'); if (btn) { btn.disabled = false; btn.click(); }
        const pre = document.getElementById('chPreset'); if (pre) { pre.disabled = false; pre.value = '1s-eod'; pre.dispatchEvent(new Event('change', { bubbles: true })); }
        CH.edit = true; renderChal(); const form = document.getElementById('chEdit');
        if (form) { document.getElementById('ceSave').disabled = false; form.requestSubmit(); }
        const toasts = [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent);
        return { st, stop, same: JSON.stringify(S.chal) === before, att: S.chal.att, sel: S.chal.sel, custom: S.chal.custom, dis, toasts };
      });
      t.eq(r.st.ok, false, 'chStart refused'); t.ok(/read-only/i.test(r.st.why), 'with the reason: ' + r.st.why);
      t.eq(r.stop, false, 'chStop refused');
      t.ok(r.same && r.att === null && r.sel === '2s-static' && r.custom === null, 'no state change: ' + JSON.stringify({ sel: r.sel, att: r.att }));
      t.deep(r.dis, { chStartB: true, chPreset: true }, 'start and preset disabled in the read-only tab');
      t.ok(r.toasts.some(x => /read-only tab/i.test(x)), 'a toast says read-only tab: ' + r.toasts.join(' | '));
      t.noErrors(b);
    }
  },
  {
    name: 'W0Q6 Challenge breach: the log shows the return after the stop-out; the daily meter keeps its bar (ch-mwarn)',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); S.chal = null; S.demo = null; S.set.comm = 0; chStart('2s-static');
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, dupOk: true, pmDone: true });
        QK.bidTo(p, -3000); chTick();
        setTab('chal'); renderChal();
        const m = [...document.querySelectorAll('.ch-meter')].find(x => /Daily loss/.test(x.textContent));
        const meter = { cls: m.className, bar: m.querySelector('.ch-bar') ? getComputedStyle(m.querySelector('.ch-bar')).display : 'none', margin: getComputedStyle(m).marginLeft };
        QK.bidTo(p, -5200); chTick();
        const log = S.chal.log[0];
        renderChal(); const row = document.querySelector('.ch-logt tbody tr')?.textContent || '';
        return { meter, status: S.chal.att.status, ret: log.ret, real: (S.balance / 100000 - 1) * 100, open: S.positions.length, row };
      });
      t.ok(/\bch-mwarn\b/.test(r.meter.cls) && !/(^|\s)warn(\s|$)/.test(r.meter.cls), 'daily meter class at ≥50%: ' + r.meter.cls);
      t.eq(r.meter.bar, 'block', 'the bar stays visible'); t.eq(r.meter.margin, '0px', 'no .warn margin inherited');
      t.eq(r.status, 'breached', 'breached'); t.eq(r.open, 0, 'positions closed');
      t.ok(r.real < -5, 'the account lost more than 5%');
      t.near(r.ret, r.real, 'log return = balance after the stop-out', 1e-9, 1e-9);
      t.ok(r.row.includes('−' + Math.abs(r.real).toFixed(2) + '%'), 'log row shows it: ' + r.row);
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q7 Challenge order block counts the risk at the stop of open positions and pending orders',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); S.chal = null; S.demo = null; S.set.comm = 0; chStart('2s-static');
        const q = Engine.quote('EURUSD'), pip = Engine.META.EURUSD.pip;
        // room $5,000; an open buy of 5 lots with a 40-pip stop risks about $2,000 from here
        const p1 = openPosition({ sym: 'EURUSD', side: 'buy', lots: 5, sl: q.bid - 40 * pip, pmDone: true, dupOk: true });
        // a pending buy limit of 5 lots with a 40-pip stop: $2,000 more
        const o1 = placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.bid - 20 * pip).toFixed(5), lots: 5, slPips: 40, tpPips: 0, trail: 0, pmDone: true, dupOk: true });
        // a third order risking $1,500 on its own fits the room alone but not with the other two
        const pv = pipValue('GBPUSD', 1), lots = 3, slp = 1500 / (pv * lots);
        const third = { sym: 'GBPUSD', side: 'buy', lots, slPips: slp };
        const why = chOrderBlock(third), alone = (() => { const keep = [S.positions, S.orders]; S.positions = []; S.orders = []; const w = chOrderBlock(third); [S.positions, S.orders] = keep; return w; })();
        const p3 = openPosition({ ...third, pmDone: true, dupOk: true });
        return { p1: !!p1, o1: !!o1, why, alone, p3: !!p3, n: S.positions.length };
      });
      t.ok(r.p1 && r.o1, 'first position and order accepted');
      t.eq(r.alone, null, 'alone, $1,500 fits the $5,000 room');
      t.ok(r.why && /breach the daily limit/.test(r.why) && /open positions and pending orders/.test(r.why), 'with $4,000 already at risk it is blocked: ' + r.why);
      t.eq(r.p3, false, 'openPosition refuses it'); t.eq(r.n, 1, 'still one position');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q8 Challenge phase 2 starts from the initial capital: phase 1 profit does not count toward it',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); S.chal = null; S.demo = null; chStart('2s-static'); const c = S.chal.att;
        S.balance = 111000; c.days = [1, 2, 3].map(i => ({ k: '2026-10-0' + i, pnl: 3000, n: 1 })); c.day.n = 1; c.day.bal0 = 109000; chTick();
        const ph = { phase: c.phase, ret: c.phases[0] && c.phases[0].ret, toast: T.toasts().find(x => /^Phase 1 passed/.test(x.title)) };
        const L = chLive();
        const live = { target: L.target, maxFloor: L.maxFloor, dailyFloor: L.dailyFloor, toTarget: L.toTarget };
        // +5% of the initial capital ($5,000) passes phase 2; +4% does not
        S.balance = 115000; c.day.n = 1; c.days = [1, 2, 3].map(i => ({ k: '2026-10-1' + i, pnl: 1000, n: 1 })); chTick(); const at4 = c.status;
        S.balance = 116000; chTick();
        setTab('chal'); renderChal();
        const about = [...document.querySelectorAll('.ch-about li')].map(x => x.textContent).join(' ');
        return { ph, live, at4, status: c.status, about, p2ret: c.phases[1] && c.phases[1].ret };
      });
      t.eq(r.ph.phase, 1, 'phase 2 started'); t.near(r.ph.ret, 11, 'phase 1 return on the initial capital', 1e-9, 1e-9);
      t.ok(r.ph.toast && /initial capital/i.test(r.ph.toast.body) && /\$100,000/.test(r.ph.toast.body), 'toast says phase 2 is measured on the initial capital: ' + JSON.stringify(r.ph.toast));
      t.near(r.live.target, 5000, 'target = 5% of $100,000');
      t.near(r.live.maxFloor, 111000 - 10000, 'max floor: phase start − 10% of the initial capital');
      t.near(r.live.dailyFloor, 111000 - 5000, 'daily floor: day start − 5% of the initial capital');
      t.near(r.live.toTarget, 5000, 'phase 1 profit does not count');
      t.eq(r.at4, 'active', '+$4,000 in phase 2 is not enough');
      t.eq(r.status, 'passed', '+$5,000 in phase 2 passes'); t.near(r.p2ret, 5, 'phase 2 return 5% of the initial capital', 1e-9, 1e-9);
      t.ok(/initial capital/i.test(r.about), 'rules text describes it: ' + r.about.slice(0, 200));
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q9 Challenge Monte Carlo sample uses net P&L (commission included)',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        // a +$16 gross trade with $40 commission enters the sample as a loss
        T.reset(); S.chal = null; S.demo = null; S.set.comm = 20;
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 2, dupOk: true });
        QK.bidTo(p, 16); closePosition(p.id, 'Manual');
        const smp = chSample(chRules('2s-static'), { risk: 'asis', horizon: 60 });
        return { n: smp.n, ret: smp.trades[0] && smp.trades[0].ret, bal: S.balance, pnl: S.history[0].pnl };
      });
      t.near(r.pnl, 16, 'gross +16', 1e-6, 1e-4);
      t.eq(r.n, 1, 'one trade in the sample');
      t.ok(r.ret < 0, 'the trade is a loss at net: ' + r.ret);
      t.near(r.ret, -24 / (r.bal + 24), 'return = net / balance before', 1e-6, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q10 sanitizeChal rejects implausible capital and returns from an import',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); S.chal = null; S.demo = null; chStart('2s-static');
        const good = JSON.parse(JSON.stringify(S.chal)); good.log = [{ id: 'A1', pid: '2s-static', pv: 1, label: 'x', start: 1, end: 2, status: 'stopped', phase: 0, why: 'user', days: 1, ret: 2.5 }];
        const v = x => sanitizeChal(x);
        const g = v(good);
        const bigRet = JSON.parse(JSON.stringify(good)); bigRet.log[0].ret = 1e5;
        const bigCap = JSON.parse(JSON.stringify(good)); bigCap.att.e0 = bigCap.att.b0 = bigCap.att.hw = 1e11;
        const hw = JSON.parse(JSON.stringify(good)); hw.att.hw = good.att.e0 * 50;
        const ph = JSON.parse(JSON.stringify(good)); ph.att.phases = [{ e0: good.att.e0, start: 1, end: 2, days: 1, ret: 5e4 }];
        const tiny = JSON.parse(JSON.stringify(good)); tiny.att.e0 = tiny.att.b0 = tiny.att.hw = 1e-6;
        return { g: !!(g && g.att && g.log.length === 1), bigRet: v(bigRet).log.length, bigCap: v(bigCap).att, hw: v(hw).att, ph: v(ph).att, tiny: v(tiny).att };
      });
      t.ok(r.g, 'a valid copy passes');
      t.eq(r.bigRet, 0, 'a +100,000% log return is dropped');
      t.eq(r.bigCap, null, 'a $100 billion attempt is dropped');
      t.eq(r.hw, null, 'a high-water 50× the start is dropped');
      t.eq(r.ph, null, 'a +50,000% phase is dropped');
      t.eq(r.tiny, null, 'a $0.000001 attempt is dropped');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q11 multi-chart pane selector lists the catalog (a GOLD pane shows GOLD); empty panes fill from favourites, then FX',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.reset(); const c = mcCfg(); c.panes[2] = { sym: 'GOLD', tf: 15 }; setLayout('4');
        const sels = [...document.querySelectorAll('.mc-pane .mc-sym')];
        const out = { vals: sels.map(s => s.value), opts: sels[0] ? [...sels[0].options].map(o => o.value) : [], label: sels[0]?.getAttribute('aria-label') };
        const main = S.set.sym;
        delete S.set.mc; S.set.fav = ['US.500', main, 'GOLD']; out.fav = mcCfg().panes.map(p => p.sym);
        delete S.set.mc; S.set.fav = []; out.fx = mcCfg().panes.map(p => p.sym);
        out.main = main; out.fxList = Engine.FX.map(m => m.sym).filter(s => s !== main).slice(0, 3);
        setLayout('1'); return out;
      });
      t.eq(r.vals[2], 'GOLD', 'the GOLD pane selector shows GOLD');
      t.ok(r.opts.includes('GOLD') && r.opts.includes('EURUSD') && r.opts.includes('US.500'), 'pairs and other instruments listed: ' + r.opts.length);
      t.eq(r.label, 'Instrument', 'labelled Instrument');
      t.deep(r.fav, ['US.500', 'GOLD', r.fxList[0]], 'favourites first (not the main chart), then FX');
      t.deep(r.fx, r.fxList, 'no favourites: the FX pairs in catalog order');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q12 correlation: FX = the 16 G8 pairs; All = favourites, held and visible instruments (at most 30), aligned on common minutes; volatility on G8 + yours',
    async run({ t, app }) {
      const page = await qApp(app, FRI_1500);
      const r = await page.evaluate(() => {
        T.reset(); S.set.fav = ['US.500', 'GOLD', 'AAPL.US'];
        openPosition({ sym: 'BTCUSD', side: 'buy', lots: .01, dupOk: true });
        setTab('corr'); CORR.set = 'fx'; renderCorr(); const fx = corrSyms();
        CORR.set = 'all'; renderCorr(); const all = corrSyms(), grid = document.getElementById('corr').textContent;
        const heads = [...document.querySelectorAll('#corr > .h')].length;
        const aa = corrPair('AAPL.US', 'US.500'), ii = corrPair('US.500', 'US.100'), ee = corrPair('EURUSD', 'EURUSD');
        // two sessions of unrelated minute returns, both series jumping 5% across a 17 h close: the gap is no return
        const mk = (f) => { const o = []; let a = 1, t = 0; for (let k = 0; k < 160; k++) { if (k === 80) { t += 1061 * 60; a *= 1.05; } else { t += 60; a *= 1 + .001 * f(k); } o.push({ time: t, close: a }); } return o; };
        const gap = corrAligned(mk(k => k % 2 ? 1 : -1), mk(k => k % 4 < 2 ? 1 : -1));
        setTab('vol'); renderVol(); const vol = [...document.querySelectorAll('#volBody .vcard')].map(e => e.dataset.sym), vtxt = document.getElementById('volBody').textContent;
        S.set.fav = Engine.INSTR.slice(16, 70).map(m => m.sym); const many = corrSyms();
        return { fx, all, grid, heads, aa, ii, ee, gap, many, vol, vtxt, pairs: Engine.PAIRS.map(p => p.sym), sym: S.set.sym };
      });
      t.deep(r.fx, r.pairs, 'FX: the 16 G8 pairs');
      for (const s of ['US.500', 'GOLD', 'AAPL.US', 'BTCUSD', r.sym]) t.ok(r.all.includes(s), `All includes ${s}: ${r.all.join(',')}`);
      t.ok(r.all.length <= 30, 'at most 30');
      t.eq(r.heads, 2 * r.all.length, 'one row and one column header per instrument');
      t.ok(!/NaN|undefined/.test(r.grid), 'no NaN in the matrix');
      t.ok(r.aa.n > 30 && r.aa.n < 1000 && Number.isFinite(r.aa.r), `AAPL.US vs US.500 on the minutes of the stock session only: ρ ${r.aa.r} over ${r.aa.n}`);
      t.ok(r.ii.r > .5, `US.500 vs US.100 move together on common minutes: ρ ${r.ii.r} over ${r.ii.n}`);
      t.ok(Math.abs(r.ee.r - 1) < 1e-9, 'an instrument with itself: 1');
      t.ok(Math.abs(r.gap.r) < .2 && r.gap.n === 158, `a session gap is not paired as one return: ρ ${r.gap.r} over ${r.gap.n}`);
      t.eq(r.many.length, 30, 'capped at 30 with many favourites');
      for (const s of [...r.pairs, 'US.500', 'GOLD', 'AAPL.US', 'BTCUSD']) t.ok(r.vol.includes(s), 'volatility lists ' + s);
      t.ok(r.vol.length <= 60, `volatility is not all 265 instruments: ${r.vol.length}`);
      t.ok(!/NaN|undefined|Infinity/.test(r.vtxt), 'no NaN in the volatility table');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q13 exposure by type and sector: stocks per sector, other classes per group, every currency (outside the G8 too) in the panel and the basket tool',
    async run({ t, app }) {
      const page = await qApp(app, FRI_1500);
      const r = await page.evaluate(async () => {
        T.reset(); await loadLazy();
        for (const [sym, side, lots] of [['EURUSD', 'buy', 1], ['USDMXN', 'buy', 1], ['AAPL.US', 'buy', 100], ['MSFT.US', 'buy', 50], ['JPM.US', 'sell', 40], ['GOLD', 'sell', 1], ['US.500', 'buy', 1], ['DE.30', 'buy', .2], ['BTCUSD', 'buy', .1]])
          if (!openPosition({ sym, side, lots, dupOk: true, pmDone: true })) return { fail: sym + ': ' + lastReject };
        renderExposure();
        const ex = exposureOf(), html = bkExpHtml(), panel = document.getElementById('exposure').textContent;
        const tech = notionalUsd('AAPL.US', 100) + notionalUsd('MSFT.US', 50), de = notionalUsd('DE.30', .2);
        return { ex, html, panel, tech, de, mxn: notionalUsd('USDMXN', 1), eur: notionalUsd('EURUSD', 1) };
      });
      t.ok(!r.fail, 'positions opened: ' + r.fail);
      t.near(r.ex.asset['stock:Technology'], r.tech, 'Technology = AAPL + MSFT', 1e-9, 1e-6);
      t.ok(r.ex.asset['stock:Financials'] < 0, 'Financials short (JPM)');
      t.ok(r.ex.asset.metal < 0 && r.ex.asset.index > 0 && r.ex.asset.crypto > 0, 'metal / index / crypto groups');
      for (const lab of ['Asset exposure', 'Stocks · Technology', 'Stocks · Financials', 'Metals', 'Indices', 'Crypto', 'MXN']) t.ok(r.panel.includes(lab), `Market panel lists ${lab}: ${r.panel.slice(0, 200)}`);
      t.near(r.ex.ccy.MXN, -r.mxn, 'long USD/MXN is short MXN', 1e-9, 1e-6);
      t.near(r.ex.ccy.EUR, r.eur + r.de, 'EUR from EUR/USD and DE.30 (quoted in EUR)', 1e-9, 1e-6);
      t.ok(/MXN/.test(r.html) && /outside the G8/i.test(r.html), 'basket tool shows MXN as a currency outside the G8: ' + r.html.replace(/<[^>]+>/g, ' ').slice(0, 300));
      t.ok(!/NaN|undefined/.test(r.panel + r.html), 'no NaN');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q14 Market Brief on the catalog: round numbers on the volatility (σ) of the instrument, G8 strength only for G8 pairs, no NaN on a stock, an index or an exotic',
    async run({ t, app }) {
      const page = await qApp(app, FRI_1500);
      const r = await page.evaluate(async () => {
        T.reset(); await loadLazy();
        const out = {};
        for (const sym of ['US.500', 'AAPL.US', 'USDMXN', 'BTCUSD', 'EURUSD']) {
          generateBrief(sym, false);
          out[sym] = { txt: document.getElementById('brMain').textContent, grid: briefGrid(sym), px: Engine.mid(sym), sig: M(sym).seed.sIn * Engine.mid(sym), plain: briefAsText() };
        }
        out.uni = Object.fromEntries(['GOLD', 'AAPL.US', 'USDMXN', 'US.500'].map(x => { const u = scanUniverse(x); return [x, { n: u.name, cats: [...new Set(u.syms.map(y => CAT_OF[M(y).group] + (M(y).group === 'stock' || CAT_OF[M(y).group] === 'fx' ? ':' + subOf(M(y)) : '')))], self: u.syms.includes(x) }]; }));
        out.scan = [...document.querySelectorAll('#brScan .scan-row')].map(b => b.dataset.sym);
        out.pairs = Engine.PAIRS.map(p => p.sym);
        return out;
      });
      const nice = g => { const e = 10 ** Math.floor(Math.log10(g) + 1e-9), f = +(g / e).toFixed(6); return [1, 2, 2.5, 5].includes(f); };
      for (const s of ['US.500', 'AAPL.US', 'BTCUSD']) {
        const x = r[s];
        t.ok(nice(x.grid), `${s}: the round-number grid is a 1-2-2.5-5 step: ${x.grid}`);
        t.ok(x.grid >= 2 * x.sig && x.grid <= 25 * x.sig, `${s}: grid ${x.grid} sized on the 1-hour σ ${x.sig.toFixed(4)}`);
      }
      t.near(r.EURUSD.grid, .005, 'EUR/USD keeps the 50-pip grid', 1e-12, 1e-12);
      t.ok(/G8 currencies/.test(r.USDMXN.txt) && !/MXN and USD are moving in step/.test(r.USDMXN.txt), 'an exotic pair says the strength view covers the G8 currencies');
      for (const s of ['US.500', 'AAPL.US', 'USDMXN', 'BTCUSD']) t.ok(!/\b(NaN|undefined|null|Infinity)\b/.test(r[s].txt + r[s].plain), `${s}: no NaN in the brief`);
      t.deep(r.scan.slice().sort(), r.pairs.slice().sort(), 'scanner: the 16 G8 pairs');
      for (const [x, u] of Object.entries(r.uni)) t.ok(u.self && u.cats.length === 1, `scanner for ${x}: one category or sector, the instrument included: ${u.n} ${u.cats}`);
      t.ok(/commodities$/.test(r.uni.GOLD.n) && /Technology stocks$/.test(r.uni['AAPL.US'].n) && /FX exotics$/.test(r.uni.USDMXN.n), 'scanner names its universe');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q15 texts: the tour says no simulated / ECB wording; the strength panel says G8 currencies',
    async run({ t, app }) {
      const page = await qApp(app);
      await page.waitForFunction(() => typeof window.startTour === 'function', null, { timeout: 10000 }); // ui.js defines it after a short poll
      await page.evaluate(() => { S.set.tourSeen = true; startTour(); });
      await page.waitForFunction(() => (document.getElementById('tourP')?.textContent || '').length > 0, null, { timeout: 10000 });
      const r = await page.evaluate(() => {
        const p = document.getElementById('tourP').textContent;
        document.querySelector('.tour-x')?.click();
        renderStrength();
        return { p, str: document.getElementById('strength').textContent };
      });
      t.ok(r.p && !/ECB/.test(r.p), 'tour step 1 has no ECB: ' + r.p);
      t.ok(/Pick an instrument/.test(r.p) && /nothing is real money/.test(r.p), 'tour step 1 introduces the markets and says nothing is real money: ' + r.p);
      t.ok(!/simulat|synthetic|zero drift|snapshot/i.test(r.p), 'tour step 1 never says simulated / zero drift: ' + r.p);
      t.ok(/G8 currencies/.test(r.str), 'strength panel labelled G8 currencies');
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q16 multi-chart auto-fill with FX closed (Sunday 12:00Z): reads the last common session, fills three panes and names them',
    async run({ t, app }) {
      const page = await qApp(app, new Date('2026-10-18T12:00:00Z'));
      const r = await page.evaluate(() => {
        T.clearToasts(); setSymbol('EURUSD'); S.set.mc = { layout: '4', panes: [{ sym: 'USDJPY', tf: 5 }, { sym: 'USDJPY', tf: 5 }, { sym: 'USDJPY', tf: 5 }], syncX: true, linkTf: false };
        const pair = corrPair('EURUSD', 'GBPUSD');
        mcAutoFill();
        return { pair, panes: S.set.mc.panes.map(p => p.sym), toasts: T.toasts() };
      });
      t.ok(r.pair.n >= 30 && Number.isFinite(r.pair.r), `EURUSD/GBPUSD measured on the last session: n=${r.pair.n} r=${r.pair.r}`);
      t.eq(new Set(r.panes).size, 3, 'three different instruments: ' + r.panes.join(','));
      t.ok(!r.panes.includes('EURUSD'), 'never the main chart');
      const ts = r.toasts.find(x => /Filled with related/.test(x.title));
      t.ok(ts && /\+|−|-/.test(ts.body) && ts.body.split('·').length >= 3, 'toast names the three picks: ' + JSON.stringify(r.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q17 multi-chart auto-fill ranks on the last common in-session minutes, not the clock window: a stock 10 minutes after the Monday open still fills',
    async run({ t, app }) {
      const page = await qApp(app, new Date('2026-10-19T13:40:00Z'));
      const r = await page.evaluate(() => {
        T.clearToasts(); setSymbol('AAPL.US'); S.set.corrLb = 1440; S.set.fav = [];
        S.set.mc = { layout: '4', panes: [{ sym: 'USDJPY', tf: 5 }, { sym: 'USDJPY', tf: 5 }, { sym: 'USDJPY', tf: 5 }], syncX: true, linkTf: false };
        const win = corrPair('AAPL.US', 'EURUSD'), rec = corrRecent('AAPL.US', 'EURUSD');
        mcAutoFill();
        return { win, rec, panes: S.set.mc.panes.map(p => p.sym), toasts: T.toasts() };
      });
      t.ok(!(r.win.n >= 30), `the 1-day clock window holds only the minutes since the open: n=${r.win.n}`);
      t.ok(r.rec.n >= 200 && Number.isFinite(r.rec.r), `the last common minutes reach back into Friday: n=${r.rec.n} r=${r.rec.r}`);
      t.eq(new Set(r.panes).size, 3, 'three panes filled: ' + r.panes.join(','));
      t.ok(r.toasts.some(x => /Filled with related/.test(x.title)), 'filled: ' + JSON.stringify(r.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q18 multi-chart auto-fill with nothing measurable says so and leaves the panes',
    async run({ t, app }) {
      const page = await qApp(app);
      const r = await page.evaluate(() => {
        T.clearToasts(); setSymbol('EURUSD');
        S.set.mc = { layout: '4', panes: [{ sym: 'USDJPY', tf: 5 }, { sym: 'GBPUSD', tf: 5 }, { sym: 'AUDUSD', tf: 5 }], syncX: true, linkTf: false };
        const keep = Engine.candles.EURUSD; Engine.candles.EURUSD = keep.slice(-10);
        try { mcAutoFill(); } finally { Engine.candles.EURUSD = keep; }
        return { panes: S.set.mc.panes.map(p => p.sym), toasts: T.toasts() };
      });
      t.deep(r.panes, ['USDJPY', 'GBPUSD', 'AUDUSD'], 'panes unchanged');
      t.ok(!r.toasts.some(x => /Filled with related/.test(x.title)) && r.toasts.some(x => /Nothing to fill/.test(x.title) && /unchanged/.test(x.body)), 'honest toast: ' + JSON.stringify(r.toasts));
      t.noErrors(page);
    }
  },
  {
    name: 'W0Q19 correlation Yours with FX closed (Sunday 12:00Z): each pair is read on the lookback ending at its last common minutes, as in G8',
    async run({ t, app }) {
      const page = await qApp(app, new Date('2026-10-18T12:00:00Z'));
      const r = await page.evaluate(() => {
        T.reset(); setSymbol('USDJPY'); S.set.corrLb = 1440; S.set.fav = ['EURUSD', 'GBPUSD', 'GOLD', 'US.500'];
        setTab('corr'); CORR.set = 'fx'; renderCorr();
        const ps = corrSyms(), cell = (a, b) => document.querySelectorAll('#corr > div')[(ps.indexOf(a) + 1) * (ps.length + 1) + ps.indexOf(b) + 1];
        const g8 = cell('EURUSD', 'GBPUSD').textContent;
        CORR.set = 'all'; renderCorr();
        const ys = corrSyms(), all = [...document.querySelectorAll('#corr > div')], n = ys.length;
        const off = []; for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) if (i !== j) off.push(all[(i + 1) * (n + 1) + j + 1]);
        const tipOf = d => d.dataset.tip || d.title || '', eg = off.find(d => /^EUR\/USD vs GBP\/USD/.test(tipOf(d)));
        return { g8, ys, dash: off.filter(d => d.textContent === '—').map(tipOf), eg: eg && { txt: eg.textContent, title: tipOf(eg) }, pair: corrPair('EURUSD', 'GBPUSD'), grid: document.getElementById('corr').textContent };
      });
      t.ok(r.pair.n >= 30 && Number.isFinite(r.pair.r), `corrPair on the last session: n=${r.pair.n} r=${r.pair.r}`);
      t.ok(r.eg && r.eg.txt === r.g8, `Yours EUR/USD vs GBP/USD = G8 value ${r.g8}: ${JSON.stringify(r.eg)}`);
      t.ok(r.eg && /UTC, when the earlier of the two last traded/.test(r.eg.title), 'tooltip names the window it was read on: ' + (r.eg && r.eg.title));
      t.eq(r.dash.length, 0, 'no empty cell on Sunday for ' + r.ys.join(',') + ': ' + r.dash.slice(0, 3).join(' | '));
      t.ok(!/NaN|undefined/.test(r.grid), 'no NaN in the matrix');
      t.noErrors(page);
    }
  }
];
