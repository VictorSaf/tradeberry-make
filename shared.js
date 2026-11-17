/* tradeBerry — helpers shared by the core and the lazily loaded tool modules */
// tip: 'Title|explanation' shown on hover and focus on the analysis pages (brief.js tipBind)
// tier: optional emphasis class on the tile ('hero' | 'key' | 'sec', styles.css ds-sys)
function kpi(l, v, cls = '', tip = '', tier = '') { return `<div class="kpi${tier ? ' ' + tier : ''}"${tip ? ` tabindex="0" data-tip="${escHtml(tip)}"` : ''}><label>${l}</label><b class="${cls}">${v}</b></div>`; }
const fmtDur = m => { if (m < 1) return '<1m'; m = Math.round(m); return m < 60 ? m + 'm' : m < 1440 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${(m / 1440).toFixed(1)}d`; };
const bp = v => (v >= 0 ? '+' : '') + (v * 1e4).toFixed(1) + ' bp';
function toggleDock(force) {
  const g = document.querySelector('.grid'), on = force ?? !g.classList.contains('dock-big');
  g.classList.toggle('dock-big', on); $('#dockBtn').textContent = on ? 'Collapse panel' : 'Expand panel'; $('#dockBtn').title = on ? 'Return the bottom panel to its normal height' : 'Give the bottom panel more room'; $('#dockBtn').setAttribute('aria-pressed', String(on));
  setTimeout(() => { if (activeTab === 'bt' && typeof drawBtCurve === 'function') drawBtCurve(); if (activeTab === 'journal') renderJournal(); if (activeTab === 'lab') redrawLab(); reqOverlay(); }, 60);
}
/* ---- one trade model ----
   S.history holds one row per close, partial closes included (same id), newest first; a row's pnl is before
   commission, which the account paid in full at the open (h.comm is each part's share).
   netPnl(h): what the row did to the account. tradesOf(history): one record per position, newest last-part close first. */
// minutes after a losing close in which a new entry counts as a revenge trade (Behaviour flag and coach)
const REVENGE_MIN = 10;
const netPnl = h => (+h.pnl || 0) - (+h.comm || 0);
const TRADE_FIRST = ['pm', 'ctx', 'news', 'note', 'conf', 'mood', 'risk', 'sl0', 'tp0', 'basket', 'bgid', 'timeStop'];
function tradesOf(history) {
  const groups = new Map();
  for (const h of Array.isArray(history) ? history : []) {
    if (!h || h.nbp || h.side === 'nbp') continue; // the negative balance protection credit is not a trade
    // parts of one position share id, symbol, side and open time (a bare id can repeat in old imports)
    const k = `${h.id}|${h.sym}|${h.side}|${h.open}`;
    const g = groups.get(k); if (g) g.push(h); else groups.set(k, [h]);
  }
  const open = typeof S === 'object' && S && Array.isArray(S.positions) ? S.positions : [];
  const out = [];
  for (const rows of groups.values()) {
    const last = rows[0], first = rows[rows.length - 1], sum = f => rows.reduce((s, h) => s + (+h[f] || 0), 0);
    const lots = sum('lots'), w = f => lots > 0 ? rows.reduce((s, h) => s + (+h[f] || 0) * (+h.lots || 0), 0) / lots : +last[f] || 0;
    const tr = { id: last.id, sym: last.sym, side: last.side, lots: Math.round(lots * 100) / 100, open: first.open, close: last.close, entry: first.entry, exit: w('exit'),
      pnl: sum('pnl'), comm: sum('comm'), swap: sum('swap'), net: rows.reduce((s, h) => s + netPnl(h), 0), reason: last.reason, parts: rows.length,
      complete: !open.some(p => p.id === last.id && p.sym === last.sym),
      // lot-weighted pips and R (the risk per lot is fixed at the open, so this is total pnl / total risk)
      pips: w('pips'), r: rows.every(h => Number.isFinite(h.r)) ? w('r') : null,
      // how it ended: the last part's exit decision and final stop / target
      vol: last.vol, slLast: last.slLast, tpLast: last.tpLast, pmHit: rows.map(h => h.pmHit).find(v => v != null) ?? null };
    for (const f of TRADE_FIRST) if (first[f] !== undefined) tr[f] = first[f];
    Object.defineProperty(tr, 'rows', { value: rows }); // the history rows behind it (not enumerable: stays out of exports)
    out.push(tr);
  }
  return out;
}
/* ---- honest statistics (pure; atr1h / sig1h read Engine.aggregate and M() only) ---- */
// Wilson score interval for k successes in n: [lo, hi] (also .lo / .hi); null without trials
function wilson(k, n, z = 1.96) {
  if (!(n > 0) || !Number.isFinite(k) || !Number.isFinite(z) || k < 0 || k > n) return null;
  const p = k / n, d = 1 + z * z / n, c = (p + z * z / (2 * n)) / d, e = z * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / d;
  const lo = k === 0 ? 0 : Math.max(0, c - e), hi = k === n ? 1 : Math.min(1, c + e);
  return Object.assign([lo, hi], { lo, hi });
}
// a win rate with its 95% interval: "62% (43–78%) · n=26"
function wrTxt(k, n) {
  const ci = wilson(k, n), pc = v => Math.round(v * 100);
  return ci ? `${pc(k / n)}% (${pc(ci.lo)}–${pc(ci.hi)}%) · n=${n}` : `— · n=${n > 0 ? n : 0}`;
}
// Brier score with Murphy's decomposition over the distinct forecasts: bs = rel − res + unc; bss = 1 − bs / unc
// rows: [{ p: 0..1, y: outcome (truthy = happened) }]; null when no valid row; bss null when every outcome is the same
function brierParts(rows) {
  const ok = (Array.isArray(rows) ? rows : []).filter(r => r && typeof r.p === 'number' && r.p >= 0 && r.p <= 1);
  const N = ok.length; if (!N) return null;
  const g = new Map(); let bs = 0, k = 0;
  for (const r of ok) { const y = r.y ? 1 : 0, b = g.get(r.p) || { p: r.p, n: 0, k: 0 }; b.n++; b.k += y; g.set(r.p, b); bs += (r.p - y) ** 2; k += y; }
  const base = k / N, unc = base * (1 - base), bins = [...g.values()].sort((a, b) => a.p - b.p);
  let rel = 0, res = 0;
  for (const b of bins) { const o = b.k / b.n; b.obs = o; rel += b.n * (b.p - o) ** 2; res += b.n * (o - base) ** 2; }
  bs /= N; rel /= N; res /= N;
  return { n: N, bs, base, unc, rel, res, bss: unc > 0 ? 1 - bs / unc : null, bins };
}
// zero-drift random walk: probability that the move over `hours` is at least |distFrac| either way = 2(1 − Φ(d / (σ√h)))
function rwHit(distFrac, sigH, hours) {
  if (!Number.isFinite(distFrac) || !(sigH > 0) || !(hours > 0)) return null;
  // 2(1 − Φ(x)) = erfc(x / √2); Numerical Recipes erfcc, fractional error < 1.2e-7
  const x = Math.abs(distFrac) / (sigH * Math.sqrt(hours)) / Math.SQRT2, u = 1 / (1 + .5 * x);
  const v = u * Math.exp(-x * x - 1.26551223 + u * (1.00002368 + u * (.37409196 + u * (.09678418 + u * (-.18628806 + u * (.27886807 + u * (-1.13520398 + u * (1.48851587 + u * (-.82215223 + u * .17087277)))))))));
  return x === 0 ? 1 : Math.min(1, Math.max(0, v));
}
// Wilder's ATR: true range from the previous close, seeded by the mean of the first n TRs, then (prev·(n−1) + TR) / n
// in price units; null with fewer than n + 1 bars
function atrWilder(bars, n = 14) {
  if (!Array.isArray(bars) || !(n >= 1) || bars.length < n + 1) return null;
  let a = 0;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], pc = bars[i - 1].close, tr = Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
    a = i <= n ? a + tr / n : (a * (n - 1) + tr) / n;
  }
  return a;
}
// the last 101 complete 1-hour bars (the hour in progress is left out); null under 15
function hoursDone1h(sym) {
  if (!M(sym)) return null;
  const now = Engine.simTime, b = Engine.aggregate(sym, 60, 140).filter(x => x.time + 3600 <= now).slice(-101);
  return b.length >= 15 ? b : null;
}
// ATR(14) on complete 1-hour bars, in price units (divide by the pip for pips)
function atr1h(sym) { const b = hoursDone1h(sym); return b ? atrWilder(b, 14) : null; }
/* The normal for that ATR: the mean true range of the same hours of the day earlier in the week. ATR(14) at 16:00
   UTC covers the London and New York hours; a plain weekly mean would count the quiet nights too, and every pair
   would look 'elevated' every afternoon. null with under 10 matching earlier hours. */
function atrNorm1h(sym) {
  const b = hoursDone1h(sym); if (!b) return null;
  const n = b.length, hrs = new Set(b.slice(-14).map(x => new Date(x.time * 1000).getUTCHours())), tr = [];
  for (let i = 1; i < n - 14; i++) { const x = b[i], pc = b[i - 1].close; if (hrs.has(new Date(x.time * 1000).getUTCHours())) tr.push(Math.max(x.high - x.low, Math.abs(x.high - pc), Math.abs(x.low - pc))); }
  return tr.length >= 10 ? tr.reduce((a, v) => a + v, 0) / tr.length : null;
}
// sigma of hourly log returns on the same complete hours, as a fraction (zero drift: RMS about 0)
function sig1h(sym) {
  const b = hoursDone1h(sym); if (!b) return null;
  let s = 0; for (let i = 1; i < b.length; i++) s += Math.log(b[i].close / b[i - 1].close) ** 2;
  return Math.sqrt(s / (b.length - 1));
}

/* Market state and series gaps, shared by the analysis tools (Observatory, Lab, Baskets).
   A gap is a closed market between two consecutive bars (weekend, CFD daily pause): returns, activity and
   elapsed time are never measured across one. */
const GAP_S = 300;
const isGapAt = (T, i) => i > 0 && T[i] - T[i - 1] > GAP_S;
// log returns of consecutive bars, skipping every step that crosses a gap; idx[k] is the bar the k-th return ends on
function gapRets(T, C) {
  const r = [], idx = [];
  for (let i = 1; i < C.length; i++) if (!isGapAt(T, i) && C[i] > 0 && C[i - 1] > 0) { r.push(Math.log(C[i] / C[i - 1])); idx.push(i); }
  return { r, idx };
}
const isFxSym = s => Engine.FX.some(m => m.sym === s);
const isMajor = s => Engine.PAIRS.some(m => m.sym === s);
// {open, label}: label is empty while the market is open, otherwise "FX closed · opens Sun 22:00 UTC"
function mktState(sym = 'EURUSD') {
  const s = Engine.session(sym), m = M(sym);
  if (!s || s.open) return { open: true, label: '' };
  const who = isFxSym(sym) ? 'FX' : (m && m.name) || sym;
  const at = s.opensAt ? new Date(s.opensAt * 1000).toUTCString().replace(/^(\w+), \d+ \w+ \d+ (\d\d:\d\d).*$/, '$1 $2') + ' UTC' : '';
  return { open: false, label: `${who} closed${at ? ' · opens ' + at : ''}` };
}
