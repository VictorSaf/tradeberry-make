'use strict';
/* tradeBerry — Behaviour: pre-mortem gate before consequential trades (Klein 2007; prospective hindsight,
   Mitchell, Russo & Pennington 1989), automatic post-mortem, red-flag scoreboard, tilt guard,
   and a disposition-effect meter (Odean 1998: PGR vs PLR, with his t-statistic). */

const PM = { pending: null, timer: null };
const PM_REASONS = ['Stop too tight for current volatility', 'Entered against the trend', 'News or data surprise', 'Chased a move that was already done', 'Size too big — I panicked out', 'A hunch, not my setup', 'Correlated with another trade', 'Costs and spread ate the move'];
// which automatic evidence would confirm each predicted reason
const PM_MAP = { [PM_REASONS[0]]: ['tight', 'stophunt'], [PM_REASONS[1]]: ['trend'], [PM_REASONS[2]]: ['news', 'newsin'], [PM_REASONS[3]]: ['chase'], [PM_REASONS[4]]: ['size', 'panic'], [PM_REASONS[6]]: ['corr'], [PM_REASONS[7]]: ['cost'] };
// the confidence a pre-mortem can state, in % (sanitizeState accepts whole numbers 10–90)
const CAL_V = [10, 20, 30, 40, 50, 60, 70, 80, 90];
const MOODS = ['calm', 'confident', 'bored', 'anxious', 'FOMO', 'frustrated'];
const FLAG_NAMES = { nosl: 'No stop loss', size: 'Risk above 2% of equity', tight: 'Stop inside normal noise', rr: 'Reward smaller than risk', trend: 'Against the 1-hour trend', chase: 'Chasing an extended move', news: 'High-impact news within 2h', revenge: `Within ${REVENGE_MIN} min of a loss`, corr: 'Stacked, correlated exposure', cost: 'Costs large vs the stop', tilt: 'Placed during tilt guard', overtrade: 'Unusually many trades in the last hour', chal: 'Could break a challenge limit', gap: 'Market closes within the hour' };
// directional warnings: shown as context, but on a zero-drift market they carry no edge either way
const BH_DIR_FLAGS = ['trend', 'chase'];
// sample sizes: no verdict below BH_MIN, "may be chance" below BH_N, over/under-confidence from BH_CAL_N rated trades
const BH_MIN = 10, BH_N = 30, BH_CAL_N = 20;
const bhChance = n => n < BH_N ? ', may be chance' : '';
// a win rate with its 95% Wilson interval for table cells: "62% (43–78%)"; — without trades
const bhWins = T => T.filter(h => h.net > 0).length;
function bhWrCell(k, n) { const ci = wilson(k, n), pc = v => Math.round(v * 100); return ci ? `${pc(k / n)}% <small class="muted ci">(${pc(ci.lo)}–${pc(ci.hi)}%)</small>` : '— <small class="muted ci"></small>'; }
const bhEsc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// long explanations fold under a one-line summary that always shows; which ones are open survives a re-render
const BH_OPEN = new Set();
const bhMore = (k, sum, body) => `<details class="bh-more" data-more="${k}"${BH_OPEN.has(k) ? ' open' : ''}><summary>${sum}</summary>${body}</details>`;
// until: sim second the "Skip pre-mortems for 1 hour" ends (0 = not skipping); skips: how many times it was used;
// off: the account-menu switch — no pre-mortem at all, tilt guard, rules and challenge flags included (for testing)
function pmCfg() { if (!S.set.pm) S.set.pm = { on: true, minRisk: 1, noSL: true, until: 0, skips: 0 }; return S.set.pm; }
const pmSkipping = () => (+pmCfg().until || 0) > Engine.simTime;
function tiltCfg() { if (!S.set.tilt) S.set.tilt = { on: true, streak: 3, dayLoss: 3, cool: 15 }; return S.set.tilt; }
const bhObj = v => !!v && typeof v === 'object' && !Array.isArray(v);
function bhState() {
  // a missing or malformed record starts over (it only feeds statistics; it must never stop a close)
  const d = S.dispo;
  if (!bhObj(d) || !['rg', 'rl', 'pg', 'pl'].every(k => Number.isFinite(d[k]) && d[k] >= 0) || !Array.isArray(d.ev)) S.dispo = { rg: 0, rl: 0, pg: 0, pl: 0, ev: [] };
  else if (d.ev.some(e => !bhObj(e))) d.ev = d.ev.filter(bhObj);
  if (!Array.isArray(S.pmSkip)) S.pmSkip = [];
  if (!bhObj(S.tiltSt)) S.tiltSt = { until: 0, trips: 0, overrides: 0, lastTrip: null };
  return S;
}
const bhMean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const bhDur = s => { const m = Math.round(s / 60); return m < 60 ? m + 'm' : m < 1440 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${(m / 1440).toFixed(1)}d`; };
const bhClock = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/* ---------- risk + red flags ----------
   Distances are in the instrument's displayed unit (M(sym).pip: a pip on FX, the platform's point otherwise) and money
   goes through pipValue (contract size, profit currency), so a stock, an index and a pair read the same way. */
function pmRisk(o) {
  const m = M(o.sym), q = Engine.quote(o.sym), d = o.side === 'buy' ? 1 : -1;
  const entry = o.price ?? (d > 0 ? q.ask : q.bid);
  const own = S.positions.find(p => p.sym === o.sym && p.side === o.side && p.sl != null); // an add joins the position, whose stop covers it (netting)
  const sl = o.sl ?? (o.slPips ? entry - d * o.slPips * m.pip : own && o.price == null ? own.sl : null);
  const tp = o.tp ?? (o.tpPips ? entry + d * o.tpPips * m.pip : null);
  const risk = sl != null ? Math.abs(entry - sl) / m.pip * pipValue(o.sym, 1) * o.lots : null;
  const reward = tp != null ? Math.abs(tp - entry) / m.pip * pipValue(o.sym, 1) * o.lots : null;
  return { entry, sl, tp, d, m, risk, reward, pct: risk != null ? risk / account().eq * 100 : null };
}
function bhNewsSoon(ccys) { const now = Engine.simTime; return (typeof CAL !== 'undefined' ? CAL.events : []).filter(e => !e.done && e.impact === 'hi' && ccys.includes(e.ccy) && e.t > now && e.t - now < 2 * 3600).sort((x, y) => x.t - y.t)[0]; }
// every statistic here counts positions (tradesOf, shared.js: partial closes merged, NBP credit left out) at net P&L
const bhTrades = () => tradesOf(S.history), bhLastTrade = () => bhTrades()[0];
const bhFind = id => bhTrades().find(h => h.id === id);
// a position judged as a whole: what its closed parts made net, plus the open rest after its share of the commission
const bhPosNet = p => posPnl(p).pnl - (+p.comm || 0) + S.history.reduce((s, h) => s + (h.id === p.id && h.sym === p.sym && !h.nbp ? netPnl(h) : 0), 0);
function bhRevenge() { const last = bhLastTrade(), now = Engine.simTime; return last && last.net < 0 && now - last.close < REVENGE_MIN * 60 ? [`revenge`, `Opened ${Math.max(1, Math.round((now - last.close) / 60))} min after a ${usdFmt(last.net)} loss`] : null; }
// overtrading: positions opened in the last sim hour vs your usual rate in hours when you trade (each position once)
function bhOvertrade() {
  const now = Engine.simTime, T = bhTrades().filter(h => !h.basket), seen = new Set(T.map(h => h.id));
  const opens = [...T.map(h => h.open), ...S.positions.filter(p => !p.basket && !seen.has(p.id)).map(p => p.open)];
  const last = opens.filter(t => now - t < 3600).length; if (last < 4) return null;
  const hrs = {}; for (const t of opens) if (now - t >= 3600) hrs[Math.floor(t / 3600)] = (hrs[Math.floor(t / 3600)] || 0) + 1;
  const v = Object.values(hrs), usual = v.length >= 3 ? bhMean(v) : 1.5;
  return last >= Math.max(4, usual * 2) ? ['overtrade', `${last + 1} trades in an hour — about ${((last + 1) / usual).toFixed(1)}× your usual pace`] : null;
}
function pmFlags(o, r) {
  const f = [], sym = o.sym, m = r.m, d = r.d;
  if (r.sl == null) f.push(['nosl', 'No stop loss — the possible loss is open-ended']);
  else if (r.pct > 2) f.push(['size', `Risking ${r.pct.toFixed(1)}% of equity on one idea`]);
  const b15 = Engine.aggregate(sym, 15, 40).slice(-15), atr = bhMean(b15.map(b => b.high - b.low));
  if (r.sl != null && atr) { const slp = Math.abs(r.entry - r.sl) / m.pip, ap = atr / m.pip; if (slp < ap * 1.2) f.push(['tight', `Stop of ${slp.toFixed(1)} ${unitWord(sym)} sits inside normal 15-minute noise (ATR ${ap.toFixed(1)} ${unitWord(sym)})`]); }
  if (r.tp != null && r.sl != null) { const rr = Math.abs(r.tp - r.entry) / Math.abs(r.entry - r.sl); if (rr < 1) f.push(['rr', `Reward is only ${rr.toFixed(2)}× the risk`]); }
  const h1 = Engine.aggregate(sym, 60, 120); if (h1.length > 60) {
    let e = h1[0].close; const es = []; for (const b of h1) { e += 2 / 51 * (b.close - e); es.push(e); }
    const slope = es[es.length - 1] - es[es.length - 6];
    if ((r.entry - es[es.length - 1]) * d < 0 && slope * d < 0) f.push(['trend', `${d > 0 ? 'Buying below a falling' : 'Selling above a rising'} 1-hour EMA50 — against the trend`]);
  }
  const a = Engine.candles[sym], n = a.length; if (n > 1500) {
    const mv = (a[n - 1].close - a[n - 61].close) * d, typ = bhMean(Array.from({ length: 23 }, (_, k) => Math.abs(a[n - 1 - k * 60].close - a[n - 61 - k * 60].close)));
    if (typ && mv > typ * 2.2) f.push(['chase', `Price already ran ${(mv / typ).toFixed(1)}× its usual hourly move in your direction — chasing`]);
  }
  // sessions: the reopening can gap through a stop (simulated gaps, sized on the instrument's own history)
  const ss = Engine.session(sym), left = ss && ss.open && ss.closesAt ? ss.closesAt - Engine.simTime : null;
  if (left != null && left > 0 && left <= 3600) f.push(['gap', `Market closes in ${Math.max(1, Math.round(left / 60))} min — held over the close, the reopening can gap through your stop`]);
  const sp = Engine.quote(sym).spread; if (r.sl != null && sp / (Math.abs(r.entry - r.sl) / m.pip) > .15) f.push(['cost', `Spread is ${(sp / (Math.abs(r.entry - r.sl) / m.pip) * 100).toFixed(0)}% of the stop distance`]);
  const ev = bhNewsSoon(m.newsCcy); if (ev) f.push(['news', `High-impact ${ev.ccy} ${ev.name} in ${bhDur(ev.t - Engine.simTime)}`]);
  const rv = bhRevenge(); if (rv) f.push(rv);
  const ot = bhOvertrade(); if (ot) f.push(ot);
  for (const p of S.positions) {
    if (p.sym === sym) { if (p.side === o.side) f.push(['corr', `Adds to an open ${pretty(sym)} ${p.side}`]); continue; }
    const rho = typeof pairCorr === 'function' ? pairCorr(sym, p.sym) : 0, eff = rho * (p.side === o.side ? 1 : -1);
    if (eff > .7) { f.push(['corr', `Stacks on open ${pretty(p.sym)} ${p.side} (ρ ${rho.toFixed(2)}) — the same bet twice`]); break; }
  }
  if (tiltStatus().armed) f.push(['tilt', tiltStatus().why]);
  // challenge attempt (challenge.js): no stop, a large share of the room left, or the 80% cool-down
  if (typeof chFlag === 'function') { const cf = chFlag(o, r); if (cf) f.push(cf); }
  return f;
}

/* ---------- tilt guard ---------- */
function tiltStatus() {
  // the streak counts finished positions only; the day counts every close today (partials too), after commission
  const c = tiltCfg(), now = Engine.simTime, day = Math.floor(now / 86400) * 86400, H = bhTrades().filter(h => !h.basket && h.complete);
  let streak = 0; for (const h of H) { if (h.net < 0) streak++; else break; }
  const dayPnl = S.history.reduce((s, h) => s + (!h.nbp && h.close >= day ? netPnl(h) : 0), 0), dayPct = dayPnl / Math.max(1, S.balance - dayPnl) * 100;
  const st = bhState().tiltSt, hitStreak = streak >= c.streak, hitDay = dayPct <= -c.dayLoss;
  const paused = (st.pauseUntil || 0) > now;
  if (paused) return { streak, dayPnl, dayPct, armed: true, cooling: true, left: st.pauseUntil - now, why: 'Pause you set yourself', paused: true };
  const why = hitStreak ? `${streak} losing trades in a row` : hitDay ? `Down ${Math.abs(dayPct).toFixed(1)}% today (limit ${c.dayLoss}%)` : '';
  return { streak, dayPnl, dayPct, armed: c.on && (hitStreak || hitDay), cooling: c.on && st.until > now, left: Math.max(0, st.until - now), why };
}
function bhPause(sec) { const st = bhState().tiltSt; st.pauseUntil = sec ? Engine.simTime + sec : 0; if (sec) st.pauses = (st.pauses || 0) + 1; save(); toast(sec ? 'Trading paused' : 'Pause ended', sec ? `New trades wait ${bhDur(sec)} (sim time). You can still close positions.` : 'Back to normal', 'info'); renderBehav(); if (typeof renderTicket === 'function') renderTicket(); }
function tiltCheckTrip() {
  const t = tiltStatus(), st = S.tiltSt, last = bhTrades().find(h => h.complete);
  if (!t.armed || !last || st.lastTrip === last.id + ':' + last.close) return;
  st.lastTrip = last.id + ':' + last.close; st.until = Engine.simTime + tiltCfg().cool * 60; st.trips++; save();
  toast('Tilt guard on', `${t.why}. Cool-down ${tiltCfg().cool} min, and every trade gets a pre-mortem until the streak breaks.`, 'warn'); beep('alert');
}
function rulesCfg() { if (!S.set.rules) S.set.rules = {}; return S.set.rules; }
function pmNeedFor(pct, hasStop, codes = []) {
  if (pmCfg().off || !pmAdmin()) return false;
  const ru = rulesCfg(); if (codes.some(c => ru[c])) return true;
  if (tiltStatus().armed) return true;
  const c = pmCfg(); if (!c.on || pmSkipping()) return false;
  return hasStop ? pct >= c.minRisk : c.noSL;
}
// pre-mortems go with Coach, where they are set: only for users the administrator gave Coach (shell.js wsCan)
function pmAdmin() { return typeof wsCan !== 'function' || wsCan('coach'); }
function pmNeeded(o) { if (o.auto || o.pmDone || !o || !M(o.sym) || pmCfg().off || !pmAdmin() || netOnly(o)) return false; const r = pmRisk(o); if (typeof chFlag === 'function' && chFlag(o, r)) return true; let codes = []; if (Object.keys(rulesCfg()).length) { try { codes = pmFlags(o, r).map(f => f[0]); } catch (e) { } } return pmNeedFor(r.pct, r.sl != null, codes); }

/* ---------- wrap trading functions (app.js globals) ---------- */
const _bhOpen = openPosition, _bhPlace = placeOrder, _bhClose = closePosition;
const bhVoluntary = reason => !/Stop|Take profit|Trailing|Time stop|Basket stop|Basket target/.test(reason);
// Odean: one sell decision = one event. Everything sold in it is realised, everything still held is paper.
// Totals rg/rl/pg/pl are all-time; ev keeps the last 300 decisions (it only drives the sparkline).
let BH_BATCH = false;
// Odean counts only portfolios of two or more positions, and a position at exactly zero (to the cent) is neither a gain nor a loss
const bhSign = x => { const c = Math.round(bhPosNet(x) * 100); return c > 0 ? 1 : c < 0 ? -1 : 0; };
function dispoSale(sold, held) {
  if (sold.length + held.length < 2) return;
  const st = bhState().dispo, e = { t: Engine.simTime, sym: sold[0].sym, rg: 0, rl: 0, pg: 0, pl: 0 };
  for (const x of sold) { const g = bhSign(x); if (g > 0) e.rg++; else if (g < 0) e.rl++; }
  if (!e.rg && !e.rl) return;
  for (const x of held) { const g = bhSign(x); if (g > 0) e.pg++; else if (g < 0) e.pl++; }
  st.rg += e.rg; st.rl += e.rl; st.pg += e.pg; st.pl += e.pl;
  st.ev.unshift(e); if (st.ev.length > 300) st.ev.pop();
  if (e.rg && e.pl && dispoVerdict(dispoStats()).key === 'dispo') setTimeout(() => toast('Disposition check', `You banked a winner while ${e.pl} losing position${e.pl > 1 ? 's stay' : ' stays'} open. Is the loser still a trade you would open today?`, 'info'), 400);
}
if (typeof closeWhere === 'function') { // batch closes (Close all, winners, losers, by symbol): one decision, counted before any leg closes
  const _bhWhere = closeWhere;
  closeWhere = function (fn, reason = 'Manual') {
    if (BH_BATCH) return _bhWhere(fn, reason);
    const T = [...S.positions].filter(fn), sold = T.filter(p => !p.basket);
    if (bhVoluntary(reason) && sold.length) safe('disposition', () => dispoSale(sold, S.positions.filter(p => !p.basket && !T.includes(p))));
    BH_BATCH = true; try { return _bhWhere(fn, reason); } finally { BH_BATCH = false; }
  };
}
// an order whose stop-out would breach a running challenge attempt is refused on every path (challenge.js), before the pre-mortem
const bhChalBlock = o => { if (!o || !M(o.sym) || netOnly(o)) return undefined; const why = typeof chOrderBlock === 'function' ? chOrderBlock(o) : null; return why ? reject('Order blocked', why) : undefined; };
openPosition = function (o) {
  if (bhChalBlock(o) === null) return null;
  if (pmNeeded(o)) { pmOpen(o, 'pos'); return null; }
  let ctx = o.ctx;
  if (!ctx && !o.basket && M(o.sym)) { try { ctx = pmFlags(o, pmRisk(o)).map(f => f[0]); } catch (e) { ctx = []; } }
  const stamp = p => {
    if (!p || !netNew()) return p;
    p.sl0 = p.sl; p.tp0 = p.tp; p.ctx = ctx || []; p.news = []; if (o.pm) { p.pm = o.pm; if (o.pm.timeStop) p.timeStop = o.pm.timeStop; } if (o.basket) { p.basket = o.basket; p.bgid = o.bgid; }
    return p;
  };
  // live: the journal fields go with the order; the server stamps them on the new position (gw_meta)
  if (TradeLink.live) { if (!o.ctx) o = { ...o, ctx: ctx || [] }; return _bhOpen(o); }
  const p = _bhOpen(o);
  return p instanceof Promise ? p.then(stamp) : stamp(p);
};
placeOrder = function (o) { if (bhChalBlock(o) === null) return; if (pmNeeded(o)) { pmOpen(o, 'ord'); return; } return _bhPlace(o); };
closePosition = function (id, reason = 'Manual', frac = 1) {
  const p = S.positions.find(x => x.id === id); if (!p) return;
  // a part refused at the minimum size (closeLots 0: "½" of 0.01 lots) closes nothing: no sale is counted and no
  // journal fields go to the server; the refusal itself is shown by the close below
  if (frac < 1 && !closeLots(p, frac)) return _bhClose(id, reason, frac);
  const vol = bhVoluntary(reason) && !p.basket;
  // statistics never stand between the user and the close
  if (vol && !BH_BATCH) safe('disposition', () => dispoSale([p], S.positions.filter(x => !x.basket && x !== p))); // inside a batch it was already counted
  const meta = { pm: p.pm, sl0: p.sl0, tp0: p.tp0, slLast: p.sl, tpLast: p.tp, vol, basket: p.basket, bgid: p.bgid, ctx: p.ctx, news: p.news, timeStop: p.timeStop };
  // live: the server's history row carries the position's journal fields (gw_meta); the rest arrives with it
  // the close's own journal fields (the stop and target it left, voluntary or not, the risk) go to the server first
  if (TradeLink.live) { TradeLink.send('meta', { posId: id, meta: { slLast: p.sl ?? null, tpLast: p.tp ?? null, vol, riskUsd: p.risk > 0 ? p.risk * Math.min(1, frac) : null } }); const r = _bhClose(id, reason, frac); Promise.resolve(r).then(() => { safe('tilt guard', tiltCheckTrip); if (activeTab === 'behav') safe('behaviour', renderBehav); }); return r; }
  const h0 = S.history[0], r = _bhClose(id, reason, frac);
  if (S.history[0] && S.history[0] !== h0 && S.history[0].id === id) Object.assign(S.history[0], meta);
  safe('tilt guard', tiltCheckTrip);
  if (activeTab === 'behav') safe('behaviour', renderBehav);
  return r;
};
if (typeof tkWarnings === 'function') {
  const _tkW = tkWarnings;
  tkWarnings = function (k) { const w = _tkW(k), t = tiltStatus(); if (t.armed) w.unshift(`Tilt guard: ${t.why}${t.cooling ? ` — cool-down ${bhClock(t.left)} left` : ''}.`); return w; };
}

/* ---------- generic pre-mortem gate (single trades and baskets) ---------- */
function pmGate(spec) {
  const c = pmCfg(); PM.pending = spec;
  let el = $('#pmGate');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'pmGate'; document.body.appendChild(el);
    el.addEventListener('click', pmClick); el.addEventListener('input', pmValidate); el.addEventListener('change', pmValidate);
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); pmResolve('cancel'); } if (e.key === 'Enter' && e.target.type === 'text' && !$('#pmGo').disabled) pmResolve('go'); });
  }
  const t = tiltStatus(), ru = rulesCfg(), blockers = spec.flags.filter(f => ru[f[0]] === 'block'); PM.block = blockers.map(f => f[0]);
  el.innerHTML = `<div class="modal pm-modal" role="dialog" aria-modal="true" aria-labelledby="pmT">
    <div class="ph"><h2 id="pmT">Pre-mortem</h2><button class="icon-btn" data-pm="cancel" aria-label="Close">✕</button></div>
    ${t.paused ? `<div class="pm-tilt"><b>Paused</b> · You stepped away on purpose. <b class="mono" id="pmCool">${bhClock(t.left)}</b> left — end the pause in Behaviour or override it here.</div>` : t.armed ? `<div class="pm-tilt"><b>Tilt guard</b> · ${t.why}.${t.cooling ? ` Cool-down <b class="mono" id="pmCool">${bhClock(t.left)}</b> left — losses cluster when we trade to win it back.` : ' Every trade gets a pre-mortem until a winner breaks the streak.'}</div>` : ''}
    ${blockers.length ? `<div class="pm-tilt pm-rule"><b>Your rule</b> · you decided not to take trades with: ${blockers.map(f => FLAG_NAMES[f[0]].toLowerCase()).join(', ')}. Breaking it is possible, and it is recorded.</div>` : ''}
    <div class="pm-trade">${spec.summary}</div>
    <p class="pm-lead">It is 24 hours from now. <b>This ${spec.noun || 'trade'} lost.</b> Why did it fail?</p>
    ${spec.flags.length ? `<div class="pm-flags"><label>Red flags already visible · ${spec.flags.length}</label><ul>${spec.flags.map(f => `<li>${bhEsc(f[1])}${pmTrack(f[0])}</li>`).join('')}</ul></div>` : `<div class="pm-flags ok"><label>No automatic red flags</label><p>Size, stop, trend, news, timing, cost and correlation checks passed. Imagine the failure anyway.</p></div>`}
    <div class="pm-reasons"><label>Most likely reasons — pick at least one, or write your own</label>
      <div class="pm-chips">${PM_REASONS.map(x => `<label class="pm-chip"><input type="checkbox" value="${x}"><span>${x}</span></label>`).join('')}</div>
      <input type="text" id="pmOwn" placeholder="In my own words: it failed because…" maxlength="160" autocomplete="off">
      <div class="pm-conf"><span>Right now I feel</span>${MOODS.map(v => `<label><input type="radio" name="pmMood" value="${v}"><span>${v}</span></label>`).join('')}</div>
      <div class="pm-conf"><span>How likely is it to work?</span>${CAL_V.map(v => `<label><input type="radio" name="pmConf" value="${v}"><span>${v}%</span></label>`).join('')}</div>
      <div class="pm-row2"><input type="text" id="pmKill" placeholder="Optional — I will get out early if…" maxlength="160" autocomplete="off">
      <label class="pm-ts">Time stop <select id="pmTs"><option value="0">none</option><option value="3600">1h</option><option value="14400">4h</option><option value="86400">24h</option></select></label></div></div>
    <div class="pm-actions"><span class="sp"></span><button class="ghost" data-pm="cancel">Rethink — don't place</button>${t.cooling || blockers.length ? `<button class="ghost pm-ovr" data-pm="override">${blockers.length ? 'Break my rule' : t.paused ? 'Override pause' : 'Override cool-down'}</button>` : ''}<button class="pm-go ${spec.side}" id="pmGo" data-pm="go" disabled>${spec.label}</button>${t.armed || spec.flags.some(f => ru[f[0]] || f[0] === 'chal') ? '' : '<button class="link" data-pm="skip" style="flex-basis:100%;justify-content:flex-end;text-align:right;font-size:var(--fs-xs);color:var(--tx3)">Skip pre-mortems for 1 hour and place this order</button>'}</div>
    <p class="small muted pm-foot">Imagining that a decision has already failed ("prospective hindsight") helps people name more of the real reasons in advance. Shown when risk ≥ ${c.minRisk}% of equity${c.noSL ? ' or there is no stop' : ''}, and for every trade while the tilt guard is on. Skipping pauses them for one hour; turning them off is in Behaviour. Time stop closes the trade if it is not in profit by then. Skipped trades are tracked.</p></div>`;
  el.hidden = false; PM.override = false; setTimeout(() => el.querySelector('.pm-chip input')?.focus(), 30);
  clearInterval(PM.timer); PM.timer = setInterval(() => { const tt = tiltStatus(), cl = $('#pmCool'); if (cl) cl.textContent = bhClock(tt.left); if (!tt.cooling && !PM.block.length && $('.pm-ovr')) { $('.pm-ovr').remove(); pmValidate(); } if (el.hidden) clearInterval(PM.timer); }, 500);
}
// how did this flag work out for you before?
function pmTrack(code) {
  const T = bhTrades().filter(h => !h.basket && h.ctx && h.ctx.includes(code)); if (T.length < 2) return '';
  const net = T.reduce((s, h) => s + h.net, 0);
  // the record is context, not permission: a flag that happened to pay is still the same risk
  return ` <span class="pm-hist${net < 0 && T.length >= BH_MIN ? ' dn' : ''}">your past trades with it: ${wrTxt(bhWins(T), T.length)} won${bhChance(T.length)} · ${usdFmt(net, true)}${net > 0 ? ' — past wins do not make this risk smaller' : ''}</span>`;
}
function pmValidate() {
  const el = $('#pmGate'); if (!el || el.hidden) return;
  const any = el.querySelectorAll('.pm-chip input:checked').length || ($('#pmOwn').value.trim().length > 3);
  $('#pmGo').disabled = !any || ((tiltStatus().cooling || PM.block.length) && !PM.override);
}
function pmClick(e) { if (e.target.id === 'pmGate') return; const b = e.target.closest('[data-pm]'); if (b) pmResolve(b.dataset.pm); }
function pmResolve(act) {
  const P = PM.pending, el = $('#pmGate'); if (!P) return;
  if (act === 'override') { PM.override = true; if (tiltStatus().cooling) S.tiltSt.overrides++; if (PM.block.length) S.tiltSt.ruleBreaks = (S.tiltSt.ruleBreaks || 0) + 1; save(); el.querySelector('.pm-ovr')?.remove(); pmValidate(); return; }
  if (act === 'go' && $('#pmGo').disabled) return;
  const pm = { flags: P.flags.map(f => f[1]), codes: P.flags.map(f => f[0]), mine: [...el.querySelectorAll('.pm-chip input:checked')].map(x => x.value), own: $('#pmOwn').value.trim(), kill: $('#pmKill').value.trim(), timeStop: +$('#pmTs').value || 0, conf: +(el.querySelector('input[name=pmConf]:checked')?.value || 0) || null, mood: el.querySelector('input[name=pmMood]:checked')?.value || null, broke: PM.override ? PM.block.slice() : [], t: Engine.simTime, override: PM.override };
  el.hidden = true; PM.pending = null; clearInterval(PM.timer);
  if (act === 'cancel') { bhState().pmSkip.unshift(P.skipRecord()); if (S.pmSkip.length > 100) S.pmSkip.pop(); save(); toast(`${P.noun === 'basket' ? 'Basket' : 'Trade'} not placed`, 'Behaviour will show whether skipping it was right', 'info'); return; }
  // decision 36: the modal only pauses them for one sim hour (counted); turning them off for good is in Behaviour, after a confirmation
  if (act === 'skip') { const c = pmCfg(); c.until = Engine.simTime + 3600; c.skips = (+c.skips || 0) + 1; save(); toast('Pre-mortems skipped for 1 hour', `They come back on their own at ${hhmm(c.until)} UTC (sim time). Tilt guard, your rules and challenge limits still ask.`, 'info'); P.onGo(null); return; }
  P.onGo(pm);
}
function pmOpen(o, kind) {
  const r = pmRisk(o), flags = pmFlags(o, r);
  pmGate({
    side: o.side, flags, label: `Place ${o.side}`, noun: 'trade',
    summary: `<span class="tag ${o.side}">${o.side}</span><b>${bhEsc(lotsWord(o.sym, normLots(o.sym, o.lots)))} ${pretty(o.sym)}</b><span class="muted">${kind === 'ord' ? `${o.ot} @ ${fp(o.sym, r.entry)}` : 'at market'}</span><span>risk ${r.pct != null ? `<b class="dn">${usdFmt(-r.risk)}</b> <span class="muted">${r.pct.toFixed(2)}%</span>` : '<b class="dn">unlimited</b>'}</span>${r.reward != null ? `<span>target <b class="up">${usdFmt(r.reward, true)}</b></span>` : ''}`,
    skipRecord: () => ({ type: 'trade', t: Engine.simTime, sym: o.sym, side: o.side, lots: +o.lots, entry: r.entry, sl: r.sl, tp: r.tp, risk: r.risk, reward: r.reward, flags: flags.map(f => f[1]) }),
    onGo: pm => { o.pmDone = true; if (pm) o.pm = pm; o.ctx = flags.map(f => f[0]); if (kind === 'pos') openPosition(o); else placeOrder(o); }
  });
}

/* ---------- counterfactual + automatic post-mortem ---------- */
function firstHit(sym, side, t0, sl, tp, maxMin = 1e9) {
  const a = Engine.candles[sym]; if (!a.length || a[a.length - 1].time <= t0) return { res: 'open' };
  let i = a.length - 1; while (i > 0 && a[i - 1].time > t0) i--;
  for (; i < a.length && a[i].time - t0 <= maxMin * 60; i++) {
    const k = a[i];
    if (side === 'buy') { if (sl != null && k.low <= sl) return { res: 'sl', t: k.time }; if (tp != null && k.high >= tp) return { res: 'tp', t: k.time }; }
    else { if (sl != null && k.high >= sl) return { res: 'sl', t: k.time }; if (tp != null && k.low <= tp) return { res: 'tp', t: k.time }; }
  }
  return { res: 'open' };
}
// settled post-mortems per position (trade records are rebuilt from the history on every read)
const BH_POST = new Map();
// how often a zero-drift random walk touches a level within 24 hours (reflection principle: the touch probability is
// 2(1 − Φ(d / σ√T)), rwHit in shared.js), with σ from complete 1-hour bars; '' when there is not enough history
function bhRwTxt(sym, from, to) {
  const sg = typeof sig1h === 'function' ? sig1h(sym) : null, p = from > 0 ? rwHit(Math.abs(to - from) / from, sg, 24) : null;
  return p == null ? 'That can happen by chance alone' : `A random walk touches that level within 24h about ${Math.round(p * 100)}% of the time`;
}
function postMortem(h) {
  const key = `${h.id}|${h.sym}|${h.open}|${h.parts || 1}|${h.close}`, done = BH_POST.get(key); if (done) return done;
  const net = h.net ?? netPnl(h), tags = [], d = h.side === 'buy' ? 1 : -1, age = Engine.simTime - h.close; let pending = false;
  for (const c of h.ctx || []) if (FLAG_NAMES[c]) tags.push([c, `At entry: ${FLAG_NAMES[c].toLowerCase()}`]);
  if (h.news && h.news.length) tags.push(['newsin', `${h.news[0]} was released while it was open`]);
  if (h.sl0 != null && h.slLast != null && (h.side === 'buy' ? h.slLast < h.sl0 - 1e-9 : h.slLast > h.sl0 + 1e-9)) tags.push(['widened', 'The stop was moved further away than planned']);
  if (net < 0 && /Stop loss/.test(h.reason) && h.sl0 != null) {
    const tgt = h.tp0 ?? h.entry + d * Math.abs(h.entry - h.sl0), fh = firstHit(h.sym, h.side, h.close, null, tgt, 1440);
    if (fh.res === 'tp') tags.push(['stophunt', `Stopped out, then price reached ${h.tp0 != null ? 'your target' : '1R in your favour'} ${bhDur(fh.t - h.close)} later. ${bhRwTxt(h.sym, h.exit, tgt)}, so on its own this says nothing about the idea or the stop`]);
    else if (age < 86400) pending = true;
  }
  if (net < 0 && h.vol && h.sl0 != null && Math.abs(h.exit - h.entry) < Math.abs(h.entry - h.sl0) * .5) tags.push(['panic', 'Closed by hand at less than half the planned loss']);
  if (net > 0 && h.vol && h.tp0 != null) { const fh = firstHit(h.sym, h.side, h.close, h.sl0 ?? h.slLast, h.tp0, 1440); if (fh.res === 'tp') tags.push(['early', `Closed before the target; price reached it ${bhDur(fh.t - h.close)} later. ${bhRwTxt(h.sym, h.exit, h.tp0)}`]); else if (fh.res === 'open' && age < 86400) pending = true; }
  if (h.timeStop && /Time stop/.test(h.reason)) tags.push(['timestop', 'Closed by your time stop']);
  const post = { tags, settled: !pending };
  if (post.settled) { BH_POST.set(key, post); if (BH_POST.size > 1000) BH_POST.delete(BH_POST.keys().next().value); }
  return post;
}
function pmMatch(h) {
  const codes = postMortem(h).tags.map(t => t[0]);
  return (h.pm?.mine || []).filter(r => (PM_MAP[r] || []).some(c => codes.includes(c)));
}

/* ---------- disposition statistics ---------- */
function dispoStats() {
  const d = bhState().dispo, nG = d.rg + d.pg, nL = d.rl + d.pl;
  const pgr = nG ? d.rg / nG : null, plr = nL ? d.rl / nL : null, de = pgr != null && plr != null ? pgr - plr : null;
  const se = de != null ? Math.sqrt((pgr * (1 - pgr)) / nG + (plr * (1 - plr)) / nL) : null; let tstat = se ? de / se : null;
  // all-or-nothing samples (every gain sold, no loss sold) give an unpooled SE of 0: fall back to the pooled two-proportion SE
  if (de && !se) { const pp = (d.rg + d.rl) / (nG + nL), sp = Math.sqrt(pp * (1 - pp) * (1 / nG + 1 / nL)); if (sp) tstat = de / sp; }
  const n = d.rg + d.rl;
  // cumulative path of PGR − PLR over the stored decisions, oldest first (older events carry one sale and a `gain` flag)
  const path = []; let a = { rg: 0, rl: 0, pg: 0, pl: 0 };
  for (const e of d.ev.slice().reverse()) { if (e.rg != null) { a.rg += e.rg; a.rl += e.rl; } else e.gain ? a.rg++ : a.rl++; a.pg += e.pg; a.pl += e.pl; if (a.rg + a.pg && a.rl + a.pl) path.push(a.rg / (a.rg + a.pg) - a.rl / (a.rl + a.pl)); }
  return { pgr, plr, de, ratio: pgr != null && plr ? pgr / plr : null, se, tstat, n, ready: de != null, path };
}
// the one verdict (Behaviour card, toast, score, coach, report): Odean's ratio PGR / PLR, judged only when his t-statistic
// reaches |t| ≥ 2 over at least BH_MIN voluntary closes; anything less is "not clear yet", never "balanced"
const DISPO_T = 2;
function dispoVerdict(ds) {
  const pc = v => (v * 100).toFixed(0) + '%', rt = ds.ratio != null ? ds.ratio.toFixed(2) + '×' : '—', tt = ds.tstat != null ? `t = ${nfx(ds.tstat, 1)}` : 't undefined at this sample';
  let key, html;
  if (ds.de == null && ds.n < 4) { key = 'none'; html = `Close ${4 - ds.n} more trade${ds.n === 3 ? '' : 's'} yourself (not by stop or target) while holding another position to get a first reading. Each voluntary close is compared with everything else you were holding at that moment.`; }
  else if (ds.de == null) { key = 'none'; html = `You need both winning and losing positions in the record to compare them — so far ${ds.pgr == null ? 'none of the positions was in profit' : 'none was in loss'} when you closed something.`; }
  else if (ds.tstat != null && Math.abs(ds.tstat) >= DISPO_T && ds.n >= BH_MIN) {
    key = ds.de > 0 ? 'dispo' : 'reverse';
    html = key === 'dispo' ? `<b class="st-bad">Disposition effect.</b> You realise gains ${ds.ratio != null ? rt + ' as readily as' : 'far more readily than'} losses: ${pc(ds.pgr)} of your gains when you close something, but only ${pc(ds.plr)} of your losses (${tt}) — you bank winners early and give losers more time.`
      : `<b class="st-ok">The reverse of the typical bias.</b> You cut losers (${pc(ds.plr)}) more readily than you take gains (${pc(ds.pgr)}; PGR / PLR ${rt}, ${tt}) — what trend-followers aim for.`;
  } else { key = 'unclear'; html = `<b>Not clear yet.</b> You realise ${pc(ds.pgr)} of gains and ${pc(ds.plr)} of losses (PGR / PLR ${rt}, ${tt}). Odean's test needs |t| ≥ ${DISPO_T}${ds.n < BH_MIN ? ` and at least ${BH_MIN} voluntary closes (you have ${ds.n})` : ''}; a gap this size can be chance.`; }
  return { key, html, text: html.replace(/<[^>]+>/g, ''), clear: key === 'dispo' || key === 'reverse', ratio: ds.ratio, tstat: ds.tstat };
}

/* ---------- Behaviour tab ---------- */
// clear = false (no verdict yet): the needle is drawn muted and dashed, so the coloured zones do not read as a verdict
function deGauge(de, clear = true) {
  const W = 260, H = 112, cx = W / 2, cy = 100, R = 86, ang = v => Math.PI * (1 - (clamp(v, -.5, .5) + .5));
  const pt = (v, r) => [cx + Math.cos(ang(v)) * r, cy - Math.sin(ang(v)) * r];
  const arc = (a, b, col) => { const [x1, y1] = pt(a, R), [x2, y2] = pt(b, R); return `<path d="M${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2}" stroke="${col}" stroke-width="12" fill="none"/>`; };
  const [nx, ny] = de == null ? [cx, cy - R + 20] : pt(de, R - 18);
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img" aria-label="Disposition effect gauge">${arc(-.5, -.1, 'var(--ok)')}${arc(-.1, .1, 'var(--tx3)')}${arc(.1, .5, 'var(--bad)')}
    ${de == null ? '' : `<line x1="${cx}" y1="${cy}" x2="${nx}" y2="${ny}" stroke="var(${clear ? '--tx' : '--tx3'})" stroke-width="2.5" stroke-linecap="round"${clear ? '' : ' stroke-dasharray="4 3"'}/><circle cx="${cx}" cy="${cy}" r="5" fill="var(${clear ? '--tx' : '--tx3'})"/>`}
    </svg><div style="display:flex;justify-content:space-between;gap:8px;font-size:var(--fs-xs);line-height:1.3;color:var(--tx3);margin-top:2px"><span>cuts losers</span><span>banks winners</span></div>`;
}
function bhSpark(path) {
  if (path.length < 2) return '';
  const W = 200, Hh = 30, mn = Math.min(-.2, ...path), mx = Math.max(.2, ...path), y = v => Hh - (v - mn) / (mx - mn) * Hh;
  return `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" aria-label="Disposition effect over time"><line x1="0" x2="${W}" y1="${y(0)}" y2="${y(0)}" stroke="var(--line2)" stroke-dasharray="3 3"/><polyline fill="none" stroke="var(--ind1)" stroke-width="1.6" points="${path.map((v, i) => `${i / (path.length - 1) * W},${y(v)}`).join(' ')}"/></svg>`;
}
function renderBehav() {
  const el = $('#behav'); if (!el) return; bhState();
  const ae = document.activeElement; if (el.contains(ae) && (ae.type === 'text' || ae.type === 'number' || ae.type === 'range')) return;
  const ds = dispoStats(), { pgr, plr, de, n: nSales } = ds, c = pmCfg(), tc = tiltCfg(), tl = tiltStatus();
  const H = bhTrades().filter(h => !h.basket), W = H.filter(h => h.net > 0), L = H.filter(h => h.net <= 0), hold = a => bhMean(a.map(h => h.close - h.open));
  const manW = H.filter(h => h.vol && h.net > 0 && h.tp0 != null), cap = manW.map(h => Math.abs(h.exit - h.entry) / Math.abs(h.tp0 - h.entry));
  const went = manW.slice(0, 40).filter(h => postMortem(h).tags.some(t => t[0] === 'early')).length;
  const widened = H.filter(h => postMortem(h).tags.some(t => t[0] === 'widened'));
  const openP = S.positions.filter(p => !p.basket), openG = openP.filter(p => bhPosNet(p) > 0), openL = openP.filter(p => bhPosNet(p) <= 0), age = a => bhMean(a.map(p => Engine.simTime - p.open));
  const dv = dispoVerdict(ds), verdict = dv.html;
  // pre-mortem stats
  const pmT = H.filter(h => h.pm), flagged = pmT.filter(h => h.pm.flags.length), clean = pmT.filter(h => !h.pm.flags.length), wr = a => a.length ? a.filter(h => h.net > 0).length / a.length * 100 : null;
  const answered = pmT.filter(h => h.net <= 0 && h.pmHit != null), hits = answered.filter(h => h.pmHit).length;
  const skips = S.pmSkip.slice(0, 30).map(s => ({ ...s, ...(s.type === 'basket' ? (typeof bkSkipHit === 'function' ? bkSkipHit(s) : { res: 'open' }) : firstHit(s.sym, s.side, s.t, s.sl, s.tp)) }));
  const saved = skips.filter(s => s.res === 'sl'), missed = skips.filter(s => s.res === 'tp');
  const savedUsd = saved.reduce((a, s) => a + (s.risk || 0), 0), missedUsd = missed.reduce((a, s) => a + (s.reward || 0), 0);
  // red-flag scoreboard over every trade with entry context
  const withCtx = H.filter(h => h.ctx), base = withCtx.filter(h => !h.ctx.length);
  const board = Object.keys(FLAG_NAMES).map(k => { const T = withCtx.filter(h => h.ctx.includes(k)); return { k, n: T.length, wins: bhWins(T), w: wr(T), net: T.reduce((s, h) => s + h.net, 0), r: bhMean(T.filter(h => h.r != null).map(h => h.r)) }; }).filter(x => x.k !== 'tilt').sort((a, b) => (b.n ? 1 : 0) - (a.n ? 1 : 0) || a.net - b.net);
  const ru = rulesCfg(), broke = H.filter(h => h.pm?.broke?.length), brokeNet = broke.reduce((s2, h) => s2 + h.net, 0);
  // calibration: Brier (1950) with Murphy's (1973) parts (brierParts, shared.js) and a Wilson interval per stated probability
  const calT = H.filter(h => h.pm?.conf), cal = CAL_V.map(v => { const T = calT.filter(h => h.pm.conf === v), k = T.filter(h => h.net > 0).length; return { v, n: T.length, k, w: wr(T), ci: wilson(k, T.length) }; });
  const bp = brierParts(calT.map(h => ({ p: h.pm.conf / 100, y: h.net > 0 }))), brier = bp ? bp.bs : null, bss = bp ? bp.bss : null;
  const calK = calT.filter(h => h.net > 0).length, calCi = wilson(calK, calT.length), meanConf = calT.length ? bhMean(calT.map(h => h.pm.conf)) : null, over = calT.length ? meanConf - wr(calT) : null;
  const hrs = Array.from({ length: 24 }, (_, k) => { const T = H.filter(h => Math.floor((h.open % 86400) / 3600) === k); return { k, n: T.length, net: T.reduce((s2, h) => s2 + h.net, 0) }; });
  const hMax = Math.max(1, ...hrs.map(x => Math.abs(x.net))), hRank = hrs.filter(x => x.n >= 2).sort((a, b) => a.net - b.net);
  const post = H.filter(h => h.net <= 0).slice(0, 30).flatMap(h => postMortem(h).tags.filter(t => !FLAG_NAMES[t[0]]).map(t => t[0]));
  const postCount = k => post.filter(x => x === k).length;
  const baseWr = wr(base), sugg = board.filter(x => x.n >= BH_MIN && !BH_DIR_FLAGS.includes(x.k) && x.net < 0 && !ru[x.k] && (baseWr == null || x.w < baseWr - 10)).map(x => x.k);
  // behaviour score: average of whatever components have enough data
  const recent = withCtx.slice(0, 30), pmN = H.filter(h => h.pm).length;
  const comp = [
    // only a clear verdict counts: ratio 1 → 100, 1.5 → 50, 2 or more → 0; the reverse bias scores 100
    ['Disposition', dv.key === 'dispo' ? (ds.ratio == null ? 0 : clamp(100 - (ds.ratio - 1) * 100, 0, 100)) : dv.key === 'reverse' ? 100 : null, 'Let losers go as readily as winners — close the trade you would not open today.'],
    ['Clean entries', recent.length >= 5 ? recent.filter(h => !h.ctx.some(c => !BH_DIR_FLAGS.includes(c))).length / recent.length * 100 : null, 'Most of your recent entries carried a risk flag (stop, size, cost, news, timing or stacking) — fix those before the next trade.'],
    ['Stops not widened', H.filter(h => h.sl0 != null).length >= 5 ? 100 - widened.length / H.filter(h => h.sl0 != null).length * 100 : null, 'Stop widening is the most expensive habit — move stops only toward profit.'],
    // Brier skill score against your own base rate: 50 = no better than always stating your win rate, 100 = perfect, 0 = BSS −1
    ['Forecast skill (BSS)', bss != null && calT.length >= BH_CAL_N ? clamp(50 + 50 * bss, 0, 100) : null, 'Your stated odds do worse than simply stating your own win rate every time — rate trades closer to what actually happens.'],
    ['Discipline', pmN + (S.tiltSt.trips || 0) >= 3 ? clamp(100 - ((S.tiltSt.overrides || 0) + (S.tiltSt.ruleBreaks || 0)) / Math.max(1, pmN) * 150, 0, 100) : null, 'You override your own guard rails often — each override is a trade you said you would not take.']
  ];
  const have = comp.filter(x => x[1] != null), score = have.length ? bhMean(have.map(x => x[1])) : null, worstC = have.slice().sort((a, b) => a[1] - b[1])[0];
  const grade = score == null ? '—' : score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 55 ? 'C' : score >= 40 ? 'D' : 'E';
  // process vs outcome (Baron & Hershey 1988): judge the decision by what was knowable at entry, not by the P&L
  // good process = stop at entry, risk ≤ 2% of equity, spread < 15% of the stop distance (the nosl / size / cost checks);
  // trend and chase warnings are left out: on a zero-drift market they do not change the expectancy
  const goodProc = h => (h.sl0 != null || h.r != null) && !(h.ctx || []).some(c => ['nosl', 'size', 'cost'].includes(c));
  const PO = withCtx.slice(0, 60), q = [[true, true], [true, false], [false, true], [false, false]].map(([gp, w]) => { const T = PO.filter(h => goodProc(h) === gp && (h.net > 0) === w); return { n: T.length, net: T.reduce((a, h) => a + h.net, 0) }; });
  const winsN = q[0].n + q[2].n, luck = winsN ? q[2].n / winsN * 100 : null;
  const moodT = H.filter(h => h.pm?.mood), moods = MOODS.map(m => { const T = moodT.filter(h => h.pm.mood === m); return { m, n: T.length, wins: bhWins(T), w: wr(T), net: T.reduce((a, h) => a + h.net, 0) }; }).filter(x => x.n);
  // score history (one point per sim hour)
  if (!S.bhScoreHist) S.bhScoreHist = [];
  if (score != null) { const hk = Math.floor(Engine.simTime / 3600), lastS = S.bhScoreHist[S.bhScoreHist.length - 1]; if (!lastS || lastS.h !== hk) { S.bhScoreHist.push({ h: hk, s: Math.round(score) }); if (S.bhScoreHist.length > 240) S.bhScoreHist.shift(); } else lastS.s = Math.round(score); }
  const sh = S.bhScoreHist, shSvg = sh.length > 1 ? (() => { const W = 140, Hh = 26, y = v => Hh - v / 100 * Hh; return `<svg viewBox="0 0 ${W} ${Hh}" width="${W}" height="${Hh}" aria-label="Score history"><line x1="0" x2="${W}" y1="${y(70)}" y2="${y(70)}" stroke="var(--line2)" stroke-dasharray="2 3"/><polyline fill="none" stroke="var(--ind1)" stroke-width="1.6" points="${sh.map((p2, i) => `${i / (sh.length - 1) * W},${y(p2.s)}`).join(' ')}"/></svg>`; })() : '';
  BH_LAST = { score, grade, comp, q, luck, moods, ds, brier, bss, bp, calT: calT.length, over, calCi, meanConf, board, ru, hrs: hRank, H: H.length, skips: S.pmSkip.length };
  // the score is the hero figure (mono, ink); the grade is a key value beside it; "not enough data" stays secondary text
  const scoreHtml = `<section class="bh-card bh-score"><div class="bh-score-g ${score == null ? '' : score >= 70 ? 'st-ok' : score >= 50 ? '' : 'st-bad'}"><label class="bh-lab">Behaviour score</label>
      <div class="bh-hero">${score == null ? '<span class="bh-nd">not enough data</span>' : `<b class="bh-num mono">${score.toFixed(0)}</b><small class="mono">/ 100</small>`}<span class="bh-grade" title="Grade: A ≥ 85 · B ≥ 70 · C ≥ 55 · D ≥ 40 · E below"><span class="bh-lab">Grade</span><b>${grade}</b></span></div>${shSvg ? `<div class="bh-score-h" title="Score per sim hour">${shSvg}</div>` : ''}</div>
    <div class="bh-score-c" style="align-items:end">${comp.map(([n, v]) => `<div class="${v == null ? 'z' : ''}"><label style="white-space:normal;overflow:visible;line-height:1.25">${n}</label><div class="bh-meter"><i style="width:${v == null ? 0 : v.toFixed(0)}%" class="${v == null ? '' : v >= 70 ? 'st-ok' : v >= 50 ? 'mid' : 'st-bad'}"></i></div><span class="mono">${v == null ? '—' : v.toFixed(0)}</span></div>`).join('')}</div>
    <div class="bh-score-t"><div class="bh-score-a">${score == null ? '<button type="button" class="btn-pri bh-open" id="bhOpenTrade">Open Trade</button>' : '<button class="link bh-rep" id="bhReport">Download report</button>'}</div><p class="small">${score == null ? 'Each part needs a few trades before it counts: voluntary closes, entries, stops, rated pre-mortems and guard-rail decisions.' : worstC[1] < 70 ? `<b>Focus next — ${worstC[0].toLowerCase()}:</b> ${worstC[2]}` : 'All measured habits are in good shape. Keep the rules that got you here.'}${sugg.length ? ` <button type="button" class="link bh-go" data-bhgo="flags">${sugg.length} rule suggestion${sugg.length > 1 ? 's' : ''} in the Red-flag scoreboard</button>` : ''}</p></div></section>`;
  const skipName = s => bhEsc(s.type === 'basket' ? s.name : pretty(s.sym));
  el.innerHTML = `${scoreHtml}<div class="bh-col">
    <section class="bh-card"><h3>Disposition effect <a class="obs-src" href="https://onlinelibrary.wiley.com/doi/abs/10.1111/0022-1082.00072" target="_blank" rel="noopener" title="Research: Odean (1998), Are investors reluctant to realize their losses? Journal of Finance">Odean (1998), Are investors reluctant to realize their losses?</a></h3>
      <div class="bh-de"><div class="bh-gauge">${deGauge(ds.ready ? de : null, dv.clear)}<div class="bh-de-v mono">${ds.ready ? (de >= 0 ? '+' : '') + de.toFixed(2) : '—'}</div></div>
      <div class="bh-de-txt"><p>${verdict}</p>${ds.path.length > 2 ? `<div class="bh-sp"><label class="bh-lab">PGR − PLR over your last ${ds.path.length} closes</label>${bhSpark(ds.path)}</div>` : ''}
      <div class="obs-kpis bh-kpis" style="grid-template-columns:repeat(2,minmax(0,1fr))">${kpi('Gains realised (PGR)', pgr != null ? (pgr * 100).toFixed(0) + '%' : '—')}${kpi('Losses realised (PLR)', plr != null ? (plr * 100).toFixed(0) + '%' : '—')}${kpi('Voluntary closes', nSales)}${kpi('Loser hold time', W.length && L.length ? `${(hold(L) / Math.max(60, hold(W))).toFixed(1)}×` : '—', W.length && L.length && hold(L) > hold(W) * 1.3 ? 'st-bad' : '')}</div></div></div>
      <div class="bh-grid">
        <div class="ins"><label>Winners closed by hand</label><p>${manW.length ? `You captured <b>${(bhMean(cap) * 100).toFixed(0)}%</b> of the planned target on ${manW.length} winner${manW.length > 1 ? 's' : ''}. ${went ? `<b class="st-bad">${went}</b> went on to hit the original target after you closed.` : 'None went on to hit the target afterwards.'}` : 'No hand-closed winners with a target yet.'}</p></div>
        <div class="ins"><label>Stops moved away</label><p>${widened.length ? `<b class="st-bad">${widened.length}</b> trade${widened.length > 1 ? 's' : ''} ended with a wider stop than planned — net ${usdFmt(widened.reduce((a, h) => a + h.net, 0), true)}.` : 'None — you kept your original stops.'}</p></div>
        <div class="ins"><label>Holding right now</label><p>${openP.length ? `${openG.length} in profit (avg ${openG.length ? bhDur(age(openG)) : '—'}) · ${openL.length} in loss (avg ${openL.length ? bhDur(age(openL)) : '—'}).${openL.length && openG.length && age(openL) > age(openG) * 1.5 ? ' <span class="st-bad">Losers are being held longer.</span>' : ''}` : 'No open positions.'}</p></div>
      </div>
      ${bhMore('dispo', 'Measured the way Odean did: only trades you close yourself count', `<p class="small muted">Measured the way Odean did: every time you close a trade yourself, it counts as a realised gain or loss and every other open position as a paper gain or loss. Stops, targets, time stops and basket legs are excluded — they are plans, not in-the-moment decisions.</p>`)}
    </section>
    <section class="bh-card"><h3>Tilt guard</h3>
      <div class="bh-tilt ${tl.armed ? 'on' : ''}${tl.armed && tl.cooling && !tl.paused ? ' cool' : ''}"><div><b>${tl.paused ? `Paused · ${bhClock(tl.left)}` : !tc.on ? 'Guard off' : tl.armed ? (tl.cooling ? `Cooling down · ${bhClock(tl.left)}` : 'Armed — pre-mortem on every trade') : 'Calm'}</b><span class="muted small">${tl.armed ? tl.why : `${tl.streak} loss${tl.streak === 1 ? '' : 'es'} in a row · today ${usdFmt(tl.dayPnl, true)} (${tl.dayPct >= 0 ? '+' : ''}${tl.dayPct.toFixed(2)}%)`}</span></div>
        <div class="obs-kpis bh-kpis three">${kpi('Times triggered', S.tiltSt.trips)}${kpi('Overrides', S.tiltSt.overrides, S.tiltSt.overrides ? 'st-bad' : '')}${kpi('After-loss trades', H.filter(h => (h.ctx || []).includes('revenge')).length)}</div></div>
      <div class="bh-pause"><span class="small muted">Step away on your own terms</span>${tl.paused ? `<b class="mono">Paused · ${bhClock(tl.left)}</b><button class="ghost sm" data-pause="0">Resume now</button>` : [[900, '15 min'], [3600, '1 hour'], [Math.max(600, 86400 - (Engine.simTime % 86400)), 'Rest of day']].map(([v, l]) => `<button class="ghost sm" data-pause="${v}">Pause ${l}</button>`).join('')}</div>
      <div class="bh-set"><label class="tgl"><input type="checkbox" id="tlOn" ${tc.on ? 'checked' : ''}> Guard on</label>
        <label>after <select id="tlStreak">${[2, 3, 4, 5].map(v => `<option ${v === tc.streak ? 'selected' : ''}>${v}</option>`).join('')}</select> losses in a row</label>
        <label>or a day down <select id="tlDay">${[1, 2, 3, 5].map(v => `<option value="${v}" ${v === tc.dayLoss ? 'selected' : ''}>${v}%</option>`).join('')}</select></label>
        <label>cool-down <select id="tlCool">${[5, 15, 30, 60].map(v => `<option value="${v}" ${v === tc.cool ? 'selected' : ''}>${v} min</option>`).join('')}</select></label></div>
      ${bhMore('tilt', 'When it trips: a cool-down, then a pre-mortem on every trade; overrides are counted', `<p class="small muted">When it trips, new trades wait out the cool-down (sim time) and need a pre-mortem until a winning trade breaks the streak. You can override — overrides are counted.</p>`)}
    </section>
    <section class="bh-card"><h3>Confidence calibration <a class="obs-src" href="https://journals.ametsoc.org/view/journals/mwre/78/1/1520-0493_1950_078_0001_vofeit_2_0_co_2.xml" target="_blank" rel="noopener" title="Research: Brier (1950), Verification of forecasts expressed in terms of probability. Monthly Weather Review">Brier (1950), Verification of forecasts expressed in terms of probability</a></h3>
      <div class="bh-cal">${calSvg(cal)}<div><p class="small">${calT.length < BH_CAL_N ? `Pick a probability in the pre-mortem ("How likely is it to work?"). Need ${BH_CAL_N - calT.length} more rated trade${BH_CAL_N - calT.length === 1 ? '' : 's'} before judging over- or underconfidence — then you will see whether your 70% really wins 70% of the time.` : meanConf / 100 > calCi.hi ? `<b class="st-bad">Overconfident by ${over.toFixed(0)} points.</b> You expect ${meanConf.toFixed(0)}% on average and win ${wrTxt(calK, calT.length)} — your average is above the whole 95% interval.` : meanConf / 100 < calCi.lo ? `<b class="st-warn">Underconfident by ${Math.abs(over).toFixed(0)} points</b> — you expect ${meanConf.toFixed(0)}% and win ${wrTxt(calK, calT.length)}.` : `<b>No clear miscalibration.</b> You expect ${meanConf.toFixed(0)}% on average and win ${wrTxt(calK, calT.length)}; the gap is within the 95% interval.`}</p>
        <div class="obs-kpis bh-kpis three">${kpi('Rated trades', calT.length)}${kpi('Brier score', brier != null ? brier.toFixed(3) : '—')}${kpi('Skill (BSS)', bss != null ? nfx(bss, 2) : '—', bss == null || calT.length < BH_CAL_N ? '' : bss > 0 ? 'st-ok' : bss < 0 ? 'st-bad' : '')}</div>
        ${bp ? `<p class="small mono">Brier ${bp.bs.toFixed(3)} = reliability ${bp.rel.toFixed(3)} − resolution ${bp.res.toFixed(3)} + uncertainty ${bp.unc.toFixed(3)} · base rate ${(bp.base * 100).toFixed(0)}%</p>` : ''}
        ${bhMore('cal', 'Brier: lower is better · BSS 0 = no better than stating your own win rate · 95% intervals (Wilson)', `<p class="small muted">Brier score is the mean squared gap between the probability you gave and what happened (1 = win, 0 = loss); lower is better. Murphy's parts: reliability is how far your stated odds sit from what happened at each level (lower is better), resolution how well your odds separate winners from losers (higher is better), uncertainty what your own win rate alone leaves. The skill score BSS = 1 − Brier / uncertainty: 0 means no better than stating your own win rate every time, below 0 worse. Dots show each level with its 95% interval (Wilson).</p>`)}</div></div>
    </section>
    <section class="bh-card"><h3>Your trading hours <span class="muted small">net P&amp;L by UTC hour of entry</span></h3>
      <div class="bh-hrs">${hrs.map(x => `<div title="${String(x.k).padStart(2, '0')}:00 UTC · ${x.n} trade${x.n === 1 ? '' : 's'} · ${usdFmt(x.net, true)}" style="--h:${(Math.abs(x.net) / hMax * 100).toFixed(0)}%" class="${x.n ? (x.net >= 0 ? 'up' : 'dn') : 'z'}"><i></i></div>`).join('')}</div>
      <div class="bh-hrs-ax"><span>00</span><span>06</span><span>12</span><span>18</span><span>23</span></div>
      <p class="small">${hRank.length >= 2 ? `Worst hour <b class="dn">${String(hRank[0].k).padStart(2, '0')}:00</b> (${usdFmt(hRank[0].net, true)}, n=${hRank[0].n}${bhChance(hRank[0].n)}) · best <b class="up">${String(hRank[hRank.length - 1].k).padStart(2, '0')}:00</b> (${usdFmt(hRank[hRank.length - 1].net, true)}, n=${hRank[hRank.length - 1].n}${bhChance(hRank[hRank.length - 1].n)}). A gap between hours is mostly noise until each hour has ${BH_N}+ trades.` : '<span class="muted">Needs at least two hours with two or more trades each.</span>'}</p>
    </section>
    <section class="bh-card"><h3>Process vs outcome <a class="obs-src" href="https://www.sas.upenn.edu/~baron/papers/outcomebias.pdf" target="_blank" rel="noopener" title="Research: Baron &amp; Hershey (1988), Outcome bias in decision evaluation. Journal of Personality and Social Psychology">Baron &amp; Hershey (1988), Outcome bias in decision evaluation</a></h3>
      <table class="tbl bh-pot"><thead><tr><th scope="col">Process</th><th scope="col">Won</th><th scope="col">Lost</th></tr></thead><tbody>
        ${[['Good process', [[0, 'dw', 'Deserved win'], [1, 'bb', 'Bad break']]], ['Poor process', [[2, 'dl', 'Dumb luck'], [3, 'pj', 'Poetic justice']]]].map(([row, cells]) => `<tr><th scope="row">${row}</th>${cells.map(([k, c, lab]) => `<td class="po ${c}"><b class="mono">${q[k].n}</b><span>${lab}</span><small class="mono ${cls(q[k].net)}">${usdFmt(q[k].net, true)}</small></td>`).join('')}</tr>`).join('')}</tbody></table>
      <p class="small">${PO.length < 6 ? 'A few more trades and this shows how much of your P&amp;L came with sound risk control and how much without it.' : `${luck != null ? `<b class="${luck > 40 ? 'st-bad' : ''}">${luck.toFixed(0)}%</b> of your wins (n=${winsN}) came from poor-process trades — results you should not repeat on purpose. ` : ''}${q[1].n ? `${q[1].n} good-process trade${q[1].n > 1 ? 's' : ''} lost anyway — a loss with a sound plan is not a mistake.` : ''}`}</p>
      ${bhMore('po', `Good process = a stop, risk ≤ 2% of equity, spread under 15% of the stop · last ${PO.length} trades`, `<p class="small muted">Good process = a stop at entry, risk ≤ 2% of equity, and spread under 15% of the stop distance. Trend and chase warnings are not part of it: only risk control is judged. Last ${PO.length} trades.</p>`)}
    </section>
    <section class="bh-card"><h3>Mood at entry <span class="muted small">from the pre-mortem</span></h3>
      ${moods.length ? `<div class="bh-board-w"><table class="tbl sm bh-board"><thead><tr><th>Feeling</th><th>Trades</th><th>Win rate</th><th>Net</th></tr></thead><tbody>${moods.sort((a, b) => a.net - b.net).map(x => `<tr class="${x.n < BH_MIN ? 'z' : ''}"><td>${bhEsc(x.m)}</td><td class="mono">${x.n} <small class="muted bh-note">${x.n < BH_N ? 'may be chance' : ''}</small></td><td class="mono ${x.n >= BH_MIN && x.w < 40 ? 'st-bad' : ''}">${bhWrCell(x.wins, x.n)}</td><td class="mono ${x.n >= BH_MIN ? cls(x.net) : ''}">${usdFmt(x.net, true)}</td></tr>`).join('')}</tbody></table></div>
        <p class="small">${(() => { const mw = moods.filter(x => x.n >= BH_MIN)[0]; return !mw ? `No mood has ${BH_MIN}+ tagged trades yet — too few to say which states cost money.` : mw.net < 0 ? `Trading while <b>${bhEsc(mw.m)}</b>: ${usdFmt(mw.net)} over ${mw.n} trades (n=${mw.n}${bhChance(mw.n)}).` : `No mood with ${BH_MIN}+ trades is losing money.`; })()}</p>` : '<p class="small muted">Tag how you feel in the pre-mortem — calm, bored, anxious, FOMO… With 10+ trades per mood you will see which states go with losses.</p>'}
    </section></div>
    <div class="bh-col">
    <section class="bh-card"><h3>Pre-mortem <a class="obs-src" href="https://hbr.org/2007/09/performing-a-project-premortem" target="_blank" rel="noopener" title="Research: Klein (2007), Performing a project premortem. Harvard Business Review">Klein (2007), Performing a project premortem</a></h3>
      ${c.off ? '<p class="small st-bad">All pre-mortems are off from the account menu: no trade asks first, not even under the tilt guard or your rules.</p>' : ''}
      <div class="bh-set"><label class="tgl"><input type="checkbox" id="pmOn" ${c.on ? 'checked' : ''}> Ask before risky trades</label>
        <label>when risk ≥ <input type="range" id="pmMin" min="0" max="3" step=".25" value="${c.minRisk}"> <b class="mono" id="pmMinV">${c.minRisk}%</b></label>
        <label class="tgl"><input type="checkbox" id="pmNoSL" ${c.noSL ? 'checked' : ''}> always without a stop</label>
        <button class="ghost sm" id="pmTry">Try it on the ticket</button>${c.on && pmSkipping() ? `<span class="small muted">Skipped until ${hhmm(c.until)} UTC (sim) · <button class="link" id="pmResume">resume now</button></span>` : ''}${c.skips ? `<span class="small muted">Skipped for an hour ${c.skips} time${c.skips === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="obs-kpis bh-kpis">${kpi('Pre-mortem trades', pmT.length)}${kpi('Wins · red flags', flagged.length ? bhWrCell(bhWins(flagged), flagged.length) + ` <small>n=${flagged.length}</small>` : '—', flagged.length >= BH_MIN && wr(flagged) < 45 ? 'st-bad' : '')}${kpi('Wins · no flags', clean.length ? bhWrCell(bhWins(clean), clean.length) + ` <small>n=${clean.length}</small>` : '—')}${kpi('Losses foreseen', answered.length ? `${hits}/${answered.length}` : '—')}</div>
      <div class="bh-grid two">
        <div><label class="bh-lab">Review · automatic post-mortem</label>${pmT.slice(0, 5).map(h => { const i = h.id, pmo = postMortem(h), mt = pmMatch(h), auto = pmo.tags.filter(t => !FLAG_NAMES[t[0]]); return `<div class="pm-rev"><div class="top"><span>${pretty(h.sym)} <span class="tag ${h.side}">${h.side}</span> <span class="muted small">${dts(h.close)} · ${bhEsc(h.reason)}</span></span><span class="pm-rev-r"><button class="link" data-show="${i}">Chart</button><b class="${cls(h.net)}">${usdFmt(h.net, true)}</b></span></div>
          <div class="small"><span class="muted">You expected:</span> ${[...h.pm.mine, h.pm.own].filter(Boolean).map(bhEsc).join(' · ') || '—'}</div>
          ${auto.length ? `<div class="small"><span class="muted">What happened:</span> ${auto.map(t => bhEsc(t[1])).join(' · ')}</div>` : pmo.settled ? '' : '<div class="small muted">Still watching the next 24h of price…</div>'}
          ${h.pm.kill ? `<div class="small"><span class="muted">Exit plan:</span> ${bhEsc(h.pm.kill)}</div>` : ''}
          ${h.net <= 0 ? `<div class="pm-ask">${mt.length ? `<span class="pm-ev">Evidence matches "${bhEsc(mt[0])}".</span>` : ''} <span id="pmQ${i}">Did it fail for a reason you named?</span> <span class="pm-yn" role="group" aria-labelledby="pmQ${i}"><button type="button" class="${h.pmHit === true ? 'on' : ''}" aria-pressed="${h.pmHit === true}" data-hit="${i}" data-v="1">Yes</button><button type="button" class="${h.pmHit === false ? 'on' : ''}" aria-pressed="${h.pmHit === false}" data-hit="${i}" data-v="0">No, something else</button></span></div>` : ''}</div>`; }).join('') || '<p class="small muted">Trades placed through a pre-mortem appear here once closed, with what actually happened next to what you expected.</p>'}</div>
        <div><label class="bh-lab">Trades you talked yourself out of · ${S.pmSkip.length}</label>
          ${skips.length ? `<p class="small">${saved.length} would have hit the stop (<b class="up">${usdFmt(savedUsd)} saved</b>), ${missed.length} the target (<b class="dn">${usdFmt(missedUsd)} missed</b>), ${skips.length - saved.length - missed.length} undecided.</p>` : '<p class="small muted">When you press "Rethink", the skipped trade is tracked against live prices.</p>'}
          ${skips.slice(0, 6).map(s => `<div class="pm-skip"><span>${skipName(s)} <span class="tag ${bhEsc(s.side)}">${bhEsc(s.side)}</span></span><span class="muted small">${dts(s.t)}</span><b class="${s.res === 'sl' ? 'st-ok' : s.res === 'tp' ? 'st-bad' : 'muted'}">${s.res === 'sl' ? 'avoided loss' : s.res === 'tp' ? 'missed win' : s.sl == null && s.tp == null ? 'no levels' : 'open'}</b></div>`).join('')}</div>
      </div></section>
    <section class="bh-card"><h3>Red-flag scoreboard <span class="muted small">every trade, checked at entry</span></h3>
      ${`<div class="bh-board-w"><table class="tbl sm bh-board"><thead><tr><th>Warning at entry</th><th>Trades</th><th>Win rate</th><th>Avg R</th><th>Net</th><th>Rule</th></tr></thead><tbody>
        ${board.map(x => `<tr class="${x.n ? '' : 'z'}"><td>${FLAG_NAMES[x.k]}</td><td class="mono">${x.n || '—'}</td><td class="mono ${x.n >= BH_MIN && x.w < 40 ? 'st-bad' : ''}">${bhWrCell(x.wins, x.n)}</td><td class="mono ${cls(x.r)}">${x.r ? sgn(x.r, 2) + 'R' : '—'}</td><td class="mono ${cls(x.net)}">${x.n ? usdFmt(x.net, true) : '—'}</td><td class="bh-rule-c">${sugg.includes(x.k) ? `<button type="button" class="bh-sug btn-pri" data-sug="${x.k}" title="Losing more often than your no-warning trades — make it a pre-mortem rule">suggest</button>` : ''}<select class="bh-rule ${ru[x.k] || ''}" data-rule="${x.k}" aria-label="Rule for ${FLAG_NAMES[x.k]}"><option value="">warn</option><option value="gate" ${ru[x.k] === 'gate' ? 'selected' : ''}>pre-mortem</option><option value="block" ${ru[x.k] === 'block' ? 'selected' : ''}>block</option></select></td></tr>`).join('')}
        <tr class="bh-base"><td>No warnings</td><td class="mono">${base.length}</td><td class="mono">${bhWrCell(bhWins(base), base.length)}</td><td class="mono">${base.filter(h => h.r != null).length ? sgn(bhMean(base.filter(h => h.r != null).map(h => h.r)), 2) + 'R' : '—'}</td><td class="mono ${cls(base.reduce((s, h) => s + h.net, 0))}">${usdFmt(base.reduce((s, h) => s + h.net, 0), true)}</td><td></td></tr></tbody></table></div>
        ${Object.keys(ru).length ? `<p class="small"><b>${Object.keys(ru).length}</b> rule${Object.keys(ru).length > 1 ? 's' : ''} active · broken ${S.tiltSt.ruleBreaks || 0} time${S.tiltSt.ruleBreaks === 1 ? '' : 's'}${broke.length ? ` · trades that broke a rule: <b class="${cls(brokeNet)}">${usdFmt(brokeNet, true)}</b> over ${broke.length}` : ''}.</p>` : ''}
        ${post.length ? `<p class="small"><span class="muted">After the fact, across recent losers:</span> ${[['stophunt', 'stopped out, then the target was reached'], ['newsin', 'news hit while open'], ['widened', 'stop widened'], ['panic', 'closed in panic']].filter(([k]) => postCount(k)).map(([k, t]) => `<b>${postCount(k)}</b> ${t}`).join(' · ') || 'no recurring pattern yet'}.</p>` : ''}
        ${bhMore('flags', `Fewer than ${BH_N} trades may be chance · 95% intervals (Wilson)`, `<p class="small muted">${withCtx.length < 15 ? `Only ${withCtx.length} trades so far. ` : 'Rows at the top cost you the most. '}Rows with fewer than ${BH_N} trades may be chance; rules are suggested only from ${BH_MIN}+ trades, and never for trend or chase warnings. Win rates show their 95% interval (Wilson). Turn a warning into a rule: <b>pre-mortem</b> always asks first, <b>block</b> stops the trade unless you deliberately break the rule.</p>`)}`}
    </section></div>`;
}
// bins: { v: stated %, n, w: won %, k?: wins, ci?: Wilson interval } — with an interval, a dot is miscalibrated only when the
// stated level lies outside it (red: overconfident, caution: underconfident); without one, a 10-point gap marks it
function calSvg(cal) {
  const W = 150, P = 18, X = v => P + v / 100 * (W - P - 6), Y = v => W - P - v / 100 * (W - P - 6), mx = Math.max(1, ...cal.map(c => c.n)), pc = v => Math.round(v * 100);
  const col = c => c.ci ? (c.ci.hi * 100 < c.v ? 'var(--bad)' : c.ci.lo * 100 > c.v ? 'var(--warn)' : 'var(--ok)') : c.w < c.v - 10 ? 'var(--bad)' : c.w > c.v + 10 ? 'var(--warn)' : 'var(--ok)';
  return `<svg viewBox="0 0 ${W} ${W}" width="${W}" height="${W}" role="img" aria-label="Calibration: stated probability vs actual win rate"><rect x="${P}" y="6" width="${W - P - 6}" height="${W - P - 6}" fill="none" stroke="var(--line)"/>
    <line x1="${X(0)}" y1="${Y(0)}" x2="${X(100)}" y2="${Y(100)}" stroke="var(--tx3)" stroke-dasharray="3 3"/>
    ${cal.filter(c => c.n && c.ci).map(c => `<line x1="${X(c.v)}" x2="${X(c.v)}" y1="${Y(c.ci.lo * 100)}" y2="${Y(c.ci.hi * 100)}" stroke="var(--tx3)" stroke-width="1"/>`).join('')}
    ${cal.filter(c => c.n).map(c => `<circle cx="${X(c.v)}" cy="${Y(c.w)}" r="${3 + c.n / mx * 6}" fill="${col(c)}" fill-opacity=".75"><title>${c.ci ? `Said ${c.v}% · won ${c.k} of ${c.n} = ${c.w.toFixed(0)}% (${pc(c.ci.lo)}–${pc(c.ci.hi)}%)` : `Said ${c.v}% · won ${c.w.toFixed(0)}% of ${c.n}`}</title></circle>`).join('')}
    <text x="${X(50)}" y="${W - 4}" class="g-lab" text-anchor="middle">you said</text><text x="9" y="${Y(50)}" class="g-lab" text-anchor="middle" transform="rotate(-90 9 ${Y(50)})">you won</text></svg>`;
}
function bhShowTrade(h) {
  if (!h) return;
  if (S.set.sym !== h.sym) setSymbol(h.sym);
  const pad = Math.max(S.set.tf * 60 * 30, (h.close - h.open) * .6);
  try { chart.timeScale().setVisibleRange({ from: h.open - pad, to: h.close + pad }); } catch (e) { }
  BH_SHOW.forEach(l => { try { candle.removePriceLine(l); } catch (e) { } }); BH_SHOW.length = 0;
  const c = chartColors();
  BH_SHOW.push(candle.createPriceLine({ price: h.entry, color: c.acc, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `#${h.id} entry` }));
  BH_SHOW.push(candle.createPriceLine({ price: h.exit, color: (h.net ?? h.pnl) >= 0 ? c.up : c.dn, lineWidth: 1, lineStyle: 2, axisLabelVisible: true, title: `exit ${usdFmt(h.net ?? h.pnl, true)}` }));
  if (h.sl0 != null) BH_SHOW.push(candle.createPriceLine({ price: h.sl0, color: c.dn, lineWidth: 1, lineStyle: 1, axisLabelVisible: false, title: 'planned stop' }));
  clearTimeout(BH_SHOW.t); BH_SHOW.t = setTimeout(() => { BH_SHOW.forEach(l => { try { candle.removePriceLine(l); } catch (e) { } }); BH_SHOW.length = 0; }, 20000);
  $('#chart')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  toast(`Trade #${h.id} on the chart`, `${pretty(h.sym)} ${h.side} · ${dts(h.open)} → ${dts(h.close)}`, 'info');
}
const BH_SHOW = [];
let BH_LAST = null;
function bhReport() {
  const L = BH_LAST; if (!L) return;
  const f = v => v == null ? '—' : typeof v === 'number' ? v.toFixed(0) : v, d = new Date(Engine.simTime * 1000).toISOString().slice(0, 16).replace('T', ' ');
  const md = [`# tradeBerry — behaviour report`, `${d} UTC · ${L.H} closed trades`, ...(S.demo ? ['', '**Demo account: example trades** — generated to show the tools, not your own trading.'] : []), '',
    `## Score: ${L.grade} (${f(L.score)} / 100)`, ...L.comp.map(([n, v]) => `- ${n}: ${f(v)}`), '',
    `## Disposition effect`, L.ds.ready ? `PGR ${(L.ds.pgr * 100).toFixed(0)}% · PLR ${(L.ds.plr * 100).toFixed(0)}% · PGR / PLR ${L.ds.ratio != null ? L.ds.ratio.toFixed(2) : '—'}${L.ds.tstat != null ? ` (t = ${nfx(L.ds.tstat, 1)}, ${L.ds.n} voluntary closes)` : ''}` : 'Not enough voluntary closes yet.', dispoVerdict(L.ds).text, '',
    `## Process vs outcome`, 'Good process = stop at entry, risk ≤ 2% of equity, spread < 15% of the stop distance.', `- Deserved wins: ${L.q[0].n} (${usdFmt(L.q[0].net, true)})`, `- Bad breaks: ${L.q[1].n} (${usdFmt(L.q[1].net, true)})`, `- Dumb luck: ${L.q[2].n} (${usdFmt(L.q[2].net, true)})`, `- Poetic justice: ${L.q[3].n} (${usdFmt(L.q[3].net, true)})`, '',
    `## Red flags at entry`, '| Warning | Trades | Win rate | Net | Rule |', '|---|---|---|---|---|', ...L.board.filter(x => x.n).map(x => `| ${FLAG_NAMES[x.k]} | ${x.n} | ${wrTxt(x.wins, x.n)} | ${usdFmt(x.net, true)} | ${L.ru[x.k] || 'warn'} |`), '',
    `## Calibration`, L.calT ? `${L.calT} rated trades · Brier ${L.brier.toFixed(3)} = reliability ${L.bp.rel.toFixed(3)} − resolution ${L.bp.res.toFixed(3)} + uncertainty ${L.bp.unc.toFixed(3)} · BSS ${L.bss != null ? nfx(L.bss, 2) : '—'} · ${L.calT < BH_CAL_N ? `need ${BH_CAL_N - L.calT} more rated trades before judging over- or underconfidence` : L.meanConf / 100 > L.calCi.hi ? `overconfident by ${Math.abs(L.over).toFixed(0)} points` : L.meanConf / 100 < L.calCi.lo ? `underconfident by ${Math.abs(L.over).toFixed(0)} points` : 'no clear miscalibration (within the 95% interval)'}` : 'No rated trades yet.', '',
    `## Mood at entry`, ...(L.moods.length ? L.moods.map(x => `- ${x.m}: ${wrTxt(x.wins, x.n)} wins${bhChance(x.n)}, ${usdFmt(x.net, true)}${x.n < BH_MIN ? ' (too few for a verdict)' : ''}`) : ['No tagged trades yet.']), '',
    `Skipped in pre-mortems: ${L.skips}`, '', 'Not investment advice.'].join('\n');
  try { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([md], { type: 'text/markdown' })); a.download = `tradeberry-behaviour-${d.slice(0, 10)}.md`; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { }
  navigator.clipboard?.writeText(md).catch(() => { });
  toast('Behaviour report ready', 'Downloaded as Markdown and copied to the clipboard', 'info');
}
function bhTick() {
  bhState();
  // news released while positions are open
  if (typeof CAL !== 'undefined') for (const e of CAL.events) if (e.done && !e._bh) { e._bh = 1; for (const p of S.positions) { const m = M(p.sym); if (m && e.impact === 'hi' && m.newsCcy.includes(e.ccy)) (p.news = p.news || []).push(`${e.ccy} ${e.name}`); } }
  // time stops
  // (a closed market cannot fill: the time stop waits for the open instead of being refused every second)
  // (the live account's time stops run on the execution server, Task 9)
  if (!TradeLink.live) for (const p of [...S.positions]) if (p.timeStop && !p.basket && Engine.simTime - p.open >= p.timeStop && M(p.sym) && marketOpen(p.sym)) { if (posPnl(p).pnl <= 0) closePosition(p.id, 'Time stop'); else { p.timeStop = 0; toast(`${pretty(p.sym)} #${p.id} passed its time stop`, 'In profit at the deadline, so it stays open', 'info'); } }
  // live tilt countdown in the tab
  if (activeTab === 'behav' && S.tiltSt.until > Engine.simTime - 2) { const b = $('#behav .bh-tilt b'); const t = tiltStatus(); if (b && t.cooling) b.textContent = `Cooling down · ${bhClock(t.left)}`; }
}
// turning pre-mortems off for good (decision 36): only from here, after showing what they caught
function pmAskOff() {
  const H = bhTrades().filter(h => !h.basket), pmT = H.filter(h => h.pm), fl = pmT.filter(h => h.pm.flags && h.pm.flags.length).length;
  const ans = pmT.filter(h => h.net <= 0 && h.pmHit != null), hit = ans.filter(h => h.pmHit).length, sk = S.pmSkip.length;
  askConfirm({ title: 'Turn pre-mortems off?', ok: 'Turn off', kind: 'sell',
    body: `So far a pre-mortem came before ${pmT.length} trade${pmT.length === 1 ? '' : 's'} (${fl} with red flags at entry); you named the reason for ${hit} of ${ans.length} answered losses, and you talked yourself out of ${sk} trade${sk === 1 ? '' : 's'} — Behaviour tracks how those skipped trades would have ended. With pre-mortems off, only the tilt guard, your rules and challenge limits still ask before a trade.`,
    onOk: () => { const c = pmCfg(); c.on = false; c.until = 0; save(); renderBehav(); toast('Pre-mortems off', 'Turn them back on here in Behaviour', 'info'); } });
}
function bindBehav() {
  bhState();
  $('#behav').addEventListener('click', e => {
    // the answer belongs to the position: every part of it carries it
    const h = e.target.closest('[data-hit]'); if (h) { const t = bhFind(+h.dataset.hit); if (t) { for (const x of t.rows) x.pmHit = h.dataset.v === '1'; save(); renderBehav(); } return; }
    const pz = e.target.closest('[data-pause]'); if (pz) { bhPause(+pz.dataset.pause); return; }
    if (e.target.id === 'bhReport') { bhReport(); return; }
    if (e.target.id === 'bhOpenTrade') { setView('trade'); setTimeout(() => { const s = ['.rail [data-side].on', '#qBuy', '#tkBuyBtn'].map(x => document.querySelector(x)).find(el => el && el.offsetParent); if (s) s.focus(); }, 80); return; }
    const sg = e.target.closest('[data-sug]'); if (sg) { rulesCfg()[sg.dataset.sug] = 'gate'; save(); renderBehav(); toast('Rule added', `${FLAG_NAMES[sg.dataset.sug]} → pre-mortem every time`, 'info'); return; }
    const sh = e.target.closest('[data-show]'); if (sh) { bhShowTrade(bhFind(+sh.dataset.show)); return; }
    if (e.target.id === 'pmResume') { pmCfg().until = 0; save(); renderBehav(); return; }
    if (e.target.id === 'pmTry') { pmCfg().on = true; pmCfg().minRisk = 0; pmCfg().until = 0; save(); renderBehav(); toast('Pre-mortem armed for every trade', 'Place any order from the ticket to see it', 'info'); $('#tkSubmit')?.focus(); }
  });
  $('#behav').addEventListener('toggle', e => { const k = e.target.dataset && e.target.dataset.more; if (k) { if (e.target.open) BH_OPEN.add(k); else BH_OPEN.delete(k); } }, true);
  $('#behav').addEventListener('input', e => {
    const c = pmCfg(), t = tiltCfg(), id = e.target.id;
    if (id === 'pmMin') { c.minRisk = +e.target.value; $('#pmMinV').textContent = c.minRisk + '%'; }
    if (id === 'pmOn') { if (e.target.checked) { c.on = true; c.until = 0; } else { e.target.checked = true; pmAskOff(); return; } }
    if (id === 'pmNoSL') c.noSL = e.target.checked;
    if (id === 'tlOn') t.on = e.target.checked;
    if (id === 'tlStreak') t.streak = +e.target.value;
    if (id === 'tlDay') t.dayLoss = +e.target.value;
    if (id === 'tlCool') t.cool = +e.target.value;
    if (e.target.dataset.rule) { const ru = rulesCfg(); if (e.target.value) ru[e.target.dataset.rule] = e.target.value; else delete ru[e.target.dataset.rule]; save(); setTimeout(renderBehav, 0); return; }
    save(); if (id.startsWith('tl')) { renderBehav(); if (typeof renderTicket === 'function') renderTicket(); }
  });
  document.addEventListener('keydown', e => { if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return; if (e.key.toLowerCase() === 'y') setTab('behav'); });
  if (typeof coachInsights === 'function') {
    const base = coachInsights;
    coachInsights = function () {
      const out = base(), ds = dispoStats();
      const dv = dispoVerdict(ds), rt = ds.ratio != null ? ds.ratio.toFixed(2) + '×' : '—';
      if (dv.clear) out.unshift({ tone: dv.key === 'dispo' ? 'bad' : 'good', t: dv.key === 'dispo' ? `<b>Disposition effect</b>: you realise gains ${rt} as readily as losses (t = ${nfx(ds.tstat, 1)}, n=${ds.n}). See Behaviour.` : `You cut losers faster than you take profits (PGR / PLR ${rt}, t = ${nfx(ds.tstat, 1)}, n=${ds.n}).` });
      const H = bhTrades().filter(h => h.ctx && !h.basket);
      const worst = Object.keys(FLAG_NAMES).map(k => { const T = H.filter(h => h.ctx.includes(k)); return { k, n: T.length, net: T.reduce((s, h) => s + h.net, 0) }; }).filter(x => x.n >= BH_MIN && !BH_DIR_FLAGS.includes(x.k)).sort((a, b) => a.net - b.net)[0];
      if (worst && worst.net < 0) out.unshift({ tone: 'bad', t: `Costliest warning so far: <b>${FLAG_NAMES[worst.k].toLowerCase()}</b> — ${usdFmt(worst.net)} over ${worst.n} trades (n=${worst.n}${bhChance(worst.n)}).` });
      const ru = rulesCfg(), bw = H.length ? H.filter(h => !h.ctx.length) : [], bwr = bw.length ? bw.filter(h => h.net > 0).length / bw.length * 100 : null;
      const sg = Object.keys(FLAG_NAMES).map(k => { const T = H.filter(h => h.ctx.includes(k)); return { k, n: T.length, net: T.reduce((s, h) => s + h.net, 0), wins: bhWins(T), w: T.length ? T.filter(h => h.net > 0).length / T.length * 100 : 0 }; }).find(x => x.n >= BH_MIN && !BH_DIR_FLAGS.includes(x.k) && x.net < 0 && !ru[x.k] && (bwr == null || x.w < bwr - 10));
      if (sg) out.unshift({ tone: 'bad', t: `Suggested rule: <b>${FLAG_NAMES[sg.k].toLowerCase()}</b> → pre-mortem every time (${wrTxt(sg.wins, sg.n)} wins${bhChance(sg.n)}).` });
      const sk = S.pmSkip?.length; if (sk) out.push({ tone: 'info', t: `You talked yourself out of ${sk} trade${sk > 1 ? 's' : ''} in pre-mortems — Behaviour shows how they would have ended.` });
      return out.slice(0, 8);
    };
  }
  setInterval(() => safe('behaviour', bhTick), 1000);
  if (typeof bindChal === 'function') safe('challenge', bindChal); // after the coach wrapper above
  // dock tab bar: show fades and arrows when tabs overflow
  const tb = $('#tabs'), wr = tb?.parentElement;
  if (tb && wr?.classList.contains('tabs-wrap')) {
    const upd = () => { const o = tb.scrollWidth > tb.clientWidth + 2; wr.classList.toggle('fl', o && tb.scrollLeft > 4); wr.classList.toggle('fr', o && tb.scrollLeft + tb.clientWidth < tb.scrollWidth - 4); };
    tb.addEventListener('scroll', upd, { passive: true }); addEventListener('resize', upd); new ResizeObserver(upd).observe(tb); upd();
    tb.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && tb.scrollWidth > tb.clientWidth) { tb.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
    $('#tabsL').addEventListener('click', () => tb.scrollBy({ left: -240 })); $('#tabsR').addEventListener('click', () => tb.scrollBy({ left: 240 }));
    tb.addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) b.scrollIntoView({ block: 'nearest', inline: 'nearest' }); });
  }
}
