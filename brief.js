'use strict';
/* tradeBerry — Market Brief.
   An analyst-style brief generated on the device from simulated terminal data:
   multi-timeframe trend, momentum, volatility, swing-pivot levels, currency strength,
   calendar risk and the user's own positioning. Deterministic and explainable: every
   sentence is backed by a number shown in the brief. Descriptive only: the market is a simulated
   driftless random walk, so the trend score describes the past and predicts nothing. */

const BR = { sym: null, data: null, at: 0, typing: 0 };

/* ---------- analytics ---------- */
function emaArr(vals, n) { const k = 2 / (n + 1), out = []; vals.forEach((v, i) => out.push(i ? out[i - 1] + k * (v - out[i - 1]) : v)); return out; }
// Wilder's ATR (shared.js atrWilder); a short series uses the bars it has, under two bars 0
function atrOf(b, n = 14) {
  return b.length > 1 ? atrWilder(b, Math.min(n, b.length - 1)) : 0;
}
function rsiOf(b, n = 14) {
  let ag = 0, al = 0;
  for (let i = 1; i < b.length; i++) {
    const ch = b[i].close - b[i - 1].close, g = Math.max(ch, 0), l = Math.max(-ch, 0);
    if (i <= n) { ag += g / n; al += l / n; } else { ag = (ag * (n - 1) + g) / n; al = (al * (n - 1) + l) / n; }
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
function trendOn(sym, tf) {
  const b = Engine.aggregate(sym, tf, 220); if (b.length < 25) return { score: 0, label: 'Flat', slope: 0, rsi: 50, stretch: 0, atr: atrOf(b) || 1e-9, px: b.length ? b[b.length - 1].close : 0, e20: 0, e50: 0, pos: 0, slp: 0, short: true };
  const cl = b.map(x => x.close), e20 = emaArr(cl, 20), e50 = emaArr(cl, 50), n = cl.length - 1, atr = atrOf(b) || 1e-9;
  const px = cl[n], slope = (e20[n] - e20[n - 5]) / atr;           // ATRs per 5 bars
  const stack = (px > e20[n] ? 1 : -1) + (e20[n] > e50[n] ? 1 : -1); // -2..2
  const score = clamp(stack / 2 * .55 + clamp(slope / 1.2, -1, 1) * .45, -1, 1);
  const label = score > .55 ? 'Strong up' : score > .2 ? 'Up' : score < -.55 ? 'Strong down' : score < -.2 ? 'Down' : 'Flat';
  // pos / slp: the two parts of the score (Why panel), the same arithmetic as score before the clamp
  return { score, label, slope, px, e20: e20[n], e50: e50[n], atr, rsi: rsiOf(b), stretch: (px - e20[n]) / atr, pos: stack / 2 * .55, slp: clamp(slope / 1.2, -1, 1) * .45 };
}
// the last 24 hours of 1-minute bars (a market closed for longer: its last session's bars, up to 1440)
function lastDay(sym) {
  const arr = Engine.candles[sym], t0 = Engine.simTime - 86400; let i = arr.length;
  while (i > 0 && arr[i - 1].time >= t0) i--;
  return i < arr.length ? arr.slice(i) : arr.slice(-1440);
}
/* Round-number grid: 50 pips on a pair (.005 on EUR/USD, .50 on USD/JPY); off FX a 1-2-2.5-5 step near 8 one-hour
   moves of the instrument's own volatility (σ per hour from the sheet calibration × price), so a stock, an index and
   bitcoin all get levels a few hours of movement apart. */
function niceStep(v) { const e = 10 ** Math.floor(Math.log10(v)), f = v / e; return [1, 2, 2.5, 5, 10].reduce((b, x) => Math.abs(Math.log(x / f)) < Math.abs(Math.log(b / f)) ? x : b, 1) * e; }
function briefGrid(sym) {
  const m = M(sym); if (m.kind !== 'cfd') return +(50 * m.pip).toFixed(10);
  const sig = (m.seed && m.seed.sIn || .002) * Engine.mid(sym);
  return Math.max(10 * m.point, +niceStep(8 * sig).toPrecision(6));
}
function pivotLevels(sym) {
  const b = Engine.aggregate(sym, 60, 168), m = M(sym), px = b[b.length - 1].close, atr = atrOf(b), W = 3, raw = [];
  for (let i = W; i < b.length - W; i++) {
    let hi = true, lo = true;
    for (let j = i - W; j <= i + W; j++) { if (b[j].high > b[i].high) hi = false; if (b[j].low < b[i].low) lo = false; }
    if (hi) raw.push({ p: b[i].high, t: b[i].time, kind: 'swing high' });
    if (lo) raw.push({ p: b[i].low, t: b[i].time, kind: 'swing low' });
  }
  const day = lastDay(sym);
  raw.push({ p: Math.max(...day.map(c => c.high)), kind: '24h high', t: Engine.simTime });
  raw.push({ p: Math.min(...day.map(c => c.low)), kind: '24h low', t: Engine.simTime });
  // round numbers on briefGrid
  const grid = briefGrid(sym);
  const r0 = Math.round(px / grid) * grid;
  [-2, -1, 0, 1, 2].forEach(k => raw.push({ p: r0 + k * grid, kind: 'round number', t: 0, weak: true }));
  // cluster
  raw.sort((a, b) => a.p - b.p);
  const cl = [];
  for (const r of raw) {
    const last = cl[cl.length - 1];
    if (last && Math.abs(r.p - last.p) < atr * .45) { last.touches += r.weak ? 0 : 1; last.kinds.add(r.kind); last.p = r.weak ? last.p : (last.p * last.n + r.p) / (last.n + 1); last.n += r.weak ? 0 : 1; }
    else cl.push({ p: r.p, touches: r.weak ? 0 : 1, n: r.weak ? 0 : 1, kinds: new Set([r.kind]) });
  }
  const sig = x => x.touches + (x.kinds.has('24h high') || x.kinds.has('24h low') ? 1 : 0) + (x.kinds.has('round number') ? .5 : 0);
  const res = cl.filter(x => x.p > px + atr * .15).sort((a, b) => a.p - b.p).slice(0, 4).sort((a, b) => sig(b) - sig(a) || a.p - b.p).slice(0, 2).sort((a, b) => a.p - b.p);
  const sup = cl.filter(x => x.p < px - atr * .15).sort((a, b) => b.p - a.p).slice(0, 4).sort((a, b) => sig(b) - sig(a) || b.p - a.p).slice(0, 2).sort((a, b) => b.p - a.p);
  const desc = x => { const k = [...x.kinds].filter(s => s !== 'round number'); const parts = k.length ? k : ['round number']; return parts.slice(0, 2).join(' + ') + (x.touches > 1 ? ` · ${x.touches} touches` : ''); };
  return { px, atr, res: res.map(x => ({ p: x.p, why: desc(x), str: sig(x) })), sup: sup.map(x => ({ p: x.p, why: desc(x), str: sig(x) })) };
}

function analyse(sym) {
  const m = M(sym), q = Engine.quote(sym);
  const tfs = { '15m': trendOn(sym, 15), '1H': trendOn(sym, 60), '4H': trendOn(sym, 240) };
  // currency strength compares the two currencies of a pair, on the G8 currencies only (Engine.strength); a CFD has
  // no base currency and a pair with a currency outside the G8 has no reading
  const st = Object.fromEntries(Engine.strength(240).map(x => [x.c, x.s]));
  const strDiff = m.kind === 'cfd' || !(m.base in st) || !(m.quote in st) ? null : st[m.base] - st[m.quote];
  const h1 = tfs['1H'], lv = pivotLevels(sym);
  const day = lastDay(sym), dHi = Math.max(...day.map(c => c.high)), dLo = Math.min(...day.map(c => c.low));
  const rangePos = (q.mid - dLo) / (dHi - dLo || 1), ch24 = (q.mid / day[0].close - 1) * 100;
  // the 1H ATR the brief quotes and plans with is the terminal's one: Wilder's ATR(14) on complete hours (atr1h)
  const a1 = atr1h(sym); if (a1 != null) h1.atr = a1;
  const atrPips = h1.atr / m.pip;
  // volatility regime: against the same hours of the day earlier in the week (shared.js atrNorm1h)
  const wAtr = atrNorm1h(sym) || 0;
  const volRatio = h1.atr / (wAtr || h1.atr);
  // descriptive 4H trend score (−100..+100): where price sits vs its EMAs and how they slope; not a forecast
  const trend = tfs['4H'].score, score = Math.round(trend * 100);
  const dir = trend > .2 ? 1 : trend < -.2 ? -1 : 0;
  const agree = Object.values(tfs).filter(t => dir && Math.sign(t.score) === dir && Math.abs(t.score) > .2).length;
  // calendar
  // calendar: the currencies whose news move this instrument (both currencies of a pair; the quote currency otherwise:
  // USD for US.500, EUR for DE.30)
  const events = CAL.events.filter(e => !e.done && m.newsCcy.includes(e.ccy) && e.t - Engine.simTime < 6 * 3600).sort((a, b) => a.t - b.t);
  const hiSoon = events.find(e => e.impact === 'hi' && e.t - Engine.simTime < 2 * 3600);
  // positioning: currency exposure split as in the Net exposure panel
  const mine = S.positions.filter(p => p.sym === sym);
  const exp = exposureOf().ccy;
  const wAtrPips = (wAtr || h1.atr) / m.pip;
  return { sym, m, q, tfs, st, strDiff, lv, dHi, dLo, rangePos, ch24, atrPips, wAtrPips, volRatio, trend, score, dir, agree, events, hiSoon, mine, exp, h1, at: Engine.simTime };
}

/* ---------- trade plan ---------- */
function makePlan(a) {
  const { m, q, lv, h1, dir } = a, atr = h1.atr, R = v => +v.toFixed(m.digits);
  if (!dir) {
    const s = lv.sup[0], r = lv.res[0];
    if (!s || !r) return null;
    const width = (r.p - s.p) / m.pip;
    if (width < a.atrPips * 1.5) return { kind: 'wait', text: `Range is too tight (${width.toFixed(0)} ${unitWord(a.sym)}) to trade both edges. Wait for a break of ${fp(a.sym, r.p)} or ${fp(a.sym, s.p)}.` };
    const nearTop = a.q.mid - s.p > r.p - a.q.mid;
    const side = nearTop ? 'sell' : 'buy', entry = R(nearTop ? r.p - atr * .1 : s.p + atr * .1);
    const stop = R(nearTop ? r.p + atr * .6 : s.p - atr * .6), target = R(nearTop ? s.p + atr * .2 : r.p - atr * .2);
    return { kind: 'range', side, ot: 'limit', entry, stop, target, why: `No clear 4H trend. Range template: ${nearTop ? 'sell near the top' : 'buy near the bottom'} of the ${fp(a.sym, s.p)}–${fp(a.sym, r.p)} range, with a defined stop. A structure for practising execution, not a forecast.` };
  }
  const side = dir > 0 ? 'buy' : 'sell', ref = dir > 0 ? q.ask : q.bid;
  const zone = dir > 0 ? lv.sup[0] : lv.res[0], obj = dir > 0 ? lv.res : lv.sup;
  const stretched = Math.abs(h1.stretch) > 1.1 && Math.sign(h1.stretch) === dir;
  let ot = 'market', entry = ref;
  if (stretched) { ot = 'limit'; entry = R(dir > 0 ? Math.max(h1.e20, zone ? zone.p + atr * .1 : h1.e20) : Math.min(h1.e20, zone ? zone.p - atr * .1 : h1.e20)); }
  let stop = zone ? zone.p - dir * atr * .5 : entry - dir * atr * 1.5;
  if (Math.abs(entry - stop) < atr * .8) stop = entry - dir * atr * 1.2;
  if (Math.abs(entry - stop) > atr * 3) stop = entry - dir * atr * 2;
  stop = R(stop);
  const risk = Math.abs(entry - stop);
  let target = obj.find(l => Math.abs(l.p - entry) >= risk * 1.5);
  target = R(target ? target.p - dir * atr * .1 : entry + dir * risk * 2);
  const why = stretched
    ? `Trend-following template: the 4H trend has been ${dir > 0 ? 'up' : 'down'} and price is ${Math.abs(h1.stretch).toFixed(1)} ATR from the 1H EMA20, so the template uses a limit order near the EMA20. Past trend does not predict the next move; the plan only fixes entry, stop and target before you trade.`
    : `Trend-following template: the 4H trend has been ${dir > 0 ? 'up' : 'down'} and price is ${Math.abs(h1.stretch).toFixed(1)} ATR from the 1H EMA20, so the template enters at market. Past trend does not predict the next move; the plan only fixes entry, stop and target before you trade.`;
  return { kind: 'trend', side, ot, entry: R(entry), stop, target, why };
}

/* ---------- text ---------- */
/* N(text, tone, tip, key) wraps a number of the text: identity for the copied text, a highlighted chip with an
   explanation on hover for the page (brChip). tone: 'up' | 'dn' | 'wn' | ''; key ties the chip to the chart. */
function writeBrief(a, plan, N = x => x) {
  const { sym, m, tfs, dir, score, strDiff, lv, rangePos, ch24, atrPips, volRatio, h1, events, hiSoon, mine, exp } = a;
  const P = pretty(sym), tone = dir > 0 ? 'up' : dir < 0 ? 'dn' : '';
  const lead = `${P}: 4H trend score ${N(sgn(score, 0), tone, `4H trend score|From −100 (strong down) to +100 (strong up). It combines where price sits against the EMA20 and EMA50 on 4H (55%) and how fast the EMA20 slopes (45%); the Why panel shows the parts.`, 'ema')} (descriptive) — ${N(tfs['4H'].label.toLowerCase(), tone, `${tfs['4H'].label}|Above +55 strong up, +20 to +55 up, −20 to +20 flat, −55 to −20 down, below −55 strong down.`, 'ema')} over the recent 4H bars. On this simulated market past trend does not predict the next move.`;
  const tAll = Object.entries(tfs).map(([k, t]) => `${k} ${t.label.toLowerCase()}`).join(', ');
  const align = a.agree === 3 ? 'All three timeframes point the same way' : a.agree === 2 ? 'Two of three timeframes point the same way' : dir ? 'Only the 4H trend points that way' : 'Timeframes are mixed';
  const un = unitWord(sym), cfd = m.kind === 'cfd';
  const outG8 = cfd ? [] : [m.base, m.quote].filter(c => !Engine.ALL.includes(c));
  const strong = cfd ? 'Currency-strength view applies to FX pairs only (the G8 currencies).' : strDiff == null ? `The currency-strength view covers the G8 currencies only; ${outG8.join(' and ')} ${outG8.length > 1 ? 'are' : 'is'} outside it.` : Math.abs(strDiff) > 6
    ? `${strDiff > 0 ? m.base : m.quote} is outperforming ${strDiff > 0 ? m.quote : m.base} by ${N(Math.abs(strDiff).toFixed(0) + ' bp', '', `Currency strength, 4 hours|Each currency's average move against the other G8 currencies. ${strDiff > 0 ? m.base : m.quote} gained ${Math.abs(strDiff).toFixed(0)} basis points (${(Math.abs(strDiff) / 100).toFixed(2)}%) more than ${strDiff > 0 ? m.quote : m.base}.`)} over 4 hours${(strDiff > 0) === (dir > 0) || !dir ? '' : ', the opposite way to the 4H trend'}.`
    : `${m.base} and ${m.quote} are moving in step on the strength meter.`;
  const mom = `1H ${N('RSI', 'term', 'RSI(14)|Relative strength index: the average up-move against the average down-move over 14 bars, on a 0–100 scale. Under 30: recent losses outweighed gains; over 70: gains outweighed losses.')} is ${N(h1.rsi.toFixed(0), h1.rsi > 70 || h1.rsi < 30 ? 'wn' : '', `RSI ${h1.rsi.toFixed(0)} on 1H|${h1.rsi > 70 ? 'Above 70.' : h1.rsi < 30 ? 'Below 30.' : h1.rsi >= 45 && h1.rsi <= 55 ? 'Close to 50: up and down moves balance.' : h1.rsi < 50 ? 'Under 50: down moves were larger, far from the extremes.' : 'Over 50: up moves were larger, far from the extremes.'}`, 'rsi')}${h1.rsi > 70 ? ' (above 70: recent gains outweighed losses)' : h1.rsi < 30 ? ' (below 30: recent losses outweighed gains)' : ''}.`;
  const atrN = N(`${atrPips.toFixed(1)} ${un}`, volRatio > 1.25 ? 'wn' : '', `ATR(14) on 1H|Average true range: the average size of one hour's move, gaps included (Wilder, 14 complete hours). Right now an hour moves about ${atrPips.toFixed(1)} ${un}.`);
  const ratN = x => N(`${volRatio.toFixed(1)}× ${x}`, volRatio > 1.25 ? 'wn' : '', `Volatility against the week|The same hours of the day averaged ${a.wAtrPips.toFixed(1)} ${un} earlier this week; now ${atrPips.toFixed(1)}. Above 1.25× the brief calls it elevated, below 0.8× compressed.`);
  const vol = volRatio > 1.25 ? `Volatility is elevated (1H ${N('ATR', 'term', 'ATR|Average true range: how much one bar moves on average, gaps included.')} ${atrN}, ${ratN('the norm for these hours')}) — widen stops or cut size.` : volRatio < .8 ? `Volatility is compressed (1H ATR ${atrN}, ${ratN('normal')}) — volatility tends to drift back toward normal; that says nothing about direction.` : `Volatility is normal at ${atrPips.toFixed(1)} ${un} per hour.`;
  const rng = `Price is ${ch24 >= 0 ? 'up' : 'down'} ${N(Math.abs(ch24).toFixed(2) + '%', ch24 >= 0 ? 'up' : 'dn', '24h change|Price now against 24 hours ago.')} over 24h and sits in the ${rangePos > .8 ? 'top' : rangePos < .2 ? 'bottom' : rangePos > .5 ? 'upper half' : 'lower half'} of its daily range (${N((rangePos * 100).toFixed(0) + '%', '', `Position in the 24h range|0% = at the day's low (${fp(sym, a.dLo)}), 100% = at its high (${fp(sym, a.dHi)}).`, 'rng')}).`;
  const r1 = lv.res[0], s1 = lv.sup[0];
  const LN = (l, k) => N(fp(sym, l.p), k[0] === 'R' ? 'dn' : 'up', `${k} · ${fp(sym, l.p)}|${l.why}. ${Math.abs((l.p - a.q.mid) / m.pip).toFixed(0)} ${un} ${l.p > a.q.mid ? 'above' : 'below'} the price.`, k);
  const bull = r1 ? `Nearest mapped level above: ${LN(r1, 'R1')}${lv.res[1] ? `, then ${LN(lv.res[1], 'R2')}` : ''}.` : 'No mapped level above on the 1H chart this week.';
  const bear = s1 ? `Nearest mapped level below: ${LN(s1, 'S1')}${lv.sup[1] ? `, then ${LN(lv.sup[1], 'S2')}` : ''}.` : 'No mapped level below on the 1H chart this week.';
  const risk = [];
  if (hiSoon) risk.push(`High-impact ${N(`${hiSoon.ccy} ${hiSoon.name} in ${fmtIn(hiSoon.t - Engine.simTime)}`, 'wn', `${hiSoon.ccy} ${hiSoon.name}|A high-impact release from the calendar. Around it price can jump in either direction, and spreads and slippage widen.`, 'ev')} — expect a volatility spike in either direction; spreads and slippage widen around it.`);
  else if (events.length) risk.push(`Next relevant release: ${events[0].ccy} ${events[0].name} (${{ hi: 'high', md: 'medium', lo: 'low' }[events[0].impact]} impact) in ${fmtIn(events[0].t - Engine.simTime)}.`);
  else risk.push(cfd ? `No scheduled ${m.newsCcy.join(' or ')} releases in the next 6 hours.` : 'No scheduled releases for either currency in the next 6 hours.');
  if (mine.length) {
    const pnl = mine.reduce((s, p) => s + posPnl(p).pnl, 0), side = mine[0].side;
    const fit = (side === 'buy') === (dir > 0);
    risk.push(`You hold ${mine.length} ${P} position${mine.length > 1 ? 's' : ''} (${usdFmt(pnl, true)}). ${!dir ? 'The 4H trend is flat.' : fit ? 'They point the same way as the 4H trend.' : 'They point against the 4H trend.'} Check that each has a stop.`);
  }
  const ex = cfd ? [] : [m.base, m.quote].map(c => [c, exp[c] || 0]).filter(([, v]) => Math.abs(v) > 1000);
  if (ex.length && !mine.length) risk.push(`You already carry ${ex.map(([c, v]) => `${v > 0 ? 'long' : 'short'} ${c} ${(Math.abs(v) / 1000).toFixed(0)}k`).join(' and ')} through other pairs.`);
  return {
    headline: lead,
    summary: `${align}: ${tAll}. ${strong} ${mom}`,
    context: `${rng} ${vol}`,
    bull, bear, risk,
    planText: plan ? (plan.kind === 'wait' ? plan.text : plan.why) : 'Not enough structure for a plan.'
  };
}

/* ---------- render ---------- */
/* The scanner lists the instruments around the open one: the 16 G8 pairs for an FX major, the pair's own group
   (crosses, exotics) otherwise, the whole category for indices, commodities and crypto, the sector for a stock.
   One trend score each (about 10 ms), cached for two minutes of market time. */
function scanUniverse(sym) {
  const m = M(sym), c = CAT_OF[m.group], sub = subOf(m), list = listedInstr();
  if (c === 'fx' && G8_PAIRS.has(sym)) return { syms: Engine.PAIRS.map(p => p.sym), name: '16 FX majors' };
  const same = c === 'fx' || c === 'stock' ? list.filter(x => CAT_OF[x.group] === c && subOf(x) === sub) : list.filter(x => CAT_OF[x.group] === c);
  const syms = same.map(x => x.sym); if (!syms.includes(sym)) syms.push(sym);
  const word = { fx: `FX ${sub.toLowerCase()}`, index: 'indices', commodity: 'commodities', crypto: 'crypto', stock: `${sub} stocks` }[c] || catName(c);
  return { syms, name: `${syms.length} ${word}` };
}
function renderScanner() {
  const u = scanUniverse(BR.sym || S.set.sym);
  const rows = u.syms.map(s => ({ sym: s, ...quickTrend(s) })).sort((x, y) => Math.abs(y.b) - Math.abs(x.b));
  const n = $('#brScanN'); if (n) n.textContent = u.name;
  // a column head over the rows (a div, not a .scan-row: the rows are the instruments)
  $('#brScan').innerHTML = '<div class="scan-cols" aria-hidden="true"><span>Pair</span><span>Strength</span><span>Score</span><span>Trend</span></div>' + rows.map(r => {
    const w = Math.abs(r.b) * 50, col = r.b > .2 ? 'var(--up)' : r.b < -.2 ? 'var(--dn)' : 'var(--tx3)';
    const lb = r.b > .55 ? 'Strong up' : r.b > .2 ? 'Up' : r.b < -.55 ? 'Strong down' : r.b < -.2 ? 'Down' : 'Flat', k = r.b > .2 ? 'up' : r.b < -.2 ? 'dn' : 'muted';
    return `<button class="scan-row ${r.sym === BR.sym ? 'on' : ''}" data-sym="${r.sym}"${tipAttr(`${pretty(r.sym)} · ${sgn(Math.round(r.b * 100), 0)}|4H trend score: ${lb.toLowerCase()}. Click to load its brief.`)}><b>${escHtml(M(r.sym).kind === 'cfd' ? M(r.sym).short : pretty(r.sym))}</b><span class="str-track"><span class="str-fill" style="left:${r.b >= 0 ? 50 : 50 - w}%;width:${w}%;background:${col}"></span></span><span class="mono sc ${k}">${sgn(Math.round(r.b * 100), 0)}</span><em class="${k}">${lb}</em></button>`;
  }).join('');
}
// 4H trend score per pair for the scanner (the same number as the brief's headline)
const qbCache = {};
function quickTrend(sym) {
  const c = qbCache[sym]; if (c && Engine.simTime - c.t < 120) return c;
  return (qbCache[sym] = { b: trendOn(sym, 240).score, t: Engine.simTime });
}
// a highlighted number of the reading; tip 'Title|explanation' shows on hover and focus (brTip), key ties it to the chart
const brChip = (text, tone, tip, key) => `<span class="brx-n${tone ? ' ' + tone : ''}" tabindex="0" data-tip="${escHtml(tip)}"${key ? ` data-k="${key}"` : ''}>${text}</span>`;
const tipAttr = (tip, key) => ` data-tip="${escHtml(tip)}"${key ? ` data-k="${key}"` : ''}`;
const LV_KEYS = { res: ['R1', 'R2'], sup: ['S1', 'S2'] };
const scoreTone = v => v > .2 ? 'up' : v < -.2 ? 'dn' : '';
// a -1..1 bar from the middle, for the parts of the score
const brBar = v => { const w = Math.min(50, Math.abs(v) * 50); return `<i style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%" class="${v > 0 ? 'up' : 'dn'}"></i>`; };
function generateBrief(sym) {
  sym = sym || S.set.sym; BR.sym = sym;
  const a = analyse(sym), plan = makePlan(a), t = writeBrief(a, plan), r = writeBrief(a, plan, brChip);
  BR.data = { a, plan, t }; BR.at = Engine.simTime;
  const { m, q, tfs } = a, un = unitWord(sym), u = uShort(sym), tone = scoreTone(a.trend), t4 = tfs['4H'];
  const dist = p => Math.abs(p - q.mid) / m.pip;
  // the two parts of the 4H score, rounded so that they add up to the headline number
  const posPts = Math.round(t4.pos * 100), slpPts = a.score - posPts;
  const pA = t4.px > t4.e20, eA = t4.e20 > t4.e50;
  const yes = c => `<td class="brx-chk ${c ? 'up' : 'dn'}"><span aria-hidden="true">${c ? '✓' : '✗'}</span><span class="sr-only">${c ? 'yes' : 'no'}</span></td>`;
  const ev = a.hiSoon || a.events[0];
  // a coloured label for the reading under a KPI number
  const tag = (txt, tn) => `<span class="brx-t${tn ? ' ' + tn : ''}">${txt}</span>`;
  const rsiTone = v => v > 70 || v < 30 ? 'wn' : v > 55 ? 'up' : v < 45 ? 'dn' : '';
  const kpi = (label, val, sub, tip, cls = '', extra = '') => `<div class="brx-kpi" tabindex="0"${tipAttr(tip)}><label>${label}</label><b class="mono ${cls}">${val}</b><span>${sub}</span>${extra}</div>`;
  const meter = (pct, zones = '') => `<div class="brx-bar" aria-hidden="true">${zones}<i class="brx-pt" style="left:${clamp(pct, 0, 100)}%"></i></div>`;
  const rsiZones = '<i class="brx-z up" style="left:0;width:30%"></i><i class="brx-z dn" style="left:70%;width:30%"></i>';
  const levels = [...a.lv.res.map((l, i) => ({ ...l, k: LV_KEYS.res[i] })).reverse(), { now: true, p: q.mid }, ...a.lv.sup.map((l, i) => ({ ...l, k: LV_KEYS.sup[i] }))];
  const ladder = levels.map(l => l.now
    ? `<div class="brx-lv now"><span></span><span class="mono">${fp(sym, l.p)}</span><span class="why">current price</span><span></span><span></span><span></span></div>`
    : `<div class="brx-lv" tabindex="0"${tipAttr(`${l.k} · ${fp(sym, l.p)}|${l.why}. ${dist(l.p).toFixed(0)} ${un} ${l.p > q.mid ? 'above' : 'below'} the price. Strength ${l.str}: one point per touch, one more for the 24h high or low, half for a round number.`, l.k)}><span class="brx-tag ${l.k[0] === 'R' ? 'dn' : 'up'}">${l.k}</span><span class="mono">${fp(sym, l.p)}</span><span class="why">${l.why}</span><span class="brx-dots" aria-label="strength ${l.str}">${'●'.repeat(Math.min(5, Math.floor(l.str)))}${l.str % 1 ? '◐' : ''}</span><span class="mono ${l.p > q.mid ? 'dn' : 'up'}">${sgn((l.p - q.mid) / m.pip, 0)}${u}</span><button class="ghost xs" data-alert="${l.p}" title="Set an alert at ${fp(sym, l.p)}">Alert</button></div>`).join('');
  const lvHead = a.lv.res.length || a.lv.sup.length ? '<div class="brx-lvh" aria-hidden="true"><span>Level</span><span>Price</span><span>Why</span><span>Strength</span><span>Distance</span><span></span></div>' : '';
  const noLv = !a.lv.res.length && !a.lv.sup.length ? '<p class="muted small">No mapped levels on the 1H chart this week.</p>' : '';
  const planHtml = plan && plan.kind !== 'wait' ? (() => {
    const risk = Math.abs(plan.entry - plan.stop) / m.pip, rew = Math.abs(plan.target - plan.entry) / m.pip, sell = plan.side === 'sell';
    const steps = plan.kind === 'trend'
      ? [`Direction follows the 4H trend: ${sell ? 'down, so sell' : 'up, so buy'}.`, plan.ot === 'market' ? `Price is ${Math.abs(a.h1.stretch).toFixed(1)} ATR from the 1H EMA20 (under 1.1): enter at market.` : `Price is ${Math.abs(a.h1.stretch).toFixed(1)} ATR from the 1H EMA20 (over 1.1): wait with a limit order near it.`, `Stop beyond the nearest ${sell ? 'resistance' : 'support'} with half an ATR of room.`, 'Target at the first level at least 1.5× the risk away.']
      : ['No clear 4H trend: the template trades the range edges.', `${sell ? 'Sell near the top' : 'Buy near the bottom'} with a limit order.`, 'Stop beyond the edge with 0.6 ATR of room.', 'Target just before the opposite edge.'];
    const lots = S.tk.sm === 'lots' && S.tk.lots > 0 ? S.tk.lots : m.p.vol[0];
    return `<div class="brx-plan-h"><span class="brx-pill ${sell ? 'dn' : 'up'}">${sell ? 'Sell' : 'Buy'} ${plan.ot === 'market' ? 'at market' : plan.ot}</span><span class="muted small">${plan.kind === 'trend' ? 'Trend template' : 'Range template'}</span></div>
      <div class="brx-plan-g">
        <div tabindex="0"${tipAttr(plan.ot === 'market' ? 'Entry|At market: the order fills at the current price.' : 'Entry|A limit order: it fills only if price comes back to this level.', 'plan')}><label>Entry</label><b class="mono">${fp(sym, plan.entry)}</b><small>${plan.ot}</small></div>
        <div tabindex="0"${tipAttr(`Stop|Where the trade closes at a loss: ${risk.toFixed(0)} ${un} from the entry.`, 'plan')}><label>Stop</label><b class="mono dn">${fp(sym, plan.stop)}</b><small>${risk.toFixed(0)} ${un}</small></div>
        <div tabindex="0"${tipAttr(`Target|Where the trade takes profit: ${rew.toFixed(0)} ${un} from the entry.`, 'plan')}><label>Target</label><b class="mono up">${fp(sym, plan.target)}</b><small>${rew.toFixed(0)} ${un}</small></div>
        <div tabindex="0"${tipAttr(`Reward : risk|The potential gain divided by the risk: ${rew.toFixed(0)} / ${risk.toFixed(0)}. The trend template looks for at least 1 : 1.5.`)}><label>Reward : risk</label><b class="mono">1 : ${(rew / risk).toFixed(2)}</b><small>min 1 : 1.5</small></div>
      </div>
      <div class="brx-rr" aria-hidden="true"><span class="dn" style="flex:${risk.toFixed(1)}">risk ${risk.toFixed(0)}${u}</span><span class="up" style="flex:${rew.toFixed(1)}">reward ${rew.toFixed(0)}${u}</span></div>
      <label class="brx-size">Size <input id="brLots" type="number" value="${lots}" min="${m.p.vol[0]}" step="${m.p.vol[2]}" inputmode="decimal"> ${m.lotName === 'shares' ? 'shares' : 'lots'}</label>
      <p class="brx-risk" id="brRisk" data-risk="${risk}" data-rew="${rew}"></p>
      <ol class="brx-steps">${steps.map(x => `<li>${x}</li>`).join('')}</ol>
      <p class="muted small">${t.planText}</p>
      <div class="plan-btns"><button class="cta sm ${plan.side}" id="brLoad">Load plan into ticket</button><button class="ghost sm" id="brAlerts">Alerts at key levels</button></div>`;
  })() : `<p class="muted small">${t.planText}</p><div class="plan-btns"><button class="ghost sm" id="brAlerts">Alerts at key levels</button></div>`;
  const strRows = a.strDiff == null ? '' : [m.base, m.quote].map(c => { const v = a.st[c], w = Math.min(50, Math.abs(v) * 2); return `<b>${c}</b><span class="str-track"><span class="str-fill" style="left:${v >= 0 ? 50 : 50 - w}%;width:${w}%;background:var(${v >= 0 ? '--up' : '--dn'})"></span></span><span class="mono ${v >= 0 ? 'up' : 'dn'}">${sgn(v, 0)} bp</span>`; }).join('');
  const layers = [['ema', 'EMA 20 / 50', '--ind1'], ['lv', 'Key levels', '--tx2'], ['plan', 'Plan', '--dn'], ['rng', '24h range', '--tx3'], ['ev', 'Events', '--warn']];
  $('#brMain').innerHTML = `
    <div class="br-head brx-head">
      <div class="brx-id"><span class="br-sym">${pretty(sym)}</span><span class="mono brx-px">${fp(sym, q.mid)}</span>
        <span class="brx-verdict ${tone}" tabindex="0"${tipAttr(`${t4.label}|From the 4H trend score ${sgn(a.score, 0)}. It describes the last days of price; it does not predict the next move.`)}>${a.dir > 0 ? '▲' : a.dir < 0 ? '▼' : '■'} ${t4.label === 'Flat' ? 'No clear trend' : t4.label + ' trend'}</span></div>
      <span class="muted small">Generated ${new Date(a.at * 1000).toISOString().slice(11, 16)} UTC · from simulated terminal data</span>
      <div class="br-actions"><button class="ghost sm" id="brRegen" title="Regenerate with the latest data">Refresh</button><button class="ghost sm" id="brCopy" title="Copy brief as text">Copy</button></div>
    </div>
    <div class="brx-kpis">
      ${kpi('Trend 4H', sgn(a.score, 0), tag(t4.label, tone), '4H trend score|From −100 to +100: where price sits against the EMA20 and EMA50 on 4H (55%) and how fast the EMA20 slopes (45%). It describes the past.', tone, meter(50 + a.score / 2))}
      ${kpi('Timeframes', `${a.agree}<small>/3</small>`, Object.entries(tfs).map(([k, v]) => `${k} ${tag(v.label.replace('Strong ', '').toLowerCase(), scoreTone(v.score))}`).join(' '), 'Timeframe agreement|The same trend score on 15m, 1H and 4H. It counts the timeframes that point the same way as the 4H trend with a score beyond ±20.')}
      ${kpi('Momentum · RSI 1H', a.h1.rsi.toFixed(0), tag(a.h1.rsi > 70 ? 'Above 70' : a.h1.rsi < 30 ? 'Below 30' : a.h1.rsi < 45 ? 'Slightly negative' : a.h1.rsi > 55 ? 'Slightly positive' : 'Neutral', rsiTone(a.h1.rsi)), 'RSI(14) on 1H|0–100. Under 30 the recent losses outweighed the gains, over 70 the gains outweighed the losses; 50 is balanced.', a.h1.rsi > 70 || a.h1.rsi < 30 ? 'wn' : '', meter(a.h1.rsi, rsiZones))}
      ${kpi('Volatility · ATR 1H', `${a.volRatio.toFixed(1)}×`, `${a.atrPips.toFixed(1)} ${un} ${tag(a.volRatio > 1.25 ? 'elevated' : a.volRatio < .8 ? 'compressed' : 'normal', a.volRatio > 1.25 ? 'wn' : a.volRatio < .8 ? 'info' : '')}`, `Volatility|ATR(14) on 1H: one hour moves about ${a.atrPips.toFixed(1)} ${un}. The week averages ${a.wAtrPips.toFixed(1)}, so ${a.volRatio.toFixed(2)}× the norm. Above 1.25× elevated, below 0.8× compressed.`, a.volRatio > 1.25 ? 'wn' : '')}
      ${ev ? kpi('Event risk', `<span id="brEvIn" data-t="${ev.t}">${fmtIn(ev.t - Engine.simTime)}</span>`, `${tag({ hi: 'High', md: 'Medium', lo: 'Low' }[ev.impact], ev.impact === 'hi' ? 'wn' : '')} ${ev.ccy} ${escHtml(ev.name)}`, `${ev.ccy} ${ev.name}|${{ hi: 'High', md: 'Medium', lo: 'Low' }[ev.impact]}-impact release from the calendar. Around high-impact releases price can jump in either direction and spreads widen.`, ev.impact === 'hi' ? 'wn' : '') : kpi('Event risk', '—', 'Nothing in 6 hours', `Event risk|No scheduled release for ${m.newsCcy.join(' or ')} in the next 6 hours.`)}
    </div>
    <div class="brx-g2">
      <section class="brx-card brx-chart">
        <div class="brx-hd"><h3>Chart</h3><div class="mini-seg" id="brTf" role="group" aria-label="Chart timeframe">${[[60, '1H', 'One-hour bars, last 5 days: the timeframe of the plan (1H EMA20, 1H ATR)'], [240, '4H', 'Four-hour bars, last 20 days: the timeframe of the trend score']].map(([v, l, d]) => `<button data-tf="${v}" class="${BR.tf === v ? 'on' : ''}" aria-pressed="${BR.tf === v}" title="${d}">${l}</button>`).join('')}</div><div class="brx-layers" id="brLayers" role="group" aria-label="Chart layers">${layers.map(([k, l, c]) => `<button class="brx-tg${BR.layers[k] ? ' on' : ''}" data-l="${k}" aria-pressed="${!!BR.layers[k]}"><i style="background:var(${c})"></i>${l}</button>`).join('')}</div></div>
        <div class="brx-cv"><canvas id="brCh" role="img" aria-label="Chart of ${pretty(sym)} with the moving averages, the key levels and the plan"></canvas></div>
        <div class="brx-cv rsi"><canvas id="brRsi" role="img" aria-label="RSI 14 on the chart's timeframe"></canvas></div>
        <p class="muted small">Hover the chart for prices and indicator values; hover a highlighted number to find it on the chart. 4H shows the EMAs the trend score reads; 1H the ones the plan uses.</p>
      </section>
      <section class="brx-card brx-why">
        <div class="brx-hd"><h3>Why ${sgn(a.score, 0)}</h3></div>
        <div class="brx-scale" aria-hidden="true"><div class="brx-zones"><i style="width:22.5%" class="dn2"></i><i style="width:17.5%" class="dn1"></i><i style="width:20%"></i><i style="width:17.5%" class="up1"></i><i style="width:22.5%" class="up2"></i></div><i class="brx-mk" style="left:${50 + a.score / 2}%"></i>${[-100, -55, -20, 20, 55, 100].map(v => `<span style="left:${50 + v / 2}%">${sgn(v, 0)}</span>`).join('')}</div>
        ${t4.short ? '<p class="muted small">Not enough 4H history for a score yet.</p>' : `
        <div class="brx-comp" tabindex="0"${tipAttr(`Price against the EMA20 (4H)|The EMA20 is the average of the last 20 bars, with more weight on the recent ones. Price ${pA ? 'above' : 'below'} it counts ${pA ? '+1' : '−1'}.`, 'ema')}><span>Price ${pA ? 'above' : 'below'} EMA20</span><b class="mono ${pA ? 'up' : 'dn'}">${pA ? '+1' : '−1'}</b><small class="mono">${fp(sym, t4.px)} ${pA ? '&gt;' : '&lt;'} ${fp(sym, t4.e20)}</small></div>
        <div class="brx-comp" tabindex="0"${tipAttr(`EMA20 against the EMA50 (4H)|The fast average ${eA ? 'above' : 'below'} the slow one: the move has lasted long enough to carry the 20-bar average ${eA ? 'over' : 'under'} the 50-bar one. Counts ${eA ? '+1' : '−1'}.`, 'ema')}><span>EMA20 ${eA ? 'above' : 'below'} EMA50</span><b class="mono ${eA ? 'up' : 'dn'}">${eA ? '+1' : '−1'}</b><small class="mono">${fp(sym, t4.e20)} ${eA ? '&gt;' : '&lt;'} ${fp(sym, t4.e50)}</small></div>
        <div class="brx-comp" tabindex="0"${tipAttr(`Position · 55% of the score|The two checks above add up to ${sgn((pA ? 1 : -1) + (eA ? 1 : -1), 0)} of ±2, so this part gives ${sgn(posPts, 0)} of ±55.`)}><span>Position · 55%</span><b class="mono ${scoreTone(t4.pos)}">${sgn(posPts, 0)}</b><span class="brx-cb">${brBar(t4.pos / .55)}</span></div>
        <div class="brx-comp" tabindex="0"${tipAttr(`Slope · 45% of the score|The EMA20 moved ${sgn(t4.slope, 2)} ATR over the last 5 bars. The full 45 points need 1.2 ATR, so this part gives ${sgn(slpPts, 0)}.`)}><span>EMA20 slope ${sgn(t4.slope, 2)} ATR / 5 bars · 45%</span><b class="mono ${scoreTone(t4.slp)}">${sgn(slpPts, 0)}</b><span class="brx-cb">${brBar(t4.slp / .45)}</span></div>
        <div class="brx-comp tot"><span>Total</span><b class="mono ${tone}">${sgn(a.score, 0)}</b></div>`}
        <h3 class="brx-sub">The same score on each timeframe</h3>
        <table class="brx-tf"><thead><tr><th scope="col">TF</th><th scope="col" title="Price above the EMA20">P &gt; E20</th><th scope="col" title="EMA20 above the EMA50">E20 &gt; E50</th><th scope="col" class="r">Score</th><th scope="col" class="r">RSI</th></tr></thead><tbody>
        ${Object.entries(tfs).map(([k, v]) => `<tr${tipAttr(`${k}|Score ${sgn(Math.round(v.score * 100), 0)}: ${v.label.toLowerCase()}. RSI ${v.rsi.toFixed(0)}.`)}><td>${k}</td>${yes(v.px > v.e20)}${yes(v.e20 > v.e50)}<td class="r mono ${scoreTone(v.score)}">${sgn(Math.round(v.score * 100), 0)} ${v.label.replace('Strong ', '')}</td><td class="r mono">${v.rsi.toFixed(0)}</td></tr>`).join('')}
        </tbody></table>
      </section>
    </div>
    <section class="brx-card brx-read">
      <div class="brx-hd"><h3>Reading</h3></div>
      <p class="lead"><b>Trend.</b> ${r.headline}</p>
      <p><b>Timeframes and currencies.</b> ${r.summary}</p>
      <p><b>Today.</b> ${r.context}</p>
      <p><b>Levels.</b> ${r.bull} ${r.bear}</p>
      <div class="brx-riskp"><b>Risk and positioning.</b>${r.risk.map(x => `<p>${x}</p>`).join('')}</div>
    </section>
    <div class="brx-g3">
      <section class="brx-card"><div class="brx-hd"><h3>Key levels</h3></div>${lvHead}${ladder}${noLv}
        <p class="muted small">Swing highs and lows on 1H over 7 days, the 24h high and low, and round numbers; levels closer than half an ATR merge into one.</p></section>
      <section class="brx-card brx-planc"><div class="brx-hd"><h3>Plan template</h3></div>${planHtml}</section>
      <section class="brx-card brx-ind"><div class="brx-hd"><h3>Indicators</h3></div>
        <div tabindex="0"${tipAttr('RSI(14) on 1H|Under 30 the recent losses outweighed the gains, over 70 the gains outweighed the losses.', 'rsi')}><span class="muted">RSI 14 · 1H</span> <b class="mono">${a.h1.rsi.toFixed(0)}</b>${meter(a.h1.rsi, rsiZones)}<div class="brx-ax"><span style="left:0">0</span><span style="left:30%">30</span><span style="left:70%">70</span><span style="left:100%">100</span></div></div>
        <div tabindex="0"${tipAttr(`ATR now against the week|${a.atrPips.toFixed(1)} ${un} an hour now, ${a.wAtrPips.toFixed(1)} on average at the same hours earlier this week.`)}><span class="muted">ATR 1H · now / week</span> <b class="mono ${a.volRatio > 1.25 ? 'wn' : ''}">${a.atrPips.toFixed(1)}</b> <span class="mono muted">/ ${a.wAtrPips.toFixed(1)} ${un}</span>${meter(Math.min(100, a.volRatio / 2 * 100), '<i class="brx-z" style="left:0;width:50%"></i>')}<div class="brx-ax"><span style="left:0">0</span><span style="left:50%">week</span><span style="left:100%">2×</span></div></div>
        <div tabindex="0"${tipAttr(`Position in the 24h range|Low ${fp(sym, a.dLo)}, high ${fp(sym, a.dHi)}. Price is at ${(a.rangePos * 100).toFixed(0)}% of it.`, 'rng')}><span class="muted">Position in the 24h range</span> <b class="mono">${(a.rangePos * 100).toFixed(0)}%</b>${meter(a.rangePos * 100)}<div class="brx-ax"><span style="left:0">${fp(sym, a.dLo)}</span><span style="left:100%">${fp(sym, a.dHi)}</span></div></div>
        ${strRows ? `<div tabindex="0"${tipAttr('Currency strength, 4 hours|Each currency against the average of the G8 currencies, in basis points (0.01%).')}><span class="muted">Strength 4H</span><div class="brx-str">${strRows}</div></div>` : ''}
      </section>
    </div>
    <p class="br-disc">Generated by rules from tradeBerry's own indicators on simulated data — every statement maps to a number above and describes the past. On this simulated market past trend does not predict the next move. This is not financial advice.</p>`;
  renderScanner();
  brChart(); brRisk();
}
// the plan's risk in money for the size typed under it (the ticket's size by default)
function brRisk() {
  const el = $('#brRisk'), inp = $('#brLots'); if (!el || !inp || !BR.data) return;
  const sym = BR.data.a.sym, lots = Math.max(0, +inp.value || 0), pv = pipValue(sym, lots), eq = account().eq;
  const rk = +el.dataset.risk * pv, rw = +el.dataset.rew * pv;
  el.innerHTML = lots > 0 ? `Risk <b class="mono dn">${usdFmt(rk)}</b> · ${(rk / eq * 100).toFixed(2)}% of equity · at target <b class="mono up">${usdFmt(rw, true)}</b>` : 'Type a size to see the risk in money.';
}
/* ---------- chart: 1H bars with the EMAs, the key levels, the plan, the 24h range and the next events ---------- */
BR.layers = { ema: 1, lv: 1, plan: 1, rng: 0, ev: 1 }; BR.hl = null; BR.hov = -1; BR.tf = 240; // the chart starts on 4H, the score's timeframe
function brChart() {
  const cv = $('#brCh'), rv = $('#brRsi'); if (!cv || !BR.data) return;
  const { a, plan } = BR.data, sym = a.sym, m = a.m, L = BR.layers, c = chartColors(), mono = '11px ' + (cssv('--mono') || 'monospace');
  const tf = BR.tf, sec = tf * 60, all = Engine.aggregate(sym, tf, 170); if (all.length < 2) return;
  const cl = all.map(b => b.close), E20 = emaArr(cl, 20), E50 = emaArr(cl, 50), RS = [];
  for (let i = 0; i < all.length; i++) RS.push(i < 15 ? null : rsiOf(all.slice(Math.max(0, i - 60), i + 1)));
  const N = Math.min(120, all.length), off = all.length - N, B = all.slice(off), FUT = 16;
  const dpr = devicePixelRatio || 1, W = cv.parentElement.clientWidth, H = cv.parentElement.clientHeight || 340, pr = 78;
  if (!W) return;
  cv.width = W * dpr; cv.height = H * dpr; cv.style.width = W + 'px'; cv.style.height = H + 'px';
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H); g.font = mono;
  const lv = [...a.lv.res.map((l, i) => ({ ...l, k: LV_KEYS.res[i] })), ...a.lv.sup.map((l, i) => ({ ...l, k: LV_KEYS.sup[i] }))];
  const vals = B.flatMap(b => [b.high, b.low]);
  if (L.lv) lv.forEach(l => vals.push(l.p));
  if (L.plan && plan && plan.kind !== 'wait') vals.push(plan.stop, plan.target);
  let lo = Math.min(...vals), hi = Math.max(...vals); const pad = (hi - lo) * .06 || m.pip * 10; lo -= pad; hi += pad;
  const cw = (W - pr - 4) / (N + FUT), X = i => 2 + i * cw + cw / 2, y = p => 8 + (hi - p) / (hi - lo) * (H - 26);
  const st = niceStep((hi - lo) / 6), dg = M(sym).digits;
  g.strokeStyle = c.grid; g.lineWidth = 1; g.fillStyle = c.tx;
  for (let p = Math.ceil(lo / st) * st; p <= hi; p += st) { g.beginPath(); g.moveTo(0, y(p)); g.lineTo(W - pr, y(p)); g.stroke(); g.fillText(p.toFixed(dg), W - pr + 6, y(p) + 4); }
  // day separators; on 4H a label only where there is room (a weekday on 1H, the date on 4H)
  let day = -1, lastLx = -99;
  B.forEach((b, i) => { const dt = new Date(b.time * 1000), d = dt.getUTCDate(); if (d === day) return; if (day >= 0 && tf <= 60) { g.strokeStyle = c.grid; g.setLineDash([2, 4]); g.beginPath(); g.moveTo(X(i) - cw / 2, 8); g.lineTo(X(i) - cw / 2, H - 18); g.stroke(); g.setLineDash([]); } day = d; if (X(i) - lastLx < 44) return; g.fillStyle = c.tx; g.fillText(tf <= 60 ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][dt.getUTCDay()] : dt.toISOString().slice(5, 10), X(i) + 2, H - 4); lastLx = X(i); });
  const lastT = B[N - 1].time;
  if (L.rng) { const i0 = Math.max(0, B.findIndex(b => b.time >= lastT - 86400 + sec)); g.fillStyle = cssv('--s3'); g.globalAlpha = .6; g.fillRect(X(i0) - cw / 2, y(a.dHi), X(N - 1) - X(i0) + cw, y(a.dLo) - y(a.dHi)); g.globalAlpha = 1; g.fillStyle = c.tx; g.fillText('24h range', X(i0) + 3, y(a.dHi) + 13); }
  const lab = (p, txt, col, ink) => { g.fillStyle = col; g.fillRect(W - pr, y(p) - 8, pr, 16); g.fillStyle = ink; g.fillText(txt, W - pr + 4, y(p) + 4); };
  if (L.lv) lv.forEach(l => { const on = BR.hl === l.k, col = l.k[0] === 'R' ? c.dn : c.up; g.strokeStyle = col; g.globalAlpha = on ? 1 : .6; g.lineWidth = on ? 2.5 : 1; g.setLineDash(l.why === 'round number' ? [2, 4] : [6, 4]); g.beginPath(); g.moveTo(0, y(l.p)); g.lineTo(W - pr, y(l.p)); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; g.lineWidth = 1; });
  if (L.ev) a.events.slice(0, 4).forEach((e, ei) => { const x = X(N - 1) + (e.t - lastT) / sec * cw; if (x > W - pr) return; const col = e.impact === 'hi' ? cssv('--warn') : c.tx; g.strokeStyle = col; g.lineWidth = BR.hl === 'ev' ? 2 : 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(x, 8); g.lineTo(x, H - 18); g.stroke(); g.setLineDash([]); g.lineWidth = 1; g.fillStyle = col; g.fillText(`${e.ccy} ${e.name}`.slice(0, 18), Math.max(4, Math.min(x + 4, W - pr - 120)), 20 + ei * 13); });
  if (L.plan && plan && plan.kind !== 'wait') {
    const x0 = X(N - 1) + cw * 1.5, x1 = W - pr - 2, on = BR.hl === 'plan', ys = y(plan.stop), ye = y(plan.entry), yt = y(plan.target);
    g.fillStyle = c.dn; g.globalAlpha = on ? .38 : .2; g.fillRect(x0, Math.min(ys, ye), x1 - x0, Math.abs(ye - ys));
    g.fillStyle = c.up; g.globalAlpha = on ? .34 : .17; g.fillRect(x0, Math.min(yt, ye), x1 - x0, Math.abs(ye - yt)); g.globalAlpha = 1;
    g.strokeStyle = c.tx2; g.beginPath(); g.moveTo(x0, ye); g.lineTo(x1, ye); g.stroke();
    g.fillStyle = c.dn; g.fillText('SL', x0 + 3, ys + (ys < ye ? 12 : -4)); g.fillStyle = c.up; g.fillText('TP', x0 + 3, yt + (yt < ye ? 12 : -4));
  }
  B.forEach((b, i) => { const col = b.close >= b.open ? c.up : c.dn; g.strokeStyle = col; g.fillStyle = col; g.beginPath(); g.moveTo(X(i), y(b.high)); g.lineTo(X(i), y(b.low)); g.stroke(); g.fillRect(X(i) - Math.max(.5, cw * .35), y(Math.max(b.open, b.close)), Math.max(1, cw * .7), Math.max(1, Math.abs(y(b.open) - y(b.close)))); });
  if (L.ema) [[E50, c.info, 'EMA50'], [E20, cssv('--ind1'), 'EMA20']].forEach(([e, col, name]) => { g.strokeStyle = col; g.lineWidth = BR.hl === 'ema' ? 2.6 : 1.6; g.beginPath(); for (let i = 0; i < N; i++) { const v = e[off + i]; i ? g.lineTo(X(i), y(v)) : g.moveTo(X(i), y(v)); } g.stroke(); g.lineWidth = 1; g.fillStyle = col; g.fillText(name, X(1), y(e[off + 1]) + (name === 'EMA20' ? -6 : 14)); });
  if (L.lv) lv.forEach(l => lab(l.p, `${l.k} ${fp(sym, l.p)}`, l.k[0] === 'R' ? c.dn : c.up, cssv('--bg')));
  // the current price: neutral ink (amber is selection only)
  g.strokeStyle = c.tx2; g.setLineDash([2, 2]); g.beginPath(); g.moveTo(0, y(a.q.mid)); g.lineTo(W - pr, y(a.q.mid)); g.stroke(); g.setLineDash([]); lab(a.q.mid, fp(sym, a.q.mid), cssv('--s3'), cssv('--tx'));
  if (BR.hov >= 0) { g.strokeStyle = c.line; g.beginPath(); g.moveTo(X(BR.hov), 8); g.lineTo(X(BR.hov), H - 18); g.stroke(); }
  cv._geo = { cw, N, off, B, E20, E50, RS };
  if (!rv) return;
  const RH = rv.parentElement.clientHeight || 80; rv.width = W * dpr; rv.height = RH * dpr; rv.style.width = W + 'px'; rv.style.height = RH + 'px';
  const r = rv.getContext('2d'); r.setTransform(dpr, 0, 0, dpr, 0, 0); r.clearRect(0, 0, W, RH); r.font = mono; const ry = v => 4 + (100 - v) / 100 * (RH - 8);
  r.fillStyle = c.up; r.globalAlpha = .08; r.fillRect(0, ry(30), W - pr, ry(0) - ry(30)); r.fillStyle = c.dn; r.fillRect(0, ry(100), W - pr, ry(70) - ry(100)); r.globalAlpha = 1;
  [30, 50, 70].forEach(v => { r.strokeStyle = c.grid; r.beginPath(); r.moveTo(0, ry(v)); r.lineTo(W - pr, ry(v)); r.stroke(); r.fillStyle = c.tx; r.fillText(v, W - pr + 6, ry(v) + 4); });
  r.strokeStyle = cssv('--ind1'); r.lineWidth = BR.hl === 'rsi' ? 2.4 : 1.4; r.beginPath(); let on = false; for (let i = 0; i < N; i++) { const v = RS[off + i]; if (v == null) continue; on ? r.lineTo(X(i), ry(v)) : r.moveTo(X(i), ry(v)); on = true; } r.stroke();
  r.fillStyle = c.tx2; r.fillText(`RSI 14 · ${tf === 240 ? '4H' : '1H'}`, 4, 14);
  if (BR.hov >= 0) { r.strokeStyle = c.line; r.beginPath(); r.moveTo(X(BR.hov), 0); r.lineTo(X(BR.hov), RH); r.stroke(); }
}
/* ---------- explanations on hover and focus ---------- */
function brTipShow(raw, x, y, html) {
  let tip = $('#brTip'); if (!tip) { tip = document.createElement('div'); tip.id = 'brTip'; tip.setAttribute('role', 'tooltip'); document.body.appendChild(tip); }
  const i = raw.indexOf('|');
  tip.innerHTML = html ? raw : i < 0 ? escHtml(raw) : `<b>${escHtml(raw.slice(0, i))}</b>${escHtml(raw.slice(i + 1))}`;
  tip.style.display = 'block';
  const r = tip.getBoundingClientRect();
  tip.style.left = Math.max(8, Math.min(x + 14, innerWidth - r.width - 8)) + 'px';
  tip.style.top = (y + 20 + r.height > innerHeight ? y - r.height - 12 : y + 20) + 'px';
}
function brTipHide() { const tip = $('#brTip'); if (tip) tip.style.display = 'none'; }
function brLight(k) {
  if (BR.hl === k) return; BR.hl = k;
  $$('#brMain .brx-lv.lit').forEach(x => x.classList.remove('lit')); if (k) $$(`#brMain .brx-lv[data-k="${k}"]`).forEach(x => x.classList.add('lit'));
  brChart();
}
/* One explanation layer for the analysis pages (Market Brief, Observatory): any [data-tip] inside them shows its
   'Title|explanation' on hover and focus. CV_HOVER[canvas id](event | null) draws a chart's own readout under the
   pointer (null: the pointer left). */
const TIP_SCOPE = '.brief, .obs, .corr-wrap, .volgrid', CV_HOVER = {};
let tipBound = false;
function tipBind() {
  if (tipBound) return; tipBound = true;
  const tipOf = e => { const el = e.target.closest && e.target.closest('[data-tip]'); return el && el.closest(TIP_SCOPE) ? el : null; };
  const over = e => { const el = tipOf(e); if (!el) return; const r = el.getBoundingClientRect(); brTipShow(el.dataset.tip, e.clientX ?? r.left, e.clientY ?? r.bottom - 10); if (el.closest('#brMain')) brLight(el.dataset.k || null); };
  const out = e => { const el = tipOf(e); if (!el || (e.relatedTarget && el.contains(e.relatedTarget))) return; brTipHide(); if (el.closest('#brMain')) brLight(null); };
  document.addEventListener('mouseover', over); document.addEventListener('mouseout', out);
  document.addEventListener('focusin', over); document.addEventListener('focusout', out);
  document.addEventListener('mousemove', e => {
    const id = e.target.id; if (id && CV_HOVER[id]) return CV_HOVER[id](e);
    const el = tipOf(e), tip = $('#brTip'); if (el && tip && tip.style.display === 'block') brTipShow(el.dataset.tip, e.clientX, e.clientY);
  });
  document.addEventListener('mouseout', e => { const id = e.target.id; if (id && CV_HOVER[id] && !(e.relatedTarget && e.target.contains(e.relatedTarget))) { brTipHide(); CV_HOVER[id](null); } });
}
// a readout for a chart: title and lines (plain text, escaped)
function cvTip(e, title, lines) {
  brTipShow('', e.clientX, e.clientY);
  const tip = $('#brTip'); tip.innerHTML = `<b>${escHtml(title)}</b>${lines.map(l => `<span class="mono">${escHtml(l)}</span>`).join('')}`;
  brTipShow(tip.innerHTML, e.clientX, e.clientY, true);
}
// the bar under the pointer: time, OHLC and the indicator values
function brHover(e) {
  const cv = $('#brCh'), geo = cv && cv._geo; if (!geo || !BR.data) return;
  const rc = cv.getBoundingClientRect(), i = Math.floor((e.clientX - rc.left - 2) / geo.cw);
  if (i < 0 || i >= geo.N) { if (BR.hov !== -1) { BR.hov = -1; brChart(); } brTipHide(); return; }
  if (i !== BR.hov) { BR.hov = i; brChart(); }
  const b = geo.B[i], s = BR.data.a.sym, k = geo.off + i, f = v => fp(s, v), rs = geo.RS[k];
  const tip = $('#brTip') || (brTipShow('', 0, 0), $('#brTip'));
  brTipShow('', e.clientX, e.clientY);
  tip.innerHTML = `<b>${new Date(b.time * 1000).toISOString().slice(5, 16).replace('T', ' ')} UTC</b><span class="mono">O ${f(b.open)} · H ${f(b.high)}<br>L ${f(b.low)} · C ${f(b.close)}</span><span class="mono" style="color:var(--ind1)">EMA20 ${f(geo.E20[k])}</span><span class="mono" style="color:var(--info)">EMA50 ${f(geo.E50[k])}</span>${rs != null ? `<span class="mono">RSI ${rs.toFixed(0)}</span>` : ''}`;
}
function briefAsText() {
  if (!BR.data) return '';
  const { a, plan, t } = BR.data, s = a.sym;
  const lv = l => `${fp(s, l.p)} (${l.why})`;
  return [`TRADEBERRY — MARKET BRIEF · ${pretty(s)} @ ${fp(s, a.q.mid)} · ${new Date(a.at * 1000).toISOString().slice(0, 16).replace('T', ' ')} UTC`, '', t.headline, t.summary, t.context, '',
    `Levels above: ${t.bull}`, `Levels below: ${t.bear}`, '', ...t.risk.map(r => `• ${r}`), '',
    `Resistance: ${a.lv.res.map(lv).join(', ') || '—'}`, `Support: ${a.lv.sup.map(lv).join(', ') || '—'}`, '',
    `Plan template: ${t.planText}`, plan && plan.kind !== 'wait' ? `${plan.side.toUpperCase()} ${plan.ot} ${fp(s, plan.entry)} · SL ${fp(s, plan.stop)} · TP ${fp(s, plan.target)}` : ''].join('\n').replace(/<[^>]+>/g, '');
}
function loadPlan() {
  const p = BR.data?.plan; if (!p || p.kind === 'wait') return;
  const sym = BR.data.a.sym, m = M(sym);
  if (S.set.sym !== sym) setSymbol(sym);
  Object.assign(S.tk, { side: p.side, ot: p.ot, price: p.ot === 'market' ? null : p.entry, sl: +(Math.abs(p.entry - p.stop) / m.pip).toFixed(1), tp: +(Math.abs(p.target - p.entry) / m.pip).toFixed(1), useSL: true, useTP: true, useTrail: false });
  // a plan never carries a large lot size over silently: above 5 lots it resets to 1 and says so
  const typed = +($('#brLots') || {}).value; if (typed > 0 && S.tk.sm === 'lots') S.tk.lots = typed;
  const reset = S.tk.sm === 'lots' && m.lotName === 'lots' && S.tk.lots > 5 ? S.tk.lots : null;
  if (reset != null) S.tk.lots = Math.max(m.p.vol[0], 1);
  syncTicketInputs();
  toast('Plan loaded into ticket', `${p.side} ${p.ot} ${pretty(sym)} · SL ${S.tk.sl}${uShort(sym)} · TP ${S.tk.tp}${uShort(sym)}${reset != null ? ` · size reset from ${reset} to ${lotsWord(sym, S.tk.lots)}` : ''} — review size, then submit`, 'info');
  document.querySelector('.ticket').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  const t = document.querySelector('.ticket'); t.classList.add('pulse'); setTimeout(() => t.classList.remove('pulse'), 1400);
}
// the Market Brief is a desktop and tablet tool: the phone layout (mnav) has no room for its chart and panels
function openBrief(sym) {
  if (document.body.classList.contains('mnav-on')) { toast('Market Brief', 'The Market Brief is available on a larger screen.', 'info'); return; }
  setTab('brief'); generateBrief(sym || S.set.sym);
}

function bindBrief() {
  $('#briefBtn').addEventListener('click', () => openBrief());
  $('#brScan').addEventListener('click', e => { const b = e.target.closest('.scan-row'); if (b) { setSymbol(b.dataset.sym); generateBrief(b.dataset.sym); } });
  tipBind();
  CV_HOVER.brCh = e => { if (e) return brHover(e); if (BR.hov !== -1) { BR.hov = -1; brChart(); } };
  $('#brMain').addEventListener('input', e => { if (e.target.id === 'brLots') brRisk(); });
  let rz = 0; new ResizeObserver(() => { cancelAnimationFrame(rz); rz = requestAnimationFrame(brChart); }).observe($('#brMain'));
  $('#brMain').addEventListener('click', e => {
    const tb = e.target.closest('#brTf button'); if (tb) { BR.tf = +tb.dataset.tf; BR.hov = -1; $$('#brTf button').forEach(x => { const on = x === tb; x.classList.toggle('on', on); x.setAttribute('aria-pressed', String(on)); }); brChart(); return; }
    const tg = e.target.closest('#brLayers button'); if (tg) { const k = tg.dataset.l; BR.layers[k] = BR.layers[k] ? 0 : 1; tg.classList.toggle('on', !!BR.layers[k]); tg.setAttribute('aria-pressed', String(!!BR.layers[k])); brChart(); return; }
    if (e.target.closest('#brRegen')) generateBrief(BR.sym);
    if (e.target.closest('#brLoad')) loadPlan();
    if (e.target.closest('#brCopy')) {
      const txt = briefAsText();
      const done = () => toast('Brief copied', `${pretty(BR.sym)} · paste anywhere`, 'info');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(txt).then(done, () => fallbackCopy(txt, done)); else fallbackCopy(txt, done);
    }
    if (e.target.closest('#brAlerts')) { const a = BR.data.a; [a.lv.res[0], a.lv.sup[0]].filter(Boolean).forEach(l => addAlert(a.sym, l.p)); }
    const al = e.target.closest('[data-alert]'); if (al) addAlert(BR.sym, +al.dataset.alert);
  });
}
function fallbackCopy(txt, done) {
  const ta = document.createElement('textarea'); ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0'; document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); done(); } catch (e) { toast('Copy failed', 'Select the brief text manually', 'dn'); }
  ta.remove();
}
// keep the brief in sync when the user switches symbol while the tab is open
function briefTick() {
  if (activeTab !== 'brief') return;
  if (BR.sym !== S.set.sym) { generateBrief(S.set.sym); return; }
  const evIn = $('#brEvIn'); if (evIn) evIn.textContent = fmtIn(+evIn.dataset.t - Engine.simTime);
  const stale = $('#brMain .br-head .muted.small');
  if (stale && BR.data) { const mins = Math.round((Engine.simTime - BR.at) / 60); stale.textContent = `Generated ${new Date(BR.at * 1000).toISOString().slice(11, 16)} UTC${mins >= 1 ? ` · ${mins} min ago` : ''} · from simulated terminal data`; }
  if (Engine.simTime - BR.at > 30 * 60) generateBrief(BR.sym);
}
