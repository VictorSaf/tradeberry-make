'use strict';
/* tradeBerry — account math and trading. Classic script sharing globals with app.js; loaded right after it.
   v15 (.mace/design/catalog.md §4, contract C3): every number of the account comes from the instrument sheet
   (Engine.META[sym].p, profile Default): leverage, volumes, sessions, trade status, minimum pending distance, maximum
   deviation, swap and commission. A jurisdiction (S.set.jur) is an optional cap on top of it, none by default. */
/* The rules of the account (money, margin, leverage, volumes, execution, swap, the order model, netting, stop-out)
   are core/account.js (AccountCore), shared with the server. This file is its browser adapter: the global names the
   modules call and wrap, on S and Engine, and everything the user sees (toasts, beeps, confirmations, texts). */
let fillRng = Math.random; // execSeed(n): seeded fill noise (tests); Math.random otherwise
function execSeed(n) { fillRng = n == null ? Math.random : AccountCore.seeded(n); }
const AC = AccountCore.create({
  market: { get META() { return Engine.META; }, quote: s => Engine.quote(s), usd: c => Engine.usd(c), mid: s => Engine.mid(s), nyOffset: t => Engine.nyOffset(t), serverOffset: t => Engine.serverOffset(t) },
  rng: () => fillRng(), now: () => Engine.simTime,
  // a replay stays reproducible and a paused market has firm quotes: both fill at the quote
  live: () => Engine.speed > 0 && (Engine.mode || 'live') === 'live', speed: () => Engine.speed, vol: sym => vol1s(sym),
  replayOff: sym => replayOff(sym), opens: sym => opensText(sym)
});
/* ============ account math ============ */
/* Money on any instrument goes through its contract size (M(sym).size: 100,000 units of the base currency per FX
   lot, 50 per point on US.500, 1 share on a stock, …) and is paid in its quote currency. pip is the displayed unit:
   a pip on FX, the platform's point otherwise. */
const pipValue = (sym, lots = 1) => AC.pipValue(sym, lots);
function posPnl(p) { return AC.posPnl(p); }
// the displayed unit in words: 'pips' on FX, 'pt' (points) otherwise; one: 'pip' / 'pt'
const unitWord = (sym, one = false) => M(sym) && M(sym).unit === 'pt' ? 'pt' : one ? 'pip' : 'pips';
// one lot in words: '1 lot = 100,000 EUR', '1 lot = 100 Ounces', '1 lot = $50 per point', '1 share'. Where the platform's
// point (pt, the unit of stops and targets) is a fraction of the price (0.01 on BCH/EUR, 0.1 on DE.30), "per point"
// would read as per pt: the text then says what a whole move and one pt are worth, '1 lot = €1 per 1.00 move · 1 pt
// (0.01) = €0.01'
const CCY_SIGN = { USD: '$', EUR: '€', GBP: '£', JPY: '¥' };
const CLS_LABEL = { 'fx-major': 'major pair', 'fx-minor': 'minor pair', gold: 'gold', 'index-major': 'major index', 'index-minor': 'minor index', commodity: 'commodity', crypto: 'crypto', equity: 'equity' };
function contractText(sym) {
  const m = M(sym);
  if (m.kind !== 'cfd') return `1 lot = ${nf0.format(m.size)} ${m.base}`;
  if (m.lotName === 'shares') return m.size === 1 ? '1 share' : `1 lot = ${nf0.format(m.size)} shares`;
  if (m.sizeUnit === 'point') return m.pip === 1 ? `1 lot = ${CCY_SIGN[m.quote] || m.quote + ' '}${nf0.format(m.size)} per point`
    : `1 lot = ${CCY_SIGN[m.quote] || m.quote + ' '}${nf0.format(m.size)} per ${(1).toFixed(m.digits)} move · ${ptWorth(sym)}`;
  return `1 lot = ${nf0.format(m.size)} ${m.sizeUnit || 'units'}`;
}
// what one pt (the unit of stops and targets) moves, and what it is worth for a size, in the quote currency: '1 pt (0.01) = €0.01'
function ptWorth(sym, lots = 1) {
  const m = M(sym), v = lots * m.size * m.pip, s = CCY_SIGN[m.quote] || m.quote + ' ';
  return `1 pt (${m.pip.toFixed(m.digits)}) = ${s}${smallMoney(v)}`;
}
// an amount that may be a fraction of a cent: two decimals from one cent up, else its first significant figures
const smallMoney = v => (Math.abs(v) >= .01 || v === 0 ? nf2.format(v) : String(+v.toPrecision(2)));
// USD notional: FX = lots × size units of the base currency in USD; otherwise lots × size × bid in the quote currency
const notionalUsd = (sym, lots) => AC.notionalUsd(sym, lots);

/* ---------- volumes (sheet vol: [min, max, step]) ---------- */
const volOf = sym => AC.volOf(sym);
const lotDec = sym => AC.lotDec(sym);
// a size rounded to the sheet's step (0.01 lots on FX, 1 share, 100 XRP lots); nothing is clamped here
function normLots(sym, v) { return AC.normLots(sym, v); }
const lotsFmt = (sym, lots) => (+lots).toFixed(lotDec(sym));
// '1 share' / '2 shares' / '0.01 lots' / '400 lots'
const lotsWord = (sym, lots) => { const n = Number.isInteger(+lots) ? nf0.format(lots) : lotsFmt(sym, lots), u = M(sym).lotName === 'shares' ? 'share' : 'lot'; return `${n} ${u}${+lots === 1 ? '' : 's'}`; };
// '' or why a size is outside the sheet's min/max
function volWhy(sym, lots) { return AC.volWhy(sym, lots); }

/* ---------- leverage: min(sheet [or the user's choice, up to the sheet maximum], jurisdiction cap) ----------
   The rules and the tables (ESMA Annex I for EU, UK without crypto and AU; NFA for the US) are core/account.js. */
const NFA_MAJORS = AC.NFA_MAJORS, ESMA_CAP = AC.ESMA_CAP, JUR = AC.JUR;
const JUR_KEYS = Object.keys(JUR);
// no jurisdiction cap, in words (UX 09.11.2026, F3: labels only): the sheet's own default and the EU limit it is not held to
// flat: the same words without parentheses, for a text that is itself inside parentheses
const noCapText = flat => `sheet default 1:${M('EURUSD') ? M('EURUSD').p.lev[0] : 500} · no EU limit${flat ? '; ' : ' ('}ESMA caps EUR/USD at 1:${ESMA_CAP['fx-major']}${flat ? '' : ')'}`;
const LEV_CHOICES = SET_ENUM.lev, LEV_MAX = Math.max(...Engine.INSTR.map(m => m.p.lev[1]));
// kept for modules that still read the v14 names: no class ceiling any more (the sheet maximum is the ceiling)
const CHOICE_CEIL = {}, CHOICE_CEIL_LABEL = 'the instrument sheet maximum';
const jurOf = set => AC.jurOf(set);
// margin class under a jurisdiction: for a pair, the regime's own major list if it has one, else the sheet class
const levCls = (sym, j = jurOf(S.set)) => AC.levCls(sym, j);
// the sheet's leverage for the user's choice: the default, or the choice up to the maximum
const sheetLev = (sym, set = S.set) => AC.sheetLev(sym, set);
// the jurisdiction's cap on the instrument (Infinity: none); a class not offered keeps the ESMA cap as its margin
const jurCap = (sym, set = S.set) => AC.jurCap(sym, set);
const effLev = (sym, set = S.set) => AC.effLev(sym, set);
// the jurisdiction cuts the sheet's leverage on this instrument (watchlist badge)
const capBinds = (sym, set = S.set) => jurCap(sym, set) < sheetLev(sym, set);

/* ---------- trade status and sessions ----------
   tradeStatus(sym) → 'off' (not offered: unknown, the jurisdiction does not offer its class, or a replay that does
   not cover it), 'close' (CLOSE ONLY on the sheet: reductions and closes only) or 'full'. Sessions are separate: a
   'full' instrument still trades only while its market is open. profile: a set ({jur, lev}), a key ('uk', 'none:200')
   or nothing (S.set). */
const setOf = profile => profile == null ? S.set : typeof profile === 'string' ? { ...S.set, ...(parseLevKey(profile) || {}) } : profile;
const replayOff = sym => Engine.isReplayDoc && !Engine.PAIRS.some(p => p.sym === sym);
function tradeStatus(sym, profile) { return AC.tradeStatus(sym, setOf(profile)); }
function unavailableWhy(sym, profile) { return AC.unavailableWhy(sym, setOf(profile)); }
// the same text with the rule behind it, for tooltips and the order log
function unavailableNote(sym, profile) {
  const w = unavailableWhy(sym, profile), j = jurOf(setOf(profile)), m = M(sym);
  const r = w && m && tradeStatus(sym, profile) === 'off' && j.why ? j.why[m.cls] || (m.kind === 'cfd' ? j.why.cfd : '') : '';
  return r ? `${w} (${r})` : w;
}
const isAvailable = (sym, profile) => tradeStatus(sym, profile) === 'full';
const instrAvail = (sym, set = S.set) => isAvailable(sym, set);
const instrumentsFor = profile => Engine.INSTR.filter(m => isAvailable(m.sym, profile));
// close only: CLOSE ONLY on the sheet, or not offered with a position still open on it (reduce and close, add nothing)
const closeOnly = sym => AC.closeOnly(S, sym);
const DOW3 = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hm2 = (h, m) => String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
// 'opens Mon 15:35 (local) / 13:35 UTC' (local = the browser's time zone), '' when open or no opening is known
function opensText(sym, t = Engine.simTime) {
  const s = Engine.session(sym, t); if (!s || s.open || !s.opensAt) return '';
  const d = new Date(s.opensAt * 1000), sameDay = d.getDay() === d.getUTCDay();
  return `opens ${DOW3[d.getDay()]} ${hm2(d.getHours(), d.getMinutes())} (local) / ${sameDay ? '' : DOW3[d.getUTCDay()] + ' '}${hm2(d.getUTCHours(), d.getUTCMinutes())} UTC`;
}
// '' while the instrument quotes; else why it cannot be traded now ('Market closed — opens …', 'Off quotes — …')
function marketWhy(sym) { return AC.marketWhy(sym); }
const marketOpen = sym => AC.marketOpen(sym);

// what a jurisdiction does to the instruments in this set, in words
function capText(j) {
  if (j.none) return 'no cap: each instrument at its sheet leverage';
  const minor = Engine.FX.some(p => levCls(p.sym, j) === 'fx-minor');
  const fx = minor ? `1:${j.cap['fx-major']} on pairs of ${j.majorsName || 'major currencies'}, 1:${j.cap['fx-minor']} on other pairs` : `1:${j.cap['fx-major']} on every pair`;
  if (j.cap.gold == null) return `${fx}; CFDs not offered to retail`;
  return `${fx}; CFDs: 1:${j.cap.gold} gold and major indices, 1:${j.cap.commodity} other commodities and minor indices, 1:${j.cap.equity} stocks, ` + (j.cap.crypto == null ? 'crypto not offered to retail' : `1:${j.cap.crypto} crypto`);
}
/* Initial margin (decision 35, ESMA Q&A 5.8): fixed per position when it opens (p.im = notional at the fill / the
   effective leverage, the figure the margin check used), scaled on a partial close, rescaled by a leverage profile
   change; used margin, margin level and the stop-out read Σ im. A position saved without im is margined at its entry
   price (once, then kept). An order or a bare {sym, lots} (no entry) is margined at the current price (decision 13). */
const MARGIN_TEXT = 'Margin level = equity ÷ used margin × 100. Under 100% no new position can open; at 50% the broker closes positions (stop-out). Used margin is the initial margin of each position, fixed when it opens (notional at the fill ÷ leverage) and scaled when part of it is closed; it does not follow the price. A position saved by an older version uses its entry price. Margin level and the 50% stop-out are measured on it. A leverage or jurisdiction change rescales it.';
const okIm = v => AC.okIm(v);
const imAtEntry = (p, set = S.set) => AC.imAtEntry(p, set);
function posMargin(p, set) { return AC.posMargin(p, S.set, set || S.set); }
const levText = (set = S.set) => set.lev > 0 ? '1:' + set.lev : 'Sheet default';
const levKey = (set = S.set) => `${JUR[set.jur] ? set.jur : 'none'}:${set.lev > 0 ? set.lev : 'default'}`;
/* A profile key: a jurisdiction ('none', 'eu', …), a leverage ('default', '200'), or both ('eu:default', 'none:200';
   the v14 'pro:200' / 'sim:200' read as 'none:200'). → the fields it sets, or null. */
function parseLevKey(v) {
  const s = String(v), [a, b] = s.includes(':') ? s.split(':') : [s, undefined], out = {};
  const lev = x => x === 'default' || x === 'null' ? null : LEV_CHOICES.includes(+x) ? +x : undefined;
  if (b === undefined) {
    if (Object.prototype.hasOwnProperty.call(JUR, a)) out.jur = JUR[a] === JUR.none ? 'none' : a;
    else { const l = lev(a); if (l === undefined) return null; out.lev = l; }
    return out;
  }
  if (!Object.prototype.hasOwnProperty.call(JUR, a)) return null;
  const l = lev(b); if (l === undefined) return null;
  return { jur: JUR[a] === JUR.none ? 'none' : a, lev: l };
}
// #levSel (status bar) = the leverage choice; #jurSel (Settings, built here) = the optional cap
function buildLevSel() {
  const sel = $('#levSel');
  if (sel) sel.innerHTML = `<option value="default">Sheet default</option>` + LEV_CHOICES.map(l => `<option value="${l}">1:${l}</option>`).join('');
  buildJurSel(); syncLevSel();
  // the margin convention, on the figures that show it (status bar Used margin, header Margin level)
  for (const id of ['mMargin', 'mLevel']) { const el = $('#' + id), box = el && el.closest('.m'); if (box) box.title = MARGIN_TEXT; }
}
function buildJurSel() {
  if ($('#jurSel')) return;
  const box = $('#help .help-set'); if (!box) return;
  const lb = document.createElement('label'); lb.className = 'set-row';
  lb.innerHTML = `<span><b>Jurisdiction cap</b><small class="muted">Optional regulatory leverage cap on top of the instrument sheet: ESMA Annex I for EU, UK (no crypto) and AU; NFA for the US (no CFDs). None: every instrument at its sheet leverage.</small></span>`
    + `<select id="jurSel">${JUR_KEYS.map(k => `<option value="${k}">${escHtml(JUR[k].opt)}</option>`).join('')}</select>`;
  box.appendChild(lb);
  const mn = document.createElement('p'); mn.className = 'muted'; mn.id = 'marginNote'; mn.textContent = MARGIN_TEXT;
  box.appendChild(mn);
  $('#jurSel').addEventListener('change', e => requestProfile(e.target.value));
}
function syncLevSel() {
  const sel = $('#levSel'), js = $('#jurSel'), j = jurOf(S.set);
  if (sel) {
    const v = S.set.lev > 0 && LEV_CHOICES.includes(S.set.lev) ? String(S.set.lev) : 'default'; if (sel.value !== v) sel.value = v;
    const t = `Leverage: ${S.set.lev > 0 ? `1:${S.set.lev} where the instrument sheet allows it (never above its maximum)` : 'the instrument sheet default'}; ${j.none ? noCapText() : `capped by ${j.name} (${capText(j)})`}${j.note ? '. ' + j.note : ''}`;
    if (sel.title !== t) { sel.title = t; const lb = sel.closest('label'); if (lb) lb.title = t; }
  }
  if (js) { const k = JUR[S.set.jur] === JUR.none || !JUR[S.set.jur] ? 'none' : S.set.jur; if (js.value !== k) js.value = k; }
}
// applying a profile cancels at once the pending orders on instruments it does not offer
// Under a retail jurisdiction S.set.lev is set to its major cap, as loadState (app.js) keeps it; that never changes
// effLev, since every class cap of a regime is at or below its major cap.
function applyProfile(key) {
  const v = parseLevKey(key); if (!v) return false;
  if (TradeLink.live) { const set = { ...S.set, ...v }; if (!jurOf(set).choice) set.lev = jurOf(set).cap['fx-major']; return tlSettings({ jur: set.jur, lev: set.lev }); }
  const was = S.positions.filter(p => M(p.sym)).map(p => [p, posMargin(p), effLev(p.sym)]);
  Object.assign(S.set, v);
  { const j = jurOf(S.set); if (!j.choice) S.set.lev = j.cap['fx-major']; }
  // the initial margin of open positions follows the new leverage (the preview in requestProfile shows the same)
  for (const [p, im, l0] of was) p.im = im * l0 / effLev(p.sym);
  syncLevSel(); dirty.lines = true; save();
  dropUnavailableOrders();
  return true;
}
/* With open positions, or with pending orders on instruments the new profile does not offer, a change first shows
   what it does: used margin and margin level, the instruments no longer offered, the positions that become close-only
   and the orders that will be cancelled. */
function requestProfile(key) {
  const v = parseLevKey(key); if (!v) { syncLevSel(); return; }
  const set = { ...S.set, ...v }, j = jurOf(set), n = S.positions.length;
  const lost = Engine.INSTR.filter(m => isAvailable(m.sym, S.set) && !isAvailable(m.sym, set)).map(m => m.sym);
  const lp = S.positions.filter(p => lost.includes(p.sym)).length, lo = S.orders.filter(o => lost.includes(o.sym)).length;
  if (!n && !lo) { applyProfile(key); return; }
  const a = account(), mg = S.positions.reduce((s, p) => s + posMargin(p, set), 0), lv = mg ? a.eq / mg * 100 : Infinity;
  const f = x => isFinite(x) ? nf0.format(x) + '%' : '—';
  const names = lost.slice(0, 8).map(s => M(s).short).join(', ') + (lost.length > 8 ? ` and ${lost.length - 8} more` : '');
  const lossTxt = !lp && !lo ? '' : ` Not offered under ${j.name}: ${names}.` +
    (lp ? ` ${lp} open position${lp > 1 ? 's become' : ' becomes'} close-only${lo ? ';' : '.'}` : '') + (lo ? ` ${lo} pending order${lo > 1 ? 's' : ''} will be cancelled.` : '');
  syncLevSel(); // the selects keep showing the active profile until the change is confirmed
  askConfirm({
    title: 'Change leverage?', ok: 'Apply', kind: lv < 50 ? 'sell' : '',
    body: `Leverage ${levText(set)}, ${j.none ? noCapText() : `${j.name}: ${capText(j)}`}.` +
      (n ? ` With your ${n} open position${n > 1 ? 's' : ''}: used margin ${usdFmt(a.mg)} → ${usdFmt(mg)}, margin level ${f(a.level)} → ${f(lv)}.` +
        (lv < 50 ? ' That is below the 50% stop-out level: positions would be closed at once, worst first.' : lv < 100 ? ' Below 100%: no free margin for new trades.' : '') : '') + lossTxt,
    onOk: () => applyProfile(key)
  });
}
/* Pending orders on an instrument that is not offered (jurisdiction, replay) or close only leave the book (a row in
   the order log, one toast). Runs when a profile is applied and once after every boot or import (loadState). */
function dropUnavailableOrders() {
  if (TradeLink.live) return 0; // the broker drops them on the live account
  const gone = S.orders.filter(o => !isAvailable(o.sym));
  if (!gone.length) return 0;
  const names = [...new Set(gone.map(o => M(o.sym) ? M(o.sym).short : o.sym))].join(', ');
  for (const o of gone) endOrder(o, 'cancelled', unavailableNote(o.sym));
  toast(`Orders cancelled: ${names}`, `${gone.length} pending order${gone.length > 1 ? 's' : ''} on ${names} cancelled: ${unavailableWhy(gone[0].sym)}.`, 'info');
  return gone.length;
}

/* ============ swap (sheet p.swap: [long, short, unit]) ============
   'pts' (FX): points per lot a night, swap × point × size × lots in the quote currency; 'pctYr' (everything else):
   a yearly fraction of the notional, notional × swap / 360 a night (−0.05 = −5% a year, as the broker platform
   shows it). The sign comes from the sheet (negative = the position pays). Rollover at 17:00 New York (00:00 server
   time): FX and everything else Monday to Friday, three nights on the triple day (FX Wednesday, the rest Friday);
   crypto every night, no triple (a simulation convention, labelled). */
const SWAP_LABEL = 'swap from the instrument sheet (Default profile)';
// kept for modules that still read the v14 names: the swap has no policy-rate table and no markup any more
const POLICY_RATES_LABEL = SWAP_LABEL, SWAP_MARKUP = 0, FIN_LABEL = SWAP_LABEL;
const swapUnit = sym => M(sym).p.swap[2];
const isCrypto = sym => M(sym).group === 'crypto';
function swapPerNight(sym, side, lots) { return AC.swapPerNight(sym, side, lots); }
// the same as % a year of the notional (for display)
const swapRate = (sym, side) => { const m = M(sym), [l, s, u] = m.p.swap, v = side === 'buy' ? l : s; if (u !== 'pts') return v * 100; const n = notionalUsd(sym, 1); return n ? swapPerNight(sym, side, 1) * 360 / n * 100 : 0; };
// in words: '−9.217 pts long / −8.771 pts short', '−5.00% / −5.00% a year'
function swapText(sym) {
  const [l, s, u] = M(sym).p.swap;
  return u === 'pts' ? `${nfx(l, 3)} pts long / ${nfx(s, 3)} pts short a night` : `${nfx(l * 100, 2)}% long / ${nfx(s * 100, 2)}% short a year (÷ 360 a night)`;
}
const nyDow = t => AC.nyDow(t);
// the triple day by New York weekday: 3 FX (Wednesday), 5 the rest (Friday), null crypto (every night, no triple)
const tripleDow = sym => AC.tripleDow(sym);
const TRIPLE_TEXT = sym => tripleDow(sym) == null ? 'every night, no triple (crypto convention)' : `triple on ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][tripleDow(sym)]}`;
// nights a position on sym is financed by the rollover at t (no symbol: FX)
function rolloverNights(t, sym) { return AC.rolloverNights(t, sym); }
// the first rollover strictly after t: any day (no symbol), or one that finances sym
function nextRollover(t, sym) { return AC.nextRollover(t, sym); }
function nextTriple(t, sym) { return AC.nextTriple(t, sym); }
/* The swap of every rollover since the last call (core rollover). The first call only arms it: rollLast is not
   saved, so rollovers while the app was closed are not booked here. */
const rollAcct = { positions: [], rollLast: null };
function rolloverTick() {
  if (TradeLink.live) return; // the broker books the swap of the live account
  rollAcct.positions = S.positions;
  if (AC.rollover(rollAcct, Engine.simTime).length) save();
}
/* costModel(sym) → the sheet's costs as pure functions (contract C2), for the backtester's 'account' cost mode:
   commRT(lots): commission round turn in USD (the sheet's + the account's extra, as commOf);
   swapNight(side, lots, px, tUtc): the swap in USD booked by the rollover at tUtc (×3 on the triple day, 0 when that
     rollover does not finance the instrument), at price px for a % a year swap;
   spreadAt(tUtc): ask − bid in price units, the Default spread or the Night spread (23:00–01:00 server time, Monday to
     Friday); a crypto jitter counts at its midpoint;
   newsInSpread: false — the News spread is live only (a calendar release), not part of spreadAt.
   Currency conversion uses the rate at the call; nothing else reads the live market. */
const srvNight = t => AC.srvNight(t);
function costModel(sym) {
  const c = AC.costModel(S.set, sym);
  if (c) c.commRT = lots => commOf(lots, sym); // the account's extra as it is at the call
  return c;
}
// { fl, mg, eq, free, level } (and the core's names: balance, equity, margin)
function account() { return AC.summary(S); }

/* ============ trading ============ */
// the last reason openPosition refused a fill, so a pending order that could not be filled can say why
let lastReject = '';
// true while a basket leg opens or closes: the basket tool says it once for all its legs (one summary toast, no beep per leg)
let legQuiet = false;
const legToast = (...a) => { if (!legQuiet) toast(...a); }, legBeep = k => { if (!legQuiet) beep(k); };
// one wording for a stop loss that would sit inside the spread (ticket button, openPosition, placeOrder)
const stopInSpreadWhy = (sym, spread) => `Stop inside the spread (${spread.toFixed(1)} ${unitWord(sym)}) — widen it`;
// last: the order-log wording when it is not 'title (why)'
const reject = (title, why, last) => { lastReject = last ?? `${title.toLowerCase()} (${why})`; legToast(title, why, 'dn'); legBeep('err'); return null; };
// a refusal because the instrument does not quote now (closed, off quotes): the toast names the opening time
const closedReject = (sym, w, b = true) => { const [title] = w.split(' — '); lastReject = w[0].toLowerCase() + w.slice(1); legToast(title, `${M(sym).short}: ${w}.`, 'dn'); if (b) legBeep('err'); return null; };
/* Order-entry limits, checked inside openPosition/placeOrder so every path (ticket, quick trade, DOM ladder,
   chart gestures, command bar, multi-chart) is covered. RISK_CAP blocks the ticket and the command bar. The size per
   order is the sheet's [min, max] (volWhy); MAX_LOTS is only the largest of them (a sanity bound for stored states). */
const MAX_LOTS = Math.max(...Engine.INSTR.map(m => m.p.vol[1])), MAX_NOTIONAL_X = AC.MAX_NOTIONAL_X, RISK_CAP = 10, RISK_HIGH = 5, DUP_MS = 2000;
function orderCaps(sym, lots) { return AC.why(AC.orderCaps(S, sym, lots)); }
// the same symbol, side and size sent twice within DUP_MS (real time) asks before the second one goes through
let lastSent = null;
function isDuplicate(kind, o, lots) {
  if (o.auto || o.basket || o.dupOk) return false;
  const l = lastSent;
  if (l && l.open && l.kind === kind && l.sym === o.sym && l.side === o.side && l.lots === lots && (kind === 'pos' || l.ot === o.ot)) return true; // still waiting for the server's answer
  return !!l && l.kind === kind && l.sym === o.sym && l.side === o.side && l.lots === lots && (kind === 'pos' || l.ot === o.ot) && performance.now() - l.t < DUP_MS;
}
const markSent = (kind, o, lots) => { if (!o.auto && !o.basket) lastSent = { kind, sym: o.sym, side: o.side, ot: o.ot, lots, t: performance.now() }; return o.auto || o.basket ? null : lastSent; };
// an order on its way to the server: the order buttons show it (styles.css, body.tl-sending) and the duplicate guard holds until the answer
let tlSending = 0;
const tlBusy = (mark, p) => { tlSending++; if (mark) mark.open = true; document.body.classList.add('tl-sending'); return p.finally(() => { if (mark) mark.open = false; if (!--tlSending) document.body.classList.remove('tl-sending'); }); };
// in-page confirmation (Cancel has focus, so a stray Enter does not confirm)
function askConfirm({ title, body, ok, kind = '', onOk }) {
  let el = $('#confirmDlg');
  if (!el) {
    el = document.createElement('div'); el.className = 'overlay'; el.id = 'confirmDlg'; document.body.appendChild(el);
    el.addEventListener('click', e => { const b = e.target.closest('[data-cf]'); if (e.target === el || b) { const go = b && b.dataset.cf === 'ok', f = el._ok; el.hidden = true; el._ok = null; if (go && f) f(); } });
    el.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); el.hidden = true; el._ok = null; } });
  }
  el.innerHTML = `<div class="modal cf-modal" role="alertdialog" aria-modal="true" aria-labelledby="cfT" aria-describedby="cfB">
    <div class="ph"><h2 id="cfT">${escHtml(title)}</h2></div><p class="cf-body" id="cfB">${escHtml(body)}</p>
    <div class="cf-actions"><button class="ghost" data-cf="cancel">Cancel</button><button class="cta sm ${kind}" data-cf="ok">${escHtml(ok)}</button></div></div>`;
  el._ok = onOk; el.hidden = false; el.querySelector('[data-cf=cancel]').focus();
}
function confirmDuplicate(kind, o, lots) {
  const what = `${o.side} ${kind === 'ord' ? o.ot + ' ' : ''}${lotsFmt(o.sym, lots)} ${pretty(o.sym)}`;
  lastReject = 'duplicate order awaiting confirmation';
  askConfirm({ title: 'Send the same order again?', body: lastSent && lastSent.open ? `${what[0].toUpperCase() + what.slice(1)} is still waiting for the server's answer. A second identical order doubles the position.` : `You sent ${what} less than ${DUP_MS / 1000} seconds ago. A second identical order doubles the position.`, ok: `Send again`, kind: o.side,
    onOk: () => { const o2 = { ...o, dupOk: true }; if (kind === 'pos') openPosition(o2); else placeOrder(o2); } });
  return null;
}
/* ============ execution model ============
   Every fill goes through execFill(). While the simulation runs, a fill lands at the quote plus symmetric noise of
   σ = √(slipSd² + σ_lat²) pips, where σ_lat is the pair's own volatility over the simulated latency (latMs × speed).
   The noise has mean zero by construction: a fill is as likely to be in your favour as against you. A paused market
   (speed 0) has firm quotes, and a replay must stay reproducible, so both fill exactly at the quote. Fills are all-or-nothing (no partial fills). A limit
   (pending limit, triggered stop-limit, take profit) never fills worse than its price: when the noise would push it
   through, it keeps working. A stop fills at the quote that crossed it, so a jump through the stop is reported as a
   gap. Commission is per lot, round turn, charged in full at the fill that opens the position; it is off by default (a
   spread-only account) and set under Execution in the ticket. */
const EXEC_DEF = AC.EXEC_DEF; // comm: USD per lot round turn (S.set.comm; the backtester's default is 5)
const execCfg = () => AC.execCfg(S.set);
const volCache = {};
// the pair's volatility in pips per √(simulated second), from its last hour of 1-minute closes (cached 30 s sim)
function vol1s(sym) {
  const c = volCache[sym]; if (c && Math.abs(Engine.simTime - c.t) < 30) return c.v;
  const r = Engine.returns(sym, 60), n = r.length, mu = n ? r.reduce((s, x) => s + x, 0) / n : 0;
  const sd = n > 1 ? Math.sqrt(r.reduce((s, x) => s + (x - mu) ** 2, 0) / (n - 1)) : 0;
  const v = sd * Engine.mid(sym) / M(sym).pip / Math.sqrt(60);
  volCache[sym] = { v, t: Engine.simTime }; return v;
}
const execModelText = (c = execCfg()) => c.on ? `symmetric (equal odds for and against you), σ ${c.sd} pip plus the market move over ${c.lat} ms of latency; none while the market is paused or in a replay; a market fill further than the sheet's maximum deviation from the quote is requoted` : 'off — fills at the quote';
const commText = (c = execCfg()) => c.comm > 0 ? `$${c.comm.toFixed(2)} per lot round turn (an extra; the instrument sheet charges none), charged in full when the position opens` : 'none (spread-only account)';
/* Maximum deviation (sheet maxDev, points): a market fill that lands further than that from the quote is not filled
   ('requote', out.ok false). Stops, limits, gaps and the stop-out (dev: false) are never requoted. */
function execFill(x) { return AC.execFill(S, x); }
// commission per lot round turn: the sheet's (0 on every instrument of the Default profile) + the simulation's extra
const commOf = (lots, sym) => AC.commOf(S.set, lots, sym);
const requoteReject = (sym, ex) => { const n = Math.round(ex.devPts); lastReject = `requote — price moved ${n} pts`; legToast('Requote', `${M(sym).short}: the price moved ${n} pts from the quote (maximum deviation ${M(sym).p.maxDev} pts) — not filled. Send again at the new price.`, 'dn'); legBeep('err'); return null; };
const slipWords = (slip, sym) => Math.abs(slip) < .05 ? 'none' : `${Math.abs(slip).toFixed(1)} ${unitWord(sym, true)} ${slip > 0 ? 'against you' : 'in your favour'}`;

/* Fill receipts (S.fills, newest first, at most 500) and the order log (S.ordLog: orders that left the book, with
   why, at most 300). Fill ids have their own counter (S.nextFill) and do not use S.nextId. */
const FILL_MAX = 500, LOG_MAX = 300;
let lastFill = null;
// the core's records into S: a fill receipt, a history row, an order-log row
function storeFill(f) {
  if (!Array.isArray(S.fills)) S.fills = [];
  S.fills.unshift(f); if (S.fills.length > FILL_MAX) S.fills.length = FILL_MAX;
  lastFill = f;
}
function storeTrade(row) { S.history.unshift(row); if (S.history.length > 500) S.history.pop(); }
function logOrder(rec) {
  if (!Array.isArray(S.ordLog)) S.ordLog = [];
  S.ordLog.unshift(rec); if (S.ordLog.length > LOG_MAX) S.ordLog.length = LOG_MAX;
  changed('ord');
}
// an event of the core: what it stores (the toasts are the caller's)
function applyEv(e) {
  if (e.type === 'fill') { storeFill(e.fill); if (e.trade) storeTrade(e.trade); }
  else if (e.type === 'nbp') storeTrade(e.trade);
  else if (e.order && (e.type === 'cancel' || e.type === 'expire' || e.type === 'filled' || e.type === 'reject')) logOrder(e.order);
}
const ordType = o => o.limit != null ? 'stop-limit' : o.ot;
const tifText = o => o.tif === 'GTC' || !o.tif ? 'GTC' : `${o.tif} until ${dts(o.expires)} UTC`;
function endOrder(o, status, why) { logOrder(AC.endOrder(S, o, status, why, Engine.simTime)); }

/* ============ order model (hybrid) ============
   Protections live on the position: one stop loss (sl, optionally trailing or moved to break-even once) and up to 4
   take profits (tp alone, or tps legs that each close part of the position; p.tp always shows the nearest). Entry
   orders in the book can be limit, stop or stop-limit (a stop with a limit price), good till cancelled, DAY or GTD
   (simulation UTC), and two or more can form an OCO group: the first to fill (or to trigger, for a stop-limit) cancels
   the others. Their exits are offsets from the fill (slPips, tpPips or tps rows, trail, be). */
const TP_MAX = AC.TP_MAX, MAX_WORKING = AC.MAX_WORKING;
const r2 = v => Math.round(v * 100) / 100;
// sizes on the instrument's step: round (rS), round down (fS)
const rS = (sym, v) => AC.rS(sym, v), fS = (sym, v) => AC.fS(sym, v);
// one trailing rule for live stops and the Exit lab: the stop follows px (the best price so far) at dist, never loosened
const trailNext = AccountCore.trailNext;
/* targets from {pips, pct} rows (or absolute {price, lots}). Lots per leg round down to the sheet's step and the last
   leg takes the remainder, so the legs never cover more than the position; the share left over (Σpct < 100) runs on
   the stop. → { tps } or { err } */
function buildTps(sym, side, entry, lots, rows) { return AC.buildTps(sym, side, entry, lots, rows); }
// break-even: after `at` pips in profit and/or after the first target fills, the stop moves to entry + off pips (once)
function beSpec(b, spread, sym) { return AC.beSpec(b, spread, sym); }
// after a partial close the targets are cut back to the remaining size, nearest first (a manual close is a target taken early)
function trimTps(p) { AC.trimTps(p); }
// p.tp is edited in place by the dock and the chart: the nearest leg follows it (cleared: that leg is removed)
function syncTps(p) { AC.syncTps(p); }

/* openPosition(o) → position | null, synchronously (behav.js and pwa.js wrap it). o: {sym, side, lots, sl?, tp? (prices),
   slPips?, tpPips? (pips from the fill), tps? (rows), be?, trail?, exec? (a fill from the book), src?, reason?, basket?
   (a basket leg: no toast or beep of its own, refusals included; lastReject still says why)}. */
/* Netting (Victor, 31.10.2026): one position per instrument. An order on an instrument with an open position offsets it:
   - same side: the size is added and the entry becomes the size-weighted average; the position keeps its own stop,
     targets, trail and break-even (an added order brings none: its SL/TP are not applied, and the toast says so);
   - other side: the position is reduced at the fill price and that part's P/L is realised (history row 'Offset by …
     order'); an order larger than the position closes it and opens the remainder on the other side, with the order's
     own SL/TP (a reversal).
   Basket legs (o.basket, p.basket/p.bgid) stay positions of their own and never net. A state from before netting may
   hold several positions on one instrument: before an order nets, those on one side become one (netMerge: the oldest
   takes the size, the size-weighted entry, the fills, swap, commission and margin, and keeps its own SL/TP), so an
   opposite order meets one position at its average price. netLast says what the last openPosition did: null (opened a position), 'add', 'reduce', 'close' (the
   order closed the position exactly) or 'flip' (closed and opened the remainder); the wrappers in behav.js and
   challenge.js stamp a new position's metadata only when netNew() */
let netLast = null;
const netNew = () => !netLast || netLast === 'flip';
const netBook = sym => AC.netBook(S, sym);
// one side of the book as one position (read-only, for the ticket): total size, size-weighted entry, the oldest's levels
function netAgg(sym, side) { return AC.netAgg(S, sym, side); }
function netMerge(sym) { if (AC.netMerge(S, sym)) changed('pos'); }
// the order only reduces what is open (no new exposure): the pre-mortem and the challenge gate do not apply
const netOnly = o => !!o && !o.basket && M(o.sym) && netBook(o.sym).filter(x => x.side !== o.side).reduce((s, x) => s + x.lots, 0) >= normLots(o.sym, o.lots) - 1e-9;
// a refusal of the core, as the user sees it: the market ones name the opening time, a requote the deviation
const marketRej = r => !!(AC.REJECT[r.code] && AC.REJECT[r.code].market);
const refuseOrder = (sym, r) => r.code === 'REQUOTE' ? requoteReject(sym, r) : marketRej(r) ? closedReject(sym, r.why) : reject(r.title, r.why);
// the duplicate check sits where trade.js always had it, inside the core's checks (a refused order asks nothing)
const dupGate = kind => o => { const lots = normLots(o.sym, o.lots); if (isDuplicate(kind, o, lots)) { confirmDuplicate(kind, o, lots); return true; } markSent(kind, o, lots); return false; };
function openPosition(o) { if (TradeLink.live) return tlOpen(o); const q0 = legQuiet; legQuiet = !!(o && o.basket); netLast = null; try { return openPos(o); } finally { legQuiet = q0; } }
function openPos(o) {
  lastReject = '';
  // the core nets on the book (net: true); the reduction of an opposite position goes through closeVia, so every
  // wrapper of closePosition sees it
  const r = AC.openMarket(S, { ...o, net: true }, { gate: dupGate('pos'), close: (acct, id, frac, reason, ctx) => closeVia(id, reason, frac, ctx) });
  if (r.merged) changed('pos');
  if (!r.ok) { if (!r.held && !r.quiet) refuseOrder(o.sym, r); return null; }
  for (const e of r.events) applyEv(e);
  if (r.restRej) refuseOrder(o.sym, r.restRej); // the reduction stands; the remainder was refused
  netLast = r.net;
  const p = r.pos, sym = p.sym, ex = r.ex, d = o.side === 'buy' ? 1 : -1;
  if (r.op === 'open') {
    changed('pos');
    legToast(`${o.side === 'buy' ? 'Bought' : 'Sold'} ${lotsFmt(sym, p.lots)} ${pretty(sym)}`, `@ ${fp(sym, p.entry)}${p.sl != null ? (p.trailNow ? ' · trailing SL ' : ' · SL ') + fp(sym, p.sl) : ''}${p.tp != null ? ' · TP ' + fp(sym, p.tp) + (p.tps ? ` (${p.tps.length} targets)` : '') : ''}${Math.abs(ex.slip) >= .1 ? ' · slip ' + slipWords(ex.slip, sym) : ''}`, d > 0 ? 'up' : 'dn');
    legBeep('fill');
  } else if (r.op === 'add') {
    changed('pos');
    const extra = o.sl != null || o.tp != null || o.slPips > 0 || o.tpPips > 0 || (o.tps && o.tps.length) || o.trail > 0 || o.be;
    legToast(`${o.side === 'buy' ? 'Bought' : 'Sold'} ${lotsFmt(sym, r.lots)} more ${pretty(sym)}`, `@ ${fp(sym, ex.px)} · position #${p.id} now ${lotsFmt(sym, p.lots)} at ${fp(sym, p.entry)} average${extra ? ' · the order\'s SL/TP were not applied: the position keeps its own' : ''}${Math.abs(ex.slip) >= .1 ? ' · slip ' + slipWords(ex.slip, sym) : ''}`, d > 0 ? 'up' : 'dn');
    legBeep('fill');
  }
  return p;
}
// exit context for the next closePosition call: the wrappers in behav.js, pwa.js and persist.js pass three arguments only
let exitCtx = null;
function closeVia(id, reason, frac, ctx) { if (TradeLink.live) return closePosition(id, reason, frac); exitCtx = ctx; try { closePosition(id, reason, frac); } finally { exitCtx = null; } }
/* closePosition(id, reason, frac): a close or a reduction, also on a close-only instrument. Refused while the market
   is closed (or off quotes) and on a requote; the stop-out passes its own fill (never requoted). Partial sizes go on
   the sheet's step; what would be left under the minimum size is closed with the rest. A basket leg closed by the basket
   tool (closeVia with ctx.basket) has no toast or beep of its own, the "Market closed" refusal included: the tool sums
   them up. A leg closed by hand or by its own stop still says so. */
/* closeLots(p, frac): the lots a close of frac takes, on the instrument's step and rounded down (½ of 0.03 lots is
   0.01): p.lots for a whole close (frac ≥ 1, or what would be left is under the minimum size); 0 when the part is
   under the minimum size, so nothing can be closed and the close is refused (UX 09.11.2026, F10).
   halfLots(p): the lots "½" would close, 0 when "½" is not available (the ticket and the positions table grey it). */
function closeLots(p, frac = 1) {
  if (!p || !(p.lots > 0)) return 0;
  // a whole close needs no size rules: it goes as before, also on an instrument this page does not know (the server has it)
  if (!(frac < 1)) return p.lots;
  if (!M(p.sym)) return 0;
  const [mn, , st] = volOf(p.sym), lots = +(Math.floor(p.lots * frac / st + 1e-6) * st).toFixed(lotDec(p.sym));
  if (!(lots >= mn - 1e-9)) return 0;
  return lots >= p.lots - 1e-9 || p.lots - lots < mn - 1e-9 ? p.lots : lots;
}
function halfLots(p) { const l = closeLots(p, .5); return l > 0 && l < p.lots - 1e-9 ? l : 0; }
// a part under the minimum size: nothing is sent, the toast says why and what to do
function partRefuse(p, frac) {
  // an instrument this page does not know: its size rules are not here, so no part can be worked out (Close still works)
  if (!M(p.sym)) lastReject = `${p.sym} #${p.id}: its size rules are not known on this page`;
  else { const mn = volOf(p.sym)[0]; lastReject = `${pretty(p.sym)} #${p.id} ${p.lots <= mn + 1e-9 ? 'is at the minimum size' : 'cannot be split above the minimum size'} (${lotsFmt(p.sym, mn)})`; }
  legToast(frac === .5 ? "Can't close half" : "Can't close part of it", lastReject + ': use Close to close it all', 'dn'); legBeep('err');
}
// the toast of a reduction by hand says what is left
const partToast = (sym, closed, of, left) => `Partial close: ${lotsFmt(sym, closed)} of ${lotsFmt(sym, of)} closed, ${lotsFmt(sym, left)} left`;
function closePosition(id, reason, frac) { if (TradeLink.live) return tlClose(id, reason, frac); const p = S.positions.find(x => x.id === id), q0 = legQuiet; legQuiet = !!(p && p.bgid && exitCtx && exitCtx.basket); try { return closePos(id, reason, frac); } finally { legQuiet = q0; } }
function closePos(id, reason = 'Manual', frac = 1) {
  const ctx = exitCtx; exitCtx = null;
  const p = S.positions.find(x => x.id === id); if (!p) return;
  lastReject = '';
  // the part on the step, rounded down; under the minimum size nothing is closed; a part that takes it all is a close
  const lots = closeLots(p, frac), l0 = p.lots;
  if (!lots) return partRefuse(p, frac);
  if (lots >= p.lots - 1e-9) { frac = 1; if (reason === 'Partial close') reason = 'Manual'; } else frac = lots / p.lots;
  const r = AC.close(S, id, frac, reason, ctx || {});
  if (!r.ok) { if (r.code === 'REQUOTE') requoteReject(p.sym, r); else if (marketRej(r)) closedReject(p.sym, r.why); return; }
  for (const e of r.events) applyEv(e);
  changed('pos', 'hist');
  const h = r.trade, ex = r.ex, part = !r.full && h.reason === 'Partial close';
  legToast(part ? partToast(p.sym, h.lots, l0, p.lots) : `${h.reason}: ${pretty(p.sym)} ${lotsFmt(p.sym, h.lots)}`, `${part ? `${pretty(p.sym)} #${p.id} · ` : ''}${usdFmt(h.pnl, true)} · ${sgn(h.pips)} ${unitWord(p.sym)} · closed @ ${fp(p.sym, h.exit)}${Math.abs(ex.slip) >= .1 ? ' · slip ' + slipWords(ex.slip, p.sym) : ''}${ex.gap ? ' · gap' : ''}`, h.pnl >= 0 ? 'up' : 'dn');
  legBeep(h.pnl >= 0 ? 'win' : 'loss');
}
const dayEnd = t => AC.dayEnd(t);
/* placeOrder(o) → order | null. o: {sym, side, ot: 'limit'|'stop', price, limit? (stop-limit), lots, slPips, tpPips, tps?,
   be?, trail, tif?: 'GTC'|'DAY'|'GTD', expires? (sim seconds, GTD), oca? (an order id or 'o<id>' group to join)}.
   Margin is not checked here: it is checked at the fill, and the ticket warns. */
function placeOrder(o) {
  if (TradeLink.live) return tlPlace(o);
  lastReject = '';
  const no = (title, why, b = true) => { lastReject = `${title.toLowerCase()} (${why})`; toast(title, why, 'dn'); if (b) beep('err'); return null; };
  // an order of the net book nets when it fills (net, kept on the order); a basket leg never does
  const r = AC.place(S, { ...o, net: !o.basket }, { gate: () => dupGate('ord')(o) });
  if (!r.ok) { if (r.held) return null; if (marketRej(r)) return closedReject(o.sym, r.why); return no(r.title, r.why, r.beep !== false); }
  const ord = r.order, lots = ord.lots, limit = ord.limit, tif = ord.tif, peer = r.peer, oca = ord.oca;
  changed('ord');
  toast(`${o.side} ${ordType(ord)} placed`, `${lotsFmt(o.sym, lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)}${limit != null ? ' → limit ' + fp(o.sym, limit) : ''}${tif !== 'GTC' ? ' · ' + tifText(ord) : ''}${oca ? ` · OCO with #${peer.id}` : ''}`, 'info'); beep('fill');
  return ord;
}
function cancelOrder(id, why = 'Cancelled') { if (TradeLink.live) return tlCancel(id); const r = AC.cancel(S, id, why); if (r.ok) r.events.forEach(applyEv); else changed('ord'); }
function closeWhere(fn, reason = 'Manual') { if (TradeLink.live) return Promise.all([...S.positions].filter(fn).map(p => closePosition(p.id, reason))); [...S.positions].filter(fn).forEach(p => closePosition(p.id, reason)); }


/* Negative balance protection: the client cannot lose more than the account's funds. Whatever closed the last
   position (a stop-out, a gap through a stop loss or take profit, a manual close, Close all) leaves at most a zero
   balance: the negative part is covered and recorded in the history. It runs on every loop tick and before every
   save, so a negative flat account is never stored or exported. With positions still open the account is judged on
   equity by the stop-out, not here. */
function nbpDone(e) {
  storeTrade(e.trade); changed('hist');
  toast('Negative balance protection', `${e.after || 'The last close'} left the balance at ${usdFmt(-e.cover)}. ${usdFmt(e.cover)} covered; balance reset to ${usdFmt(0)}.`, 'info');
}
function negativeBalanceProtection() { if (TradeLink.live) return false; /* the broker's on the live account */ const e = AC.nbp(S, Engine.simTime); if (!e) return false; nbpDone(e); return true; }
/* Trailing and break-even of a position, at the quote q (the core's onTick calls it before the stop and the targets,
   and again with byTp after a target filled). Skipped while a chart line of the position is dragged. A trail without a
   stop of its own is the stop (it follows from entry ∓ trail at once, as in the Exit lab); with a stop you set, the
   trail starts once it can lock in the entry, then follows. It never loosens the stop. Break-even stays armed until it
   has moved the stop (a level still beyond the quote is retried on the next sub-step), or until the stop already sits
   at or beyond the level (nothing left to move). */
function posProtect(p, q, byTp) {
  const m = M(p.sym), d = p.side === 'buy' ? 1 : -1, px = d > 0 ? q.bid : q.ask;
  if (!byTp) {
    if (drag?.ref === p) return;
    syncTps(p);
    if (p.trail) {
      const dist = p.trail * m.pip;
      if (p.trailNow && p.sl !== p.trailSl) delete p.trailNow; // you moved the stop: it is yours now (the trail resumes once it can lock in the entry)
      if (p.trailNow) { const n = trailNext(d, p.sl, px, dist); if (n !== p.sl) { p.sl = p.trailSl = n; p.trailed = true; } }
      else { const n = trailNext(d, null, px, dist); if (d * (n - p.entry) >= 0 && (p.sl == null || d * (n - p.sl) > 0)) { p.sl = n; p.trailed = true; } }
    }
  }
  const b = p.be; if (!b || b.done) return;
  if (byTp && b.onTp) b.tpHit = true;
  const lvl = AccountCore.beLevel(b, d, p.entry, px, m.pip); if (lvl == null) return; // only ever tightens the stop
  if (p.sl != null && d * (lvl - p.sl) <= 0) { b.done = true; return; }
  if (d > 0 ? lvl < q.bid : lvl > q.ask) {
    b.done = true; p.sl = lvl; p.beSl = lvl; p.trailed = false; changed('pos');
    toast('Stop moved to break-even', `${pretty(p.sym)} #${p.id} · SL ${fp(p.sym, lvl)}`, 'info');
  }
}
/* The book at the current quotes (core onTick: expiry, pending entries and OCO, stops and targets, stop-out, the
   negative balance protection), through the global openPosition / closeVia so every wrapper sees each fill; then the
   price alerts. */
function checkTriggers() {
  if (TradeLink.live) return; // the server runs the book of the live account
  const gone = [];
  AC.onTick(S, Engine.simTime, {
    // a pending order that reached its price fills through openPosition (it nets like any order)
    open: (acct, rq) => { let p = null; try { p = openPosition(rq); } catch (e) { console.error('[Meridian] order fill failed:', e); } return p ? { ok: true, pos: p } : { ok: false, text: lastReject }; },
    close: (acct, id, frac, reason, ctx) => closeVia(id, reason, frac, ctx),
    protect: posProtect,
    emit: e => {
      if (e.type === 'nbp') { nbpDone(e); return; }
      applyEv(e);
      if (e.type === 'expire') {
        gone.push(e.order);
        if (e.last) toast(gone.length > 1 ? `${gone.length} orders expired` : 'Order expired', gone.map(o => `${o.side} ${ordType(o)} ${lotsFmt(o.sym, o.lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)}`).join(' · '), 'info');
      } else if (e.type === 'trigger') {
        const o = e.order; changed('ord');
        toast('Stop-limit triggered', `${o.side} ${lotsFmt(o.sym, o.lots)} ${pretty(o.sym)} #${o.id}: now working as a limit at ${fp(o.sym, o.limit)}.`, 'info');
      } else if (e.type === 'oco') {
        const o = e.order, sib = e.cancelled;
        toast(`OCO: ${sib.length > 1 ? sib.length + ' orders' : 'order #' + sib[0].id} cancelled`, `${o.side} ${ordType(o)} #${o.id} ${e.what}, so ${sib.map(x => `${x.side} ${ordType(x)} #${x.id}`).join(', ')} left the book.`, 'info');
      } else if (e.type === 'reject') {
        const o = e.order;
        toast('Pending order cancelled', `${o.side} ${o.ot} ${lotsFmt(o.sym, o.lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)} reached its price but could not be filled: ${e.text || 'see the browser console'}.`, 'dn');
      }
    }
  });
  // alerts fire on a crossing: from the side they started on (from) to the side of their condition, once. An alert
  // without a known start side (older states, an edited level) arms itself on the first check that finds it unmet.
  for (const al of S.alerts) {
    if (al.done) continue;
    const px = Engine.quote(al.sym).mid, other = al.cond === 'above' ? 'below' : 'above';
    if (!(al.cond === 'above' ? px >= al.price : px <= al.price)) { if (al.from !== other) al.from = other; continue; }
    if (al.from === other) {
      al.done = true; al.at = Engine.simTime; changed('al');
      toast(`Alert · ${pretty(al.sym)}`, `Crossed ${al.cond} ${fp(al.sym, al.price)} · now ${fp(al.sym, px)}`, 'info'); beep('alert');
    }
  }
}
/* Order-model fields of a state from outside (boot, import, reset), after sanitizeState(). loadState() calls it.
   Old states keep every level: positions with sl/tp/trail stay as they are, orders with slPips/tpPips/trail become
   GTC entries. A position that trailed without a stop (the old rule gave it none until price moved in its favour)
   gets its protective stop at entry ∓ trail, or trail behind the current price if that level is already crossed. */
function normalizeOrders(st = S) {
  const fin = v => typeof v === 'number' && isFinite(v), pxOk = v => fin(v) && v > 0, num = (v, a, b, def) => fin(v) && v >= a && v <= b ? v : def;
  const set = st.set;
  if (set.slip !== 'off' && set.slip !== 'sym') set.slip = EXEC_DEF.slip;
  set.slipSd = num(set.slipSd, 0, 5, EXEC_DEF.slipSd); set.latMs = num(set.latMs, 0, 2000, EXEC_DEF.latMs); set.comm = num(set.comm, 0, 50, EXEC_DEF.comm);
  const beOk = b => b && typeof b === 'object' && !Array.isArray(b) && (b.at == null || fin(b.at) && b.at > 0) && fin(+b.off || 0) && (b.at != null || b.onTp === true);
  const rowsOk = r => Array.isArray(r) && r.length >= 1 && r.length <= TP_MAX && r.every(x => x && fin(x.pips) && x.pips > 0 && fin(x.pct) && x.pct > 0 && x.pct <= 100) && r.reduce((s, x) => s + x.pct, 0) <= 100 + 1e-9;
  let migrated = 0;
  for (const p of st.positions) {
    const m = M(p.sym), d = p.side === 'buy' ? 1 : -1, q = Engine.quote(p.sym);
    p.comm = fin(p.comm) && p.comm >= 0 ? p.comm : 0;
    p.fills = Array.isArray(p.fills) ? p.fills.filter(Number.isInteger) : [];
    if (p.trailNow !== true || p.sl == null) { delete p.trailNow; delete p.trailSl; } else if (!fin(p.trailSl)) p.trailSl = p.sl;
    if (!fin(p.beSl)) delete p.beSl;
    if (Array.isArray(p.tps)) {
      const mn = m ? m.p.vol[0] : .01, rs = v => m ? normLots(p.sym, v) : r2(v);
      p.tps = p.tps.filter(x => x && pxOk(x.price) && fin(x.lots) && x.lots >= mn - 1e-9).slice(0, TP_MAX).map(x => ({ price: x.price, lots: rs(x.lots), leg: /^TP[1-4]$/.test(x.leg) ? x.leg : '' }))
        .sort((a, b) => d * (a.price - b.price));
      p.tps.forEach((x, i) => { if (!x.leg) x.leg = 'TP' + (i + 1); });
      if (p.tps.length) { p.tp = p.tps[0].price; trimTps(p); } else delete p.tps;
    } else delete p.tps;
    if (beOk(p.be)) p.be = { at: p.be.at ?? null, off: +p.be.off || 0, onTp: p.be.onTp === true, done: p.be.done === true, ...(p.be.tpHit === true && { tpHit: true }) }; else delete p.be;
    if (p.trail > 0 && p.sl == null) {
      const dist = p.trail * m.pip; let sl = trailNext(d, null, p.entry, dist);
      if (d > 0 ? sl >= q.bid : sl <= q.ask) sl = trailNext(d, null, d > 0 ? q.bid : q.ask, dist);
      p.sl = p.trailSl = sl; p.trailNow = true; migrated++;
    }
  }
  for (const o of st.orders) {
    o.limit = o.ot === 'stop' && pxOk(o.limit) && (o.side === 'buy' ? o.limit >= o.price : o.limit <= o.price) ? o.limit : null;
    o.tif = o.tif === 'DAY' || o.tif === 'GTD' ? o.tif : 'GTC';
    o.expires = o.tif !== 'GTC' && fin(o.expires) ? o.expires : null;
    if (o.expires == null) o.tif = 'GTC';
    o.oca = typeof o.oca === 'string' && /^o\d+$/.test(o.oca) ? o.oca : null;
    o.status = o.limit != null && o.status === 'triggered' ? 'triggered' : 'pending';
    o.net = typeof o.net === 'boolean' ? o.net : !o.basket; // saved before the flag: every entry of the book netted
    if (rowsOk(o.tps)) o.tps = o.tps.map(x => ({ pips: x.pips, pct: x.pct })); else delete o.tps;
    if (beOk(o.be)) o.be = { at: o.be.at ?? null, off: +o.be.off || 0, onTp: o.be.onTp === true }; else delete o.be;
  }
  // a group with one member left is a plain order
  const n = {}; for (const o of st.orders) if (o.oca) n[o.oca] = (n[o.oca] || 0) + 1;
  for (const o of st.orders) if (o.oca && n[o.oca] < 2) o.oca = null;
  st.fills = Array.isArray(st.fills) ? st.fills.filter(f => f && typeof f === 'object' && Number.isInteger(f.fid) && f.fid > 0 && okSym(f.sym) && pxOk(f.px)).slice(0, FILL_MAX) : [];
  st.nextFill = Math.max(Number.isInteger(st.nextFill) ? st.nextFill : 1, 1 + st.fills.reduce((mx, f) => Math.max(mx, f.fid), 0));
  st.ordLog = Array.isArray(st.ordLog) ? st.ordLog.filter(x => x && typeof x === 'object' && okSym(x.sym)).slice(0, LOG_MAX) : [];
  if (typeof normTkx === 'function') st.tkx = normTkx(st.tkx);
  if (migrated) setTimeout(() => { try { toast('Trailing stops now protect at once', `${migrated} open position${migrated > 1 ? 's' : ''} had a trailing stop but no stop loss. ${migrated > 1 ? 'Each' : 'It'} now has its stop at the trail distance from entry (or from the current price), and the stop follows the price from there.`, 'info'); } catch (e) { console.error(e); } }, 0);
}
/* addAlert → the alert, or null when the price already meets its condition (it fires on a crossing, never at once). */
function addAlert(sym, price, cond) {
  const mid = Engine.quote(sym).mid;
  if (TradeLink.live) return tlAlert(sym, price, cond, mid);
  if (cond !== 'above' && cond !== 'below') cond = price >= mid ? 'above' : 'below';
  if (cond === 'above' ? mid >= price : mid <= price) {
    toast('Alert not set', `${pretty(sym)} is already ${cond} ${fp(sym, price)} (now ${fp(sym, mid)}). An alert fires when the price crosses its level.`, 'dn');
    return null;
  }
  const al = { id: S.nextId++, sym, price, cond, from: cond === 'above' ? 'below' : 'above', done: false };
  S.alerts.push(al);
  changed('al'); toast('Alert set', `${pretty(sym)} ${cond} ${fp(sym, price)}`, 'info');
  return al;
}
/* Every market sub-step (Engine.advance in the live market, every replay step) emits 'q': orders, stops, trailing,
   stop-out and alerts at that sub-step's quote (a replay also books its swap per step; the live loop books it once
   per tick, as before). The loop's own call after Engine.tick sees the last sub-step's quote again: nothing new. */
Engine.on('q', () => {
  if (!S) return; // before the state is loaded
  if (Engine.mode !== 'live') safe('swap', rolloverTick);
  if (S.orders.length || S.positions.length || S.alerts.some(a => !a.done)) safe('order and stop checks', checkTriggers);
});

/* ============ the live account (tradelink.js) ============
   On a signed-in page the same global names send the command to the execution server and return a promise of the
   result: openPosition → the position (null when refused), placeOrder → the order, closePosition / cancelOrder /
   modifyPosition / modifyOrder → true or false. Nothing changes in S here: the server's reports do that. A refusal is
   the toast of today, with the server's text (the title from the same table, AccountCore.REJECT). */
const tlRefuse = (sym, r) => {
  const R = AC.REJECT[r.code], text = r.text || 'Refused by the execution server';
  if (R && R.market && M(sym)) return closedReject(sym, text);
  if (/not found/i.test(text)) return reject('Already closed', 'This position or order is no longer open: it was closed or cancelled elsewhere (another tab, a stop or a target).');
  return reject(R ? R.title : r.code === 'LINK_DOWN' ? 'Not sent' : r.code === 'TIMEOUT' || r.code === 'LINK_LOST' ? 'No answer: order status unknown' : 'Order rejected', text, text);
};
// the server account without the platform's prices on the page (their first request failed): what is on screen is not the market
const tlNoFeed = () => typeof LiveFeed === 'object' && !LiveFeed.on ? reject('No live prices', 'The platform’s prices have not arrived, so the prices on screen are not live. Nothing was sent; the page reloads when they are back.') : false;
const tlClean = o => { const x = {}; for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && !(Array.isArray(v) && !v.length)) x[k] = v; return x; };
const sideWord = s => s === 'buy' ? 'Buy' : 'Sell';
// wait for the server's report of an order (the reply can come before the ord event): up to the command's own 20 s
const tlAwait = (find, ms = 20000) => new Promise(res => { const t0 = Date.now(); const f = () => { const v = find(); if (v || Date.now() - t0 > ms) res(v || null); else setTimeout(f, 30); }; f(); });
function tlOpen(o) {
  lastReject = ''; netLast = null;
  if (tlNoFeed() === null) return Promise.resolve(null);
  if (!o || !M(o.sym)) return Promise.resolve(reject('Order rejected', 'Unknown instrument'));
  const lots = normLots(o.sym, o.lots);
  if (isDuplicate('pos', o, lots)) return Promise.resolve(confirmDuplicate('pos', o, lots));
  const mark = markSent('pos', o, lots);
  const had = new Set(S.positions.map(p => p.id)), q0 = !!o.basket;
  const f = tlClean({ sym: o.sym, side: o.side, lots, ot: 'market', sl: o.sl, tp: o.tp, slPips: o.slPips > 0 ? o.slPips : null, tpPips: o.tpPips > 0 ? o.tpPips : null, trail: o.trail > 0 ? o.trail : null, tps: o.tps, be: o.be, reason: o.reason, pm: o.pm, ctx: o.ctx, net: !o.basket || null });
  return tlBusy(mark, TradeLink.send('order', f, `${sideWord(o.side)} ${lotsFmt(o.sym, lots)} ${pretty(o.sym)}`, 'pos')).then(async r => {
    if (!r.ok) { const lq = legQuiet; legQuiet = q0; try { return tlRefuse(o.sym, r); } finally { legQuiet = lq; } }
    // the reply is the confirmation: the position comes with the server's pos event (waited for, not a fixed time); a
    // close-only order (it offset positions, nothing opened) answers with the position it closed
    // a position that existed before (an add, or one this order closed): no wait — only a new one comes with a pos event
    const id = r.pos != null ? r.pos : null, p = id == null ? null : had.has(id) ? S.positions.find(x => x.id === id) || null : await TradeLink.whenPos(id);
    netLast = id != null && had.has(id) ? 'add' : null;
    return p || { id, sym: o.sym, side: o.side, lots, confirmed: true };
  });
}
function tlPlace(o) {
  lastReject = '';
  if (tlNoFeed() === null) return Promise.resolve(null);
  if (!o || !M(o.sym)) return Promise.resolve(reject('Order rejected', 'Unknown instrument'));
  const lots = normLots(o.sym, o.lots);
  if (isDuplicate('ord', o, lots)) return Promise.resolve(confirmDuplicate('ord', o, lots));
  markSent('ord', o, lots);
  const peer = o.oca ? S.orders.find(x => String(x.id) === String(o.oca) || x.oca === o.oca) : null;
  const ot = o.limit != null ? 'stoplimit' : o.ot;
  const f = tlClean({ sym: o.sym, side: o.side, lots, ot, price: o.price, limit: o.limit, tif: o.tif && o.tif !== 'GTC' ? o.tif : null, expires: o.tif === 'GTD' ? o.expires : null,
    oca: peer ? peer.oca || 'o' + peer.id : null, slPips: o.slPips > 0 ? o.slPips : null, tpPips: o.tpPips > 0 ? o.tpPips : null, tps: o.tps, be: o.be, trail: o.trail > 0 ? o.trail : null, pm: o.pm, ctx: o.ctx, net: !o.basket || null });
  const what = `${o.side} ${o.limit != null ? 'stop-limit' : o.ot}`;
  // OCO with an order already working: that order joins the group at the broker first (modify {id, oca}), then the
  // new one goes with the same group; if the join is refused nothing is sent
  if (o.ocaGroup) f.oca = o.ocaGroup;
  else if (peer && !peer.oca) return modifyOrder(peer.id, { oca: f.oca }).then(ok => ok ? tlPlace({ ...o, oca: null, ocaGroup: f.oca, ocaWith: peer.id, dupOk: true }) : null); // the replace gives the peer a new id
  return TradeLink.send('order', f, `${sideWord(o.side)} ${o.limit != null ? 'stop-limit' : o.ot} ${lotsFmt(o.sym, lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)}`, 'ord').then(async r => {
    if (!r.ok) return tlRefuse(o.sym, r);
    const ord = await tlAwait(() => S.orders.find(x => x.id === r.id));
    toast(`${what} placed`, `${lotsFmt(o.sym, lots)} ${pretty(o.sym)} @ ${fp(o.sym, o.price)}${o.limit != null ? ' → limit ' + fp(o.sym, o.limit) : ''}${o.tif && o.tif !== 'GTC' ? ' · ' + tifText(o) : ''}${peer || o.ocaWith ? ` · OCO with #${peer ? peer.id : o.ocaWith}` : ''}`, 'info'); beep('fill');
    return ord;
  });
}
function tlClose(id, reason = 'Manual', frac = 1) {
  lastReject = '';
  const p = S.positions.find(x => x.id === id); if (!p) return Promise.resolve(false);
  // the same rule as the sandbox (closeLots): the part rounded down to the step, refused under the minimum size (nothing
  // sent); a part that takes it all, or leaves less than the minimum, closes the whole position, recorded as Manual
  // quiet only when the basket tool closes its own legs, as in the sandbox (closePosition): a ½ clicked on a basket leg
  // in the table still says why it was refused (tester follow-up, UX 09.11)
  const q0 = !!(p.bgid && typeof exitCtx !== 'undefined' && exitCtx && exitCtx.basket), l = closeLots(p, frac);
  if (!l) { const lq = legQuiet; legQuiet = q0; try { partRefuse(p, frac); } finally { legQuiet = lq; } return Promise.resolve(false); }
  const lots = l < p.lots - 1e-9 ? l : null;
  if (lots == null && reason === 'Partial close') reason = 'Manual';
  return TradeLink.send('close', tlClean({ posId: id, lots, reason }), `Close ${lots != null ? lotsFmt(p.sym, lots) + ' of ' : ''}#${id} ${pretty(p.sym)}`, 'pos').then(r => {
    if (!r.ok) { const lq = legQuiet; legQuiet = q0; try { tlRefuse(p.sym, r); } finally { legQuiet = lq; } return false; }
    return true;
  });
}
// close from a click on a row (dock table, the ticket's "On … now" table): one close at a time, and nothing for a moment
// after its answer, when the row disappears and the next position slides under the pointer (UX-12)
let closeBusy = 0, closeHold = 0;
function closeClick(id, reason, frac) {
  if (closeBusy || performance.now() < closeHold) return;
  const r = reason ? closePosition(id, reason, frac) : closePosition(id);
  if (r && typeof r.then === 'function') { closeBusy++; r.finally(() => { closeBusy--; closeHold = performance.now() + 700; }); }
  else closeHold = performance.now() + 400;
}
function tlCancel(id) {
  const o = S.orders.find(x => String(x.id) === String(id)); if (!o) return Promise.resolve(false);
  return TradeLink.send('cancel', { id: o.id }, `Cancel #${o.id}`, 'ord').then(r => { if (!r.ok) { tlRefuse(o.sym, r); return false; } return true; });
}
function tlSettings(set) {
  return TradeLink.send('settings', set).then(r => { if (!r.ok) { toast('Not applied', r.text || 'Refused by the execution server', 'dn'); beep('err'); syncLevSel(); return false; } return true; });
}
function tlAlert(sym, price, cond, mid) {
  if (cond !== 'above' && cond !== 'below') cond = price >= mid ? 'above' : 'below';
  if (cond === 'above' ? mid >= price : mid <= price) { toast('Alert not set', `${pretty(sym)} is already ${cond} ${fp(sym, price)} (now ${fp(sym, mid)}). An alert fires when the price crosses its level.`, 'dn'); return Promise.resolve(null); }
  return TradeLink.send('alert', { do: 'add', sym, price, cond }).then(r => { if (!r.ok) { toast('Alert not set', r.text || 'Refused by the execution server', 'dn'); return null; } toast('Alert set', `${pretty(sym)} ${cond} ${fp(sym, price)}`, 'info'); return true; });
}
/* modifyPosition(id, ch) / modifyOrder(id, ch): every edit of a stop, a target, a trail, a break-even or a pending
   price goes through these (dock, level editor, chart drag, move to break-even). The rules are the core's modify
   (AccountCore), checked here first on a copy so the refusal is immediate and says why; the live account then sends
   the change ({ posId | id, …ch }) and the server applies it. ch: { sl?, tp?, tps?, trail?, be? } for a position,
   { price?, limit?, tps?, trail?, be? } for an order; null removes a stop or a target.
   → true / false (sandbox: at once), or a promise of it (live). quiet: no toast on a refusal (the caller says it). */
const tlCopy = v => JSON.parse(JSON.stringify(v));
function modifyCheck(kind, id, ch) {
  const ref = kind === 'pos' ? S.positions.find(x => x.id === id) : S.orders.find(x => String(x.id) === String(id));
  if (!ref) return { ok: false, code: kind === 'pos' ? 'NO_POS' : 'NO_ORDER', title: 'Not applied', why: kind === 'pos' ? 'Position no longer open' : 'Order no longer working' };
  const acct = kind === 'pos' ? { positions: [tlCopy(ref)], orders: [] } : { positions: [], orders: [tlCopy(ref)] };
  return { ...AC.modify(acct, kind === 'pos' ? { posId: id, ...ch } : { orderId: acct.orders[0].id, ...ch }), ref };
}
function modifyLevel(kind, id, ch, quiet) {
  const v = modifyCheck(kind, id, ch);
  if (!v.ok) { lastReject = v.why || ''; if (!quiet) { toast(v.title || 'Not applied', v.why, 'dn'); beep('err'); } return TradeLink.live ? Promise.resolve(false) : false; }
  if (TradeLink.live) {
    const f = kind === 'pos' ? { posId: id, ...ch } : { id: v.ref.id, ...ch };
    const what = Object.keys(ch).map(k => k.toUpperCase()).join(', ');
    return TradeLink.send('modify', f, `${what} #${v.ref.id}`, kind).then(r => { if (!r.ok) { lastReject = r.text || ''; if (!quiet) { toast(AC.REJECT[r.code] ? AC.REJECT[r.code].title : 'Not applied', r.text || 'Refused by the execution server', 'dn'); beep('err'); } return false; } return true; });
  }
  const r = AC.modify(S, kind === 'pos' ? { posId: id, ...ch } : { orderId: v.ref.id, ...ch });
  if (!r.ok) return false;
  changed(kind === 'pos' ? 'pos' : 'ord');
  return true;
}
function modifyPosition(id, ch, quiet) { return modifyLevel('pos', id, ch, quiet); }
function modifyOrder(id, ch, quiet) { return modifyLevel('ord', id, ch, quiet); }
