'use strict';
/* tradeBerry — Observatory v6 tools.
   Edge check: a setup scanner that grades every live signal by its own track record on that pair.
   Range cone: session-aware volatility forecast with self-calibration against a constant-vol cone.
   Exit lab: replays your closed trades under alternative exit policies (counterfactual exits). */

const LAB = { scan: null, scanKey: '', cone: null, coneKey: '', exit: null, exitKey: '', sample: null };
function labCfg(c) { return Object.assign(c, { scH: 8, scF: 'live', scAlert: false, cnH: 240, cnMode: 'model', exR: 'stop', ...c }); }
const labQ = (a, q) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y), k = Math.min(s.length - 1, Math.ceil((s.length + 1) * q) - 1); return s[Math.max(0, k)]; };
// two-sided p for a t-statistic: Student-t with df = n − 1 via the regularised incomplete beta
function labLgamma(x) { const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, .1208650973866179e-2, -.5395239384953e-5]; let y = x, t = x + 5.5, s = 1.000000000190015; t -= (x + .5) * Math.log(t); for (const c of g) s += c / ++y; return -t + Math.log(2.5066282746310005 * s / x); }
function labIbeta(x, a, b) {
  if (x <= 0) return 0; if (x >= 1) return 1;
  const bt = Math.exp(labLgamma(a + b) - labLgamma(a) - labLgamma(b) + a * Math.log(x) + b * Math.log(1 - x));
  const cf = (x, a, b) => { const T = 1e-30; let c = 1, d = 1 - (a + b) * x / (a + 1); d = 1 / (Math.abs(d) < T ? T : d); let h = d; for (let m = 1; m <= 300; m++) { const m2 = 2 * m; let aa = m * (b - m) * x / ((a + m2 - 1) * (a + m2)); d = 1 + aa * d; d = 1 / (Math.abs(d) < T ? T : d); c = 1 + aa / c; c = Math.abs(c) < T ? T : c; h *= d * c; aa = -(a + m) * (a + b + m) * x / ((a + m2) * (a + m2 + 1)); d = 1 + aa * d; d = 1 / (Math.abs(d) < T ? T : d); c = 1 + aa / c; c = Math.abs(c) < T ? T : c; const del = d * c; h *= del; if (Math.abs(del - 1) < 3e-14) break; } return h; };
  return x < (a + 1) / (a + b + 2) ? bt * cf(x, a, b) / a : 1 - bt * cf(1 - x, b, a) / b;
}
function labTp2(t, df) { if (t == null || !isFinite(t) || !(df > 0)) return 1; return Math.min(1, labIbeta(df / (df + t * t), df / 2, .5)); }
const labP2 = (t, n) => labTp2(t, n - 1);

/* ---------------- shared helpers ---------------- */
function labEma(a, n) { const k = 2 / (n + 1), o = []; let e = a[0]; for (let i = 0; i < a.length; i++) { e = i ? a[i] * k + e * (1 - k) : a[0]; o.push(e); } return o; }
function labRsi(a, n = 14) { const o = Array(a.length).fill(50); let g = 0, l = 0; for (let i = 1; i < a.length; i++) { const d = a[i] - a[i - 1]; if (i <= n) { g += Math.max(d, 0) / n; l += Math.max(-d, 0) / n; } else { g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; } if (i >= n) o[i] = l ? 100 - 100 / (1 + g / l) : 100; } return o; }
function labT(x) { const n = x.length; if (n < 2) return null; const m = mean(x), s = stdev(x); return s ? m / (s / Math.sqrt(n)) : null; }
function labNcdf(z) { const t = 1 / (1 + .2316419 * Math.abs(z)), d = .3989423 * Math.exp(-z * z / 2), p = d * t * (.3193815 + t * (-.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; }
// a duration in minutes: 45m, 1h, 2h 45m, 24h, 2d
const LAB_HM = m => { m = Math.round(m); if (m >= 2880 && m % 1440 === 0) return `${m / 1440}d`; const h = Math.floor(m / 60), r = m % 60; return h ? (r ? `${h}h ${r}m` : `${h}h`) : `${m}m`; };
// a seeded generator (mulberry32): the same seed gives the same draws, so a Monte Carlo figure does not flicker per tick
function labRng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const labSeed = str => { let h = 2166136261; for (let i = 0; i < str.length; i++) h = Math.imul(h ^ str.charCodeAt(i), 16777619); return h >>> 0; };

/* ---------------- 1. Edge check (setup scanner) ---------------- */
const SC_SIG = {
  brk: ['24h breakout', 'Close beyond the high or low of the previous 24 hours — trade with it'],
  fade: ['Stretch fade', 'Close more than 2σ from its 20-bar mean — trade back toward it'],
  trd: ['Trend pullback', 'EMA20 above EMA50, price dips to EMA20 — trade with the trend'],
  rsi: ['RSI extreme', 'RSI(14) below 25 or above 75 — trade the reversal'],
  sqz: ['Volatility squeeze', '20-bar volatility in the quietest 10% of the week — expect a bigger move']
};
function scSignals(k) {
  const C = k.map(x => x.close), n = C.length, e20 = labEma(C, 20), e50 = labEma(C, 50), rsi = labRsi(C), r = [0];
  for (let i = 1; i < n; i++) r.push(Math.log(C[i] / C[i - 1]));
  const sd = Array(n).fill(null), mu = Array(n).fill(null), vol = Array(n).fill(null);
  for (let i = 20; i < n; i++) { const w = C.slice(i - 19, i + 1), m = mean(w); mu[i] = m; sd[i] = stdev(w); vol[i] = stdev(r.slice(i - 19, i + 1)); }
  // the squeeze threshold is the 10% quantile of the volatility seen up to bar i (expanding), never of later bars:
  // a quantile over the whole window would let the future decide past signals (look-ahead)
  const seen = [], put = v => { let lo = 0, hi = seen.length; while (lo < hi) { const m = (lo + hi) >> 1; if (seen[m] < v) lo = m + 1; else hi = m; } seen.splice(lo, 0, v); };
  for (let i = 20; i < 96 && i < n; i++) if (vol[i] != null) put(vol[i]);
  const out = { brk: Array(n).fill(0), fade: Array(n).fill(0), trd: Array(n).fill(0), rsi: Array(n).fill(0), sqz: Array(n).fill(0) };
  for (let i = 96; i < n; i++) {
    if (vol[i] != null) put(vol[i]);
    const q10 = seen[Math.floor(seen.length * .1)] ?? 0;
    let hi = -Infinity, lo = Infinity; for (let j = i - 96; j < i; j++) { if (k[j].high > hi) hi = k[j].high; if (k[j].low < lo) lo = k[j].low; }
    if (C[i] > hi) out.brk[i] = 1; else if (C[i] < lo) out.brk[i] = -1;
    const z = sd[i] ? (C[i] - mu[i]) / sd[i] : 0; if (z > 2) out.fade[i] = -1; else if (z < -2) out.fade[i] = 1;
    if (e20[i] > e50[i] && k[i].low <= e20[i] && C[i] > e50[i]) out.trd[i] = 1; else if (e20[i] < e50[i] && k[i].high >= e20[i] && C[i] < e50[i]) out.trd[i] = -1;
    if (rsi[i] < 25) out.rsi[i] = 1; else if (rsi[i] > 75) out.rsi[i] = -1;
    if (vol[i] != null && vol[i] <= q10) out.sqz[i] = 2; // direction-neutral
  }
  return { out, C, r };
}
// the closed 15-minute bars of the last week: the bar in progress can still change its signal
function scBars(sym) { const now = Engine.simTime; return Engine.aggregate(sym, 15, 701).filter(x => x.time + 900 <= now).slice(-700); }
// a trigger is the bar the signal appears on; the bars it merely persists on are not new triggers
const scFresh = (sig, j) => j > 0 && !!sig[j] && sig[j - 1] !== sig[j];
/* forward outcomes for one signal series: non-overlapping (cooldown = horizon) so the t-stat is honest.
   The baseline of a trigger is its own hour of the day (UTC): every window starting in that hour over the week. A
   squeeze fires in the quiet hours, and against all hours it would look like a failure that is only the clock.
   No window spans a closed market (T: bar times; a span longer than H bars of 15 minutes).
   cost: the round-trip spread in bp; a directional trigger also gets its average and hit after paying it. */
function scEvidence(sig, C, H, keep, T, cost = 0) {
  const n = C.length, fw = [], at = [], bh = [], ts = [], hr = i => T ? Math.floor((((T[i] % 86400) + 86400) % 86400) / 3600) : 0, open = i => !T || T[i + H] - T[i] <= H * 900;
  const byH = Array.from({ length: 24 }, () => []);
  for (let i = 0; i + H < n; i++) if (open(i)) byH[hr(i)].push(Math.log(C[i + H] / C[i]) * 1e4);
  const muH = byH.map(a => a.length ? mean(a) : 0), absH = byH.map(a => a.length ? mean(a.map(Math.abs)) : 0);
  for (let i = 96; i + H < n; i++) {
    if (!scFresh(sig, i) || !open(i)) continue; // only fresh triggers
    const h = hr(i), A = byH[h], d = sig[i], f = Math.log(C[i + H] / C[i]) * 1e4;
    // range signals: the size of the move over the hour's usual size; directional: the move over the hour's drift
    if (d === 2) { fw.push(Math.abs(f) - absH[h]); bh.push(A.filter(x => Math.abs(x) > absH[h]).length / A.length); }
    else { fw.push(d * (f - muH[h])); bh.push(A.filter(x => d * (x - muH[h]) > 0).length / A.length); }
    at.push(i); ts.push(T ? T[i] : i * 900); i += H - 1;
  }
  const rng = sig.some(x => x === 2), net = !rng && fw.length ? fw.map(x => x - cost) : null;
  const hit = fw.length ? fw.filter(x => x > 0).length / fw.length * 100 : null, h = Math.floor(fw.length / 2), A = fw.slice(0, h), B = fw.slice(h);
  const stable = A.length >= 4 && B.length >= 4 && Math.sign(mean(A)) === Math.sign(mean(B)) && Math.sign(mean(A)) === Math.sign(mean(fw));
  return { n: fw.length, hit, baseHit: bh.length ? mean(bh) * 100 : null, avg: fw.length ? mean(fw) : null, t: labT(fw), stable, a1: A.length ? mean(A) : null, a2: B.length ? mean(B) : null, fw: keep ? fw : null, at: keep ? at : null, fwAll: fw, ts,
    avgNet: net ? mean(net) : null, hitNet: net ? net.filter(x => x > 0).length / net.length * 100 : null };
}
// one verdict per test, the single source for the label, the tooltip and the colour
function scVerdict(e) {
  if (e.n < 8) return ['thin', 'Too few'];
  if (e.t > 2 && e.fdr) return e.stable ? ['robust', 'Robust'] : ['unst', 'Significant · unstable'];
  if (e.t < -2 && e.fdr) return ['revsig', 't < −2 · significant'];
  if (e.t > 2) return ['edge', 't > 2 · luck?'];
  if (e.t < -2) return ['rev', 't < −2 · luck?'];
  return ['noise', 'Noise'];
}
const SC_VCLS = { unst: 'edge', revsig: 'rev' }; // styled like their unsignificant cousins
const SC_VLAB = { robust: 'Robust', unst: 'Significant · unstable', edge: 't > 2 · luck?', revsig: 't < −2 · significant', rev: 't < −2 · luck?', noise: 'Noise', thin: 'Too few' };
function scVtip(k, nT, exp) {
  return {
    robust: `Robust|t above 2, survives the Benjamini–Hochberg correction for the ${nT} signal–pair tests at once, and the same sign in both halves of the week (a weak check: about half of pure-noise results pass it too). The only verdict that counts as a record, and still a hypothesis to test forward.`,
    unst: `Significant, not stable|t above 2 and survives the correction for the ${nT} signal–pair tests at once, but the sign flipped between the two halves of the week: not a record.`,
    edge: `t > 2, not significant|Paid on this pair in the past week (t above 2), but does not survive the correction for the ${nT} signal–pair tests at once: about ${exp == null ? 'a few' : exp.toFixed(1)} of them pass |t| > 2 by chance alone.`,
    revsig: `t < −2, significant|Lost on this pair in the past week (t below −2) and survives the correction for the ${nT} signal–pair tests at once. The tests share currencies and overlap in time: not a contrarian signal.`,
    rev: `t < −2, not significant|Lost on this pair in the past week (t below −2), but does not survive the correction for the ${nT} signal–pair tests at once either: not a contrarian signal.`,
    noise: 'Noise|The past results are within what chance gives (t between −2 and 2).',
    thin: 'Too few|Fewer than 8 past triggers on this pair: no judgement.'
  }[k];
}
/* pooled t of one signal across the pairs (every trigger of every pair, one test), clustered by time: triggers that
   start in the same window of the horizon on several pairs (shared currencies, one market move) count as one cluster,
   so the same move seen on two pairs is not twice the evidence (cluster-robust standard error, G/(G−1) correction) */
function scPoolT(P, H) {
  const x = [], key = [], w = Math.max(1, H) * 900;
  for (const e of P) (e.fwAll || []).forEach((v, i) => { x.push(v); key.push(Math.floor((e.ts ? e.ts[i] : i * w) / w)); });
  if (x.length < 3) return null;
  const m = mean(x), cl = new Map(); x.forEach((v, i) => cl.set(key[i], (cl.get(key[i]) || 0) + v - m));
  const G = cl.size; if (G < 2) return null;
  let ss = 0; for (const v of cl.values()) ss += v * v;
  const V = G / (G - 1) * ss / (x.length * x.length); return V > 0 ? m / Math.sqrt(V) : null;
}
/* How often a scan of pure noise has survivors: [P(at least 1), P(at least 2)] by horizon (bars of 15 minutes).
   Measured on this simulator (24.10.2026): 1,000 scans per horizon of the week's 16 pairs, each pair's bars shuffled
   within their hour of the day (same sizes and session rhythm, no order), the same tests and correction as scRun. */
const SC_NULL = { 4: [.10, .019], 8: [.10, .019], 16: [.075, .016] };
function scNullTxt(nR, H) {
  const r = SC_NULL[H] || SC_NULL[8], one = Math.round(1 / r[0]), two = Math.round(1 / r[1]);
  return nR === 1 ? `1 survivor; about 1 in ${one} scans of pure noise has one` : nR === 2 ? `2 survivors; about 1 in ${two} scans of pure noise has 2 or more` : `${nR} survivors; under 1 in ${two} scans of pure noise has 2 or more`;
}
// barsOf(sym): the bars to scan (default: the closed 15-minute bars); the null-rate measurement passes shuffled ones
function scRun(H, barsOf = scBars) {
  const rows = [], pool = {}; let bars = 0, lastT = 0;
  for (const p of Engine.PAIRS) {
    const k = barsOf(p.sym); if (k.length < 150) continue;
    bars = Math.max(bars, k.length); lastT = Math.max(lastT, k[k.length - 1].time);
    const { out, C } = scSignals(k), T = k.map(x => x.time), last = k.length - 1, cost = scCost(p.sym, C[last]);
    for (const s in SC_SIG) {
      const e = scEvidence(out[s], C, H, false, T, cost);
      (pool[s] = pool[s] || []).push(e);
      // live: a trigger on the last closed bar, the way the record counts them (fresh, not merely persisting)
      if (scFresh(out[s], last)) rows.push({ sym: p.sym, s, dir: out[s][last], ago: 0, e, px: C[last] });
    }
  }
  // Benjamini–Hochberg at q = 10% across every signal × pair test
  const tests = Object.values(pool).flat().filter(e => e.n >= 8).sort((x, y) => labP2(x.t, x.n) - labP2(y.t, y.n)); let kmax = 0;
  tests.forEach((e, i) => { if (labP2(e.t, e.n) <= (i + 1) / tests.length * .1) kmax = i + 1; });
  tests.forEach((e, i) => e.fdr = i < kmax); const nTests = tests.length;
  // false positives expected at |t| > 2 if nothing works: Σ P(|T_{n−1}| > 2) over the included tests
  const expFP = tests.reduce((a, e) => a + labTp2(2, e.n - 1), 0);
  const card = Object.keys(SC_SIG).map(s => { const P = pool[s] || [], n = P.reduce((a, e) => a + e.n, 0); const avg = n ? P.reduce((a, e) => a + (e.avg || 0) * e.n, 0) / n : null, hit = n ? P.reduce((a, e) => a + (e.hit || 0) * e.n, 0) / n : null, baseHit = n ? P.reduce((a, e) => a + (e.baseHit || 0) * e.n, 0) / n : null, edges = P.filter(e => ['edge', 'unst', 'robust'].includes(scVerdict(e)[0])).length, robust = P.filter(e => scVerdict(e)[0] === 'robust').length, revs = P.filter(e => ['rev', 'revsig'].includes(scVerdict(e)[0])).length; return { s, n, avg, hit, baseHit, edges, robust, revs, pairs: P.length, t: scPoolT(P, H) }; });
  // the sample: how many cases the tests rest on (every signal × pair test, thin ones included)
  const ns = Object.values(pool).flat().map(e => e.n);
  return { rows, card, nTests, nFdr: kmax, expFP, bars, lastT, nMin: ns.length ? Math.min(...ns) : 0, nMax: ns.length ? Math.max(...ns) : 0 };
}
// "7.3 trading days of 15-minute bars: 7–25 cases per test", from the bars the scan read
function scSpan(x) { const d = x.bars * 15 / 1440; return `${d >= 10 ? d.toFixed(0) : d.toFixed(1).replace(/\.0$/, '')} trading days of 15-minute bars: ${x.nMin}–${x.nMax} cases per test`; }
// a bar time as "Fri 20:45 UTC"
const scWhen = t => { const d = new Date(t * 1000); return `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.toISOString().slice(11, 16)} UTC`; };
// the round-trip cost of a trigger in bp of price: the instrument's normal spread
const scCost = (sym, px) => { const m = M(sym); return m && px ? exSpread(m) / px * 1e4 : 0; };
/* the record of one signal on one pair. v: its verdict; colours of gain and loss only on a Robust record, otherwise the
   record is drawn neutral (a noise result in green would read as a direction) */
function scDetail(sym, s, H, v) {
  const k = scBars(sym), { out, C } = scSignals(k), T = k.map(x => x.time), e = scEvidence(out[s], C, H, true, T), dir = v === 'robust';
  const decay = [1, 2, 4, 8, 16].map(h => [h, scEvidence(out[s], C, h, false, T).avg]);
  let cum = 0; const pts = e.fw.map(x => cum += x), W = 300, Hh = 70, mn = Math.min(0, ...pts), mx = Math.max(0, ...pts), Y = v => 6 + (mx - v) / (mx - mn || 1) * (Hh - 12);
  const curve = pts.length > 1 ? `<svg viewBox="0 0 ${W} ${Hh}" width="100%" height="${Hh}" preserveAspectRatio="none"><line x1="0" x2="${W}" y1="${Y(0)}" y2="${Y(0)}" class="cn-grid"/><polyline fill="none" stroke="${!dir ? 'var(--ind1)' : cum >= 0 ? 'var(--up)' : 'var(--dn)'}" stroke-width="1.8" vector-effect="non-scaling-stroke" points="${pts.map((v, i) => `${(i / (pts.length - 1) * W).toFixed(1)},${Y(v).toFixed(1)}`).join(' ')}"/></svg>` : '';
  const dm = Math.max(1e-9, ...decay.map(d => Math.abs(d[1] || 0)));
  return `<div class="sc-det"><div><label class="bh-lab">Every past trigger, cumulative bp</label>${curve}<p class="small muted">${e.n} triggers · total ${sgn(cum, 0)} bp (${sgn(cum * 1e-4 * Engine.quote(sym).mid / M(sym).pip, 0)} pips) · first half ${e.a1 == null ? '—' : sgn(e.a1, 1)} bp, second half ${e.a2 == null ? '—' : sgn(e.a2, 1)} bp ${e.stable ? `<b${dir ? ' class="up"' : ''}>· same sign in both halves</b>` : `<b${dir ? ' class="dn"' : ''}>· flipped between halves</b>`}</p></div>
    <div><label class="bh-lab">Average move by horizon</label><div class="sc-decay">${decay.map(([h, v]) => `<div><span class="mono small">${LAB_HM(h * 15)}</span><div class="bk-exp-bar"><i class="${!dir ? 'nt' : (v || 0) >= 0 ? 'up' : 'dn'}" style="${(v || 0) >= 0 ? 'left:50%' : `left:${50 - Math.abs(v || 0) / dm * 50}%`};width:${Math.abs(v || 0) / dm * 50}%"></i></div><b class="mono small ${dir ? cls(v || 0) : ''}">${v == null ? '—' : sgn(v, 1)}</b></div>`).join('')}</div><p class="small muted">A real edge usually builds or holds with the horizon; noise jumps around.</p></div></div>`;
}
function scWatch() {
  const c = obsCfg(); labCfg(c); if (!c.scAlert || !Engine.candles.EURUSD?.length) return;
  const key = `${c.scH}|${Math.floor(Engine.simTime / 900)}`; if (LAB.scanKey !== key) { LAB.scan = scRun(c.scH); LAB.scanKey = key; } else if (LAB.watched === key) return;
  LAB.watched = key; LAB.seen = LAB.seen || {};
  for (const r of LAB.scan.rows) { const v = scVerdict(r.e)[0], id = `${r.sym}|${r.s}|${Math.floor(Engine.simTime / 900) - r.ago}`; if (r.ago === 0 && v === 'robust' && !LAB.seen[id]) { LAB.seen[id] = 1; toast(`Edge check: ${pretty(r.sym)} ${SC_SIG[r.s][0]}`, `${r.dir === 2 ? 'Range signal' : (r.dir > 0 ? 'Buy signal' : 'Sell signal')} · ${r.e.n} past cases, ${r.e.hit.toFixed(0)}% hit, t ${nfx(r.e.t, 1)} · FDR-significant record. Not a forecast of direction.`, 'info'); } }
}
function drawScan(b, c) {
  labCfg(c);
  const key = `${c.scH}|${Math.floor(Engine.simTime / 900)}`;
  if (LAB.scanKey !== key) { LAB.scan = scRun(c.scH); LAB.scanKey = key; }
  const { rows, card } = LAB.scan, H = c.scH * 15, ord = { robust: -2, unst: -1, revsig: -1, edge: 0, rev: 1, noise: 2, thin: 3 };
  const list = rows.filter(r => c.scF === 'all' || ['robust', 'unst', 'edge', 'revsig', 'rev'].includes(scVerdict(r.e)[0])).sort((a, b2) => ord[scVerdict(a.e)[0]] - ord[scVerdict(b2.e)[0]] || (b2.e.t || 0) - (a.e.t || 0));
  const exp = LAB.scan.expFP, nT = LAB.scan.nTests;
  // with the market closed the newest closed bar is the last one before the close, not a live signal
  const closed = !mktState(Engine.PAIRS[0].sym).open && LAB.scan.lastT > 0, atClose = closed ? `last signal before the close (${scWhen(LAB.scan.lastT)})` : '', span = scSpan(LAB.scan);
  const edges = card.reduce((a, x) => a + x.edges + x.revs, 0), nR = LAB.scan.nFdr;
  // in pips for the open pair's scale: bp of the pair's price
  const pip = (sym, v) => v * 1e-4 * Engine.quote(sym).mid / M(sym).pip;
  // the correction treats the tests as independent; they share currencies and overlap in time
  const dep = 'The tests are not independent (the pairs share currencies and their triggers overlap in time), and the correction assumes they are, so its verdict is optimistic.';
  // a survivor is set against how often pure noise has one (SC_NULL, measured), never shown as a green "found" box
  const verdict = nR ? ['meh', scNullTxt(nR, c.scH), `${nR} signal–pair record${nR > 1 ? 's pass' : ' passes'} the Benjamini–Hochberg correction at a 10% false-discovery rate. Scans of shuffled data, with no order at all, have survivors that often too. ${dep}`]
    : ['none', `No signal survives the multiple-testing correction · 0 of ${nT}`, `${edges} of ${nT} tests passed |t| > 2 and about ${exp.toFixed(1)} would by chance alone. None survives the Benjamini–Hochberg correction, so every "t > 2" below is most likely luck.`];
  const vLeg = ['robust', 'unst', 'edge', 'revsig', 'rev', 'noise', 'thin'].map(k => `<span class="sc-v ${SC_VCLS[k] || k}" tabindex="0"${tipAttr(scVtip(k, nT, exp))}>${SC_VLAB[k]}</span>`).join(' ');
  const net = r => r.dir === 2 || r.e.avgNet == null ? `<span class="muted"${tipAttr('No side|A range signal has no side to trade, so there is no spread to pay on it.')}>—</span>` : `${sgn(r.e.avgNet, 1)}${r.e.hitNet == null ? '' : ` <small class="muted">${r.e.hitNet.toFixed(0)}%</small>`}`;
  const row = r => {
    const [v, vl] = scVerdict(r.e), id = r.sym + '|' + r.s, on = LAB.open === id;
    return `<tr class="sc-r ${on ? 'on' : ''}" data-sc-open="${id}"><td class="mono">${pretty(r.sym)}</td><td${tipAttr(`${SC_SIG[r.s][0]}|${SC_SIG[r.s][1]}`)}>${SC_SIG[r.s][0]}${r.ago ? ` <small class="muted">${r.ago * 15}m ago</small>` : ''}</td><td>${r.dir === 2 ? '<span class="tag">either</span>' : `<span class="tag ${v === 'robust' ? (r.dir > 0 ? 'buy' : 'sell') : ''}">${r.dir > 0 ? 'buy' : 'sell'}</span>`}</td><td class="mono">${r.e.n}</td><td class="mono">${r.e.hit == null ? '—' : r.e.hit.toFixed(0) + '%'}${r.e.baseHit == null ? '' : ` <small class="muted">base ${r.e.baseHit.toFixed(0)}%</small>`}</td><td class="mono ${v === 'robust' ? cls(r.e.avg || 0) : ''}">${r.e.avg == null ? '—' : `${sgn(r.e.avg, 1)} <small class="muted">${sgn(pip(r.sym, r.e.avg), 1)}p</small>`}</td><td class="mono">${net(r)}</td><td class="mono">${r.e.t == null ? '—' : nfx(r.e.t, 1)}</td><td><span class="sc-v ${SC_VCLS[v] || v}"${tipAttr(`${scVtip(v, nT, exp)} ${r.e.stable ? 'Same sign in both halves of the week.' : 'Not stable across the two halves of the week.'}`)}>${vl}</span></td><td class="sc-act"><button class="link sc-more" data-sc-toggle="${id}" aria-expanded="${on}">${on ? '▴' : '▾'} Details</button><button class="link" data-sc-go="${r.sym}" data-sc-side="${v === 'robust' && r.dir !== 2 ? (r.dir > 0 ? 'buy' : 'sell') : ''}">Open chart</button></td></tr>${on ? `<tr class="sc-dr"><td colspan="10">${scDetail(r.sym, r.s, c.scH, v)}</td></tr>` : ''}`;
  };
  b.innerHTML = `<div class="dj-verdict ${verdict[0]} sc-verdict" tabindex="0"${tipAttr(`${verdict[1]}|${verdict[2]}`)}><b>${verdict[1]}</b><span>${span} · ${nR ? `${nR} of ${nT} tests survive the correction · ` : ''}${edges} passed |t| &gt; 2 · about ${exp.toFixed(1)} expected by luck</span></div>
  <div class="lab-intro"><p>Every scanner finds signals. This one also checks <b>whether each signal has actually paid on that pair</b>: it finds every past trigger in the last week of 15-minute bars, then measures the move ${LAB_HM(H)} later. Triggers never overlap, so the t-statistic is honest. A survivor is a hypothesis to test forward, not a signal.</p></div>
  <div class="sc-wrap"><div class="sc-live"><div class="sc-h"><b>${closed ? 'Signals at the close' : 'Live signals'}</b><span class="muted small">${closed ? `${rows.length} fired · ${atClose}` : `${rows.length} live now`} · ${c.scF === 'all' ? `all ${list.length} shown` : `${list.length} with t beyond ±2 shown`} · Details opens a signal's record</span></div>
    <div class="sc-vleg small">${vLeg}</div>
    ${list.length ? `<div class="bh-board-w"><table class="tbl sm sc-tbl"><thead><tr><th>Pair</th><th>Signal</th><th>Side</th><th${tipAttr('Cases|Past triggers of the signal on this pair in the last week of 15-minute bars, none overlapping.')}>Cases</th><th${tipAttr(`Hit|Share of the past triggers after which price had moved the signal's way ${LAB_HM(H)} later, beyond the usual move of that hour of the day. Base: the same share for every window starting at those hours, the hit to beat (not 50%). Before the spread.`)}>Hit</th><th${tipAttr(`Average move|The average move ${LAB_HM(H)} after a trigger, in the signal's direction and over the usual move of that hour of the day: in basis points of price and in pips of the pair. Before the spread.`)}>Avg</th><th${tipAttr(`After spread|The average move after paying the pair's normal spread once (in bp), and the share of triggers that still gained. A range signal has no side, so no spread is paid on it.`)}>After spread</th><th${tipAttr(`t statistic|The average divided by its standard error. Beyond ±2 a single test would rarely be chance; with ${nT} tests at once, about ${exp.toFixed(1)} pass by luck.`)}>t</th><th${tipAttr('Verdict|See the legend above: only Robust survives the correction for testing many signals.')}>Verdict</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${list.map(row).join('')}</tbody></table></div>` : `<div class="empty">${rows.length ? `${rows.length} signal${rows.length > 1 ? 's' : ''} ${closed ? 'fired on the last bar before the close' : rows.length > 1 ? 'are live' : 'is live'}, but none has a track record on its pair. <button class="link" data-k2="scF" data-val2="all">Show them anyway</button>` : closed ? `No signal fired on the last bar before the close (${scWhen(LAB.scan.lastT)}). The scan resumes when the market reopens.` : 'No signal is live right now. The scan refreshes every 15 minutes of sim time.'}</div>`}
  </div>
  <div class="sc-card"><div class="sc-h"><b>Signal report card</b><span class="muted small">the 16 G8 pairs pooled · ${LAB_HM(H)} horizon</span></div>
    <div class="bh-board-w"><table class="tbl sm sc-rc"><thead><tr><th class="l">Signal</th><th>Cases</th><th${tipAttr('Hit and base|Share of triggers that moved the signal\'s way, and the same share for every window starting at the same hours of the day: the hit to beat. Before the spread.')}>Hit <small class="muted">base</small></th><th>Avg bp</th><th>Pooled t</th><th>Pairs t &gt; 2</th></tr></thead><tbody>
    ${card.map(x => `<tr class="sc-rcr"><td class="l"><b>${SC_SIG[x.s][0]}</b><small class="muted">${SC_SIG[x.s][1]}</small></td><td class="mono">${x.n} <small class="muted">cases</small></td><td class="mono"${tipAttr('Hit and base|Share of triggers that moved the signal\'s way, and the same share for every window starting at the same hours of the day: the hit to beat. Before the spread.')}>${x.hit == null ? '—' : x.hit.toFixed(0) + '% hit'}${x.baseHit == null ? '' : ` <small class="muted">(base ${x.baseHit.toFixed(0)}%)</small>`}</td><td class="mono ${x.robust ? cls(x.avg || 0) : ''}">${x.avg == null ? '—' : sgn(x.avg, 2) + ' bp'}</td><td class="mono"${tipAttr(`Pooled t, clustered|Every trigger of the signal on all ${x.pairs} pairs as one test. Triggers that start in the same ${LAB_HM(H)} window on several pairs count as one cluster: the pairs share currencies (five carry the yen), so one market move on many pairs is not many pieces of evidence. Beyond ±2 the signal paid (or lost) across the board.`)}>${x.t == null ? '—' : nfx(x.t, 1)}</td><td class="mono ${x.robust ? 'up' : ''}"${tipAttr(`Pairs|On how many of the ${x.pairs} pairs the signal passed t > 2${x.revs ? ' or t < −2 (reversed)' : ''}; Robust ones also survive the correction.`)}>${x.edges}/${x.pairs}${x.robust ? ` <small>· <b>${x.robust} robust</b></small>` : ''}${x.revs ? ` <small class="muted">· ${x.revs} with t &lt; −2</small>` : ''}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small"><b>${LAB.scan.nFdr}</b> of ${LAB.scan.nTests} tests survive the Benjamini–Hochberg correction (false-discovery rate 10%). <b>Robust</b> = survives it, t &gt; 2, and the same sign in both halves of the week. ${dep}</p>
    <label class="tgl sc-al"><input type="checkbox" id="scAlert" ${c.scAlert ? 'checked' : ''}><span>Alert me when an FDR-significant signal fires</span></label>
    <p class="small muted">With ${nT} signal–pair test${nT === 1 ? '' : 's'} (8+ cases each) and nothing real behind them, about ${exp.toFixed(1)} would pass |t| &gt; 2 by chance. ${edges <= exp * 1.5 ? `${edges} passed here — in line with luck alone.` : `${edges} passed — above the chance count, but pairs share currencies so the tests are correlated and the excess can still be luck.`}</p>
  </div></div>`;
}

/* ---------------- 2. Range cone (session-aware volatility forecast) ---------------- */
const labMed = v => { const s = v.slice().sort((x, y) => x - y), h = s.length >> 1; return s.length ? (s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2) : 0; };
/* The seasonal profile: mean squared 1-minute return per 15-minute slot of the day. Returns across a closed market
   (gapRets) are left out, and each UTC hour is winsorised at 5 × its MAD, so one jump minute cannot make an hour busy.
   bars: an optional series in place of Engine.candles[sym] (tests). open(t): the instrument trades in minute t. */
function cnModel(sym, bars) {
  const a = bars || Engine.candles[sym], SL = 96, T = a.map(x => x.time), { r: r0, idx } = gapRets(T, a.map(x => x.close));
  const hourOf = i => Math.floor((((T[i] % 86400) + 86400) % 86400) / 3600), byH = Array.from({ length: 24 }, () => []);
  idx.forEach((i, k) => byH[hourOf(i)].push(r0[k]));
  const cap = byH.map(v => { const md = labMed(v), mad = labMed(v.map(x => Math.abs(x - md))); return [md - 5 * mad, md + 5 * mad]; });
  const sv = Array(SL).fill(0), ct = Array(SL).fill(0), r = Array(a.length).fill(null);
  idx.forEach((i, k) => { const c = cap[hourOf(i)], x = Math.min(c[1], Math.max(c[0], r0[k])), s = Math.floor((((T[i] % 86400) + 86400) % 86400) / 900); r[i] = x; sv[s] += x * x; ct[s]++; });
  const prof = sv.map((v, i) => ct[i] ? v / ct[i] : 0), all = mean(prof.filter(v => v > 0)) || 0;
  const slotVar = t => prof[Math.floor((((t % 86400) + 86400) % 86400) / 900)] || all;
  const open = bars || !Engine.META[sym] ? () => true : t => Engine.isOpen(sym, t);
  // the constant-volatility reference: the mean squared 1-minute return over the same week the profile uses
  let cs = 0, cn = 0; for (const x of r) if (x != null) { cs += x * x; cn++; }
  return { sym, a, T, r, prof, all, slotVar, open, cvar: cn ? cs / cn : 0 };
}
// the pace: realised variance of the last 120 min vs what the seasonal profile expected for those minutes (raw)
function cnRegimeRaw(M, end) { let real = 0, exp = 0; for (let i = Math.max(1, end - 120); i <= end; i++) { if (M.r[i] == null) continue; real += M.r[i] ** 2; exp += M.slotVar(M.T[i]); } return exp ? real / exp : 1; }
// regime factor the cone uses: the raw pace taken 60% of the way from normal, kept within 0.25–4×
function cnRegime(M, end) { const f = cnRegimeRaw(M, end); return Math.min(4, Math.max(.25, .6 * f + .4)); }
const CN_TAU = 360; // today's liveliness fades toward normal over ~6h of trading
/* [minutes ahead, variance, open minutes] every 15 minutes: the horizon is on the clock, variance arrives only in the
   minutes the instrument trades (a weekend or a CFD's daily pause adds none) */
function cnVarPath(M, t0, H, f) { const out = []; let v = 0, om = 0; for (let m = 1; m <= H; m++) { if (M.open(t0 + (m - 1) * 60)) { om++; v += (1 + (f - 1) * Math.exp(-om / CN_TAU)) * M.slotVar(t0 + m * 60); } if (m % 15 === 0 || m === H) out.push([m, v, om]); } return out; }
function cnCalib(M, H) {
  const a = M.a, n = a.length, res = { s68: 0, s95: 0, c68: 0, c95: 0, n: 0 }, U = [];
  let j = 0;
  for (let i = 240; i < n; i += 60) {
    // the realised price H minutes of the clock later (the bar in force then), as the cone promises it
    const tEnd = a[i].time + H * 60; if (tEnd > a[n - 1].time) break;
    if (j < i) j = i; while (j < n - 1 && a[j + 1].time <= tEnd) j++;
    // the constant-vol reference reads the same week as the session profile (M.cvar), so the two differ only in shape
    const f = cnRegime(M, i), last = cnVarPath(M, a[i].time, H, f).at(-1), vs = last[1], vc = M.cvar * last[2];
    if (!(vs > 0) || !(vc > 0)) continue; // a horizon with the market closed throughout: nothing to grade
    const z = Math.log(a[j].close / a[i].close), ss = Math.sqrt(vs), sc = Math.sqrt(vc);
    U.push(Math.abs(z) / ss);
    res.n++; if (Math.abs(z) <= ss) res.s68++; if (Math.abs(z) <= 1.96 * ss) res.s95++; if (Math.abs(z) <= sc) res.c68++; if (Math.abs(z) <= 1.96 * sc) res.c95++;
  }
  for (const k of ['s68', 's95', 'c68', 'c95']) res[k] = res.n ? res[k] / res.n * 100 : null;
  // conformal: band multipliers = empirical quantiles of |z|/σ. Honest check: fit on the first half, score the second.
  const h = Math.floor(U.length / 2), q68 = labQ(U.slice(0, h), .68), q95 = labQ(U.slice(0, h), .95), T = U.slice(h);
  res.k68 = labQ(U, .68) || 1; res.k95 = labQ(U, .95) || 1.96;
  res.f68 = T.length ? T.filter(u => u <= q68).length / T.length * 100 : null; res.f95 = T.length ? T.filter(u => u <= q95).length / T.length * 100 : null;
  return res;
}
/* The calibration verdict. The hourly forecasts overlap when the horizon is longer than an hour, so the independent
   windows are about n × 60 / H (n_eff). Under 20 there is no verdict; otherwise both bands must land within two
   binomial standard errors of 68% and 95% (at least ±4 and ±2 points). Returns [class, title, text, n_eff]. */
const CN_NEFF_MIN = 20;
function cnVerdict(cal, conf, H) {
  const i95 = conf ? cal.f95 : cal.s95, i68 = conf ? cal.f68 : cal.s68, n = conf ? Math.floor(cal.n / 2) : cal.n;
  if (i95 == null || i68 == null) return null;
  const ne = Math.floor(n * 60 / Math.max(60, H)), what = `${i95.toFixed(0)}% of prices ended inside the 95% band and ${i68.toFixed(0)}% inside the 68% one`, base = `n_eff ${ne}: about ${ne} independent ${LAB_HM(H)} windows${conf ? ' in the half of the week the conformal bands were scored on' : ''} (${n} hourly forecasts that overlap).`;
  if (ne < CN_NEFF_MIN) return ['none', 'Too few independent windows to grade', `${what}, but with ${base} Under ${CN_NEFF_MIN} that is too few to tell a calibrated cone from a lucky one.`, ne];
  const t95 = Math.max(2, 200 * Math.sqrt(.95 * .05 / ne)), t68 = Math.max(4, 200 * Math.sqrt(.68 * .32 / ne));
  const lo = i95 < 95 - t95 || i68 < 68 - t68, hi = i95 > 95 + t95 || i68 > 68 + t68, tol = `(within ±${t68.toFixed(0)} and ±${t95.toFixed(0)} points counts as on target, two standard errors at ${base}`;
  if (lo && hi) return ['none', 'Off target last week', `${what}: one band ran too narrow and the other too wide ${tol})`, ne];
  if (lo) return ['none', 'Too narrow last week', `${what}: real moves ran wider than this cone promises ${tol}) Treat its edges as soft.`, ne];
  if (hi) return ['none', 'Too wide last week', `${what}: the cone overstates the risk ${tol}) Its edges are conservative.`, ne];
  return ['ok', 'Well calibrated last week', `${what}, close to 68% and 95% ${tol})`, ne];
}
/* The ticket levels from the cone, for the ticket's side: the stop fires just outside the 68% band, the target at the
   95% edge, never closer than the stop (R:R at least 1). A buy enters at the ask and exits on the bid, a sell enters at
   the bid and exits on the ask (bid + spread): the distances are set so the exit fires when the BID reaches the band.
   Returns pips (points on a CFD) from the entry, rounded outward for the stop. */
function cnLevels(px, sH, K68, K95, sym, side) {
  const q = Engine.quote(sym), m = M(sym), sp = q.ask - q.bid, buy = side !== 'sell';
  const lo68 = px * Math.exp(-K68 * sH), hi68 = px * Math.exp(K68 * sH), lo95 = px * Math.exp(-K95 * sH), hi95 = px * Math.exp(K95 * sH);
  const st = buy ? q.ask - lo68 : hi68 + sp - q.bid, tg = buy ? hi95 - q.ask : q.bid - lo95 - sp;
  const stop = Math.max(.1, Math.ceil(st / m.pip * 10 - 1e-9) / 10), tp = Math.max(stop, Math.floor(tg / m.pip * 10 + 1e-9) / 10);
  return { stop, tp, rr: tp / stop, side: buy ? 'buy' : 'sell' };
}
/* Pending limits at the band edges, never sent: a buy limit below (it fills when the ASK falls to its price, so the
   price is the bid edge plus the spread), a sell limit above (it fills when the BID rises to it: the edge itself). */
function cnPending(px, sH, K68, K95, sym) {
  const q = Engine.quote(sym), sp = q.ask - q.bid, dg = M(sym).digits, rd = v => +v.toFixed(dg), out = [];
  for (const [band, k] of [[68, K68], [95, K95]]) {
    const lo = px * Math.exp(-k * sH), hi = px * Math.exp(k * sH);
    out.push({ side: 'buy', band, edge: lo, px: rd(lo + sp) }, { side: 'sell', band, edge: hi, px: rd(hi) });
  }
  return out;
}
// loads a pending limit into the ticket (side, type, price) and sends nothing
function cnLoadOrder(side, band, px) {
  const sym = S.set.sym; if (!(px > 0) || !M(sym)) return;
  S.tk.side = side === 'sell' ? 'sell' : 'buy'; S.tk.ot = 'limit'; S.tk.price = px;
  save(); syncTicketInputs(); renderTicket();
  toast(`${S.tk.side === 'buy' ? 'Buy' : 'Sell'} limit loaded — review, then submit`, `${pretty(sym)} at ${fp(sym, px)}, the ${band}% cone's ${S.tk.side === 'buy' ? 'lower' : 'upper'} edge. Nothing was sent.`, 'info');
}
// the σ scale of the odds: conformal odds are read on the normal that matches the 95% band (k95 = 1.96 σ'), the band
// the stops and targets are set against; the session model is the normal itself
const cnScale = (cal, conf) => conf && cal && cal.k95 > 0 ? cal.k95 / 1.96 : 1;
// chance (%) that price is beyond level lv at the horizon
const cnBeyond = (lv, px, sH, sc) => { const z = Math.log(lv / px) / (sH * sc); return (z > 0 ? 1 - labNcdf(z) : labNcdf(z)) * 100; };
function drawCone(b, c) {
  labCfg(c);
  const sym = S.set.sym, m = Engine.META[sym], H = c.cnH, un = unitWord(sym), unS = un === 'pt' ? ' pt' : 'p';
  const intro = `<div class="lab-intro"><p>Where is ${pretty(sym)} likely to be in ${LAB_HM(H)}? The cone follows the market's own intraday rhythm — it widens faster through the London and New York sessions — and is scaled by how lively the last two hours were. Below, it is graded against a plain constant-volatility cone on the past week.</p></div>`;
  // a closed market does not move: no cone until it reopens
  const ms = mktState(sym);
  if (!ms.open) { b.innerHTML = intro + `<div class="dj-verdict none cn-verdict" tabindex="0"${tipAttr(`${ms.label}|While the market is closed the price cannot move, so there is nothing to forecast. The cone returns when it reopens.`)}><b>${ms.label}</b><span>No cone while ${pretty(sym)} is closed: price does not move until it reopens.</span></div>`; return; }
  const mk = `${sym}|${Math.floor(Engine.simTime / 60)}`; if (LAB.cnMk !== mk) { LAB.cnM = cnModel(sym); LAB.cnMk = mk; }
  const M = LAB.cnM, a = M.a, end = a.length - 1, px = a[end].close, t0 = a[end].time;
  const f = cnRegime(M, end), fRaw = cnRegimeRaw(M, end), path = cnVarPath(M, t0, H, f), vH = path.at(-1)[1], sH = Math.sqrt(vH), cv = M.cvar;
  const ck = `${sym}|${H}|${Math.floor(Engine.simTime / 3600)}`; if (LAB.coneKey !== ck) { LAB.cone = cnCalib(M, H); LAB.coneKey = ck; }
  const cal = LAB.cone, conf = c.cnMode === 'conf', K68 = conf ? cal.k68 : 1, K95 = conf ? cal.k95 : 1.96, pipsOf = x => x / m.pip, lvl = k => px * Math.exp(k * sH);
  /* SVG in pixels of its box (text is never stretched). The history before "now" covers about 1.2 × the horizon, in
     bars fine enough for it (1, 5 or 15 minutes), so both sides of "now" run at about the same minutes per pixel. */
  const tf = H <= 60 ? 1 : H <= 480 ? 5 : 15, histMin0 = Math.round(H * 1.2), W = Math.max(560, Math.min(1400, Math.round((b.clientWidth || 778) - 18))), Hh = 260, padR = 64;
  const hist = Engine.aggregate(sym, tf, Math.ceil(histMin0 / tf) + 1).map(k => [k.time, k.close]), histMin = Math.max(tf, (t0 - hist[0][0]) / 60);
  const histW = Math.round((W - padR) * Math.min(.7, Math.max(.3, histMin / (histMin + H))));
  LAB.cnGeo = { W, padR, histW, histMin };
  const tk = typeof tkCalc === 'function' ? tkCalc() : null, open = S.positions.filter(p => p.sym === sym);
  const lines = [];
  if (tk && tk.sl != null) lines.push(['Ticket SL', tk.sl, 'dn']); if (tk && tk.tp != null) lines.push(['Ticket TP', tk.tp, 'up']);
  for (const p of open) { if (p.sl != null) lines.push([`#${p.id} SL`, p.sl, 'dn']); if (p.tp != null) lines.push([`#${p.id} TP`, p.tp, 'up']); }
  // the scale holds the history, the cone and every level within 4× the outer cone (a level further out is named at the edge)
  const near = v => Math.abs(Math.log(v / px)) <= K95 * sH * 4, ys = [...hist.map(h => h[1]), lvl(K95 * 1.12), lvl(-K95 * 1.12), ...lines.map(l => l[1]).filter(near)];
  const ymin = Math.min(...ys), ymax = Math.max(...ys), Y = v => 12 + (ymax - v) / (ymax - ymin || 1) * (Hh - 34);
  // history by bar, not by clock: a closed market (a gap over 3 hours) leaves no line across it, only a mark
  const nh = hist.length, Xh = i => i / Math.max(1, nh - 1) * histW, Xf = mm => histW + mm / H * (W - padR - histW), gaps = [];
  for (let i = 1; i < nh; i++) if (hist[i][0] - hist[i - 1][0] > 3 * 3600) gaps.push(i);
  const yst = (() => { const st = niceStep((ymax - ymin) / 5), out = []; for (let v = Math.ceil(ymin / st) * st; v <= ymax; v += st) out.push(v); return out; })();
  const band = (k, cvar) => { const up = path.map(([mm, v, om]) => `${Xf(mm).toFixed(1)},${Y(px * Math.exp(k * Math.sqrt(cvar ? cv * om : v))).toFixed(1)}`), dn = path.map(([mm, v, om]) => `${Xf(mm).toFixed(1)},${Y(px * Math.exp(-k * Math.sqrt(cvar ? cv * om : v))).toFixed(1)}`).reverse(); return `${histW},${Y(px)} ${up.join(' ')} ${dn.join(' ')}`; };
  const lineC = (k, cvar) => `M${histW},${Y(px)} ` + path.map(([mm, v, om]) => `L${Xf(mm).toFixed(1)},${Y(px * Math.exp(k * Math.sqrt(cvar ? cv * om : v))).toFixed(1)}`).join(' ');
  const fx = v => v.toFixed(m.digits);
  const sc = cnScale(cal, conf), probBeyond = lv => cnBeyond(lv, px, sH, sc), seed = labSeed(`${sym}|${H}|${Math.floor(Engine.simTime / 900)}`);
  const touch = cnTouch(path, sc, lines.map(l => Math.log(l[1] / px)), seed), fst = tk && tk.sl != null && tk.tp != null ? cnFirst(path, sc, Math.log(tk.tp / px), Math.log(tk.sl / px), seed) : null;
  // when in the horizon does variance arrive? find steepest hour
  let best = 0, bm = 0; for (let i = 4; i < path.length; i++) { const d = path[i][1] - path[i - 4][1]; if (d > best) { best = d; bm = path[i][0]; } }
  // hour marks on the forecast axis, none crowding the "now" label
  const tst = H <= 240 ? 60 : H <= 480 ? 120 : 240, ticks = []; for (let mm = tst; mm <= H; mm += tst) if (Xf(mm) - histW >= 40) ticks.push(mm);
  // level labels sit inside the plot, right-aligned above their line, clear of the price axis
  const lvLab = ([l, v, k]) => near(v) ? `<line x1="${histW}" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="cn-lv ${k}"/><text x="${W - padR - 4}" y="${Y(v) - 3}" text-anchor="end" class="cn-ax cn-lvt ${k}">${l.replace('Ticket ', '')}</text>` : `<text x="${W - padR - 4}" y="${v > px ? 22 : Hh - 26}" text-anchor="end" class="cn-ax cn-lvt ${k}">${l.replace('Ticket ', '')} ${v > px ? '↑' : '↓'} ${fx(v)} (off the scale)</text>`;
  const vd = cnVerdict(cal, conf, H), side = S.tk && S.tk.side === 'sell' ? 'sell' : 'buy', lv = cnLevels(px, sH, K68, K95, sym, side);
  const pend = cnPending(px, sH, K68, K95, sym), pendTip = o => `${o.side === 'buy' ? 'Buy' : 'Sell'} limit at the ${o.band}% cone's ${o.side === 'buy' ? 'lower' : 'upper'} edge|${o.side === 'buy' ? `A buy limit fills when the ask falls to ${fx(o.px)}: the bid at the band's edge (${fx(o.edge)}) plus the current spread.` : `A sell limit fills when the bid rises to ${fx(o.px)}, the band's edge (the cone is drawn on the bid).`} Price ends beyond this edge about one time in ${o.band === 68 ? 6 : 40} over ${LAB_HM(H)} and touches it more often (see Touched). The button loads side, type and price into the ticket and sends nothing: review the size, stop and target, then submit.`;
  const hitCls = (v, want, tol) => v != null && Math.abs(v - want) < tol ? 'cn-hit' : '';
  b.innerHTML = intro + `
  <div class="obs-kpis">${kpi('68% range', `${fx(lvl(-K68))} – ${fx(lvl(K68))}`, '', 'Inner cone, 68%|About two times in three, price should be inside this range at the end of the horizon.')}${kpi('95% range', `${fx(lvl(-K95))} – ${fx(lvl(K95))} <small>±${pipsOf(px * (Math.exp(K95 * sH) - 1)).toFixed(1)}${unS}</small>`, '', 'Outer cone, 95%|About 19 times in 20, price should be inside this range at the end of the horizon. A target beyond it is unlikely in this time.')}${kpi('68% move', `±${pipsOf(px * (Math.exp(K68 * sH) - 1)).toFixed(1)} ${un}`, '', 'Typical move|Half the width of the inner cone: the move to expect in either direction over the horizon.')}${kpi('Regime', `${f.toFixed(2)}× normal`, f > 1.3 ? 'wn' : f < .8 ? 'info' : '', `Pace|The cone is scaled by ${f.toFixed(2)}×: the last 2 hours moved ${fRaw.toFixed(2)}× what this time of day usually moves, taken 60% of the way from normal (and kept within 0.25–4×), and the effect fades toward 1× over about 6 hours of trading. Above 1.3× busy, below 0.8× quiet.`)}</div>
  <div class="cn-svg"><svg id="cnSvg" viewBox="0 0 ${W} ${Hh}" style="height:auto" role="img" aria-label="Forecast cone">
    ${yst.map(v => `<line x1="0" x2="${W - padR}" y1="${Y(v)}" y2="${Y(v)}" class="cn-grid"/><text x="${W - padR + 6}" y="${Y(v) + 4}" class="cn-ax">${fx(v)}</text>`).join('')}
    ${gaps.map(i => `<line x1="${Xh(i - .5)}" x2="${Xh(i - .5)}" y1="6" y2="${Hh - 20}" class="cn-gap"/><text x="${Xh(i - .5) + 3}" y="${Hh - 6}" class="cn-ax">closed</text>`).join('')}
    <polygon points="${band(K95)}" class="cn-b95"/><polygon points="${band(K68)}" class="cn-b68"/>
    <path d="${lineC(1.96, true)}" class="cn-cv"/><path d="${lineC(-1.96, true)}" class="cn-cv"/>
    ${[0, ...gaps, nh].slice(0, -1).map((g, k) => `<polyline points="${hist.slice(g, [...gaps, nh][k]).map((h, j) => `${Xh(g + j).toFixed(1)},${Y(h[1]).toFixed(1)}`).join(' ')}" class="cn-px"/>`).join('')}
    <rect x="${W - padR + 2}" y="${Y(px) - 8}" width="${padR - 4}" height="16" rx="3" class="cn-nowl"/><text x="${W - padR + 6}" y="${Y(px) + 4}" class="cn-ax cn-nowt">${fx(px)}</text>
    <line x1="${histW}" x2="${histW}" y1="6" y2="${Hh - 20}" class="cn-now"/><text x="${histW + 4}" y="${Hh - 6}" class="cn-ax">now</text>
    <text x="4" y="${Hh - 6}" class="cn-ax">−${LAB_HM(histMin)}</text>
    ${ticks.map(mm => `<text x="${Xf(mm)}" y="${Hh - 6}" class="cn-ax" text-anchor="middle">+${LAB_HM(mm)}</text>`).join('')}
    ${lines.map(lvLab).join('')}
  </svg><div class="cn-leg small"><span><i class="b68"></i>68%</span><span><i class="b95"></i>95%</span><span><i class="cv"></i>constant-vol 95%</span>${bm ? `<span class="muted">fastest widening around +${LAB_HM(bm)} (${new Date((t0 + bm * 60) * 1000).toISOString().slice(11, 16)} UTC)</span>` : ''}</div></div>
  <div class="cn-row">
    <div class="bh-card"><h3>Did the cone keep its promise?</h3>
      ${vd ? `<div class="dj-verdict ${vd[0]} cn-verdict" tabindex="0"${tipAttr(`${vd[1]}|${vd[2]}`)}><b>${vd[1]}</b><span>${conf ? 'conformal' : 'session'} cone · ${(conf ? cal.f95 : cal.s95).toFixed(0)}% inside its 95% band, ${(conf ? cal.f68 : cal.s68).toFixed(0)}% inside 68% · n_eff ${vd[3]}</span></div>` : ''}
      <table class="tbl sm"><thead><tr><th>Model</th><th>Inside 68%</th><th>Inside 95%</th></tr></thead><tbody>
      <tr><td>Session-aware (this cone)</td><td class="mono ${hitCls(cal.s68, 68, 6)}">${cal.s68?.toFixed(0) ?? '—'}%</td><td class="mono ${hitCls(cal.s95, 95, 3)}">${cal.s95?.toFixed(0) ?? '—'}%</td></tr>
      <tr><td>Conformal bands <small class="muted">fit on first half, scored on second</small></td><td class="mono ${hitCls(cal.f68, 68, 6)}">${cal.f68?.toFixed(0) ?? '—'}%</td><td class="mono ${hitCls(cal.f95, 95, 3)}">${cal.f95?.toFixed(0) ?? '—'}%</td></tr>
      <tr><td${tipAttr('Constant volatility|A cone that widens at the same speed at every hour, from the average 1-minute variance of the same week the session model reads: the two differ only in shape.')}>Constant volatility</td><td class="mono ${hitCls(cal.c68, 68, 6)}">${cal.c68?.toFixed(0) ?? '—'}%</td><td class="mono ${hitCls(cal.c95, 95, 3)}">${cal.c95?.toFixed(0) ?? '—'}%</td></tr></tbody></table>
      <p class="small">${conf ? `Showing <b>conformal</b> bands: the 68% and 95% edges sit at ${cal.k68.toFixed(2)}σ and ${cal.k95.toFixed(2)}σ, the multiples that held last week (a normal curve would say 1.00 and 1.96); a past frequency, not a guarantee.` : 'Showing the session-model bands at 1σ and 1.96σ.'}</p><p class="small">${(() => { const e = (a2, b2) => Math.abs(a2 - 68) + Math.abs(b2 - 95), em = e(cal.s68, cal.s95), ec = e(cal.f68, cal.f95); return ec < em ? 'Out of sample, the <b>conformal</b> bands held closer to target this week.' : `Out of sample, the conformal bands drifted to ${cal.f68?.toFixed(0)}% / ${cal.f95?.toFixed(0)}% — volatility changed between the two halves of the week, so the <b>session model</b> held closer this time.`; })()}${vd && vd[3] < CN_NEFF_MIN ? ' With so few independent windows, the difference can be luck.' : ''}</p><p class="small muted">${cal.n} hourly forecasts over the past week, ${LAB_HM(H)} ahead; they overlap, so about ${vd ? vd[3] : '—'} are independent. A well-calibrated cone lands near 68% and 95%. The seasonal profile uses the whole week, so this check is slightly optimistic.</p></div>
    <div class="bh-card"><h3>Your levels against the cone</h3>
      ${lines.length ? `<table class="tbl sm"><thead><tr><th>Level</th><th>Price</th><th>Distance</th><th${tipAttr('Beyond at end|Chance price is beyond this level at the end of the horizon.')}>Beyond at end</th><th${tipAttr('Touched|Chance price touches this level at any point before the horizon.')}>Touched</th></tr></thead><tbody>${lines.map(([l, v], i) => `<tr><td>${l}</td><td class="mono">${fx(v)}</td><td class="mono">${nfx(Math.log(v / px) / (sH * sc), 2)}σ</td><td class="mono">${probBeyond(v).toFixed(0)}%</td><td class="mono"><b>${touch[i].toFixed(0)}%</b></td></tr>`).join('')}</tbody></table>
      ${fst ? `<p class="small">Within ${LAB_HM(H)}: ticket TP first <b>${fst[0].toFixed(0)}%</b>, SL first <b>${fst[1].toFixed(0)}%</b>, neither yet <b>${fst[2].toFixed(0)}%</b>.</p>${fst[2] > 50 ? `<p class="cn-note">In ${LAB_HM(H)} your current stop and target will most likely not be reached (${fst[2].toFixed(0)}%): the trade would still be open at the horizon.</p>` : ''}` : ''}
      <p class="small muted">"Touched" comes from 4,000 random paths that follow the cone's own variance, with a Brownian-bridge correction between 15-minute steps. The draws are fixed for each 15-minute bar, so the odds change with the price, not with a new random draw; a level fixed in price can still move by a point or two as the price ticks.</p>` : '<p class="small muted">Set a stop or target in the order ticket, or open a position on this pair, and its odds appear here.</p>'}
      <div class="cn-act"><button class="ghost sm" data-cn-stop="${lv.stop.toFixed(1)}"${tipAttr(`Set the ticket stop|For a ${lv.side} (the ticket's side): the stop fires when the bid reaches just outside the 68% cone${lv.side === 'sell' ? ' (a sell exits on the ask, so the spread is added)' : ' (the buy entered at the ask, so the spread is added)'}. A move that far happens about one time in three over ${LAB_HM(H)}.`)}>Set ticket stop: ${lv.stop.toFixed(1)} ${un} (outside 68%)</button><button class="ghost sm" data-cn-tp="${lv.tp.toFixed(1)}"${tipAttr(`Set the ticket target|For a ${lv.side}: the target fires when the bid reaches the edge of the 95% cone, after the spread, and never closer than the stop (reward at least the risk). Ending beyond that edge happens about one time in 40 on that side; touching it on the way is more frequent (see Touched).`)}>Set ticket target: ${lv.tp.toFixed(1)} ${un} (95% edge) · R:R 1:${lv.rr.toFixed(1)}</button></div>
      <div class="cn-act cn-pend"><span class="small muted">Pending at the cone's edges:</span>${pend.map(o => `<button class="ghost sm" data-cn-ord="${o.side}|${o.band}" data-cn-px="${o.px}"${tipAttr(pendTip(o))}>${o.side === 'buy' ? 'Buy' : 'Sell'} limit ${fx(o.px)} <small>(${o.band}% ${o.side === 'buy' ? 'low' : 'high'})</small></button>`).join('')}</div>
    </div></div>`;
  const svgEl = $('#cnSvg'); if (svgEl) cnHover(svgEl, { W, padR, histW, H, path, px, t0, K68, K95, pip: m.pip, un, fx, hist });
}

// the readout under the pointer: the bands at a future time, or the price at a past bar
function cnHover(svg, d) {
  svg.onmousemove = e => {
    const r = svg.getBoundingClientRect(), x = (e.clientX - r.left) / r.width * d.W;
    if (x >= d.histW && x <= d.W - d.padR) {
      const mm = (x - d.histW) / (d.W - d.padR - d.histW) * d.H, pt = d.path.reduce((a, q) => Math.abs(q[0] - mm) < Math.abs(a[0] - mm) ? q : a, d.path[0]), s1 = Math.sqrt(pt[1]);
      const band = k => [d.px * Math.exp(-k * s1), d.px * Math.exp(k * s1)], b68 = band(d.K68), b95 = band(d.K95), pip = v => ((v - d.px) / d.pip).toFixed(1);
      return cvTip(e, `+${LAB_HM(pt[0])} · ${new Date((d.t0 + pt[0] * 60) * 1000).toISOString().slice(11, 16)} UTC`, [`68%: ${d.fx(b68[0])} – ${d.fx(b68[1])} (±${pip(b68[1])} ${d.un})`, `95%: ${d.fx(b95[0])} – ${d.fx(b95[1])} (±${pip(b95[1])} ${d.un})`, 'Where price should be at this time, with these odds']);
    }
    if (x < d.histW) { const i = Math.round(x / d.histW * (d.hist.length - 1)), h = d.hist[Math.max(0, Math.min(d.hist.length - 1, i))]; return cvTip(e, `${dts(h[0])} UTC`, [`${d.fx(h[1])} · ${((h[1] - d.px) / d.pip >= 0 ? '+' : '') + ((h[1] - d.px) / d.pip).toFixed(1)} ${d.un} from now`]); }
    brTipHide();
  };
  svg.onmouseleave = brTipHide;
}
/* Monte Carlo on the cone's own variance path; Brownian-bridge crossing probability between 15-minute steps.
   seed: the draws are seeded (pair and 15-minute bar), so "Touched" holds still between ticks instead of jumping
   with a fresh random sample on every redraw. */
function cnPaths(path, sc, N, fn, rnd) {
  const dv = path.map((p, i) => (p[1] - (i ? path[i - 1][1] : 0)) * sc * sc), g = labGauss(rnd);
  for (let k = 0; k < N; k++) { let x = 0; for (let i = 0; i < dv.length; i++) { const x1 = x + Math.sqrt(dv[i]) * g(); if (fn(k, x, x1, dv[i]) === false) break; x = x1; } }
}
// standard normal draws from a uniform generator (Box–Muller, both values used)
function labGauss(rnd) { let spare = null; return () => { if (spare != null) { const v = spare; spare = null; return v; } let u = 0; while (!u) u = rnd(); const v = rnd(), r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v); }; }
const cnCross = (x, x1, b, dv, rnd) => (b > 0 ? (x >= b || x1 >= b) : (x <= b || x1 <= b)) || rnd() < Math.exp(-2 * (b - x) * (b - x1) / Math.max(dv, 1e-18));
function cnTouch(path, sc, bs, seed = 1) {
  if (!bs.length) return []; const N = 4000, hit = bs.map(() => 0), got = bs.map(() => new Uint8Array(N)), rnd = labRng(seed);
  cnPaths(path, sc, N, (k, x, x1, dv) => { bs.forEach((b, j) => { if (!got[j][k] && cnCross(x, x1, b, dv, rnd)) { got[j][k] = 1; hit[j]++; } }); }, rnd);
  return hit.map(h => h / N * 100);
}
function cnFirst(path, sc, bt, bsl, seed = 1) {
  const N = 4000, rnd = labRng(seed); let tp = 0, sl = 0;
  cnPaths(path, sc, N, (k, x, x1, dv) => { if (cnCross(x, x1, bsl, dv, rnd)) { sl++; return false; } if (cnCross(x, x1, bt, dv, rnd)) { tp++; return false; } }, rnd);
  return [tp / N * 100, sl / N * 100, (N - tp - sl) / N * 100];
}

/* ---------------- 3. Exit lab (counterfactual exits) ---------------- */
const EX_POL = [
  ['actual', 'Your exits', 'What you actually did'],
  ['t1', 'Target 1R', 'Stop 1R, take profit at 1R'],
  ['t2', 'Target 2R', 'Stop 1R, take profit at 2R'],
  ['t3', 'Target 3R', 'Stop 1R, take profit at 3R'],
  ['trail', 'Trail 1R', 'Stop follows the best price at 1R distance'],
  ['be', 'Break-even + 3R', 'Stop to entry after +1R, target 3R'],
  ['ts1', 'Time stop 1h', 'Stop 1R, otherwise exit after 1 hour'],
  ['ts4', 'Time stop 4h', 'Stop 1R, otherwise exit after 4 hours'],
  ['hold', 'Hold 24h', 'Stop 1R, otherwise exit after 24 hours']
];
/* One exit rule replayed from bar i0. The bars are bids: a buy exits on them, a sell on the ask (bid + sp). Time stops
   and the 24h hold count minutes of open market (a weekend or a CFD's daily pause adds one bar, not its clock time);
   a stop gapped through at the reopening fills at the opening price. m: open minutes held. */
function exSim(a, i0, side, entry, R, pol, sm = 1, tm, sp = 0) {
  const d = side === 'buy' ? 1 : -1, maxM = { ts1: 60, ts4: 240 }[pol] || 1440, q = d > 0 ? 0 : sp;
  let stop = entry - d * R * sm, best = entry, moved = false, om = 0, i = i0; const tgt = tm !== undefined ? tm : { t1: 1, t2: 2, t3: 3, be: 3 }[pol];
  for (; i < a.length; i++) {
    const gap = i > i0 && a[i].time - a[i - 1].time > GAP_S;
    if (i > i0) om += gap ? 1 : (a[i].time - a[i - 1].time) / 60; // the minutes of the bars before this one
    if (om >= maxM) break;
    const k = a[i], adv = (d > 0 ? k.low : k.high) + q, fav = (d > 0 ? k.high : k.low) + q;
    if (d * (adv - stop) <= 0) return { x: gap && d * (k.open + q - stop) < 0 ? k.open + q : stop, m: om };
    if (tgt && d * (fav - (entry + d * tgt * R)) >= 0) return { x: entry + d * tgt * R, m: om };
    if (d * (fav - best) > 0) best = fav;
    if (pol === 'trail') stop = trailNext(d, stop, best, R * sm); // the live rule (trade.js): stop from entry ∓ R, follows the best price
    if (pol === 'be' && !moved && d * (best - entry) >= R) { stop = entry; moved = true; }
  }
  // the close of the last minute inside the window; past the end of the data the horizon is not reached: marked to market
  const j = Math.max(i0, i - 1);
  return { x: a[j].close + q, m: om, live: i >= a.length };
}
// 1.5 × the 15-minute volatility from the 240 one-minute returns up to bar i (none across a closed market), in price
function exVolR(a, i, px) { let rv = 0, k = 0; for (let j = i; j > 0 && k < 240; j--) if (a[j].time - a[j - 1].time <= GAP_S) { rv += Math.log(a[j].close / a[j - 1].close) ** 2; k++; } return k ? px * Math.sqrt(rv / k * 15) * 1.5 : 0; }
// the volatility stop on a pair now, in the ticket's unit (pips, or points on a CFD)
function exVolStopPips(sym) { const a = Engine.candles[sym], m = M(sym); if (!a || a.length < 30 || !m) return 0; const e = a.length - 1; return Math.round(exVolR(a, e, a[e].close) / m.pip * 10) / 10; }
// the instrument's spread in price: default, and the widest it quotes (news, plus the crypto variation)
const exSpread = m => m.p ? m.p.spread[0] * m.point : (m.spread || 0) * m.pip;
const exSpreadMax = m => m.p ? (m.p.spread[2] + (m.p.jit ? Math.max(0, ...m.p.jit.map(j => j[1])) : 0)) * m.point : (m.spread || 0) * m.pip * 3;
// the replay reads the most recent EX_CAP trades (the journal keeps the newest first)
const EX_CAP = 200;
// one entry per position (partial closes merged, the NBP credit left out): each one is one entry decision to replay
const exEligible = () => tradesOf(S.history).filter(h => h.open && h.close && Engine.META[h.sym]);
function exTrades(useSample) {
  if (useSample) return LAB.sample || [];
  return exEligible().slice(0, EX_CAP);
}
/* How a trade actually ended, from its close reason (the last part's): the stop moved to entry and the trailing stop
   are their own types, a basket's stop, target and trail count with the single-trade ones, everything closed by hand
   (Manual, Close, Reversed, a basket closed by hand) is Manual. */
const EX_KIND = [['manual', 'Manual'], ['sl', 'Stop loss'], ['tp', 'Take profit'], ['trail', 'Trail'], ['be', 'Break-even'], ['time', 'Time stop'], ['so', 'Stop-out']];
function exKind(reason) {
  const r = String(reason || '');
  if (/^Stop-out/.test(r)) return 'so';
  if (/break-even/i.test(r)) return 'be';
  if (/trail/i.test(r)) return 'trail';
  if (/^(Stop loss|Basket stop)/.test(r)) return 'sl';
  if (/^(Take profit|Basket target)/.test(r)) return 'tp';
  if (r === 'Time stop') return 'time';
  return 'manual';
}
// the replayed trades by exit type: n, total and average R, win rate (yours), and the rule k's total on the same trades
const EX_KIND_MIN = 3;
function exByKind(per, k) {
  return EX_KIND.map(([kind, name]) => {
    const a = per.filter(x => exKind(x.h.reason) === kind), n = a.length, sum = a.reduce((s2, x) => s2 + x.act, 0);
    return { kind, name, n, sum, avg: n ? sum / n : 0, win: n ? a.filter(x => x.act > 0).length / n * 100 : 0, alt: a.reduce((s2, x) => s2 + (x.alt[k] || 0), 0) };
  }).filter(g => g.n);
}
function exMakeSample() {
  const out = []; let id = 1;
  for (let k = 0; k < 40; k++) {
    const p = Engine.PAIRS[Math.floor(Math.random() * Engine.PAIRS.length)], a = Engine.candles[p.sym], i = 300 + Math.floor(Math.random() * (a.length - 2000));
    const side = Math.random() < .5 ? 'buy' : 'sell', d = side === 'buy' ? 1 : -1, sp = exSpread(p), q = d > 0 ? 0 : sp, entry = a[i].close + (d > 0 ? sp : 0);
    // the volatility stop, but never inside 4 spreads: nobody trades a stop narrower than the cost of the round trip
    const R = Math.max(exVolR(a, i, a[i].close), 4 * sp);
    /* a typical impatient exit: take small wins fast, let losses run to the stop. Both close at the minute's close (a buy
       on the bid, a sell on the ask), the loss too: booking it at exactly −1R when the close is already beyond the stop
       would hand the sample a small edge it does not have. Zero edge by construction: its result is the costs. */
    let x = null, t = a[i].time; for (let j = i + 1; j < Math.min(a.length, i + 1440); j++) { const mv = d * (a[j].close + q - entry); if (mv >= .6 * R || mv <= -R) { x = a[j].close + q; t = a[j].time; break; } }
    if (x == null) continue;
    const pips = d * (x - entry) / p.pip; out.push({ riskUsd: 100, id: id++, sym: p.sym, side, lots: 1, entry, exit: x, open: a[i].time + 59, close: t, pips, pnl: d * (x - entry) / R * 100, sl0: entry - d * R, sample: true });
  }
  return out;
}
const EX_SM = [.5, 1, 1.5, 2], EX_TM = [1, 1.5, 2, 3, null];
// walk-forward: an older half of at least 4 trades to choose the rule on, a newer half of at least 4 to test it
const EX_WF_MIN = 8;
// the rules the order ticket can place exactly (Use): stop + target (× R), the trailing stop, break-even + target
const EX_USE = { t1: 1, t2: 2, t3: 3, trail: 0, be: 3 };
function exRun(T, rMode) {
  const res = Object.fromEntries(EX_POL.map(([k]) => [k, []])), used = [], eff = [], per = [], grid = EX_SM.map(() => EX_TM.map(() => 0)), skip = { hist: 0, off: 0, short: 0 }, liveSyms = new Set(); let live = 0;
  for (const h of T) {
    const a = Engine.candles[h.sym], m = Engine.META[h.sym]; if (!a.length || h.open < a[0].time) { skip.hist++; continue; }
    let i0 = a.length - 1; while (i0 > 0 && a[i0 - 1].time >= h.open) i0--; if (i0 < 241) { skip.hist++; continue; }
    const d = h.side === 'buy' ? 1 : -1, sp = exSpread(m);
    const volR = exVolR(a, i0, h.entry);
    const fromStop = rMode === 'stop' && h.sl0 != null && Math.abs(h.entry - h.sl0) > 0, R = fromStop ? Math.abs(h.entry - h.sl0) : volR;
    if (a[a.length - 1].time - a[i0].time < 900) { skip.short++; continue; } // need 15 minutes of path
    /* the trade's own entry and exit must lie on this price history: a buy fills at the ask (bid bars + spread), a sell
       at the bid, the exit the other way round; slack = the widest spread + the maximum deviation of a fill + a
       quarter of the volatility stop (at least 2 pips). Further out, the trade happened on another price path. */
    const ie = a[i0].time > h.open ? Math.max(0, i0 - 1) : i0;
    let j1 = i0; while (j1 < a.length - 1 && a[j1 + 1].time <= h.close) j1++;
    const tol = exSpreadMax(m) + (m.p ? m.p.maxDev * m.point : 0) + Math.max(2 * m.pip, volR * .25);
    // the bars around the fill and the close before them (a stop gapped through at a reopening lies between the two)
    const onPath = (k0, k1, v, ask) => { let lo = a[Math.max(0, k0 - 1)].close, hi = lo; for (let k = k0; k <= k1; k++) { lo = Math.min(lo, a[k].low); hi = Math.max(hi, a[k].high); } const s = ask ? sp : 0; return v >= lo + s - tol && v <= hi + s + tol; };
    if (!h.sample && (!onPath(ie, i0, h.entry, d > 0) || !onPath(j1, Math.min(a.length - 1, j1 + 1), h.exit, d < 0))) { skip.off++; continue; }
    const sims = {};
    for (const [k] of EX_POL) { if (k === 'actual') continue; sims[k] = exSim(a, i0, h.side, h.entry, R, k, 1, undefined, sp); }
    if (Object.values(sims).some(x => x.live)) { live++; liveSyms.add(h.sym); }
    // each cell in R of its own stop (sm × R): a 2R stop risks twice as much per trade, so its total is halved to compare equal risk
    EX_SM.forEach((sm, i) => EX_TM.forEach((tm, j) => { const g = exSim(a, i0, h.side, h.entry, R, 'grid', sm, tm == null ? null : tm * sm, sp); grid[i][j] += d * (g.x - h.entry) / (R * sm); }));
    // dollars per unit of price: the instrument's pip value for the trade's size (never pnl / pips: pnl carries the swap)
    const usdPerPx = h.sample ? 100 / R : pipValue(h.sym, +h.lots || 0) / m.pip;
    res.actual.push({ R: d * (h.exit - h.entry) / R, usd: h.net ?? h.pnl });
    for (const k in sims) { const mv = d * (sims[k].x - h.entry); res[k].push({ R: mv / R, usd: mv * usdPerPx - (+h.comm || 0) }); }
    // exit efficiency: captured share of the best excursion while you held it (a sell measured on the ask)
    let mfe = 0; for (let j = i0; j < a.length && a[j].time <= h.close; j++) mfe = Math.max(mfe, d * ((d > 0 ? a[j].high : a[j].low + sp) - h.entry));
    if (mfe > 0) eff.push(clamp(d * (h.exit - h.entry) / mfe, -1, 1));
    used.push(h); per.push({ h, R, rSrc: fromStop ? 'stop' : 'vol', act: d * (h.exit - h.entry) / R, mfe: mfe / R, alt: Object.fromEntries(Object.entries(sims).map(([k, v]) => [k, d * (v.x - h.entry) / R])) });
  }
  const stats = EX_POL.map(([k, name, desc]) => { const x = res[k], Rs = x.map(y => y.R); let eq = 0, pk = 0, dd = 0; for (const r of Rs) { eq += r; pk = Math.max(pk, eq); dd = Math.max(dd, pk - eq); } return { k, name, desc, n: x.length, usd: x.reduce((s, y) => s + y.usd, 0), avgR: Rs.length ? mean(Rs) : 0, sumR: Rs.reduce((s, r) => s + r, 0), win: Rs.length ? Rs.filter(r => r > 0).length / Rs.length * 100 : 0, dd, Rs }; });
  // walk-forward: pick the best rule on the older half of trades, score it on the newer half
  const ch = per.slice().sort((x, y) => x.h.open - y.h.open), hh = Math.floor(ch.length / 2), A = ch.slice(0, hh), B = ch.slice(hh);
  let wf = null; if (ch.length >= EX_WF_MIN) { const keys = EX_POL.slice(1).map(p => p[0]), sumA = k => A.reduce((s2, x) => s2 + x.alt[k], 0), pick = keys.sort((x, y) => sumA(y) - sumA(x))[0]; wf = { pick, nA: A.length, nB: B.length, inA: sumA(pick), outB: B.reduce((s2, x) => s2 + x.alt[pick], 0), mineB: B.reduce((s2, x) => s2 + x.act, 0), dB: B.map(x => x.alt[pick] - x.act) }; }
  return { stats, used, live, liveSyms: [...liveSyms], per, grid, wf, skip, eff: eff.length ? mean(eff) * 100 : null };
}
/* The lead, said once: what the replay supports. A green verdict needs the walk-forward difference on the newer trades
   to pass a margin that pays for having picked the best of 8 rules: paired t with p below 0.05 / 8 (Bonferroni).
   A large average gain on a driftless market points at the data first (threshold: 1 R a trade). [class, title, text] */
const EX_ODD_R = 1, EX_ALPHA = .05 / 8;
function exVerdict(best, act, wf) {
  if (best.avgR > EX_ODD_R) return ['none', 'Check this: the replay disagrees with the recorded trades', `${best.name} averages ${sgn(best.avgR, 2)} R a trade on these entries. The threshold of this check is ${EX_ODD_R} R a trade: on a market without drift a simple exit rule rarely earns that much on the same entries, so first check that the trades' prices match the price path they are replayed on (a fill far from the bars, or a trade from another session). A few very large trades can also do it.`];
  if (!wf) return ['none', 'Too few trades for a fair test', `The best rule is picked in hindsight; with under ${EX_WF_MIN} replayed trades it cannot be tested on trades it did not see.`];
  const name = EX_POL.find(q => q[0] === wf.pick)[1], d = wf.dB || [], t = labT(d), p = t == null ? 1 : labP2(t, d.length), sure = p < EX_ALPHA;
  const facts = `Chosen on your ${wf.nA} older trades, ${name} made ${sgn(wf.outB, 1)} R on the ${wf.nB} newer ones against ${sgn(wf.mineB, 1)} R from your own exits (paired t ${t == null ? '—' : nfx(t, 1)}).`;
  if (sure && wf.outB > wf.mineB) return ['ok', `${name} beat your exits on newer trades`, `${facts} That passes the margin for picking the best of 8 rules (p below 0.05 / 8, Bonferroni). One split on a small sample: try it forward before adopting it.`];
  if (sure) return ['meh', `Your exits did better than ${name} on newer trades`, `${facts} That passes the margin for picking the best of 8 rules (p below 0.05 / 8): the rule's hindsight edge did not survive.`];
  return ['meh', 'No reliable difference between your exits and the rules', `${facts} Once the best of 8 rules has been picked, a difference this size is within chance (it needs p below 0.05 / 8). Your exits are about as good as any simple rule on these trades.`];
}
function drawExit(b, c) {
  labCfg(c);
  const sample = !!LAB.sample && c.exSrc === 'sample', T = exTrades(sample);
  const key = `${sample}|${c.exR}|${T.length}|${T[0]?.id}:${T[0]?.parts}|${Math.floor(Engine.simTime / 300)}`;
  if (LAB.exitKey !== key) { LAB.exit = exRun(T, c.exR); LAB.exitKey = key; }
  const { stats, used, eff, live, liveSyms, per, grid, wf, skip } = LAB.exit, act = stats[0], nSkip = skip.hist + skip.off + skip.short;
  // the replay is capped at the EX_CAP most recent trades: say so when there are more
  const nAll = sample ? T.length : exEligible().length, capTxt = nAll > T.length ? `the ${T.length} most recent of ${nAll}` : '';
  const skipTxt = nSkip ? `${nSkip} of ${T.length} trades left out: ${[skip.off && `${skip.off} whose price is not on the bar path beyond spread + tolerance (the widest spread, the maximum fill deviation and a quarter of the volatility stop)`, skip.hist && `${skip.hist} older than the loaded history`, skip.short && `${skip.short} with under 15 minutes of price after entry`].filter(Boolean).join(', ')}.` : '';
  const synth = sample ? '<p class="small ex-synth">Sample trader: random entries, no edge; its numbers show costs only. It takes random entries, grabs small wins and lets losses run to the stop; any total away from the costs is chance.</p>' : '';
  const note = LAB.exNote && Date.now() - LAB.exNote.at < 15000 ? `<p class="small ex-note" role="status"><b>${LAB.exNote.title}</b> · ${LAB.exNote.body}</p>` : '';
  const head = `<div class="lab-intro"><p>Most traders tune entries and ignore exits. Exit Lab replays your closed FX and CFD trades on the real price path, each in its own unit, and asks: with the <b>same entries</b>, what would other exit rules have earned? 1R = ${c.exR === 'stop' ? 'your initial stop distance (a volatility stop if you had none)' : '1.5 × the 15-minute volatility at entry'}.</p>
    <div class="lab-src"><div class="mini-seg" data-exsrc><button data-val="mine" class="${sample ? '' : 'on'}">My trades · ${tradesOf(S.history).length}</button><button data-val="sample" class="${sample ? 'on' : ''}">Sample trader</button></div>${sample ? '<button class="link" data-ex-resample>New sample</button>' : ''}<div class="mini-seg" data-k="exR"><button data-val="stop" class="${c.exR === 'stop' ? 'on' : ''}">R = my stop</button><button data-val="vol" class="${c.exR === 'vol' ? 'on' : ''}">R = volatility</button></div></div>${synth}${c.exR === 'vol' ? '<p class="small ex-volwarn" role="note"><b>R = volatility mixes trades with different risks.</b> Each trade\'s 1R is 1.5 × the 15-minute volatility at its entry, not the stop you actually risked, so a tight-stop trade and a wide-stop trade count alike. Compare the rules as shape, not size: which did better, not by how many R.</p>' : ''}</div>`;
  if (used.length < 5) {
    b.innerHTML = head + `<div class="empty">${T.length ? `Only ${used.length} of ${T.length} trades can be replayed; Exit Lab needs 5. ${skipTxt}` : 'No closed trades yet.'} <button class="link" data-ex-sample>Try it with a sample trader</button>: random entries with no edge; it grabs small wins and lets losses hit the stop (each trade risks $100).</div>`;
    return;
  }
  const alt = stats.slice(1).slice().sort((x, y) => y.sumR - x.sumR), best = alt[0], diff = best.Rs.map((r, i) => r - act.Rs[i]), t = labT(diff), pT = t == null ? 1 : labP2(t, diff.length);
  const mx = Math.max(...stats.map(s => Math.abs(s.sumR)), 1e-9);
  const odd = best.avgR > EX_ODD_R, verdict = exVerdict(best, act, wf);
  const pt = `<span class="ex-term" tabindex="0"${tipAttr('Paired t|For each trade, the rule\'s result minus yours, in R; t = the average of those differences over its standard error. Picking the best of 8 rules afterwards needs a stricter bar than |t| > 2, and trades that overlap in time are not fully independent.')}>paired t</span>`;
  // a replay still inside its window is marked at the current price: it moves only while that market trades
  const liveOpen = live && (liveSyms || []).some(s => mktState(s).open);
  const effTxt = eff == null ? '—' : eff < 0 ? '—' : `${eff.toFixed(0)}%`;
  const effTip = eff != null && eff < 0 ? `Exit efficiency|Negative (${eff.toFixed(0)}%): on average your exits closed below entry even after the trade had been in profit, so a share of the best open profit means nothing here. MFE, the maximum favourable excursion, is the best open profit while the trade was held.` : 'Exit efficiency|How much of the best open profit your exits kept, on average. The best open profit is the MFE, the maximum favourable excursion while the trade was held. Under 30% means profits were often given back.';
  b.innerHTML = head + `<div class="dj-verdict ${verdict[0]} ex-verdict" tabindex="0"${tipAttr(`${verdict[1]}|${verdict[2]}`)}><b>${verdict[1]}</b><span>${used.length} trades replayed${capTxt ? ` (${capTxt})` : ''}${nSkip ? ` · ${nSkip} left out` : ''} · 1R = ${c.exR === 'stop' ? 'your initial stop' : '1.5× the 15-minute volatility'}</span></div>
  ${nSkip || capTxt ? `<p class="small ex-skip">${capTxt ? `Exit Lab replays ${capTxt} closed trades (a cap of ${EX_CAP}, to keep the replay quick). ` : ''}${skipTxt}</p>` : ''}
  <div class="obs-kpis">${kpi('Trades replayed', `${used.length}${sample ? ' (sample)' : ''}`, '', `Trades replayed|${used.length} closed trades${sample ? ' from the sample trader' : ''}, each replayed from its own entry on the real price path with every exit rule.`)}${kpi('Your exits', `${sgn(act.sumR, 1)} R`, cls(act.sumR), `Your exits|The total of your trades as you actually closed them, in R. 1 R = the risk of the trade (entry to stop).`)}${kpi('Best rule (hindsight)', `${sgn(best.sumR, 1)} R <small>${best.name}</small>`, odd ? 'wn' : '', `Best rule, in hindsight|The exit rule with the best total on these same trades, picked after the fact: a description of the past, not a recommendation. The walk-forward check below says whether it held on trades it did not see.`)}${kpi('Exit efficiency', effTxt, '', effTip)}</div>
  ${note}
  <div class="bh-board-w"><table class="tbl sm ex-tbl"><thead><tr><th>Exit rule</th><th${tipAttr('Total R|The sum over all replayed trades, in R (1R = the risk of each trade). Every trade weighs the same, whatever its size.')}>Total R</th><th><span class="sr-only">Total R bar</span></th><th${tipAttr('Average R|Total R divided by the number of trades: what the rule earned per trade.')}>Avg R</th><th${tipAttr('Win rate|Share of the trades that closed in profit under the rule.')}>Win rate</th><th${tipAttr('Maximum drawdown|The deepest fall of the running total, in R: the worst losing stretch you would have sat through.')}>Max DD (R)</th><th${tipAttr('P&L|The same result in dollars at the pip value of each trade size, with the commission your trades paid. Replays pay the normal spread (a sell exits on the ask) but no slippage. Its sign can differ from Total R on the same row: R gives every trade the same weight, dollars weight each trade by its size (lots and stop distance), so a few large trades can turn the dollar total.')}>P&amp;L</th></tr></thead><tbody>${stats.map(s => `<tr class="${s.k === 'actual' ? 'me' : s.k === best.k ? 'best' : ''}"><td${tipAttr(`${s.name}|${s.desc}.${s.k === best.k ? ' The best total on these trades, in hindsight.' : ''}`)}><b>${s.name}</b> <small class="muted">${s.desc}</small>${s.k in EX_USE ? ` <button class="link ex-use" data-ex-use="${s.k}"${tipAttr(`Use in the ticket|${EX_USE_TIP[s.k]} 1R = your ticket stop, or the volatility stop on ${pretty(S.set.sym)} when the ticket has none. Split targets are switched off so the ticket matches the rule.`)}>Use</button>` : s.k === 'actual' ? '' : ` <small class="muted ex-na"${tipAttr('No time stop in the ticket|The order ticket has no exit by time, so it cannot place this rule: close the trade by hand when the time is up.')}>time stop · by hand</small>`}</td><td class="mono ${cls(s.sumR)}">${sgn(s.sumR, 1)}</td><td class="ex-bar"><div class="bk-exp-bar"><i class="${s.sumR >= 0 ? 'up' : 'dn'}" style="${s.sumR >= 0 ? 'left:50%' : `left:${50 - Math.abs(s.sumR) / mx * 50}%`};width:${Math.abs(s.sumR) / mx * 50}%"></i></div></td><td class="mono ${cls(s.avgR)}">${sgn(s.avgR, 2)}</td><td class="mono">${s.win.toFixed(0)}%</td><td class="mono">${s.dd.toFixed(1)}</td><td class="mono ${cls(s.usd)}">${usdFmt(s.usd, true)}</td></tr>`).join('')}</tbody></table></div>
  <p class="small">${best.sumR > act.sumR ? `In hindsight, <b>${best.name}</b> would have added ${sgn(best.sumR - act.sumR, 1)} R on the same entries. ` : 'In hindsight, none of the standard rules beat your own exits on these trades. '}${t != null ? (pT < EX_ALPHA ? `The per-trade difference passes the margin for picking the best of 8 rules (${pt} = ${nfx(t, 1)}, p below 0.05 / 8), though trades that overlap in time are not fully independent.` : `The per-trade difference is within chance once the best of 8 rules is picked (${pt} = ${nfx(t, 1)}; it needs p below 0.05 / 8): the best rule in hindsight often regresses.`) : ''} ${eff != null && eff >= 0 ? `You kept ${eff.toFixed(0)}% of the best open profit your trades reached.` : ''}</p>
  <div class="ex-more"><div class="bh-card"><h3>Stop × target map <span class="muted small">total R on the same entries, equal risk</span></h3>${exGrid(grid)}<p class="small muted ex-gleg"><i class="up"></i>gained <i class="dn"></i>lost · stronger colour = larger total · outlined = best cell. Rows: stop distance in base R. Columns: target as a multiple of that stop ("none" = exit after 24h). <span class="ex-term" tabindex="0"${tipAttr('Base R|1R of each trade: your initial stop (or the volatility stop). A row\'s stop is a multiple of it; each cell is counted in R of its own stop, so a 2R stop, which risks twice as much per trade, has its total halved. Cells compare results at equal risk.')}>Each cell is in R of its own stop</span>, so a wider stop is not favoured by risking more. A lone bright cell among dark ones is luck; a bright neighbourhood is more believable.</p></div>
    <div class="bh-card"><h3>Walk-forward check</h3>${wf ? `<p class="small">Choosing the best rule on your <b>${wf.nA} older trades</b> picks <b>${EX_POL.find(p => p[0] === wf.pick)[1]}</b> (${sgn(wf.inA, 1)} R in hindsight). On the <b>${wf.nB} newer trades</b> it then made <b>${sgn(wf.outB, 1)} R</b>, against <b>${sgn(wf.mineB, 1)} R</b> from your own exits.</p><p class="small">${verdict[0] === 'ok' ? 'It beat your own exits on the newer trades by more than the margin for picking the best of 8 rules. One split on a small sample: this describes the past, it does not predict the next trades.' : wf.outB > wf.mineB ? 'It did better on the newer trades, but not by more than chance gives after picking the best of 8 rules. Do not switch on the strength of the table alone.' : 'Its hindsight edge did not survive out of sample. Do not switch on the strength of the table alone.'}</p>` : `<p class="small muted">Needs at least ${EX_WF_MIN} replayed trades to split into an older half (to choose a rule) and a newer half (to test it), at least 4 in each.</p>`}</div></div>
  ${exKindTable(per, best)}
  <p class="small muted ex-per-cap">${per.length > 12 ? `Showing 12 of ${per.length} replayed trades, the most recent first.` : `All ${per.length} replayed trades, the most recent first.`}</p>
  <div class="bh-board-w"><table class="tbl sm ex-per"><thead><tr><th>Trade</th><th>Side</th><th${tipAttr('1R from|Your initial stop, or the volatility stop (1.5× the 15-minute volatility) when the trade had none.')}>1R from</th><th>Yours</th><th${tipAttr('Best seen (MFE)|The maximum favourable excursion: the best open profit while you held the trade, in R.')}>Best seen</th><th${tipAttr('Best rule on this trade, in hindsight|The rule that would have done best on this one trade, known only afterwards: one trade says nothing about the next.')}>Best rule (hindsight)</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${per.slice(0, 12).map((x, i) => { const bk = Object.entries(x.alt).sort((p, q) => q[1] - p[1])[0]; return `<tr><td class="mono">${pretty(x.h.sym)} <small class="muted">${dts(x.h.open)}</small></td><td><span class="tag ${x.h.side}">${x.h.side}</span></td><td class="small muted">${x.rSrc === 'stop' ? 'your stop' : 'volatility'}</td><td class="mono ${cls(x.act)}">${sgn(x.act, 2)} R</td><td class="mono">${x.mfe.toFixed(2)} R</td><td><span class="mono">${sgn(bk[1], 2)} R</span> <small class="muted">${EX_POL.find(p => p[0] === bk[0])[1]}</small></td><td><button class="link" data-ex-show="${i}">Open chart</button></td></tr>`; }).join('')}</tbody></table></div>
  <p class="small muted">${live ? `${live} replay${live > 1 ? 's are' : ' is'} still inside its time window and ${liveOpen ? 'marked at the current price, so the table will keep moving' : 'marked at the last price before the close; it moves again when the market reopens'}. ` : ''}In dollars every rule pays the commission your trade paid; counterfactual exits pay the normal spread but no slippage, and stops fill exactly at the level unless the price gapped through it. Time stops count minutes of open market. Choosing the best of eight rules after the fact overstates its edge; test it forward before adopting it. On a pure random walk, stops cannot add expected return — they only help when prices trend.</p>`;
}

/* Where you lose: your trades by how they actually ended (the close reason), with what the best rule in hindsight
   made on the same trades. A type with fewer than EX_KIND_MIN trades says so instead of showing averages. */
function exKindTable(per, best) {
  const g = exByKind(per, best.k).sort((a, b) => (a.n < EX_KIND_MIN) - (b.n < EX_KIND_MIN) || a.sum - b.sum);
  if (!g.length) return '';
  const row = x => `<tr data-ex-kind="${x.kind}"><td>${x.name}</td><td class="mono">${x.n}</td>${x.n < EX_KIND_MIN ? `<td colspan="4" class="small muted"${tipAttr(`Too few|Under ${EX_KIND_MIN} trades ended this way: no average is worth reading.`)}>too few (under ${EX_KIND_MIN})</td>` : `<td class="mono ${cls(x.sum)}">${sgn(x.sum, 1)}</td><td class="mono ${cls(x.avg)}">${sgn(x.avg, 2)}</td><td class="mono">${x.win.toFixed(0)}%</td><td class="mono">${sgn(x.alt, 1)}</td>`}</tr>`;
  return `<div class="bh-card ex-kind-w"><h3>Where you lose <span class="muted small">your trades by how they actually ended</span></h3><div class="bh-board-w"><table class="tbl sm ex-kind"><thead><tr><th${tipAttr('Exit type|How the trade actually closed, from its close reason: by hand (Manual), stop loss, take profit, trailing stop, stop moved to break-even, time stop, or the broker\'s stop-out.')}>Exit type</th><th>Trades</th><th${tipAttr('Total R|Your result on these trades as you closed them, in R.')}>Total R</th><th>Avg R</th><th${tipAttr('Win rate|Share of these trades you closed in profit.')}>Win rate</th><th${tipAttr(`${best.name} on them|What ${best.name}, the best rule in hindsight over all your trades, made on these same trades, in R. Picked after the fact: a description, not a recommendation.`)}>${best.name} on them</th></tr></thead><tbody>${g.map(row).join('')}</tbody></table></div><p class="small muted">Sorted from the type that lost the most. Hindsight on a few trades: a type's total says where the losses came from, not what the next trades will do.</p></div>`;
}
function exGrid(G) {
  const all = G.flat(), mx = Math.max(1e-9, ...all.map(Math.abs)), best = Math.max(...all);
  return `<div class="ex-grid" style="grid-template-columns:74px repeat(${EX_TM.length},minmax(0,1fr))"><span class="h r">stop ↓ · target →</span>${EX_TM.map(t => `<span class="h">${t == null ? 'none (24h)' : t + '× stop'}</span>`).join('')}${EX_SM.map((sm, i) => `<span class="h r">stop ${sm}R</span>${EX_TM.map((t, j) => { const v = G[i][j]; return `<span class="c ${v === best ? 'best' : ''}" style="background:${v >= 0 ? `color-mix(in srgb,var(--up) ${Math.round(Math.abs(v) / mx * 55)}%,transparent)` : `color-mix(in srgb,var(--dn) ${Math.round(Math.abs(v) / mx * 55)}%,transparent)`}" ${tipAttr(`Stop ${sm}R · target ${t == null ? 'none (exit after 24h)' : t + '× the stop'}|${sgn(v, 1)} R in total on the same entries, counted in R of this cell's own stop (${sm} × base R), so every cell risks the same.${v === best ? ' The best cell of the map, in hindsight.' : ''}`)}>${sgn(v, 1)}</span>`; }).join('')}`).join('')}</div>`;
}
const EX_USE_TIP = { t1: 'Sets a stop at 1R and a target at 1R.', t2: 'Sets a stop at 1R and a target at 2R.', t3: 'Sets a stop at 1R and a target at 3R.', trail: 'Sets a trailing stop of 1R with no fixed stop or target: it starts 1R from entry and follows the best price.', be: 'Sets a stop at 1R, a target at 3R and break-even: the stop moves to entry once price is 1R in your favour.' };
// puts a replayed rule in the order ticket, exactly: only the rules the ticket can place (EX_USE), with the rule's own 1R
/* a message from Exit lab: inline above the table while the tool is on screen (a toast would sit over its columns),
   otherwise a toast */
function exSay(title, body) {
  if (document.querySelector('#obsBody .ex-tbl')) { LAB.exNote = { title: escHtml(title), body: escHtml(body), at: Date.now() }; obsDraw(); }
  else toast(title, body, 'info');
}
function exUse(k) {
  if (!(k in EX_USE)) return;
  const t = S.tk, x = tkx(), sym = S.set.sym, un = unitWord(sym);
  // 1R: the ticket's own stop when it has one (a trail without a stop is the stop, as in tkCalc), otherwise the
  // volatility stop the replay uses, on the ticket's pair now
  const R = t.useSL && t.sl > 0 ? t.sl : t.useTrail && t.trail > 0 ? t.trail : exVolStopPips(sym);
  if (!(R > 0)) { exSay('Ticket unchanged', 'No stop to build the rule on: set a stop in the ticket first.'); return; }
  const r1 = v => Math.round(v * 10) / 10;
  x.split = false; x.be = false;
  if (k === 'trail') { t.useTrail = true; t.trail = r1(R); t.useSL = false; t.useTP = false; }
  else {
    t.sl = r1(R); t.useSL = true; t.useTP = true; t.useTrail = false; t.tp = r1(R * EX_USE[k]);
    if (k === 'be') Object.assign(x, { be: true, beAt: t.sl, beOff: 0, beOnTp: false });
  }
  save(); syncTicketInputs(); renderTicket();
  exSay('Ticket updated', k === 'trail' ? `Trailing stop ${t.trail} ${un}: the stop starts ${t.trail} ${un} from entry and follows the best price; no fixed stop or target`
    : `Stop ${t.sl} ${un} (1R), target ${t.tp} ${un} = ${EX_USE[k]}R${k === 'be' ? `, break-even at +${t.sl} ${un}` : ''}`);
}

/* ---------------- registration ---------------- */
OBS_VIEWS.push(['scan', 'Edge check', 'Signals with a record'], ['cone', 'Range cone', 'Where price can go'], ['exit', 'Exit lab', 'Replay other exits']);
OBS_SRC.scan = ['Harvey, Liu & Zhu (2016), multiple testing', 'https://www.nber.org/papers/w20592'];
OBS_SRC.cone = ['Andersen & Bollerslev (1997), intraday periodicity and volatility persistence', 'https://ideas.repec.org/a/eee/empfin/v4y1997i2-3p115-158.html'];
OBS_SRC.exit = ['Kaminski & Lo (2014), When do stop-loss rules stop losses?', 'https://dspace.mit.edu/entities/publication/bb69ca4b-0cdc-487f-831d-63b2e84fafee'];
OBS_EXT.scan = drawScan; OBS_EXT.cone = drawCone; OBS_EXT.exit = drawExit;
// the shared tooltips of these tools' controls and terms (obs.js), worded for what the tools compute
if (typeof OBS_CTRL_TIP === 'object') {
  OBS_CTRL_TIP.scH = { 4: 'Horizon 1 hour|Each past signal is scored on what price did over the next hour (4 bars of 15 minutes).', 8: 'Horizon 2 hours|Scored on the next 2 hours.', 16: 'Horizon 4 hours|Scored on the next 4 hours.' };
  if (OBS_CTRL_TIP.cnMode) OBS_CTRL_TIP.cnMode.conf = 'Conformal|The session cone widened or narrowed by how often it missed last week. Checked on the newer half of the week only; the odds are a past frequency, not a guarantee.';
}
if (typeof OBS_TERMS === 'object') for (const x of OBS_TERMS) if (x[0] === 'Conformal') x[1] = 'Conformal band|The cone widened or narrowed by how often it missed last week; its odds are a past frequency, not a guarantee.';
const OBS_CTRL = {
  scan: (c, seg) => `<span class="muted small">horizon</span>` + seg('scH', [[4, '1H'], [8, '2H'], [16, '4H']]) + seg('scF', [['live', 'With a record'], ['all', 'All live']]),
  cone: (c, seg) => `<span class="muted small">horizon</span>` + seg('cnH', [[60, '1H'], [240, '4H'], [480, '8H'], [1440, '1D']]) + seg('cnMode', [['model', 'Session model'], ['conf', 'Conformal']]),
  exit: () => ''
};
function bindLab() {
  document.addEventListener('click', e => {
    const t = e.target; if (!t.closest || !t.closest('#obsBody')) return;
    const c = obsCfg();
    // a signal's record: the Details button (keyboard) or a click on its row; the focus returns to the button
    const tg = t.closest('[data-sc-toggle]'), op = t.closest('[data-sc-open]'), id = tg ? tg.dataset.scToggle : op && !t.closest('button') ? op.dataset.scOpen : null;
    if (id) { LAB.open = LAB.open === id ? null : id; obsDraw(); if (tg) { const nb = [...document.querySelectorAll('#obsBody [data-sc-toggle]')].find(x => x.dataset.scToggle === id); if (nb) nb.focus(); } return; }
    const us = t.closest('[data-ex-use]'); if (us) { const k = us.dataset.exUse; exUse(k); const nb = document.querySelector(`#obsBody [data-ex-use="${k}"]`); if (nb && nb !== us) nb.focus(); return; }
    const sh = t.closest('[data-ex-show]'); if (sh) { const x = LAB.exit?.per[+sh.dataset.exShow]; if (x && typeof bhShowTrade === 'function') bhShowTrade(x.h); return; }
    const cs = t.closest('[data-cn-stop]'), ct = t.closest('[data-cn-tp]'); if (cs || ct) { const v = Math.max(1, +(cs || ct).dataset[cs ? 'cnStop' : 'cnTp']); if (cs) { S.tk.sl = v; S.tk.useSL = true; } else { S.tk.tp = v; S.tk.useTP = true; } save(); syncTicketInputs(); renderTicket(); obsDraw(); toast('Ticket updated', `${cs ? 'Stop' : 'Target'} set to ${v} ${unitWord(S.set.sym)} from the cone`, 'info'); return; }
    const po = t.closest('[data-cn-ord]'); if (po) { const [sd, bd] = po.dataset.cnOrd.split('|'); cnLoadOrder(sd, bd, +po.dataset.cnPx); return; }
    const go = t.closest('[data-sc-go]'); if (go) { setSymbol(go.dataset.scGo, go.dataset.scSide || undefined); toast(`${pretty(go.dataset.scGo)} on the chart`, go.dataset.scSide ? `Ticket set to ${go.dataset.scSide} (a Robust record, still a hypothesis). Check the cone before you size it.` : 'Ticket side unchanged: only a Robust record sets it. Not a forecast of direction.', 'info'); return; }
    const k2 = t.closest('[data-k2]'); if (k2) { c[k2.dataset.k2] = k2.dataset.val2; save(); renderObs(); return; }
    if (t.closest('[data-ex-sample]') || t.closest('[data-ex-resample]')) { LAB.sample = exMakeSample(); c.exSrc = 'sample'; LAB.exitKey = ''; obsDraw(); return; }
    const src = t.closest('[data-exsrc] [data-val]'); if (src) { if (src.dataset.val === 'sample' && !LAB.sample) LAB.sample = exMakeSample(); c.exSrc = src.dataset.val; LAB.exitKey = ''; obsDraw(); return; }
    const r = t.closest('#obsBody [data-k] [data-val]'); if (r) { const k = r.closest('[data-k]').dataset.k; c[k] = r.dataset.val; save(); LAB.exitKey = ''; obsDraw(); }
  });
}
bindLab();
document.addEventListener('change', e => { if (e.target.id === 'scAlert') { const c = obsCfg(); c.scAlert = e.target.checked; save(); if (c.scAlert) { LAB.watched = null; scWatch(); } } });
setInterval(() => { try { scWatch(); } catch (e) { console.error(e); } }, 3000);
