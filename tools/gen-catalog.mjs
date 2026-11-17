// tradeBerry catalog generator (.mace/design/catalog.md §1–2, contract C1).
// usage: node tools/gen-catalog.mjs   → writes catalog.js (deterministic; commit the result) and prints a calibration report.
// Reads Victor's instrument sheet (tabs main + profile_default only) and the price snapshot from his platform.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = new URL('../', import.meta.url);
const SHEET_FILE = 'tests/fixtures/instrument-specs-sheet-2026-10-20.json'; // the data lives in the repo (copied from .mace/data, byte-identical), so the generator and its test run without .mace
const SNAP_FILE = 'tests/fixtures/price-snapshot-2026-10-20.json';
const SHEET_DATE = '2026-10-20';
const PHI = .3, KX_CAP = 30, R2_CAP = .95, RMAX = 3, K = 4;
const G8 = ['EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'];
const FX_MAJOR = new Set(['USD', 'EUR', 'JPY', 'GBP', 'CAD', 'CHF']);
// ESMA Annex I major indices (the jurisdiction cap only)
const INDEX_MAJOR = new Set(['US.500', 'US.30', 'US.100', 'DE.30', 'FTSE.100', 'CAC40.FR', 'EU.50', 'JAP225', 'AUS200']);
const TYPE = { FOREX: 'fx', STOCKS: 'stock', COMMODITIES: 'commodity', INDICES: 'index', CRYPTOCURRENCIES: 'crypto' };
const COMMODITY_GROUP = { Metals: 'metal', Energy: 'energy', 'Oil & Gas': 'energy', Agriculture: 'agri' };

const r5 = x => x == null ? null : +(+x).toPrecision(5);
const num = s => { const v = parseFloat(s); if (!Number.isFinite(v)) throw new Error('not a number: ' + s); return v; };

/* Sessions: "HHMM-HHMM:d;" in server time, d 1 = Sunday … 7 = Saturday, 0000-0000 = the whole day, end exclusive.
   → [[dow (0 = Sunday), fromMin, toMin], …] sorted; a window across midnight is split into the next day. */
export function parseSessions(str) {
  const out = [];
  for (const part of String(str || '').split(';').map(s => s.trim()).filter(Boolean)) {
    const m = /^(\d{2})(\d{2})-(\d{2})(\d{2}):([1-7])$/.exec(part);
    if (!m) throw new Error('bad session window: ' + part);
    const from = +m[1] * 60 + +m[2], to = +m[3] * 60 + +m[4], d = +m[5] - 1;
    if (from > 1440 || to > 1440) throw new Error('bad session time: ' + part);
    if (from === 0 && to === 0) out.push([d, 0, 1440]);
    else if (to > from) out.push([d, from, to]);
    else if (to === 0) out.push([d, from, 1440]);
    else { out.push([d, from, 1440]); out.push([(d + 1) % 7, 0, to]); }
  }
  out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
  const is247 = out.length > 0 && [0, 1, 2, 3, 4, 5, 6].every(d => {
    let end = 0;
    for (const w of out.filter(w => w[0] === d)) { if (w[1] > end) return false; end = Math.max(end, w[2]); }
    return end >= 1440;
  });
  return { sess: out, is247 };
}

// open hours per trading day and breaks (reopenings after a pause, the week wraps around) per trading day
export function sessionStats(sess) {
  const days = new Set(sess.map(w => w[0])).size;
  if (!days) return { hDay: 0, breaksDay: 0, days: 0 };
  const W = 7 * 1440, ws = sess.map(([d, a, b]) => [d * 1440 + a, d * 1440 + b]).sort((x, y) => x[0] - y[0]);
  const mg = [];
  for (const [a, b] of ws) { const l = mg[mg.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], b); else mg.push([a, b]); }
  if (mg.length > 1 && mg[mg.length - 1][1] >= W && mg[0][0] === 0) mg.pop(); // wraps into the first window
  const breaks = mg.length === 1 && mg[0][0] === 0 && mg[0][1] >= W ? 0 : mg.length;
  return { hDay: ws.reduce((s, [a, b]) => s + b - a, 0) / 60 / days, breaksDay: breaks / days, days };
}

export const fxPip = d => d % 2 ? +(10 ** -(d - 1)).toFixed(d - 1) : +(10 ** -d).toFixed(d);

/* ---------- small dense linear algebra (deterministic) ---------- */
function jacobi(A0) { // symmetric eigen-decomposition: { val, vec (columns) }
  const n = A0.length, A = A0.map(r => r.slice()), V = A.map((_, i) => A.map((_, j) => +(i === j)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0; for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += A[i][j] ** 2;
    if (off < 1e-22) break;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) {
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < n; k++) { const a = A[k][p], b = A[k][q]; A[k][p] = c * a - s * b; A[k][q] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = A[p][k], b = A[q][k]; A[p][k] = c * a - s * b; A[q][k] = s * a + c * b; }
      for (let k = 0; k < n; k++) { const a = V[k][p], b = V[k][q]; V[k][p] = c * a - s * b; V[k][q] = s * a + c * b; }
    }
  }
  const idx = A.map((_, i) => i).sort((a, b) => A[b][b] - A[a][a]);
  return { val: idx.map(i => A[i][i]), vec: V.map(r => idx.map(i => r[i])) };
}
function solve(A0, b0) { // Gaussian elimination, partial pivot
  const n = A0.length, A = A0.map((r, i) => [...r, b0[i]]);
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = c + 1; r < n; r++) { const f = A[r][c] / A[c][c]; for (let k = c; k <= n; k++) A[r][k] -= f * A[c][k]; }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) { let s = A[r][n]; for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k]; x[r] = s / A[r][r]; }
  return x;
}
function cholesky(A) {
  const n = A.length, L = A.map(() => new Array(n).fill(0));
  for (let i = 0; i < n; i++) for (let j = 0; j <= i; j++) {
    let s = A[i][j]; for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
    L[i][j] = i === j ? Math.sqrt(Math.max(s, 0)) : (L[j][j] > 0 ? s / L[j][j] : 0);
  }
  return L;
}
const psd = (A, floor = 1e-9) => { const { val, vec } = jacobi(A), n = A.length, v = val.map(x => Math.max(x, floor));
  return A.map((_, i) => A.map((_, j) => { let s = 0; for (let k = 0; k < n; k++) s += vec[i][k] * v[k] * vec[j][k]; return s; })); };

/* ---------- inputs ---------- */
function loadInputs() {
  const sheet = JSON.parse(fs.readFileSync(new URL(SHEET_FILE, ROOT), 'utf8')).sheets;
  const snap = JSON.parse(fs.readFileSync(new URL(SNAP_FILE, ROOT), 'utf8'));
  return { sheet, snap };
}
// the last active row per alias: the sheet has stale inactive duplicates and two active ones (ZM.US, UBER.US)
const lastActive = rows => { const o = {}; for (const r of rows) if (r.active === '1') o[r.alias] = r; return o; };

/* ---------- FX: currency covariance from the 38 pairs, K-factor model ---------- */
function fitCurrencies(snap, row) {
  const O = snap.fxOrder, n = O.length;
  const ccys = [...G8, ...[...new Set(O.flatMap(p => [p.slice(0, 3), p.slice(3)]))].filter(c => c !== 'USD' && !G8.includes(c)).sort()];
  const N = ccys.length, ix = Object.fromEntries(ccys.map((c, i) => [c, i]));
  const a = O.map(p => { const v = new Array(N).fill(0); if (p.slice(0, 3) !== 'USD') v[ix[p.slice(0, 3)]] += 1; if (p.slice(3) !== 'USD') v[ix[p.slice(3)]] -= 1; return v; });
  const s = O.map(p => row[p].s1h);
  // least squares on the pair covariances, each equation scaled to correlation units
  const U = []; for (let i = 0; i < N; i++) for (let j = i; j < N; j++) U.push([i, j]);
  const M = U.map(() => new Array(U.length).fill(0)), rhs = new Array(U.length).fill(0);
  for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
    const w = 1 / (s[i] * s[j]), target = (i === j ? 1 : snap.fxCorr[i][j]) * s[i] * s[j] * w;
    const coef = U.map(([p, q]) => (p === q ? a[i][p] * a[j][p] : a[i][p] * a[j][q] + a[i][q] * a[j][p]) * w);
    for (let u = 0; u < U.length; u++) { if (!coef[u]) continue; rhs[u] += coef[u] * target; for (let v = 0; v < U.length; v++) if (coef[v]) M[u][v] += coef[u] * coef[v]; }
  }
  const x = solve(M, rhs);
  let S = ccys.map(() => new Array(N).fill(0));
  U.forEach(([p, q], u) => { S[p][q] = S[q][p] = x[u]; });
  S = psd(S, 1e-14);
  const vol = S.map((r, i) => Math.sqrt(r[i]));
  const R = S.map((r, i) => r.map((v, j) => v / (vol[i] * vol[j])));
  // principal-axis factor analysis on the correlation: R ≈ BBᵀ + Ψ, Ψ = 1 − rowsum(B²)
  let psi = R.map(() => .3), B = null;
  for (let it = 0; it < 500; it++) {
    const Rr = R.map((r, i) => r.map((v, j) => i === j ? 1 - psi[i] : v));
    const { val, vec } = jacobi(Rr);
    B = R.map((_, i) => Array.from({ length: K }, (_, k) => vec[i][k] * Math.sqrt(Math.max(val[k], 0))));
    const np = B.map(b => Math.min(1, Math.max(.002, 1 - b.reduce((q, v) => q + v * v, 0))));
    const d = Math.max(...np.map((v, i) => Math.abs(v - psi[i]))); psi = np;
    if (d < 1e-10) break;
  }
  // sign convention per factor (largest |loading| positive), then rows renormalised so load·load + idio² = 1
  for (let k = 0; k < K; k++) { let m = 0; for (let i = 0; i < N; i++) if (Math.abs(B[i][k]) > Math.abs(m)) m = B[i][k]; if (m < 0) for (let i = 0; i < N; i++) B[i][k] = -B[i][k]; }
  const ccy = {};
  const pairOf = c => O.find(p => p === c + 'USD' || p === 'USD' + c) || (c === 'HUF' ? 'EURHUF' : null);
  const fxClosedH = 7 * 24 - 5 * 24; // FX closes from Saturday 00:00 to Monday 00:00 server time
  for (const c of ccys) {
    const i = ix[c], b = B[i], l2 = b.reduce((q, v) => q + v * v, 0), sc = l2 > 1 ? 1 / Math.sqrt(l2) : 1;
    const load = b.map(v => r5(v * sc)), idio = Math.sqrt(Math.max(0, 1 - load.reduce((q, v) => q + v * v, 0)));
    const p = pairOf(c), pr = row[p];
    const ref = p === c + 'USD' ? 1 / pr.bid : p === 'USD' + c ? pr.bid : row.EURHUF.bid / row.EURUSD.bid;
    ccy[c] = { vol: r5(vol[i]), load, idio: r5(idio), prof: pr.prof24, wk: r5(pr.sGap / (pr.s1h * Math.sqrt(fxClosedH))), pair: p, ref: +ref.toPrecision(8) };
  }
  // fit quality on the pair correlations, from the rounded catalog values
  const cov = (p, q) => p === 'USD' || q === 'USD' ? 0 : p === q ? ccy[p].vol ** 2 : ccy[p].vol * ccy[q].vol * ccy[p].load.reduce((z, v, k) => z + v * ccy[q].load[k], 0);
  const pc = (P, Q) => cov(P.slice(0, 3), Q.slice(0, 3)) - cov(P.slice(0, 3), Q.slice(3)) - cov(P.slice(3), Q.slice(0, 3)) + cov(P.slice(3), Q.slice(3));
  let se = 0, m = 0;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { se += (pc(O[i], O[j]) / Math.sqrt(pc(O[i], O[i]) * pc(O[j], O[j])) - snap.fxCorr[i][j]) ** 2; m++; }
  return { ccy, rmse: Math.sqrt(se / m) };
}

/* ---------- non-FX factors ---------- */
function factorModel(snap) {
  const F = snap.factors, L = snap.loadings, O = snap.fxOrder;
  const CF = F.map((a, i) => F.map((b, j) => i === j ? 1 : L[a] ? L[a][j] : L[b] ? L[b][i] : snap.fxCorr[O.indexOf(a)][O.indexOf(b)]));
  const ev = jacobi(CF).val;
  if (ev[ev.length - 1] <= 1e-6) throw new Error('factor correlation is not positive definite: ' + ev);
  const c = CF[6][7], det = 1 - c * c, inv = [[1 / det, -c / det], [-c / det, 1 / det]];
  const cond = [0, 1, 2, 3, 4, 5].map(i => [0, 1].map(k => CF[i][6] * inv[0][k] + CF[i][7] * inv[1][k]));
  const cc = [0, 1, 2, 3, 4, 5].map(i => [0, 1, 2, 3, 4, 5].map(j => CF[i][j] - (cond[i][0] * CF[6][j] + cond[i][1] * CF[7][j])));
  return { F, CF, cond, chol: cholesky(cc) };
}

/* ---------- the catalog ---------- */
function parseSwap(s) {
  const t = String(s).trim();
  if (/pips$/.test(t)) return [num(t.replace(/pips$/, '')), 'pts'];
  if (/%$/.test(t)) return [num(t.replace(/%$/, '')) / 100, 'pctYr'];
  return [num(t), 'pctYr'];
}
const parseSpread = s => { const [b, lo, hi] = String(s).split(',').map(Number); return { b, j: lo == null || Number.isNaN(lo) ? null : [lo, hi] }; };

export function build() {
  const { sheet, snap } = loadInputs();
  const row = Object.fromEntries(snap.rows.map(r => [r[0], Object.fromEntries(snap.cols.map((c, i) => [c, r[i]]))]));
  const main = lastActive(sheet.main), prof = lastActive(sheet.profile_default);
  const set = Object.keys(main).filter(a => prof[a] && prof[a].tradeStatus !== 'DISABLED' && row[a] && Number.isFinite(row[a].bid));
  const { ccy, rmse } = fitCurrencies(snap, row);
  const fm = factorModel(snap);
  const report = { ratio: [], shrunk: [], rmse };
  const instr = set.map(sym => {
    const m = main[sym], p = prof[sym], r = row[sym];
    const type = TYPE[m.type]; if (!type) throw new Error(sym + ': unknown type ' + m.type);
    const base = m.baseCurrency, quote = m.profitCurrency;
    const group = type === 'fx' ? 'fx' : type === 'commodity' ? COMMODITY_GROUP[m.sector] : type === 'index' ? (/^(BUND|SCHATZ)/.test(sym) ? 'rates' : 'index') : type;
    if (!group) throw new Error(sym + ': no group for sector ' + m.sector);
    const cls = type === 'fx' ? (FX_MAJOR.has(base) && FX_MAJOR.has(quote) ? 'fx-major' : 'fx-minor') : sym === 'GOLD' ? 'gold' : type === 'commodity' ? 'commodity'
      : group === 'rates' ? 'equity' : type === 'index' ? (INDEX_MAJOR.has(sym) ? 'index-major' : 'index-minor') : type === 'crypto' ? 'crypto' : 'equity';
    const digits = Math.round(num(m.digits)), point = +(10 ** -digits).toFixed(digits);
    const { sess, is247 } = parseSessions(m.sessions);
    const st = sessionStats(sess);
    // seed: the daily variance target σ_in²·H + n·sGap² = sD² (the gap shrunk where the sheet leaves too little room)
    const nb = st.breaksDay, H = st.hDay;
    let gap = r.sGap == null || nb === 0 ? null : r.sGap;
    let res = r.sD ** 2 - nb * (gap || 0) ** 2;
    const ratio = r.s1h * Math.sqrt(H) / Math.sqrt(Math.max(res, 1e-30));
    if (ratio > 1.5) report.ratio.push([sym, ratio]);
    const minRes = r.s1h ** 2 * H / (RMAX * RMAX);
    if (gap != null && res < minRes) { res = Math.min(minRes, r.sD ** 2); gap = Math.sqrt(Math.max(0, r.sD ** 2 - res) / nb); report.shrunk.push(sym); }
    const sIn = Math.sqrt(res / H);
    const kx = Math.min(KX_CAP, r.kx), lamJ = kx > 0 ? 3 * PHI * PHI / kx : 0, J = kx > 0 ? sIn * Math.sqrt(PHI / lamJ) : 0;
    let beta = null, idio = null, derived;
    if (type === 'crypto' && quote === 'EUR') { derived = sym.slice(0, -3) + 'USD/EURUSD'; idio = 0; }
    else if (type !== 'fx') {
      const fi = fm.F.indexOf(sym);
      if (fi >= 0) { beta = fm.F.map((_, j) => +(j === fi)); idio = 0; }
      else {
        const rho = snap.loadings[sym]; if (!rho) throw new Error(sym + ': no loadings');
        let b = solve(fm.CF, rho), r2 = b.reduce((q, v, i) => q + v * rho[i], 0);
        if (r2 > R2_CAP) { const k = Math.sqrt(R2_CAP / r2); b = b.map(v => v * k); r2 = R2_CAP; }
        beta = b.map(r5); idio = r5(Math.sqrt(Math.max(0, 1 - r2)));
      }
    }
    const seed = { bid: r.bid, t: r.t, live: r.live, sIn: r5(sIn), sGap: r5(gap), lamJ: r5(lamJ), J: r5(J), prof: r.prof24, beta, idio };
    if (derived) seed.derived = derived;
    const sp = ['Default', 'Night', 'News'].map(k => parseSpread(p['spreadProfile:' + k]));
    const [sl, ul] = parseSwap(p.swapLong), [ss, us] = parseSwap(p.swapShort);
    if (ul !== us) throw new Error(sym + ': swap units differ');
    const o = {
      sym, type, kind: type === 'fx' ? 'fx' : 'cfd', group, cls, desc: m.description, sector: m.sector, exch: m.exchange, country: m.countryOrigin, base, quote,
      digits, point, pip: type === 'fx' ? fxPip(digits) : point, unit: type === 'fx' ? 'pip' : 'pt',
      size: num(m.contractSize), sizeUnit: m.contractDef === 'Index Value' ? 'point' : m.contractDef, lotName: type === 'stock' ? 'shares' : 'lots',
      sess, is247, fmt: m.relevantDigitsFormat, offQ: m.offQuotesTime == null || m.offQuotesTime === '-' ? null : num(m.offQuotesTime),
      seed,
      p: {
        status: p.tradeStatus === 'CLOSE ONLY' ? 'close' : 'full', lev: [num(p.defaultLeverage), num(p.maximumLeverage)],
        vol: [num(p.minTradeVolume), num(p.maxTradeVolume), num(p.stepVolume)], minPend: num(p.minPendingOrder), maxDev: num(p.maxDeviation),
        swap: [sl, ss, ul], comm: num(p.pertradecommission), spread: sp.map(x => x.b), jit: sp.some(x => x.j) ? sp.map(x => x.j || [0, 0]) : null
      }
    };
    return o;
  });
  const factors = { names: fm.F.slice(0, 6), fx: fm.F.slice(6), cond: fm.cond.map(r => r.map(r5)), chol: fm.chol.map(r => r.map(v => v === 0 ? 0 : r5(v))) };
  const snapAt = snap.at.replace(/\.\d+Z$/, 'Z');
  return { cat: { v: 1, sheetDate: SHEET_DATE, snapAt, snapSrc: 'broker platform', serverTz: 'EET', ccy, factors, instr }, report };
}

const HEADER = `/* catalog.js — generated by tools/gen-catalog.mjs — do not edit (run: node tools/gen-catalog.mjs).
   Sources: Victor's instrument sheet (${SHEET_DATE}; tabs main + profile_default only) and a price snapshot from his broker
   platform (last bid + 30 days of 1H bars). The market built on it stays SIMULATED, with zero drift.
   Units and conventions (.mace/design/catalog.md §1–2, contract C1):
   - sess: [dow (0 = Sunday), fromMin, toMin) in server time (EET/EEST); is247 = every day, all day.
   - point = 10^-digits; FX pip = 10^-(digits-1) for odd digits, else 10^-digits; non-FX unit = point.
   - p.spread [default, night, news], p.minPend, p.maxDev in points; p.jit = crypto spread variation [lo, hi] per profile.
   - p.swap [long, short, unit]: 'pts' = points per lot per night (sheet "pips"); 'pctYr' = annual fraction of notional
     (per night: notional × swap / 360). p.lev [default, max]; p.vol [min, max, step].
   - seed: bid at t (unix s; live 0 = last 1H close). sIn = σ per open hour (log), from σ_in²·H + n·sGap² = sD²; where the
     sheet's gap leaves less than (s1h/${RMAX})²·H for the session, the gap is shrunk to keep sD. Jumps: Poisson lamJ per hour,
     log-size sd J, carrying φ = ${PHI} of the in-session variance (kx capped at ${KX_CAP}). prof = 24 UTC-hour digits (null:
     use US.500 on the cash session). beta on the 8 factors [US.500, DE.30, US.100, GOLD, OIL, BTCUSD, EURUSD, USDJPY],
     R² capped at ${R2_CAP}, idio = √(1 − R²); derived = price is that ratio; FX: beta/idio null (they move on ccy).
   - ccy (15, USD is the numeraire): vol = σ per hour of the log USD value; load (K = ${K}) + idio, load·load + idio² = 1,
     fitted on the pairs' 1H correlations; prof from its USD pair (pair); wk = vol multiplier while FX is closed so the
     48 h weekend accumulates the pair's sGap²; ref = units per USD at the seed bids.
   - factors: names = the 6 non-FX factors, fx = the 2 FX factors they are conditioned on; given the standardised FX
     increments z, the 6 = cond·z + chol·ε. */
`;

// deterministic source text, compact: instruments as rows of values (one per line) expanded to C1 objects at load
const IK = ['sym', 'type', 'kind', 'group', 'cls', 'desc', 'sector', 'exch', 'country', 'base', 'quote', 'digits', 'point', 'pip', 'unit', 'size', 'sizeUnit', 'lotName', 'sess', 'is247', 'fmt', 'offQ', 'seed', 'p'];
const SK = ['bid', 't', 'live', 'sIn', 'sGap', 'lamJ', 'J', 'prof', 'beta', 'idio', 'derived'];
const PK = ['status', 'lev', 'vol', 'minPend', 'maxDev', 'swap', 'comm', 'spread', 'jit'];
export function generate() {
  const { cat } = build();
  const J = JSON.stringify;
  const head = Object.entries(cat).filter(([k]) => !['ccy', 'factors', 'instr'].includes(k)).map(([k, v]) => `${k}:${J(v)}`).join(',');
  const ccy = Object.entries(cat.ccy).map(([k, v]) => ` ${k}:${J(v)}`).join(',\n');
  const rows = cat.instr.map(m => J(IK.map(k => k === 'seed' ? SK.map(q => m.seed[q] ?? null) : k === 'p' ? PK.map(q => m.p[q]) : m[k])));
  const body = `{${head},\nccy:{\n${ccy}\n},\nfactors:${J(cat.factors)},\ninstr:[\n${rows.join(',\n')}\n].map(r => {\n` +
    `  const o = I.reduce((a, k, i) => (a[k] = r[i], a), {});\n  o.seed = S.reduce((a, k, i) => (r[22][i] != null || k !== 'derived' ? (a[k] = r[22][i], a) : a), {});\n  o.p = P.reduce((a, k, i) => (a[k] = r[23][i], a), {});\n  return o;\n})}`;
  return HEADER + `const CATALOG = (() => {\nconst I = ${J(IK)}, S = ${J(SK)}, P = ${J(PK)};\n` +
    `const f = x => { if (x && typeof x === 'object' && !Object.isFrozen(x)) { for (const k in x) f(x[k]); Object.freeze(x); } return x; };\nreturn f(${body});\n})();\n`;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fs.realpathSync(process.argv[1])) {
  const src = generate(), { cat, report } = build();
  fs.writeFileSync(new URL('catalog.js', ROOT), src);
  const by = k => Object.entries(cat.instr.reduce((o, m) => (o[m[k]] = (o[m[k]] || 0) + 1, o), {})).map(([a, b]) => a + ' ' + b).join(', ');
  console.log(`catalog.js: ${cat.instr.length} instruments (${by('type')}); ${(src.length / 1024).toFixed(1)} KB`);
  console.log(`FX: ${Object.keys(cat.ccy).length} currencies, K = ${K}; pair-correlation RMSE ${report.rmse.toFixed(4)}`);
  console.log(`mean-reversion ratio s1h·√H / √(sD² − n·sGap²) above 1.5 (intraday mean reversion not reproduced) on ${report.ratio.length}:`);
  console.log('  ' + report.ratio.sort((a, b) => b[1] - a[1]).map(([s, r]) => `${s} ${Number.isFinite(r) && r < 1e6 ? r.toFixed(2) : '∞'}`).join(', '));
  console.log(`gap shrunk to fit the daily target on ${report.shrunk.length}: ${report.shrunk.join(', ')}`);
}
