'use strict';
/* tradeBerry — Challenge Readiness (.mace/design/challenge-readiness.md). Two parts:
   1. Practice attempt: a parameterised rule engine over the simulated account. Equity (floating P&L and swap
      included; the live model has no commission) is checked after every loop step's order and stop checks, the
      daily limit resets in the preset's time zone, drawdown is static, end-of-day trailing or intraday trailing.
      A breach closes every position and ends the attempt.
   2. Readiness: a day-block bootstrap Monte Carlo on the user's own closed trades (demo trades never count), as
      traded and with the mean removed (zero edge), with a 90% interval from an outer bootstrap.
   The market is a zero-drift random walk, so the best verdict is "Borderline" with the zero-edge odds: the app
   never says "Ready". Presets are generic and versioned: no firm names, a 'valid from' date and a described source.
   Load order: after panels.js (ticket, trade and app globals exist), before behav.js; behav.js calls chFlag,
   chOrderBlock and bindChal. Pure functions first, so they can be used without the DOM. */

/* ============ presets (code, never state) ============ */
const CH_VER = 1;
const CH_TZ = ['Europe/Prague', 'Europe/London', 'America/New_York', 'America/Chicago', 'UTC'];
const CH_RISKS = ['asis', .25, .5, 1, 2], CH_HOR = [20, 60, 120];
const chHas = (o, k) => o != null && typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const chFreeze = o => { for (const v of Object.values(o)) if (v && typeof v === 'object') chFreeze(v); return Object.freeze(o); };
const CH_TGT_NOTE = 'The profit target counts closed balance with no open positions; the limits count equity, floating P&L included — our generic reading.';
const CH_PRESETS = chFreeze({
  '2s-static': {
    id: '2s-static', pv: 1, label: '2-step · static drawdown', phases: [{ target: 10 }, { target: 5 }],
    daily: { pct: 5, base: 'initial', anchor: 'balance' }, max: { pct: 10, mode: 'static', trailOn: 'balance', lock: false },
    minDays: 4, profitDays: null, consistency: null, reset: { tz: 'Europe/Prague', hour: 0 }, validFrom: '2026-10-12', checked: '2026-10-19',
    source: 'Rules a large prop firm published for its 2-step evaluation (page modified 12.10.2026)', url: null,
    notes: ['The daily limit is measured from the balance at the start of the day — our generic reading.', CH_TGT_NOTE]
  },
  '1s-eod': {
    id: '1s-eod', pv: 1, label: '1-step · end-of-day trailing', phases: [{ target: 10 }],
    daily: { pct: 3, base: 'initial', anchor: 'balance' }, max: { pct: 10, mode: 'eod', trailOn: 'balance', lock: true },
    minDays: 0, profitDays: null, consistency: 50, reset: { tz: 'Europe/Prague', hour: 0 }, validFrom: '2026-10-12', checked: '2026-10-19',
    source: 'Rules a large prop firm published for its 1-step evaluation (page modified 12.10.2026; consistency rule from 12.10.2026)', url: null,
    notes: ['The daily limit is measured from the balance at the start of the day — our generic reading.', 'The trailing floor stops rising at the starting balance — our generic choice.', 'Breaking the consistency rule is not a breach: you keep trading until the best day is ≤ 50% of the profit.', CH_TGT_NOTE]
  },
  '2s-pdays': {
    id: '2s-pdays', pv: 1, label: '2-step · profitable days', phases: [{ target: 10 }, { target: 5 }],
    daily: { pct: 5, base: 'initial', anchor: 'maxBalEq' }, max: { pct: 10, mode: 'static', trailOn: 'balance', lock: false },
    minDays: 0, profitDays: { n: 3, minPct: .5 }, consistency: null, reset: { tz: 'Europe/Prague', hour: 0 }, validFrom: '2026-10-19', checked: '2026-10-19',
    source: 'Rules a prop firm published for its high-stakes 2-step program (read 19.10.2026)', url: null,
    notes: ['The daily limit is measured from the higher of balance and equity at the start of the day — our generic reading.', 'The day resets at midnight Prague time — our generic choice.', CH_TGT_NOTE]
  },
  intraday: {
    id: 'intraday', pv: 1, label: 'Intraday trailing', phases: [{ target: 10 }],
    daily: null, max: { pct: 6, mode: 'intraday', trailOn: 'equity', lock: true },
    minDays: 0, profitDays: null, consistency: 30, reset: { tz: 'America/Chicago', hour: 17 }, validFrom: '2026-10-19', checked: '2026-10-19',
    source: 'Generic intraday trailing drawdown, modelled on instant-funding and futures evaluations (read 19.10.2026); the numbers are ours', url: null,
    notes: ['The floor trails your highest equity, floating profit included, and stops rising at the starting balance.', 'Breaking the consistency rule is not a breach: you keep trading until the best day is ≤ 30% of the profit.', CH_TGT_NOTE]
  }
});
const CH_IDS = Object.keys(CH_PRESETS);
// discipline thresholds for the verdict (§3.7)
const CH_MIN_N = 30, CH_MIN_DAYS = 10, CH_STOP_SHARE = .95, CH_TILT_SHARE = .05, CH_DAILY_ODDS = .10, CH_PRACTICE_DAYS = 10, CH_SPEED_CAP = 60;
const CH = { mc: null, run: 0, busy: null, tzBad: null, fmt: {}, edit: false, focus: null, coachBreach: null };

/* ============ validation (imports and the saved copy) ============ */
const CH_DAY = /^\d{4}-\d{2}-\d{2}$/;
const chNum = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const chInt = (v, lo, hi) => Number.isInteger(v) && v >= lo && v <= hi;
const chObj = v => v && typeof v === 'object' && !Array.isArray(v);
// a rule set with every field inside its range, or null; for a known preset id the texts come from code
function chValidRules(r) {
  if (!chObj(r)) return null;
  const known = chHas(CH_PRESETS, r.id) ? CH_PRESETS[r.id] : null;
  if (!known && r.id !== 'custom') return null;
  if (!chInt(r.pv, 0, 1e6)) return null;
  if (!Array.isArray(r.phases) || r.phases.length < 1 || r.phases.length > 3 || !r.phases.every(p => chObj(p) && chNum(p.target, .5, 50))) return null;
  let daily = null;
  if (r.daily != null) {
    const d = r.daily;
    if (!chObj(d) || !chNum(d.pct, .5, 20) || !['initial', 'dayStart'].includes(d.base) || !['balance', 'maxBalEq'].includes(d.anchor)) return null;
    daily = { pct: d.pct, base: d.base, anchor: d.anchor };
  }
  const m = r.max;
  if (!chObj(m) || !chNum(m.pct, 1, 30) || !['static', 'eod', 'intraday'].includes(m.mode) || !['balance', 'equity'].includes(m.trailOn) || typeof m.lock !== 'boolean') return null;
  if (!chInt(r.minDays, 0, 60)) return null;
  let profitDays = null;
  if (r.profitDays != null) { const p = r.profitDays; if (!chObj(p) || !chInt(p.n, 0, 30) || !chNum(p.minPct, 0, 5)) return null; profitDays = { n: p.n, minPct: p.minPct }; }
  if (r.consistency != null && !chNum(r.consistency, 10, 100)) return null;
  if (!chObj(r.reset) || !CH_TZ.includes(r.reset.tz) || !chInt(r.reset.hour, 0, 23)) return null;
  if (typeof r.validFrom !== 'string' || !CH_DAY.test(r.validFrom) || typeof r.checked !== 'string' || !CH_DAY.test(r.checked)) return null;
  if (!known && (typeof r.label !== 'string' || !r.label.trim() || r.label.length > 40)) return null;
  return {
    id: r.id, pv: r.pv, label: known ? known.label : r.label, phases: r.phases.map(p => ({ target: p.target })), daily,
    max: { pct: m.pct, mode: m.mode, trailOn: m.trailOn, lock: m.lock }, minDays: r.minDays, profitDays, consistency: r.consistency ?? null,
    reset: { tz: r.reset.tz, hour: r.reset.hour }, validFrom: r.validFrom, checked: r.checked,
    source: known ? known.source : 'Entered by you', url: known ? known.url : null, notes: known ? [...known.notes] : [CH_TGT_NOTE]
  };
}
const CH_STATUS = ['active', 'passed', 'breached', 'stopped', 'void'], CH_WHY = ['daily', 'max', 'target', 'user', 'account'];
// plausible sizes for an import: a starting capital of $1 to $1 billion, balances and P&L within 11× of it (a phase
// ends at its target, so +1,000% is far past any real attempt), returns from −100% to +1,000%
const CH_CAP = [1, 1e9], CH_GROW = 11, CH_RET = [-100, 1000];
function chValidAtt(a) {
  if (!chObj(a)) return null;
  const rules = chValidRules(a.rules); if (!rules) return null;
  if (!chNum(a.b0, ...CH_CAP)) return null;
  const B = a.b0 * CH_GROW, pos = v => chNum(v, 1e-9, B), t0 = v => chNum(v, 0, 1e11), dk = v => typeof v === 'string' && CH_DAY.test(v);
  if (typeof a.id !== 'string' || !/^A\d{1,12}$/.test(a.id) || !CH_STATUS.includes(a.status) || !chInt(a.phase, 0, rules.phases.length - 1)) return null;
  if (![a.e0, a.hw].every(pos) || ![a.start, a.ph0, a.coolUntil, a.tgtAt].every(t0)) return null;
  // phase 1 starts at the starting capital; a later phase at a higher balance; the high-water mark never below its phase start
  if (a.phase === 0 ? Math.abs(a.e0 - a.b0) > 1e-6 * a.b0 : !(a.e0 > a.b0)) return null;
  if (!(a.hw >= a.e0 * (1 - 1e-9))) return null;
  const d = a.day; if (!chObj(d) || !dk(d.k) || ![d.bal0, d.eq0].every(pos) || !chNum(d.low, -B, B) || !chInt(d.n, 0, 1e6)) return null;
  if (!Array.isArray(a.days) || a.days.length > 400 || !a.days.every(x => chObj(x) && dk(x.k) && chNum(x.pnl, -B, B) && chInt(x.n, 0, 1e6))) return null;
  const w = a.warn; if (!chObj(w) || !dk(w.k) || ![0, 50, 80].includes(w.d) || ![0, 50, 80].includes(w.m)) return null;
  if (!Array.isArray(a.phases) || a.phases.length > 3 || !a.phases.every(p => chObj(p) && pos(p.e0) && t0(p.start) && t0(p.end) && chInt(p.days, 0, 1e5) && chNum(p.ret, ...CH_RET))) return null;
  let end = null;
  if (a.end != null) {
    const e = a.end;
    if (!chObj(e) || !t0(e.t) || !CH_WHY.includes(e.why) || !chNum(e.eq, -B, B) || !(e.floor == null || chNum(e.floor, -B, B)) || !chInt(e.closed ?? 0, 0, 1e4)) return null;
    end = { t: e.t, why: e.why, eq: e.eq, floor: e.floor ?? null, closed: e.closed ?? 0, day: chInt(e.day, 1, 1e5) ? e.day : 1 };
    // positions of a breach that wait for their market to open (ids); anything else in the list is dropped
    if (Array.isArray(e.wait) && a.status === 'breached') end.wait = [...new Set(e.wait.filter(v => chInt(v, 0, 1e12)))].slice(0, 500);
  }
  if (a.status === 'active' ? end != null : end == null) return null;
  if (!(a.demoAt == null || t0(a.demoAt))) return null;
  return {
    id: a.id, rules, status: a.status, phase: a.phase, start: a.start, e0: a.e0, ph0: a.ph0, hw: a.hw, b0: a.b0,
    day: { k: d.k, bal0: d.bal0, eq0: d.eq0, n: d.n, low: d.low }, days: a.days.map(x => ({ k: x.k, pnl: x.pnl, n: x.n })),
    warn: { k: w.k, d: w.d, m: w.m }, coolUntil: a.coolUntil, tgtAt: a.tgtAt,
    phases: a.phases.map(p => ({ e0: p.e0, start: p.start, end: p.end, days: p.days, ret: p.ret })), end, demoAt: a.demoAt ?? null
  };
}
function chValidSum(x) {
  if (!chObj(x) || typeof x.id !== 'string' || !/^A\d{1,12}$/.test(x.id) || !CH_STATUS.includes(x.status) || x.status === 'active') return null;
  if (!(chHas(CH_PRESETS, x.pid) || x.pid === 'custom') || !chInt(x.pv, 0, 1e6) || !chInt(x.phase, 0, 2) || !chInt(x.days, 0, 1e5)) return null;
  if (![x.start, x.end].every(v => chNum(v, 0, 1e11)) || !chNum(x.ret, ...CH_RET) || !(x.why == null || CH_WHY.includes(x.why))) return null;
  const label = chHas(CH_PRESETS, x.pid) ? CH_PRESETS[x.pid].label : typeof x.label === 'string' ? x.label.slice(0, 40) : 'Custom';
  return { id: x.id, pid: x.pid, pv: x.pv, label, start: x.start, end: x.end, status: x.status, phase: x.phase, why: x.why ?? null, days: x.days, ret: x.ret };
}
// S.chal from outside, cleaned; null when it is not version 1 or not an object. Never throws.
function sanitizeChal(raw) {
  try {
    if (!chObj(raw) || raw.v !== CH_VER) return null;
    const custom = chObj(raw.custom) && raw.custom.id === 'custom' ? chValidRules(raw.custom) : null;
    const sel = chHas(CH_PRESETS, raw.sel) ? raw.sel : raw.sel === 'custom' && custom ? 'custom' : '2s-static';
    const o = chObj(raw.opt) ? raw.opt : {};
    return {
      v: CH_VER, custom, sel, opt: { risk: CH_RISKS.includes(o.risk) ? o.risk : 'asis', horizon: CH_HOR.includes(o.horizon) ? o.horizon : 60 },
      att: chValidAtt(raw.att), log: Array.isArray(raw.log) ? raw.log.map(chValidSum).filter(Boolean).slice(0, 20) : []
    };
  } catch (e) { return null; }
}
// every outside state passes through sanitizeState (app.js): S.chal and the MAE/MFE/risk fields are checked there too
if (typeof sanitizeState === 'function') {
  const _chSan = sanitizeState;
  sanitizeState = function () {
    const o = _chSan.apply(this, arguments);
    if (o) {
      if ('chal' in o) { const c = sanitizeChal(o.chal); if (c) o.chal = c; else delete o.chal; }
      const fin = v => typeof v === 'number' && Number.isFinite(v);
      for (const p of o.positions || []) { p.mae = fin(p.mae) && p.mae <= 0 ? p.mae : 0; p.mfe = fin(p.mfe) && p.mfe >= 0 ? p.mfe : 0; }
      for (const h of o.history || []) { h.mae = fin(h.mae) && h.mae <= 0 ? h.mae : null; h.mfe = fin(h.mfe) && h.mfe >= 0 ? h.mfe : null; h.riskUsd = fin(h.riskUsd) && h.riskUsd > 0 ? h.riskUsd : null; }
    }
    return o;
  };
}

/* ============ pure rule engine ============ */
// the trading day containing sim second t, in reset.tz, with the day starting at reset.hour (DST-safe: compares keys)
function chFmt(tz) {
  if (CH.fmt[tz]) return CH.fmt[tz];
  try { CH.fmt[tz] = new Intl.DateTimeFormat('en-CA', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
  catch (e) { CH.tzBad = tz; CH.fmt[tz] = chFmt('UTC'); }
  return CH.fmt[tz];
}
function chLocal(t, tz) {
  const p = {}; for (const x of chFmt(tz).formatToParts(new Date(t * 1000))) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
}
function chDayKey(t, reset) {
  const tz = reset && CH_TZ.includes(reset.tz) ? reset.tz : 'UTC', hour = reset && chInt(reset.hour, 0, 23) ? reset.hour : 0, L = chLocal(t, tz);
  return new Date(Date.UTC(L.y, L.mo - 1, L.d, L.h) - hour * 3600e3).toISOString().slice(0, 10);
}
// seconds from t to the next day reset (resets fall on whole local hours in every CH_TZ zone)
function chNextReset(t, reset) {
  const k = chDayKey(t, reset); let x = Math.ceil((t + 1) / 3600) * 3600;
  for (let i = 0; i < 30 && chDayKey(x, reset) === k; i++) x += 3600;
  return x - t;
}
// cap: the capital the percentages apply to (the initial capital; e0 in the normalised Monte Carlo)
const chMaxFloor = (mx, e0, hw, cap = e0) => { const amt = mx.pct / 100 * cap; if (mx.mode === 'static') return e0 - amt; const f = hw - amt; return mx.lock ? Math.min(f, e0) : f; };
/* Every phase is a fresh account of the initial capital (decision 28, as FTMO / FundedNext): phase 2 starts at the
   balance phase 1 ended with (att.e0), but its target and limits are percentages of the initial capital (att.b0) and
   phase 1 profit does not count toward it. Seen from the rules, the account is shifted by e0 − b0. */
const chCap = att => att.phase > 0 && att.b0 > 0 ? att.b0 : att.e0;
// daily and max floors for an attempt at equity eq ($); used fractions of each room, clipped at 0 from below
function chFloors(att, eq) {
  const R = att.rules, d = att.day, e0 = att.e0, cap = chCap(att);
  let anchor = null, dailyAmt = Infinity, dailyFloor = -Infinity, dailyUsed = 0;
  if (R.daily) {
    anchor = R.daily.anchor === 'balance' ? d.bal0 : Math.max(d.bal0, d.eq0);
    dailyAmt = R.daily.pct / 100 * (R.daily.base === 'initial' ? cap : anchor - (e0 - cap));
    dailyFloor = anchor - dailyAmt; dailyUsed = Math.max(0, (anchor - eq) / dailyAmt);
  }
  const maxAmt = R.max.pct / 100 * cap, maxFloor = chMaxFloor(R.max, e0, att.hw, cap), maxUsed = Math.max(0, (maxFloor + maxAmt - eq) / maxAmt);
  const floor = Math.max(dailyFloor, maxFloor), which = dailyFloor >= maxFloor ? 'daily' : 'max';
  return { anchor, dailyAmt, dailyFloor, dailyUsed, maxAmt, maxFloor, maxUsed, floor, which, room: eq - floor };
}
// finished days of the phase plus today when it has fills, newest first
const chPhaseDays = (att, bal) => (att.day.n > 0 ? [{ k: att.day.k, pnl: bal - att.day.bal0, n: att.day.n }] : []).concat(att.days);
const chPl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
// is the current phase complete? pending = the conditions still missing (none of them is a breach)
function chPhaseDone(att, bal, flat) {
  const R = att.rules, days = chPhaseDays(att, bal), n = days.length, e0 = att.e0, cap = chCap(att), target = R.phases[att.phase].target;
  const tgtOk = bal >= e0 + target / 100 * cap, profit = bal - e0, best = days.reduce((m, d) => Math.max(m, d.pnl), 0);
  const pDays = R.profitDays ? days.filter(d => d.pnl >= R.profitDays.minPct / 100 * cap).length : 0, needPDays = R.profitDays ? R.profitDays.n : 0;
  const consOk = !R.consistency || (profit > 0 && best <= R.consistency / 100 * profit);
  const pending = [];
  if (n < R.minDays) pending.push(`${chPl(R.minDays - n, 'more trading day')}`);
  if (pDays < needPDays) pending.push(`${chPl(needPDays - pDays, 'more profitable day')}`);
  if (R.consistency && !consOk && profit > 0) pending.push(`best day is ${Math.round(best / profit * 100)}% of profit (limit ${R.consistency}%)`);
  if (!flat) pending.push('close your open positions');
  return { done: tgtOk && !pending.length, tgtOk, pending, days: n, pDays, needPDays, best, profit, consOk };
}

/* ============ state ============ */
function chCfg() {
  if (!S.chal || S.chal.v !== CH_VER) S.chal = { v: CH_VER, custom: null, sel: '2s-static', opt: { risk: 'asis', horizon: 60 }, att: null, log: [] };
  return S.chal;
}
const chClone = v => v == null ? v : JSON.parse(JSON.stringify(v));
function chRules(id) { if (chHas(CH_PRESETS, id)) return chClone(CH_PRESETS[id]); if (id === 'custom' && S.chal && S.chal.custom) return chClone(S.chal.custom); return null; }
const chActive = () => !!(S && S.chal && S.chal.att && S.chal.att.status === 'active');
function chEmit(type, att, extra = {}) {
  try { window.dispatchEvent(new CustomEvent('mfx:chal', { detail: { type, att: typeof structuredClone === 'function' ? structuredClone(att) : chClone(att), ...extra } })); } catch (e) { }
}
function chCanStart() {
  if (chActive()) return { ok: false, why: 'An attempt is already running.' };
  const np = S.positions.length, no = S.orders.length;
  if (np) return { ok: false, why: `Close your ${chPl(np, 'open position')} to start — an attempt starts flat.`, btn: `Close your ${chPl(np, 'open position')} to start` };
  if (no) return { ok: false, why: `Cancel your ${chPl(no, 'pending order')} to start.`, btn: `Cancel your ${chPl(no, 'pending order')} to start` };
  if (!(S.balance > 0)) return { ok: false, why: 'The balance is zero: reset the account in Help to start.' };
  return { ok: true };
}
// a read-only tab shows another tab's account: an attempt started, stopped or re-ruled here would not be kept
const CH_RO_TITLE = 'Read-only: this account is open in another tab — Take over here to change it';
const chRO = () => typeof store === 'object' && !!store && typeof store.readOnly === 'function' && !!store.readOnly();
const CH_RO_WHY = 'Read-only tab: this account is open in another tab. Use “Take over here” to change it in this tab.';
const chRoRefuse = () => { toast('Not changed — read-only tab', 'The challenge belongs to the account open in another tab. Use “Take over here” to change it in this tab.', 'dn'); };
// a control that changes the attempt: disabled (and labelled) in a read-only tab; data-ro-title lets persist.js re-enable it on take-over
const chRoAttr = (off = false) => chRO() ? ` disabled data-ro-title="" title="${CH_RO_TITLE}"` : off ? ' disabled' : '';
// the live account: the challenge choices (rules chosen, custom rules, sampling options) are the server's too
function chCfgSend() { if (!TradeLink.live) return; const c = chCfg(); TradeLink.send('settings', { chal: { do: 'cfg', sel: c.sel, opt: c.opt, custom: c.custom } }).then(r => { if (!r.ok) toast('Challenge settings not saved', r.text || 'Refused by the execution server', 'dn'); }); }
/* what the execution server reports about the attempt without a text of its own (notice {kind: 'chal', what}): the toast
   today's chTick shows for the same event, from the attempt as the server holds it (S.chal, the gw 'chal' state) */
function chNotice(m) {
  setTimeout(() => safe('challenge', () => {
    const att = S.chal && S.chal.att; if (!att) return;
    const R = att.rules;
    if (m.what === 'warn') {
      const lv = m.level, rule = m.rule, room = typeof m.room === 'number' ? m.room : 0;
      if (rule === 'daily' && lv === 80) { const cool = typeof tiltCfg === 'function' ? tiltCfg().cool : 15; toast(`Challenge: 80% of today's loss limit used`, `Room left ${usdFmt(room)}. For ${cool} min every new trade gets a pre-mortem.`, 'dn'); beep('alert'); }
      else toast(`Challenge: ${lv}% of the ${rule === 'daily' ? 'daily' : 'max'} loss room used`, `Room left ${usdFmt(room)} before the ${chWhyName(rule)}.`, lv === 80 ? 'dn' : 'info');
    } else if (m.what === 'target') {
      const pd = chPhaseDone(att, S.balance, !S.positions.length);
      toast('Target reached', pd.pending.length ? `Still needed: ${pd.pending.join(' · ')}. Limits still apply.` : 'Phase complete.', 'up');
    } else if (m.what === 'phase') {
      const ph = m.phase ?? att.phase, last = att.phases[att.phases.length - 1], tg = R.phases[ph] ? R.phases[ph].target : 0;
      toast(`Phase ${ph} passed in ${chPl(last ? last.days : 0, 'trading day')}`, `Phase ${ph + 1} starts now as a fresh account of the initial capital (${usdFmt(att.b0)}): your phase ${ph} profit does not count toward it. Target +${tg}% (${usdFmt(tg / 100 * att.b0)}), same limits.`, 'up');
    } else if (m.what === 'pass') toast('All phases passed', 'A pass shows your risk control held on this path. It is not evidence of an edge.', 'info');
    if (typeof renderChal === 'function' && activeTab === 'chal') renderChal();
  }), 150); // the attempt's new state comes in the gw event next to the notice
}
function chStart(id) {
  if (chRO()) return { ok: false, why: CH_RO_WHY, ro: true };
  const c = chCfg(), can = chCanStart(); if (!can.ok) return { ok: false, why: can.why };
  const rules = chRules(id); if (!rules) return { ok: false, why: 'Unknown rules.' };
  // the live account: the execution server runs the attempt (Task 9); it arrives as the gw 'chal' state
  if (TradeLink.live) { TradeLink.send('settings', { chal: { do: 'start', id, rules } }).then(r => { if (!r.ok) toast('Challenge not started', r.text || 'Refused by the execution server', 'dn'); }); return { ok: true, sent: true, att: { rules } }; }
  const t = Engine.simTime, bal = S.balance, k = chDayKey(t, rules.reset);
  const att = {
    id: 'A' + Math.round(t), rules, status: 'active', phase: 0, start: t, e0: bal, ph0: t, hw: bal, b0: bal,
    day: { k, bal0: bal, eq0: bal, n: 0, low: bal }, days: [], warn: { k, d: 0, m: 0 }, coolUntil: 0, tgtAt: 0, phases: [], end: null,
    demoAt: S.demo ? S.demo.at : null
  };
  c.att = att; c.sel = id;
  if (Engine.speed > CH_SPEED_CAP) setSpeed(CH_SPEED_CAP);
  chEmit('start', att); save();
  return { ok: true, att };
}
function chSummary(att) {
  const daysAll = att.phases.reduce((s, p) => s + p.days, 0) + (att.status === 'passed' ? 0 : chPhaseDays(att, S.balance).length);
  return { id: att.id, pid: att.rules.id, pv: att.rules.pv, label: att.rules.label, start: att.start, end: att.end ? att.end.t : Engine.simTime, status: att.status, phase: att.phase, why: att.end ? att.end.why : null, days: daysAll, ret: (S.balance / att.b0 - 1) * 100 };
}
function chFinish(att, status, why, eq, floor) {
  att.status = status; att.end = { t: Engine.simTime, why, eq, floor, closed: 0 };
  const c = chCfg(); c.log.unshift(chSummary(att)); if (c.log.length > 20) c.log.length = 20;
}
// the user stops the attempt (the panel asks first)
function chStop() {
  if (!chActive() || chRO()) return false;
  if (TradeLink.live) { TradeLink.send('settings', { chal: { do: 'stop' } }).then(r => { if (!r.ok) toast('Challenge not stopped', r.text || 'Refused by the execution server', 'dn'); }); return true; }
  const att = S.chal.att; chFinish(att, 'stopped', 'user', account().eq, null);
  chEmit('stop', att); save(); return true;
}
// the account was replaced (demo loaded or cleared): the attempt no longer describes this account
function chVoid() {
  if (!chActive()) return false;
  const att = S.chal.att; chFinish(att, 'void', 'account', account().eq, null);
  chEmit('void', att); save(); return true;
}
const chWhyName = w => w === 'daily' ? 'daily loss limit' : 'max loss limit';
const chHM = (t, tz) => { const L = chLocal(t, tz); return `${String(L.h).padStart(2, '0')}:${String(L.mi).padStart(2, '0')}`; };
function chRoll(att, k, eq, bal) {
  const R = att.rules;
  if (att.day.n > 0) { att.days.unshift({ k: att.day.k, pnl: bal - att.day.bal0, n: att.day.n }); if (att.days.length > 400) att.days.length = 400; }
  if (R.max.mode === 'eod') att.hw = Math.max(att.hw, R.max.trailOn === 'equity' ? eq : bal);
  att.day = { k, bal0: bal, eq0: eq, n: 0, low: eq }; att.warn = { k, d: 0, m: 0 };
}
/* Live evaluation: once per loop step, right after checkTriggers (stops, targets and margin stop-outs of the step
   are already processed). MAE/MFE are tracked on every position, attempt or not, so the Monte Carlo has
   intra-trade drawdowns. */
/* The breach stop-out closes what can be closed: a position whose market is closed (session over, weekend, off
   quotes) cannot fill, so it stays in att.end.wait and closes at the first check after its market opens, at that
   quote (a gap counts against or for it like any other fill). The fills are never requoted (as the margin stop-out). */
function chFlatten(att) {
  const e = att.end; if (!e || !Array.isArray(e.wait) || !e.wait.length) return 0;
  let k = 0;
  for (const id of e.wait.slice()) {
    const p = S.positions.find(x => x.id === id);
    if (p && M(p.sym) && marketOpen(p.sym)) {
      closeVia(p.id, 'Stop-out (challenge breach)', 1, { exec: execFill({ sym: p.sym, side: p.side === 'buy' ? 'sell' : 'buy', kind: 'market', dev: false }), refKind: 'quote at the challenge breach' });
      if (S.positions.includes(p)) continue;
      k++;
    }
    // closed now, or closed meanwhile by the user, a stop or the margin stop-out
    if (!p || !S.positions.includes(p)) e.wait.splice(e.wait.indexOf(id), 1);
  }
  e.closed = (e.closed || 0) + k;
  // the log entry is the attempt's summary: its return is the balance after the stop-out
  const c = chCfg(); if (c.log[0] && c.log[0].id === att.id) c.log[0] = chSummary(att);
  return k;
}
function chTick() {
  // the live account's attempt is evaluated on the execution server (Task 9: rules, MAE/MFE, breach flatten)
  if (TradeLink.live) return;
  // while a replay is open (or this is the replay document) the main account is frozen: nothing to track
  if (typeof RP !== 'undefined' && (RP.role === 'child' || (RP.role === 'host' && RP.state !== 'idle' && RP.state !== 'error'))) return;
  for (const p of S.positions) { const pl = posPnl(p).pnl; p.mae = Math.min(p.mae || 0, pl); p.mfe = Math.max(p.mfe || 0, pl); }
  { const a = S.chal && S.chal.att; if (a && a.status === 'breached' && a.end && a.end.wait && a.end.wait.length) {
    const before = a.end.wait.length, k = chFlatten(a);
    if (k) toast('Challenge stop-out completed', `${chPl(k, 'position')} closed at the market open after the breach.`, 'info');
    if (k || a.end.wait.length !== before) { save(); if (typeof activeTab !== 'undefined' && activeTab === 'chal') renderChal(); }
  } }
  if (!chActive()) return;
  const att = S.chal.att, R = att.rules;
  if ((S.demo ? S.demo.at : null) !== (att.demoAt ?? null)) { chVoid(); return; }
  const eq = account().eq, bal = S.balance, t = Engine.simTime, k = chDayKey(t, R.reset);
  if (k !== att.day.k) chRoll(att, k, eq, bal);
  if (R.max.mode === 'intraday') att.hw = Math.max(att.hw, R.max.trailOn === 'equity' ? eq : bal);
  att.day.low = Math.min(att.day.low, eq);
  const f = chFloors(att, eq);
  // touching a floor is a breach; both in one step: the higher floor was reached first
  const hitD = eq <= f.dailyFloor, hitM = eq <= f.maxFloor;
  if (hitD || hitM) {
    const why = hitD && (!hitM || f.dailyFloor >= f.maxFloor) ? 'daily' : 'max', floor = why === 'daily' ? f.dailyFloor : f.maxFloor;
    const dayNo = chPhaseDays(att, bal).length || 1;
    chFinish(att, 'breached', why, eq, floor); att.end.day = dayNo; att.end.wait = S.positions.map(p => p.id);
    // the status changes first, so the close wrappers no longer count fills for this attempt
    chFlatten(att);
    const left = S.positions.filter(p => att.end.wait.includes(p.id)), n = att.end.closed;
    const wt = left.length ? ` ${chPl(left.length, 'position')} on a closed market (${[...new Set(left.map(p => M(p.sym).short))].join(', ')}) ${left.length === 1 ? 'closes' : 'close'} at its next open.` : '';
    toast(`Challenge breached — ${chWhyName(why)}`, `Equity ${usdFmt(eq)} reached the floor ${usdFmt(floor)}.${n ? ` ${chPl(n, 'open position')} closed.` : ''}${wt} The attempt is over.`, 'dn');
    beep('loss'); chEmit('breach', att); save();
    if (typeof activeTab !== 'undefined' && activeTab === 'chal') renderChal();
    return;
  }
  // warnings at 50% and 80% of each room, once per day and rule; 80% of the daily room starts a cool-down
  for (const [rule, used, key] of [['daily', f.dailyUsed, 'd'], ['max', f.maxUsed, 'm']]) {
    if (rule === 'daily' && !R.daily) continue;
    const lv = used >= .8 ? 80 : used >= .5 ? 50 : 0;
    if (lv > att.warn[key]) {
      att.warn[key] = lv;
      if (rule === 'daily' && lv === 80) {
        const cool = typeof tiltCfg === 'function' ? tiltCfg().cool : 15; att.coolUntil = t + cool * 60;
        toast(`Challenge: 80% of today's loss limit used`, `Room left ${usdFmt(f.room)}. For ${cool} min every new trade gets a pre-mortem.`, 'dn'); beep('alert');
      } else toast(`Challenge: ${lv}% of the ${rule === 'daily' ? "daily" : 'max'} loss room used`, `Room left ${usdFmt(f.room)} before the ${chWhyName(rule)}.`, lv === 80 ? 'dn' : 'info');
      chEmit('warn', att, { rule, level: lv }); save();
    }
  }
  // target on closed balance with the account flat
  const pd = chPhaseDone(att, bal, !S.positions.length);
  if (pd.tgtOk && !att.tgtAt) { att.tgtAt = t; toast('Target reached', pd.pending.length ? `Still needed: ${pd.pending.join(' · ')}. Limits still apply.` : 'Phase complete.', 'up'); save(); }
  if (pd.done) {
    att.phases.push({ e0: att.e0, start: att.ph0, end: t, days: pd.days, ret: (bal - att.e0) / chCap(att) * 100 });
    if (att.phase < R.phases.length - 1) {
      att.phase++; att.e0 = att.hw = bal; att.ph0 = t; att.days = []; att.day = { k, bal0: bal, eq0: eq, n: 0, low: eq }; att.warn = { k, d: 0, m: 0 }; att.tgtAt = 0; att.coolUntil = 0;
      const tg = R.phases[att.phase].target;
      toast(`Phase ${att.phase} passed in ${chPl(pd.days, 'trading day')}`, `Phase ${att.phase + 1} starts now as a fresh account of the initial capital (${usdFmt(att.b0)}): your phase ${att.phase} profit does not count toward it. Target +${tg}% (${usdFmt(tg / 100 * att.b0)}), same limits.`, 'up');
      chEmit('phase', att);
    } else {
      chFinish(att, 'passed', 'target', eq, null);
      toast('All phases passed', 'A pass shows your risk control held on this path. It is not evidence of an edge.', 'info');
      chEmit('pass', att);
    }
    save();
    if (typeof activeTab !== 'undefined' && activeTab === 'chal') renderChal();
  }
}
// snapshot for the panel, the pill, the ticket strip and tests
function chLive() {
  const c = S.chal, att = c && c.att;
  if (!att || att.status !== 'active') return { active: false, stepSec: .25 * Engine.speed };
  const R = att.rules, eq = account().eq, bal = S.balance, f = chFloors(att, eq), pd = chPhaseDone(att, bal, !S.positions.length);
  const target = R.phases[att.phase].target / 100 * chCap(att);
  return {
    active: true, phase: att.phase, nPhases: R.phases.length, eq, bal, e0: att.e0, hw: att.hw, anchor: f.anchor,
    dailyFloor: f.dailyFloor, dailyAmt: f.dailyAmt, dailyUsed: f.dailyUsed, maxFloor: f.maxFloor, maxAmt: f.maxAmt, maxUsed: f.maxUsed,
    room: f.room, which: f.which, target, toTarget: Math.max(0, target - (bal - att.e0)), days: pd.days, minDays: R.minDays, pDays: pd.pDays, needPDays: pd.needPDays,
    best: pd.best, profit: pd.profit, consOk: pd.consOk, tgtOk: pd.tgtOk, pending: pd.pending,
    level: Math.max(f.dailyUsed, f.maxUsed) >= .5 ? 'warn' : 'ok', stepSec: .25 * Engine.speed, cooling: Engine.simTime < att.coolUntil
  };
}

/* ============ order-entry integration ============ */
// the order that would breach at its stop is blocked (Victor's call, §9 Q7 → B); the text is written on the ticket
function chRoomFor() { const att = S.chal.att, f = chFloors(att, account().eq); return f; }
/* What is already at risk if every stop is hit: open positions from the current price to their stop (a stop in profit
   counts 0), pending orders from their price to their stop. Without a stop a position or order is not counted (the
   pre-mortem flags it). src: the order being filled now, left out with its OCO peers (they leave the book on the fill). */
function chOpenRisk(src) {
  let r = 0;
  for (const p of S.positions) {
    if (p.sl == null) continue;
    const m = M(p.sym), d = p.side === 'buy' ? 1 : -1, x = posPnl(p).exit;
    r += Math.max(0, (x - p.sl) * d / m.pip * pipValue(p.sym, 1) * p.lots);
  }
  const so = src != null ? S.orders.find(o => o.id === src) : null;
  for (const o of S.orders) {
    if (so && (o === so || (so.oca && o.oca === so.oca))) continue;
    const k = typeof pmRisk === 'function' ? pmRisk(o) : null; if (k && k.risk != null) r += k.risk;
  }
  return r;
}
function chOrderBlock(o) {
  if (!chActive() || !o || o.basket) return null;
  const r = typeof pmRisk === 'function' ? pmRisk(o) : null; if (!r || r.risk == null) return null;
  const f = chRoomFor(), other = chOpenRisk(o.src);
  if (r.risk + other < f.room) return null;
  return other > 0 ? `Challenge: a stop-out here would breach the ${f.which} limit — ${usdFmt(r.risk)} at risk on this order plus ${usdFmt(other)} on open positions and pending orders, ${usdFmt(f.room)} of room left.`
    : `Challenge: a stop-out here would breach the ${f.which} limit — ${usdFmt(r.risk)} at risk, ${usdFmt(f.room)} of room left.`;
}
// pre-mortem flag (behav.js pmFlags/pmNeeded): no stop, half the room or more at risk, or the 80% cool-down
function chFlag(o, r) {
  if (!chActive() || !o || o.basket) return null;
  const att = S.chal.att, t = Engine.simTime, f = chRoomFor();
  if (t < att.coolUntil) return ['chal', `Challenge cool-down: ${typeof bhClock === 'function' ? bhClock(att.coolUntil - t) : Math.ceil((att.coolUntil - t) / 60) + ' min'} left after using 80% of today's loss limit`];
  if (!r || r.risk == null) return ['chal', 'No stop loss during a challenge attempt — one trade can breach it'];
  if (r.risk >= .5 * f.room) return ['chal', `Risks ${Math.round(r.risk / f.room * 100)}% of the challenge room left (${usdFmt(r.risk)} of ${usdFmt(f.room)})`];
  return null;
}
if (typeof tkBlocks === 'function') {
  const _chBlocks = tkBlocks;
  tkBlocks = function (k) {
    const b = _chBlocks.apply(this, arguments);
    if (!b.length && chActive() && k && k.riskUsd != null) {
      const f = chRoomFor(), other = chOpenRisk();
      if (k.riskUsd + other >= f.room) b.push({ btn: `Would breach the challenge ${f.which} limit at the stop`, why: `Challenge: a stop-out here breaches the ${f.which} limit (risk ${usdFmt(k.riskUsd)}${other > 0 ? ` plus ${usdFmt(other)} on open positions and pending orders` : ''}, room ${usdFmt(f.room)}).` });
    }
    return b;
  };
}
if (typeof tkWarnings === 'function') {
  const _chWarn = tkWarnings;
  tkWarnings = function (k) {
    const w = _chWarn.apply(this, arguments);
    if (chActive() && k) {
      const f = chRoomFor(), add = x => { WARN_LV.set(x, 'risk'); w.unshift(x); };
      if (k.riskUsd == null) add('Challenge: no stop loss — one trade can breach the attempt.');
      else if (k.riskUsd < f.room && k.riskUsd >= .5 * f.room) add(`Challenge: this trade risks ${Math.round(k.riskUsd / f.room * 100)}% of the room left before the ${f.which} limit.`);
    }
    return w;
  };
}
// fills count trading days; closes copy MAE/MFE and the risk of the closed part onto the history row
if (typeof openPosition === 'function') {
  const _chOpen = openPosition;
  // live: MAE/MFE, trading days and the breach flatten are the execution server's (Task 9); nothing is counted here
  openPosition = function (o) { const p = _chOpen.apply(this, arguments); if (p instanceof Promise) return p; if (p) { if (netNew()) { p.mae = 0; p.mfe = 0; } if (chActive()) S.chal.att.day.n++; } return p; };
}
if (typeof closePosition === 'function') {
  const _chClose = closePosition;
  closePosition = function (id) {
    if (TradeLink.live) return _chClose.apply(this, arguments);
    const p = S.positions.find(x => x.id === id), was = p ? { mae: p.mae || 0, mfe: p.mfe || 0, risk: p.risk, lots: p.lots } : null, h0 = S.history[0];
    const r = _chClose.apply(this, arguments), h = S.history[0];
    if (was && h && h !== h0 && h.id === id) {
      const k = h.lots / was.lots;
      h.mae = Math.min(0, was.mae * k, h.pnl); h.mfe = Math.max(0, was.mfe * k, h.pnl); h.riskUsd = was.risk > 0 ? was.risk * k : null;
      if (p && S.positions.includes(p)) { p.mae *= 1 - k; p.mfe *= 1 - k; }
      if (chActive()) S.chal.att.day.n++;
    }
    return r;
  };
}
if (typeof checkTriggers === 'function') {
  const _chTrig = checkTriggers;
  checkTriggers = function () { const r = _chTrig.apply(this, arguments); safe('challenge rules', chTick); return r; };
}
// speed cap: at 300× there are 75 simulated seconds between two checks, and a breach in between would be missed
if (typeof setSpeed === 'function') {
  const _chSpeed = setSpeed;
  setSpeed = function (v) {
    if (v > CH_SPEED_CAP && chActive()) { v = CH_SPEED_CAP; toast(`Speed capped at ${CH_SPEED_CAP}× during a challenge attempt`, 'Rules are checked every 250 ms; at 300× that is 75 market seconds between checks, and a breach in between would be missed.', 'info'); }
    return _chSpeed.call(this, v);
  };
}
if (typeof setTab === 'function') {
  const _chTab = setTab;
  setTab = function (name) { const r = _chTab.apply(this, arguments); if (name === 'chal') safe('challenge', renderChal); return r; };
}

/* ============ Monte Carlo sample (§3.5) ============ */
function chSample(rules, opt) {
  opt = opt || chCfg().opt;
  const risk = opt.risk, ex = { demo: 0, noR: 0, clip: 0 }, tr = [];
  // balance before each trade: walk back from today's balance through every row (the NBP credit moved it too)
  let B = S.balance;
  for (const h of S.history) {
    // net of commission (shared.js netPnl); the commission was paid at the open, so it also deepens the drawdown
    const net = netPnl(h), cm = +h.comm || 0, Bb = B - net; B = Bb;
    if (h.nbp) continue;
    if (S.demo && !(h.open >= S.demo.at)) { ex.demo++; continue; }
    if (!(Bb > 0)) { ex.clip++; continue; }
    const fin = Number.isFinite, maeU = (fin(h.mae) ? h.mae : Math.min(0, h.pnl)) - cm, mfeU = (fin(h.mfe) ? h.mfe : Math.max(0, h.pnl)) - cm;
    let k;
    if (risk === 'asis') k = 1 / Bb;
    else { const ru = h.riskUsd > 0 ? h.riskUsd : h.r ? Math.abs(h.pnl / h.r) : null; if (!(ru > 0)) { ex.noR++; continue; } k = risk / 100 / ru; }
    let ret = net * k; if (ret < -.999) { ret = -.999; ex.clip++; }
    tr.push({ h, B: Bb, ret, mae: Math.max(-.999, Math.min(0, maeU * k, ret)), mfe: Math.max(0, mfeU * k, ret), noMae: !fin(h.mae) });
  }
  tr.sort((a, b) => a.h.close - b.h.close);
  const n = tr.length, mu = n ? tr.reduce((s, x) => s + x.ret, 0) / n : 0, byDay = new Map();
  for (const x of tr) {
    x.ret0 = x.ret - mu; x.mae0 = Math.min(x.mae, x.ret0, 0); x.mfe0 = Math.max(x.mfe, x.ret0, 0);
    const k = chDayKey(x.h.close, rules.reset); if (!byDay.has(k)) byDay.set(k, []); byDay.get(k).push(x);
  }
  const days = [...byDay].map(([k, a]) => ({ k, tr: a.map(x => ({ ret: x.ret, mae: x.mae, mfe: x.mfe })), tr0: a.map(x => ({ ret: x.ret0, mae: x.mae0, mfe: x.mfe0 })) }));
  const sum = tr.reduce((s, x) => s + x.ret, 0);
  return {
    ok: n >= CH_MIN_N && days.length >= CH_MIN_DAYS, n, nDays: days.length, days, mu, noMae: tr.filter(x => x.noMae).length, excluded: ex, trades: tr,
    sig: n + ':' + sum.toFixed(8) + ':' + rules.id + rules.pv + ':' + JSON.stringify([rules.phases, rules.daily, rules.max, rules.minDays, rules.profitDays, rules.consistency, rules.reset]) + ':' + risk + ':' + opt.horizon
  };
}
// a sample built directly from day blocks (tests, and anything that already has normalised returns)
function chSampleOf(days, rules, horizon = 60) {
  const all = days.flat(), n = all.length, mu = n ? all.reduce((s, x) => s + x.ret, 0) / n : 0;
  const ds = days.map((a, i) => ({ k: 'd' + i, tr: a.map(x => ({ ret: x.ret, mae: Math.min(0, x.mae ?? Math.min(0, x.ret), x.ret), mfe: Math.max(0, x.mfe ?? Math.max(0, x.ret), x.ret) })) }));
  for (const d of ds) d.tr0 = d.tr.map(x => { const r0 = x.ret - mu; return { ret: r0, mae: Math.min(x.mae, r0, 0), mfe: Math.max(x.mfe, r0, 0) }; });
  return { ok: true, n, nDays: ds.length, days: ds, mu, noMae: 0, excluded: { demo: 0, noR: 0, clip: 0 }, trades: [], sig: 'x:' + n + ':' + all.reduce((s, x) => s + x.ret, 0).toFixed(8) + ':' + rules.id + rules.pv + ':' + horizon };
}

/* ============ Monte Carlo simulation (§3.6) ============ */
const chHash = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
function chRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const CH_RES = ['pass', 'daily', 'max', 'neither'];
/* One simulated attempt on normalised equity (start 1): days drawn from the pool, the account flat at every day
   start, trades in sequence; MFE before MAE inside a trade (the conservative order for a trailing floor).
   Returns [result index, trading days used]. */
function chPath(pool, R, H, rnd) {
  const dl = R.daily, mx = R.max;
  let E = 1, e0 = 1, hw = 1, total = 0;
  for (let ph = 0; ph < R.phases.length; ph++) {
    const tgt = e0 * (1 + R.phases[ph].target / 100);
    let pd = 0, best = 0, done = false;
    for (let d = 1; d <= H && !done; d++) {
      const day = pool[(rnd() * pool.length) | 0], bal0 = E;
      const dF = dl ? bal0 - dl.pct / 100 * (dl.base === 'initial' ? e0 : bal0) : -Infinity;
      for (const tr of day) {
        if (mx.mode === 'intraday' && mx.trailOn === 'equity') hw = Math.max(hw, E * (1 + tr.mfe));
        let mF = chMaxFloor(mx, e0, hw), low = E * (1 + tr.mae);
        if (low <= dF || low <= mF) return [low <= dF && (low > mF || dF >= mF) ? 1 : 2, total + d];
        E *= 1 + tr.ret;
        if (mx.mode === 'intraday') { hw = Math.max(hw, E); mF = chMaxFloor(mx, e0, hw); }
        if (E <= dF || E <= mF) return [E <= dF && (E > mF || dF >= mF) ? 1 : 2, total + d];
      }
      const dp = E - bal0; best = Math.max(best, dp);
      if (R.profitDays && dp >= R.profitDays.minPct / 100 * e0) pd++;
      if (mx.mode === 'eod') hw = Math.max(hw, E);
      if (E >= tgt && d >= R.minDays && pd >= (R.profitDays ? R.profitDays.n : 0) && (!R.consistency || (E - e0 > 0 && best <= R.consistency / 100 * (E - e0)))) {
        total += d;
        if (ph === R.phases.length - 1) return [0, total];
        // the next phase is a fresh account of the initial capital (normalised to 1)
        E = e0 = hw = 1; done = true;
      }
    }
    if (!done) return [3, total + H];
  }
  return [3, total];
}
const chPctl = (a, q) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))] : 0; };
// stepper shared by the sync (tests) and the sliced async version: B outer bootstraps of the day list, P paths each
function chSimRunner(sample, rules, opt, B = 200, P = 100) {
  const seed = chHash(sample.sig), H = opt.horizon || 60, nD = sample.days.length, rnd = chRng(seed);
  const V = { asis: sample.days.map(d => d.tr), zero: sample.days.map(d => d.tr0) };
  const acc = {}; for (const v in V) acc[v] = { n: [0, 0, 0, 0], pb: [], bb: [], db: [], passDays: [] };
  let b = 0; const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
  return {
    get done() { return b >= B; }, get progress() { return b / B; },
    step(k) {
      for (const z = Math.min(B, b + k); b < z; b++) {
        const idx = Array.from({ length: nD }, () => (rnd() * nD) | 0);
        for (const v in V) {
          const pool = idx.map(i => V[v][i]), a = acc[v], c = [0, 0, 0, 0];
          for (let p = 0; p < P; p++) { const [res, days] = chPath(pool, rules, H, rnd); c[res]++; if (res === 0) a.passDays.push(days); }
          for (let i = 0; i < 4; i++) a.n[i] += c[i];
          a.pb.push(c[0] / P); a.bb.push((c[1] + c[2]) / P); a.db.push(c[1] / P);
        }
      }
    },
    result() {
      const out = { B, P, seed, sig: sample.sig, ms: Math.round((typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0) };
      for (const v in V) {
        const a = acc[v], N = B * P, f = a.n.map(x => x / N), pass = f[0];
        out[v] = {
          pass, daily: f[1], max: f[2], breach: f[1] + f[2], neither: f[3],
          ci: { pass: [chPctl(a.pb, .05), chPctl(a.pb, .95)], breach: [chPctl(a.bb, .05), chPctl(a.bb, .95)], daily: [chPctl(a.db, .05), chPctl(a.db, .95)] },
          medDays: a.passDays.length ? chPctl(a.passDays, .5) : null, perPass: pass > 0 ? 1 / pass : Infinity
        };
      }
      return out;
    }
  };
}
function chSimulateSync(sample, rules, opt, B, P) { const r = chSimRunner(sample, rules, opt, B, P); r.step(Infinity); return r.result(); }
// sliced: 10 outer bootstraps per setTimeout(0); a newer run cancels the old one
function chSimulate(sample, rules, opt, onProgress) {
  const token = ++CH.run, r = chSimRunner(sample, rules, opt);
  return new Promise((res, rej) => {
    const go = () => {
      if (token !== CH.run) { rej(new Error('cancelled')); return; }
      try { r.step(10); } catch (e) { rej(e); return; }
      if (r.done) res(r.result()); else { if (onProgress) onProgress(r.progress); setTimeout(go, 0); }
    };
    setTimeout(go, 0);
  });
}

/* ============ discipline checks and verdict (§3.7, §3.8) ============ */
const chP = (x, d = 0) => !Number.isFinite(x) ? '—' : x > 0 && x < .005 ? '<1%' : (x * 100).toFixed(d) + '%';
function chChecks(sample, sim, rules) {
  const T = sample.trades || [], n = T.length, R = rules, out = [];
  const noStop = T.filter(x => !(x.h.sl0 != null || x.h.r != null)).length;
  out.push({ id: 'D1', ok: !n || (n - noStop) / n >= CH_STOP_SHARE, text: `${noStop} of your ${n} trades had no stop loss.` });
  const lim = R.daily ? .5 * R.daily.pct / 100 : .25 * R.max.pct / 100, withR = T.filter(x => x.h.riskUsd > 0), big = withR.filter(x => x.h.riskUsd / x.B > lim).length;
  out.push({ id: 'D2', ok: !withR.length || (withR.length - big) / withR.length >= CH_STOP_SHARE, text: `${big} trades risked more than half of the ${R.daily ? 'daily' : 'max'} limit on their own.` });
  const tilt = T.filter(x => (x.h.ctx || []).some(c => c === 'tilt' || c === 'revenge')).length;
  out.push({ id: 'D3', ok: !n || tilt / n <= CH_TILT_SHARE, text: `${tilt} trades were placed during tilt guard or within 10 min of a loss.` });
  let bad = 0;
  if (R.daily) for (const d of sample.days) { let E = 1, low = 1; for (const x of d.tr) { low = Math.min(low, E * (1 + x.mae)); E *= 1 + x.ret; low = Math.min(low, E); } if (low <= 1 - R.daily.pct / 100) bad++; }
  out.push({ id: 'D4', ok: bad === 0, text: R.daily ? `On ${bad} of your ${sample.nDays} trading days you went past the ${R.daily.pct}% daily limit.` : '' });
  const z = sim && sim.zero;
  out.push({ id: 'D5', ok: !R.daily || !z || z.ci.daily[1] <= CH_DAILY_ODDS, text: z ? `At this sizing, ${chP(z.daily)} of random attempts break the daily limit (90%: ${chP(z.ci.daily[0])}–${chP(z.ci.daily[1])}).` : '' });
  const c = S.chal || { log: [] }, same = [...(c.att ? [chSummary(c.att)] : []), ...c.log].filter(x => x.pid === R.id && x.status !== 'void');
  out.push({ id: 'D6', ok: same.some(x => x.status === 'passed' || (x.status !== 'breached' && x.days >= CH_PRACTICE_DAYS)), text: 'Run a practice attempt on these rules first — none has finished without a breach yet.' });
  return out;
}
const chPerPass = z => z.pass < .01 ? 'fewer than 1 pass in 100 attempts' : `about ${Math.round(1 / z.pass)} paid attempts per pass`;
function chVerdict(sample, sim, checks, opt) {
  if (!sample.ok) {
    const x = opt && opt.risk !== 'asis' && sample.excluded.noR ? `Only ${sample.n} trades have a known stop — need ${CH_MIN_N} for a what-if at ${opt.risk}%.` : null;
    return { level: 'nodata', title: 'No verdict yet', body: x || `Close at least ${CH_MIN_N} trades over ${CH_MIN_DAYS} trading days of your own. Example trades never count.`, reasons: [], progress: `${sample.n} / ${CH_MIN_N} trades · ${sample.nDays} / ${CH_MIN_DAYS} days` };
  }
  const order = ['D5', 'D4', 'D2', 'D1', 'D3', 'D6'], failed = order.map(id => checks.find(c => c.id === id)).filter(c => c && !c.ok);
  if (failed.length) return { level: 'not-ready', title: "Not ready — don't buy a challenge yet.", body: 'Each of these is in your control. Fix them in practice first; a paid attempt will not be kinder.', reasons: failed.slice(0, 3).map(c => c.text) };
  // the best verdict there is: borderline, with the zero-edge odds and their interval (never "Ready")
  const z = sim.zero;
  return {
    level: 'borderline', title: 'Borderline — practise more before paying for a challenge.', reasons: [],
    body: `Your risk fits these rules; your edge is unproven, so a pass here is discipline plus luck. With zero edge, these rules end in a pass ${chP(z.pass)} of the time (90% interval ${chP(z.ci.pass[0])}–${chP(z.ci.pass[1])}) and a breach ${chP(z.breach)} — ${chPerPass(z)}. A real challenge is a paid bet; decide with that number.`
  };
}

/* ============ panel ============ */
const chE = v => typeof escHtml === 'function' ? escHtml(v) : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const CH_MODE = { static: 'static', eod: 'end-of-day trailing', intraday: 'intraday trailing' };
function chSum(R) {
  return [R.phases.map(p => p.target + '%').join(' → ') + ' target', R.daily ? `${R.daily.pct}% daily` : 'no daily limit', `${R.max.pct}% ${CH_MODE[R.max.mode]}`,
    R.minDays ? chPl(R.minDays, 'day') + ' min' : '', R.profitDays ? `${R.profitDays.n} days ≥ ${R.profitDays.minPct}%` : '', R.consistency ? `best day ≤ ${R.consistency}%` : ''].filter(Boolean).join(' · ');
}
function chExplain(R) {
  const s = [`Profit target: ${R.phases.map((p, i) => `phase ${i + 1} +${p.target}%`).join(', ')} of the initial capital, counted on closed balance with no open positions.`];
  if (R.phases.length > 1) s.push('Each phase is a fresh account of the initial capital: a later phase starts from the balance the previous one ended with, its target and limits are measured on the initial capital, and the earlier profit does not count toward it.');
  if (R.daily) s.push(`Daily loss: equity may not fall ${R.daily.pct}% of ${R.daily.base === 'initial' ? 'the initial capital' : 'the day start'} below ${R.daily.anchor === 'balance' ? 'the balance' : 'the higher of balance and equity'} at the day start.`);
  else s.push('No daily loss limit.');
  s.push(R.max.mode === 'static' ? `Max loss: equity may not fall more than ${R.max.pct}% of the initial capital below the phase start balance.`
    : `Max loss: the floor sits ${R.max.pct}% of the initial capital below your highest ${R.max.trailOn}${R.max.mode === 'eod' ? ' at the end of each day' : ', updated on every check'}${R.max.lock ? ', and stops rising at the phase start balance' : ''}.`);
  if (R.minDays) s.push(`At least ${chPl(R.minDays, 'trading day')} (a day with at least one fill).`);
  if (R.profitDays) s.push(`At least ${chPl(R.profitDays.n, 'day')} with a closed profit of ${R.profitDays.minPct}% or more.`);
  if (R.consistency) s.push(`Consistency: the best day may be at most ${R.consistency}% of the total profit. Not a breach — you keep trading until it holds.`);
  s.push(`The day resets at ${String(R.reset.hour).padStart(2, '0')}:00 ${R.reset.tz}.`);
  return s;
}
const chIcon = '<svg class="es-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5"/></svg>';
// one row of the limits table: Limit | Used (with its bar) | Allowed | Room | Floor | Status. val is the full sentence
// for assistive tech (aria-valuetext) and the row's tooltip; c holds the cells, note an optional line under the row
const CH_COLS = [['used', 'Used'], ['allowed', 'Allowed'], ['room', 'Room'], ['floor', 'Floor']];
function chMeter(name, val, used, st, cls2 = '', c = {}) {
  const pctUsed = Math.max(0, Math.min(100, used * 100)), shape = { OK: '●', Warning: '▲', Breached: '✕', Met: '✓' }[st] || '●';
  const cell = ([k, lab]) => `<span class="ch-c ch-${k} mono" data-l="${lab}">${c[k] != null && c[k] !== '' ? c[k] : '—'}${k === 'used' && used != null ? `<span class="ch-bar" aria-hidden="true"><i style="width:${pctUsed.toFixed(1)}%"></i></span>` : ''}</span>`;
  return `<div class="ch-meter ch-mrow ${cls2}" role="meter" aria-label="${chE(name)}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pctUsed.toFixed(0)}" aria-valuetext="${chE(`${name}: ${val}. ${st}`)}" title="${chE(`${name}: ${val}`)}">
    <span class="ch-c ch-name">${chE(name)}</span>${CH_COLS.map(cell).join('')}<b class="ch-c ch-st ch-${st === 'Breached' ? 'breach' : st === 'Warning' ? 'warn' : 'ok'}"><span aria-hidden="true">${shape}</span> ${chE(st)}</b>${c.note ? `<span class="ch-mnote">${c.note}</span>` : ''}</div>`;
}
const chMHead = () => `<div class="ch-mrow ch-mhead" aria-hidden="true"><span>Limit</span>${CH_COLS.map(([, l]) => `<span>${l}</span>`).join('')}<span>Status</span></div>`;
const chLvSt = u => u >= 1 ? 'Breached' : u >= .5 ? 'Warning' : 'OK';
function chAttHtml() {
  const c = chCfg(), att = c.att, R = chRules(c.sel) || chRules('2s-static'), can = chCanStart();
  const empty = (pre = '') => `${pre}<div class="es ch-es">${chIcon}<b class="es-t">No practice attempt running</b>
    <p class="es-p">Runs on your demo account from its balance at start. Equity is checked on every market update; the daily limit resets at ${String(R.reset.hour).padStart(2, '0')}:00 ${chE(R.reset.tz)}. Nothing is real money.</p>
    <div class="es-act"><button type="button" class="es-b btn-pri" id="chStartB"${chRoAttr(!can.ok)}>${chE(can.ok ? 'Start practice attempt' : can.btn || can.why)}</button>${!can.ok && S.positions.length ? '<button type="button" class="es-b" data-ch="positions">Go to positions</button>' : !can.ok && S.orders.length ? '<button type="button" class="es-b" data-ch="orders">Go to orders</button>' : ''}</div></div>`;
  if (!att) return empty();
  const Ra = att.rules, tz = Ra.reset.tz;
  if (att.status === 'active') {
    const L = chLive(), meters = [];
    const dUsed = Math.max(0, L.anchor - L.eq), mUsed = Math.max(0, L.maxFloor + L.maxAmt - L.eq), trail = Ra.max.mode !== 'static' ? `trails ${Ra.max.mode === 'eod' ? 'end of day' : 'intraday'}, high-water ${usdFmt(att.hw)}` : '';
    if (Ra.daily) meters.push(chMeter('Daily loss', `${usdFmt(dUsed)} of ${usdFmt(L.dailyAmt)} used · floor ${usdFmt(L.dailyFloor)}`, L.dailyUsed, chLvSt(L.dailyUsed), L.dailyUsed >= .5 ? 'ch-mwarn' : '',
      { used: usdFmt(dUsed), allowed: usdFmt(L.dailyAmt), room: usdFmt(L.eq - L.dailyFloor), floor: usdFmt(L.dailyFloor) }));
    meters.push(chMeter('Max loss', `${usdFmt(L.eq - L.maxFloor)} room · floor ${usdFmt(L.maxFloor)}${trail ? ` (${trail})` : ''}`, L.maxUsed, chLvSt(L.maxUsed), L.maxUsed >= .5 ? 'ch-mwarn' : '',
      { used: usdFmt(mUsed), allowed: usdFmt(L.maxAmt), room: usdFmt(L.eq - L.maxFloor), floor: usdFmt(L.maxFloor), note: trail ? `Floor ${chE(trail)}` : '' }));
    const prog = L.target > 0 ? (L.bal - L.e0) / L.target : 0;
    meters.push(chMeter('Profit target', `${usdFmt(L.bal - L.e0, true)} of ${usdFmt(L.target)}`, Math.max(0, prog), prog >= 1 ? 'Met' : 'OK', 'tgt',
      { used: usdFmt(L.bal - L.e0, true), allowed: usdFmt(L.target), room: usdFmt(L.toTarget) }));
    meters.push(chMeter('Trading days', `${L.days} / ${Ra.minDays}`, null, L.days >= Ra.minDays ? 'Met' : `${Ra.minDays - L.days} to go`, '', { used: L.days, allowed: `min ${Ra.minDays}` }));
    if (Ra.profitDays) meters.push(chMeter('Profitable days', `${L.pDays} / ${L.needPDays} (≥ ${Ra.profitDays.minPct}%)`, null, L.pDays >= L.needPDays ? 'Met' : `${L.needPDays - L.pDays} to go`, '', { used: L.pDays, allowed: `${L.needPDays} at ≥ ${Ra.profitDays.minPct}%` }));
    if (Ra.consistency) meters.push(chMeter('Consistency', `Best day ${L.profit > 0 ? Math.round(L.best / L.profit * 100) + '%' : '—'} of profit · limit ${Ra.consistency}%`, null, L.consOk ? 'Met' : 'Not yet — keep trading', '', { used: `best day ${L.profit > 0 ? Math.round(L.best / L.profit * 100) + '%' : '—'}`, allowed: `≤ ${Ra.consistency}% of profit` }));
    // the profit target reads first (hero); the room left before each loss limit is the key figure beside it
    const hero = `<div class="ch-kpis">${kpi('Profit target', `${usdFmt(L.bal - L.e0, true)} <small>of ${usdFmt(L.target)}</small>`, '', '', 'hero')}${Ra.daily ? kpi('Daily room', usdFmt(L.eq - L.dailyFloor), L.dailyUsed >= .5 ? 'wn' : '', '', 'key') : ''}${kpi('Max room', usdFmt(L.eq - L.maxFloor), L.maxUsed >= .5 ? 'wn' : '', '', 'key')}${kpi('Floor', usdFmt(Math.max(L.dailyFloor, L.maxFloor)), '', '', 'sec')}</div>`;
    const nr = chNextReset(Engine.simTime, Ra.reset), fd = s => { const m = Math.round(s / 60); return m < 60 ? m + ' min' : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
    return `<h3 id="chAttH" tabindex="-1">Phase ${att.phase + 1} of ${Ra.phases.length} · Day ${Math.max(1, L.days)} <span class="obs-src ch-src">started ${dts(att.start)}</span></h3>
      ${att.phase > 0 ? `<div class="ch-note">Phase ${att.phase + 1} counts as a fresh ${usdFmt(att.b0)} account: it started at a balance of ${usdFmt(att.e0)}, and the earlier profit does not count toward its target.</div>` : ''}
      ${L.tgtOk ? `<div class="ch-note">Target reached — ${chE(L.pending.join(' · ') || 'completing the phase')}. Limits still apply until the phase is complete.</div>` : ''}
      ${L.cooling ? `<div class="ch-note warn">Cool-down after 80% of today's loss limit: every new trade gets a pre-mortem for ${fd(att.coolUntil - Engine.simTime)}.</div>` : ''}
      ${hero}<div class="ch-meters">${chMHead()}${meters.join('')}</div>
      <p class="muted small">Checked every market update — ${(.25 * Engine.speed).toFixed(Engine.speed < 4 ? 2 : 0)} market seconds apart at ${Engine.speed}×. Day resets at ${String(Ra.reset.hour).padStart(2, '0')}:00 ${chE(tz)}; next reset in ${fd(nr)}.${CH.tzBad ? ` Your browser does not know ${chE(CH.tzBad)}; days reset at 00:00 UTC.` : ''}</p>
      <div class="ch-act"><button type="button" class="ghost sm" id="chStopB"${chRoAttr()}>Stop attempt</button></div>`;
  }
  if (att.status === 'breached') {
    const e = att.end, k = chDayKey(e.t, Ra.reset), day = S.history.filter(h => !h.nbp && h.open >= att.start && chDayKey(h.close, Ra.reset) === k);
    const flagged = day.filter(h => (h.ctx || []).length).length;
    const rows = day.slice(0, 12).map(h => `<li><span>${chE(pretty(h.sym))} <span class="tag ${h.side === 'buy' ? 'buy' : 'sell'}">${chE(h.side)}</span></span><b class="mono ${h.pnl >= 0 ? 'up' : 'dn'}">${usdFmt(h.pnl, true)}</b><span class="muted small">${chE((h.ctx || []).map(x => typeof FLAG_NAMES === 'object' && FLAG_NAMES[x] ? FLAG_NAMES[x] : x).join(' · ') || 'no warnings')}</span></li>`).join('');
    return `<div class="ch-banner breach" role="alert"><b>Breached — ${chWhyName(e.why)}</b>
      <p>Equity ${usdFmt(e.eq)} reached the floor ${usdFmt(e.floor)} at ${chHM(e.t, tz)} ${chE(tz)} on day ${e.day || 1} of phase ${att.phase + 1}.${e.closed ? ` ${chPl(e.closed, 'open position')} ${e.closed === 1 ? 'was' : 'were'} closed (Stop-out, challenge breach).` : ''}${e.wait && e.wait.length ? ` ${chPl(e.wait.length, 'position')} on a closed market ${e.wait.length === 1 ? 'closes' : 'close'} at its next open.` : ''}</p></div>
      <h3>Breach day</h3>${day.length ? `<ul class="ch-day">${rows}</ul><p class="small">${flagged} of ${day.length} trades that day carried warnings.</p>` : '<p class="muted small">No trades closed that day.</p>'}
      <div class="es-act ch-act"><button type="button" class="es-b" data-ch="behav">Review in Behaviour</button><button type="button" class="es-b" id="chNewB"${chRoAttr(!can.ok)}>${chE(can.ok ? 'Start a new attempt' : can.btn || can.why)}</button></div>`;
  }
  if (att.status === 'passed') {
    const tot = att.phases.reduce((s, p) => s + p.days, 0);
    return `<div class="ch-banner pass"><b>All phases passed in ${chPl(tot, 'trading day')}</b>
      <p>A pass shows your risk control held on this path. It is not evidence of an edge.</p>
      <p class="mono small">${att.phases.map((p, i) => `Phase ${i + 1}: ${p.ret >= 0 ? '+' : '−'}${Math.abs(p.ret).toFixed(1)}% in ${chPl(p.days, 'day')}`).join(' · ')}</p></div>
      <div class="es-act ch-act"><button type="button" class="es-b" id="chNewB"${chRoAttr(!can.ok)}>${chE(can.ok ? 'Start a new attempt' : can.btn || can.why)}</button><button type="button" class="es-b" data-ch="ready">See the readiness odds</button></div>`;
  }
  const days = chSummary(att).days;
  return empty(`<p class="muted">${att.status === 'stopped' ? `Attempt stopped by you on day ${Math.max(1, days)}.` : 'Attempt voided: the account was replaced (demo loaded or cleared).'}</p>`);
}
function chLogHtml() {
  const L = chCfg().log;
  const res = x => x.status === 'passed' ? 'Passed' : x.status === 'breached' ? `Breached · ${x.why}` : x.status === 'stopped' ? 'Stopped' : 'Void';
  return `<h3>Attempt log</h3>${L.length ? `<div class="tbl-wrap ch-logt"><table class="tbl"><thead><tr><th>Started</th><th>Rules</th><th>Result</th><th>Phase</th><th>Days</th><th>Return</th></tr></thead><tbody>${L.map(x => `<tr><td class="mono">${dts(x.start)}</td><td>${chE(x.label)}</td><td>${res(x)}</td><td class="mono">${x.phase + 1}</td><td class="mono">${x.days}</td><td class="mono ${x.ret >= 0 ? 'up' : 'dn'}">${x.ret >= 0 ? '+' : '−'}${Math.abs(x.ret).toFixed(2)}%</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted small">Your finished attempts appear here.</p>'}`;
}
const CH_FIXED = 'These odds describe your sizing and rule discipline with no edge assumed, not your chances on a live account.';
function chReadyHtml() {
  const c = chCfg(), R = chRules(c.sel) || chRules('2s-static'), o = c.opt, smp = chSample(R, o), mc = CH.mc && CH.mc.sig === smp.sig ? CH.mc : null;
  const checks = mc ? chChecks(smp, mc, R) : null, v = mc ? chVerdict(smp, mc, checks, o) : !smp.ok ? chVerdict(smp, null, [], o) : null;
  const sel = (id, lab, opts, cur) => `<label class="ch-ctl">${lab}<select id="${id}">${opts.map(([val, t]) => `<option value="${val}"${String(val) === String(cur) ? ' selected' : ''}>${t}</option>`).join('')}</select></label>`;
  const ctl = `<div class="ch-ctls">${sel('chRisk', 'Risk per trade', [['asis', 'As traded'], ['0.25', '0.25%'], ['0.5', '0.5%'], ['1', '1%'], ['2', '2%']], o.risk)}${sel('chHor', 'Horizon', CH_HOR.map(h => [h, h + ' trading days']), o.horizon)}</div>`;
  let vh;
  if (!v) vh = `<div class="ch-verdict" aria-live="polite"><p role="status">${CH.busy != null ? `Running 20,000 random attempts… ${Math.round(CH.busy * 100)}%` : 'Preparing the run…'}</p></div>`;
  else vh = `<div class="ch-verdict lv-${v.level}" aria-live="polite"><b class="ch-vt">${v.level === 'not-ready' ? '<span aria-hidden="true">✕</span> ' : v.level === 'borderline' ? '<span aria-hidden="true">●</span> ' : ''}${chE(v.title)}</b>
    ${v.reasons.length ? `<ul>${v.reasons.map(x => `<li>${chE(x)}</li>`).join('')}</ul>` : ''}<p>${chE(v.body)}</p>${v.progress ? `<p class="mono small">${chE(v.progress)}</p>` : ''}</div>`;
  let nums = '';
  if (mc) {
    const row = (name, z) => `<tr><th scope="row">${name}</th><td class="mono">${chP(z.pass)} <small>90%: ${chP(z.ci.pass[0])}–${chP(z.ci.pass[1])}</small></td><td class="mono">${chP(z.breach)} <small>(${chP(z.daily)} / ${chP(z.max)})</small></td><td class="mono">${chP(z.neither)}</td></tr>`;
    const bar = (name, z) => { const seg = (cl, x, lab) => x > 0 ? `<i class="${cl}" style="width:${(x * 100).toFixed(2)}%">${x >= .08 ? lab + ' ' + chP(x) : ''}</i>` : ''; return `<div class="ch-stack" aria-hidden="true"><span>${name}</span><div>${seg('p', z.pass, 'pass')}${seg('n', z.neither, '')}${seg('d', z.daily, 'daily')}${seg('m', z.max, 'max')}</div></div>`; };
    const z = mc.zero;
    nums = `<table class="tbl ch-tbl"><thead><tr><th>Scenario</th><th>Pass</th><th>Breach (daily / max)</th><th>Neither in ${o.horizon} days</th></tr></thead><tbody>${row('As traded', mc.asis)}${row('With zero edge', z)}</tbody></table>
      ${bar('As traded', mc.asis)}${bar('With zero edge', z)}
      <p class="small">With zero edge: ${chPerPass(z)}${z.medDays != null ? ` · median ${z.medDays} trading days to pass` : ''}.</p>`;
  }
  const ex = smp.excluded, smpTxt = smp.n ? `Based on ${smp.n} of your trades over ${smp.nDays} trading days (demo trades excluded${ex.noR ? `, ${ex.noR} without a stop left out of the what-if` : ''}).` : 'No trades of your own yet.';
  const method = mc ? `<details class="ch-about"><summary>Method</summary><ul class="small">
    <li>Bootstrap on whole trading days (a day keeps its trades together, so revenge clusters stay in), ${mc.B} outer resamples × ${mc.P} attempts each; the interval is the 5th–95th percentile across the outer resamples. Seed ${mc.seed}.</li>
    <li>Trades run one after another (overlaps are not modelled); the account is flat at every day start; days are independent of each other.</li>
    <li>Intra-trade drawdown and run-up (MAE/MFE) come from checks 250 ms apart; the run-up is applied before the drawdown.</li>
    <li>Zero edge: every trade's return shifted by ${(smp.mu * 1e4).toFixed(1)} bp so the average is zero. On this market that row is the relevant one.</li>
    ${ex.clip ? `<li>${ex.clip} trades were clipped at −99.9% of the balance.</li>` : ''}</ul></details>` : '';
  return `<h3 id="chReadyH" tabindex="-1">Readiness</h3>${vh}${ctl}<div class="ch-nums${!mc && smp.ok ? ' stale' : ''}">${nums}</div>
    <p class="small muted">${smpTxt}${smp.noMae ? ` Intra-trade drawdown unknown for ${smp.noMae} older trades — breach odds are understated.` : ''}</p>${method}
    <p class="ch-fixed">${CH_FIXED}</p>`;
}
function chRulesHtml() {
  const c = chCfg(), act = chActive(), R = act ? c.att.rules : chRules(c.sel) || chRules('2s-static'), cur = chHas(CH_PRESETS, R.id) ? CH_PRESETS[R.id] : null;
  const opts = CH_IDS.map(id => `<option value="${id}"${c.sel === id ? ' selected' : ''}>${chE(CH_PRESETS[id].label)}</option>`).join('') + (c.custom ? `<option value="custom"${c.sel === 'custom' ? ' selected' : ''}>Custom: ${chE(c.custom.label)}</option>` : '') + '<option value="+edit">+ Use my firm\'s current rules…</option>';
  const about = CH.edit && !act ? chEditHtml(R) : `<details class="ch-about"><summary>About these rules <span class="muted">(rules as published from ${R.validFrom} · checked ${R.checked})</span></summary>
    <ul class="small">${chExplain(R).map(x => `<li>${chE(x)}</li>`).join('')}${R.notes.map(x => `<li>${chE(x)}</li>`).join('')}</ul>
    <p class="small">Source: ${chE(R.source)}. Rules as published from ${R.validFrom} · checked ${R.checked}. Firms change rules often — check the current page before you pay.${R.url ? ` <a href="${chE(R.url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ''}</p>
    ${act && cur && cur.pv !== R.pv ? `<p class="small">This attempt uses rules v${R.pv}; the current preset is v${cur.pv}.</p>` : ''}
    <p class="small muted">Runs on your demo account from its balance at start. Saved with your account. Export / Import in Help carries it.</p></details>`;
  return `<div class="ch-rh"><h3>Rules</h3><label class="ch-ctl">Preset<select id="chPreset"${act ? ' disabled title="Stop the attempt to change rules"' : chRoAttr()}>${opts}</select></label><span class="ch-sum mono">${chE(chSum(R))}</span></div>${about}`;
}
// custom rules: derived from the selected preset, validated by chValidRules
function chEditHtml(R) {
  const n = (id, lab, v, min, max, step = 'any') => `<label>${lab}<input type="number" id="${id}" value="${v ?? ''}" min="${min}" max="${max}" step="${step}" class="mono"></label>`;
  const s = (id, lab, v, opts) => `<label>${lab}<select id="${id}">${opts.map(([a, b]) => `<option value="${a}"${String(a) === String(v) ? ' selected' : ''}>${b}</option>`).join('')}</select></label>`;
  const err = chEditErr();
  return `<form class="ch-edit" id="chEdit" novalidate><p class="small muted">Copy your firm's current page into these fields. Every value is checked against a sensible range.</p>
    <label>Name<input type="text" id="ceLabel" maxlength="40" value="${chE(R.id === 'custom' ? R.label : 'My firm')}"></label>
    ${n('ceT1', 'Phase 1 target %', R.phases[0].target, .5, 50)}${n('ceT2', 'Phase 2 target % (empty = one phase)', R.phases[1] ? R.phases[1].target : '', .5, 50)}
    ${n('ceDp', 'Daily loss % (empty = none)', R.daily ? R.daily.pct : '', .5, 20)}${s('ceDb', 'Daily measured on', R.daily ? R.daily.base : 'initial', [['initial', 'initial capital'], ['dayStart', 'day start']])}${s('ceDa', 'Daily from', R.daily ? R.daily.anchor : 'balance', [['balance', 'balance at day start'], ['maxBalEq', 'higher of balance and equity']])}
    ${n('ceMp', 'Max loss %', R.max.pct, 1, 30)}${s('ceMm', 'Max loss mode', R.max.mode, [['static', 'static'], ['eod', 'end-of-day trailing'], ['intraday', 'intraday trailing']])}${s('ceMt', 'Trails on', R.max.trailOn, [['balance', 'balance'], ['equity', 'equity']])}${s('ceMl', 'Floor stops at start balance', R.max.lock ? '1' : '0', [['1', 'yes'], ['0', 'no']])}
    ${n('ceMin', 'Min trading days', R.minDays, 0, 60, 1)}${n('cePn', 'Profitable days (empty = none)', R.profitDays ? R.profitDays.n : '', 0, 30, 1)}${n('cePm', 'Profitable day ≥ %', R.profitDays ? R.profitDays.minPct : .5, 0, 5)}
    ${n('ceC', 'Consistency % (empty = none)', R.consistency ?? '', 10, 100)}${s('ceTz', 'Day resets in', R.reset.tz, CH_TZ.map(z => [z, z]))}${n('ceH', 'at hour', R.reset.hour, 0, 23, 1)}
    <div class="ch-act"><button type="submit" class="es-b btn-pri" id="ceSave"${chRoAttr()}>Save rules</button><button type="button" class="es-b" id="ceCancel">Cancel</button></div><p class="small dn" id="ceErr" role="status">${chE(err || '')}</p></form>`;
}
function chEditRead() {
  const v = id => { const e = document.getElementById(id); return e ? e.value.trim() : ''; }, num = id => v(id) === '' ? null : +v(id);
  const t2 = num('ceT2'), dp = num('ceDp'), pn = num('cePn'), cc = num('ceC'), today = new Date(Engine.simTime * 1000).toISOString().slice(0, 10);
  return {
    id: 'custom', pv: 0, label: v('ceLabel'), phases: [{ target: num('ceT1') }].concat(t2 != null ? [{ target: t2 }] : []),
    daily: dp != null ? { pct: dp, base: v('ceDb'), anchor: v('ceDa') } : null, max: { pct: num('ceMp'), mode: v('ceMm'), trailOn: v('ceMt'), lock: v('ceMl') === '1' },
    minDays: num('ceMin'), profitDays: pn != null && pn > 0 ? { n: pn, minPct: num('cePm') ?? 0 } : null, consistency: cc, reset: { tz: v('ceTz'), hour: num('ceH') }, validFrom: today, checked: today
  };
}
function chEditErr() {
  if (typeof document === 'undefined' || !document.getElementById('ceT1')) return '';
  const r = chEditRead();
  if (!r.label || r.label.length > 40) return 'Give the rules a name of up to 40 characters.';
  return chValidRules(r) ? '' : 'Some values are outside their range (targets 0.5–50%, daily 0.5–20%, max 1–30%, days 0–60, consistency 10–100%, hour 0–23).';
}
function renderChal() {
  const el = typeof document !== 'undefined' && document.getElementById('chal'); if (!el) return;
  const ae = document.activeElement; if (el.contains(ae) && /INPUT|SELECT|TEXTAREA/.test(ae.tagName)) { chUpdateAtt(); return; }
  const phoneFirst = document.body.classList.contains('mnav-on');
  el.innerHTML = `<section class="bh-card ch-rules">${chRulesHtml()}</section>
    <div class="ch-grid${phoneFirst ? ' ph' : ''}"><section class="bh-card ch-att" id="chAtt" aria-label="Practice attempt"><div class="ch-cap bh-lab">Practice attempt</div><div id="chAttB">${chAttHtml()}</div></section>
    <section class="bh-card ch-ready" id="chReady">${chReadyHtml()}</section></div>
    <section class="bh-card ch-log">${chLogHtml()}</section>`;
  chKickMC();
}
// refresh only the attempt card (1 s while the tab is open); skip when nothing changed or a control in it has focus
function chUpdateAtt() {
  const b = typeof document !== 'undefined' && document.getElementById('chAttB'); if (!b) return;
  const html = chAttHtml(); if (b._h === html) return;
  if (b.contains(document.activeElement) && document.activeElement !== document.body && b._st === (S.chal.att && S.chal.att.status)) return;
  b.innerHTML = html; b._h = html; b._st = S.chal.att && S.chal.att.status;
}
// start the Monte Carlo when the tab is open and the sample changed (cached on the sample signature)
function chKickMC() {
  if (typeof activeTab === 'undefined' || activeTab !== 'chal') return;
  const c = chCfg(), R = chRules(c.sel) || chRules('2s-static'), smp = chSample(R, c.opt);
  if (!smp.ok || (CH.mc && CH.mc.sig === smp.sig) || (CH.busy != null && CH.busySig === smp.sig)) return;
  CH.busy = 0; CH.busySig = smp.sig;
  const prog = p => { CH.busy = p; const s = document.querySelector('#chReady [role=status]'); if (s) s.textContent = `Running 20,000 random attempts… ${Math.round(p * 100)}%`; };
  chSimulate(smp, R, c.opt, prog).then(r => { CH.mc = r; CH.busy = null; const rd = document.getElementById('chReady'); if (rd && !rd.contains(document.activeElement)) rd.innerHTML = chReadyHtml(); else renderChal(); })
    .catch(e => { CH.busy = null; if (e && e.message !== 'cancelled') console.error('[Meridian] challenge simulation failed:', e); });
}
function chStatusTick() {
  const pill = document.getElementById('chalPill'), strip = document.getElementById('tkChal'), L = S && S.chal ? chLive() : { active: false };
  const att = S && S.chal && S.chal.att, recentBreach = att && att.status === 'breached' && Engine.simTime < (att.end.t + 3600);
  if (pill) {
    if (L.active) {
      const t = L.dailyUsed >= .5 ? `CHALLENGE · daily ${Math.round(L.dailyUsed * 100)}% used` : `CHALLENGE · P${L.phase + 1} · day ${Math.max(1, L.days)}`;
      if (pill.textContent !== t) pill.textContent = t; pill.className = 'pill ch-pill ' + (L.level === 'warn' ? 'ch-warn' : 'ch-ok'); pill.hidden = false;
    } else if (recentBreach) { pill.textContent = 'CHALLENGE · breached'; pill.className = 'pill ch-pill ch-breach'; pill.hidden = false; }
    else pill.hidden = true;
  }
  if (strip) {
    if (L.active) {
      const short = document.body.classList.contains('mnav-on'), dr = L.dailyFloor > -Infinity ? L.eq - L.dailyFloor : null, mr = L.eq - L.maxFloor;
      const t = short ? `${dr != null ? `Daily room ${usdFmt(dr)}` : `Max room ${usdFmt(mr)}`} · to target ${usdFmt(L.toTarget)}` : `Challenge · ${dr != null ? `Daily room ${usdFmt(dr)} · ` : ''}Max room ${usdFmt(mr)} · ${usdFmt(L.toTarget)} to target`;
      if (strip.textContent !== t) { strip.textContent = t; strip.setAttribute('aria-label', `Challenge attempt: ${dr != null ? `daily room ${usdFmt(dr)}, ` : ''}max room ${usdFmt(mr)}, ${usdFmt(L.toTarget)} to target. Open the Challenge tab.`); }
      strip.classList.toggle('warn', L.level === 'warn'); strip.hidden = false;
    } else strip.hidden = true;
  }
  if (typeof activeTab !== 'undefined' && activeTab === 'chal') { chUpdateAtt(); chKickMC(); }
}

/* ============ DOM: tab, pane, pill, ticket strip, Risk Lab link, styles (created here, index.html stays as is) ============ */
function chMount() {
  if (typeof document === 'undefined' || document.getElementById('chal')) return;
  const tb = document.querySelector('#tabs button[data-tab="behav"]'), pane = document.querySelector('.tab[data-pane="behav"]');
  if (tb && pane) {
    const b = document.createElement('button'); b.dataset.tab = 'chal'; b.textContent = 'Challenge'; tb.after(b);
    const p = document.createElement('div'); p.className = 'tab'; p.dataset.pane = 'chal'; p.innerHTML = '<div class="chal" id="chal"></div>'; pane.after(p);
  }
  const dp = document.getElementById('demoPill');
  if (dp) { const pl = document.createElement('button'); pl.type = 'button'; pl.className = 'pill ch-pill'; pl.id = 'chalPill'; pl.hidden = true; dp.after(pl); }
  const tw = document.getElementById('tkWarn');
  if (tw) { const st = document.createElement('button'); st.type = 'button'; st.className = 'ch-strip'; st.id = 'tkChal'; st.hidden = true; st.setAttribute('aria-label', 'Challenge attempt status'); tw.before(st); }
  const lb = document.querySelector('.lab-btns');
  if (lb) { const x = document.createElement('button'); x.type = 'button'; x.className = 'ghost sm'; x.id = 'labToChal'; x.textContent = 'Challenge odds on my trades'; lb.appendChild(x); }
  const css = document.createElement('style'); css.id = 'chStyle'; css.textContent = CH_CSS; document.head.appendChild(css);
}
const CH_CSS = `/* challenge readiness */
.chal{display:grid;gap:12px;padding:12px;align-content:start}
.ch-grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:12px;align-items:start}
.ch-rh{display:flex;flex-wrap:wrap;align-items:center;gap:8px 14px}
/* title bands: the card title reads before anything in it (styles.css .bh-card>h3 does the same in Behaviour) */
.ch-rh h3,.ch-ready>h3,.ch-log>h3,.ch-att>.ch-cap{display:block;margin:-12px -14px 10px;padding:6px 14px;background:var(--band);border-bottom:1px solid var(--line2);font-family:var(--f);font-size:var(--fs-sm);font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--tx);line-height:1.4}
.ch-rh h3{flex:0 0 calc(100% + 28px);margin-bottom:0}
/* the attempt's own heading is its status line (phase · day), not a second title */
#chAttH{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 10px;margin:0 0 8px;font-size:var(--fs-md);font-weight:600;color:var(--tx);text-transform:none;letter-spacing:0}
#chAttH .ch-src{margin-left:auto;font-weight:400}
.ch-ctl{display:inline-flex;align-items:center;gap:6px;font-size:var(--fs-sm);color:var(--tx2)}
.ch-ctl select,.ch-edit input,.ch-edit select{min-height:32px}
.ch-sum{font-size:var(--fs-sm);color:var(--tx2)}
.ch-about{margin-top:8px}.ch-about summary{cursor:pointer;font-size:var(--fs-sm);color:var(--tx2)}.ch-about ul{margin:6px 0;padding-left:18px;line-height:1.5}
/* hero row: profit target first, the room before each loss limit next to it */
.ch-kpis{display:flex;flex-wrap:wrap;gap:6px 22px;align-items:end;margin:0 0 10px}
.ch-kpis .kpi b small{font-size:var(--fs-xs);font-weight:400;color:var(--tx2)}
/* limits table: fixed tracks on every row, so heads and figures line up to the pixel; 1px grid in --line */
.ch-meters{display:grid;margin:0 0 8px;border:1px solid var(--line)}
.ch-mrow{display:grid;grid-template-columns:minmax(96px,1.1fr) minmax(104px,1.2fr) 96px 104px 96px minmax(96px,1fr);align-items:center;min-height:30px;border-bottom:1px solid var(--line)}
.ch-mrow:last-child{border-bottom:0}
.ch-mrow>.ch-c{padding:4px 8px;border-right:1px solid var(--line);align-self:stretch;display:flex;flex-direction:column;justify-content:center;min-width:0}
.ch-mrow>.ch-c:last-of-type{border-right:0}
.ch-mhead{background:var(--s2);border-bottom-color:var(--line2);min-height:24px}
.ch-mhead>span{padding:3px 8px;border-right:1px solid var(--line);font-size:var(--fs-2xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx2);text-align:right}
.ch-mhead>span:first-child,.ch-mhead>span:last-child{text-align:left}.ch-mhead>span:last-child{border-right:0}
.ch-name{font-size:var(--fs-sm);color:var(--tx)}
.ch-used,.ch-allowed,.ch-room,.ch-floor{text-align:right;align-items:stretch;font-variant-numeric:tabular-nums;white-space:nowrap}
.ch-used,.ch-allowed{font-size:var(--fs-sm);color:var(--tx2)}
.ch-room{font-size:var(--fs-md);font-weight:600;color:var(--tx)}
.ch-floor{font-size:var(--fs-xs);color:var(--tx2)}
.ch-mnote{grid-column:1/-1;padding:3px 8px;font-size:var(--fs-xs);color:var(--tx2);border-top:1px solid var(--line)}
.ch-st{font-size:var(--fs-sm);font-weight:600;color:var(--tx2)}.ch-st.ch-warn{color:var(--warn)}.ch-st.ch-breach{color:var(--dn)}
.ch-mrow>.ch-st{flex-direction:row;align-items:center;justify-content:flex-start;gap:4px;border-right:0}
.ch-meter{margin:0}
/* a narrow card (tablet, phone): each limit becomes a two-line row with its labels; nothing is dropped */
.ch-att{container-type:inline-size}
@container (max-width:620px){
  .ch-mhead{display:none}
  .ch-mrow{grid-template-columns:repeat(2,minmax(0,1fr))}
  .ch-mrow>.ch-name{grid-area:1/1;border-bottom:1px solid var(--line);font-weight:600}
  .ch-mrow>.ch-st{grid-area:1/2;border-bottom:1px solid var(--line);justify-content:flex-end}
  .ch-mrow>.ch-used{grid-area:2/1}.ch-mrow>.ch-allowed{grid-area:2/2}.ch-mrow>.ch-room{grid-area:3/1}.ch-mrow>.ch-floor{grid-area:3/2}
  .ch-mrow>.ch-mnote{grid-area:4/1/5/3}
  .ch-mrow>.ch-c:is(.ch-used,.ch-allowed,.ch-room,.ch-floor){flex-direction:row;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:0 8px}
  .ch-mrow>.ch-c:is(.ch-room,.ch-floor){border-top:1px solid var(--line)}
  .ch-mrow>.ch-c:is(.ch-allowed,.ch-floor){border-right:0}
  .ch-mrow>.ch-used>.ch-bar{flex:1 0 100%}
  .ch-c[data-l]::before{content:attr(data-l);display:block;font-family:var(--f);font-size:var(--fs-2xs);font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3)}
}
.ch-bar{display:block;height:4px;border-radius:var(--r-xs);background:var(--s2);border:1px solid var(--line);overflow:hidden;margin:3px 0 0}
.ch-bar i{display:block;height:100%;background:var(--tx3)}.ch-meter.ch-mwarn .ch-bar i{background:var(--warn)}.ch-meter.tgt .ch-bar i{background:var(--up)}
.ch-note{padding:8px 10px;margin:8px 0;border:1px solid var(--line2);border-radius:var(--r-md);background:var(--s2);font-size:var(--fs-sm)}.ch-note.warn{border-color:var(--warn)}
.ch-banner{padding:10px 12px;border:1px solid var(--line2);border-left:3px solid var(--dn);border-radius:var(--r-md);background:var(--s2);margin-bottom:10px}
.ch-banner.pass{border-left-color:var(--up)}.ch-banner p{margin:6px 0 0;font-size:var(--fs-sm)}
.ch-day{list-style:none;margin:0;padding:0;display:grid;gap:4px}.ch-day li{display:flex;flex-wrap:wrap;gap:4px 10px;align-items:baseline;font-size:var(--fs-sm)}
.ch-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}
.ch-es{justify-items:start;max-width:none;margin:0}
/* readiness in levels: verdict (key) → progress (key figures) → reasons and the zero-edge sentence (secondary) */
.ch-verdict{margin-bottom:10px}.ch-vt{display:block;font-size:var(--fs-md);font-weight:700;color:var(--tx)}.ch-verdict.lv-not-ready .ch-vt{color:var(--dn)}
.ch-verdict p,.ch-verdict ul{font-size:var(--fs-sm);line-height:1.5;margin:6px 0;color:var(--tx2)}
.ch-verdict p.mono{font-size:var(--fs-md);font-weight:600;color:var(--tx)}
.ch-ctls{display:flex;flex-wrap:wrap;gap:8px 14px;margin:8px 0}
.ch-nums.stale{opacity:.5}
.ch-tbl{width:100%;margin:6px 0;table-layout:fixed}.ch-tbl small{color:var(--tx3)}
.ch-tbl th:first-child{width:28%}
.ch-tbl tbody th{background:none;font-size:var(--fs-sm);font-weight:500;letter-spacing:0;text-transform:none;color:var(--tx);text-align:left;vertical-align:middle;border-bottom-color:var(--line)}
/* the interval sits in its own fixed-width slot after the figure, so the figures stay aligned */
.ch-tbl td small{display:inline-block;min-width:11ch;margin-left:4px;text-align:left;font-size:var(--fs-xs)}
.ch-tbl td{font-weight:600;color:var(--tx)}
.ch-stack{display:grid;grid-template-columns:110px minmax(0,1fr);gap:8px;align-items:center;font-size:var(--fs-xs);color:var(--tx3);margin:4px 0}
.ch-stack>div{display:flex;height:16px;border-radius:var(--r-xs);overflow:hidden;border:1px solid var(--line)}
.ch-stack i{display:block;height:100%;font-style:normal;white-space:nowrap;overflow:hidden;color:var(--bg);font-size:10px;line-height:16px;padding-left:3px}
.ch-stack i+i{box-shadow:inset 1px 0 0 var(--s1)}
.ch-stack i.p{background:var(--up)}.ch-stack i.n{background:color-mix(in srgb,var(--tx3) 40%,transparent)}.ch-stack i.d{background:var(--dn)}
/* max-loss breaches: an outlined red segment (fill, not hue, tells it from the daily one) */
.ch-stack i.m{background:var(--s1);box-shadow:inset 0 0 0 1px var(--dn);color:var(--dn)}
.ch-fixed{font-size:var(--fs-xs);color:var(--tx2);border-top:1px solid var(--line);padding-top:8px;margin:10px 0 0}
.ch-edit{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px 12px;margin-top:8px}.ch-edit>p,.ch-edit>.ch-act{grid-column:1/-1}
.ch-edit label{display:grid;gap:3px;font-size:var(--fs-xs);color:var(--tx2)}
.ch-pill{cursor:pointer;background:none}.ch-pill.ch-warn{color:var(--warn);border-color:var(--warn)}.ch-pill.ch-breach{color:var(--dn);border-color:var(--dn)}
.ch-strip{display:block;width:100%;text-align:left;margin:6px 0;padding:6px 8px;font-size:var(--fs-xs);color:var(--tx2);background:var(--s2);border:1px solid var(--line);border-radius:var(--r-md)}
.ch-strip.warn{border-left:3px solid var(--warn)}
.ch-strip[hidden]{display:none}
.ch-src::before{content:''}
html[data-demo] .tab[data-pane=chal]::before{content:'Demo account — example trades. Example trades never count here.';display:block;padding:4px 12px;font-size:var(--fs-xs);line-height:1.4;color:var(--warn);background:color-mix(in srgb,var(--warn) 7%,transparent);border-bottom:1px solid color-mix(in srgb,var(--warn) 25%,transparent)}
@media (max-width:900px){.ch-grid{grid-template-columns:minmax(0,1fr)}}
body.mnav-on .chal{padding:10px}body.mnav-on .ch-ctl{display:grid;width:100%}body.mnav-on .ch-ctl select{width:100%}
body.mnav-on .chal button,body.mnav-on .chal select,body.mnav-on .chal summary,body.mnav-on .chal input{min-height:44px}
body.mnav-on .ch-tbl thead{display:none}body.mnav-on .ch-tbl tr{display:grid;gap:2px;padding:6px 0;border-bottom:1px solid var(--line)}body.mnav-on .ch-tbl td,body.mnav-on .ch-tbl th{text-align:left}
body.mnav-on .ch-logt table thead{display:none}body.mnav-on .ch-logt tr{display:grid;grid-template-columns:1fr 1fr;padding:6px 0;border-bottom:1px solid var(--line)}
@media (prefers-reduced-motion:reduce){.ch-bar i,.ch-stack i{transition:none}}`;
if (typeof document !== 'undefined') chMount();

/* ============ bind (called from bindBehav, after the coach wrapper there) ============ */
function bindChal() {
  chCfg();
  const el = document.getElementById('chal');
  if (el) {
    el.addEventListener('click', e => {
      const t = e.target.closest('button,[data-ch]'); if (!t) return;
      if ((t.id === 'chStartB' || t.id === 'chNewB' || t.id === 'chStopB') && chRO()) { chRoRefuse(); return; }
      if (t.id === 'chStartB' || t.id === 'chNewB') {
        const r = chStart(chCfg().sel);
        if (!r.ok) { if (r.ro) chRoRefuse(); else toast('Attempt not started', r.why, 'dn'); return; }
        toast('Practice attempt started', `${r.att.rules.label}: equity is checked on every market update.`, 'info');
        renderChal(); const h = document.getElementById('chAttH'); if (h) h.focus();
        return;
      }
      if (t.id === 'chStopB') {
        askConfirm({ title: 'Stop this attempt?', body: 'The attempt ends now and goes into the log as stopped. Open positions stay open.', ok: 'Stop attempt', onOk: () => { chStop(); renderChal(); const b = document.getElementById('chStartB'); if (b) b.focus(); } });
        return;
      }
      if (t.id === 'ceCancel') { CH.edit = false; renderChal(); return; }
      const go = t.dataset && t.dataset.ch;
      if (go === 'ready') { const h = document.getElementById('chReadyH'); if (h) h.focus(); return; }
      if (go) setTab(go);
    });
    el.addEventListener('change', e => {
      const id = e.target.id, c = chCfg();
      if (id === 'chPreset' && chRO()) { chRoRefuse(); renderChal(); return; }
      if (id === 'chPreset') { if (e.target.value === '+edit') { CH.edit = true; } else { CH.edit = false; c.sel = e.target.value; CH.mc = null; } save(); if (!CH.edit) chCfgSend(); renderChal(); if (CH.edit) document.getElementById('ceLabel')?.focus(); return; }
      if (id === 'chRisk') { c.opt.risk = e.target.value === 'asis' ? 'asis' : +e.target.value; save(); chCfgSend(); e.target.blur(); renderChal(); return; }
      if (id === 'chHor') { c.opt.horizon = +e.target.value; save(); chCfgSend(); e.target.blur(); renderChal(); return; }
    });
    el.addEventListener('input', e => { if (e.target.closest('#chEdit')) { const m = document.getElementById('ceErr'), err = chEditErr(), b = document.getElementById('ceSave'); if (m) m.textContent = err; if (b) { b.disabled = !!err; b.textContent = err ? 'Fix the values to save' : 'Save rules'; } } });
    el.addEventListener('submit', e => {
      if (e.target.id !== 'chEdit') return; e.preventDefault();
      if (chRO()) { chRoRefuse(); return; }
      const r = chValidRules(chEditRead()); if (!r) { const m = document.getElementById('ceErr'); if (m) m.textContent = chEditErr(); return; }
      const c = chCfg(); c.custom = r; c.sel = 'custom'; CH.edit = false; CH.mc = null; save(); chCfgSend(); renderChal(); toast('Custom rules saved', r.label, 'info');
    });
  }
  const pill = document.getElementById('chalPill'), strip = document.getElementById('tkChal'), lab = document.getElementById('labToChal');
  for (const x of [pill, strip, lab]) if (x) x.addEventListener('click', () => setTab('chal'));
  // demo loaded or cleared from Help: the account was replaced (the opt-in autoload is caught by chTick through S.demo)
  for (const f of ['loadDemoHistory', 'clearDemoHistory']) if (typeof window[f] === 'function') { const f0 = window[f]; window[f] = function () { chVoid(); return f0.apply(this, arguments); }; }
  if (chActive() && Engine.speed > CH_SPEED_CAP) setSpeed(CH_SPEED_CAP);
  if (typeof coachInsights === 'function') {
    const base = coachInsights;
    coachInsights = function () {
      const out = base(), att = S.chal && S.chal.att;
      if (chActive()) { const L = chLive(); out.unshift({ tone: 'info', t: `Challenge day ${Math.max(1, L.days)}: ${usdFmt(L.room)} of room before the ${L.which} limit, ${usdFmt(L.toTarget)} to target.` }); }
      else if (att && att.status === 'breached' && CH.coachBreach !== att.id) {
        CH.coachBreach = att.id;
        const k = chDayKey(att.end.t, att.rules.reset), day = S.history.filter(h => !h.nbp && h.open >= att.start && chDayKey(h.close, att.rules.reset) === k), w = day.filter(h => (h.ctx || []).length).length;
        out.unshift({ tone: 'bad', t: `Challenge breached on the ${att.end.why} limit — ${w} of ${day.length} trades that day carried warnings. See Challenge.` });
      }
      return out.slice(0, 8);
    };
  }
  setInterval(() => safe('challenge panel', chStatusTick), 1000);
}
