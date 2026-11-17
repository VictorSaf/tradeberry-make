// Challenge Readiness (challenge.js): rule engine on equity, trailing modes, consistency, day reset, breach flatten,
// order blocking, Monte Carlo on a known trade set (expected value computed here, independently of app code).

// in-page helper: move EURUSD so the open buys' floating P&L is ~usd. The engine pivots on the bid (mid() is the
// bid, catalog C2) and T.move sets it, so the target is the exit bid itself, whatever the spread (night, news).
const PAGE_HELPERS = () => {
  window.CHT = {
    floatTo(usd) {
      const ps = S.positions; if (!ps.length) return;
      const lots = ps.reduce((s, p) => s + p.lots, 0), entry = ps[0].entry;
      T.move('EURUSD', entry + usd / (lots * 100000));
    },
    fl: () => account().fl,
    custom(over) {
      const base = { id: 'custom', pv: 0, label: 'Test rules', phases: [{ target: 10 }], daily: null, max: { pct: 2, mode: 'intraday', trailOn: 'equity', lock: false }, minDays: 0, profitDays: null, consistency: null, reset: { tz: 'UTC', hour: 0 }, validFrom: '2026-10-19', checked: '2026-10-19' };
      const r = chValidRules({ ...base, ...over }); chCfg().custom = r; return r;
    },
    fresh() { T.reset(); S.chal = null; S.demo = null; chCfg(); }
  };
};
// pinned clock (Friday 10:30 UTC, see tests/run.mjs): the FX market is open whenever the suite runs (v15 sessions)
async function chApp(app) { const page = await app('', { clock: true }); await page.evaluate(PAGE_HELPERS); return page; }

// exact P(pass) for a ±1% day walk (target +10%, static floor −10%, no daily limit) over H days with up-probability q
function passProb(q, H) {
  // state: number of up days u after s days (downs = s − u); E = 1.01^u · 0.99^(s−u)
  let alive = new Map([[0, 1]]), pass = 0;
  for (let s = 1; s <= H; s++) {
    const next = new Map();
    for (const [u, p] of alive) for (const [du, pr] of [[1, q], [0, 1 - q]]) {
      const nu = u + du, E = Math.pow(1.01, nu) * Math.pow(0.99, s - nu), w = p * pr;
      if (E <= 0.9) continue; // breach
      if (E >= 1.1) { pass += w; continue; }
      next.set(nu, (next.get(nu) || 0) + w);
    }
    alive = next;
  }
  return pass;
}
function binom(n, k) { let c = 1; for (let i = 1; i <= k; i++) c = c * (n - k + i) / i; return c; }

export const tests = [
  {
    name: 'challenge 01 day keys (DST, reset hour), floors, rule validation',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        const P = { tz: 'Europe/Prague', hour: 0 }, C = { tz: 'America/Chicago', hour: 17 };
        // 2026-10-26 is the first CET day: 23:00 UTC on the 25th is 00:00 Prague
        const k = [chDayKey(Date.UTC(2026, 9, 24, 22, 30) / 1000, P), chDayKey(Date.UTC(2026, 9, 25, 22, 30) / 1000, P), chDayKey(Date.UTC(2026, 9, 25, 23, 0) / 1000, P)];
        // Chicago is UTC−5 (CDT) on 2026-10-19: 16:59 and 17:00 local are 21:59 and 22:00 UTC
        const c = [chDayKey(Date.UTC(2026, 9, 19, 21, 59) / 1000, C), chDayKey(Date.UTC(2026, 9, 19, 22, 0) / 1000, C)];
        const att = (max, hw, daily, bal0 = 100000) => ({ rules: { ...chRules('2s-static'), max, daily }, e0: 100000, hw, day: { bal0, eq0: bal0 } });
        const f = [
          chFloors(att({ pct: 10, mode: 'static', trailOn: 'balance', lock: false }, 100000, null), 100000).maxFloor,
          chFloors(att({ pct: 10, mode: 'eod', trailOn: 'balance', lock: false }, 104000, null), 100000).maxFloor,
          chFloors(att({ pct: 10, mode: 'eod', trailOn: 'balance', lock: true }, 112000, null), 100000).maxFloor,
          chFloors(att({ pct: 10, mode: 'static', trailOn: 'balance', lock: false }, 100000, { pct: 5, base: 'initial', anchor: 'balance' }, 101000), 100000).dailyFloor
        ];
        const ok = chValidRules(chRules('1s-eod')) != null, bad = [
          chValidRules({ ...chRules('2s-static'), max: { pct: 99, mode: 'static', trailOn: 'balance', lock: false } }),
          chValidRules({ ...chRules('2s-static'), reset: { tz: 'Mars/Base', hour: 0 } }),
          chValidRules({ ...chRules('2s-static'), id: 'other' })
        ];
        // a known id keeps its texts from code even when the file changes them
        const txt = chValidRules({ ...chRules('2s-static'), label: '<b>x</b>', source: 'evil' });
        const names = CH_IDS.map(id => CH_PRESETS[id].label + ' ' + CH_PRESETS[id].source).join(' ');
        return { k, c, f, ok, bad, txt: [txt.label, txt.source], frozen: Object.isFrozen(CH_PRESETS['2s-static'].max), vf: CH_IDS.every(id => /^\d{4}-\d{2}-\d{2}$/.test(CH_PRESETS[id].validFrom) && CH_PRESETS[id].source.length > 20), names };
      });
      t.deep(r.k, ['2026-10-25', '2026-10-25', '2026-10-26'], 'Prague day keys across the end of DST');
      t.deep(r.c, ['2026-10-18', '2026-10-19'], 'Chicago 17:00 reset: a day is named by the date it starts on, 16:59 and 17:00 fall on consecutive days');
      t.deep(r.f, [90000, 94000, 100000, 96000], 'static, EOD, locked EOD and daily floors');
      t.ok(r.ok, 'a preset validates');
      t.deep(r.bad, [null, null, null], 'out-of-range pct, unknown tz and unknown id are rejected');
      t.deep(r.txt, ['2-step · static drawdown', 'Rules a large prop firm published for its 2-step evaluation (page modified 12.10.2026)'], 'preset texts come from code');
      t.ok(r.frozen, 'presets are frozen');
      t.ok(r.vf, 'every preset has a valid-from date and a described source');
      t.ok(!/FTMO|FundedNext|The5ers|Topstep|Apex|MyForexFunds/i.test(r.names), 'no firm names in the presets');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 02 sanitizeChal and sanitizeState',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); chStart('2s-static');
        const good = JSON.parse(JSON.stringify(S.chal));
        const v2 = sanitizeChal({ ...good, v: 2 });
        const badAtt = JSON.parse(JSON.stringify(good)); badAtt.att.rules.max.pct = 99;
        const badTz = JSON.parse(JSON.stringify(good)); badTz.custom = { ...chRules('2s-static'), id: 'custom', label: 'x', reset: { tz: 'Mars/Base', hour: 0 } };
        const many = JSON.parse(JSON.stringify(good)); many.log = Array.from({ length: 30 }, (_, i) => ({ id: 'A' + (i + 1), pid: '2s-static', pv: 1, label: 'x', start: 1, end: 2, status: 'stopped', phase: 0, why: 'user', days: 1, ret: 0 }));
        const proto = sanitizeChal(JSON.parse('{"v":1,"sel":"__proto__","__proto__":{"polluted":1},"opt":{"risk":7,"horizon":5}}'));
        const st = sanitizeState({ balance: 100000, chal: good, positions: [{ id: 1, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, mae: 5, mfe: -3 }], history: [{ id: 2, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, pnl: 0, mae: -10, mfe: 'x', riskUsd: -1 }] });
        const bad = sanitizeState({ balance: 100000, chal: { v: 9 } });
        return {
          keep: sanitizeChal(good).att.id === good.att.id, v2, badAtt: sanitizeChal(badAtt).att, badTz: sanitizeChal(badTz).custom, n: sanitizeChal(many).log.length,
          proto: proto && { sel: proto.sel, opt: proto.opt, own: Object.prototype.hasOwnProperty.call(proto, '__proto__'), polluted: ({}).polluted },
          st: { chal: !!st.chal && st.chal.att.status, p: [st.positions[0].mae, st.positions[0].mfe], h: [st.history[0].mae, st.history[0].mfe, st.history[0].riskUsd] }, bad: 'chal' in bad
        };
      });
      t.ok(r.keep, 'a valid S.chal survives');
      t.eq(r.v2, null, 'unknown version → null');
      t.eq(r.badAtt, null, 'an attempt with out-of-range rules is dropped');
      t.eq(r.badTz, null, 'custom rules with an unknown time zone are dropped');
      t.eq(r.n, 20, 'the log is capped at 20');
      t.deep(r.proto, { sel: '2s-static', opt: { risk: 'asis', horizon: 60 }, own: false, polluted: undefined }, '__proto__ and bad options fall back to defaults');
      t.deep(r.st, { chal: 'active', p: [0, 0], h: [-10, null, null] }, 'sanitizeState cleans S.chal and the MAE/MFE/risk fields');
      t.eq(r.bad, false, 'a corrupt chal is removed by sanitizeState');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 03 daily loss on equity with floating P&L: 80% warning, cool-down, breach closes positions',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); const ev = []; addEventListener('mfx:chal', e => ev.push(e.detail.type));
        const st = chStart('2s-static');
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true });
        CHT.floatTo(-4300); chTick(); chTick();
        const att = S.chal.att, warn = { fl: CHT.fl(), status: att.status, bal: S.balance, cool: att.coolUntil > Engine.simTime, toasts: T.toasts().filter(x => x.title === "Challenge: 80% of today's loss limit used").length, live: chLive() };
        const o = { sym: 'EURUSD', side: 'buy', lots: .1, sl: Engine.quote('EURUSD').bid - .002 };
        const pm = { need: pmNeeded(o), flags: pmFlags(o, pmRisk(o)).map(f => f[0]) };
        CHT.floatTo(-5100); const fl = CHT.fl(); chTick();
        return { ok: st.ok, warn, pm, fl, status: att.status, why: att.end && att.end.why, eq: att.end && att.end.eq, floor: att.end && att.end.floor, open: S.positions.length, reason: S.history[0] && S.history[0].reason, log: S.chal.log.length, ev, mae: S.history[0].mae, day: att.day.n };
      });
      t.ok(r.ok, 'attempt started');
      t.ok(r.warn.fl < -4000 && r.warn.fl > -4600, `floating P&L set to about −4,300 (${r.warn.fl.toFixed(0)})`);
      t.eq(r.warn.status, 'active', 'balance untouched, the attempt is still active below the floor');
      t.eq(r.warn.bal, 100000, 'nothing closed yet');
      t.ok(r.warn.live.dailyUsed > .8 && r.warn.live.dailyUsed < 1, 'daily room is measured on equity');
      t.eq(r.warn.toasts, 1, 'the 80% warning is announced once');
      t.ok(r.warn.cool, 'the 80% warning starts a challenge cool-down');
      t.ok(r.pm.need, 'during the cool-down every trade gets a pre-mortem');
      t.ok(r.pm.flags.includes('chal'), 'the pre-mortem shows the challenge flag');
      t.ok(r.fl <= -5000, `floating P&L past the daily limit (${r.fl.toFixed(0)})`);
      t.eq(r.status, 'breached', 'breach on floating P&L alone');
      t.eq(r.why, 'daily', 'daily limit');
      t.ok(r.eq <= r.floor && r.floor === 95000, `equity ${r.eq} at or below the 95,000 floor`);
      t.eq(r.open, 0, 'breach closes every position');
      t.eq(r.reason, 'Stop-out (challenge breach)', 'the history says why');
      t.ok(r.mae < -5000, 'the closed trade carries its MAE');
      t.eq(r.log, 1, 'the attempt is in the log');
      t.deep(r.ev, ['start', 'warn', 'breach'], 'events start, warn, breach');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 04 max loss breach; both floors in one step take the higher one',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); chStart('2s-static'); const att = S.chal.att;
        // earlier days lost 6,000: the day starts at 94,000, daily floor 89,000, max floor 90,000
        S.balance = 94000; att.day.bal0 = att.day.eq0 = att.day.low = 94000;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true });
        CHT.floatTo(-4100); chTick();
        const a = { status: att.status, why: att.end && att.end.why };
        // both floors at once: day start 95,000 → daily floor 90,000 = max floor 90,000 → 'daily' (the higher or equal one)
        CHT.fresh(); chStart('2s-static'); const b = S.chal.att; S.balance = 95000; b.day.bal0 = b.day.eq0 = b.day.low = 95000;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true }); CHT.floatTo(-5600); chTick();
        return { a, b: { status: b.status, why: b.end && b.end.why } };
      });
      t.deep(r.a, { status: 'breached', why: 'max' }, 'max floor 90,000 reached before the daily floor 89,000');
      t.deep(r.b, { status: 'breached', why: 'daily' }, 'equal floors: daily');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 05 trailing: intraday on equity vs end of day on balance; day reset',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        // intraday trailing on equity, 2%, no lock: +3,000 floating lifts the floor to ~101,000 at once
        CHT.fresh(); CHT.custom({ max: { pct: 2, mode: 'intraday', trailOn: 'equity', lock: false } }); chStart('custom');
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true });
        CHT.floatTo(3000); chTick(); const ia = { hw: S.chal.att.hw, floor: chLive().maxFloor };
        CHT.floatTo(-50); chTick(); const ib = { status: S.chal.att.status, why: S.chal.att.end && S.chal.att.end.why };
        // the same path under end-of-day trailing on balance: the floor does not move intraday
        CHT.fresh(); CHT.custom({ max: { pct: 2, mode: 'eod', trailOn: 'balance', lock: false } }); chStart('custom'); const att = S.chal.att;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true });
        CHT.floatTo(3000); chTick(); const ea = { hw: att.hw, floor: chLive().maxFloor };
        CHT.floatTo(-50); chTick(); const eb = { status: att.status };
        CHT.floatTo(3000); closePosition(S.positions[0].id, 'Manual'); chTick();
        const before = { hw: att.hw, n: att.day.n, bal: S.balance };
        // day reset: pretend the current day started yesterday
        att.day.k = '2026-01-01'; att.day.bal0 = 100000; att.warn = { k: '2026-01-01', d: 50, m: 0 }; chTick();
        const after = { hw: att.hw, days: JSON.parse(JSON.stringify(att.days)), day: { ...att.day }, warn: { ...att.warn }, key: chDayKey(Engine.simTime, att.rules.reset) };
        // a day without fills is not a trading day
        att.day.k = '2026-01-02'; chTick();
        return { ia, ib, ea, eb, before, after, nDays: att.days.length };
      });
      t.ok(r.ia.hw > 102800 && r.ia.floor > 100800, `intraday: high-water ${r.ia.hw.toFixed(0)}, floor ${r.ia.floor.toFixed(0)}`);
      t.deep(r.ib, { status: 'breached', why: 'max' }, 'intraday: giving back the open profit breaches');
      t.deep(r.ea, { hw: 100000, floor: 98000 }, 'EOD: floating profit does not move the floor');
      t.deep(r.eb, { status: 'active' }, 'EOD: the same path does not breach');
      t.eq(r.before.hw, 100000, 'EOD: closed profit moves the floor only at the day reset');
      t.eq(r.before.n, 2, 'two fills today (one open, one close)');
      t.near(r.after.hw, r.before.bal, 'EOD: high-water = balance at the reset');
      t.deep(r.after.days, [{ k: '2026-01-01', pnl: r.before.bal - 100000, n: 2 }], 'the finished day is recorded with its closed P&L');
      t.deep([r.after.day.k, r.after.day.n, r.after.day.bal0], [r.after.key, 0, r.before.bal], 'the new day starts from the balance');
      t.deep(r.after.warn, { k: r.after.key, d: 0, m: 0 }, 'warnings reset with the day');
      t.eq(r.nDays, 1, 'a day without fills is not counted');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 06 consistency keeps the attempt open; two phases pass; no "Ready" anywhere',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); chStart('1s-eod'); const att = S.chal.att;
        // best day +9,000 of a +10,500 profit = 86% > 50%
        S.balance = 110500; att.days = [{ k: '2026-10-10', pnl: 9000, n: 1 }]; att.day.bal0 = att.day.eq0 = 109000; att.day.n = 1; chTick();
        const a = { status: att.status, pending: chLive().pending, tgt: att.tgtAt > 0 };
        att.days = [{ k: '2026-10-11', pnl: 5000, n: 1 }, { k: '2026-10-10', pnl: 4000, n: 2 }]; chTick();
        const b = { status: att.status, why: att.end && att.end.why };
        // 2-step: phase 1 needs 4 trading days
        CHT.fresh(); chStart('2s-static'); const c = S.chal.att;
        S.balance = 111000; c.days = [{ k: '2026-10-10', pnl: 9000, n: 2 }, { k: '2026-10-09', pnl: 2000, n: 1 }]; c.day.n = 1; c.day.bal0 = 111000; chTick();
        const c1 = { phase: c.phase, pending: chLive().pending };
        c.days.push({ k: '2026-10-08', pnl: 0, n: 1 }); chTick();
        const c2 = { phase: c.phase, e0: c.e0, days: c.days.length };
        S.balance = 111000 * 1.055; c.days = [1, 2, 3, 4].map(i => ({ k: '2026-10-1' + i, pnl: 1000, n: 1 })); chTick();
        setTab('chal'); renderChal();
        const txt = document.getElementById('chal').textContent;
        return { a, b, c1, c2, c3: { status: c.status, phases: c.phases.length }, pass: /All phases passed/.test(txt), ready: /\bReady\b|will pass/i.test(txt.replace(/Readiness|not-ready/g, '')) };
      });
      t.eq(r.a.status, 'active', 'consistency is not a breach');
      t.ok(r.a.tgt, 'target reached is recorded');
      t.ok(r.a.pending.some(x => /^best day is 86% of profit \(limit 50%\)$/.test(x)), `pending names the consistency rule: ${r.a.pending}`);
      t.deep(r.b, { status: 'passed', why: 'target' }, 'with the best day at 48% the phase passes');
      t.deep(r.c1, { phase: 0, pending: ['1 more trading day'] }, 'phase 1 waits for the 4th trading day');
      t.deep(r.c2, { phase: 1, e0: 111000, days: 0 }, 'phase 2 starts from the balance');
      t.deep(r.c3, { status: 'passed', phases: 2 }, 'both phases passed');
      t.ok(r.pass, 'pass banner');
      t.ok(!r.ready, 'no "Ready" or "will pass" text in the panel');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 07 orders: a stop-out that would breach is blocked; ticket warning; speed cap; demo voids',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); setSymbol('EURUSD'); chStart('2s-static');
        Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 20, sl: 30, useSL: true, useTP: false, useTrail: false });
        renderTicket(); const btn = document.getElementById('tkSubmit');
        const blk = { disabled: btn.disabled, text: btn.textContent, why: tkBlocks(tkCalc()).map(b => b.why) };
        const q = Engine.quote('EURUSD'), p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 20, sl: q.ask - .003, pmDone: true, dupOk: true });
        const direct = { p, open: S.positions.length, toast: T.toasts().some(x => x.title === 'Order blocked' && /breach the daily limit/.test(x.body)) };
        placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.bid - .002).toFixed(5), lots: 20, slPips: 30, tpPips: 0, trail: 0, pmDone: true, dupOk: true });
        const pend = S.orders.length;
        S.tk.lots = 10; renderTicket();
        const wtxt = document.getElementById('tkWarn').innerHTML, w = { enabled: !btn.disabled, risk: /w-risk"><span class="w-lv">Risk<\/span>Challenge: this trade risks 60%/.test(wtxt) };
        const o = { sym: 'EURUSD', side: 'buy', lots: 10, sl: q.ask - .003 };
        const pm = { need: pmNeeded(o), flags: pmFlags(o, pmRisk(o)).map(f => f[0]), nosl: pmFlags({ sym: 'EURUSD', side: 'buy', lots: .1 }, pmRisk({ sym: 'EURUSD', side: 'buy', lots: .1 })).some(f => f[0] === 'chal') };
        setSpeed(300); const sp = { speed: Engine.speed, toast: T.toasts().some(x => /^Speed capped at 60×/.test(x.title)) }; Engine.speed = 0;
        S.demo = { at: Engine.simTime, n: 0 }; chTick(); const v = S.chal.att.status; S.demo = null;
        setSpeed(300); const free = Engine.speed; Engine.speed = 0;
        return { blk, direct, pend, w, pm, sp, v, free };
      });
      t.ok(r.blk.disabled && /challenge daily limit/i.test(r.blk.text), `ticket blocked with the reason on the button: ${r.blk.text}`);
      t.ok(r.blk.why.some(x => /^Challenge: a stop-out here breaches the daily limit \(risk \$6,000\.00, room \$5,000\.00\)\.$/.test(x)), `block reason: ${r.blk.why}`);
      t.deep(r.direct, { p: null, open: 0, toast: true }, 'every order path is blocked, with a toast');
      t.eq(r.pend, 0, 'a pending order that would breach at its stop is refused');
      t.ok(r.w.enabled && r.w.risk, 'half the room at risk: a risk-level challenge warning, not a block');
      t.ok(r.pm.need && r.pm.flags.includes('chal') && r.pm.nosl, 'the pre-mortem fires with the challenge flag');
      t.deep(r.sp, { speed: 60, toast: true }, 'speed capped at 60× during an attempt');
      t.eq(r.v, 'void', 'loading a demo voids the attempt');
      t.eq(r.free, 300, 'no cap without an attempt');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 08 Monte Carlo: P(pass) on a known ±1% trade set matches the exact expectation',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        const R = CHT.custom({ max: { pct: 10, mode: 'static', trailOn: 'balance', lock: false } }), opt = { risk: 'asis', horizon: 120 };
        const alt = Array.from({ length: 40 }, (_, i) => [{ ret: i % 2 ? -.01 : .01 }]);
        const s = chSampleOf(alt, R, 120), m = chSimulateSync(s, R, opt), m2 = chSimulateSync(s, R, opt);
        const s2 = chSampleOf(alt.concat([[{ ret: .01 }]]), R, 120);
        const P2 = chRules('2s-static'), opt2 = { risk: 'asis', horizon: 120 };
        const up = chSimulateSync(chSampleOf(Array.from({ length: 20 }, () => [{ ret: .01, mae: 0 }]), P2, 120), P2, opt2);
        const dn = chSimulateSync(chSampleOf(Array.from({ length: 20 }, () => [{ ret: -.01, mae: 0 }]), P2, 120), P2, opt2);
        const deep = chSimulateSync(chSampleOf(Array.from({ length: 20 }, () => [{ ret: 0, mae: -.06 }]), P2, 120), P2, opt2);
        return { asis: m.asis, zero: m.zero, same: JSON.stringify(m.asis) === JSON.stringify(m2.asis), sig: s.sig !== s2.sig, mu: s.mu, up: up.asis, dn: dn.asis, deep: deep.asis, BP: [m.B, m.P] };
      });
      // expected: each outer bootstrap draws 40 days, so the share of up days is Binomial(40, ½)/40
      let expect = 0; for (let j = 0; j <= 40; j++) expect += binom(40, j) / 2 ** 40 * passProb(j / 40, 120);
      t.deep(r.BP, [200, 100], '200 × 100 paths');
      t.ok(Math.abs(r.asis.pass - expect) < .05, `P(pass) ${r.asis.pass.toFixed(3)} vs exact ${expect.toFixed(3)} ± 0.05`);
      t.ok(r.asis.ci.pass[0] <= r.asis.pass && r.asis.pass <= r.asis.ci.pass[1], `90% interval ${r.asis.ci.pass} contains ${r.asis.pass}`);
      t.ok(r.asis.ci.pass[1] - r.asis.ci.pass[0] > .1, 'the interval reflects the sample uncertainty');
      t.near(r.asis.pass + r.asis.breach + r.asis.neither, 1, 'pass + breach + neither = 1');
      t.near(r.mu, 0, 'zero mean');
      t.near(r.zero.pass, r.asis.pass, 'zero edge = as traded when the mean is already zero', 0, .03);
      t.ok(r.same, 'deterministic: same sample, same numbers');
      t.ok(r.sig, 'one more trade changes the signature');
      t.eq(r.up.pass, 1, '+1% every day passes both phases');
      t.deep([r.dn.breach, r.dn.max, r.dn.daily], [1, 1, 0], '−1% every day ends on the max limit');
      t.deep([r.deep.daily, r.deep.breach], [1, 1], 'an intra-trade drawdown of 6% breaks the 5% daily limit');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 09 sample from history (demo and NBP out), verdict, panel and phone tile',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); const now = Engine.simTime;
        const row = (i, close, pnl, extra = {}) => ({ id: 100 + i, sym: 'EURUSD', side: i % 2 ? 'sell' : 'buy', lots: 1, entry: 1.1, exit: 1.1, open: close - 600, close, pnl, pips: 0, r: pnl / 200, reason: 'Manual', note: '', setup: '', ctx: [], sl0: 1.098, riskUsd: 200, mae: Math.min(0, pnl) - 20, mfe: Math.max(0, pnl) + 20, ...extra });
        const H = [];
        for (let i = 0; i < 40; i++) H.push(row(i, now - (12 - Math.floor(i / 3.4)) * 86400 - i * 60, i % 2 ? -150 : 160));
        H.push({ ...row(90, now - 5 * 86400, 300), nbp: true, side: 'nbp', lots: 0 });
        for (let i = 0; i < 5; i++) H.push(row(200 + i, now - 30 * 86400 - i * 60, 500));
        S.history = H.sort((a, b) => b.close - a.close); S.demo = { at: now - 20 * 86400, n: 5 };
        const R = chRules('2s-static'), s = chSample(R, { risk: 'asis', horizon: 60 }), s1 = chSample(R, { risk: 1, horizon: 60 });
        const m = chSimulateSync(s, R, { risk: 'asis', horizon: 60 }, 40, 50), ck = chChecks(s, m, R), v = chVerdict(s, m, ck, { risk: 'asis' });
        // with a passed practice attempt on these rules, the best verdict is still "Borderline"
        S.chal.log.unshift({ id: 'A1', pid: '2s-static', pv: 1, label: 'x', start: 1, end: 2, status: 'passed', phase: 1, why: 'target', days: 12, ret: 16 });
        const v2 = chVerdict(s, m, chChecks(s, m, R), { risk: 'asis' });
        const empty = chVerdict({ ...s, ok: false }, null, [], { risk: 'asis' });
        return { n: s.n, nDays: s.nDays, ex: s.excluded, ok: s.ok, r1: s1.trades[0].ret, v: v.level, d6: ck.find(c => c.id === 'D6').ok, v2, empty: [empty.level, empty.body] };
      });
      t.eq(r.n, 40, 'demo trades and the NBP credit stay out of the sample');
      t.eq(r.ex.demo, 5, 'demo trades counted as excluded');
      t.ok(r.nDays >= 10 && r.ok, `enough trades and days (${r.nDays} days)`);
      t.near(Math.abs(r.r1), [160 / 200 * .01, 150 / 200 * .01].find(x => Math.abs(Math.abs(r.r1) - x) < 1e-9) ?? -1, 'what-if at 1%: return = P&L / risk × 1%');
      t.eq(r.v, 'not-ready', 'no practice attempt yet: not ready');
      t.eq(r.d6, false, 'D6 asks for a practice attempt');
      t.eq(r.v2.level, 'borderline', 'the best level is borderline');
      t.ok(/^Borderline — practise more before paying for a challenge\.$/.test(r.v2.title), r.v2.title);
      t.ok(/With zero edge, these rules end in a pass .+ \(90% interval .+–.+\)/.test(r.v2.body), 'the body gives the zero-edge pass odds with their interval');
      t.ok(!/\bReady\b|will pass/i.test(r.v2.title + r.v2.body), 'never "Ready"');
      t.deep(r.empty, ['nodata', 'Close at least 30 trades over 10 trading days of your own. Example trades never count.'], 'no-data verdict');
      // the panel: tab in Coach, readiness table once the simulation is done
      await page.evaluate(() => setTab('chal'));
      await page.waitForFunction(() => document.querySelectorAll('#chal .ch-tbl tbody tr').length === 2, null, { timeout: 30000 });
      const ui = await page.evaluate(() => ({
        inCoach: (document.querySelector('#tabs button[data-tab="chal"]').dataset.in || '').includes('coach'), role: document.querySelector('#tabs button[data-tab="chal"]').getAttribute('role'),
        ci: [...document.querySelectorAll('#chal .ch-tbl tbody tr')].map(tr => /90%:/.test(tr.textContent)), fixed: /These odds describe your sizing and rule discipline with no edge assumed, not your chances on a live account\./.test(document.getElementById('chal').textContent) && !/simulat|zero before costs/i.test(document.getElementById('chal').textContent),
        es: document.getElementById('chal').textContent.includes('No practice attempt running'), tile: !!document.querySelector('.mtools button[data-mt="chal"]'), lab: !!document.getElementById('labToChal')
      }));
      t.deep(ui, { inCoach: true, role: 'tab', ci: [true, true], fixed: true, es: true, tile: true, lab: true }, 'Challenge tab in Coach, readiness table, empty attempt state, phone tile, Risk Lab link');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 10 panel states: start disabled with positions, pill and strip, breach banner, XSS-safe custom label',
    async run({ t, app }) {
      const page = await chApp(app);
      const a = await page.evaluate(() => {
        CHT.fresh(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); setTab('chal');
        const b = document.getElementById('chStartB'), out = { disabled: b.disabled, text: b.textContent };
        closePosition(S.positions[0].id); renderChal(); document.getElementById('chStartB').click();
        return { ...out, status: S.chal.att.status, focus: document.activeElement && document.activeElement.id };
      });
      t.deep(a, { disabled: true, text: 'Close your 1 open position to start', status: 'active', focus: 'chAttH' }, 'start refused with the reason, then started from the panel');
      await page.waitForFunction(() => !document.getElementById('chalPill').hidden && !document.getElementById('tkChal').hidden, null, { timeout: 4000 });
      const b = await page.evaluate(() => {
        const out = { pill: document.getElementById('chalPill').textContent, strip: document.getElementById('tkChal').textContent, meters: document.querySelectorAll('#chal [role=meter]').length };
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true }); CHT.floatTo(-5200); chTick(); setTab('chal');
        out.alert = document.querySelectorAll('#chal .ch-banner.breach[role=alert]').length; out.closed = /1 open position was closed/.test(document.getElementById('chal').textContent);
        CHT.fresh(); CHT.custom({ label: '<img src=x onerror="window.__pwn=1">' }); chCfg().sel = 'custom'; renderChal();
        out.img = document.querySelectorAll('#chal img').length; out.label = [...document.querySelectorAll('#chPreset option')].some(o => o.textContent === 'Custom: <img src=x onerror="window.__pwn=1">');
        return out;
      });
      await page.waitForTimeout(300);
      const pwn = await page.evaluate(() => window.__pwn);
      t.ok(/^CHALLENGE · P1 · day 1$/.test(b.pill), `status-bar pill: ${b.pill}`);
      t.ok(/^Challenge · Daily room \$4,99\d\.\d\d · Max room \$9,99\d\.\d\d · \$9,99\d\.\d\d to target$/.test(b.strip), `ticket strip: ${b.strip}`);
      t.ok(b.meters >= 4, 'meters with role=meter');
      t.eq(b.alert, 1, 'breach banner with role=alert');
      t.ok(b.closed, 'the banner says the position was closed');
      t.deep([b.img, b.label, pwn], [0, true, undefined], 'custom label is text, not HTML');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 11 Behaviour statistics leave the NBP credit out',
    async run({ t, app }) {
      const page = await chApp(app);
      const r = await page.evaluate(() => {
        CHT.fresh(); const now = Engine.simTime;
        const row = (id, pnl, x = {}) => ({ id, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, open: now - 900, close: now - 300 - id, pnl, pips: 0, r: null, reason: 'Stop loss', ctx: [], ...x });
        S.history = [row(1, -100), row(2, 250, { nbp: true, side: 'nbp', lots: 0, reason: 'Negative balance protection' }), row(3, -100), row(4, -100)];
        const streak = tiltStatus().streak; setTab('behav'); renderBehav();
        return { streak, H: BH_LAST.H, rev: bhRevenge() && bhRevenge()[0] };
      });
      t.deep(r, { streak: 3, H: 3, rev: 'revenge' }, 'streak, trade count and the last trade skip the NBP row');
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 12 sessions: a breach closes the open markets now; a position on a closed market waits and closes at its next open',
    async run({ t, app }) {
      // Tuesday 19:50 UTC: US stocks close at 19:55 UTC (16:35–22:55 server, EEST), FX stays open
      const page = await app('', { clock: new Date('2026-10-20T19:50:00Z') });
      await page.evaluate(PAGE_HELPERS);
      const r = await page.evaluate(() => {
        CHT.fresh(); S.set.jur = 'none'; S.set.lev = null; S.set.comm = 0;
        const st = chStart('2s-static');
        const a = openPosition({ sym: 'AAPL.US', side: 'buy', lots: 100, dupOk: true, pmDone: true });
        const e = openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, dupOk: true, pmDone: true });
        Engine.speed = 600; Engine.tick(1000); Engine.speed = 0; // 20:00 UTC
        const closedNow = !Engine.quote('AAPL.US').open, fxOpen = Engine.quote('EURUSD').open;
        T.clearToasts();
        T.move('EURUSD', e.entry * .94); chTick();
        const att = S.chal.att, toasts = T.toasts();
        const out = { st: st.ok, closedNow, fxOpen, status: att.status, open: S.positions.map(p => p.sym), wait: att.end.wait.slice(), closed: att.end.closed, aId: a.id,
          titles: toasts.map(x => x.title), body: (toasts.find(x => /breached/.test(x.title)) || {}).body || '',
          san: (sanitizeChal(JSON.parse(JSON.stringify(S.chal))) || {}).att?.end?.wait ?? 'dropped' };
        // nothing changes while the market stays closed
        chTick(); out.still = S.positions.map(p => p.sym); out.titles2 = T.toasts().map(x => x.title);
        // to Wednesday 14:00 UTC: AAPL.US reopened at 13:35 UTC
        Engine.speed = 3600; for (let i = 0; i < 18; i++) Engine.tick(1000); Engine.speed = 0;
        out.reopen = Engine.quote('AAPL.US').open; chTick();
        out.after = { open: S.positions.map(p => p.sym), wait: S.chal.att.end.wait, closed: S.chal.att.end.closed, reason: S.history[0].reason, sym: S.history[0].sym, log: chCfg().log[0].ret };
        out.ret = (S.balance / S.chal.att.b0 - 1) * 100;
        return out;
      });
      t.ok(r.st, 'attempt started'); t.ok(r.closedNow, 'AAPL.US closed at 20:00 UTC'); t.ok(r.fxOpen, 'EURUSD open');
      t.eq(r.status, 'breached', 'the FX loss breaches');
      t.deep(r.open, ['AAPL.US'], 'EURUSD closed at once; AAPL.US stays (its market is closed)');
      t.deep(r.wait, [r.aId], 'the waiting position is recorded'); t.eq(r.closed, 1, 'one position closed at the breach');
      t.ok(!r.titles.some(x => /Market closed/.test(x)), 'no "Market closed" refusal toast: ' + r.titles);
      t.ok(/1 open position closed/.test(r.body) && /AAPL\.US.*next open/.test(r.body), 'the breach toast says what waits: ' + r.body);
      t.deep(r.san, [r.aId], 'sanitizeChal keeps the waiting list');
      t.deep(r.still, ['AAPL.US'], 'still waiting while closed'); t.ok(!r.titles2.some(x => /Market closed/.test(x)), 'no refusal on later checks: ' + r.titles2);
      t.ok(r.reopen, 'AAPL.US open again on Wednesday 14:00 UTC');
      t.deep(r.after.open, [], 'closed at the reopening'); t.deep(r.after.wait, [], 'nothing waits any more'); t.eq(r.after.closed, 2, 'both counted');
      t.eq(r.after.reason, 'Stop-out (challenge breach)', 'reason'); t.eq(r.after.sym, 'AAPL.US', 'last close is AAPL.US');
      t.near(r.after.log, r.ret, 'the attempt log shows the return after the late close', 1e-9, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'challenge 13 night spread does not shift the floors; equity is evaluated while every market is closed',
    async run({ t, app }) {
      // Tuesday 20:30 UTC = 23:30 server (EEST): Spread Night on FX; US stocks closed since 19:55 UTC
      const page = await app('', { clock: new Date('2026-10-20T20:30:00Z') });
      await page.evaluate(PAGE_HELPERS);
      const r = await page.evaluate(() => {
        CHT.fresh(); chStart('2s-static'); const att = S.chal.att;
        S.balance = 94000; att.day.bal0 = att.day.eq0 = att.day.low = 94000;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 10, pmDone: true, dupOk: true });
        const sp = Engine.quote('EURUSD').sp; CHT.floatTo(-4010); const fl = account().fl; chTick();
        const a = { sp, fl: Math.round(fl), status: att.status, why: att.end && att.end.why };
        // a position on a closed market: its frozen bid still counts in equity, the breach is recorded now and the close waits
        CHT.fresh(); S.set.jur = 'none'; S.set.lev = null; chStart('2s-static');
        const b = S.chal.att; b.day.bal0 = b.day.eq0 = b.day.low = 100000;
        Engine.speed = 0; const p = { id: 999001, sym: 'AAPL.US', side: 'buy', lots: 100, entry: Engine.quote('AAPL.US').bid + 120, open: Engine.simTime, sl: null, tp: null, mae: 0, mfe: 0 };
        S.positions.push(p);
        const closed = !Engine.quote('AAPL.US').open, eq = account().eq; chTick();
        return { a, b: { closed, eqUnder: eq <= 90000, status: b.status, why: b.end && b.end.why, wait: b.end && b.end.wait, open: S.positions.length } };
      });
      t.eq(r.a.sp, 'night', 'the quote is in Spread Night');
      t.ok(Math.abs(r.a.fl + 4010) < 1, `floating P&L lands on the bid target (${r.a.fl})`);
      t.deep([r.a.status, r.a.why], ['breached', 'max'], 'max floor 90,000 breached under the night spread');
      t.ok(r.b.closed, 'AAPL.US is closed at 20:30 UTC');
      t.ok(r.b.eqUnder, 'equity on the frozen bid is under the max floor');
      t.deep([r.b.status, r.b.why, r.b.wait, r.b.open], ['breached', 'daily', [999001], 1], 'breach recorded with the market closed; the close waits for the open');
      t.noErrors(page);
    }
  }
];
