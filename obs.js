'use strict';
/* tradeBerry — Observatory: unconventional, research-grounded ways to look at the market.
   Views: Constellation (correlation MST), Regime map (Hurst × permutation entropy), Intrinsic time
   (directional-change events), Déjà vu (nearest-neighbour analogues), Recurrence plot (+RQA),
   Drivers (which currency is moving a pair), Volatility clock (intraday seasonality),
   Tapestry (horizon charts of all pairs). Plus market sonification and first-passage odds. */

const OBS_VIEWS = [
  ['const', 'Constellation', 'Correlation map'],
  ['regime', 'Regime map', 'Trend or noise?'],
  ['dc', 'Intrinsic time', 'Event-based clock'],
  ['deja', 'Déjà vu', 'Historical analogues'],
  ['rp', 'Recurrence', 'Hidden structure'],
  ['drv', 'Drivers', 'Who moves the pair'],
  ['clock', 'Volatility clock', '24h activity'],
  ['tap', 'Tapestry', 'All pairs at once']
];
const OBS = { cache: {}, hover: null };
const OBS_EXT = {};
function obsCfg() {
  if (!S.set.obs) S.set.obs = {};
  return Object.assign(S.set.obs, { view: 'const', lb: 1440, dcTh: .1, dvTf: 15, dvW: 32, dvH: 12, rpTf: 15, rpMode: 'grad', tapLb: 1440, tapSort: 'ret', clkAll: false, ...S.set.obs });
}
const OBS_SRC = {
  const: ['Mantegna (1999), hierarchical structure in financial markets', 'https://arxiv.org/abs/cond-mat/9802256'],
  regime: ['Bandt & Pompe (2002), permutation entropy', 'https://link.aps.org/doi/10.1103/PhysRevLett.88.174102'],
  dc: ['Glattfelder, Dupuis & Olsen (2011), 12 empirical scaling laws in FX', 'https://arxiv.org/abs/0809.1040'],
  deja: ['Nearest-neighbour forecasting of exchange rates (Financial Innovation, 2025)', 'https://jfin-swufe.springeropen.com/articles/10.1186/s40854-025-00863-z'],
  rp: ['Eckmann, Kamphorst & Ruelle (1987), recurrence plots', 'https://iopscience.iop.org/article/10.1209/0295-5075/4/9/004'],
  drv: ['Lustig, Roussanov & Verdelhan (2011), common risk factors in currency markets', 'https://www.ssrn.com/abstract=1139447'],
  clock: ['Andersen & Bollerslev (1998), intraday activity patterns in DM–dollar volatility', 'https://public.econ.duke.edu/~boller/Published_Papers/jf_98.pdf'],
  tap: ['Heer, Kong & Agrawala (2009), Sizing the Horizon', 'https://idl.uw.edu/papers/horizon']
};

/* ---------------- explanations: what each tool answers, its controls, its terms ---------------- */
// the question each tool answers (navigation and header)
const OBS_ASK = {
  const: 'Constellation|Which pairs move together right now. A tree of the strongest correlations between the 16 pairs: adjacent = directly correlated; further along a branch is not implied.',
  regime: 'Regime map|Has each pair\'s recent path been persistent, anti-persistent or like noise over 1–32 minutes? Every pair is placed by its memory (Hurst) and its randomness (entropy), against the band where the same returns with random signs land. It describes the window; it does not forecast.',
  dc: 'Intrinsic time|How busy is the market, measured in reversals instead of minutes. One event per move of δ against the last extreme.',
  deja: 'Déjà vu|Has the last stretch of this pair happened before? The closest shapes in the history of all 16 pairs, what followed them, and whether that ever predicted anything here.',
  rp: 'Recurrence|Does the market revisit the same states? Each pixel compares two moments; lines and blocks show repeating sequences and stuck phases.',
  drv: 'Drivers|Which currency moves the pair. The pair split into its two currencies, each measured against all eight.',
  clock: 'Volatility clock|How active the market usually is at each time of day, and how today compares.',
  tap: 'Tapestry|All 16 pairs on one screen: who is up, who is down, and since when.',
  bask: 'Baskets|Trade a view on a currency group, not on one pair: a weighted index of currencies, its closest pair and its execution as legs.',
  scan: 'Edge check|Which live signals have actually paid on this pair. Every signal carries its own track record and a test of whether it beats luck.',
  cone: 'Range cone|How far price can go in the next hours, by time of day and the current pace, checked against its own past accuracy.',
  exit: 'Exit lab|Would other exit rules have done better on your own closed trades? Your trades replayed with nine exit rules.'
};
// the controls, by key and value
const OBS_CTRL_TIP = {
  lb: { 240: '4H|Measured on the 1-minute returns of the last 4 hours of trading: the most recent picture, the noisiest.', 1440: '1D|Measured on the 1-minute returns of the last 24 hours of trading.', 4320: '3D|Measured on the last 3 days of trading: the steadiest picture.' },
  tapLb: { 240: '4H|Each line starts 4 hours of trading ago.', 1440: '1D|Each line starts 24 hours of trading ago (a weekend is skipped).', 4320: '3D|Each line starts 3 days of trading ago (a weekend is skipped).' },
  dcTh: { .05: 'δ 0.05%|An event every 0.05% reversal: many small events.', .1: 'δ 0.10%|An event every 0.10% reversal.', .2: 'δ 0.20%|An event every 0.20% reversal.', .5: 'δ 0.50%|An event every 0.50% reversal: only the big swings.' },
  dvTf: { 5: '5-minute bars|The pattern and its look-ahead in 5-minute bars.', 15: '15-minute bars|The pattern and its look-ahead in 15-minute bars.', 60: '1-hour bars|The pattern and its look-ahead in 1-hour bars.' },
  dvW: { 16: 'Pattern of 16 bars|The shape compared: the last 16 bars.', 32: 'Pattern of 32 bars|The shape compared: the last 32 bars.', 64: 'Pattern of 64 bars|The shape compared: the last 64 bars.' },
  dvH: { 6: 'Look ahead 6 bars|What the matches did over the next 6 bars.', 12: 'Look ahead 12 bars|What the matches did over the next 12 bars.', 24: 'Look ahead 24 bars|What the matches did over the next 24 bars.' },
  rpTf: { 5: '5-minute states|One state per 5-minute bar.', 15: '15-minute states|One state per 15-minute bar.', 60: '1-hour states|One state per hour.' },
  rpMode: { grad: 'Distance|Every pixel shaded by how similar the two moments are.', bin: 'Recurrences|Only the pairs of moments similar enough to count as a recurrence (10% of them).' },
  clkAll: { false: 'This pair|The activity profile of the open pair.', true: 'All pairs|The average activity profile of the 16 pairs.' },
  scH: { 4: 'Look ahead 1 hour|Each past signal is scored on what price did over the next hour (4 bars of 15 minutes).', 8: 'Look ahead 2 hours|Scored on the next 2 hours.', 16: 'Look ahead 4 hours|Scored on the next 4 hours.' },
  scF: { live: 'With a record|Only live signals that have fired often enough on this pair to judge them.', all: 'All live|Every signal that is live now, including those with too few past cases to judge.' },
  cnH: { 60: 'Horizon 1 hour|The cone for the next hour.', 240: 'Horizon 4 hours|The cone for the next 4 hours.', 480: 'Horizon 8 hours|The cone for the next 8 hours.', 1440: 'Horizon 1 day|The cone for the next 24 hours.' },
  cnMode: { model: 'Session model|The cone widens with the usual activity of each hour and the pace of the last 2 hours.', conf: 'Conformal|The session cone corrected by how often it missed in the past, so its stated odds hold.' },
  cFreq: { 1: '1-minute returns|The matrix on 1-minute returns: the most returns, the finest picture.', 5: '5-minute returns|The matrix on 5-minute returns (sums of five 1-minute returns, complete 5-minute slots only): a fifth as many returns.', 15: '15-minute returns|The matrix on 15-minute returns: a fifteenth as many returns, so ρ is noisier on short windows.' },
  tapScale: { common: 'Common scale|One scale for all 16 rows: rows can be compared, but a calm pair barely shows next to a busy one.', pair: 'Per-pair scale|Each row on its own scale: one band = a third of the pair\'s typical move over the window (σ of its 1-minute returns × √bars). Calm pairs show their shape; rows are no longer comparable in size.' },
  tapCcy: { all: 'All pairs|The 16 pairs of the G8 currencies; the theme is the strongest and the weakest currency.', USD: 'USD|Only the pairs with USD; the theme becomes USD\'s average move across them.', EUR: 'EUR|Only the pairs with EUR; the theme becomes EUR\'s average move across them.', GBP: 'GBP|Only the pairs with GBP; the theme becomes GBP\'s average move across them.', JPY: 'JPY|Only the pairs with JPY; the theme becomes JPY\'s average move across them.', CHF: 'CHF|Only the pairs with CHF; the theme becomes CHF\'s average move across them.', AUD: 'AUD|Only the pairs with AUD; the theme becomes AUD\'s average move across them.', CAD: 'CAD|Only the pairs with CAD; the theme becomes CAD\'s average move across them.', NZD: 'NZD|Only the pairs with NZD; the theme becomes NZD\'s average move across them.' },
  tapSort: { ret: 'Sort by return|Strongest risers on top.', abc: 'Sort A–Z|Alphabetical.', clu: 'Sort by cluster|Pairs linked in the Constellation tree of the same window next to each other. The tree reads |ρ|, so a pair and its inverse partner (moving opposite ways) also sit together.' }
};
// a control that means something else in one tool: OBS_CTRL_TIP_V[view][key] wins over OBS_CTRL_TIP[key]
const OBS_CTRL_TIP_V = {
  regime: { lb: {
    240: '4H|The last 240 one-minute bars (4 hours of trading). Hurst on their 1-minute returns; entropy on their 5-minute returns, averaged over the five ways to cut the 5-minute grid. The noisiest picture.',
    1440: '1D|The last 1,440 one-minute bars (24 hours of trading). Hurst on 1-minute returns; entropy on 5-minute returns, averaged over the five grid offsets.',
    4320: '3D|The last 4,320 one-minute bars (3 days of trading). Hurst on 1-minute returns; entropy on 5-minute returns, averaged over the five grid offsets. The steadiest picture.' } }
};
/* The glossary: a term in the text of a tool gets a dotted underline and its explanation (first use in each block).
   Longer phrases first, so "permutation entropy" wins over "entropy". A third element lists the views a meaning
   belongs to: a word that means different things in different tools ("legs", "basket") is only explained where its
   meaning is the one written here. */
const OBS_TERMS = [
  ['minimum spanning tree', 'Minimum spanning tree|The fewest, strongest links that still connect every pair: 15 links for 16 pairs.'],
  ['correlation distance', 'Correlation distance|d = √(2(1−|ρ|)): 0 for pairs that move as one, about 1.4 for unrelated ones.'],
  ['permutation entropy', 'Permutation entropy|How random the order of the moves is: near 1 = noise, lower = some up-down patterns repeated in the window (Bandt & Pompe). Short samples of pure noise sit a little below 1.'],
  ['Hurst exponent', 'Hurst exponent|The memory of the price path in the window. Above 0.5 its moves ran on more than chance, below 0.5 they were undone more than chance, 0.5 is a random walk. It describes the window; it is not a forecast.'],
  ['Hurst', 'Hurst exponent|The memory of the price path in the window. Above 0.5 its moves ran on more than chance, below 0.5 they were undone more than chance, 0.5 is a random walk. It describes the window; it is not a forecast.'],
  ['noise band', 'Noise band|Where the same returns land with their signs randomised (same sizes, same busy and quiet hours, no memory of direction): 90% of those copies fall inside it.', ['regime']],
  ['Efficiency ratio', 'Efficiency ratio|Net move divided by the whole path travelled: 100% = a straight line, near 0% = back and forth.', ['regime']],
  ['anti-persistent', 'Anti-persistent|Over the window, at scales of 1 to 32 minutes, moves were undone more often than chance would undo them (Hurst below the noise band). A description of the past window, not a forecast.', ['regime']],
  ['persistent', 'Persistent|Over the window, at scales of 1 to 32 minutes, moves ran on more often than chance would carry them (Hurst above the noise band). A description of the past window, not a forecast.', ['regime']],
  ['mean-reverting', 'Mean-reverting|Moves tend to be undone: a rise is more often followed by a fall.'],
  ['random-walk', 'Random walk|Each move is independent of the last: past moves say nothing about the next one.'],
  ['intrinsic time', 'Intrinsic time|Time counted in reversals of δ instead of minutes: a busy hour holds many steps, a quiet one few.', ['dc']],
  ['directional change', 'Directional change|Price has reversed by δ from its last extreme: a new leg is confirmed.', ['dc']],
  ['Overshoot', 'Overshoot|How far price kept going after a reversal was confirmed, in multiples of δ. Research finds about 1× δ on average.', ['dc']],
  ['overshoot', 'Overshoot|How far price kept going after a reversal was confirmed, in multiples of δ.', ['dc']],
  ['Coastline', 'Coastline|The length of the zigzag: every leg from extreme to extreme added up, in % of price. How far the price travelled, whatever the net move.', ['dc']],
  ['Heartbeat', 'Heartbeat|Events in the last 6 hours of trading against the average pace: above 1 busier than usual. Highlighted only outside the range chance alone gives (a Poisson count at the average pace).', ['dc']],
  ['analogues', 'Analogues|Past stretches, on any of the 16 pairs, whose shape is closest to the last bars of this pair.'],
  ['95% CI', '95% confidence interval|The range where the true hit rate lies with 95% confidence. If it contains 50%, the method is no better than a coin.'],
  ['Determinism', 'Determinism|Share of recurrences that line up into diagonals: sequences of states that repeat. Compared with the same data shuffled.', ['rp']],
  ['Laminarity', 'Laminarity|Share of recurrences in vertical blocks: the market stuck in one state (consolidation).', ['rp']],
  ['embedding dimension', 'Embedding dimension|How many consecutive returns make one state: 3 here, so a state is the shape of three bars in a row.', ['rp']],
  ['recurrence rate', 'Recurrence rate|The threshold is set so that the closest 10% of all pairs of states count as recurrences.', ['rp']],
  ['states', 'State|Three consecutive returns, divided by their usual size: the shape and relative size of a short stretch, not the price.', ['rp']],
  ['recurrences', 'Recurrence|Two moments whose states are closer than the threshold: the market looked the same at both.', ['rp']],
  ['volatility clustering', 'Volatility clustering|Calm follows calm and busy follows busy; it repeats the size of the moves, not their direction.'],
  ['shuffled', 'Shuffled data|The same returns in random order: same sizes, no time structure. The reference for "is there structure here".', ['rp']],
  ['basket', 'Basket|An equal-weighted group of all eight currencies, the reference each currency is measured against.', ['drv']],
  ['basket', 'Basket|A group of currencies, weighted, traded as one index through its pair legs.', ['bask']],
  ['Horizon charts', 'Horizon chart|A line folded into coloured bands: darker = further from the start of the window. 16 pairs fit in the space of one chart.'],
  ['basis point', 'Basis point|0.01%. 25 bp = 0.25%.'],
  ['false discovery', 'False discovery rate|With many signals tested, some pass by luck. The Benjamini–Hochberg correction keeps the share of lucky passes under the stated rate.'],
  ['Benjamini', 'Benjamini–Hochberg|A correction for testing many signals at once, so that few of the "significant" ones are flukes.'],
  ['walk-forward', 'Walk-forward|The rule is chosen on older trades and checked on newer ones it never saw: a fairer test than picking the best in hindsight.'],
  ['Walk-forward', 'Walk-forward|The rule is chosen on older trades and checked on newer ones it never saw: a fairer test than picking the best in hindsight.'],
  ['MFE', 'MFE|Maximum favourable excursion: the best open profit while the trade was held.'],
  ['MAE', 'MAE|Maximum adverse excursion: the worst open loss while the trade was held.'],
  ['Max DD', 'Maximum drawdown|The deepest fall from a peak of the running total.'],
  ['Win rate', 'Win rate|Share of trades that closed in profit.'],
  ['Expectancy', 'Expectancy|The average result per trade, in R.'],
  ['Session model', 'Session model|The cone widens with the usual activity of each time of day (Asia, London, New York) and the pace of the last 2 hours.', ['cone']],
  ['Constant volatility', 'Constant volatility|A cone that widens at the same speed at every hour: the simple reference.', ['cone']],
  ['Conformal', 'Conformal band|The cone widened or narrowed by how often it missed in the past, so that its stated odds hold.', ['cone']],
  ['σ', 'σ (sigma)|Standard deviation: the typical size of a move. 2σ is an unusually large distance.'],
  ['ρ', 'ρ (correlation)|From −1 to +1. +1: the two move as one; −1: always opposite; 0: unrelated.'],
  ['δ', 'δ (delta)|The reversal size that counts as an event, in % of price.', ['dc']],
  ['RSI', 'RSI(14)|Relative strength index, 0–100: average up-moves against down-moves over 14 bars.'],
  ['EMA20', 'EMA20|Exponential moving average of the last 20 bars, recent bars weighing more.'],
  ['EMA50', 'EMA50|Exponential moving average of the last 50 bars.'],
  ['diversifier', 'Diversifier|A position that does not move with the others, so it lowers the risk of the whole.', ['const']],
  ['proxy', 'Proxy|The single pair that tracks the basket most closely.', ['bask']],
  ['legs', 'Legs|The pair trades that together make up the basket position.', ['bask']],
  ['legs', 'Legs|The two currencies of the pair, each measured against the basket of all eight.', ['drv']],
  ['legs', 'Legs|The moves between two confirmed reversals: each leg runs from one extreme to the next.', ['dc']]
];
const OBS_SKIP = 'button,a,input,select,textarea,svg,canvas,script,style,.brx-n,[data-tip],label,th,.pill,.mini-seg';
function obsTermsIn(root) {
  const blocks = root.querySelectorAll('.ins p, .obs-side p, .obs-body > p, .bh-card p, .ins small, .note, p.small');
  blocks.forEach(bl => {
    if (bl.dataset.gl) return; bl.dataset.gl = 1;
    const used = new Set(), view = obsCfg().view, terms = OBS_TERMS.filter(x => !x[2] || x[2].includes(view));
    const walk = node => {
      for (const ch of [...node.childNodes]) {
        if (ch.nodeType === 1) { if (!ch.matches(OBS_SKIP)) walk(ch); continue; }
        if (ch.nodeType !== 3 || !ch.nodeValue.trim()) continue;
        let txt = ch.nodeValue, hit = null;
        for (const [t, tip] of terms) {
          if (used.has(tip)) continue;
          const re = new RegExp(t.length === 1 ? `(${t})` : `(^|[^A-Za-z])(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})(?![A-Za-z])`);
          const m = re.exec(txt); if (!m) continue;
          const at = m.index + (t.length === 1 ? 0 : m[1].length);
          if (!hit || at < hit.at) hit = { at, t: t.length === 1 ? m[1] : m[2], tip };
        }
        if (!hit) continue;
        used.add(hit.tip);
        const after = ch.splitText(hit.at), rest = after.splitText(hit.t.length);
        const sp = document.createElement('span'); sp.className = 'brx-n term'; sp.tabIndex = 0; sp.dataset.tip = hit.tip; sp.textContent = after.nodeValue;
        after.replaceWith(sp);
        walk({ childNodes: [rest] });
      }
    };
    walk(bl);
  });
}
// native tooltips become the page's tooltip: title attributes and SVG <title> children
function obsTitles(root) {
  root.querySelectorAll('[title]').forEach(el => {
    const t = el.getAttribute('title'); if (!t) return;
    if (!el.dataset.tip) el.dataset.tip = t;
    if (!el.textContent.trim() && !el.getAttribute('aria-label')) el.setAttribute('aria-label', t);
    el.removeAttribute('title');
  });
  root.querySelectorAll('svg title').forEach(ti => { const p = ti.parentNode; if (p && !p.dataset.tip) p.dataset.tip = ti.textContent; ti.remove(); });
}
function obsEnhance() {
  const el = $('#obs'); if (!el) return;
  obsTitles(el); obsTermsIn(el);
}
let obsEnhQ = 0;
function obsWatch() {
  const el = $('#obs'); if (!el || el.dataset.watch) return; el.dataset.watch = 1;
  new MutationObserver(() => { cancelAnimationFrame(obsEnhQ); obsEnhQ = requestAnimationFrame(obsEnhance); }).observe(el, { childList: true, subtree: true });
}
// a highlighted value with its explanation
// "1 event", "2 events"; a signed number that rounds to zero is "0" (or "+0"), never "−0"
const obsPl = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const obsSgn = (v, d = 1) => sgn(+v.toFixed(d) === 0 ? 0 : v, d);
// the typographic minus in every number the Observatory writes
const obsMinus = t => String(t).replace(/-(?=[\d.])/g, '−');
const obsBp = v => obsMinus(bp(v));
// seconds of trading up to each bar: the time between consecutive bars, a closed market (a gap) counted as zero
function obsOpenT(T) { const O = [0]; for (let i = 1; i < T.length; i++) O.push(O[i - 1] + (isGapAt(T, i) ? 0 : T[i] - T[i - 1])); return O; }
const obsV = (txt, tone, tip) => `<span class="brx-n${tone ? ' ' + tone : ''}" tabindex="0" data-tip="${escHtml(tip)}">${txt}</span>`;

/* ---------------- math helpers ---------------- */
const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
const stdev = a => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / Math.max(1, a.length - 1)); };
function logret(cl) { const r = []; for (let i = 1; i < cl.length; i++) r.push(Math.log(cl[i] / cl[i - 1])); return r; }
function linreg(xs, ys) { const mx = mean(xs), my = mean(ys); let a = 0, b = 0; xs.forEach((x, i) => { a += (x - mx) * (ys[i] - my); b += (x - mx) ** 2; }); const k = b ? a / b : 0; return { k, c: my - k * mx }; }
// Hurst via aggregated variance: Var(sum of k returns) ∝ k^(2H); null under HURST_MIN returns (fewer than 3 levels)
const HURST_MIN = 48;
function hurst(r) {
  if (r.length < HURST_MIN) return null;
  const ks = [1, 2, 4, 8, 16, 32].filter(k => r.length / k >= 12), lx = [], ly = [];
  for (const k of ks) { const s = []; for (let i = 0; i + k <= r.length; i += k) { let t = 0; for (let j = i; j < i + k; j++) t += r[j]; s.push(t); } const v = stdev(s) ** 2; if (v > 0) { lx.push(Math.log(k)); ly.push(Math.log(v)); } }
  return lx.length >= 3 ? clamp(linreg(lx, ly).k / 2, 0, 1) : null;
}
/* A window of bars as gap-free segments of 1-minute log returns: a closed market (weekend, pause) starts a new
   segment, so no return, 5-minute sum or ordinal pattern ever spans one. */
function obsSegs(T, C) {
  const out = []; let cur = [];
  for (let i = 1; i < C.length; i++) {
    if (isGapAt(T, i)) { if (cur.length) out.push(cur); cur = []; continue; }
    if (C[i] > 0 && C[i - 1] > 0) cur.push(Math.log(C[i] / C[i - 1]));
  }
  if (cur.length) out.push(cur);
  return out;
}
/* Normalised permutation entropy, order m (Bandt & Pompe), of 5-minute returns on one cut of the 5-minute grid (the
   sums of 1-minute returns o, o+5, … of each segment). Patterns with a tie are skipped: flat quotes would otherwise
   read as one repeating pattern. null under PE_MIN patterns (= 4!, each possible pattern once on average). */
const PE_M = 4, PE_MIN = 24, RG_MIN_BARS = 5 * (PE_MIN + PE_M) + 5;
function obsPEoff(segs, o, m = PE_M) {
  const cnt = new Map(); let n = 0;
  for (const r of segs) {
    const x = []; for (let i = o; i + 5 <= r.length; i += 5) { let t = 0; for (let j = i; j < i + 5; j++) t += r[j]; x.push(t); }
    for (let i = 0; i + m <= x.length; i++) {
      const w = x.slice(i, i + m); if (new Set(w).size < m) continue;
      const key = [...Array(m).keys()].sort((a, b) => w[a] - w[b]).join('');
      cnt.set(key, (cnt.get(key) || 0) + 1); n++;
    }
  }
  if (n < PE_MIN) return null;
  let h = 0; cnt.forEach(c => { const p = c / n; h -= p * Math.log(p); });
  let f = 1; for (let k = 2; k <= m; k++) f *= k;
  return h / Math.log(f);
}
// the mean over the five offsets of the 5-minute grid: the value does not depend on where the grid starts
function obsPE(segs) { let s = 0; for (let o = 0; o < 5; o++) { const v = obsPEoff(segs, o); if (v == null) return null; s += v; } return s / 5; }
// the Regime measures of one window; flat = most 1-minute quotes did not move (a frozen feed, not a calm market)
function rgStats(segs) {
  const r = segs.flat(), moved = r.filter(v => v !== 0).length;
  return { H: hurst(r), pe: obsPE(segs), n: r.length, flat: r.length > 0 && moved < r.length / 2 };
}
/* The noise band: the same returns with their signs randomised. Same sizes, same busy and quiet hours, same fat tails,
   no memory of direction, which is exactly what Hurst and the entropy look for. On a market without memory the
   measured value is one more such copy, so the 5–95% band holds it 90% of the time (iid Gaussian noise held 83–85%
   here: it misses the seasonality and the tails). pool: the windows (each a list of segments) the copies are drawn
   from, in turn; fixed seed. */
function rgBand(pool, sims = 160, seed = 1) {
  let s = (0x9e3779b9 ^ seed) | 0;
  const rnd = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const hs = [], ps = [], es = [];
  for (let i = 0; i < sims; i++) {
    const segs = pool[i % pool.length].map(r => r.map(v => rnd() < .5 ? -v : v)), st = rgStats(segs);
    if (st.H != null) hs.push(st.H); if (st.pe != null) ps.push(st.pe);
    const e = rgEr(segs.flat()); if (e != null) es.push(e);
  }
  const q = v => { v.sort((a, b) => a - b); const k = v.length - 1; return k < 0 ? { lo: NaN, hi: NaN, mid: NaN } : { lo: v[Math.floor(.05 * k)], hi: v[Math.ceil(.95 * k)], mid: v[Math.floor(k / 2)] }; };
  // er: the efficiency ratio of the same copies, its reference (noise alone gives a few %, never 0)
  return { h: q(hs), pe: q(ps), er: q(es) };
}
// efficiency ratio: net move / path length
function rgEr(r) { let path = 0, net = 0; for (const v of r) { path += Math.abs(v); net += v; } return path ? Math.abs(net) / path : null; }
// legend swatch: the colour comes from the token itself, so it matches the drawing in every palette
/* Long explanations of a side panel fold into "How to read this": the summary line stays visible (it carries the
   honest reading in one line), every sentence, figure and glossary term is kept inside. */
const obsHow = (sum, body, cls = '') => `<details class="obs-how${cls ? ' ' + cls : ''}"><summary><span class="obs-how-k">How to read this</span> <span class="obs-how-s">${sum}</span></summary>${body}</details>`;
const obsSw = (tok, key, lab) => `<span style="white-space:nowrap"><i data-legend="${key}" aria-hidden="true" style="display:inline-block;width:14px;height:6px;border-radius:var(--r-xs);margin-right:4px;vertical-align:middle;background:var(${tok})"></i>${lab}</span>`;
// descriptive words for the window, in neutral tones: Hurst is measured on 1- to 32-minute sums and forecasts nothing
const RG_SCALE = 'over 1–32 minutes';
const rgWord = (H, b) => H > b.hi ? 'persistent' : H < b.lo ? 'anti-persistent' : 'random-walk-like';
const rgLab = (H, b) => H > b.hi ? `<b>persistent ${RG_SCALE}</b> (above the noise band: its moves ran on more than chance)` : H < b.lo ? `<b>anti-persistent ${RG_SCALE}</b> (below the noise band: its moves were undone more than chance)` : `within the noise band — random-walk-like ${RG_SCALE}`;
const peLab = (pe, b) => pe < b.lo ? 'below the noise band — some repeating micro-patterns' : 'within the noise band — indistinguishable from noise';
// wilson(k, n) lives in shared.js (array [lo, hi] with .lo/.hi)
// currency log-values vs USD over the last n minutes, aligned
function ccyPaths(n) {
  const out = { USD: null };
  for (const c of Engine.CCY) {
    const p = Engine.PAIRS.find(x => (x.base === c && x.quote === 'USD') || (x.base === 'USD' && x.quote === c));
    const arr = Engine.candles[p.sym].slice(-n), inv = p.base === 'USD';
    out[c] = arr.map(k => inv ? -Math.log(k.close) : Math.log(k.close));
    if (!out.USD) out.USD = arr.map(() => 0), out._t = arr.map(k => k.time);
  }
  return out;
}
function canvasFit(cv) { const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight; cv.width = w * dpr; cv.height = h * dpr; const g = cv.getContext('2d'); g.scale(dpr, dpr); return { g, w, h }; }

/* ---------------- shell ---------------- */
function renderObs() {
  const c = obsCfg(), el = $('#obs'); if (!el) return;
  if (typeof tipBind === 'function') tipBind(); obsWatch();
  if (!el.dataset.built) {
    el.innerHTML = `<nav class="obs-nav" aria-label="Observatory views">${OBS_VIEWS.map(([k, n, s]) => `<button data-v="${k}"${OBS_ASK[k] ? ` data-ntip="${escHtml(OBS_ASK[k])}"` : ''}><b>${n}</b><small>${s}</small></button>`).join('')}</nav><div class="obs-main"><div class="obs-head" id="obsHead"></div><div class="obs-body" id="obsBody"></div></div>`;
    el.dataset.built = 1;
  }
  obsNavTips(el);
  $$('#obs .obs-nav button').forEach(b => b.classList.toggle('on', b.dataset.v === c.view));
  if (!OBS_VIEWS.some(v => v[0] === c.view)) c.view = 'const';
  if (el.dataset.built && el.querySelectorAll('.obs-nav button').length !== OBS_VIEWS.length) el.dataset.built = '';
  const [, name] = OBS_VIEWS.find(v => v[0] === c.view), src = OBS_SRC[c.view];
  $('#obsHead').innerHTML = `<div class="obs-title"><h3${OBS_ASK[c.view] ? ` tabindex="0" data-tip="${escHtml(OBS_ASK[c.view])}"` : ''}>${name}</h3><span class="obs-sym">${c.view === 'bask' ? 'currency index' : c.view === 'const' || c.view === 'regime' || c.view === 'tap' || c.view === 'scan' ? 'G8 currencies · 16 pairs' : c.view === 'exit' ? 'your closed trades' : pretty(S.set.sym)}</span><span class="obs-asof" id="obsAsOf"></span></div><div class="obs-ctrl" id="obsCtrl">${obsCtrl(c)}</div><a class="obs-src" href="${src[1]}" target="_blank" rel="noopener">${src[0]}</a>`;
  OBS.cache = {};
  obsDraw();
}
/* The menu explains each tool after a short rest of the pointer (OBS_NAV_DELAY), so moving across the menu does not
   flash a tooltip per button; keyboard focus shows it at once. Its own attribute (data-ntip) keeps the page's
   immediate tooltip layer off the menu. */
const OBS_NAV_DELAY = 400;
function obsNavTips(el) {
  if (el.dataset.navTips) return; el.dataset.navTips = 1;
  let tm = 0, on = null;
  const btn = e => e.target.closest && e.target.closest('.obs-nav [data-ntip]');
  const hide = () => { clearTimeout(tm); if (on) { on = null; brTipHide(); } };
  el.addEventListener('mouseover', e => {
    const b = btn(e); if (!b || b === on) return; hide();
    const x = e.clientX, y = e.clientY;
    tm = setTimeout(() => { on = b; brTipShow(b.dataset.ntip, x, y); }, OBS_NAV_DELAY);
  });
  el.addEventListener('mouseout', e => { const b = btn(e); if (b && !(e.relatedTarget && b.contains(e.relatedTarget))) hide(); });
  el.addEventListener('focusin', e => { const b = btn(e); if (!b) return; clearTimeout(tm); on = b; const r = b.getBoundingClientRect(); brTipShow(b.dataset.ntip, r.right, r.top); });
  el.addEventListener('focusout', e => { if (btn(e)) hide(); });
  el.addEventListener('click', e => { if (btn(e)) hide(); });
}
/* Where a view's data comes from and how old it is. The views on the 16 pairs read FX hours (EUR/USD stands for
   them); the others read the open symbol. Exit lab reads closed trades: no market clock. */
const OBS_G8 = ['const', 'regime', 'tap', 'bask'];
const obsSymOf = v => OBS_G8.includes(v) ? 'EURUSD' : S.set.sym;
function obsAsOf() {
  const el = $('#obsAsOf'), v = obsCfg().view; if (!el) return;
  const sym = obsSymOf(v), a = v === 'exit' ? null : Engine.candles[sym];
  if (!a || !a.length) { el.textContent = ''; return; }
  const ms = mktState(sym), at = new Date(a[a.length - 1].time * 1000).toUTCString().replace(/^(\w+), \d+ \w+ \d+ (\d\d:\d\d).*$/, '$1 $2');
  el.textContent = `as of ${at} UTC${ms.open ? '' : ' · ' + ms.label}`;
  el.classList.toggle('closed', !ms.open);
}
/* The guard for tools that need FX ('fx') or one of the 16 G8 pairs ('major'): '' when sym qualifies, otherwise
   the message for the view body, with a button to open EUR/USD. obsDraw applies OBS_NEED[view] before drawing. */
const OBS_NEED = { deja: 'major', dc: 'fx' };
function obsNeed(kind, sym = S.set.sym) {
  if (kind === 'major' ? isMajor(sym) : isFxSym(sym)) return '';
  const m = M(sym) || {}, v = obsCfg().view, tool = (OBS_VIEWS.find(x => x[0] === v) || [, 'This tool'])[1];
  const type = m.type || m.group || 'non-FX', what = isFxSym(sym) ? 'an FX pair outside the 16 G8 pairs' : `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${type} CFD`;
  return `<div class="empty obs-need" role="status"><p><b>${escHtml(tool)}</b> works on ${kind === 'major' ? 'the 16 G8 currency pairs' : 'FX pairs'}; <b>${escHtml(pretty(sym))}</b> is ${escHtml(what)}.</p><button class="ghost sm" data-obs-open="EURUSD">Open EUR/USD</button></div>`;
}
/* Settings without a default in obsCfg (sanitizeState does not know them, so they are not part of the saved state
   and fall back to this value after a reload or an import). */
const OBS_SOFT = { tapScale: 'common', tapCcy: 'all', cFreq: 1 };
function obsCtrl(c) {
  const seg = (k, opts) => `<div class="mini-seg" data-k="${k}">${opts.map(([v, l]) => { const tips = (OBS_CTRL_TIP_V[c.view] && OBS_CTRL_TIP_V[c.view][k]) || OBS_CTRL_TIP[k], tp = tips && tips[v]; return `<button data-val="${v}" class="${String(c[k] ?? OBS_SOFT[k]) === String(v) ? 'on' : ''}"${tp ? ` data-tip="${escHtml(tp)}"` : ''}>${l}</button>`; }).join('')}</div>`;
  switch (c.view) {
    case 'const': return seg('lb', [[240, '4H'], [1440, '1D'], [4320, '3D']]) + `<span class="muted small">returns</span>` + seg('cFreq', [[1, '1m'], [5, '5m'], [15, '15m']]);
    case 'regime': return seg('lb', [[240, '4H'], [1440, '1D'], [4320, '3D']]);
    case 'dc': return `<span class="muted small">Threshold</span>` + seg('dcTh', [[.05, '0.05%'], [.1, '0.10%'], [.2, '0.20%'], [.5, '0.50%']]);
    case 'deja': return seg('dvTf', [[5, '5m'], [15, '15m'], [60, '1H']]) + `<span class="muted small">pattern</span>` + seg('dvW', [[16, '16'], [32, '32'], [64, '64']]) + `<span class="muted small">bars · ${djDur(c.dvW * c.dvTf)}</span><span class="muted small">look ahead</span>` + seg('dvH', [[6, '6'], [12, '12'], [24, '24']]) + `<span class="muted small">bars · ${djDur(c.dvH * c.dvTf)}</span>`;
    case 'rp': return seg('rpTf', [[5, '5m'], [15, '15m'], [60, '1H']]) + seg('rpMode', [['grad', 'Distance'], ['bin', 'Recurrences']]);
    case 'drv': return '';
    case 'clock': return seg('clkAll', [[false, 'This pair'], [true, 'All pairs']]);
    case 'tap': return seg('tapLb', [[240, '4H'], [1440, '1D'], [4320, '3D']]) + `<span class="muted small">sort</span>` + seg('tapSort', [['ret', 'Return'], ['abc', 'A–Z'], ['clu', 'Cluster']]) + `<span class="muted small">scale</span>` + seg('tapScale', [['common', 'Common'], ['pair', 'Per pair']]) + `<span class="muted small">currency</span>` + seg('tapCcy', [['all', 'All'], ...tapG8().map(x => [x, x])]);
  }
  return typeof OBS_CTRL !== 'undefined' && OBS_CTRL[c.view] ? OBS_CTRL[c.view](c, seg) : '';
}
function obsDraw() {
  const c = obsCfg(), b = $('#obsBody'); if (!b) return;
  OBS.key = obsKey(); OBS.missed = false; obsAsOf();
  OBS.closedFor = mktState(obsSymOf(c.view)).open ? '' : `${c.view}|${S.set.sym}`;
  try {
    if (!OBS_VIEWS.some(v => v[0] === c.view)) c.view = 'const';
    const no = OBS_NEED[c.view] ? obsNeed(OBS_NEED[c.view]) : ''; if (no) { b.innerHTML = no; return; }
    (({ const: drawConst, regime: drawRegime, dc: drawDC, deja: drawDeja, rp: drawRP, drv: drawDrivers, clock: drawClock, tap: drawTap })[c.view] || OBS_EXT[c.view])(b, c);
  }
  catch (e) { console.error(e); b.innerHTML = `<div class="empty">Could not compute this view yet: ${escHtml(e.message)}</div>`; }
  obsRefit();
}
/* A canvas is sized from its box when it is drawn (canvasFit). Content added after that (a side panel, a table under
   the plot) can resize the box, and the browser then stretches the bitmap: round dots turn into ellipses, text
   squashes. One frame later every canvas of the view is compared with its box; on a mismatch the view is drawn
   once more at the settled size. */
function obsRefit() {
  if (OBS.refitting) return; // the redraw below does not schedule another check: at most one refit per draw
  requestAnimationFrame(() => {
    const dpr = devicePixelRatio || 1, off = cv => cv.width && cv.clientWidth && (Math.abs(cv.width / dpr - cv.clientWidth) > 1 || Math.abs(cv.height / dpr - cv.clientHeight) > 1);
    if (![...document.querySelectorAll('#obsBody canvas')].some(off)) return;
    OBS.refitting = true; try { obsDraw(); } finally { OBS.refitting = false; }
  });
}
/* The 5 s refresh. A redraw replaces the view's markup, so it waits while the pointer or the focus is inside the view
   (the skipped tick is drawn on leaving), and it is skipped when nothing it reads has changed: with the market
   closed the last bar stays the same, so the view stays still. */
const OBS_LIVE = ['const', 'regime', 'drv', 'clock', 'tap', 'dc', 'rp', 'scan', 'cone'];
function obsKey() { const v = obsCfg().view, sym = obsSymOf(v), a = Engine.candles[sym], k = a && a[a.length - 1]; return `${v}|${S.set.sym}|${sym}|${k ? k.time + ':' + k.close : ''}|${mktState(sym).open}`; }
function obsBusy() { const b = $('#obsBody'); return !!b && (b.matches(':hover') || !!document.activeElement?.closest('#obsBody')); }
function obsTick() {
  const v = obsCfg().view; if (activeTab !== 'obs') return;
  // the as-of time moves with the body: a held-back or static view keeps the time of the data it shows
  if (v === 'bask') { obsAsOf(); if (typeof bkTick === 'function') bkTick(); return; }
  if (!OBS_LIVE.includes(v) || obsKey() === OBS.key) return;
  // drawn while closed, still closed, same view and symbol: nothing it reads can have moved
  if (!mktState(obsSymOf(v)).open && OBS.closedFor === `${v}|${S.set.sym}`) return;
  if (obsBusy()) { OBS.missed = true; return; }
  OBS.cache = {}; obsDraw();
}
function obsResume() { setTimeout(() => { if (OBS.missed && activeTab === 'obs' && !obsBusy()) { OBS.cache = {}; obsDraw(); } }, 0); }

/* ---------------- 1. Constellation: correlation minimum spanning tree ---------------- */
/* 1-minute returns of the 16 pairs over the last lb bars, on the minutes all of them have: a return across a closed
   market (the weekend jump) is left out. still[i]: the pair's quotes barely moved (most returns zero), so its
   correlations say nothing. off: the window ends off bars before the last (off = lb: the previous window).
   fq: the returns summed over fq-minute buckets of the UTC clock (complete buckets only): 1, 5 or 15 minutes. */
function corrMatrix(lb, off = 0, fq = 1) {
  const syms = Engine.PAIRS.map(p => p.sym), per = syms.map(s => {
    const c = Engine.candles[s], a = c.slice(Math.max(0, c.length - off - lb - 1), c.length - off), T = a.map(k => k.time), { r, idx } = gapRets(T, a.map(k => k.close));
    return new Map(idx.map((i, k) => [T[i], r[k]]));
  });
  const times = [...per[0].keys()].filter(t => per.every(m => m.has(t)));
  let R = per.map(m => times.map(t => m.get(t)));
  if (fq > 1) {
    const groups = []; let g = null, key = null;
    times.forEach((t, k) => { const b = Math.floor((t - 60) / (fq * 60)); if (b !== key) { key = b; g = []; groups.push(g); } g.push(k); });
    const full = groups.filter(x => x.length === fq);
    R = R.map(r => full.map(x => x.reduce((s2, k) => s2 + r[k], 0)));
  }
  const still = R.map(r => r.filter(v => v !== 0).length < r.length / 2);
  const C = syms.map((_, i) => syms.map((__, j) => i === j ? 1 : 0));
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) C[i][j] = C[j][i] = Engine.corr(R[i], R[j]);
  return { syms, R, C, still };
}
function mst(D) { // Prim
  const n = D.length, inT = Array(n).fill(false), best = Array(n).fill(Infinity), par = Array(n).fill(-1), E = []; best[0] = 0;
  for (let k = 0; k < n; k++) {
    let u = -1; for (let i = 0; i < n; i++) if (!inT[i] && (u < 0 || best[i] < best[u])) u = i;
    inT[u] = true; if (par[u] >= 0) E.push([par[u], u]);
    for (let v = 0; v < n; v++) if (!inT[v] && D[u][v] < best[v]) { best[v] = D[u][v]; par[v] = u; }
  }
  return E;
}
/* The tree drawn radially: its central pair in the middle, each branch in its own angular sector sized by its
   leaves, one ring per step from the centre. A tree laid out this way never crosses its own lines. */
function radialTree(syms, E, deg, W, H) {
  const n = syms.length, adj = syms.map(() => []); E.forEach(([a, b]) => { adj[a].push(b); adj[b].push(a); });
  // the centre of the tree (fewest steps to its farthest pair), the most links on a tie: the shallowest rings
  const ecc = syms.map((_, r) => { const d = Array(n).fill(-1), q = [r]; d[r] = 0; for (let k = 0; k < q.length; k++) for (const v of adj[q[k]]) if (d[v] < 0) { d[v] = d[q[k]] + 1; q.push(v); } return Math.max(...d); });
  const root = syms.map((_, i) => i).sort((a, b) => ecc[a] - ecc[b] || deg[b] - deg[a])[0], par = Array(n).fill(-1), depth = Array(n).fill(0), order = [root], kids = syms.map(() => []);
  const seen = new Set([root]);
  for (let k = 0; k < order.length; k++) { const u = order[k]; for (const v of adj[u]) if (!seen.has(v)) { seen.add(v); par[v] = u; depth[v] = depth[u] + 1; kids[u].push(v); order.push(v); } }
  const leaves = Array(n).fill(0); for (let k = order.length - 1; k >= 0; k--) { const u = order[k]; leaves[u] = kids[u].length ? kids[u].reduce((s2, v) => s2 + leaves[v], 0) : 1; }
  const maxD = Math.max(1, ...depth), ang = Array(n).fill(0), cx = W / 2, cy = H / 2, rx = W / 2 - 70, ry = H / 2 - 34;
  const place = (u, a0, a1) => { ang[u] = (a0 + a1) / 2; let a = a0; for (const v of kids[u]) { const span = (a1 - a0) * leaves[v] / leaves[u]; place(v, a, a + span); a += span; } };
  place(root, -Math.PI / 2, Math.PI * 1.5);
  return syms.map((_, i) => ({ x: cx + Math.cos(ang[i]) * rx * depth[i] / maxD, y: cy + Math.sin(ang[i]) * ry * depth[i] / maxD }));
}
/* The tightest link in words, by its strength: only beyond ±0.7 are two pairs close to the same trade. */
function constTightSay(r) {
  const a = Math.abs(r);
  if (a >= .7) return r >= 0 ? 'they move almost as one: a position on each is close to the same trade' : 'they move almost as one in opposite directions: buying one and selling the other is close to the same trade';
  if (a >= .4) return `they share part of their moves (${r >= 0 ? 'the same way' : 'opposite ways'}): related, not interchangeable`;
  return 'only weakly linked: even the strongest link in the tree is loose right now';
}
// the tree as a set of links named by their pairs, to compare two windows
const constLinks = (syms, E) => new Set(E.map(([a, b]) => [syms[a], syms[b]].sort().join('|')));
const constDist = C => C.map(r => r.map(x => Math.sqrt(Math.max(0, 2 * (1 - Math.abs(x))))));
/* a link label goes where it covers no node and no node name (a box from the circle down to its label): along the
   line, nearest the middle first; none fits = no label (ρ is in the link and node tips) */
function constLabAt(p, q, P, R) {
  for (const t of [.5, .4, .6, .32, .68, .25, .75]) {
    const x = p.x + (q.x - p.x) * t, y = p.y + (q.y - p.y) * t - 4;
    const clear = P.every((n, i) => { const hw = Math.max(R[i] + 2, 30); return x + 15 <= n.x - hw || x - 15 >= n.x + hw || y + 3 <= n.y - R[i] - 2 || y - 9 >= n.y + R[i] + 17; });
    if (clear && P.every((n, i) => Math.abs(x - n.x) >= R[i] + 14 || Math.abs(y - 4 - n.y) >= R[i] + 8)) return { x, y };
  }
  return null;
}
const CONST_STABLE = 12; // links of 15 shared with the previous window for the tree to be read as settled
/* ρ now against ρ normal. Normal = the same link over the whole history kept (at most a week of trading), which
   contains the window now: for nested windows of n1 ⊂ n2 returns, z = atanh(ρ) differs between them with a standard
   error of √(1/(n1−3) − 1/(n2−3)) when the link has not changed and returns are independent and normal (Fisher).
   They are not (fat tails, news jumps on one currency, activity by hour), so that error is widened by k: how much more
   z actually varies between consecutive windows of the history than Fisher says (constCalib, never below 1). A link
   is unusual beyond CONST_BRK_Z widened errors: 3, because 120 links are checked at once (at 2 about six would cross
   by chance on every window). Under CONST_MIN_N returns now, nothing is judged. */
const CONST_BRK_Z = 3, CONST_MIN_N = 30, CONST_NORM_MAX = 10080;
const constZ = r => Math.atanh(clamp(r, -.999999, .999999));
/* k: the history's returns (one array per pair) cut into consecutive windows of len returns from the end (at least 3
   windows, else shorter ones); per link the variance of z between windows, pooled over the links, against Fisher's
   1/(len−3). */
function constCalib(R, len, skip = () => false) {
  const N = R[0] ? R[0].length : 0;
  if (N / len < 3) len = Math.floor(N / 3);
  const K = Math.floor(N / len);
  if (K < 3 || len < CONST_MIN_N) return { k: 1, raw: null, K, len };
  const win = R.map(r => Array.from({ length: K }, (_, w) => r.slice(N - (w + 1) * len, N - w * len)));
  let ss = 0, df = 0;
  for (let i = 0; i < R.length; i++) for (let j = i + 1; j < R.length; j++) {
    if (skip(i) || skip(j)) continue;
    const zs = win[i].map((a, w) => constZ(Engine.corr(a, win[j][w]))), m = mean(zs);
    ss += zs.reduce((s2, v) => s2 + (v - m) ** 2, 0); df += K - 1;
  }
  const raw = df ? Math.sqrt(ss / df * (len - 3)) : null;
  return { k: Math.max(1, raw || 1), raw, K, len };
}
function constUnusual(syms, Cn, n1, Cm, n2, skip = () => false, k = 1) {
  if (n1 < CONST_MIN_N || n2 - n1 < CONST_MIN_N) return { se: null, links: [], thin: n1 < CONST_MIN_N };
  const se = k * Math.sqrt(1 / (n1 - 3) - 1 / (n2 - 3)), z = constZ, links = [];
  for (let i = 0; i < syms.length; i++) for (let j = i + 1; j < syms.length; j++) {
    if (skip(i) || skip(j) || !isFinite(Cn[i][j]) || !isFinite(Cm[i][j])) continue;
    const dz = Math.abs(z(Cn[i][j]) - z(Cm[i][j])) / se;
    if (dz > CONST_BRK_Z) links.push({ a: syms[i], b: syms[j], now: Cn[i][j], norm: Cm[i][j], dz, kind: Math.abs(Cn[i][j]) < Math.abs(Cm[i][j]) ? 'broke' : 'new' });
  }
  return { se, links: links.sort((x, y) => y.dz - x.dz) };
}
const constFq = c => [1, 5, 15].includes(+c.cFreq) ? +c.cFreq : 1;
const constRetW = fq => fq === 1 ? '1-minute' : `${fq}-minute`;
const constMeanR = C => { let s = 0, k = 0; for (let i = 0; i < C.length; i++) for (let j = i + 1; j < C.length; j++) { s += Math.abs(C[i][j]); k++; } return s / Math.max(1, k); };
function drawConst(b, c) {
  const fq = constFq(c), { syms, R, C, still } = corrMatrix(c.lb, 0, fq), n = syms.length, nR = R[0] ? R[0].length : 0;
  const D = constDist(C), E = mst(D), deg = syms.map((_, i) => E.filter(e => e.includes(i)).length);
  // the same tree one window earlier: how many of its links persist (a tree that reshuffles is read loosely)
  const lbN = { 240: '4H', 1440: '1D', 4320: '3D' }[c.lb] || `${c.lb} bars`;
  let stab = null;
  const pc = corrMatrix(c.lb, c.lb, fq);
  // only a previous window as long as this one is a fair comparison (3D has no full 3 days before it in the history)
  if (pc.R[0] && nR && pc.R[0].length >= nR * .95) { const now = constLinks(syms, E), pE = constLinks(syms, mst(constDist(pc.C))); stab = { same: [...now].filter(k => pE.has(k)).length, total: E.length, prev: pE }; }
  OBS.constStab = stab && { same: stab.same, total: stab.total }; OBS.constTree = { E, syms };
  // ρ normal: the whole history kept, at the same return interval (constUnusual)
  const normLb = Math.min(CONST_NORM_MAX, ...syms.map(s => Engine.candles[s].length - 1));
  let unu = { se: null, links: [], thin: nR < CONST_MIN_N }, n2 = 0, cal = { k: 1, raw: null, K: 0, len: 0 };
  if (normLb >= c.lb * 1.5) {
    const nm = corrMatrix(normLb, 0, fq), sk = i => still[i] || nm.still[i]; n2 = nm.R[0] ? nm.R[0].length : 0;
    cal = constCalib(nm.R, nR, sk); unu = constUnusual(syms, C, nR, nm.C, n2, sk, cal.k);
  }
  OBS.constUnu = { normLb, n1: nR, n2, se: unu.se, k: cal.k, cal, links: unu.links, thin: !!unu.thin };
  const unuKey = new Map(unu.links.map(l => [[l.a, l.b].sort().join('|'), l]));
  const normDays = `${(normLb / 1440).toFixed(1)} days of trading`;
  // what the interval changes here: mean |ρ| of the 120 links at 1, 5 and 15 minutes on the same window (Epps)
  const epps = [1, 5, 15].map(f => { const m = f === fq ? { C, R } : corrMatrix(c.lb, 0, f); return { fq: f, r: constMeanR(m.C), n: m.R[0] ? m.R[0].length : 0 }; });
  OBS.constEpps = epps;
  b.innerHTML = `<div class="obs-split"><div class="obs-svg" id="constWrap"></div><aside class="obs-side" id="constSide"></aside></div>`;
  const wrap = $('#constWrap'), W = wrap.clientWidth || 640, H = wrap.clientHeight || 340;
  const P = radialTree(syms, E, deg, W, H), col = chartColors(), cPos = cssv('--div-pos'), cNeg = cssv('--div-neg'), info = cssv('--info');
  const vol = R.map(r => stdev(r)), vmx = Math.max(...vol), ret = syms.map(s => { const a = Engine.candles[s], k = a.length; return Math.log(a[k - 1].close / a[Math.max(0, k - 1 - Math.min(c.lb, 240))].close); });
  const rad = vol.map(v => 9 + v / vmx * 13);
  // the tree covers the 16 pairs only: a CFD position is listed as left out, never looked up in the matrix
  const heldAll = [...new Set(S.positions.map(p => p.sym))], held = new Set(heldAll.filter(s => syms.includes(s))), outside = heldAll.filter(s => !held.has(s));
  const inPrev = (a, bb) => stab.prev.has([syms[a], syms[bb]].sort().join('|'));
  // the title keeps the ASCII number (read back by the colour tests: v1-colors parses 'ρ -0.82|')
  const edgeTip = (a, bb, r) => `${pretty(syms[a])} ↔ ${pretty(syms[bb])} · ρ ${r.toFixed(2)}|${Math.abs(r) >= .7 ? 'Strongly' : Math.abs(r) >= .4 ? 'Moderately' : 'Weakly'} ${r >= 0 ? 'correlated: they tend to move the same way' : 'inversely correlated: they tend to move opposite ways'}. ${Math.abs(r) >= .7 ? (r >= 0 ? 'A position on each is close to doubling the same bet.' : 'Buying one and selling the other is close to doubling the same bet.') : 'They share part of their moves.'}${stab ? (inPrev(a, bb) ? ` Also a link in the previous ${lbN}.` : ` Not a link in the previous ${lbN}.`) : ''}${unuOf(a, bb) ? ` Unusual now: ${unuSay(unuOf(a, bb))}.` : ''}`;
  const unuOf = (a, bb) => unuKey.get([syms[a], syms[bb]].sort().join('|'));
  const unuSay = l => `${l.kind} — ρ ${obsMinus(l.norm.toFixed(2))} normal (the whole history), ${obsMinus(l.now.toFixed(2))} now, ${l.dz.toFixed(1)} standard errors apart`;
  const tx = cssv('--tx');
  const edges = E.map(([a, bb]) => { const r = C[a][bb], w = .8 + Math.abs(r) * 4.2, at = constLabAt(P[a], P[bb], P, rad), u = unuOf(a, bb); return `<g data-tip="${escHtml(edgeTip(a, bb, r))}"><line x1="${P[a].x}" y1="${P[a].y}" x2="${P[bb].x}" y2="${P[bb].y}" stroke="transparent" stroke-width="14"/><line x1="${P[a].x}" y1="${P[a].y}" x2="${P[bb].x}" y2="${P[bb].y}" stroke="${r >= 0 ? cPos : cNeg}" stroke-opacity="${.25 + Math.abs(r) * .6}" stroke-width="${w}" stroke-linecap="round"/></g>${u ? `<line class="const-unu" data-kind="${u.kind}" x1="${P[a].x}" y1="${P[a].y}" x2="${P[bb].x}" y2="${P[bb].y}" stroke="${tx}" stroke-width="${(w + 5).toFixed(1)}" stroke-opacity=".55" stroke-dasharray="2 6" fill="none" pointer-events="none"/>` : ''}${at ? `<text x="${at.x}" y="${at.y}" class="edge-lab">${obsMinus(r.toFixed(2))}</text>` : ''}`; }).join('');
  // each node names its own links, so ρ is readable from the keyboard and where a label had no room
  const links = i => E.filter(e => e.includes(i)).map(([a, bb]) => { const j = a === i ? bb : a; return [j, C[i][j]]; }).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const nodeTip = (s, i, rr) => `${pretty(s)}|Last 4 hours of trading: ${obsBp(rr)}.${still[i] ? ' Its quotes did not move in the window, so its links say nothing.' : ''} Volatility ${(vol[i] * 1e4).toFixed(2)} bp per ${fq === 1 ? 'minute' : fq + ' minutes'} (${vol[i] >= vmx * .75 ? 'among the most active' : vol[i] <= vmx * .4 ? 'among the quietest' : 'average'}). Linked to ${links(i).map(([j, r]) => `${pretty(syms[j])} (ρ ${obsMinus(r.toFixed(2))})`).join(', ')}. ${s === S.set.sym ? 'The open pair.' : 'Click or press Enter to open it on the chart.'}${held.has(s) ? ' You hold a position on it.' : ''}`;
  const nodes = syms.map((s, i) => { const r = rad[i], rr = ret[i], a = Math.min(1, Math.abs(rr) * 1e4 / 25); return `<g class="cnode ${s === S.set.sym ? 'cur' : ''} ${held.has(s) ? 'held' : ''}" data-sym="${s}" tabindex="0" role="button" aria-label="${escHtml(pretty(s))}" data-tip="${escHtml(nodeTip(s, i, rr))}" transform="translate(${P[i].x},${P[i].y})"><circle r="${r}" fill="${rr >= 0 ? col.up : col.dn}" fill-opacity="${(.45 + a * .5).toFixed(3)}" stroke="${s === S.set.sym ? col.acc : held.has(s) ? info : col.line}" stroke-width="${s === S.set.sym || held.has(s) ? 2.4 : 1.2}"/><text y="${r + 13}" class="node-lab">${pretty(s)}</text></g>`; }).join('');
  wrap.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="group" aria-label="Minimum spanning tree of pair correlations; each pair opens on Enter">${edges}${nodes}</svg>`;
  // insights. Hubs: the most links, every pair tied with the third included
  const byDeg = syms.map((s, i) => [s, deg[i]]).sort((a, b2) => b2[1] - a[1] || a[0].localeCompare(b2[0])), third = byDeg[2][1];
  const hubs = byDeg.filter(([, d]) => d >= third && d >= 2);
  let tight = null; E.forEach(([a, bb]) => { if (!tight || Math.abs(C[a][bb]) > Math.abs(tight.r)) tight = { a, b: bb, r: C[a][bb] }; });
  // frozen quotes have no correlation (ρ 0, the largest distance): they are named, never offered as independent
  const iso = syms.map((s, i) => [s, Math.min(...D[i].filter((_, j) => j !== i)), i]).filter(x => !still[x[2]]).sort((a, b2) => b2[1] - a[1])[0];
  const frozen = syms.filter((_, i) => still[i]);
  /* positions read with their direction: two positions whose P&L moves together (same side on ρ > 0, opposite sides on
     ρ < 0) are one bet twice; the other way round they offset each other (a hedge). Net lots per pair. */
  const net = {}; for (const p of S.positions) if (held.has(p.sym)) net[p.sym] = (net[p.sym] || 0) + (p.side === 'buy' ? 1 : -1) * (+p.lots || 0);
  const hs = [...held].filter(s => net[s]), clash = [], hedge = [], sideW = s => net[s] > 0 ? 'long' : 'short';
  for (let i = 0; i < hs.length; i++) for (let j = i + 1; j < hs.length; j++) {
    const a = syms.indexOf(hs[i]), bb = syms.indexOf(hs[j]), r = C[a][bb], pr = Math.sign(net[hs[i]]) * Math.sign(net[hs[j]]) * r;
    if (Math.abs(r) > .7) (pr > 0 ? clash : hedge).push([hs[i], hs[j], r]);
  }
  // a diversifier only exists against something held: the pair whose strongest |ρ| to the held pairs is the smallest
  const div = hs.length ? syms.map((s, i) => [s, i]).filter(([s, i]) => !held.has(s) && !still[i]).map(([s, i]) => { const w = hs.map(h => [h, C[i][syms.indexOf(h)]]).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]))[0]; return { s, m: Math.abs(w[1]), w }; }).sort((x, y) => x.m - y.m)[0] : null;
  const firm = stab && stab.same >= CONST_STABLE;
  const stabTxt = !stab ? '' : `<p class="small">${obsV(`${stab.same} of ${stab.total}`, '',`Tree stability|The same tree built on the ${lbN} before this one shares ${stab.same} of its ${stab.total} links. ${firm ? 'Most links persist: the structure is settled on this window.' : `Fewer than ${CONST_STABLE} persist: the tree reshuffles from one window to the next, so read single links loosely.`}`)} links also in the previous ${lbN}${firm ? ': a settled structure.' : ': the tree is reshuffling, so read single links loosely.'}</p>`;
  // net currency exposure of all positions (exposureOf, as the Exposure panel), the currencies of a hub pair marked
  const hubC = new Map(); hubs.forEach(([s]) => { const m = M(s); [m.base, m.quote].forEach(cc => hubC.set(cc, [...(hubC.get(cc) || []), s])); });
  const expo = Object.entries(exposureOf().ccy).filter(([, v]) => isFinite(v) && Math.abs(v) > 1).sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
  const expRow = ([cc, v]) => { const hp = hubC.get(cc), sd = v > 0 ? 'long' : 'short'; return `<div class="const-exp${hp ? ' hubc' : ''}" data-ccy="${escHtml(cc)}" tabindex="0" data-tip="${escHtml(`${cc} · net ${sd} ${usdFmt(Math.abs(v))}|The net USD notional of your open positions in ${cc}, the same split as the Exposure panel: a pair is long its base currency and short its quote.${hp ? ` ${cc} is in the hub pair${hp.length > 1 ? 's' : ''} ${hp.map(pretty).join(', ')}: ${hp.length > 1 ? 'they share' : 'it shares'} moves with many pairs of the tree, so this exposure overlaps with much of the board. A count of links, not a cause.` : ''}`)}"><b>${escHtml(cc)}</b><span class="mono">${expK(v)}</span><span>${sd}</span>${hp ? `<small>hub: ${hp.map(pretty).join(', ')}</small>` : ''}</div>`; };
  const expTxt = expo.length ? `${expo.map(expRow).join('')}<p class="small muted">Net USD notional per currency.${expo.some(([cc]) => hubC.has(cc)) ? ' Marked: a currency of a hub pair.' : ''}</p>` : '<p>No open positions: no currency exposure to show.</p>';
  // ρ now against ρ normal
  const un = OBS.constUnu, unuMax = 8;
  const unuPill = l => `<span class="pill const-unu-pill" tabindex="0" data-kind="${l.kind}" data-tip="${escHtml(`${pretty(l.a)} ↔ ${pretty(l.b)} · ${l.kind}|ρ ${obsMinus(l.now.toFixed(2))} now against ${obsMinus(l.norm.toFixed(2))} normal (the whole history, ${normDays}): ${l.kind === 'broke' ? 'weaker' : 'stronger'} than usual by ${l.dz.toFixed(1)} standard errors of the difference (Fisher z). It describes this window against the history; it does not say what comes next.`)}">${pretty(l.a)}–${pretty(l.b)} <b>${l.kind}</b> ${obsMinus(l.norm.toFixed(2))} → ${obsMinus(l.now.toFixed(2))}</span>`;
  const unuTxt = un.thin ? `<p class="small">Too few returns to compare with normal: n = ${nR} per pair now (needs ${CONST_MIN_N}).</p>`
    : !un.n2 ? `<p class="small">Not enough history beyond this window to define a normal.</p>`
    : `${unu.links.length ? unu.links.slice(0, unuMax).map(unuPill).join('') + (unu.links.length > unuMax ? `<span class="small muted"> +${unu.links.length - unuMax} more</span>` : '') : `<p>No link is unusual right now: every ρ is within ${CONST_BRK_Z} standard errors of its normal.</p>`}
      ${obsHow(`Marked beyond ${CONST_BRK_Z} standard errors of normal. A single mark is most likely a sampling swing.`, `<p class="small muted">All 120 links, ρ now (n =${nR} ${constRetW(fq)} returns) against the whole history, ${normDays} (n = ${un.n2}). Marked beyond ${obsV(`${CONST_BRK_Z} standard errors`, '', `How a link is marked|z = atanh(ρ) now against z over the whole history, which contains this window: their difference has a standard error of √(1/(n₁−3) − 1/(n₂−3)) for independent normal returns (Fisher)${cal.raw ? `, widened ×${cal.k.toFixed(2)} because ρ varies that much more between ${cal.K} consecutive windows of ${cal.len} returns in the history (fat tails, news, activity by hour)` : ''}. Beyond ${CONST_BRK_Z} of them: with 120 links checked, about one window in four still shows a mark by chance alone. On this simulated market the links between currencies are set in the engine and shift only with each currency's activity by hour, so a mark is most likely a sampling swing.`)}${cal.raw ? `, widened ×${cal.k.toFixed(2)} to this market's own spread` : ''}. Broke = weaker than normal, new = stronger. A single mark is most likely a sampling swing.</p>`)}`;
  // the return interval: what changes with it on real data, and what this market shows on the same window
  const eRange = Math.max(...epps.map(x => x.r)) - Math.min(...epps.map(x => x.r));
  const eppsTxt = `<p class="small">On real FX data ρ usually rises with the interval (the Epps effect: pairs are not quoted at the same instants, which damps correlations measured on short returns). Here every pair is quoted on the same clock. On this window, mean |ρ| of the 120 links: ${epps.map(x => `${x.fq}m ${obsV(x.r.toFixed(2), '', `Mean |ρ| at ${x.fq} minute${x.fq > 1 ? 's' : ''}|The average strength of the 120 links on ${constRetW(x.fq)} returns of this window: ${x.n} returns per pair.${x.n < CONST_MIN_N ? ' Too few for a stable value.' : ''}`)} (n = ${x.n})`).join(' · ')}: ${eRange <= .05 ? 'about the same at every interval, no Epps effect here.' : 'they differ by more than 0.05; longer intervals give fewer returns, and the noise of a short sample raises a mean of |ρ|.'}</p>${nR < CONST_MIN_N ? `<p class="small">Thin data: ${nR} returns per pair on this window at ${fq}m, too few for a stable ρ; read the tree loosely.</p>` : ''}`;
  const notIn = syms.includes(S.set.sym) ? '' : (() => { const m = M(S.set.sym) || {}, type = m.type || m.group || 'non-FX'; return `<div class="ins const-not"><p><b>${escHtml(pretty(S.set.sym))}</b> is not in the G8 tree: ${isFxSym(S.set.sym) ? 'an FX pair outside the 16 pairs of the G8 currencies' : `${/^[aeiou]/i.test(type) ? 'an' : 'a'} ${escHtml(type)} CFD`}, so it has no node here.</p></div>`; })();
  $('#constSide').innerHTML = `${notIn}
    <div class="ins"><label>Hubs — pairs with the most links</label>${hubs.map(([s, d]) => `<button class="pill" data-sym="${s}" data-tip="${escHtml(`${pretty(s)} · ${d} links|Directly linked to ${d} pairs in the tree: its moves overlap with each of them. A count of links, not a cause: it does not mean this pair moves the others. Click to open it.`)}">${pretty(s)} <b>${d}</b></button>`).join('')}${stabTxt}</div>
    <div class="ins const-unu-list"><label>Unusual links now</label>${unuTxt}</div>
    <div class="ins"><label>Tightest link</label><div class="obs-hero"><b class="mono">ρ ${obsMinus(tight.r.toFixed(2))}</b><span>${pretty(syms[tight.a])} – ${pretty(syms[tight.b])}</span></div><p><b>${pretty(syms[tight.a])}</b> and <b>${pretty(syms[tight.b])}</b> (${obsV(`ρ ${obsMinus(tight.r.toFixed(2))}`, Math.abs(tight.r) >= .7 ? 'wn' : '', `Correlation ${obsMinus(tight.r.toFixed(2))}|The strongest link in the tree. From −1 to +1; beyond ±0.7 the two pairs are close to the same trade.`)}): ${constTightSay(tight.r)}.${stab ? (inPrev(tight.a, tight.b) ? ` Also a link in the previous ${lbN}.` : ` Not a link in the previous ${lbN}.`) : ''}</p></div>
    ${div ? `<div class="ins"><label>Least linked to your positions</label><p><b>${pretty(div.s)}</b>: at most ${obsV(`|ρ| ${div.m.toFixed(2)}`, '', `Strongest link to a held pair|${pretty(div.s)} against ${pretty(div.w[0])}: ρ ${obsMinus(div.w[1].toFixed(2))}. The smallest such value among the pairs you do not hold, on this window only.`)} with your positions (strongest with ${pretty(div.w[0])}): the candidate diversifier among the 16 pairs on this window, not a recommendation to trade it.</p></div>` : ''}
    <div class="ins"><label>Most independent pair</label><p>${iso ? `<b>${pretty(iso[0])}</b> sits furthest from everything else (${obsV(`d ${iso[1].toFixed(2)}`, '', `Correlation distance ${iso[1].toFixed(2)}|To its closest neighbour. 0 = moves as one, 1.41 = unrelated; the largest such distance among the 16 pairs.`)}): even its closest neighbour shares little of its moves.` : 'None measurable.'}${frozen.length ? ` Left out: ${frozen.map(s => `<b>${escHtml(pretty(s))}</b>`).join(', ')} — ${frozen.length > 1 ? 'their quotes' : 'its quotes'} did not move in the window, so ${frozen.length > 1 ? 'they have' : 'it has'} no correlation to measure.` : ''}</p></div>
    <div class="ins"><label>Your positions</label><p>${!hs.length ? (outside.length ? 'No open position on a pair in this tree.' : 'No open positions. Held pairs carry a ring.') : clash.length || hedge.length ? [...clash.map(([a, bb, r]) => `<span class="st-bad">${pretty(a)} ${sideW(a)} + ${pretty(bb)} ${sideW(bb)}</span>: ${r > 0 ? '' : 'inversely '}correlated (ρ ${obsMinus(r.toFixed(2))}) and held ${r > 0 ? 'the same way' : 'opposite ways'}, so they win and lose together — concentrated risk.`), ...hedge.map(([a, bb, r]) => `<span class="st-ok">${pretty(a)} ${sideW(a)} + ${pretty(bb)} ${sideW(bb)}</span>: ${r > 0 ? '' : 'inversely '}correlated (ρ ${obsMinus(r.toFixed(2))}) and held ${r > 0 ? 'opposite ways' : 'the same way'}, so one offsets the other — a hedge, not added risk.`)].join('<br>') : `<span class="st-ok">Held pairs are not strongly linked</span> — risk is spread.`}${outside.length ? `${hs.length ? '<br>' : ' '}Not part of this tree: ${outside.map(s => `<b>${escHtml(pretty(s))}</b>`).join(', ')} (the tree covers the 16 pairs of the G8 currencies, so the links of other instruments to your pairs are not shown).` : ''}</p></div>
    <div class="ins const-expo"><label>Your currency exposure</label>${expTxt}</div>
    <div class="ins"><label>Return interval · ${fq}m</label>${eppsTxt}</div>
    ${obsHow('Only the drawn links carry meaning: adjacent pairs are directly correlated, the distance on the screen means nothing.', `<p class="small muted">Each pair is linked to its closest neighbour by correlation distance d = √(2(1−|ρ|)) on ${constRetW(fq)} returns; the tree keeps only the ${n - 1} strongest links that connect everything. Only the drawn links carry meaning: adjacent pairs are directly correlated; further along a branch is not implied, and the distance on the screen means nothing. Returns across a closed market (the weekend) are left out.</p>`)}
    <p class="small muted const-leg">${obsSw('--div-pos', 'pos', 'move together (ρ ≥ 0)')} ${obsSw('--div-neg', 'neg', 'move opposite (ρ < 0)')} <span style="white-space:nowrap">line width = strength of ρ</span> ${obsSw('--up', 'up', 'up over 4h of trading')} ${obsSw('--dn', 'dn', 'down over 4h of trading')} <span style="white-space:nowrap">node size = volatility</span> <span style="white-space:nowrap"><i class="const-ring" aria-hidden="true" style="border-color:var(--acc)"></i>open pair</span> <span style="white-space:nowrap"><i class="const-ring" aria-hidden="true" style="border-color:var(--info)"></i>a pair you hold a position on</span> <span style="white-space:nowrap"><i class="const-dash" aria-hidden="true"></i>unusual against its normal</span></p>`;
  b.querySelectorAll('[data-sym]').forEach(x => x.addEventListener('click', () => setSymbol(x.dataset.sym)));
  // an SVG node has no .click(): Enter / Space open it here, before the page's generic role="button" handler
  wrap.addEventListener('keydown', e => { const g = e.target.closest && e.target.closest('.cnode'); if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); setSymbol(g.dataset.sym); } });
}

/* Teach me for the Constellation: every part of the tool with the values on screen now (teachTour, brief.js) */
function constTeach() {
  if (typeof teachTour !== 'function' || !OBS.constTree) return;
  const c = obsCfg(), fq = constFq(c), { syms, C, still } = corrMatrix(c.lb, 0, fq), { E } = OBS.constTree;
  const lbN = { 240: '4 hours', 1440: '1 day', 4320: '3 days' }[c.lb] || `${c.lb} bars`, P = pretty;
  const deg = syms.map((_, i) => E.filter(e => e.includes(i)).length);
  const hubI = deg.indexOf(Math.max(...deg)), hub = syms[hubI];
  let tight = null; E.forEach(([a, b]) => { if (!tight || Math.abs(C[a][b]) > Math.abs(tight.r)) tight = { a: syms[a], b: syms[b], r: C[a][b] }; });
  const neg = E.map(([a, b]) => ({ a: syms[a], b: syms[b], r: C[a][b] })).filter(x => x.r < 0).sort((x, y) => x.r - y.r)[0];
  const D = constDist(C), iso = syms.map((s2, i) => [s2, Math.min(...D[i].filter((_, j) => j !== i)), i]).filter(x => !still[x[2]]).sort((a, b) => b[1] - a[1])[0];
  const r2 = v => obsMinus(v.toFixed(2)), st = OBS.constStab, un = OBS.constUnu, ep = OBS.constEpps || [];
  const Q = sel => () => document.querySelector(sel);
  const ins = t => () => [...document.querySelectorAll('#constSide .ins')].find(x => ((x.querySelector('label') || {}).textContent || '').startsWith(t));
  const node = s2 => () => document.querySelector(`#constWrap .cnode[data-sym="${s2}"]`);
  const edge = (a, b) => () => [...document.querySelectorAll('#constWrap svg > g[data-tip]')].find(g => { const t = g.dataset.tip.split('|')[0]; return t.includes(P(a)) && t.includes(P(b)); });
  const held = [...new Set(S.positions.map(p => p.sym))].filter(x => syms.includes(x));
  teachTour([
    [Q('#obs .obs-nav'), 'Observatory tools', () => [
      'The Observatory is a set of research tools that look at the market in ways a price chart cannot: correlation structure, memory, activity by hour, analogues, and more. Each entry names the tool and the question it answers.',
      'Constellation (highlighted) answers: which of the 16 pairs of the G8 currencies move together right now. It covers FX pairs only; CFDs are not part of it.',
      'Use the Constellation before you add a position: it tells you whether the new trade is really new, or the same bet you already hold under another name.']],
    [Q('#obsHead .obs-title'), 'Title and data', () => [
      `Constellation on the G8 currencies, 16 pairs. The time after “as of” is the last bar used${mktState('EURUSD').open ? '' : '; FX is closed now, so the picture is the one at the close'}.`,
      'Hover the title for the one-line question the tool answers.',
      'Check the time first: a structure measured before the weekend says how the pairs moved then, not how they will move at the open.']],
    [Q('#obsCtrl [data-k="lb"]'), 'Window: 4H · 1D · 3D', () => [
      `How much history the correlations are measured on. Now: ${lbN} of trading.`,
      '4H is the most recent picture and the noisiest; 3D the steadiest. A link that appears on all three windows is real structure; one that shows only on 4H may be a passing coincidence.',
      'Switch between the windows before relying on a link. For a trade held for hours look at 4H and 1D; for days, at 3D.']],
    [Q('#obsCtrl [data-k="cFreq"]'), 'Returns: 1m · 5m · 15m', () => [
      `The step of the price changes compared: now ${fq}-minute returns.`,
      'Two pairs are correlated when their returns go up and down together at the same steps. Longer steps mean fewer returns, so ρ is noisier on a short window, but closer to what a slower trader experiences.',
      'Keep 1m for the finest picture; use 15m with the 3D window to check that a link holds for slower trading too.']],
    [Q('#obsHead .obs-src'), 'Research basis', () => [
      'The paper behind the method: Mantegna (1999) used a minimum spanning tree of correlations to show the hidden structure of a market.',
      'The method is standard in academic finance; the link opens the paper.',
      'Read it if you want to know why only the tree’s links are drawn and why the distance is √(2(1−|ρ|)).']],
    [Q('#constWrap svg'), 'The tree', () => [
      `Each circle is one of the 16 pairs; each line a direct link. Of all ${syms.length * (syms.length - 1) / 2} possible pairs of pairs, the tree keeps only the ${E.length} strongest links that connect everything.`,
      'Only the drawn lines mean something: two pairs joined by a line move together (or opposite). Two pairs far apart on a branch are NOT implied to be related, and where a circle sits on the screen means nothing.',
      'Look for clusters: a group of circles joined by thick lines is one trade expressed several ways.']],
    [node(hub), 'A pair (circle)', () => [
      `${P(hub)}: the colour is its move over the last 4 hours of trading (green up, red down; deeper = larger), the size its volatility over the window (bigger = more active).`,
      'Hover a circle for its exact return, its volatility in basis points and the list of its links with their ρ.',
      'Click a circle (or press Enter) to open that pair on the chart and in every panel of the terminal.']],
    [edge(tight.a, tight.b), 'A link (line)', () => [
      `${P(tight.a)} ↔ ${P(tight.b)}, ρ ${r2(tight.r)}. ρ is the correlation of their returns, from −1 to +1.`,
      'Orange: they move the same way (ρ ≥ 0). Blue: they move opposite ways (ρ < 0). The thicker and more opaque the line, the stronger the link; the number on it is ρ when there is room for it.',
      'Beyond ±0.7 two pairs are close to the same trade: buying both (or, if ρ is negative, buying one and selling the other) doubles one bet rather than spreading two.']],
    ...(neg ? [[edge(neg.a, neg.b), 'An inverse link', () => [
      `${P(neg.a)} ↔ ${P(neg.b)}, ρ ${r2(neg.r)}: when one rises the other tends to fall.`,
      'Inverse links usually come from a shared currency on opposite sides (for example EUR as base in one pair and USD as base in the other).',
      'Buying both is a partial hedge; buying one and selling the other doubles the exposure.']]] : []),
    ...(syms.includes(S.set.sym) ? [[Q('#constWrap .cnode.cur'), 'The open pair', () => [
      `${P(S.set.sym)} has its name in amber: it is the pair open in the terminal.`,
      'Its neighbours in the tree are the pairs that move most like it.',
      'Before trading it, check its neighbours: a position on one of them is already part of this trade.']]] : []),
    ...(held.length ? [[Q('#constWrap .cnode.held'), 'Pairs you hold', () => [
      `A blue ring marks a pair with an open position: ${held.map(P).join(', ')}.`,
      'Held pairs joined by a thick line carry the same risk.',
      'The Your positions panel on the right tells you which of them add up and which offset each other.']]] : []),
    [Q('#constSide .const-not'), 'Open instrument outside the tree', () => [
      `${P(S.set.sym)} is not one of the 16 pairs of the G8 currencies, so it has no circle here.`,
      'The tree is built only on the G8 currency pairs; CFDs and other FX pairs are left out.',
      'Open a G8 pair to see where it sits, or use Correlation (next tab) for other instruments.']],
    [ins('Hubs'), 'Hubs', () => [
      `The pairs with the most links: ${P(hub)} leads with ${deg[hubI]}. The number on each button is its count of links.`,
      'A hub shares moves with many pairs at once, often because one of its currencies (frequently USD or JPY) is driving the market. A count of links, not a cause: it does not mean the hub moves the others.' + (st ? ` Under it: ${st.same} of ${st.total} links also existed in the previous window — ${st.same >= CONST_STABLE ? 'a settled structure' : 'the tree is reshuffling, so read single links loosely'}.` : ' The previous-window check needs a full window before this one, which the 3D window does not have.'),
      'A position on a hub is exposed to whatever moves its neighbours; two positions on pairs around the same hub are rarely independent. Click a hub to open it.']],
    [ins('Unusual links'), 'Unusual links now', () => [
      `Every one of the 120 possible links, ρ now against its normal over the whole history kept (${un ? (un.normLb / 1440).toFixed(1) : '?'} days). ${un && un.links.length ? `${un.links.length} link${un.links.length > 1 ? 's are' : ' is'} unusual now.` : 'No link is unusual now.'}`,
      `“Broke” = weaker than normal, “new” = stronger. A link is marked when it moves more than ${CONST_BRK_Z} standard errors (Fisher z, widened ×${un ? un.k.toFixed(2) : '1'} to this market’s own variability) — a strict bar, because 120 links are tested at once.`,
      'A broken link means a usual hedge may not work right now; a new link means two positions you thought independent are moving together. A single mark is most likely a sampling swing.']],
    [ins('Tightest link'), 'Tightest link', () => [
      `The strongest link in the tree: ${P(tight.a)} – ${P(tight.b)}, ρ ${r2(tight.r)}.`,
      Math.abs(tight.r) >= .7 ? 'Above 0.7: the two pairs move almost as one.' : Math.abs(tight.r) >= .4 ? 'Between 0.4 and 0.7: related, not interchangeable.' : 'Below 0.4: even the strongest link is loose; the market is moving pair by pair.',
      'Do not hold both the same way thinking you are diversified; pick the one with the better setup or the lower spread.']],
    [ins('Least linked'), 'Least linked to your positions', () => [
      'Among the pairs you do not hold, the one whose strongest link to your positions is the weakest.',
      'Its |ρ| tells you how much it still shares with what you hold; the pair named after it is its closest held relative.',
      'A candidate to spread risk on this window, not a recommendation to trade it.']],
    [ins('Most independent'), 'Most independent pair', () => [
      iso ? `${P(iso[0])}: its distance to its closest neighbour is ${iso[1].toFixed(2)} (0 = moves as one, 1.41 = unrelated), the largest of the 16.` : 'No pair can be measured.',
      'It moves on its own story right now: even its nearest relative shares little of its moves. Pairs whose quotes did not move are left out, never called independent.',
      'A trade on it adds the least overlap to a book of other pairs on this window.']],
    [ins('Your positions'), 'Your positions', () => [
      held.length ? `Your positions on the tree: ${held.map(P).join(', ')}.` : 'You hold no position on a pair of the tree.',
      'Two positions on strongly correlated pairs (|ρ| > 0.7) held so that they win and lose together are marked as concentrated risk (red); held so that one offsets the other, as a hedge (green).',
      'If it says concentrated risk, size the positions as one trade: their stops are likely to be hit together.']],
    [ins('Your currency exposure'), 'Your currency exposure', () => [
      'The net USD amount of all your open positions in each currency: a pair is long its base currency and short its quote.',
      'A currency of a hub pair is marked: that exposure overlaps with much of the board.',
      'Several pairs can add up to one big bet on one currency; read this before adding another trade with the same currency.']],
    [ins('Return interval'), 'Return interval and the Epps effect', () => [
      `Mean |ρ| of the 120 links at 1, 5 and 15 minutes on this window: ${ep.map(x => `${x.fq}m ${x.r.toFixed(2)}`).join(', ')}.`,
      'On real FX, correlations measured on very short returns come out weaker, because pairs are not quoted at the same instants (Epps effect). Here every pair is quoted on the same clock.',
      'If the means differ a lot, prefer the longer interval for decisions held over hours.']],
    [Q('#constSide .obs-how'), 'How to read this', () => [
      'The method in short: correlation distance d = √(2(1−|ρ|)), and the tree keeps the strongest links that connect all pairs.',
      'Click it to open the full note. Returns across a closed market (the weekend jump) are left out.',
      'Come back to it when a link surprises you: it explains what the tree can and cannot say.']],
    [Q('#constSide .const-leg'), 'Legend', () => [
      'Line colour: orange = move together, blue = move opposite; line width = strength. Circle colour: up or down over 4 hours of trading; circle size = volatility.',
      'Amber ring: the open pair. Blue ring: a pair you hold. Dashed halo on a line: unusual against its normal.',
      'Use it to read the tree without hovering. Hover any line or circle for the exact numbers.']]
  ], 'obsTT');
}
/* Teach me for the other tools: the same frame (question, controls, research basis), then every part of the tool.
   Steps read the values on screen when they are shown; parts that are not on screen now are skipped. */
const obsQ = sel => () => document.querySelector('#obsBody ' + sel);
const obsIns = pre => () => [...document.querySelectorAll('#obsBody .ins')].find(x => { const t = ((x.querySelector('label') || {}).textContent || '').trim().toLowerCase(); return t.startsWith(pre.toLowerCase()) || (pre === 'right now' && t.endsWith(' right now')); });
const obsKpi = n => () => document.querySelectorAll('#obsBody .kpi')[n];
const obsCard = pre => () => [...document.querySelectorAll('#obsBody .bh-card')].find(c => ((c.querySelector('h3') || {}).textContent || '').trim().startsWith(pre));
const obsCtl = k => () => document.querySelector(`#obsCtrl [data-k="${k}"]`);
// the last small note of the tool that has text (some tools keep an empty placeholder after it)
const obsNote = () => [...document.querySelectorAll('#obsBody p.small.muted')].filter(x => x.innerText.trim()).pop();
const obsTx = (get, n = 220) => { const e = typeof get === 'function' ? get() : document.querySelector(get); return e ? e.innerText.replace(/\s+/g, ' ').trim().slice(0, n) : ''; };
function obsTour(view, ctrls, parts) {
  const ask = (OBS_ASK[view] || '|').split('|'), src = OBS_SRC[view];
  teachTour([
    [() => document.querySelector(`#obs .obs-nav [data-v="${view}"]`), ask[0], () => [
      ask[1],
      'Each tool in the list on the left answers one question; the line under its name says which. The highlighted one is open.',
      'Pick the tool by the question you have, not by the picture: each one is built to answer exactly its own question.']],
    [() => document.querySelector('#obsHead .obs-title'), 'Title, instrument and time', () => [
      `${obsTx('#obsHead .obs-title', 160)}.`,
      'The instrument (or group) the tool is measuring, and the time of the last bar it used. When the market is closed the picture is the one at the close.',
      'Check the time before acting: a reading from before a close or a weekend describes the past session, not the next one.']],
    ...ctrls.map(([k, title, body]) => [obsCtl(k), title, body]),
    ...(src ? [[() => document.querySelector('#obsHead .obs-src'), 'Research basis', () => [
      `${src[0]}.`,
      'The published method the tool follows; the link opens the source.',
      'Read it when a result surprises you: it explains what the method can and cannot say.']]] : []),
    ...parts,
    [obsQ('.obs-how'), 'How to read this', () => [
      obsTx(obsQ('.obs-how summary'), 260),
      'Click it to open the full note on the method, its inputs and its limits.',
      'Open it once for every tool you use often; it is where the caveats are.']]
  ], 'obsTT');
}
const lbCtl = (what, use) => ['lb', 'Window: 4H · 1D · 3D', () => [what, '4H is the most recent picture and the noisiest; 3D the steadiest. A reading that holds on all three is structure; one that shows only on 4H may be chance.', use]];

const regimeTeach = () => obsTour('regime', [lbCtl('How much history each pair is measured on: the last 4 hours, 1 day or 3 days of 1-minute bars.', 'Look at 1D first; switch to 4H to see whether a pair has just changed character.')], [
  [obsQ('#rgCv'), 'The map', () => [
    'Every one of the 16 pairs is a dot. Across: the Hurst exponent, the memory of the path over 1–32 minutes. Up and down: permutation entropy, how random the order of the moves was.',
    'The shaded noise band is where the same returns land after their signs are shuffled at random. Right of the band = persistent (moves kept going more than chance), left = anti-persistent (moves reversed more than chance). Lower entropy = more ordered.',
    'A pair outside the band behaved differently from noise over the window. That describes the recent path; it does not forecast the next move.']],
  [obsQ('#rgHits'), 'Pairs on the map', () => [
    'Each pair has an invisible target on its dot: hover it for its Hurst, entropy and zone, click it to open the pair.',
    'Dot colour = up or down over the window, dot size = volatility, the amber ring = the open pair.',
    'Use it to find the pairs that are trending cleanly (right of the band) or chopping (left) without opening each chart.']],
  [obsIns('right now') , 'The open pair right now', () => [
    obsTx(obsIns('right now'), 260),
    'Hurst against its noise band (persistent / within noise / anti-persistent), entropy against its band, and the efficiency ratio: the share of the path that was net progress.',
    'Persistent + low entropy + higher efficiency = a cleaner trend in the window; within noise on both = treat moves as random.']],
  [obsIns('largest deviations'), 'Largest deviations', () => [
    obsTx(obsIns('largest deviations'), 200),
    'The pairs furthest from their noise band, and how many of the 16 sit inside it.',
    'If most pairs are inside the band, the market is mostly noise right now; the few outside are the ones worth a look.']],
  [obsIns('reading it'), 'Reading it honestly', () => [
    'The limits of the method in two lines.',
    'A dot outside the band describes the path; it does not predict.',
    'Use the map to describe character, then let your plan decide entries and exits.']],
  [obsQ('.rg-tbl-wrap'), 'The table', () => [
    'The same numbers as the map, for all 16 pairs, in a table you can open.',
    'Read it from the keyboard or when dots overlap on the map.',
    'Sort your attention by zone: persistent pairs first if you follow trends, anti-persistent if you fade moves.']]
]);

const dcTeach = () => obsTour('dc', [['dcTh', 'Threshold δ', () => [
  'The size of a reversal that counts as an event: 0.05%, 0.10%, 0.20% or 0.50% back from the last extreme.',
  'Small δ = many small events (a busy clock); large δ = only the big swings. Every number on the page is measured with this δ.',
  'Pick a δ close to the size of moves you trade: 0.05–0.10% for intraday, 0.20–0.50% for swings.']]], [
  [obsKpi(0), 'Reversal level', () => [obsTx(obsKpi(0)), 'The price at which a reversal of δ from the current extreme would be confirmed: the one level this method defines in advance.', 'A natural place for an alert (Alert at reversal, below): when it fires, the current leg is over by this definition.']],
  [obsKpi(1), 'Events', () => [obsTx(obsKpi(1)), 'How many reversals of δ happened in the history, and the average per hour of open market. Each event is one tick of intrinsic time.', 'More events per hour = a busier, choppier market at this scale.']],
  [obsKpi(2), 'Heartbeat', () => [obsTx(obsKpi(2)), 'Events in the last 6 hours against what the average pace predicts, with the band chance alone produces.', 'Outside the band (highlighted): the market is unusually busy or unusually quiet at this scale now.']],
  [obsKpi(3), 'Average overshoot', () => [obsTx(obsKpi(3)), 'After a reversal is confirmed, how much further price went on average, in multiples of δ. FX research finds about 1 × δ.', 'It is the typical extra distance after confirmation; useful to size a target that is realistic at this scale.']],
  [obsKpi(4), 'Coastline', () => [obsTx(obsKpi(4)), 'The length of the zigzag: every leg added up, against the net move over the same time.', 'A long coastline with a small net move = a lot of travel for little progress: a ranging market.']],
  [obsKpi(5), 'Last leg', () => [obsTx(obsKpi(5)), 'The direction of the last confirmed move of δ.', 'It says which way the last reversal went, nothing more; the next leg is not predicted.']],
  [obsKpi(6), 'Overshoot so far', () => [obsTx(obsKpi(6)), 'How far the current leg has run past its confirmation, against past overshoots.', 'Far beyond the average overshoot, the leg is long by this history; that is a description, not a turning signal.']],
  [obsKpi(7), 'Average leg ends at', () => [obsTx(obsKpi(7)), 'Where the current leg would end if it were exactly average: δ plus the average overshoot from its extreme.', 'A reference price, not a target: legs end early or run long at random.']],
  [obsQ('.dc-act'), 'Alert at reversal', () => ['The reversal level and the current extreme, with a button that sets an alert at the reversal level.', 'The alert fires when the current leg is confirmed over.', 'Set it instead of watching the chart; decide when it fires.']],
  [obsQ('#dcCv'), 'Intrinsic-time chart', () => ['Price drawn once per event, not per minute: each step is a reversal of δ. The levels on the right are scale references.', 'Steep runs of steps in one direction = a trend at this scale; alternating steps = a range.', 'Compare with the normal chart: a quiet hour with many steps was choppy, a busy hour with few was one clean move.']],
  [obsQ('#dcBeat'), 'Heartbeat strip', () => ['Events per hour over the last hours of trading.', 'Spikes = busy, choppy periods; flat = calm.', 'Avoid tight stops when the heartbeat is high: small reversals are frequent.']],
  [obsIns('leg duration'), 'Leg duration', () => [obsTx(obsIns('leg duration'), 260), 'How long legs last from extreme to extreme, and where the current leg stands among them.', 'A long leg by this history is a description, not a reason to fade it.']],
  [obsIns('scaling law'), 'Scaling law', () => [obsTx(obsIns('scaling law'), 200), 'How the number of events falls as δ doubles. A random walk falls about 4× per doubling.', 'Clearly less than 4: more big swings than a random walk (trending at larger scales); clearly more: moves stall before getting large.']]
]);

const djTeach = () => obsTour('deja', [
  ['dvTf', 'Bar size', () => ['The bar the pattern is measured on: 5 minutes, 15 minutes or 1 hour.', 'Larger bars cover more time with the same number of bars.', 'Match it to how long you hold a trade.']],
  ['dvW', 'Pattern length', () => ['How many recent bars form the shape that is searched for: 16, 32 or 64.', 'Shorter patterns find more matches but each says less; longer ones are rarer and more specific.', '32 is a sensible default; change it to see whether the answer holds.']],
  ['dvH', 'Look ahead', () => ['How many bars after each match are measured: 6, 12 or 24.', 'What the matches did over that horizon is what the page reports.', 'Use the horizon you would actually hold the trade for.']]], [
  [obsQ('#djCv'), 'The chart', () => ['The last bars of the open pair (left of “now”) and, to the right, what the closest past shapes did next: their median and middle half, against all windows with no match.', 'If the matches’ band sits inside the no-match band, the shape added nothing.', 'Hover a match in the table to draw its own path.']],
  [obsQ('.dj-leg'), 'Legend', () => [obsTx(obsQ('.dj-leg'), 200), 'Median of the matches, the middle half of their outcomes, and the outcomes of all windows for comparison.', 'Read the comparison band first: it is what “no information” looks like.']],
  [obsQ('.dj-verdict'), 'Verdict', () => [obsTx(obsQ('.dj-verdict'), 220), 'Whether this kind of search has ever predicted anything on this pair, tested over many past settings with a correction for testing many at once.', 'If it says no edge, treat the matches as a curiosity, not as a forecast.']],
  [obsQ('.dj-cov'), 'Shape distance', () => [obsTx(obsQ('.dj-cov'), 200), '0 = identical shape. The closest match against a random window tells you how special the matches are.', 'Close to a random window: the “matches” are not really similar.']],
  [obsIns('what the'), 'What the matches did next', () => [obsTx(obsIns('what the'), 260), 'How many rose, the median move and the middle half, against all windows of the same length.', 'A majority up is common by chance with 12 matches; only a clear gap from the all-windows band means anything.']],
  [obsIns('closest matches'), 'Closest matches', () => ['Each match: the pair, when it happened, and what it did next in pips.', 'Matches come from all 16 pairs; one per moment so the same move is not counted twice.', 'Hover a row to see that match on the chart; read the spread of outcomes, not the best one.']]
]);

const rpTeach = () => obsTour('rp', [
  ['rpTf', 'State size', () => ['One state per 5-minute, 15-minute or 1-hour bar.', 'Larger bars cover more days with the same picture size.', 'Use 15m for the last few days, 1H for a longer view.']],
  ['rpMode', 'Distance · Recurrences', () => ['Distance shades every pixel by how similar two moments are; Recurrences shows only the 10% most similar pairs of moments.', 'Distance shows gradients; Recurrences shows the lines and blocks the statistics count.', 'Switch to Recurrences to see what determinism and laminarity measure.']]], [
  [obsQ('#rpCv'), 'Recurrence plot', () => ['Each pixel compares two moments (one on each axis); bright = similar states. “Now” is at the top right corner.', 'Diagonal lines = sequences that repeat; square blocks = periods stuck in one state; a pale cross = an unusual period.', 'Streaks are most likely similar volatility coming back, not a repeated direction.']],
  [obsQ('.rp-leg'), 'Legend', () => [obsTx(obsQ('.rp-leg'), 200), 'Shading by rank: the closest half of all pairs of states is shaded.', 'Read it together with the mode switch above.']],
  [obsQ('.dj-verdict'), 'Verdict', () => [obsTx(obsQ('.dj-verdict'), 200), 'The structure measured against 120 shuffled copies of the same returns: what chance alone produces.', 'Only results beyond the shuffled band say the market has structure here.']],
  [obsIns('regime now'), 'Regime now', () => [obsTx(obsIns('regime now'), 280), 'How much the last 6 hours resemble the rest of the window, and how big their moves are against the average.', 'Unusual = a period unlike the rest: expect volatility to behave differently from the recent past.']],
  [obsIns('determinism'), 'Determinism', () => [obsTx(obsIns('determinism'), 260), 'The share of recurrences that form diagonal lines, against shuffled data.', 'Above the band: sequences of states repeat more than chance — most likely calm and busy stretches, not price direction.']],
  [obsIns('laminarity'), 'Laminarity', () => [obsTx(obsIns('laminarity'), 220), 'The share of recurrences in vertical blocks: the market staying in one state.', 'Above the band: quiet or busy phases persist; useful to expect the current pace to continue a while.']],
  [obsIns('now resembles'), 'Now resembles', () => ['The past moments most similar to now, their distance, and the range of the next 8 bars.', 'Distances under 1× count as a recurrence. The range is a size, not a direction.', 'Use the ranges to size stops for the next hours; they say nothing about which way.']],
  [obsIns('reading the picture'), 'Reading the picture', () => ['The limits of the plot in one line.', 'Bright streaks are similar volatility, not repeated direction.', 'Use it for pace and phases, never as a direction signal.']]
]);

const drvTeach = () => obsTour('drv', [['drvW', 'Window: 1H · 4H · 1D', () => ['The span the moves are measured over.', 'Shorter windows show who is driving right now; longer ones the theme of the day.', 'Compare 1H with 1D: a driver that changed recently shows up only on the short window.']]], [
  [obsQ('.drv-verdict'), 'Verdict', () => [obsTx(obsQ('.drv-verdict'), 260), 'Which currency of the pair did the moving: each currency is measured against an equal-weighted basket of all eight, so the pair’s move splits exactly into its two legs.', 'If the quote currency did the moving, a view on the base currency is the wrong reason for this trade.']],
  [obsQ('.drv-iso'), 'Cleaner expressions', () => ['Pairs that isolate one of the two currencies.', 'If one currency is the driver, another pair with it may express the move with less noise from the second currency.', 'Click a pill to open that pair.']],
  [obsQ('table'), 'Legs by window', () => ['For each window: the base leg, the quote leg (its effect on the pair), the pair’s move and which leg led.', 'The two legs add up to the pair. Bars show their size and direction.', 'Look for a window where one leg dominates: that currency is the story.']],
  [obsQ('#drvCv'), 'Cumulative legs chart', () => [obsTx(obsQ('.dj-leg'), 160), 'The two legs drawn cumulatively over the last 24 trading hours; their sum is the pair.', 'Where the lines separate is when one currency took over.']],
  [obsIns('currency board'), 'Currency board', () => [obsTx(obsIns('currency board'), 200), 'All eight currencies ranked by their move against the basket.', 'Strongest against weakest is where the biggest relative move of the window was.']],
  [obsIns('widest strength gap'), 'Widest strength gap', () => [obsTx(obsIns('widest strength gap'), 260), 'The tradable pair made of the strongest and weakest currency, and the gap between them.', 'Descriptive: it says where the move was, not where it will be.']]
]);

const clkTeach = () => obsTour('clock', [['clkAll', 'This pair · All pairs', () => ['The usual activity profile of the open instrument, or the average of the 16 pairs.', 'All pairs shows the global FX rhythm; This pair its own (some pairs wake up with their local session).', 'Use This pair before trading it; All pairs to plan your day.']]], [
  [obsQ('#clkCv'), 'The clock', () => ['A 24-hour UTC clock. Each petal is the usual activity of one 15-minute slot; dots are today; the hand is now.', 'Long petals = busy times (usually the London and New York sessions), short = quiet (late US, early Asia).', 'Expect wider moves and faster fills in long petals; tighter ranges and wider spreads in short ones.']],
  [obsIns('now'), 'Now', () => [obsTx(obsIns('now'), 220), 'The current slot, its usual activity and how today compares.', 'Today much busier than usual: something is moving this market; much quieter: expect small ranges.']],
  [obsIns('next hour'), 'Next hour', () => [obsTx(obsIns('next hour'), 220), 'The slots of the next hour for the open instrument.', 'Know whether activity is about to rise or fade before placing a stop.']],
  [obsIns('next two hours'), 'Next two hours', () => [obsTx(obsIns('next two hours'), 220), 'The usual activity of the next eight slots.', 'Place entries before activity rises if you need movement; avoid tight stops just before it.']],
  [obsIns('busiest'), 'Busiest and quietest hour', () => [obsTx(obsIns('busiest'), 200), 'The peak and the trough of the day, as multiples of the average.', 'Trade breakouts around the peak; expect ranges around the trough.']],
  [obsNote, 'Legend', () => ['Petal colours: busier than 1.3× average, quieter than 0.7×; the hand and today’s dots; the ring marks the sessions.', 'Read the petal length first, the colour second.', 'Hover a petal for its exact numbers.']]
]);

const tapTeach = () => obsTour('tap', [
  ['tapLb', 'Window: 4H · 1D · 3D', () => ['Where each line starts: 4 hours, 1 day or 3 days of trading ago (a weekend is skipped).', 'Every row shows the move since that start.', 'Use 1D for the day’s story, 3D for the week’s theme.']],
  ['tapSort', 'Sort: Return · A–Z · Cluster', () => ['Order of the rows: by move, alphabetical, or by cluster (pairs linked in the Constellation side by side).', 'Cluster puts pairs that move together next to each other, so themes show as blocks.', 'Use Cluster to see themes, Return to see winners and losers.']],
  ['tapScale', 'Scale: Common · Per pair', () => ['One scale for all rows, or each row on its own scale.', 'Common makes rows comparable; Per pair shows the shape of calm pairs too.', 'Start on Common; switch to Per pair to read a quiet pair’s path.']],
  ['tapCcy', 'Currency filter', () => ['All 16 pairs, or only the pairs with one currency.', 'With one currency the theme line becomes that currency’s average move.', 'Pick the currency you have a view on to see whether all its pairs agree.']]], [
  [obsQ('.tap-head'), 'Theme', () => [obsTx(obsQ('.tap-head'), 260), 'The strongest and weakest currency of the window and how many of their pairs moved the same way.', 'A theme that holds on all its pairs is broad; one that holds on few is a single-pair story.']],
  [obsQ('#tapCv'), 'The tapestry', () => ['Every pair as a horizon chart: coloured bands above or below the start of the window, darker = further. Each row ends with its move in bp and points.', 'Rows that light up at the same time moved together; dashed lines mark closed-market gaps; the News strip marks releases.', 'Scan for the moment several rows changed colour together: that is when the theme started.']],
  [obsNote, 'News note', () => [obsTx(obsNote, 200), 'Which releases of the calendar fall in the window.', 'A colour change right after a release is the release’s effect.']]
]);

const baskTeach = () => obsTour('bask', [], [
  [obsQ('.bk-list'), 'Baskets', () => ['Presets and your own baskets: weighted groups of currencies, each traded as one index.', 'The highlighted one is open. + creates a new basket.', 'Use a basket when your view is on a currency group (for example commodity currencies against safe havens), not on one pair.']],
  [obsQ('.bk-head'), 'Index and timeframe', () => [obsTx(obsQ('.bk-head'), 200), 'The basket’s name, its index value and the chart timeframe.', 'Read the index like a price: up means the long side outperformed the short side.']],
  [obsQ('#bkChart'), 'Index chart', () => ['The basket drawn as one price, with its EMA20, your index alerts and the ticket’s stop and target.', 'Dashed lines are alerts; the stop and target are measured on the index and close every leg together.', 'Judge the trade on the index chart, not on each pair.']],
  [obsQ('.bk-cmp'), 'Compare', () => ['Overlay the 8 currency indices or other baskets on the chart.', 'It shows whether your basket is just one currency in disguise.', 'If it tracks one currency index closely, trading that currency may be simpler.']],
  [obsQ('.obs-kpis'), 'Moves', () => [obsTx(obsQ('.obs-kpis'), 200), 'The basket’s move over 1H, 4H, 1D and 3D, in basis points (0.01%).', 'Compare the short and long windows: same sign = a steady move; opposite = a turn.']],
  [obsQ('.bk-an'), 'Analysis', () => ['What moved the basket (by leg), its behaviour by hour, and its overlap with other baskets.', 'Switch the tabs to see which legs did the work.', 'If one leg did all the work, the basket is really a single-pair trade.']],
  [obsQ('.bk-pane'), 'Analyse · Trade', () => ['The right panel has two views: Analyse (composition, stretch, alerts, behaviour) and Trade (one ticket for all legs).', 'Analyse first, then Trade.', 'Nothing is sent until you confirm in the Trade view.']],
  [obsIns('composition'), 'Composition', () => [obsTx(obsIns('composition'), 200), 'The long and short currencies and their weights, as shares of each side.', 'Presets cannot be edited; Duplicate & edit makes your own copy.']],
  [obsIns('stretch'), 'Stretch', () => [obsTx(obsIns('stretch'), 260), 'How far the index sits from its 20-bar mean, in standard deviations, and how often such moves came back, against a random walk.', 'Beyond ±2σ the index is stretched; check the random-walk comparison before treating it as a reversal.']],
  [obsIns('index alerts'), 'Index alerts', () => ['An alert when the basket moves a set number of bp either way.', 'They appear as dashed lines on the chart.', 'Set one instead of watching the basket.']],
  [obsIns('behaviour'), 'Behaviour', () => [obsTx(obsIns('behaviour'), 280), 'Daily volatility and the closest single pair (proxy) with how much of the index it follows and what it would cost instead.', 'A proxy that follows most of the index for a fraction of the spread is often the better trade.']]
]);

const scanTeach = () => obsTour('scan', [
  ['scH', 'Look ahead: 1H · 2H · 4H', () => ['How long after each past signal the move is measured.', 'A signal can work at one horizon and not at another.', 'Use the horizon you would hold the trade for.']],
  ['scF', 'With a record · All live', () => ['Only live signals that fired often enough to judge, or every live signal.', 'All live includes signals with too few past cases to say anything.', 'Keep With a record; look at All live only out of curiosity.']]], [
  [obsQ('.dj-verdict'), 'Verdict', () => [obsTx(obsQ('.dj-verdict'), 260), 'Whether any signal survives the correction for testing many signals at once, and how many passes chance alone would give.', 'If passes are in line with luck, no signal has shown an edge here.']],
  [obsQ('.lab-intro'), 'What it does', () => [obsTx(obsQ('.lab-intro'), 260), 'Every past trigger in the last week of 15-minute bars, measured at the horizon.', 'A signal is worth something only if it paid on this pair, not just because it fired.']],
  [obsQ('.sc-live'), 'Live signals', () => ['The signals firing now on the open pair, each with its own track record and verdict colour.', 'Robust and significant are the only colours that mean an edge; noise and too few mean none.', 'Ignore a live signal whose record is noise, however convincing it looks on the chart.']],
  [obsQ('.sc-vleg'), 'Verdict colours', () => [obsTx(obsQ('.sc-vleg'), 200), 't > 2 is the usual bar for “not luck”; robust also holds across pairs and halves of the week.', 'Read the colour before the numbers.']],
  [obsQ('.sc-card'), 'All signals', () => ['Every signal across the 16 pairs: cases, hit rate against base, average bp, pooled t and how many pairs pass.', 'Pooled t combines all pairs; a high count of pairs with t > 2 is more convincing than one strong pair.', 'Compare with the expected passes by luck shown under the table.']],
  [() => document.querySelector('#scAlert'), 'Alert', () => ['Notifies you when a signal with a real record fires.', 'It stays silent for signals that only look good.', 'Turn it on and let the record decide when to look.']]
]);

const coneTeach = () => obsTour('cone', [
  ['cnH', 'Horizon', () => ['How far ahead the cone looks: 1 hour, 4 hours, 8 hours or 1 day.', 'The cone widens with time; longer horizons have wider ranges.', 'Use the horizon you would hold the trade for.']],
  ['cnMode', 'Session model · Conformal', () => ['Session model widens with the usual activity of each hour and the recent pace. Conformal corrects it by how often it missed in the past, so its stated odds hold.', 'If the two differ a lot, the recent past was unusual.', 'Use Conformal when you need the 68%/95% to mean exactly that.']]], [
  [obsQ('.lab-intro'), 'What it answers', () => [obsTx(obsQ('.lab-intro'), 260), 'A range for where price is likely to be at the horizon, shaped by the time of day and the recent pace.', 'It gives sizes, not direction.']],
  [obsQ('.dj-verdict'), 'Market state', () => [obsTx(obsQ('.dj-verdict'), 200), 'The cone is drawn only while the instrument trades.', 'When closed, come back after the open.']],
  [obsKpi(0), '68% range', () => [obsTx(obsKpi(0)), 'About two times in three, price should end the horizon inside it.', 'A stop inside it is likely to be touched; a target inside it is realistic.']],
  [obsKpi(1), '95% range', () => [obsTx(obsKpi(1)), 'About 19 times in 20, price should end inside it.', 'A target beyond it is unlikely within this time.']],
  [obsKpi(2), 'Typical move', () => [obsTx(obsKpi(2)), 'Half the width of the 68% range: the move to expect either way.', 'Size stops at least this far if you want to survive normal noise over the horizon.']],
  [obsKpi(3), 'Pace', () => [obsTx(obsKpi(3)), 'How much the cone is scaled by the last two hours against what this time of day usually moves.', 'Above 1× the market is livelier than usual; ranges are wider.']],
  [obsQ('#cnSvg'), 'The cone', () => [obsTx(obsQ('.cn-leg'), 160), 'Price now on the left, the 68% and 95% bands widening to the right, and the constant-volatility band for comparison.', 'Where the cone widens fastest is the busiest time ahead.']],
  [obsCard('Did the cone'), 'Did the cone keep its promise?', () => [obsTx(obsCard('Did the cone'), 240), 'How often price actually ended inside the 68% and 95% bands last week, for this model, the conformal one and constant volatility.', 'Close to 68% and 95% = well calibrated; trust it more.']],
  [obsCard('Your levels'), 'Your levels against the cone', () => [obsTx(obsCard('Your levels'), 240), 'Your ticket stop and target in standard deviations from now, the chance each is beyond the price at the end and the chance it is touched on the way.', 'A stop with a high touch chance will likely be hit by noise; a target with near-zero chance will not be reached in this time.']]
]);

const exitTeach = () => obsTour('exit', [], [
  [obsQ('.lab-intro'), 'What it does', () => [obsTx(obsQ('.lab-intro > p'), 260), 'Your closed trades replayed on the real price path with nine exit rules, with the same entries.', 'Use it to judge your exits, not your entries.']],
  [obsQ('.lab-src'), 'Trades and unit', () => ['My trades or the Sample trader; R = your stop or R = volatility.', 'The sample trader takes random entries with no edge: its numbers show costs only. R is the risk of each trade.', 'Try the sample first to learn the page; switch to your trades when you have at least 5 that can be replayed.']],
  [obsQ('.dj-verdict'), 'Verdict', () => [obsTx(obsQ('.dj-verdict'), 220), 'Whether any rule beat your exits by more than chance, after picking the best of the rules.', 'No reliable difference = keep your exits; a reliable one = test that rule going forward.']],
  [obsKpi(0), 'Trades replayed', () => [obsTx(obsKpi(0)), 'How many closed trades could be replayed on the price history kept.', 'Fewer than about 30 makes every comparison loose.']],
  [obsKpi(1), 'Your exits', () => [obsTx(obsKpi(1)), 'The total of your trades as you closed them, in R.', 'The benchmark every rule is compared with.']],
  [obsKpi(2), 'Best rule (hindsight)', () => [obsTx(obsKpi(2)), 'The rule with the best total, picked after the fact.', 'Hindsight always finds a winner; see the walk-forward check before believing it.']],
  [obsKpi(3), 'Exit efficiency', () => [obsTx(obsKpi(3)), 'How much of the best open profit (MFE) your exits kept on average.', 'Low efficiency = you give back most of what trades offered; trailing exits may help.']],
  [obsQ('.bh-board-w table'), 'Exit rules', () => ['Each rule: total R, average R, win rate, worst drawdown and P&L on the same trades.', 'Compare totals and drawdowns together: a higher total with a much deeper drawdown is not better.', 'Look for rules that beat yours on both.']],
  [obsCard('Stop × target'), 'Stop × target map', () => ['Total R for every combination of stop distance and target multiple, on the same entries.', 'The outlined cell is the best; smooth areas of colour matter more than one bright cell.', 'Prefer a stop and target in a broad good area, not the single best cell.']],
  [obsCard('Walk-forward'), 'Walk-forward check', () => [obsTx(obsCard('Walk-forward'), 260), 'The best rule picked on older trades, then scored on newer ones.', 'Only a rule that also wins on the newer trades is worth switching to.']],
  [obsCard('Where you lose'), 'Where you lose', () => ['Your trades grouped by how they ended (stop, target, manual, time) with their totals.', 'The type that lost the most is where to look first.', 'Change the habit behind the worst type before changing rules.']],
  [() => [...document.querySelectorAll('#obsBody .bh-board-w table')].pop(), 'Trades', () => ['The most recent replayed trades: your result, the best seen (MFE) and the best rule’s result.', 'A large gap between Best seen and Yours means profit was available and given back.', 'Open a trade from Actions to see it on the chart.']]
]);
const OBS_TEACH = { const: constTeach, regime: regimeTeach, dc: dcTeach, deja: djTeach, rp: rpTeach, drv: drvTeach, clock: clkTeach, tap: tapTeach, bask: baskTeach, scan: scanTeach, cone: coneTeach, exit: exitTeach };

/* ---------------- 2. Regime map: Hurst × permutation entropy ---------------- */
/* The zone of a window by its Hurst value against the noise band, and how long a pair has stayed in its zone now: the
   same window (lb bars) ending 1, 2, … RG_PW hours of trading ago (60 bars each step), each measured against today's
   band; run = the windows from now back that share the zone of now, nw = the windows the history holds. */
const RG_PW = 24;
const rgZone = (H, b) => H > b.hi ? 'persistent' : H < b.lo ? 'anti-persistent' : 'noise';
function rgPersist(sym, n, bH, Hnow) {
  const a = Engine.candles[sym], zone = rgZone(Hnow, bH);
  // a redraw without a new bar (a resize, the pointer leaving) reuses the windows already measured
  const ck = `${sym}|${n}|${a.length}|${a[a.length - 1].time}|${bH.lo}|${bH.hi}|${zone}`, C0 = OBS.rgPerC || (OBS.rgPerC = new Map());
  if (C0.has(ck)) return { ...C0.get(ck) };
  if (C0.size > 96) C0.clear();
  let run = 1, nw = 1, open = true;
  for (let k = 1; k <= RG_PW; k++) {
    const e = a.length - k * 60; if (e - n < 0) break; nw++;
    if (!open) continue;
    const w = a.slice(e - n, e), H = hurst(obsSegs(w.map(x => x.time), w.map(x => x.close)).flat());
    if (H != null && rgZone(H, bH) === zone) run++; else open = false;
  }
  C0.set(ck, { zone, run, nw });
  return { zone, run, nw };
}
// hours of trading in the zone: the windows agreeing span run − 1 hours; all of them agreeing = at least that
const rgPerH = p => !p ? '—' : p.run <= 1 ? '<1h' : `${p.run === p.nw ? '≥' : ''}${p.run - 1}h`;
const RG_COLS = [['pair', 'Pair'], ['H', 'H'], ['pe', 'PE'], ['er', 'ER'], ['zone', 'Zone'], ['per', 'In zone']];
const RG_ZORD = { 'anti-persistent': 0, noise: 1, persistent: 2 };
function drawRegime(b, c) {
  // the window is exactly lb bars; returns across a closed market are left out (obsSegs)
  const n = c.lb, col = chartColors(), out = [];
  const all = Engine.PAIRS.map(p => {
    const arr = Engine.candles[p.sym].slice(-n), segs = obsSegs(arr.map(k => k.time), arr.map(k => k.close)), st = rgStats(segs), r = segs.flat();
    if (st.flat) { out.push([p.sym, 'its quotes barely moved in the window']); return null; }
    if (st.H == null || st.pe == null) { out.push([p.sym, `needs ≥ ${st.H == null ? HURST_MIN + 1 : RG_MIN_BARS} bars without a closed market in between`]); return null; }
    // efficiency ratio: net move / path length, on the same returns
    const path = r.reduce((s2, v) => s2 + Math.abs(v), 0), net = r.reduce((s2, v) => s2 + v, 0);
    return { s: p.sym, segs, H: st.H, pe: st.pe, n: st.n, bars: arr.length, vol: stdev(r), ret: net, er: path ? Math.abs(net) / path : 0 };
  });
  const pts = all.filter(Boolean);
  if (!pts.length) { b.innerHTML = `<div class="empty">No pair can be measured on this window: ${out.map(([s, why]) => `${escHtml(pretty(s))} ${why}`).join('; ')}.</div>`; return; }
  // one band for the map: sign-randomised copies of the measured pairs' own windows (cached per window and half hour)
  const eu = Engine.candles.EURUSD, bk = `rg${n}|${Math.floor(eu[eu.length - 1].time / 1800)}|${pts.map(p => p.s).join()}`;
  const band = OBS.rgBand && OBS.rgBand.k === bk ? OBS.rgBand.v : (OBS.rgBand = { k: bk, v: rgBand(pts.map(p => p.segs), 160, n) }).v;
  pts.forEach(p => {
    const bH = band.h, bP = band.pe;
    // deviation in band half-widths (|z| > 1 = outside the 5–95% noise band); PE only deviates downwards
    p.bH = bH; p.bP = bP; p.zH = (p.H - bH.mid) / (p.H >= bH.mid ? bH.hi - bH.mid : bH.mid - bH.lo || 1e-9); p.zP = Math.max(0, (bP.mid - p.pe) / (bP.mid - bP.lo || 1e-9));
    p.dev = Math.max(Math.abs(p.zH), p.zP); delete p.segs;
    p.per = rgPersist(p.s, n, bH, p.H);
  });
  // the panel and the sparkline read one pair: the open one when it is on the map, else EUR/USD (or the first measured)
  const me = pts.find(p => p.s === S.set.sym) || pts.find(p => p.s === 'EURUSD') || pts[0];
  OBS.rgSpark = me.s;
  // rolling 12-hour Hurst of that pair, and its band from its own last 12 hours
  const cur = Engine.candles[me.s], roll = [];
  for (let e = cur.length; e > 720 && roll.length < 48; e -= 60) { const w = cur.slice(e - 720, e), H = hurst(obsSegs(w.map(k => k.time), w.map(k => k.close)).flat()); if (H != null) roll.unshift({ t: cur[e - 1].time, H }); }
  const lw = cur.slice(-720), rk = `sp${me.s}|${Math.floor(cur[cur.length - 1].time / 1800)}`;
  const bR = OBS.rgSpBand && OBS.rgSpBand.k === rk ? OBS.rgSpBand.v : (OBS.rgSpBand = { k: rk, v: rgBand([obsSegs(lw.map(k => k.time), lw.map(k => k.close))], 160, 720).h }).v;
  b.innerHTML = `<div class="obs-split rg-split"><div class="obs-cv"><canvas id="rgCv" aria-hidden="true"></canvas><div class="rg-hits" id="rgHits"></div></div><aside class="obs-side" id="rgSide"></aside></div><details class="rg-tbl-wrap"${OBS.rgTblOpen ? ' open' : ''}><summary>All ${Engine.PAIRS.length} pairs <span class="muted">· H, PE, ER and time in zone, sortable</span></summary><table class="rg-tbl" aria-label="Regime measures per pair; activate a row to open the pair"><thead><tr></tr></thead><tbody></tbody></table></details>`;
  const { g, w, h } = canvasFit($('#rgCv'));
  const bH = band.h, bP = band.pe, info = cssv('--info'), f2 = v => v.toFixed(2), f3 = v => v.toFixed(3);
  const pct = v => `${(v * 100).toFixed(v < .1 ? 1 : 0)}%`;
  /* the axes hold the data: x spans the band and every Hurst value (0.4–0.6 at least), y the entropy band and every
     measured value, with a margin; nothing above the highest value is drawn */
  const hs = pts.map(p => p.H), es = pts.map(p => p.pe), xMin = Math.min(.4, bH.lo - .02, Math.min(...hs) - .03), xMax = Math.max(.6, bH.hi + .02, Math.max(...hs) + .03);
  const yLo = Math.min(bP.lo, ...es), yHi = Math.max(bP.hi, ...es), yPad = (yHi - yLo) * .1 || .002, yMin = yLo - yPad, yMax = yHi + yPad;
  OBS.rgAxis = { yMin, yMax };
  const L = 62, TOP = 32, BOT = h - 30, R0 = w - 16;
  const X = v => L + (clamp(v, xMin, xMax) - xMin) / (xMax - xMin) * (R0 - L), Y = v => TOP + (1 - (clamp(v, yMin, yMax) - yMin) / (yMax - yMin)) * (BOT - TOP);
  // outside-the-band regions in neutral tints (persistence is not "up"), and the 5–95% band of the same returns, signs randomised
  g.fillStyle = cssv('--ind1') + '14'; g.fillRect(X(bH.hi), TOP, R0 - X(bH.hi), BOT - TOP);
  g.fillStyle = info + '14'; g.fillRect(L, TOP, X(bH.lo) - L, BOT - TOP);
  g.fillStyle = col.tx2 + '22'; g.fillRect(X(bH.lo), TOP, X(bH.hi) - X(bH.lo), Y(bP.lo) - TOP);
  g.strokeStyle = col.grid; g.setLineDash([3, 4]); [bH.lo, .5, bH.hi].forEach(v => { g.beginPath(); g.moveTo(X(v), TOP); g.lineTo(X(v), BOT); g.stroke(); });
  g.beginPath(); g.moveTo(L, Y(bP.lo)); g.lineTo(R0, Y(bP.lo)); g.stroke(); g.setLineDash([]);
  g.font = '11.5px JetBrains Mono'; g.fillStyle = col.tx;
  for (let v = Math.ceil(xMin * 20) / 20; v <= xMax + 1e-9; v += .05) g.fillText(v.toFixed(2), X(v) - 12, BOT + 14);
  for (let k = 0; k <= 3; k++) { const v = yMin + (yMax - yMin) * k / 3; g.fillText(v.toFixed(3), 14, Y(v) + 3); }
  g.fillStyle = col.tx2; g.font = '600 12px Inter, sans-serif';
  g.fillText('← anti-persistent', L + 4, 20); const tl = 'persistent →'; g.fillText(tl, R0 - 4 - g.measureText(tl).width, 20);
  const nb = 'noise band'; g.fillText(nb, (X(bH.lo) + X(bH.hi)) / 2 - g.measureText(nb).width / 2, 20);
  g.font = '11.5px Inter, sans-serif'; const xt = 'Hurst exponent  (memory of the path over 1–32 minutes)'; g.fillText(xt, (L + R0) / 2 - g.measureText(xt).width / 2, h - 2);
  g.save(); g.translate(10, (TOP + BOT) / 2 + 80); g.rotate(-Math.PI / 2); g.fillText(`permutation entropy  (noise ≈ ${f3(bP.mid)})`, 0, 0); g.restore();
  const vmx = Math.max(...pts.map(p => p.vol)), labs = [];
  let aMin = 1;
  // the most deviating pairs are labelled first; a label that would overlap another is left to the tooltip
  pts.slice().sort((a, b2) => b2.dev - a.dev).forEach(p => {
    const x = X(p.H), y = Y(p.pe), r = 5 + p.vol / vmx * 9, a = Math.min(1, Math.abs(p.ret) * 1e4 / 30), al = .55 + a * .4;
    aMin = Math.min(aMin, al); p.r = r;
    g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fillStyle = (p.ret >= 0 ? col.up : col.dn) + Math.round(al * 255).toString(16).padStart(2, '0'); g.fill();
    g.lineWidth = p.s === S.set.sym ? 2.4 : 1; g.strokeStyle = p.s === S.set.sym ? col.acc : cssv('--tx3'); g.stroke();
  });
  OBS.rgAlphaMin = aMin;
  g.font = '11.5px JetBrains Mono';
  pts.slice().sort((a, b2) => b2.dev - a.dev).forEach(p => {
    const x = X(p.H), y = Y(p.pe), t = pretty(p.s), tw = g.measureText(t).width;
    for (const lx of [x + p.r + 3, x - p.r - 3 - tw]) {
      const box = { x0: lx - 2, x1: lx + tw + 2, y0: y - 9, y1: y + 5 };
      if (box.x0 < L || box.x1 > R0) continue;
      if (labs.some(o => box.x0 < o.x1 && box.x1 > o.x0 && box.y0 < o.y1 && box.y1 > o.y0)) continue;
      // nor over another point
      if (pts.some(q => q !== p && X(q.H) + q.r > box.x0 && X(q.H) - q.r < box.x1 && Y(q.pe) + q.r > box.y0 && Y(q.pe) - q.r < box.y1)) continue;
      labs.push(box); g.fillStyle = cssv('--tx'); g.fillText(t, lx, y + 3); break;
    }
  });
  OBS.rgPts = pts.map(p => ({ ...p, x: X(p.H), y: Y(p.pe) }));
  // one reading, three places: the focusable target over the point, the canvas hover, the tooltip
  const rgLines = p => [`Hurst ${f2(p.H)} · noise band ${f2(p.bH.lo)}–${f2(p.bH.hi)} · ${rgWord(p.H, p.bH)}`, `Entropy ${f3(p.pe)} · noise band from ${f3(p.bP.lo)} · ${p.pe < p.bP.lo ? 'below: some repeating patterns' : 'like noise'}`, `Efficiency ${pct(p.er)} · typical noise ≈ ${pct(band.er.mid)}`, `Move over the window ${obsBp(p.ret)}`];
  $('#rgHits').innerHTML = OBS.rgPts.map(p => `<button class="rg-hit" data-sym="${p.s}" style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px" aria-label="${escHtml(pretty(p.s))}" data-tip="${escHtml(`${pretty(p.s)}|${rgLines(p).join('. ')}. Click or press Enter to open the pair.`)}"></button>`).join('');
  CV_HOVER.rgCv = e => {
    if (!e) return; if (!document.body.classList.contains('no-hints')) return brTipHide(); // with Hints on, a dot has its "?" and its card const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const hit = OBS.rgPts.map(p => [p, Math.hypot(p.x - x, p.y - y)]).filter(([, d]) => d < 16).sort((a, b2) => a[1] - b2[1])[0];
    if (!hit) return brTipHide(); const p = hit[0];
    cvTip(e, pretty(p.s), rgLines(p));
  };
  const ranked = pts.slice().sort((a, b2) => b2.dev - a.dev), nIn = pts.filter(p => p.dev <= 1).length;
  OBS.rgEr = band.er;
  // a pill names the metric that deviates most: Hurst (H) or the entropy (PE)
  const pill = p => { const pe = p.zP > Math.abs(p.zH), z = pe ? p.zP : Math.abs(p.zH); return `<button class="pill" data-sym="${p.s}" data-tip="${escHtml(`${pretty(p.s)} · ${pe ? `entropy ${f3(p.pe)}` : `Hurst ${f2(p.H)}`}|${pe ? `Entropy ${f3(p.pe)} against a noise band from ${f3(p.bP.lo)}` : `Hurst ${f2(p.H)} against a noise band of ${f2(p.bH.lo)}–${f2(p.bH.hi)}`}: ${z <= 1 ? 'within' : 'outside'} it (${z.toFixed(1)}× its half-width). Click to open the pair.`)}">${pretty(p.s)} <b>${pe ? `PE ${f3(p.pe)}` : `H ${f2(p.H)}`}</b></button>`; };
  const notHere = me.s !== S.set.sym ? `<p class="small muted">${escHtml(pretty(S.set.sym))} is not on this map (it holds the 16 G8 pairs${isMajor(S.set.sym) ? ', and this one could not be measured' : ''}): shown here is ${pretty(me.s)}.</p>` : '';
  const spH = roll.length ? roll.length - 1 : 0;
  // the table: every pair, the measured ones with their reading, sortable on each column (session-only order)
  const zoneW = { noise: 'noise', persistent: 'persistent', 'anti-persistent': 'anti-persistent' };
  OBS.rgRows = pts.map(p => ({ s: p.s, H: p.H, pe: p.pe, er: p.er, zone: p.per.zone, run: p.per.run, nw: p.per.nw }));
  const rows = [...pts.map(p => ({ s: p.s, p })), ...out.map(([s, why]) => ({ s, why }))];
  const meP = me.per, perTxt = `In this zone (${zoneW[meP.zone]}) for ${rgPerH(meP) === '<1h' ? 'less than an hour' : rgPerH(meP).replace('≥', 'at least ').replace(/h$/, ' h')} of trading: ${meP.run} of ${meP.nw} hourly windows of ${n} bars, from now back, share it${meP.run === meP.nw ? ' (all the history holds)' : ''}. The windows overlap (each starts an hour after the last), so a zone tends to last about as long as the window itself; it describes the past windows only.`;
  $('#rgSide').innerHTML = `
    <div class="ins"><label>${pretty(me.s)} right now</label>${notHere}<div class="obs-hero"><b class="mono">H ${f2(me.H)}</b><span>Hurst · ${me.H > me.bH.hi ? 'persistent' : me.H < me.bH.lo ? 'anti-persistent' : 'within the noise band'}</span></div><p>Hurst <b class="mono">${f2(me.H)}</b> (noise band ${f2(me.bH.lo)}–${f2(me.bH.hi)}) — ${rgLab(me.H, me.bH)}. Entropy <b class="mono">${f3(me.pe)}</b> (noise band ${f3(me.bP.lo)}–${f3(me.bP.hi)}) — ${peLab(me.pe, me.bP)}. Efficiency ratio <b class="mono">${pct(me.er)}</b> of the path was net progress (typical noise ≈ ${pct(band.er.mid)}; 90% of the noise copies stay under ${pct(band.er.hi)}).</p>
      <div class="spark-h" id="rgSpark" role="img" title="Rolling 12-hour Hurst of ${pretty(me.s)}, one point per hour of trading; shaded = 5–95% band of its own returns with randomised signs; dashed = 0.50"></div><div class="rg-spk-ax"></div><small class="muted">${pretty(me.s)} · rolling 12h Hurst · ${roll.length} points · shaded = noise band</small><p class="small rg-per">${perTxt}</p></div>
    <div class="ins"><label>Largest deviations (${nIn} of ${pts.length} within noise band)</label>${ranked.slice(0, 4).map(pill).join('')}</div>
    ${out.length ? `<div class="ins"><label>Not on the map</label><p class="small">${out.map(([s, why]) => `<b>${escHtml(pretty(s))}</b>: ${why}.`).join(' ')}</p></div>` : ''}
    <div class="ins"><label>Reading it honestly</label>${obsHow('A point outside the band describes the recent path; it does not predict the next move.', `<p class="small">The shaded band is where 90% of copies of these same returns land when their signs are randomised: same sizes, same busy and quiet hours, no memory of direction. Measured noise sits at an entropy of about ${f3(bP.mid)}, not 1, and around, not exactly at, a Hurst of 0.5. Persistent or anti-persistent describes the window at scales of 1 to 32 minutes. With 16 pairs, a few will fall outside by chance alone. A point outside the band describes the recent path; it does not predict the next move.</p>`)}</div>
    <p class="small muted rg-legend"><span style="white-space:nowrap"><i class="rg-zone" aria-hidden="true" style="background:color-mix(in srgb,var(--tx2) 22%,transparent)"></i>noise band</span> <span style="white-space:nowrap"><i class="rg-zone" aria-hidden="true" style="background:color-mix(in srgb,var(--ind1) 14%,transparent)"></i>persistent</span> <span style="white-space:nowrap"><i class="rg-zone" aria-hidden="true" style="background:color-mix(in srgb,var(--info) 14%,transparent)"></i>anti-persistent</span> ${obsSw('--up', 'up', 'up over the window')} ${obsSw('--dn', 'dn', 'down over the window')} <span style="white-space:nowrap">dot size = volatility</span> <span style="white-space:nowrap"><i class="const-ring" aria-hidden="true" style="border-color:var(--acc)"></i>open pair</span></p>
    ${obsHow(`Method: the last ${n} one-minute bars, noise band from 160 sign-randomised copies.`, `<p class="small muted">The last ${n} one-minute bars; returns across a closed market are left out. Hurst from the aggregated-variance method on 1-minute returns summed over 1 to 32 minutes; entropy is the normalised Shannon entropy of 4-point ordinal patterns in 5-minute returns, averaged over the five ways to cut the 5-minute grid (patterns with a tie are skipped). Noise band from 160 sign-randomised copies of the measured windows (fixed seed).</p>`)}`;
  const sp = $('#rgSpark'); if (sp && roll.length > 1) {
    const mn = Math.min(.4, bR.lo, ...roll.map(r => r.H)), mx = Math.max(.6, bR.hi, ...roll.map(r => r.H)), W2 = 220, H2 = 34, yy = v => H2 - (v - mn) / (mx - mn) * H2;
    sp.innerHTML = `<svg viewBox="0 0 ${W2} ${H2}" width="100%" height="${H2}" preserveAspectRatio="none"><rect x="0" width="${W2}" y="${yy(bR.hi)}" height="${yy(bR.lo) - yy(bR.hi)}" fill="${col.tx2}" fill-opacity=".14"/><line x1="0" x2="${W2}" y1="${yy(.5)}" y2="${yy(.5)}" stroke="${col.grid}" stroke-dasharray="3 3"/><polyline fill="none" stroke="${cssv('--ind1')}" stroke-width="1.6" vector-effect="non-scaling-stroke" points="${roll.map((r, i) => `${i / (roll.length - 1) * W2},${yy(r.H)}`).join(' ')}"/></svg>`;
    // the scale: the span (hours of trading, one point each), the Hurst range drawn and the 0.50 reference
    sp.nextElementSibling.innerHTML = `<span>${spH}h of trading</span><span>H ${f2(mn)}–${f2(mx)}, dashed 0.50</span><span>now</span>`;
  }
  b.querySelectorAll('[data-sym]').forEach(x => x.addEventListener('click', () => setSymbol(x.dataset.sym)));
  // the per-pair table repeats the plot's H and PE and adds what it lacks (ER, time in zone, every pair readable
  // without a mouse); folded by default, its state kept across the 5 s redraws; opening it shortens the plot box
  const det = b.querySelector('.rg-tbl-wrap'); det.addEventListener('toggle', () => { OBS.rgTblOpen = det.open; obsRefit(); });
  const tbl = b.querySelector('.rg-tbl'), srt = OBS.rgSort || (OBS.rgSort = { k: 'pair', d: 1 });
  const val = (r, k) => !r.p ? null : k === 'pair' ? pretty(r.s) : k === 'zone' ? RG_ZORD[r.p.per.zone] : k === 'per' ? r.p.per.run + (r.p.per.run === r.p.per.nw ? .5 : 0) : r.p[k];
  const cell = r => { const p = r.p; if (!p) return `<td>—</td><td>—</td><td>—</td><td>—</td><td>—</td>`; return `<td class="mono">${f2(p.H)}</td><td class="mono">${f3(p.pe)}</td><td class="mono">${pct(p.er)}</td><td>${zoneW[p.per.zone]}</td><td class="mono" data-tip="${escHtml(`In zone ${rgPerH(p.per)}|${p.per.run} of ${p.per.nw} hourly windows of ${n} bars, from now back, are in the ${zoneW[p.per.zone]} zone. The windows overlap, so zones last about a window's length by construction.`)}">${rgPerH(p.per)}</td>`; };
  const fill = () => {
    tbl.tHead.rows[0].innerHTML = RG_COLS.map(([k, l]) => `<th${srt.k === k ? ` aria-sort="${srt.d > 0 ? 'ascending' : 'descending'}"` : ''}><button type="button" class="rg-sort" data-k="${k}">${l}${srt.k === k ? (srt.d > 0 ? ' ▲' : ' ▼') : ''}</button></th>`).join('');
    const sorted = rows.slice().sort((x, y) => { const a = val(x, srt.k), z = val(y, srt.k); if (a == null || z == null) return a == null ? (z == null ? 0 : 1) : -1; return (typeof a === 'string' ? a.localeCompare(z) : a - z) * srt.d || x.s.localeCompare(y.s); });
    tbl.tBodies[0].innerHTML = sorted.map(r => `<tr data-row="${r.s}"${r.s === S.set.sym ? ' class="cur" aria-current="true"' : ''}${r.why ? ` data-tip="${escHtml(`${pretty(r.s)}|Not measured: ${r.why}.`)}"` : ''}><th scope="row"><button type="button" class="rg-open">${pretty(r.s)}</button></th>${cell(r)}</tr>`).join('');
  };
  fill();
  tbl.addEventListener('click', e => {
    const sb = e.target.closest('.rg-sort'); if (sb) { const k = sb.dataset.k; if (srt.k === k) srt.d = -srt.d; else { srt.k = k; srt.d = 1; } fill(); const nb = tbl.querySelector(`.rg-sort[data-k="${k}"]`); if (nb) nb.focus(); return; }
    const tr = e.target.closest('tbody tr'); if (tr) setSymbol(tr.dataset.row);
  });
  $('#rgCv').onclick = e => { const r = e.target.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, hit = OBS.rgPts.find(p => Math.hypot(p.x - x, p.y - y) < 14); if (hit) setSymbol(hit.s); };
}

/* ---------------- 3. Intrinsic time: directional-change events ---------------- */
function dcEvents(arr, th) {
  const ev = []; let mode = 1, ext = arr[0].close, extT = arr[0].time, extI = 0;
  for (let i = 0; i < arr.length; i++) {
    const k = arr[i], p = k.close;
    if (mode > 0) { if (p > ext) { ext = p; extT = k.time; extI = i; } else if (p <= ext * (1 - th)) { ev.push({ type: 'dn', dcP: p, dcT: k.time, i, extP: ext, extT, extI }); mode = -1; ext = p; extT = k.time; extI = i; } }
    else { if (p < ext) { ext = p; extT = k.time; extI = i; } else if (p >= ext * (1 + th)) { ev.push({ type: 'up', dcP: p, dcT: k.time, i, extP: ext, extT, extI }); mode = 1; ext = p; extT = k.time; extI = i; } }
  }
  if (ev.length) ev.shift(); // first event's extreme depends on the arbitrary start
  return { ev, mode, ext, extT, extI };
}
// the central 95% of Poisson(λ): the event counts a window with the average pace lands in 19 times in 20
function dcPois(lam) {
  let p = Math.exp(-lam), c = p, k = 0;
  while (c < .025) { k++; p *= lam / k; c += p; }
  const lo = k; while (c < .975) { k++; p *= lam / k; c += p; }
  return [lo, k];
}
// labels in a gutter, pushed apart so none overlaps the next: [{y, ...}] sorted by y, at least gap apart, inside [top, bot]
function obsSpread(L, gap, top, bot) {
  L.sort((a, z) => a.y - z.y);
  for (let i = 1; i < L.length; i++) L[i].y = Math.max(L[i].y, L[i - 1].y + gap);
  if (L.length && L[L.length - 1].y > bot) { L[L.length - 1].y = bot; for (let i = L.length - 2; i >= 0; i--) L[i].y = Math.min(L[i].y, L[i + 1].y - gap); }
  L.forEach(l => { l.y = Math.max(top, l.y); });
  return L;
}
/* Auto δ: the threshold that gives about DC_AUTO events per hour of trading on the history shown (a bisection on
   log δ: fewer events as δ grows), rounded to 0.001%. A soft setting (dcAuto): sanitizeState does not know it, so it is
   not kept across a reload, like OBS_SOFT. Cached on the last bar. */
const DC_AUTO = 1.5;
function dcAutoTh(arr, hours) {
  const k = `${arr.length}|${arr[arr.length - 1].time}|${arr[arr.length - 1].close}|${arr[0].time}`;
  OBS.dcAutoC = OBS.dcAutoC || {}; const hit = OBS.dcAutoC[S.set.sym]; if (hit && hit.k === k) return hit.th;
  const rate = th => dcEvents(arr, th).ev.length / hours; let lo = 1e-5, hi = .05;
  for (let i = 0; i < 32; i++) { const m = Math.sqrt(lo * hi); if (rate(m) > DC_AUTO) lo = m; else hi = m; }
  const raw = Math.sqrt(lo * hi), r3 = Math.round(raw * 1e5) / 1e5, rr = r3 > 0 ? rate(r3) : 0, th = rr >= 1 && rr <= 2 ? r3 : raw;
  OBS.dcAutoC[S.set.sym] = { k, th };
  return th;
}
// minutes of open market, short: 47m, 2.3h
const dcFm = m => m >= 60 ? `${(m / 60).toFixed(1)}h` : `${Math.round(m)}m`;
/* The scaling law: events at δ, 2δ and 4δ on the same history. For a random walk the count falls about 4× each time δ
   doubles (N ∝ δ⁻²; Glattfelder et al. find close to that in FX). Each ratio is read against a rough band from the
   Poisson noise of the two counts (±1.96·√(1/n₁ + 1/n₂) on the log ratio); under 10 events at the larger δ it is
   too thin to read. */
function dcScale(arr, th) {
  const rows = [1, 2, 4].map(f => ({ th: th * f, n: dcEvents(arr, th * f).ev.length }));
  rows.forEach((r, i) => {
    if (!i) return; const p = rows[i - 1]; r.ratio = r.n ? p.n / r.n : Infinity;
    r.call = r.n < 10 ? 'thin' : Math.abs(Math.log(r.ratio / 4)) < 1.96 * Math.sqrt(1 / p.n + 1 / r.n) ? 'near' : r.ratio > 4 ? 'above' : 'below';
  });
  return rows;
}
const DC_SCALE_SAY = {
  near: 'near 4: as a random walk scales',
  above: 'above 4: fewer reversals at the larger δ than a random walk gives for this many at the smaller one',
  below: 'below 4: more reversals at the larger δ than a random walk gives for this many at the smaller one',
  thin: 'too few events at the larger δ to read'
};
/* The threshold control gets an Auto option: a button with its own data-k inside the δ segment (the common click
   handler reads the closest data-k, so it sets dcAuto); a fixed δ clears it. The marks follow the setting in force. */
function dcCtrlSync(c, pct) {
  const ctrl = $('#obsCtrl'), seg = ctrl && ctrl.querySelector('[data-k="dcTh"]'); if (!seg) return;
  if (!ctrl.dataset.dcHook) { ctrl.dataset.dcHook = 1; ctrl.addEventListener('click', e => { const x = e.target.closest('[data-k="dcTh"] [data-val]'); if (x && !x.dataset.k) obsCfg().dcAuto = false; }); }
  let bt = seg.querySelector('[data-k="dcAuto"]');
  if (!bt) { seg.insertAdjacentHTML('beforeend', `<button data-k="dcAuto" data-val="true" data-tip="${escHtml(`Auto δ|δ chosen for this instrument so that the history shown gives about ${DC_AUTO} events per hour of trading (between 1 and 2): a busy pair gets a larger δ, a calm one a smaller δ. Its value is shown on the button. Not kept after a reload.`)}">Auto</button>`); bt = seg.querySelector('[data-k="dcAuto"]'); }
  const auto = !!c.dcAuto;
  seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === bt ? auto : !auto && String(c.dcTh) === x.dataset.val));
  bt.textContent = auto ? `Auto ${pct}` : 'Auto';
}
function drawDC(b, c) {
  const sym = S.set.sym, arr = Engine.candles[sym], col = chartColors(), m = M(sym), un = unitWord(sym);
  // the pace is counted on trading time: a closed market (the weekend) adds no hours
  const O = obsOpenT(arr.map(k => k.time)), endO = O[O.length - 1], hours = Math.max(endO / 3600, 1 / 60);
  const auto = !!c.dcAuto, th = auto ? dcAutoTh(arr, hours) : c.dcTh / 100, dPct = f => auto ? `${(th * f * 100).toFixed(3)}%` : `${(c.dcTh * f).toFixed(2)}%`, dS = dPct(1);
  dcCtrlSync(c, dS);
  const { ev, mode, ext } = dcEvents(arr, th);
  if (ev.length < 4) { b.innerHTML = `<div class="empty">Only ${obsPl(ev.length, 'directional change')} at ${dS} — pick a smaller threshold.</div>`; return; }
  // overshoot of event i = distance from its DC price to the next extreme (= next event's extP); its mean with n and a 95% interval
  const os = []; for (let i = 0; i < ev.length - 1; i++) os.push(Math.abs(Math.log(ev[i + 1].extP / ev[i].dcP)) / th);
  const avgOs = mean(os), osN = os.length, osSe = osN > 1 ? stdev(os) / Math.sqrt(osN) : 0, osCi = [Math.max(0, avgOs - 1.96 * osSe), avgOs + 1.96 * osSe];
  const rate = ev.length / hours;
  // heartbeat: events in the last 6 hours of trading against the average pace; coloured only outside the 95% band of
  // a Poisson count with that pace (a busier or quieter window happens by chance about 1 time in 20)
  const nRecent = ev.filter(e => O[e.i] > endO - 6 * 3600).length, lam = rate * 6, band = dcPois(lam), beat = nRecent / lam, hot = nRecent < band[0] || nRecent > band[1];
  // coastline: the length of the zigzag, every leg from extreme to extreme added up (in % of price)
  const zz = ev.map(e => e.extP).concat(ext); let coast = 0; for (let i = 1; i < zz.length; i++) coast += Math.abs(Math.log(zz[i] / zz[i - 1]));
  const cur = arr[arr.length - 1].close, net = Math.log(cur / arr[0].close);
  const last = ev[ev.length - 1], curOs = Math.abs(Math.log(ext / last.dcP)) / th, osRank = os.filter(v => v < curOs).length / Math.max(1, osN);
  const target = last.type === 'up' ? last.dcP * (1 + th * avgOs) : last.dcP * (1 - th * avgOs), rev = last.type === 'up' ? ext * (1 - th) : ext * (1 + th);
  const pipOf = v => Math.abs(v) / m.pip, legP = pipOf(target - last.extP), upL = last.type === 'up';
  // how far the reversal level is: in pips and in multiples of δ (δ in price = the extreme × δ; 1 at the extreme, 0 at the level)
  const revPips = pipOf(cur - rev), revD = Math.abs(cur - rev) / (ext * th);
  // leg durations, extreme to extreme, in minutes of open market; the current leg runs from its extreme to now
  const legs = []; for (let i = 0; i + 1 < ev.length; i++) legs.push((O[ev[i + 1].extI] - O[ev[i].extI]) / 60);
  const legAvg = mean(legs), legN = legs.length, legMed = djMedian(legs), legNow = (endO - O[last.extI]) / 60, legRank = legs.filter(v => v < legNow).length / Math.max(1, legN);
  const scale = dcScale(arr, th), histD = (arr[arr.length - 1].time - arr[0].time) / 86400, hist = `History: ${obsPl(Math.round(histD), 'day')} (${obsPl(Math.round(hours), 'hour')} of trading)`;
  OBS.dc = { rate, recent: nRecent, hours, lam, band, hot, osN, osCi, coast, net, th, auto, rev, revPips, revD, legAvg, legN, legNow, scale, axis: [] };
  const f2 = v => v.toFixed(2), hTxt = `${hours.toFixed(0)}h`;
  const scRows = scale.map((r, i) => `<tr><td class="mono">${i ? `${2 ** i}δ · ` : 'δ · '}${dPct(2 ** i)}</td><td class="mono">${r.n.toLocaleString('en-US')}</td><td class="mono">${i ? (isFinite(r.ratio) ? `÷${r.ratio.toFixed(1)}` : '—') : ''}</td><td class="l">${i ? DC_SCALE_SAY[r.call] : 'the base'}</td></tr>`).join('');
  // the reversal level leads as the module's hero (the one level the method defines in advance); its class stays 'acc'
  // for the tests and the ds-research block paints it in ink
  b.innerHTML = `<div class="obs-kpis">
      ${kpi('Reversal level', `${fp(sym, rev)} <small>${revPips.toFixed(1)} ${un} · ${f2(revD)} × δ</small>`, 'acc', `Reversal level|A ${dS} move back from the current extreme (${fp(sym, ext)}) would confirm a ${upL ? 'down' : 'up'} leg at this price, ${revPips.toFixed(1)} ${un} from the price now (${f2(revD)} × δ). The one level the method defines in advance: a natural place for an alert or a stop.`, 'hero')}${kpi('Events', ev.length + ` <small>${rate.toFixed(1)}/h</small>`, '', `Events|${obsPl(ev.length, 'reversal')} of ${dS} in ${hours.toFixed(0)} hours of trading, ${rate.toFixed(1)} per hour on average (closed hours left out). Each one is a step of intrinsic time.`)}${kpi('Heartbeat · last 6h', `${f2(beat)}× <small>${obsPl(nRecent, 'event')}</small>`, hot ? 'acc' : '', `Heartbeat|${obsPl(nRecent, 'event')} in the last 6 hours of trading; at the average pace ${lam.toFixed(1)} are expected, and a window of 6 hours lands between ${band[0]}–${band[1]} events 19 times in 20 by chance alone. ${hot ? (nRecent > band[1] ? 'Busier than that band: highlighted.' : 'Quieter than that band: highlighted.') : 'Inside that band: normal variation, not highlighted.'} The hour of day changes the pace too: London and New York hours bring more events than Asia.`)}${kpi('Avg overshoot', `${f2(avgOs)} × δ <small>n=${osN}</small>`, '', `Average overshoot|After a reversal is confirmed, price kept going ${f2(avgOs)} × δ further on average (n=${osN} legs; 95% interval ${f2(osCi[0])}–${f2(osCi[1])}). Research on FX finds about 1 × δ.`)}${kpi('Coastline', `${(coast * 100).toFixed(1)}% <small>${obsPl(zz.length - 1, 'leg')}</small>`, '', `Coastline|The length of the zigzag: every leg from extreme to extreme added up, ${(coast * 100).toFixed(1)}% of price over ${hours.toFixed(0)} hours of trading, against a net move of ${obsMinus(sgn(net * 100, 2))}%. How much the price travelled to get where it is.`)}
      ${kpi('Last leg', `<span class="${upL ? 'up' : 'dn'}">${upL ? 'up' : 'down'}</span> <small>δ ${dS}</small>`, '', `Last leg|The last confirmed move of δ = ${dS} was ${upL ? 'up from a low' : 'down from a high'}, and price has not reversed ${dS} back since. It says which way the last reversal went, nothing more; it does not say where the next leg goes.`)}${kpi('Overshoot so far', `${f2(curOs)} × δ`, '', `Overshoot so far|The current leg has run ${f2(curOs)} × δ past its confirmation, longer than ${(osRank * 100).toFixed(0)}% of the ${osN} past overshoots (average ${f2(avgOs)}). How long it runs on is not predicted.`)}${kpi('Average leg ends at', `${fp(sym, target)} <small>${legP.toFixed(legP < 10 ? 1 : 0)} ${un} leg</small>`, '', `Average leg|A price, not a forecast: where the current leg would end if it were exactly average (δ plus the average overshoot, ${legP.toFixed(1)} ${un} from its extreme). Legs end early or run long at random.`)}    </div><div class="dc-act"><span>The reversal level ${fp(sym, rev)} is <b class="mono">${revPips.toFixed(1)} ${un}</b> (<b class="mono">${f2(revD)} × δ</b>) from the price now.</span><button class="ghost sm" data-dc-alert${tipAttr(`Alert at reversal|Adds a price alert at ${fp(sym, rev)} on ${pretty(sym)} (${upL ? 'below' : 'above'} the price now), in the Alerts list like one set from the chart. It fires if the price crosses it; it is not an order.`)}>Alert at reversal</button><span class="muted dc-hist">${hist}</span></div>
    <div class="obs-cv tall"><canvas id="dcCv"></canvas></div><div class="obs-cv strip"><canvas id="dcBeat"></canvas></div>
    <div class="dc-more"><div class="ins dc-legs"><label>Leg duration · minutes of open market</label><p>Average leg <b class="mono">${dcFm(legAvg)}</b> (median ${dcFm(legMed)}, n=${legN}), extreme to extreme. The current leg has run <b class="mono">${dcFm(legNow)}</b> since its extreme, longer than ${(legRank * 100).toFixed(0)}% of past legs. How long it lasts is not predicted.</p></div>
    <div class="ins dc-scale"><label>Scaling law · events as δ doubles</label><table class="tbl sm dc-sc"><thead><tr><th>δ</th><th>Events</th><th>Ratio</th><th class="l">Reading</th></tr></thead><tbody>${scRows}</tbody></table><p class="small muted">For a random walk the count falls about 4× (≈ 4) each time δ doubles. A ratio is read against the rough noise of the two counts. It describes this history, not what comes next.</p></div></div>
    ${obsHow(`The top chart steps once per reversal of δ = ${dS}, not per minute; the levels on the right are scale references, not targets.`, `<p class="small muted pad-t">${hist}. The top chart's x-axis is <b>intrinsic time</b>: one step per directional change of δ = ${dS}${auto ? ' (auto: about 1–2 events per hour of trading on this history)' : ''} from the last extreme, not per minute (${ev.length > 80 ? `the last 80 of ${ev.length}` : `all ${ev.length}`}); the times under it are those of the extremes, UTC. Quiet hours shrink, busy hours stretch. Dots are the change points, the thick coloured segments the overshoots (how far price ran after confirming). On the right: the price now, the reversal level (dashed) and where an average leg would end (dotted, a scale reference, not a target: legs end early or run long at random). The bottom strip has its own x-axis, hours of trading (${hTxt}, closed hours left out): events per hour, the market's heartbeat; the shaded part is the span of the events drawn above.</p>`, 'pad-t')}`;
  b.querySelector('[data-dc-alert]').addEventListener('click', () => {
    // the level as it stands at the click (a new extreme moves it)
    const d = dcEvents(Engine.candles[sym], th), l = d.ev[d.ev.length - 1]; if (!l) return;
    const up = l.type === 'up'; addAlert(sym, up ? d.ext * (1 - th) : d.ext * (1 + th), up ? 'below' : 'above');
  });
  const show = ev.slice(-80), { g, w, h } = canvasFit($('#dcCv')), GL = 58, GR = 112, top = 10, bot = h - 36;
  // the scale: the whole zigzag unless a spike reaches more than a quarter of its middle 96% beyond it (then that spike
  // is clipped at the edge, so it does not flatten the rest), always with the price now, the reversal level and the average leg
  const zp = show.flatMap(e => [e.extP, e.dcP]).concat(ext).sort((a, z) => a - z), q = p => zp[Math.round(p * (zp.length - 1))];
  const q0 = q(.02), q1 = q(.98), rq = q1 - q0, zLo = zp[0] >= q0 - rq * .25 ? zp[0] : q0, zHi = zp[zp.length - 1] <= q1 + rq * .25 ? zp[zp.length - 1] : q1;
  const lo0 = Math.min(zLo, cur, rev, target, ext), hi0 = Math.max(zHi, cur, rev, target, ext), pad = (hi0 - lo0) * .06 || cur * 1e-4, mn = lo0 - pad, mx = hi0 + pad;
  const X = i => GL + i / (show.length + 1) * (w - GL - GR), Y = v => top + (1 - (v - mn) / (mx - mn)) * (bot - top);
  CV_HOVER.dcCv = e => {
    if (!e) return; const rc = e.target.getBoundingClientRect(), i = Math.floor((e.clientX - rc.left - GL) / (w - GL - GR) * (show.length + 1));
    if (i < 0 || i >= show.length) return brTipHide();
    const ev0 = show[i], nx = i + 1 < show.length ? show[i + 1].extP : ext, osh = Math.abs(Math.log(nx / ev0.dcP)) / th;
    cvTip(e, `${ev0.type === 'up' ? 'Up' : 'Down'} reversal · ${dts(ev0.dcT)} UTC`, [`From the extreme ${fp(sym, ev0.extP)} (${dts(ev0.extT)} UTC)`, `Confirmed at ${fp(sym, ev0.dcP)}, a ${dS} move back`, `Then ran ${osh.toFixed(2)} × δ further (overshoot)${i + 1 < show.length ? '' : ', still running'}`, `Event ${ev.length - show.length + i + 1} of ${ev.length}`]);
  };
  g.font = '11.5px JetBrains Mono'; g.fillStyle = col.tx; g.strokeStyle = col.grid; g.lineWidth = 1;
  // round ticks: multiples of a nice step in price
  const st = niceStep((mx - mn) / 4), dg = (String(+st.toPrecision(3)).split('.')[1] || '').length;
  for (let v = Math.ceil(mn / st) * st; v <= mx + 1e-12; v += st) { const y = Y(v); g.strokeStyle = col.grid; g.beginPath(); g.moveTo(GL, y); g.lineTo(w - GR, y); g.stroke(); g.fillStyle = col.tx; g.fillText(v.toFixed(dg), 2, y + 4); }
  // the time axis: the UTC time of the extreme at a few evenly spaced steps (the steps are events, so the gaps between
  // the times are uneven: that is the point of intrinsic time)
  const nT = Math.max(2, Math.min(6, Math.floor((w - GL - GR) / 120))), seen = new Set();
  for (let k = 0; k < nT; k++) { const i = Math.round(k * (show.length - 1) / (nT - 1)); if (!seen.has(i)) { seen.add(i); OBS.dc.axis.push({ i, t: show[i].extT }); } }
  g.font = '10.5px JetBrains Mono';
  OBS.dc.axis.forEach(({ i, t }) => {
    const x = X(i), s = dts(t), tw = g.measureText(s).width;
    g.strokeStyle = col.grid; g.beginPath(); g.moveTo(x, bot); g.lineTo(x, bot + 4); g.stroke();
    g.fillStyle = col.tx2; g.fillText(s, Math.max(GL, Math.min(w - GR - tw, x - tw / 2)), bot + 15);
  });
  g.fillStyle = col.tx2; g.fillText('UTC', 2, bot + 15);
  g.font = '11.5px JetBrains Mono'; g.fillStyle = col.tx; g.fillText(show.length < ev.length ? `last ${show.length} of ${ev.length} events` : `all ${ev.length} events`, GL, h - 4); const nl = 'now'; g.fillText(nl, w - GR - g.measureText(nl).width, h - 4);
  g.save(); g.beginPath(); g.rect(GL, top, w - GL - GR, bot - top); g.clip();
  // zigzag through extremes; overshoot segments
  g.beginPath(); show.forEach((e, i) => { const x = X(i); i ? g.lineTo(x, Y(e.extP)) : g.moveTo(x, Y(e.extP)); }); g.lineTo(X(show.length), Y(ext)); g.lineTo(X(show.length + 1) - 2, Y(cur)); g.strokeStyle = col.tx2; g.lineWidth = 1.2; g.stroke();
  show.forEach((e, i) => {
    const x0 = X(i), x1 = X(i + 1), nextExt = i + 1 < show.length ? show[i + 1].extP : ext;
    // DC point lies between this extreme and the next one; draw overshoot from DC to next extreme
    const fx = x0 + (x1 - x0) * Math.abs(e.dcP - e.extP) / Math.max(1e-12, Math.abs(nextExt - e.extP));
    g.strokeStyle = (e.type === 'up' ? col.up : col.dn); g.lineWidth = 3; g.globalAlpha = .55; g.beginPath(); g.moveTo(fx, Y(e.dcP)); g.lineTo(x1, Y(nextExt)); g.stroke(); g.globalAlpha = 1;
    g.beginPath(); g.arc(fx, Y(e.dcP), 2.6, 0, 6.283); g.fillStyle = e.type === 'up' ? col.up : col.dn; g.fill();
  });
  g.restore();
  // the three levels, across to the right gutter, named there: the price now, the reversal level, an average leg
  const xL = X(show.length) - 24, lv = [
    { v: cur, c: cssv('--tx'), dash: [], lw: 1, lab: `now ${fp(sym, cur)}` },
    { v: rev, c: cssv('--ind1'), dash: [6, 4], lw: 1.6, lab: `reversal ${fp(sym, rev)}` },
    { v: target, c: col.tx2, dash: [2, 3], lw: 1, lab: `avg leg ${fp(sym, target)}` }];
  lv.forEach(l => { g.setLineDash(l.dash); g.strokeStyle = l.c; g.lineWidth = l.lw; g.beginPath(); g.moveTo(xL, Y(l.v)); g.lineTo(w - GR + 4, Y(l.v)); g.stroke(); });
  g.setLineDash([]); g.font = '10.5px JetBrains Mono';
  obsSpread(lv.map(l => ({ ...l, y: Y(l.v) + 4 })), 13, top + 8, bot).forEach(l => { g.fillStyle = l.c; g.fillText(l.lab, w - GR + 7, l.y); });
  // heartbeat strip: its own axis, hours of trading
  const s2 = canvasFit($('#dcBeat')), hrs = Math.max(1, Math.ceil(hours)), bins = Array(hrs).fill(0);
  ev.forEach(e => { const k = Math.min(hrs - 1, Math.floor(O[e.i] / 3600)); if (k >= 0) bins[k]++; });
  const bm = Math.max(...bins, 1), bw = (s2.w - GL - GR) / hrs, h0 = Math.floor(O[show[0].i] / 3600);
  s2.g.fillStyle = col.tx2 + '1c'; s2.g.fillRect(GL + h0 * bw, 0, (hrs - h0) * bw, s2.h - 14);
  bins.forEach((v, i) => { s2.g.fillStyle = col.tx2 + (i >= hrs - 6 ? 'ee' : '88'); s2.g.fillRect(GL + i * bw, s2.h - 16 - v / bm * (s2.h - 22), Math.max(1, bw - .5), v / bm * (s2.h - 22)); });
  s2.g.fillStyle = col.tx; s2.g.font = '10.5px JetBrains Mono'; s2.g.fillText('events/h', 2, 12); s2.g.fillText(`max ${bm}`, 2, 25);
  s2.g.fillText(`−${hTxt} of trading`, GL, s2.h - 3); const nw = 'now'; s2.g.fillText(nw, s2.w - GR - s2.g.measureText(nw).width, s2.h - 3);
}

/* ---------------- 4. Déjà vu: nearest-neighbour analogues ---------------- */
// a window's shape (z-scored log path), its level spread (s) and the volatility of its bars (sr, RMS of the bar returns)
function zpath(cl, a, W) { const base = cl[a], p = []; for (let i = 0; i < W; i++) p.push(Math.log(cl[a + i] / base)); const m = mean(p), s = stdev(p) || 1e-9; let v = 0; for (let i = 1; i < W; i++) v += (p[i] - p[i - 1]) ** 2; return { z: p.map(x => (x - m) / s), s, sr: Math.sqrt(v / Math.max(1, W - 1)) || 1e-9 }; }
const DJ_MIN = 20;
/* The tool offers 27 settings on a pair (3 timeframes × 3 patterns × 3 look-aheads). The verdict's interval is widened
   for all of them (Bonferroni: two-sided 5% / 27 → z 3.11), so the one setting in twenty that clears 50% by luck does
   not read as an edge. */
const DJ_SET = 27, DJ_Z = 3.11;
const djMedian = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
const djQ = (s, p) => s[Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))))];
// the data is the engine's own simulation unless recorded bars are replayed or a live feed is attached
const obsSim = () => !Engine.feedOn && Engine.source !== 'replay-bars';
const djDur = mins => mins >= 60 ? `${+(mins / 60).toFixed(1)}h` : `${mins}m`;
function drawDeja(b, c) {
  const W = c.dvW, Hh = c.dvH, tf = c.dvTf, sec = tf * 60, sym = S.set.sym, col = chartColors(), m = M(sym), un = unitWord(sym);
  // per pair: log closes (from its first one) and their running sums, so a window's mean, spread and bar volatility
  // cost three subtractions instead of a pass over the window
  const series = Engine.PAIRS.map(p => {
    const bars = Engine.aggregate(p.sym, tf, 4000), n = bars.length, cl = bars.map(k => k.close), lc = new Float64Array(n), P1 = new Float64Array(n + 1), P2 = new Float64Array(n + 1), D2 = new Float64Array(n);
    for (let i = 0; i < n; i++) { lc[i] = Math.log(cl[i] / cl[0]); P1[i + 1] = P1[i] + lc[i]; P2[i + 1] = P2[i] + lc[i] * lc[i]; if (i) D2[i] = D2[i - 1] + (lc[i] - lc[i - 1]) ** 2; }
    return { s: p.sym, cl, T: bars.map(k => k.time), lc, P1, P2, D2 };
  });
  // the same numbers as zpath for the window at a: mean, spread (sample σ of the log levels) and RMS of the bar returns
  const stat = (S2, a) => { const s1 = S2.P1[a + W] - S2.P1[a], mm = s1 / W, v = (S2.P2[a + W] - S2.P2[a] - s1 * mm) / (W - 1); return { mm, s: Math.sqrt(Math.max(0, v)) || 1e-9, sr: Math.sqrt(Math.max(0, S2.D2[a + W - 1] - S2.D2[a]) / (W - 1)) || 1e-9 }; };
  const me = series.find(x => x.s === sym), cl = me.cl, N = cl.length;
  OBS.dj = null;
  if (N < W + Hh + 40) { b.innerHTML = `<div class="empty">Not enough ${tf}m history for a ${W}-bar pattern yet.</div>`; return; }
  const q = zpath(cl, N - W, W), tNow = me.T[N - W];
  /* The search for a pattern that starts at t0: every W-bar window, on any pair, whose look-ahead ended before t0. The
     live search and every past test below use this same rule (walk-forward), so neither ever sees its own answer. */
  const search = (qz, t0) => {
    const out = [];
    for (const S2 of series) {
      const c2 = S2.cl, T2 = S2.T, n2 = c2.length, lc = S2.lc;
      for (let a = 0; a + W + Hh <= n2; a++) {
        if (T2[a + W + Hh - 1] >= t0) break;
        const st = stat(S2, a), lim = out.length >= 12 ? out[out.length - 1].d : Infinity; let d = 0;
        for (let i = 0; i < W; i++) { d += ((lc[a + i] - st.mm) / st.s - qz[i]) ** 2; if (d > lim) break; }
        if (out.length < 12 || d < out[out.length - 1].d) {
          // one match per moment: no two matches closer than the look-ahead (the same hour on three correlated pairs
          // is one event, not three analogues); a closer one replaces every match it overlaps
          const tE = T2[a + W - 1], near = out.filter(o => Math.abs(o.t - tE) < Hh * sec);
          if (near.some(o => o.d <= d)) continue;
          for (const o of near) out.splice(out.indexOf(o), 1);
          const z = Array.from({ length: W }, (_, i) => (lc[a + i] - st.mm) / st.s);
          out.push({ s: S2.s, a, d, z, sc: st.s, sr: st.sr, fut: Array.from({ length: Hh }, (_, k) => Math.log(c2[a + W + k] / c2[a + W - 1])), t: tE, tEnd: T2[a + W + Hh - 1] });
          out.sort((x, y) => x.d - y.d); if (out.length > 12) out.pop();
        }
      }
    }
    return out;
  };
  // the statistic shown and the one tested: each match's move rescaled by bar volatility (ours / theirs), its median
  const ends = (an, qsr) => an.map(o => o.fut[Hh - 1] / o.sr * qsr);
  const an = search(q.z, tNow);
  if (!an.length) { b.innerHTML = `<div class="empty">No ${W}-bar window at ${tf}m stays clear of the current pattern and its look-ahead yet: pick a shorter pattern or look-ahead.</div>`; return; }
  // everything in this pair's pips
  const px = Engine.quote(sym).mid, pip = v => v * px / m.pip, kOf = o => q.sr / o.sr;
  const fut = an.map(o => o.fut.map(v => v * kOf(o))), endL = ends(an, q.sr), endP = endL.map(pip);
  const end = endP.slice().sort((x, y) => x - y), med = djMedian(endP), up = end.filter(v => v > 0).length;
  // how close a match is: against the distance of a window taken at random (same rule, every 5th window)
  // the same windows give the unconditional cone: what followed every W-bar window, matched or not, rescaled the same way
  const ref = [], uf = Array.from({ length: Hh }, () => []);
  for (const S2 of series) for (let a = 0; a + W + Hh <= S2.cl.length && S2.T[a + W + Hh - 1] < tNow; a += 5) {
    const st = stat(S2, a); let d = 0; for (let i = 0; i < W; i++) d += ((S2.lc[a + i] - st.mm) / st.s - q.z[i]) ** 2; ref.push(d);
    const k0 = q.sr / st.sr, c0 = S2.cl[a + W - 1]; for (let k = 0; k < Hh; k++) uf[k].push(Math.log(S2.cl[a + W + k] / c0) * k0);
  }
  const dRef = djMedian(ref);
  uf.forEach(v => v.sort((x, y) => x - y));
  const unc = { n: uf[0].length, lo: uf.map(v => djQ(v, .25)), med: uf.map(djMedian), hi: uf.map(v => djQ(v, .75)) };
  /* The check on this pair's own past: at earlier moments one look-ahead apart (no two outcomes overlap, so the tests
     are independent on a random walk), the same search on what was known then, scored on the sign of the median. Kept
     outside OBS.cache (renderObs empties it): the key says what it was built from. */
  const key = `${sym}|${tf}|${W}|${Hh}|${me.T[N - 1]}`;
  if (!OBS.djRel || OBS.djRel.k !== key) {
    const log = [];
    for (let e = N - Hh - 1; e > W + 40 && log.length < 40; e -= Hh) {
      const qq = zpath(cl, e - W + 1, W), t0 = me.T[e - W + 1], nn = search(qq.z, t0);
      if (nn.length < 6) break; // earlier moments have even less history
      const en = ends(nn, qq.sr), mv = Math.log(cl[e + Hh] / cl[e]), pred = Math.sign(djMedian(en)), act = Math.sign(mv);
      // coverage: did the outcome land inside the middle half of its own matches (the band drawn as "middle half")
      const so = en.slice().sort((x, y) => x - y), cov = mv >= djQ(so, .25) && mv <= djQ(so, .75);
      if (pred && act) log.push({ e, t0, pred, act, mv, cov, ends: en, maxEnd: Math.max(...nn.map(o => o.tEnd)) });
    }
    OBS.djRel = { k: key, log, tests: log.length, hits: log.filter(x => x.pred === x.act).length };
  }
  const { tests, hits, log } = OBS.djRel, cov = { k: log.filter(x => x.cov).length, n: log.length };
  OBS.dj = { an, tests, hits, log, step: Hh, med, ends: endP, dRef, unc, cov };
  // a verdict needs DJ_MIN tests; under that the interval is too wide to say anything
  const enough = tests >= DJ_MIN, rel = enough ? hits / tests * 100 : null, ci = enough ? wilson(hits, tests, DJ_Z) : null, pc = v => (v * 100).toFixed(0);
  // the verdict leads; the direction of the matches is coloured only where the method has earned it
  const edge = rel == null ? null : ci.lo > .5 ? 1 : ci.hi < .5 ? -1 : 0, tone = v => edge === 1 ? cls(v) : '';
  const sel = `${sym}${tf}${W}${Hh}`; if (OBS.djKey !== sel) { OBS.djKey = sel; OBS.djSel = null; } OBS.djHov = null;
  const ivl = ci ? `${pc(ci.lo)}–${pc(ci.hi)}%` : '', how = `${obsPl(tests, 'past moment')} one look-ahead apart, each searched only in the history before it`;
  const fine = `The interval is widened for the ${DJ_SET} settings this tool offers on a pair (it would be ${(() => { const c95 = wilson(hits, tests); return c95 ? `${pc(c95.lo)}–${pc(c95.hi)}%` : '—'; })()} for one setting alone).`;
  const verdict = rel == null ? ['none', `Not enough tests (${tests} of ${DJ_MIN})`, `The method could be checked at only ${how}; a verdict needs at least ${DJ_MIN}. A shorter timeframe, pattern or look-ahead leaves more history to test on. Read the matches below as a description only.`]
    : edge === 1 ? ['ok', `Edge in this sample · ${rel.toFixed(0)}%`, `At ${how}, the median of the matches called the next ${djDur(Hh * tf)} right ${rel.toFixed(0)}% of the time and the whole interval (${ivl}) is above a coin flip. ${fine} With 16 pairs (${DJ_SET * 16} settings in all) some still clear it by chance: expect false hits and check it on new data before trusting it.`]
    : edge === -1 ? ['none', `Worse than a coin flip · ${rel.toFixed(0)}%`, `At ${how}, the matches were wrong more often than right (interval ${ivl}). ${fine} On a random walk that is chance too, not a contrarian signal.`]
    : ['none', `No edge on ${pretty(sym)} · ${rel.toFixed(0)}%`, `At ${how}, the median of the matches called the next ${djDur(Hh * tf)} right ${rel.toFixed(0)}% of the time; the interval ${ivl} includes 50%, so the method is no better than a coin flip here. ${fine} Read the direction below as noise; the spread still shows how far price moved after similar shapes.`];
  // the band check: how often the real outcome landed in the middle half of its matches; 50% when the band is as wide as the outcomes
  const cvP = cov.n ? Math.round(cov.k / cov.n * 100) : 0, cvCi = cov.n >= DJ_MIN ? wilson(cov.k, cov.n) : null;
  const cvSay = !cov.n ? 'no past tests yet' : !cvCi ? `too few tests to judge (${cov.n} of ${DJ_MIN})` : cvCi.hi < .5 ? 'under 50%: the band was narrower than the outcomes' : cvCi.lo > .5 ? 'over 50%: the band was wider than the outcomes' : 'consistent with 50%';
  const covHtml = `<div class="dj-cov" tabindex="0"${tipAttr(`Middle-half coverage|At the same ${obsPl(cov.n, 'past moment')} as the verdict, did the real move land inside the middle half of that moment's matches (the band drawn as "middle half")? A band that describes the outcomes well holds about 50% of them; well under 50% means it was too narrow, well over too wide.${cvCi ? ` 95% interval ${pc(cvCi.lo)}–${pc(cvCi.hi)}%.` : ''} It checks the width of the band, not its direction.`)}><span>Middle-half coverage <b class="mono">${cvP}%</b> · ${cov.k} of ${obsPl(cov.n, 'test')} · target 50%${cvCi ? ` (95% ${pc(cvCi.lo)}–${pc(cvCi.hi)}%)` : ''}</span><small>${cvSay}</small></div>`;
  const uQ = (k, p) => pip(p === .25 ? unc.lo[k] : unc.hi[k]);
  const dTip = d => `distance ${d.toFixed(1)}; a window taken at random is about ${dRef.toFixed(0)}`;
  const res = (o, j) => `<div class="dj-row${OBS.djSel === j ? ' on' : ''}" data-i="${j}"><button class="dj-it" data-i="${j}"${tipAttr(`${pretty(o.s)} · ${dts(o.t)} UTC|Match ${j + 1} of ${an.length}: its last ${W} bars had the ${j ? `${j + 1}${['st', 'nd', 'rd'][j] || 'th'} closest` : 'closest'} shape (${dTip(o.d)}). Over the next ${Hh} bars it moved ${obsSgn(endP[j], 1)} ${un}, rescaled by bar volatility to ${pretty(sym)}. Click to show it on the chart.`)}><span class="mono">${j + 1}</span><span>${pretty(o.s)}</span><span class="muted">${dts(o.t)}</span><span class="mono ${tone(endP[j])}">${obsSgn(endP[j], 1)}</span></button><button class="ghost xs dj-go" data-i="${j}" aria-label="Open ${pretty(o.s)} at ${dts(o.t)} on the Trade chart"${tipAttr('Open on the Trade chart|Switches to Trade with this pair and timeframe, scrolled to the moment of the match. A “← back to Déjà vu” button on the chart returns here.')}>↗</button></div>`;
  b.innerHTML = `<div class="obs-split"><div class="dj-main"><div class="obs-cv"><canvas id="djCv"></canvas></div>
      <div class="dj-leg small">${obsSw('--tx', 'now', `${pretty(sym)} · last ${W} bars (${djDur(W * tf)})`)} ${obsSw('--ind1', 'med', 'median of the matches')} <span style="white-space:nowrap"><i aria-hidden="true" class="dj-band"></i>middle half</span> <span style="white-space:nowrap"><i aria-hidden="true" class="dj-band dj-unc"></i>all windows, no match</span> ${obsSw('--up', 'up', 'match ended higher')} ${obsSw('--dn', 'dn', 'match ended lower')}</div></div><aside class="obs-side">
    <div class="dj-verdict ${verdict[0]}" tabindex="0"${tipAttr(`${verdict[1]}|${verdict[2]}`)}><b>${verdict[1]}</b>${rel == null ? '' : `<span class="mono">${ivl} · ${obsPl(tests, 'test')} · ${DJ_SET} settings</span>`}</div>${covHtml}
    <div class="ins"><label>What the ${an.length} closest matches did next · ${Hh} bars (${djDur(Hh * tf)})</label><p><b class="${tone(up - an.length / 2)}" tabindex="0"${tipAttr(`Matches that rose|${up} of the ${an.length} closest matches were higher ${djDur(Hh * tf)} later. About half is what chance alone gives.`)}>${up} of ${an.length} rose</b>. Median <b class="mono ${tone(med)}" tabindex="0"${tipAttr(`Median move|The middle result of the matches after ${Hh} bars, rescaled by bar volatility to ${pretty(sym)}: half did better, half worse. Its sign is what the check above scores.`)}>${obsSgn(med, 1)} ${un}</b>, middle half <b class="mono" tabindex="0"${tipAttr(`Middle half|A quarter of the matches did worse than ${obsSgn(djQ(end, .25), 0)} ${un} and a quarter better than ${obsSgn(djQ(end, .75), 0)} ${un}: the range of the usual outcome.`)}>${obsSgn(djQ(end, .25), 0)} to ${obsSgn(djQ(end, .75), 0)} ${un}</b>. All ${unc.n.toLocaleString('en-US')} windows of the same length, no match: middle half <b class="mono" tabindex="0"${tipAttr(`Without matching|What followed every ${W}-bar window in the same history (all 16 pairs, every 5th window, look-ahead ended before the pattern), rescaled the same way: the reference the matches are drawn against (grey band). Matches that say something differ from it.`)}>${obsSgn(uQ(Hh - 1, .25), 0)} to ${obsSgn(uQ(Hh - 1, .75), 0)} ${un}</b>.</p></div>
    <div class="ins"><label>Closest matches · ${an.length}, one per moment</label><div class="dj-list"><div class="dj-hdr" aria-hidden="true"><span>#</span><span>Pair</span><span>When (UTC)</span><span>Next ${un}</span></div>${an.map(res).join('')}</div><p class="small muted">Shape distance: closest ${an[0].d.toFixed(1)}, a random window about ${dRef.toFixed(0)} (0 = identical).</p></div>
    <p class="small muted">The last ${W} bars are normalised (shape only, not size) and compared with every ${W}-bar window across all 16 pairs whose look-ahead ended before the pattern started, so the search never sees its own answer. One match per moment: the same hour on correlated pairs counts once. Each match's moves are rescaled by bar volatility (σ of the bar returns in our pattern against theirs) and shown in ${pretty(sym)}'s ${un}. The check runs the same search at earlier moments, on what was known then. ${obsSim() ? 'The check shows how often chance alone looks like skill.' : 'The prices are recorded or live market data: the check is the only evidence here, for one pair and one setting.'}</p></aside></div>`;
  const cv = $('#djCv'), tot = W + Hh;
  const qp = cl.slice(N - W).map(v => Math.log(v / cl[N - 1]));
  // a match drawn on our scale: the shape that was matched (its z-scores at our spread), then its moves rescaled by bar volatility
  const path = j => an[j].z.map(z => (z - an[j].z[W - 1]) * q.s).concat(fut[j]);
  const band = Array.from({ length: Hh }, (_, k) => fut.map(f => f[k]).sort((x, y) => x - y));
  let geo = null;
  const draw = () => {
    const { g, w, h } = canvasFit(cv), X = i => 58 + i / (tot - 1) * (w - 70);
    // the scale: every line unless a spike reaches more than a quarter of the middle 96% beyond it (then clipped), the pattern always
    const allP = qp.concat(...an.map((_, j) => path(j)), unc.lo, unc.hi).map(pip).sort((x, y) => x - y), q0 = djQ(allP, .02), q1 = djQ(allP, .98), rq = q1 - q0;
    const lo = Math.min(allP[0] >= q0 - rq * .25 ? allP[0] : q0, ...qp.map(pip)), hi = Math.max(allP[allP.length - 1] <= q1 + rq * .25 ? allP[allP.length - 1] : q1, ...qp.map(pip)), pad = (hi - lo) * .08 || 1;
    const mn = lo - pad, mx = hi + pad, Y = v => 10 + (1 - (pip(v) - mn) / (mx - mn)) * (h - 30), st = niceStep((mx - mn) / 5);
    g.strokeStyle = col.grid; g.fillStyle = col.tx; g.font = '11.5px JetBrains Mono';
    for (let p = Math.ceil(mn / st) * st; p <= mx; p += st) { const y = 10 + (1 - (p - mn) / (mx - mn)) * (h - 30); g.beginPath(); g.moveTo(58, y); g.lineTo(w - 10, y); g.stroke(); g.fillText(`${sgn(+p.toFixed(6), st < 1 ? 1 : 0)} ${un === 'pips' ? 'p' : 'pt'}`, 2, y + 4); }
    const xNow = X(W - 1); g.fillStyle = col.tx2 + '14'; g.fillRect(xNow, 10, w - 10 - xNow, h - 30); g.strokeStyle = col.tx2; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(xNow, 10); g.lineTo(xNow, h - 20); g.stroke(); g.setLineDash([]);
    g.fillStyle = col.tx2; g.fillText('now', xNow + 4, 22); const lab = `+${Hh} bars · ${djDur(Hh * tf)}`; g.fillText(lab, w - 12 - g.measureText(lab).width, h - 6); g.fillText(`−${W} bars · ${djDur(W * tf)}`, 58, h - 6);
    g.save(); g.beginPath(); g.rect(58, 10, w - 68, h - 30); g.clip();
    // the unconditional cone first, behind: grey fill with dashed edges
    g.beginPath(); unc.hi.forEach((v, k) => { const x = X(W + k); k ? g.lineTo(x, Y(v)) : g.moveTo(x, Y(v)); }); for (let k = Hh - 1; k >= 0; k--) g.lineTo(X(W + k), Y(unc.lo[k])); g.closePath(); g.fillStyle = col.tx2 + '24'; g.fill();
    g.setLineDash([4, 3]); g.strokeStyle = col.tx2 + 'aa'; g.lineWidth = 1;
    for (const e of [unc.lo, unc.hi]) { g.beginPath(); e.forEach((v, k) => k ? g.lineTo(X(W + k), Y(v)) : g.moveTo(X(W + k), Y(v))); g.stroke(); }
    g.setLineDash([]);
    g.beginPath(); band.forEach((v, k) => { const x = X(W + k); k ? g.lineTo(x, Y(djQ(v, .75))) : g.moveTo(x, Y(djQ(v, .75))); }); for (let k = Hh - 1; k >= 0; k--) g.lineTo(X(W + k), Y(djQ(band[k], .25))); g.closePath(); g.fillStyle = cssv('--ind1') + '33'; g.fill();
    const hl = OBS.djHov ?? OBS.djSel;
    an.forEach((o, j) => {
      if (j === hl) return; const p = path(j);
      g.beginPath(); p.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = (endP[j] >= 0 ? col.up : col.dn) + (hl == null ? '55' : '2a'); g.lineWidth = 1; g.stroke();
    });
    g.beginPath(); band.forEach((v, k) => { const x = X(W + k), y = Y(djMedian(v)); k ? g.lineTo(x, y) : (g.moveTo(xNow, Y(0)), g.lineTo(x, y)); }); g.strokeStyle = cssv('--ind1'); g.lineWidth = 2.2; g.stroke();
    g.beginPath(); qp.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = cssv('--tx'); g.lineWidth = 2.4; g.stroke();
    if (hl != null) { const p = path(hl); g.beginPath(); p.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = endP[hl] >= 0 ? col.up : col.dn; g.lineWidth = 2.6; g.stroke(); }
    g.restore();
    if (hl != null) { g.fillStyle = endP[hl] >= 0 ? col.up : col.dn; g.fillText(`${hl + 1} · ${pretty(an[hl].s)} ${dts(an[hl].t)} UTC`, X(2), 22); }
    geo = { X, Y, w, h };
  };
  draw();
  const mark = () => $$('#obsBody .dj-row').forEach(r => r.classList.toggle('on', +r.dataset.i === OBS.djSel));
  CV_HOVER.djCv = e => {
    if (!e) { if (OBS.djHov != null) { OBS.djHov = null; draw(); } return; }
    const rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, k = Math.round((x - 58) / (geo.w - 70) * (tot - 1));
    if (k < 0 || k >= tot) return brTipHide();
    const cands = an.map((_, j) => [j, Math.abs(geo.Y(path(j)[k]) - y)]).sort((a2, b2) => a2[1] - b2[1]);
    const nowD = k < W ? Math.abs(geo.Y(qp[k]) - y) : Infinity, best = cands[0];
    if (nowD < 10 && nowD <= best[1]) { if (OBS.djHov != null) { OBS.djHov = null; draw(); } return cvTip(e, `${pretty(sym)} · now`, [`The pattern searched: the last ${W} bars (${djDur(W * tf)})`, `${obsSgn(pip(qp[k]), 1)} ${un} from the current price`]); }
    if (best[1] > 12) { if (OBS.djHov != null) { OBS.djHov = null; draw(); } return brTipHide(); }
    const j = best[0]; if (OBS.djHov !== j) { OBS.djHov = j; draw(); }
    cvTip(e, `Match ${j + 1} · ${pretty(an[j].s)} · ${dts(an[j].t)} UTC`, [`Shape ${dTip(an[j].d)} (0 = identical)`, `After ${Hh} bars: ${obsSgn(endP[j], 1)} ${un} (rescaled by bar volatility)`, 'Click to keep it selected']);
  };
  cv.onclick = () => { if (OBS.djHov != null) { OBS.djSel = OBS.djSel === OBS.djHov ? null : OBS.djHov; mark(); draw(); } };
  b.querySelectorAll('.dj-it').forEach(x => x.addEventListener('click', () => { const j = +x.dataset.i; OBS.djSel = OBS.djSel === j ? null : j; mark(); draw(); }));
  b.querySelectorAll('.dj-go').forEach(x => x.addEventListener('click', () => {
    const o = an[+x.dataset.i], from = { sym: S.set.sym, tf: S.set.tf };
    if (S.set.sym !== o.s) setSymbol(o.s); if (S.set.tf !== tf) setTF(tf); setView('trade');
    setTimeout(() => { try { chart.timeScale().setVisibleRange({ from: o.t - sec * (W + 20), to: o.t + sec * (Hh + 20) }); } catch (e) { } }, 120);
    djBackShow(from);
  }));
  djBackHide(); // back on the tool: the way back has been used or is no longer needed
}
/* The way back from ↗: a button on the chart that reopens Déjà vu with the pair and timeframe from before; × dismisses it. */
function djBackHide() { const el = document.getElementById('djBack'); if (el) el.remove(); }
function djBackShow(from) {
  djBackHide();
  const host = ($('#chart') && $('#chart').parentElement) || document.body, el = document.createElement('div');
  el.id = 'djBack'; el.className = 'dj-back';
  el.innerHTML = `<button class="sm" data-dj-back${tipAttr(`Back to Déjà vu|Reopens the Observatory on Déjà vu with ${pretty(from.sym)} and the ${from.tf}m chart timeframe from before.`)}>← back to Déjà vu</button><button class="ghost xs" data-dj-x aria-label="Dismiss the way back to Déjà vu">×</button>`;
  el.querySelector('[data-dj-x]').onclick = djBackHide;
  el.querySelector('[data-dj-back]').onclick = () => {
    djBackHide();
    if (S.set.sym !== from.sym) setSymbol(from.sym); if (S.set.tf !== from.tf) setTF(from.tf);
    obsCfg().view = 'deja'; save(); setView('research', 'obs');
  };
  host.appendChild(el);
}
/* Déjà vu follows the 5 s tick on a new closed bar of its timeframe only (its key is the bar, not the last quote), so it is
   not recomputed every tick; obsTick's own guards (pointer or focus in the view, market closed) apply as for the others. */
OBS_LIVE.push('deja');
const obsKeyBase = obsKey;
obsKey = function () {
  const c = obsCfg(); if (c.view !== 'deja') return obsKeyBase();
  const sym = S.set.sym, a = Engine.candles[sym], k = a && a[a.length - 1];
  return `deja|${sym}|${c.dvTf}|${c.dvW}|${c.dvH}|${k ? Math.floor(k.time / (c.dvTf * 60)) : ''}|${mktState(sym).open}`;
};

/* ---------------- 5. Recurrence plot + RQA ---------------- */
function rqa(Rb, N) {
  let rec = 0, det = 0, lam = 0;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j && Rb[i * N + j]) rec++;
  // diagonal lines (exclude main diagonal)
  for (let k = 1; k < N; k++) { let run = 0; for (let i = 0; i + k < N; i++) { if (Rb[i * N + i + k]) run++; else { if (run >= 2) det += run * 2; run = 0; } } if (run >= 2) det += run * 2; }
  for (let j = 0; j < N; j++) { let run = 0; for (let i = 0; i < N; i++) { if (i !== j && Rb[i * N + j]) run++; else { if (run >= 2) lam += run; run = 0; } } if (run >= 2) lam += run; }
  return { rr: rec / (N * N - N), det: rec ? det / rec : 0, lam: rec ? lam / rec : 0 };
}
function rpBuild(r, m, eps) {
  const N = r.length - m + 1, V = []; for (let i = 0; i < N; i++) V.push(r.slice(i, i + m));
  const Dm = new Float32Array(N * N); let all = [];
  for (let i = 0; i < N; i++) for (let j = i; j < N; j++) { let d = 0; for (let k = 0; k < m; k++) d += (V[i][k] - V[j][k]) ** 2; d = Math.sqrt(d); Dm[i * N + j] = Dm[j * N + i] = d; if (j > i && (i + j) % 3 === 0) all.push(d); }
  all.sort((a, b) => a - b); const e = eps ?? all[Math.floor(all.length * .1)];
  const Rb = new Uint8Array(N * N); for (let i = 0; i < N * N; i++) Rb[i] = Dm[i] <= e ? 1 : 0;
  return { N, Dm, Rb, eps: e, max: all[all.length - 1], all };
}
// the recurrence matrix alone, at a given threshold (the shuffles need nothing else)
function rpRb(r, m, eps) {
  const N = r.length - m + 1, Rb = new Uint8Array(N * N), e2 = eps * eps;
  for (let i = 0; i < N; i++) { Rb[i * N + i] = 1; for (let j = i + 1; j < N; j++) { let d = 0; for (let k = 0; k < m; k++) d += (r[i + k] - r[j + k]) ** 2; if (d <= e2) Rb[i * N + j] = Rb[j * N + i] = 1; } }
  return Rb;
}
// the share of sampled distances below d (0 = the most similar pair of states, 1 = the most different)
function rpRank(all, d) { let lo = 0, hi = all.length; while (lo < hi) { const k = (lo + hi) >> 1; if (all[k] < d) lo = k + 1; else hi = k; } return lo / all.length; }
/* The usual size of a move at each UTC hour: mean absolute 1-minute return of the symbol per hour of day (closed-market
   gaps left out). Returns are divided by it before they become states, so the daily rhythm of busy and quiet hours
   (which shuffling destroys) does not count as structure. */
function rpSeason(sym) {
  const a = Engine.candles[sym], T = a.map(k => k.time), s = Array(24).fill(0), n = Array(24).fill(0);
  for (let i = 1; i < a.length; i++) { if (isGapAt(T, i)) continue; const h = new Date(T[i] * 1000).getUTCHours(); s[h] += Math.abs(Math.log(a[i].close / a[i - 1].close)); n[h]++; }
  const all = s.reduce((x, v) => x + v, 0) / Math.max(1, n.reduce((x, v) => x + v, 0)) || 1;
  return Float64Array.from(s, (v, h) => n[h] && v > 0 ? v / n[h] : all);
}
/* The noise band: RP_SIMS shuffles of the same returns (order destroyed, sizes kept). Three checks are read from it
   (determinism high or low, laminarity high), so each uses the band that leaves 5% / 3 outside (RP_QC); a value
   outside the plain 90% band but inside that one is borderline. */
const RP_SIMS = 120, RP_QC = .05 / 3;
function rpCall(b, hiOnly = false) {
  const v = b.v;
  if (v > b.hi) return 'above'; if (!hiOnly && v < b.lo) return 'below';
  if (v > b.hi90 || (!hiOnly && v < b.lo90)) return 'borderline';
  return 'inside';
}
/* The regime now: how often the last RP_NOW_W states recur among the states outside them, ranked against every stretch
   of RP_NOW_W states in the window (overlapping stretches: n counts stretches, not independent cases), with the mean
   size of their newest returns against the window's (the hour-of-day rhythm already divided out). Familiar states are
   mostly calm ones, rare states mostly large moves; the label names calm or busy only when the size agrees by more
   than RP_NOW_SZ (10%), otherwise an extreme rank is just "unusual".
   Under RP_THIN states the window's measures move a lot from one window to the next. */
const RP_NOW_W = 24, RP_NOW_Q = .1, RP_NOW_SZ = .1, RP_THIN = 200;
function rpNowLabel(rank, size) {
  if (rank <= RP_NOW_Q) return size > 1 + RP_NOW_SZ ? 'Busier than usual' : 'Unusual states';
  if (rank >= 1 - RP_NOW_Q) return size < 1 - RP_NOW_SZ ? 'Calmer than usual' : 'Unusual states';
  return 'Usual';
}
function rpNow(A, r, m, W = RP_NOW_W) {
  const N = A.N, Rb = A.Rb; if (N < 2 * W) return null;
  const row = new Float64Array(N); for (let i = 0; i < N; i++) { let k = 0; for (let j = 0; j < N; j++) k += Rb[i * N + j]; row[i] = k; }
  const all = r.slice(m - 1).reduce((x, v) => x + Math.abs(v), 0) / N, rr = [], sz = [];
  for (let s = 0; s + W <= N; s++) {
    let k = 0, a = 0; for (let i = s; i < s + W; i++) { k += row[i]; for (let j = s; j < s + W; j++) k -= Rb[i * N + j]; a += Math.abs(r[i + m - 1]); }
    rr.push(k / (W * (N - W))); sz.push(a / W);
  }
  const nB = rr.length, now = rr[nB - 1], rank = rr.filter(x => x < now).length / nB, size = sz[nB - 1] / (all || 1), q = rr.slice().sort((x, y) => x - y);
  const at = p => q[Math.round(p * (nB - 1))];
  return { w: W, rr: now, rank, nB, size, lo: at(RP_NOW_Q), hi: at(1 - RP_NOW_Q), label: rpNowLabel(rank, size) };
}
function drawRP(b, c) {
  const sym = S.set.sym, bars = Engine.aggregate(sym, c.rpTf, 260), cl = bars.map(k => k.close), col = chartColors(), mt = M(sym), un = unitWord(sym);
  const prof = rpSeason(sym), rs = logret(cl).map((x, i) => x / prof[new Date(bars[i + 1].time * 1000).getUTCHours()]), sd = stdev(rs) || 1, r = rs.map(x => x / sd), m = 3;
  OBS.rpIn = r;
  const A = rpBuild(r, m), q = rqa(A.Rb, A.N), N = A.N, tState = k => bars[Math.min(bars.length - 1, k + m)].time;
  const rn = OBS.rpNow = rpNow(A, r, m), hW = RP_NOW_W * c.rpTf / 60, pc1 = v => (v * 100).toFixed(1);
  // kept outside OBS.cache (renderObs and the tick empty it): the key says what the band was built from
  const key = `${sym}|${c.rpTf}|${m}|${RP_SIMS}|${N}|${bars[bars.length - 1].time}`;
  if (!OBS.rpBand || OBS.rpBand.k !== key) {
    let seed = 7; const rnd = () => (seed = (seed * 9301 + 49297) % 233280) / 233280, sims = [];
    for (let s = 0; s < RP_SIMS; s++) { const sh = r.slice(); for (let i = sh.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [sh[i], sh[j]] = [sh[j], sh[i]]; } sims.push(rqa(rpRb(sh, m, A.eps), N)); }
    const band = a => { a = a.slice().sort((x, y) => x - y); const at = p => a[Math.round(p * (a.length - 1))]; return { lo90: at(.05), hi90: at(.95), lo: at(RP_QC), hi: at(1 - RP_QC), mid: at(.5) }; };
    const det = band(sims.map(x => x.det)), lam = band(sims.map(x => x.lam));
    // the real coverage: the share of the shuffles themselves that none of the three checks would call
    const cov = sims.filter(x => x.det <= det.hi && x.det >= det.lo && x.lam <= lam.hi).length / RP_SIMS;
    OBS.rpBand = { k: key, det, lam, n: RP_SIMS, cov };
  }
  const { det: bD, lam: bL, n: nSh, cov } = OBS.rpBand, pc = v => (v * 100).toFixed(1);
  const cD = rpCall({ v: q.det, ...bD }), cL = rpCall({ v: q.lam, ...bL }, true);
  const SZ = 'Most likely calm and busy stretches coming back (the sizes of the moves): the plot does not tell size from direction, and it does not say where price goes next.';
  const fa = `A shuffled copy gets a call ${((1 - cov) * 100).toFixed(0)}% of the time.`;
  const verdict = cD === 'above' ? ['rp-hit', 'Repeating sequences', `Sequences of states repeat more often than in ${nSh} shuffled copies of the same returns, after dividing out the usual size of moves at each hour of the day. ${SZ} ${fa}`]
    : cL === 'above' ? ['rp-hit', 'Stuck phases', `The market stays in one state more often than in ${nSh} shuffled copies, after dividing out the usual size of moves at each hour of the day: stretches of similar, usually calm, moves. A description of the window, not a forecast. ${fa}`]
    : cD === 'below' ? ['rp-hit', 'Unusually novel moves', `Fewer repeating sequences than in ${nSh} shuffled copies: recent moves did not look like each other. ${fa}`]
    : cD === 'borderline' || cL === 'borderline' ? ['rp-calm', 'Borderline', `${cD === 'borderline' ? 'Determinism' : 'Laminarity'} sits outside the 90% band of the shuffles but inside the band corrected for the three checks: too close to call structure. ${fa}`]
    : ['rp-calm', 'No structure beyond chance', `Both measures sit inside the band of ${nSh} shuffled copies of the same returns (the hour-of-day rhythm divided out): the order of the moves looks random. ${fa}`];
  const say = (k, above, below) => k === 'above' ? above : k === 'below' ? below : k === 'borderline' ? 'Borderline: outside the 90% band, inside the corrected one — too close to call.' : 'Inside the noise band: no repetition beyond chance.';
  // what the current state resembles: the closest earlier states, one per 4 states, each with its W bars after it
  // ending before the current state starts (j + m + W < now), so "after" never reads the present
  const W = 8, now = N - 1, near = [];
  for (const j of [...Array(Math.max(0, now - W - m)).keys()].sort((a, b2) => A.Dm[now * N + a] - A.Dm[now * N + b2])) { if (near.length >= 3) break; if (near.every(x => Math.abs(x - j) >= 4)) near.push(j); }
  // the size of what followed (high to low of the closes), not its direction
  const after = j => { const i0 = Math.min(cl.length - 1, j + m), i1 = Math.min(cl.length - 1, i0 + W), s2 = cl.slice(i0, i1 + 1); return (Math.max(...s2) - Math.min(...s2)) / mt.pip; };
  OBS.rpNear = { near, now, W, m };
  // a selection follows its moment across ticks (the index of a state shifts as bars arrive)
  const selK = `${sym}|${c.rpTf}`; if (OBS.rpSelK !== selK) { OBS.rpSelK = selK; OBS.rpSelT = null; }
  OBS.rpSel = near.find(j => tState(j) === OBS.rpSelT) ?? null;
  const light = document.documentElement.dataset.theme === 'light', bin = c.rpMode === 'bin';
  const leg = bin ? `<span><i class="rp-sw rp-on"></i>recurrence: among the closest 10% of pairs of states</span><span><i class="rp-sw rp-off"></i>not a recurrence</span>`
    : `<span>similar</span><i class="rp-grad"></i><span>different</span><span class="muted">· shaded by rank: the closest half of all pairs of states</span>`;
  b.innerHTML = `<div class="obs-split rp-split"><div class="rp-main"><div class="rp-leg small" aria-hidden="true">${leg}</div><div class="obs-cv sq"><canvas id="rpCv"></canvas></div></div><aside class="obs-side">
    <div class="dj-verdict ${verdict[0]}" tabindex="0"${tipAttr(`${verdict[1]}|${verdict[2]}`)}><b>${verdict[1]}</b><span>against ${nSh} shuffled copies of the same returns</span></div>
    ${N < RP_THIN ? `<p class="rp-thin small" role="status"><b>Only ${N} states: too few for stable measures.</b> Determinism, laminarity and their shuffle band move a lot from one window to the next at this size; 5-minute or 15-minute states give more.</p>` : ''}
    <div class="ins rp-now"><label>Regime now</label>${rn ? `<p><b tabindex="0"${tipAttr(`${rn.label}|How often the last ${rn.w} states come back among the other states of the window, against all ${rn.nB} stretches of ${rn.w} states in it. Familiar states are mostly calm ones and rarely seen states mostly large moves: "Calmer than usual" = among the most recurring 10% of stretches with moves more than 10% smaller than the window's average; "Busier than usual" = among the least recurring 10% with moves more than 10% larger; "Unusual states" = an extreme rank whose size does not fit that reading; otherwise "Usual". Sizes after dividing out the usual move at each hour of the day.`)}>${rn.label}</b> · the last ${rn.w} states (${hW}h) recur with <span class="mono">${pc1(rn.rr)}%</span> of the other states; the ${rn.nB} stretches of ${rn.w} states in the window (n = ${rn.nB}, overlapping) run ${pc1(rn.lo)}–${pc1(rn.hi)}% in their middle 80%, and ${Math.round(rn.rank * 100)}% of them recur less. Their moves run <span class="mono">×${rn.size.toFixed(2)}</span> the window's average size (hour of day divided out). A description of the last ${hW} hours, not a forecast.</p>` : `<p>Too few states to compare the last ${RP_NOW_W} with the rest.</p>`}</div>
    <div class="ins"><label>Determinism</label><p><b class="mono ${cD === 'above' ? 'wn' : ''}" tabindex="0"${tipAttr(`Determinism ${pc(q.det)}%|Share of recurrences that line up into diagonals (sequences of states that repeat). The ${nSh} shuffles land between ${pc(bD.lo90)}% and ${pc(bD.hi90)}% in 90% of cases and between ${pc(bD.lo)}% and ${pc(bD.hi)}% once corrected for the three checks; only beyond that is it called.`)}>${pc(q.det)}%</b> of recurrences form diagonal lines; shuffled data ${pc(bD.lo90)}–${pc(bD.hi90)}% (corrected ${pc(bD.lo)}–${pc(bD.hi)}%). ${say(cD, `Above the band: sequences repeat. ${SZ}`, 'Below the band: moves are unusually novel.')}</p></div>
    <div class="ins"><label>Laminarity</label><p><b class="mono ${cL === 'above' ? 'wn' : ''}" tabindex="0"${tipAttr(`Laminarity ${pc(q.lam)}%|Share of recurrences in vertical blocks: the market stuck in one state. The shuffles land between ${pc(bL.lo90)}% and ${pc(bL.hi90)}% in 90% of cases, up to ${pc(bL.hi)}% once corrected for the three checks.`)}>${pc(q.lam)}%</b>; shuffled data ${pc(bL.lo90)}–${pc(bL.hi90)}% (corrected up to ${pc(bL.hi)}%). ${say(cL, 'Above the band: the market gets stuck in one state more than chance.', '')}</p></div>
    <div class="ins"><label>Now resembles</label>${near.length ? `<div class="dj-list"><div class="dj-hdr rp-hdr" aria-hidden="true"><span>#</span><span>When (UTC)</span><span>Distance</span><span>Next range ${un}</span></div>${near.map((j, k) => `<div class="dj-row${OBS.rpSel === j ? ' on' : ''}" data-j="${j}"><button class="dj-it rp-it" data-j="${j}"${tipAttr(`${dts(tState(j))} UTC|The ${k ? (k === 1 ? 'second' : 'third') + ' closest' : 'closest'} earlier state to the current one (distance ${(A.Dm[now * N + j] / A.eps).toFixed(2)}× the threshold). In the next ${W} bars after it, price ranged over ${after(j).toFixed(1)} ${un} (highest to lowest close): the size of what followed, not its direction. One case, not a forecast. Click to mark it on the plot.`)}><span class="mono">${k + 1}</span><span>${dts(tState(j))}</span><span class="muted">${(A.Dm[now * N + j] / A.eps).toFixed(2)}×</span><span class="mono">${after(j).toFixed(1)}</span></button></div>`).join('')}</div><p class="small muted">Distance in thresholds (under 1× counts as a recurrence) and the range of the next ${W} bars, in ${un}: sizes, not directions.</p>` : '<p>Not enough history.</p>'}</div>
    <div class="ins"><label>Reading the picture</label>${obsHow(`${light ? 'Dark' : 'Bright'} pixels = similar states; streaks are most likely similar volatility, not a repeated direction.`, `<p class="small">Each pixel compares the market at time <i>i</i> (left → right) with time <i>j</i> (bottom → top). ${light ? 'Dark' : 'Bright'} pixels = similar states. The main diagonal is each moment against itself. Diagonal streaks mean similar sequences of normalised returns recurred — most likely similar volatility; the picture cannot tell that from a repeated direction. Square blocks mean a calm, stable regime; ${light ? 'pale' : 'dark'} bands crossing the plot mark shocks unlike anything else in the window. The top row and the right column are now.</p>`)}</div>
    <p class="small muted">${N} states from ${c.rpTf}m returns, each divided by the usual size of a move at its hour of the day, embedding dimension ${m}, recurrence rate 10%.</p></aside></div>`;
  // the plot is square: its column takes the height available, the side panel the rest of the width
  const sp = b.querySelector('.rp-split'), lg = b.querySelector('.rp-leg');
  if (sp && getComputedStyle(sp).gridTemplateColumns.split(' ').length > 1) sp.style.gridTemplateColumns = `minmax(0, min(${Math.max(320, sp.clientHeight - lg.offsetHeight + 12)}px, calc(100% - 304px))) minmax(290px, 1fr)`;
  const cv = $('#rpCv'), { g, w, h } = canvasFit(cv), S2 = Math.min(w - 46, h - 34), ox = 40, oy = 4, dpr = devicePixelRatio || 1;
  const img = g.createImageData(Math.ceil(S2 * dpr), Math.ceil(S2 * dpr)), iw = img.width, ink = (h => [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)))((cssv('--ind1') || cssv('--info')).replace('#', '')); // one hue: --ind1 (amber is selection only)
  for (let yy = 0; yy < iw; yy++) for (let xx = 0; xx < iw; xx++) {
    const i = Math.min(N - 1, Math.floor(xx / iw * N)), j = Math.min(N - 1, N - 1 - Math.floor(yy / iw * N)), k = (yy * iw + xx) * 4;
    // by rank, so the picture keeps its contrast: the closest pairs brightest, the more different half dark
    const v = bin ? A.Rb[i * N + j] : Math.max(0, 1 - rpRank(A.all, A.Dm[i * N + j]) * 2);
    if (light) { img.data[k] = 255 - v * (255 - 40); img.data[k + 1] = 255 - v * (255 - 60); img.data[k + 2] = 255 - v * (255 - 90); }
    else { img.data[k] = 14 + v * (ink[0] - 14); img.data[k + 1] = 17 + v * (ink[1] - 17); img.data[k + 2] = 22 + v * (ink[2] - 22); }
    img.data[k + 3] = 255;
  }
  const X = i => ox + (i + .5) / N * S2, Y = j => oy + (N - 1 - j + .5) / N * S2;
  const paint = () => {
    g.clearRect(0, 0, w, h); g.putImageData(img, ox * dpr, oy * dpr);
    g.strokeStyle = col.line; g.lineWidth = 1; g.strokeRect(ox, oy, S2, S2);
    // day ticks on both axes, a label only where there is room (a weekend leaves two day changes a few bars apart);
    // the corner stays clear: no y label near the bottom, no x label left of the plot
    g.fillStyle = col.tx; g.font = '11px JetBrains Mono'; let day = -1, lastX = -99;
    for (let i = 0; i < N; i++) { const d = new Date(tState(i) * 1000); if (d.getUTCDate() === day) continue; day = d.getUTCDate(); const lab = d.toISOString().slice(5, 10);
      if (X(i) - lastX < 48 || X(i) > ox + S2 - 30) continue; lastX = X(i);
      g.strokeStyle = col.tx2; g.beginPath(); g.moveTo(X(i), oy + S2); g.lineTo(X(i), oy + S2 + 4); g.moveTo(ox - 4, Y(i)); g.lineTo(ox, Y(i)); g.stroke();
      g.fillText(lab, Math.max(ox, X(i) - 16), oy + S2 + 16);
      if (Y(i) < oy + S2 - 40) { g.save(); g.translate(ox - 7, Y(i) + 16); g.rotate(-Math.PI / 2); g.fillText(lab, 0, 0); g.restore(); } }
    g.fillStyle = col.acc; const nl = 'now'; g.fillText(nl, ox + S2 - g.measureText(nl).width, oy + S2 + 28);
    // the present: top row and right column
    g.strokeStyle = col.acc; g.lineWidth = 2; g.beginPath(); g.moveTo(ox, oy + 1); g.lineTo(ox + S2, oy + 1); g.lineTo(ox + S2 - 1, oy + S2); g.stroke();
    if (OBS.rpSel != null) { const j = OBS.rpSel; g.strokeStyle = col.acc; g.lineWidth = 1; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(j), oy); g.lineTo(X(j), oy + S2); g.moveTo(ox, Y(j)); g.lineTo(ox + S2, Y(j)); g.stroke(); g.setLineDash([]); g.beginPath(); g.arc(X(j), Y(now), 5, 0, 6.283); g.stroke(); }
  };
  paint();
  CV_HOVER.rpCv = e => {
    if (!e) return; const rc = e.target.getBoundingClientRect(), x = e.clientX - rc.left - ox, y = e.clientY - rc.top - oy;
    if (x < 0 || y < 0 || x > S2 || y > S2) return brTipHide();
    const i = Math.min(N - 1, Math.floor(x / S2 * N)), j = Math.min(N - 1, N - 1 - Math.floor(y / S2 * N)), d = A.Dm[i * N + j];
    cvTip(e, `${dts(tState(i))}  vs  ${dts(tState(j))} UTC`, [i === j ? 'The same moment (the main diagonal)' : A.Rb[i * N + j] ? 'Similar states: a recurrence' : `More different than ${(rpRank(A.all, d) * 100).toFixed(0)}% of all pairs`, `Distance ${(d / A.eps).toFixed(2)}× the threshold`, i === j ? '' : `${Math.abs(i - j)} bars apart`].filter(Boolean));
  };
  b.querySelectorAll('.rp-it').forEach(x => x.addEventListener('click', () => { const j = +x.dataset.j; OBS.rpSel = OBS.rpSel === j ? null : j; OBS.rpSelT = OBS.rpSel == null ? null : tState(j); $$('#obsBody .dj-row').forEach(rw => rw.classList.toggle('on', +rw.dataset.j === OBS.rpSel)); paint(); }));
}

/* ---------------- 6. Drivers: which currency is moving the pair ---------------- */
// the legs in words. A share of the move only when both legs pushed the same way (then it is at most 100%); legs of
// opposite sign offset each other, and that is said with both moves. A leader needs a clear share (more than DRV_SHARE
// of the two legs' combined size) and a leg that moved more than DRV_MIN; otherwise the move is shared, or too small.
const DRV_SHARE = .6, DRV_MIN = 1e-4;
const drvLead = (bL, qL, mt) => { const sh = Math.abs(bL) / (Math.abs(bL) + Math.abs(qL) || 1), isB = sh >= .5; return Math.max(sh, 1 - sh) > DRV_SHARE && Math.abs(isB ? bL : qL) > DRV_MIN ? (isB ? mt.base : mt.quote) : null; };
const drvSmall = (bL, qL) => Math.abs(bL) <= DRV_MIN && Math.abs(qL) <= DRV_MIN;
function drvSay(sym, bL, qL, span, turn = false) {
  const mt = M(sym), tot = bL + qL, lead = drvLead(bL, qL, mt), P = `<b>${pretty(sym)}</b>`, over = `Over the last ${span} of trading`;
  const legs = `${mt.base} moved ${obsBp(bL)} against the basket and ${mt.quote}'s effect on the pair was ${obsBp(qL)}`;
  if (drvSmall(bL, qL)) return turn ? '' : `${over} both legs of ${P} moved less than 1 bp (${obsBp(bL)} and ${obsBp(qL)}): too small to say which currency moved it.`;
  if (bL * qL < 0) return turn ? `In the last hour of trading the legs pulled apart: ${legs}; they ${lead ? 'partly ' : ''}offset, leaving the pair ${obsBp(tot)}.`
    : `${over} the two legs of ${P} pulled in opposite directions: ${legs}. They ${lead ? 'partly ' : ''}offset, leaving the pair ${obsBp(tot)}${lead ? `; ${lead} is the larger leg` : ''}.`;
  if (!lead) {
    if (turn) return '';
    const sb = Math.round(Math.abs(bL) / (Math.abs(bL) + Math.abs(qL)) * 100), big = sb >= 50 ? mt.base : mt.quote, sh = Math.max(sb, 100 - sb);
    return sh <= 55 ? `${over} both legs of ${P} contribute about equally (${mt.base} ${sb}%, ${mt.quote} ${100 - sb}% of the move): a shared move.`
      : `${over} the move of ${P} is shared: ${big} brings ${sh}% of it, under the ${DRV_SHARE * 100}% that names a leader.`;
  }
  const L = lead === mt.base ? bL : qL, pct = Math.round(Math.abs(L) / (Math.abs(tot) || 1) * 100), dir = (lead === mt.base ? bL : -qL) >= 0 ? 'strength' : 'weakness';
  return turn ? `In the last hour of trading <b>${lead}</b> took over: the pair moved ${obsBp(tot)}, ${pct}% of it from ${lead}.`
    : `${over}, ${P} is mostly a <b class="drv-lead">${lead} story</b>: ${pct}% of the move comes from ${lead} ${dir} against the basket.`;
}
/* The window of Drivers: 1H / 4H / 1D (a soft setting, see OBS_SOFT). The shared control switch has no row for
   Drivers, so obsCtrl is wrapped here (the same chain other modules use for globals). */
const DRV_W = { 60: { lab: '1H', hrs: '1h', span: 'hour', adj: '1-hour' }, 240: { lab: '4H', hrs: '4h', span: '4 hours', adj: '4-hour' }, 1440: { lab: '1D', hrs: '24h', span: '24 hours', adj: '1-day' } };
Object.assign(OBS_SOFT, { drvW: 240 });
Object.assign(OBS_CTRL_TIP, { drvW: {
  60: '1H|The last hour of trading: the board, the verdict and the earlier 1-hour windows it is compared with. The noisiest picture.',
  240: '4H|The last 4 hours of trading: the board, the verdict and the earlier 4-hour windows it is compared with.',
  1440: '1D|The last 24 hours of trading (a weekend is skipped): the board, the verdict and the earlier 1-day windows, of which the history holds only a few.' } });
const drvWin = c => DRV_W[c.drvW] ? +c.drvW : OBS_SOFT.drvW;
function drvCtrl(c) {
  const w = drvWin(c);
  return `<span class="muted small">window</span><div class="mini-seg" data-k="drvW">${Object.keys(DRV_W).map(v => `<button data-val="${v}" class="${+v === w ? 'on' : ''}" data-tip="${escHtml(OBS_CTRL_TIP.drvW[v])}">${DRV_W[v].lab}</button>`).join('')}</div>`;
}
{ const base = obsCtrl; obsCtrl = c => c.view === 'drv' ? drvCtrl(c) : base(c); }
/* The pair that isolates a currency now: L against the currency that moved least against the basket over the window
   (the calmest other leg), among the pairs that exist. null when L has no pair against any of them. */
function drvIso(L, sv) {
  const pairOf = y => Engine.FX.find(q => (q.base === L && q.quote === y) || (q.base === y && q.quote === L));
  const k = Object.keys(sv).filter(y => y !== L && pairOf(y)).sort((a, b2) => Math.abs(sv[a]) - Math.abs(sv[b2]))[0];
  return k ? { lead: L, sym: pairOf(k).sym, other: k } : null;
}
function drawDrivers(b, c) {
  const sym = S.set.sym, mt = M(sym), col = chartColors(), N = Math.min(4321, Engine.candles[Engine.PAIRS[0].sym].length);
  const P = ccyPaths(N), basket = P._t.map((_, i) => mean(Engine.ALL.map(cc => P[cc][i])));
  const legOf = (cc, a, z) => (P[cc][z] - P[cc][a]) - (basket[z] - basket[a]), z = N - 1;
  // the currency board does not depend on the open instrument
  const W = drvWin(c), WD = DRV_W[W], n4 = Math.min(W, N - 1), st = Engine.ALL.map(cc => ({ c: cc, v: legOf(cc, z - n4, z) })).sort((a, b2) => b2.v - a.v);
  const sv = Object.fromEntries(st.map(x => [x.c, x.v])), pool = Engine.FX.filter(p => p.base in sv && p.quote in sv);
  // every tradable pair between two of the eight, crosses included
  const best = pool.map(p => ({ p, gap: sv[p.base] - sv[p.quote] })).sort((x, y) => Math.abs(y.gap) - Math.abs(x.gap))[0];
  OBS.drv = { sv, best: best && best.p.sym, n: pool.length };
  // an open exotic pair: its currency outside the eight on the board, measured against USD (through its USD pair, or
  // the open pair and its major leg) and then against the basket; it stays out of the basket and of the widest gap
  const inG8 = cc => Engine.ALL.includes(cc), outside = mt.kind === 'fx' ? (!inG8(mt.base) ? mt.base : !inG8(mt.quote) ? mt.quote : null) : null;
  let ext = null;
  if (outside && (inG8(mt.base) || inG8(mt.quote))) {
    const u = Engine.FX.find(q => (q.base === outside && q.quote === 'USD') || (q.base === 'USD' && q.quote === outside)), ua = u && Engine.candles[u.sym], pa = Engine.candles[sym];
    let vsUsd;
    if (ua && ua.length > n4) vsUsd = (u.base === outside ? 1 : -1) * Math.log(ua[ua.length - 1].close / ua[ua.length - 1 - n4].close);
    else { const maj = outside === mt.base ? mt.quote : mt.base, t = Math.log(pa[pa.length - 1].close / pa[Math.max(0, pa.length - 1 - n4)].close), mU = P[maj][z] - P[maj][z - n4]; vsUsd = outside === mt.base ? t + mU : mU - t; }
    ext = { c: outside, vsUsd, v: vsUsd - (basket[z] - basket[z - n4]), via: ua && ua.length > n4 ? u.sym : sym };
  }
  OBS.drv.ext = ext;
  // one scale for the board: the largest move fills its half, the others in proportion
  const bMax = Math.max(...st.map(x => Math.abs(x.v)), ext ? Math.abs(ext.v) : 0, 1e-9);
  const cbBar = v => `<div class="drv-bar"><i style="${v >= 0 ? 'left:50%' : 'right:50%'};width:${Math.abs(v) / bMax * 50}%;background:${v >= 0 ? col.up : col.dn}"></i></div>`;
  const side = `<aside class="obs-side">
      <div class="ins"><label>Currency board · last ${WD.hrs} of trading vs basket</label>${st.map(x => `<div class="cb-row" tabindex="0"${tipAttr(`${x.c} · ${obsBp(x.v)}|Its move over the last ${WD.span} of trading against the equal-weighted basket of all eight currencies: ${x.v >= 0 ? 'stronger' : 'weaker'} than the basket average. The bars share one scale: the largest move fills its half.`)}><span class="mono">${x.c}</span>${cbBar(x.v)}<span class="mono small ${cls(x.v)}">${obsBp(x.v)}</span></div>`).join('')}${ext ? `<div class="cb-ext-note small muted">Outside the eight · not in the basket</div><div class="cb-row cb-ext" data-ccy="${ext.c}" tabindex="0"${tipAttr(`${ext.c} · ${obsBp(ext.v)} · outside the eight|${ext.c} is not one of the eight currencies of the basket. It moved ${obsBp(ext.vsUsd)} against USD over the last ${WD.span} of trading (from ${pretty(ext.via)}); adding USD's own move against the basket puts it on this board's scale. It is not part of the basket, the strongest and weakest, or the widest gap.`)}><span class="mono">${ext.c}</span>${cbBar(ext.v)}<span class="mono small ${cls(ext.v)}">${obsBp(ext.v)}</span></div>` : ''}</div>
      ${best ? `<div class="ins"><label>Widest strength gap · last ${WD.hrs} of trading (descriptive, not a trade idea)</label><p>Strongest: <b>${st[0].c}</b>, weakest: <b>${st[st.length - 1].c}</b>. Of the ${pool.length} tradable pairs between the eight currencies, the widest strength gap is <button class="pill" data-sym="${best.p.sym}">${pretty(best.p.sym)}</button>: ${best.p.base} ${best.gap >= 0 ? 'stronger' : 'weaker'} than ${best.p.quote} by <b>${bp(Math.abs(best.gap)).replace('+', '')}</b>. This describes the last ${WD.span} of trading; a past gap is not a forecast of the next move.</p></div>` : ''}
      <p class="small muted">Each currency is measured against an equal-weighted basket of all eight, so a pair's move splits exactly into its base leg and its quote leg. The idea comes from currency research, where a common dollar factor explains much of the moves of the dollar pairs.</p>
    </aside>`;
  if (mt.kind === 'cfd' || (!inG8(mt.base) && !inG8(mt.quote))) {
    b.innerHTML = `<div class="obs-split"><div class="drv-main"><div class="drv-verdict"><b>Drivers splits a currency pair into its two currencies.</b> ${pretty(sym)} ${mt.kind === 'cfd' ? 'is not a currency pair' : 'has neither currency among the eight majors'}, so it has no legs to show. Open a pair to see who moves it: ${['EURUSD', 'USDJPY', 'GBPUSD', 'AUDUSD'].map(s => `<button class="pill" data-sym="${s}">${pretty(s)}</button>`).join(' ')}</div></div>${side}</div>`;
    b.querySelectorAll('[data-sym]').forEach(x => x.addEventListener('click', () => setSymbol(x.dataset.sym)));
    return;
  }
  // the pair's own move; a currency outside the eight majors is measured as the rest of it (pair move − the major leg)
  const pc = Engine.candles[sym], pn = pc.length, tot = n => Math.log(pc[pn - 1].close / pc[Math.max(0, pn - 1 - n)].close), pips = n => (pc[pn - 1].close - pc[Math.max(0, pn - 1 - n)].close) / mt.pip;
  const split = (a, zz) => {
    const n = zz - a, bL0 = inG8(mt.base) ? legOf(mt.base, a, zz) : null, qL0 = inG8(mt.quote) ? -legOf(mt.quote, a, zz) : null;
    if (!outside) return { bL: bL0, qL: qL0 };
    const t = Math.log(pc[pn - 1 - (z - zz)].close / pc[Math.max(0, pn - 1 - (z - a))].close);
    return bL0 == null ? { bL: t - qL0, qL: qL0 } : { bL: bL0, qL: t - bL0 };
  };
  // a window of n bars needs n + 1 points (N is capped at 4321 so 3D fits)
  const L = [[60, '1H'], [240, '4H'], [1440, '1D'], [4320, '3D']].filter(([n]) => n < N);
  const lead = (bL, qL) => drvLead(bL, qL, mt);
  const rows = L.map(([n, lab]) => { const s2 = split(z - n, z); return { n, lab, ...s2, tot: s2.bL + s2.qL, pips: pips(n), lead: lead(s2.bL, s2.qL) }; });
  const r4 = rows.find(x => x.n === W) || rows[rows.length - 1], r1 = rows.find(x => x.lab === '1H'), dom = r4.lead, spanOf = n => DRV_W[n] ? DRV_W[n].span : `${n / 60} hours`;
  const turn = W > 60 && r1 && r1.lead && r1.lead !== dom && Math.abs(r1.tot) > 3e-4 ? r1 : null;
  const mx = Math.max(...rows.flatMap(r => [Math.abs(r.bL), Math.abs(r.qL)]), 1e-6);
  const bar = (v, color) => `<div class="drv-bar"><i style="${v >= 0 ? 'left:50%' : `right:50%`};width:${Math.abs(v) / mx * 50}%;background:${color}"></i></div>`;
  const story = r => r.lead ? `${r.lead}-led` : drvSmall(r.bL, r.qL) ? 'Small' : r.bL * r.qL < 0 ? 'Offsetting' : 'Shared';
  // what is normal for this pair: who led each earlier window of the same length (non-overlapping, newest first)
  const past = []; for (let zz = z - r4.n; zz - r4.n >= 0 && past.length < 30; zz -= r4.n) { const s2 = split(zz - r4.n, zz); past.push(lead(s2.bL, s2.qL)); }
  const nB = past.filter(x => x === mt.base).length, nQ = past.filter(x => x === mt.quote).length, nN = past.length - nB - nQ;
  OBS.drv.base = { n: past.length, [mt.base]: nB, [mt.quote]: nQ, none: nN };
  const [f1, k1, f2, k2] = nB >= nQ ? [mt.base, nB, mt.quote, nQ] : [mt.quote, nQ, mt.base, nB];
  const adj = DRV_W[r4.n] ? DRV_W[r4.n].adj : `${r4.n / 60}-hour`;
  const usual = past.length >= 4 ? `<span class="drv-turn muted">Before this window: ${k1 > past.length / 2 ? `usually ${f1}, which` : f1} led ${k1} of the ${past.length} earlier ${adj} windows of trading; ${f2} led ${k2}, neither ${nN}.</span>`
    : `<span class="drv-turn muted">Only ${obsPl(past.length, `earlier ${adj} window`)} of trading in the history: too few to say which currency usually leads this pair.</span>`;
  // the pair that isolates the leader now: the leader against the calmest other currency on the board
  const iso = OBS.drv.iso = dom ? drvIso(dom, sv) : null;
  const isoHtml = iso ? `<div class="drv-iso small"><b>${iso.lead} led:</b> ${iso.sym === sym ? `${pretty(sym)}, this pair,` : `<button class="pill" data-sym="${iso.sym}">${pretty(iso.sym)}</button>`} isolates it best now — its other currency, ${iso.other}, moved least against the basket over the last ${WD.span} of trading (${obsBp(sv[iso.other])}), so that pair moves mostly with ${iso.lead}. Describes the window, not a trade idea.</div>` : '';
  const legTip = (cc, v, isQ) => cc === outside ? `${cc} leg · ${obsBp(v)}|${cc} is not one of the eight majors, so its leg is the part of the pair's move that the ${cc === mt.base ? mt.quote : mt.base} leg does not explain.` : isQ ? `${cc} leg · effect on the pair ${obsBp(v)}|${cc} moved ${obsBp(-v)} against the basket of all eight. A weaker ${cc} lifts ${pretty(sym)}, a stronger one pushes it down, so its effect on the pair has the opposite sign.` : `${cc} leg · ${obsBp(v)}|${cc} moved ${obsBp(v)} against the basket of all eight; as the base currency it moves the pair the same way.`;
  b.innerHTML = `<div class="obs-split"><div class="drv-main">
      <div class="drv-verdict">${drvSay(sym, r4.bL, r4.qL, spanOf(r4.n))}${turn ? `<span class="drv-turn">${drvSay(sym, turn.bL, turn.qL, '', true)}</span>` : ''}${usual}${outside ? `<span class="drv-turn muted">${outside} is not one of the eight majors: its leg is the part of the pair's move that the ${outside === mt.base ? mt.quote : mt.base} leg does not explain.</span>` : ''}</div>${isoHtml}
      <table class="tbl sm drv-tbl"><thead><tr><th>Window</th><th>${mt.base} leg</th><th><span class="sr-only">${mt.base} leg bar</span></th><th data-tip="${escHtml(`${mt.quote} leg · effect on the pair|The quote currency counts with the opposite sign: when ${mt.quote} weakens, ${pretty(sym)} rises.`)}">${mt.quote} leg <small class="muted">effect on pair</small></th><th><span class="sr-only">${mt.quote} leg bar</span></th><th>Pair</th><th>Led by</th></tr></thead><tbody>
      ${rows.map(r => `<tr><td>${r.lab}</td><td class="mono ${cls(r.bL)}"${tipAttr(legTip(mt.base, r.bL, false))}>${obsBp(r.bL)}</td><td class="bcell">${bar(r.bL, cssv('--ind1'))}</td><td class="mono ${cls(r.qL)}"${tipAttr(legTip(mt.quote, r.qL, true))}>${obsBp(r.qL)}</td><td class="bcell">${bar(r.qL, 'var(--info)')}</td><td class="mono ${cls(r.tot)}"${tipAttr(`${pretty(sym)} · ${r.lab} of trading|The pair moved ${obsBp(r.tot)} (${sgn(r.pips, 1)} ${unitWord(sym)}): ${obsBp(r.bL)} from ${mt.base} and ${obsBp(r.qL)} from ${mt.quote}.`)}><b>${obsBp(r.tot)}</b> <small class="muted">${sgn(r.pips, 0)}${uShort(sym)}</small></td><td${tipAttr(`${story(r)}|${r.lead ? `${r.lead} brought more than ${DRV_SHARE * 100}% of the two legs' combined size over ${r.lab} of trading, and more than 1 bp.` : drvSmall(r.bL, r.qL) ? `Over ${r.lab} of trading both legs moved less than 1 bp: too small to split.` : r.bL * r.qL < 0 ? `Over ${r.lab} of trading the two legs pulled in opposite directions and largely cancelled.` : `Neither currency brought more than ${DRV_SHARE * 100}% of the ${r.lab} move: a shared move.`}`)}><span class="brx-t${r.lead ? ' lead' : ''}">${story(r)}</span></td></tr>`).join('')}</tbody></table>
      <div class="obs-cv mid"><canvas id="drvCv"></canvas></div>
      <div class="dj-leg small">${obsSw('--ind1', 'base', `${mt.base} leg`)} ${obsSw('--info', 'quote', `${mt.quote} leg (effect on the pair)`)} ${obsSw('--tx', 'pair', pretty(sym))} <span class="muted">· last 24 trading hours (a weekend is skipped), cumulative</span></div>
    </div>${side}</div>`;
  // cumulative legs over last 24h
  const n24 = Math.min(1440, N - 1), a0 = z - n24, sB = [], sQ = [], sT = [], tt = [];
  for (let i = a0; i <= z; i += 5) { const s2 = split(a0, i); sB.push(s2.bL); sQ.push(s2.qL); sT.push(s2.bL + s2.qL); tt.push(P._t[i]); }
  const cv = $('#drvCv'), all = sB.concat(sQ, sT).map(v => v * 1e4), mn0 = Math.min(...all, 0), mx0 = Math.max(...all, 0), pad = (mx0 - mn0) * .1 || 1, mn = mn0 - pad, mx2 = mx0 + pad;
  let hov = -1;
  const draw = () => {
    const { g, w, h } = canvasFit(cv), X = i => 56 + i / (sT.length - 1) * (w - 66), Y = v => 8 + (1 - (v * 1e4 - mn) / (mx2 - mn)) * (h - 26), stp = niceStep((mx2 - mn) / 5);
    g.font = '11.5px JetBrains Mono'; g.fillStyle = col.tx; g.strokeStyle = col.grid;
    for (let v = Math.ceil(mn / stp) * stp; v <= mx2; v += stp) { const y = 8 + (1 - (v - mn) / (mx2 - mn)) * (h - 26); g.strokeStyle = Math.abs(v) < 1e-9 ? col.line : col.grid; g.beginPath(); g.moveTo(56, y); g.lineTo(w - 10, y); g.stroke(); g.fillText(`${sgn(v, 0)} bp`, 2, y + 4); }
    let last = -99; tt.forEach((t, i) => { const d = new Date(t * 1000); if (d.getUTCMinutes() > 4 || d.getUTCHours() % 4 || X(i) - last < 50) return; last = X(i); g.fillStyle = col.tx; g.fillText(`${d.toISOString().slice(11, 13)}:00`, X(i) - 16, h - 4); g.strokeStyle = col.grid; g.beginPath(); g.moveTo(X(i), 8); g.lineTo(X(i), h - 18); g.stroke(); });
    [[sB, cssv('--ind1')], [sQ, cssv('--info')], [sT, cssv('--tx')]].forEach(([s, cc], k) => { g.beginPath(); s.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = cc; g.lineWidth = k === 2 ? 2.2 : 1.5; g.stroke(); });
    // the crosshair carries a point on each line, so the reading stays on the curves
    if (hov >= 0) { g.strokeStyle = col.line; g.lineWidth = 1; g.beginPath(); g.moveTo(X(hov), 8); g.lineTo(X(hov), h - 18); g.stroke(); [[sB, cssv('--ind1')], [sQ, cssv('--info')], [sT, cssv('--tx')]].forEach(([s, cc]) => { g.beginPath(); g.arc(X(hov), Y(s[hov]), 3.5, 0, 6.283); g.fillStyle = cc; g.fill(); g.strokeStyle = cssv('--s1'); g.lineWidth = 1.5; g.stroke(); }); }
    return { X, w };
  };
  let geo = draw();
  CV_HOVER.drvCv = e => {
    if (!e) { if (hov >= 0) { hov = -1; geo = draw(); } return; }
    const rc = cv.getBoundingClientRect(), i = Math.round((e.clientX - rc.left - 56) / (geo.w - 66) * (sT.length - 1));
    if (i < 0 || i >= sT.length) return brTipHide();
    if (i !== hov) { hov = i; geo = draw(); }
    cvTip(e, `${dts(tt[i])} UTC · since ${dts(tt[0])} UTC`, [`${pretty(sym)} ${obsBp(sT[i])}`, `${mt.base} leg ${obsBp(sB[i])}`, `${mt.quote} leg ${obsBp(sQ[i])} (effect on the pair)`]);
  };
  b.querySelectorAll('[data-sym]').forEach(x => x.addEventListener('click', () => setSymbol(x.dataset.sym)));
}

/* ---------------- 7. Volatility clock ---------------- */
/* The four FX sessions on the date of t, in UTC hours. Sydney and Tokyo stay put; London and New York run 08:00–17:00
   local, so they start an hour later in UTC once their summer time ends (EU: last Sunday of October, US: first Sunday
   of November). The market itself is open only when Engine.isOpen says so (no session is open on a weekend). */
function clkSessions(t) {
  const lon = Engine.serverOffset(t) - 2, ny = Engine.nyOffset(t) + 4; // 1 / 0 (London summer / winter), 0 / −1 (New York)
  return [['Sydney', [[21, 24], [0, 6]]], ['Tokyo', [[0, 9]]], ['London', [[8 - lon, 17 - lon]]], ['New York', [[12 - ny, 21 - ny]]]];
}
// a CFD's own trading hours on the UTC day starting at d0, from Engine.isOpen per 15 minutes, as [from, to] hours
function clkOwnHours(sym, d0) {
  const out = [];
  for (let k = 0; k < 96; k++) if (Engine.isOpen(sym, d0 + k * 900)) { const l = out[out.length - 1]; if (l && l[1] === k / 4) l[1] = (k + 1) / 4; else out.push([k / 4, (k + 1) / 4]); }
  return out;
}
const clkH = h => `${String(Math.floor(h) % 24).padStart(2, '0')}:${String(Math.round(h % 1 * 60)).padStart(2, '0')}`;
/* The start of the trading day the clock calls "today": FX rolls over at 17:00 New York (21:00 UTC in summer, 22:00 in
   winter); a CFD's day is its current session (or, while closed, its last one); a 24/7 instrument keeps the UTC day. */
function clkDayStart(sym, now) {
  if (isFxSym(sym)) { const roll = 17 - Engine.nyOffset(now); return Math.floor((now - roll * 3600) / 86400) * 86400 + roll * 3600; }
  const m = M(sym); if (!m || m.is247) return Math.floor(now / 86400) * 86400;
  let t = Math.floor(now / 900) * 900, k = 0;
  while (!Engine.isOpen(sym, t) && k++ < 400) t -= 900;
  while (Engine.isOpen(sym, t - 900) && k++ < 800) t -= 900;
  return t;
}
const CLK_MIN = 15; // one-minute bars needed before today's pace is compared with the usual one
const CLK_TAIL_MIN = 40; // past hours needed before the share beyond ±2σ is shown
const clkMed = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
/* Past hours against their ±2σ: non-overlapping 60-minute windows without a closed-market gap that end before the
   trading day; each window's σ is the root of the summed variances of its own minutes (sdm(slot) = σ per minute, log). */
function clkTails(a, before, sdm) {
  const T = a.map(k => k.time); let n = 0, k = 0;
  for (let i = 0; i + 60 < a.length;) {
    if (a[i + 60].time >= before) break;
    let ok = a[i + 60].time - a[i].time === 3600, v = 0;
    for (let j = i + 1; ok && j <= i + 60; j++) { if (isGapAt(T, j)) ok = false; else v += sdm(Math.floor((a[j].time % 86400) / 900)) ** 2; }
    if (!ok || !(v > 0)) { i++; continue; }
    n++; if (Math.abs(Math.log(a[i + 60].close / a[i].close)) > 2 * Math.sqrt(v)) k++; i += 60;
  }
  return { n, k };
}
function drawClock(b, c) {
  const col = chartColors(), syms = c.clkAll ? Engine.PAIRS.map(p => p.sym) : [S.set.sym], SL = 96, sum = Array(SL).fill(0), cnt = Array(SL).fill(0);
  const now = Engine.simTime, day0 = Math.floor(now / 86400) * 86400, today = Array(SL).fill(0), tc = Array(SL).fill(0), dg = Array.from({ length: SL }, () => new Map());
  // the market the view reads: the 16 pairs share EUR/USD's hours; a CFD has its own
  const mSym = c.clkAll ? 'EURUSD' : S.set.sym, fx = c.clkAll || isFxSym(S.set.sym), ms = mktState(mSym);
  /* Petals: the UTC days before today's date, as the median of the days' own averages per slot (one agitated day
     barely moves it); the pooled mean is kept for the hover. Today: the trading day (from dayStart). Between a rollover
     before midnight and midnight the two share bars, so every comparison of today with a usual day uses only the days
     before dayStart (a slot of a day lies wholly on one side). A return across a closed market is not activity. */
  const dayStart = clkDayStart(mSym, now), hEnd = Math.max(day0, dayStart), run = [];
  for (const s of syms) {
    const a = Engine.candles[s], T = a.map(k => k.time);
    for (let i = 1; i < a.length; i++) {
      if (isGapAt(T, i)) continue;
      const t = a[i].time, r = Math.abs(Math.log(a[i].close / a[i - 1].close)), sl = Math.floor((t % 86400) / 900);
      if (t < hEnd) { sum[sl] += r; cnt[sl]++; const d = Math.floor(t / 86400), e = dg[sl].get(d) || [0, 0, t < dayStart]; e[0] += r; e[1]++; dg[sl].set(d, e); }
      if (t >= dayStart) { today[sl] += r; tc[sl]++; if (t > now - 3600) run.push([r, sl]); }
    }
  }
  const dAvg = (m2, pre) => clkMed([...m2.values()].filter(e => !pre || e[2]).map(e => e[0] / e[1])) * 1e4;
  const avg = dg.map(m2 => dAvg(m2)), avgC = dg.map(m2 => dAvg(m2, true)), avgM = sum.map((v, i) => cnt[i] ? v / cnt[i] * 1e4 : 0), tod = today.map((v, i) => tc[i] ? v / tc[i] * 1e4 : null), overall = mean(avg.filter(v => v > 0)), nd = dg.map(m2 => m2.size);
  // the engine sets activity per UTC hour: peak and quietest are read by hour (its four slots), not by 15 minutes
  const hourAvg = Array.from({ length: 24 }, (_, h) => { const v = avg.slice(h * 4, h * 4 + 4).filter(x => x > 0); return v.length ? mean(v) : 0; });
  const hiH = hourAvg.indexOf(Math.max(...hourAvg)), loH = hourAvg.indexOf(Math.min(...hourAvg.filter(v => v > 0)));
  const curSl = Math.floor((now % 86400) / 900), nMin = run.length / syms.length, todayMin = tc.reduce((s2, v) => s2 + v, 0) / syms.length;
  // the last hour of today's trading against the same minutes on a usual day, with the number of bars it rests on
  const runB = run.reduce((s2, [, sl]) => s2 + avgC[sl], 0) / 1e4, ratio = ms.open && nMin >= CLK_MIN && runB > 0 ? run.reduce((s2, [r]) => s2 + r, 0) / runB : null;
  const slT = k => `${String(Math.floor(((k % SL) + SL) % SL / 4)).padStart(2, '0')}:${String(((k % SL) + SL) % SL % 4 * 15).padStart(2, '0')}`, hh = h => `${String(h % 24).padStart(2, '0')}:00`;
  // rings: the FX sessions of today (DST-aware), or the CFD's own hours today
  const m = M(S.set.sym), own = fx ? null : (m.exch && m.exch !== 'OTC' ? m.exch : pretty(S.set.sym)) + ' hours';
  const sess = fx ? clkSessions(now) : [[own, clkOwnHours(S.set.sym, day0)]];
  const openAt = t => { if (!Engine.isOpen(mSym, t)) return []; if (!fx) return [own]; const h = (t % 86400) / 3600; return clkSessions(t).filter(([, bands]) => bands.some(([a, z2]) => h >= a && h < z2)).map(([nm]) => nm); };
  const openTxt = t => { const o = openAt(t); return !Engine.isOpen(mSym, t) ? 'Market closed' : fx ? (o.length ? 'Open: ' + o.join(', ') : 'No main session open') : 'Market open'; };
  // in the instrument's unit for one symbol (the usual move per minute is in bp)
  const one = !c.clkAll, px = Engine.quote(S.set.sym).mid, toP = v => v / 1e4 * px / m.pip, un = unitWord(S.set.sym), un1 = unitWord(S.set.sym, true);
  /* An hour adds the variances of its minutes (random walk): from t0, the 60 coming minutes on the market's own hours
     (a closed minute adds nothing; `end` is where trading stops inside the hour); by hour of the day, its four slots. */
  const sdm = k => avg[k] * Math.sqrt(Math.PI / 2);
  const hourFrom = t0 => { let v = 0, n = 0, end = null; for (let j = 0; j < 60; j++) { const t = t0 + j * 60; if (!Engine.isOpen(mSym, t)) { if (n && end == null) end = Math.floor(t / 60) * 60; continue; } n++; v += sdm(Math.floor((t % 86400) / 900)) ** 2; } return { sig: toP(Math.sqrt(v)), min: n, end }; };
  const hourSig = hr => toP(Math.sqrt([0, 1, 2, 3].reduce((s2, i) => s2 + 15 * sdm(hr * 4 + i) ** 2, 0)));
  const nh = one && ms.open ? hourFrom(now) : null, tail = nh ? clkTails(Engine.candles[S.set.sym], dayStart, k => sdm(k) / 1e4) : null;
  if (nh) nh.sig2 = 2 * nh.sig;
  const perMin = v => one ? `${v.toFixed(2)} bp (${toP(v).toFixed(2)} ${un}) per minute` : `${v.toFixed(2)} bp per minute`;
  // today so far against the same slots on a usual day (history without today's bars)
  const done = tod.map((v, k) => v != null && avgC[k] ? k : -1).filter(k => k >= 0), todayR = todayMin >= CLK_MIN && done.length ? done.reduce((s2, k) => s2 + tod[k], 0) / done.reduce((s2, k) => s2 + avgC[k], 0) : null;
  // the next two hours, slot by slot, on the market's own hours: a closed slot has no activity to expect
  const t1 = (Math.floor(now / 900) + 1) * 900, ahead = Array.from({ length: 8 }, (_, k) => { const t = t1 + k * 900; return { t, k: Math.floor((t % 86400) / 900), open: Engine.isOpen(mSym, t) }; });
  const aOpen = ahead.filter(x => x.open), aheadR = aOpen.length ? mean(aOpen.map(x => avg[x.k])) / overall : null, peakAhead = aOpen.length ? aOpen.reduce((a, x) => avg[x.k] > avg[a.k] ? x : a, aOpen[0]).k : null;
  // the scale belongs to the profile: today's dots beyond it sit on the edge
  const mxv = Math.max(...avg, 1e-9);
  OBS.clk = { avg, mean: avgM, nd, nextH: nh, tail, curSl, peakAhead, hourAvg, hiH, loH, dayStart, mxv, run: { n: nMin, r: ratio } };
  const tone = r => r > 1.3 ? 'busy' : r < .7 ? 'quiet' : '';
  const strip = `<div class="clk-strip" aria-label="Usual activity of the next eight 15-minute slots">${ahead.map(({ t, k, open }) => { const r = open ? avg[k] / overall : 0; return `<span class="${open ? tone(r) : 'closed'}"${tipAttr(`${slT(k)}–${slT(k + 1)} UTC|${open ? `Usually ${r.toFixed(2)}× the day's average${one ? `; the hour from ${slT(k)} usually moves about ±${hourFrom(t).sig.toFixed(0)} ${un} (1σ)` : ''}. ${openTxt(t)}.` : 'Market closed: no trading in this slot.'}`)}><i style="height:${Math.min(100, r / 2.5 * 100)}%"></i><small>${k % 4 ? ':' + slT(k).slice(3) : slT(k).slice(0, 2) + 'h'}</small></span>`; }).join('')}</div>`;
  const nowOpen = openAt(now), closedN = ahead.length - aOpen.length;
  const xr = r => r < .1 ? 'under 0.1' : r.toFixed(1), stopU = typeof tkDistFor === 'function' ? tkDistFor(S.set.sym).sl : 20;
  const sw = (k, lab) => `<span style="white-space:nowrap"><i class="clk-sw ${k}" aria-hidden="true"></i>${lab}</span>`;
  const nowLab = !ms.open ? ms.label : fx ? (nowOpen.length ? nowOpen.join(' + ') + ' open' : 'no main session open') : 'market open';
  const since = `${hhmm(dayStart)} UTC`, dayWord = fx ? `the trading day (since the ${since} rollover)` : `the session (since ${since})`;
  const nowTxt = !ms.open ? 'The market is closed: there is no activity to measure now.'
    : ratio ? `The last ${nMin.toFixed(0)} minutes are running at <b class="clk-r ${tone(ratio)}" tabindex="0"${tipAttr(`Activity now|The average 1-minute move over the last ${nMin.toFixed(0)} minutes of ${dayWord}, against the same minutes on previous days (${nMin.toFixed(0)} one-minute bars${c.clkAll ? ' per pair' : ''}). Above 1.3× busier than usual, below 0.7× quieter.`)}>${ratio.toFixed(2)}×</b> their usual activity (${nMin.toFixed(0)} one-minute bars).`
    : `Only ${obsPl(Math.round(nMin), 'minute')} of trading in ${dayWord} so far: too few to compare (needs ${CLK_MIN}).`;
  b.innerHTML = `<div class="obs-split"><div class="obs-cv sq"><canvas id="clkCv"></canvas></div><aside class="obs-side">
    <div class="ins"><label>Now · ${slT(curSl)}–${slT(curSl + 1)} UTC · ${nowLab}</label><p>${nowTxt}${ms.open && todayR ? ` Today so far: <b class="clk-r ${tone(todayR)}" tabindex="0"${tipAttr(`Today so far|All of ${dayWord} up to now (${obsPl(Math.round(todayMin), 'minute')} of trading) against the same slots on a usual day: ${todayR.toFixed(2)}×.`)}>${todayR.toFixed(2)}×</b> a usual day.` : ''}</p></div>
    ${nh ? `<div class="ins clk-nh"><label>Next hour · ${pretty(S.set.sym)}</label><p>In the next hour (until ${hhmm(now + 3600)} UTC) a typical move is <b class="mono" tabindex="0"${tipAttr(`Next hour, 1σ|One standard deviation of the move over the coming 60 minutes: the usual variances of those minutes added (σ per minute from the usual 1-minute moves, × √(π/2)). About two hours in three stay within it. No direction: the move is as likely up as down.`)}>±${nh.sig.toFixed(0)} ${un} (1σ)</b>, about two hours in three; <b class="mono">±${nh.sig2.toFixed(0)} ${un} (2σ)</b> holds 95% on a normal curve.${nh.min < 60 ? ` Only ${nh.min} minutes of trading are left in it (the market closes at ${hhmm(nh.end)} UTC).` : ''} ${tail.n >= CLK_TAIL_MIN ? `Past hours went beyond their ±2σ in <b class="mono" tabindex="0"${tipAttr(`Beyond ±2σ|Non-overlapping 60-minute windows of ${pretty(S.set.sym)} before ${dayWord}, without a closed-market gap, each against ±2σ of its own minutes: ${tail.k} of ${tail.n} (${(tail.k / tail.n * 100).toFixed(1)}%). A normal curve gives 5%.`)}>${tail.k} of ${tail.n} past hours</b> (${(tail.k / tail.n * 100).toFixed(0)}%), ${tail.k / tail.n < .03 ? 'less often than' : tail.k / tail.n > .07 ? 'more often than' : 'close to'} the 5% of a normal curve.` : `Too few past hours (${tail.n}) to check how often moves went beyond ±2σ.`} The 1-minute moves have fat tails, so ±2σ is not a hard limit.</p><p>Busiest hour (${hh(hiH)}) ±${hourSig(hiH).toFixed(0)} ${un}, quietest (${hh(loH)}) ±${hourSig(loH).toFixed(0)} ${un}. A ${stopU}-${un1} stop (the ticket's) is ${xr(stopU / Math.max(nh.sig, 1e-9))}× the next hour's 1σ${ratio ? ` (${xr(stopU / (nh.sig * Math.max(ratio, .25) || 1e-9))}× at the last hour's pace)` : ''}.</p></div>` : ''}
    <div class="ins"><label>Next two hours</label>${strip}<p>${aOpen.length ? `Usually <b>${aheadR.toFixed(2)}×</b> the daily average — ${aheadR > 1.2 ? 'usually wider swings; give stops room.' : aheadR < .8 ? 'usually quiet trade.' : 'about average.'} Busiest coming slot: <b class="mono">${slT(peakAhead)}</b> (${(avg[peakAhead] / overall).toFixed(2)}×).${closedN ? ` The market is closed for ${closedN} of these 8 slots.` : ''}` : `The market is closed for the next two hours.`}</p></div>
    <div class="ins"><label>Busiest and quietest hour</label><p>Peak <b class="mono" tabindex="0"${tipAttr(`Busiest hour|The hour of the day (UTC) with the largest average 1-minute move. Activity is set hour by hour, so a single 15-minute slot is too noisy to name a peak.`)}>${hh(hiH)}–${hh(hiH + 1)}</b> UTC (${(hourAvg[hiH] / overall).toFixed(2)}× average). Quietest <b class="mono">${hh(loH)}–${hh(loH + 1)}</b> UTC (${(hourAvg[loH] / overall).toFixed(2)}×).</p></div>
    ${obsHow(`Petals: the usual activity in each 15-minute slot; dots: today.`, `<p class="small muted">Petals: average absolute 1-minute move in each 15-minute slot of the day (${c.clkAll ? 'all 16 pairs' : pretty(S.set.sym)}), the median of the previous days that traded in that slot (median of ${obsPl(nd[curSl], 'day')} at ${slT(curSl)}${nd[curSl] < 3 ? ': too few days for a steady median, read it loosely' : ''}), so one agitated day barely moves it; the jump at a reopening is left out. Dots: today, from the start of ${dayWord}; one beyond the scale sits on its edge, hollow. Scale circles: ${one ? un : 'bp'} per minute, fixed by the usual profile. Rings, inside out: ${sess.map(s => s[0]).join(' · ')}${fx ? ' (today\'s hours, UTC)' : ''}; stronger = open now.${obsSim() ? ' On this simulated market the activity profile is set per UTC hour in the instrument catalog; the petals measure what the engine produced from it, noise included.' : ''}</p>`)}
    <p class="small muted">${sw('busy', 'busier than 1.3× average')} ${sw('quiet', 'quieter than 0.7×')} ${sw('now', 'now and today')} ${sw('ring', 'session')}</p></aside></div>`;
  const { g, w, h } = canvasFit($('#clkCv')), cx = w / 2, cy = h / 2, R = Math.min(w, h) / 2 - 52, r0 = R * .22;
  const ang = k => (k / SL) * 6.283 - Math.PI / 2, RG = 7, ringR = i => R + 9 + i * RG, ringOut = ringR(sess.length - 1) + RG / 2;
  const tx = cssv('--tx'), s1 = cssv('--s1');
  CV_HOVER.clkCv = e => {
    if (!e) return; const rc = e.target.getBoundingClientRect(), x = e.clientX - rc.left - cx, y = e.clientY - rc.top - cy, d = Math.hypot(x, y);
    const k = Math.floor(((Math.atan2(y, x) + Math.PI / 2 + 6.283) % 6.283) / 6.283 * SL);
    // the whole band of rings is a target: the nearest ring to the pointer
    if (d > R + 4 && d <= ringOut) { const ri = Math.max(0, Math.min(sess.length - 1, Math.round((d - R - 9) / RG))), [nm, bands] = sess[ri]; return cvTip(e, fx ? `${nm} session` : nm, [bands.length ? `${bands.map(([a, z2]) => `${clkH(a)}–${clkH(z2)}`).join(' and ')} UTC` : 'Closed all day', nowOpen.includes(nm) ? 'Open now' : 'Closed now', `At ${slT(k)}: ${openTxt(day0 + k * 900)}`]); }
    if (d < r0 || d > R + 4) return brTipHide();
    cvTip(e, `${slT(k)}–${slT(k + 1)} UTC`, [`Usual move ${perMin(avg[k])} · ${(avg[k] / overall).toFixed(2)}× the day's average`, `Median of ${obsPl(nd[k], 'previous day')} with data; mean of all their minutes ${perMin(avgM[k])}`, one ? `The hour from ${slT(k)} today: ±${hourFrom(day0 + k * 900).sig.toFixed(0)} ${un} (1σ)` : '', tod[k] != null ? `Today ${perMin(tod[k])} · ${(tod[k] / (avgC[k] || avg[k] || 1)).toFixed(2)}× usual` : 'Not reached today yet', `Today: ${openTxt(day0 + k * 900)}`].filter(Boolean));
  };
  // session rings: neutral, the open ones brighter, named on hover and in the note
  sess.forEach(([nm, bands], i) => { const on = nowOpen.includes(nm); bands.forEach(([a, z2]) => { g.beginPath(); g.arc(cx, cy, ringR(i), a / 24 * 6.283 - Math.PI / 2, z2 / 24 * 6.283 - Math.PI / 2); g.strokeStyle = on ? col.tx2 : col.line; g.lineWidth = 4; g.stroke(); }); });
  g.strokeStyle = col.grid; g.lineWidth = 1;
  [.33, .66, 1].forEach(f => { const rr = r0 + (R - r0) * f; g.beginPath(); g.arc(cx, cy, rr, 0, 6.283); g.stroke(); });
  for (let k = 0; k < SL; k++) {
    const a1 = ang(k) + .004, a2 = ang(k + 1) - .004, rr = r0 + avg[k] / mxv * (R - r0);
    g.beginPath(); g.arc(cx, cy, rr, a1, a2); g.arc(cx, cy, r0, a2, a1, true); g.closePath();
    g.fillStyle = k === curSl ? tx : (avg[k] / overall > 1.3 ? cssv('--div-pos') + 'bb' : avg[k] / overall < .7 ? cssv('--div-neg') + '88' : col.tx2 + '77'); g.fill();
  }
  // today's dots on the same fixed scale, a halo so they read on any petal
  for (let k = 0; k < SL; k++) {
    if (tod[k] == null) continue; const over = tod[k] > mxv, rt = over ? R + 3 : r0 + tod[k] / mxv * (R - r0), am = ang(k + .5);
    g.beginPath(); g.arc(cx + Math.cos(am) * rt, cy + Math.sin(am) * rt, 2.4, 0, 6.283);
    if (over) { g.strokeStyle = tx; g.lineWidth = 1.4; g.stroke(); } else { g.fillStyle = tx; g.fill(); g.strokeStyle = s1; g.lineWidth = 1; g.stroke(); }
  }
  // scale labels last, over the petals, with a halo
  g.font = '10.5px JetBrains Mono'; g.lineJoin = 'round';
  [.33, .66, 1].forEach(f => { const rr = r0 + (R - r0) * f, v = mxv * f, lab = one ? `${toP(v).toFixed(2)}${uShort(S.set.sym)}` : `${v.toFixed(1)}bp`, x = cx + Math.cos(-1.35) * rr + 3, y = cy + Math.sin(-1.35) * rr; g.strokeStyle = s1; g.lineWidth = 3; g.strokeText(lab, x, y); g.fillStyle = col.tx; g.fillText(lab, x, y); });
  g.fillStyle = col.tx; g.font = '11.5px JetBrains Mono'; for (let hr = 0; hr < 24; hr += 3) { const a = hr / 24 * 6.283 - Math.PI / 2; g.fillText(String(hr).padStart(2, '0'), cx + Math.cos(a) * (ringOut + 14) - 7, cy + Math.sin(a) * (ringOut + 14) + 4); }
  const an = ((now % 86400) / 86400) * 6.283 - Math.PI / 2; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(an) * (R + 2), cy + Math.sin(an) * (R + 2)); g.strokeStyle = tx; g.lineWidth = 2; g.stroke();
  g.beginPath(); g.arc(cx, cy, r0 - 2, 0, 6.283); g.fillStyle = s1; g.fill();
  g.fillStyle = tx; g.font = '600 13px JetBrains Mono'; const tt = hhmm(now); g.fillText(tt, cx - g.measureText(tt).width / 2, cy + 4);
}

/* ---------------- 8. Tapestry: horizon charts of all pairs ---------------- */
/* Consensus of a theme: below this share of its pairs moving its way, the strongest / weakest currency is "mixed". */
const TAP_FIRM = .75;
// the currency filter: All, or the pairs of one of the eight (a soft setting, see OBS_SOFT)
const tapG8 = () => ['USD', ...Engine.CCY];
const tapCcyOf = c => tapG8().includes(c.tapCcy) ? c.tapCcy : 'all';
// below the rows: the time labels, then a lane of calendar releases and one lane per FX session
const TAP_NEWS_DY = 26, TAP_LANE_DY = 44, TAP_LANE_STEP = 13, TAP_LANES_H = 98;
function drawTap(b, c) {
  const col = chartColors(), lb = c.tapLb, rowsH = 30, syms = Engine.PAIRS.map(p => p.sym), perPair = c.tapScale === 'pair';
  let data = syms.map(s => { const a = Engine.candles[s].slice(-lb - 1), base = a[0].close, T0 = a.map(k => k.time), { r } = gapRets(T0, a.map(k => k.close)); return { s, v: a.map(k => Math.log(k.close / base)), p: a.map(k => (k.close - base) / M(s).pip), t: T0, sd: r.length > 1 ? stdev(r) : 0 }; });
  if (c.tapSort === 'ret') data.sort((x, y) => y.v[y.v.length - 1] - x.v[x.v.length - 1]);
  else if (c.tapSort === 'abc') data.sort((x, y) => x.s.localeCompare(y.s));
  else { // cluster: order by a depth-first walk of the Constellation tree on the same window
    const { C } = corrMatrix(lb), D = constDist(C), E = mst(D), seen = new Set(), ord = [];
    const dfs = u => { seen.add(u); ord.push(u); E.filter(e => e.includes(u)).map(e => e[0] === u ? e[1] : e[0]).filter(v => !seen.has(v)).sort((a2, b2) => D[u][a2] - D[u][b2]).forEach(dfs); };
    dfs(Math.max(0, syms.indexOf(S.set.sym))); data = ord.map(i => data.find(d => d.s === syms[i]));
  }
  const fc = tapCcyOf(c), inF = s => { const m = M(s); return m.base === fc || m.quote === fc; };
  if (fc !== 'all') data = data.filter(d => inF(d.s));
  const T = data[0].t, n = T.length, common = Math.max(...data.map(d => Math.max(...d.v.map(Math.abs)))) / 3 || 1e-4;
  // per-pair scale: a third of the pair's typical random-walk distance over the window (σ of 1-minute returns × √bars)
  data.forEach(d => { d.band = perPair && d.sd > 0 ? d.sd * Math.sqrt(n - 1) / 3 : common; });
  /* the theme: currency strength over the same window (Engine.strength, the source the rest of the app reads: each
     currency against the average of the eight), and as a check, on how many of its pairs it moved that way
     (base: the pair's move, quote: its opposite). Under TAP_FIRM of its pairs the theme is "mixed" and drawn muted. */
  const theme = fc !== 'all' ? [] : Engine.strength(lb).map(({ c: cc, s }) => { const mv = data.filter(d => { const m = M(d.s); return m.base === cc || m.quote === cc; }).map(d => (M(d.s).base === cc ? 1 : -1) * d.v[d.v.length - 1]); const k = mv.filter(v => v !== 0 && Math.sign(v) === Math.sign(s)).length; return { cc, avg: s / 1e4, k, n: mv.length, mixed: !mv.length || k / mv.length < TAP_FIRM }; });
  const hiC = theme[0], loC = theme[theme.length - 1];
  /* filtered on one currency, the theme is that currency on the rows shown: its average move across them (the pair's
     move when it is the base, the opposite when it is the quote) and on how many of them it moved that way */
  let own = null;
  if (fc !== 'all') { const mv = data.map(d => (M(d.s).base === fc ? 1 : -1) * d.v[d.v.length - 1]), avg = mean(mv), k = mv.filter(v => v !== 0 && Math.sign(v) === Math.sign(avg)).length; own = { cc: fc, avg, k, n: mv.length, mixed: !mv.length || k / mv.length < TAP_FIRM }; }
  OBS.tapTheme = own ? [own] : [hiC, loC];
  // gaps longer than 3 hours are a closed market: the bars sit side by side, the gap is marked
  const gaps = []; for (let i = 1; i < n; i++) if (T[i] - T[i - 1] > 3 * 3600) gaps.push(i);
  const lbName = { 240: '4 hours', 1440: '24 hours', 4320: '3 days' }[lb] || `${lb} minutes`;
  const shades = ['40', '90', 'e0'], bandSw = (tok, k) => `<i class="tap-sh" aria-hidden="true" style="background:color-mix(in srgb,var(${tok}) ${[25, 56, 88][k]}%,transparent)"></i>`;
  // two neutral tones for the two ends: neither is "good" or "bad"
  const chip = (x, hi) => `<span class="dj-verdict tap-theme ${hi ? 'tap-hi' : 'tap-lo'}${x.mixed ? ' mixed' : ''}" tabindex="0"${tipAttr(`${hi ? 'Strongest' : 'Weakest'}: ${x.cc}|Over the window ${x.cc} moved ${obsBp(x.avg)} against the average of the eight currencies (the same strength as the rest of the app). On ${x.k} of its ${x.n} pairs it moved that way (the pair's move when it is the base currency, the opposite when it is the quote).${x.mixed ? ' Fewer than three in four of its pairs agree: a mixed picture, not a theme across its pairs.' : ''} It describes the window; it does not forecast.`)}><b>${x.cc} ${hi ? 'strength' : 'weakness'}</b><span>${obsBp(x.avg)} vs the 8-currency average · same way on ${x.k} of ${x.n} pairs${x.mixed ? ' · mixed' : ''}</span></span>`;
  const ownChip = x => { const hi = x.avg >= 0; return `<span class="dj-verdict tap-theme ${hi ? 'tap-hi' : 'tap-lo'}${x.mixed ? ' mixed' : ''}" tabindex="0"${tipAttr(`${x.cc} on the rows shown|Over the window ${x.cc} moved ${obsBp(x.avg)} on average across the ${x.n} pairs shown (the pair's move when ${x.cc} is the base currency, the opposite when it is the quote), and that way on ${x.k} of them.${x.mixed ? ' Fewer than three in four agree: a mixed picture.' : ''} It describes the window; it does not forecast.`)}><b>${x.cc} ${hi ? 'strength' : 'weakness'}</b><span>${obsBp(x.avg)} on average across its ${x.n} pairs · same way on ${x.k} of ${x.n}${x.mixed ? ' · mixed' : ''}</span></span>`; };
  // the releases of the app's calendar inside the window, for the currencies of the rows shown
  const shownC = new Set(data.flatMap(d => [M(d.s).base, M(d.s).quote]));
  const news = (typeof CAL === 'object' && Array.isArray(CAL.events) ? CAL.events : []).filter(e => e && e.done && isFinite(e.t) && e.t >= T[0] && e.t <= T[n - 1] + 60 && shownC.has(e.ccy)).sort((x, y) => x.t - y.t).map(e => ({ e, i: Math.max(0, T.findIndex(tt => tt >= e.t)) })).map(x => ({ ...x, i: x.i < 0 ? n - 1 : x.i }));
  const impW = { hi: 'High', md: 'Medium', lo: 'Low' };
  const newsLines = e => [e.actual != null && e.fc != null ? `Actual ${fmtNum(e.actual, e.unit)} vs ${fmtNum(e.fc, e.unit)} forecast` : e.real ? `Released${e.fc ? ' · forecast ' + e.fc : ''} (actual not in the feed)` : 'Released (no figure)', `${impW[e.impact] || 'Low'} impact · from the app's economic calendar (${e.real ? 'ForexFactory' : 'built in'})`];
  const newsTxt = news.length ? `Releases in the window, from the app's calendar (it keeps its last 8): ${news.map(({ e }) => obsV(`${escHtml(e.ccy)} ${escHtml(e.name)} ${dts(e.t)}`, '', `${e.ccy} ${e.name} · ${dts(e.t)} UTC|${newsLines(e).join('. ')}.`)).join(', ')}.` : `No release of the app's calendar falls in this window (it keeps its last 8 releases).`;
  const legend = perPair
    ? `<span class="tap-bands">${[0, 1, 2].map(k => `${bandSw('--up', k)}${bandSw('--dn', k)}`).join(' ')} each row on its own scale: one band = a third of the pair's typical move over the window (σ of its 1-minute returns × √bars). Rows are not comparable in size.</span>`
    : `<span class="tap-bands">${[0, 1, 2].map(k => `${bandSw('--up', k)}${bandSw('--dn', k)} ${k < 2 ? `${(common * 1e4 * k).toFixed(0)}–${(common * 1e4 * (k + 1)).toFixed(0)} bp` : `over ${(common * 1e4 * 2).toFixed(0)} bp`}`).join(' · ')}</span>`;
  b.innerHTML = `<div class="tap-head">${own ? ownChip(own) : `${chip(hiC, true)}${chip(loC, false)}`}
      <span class="muted small tap-span"${tipAttr(`Window|The last ${lbName} of trading: ${lb} one-minute bars, from ${dts(T[0])} to ${dts(T[n - 1])} UTC.${gaps.length ? ' The market was closed in between (weekend); the bars of both sides sit next to each other and the gap is marked.' : ''}`)}>${dts(T[0])} → ${dts(T[n - 1])} UTC · last ${lbName} of trading${gaps.length ? ' · weekend skipped' : ''}${fc !== 'all' ? ` · ${data.length} of 16 pairs (${fc})` : ''}</span></div>
    <div class="tap-wrap"><canvas id="tapCv" style="height:${data.length * rowsH + TAP_LANES_H}px"></canvas></div>
    ${obsHow(`${obsSw('--up', 'up', 'above the start')} ${obsSw('--dn', 'dn', 'below the start')} ${legend}`, `<p class="small muted"><b>Horizon charts</b> fold each line into 3 bands so 16 pairs fit in the space of one chart: the further from the start of the window, the stronger the shade. Each pixel shows the largest distance among the bars it covers, so no peak is lost. The colours and bands are in the line above. The thin line under each row is 0, the level at the start of the window. Below the time axis: the calendar's releases and the four FX sessions (UTC, each day's own hours with summer time, as on the Volatility clock). Hover to read a pair and the whole board at one moment; click a row to open it.</p>`, 'pad-t tap-how')}
    <p class="small muted tap-news">${newsTxt}</p>`;
  const cv = $('#tapCv');
  const ups = shades.map(a => col.up + a), dns = shades.map(a => col.dn + a);
  /* One index rule for drawing and reading: pixel column px covers bars [a, b) and shows the bar with the largest
     distance from the start among them (max/min per pixel); hover reads that same bar. */
  let W2 = 1, picks = null;
  const range = px => { const a = Math.floor(px * n / W2); return [Math.min(a, n - 1), Math.min(n, Math.max(a + 1, Math.floor((px + 1) * n / W2)))]; };
  const pick = (row, px) => { if (picks && picks[row]) return picks[row][clamp(px, 0, W2 - 1)]; const v = data[row].v, [a, e] = range(clamp(px, 0, W2 - 1)); let k = a; for (let i = a + 1; i < e; i++) if (Math.abs(v[i]) > Math.abs(v[k])) k = i; return k; };
  const hoverIdx = (row, x) => pick(row, Math.floor(x - 82));
  const X = i => 82 + (i + .5) * W2 / n;
  const step = (lb <= 240 ? 1 : lb <= 1440 ? 4 : 12) * 3600;
  const draw = hov => {
    const { g, w } = canvasFit(cv), L0 = 82, nw = Math.max(1, Math.floor(w - L0 - 120));
    if (nw !== W2 || !picks) { W2 = nw; picks = null; picks = data.map((_, r) => Int32Array.from({ length: W2 }, (__, px) => pick(r, px))); }
    data.forEach((d, r) => {
      const y0 = r * rowsH, on = hov && hov.sym === d.s, band = d.band;
      g.fillStyle = on ? cssv('--s3') : r % 2 ? cssv('--s2') : cssv('--s1'); g.fillRect(0, y0, w, rowsH);
      for (let px = 0; px < W2; px++) {
        const v = d.v[picks[r][px]], av = Math.abs(v), cols = v >= 0 ? ups : dns;
        for (let k = 0; k < 3; k++) { const f = clamp((av - k * band) / band, 0, 1); if (f <= 0) break; g.fillStyle = cols[k]; g.fillRect(L0 + px, y0 + rowsH - 2 - f * (rowsH - 4), 1.05, f * (rowsH - 4)); }
      }
      // the 0 line: the level at the start of the window, which both folded directions grow from
      g.fillStyle = col.tx2; g.globalAlpha = .55; g.fillRect(L0, y0 + rowsH - 2, W2, 1); g.globalAlpha = 1;
      const cur = d.s === S.set.sym;
      if (cur) { g.strokeStyle = col.acc; g.lineWidth = 1.5; g.strokeRect(.75, y0 + .75, w - 1.5, rowsH - 1.5); }
      else if (on) { g.strokeStyle = col.tx2; g.lineWidth = 1; g.strokeRect(.5, y0 + .5, w - 1, rowsH - 1); }
      g.fillStyle = cur ? col.acc : cssv('--tx'); g.font = `${cur || on ? 700 : 500} 12px JetBrains Mono`; g.fillText(pretty(d.s), 6, y0 + 19);
      const lv = d.v[n - 1], lp = d.p[n - 1]; g.fillStyle = lv >= 0 ? col.up : col.dn; g.font = '12px JetBrains Mono'; g.fillText(obsBp(lv), L0 + W2 + 6, y0 + 19);
      g.fillStyle = col.tx; g.font = '11px JetBrains Mono'; g.fillText(`${sgn(lp, 0)}${uShort(d.s)}`, L0 + W2 + 78, y0 + 19);
    });
    OBS.tap.outlined = hov ? hov.sym : null;
    const yb = data.length * rowsH;
    gaps.forEach(i => { g.strokeStyle = col.tx2; g.setLineDash([3, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(X(i), 0); g.lineTo(X(i), yb); g.stroke(); g.setLineDash([]); g.fillStyle = col.tx2; g.font = '10.5px JetBrains Mono'; g.fillText('weekend', X(i) + 3, yb + 20); });
    // time labels on round hours (every 1, 4 or 12 hours by window), where there is room
    g.fillStyle = col.tx; g.font = '11.5px JetBrains Mono'; let last = -99;
    for (let i = 0; i < n; i++) {
      if (T[i] % step) continue;
      const x = X(i), lab = dts(T[i]), tw = g.measureText(lab).width, lx = x - tw / 2;
      if (lx < L0 || lx + tw > L0 + W2 || lx - last < tw + 10) continue;
      if (gaps.some(gi => Math.abs(X(gi) - x) < 70)) continue;
      g.fillRect(x - .5, yb, 1, 3); g.fillText(lab, lx, yb + 16); last = lx;
    }
    if (hov) { g.strokeStyle = col.acc; g.lineWidth = 1; g.beginPath(); g.moveTo(X(hov.i), 0); g.lineTo(X(hov.i), yb); g.stroke(); }
    // the lanes: releases (a dotted line through the rows for high and medium impact), then the sessions open at each bar
    g.font = '10.5px JetBrains Mono'; g.fillStyle = col.tx; g.fillText('News', 6, yb + TAP_NEWS_DY + 9);
    OBS.tap.newsY = yb + TAP_NEWS_DY;
    OBS.tap.news = news.map(x => ({ ...x, x: X(x.i) }));
    OBS.tap.news.forEach(({ e, x }) => {
      const big = e.impact === 'hi', r = big ? 4.5 : e.impact === 'md' ? 3.5 : 2.6, y = yb + TAP_NEWS_DY + 6;
      if (e.impact !== 'lo') { g.strokeStyle = col.tx2; g.globalAlpha = .45; g.setLineDash([1, 3]); g.lineWidth = 1; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, yb); g.stroke(); g.setLineDash([]); g.globalAlpha = 1; }
      g.beginPath(); g.moveTo(x, y - r); g.lineTo(x + r, y); g.lineTo(x, y + r); g.lineTo(x - r, y); g.closePath(); g.fillStyle = big ? col.tx : col.tx2; g.fill();
    });
    OBS.tap.lanes = ['Sydney', 'Tokyo', 'London', 'New York'].map((nm, li) => {
      const y = yb + TAP_LANE_DY + li * TAP_LANE_STEP, on = [];
      g.fillStyle = col.tx; g.fillText(nm, 6, y + 6);
      for (let px = 0; px < W2; px++) { const t = T[range(px)[0]], h = (t % 86400) / 3600, ss = clkSessions(t).find(x => x[0] === nm); if (ss && ss[1].some(([a, z]) => h >= a && h < z)) on.push(px); }
      g.fillStyle = col.tx2; g.globalAlpha = .7;
      for (let k = 0; k < on.length; k++) { let e2 = k; while (e2 + 1 < on.length && on[e2 + 1] === on[e2] + 1) e2++; g.fillRect(L0 + on[k], y, on[e2] - on[k] + 1, 6); k = e2; }
      g.globalAlpha = 1;
      return { nm, y, on };
    });
    return { L0, W2 };
  };
  OBS.tap = { data, rowsH, bands: data.map(d => d.band), pick, hoverIdx, geo: null, outlined: null, news: [], lanes: [], newsY: 0 };
  /* hover and click are bound to the pair (its symbol, also on the canvas as data-sym), never to a row number: after a
     redraw reorders the rows, the highlight stays on the same pair */
  const keep = OBS.tapHov && OBS.tapHov.key === lb && OBS.tapHov.i < n && data.some(d => d.s === OBS.tapHov.sym) ? OBS.tapHov : null;
  let geo = OBS.tap.geo = draw(keep); if (keep) cv.dataset.sym = keep.sym;
  const rowOf = e => Math.floor((e.clientY - cv.getBoundingClientRect().top) / rowsH);
  CV_HOVER.tapCv = e => {
    if (!e) { OBS.tapHov = null; delete cv.dataset.sym; geo = OBS.tap.geo = draw(null); return; }
    const rc = cv.getBoundingClientRect(), x = e.clientX - rc.left, y = e.clientY - rc.top, row = rowOf(e), d = data[row];
    // the lanes under the axis: a release, or a session on the day of the bar under the pointer
    if (y >= data.length * rowsH && x >= geo.L0 && x < geo.L0 + geo.W2) {
      if (OBS.tapHov) { OBS.tapHov = null; delete cv.dataset.sym; geo = OBS.tap.geo = draw(null); }
      const ny = OBS.tap.newsY;
      if (y >= ny - 2 && y < ny + 15) { const hit = OBS.tap.news.map(z => [z, Math.abs(z.x - x)]).filter(([, dd]) => dd <= 6).sort((p1, p2) => p1[1] - p2[1])[0]; if (!hit) return brTipHide(); const ev = hit[0].e; return cvTip(e, `${ev.ccy} ${ev.name} · ${dts(ev.t)} UTC`, newsLines(ev)); }
      const ln = OBS.tap.lanes.find(l => y >= l.y - 2 && y < l.y + 8); if (!ln) return brTipHide();
      const i = range(clamp(Math.floor(x - geo.L0), 0, W2 - 1))[0], t = T[i], ss = clkSessions(t).find(z => z[0] === ln.nm), h = (t % 86400) / 3600, open = ss[1].some(([a, z]) => h >= a && h < z);
      return cvTip(e, `${ln.nm} session`, [`${ss[1].map(([a, z]) => `${clkH(a)}–${clkH(z)}`).join(' and ')} UTC on ${new Date(t * 1000).toUTCString().slice(0, 11)}`, `${open ? 'Open' : 'Closed'} at ${dts(t)} UTC`]);
    }
    if (x < geo.L0 || x >= geo.L0 + geo.W2 || !d) { if (OBS.tapHov) { OBS.tapHov = null; delete cv.dataset.sym; geo = OBS.tap.geo = draw(null); } return brTipHide(); }
    const i = hoverIdx(row, x);
    if (!OBS.tapHov || OBS.tapHov.i !== i || OBS.tapHov.sym !== d.s) { OBS.tapHov = { i, sym: d.s, key: lb }; cv.dataset.sym = d.s; geo = OBS.tap.geo = draw(OBS.tapHov); }
    const hiI = d.v.indexOf(Math.max(...d.v)), loI = d.v.indexOf(Math.min(...d.v)), u = uShort(d.s), at = data.map(x2 => [x2.s, x2.v[i]]).sort((a2, b2) => b2[1] - a2[1]);
    cvTip(e, `${pretty(d.s)} · ${dts(T[i])} UTC`, [`Here ${obsBp(d.v[i])} (${sgn(d.p[i], 1)}${u}) · now ${obsBp(d.v[n - 1])}`, `High ${obsBp(d.v[hiI])} ${dts(T[hiI])} · low ${obsBp(d.v[loI])} ${dts(T[loI])}`, `Top ${at.slice(0, 3).map(([s]) => pretty(s)).join(', ')} · bottom ${at.slice(-3).reverse().map(([s]) => pretty(s)).join(', ')}`]);
  };
  cv.onclick = e => { const d = data[rowOf(e)]; if (d) setSymbol(d.s); };
}

/* ---------------- first-passage odds for the ticket ---------------- */
// For a driftless random walk between barriers a (stop) and b (target): P(target first) = a/(a+b), E[T] = a·b/σ²
function obsOdds(k) {
  if (k.sl == null || k.tp == null) return null;
  const t = S.tk, sp = k.q.spread, a = Math.max(.1, t.sl - sp), bb = t.tp + sp; // spread works against you on both sides
  const key = k.sym; let s = OBS.sig?.[key];
  if (!s || performance.now() - s.at > 5000) { const r = Engine.returns(k.sym, 240); const sig = stdev(r) * Engine.quote(k.sym).mid / M(k.sym).pip; s = { sig, at: performance.now() }; OBS.sig = { ...(OBS.sig || {}), [key]: s }; }
  return { p: a / (a + bb), mins: s.sig > 0 ? a * bb / (s.sig * s.sig) : null };
}

/* ---------------- sonification ---------------- */
const SON = { on: false, ctx: null, last: null, ref: null, lastBeat: 0, gain: null };
function sonCfg() { if (!S.set.sonic) S.set.sonic = { ticks: true, heart: true, vol: .5, sens: 1 }; return S.set.sonic; }
function sonNote(freq, t0, dur = .09, type = 'triangle', vol = .06, pan = 0) {
  const c = SON.ctx, o = c.createOscillator(), g = c.createGain(), p = c.createStereoPanner ? c.createStereoPanner() : null;
  o.type = type; o.frequency.value = freq; g.gain.setValueAtTime(.0001, t0); g.gain.exponentialRampToValueAtTime(vol * sonCfg().vol * 2, t0 + .012); g.gain.exponentialRampToValueAtTime(.0001, t0 + dur);
  if (p) { p.pan.value = pan; o.connect(g).connect(p).connect(c.destination); } else o.connect(g).connect(c.destination);
  o.start(t0); o.stop(t0 + dur + .02);
}
const semis = (base, n) => base * Math.pow(2, n / 12);
function sonTick() {
  if (!SON.on || !SON.ctx) return;
  const cfg = sonCfg(), sym = S.set.sym, m = M(sym), q = Engine.quote(sym), now = SON.ctx.currentTime;
  if (SON.last == null || SON.sym !== sym) { SON.last = q.mid; SON.sym = sym; const a = Engine.candles[sym]; SON.ref = a[Math.max(0, a.length - 1440)].open; return; }
  const step = .6 * m.pip / cfg.sens, d = q.mid - SON.last;
  if (cfg.ticks && Math.abs(d) >= step) {
    // relative movement: two notes, second higher on upticks; absolute distance from the day reference sets the register
    const off = clamp(Math.round((q.mid - SON.ref) / (m.pip * 10)), -12, 12), base = semis(440, off);
    sonNote(base, now, .07, 'triangle', .05, 0); sonNote(semis(base, d > 0 ? 4 : -3), now + .08, .09, 'triangle', .05, 0);
    if (Math.abs(d) > step * 4) sonNote(semis(base, d > 0 ? 7 : -8), now + .17, .12, 'sine', .05);
    SON.last = q.mid;
  }
  if (cfg.heart && S.positions.length && now - SON.lastBeat > 1.6) {
    // portfolio heartbeat: pitch follows open P&L; tempo doubles and the interval turns dissonant near a stop
    const pnl = S.positions.reduce((s, p) => s + posPnl(p).pnl, 0), eq = account().eq;
    const danger = S.positions.some(p => { if (p.sl == null) return false; const px = Engine.quote(p.sym)[p.side === 'buy' ? 'bid' : 'ask'], dist = Math.abs(px - p.sl), full = Math.abs(p.entry - p.sl) || 1; return dist / full < .25; });
    const f = semis(110, clamp(pnl / eq * 400, -12, 12));
    sonNote(f, now, .16, 'sine', .07, -.3); sonNote(danger ? semis(f, 6) : semis(f, 7), now + .18, .14, 'sine', .05, .3);
    SON.lastBeat = now - (danger ? .8 : 0);
  }
}
function sonToggle(force) {
  SON.on = force ?? !SON.on;
  if (SON.on) { try { SON.ctx = SON.ctx || new (window.AudioContext || window.webkitAudioContext)(); SON.ctx.resume(); } catch (e) { SON.on = false; } SON.last = null; }
  $('#sonBtn').classList.toggle('on', SON.on); $('#sonBtn').setAttribute('aria-pressed', SON.on);
  toast(SON.on ? 'Listening to the market' : 'Market sound off', SON.on ? `Rising two-note chimes = upticks on ${pretty(S.set.sym)}, falling = downticks; pitch drifts with distance from the daily open. A low pulse tracks your open P&L and turns tense near a stop.` : '', 'info');
}

function bindObs() {
  $('#obs').addEventListener('mouseleave', e => { if (e.target.id === 'obsBody') obsResume(); }, true);
  $('#obs').addEventListener('focusout', e => { const b = $('#obsBody'); if (b && b.contains(e.target) && !b.contains(e.relatedTarget)) obsResume(); });
  $('#obs').addEventListener('click', e => {
    const go = e.target.closest('[data-obs-open]'); if (go) { setSymbol(go.dataset.obsOpen); renderObs(); return; }
    const v = e.target.closest('.obs-nav button'); if (v) { obsCfg().view = v.dataset.v; save(); renderObs(); return; }
    const s = e.target.closest('#obsCtrl [data-val]'); if (s) { const k = s.closest('[data-k]').dataset.k, raw = s.dataset.val; obsCfg()[k] = raw === 'true' ? true : raw === 'false' ? false : isNaN(+raw) ? raw : +raw; save(); renderObs(); }
  });
  $('#sonBtn').addEventListener('click', e => { if (e.shiftKey) { $('#sonPop').hidden = !$('#sonPop').hidden; return; } sonToggle(); });
  $('#sonMore').addEventListener('click', e => { e.stopPropagation(); $('#sonPop').hidden = !$('#sonPop').hidden; });
  document.addEventListener('click', e => { if (!e.target.closest('.son-wrap')) $('#sonPop').hidden = true; });
  const c = sonCfg();
  $('#sonTicks').checked = c.ticks; $('#sonHeart').checked = c.heart; $('#sonVol').value = c.vol; $('#sonSens').value = c.sens;
  $('#sonPop').addEventListener('input', () => { c.ticks = $('#sonTicks').checked; c.heart = $('#sonHeart').checked; c.vol = +$('#sonVol').value; c.sens = +$('#sonSens').value; save(); });
  window.addEventListener('resize', () => { if (activeTab !== 'obs') return; if (obsBusy()) { OBS.missed = true; return; } obsDraw(); }); // a redraw replaces the markup: held back while the pointer or focus is inside (drawn on leaving, obsResume)
  document.addEventListener('keydown', e => {
    if (/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName) || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key.toLowerCase() === 'o' && !e.shiftKey) setTab('obs');
  });
  setInterval(() => safe('sonification', sonTick), 250);
}
