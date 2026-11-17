/* Hint cards (front 15.11.2026): the rich hover for the Journal. An element with data-rich="<key>" gets a card built from the
   trader's own numbers: the value highlighted, the formula with the figures filled in, a scale with a marker, a small diagram,
   and what to do with it. Anything without a card keeps its plain data-tip text (brief.js tipBind -> hintRich). */
const HT = (() => {
  const esc = v => String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const usd = (v, sg) => usdFmt(v, sg), cl = v => v > 0 ? 'up' : v < 0 ? 'dn' : '';
  const pc = (v, d = 0) => (v * 100).toFixed(d) + '%';
  const sec = (h, body) => `<section class="rt-s"><h5>${h}</h5>${body}</section>`;
  const EFF = { ok: ['pos', '▲', 'Positive for trading efficiency'], bad: ['neg', '▼', 'Negative for trading efficiency'], warn: ['cau', '●', 'Marginal: needs attention'], '': ['neu', '○', 'Neutral: no verdict'] };
  const head = (title, chip, tone) => { const e = EFF[tone || ''] || EFF['']; return `<header class="rt-h"><b>${esc(title)}</b><span class="rt-eff ${e[0]}"><i>${e[1]}</i><span><strong>${e[2]}</strong>${chip ? `<small>${esc(chip)}</small>` : ''}</span></span></header>`; };
  const val = (label, v, cls, sub) => `<div class="rt-val"><small>${esc(label)}</small><strong class="mono ${cls || ''}">${v}</strong>${sub ? `<span>${sub}</span>` : ''}</div>`;
  const tbl = (rows, head2) => `<table class="rt-t">${head2 ? `<thead><tr>${head2.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>` : ''}<tbody>${rows.map(r => `<tr class="${r.on ? 'on' : ''}">${r.c.map((c, i) => `<td class="${i ? 'mono' : ''}">${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const p = t => `<p>${t}</p>`;
  const use = t => `<div class="rt-use"><b>Use it</b>${t}</div>`;
  const warn = t => `<div class="rt-warn"><b>Watch out</b>${t}</div>`;
  const ex = t => `<div class="rt-eg"><b>Example</b>${t}</div>`;
  // a scale: bands [{w, label, tone}] left to right over [min, max]; the marker at v
  const scale = (bands, min, max, v, fmt) => {
    const tot = bands.reduce((s, b) => s + b.w, 0), pos = Math.max(0, Math.min(100, (v - min) / (max - min) * 100));
    return `<div class="rt-sc"><div class="rt-bands">${bands.map(b => `<i class="${b.tone}" style="flex:${b.w / tot}">${b.label}</i>`).join('')}<b class="rt-mk" style="left:${pos}%"><em>${fmt ? fmt(v) : v}</em></b></div></div>`;
  };
  // two horizontal bars on the same scale
  const bars = rows => { const mx = Math.max(...rows.map(r => Math.abs(r.v)), 1e-9); return `<div class="rt-bars">${rows.map(r => `<div><span>${r.l}</span><div class="rt-bar"><i class="${r.tone}" style="width:${Math.max(2, Math.abs(r.v) / mx * 100)}%"></i></div><em class="mono">${r.t}</em></div>`).join('')}</div>`; };
  const stat = () => journalStats();
  // drawdown diagram: the real balance curve, the peak and the trough of the worst fall marked
  const ddSvg = s => {
    const c = s.curve; if (c.length < 3) return '';
    let pk = 0, tr = 0, bp = 0, bt = 0, bd = 0; for (let i = 1; i < c.length; i++) { if (c[i] > c[bp]) bp = i; const d = c[bp] > 0 ? (c[bp] - c[i]) / c[bp] : 0; if (d > bd) { bd = d; pk = bp; tr = i; } }
    const W = 400, H = 120, L = 6, R = 6, T = 10, B = 10, mn = Math.min(...c), mx = Math.max(...c), step = Math.max(1, Math.ceil(c.length / 120));
    const X = i => L + i / (c.length - 1) * (W - L - R), Y = v => T + (1 - (v - mn) / Math.max(1e-9, mx - mn)) * (H - T - B);
    const pts = []; for (let i = 0; i < c.length; i += step) pts.push(`${X(i).toFixed(1)},${Y(c[i]).toFixed(1)}`); pts.push(`${X(c.length - 1).toFixed(1)},${Y(c[c.length - 1]).toFixed(1)}`);
    const x1 = X(pk), x2 = X(tr), y1 = Y(c[pk]), y2 = Y(c[tr]);
    return `<svg class="rt-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Balance curve with the deepest fall marked"><polyline points="${pts.join(' ')}" class="ln"/>
      <line x1="${x1}" y1="${y1}" x2="${Math.min(W - R, x2 + 30)}" y2="${y1}" class="gd"/><line x1="${x2}" y1="${y1}" x2="${x2}" y2="${y2}" class="dd"/>
      <circle cx="${x1}" cy="${y1}" r="3.5" class="pk"/><circle cx="${x2}" cy="${y2}" r="3.5" class="tr"/>
      <text x="${Math.min(W - 70, x2 + 6)}" y="${(y1 + y2) / 2 + 3}" class="lb">−${(bd * 100).toFixed(1)}%</text><text x="${Math.max(L, x1 - 4)}" y="${Math.max(9, y1 - 6)}" class="lb2" text-anchor="${x1 > 60 ? 'end' : 'start'}">peak</text></svg>`;
  };
  // the interval of the win rate on a 0-100% line
  const ciSvg = (k, n) => {
    const ci = wilson(k, n); if (!ci) return ''; const W = 400, X = v => 8 + v * (W - 16), m = k / n;
    return `<svg class="rt-svg rt-ci" viewBox="0 0 ${W} 54" role="img" aria-label="Win rate with its 95% interval"><line x1="8" y1="28" x2="${W - 8}" y2="28" class="ax"/>
      <line x1="${X(.5)}" y1="18" x2="${X(.5)}" y2="38" class="gd"/><text x="${X(.5)}" y="50" class="lb2" text-anchor="middle">50%</text>
      <rect x="${X(ci.lo)}" y="22" width="${Math.max(2, X(ci.hi) - X(ci.lo))}" height="12" class="rg"/><circle cx="${X(m)}" cy="28" r="5" class="pk"/>
      <text x="${X(ci.lo)}" y="14" class="lb2" text-anchor="middle">${pc(ci.lo)}</text><text x="${X(ci.hi)}" y="14" class="lb2" text-anchor="middle">${pc(ci.hi)}</text></svg>`;
  };
  // the equity-curve reading guide, drawn
  const shapesSvg = () => `<svg class="rt-svg" viewBox="0 0 400 86" role="img" aria-label="Three curve shapes">
    <g transform="translate(0,0)"><polyline class="ln" points="6,70 30,58 55,50 80,40 105,30 126,18"/><text x="66" y="84" class="lb2" text-anchor="middle">steady</text></g>
    <g transform="translate(134,0)"><polyline class="ln" points="6,70 30,68 52,66 62,20 90,18 126,16"/><text x="66" y="84" class="lb2" text-anchor="middle">a few big wins</text></g>
    <g transform="translate(268,0)"><polyline class="ln" points="6,30 40,16 60,18 80,52 105,60 126,64"/><text x="66" y="84" class="lb2" text-anchor="middle">peak, then fall</text></g></svg>`;

  const K = {
    'Net P&L'(s) {
      const gw = s.avgW * s.nWin, gl = Math.abs(s.avgL * s.nLoss), share = s.best > 0 && s.net > 0 ? s.best / s.net : null;
      return head('Net P&L', s.net > 0 ? 'the book is profitable after costs' : s.net < 0 ? 'the book loses money after costs' : 'break-even', s.net > 0 ? 'ok' : s.net < 0 ? 'bad' : '') + val('Your net result', usd(s.net, true), cl(s.net), `${s.n} closed trades, after commission`)
        + sec('How it adds up', bars([{ l: 'Profit of winners', v: gw, tone: 'up', t: usd(gw) }, { l: 'Loss of losers', v: gl, tone: 'dn', t: '−' + usd(gl) }, { l: 'Net', v: Math.abs(s.net), tone: s.net >= 0 ? 'up' : 'dn', t: usd(s.net, true) }]) + p('Gross profit minus gross loss. Commission and swap are already inside each trade.'))
        + sec('How to read it', p('It is the <b>result</b>, not the <b>quality</b>. Two traders with the same Net P&L can have very different risk: one with a smooth curve, one living off a single trade. Read it with the drawdown and the trade count.')
          + (share != null && share > .3 ? warn(`Your best trade is <b>${pc(share)}</b> of the whole result. Without it the book would be at ${usd(s.net - s.best, true)}.`) : ''))
        + use('Judge a period by Net P&L only after you check that the profit does not come from one or two trades (see Best / worst).');
    },
    'Trades'(s) {
      const n = s.n, band = n < 10 ? 'Too few to say anything' : n < 30 ? 'Early signal' : n < 100 ? 'Usable' : 'Solid';
      return head('Trades', band, n < 10 ? 'bad' : n < 30 ? 'warn' : 'ok') + val('Closed trades', String(n), '', 'a position closed in parts counts once')
        + sec('How much data is enough', scale([{ w: 10, label: '<10', tone: 'bad' }, { w: 20, label: '10–30', tone: 'warn' }, { w: 70, label: '30–100', tone: 'mid' }, { w: 100, label: '100+', tone: 'ok' }], 0, 200, Math.min(n, 200), v => v + (n > 200 ? '+' : '')))
        + sec('Why it matters', p('Every figure on this page is an average of these trades. With few trades, <b>luck dominates</b>: a 60% win rate on 10 trades can easily be a 35% trader on a good week. The intervals shown on win rate shrink as this number grows.')
          + tbl([{ c: ['Under 10', 'Nothing is reliable'], on: n < 10 }, { c: ['10 to 30', 'Hints, not conclusions'], on: n >= 10 && n < 30 }, { c: ['30 to 100', 'Habits become visible'], on: n >= 30 && n < 100 }, { c: ['100 and more', 'Statistics start to hold'], on: n >= 100 }]))
        + use('Do not change your method on the strength of a figure built on under 30 trades. Keep collecting and read the intervals.');
    },
    'Win rate'(s) {
      const n = s.n, w = s.nWin, ci = wilson(w, n), be = s.avgW + Math.abs(s.avgL) ? Math.abs(s.avgL) / (s.avgW + Math.abs(s.avgL)) : null;
      const wr0 = w / n, wtone = be == null ? '' : wr0 - be >= .05 ? 'ok' : wr0 >= be ? 'warn' : 'bad';
      return head('Win rate', be != null ? `${pc(wr0)} against ${pc(be)} needed to break even` : '', wtone) + val('Trades closed in profit', `${pc(w / n)}`, '', `${w} of ${n}`)
        + sec('How sure is that number?', ciSvg(w, n) + p(`With ${n} trades the true rate lies, with 95% confidence, between <b>${pc(ci.lo)}</b> and <b>${pc(ci.hi)}</b>. The wider the bar, the less the number says.`))
        + sec('The win rate alone means nothing', p('What counts is how it combines with the size of wins and losses.')
          + (be != null ? tbl([{ c: ['Average win', usd(s.avgW)] }, { c: ['Average loss', usd(Math.abs(s.avgL))] }, { c: ['Win rate needed to break even', `<b>${pc(be)}</b>`] }, { c: ['Your win rate', `<b>${pc(w / n)}</b>`], on: true }]) : ''))
        + (be != null ? ex(`With wins of ${usd(s.avgW)} and losses of ${usd(Math.abs(s.avgL))} you break even at ${pc(be)}. ${w / n >= be ? 'You are above it: the habit pays.' : 'You are below it: the habit loses.'}`) : '')
        + use('Compare your win rate to the break-even rate above, not to 50%. A scalper needs a high one; a trend follower can live with 35%.');
    },
    'Profit factor'(s) {
      const gw = s.avgW * s.nWin, gl = Math.abs(s.avgL * s.nLoss), pf = gl ? gw / gl : Infinity, ok = isFinite(pf);
      const tone = !ok ? 'ok' : pf < 1 ? 'bad' : pf < 1.3 ? 'warn' : 'ok';
      return head('Profit factor', !ok ? 'no losses yet' : pf < 1 ? 'Losing' : pf < 1.3 ? 'Thin edge' : pf < 2 ? 'Solid' : 'Strong', tone) + val('Gross profit ÷ gross loss', ok ? pf.toFixed(2) : '∞', tone === 'bad' ? 'dn' : tone === 'ok' ? 'up' : '')
        + sec('Where it comes from', bars([{ l: 'Gross profit', v: gw, tone: 'up', t: usd(gw) }, { l: 'Gross loss', v: gl, tone: 'dn', t: usd(gl) }]) + p(`${usd(gw)} ÷ ${usd(gl)} = <b>${ok ? pf.toFixed(2) : '∞'}</b>. For every dollar you lose, you make ${ok ? '$' + pf.toFixed(2) : 'more'}.`))
        + sec('Scale', (ok ? scale([{ w: 1, label: '&lt;1 losing', tone: 'bad' }, { w: .3, label: '1–1.3', tone: 'warn' }, { w: .7, label: '1.3–2', tone: 'mid' }, { w: 1, label: '2+', tone: 'ok' }], 0, 3, Math.min(pf, 3), v => v.toFixed(2)) : '')
          + tbl([{ c: ['Below 1.0', 'The book loses money'], on: ok && pf < 1 }, { c: ['1.0 to 1.3', 'Thin: costs or slippage can erase it'], on: ok && pf >= 1 && pf < 1.3 }, { c: ['1.3 to 2.0', 'Solid, a real edge is plausible'], on: ok && pf >= 1.3 && pf < 2 }, { c: ['Above 2.0', 'Strong, but check the sample size'], on: !ok || pf >= 2 }]))
        + warn('A very high factor on few trades is almost always luck. Check it against the trade count.');
    },
    'Avg win'(s) {
      const pay = s.avgL ? s.avgW / Math.abs(s.avgL) : null;
      return head('Average win', pay ? `${pay.toFixed(1)}× the average loss` : '', !pay ? '' : pay >= 1.5 ? 'ok' : pay >= 1 ? 'warn' : 'bad') + val('Mean profit of a winner', usd(s.avgW, true), 'up', `${s.nWin} winning trades`)
        + sec('Against the average loss', bars([{ l: 'Average win', v: s.avgW, tone: 'up', t: usd(s.avgW) }, { l: 'Average loss', v: Math.abs(s.avgL), tone: 'dn', t: usd(Math.abs(s.avgL)) }]) + (pay ? p(`The payoff ratio is <b>${pay.toFixed(2)}</b>: each win is worth ${pay.toFixed(2)} losses.`) : ''))
        + sec('How to read it', p('Alone it says little: a high average win with a 20% win rate is a different business than the same figure at 70%. Read it together with the win rate (Expectancy puts them together).'))
        + use('If it is small next to the average loss, look at where you take profit: closing winners early is the common cause.');
    },
    'Avg loss'(s) {
      const pay = s.avgL ? s.avgW / Math.abs(s.avgL) : null, be = s.avgW + Math.abs(s.avgL) ? Math.abs(s.avgL) / (s.avgW + Math.abs(s.avgL)) : null;
      return head('Average loss', pay ? `the average win is ${pay.toFixed(1)}× the average loss` : '', !pay ? '' : pay >= 1.5 ? 'ok' : pay >= 1 ? 'warn' : 'bad') + val('Mean loss of a loser', usd(s.avgL, true), 'dn', `${s.nLoss} losing trades`)
        + sec('Against the average win', bars([{ l: 'Average win', v: s.avgW, tone: 'up', t: usd(s.avgW) }, { l: 'Average loss', v: Math.abs(s.avgL), tone: 'dn', t: usd(Math.abs(s.avgL)) }]))
        + (be != null ? sec('What it asks of your win rate', p(`With these two figures you need to win at least <b>${pc(be)}</b> of trades to break even. You win <b>${pc(s.nWin / s.n)}</b>.`)) : '')
        + use('A loss far above the one you planned means stops that are too wide, moved or missing. Compare it to the risk you set at entry.')
        + warn('If the average loss is larger than the average win, you need a win rate above 50% just to stay level.');
    },
    'Expectancy'(s) {
      const wr = s.nWin / s.n, lr = 1 - wr, a = wr * s.avgW, b = lr * Math.abs(s.avgL);
      return head('Expectancy', s.exp > 0 ? 'Positive' : 'Negative', s.exp > 0 ? 'ok' : 'bad') + val('Average result per trade', usd(s.exp, true), cl(s.exp), 'what one more trade is worth, on average')
        + sec('The formula, with your figures', tbl([{ c: ['Win rate × average win', `${pc(wr)} × ${usd(s.avgW)}`, `<b class="up">${usd(a, true)}</b>`] }, { c: ['Loss rate × average loss', `${pc(lr)} × ${usd(Math.abs(s.avgL))}`, `<b class="dn">−${usd(b)}</b>`] }, { c: ['Expectancy', '', `<b class="${cl(s.exp)}">${usd(s.exp, true)}</b>`], on: true }]))
        + sec('How to read it', p(`If you took ${s.n} more trades like these, you would expect about <b class="${cl(s.exp * s.n)}">${usd(s.exp * s.n, true)}</b>. It is the one number that says whether the habit, as a whole, pays.`)
          + p(`Next to the average loss (${usd(Math.abs(s.avgL))}) it is <b>${s.avgL ? pc(s.exp / Math.abs(s.avgL)) : '—'}</b>: the margin you have per trade, in units of a typical loss.`))
        + use('Track it over time. If it falls while the win rate holds, your wins are getting smaller or your losses larger.');
    },
    'Avg R'(s) {
      const r = s.avgR, n = s.rN, tone = r == null ? '' : r >= .3 ? 'ok' : r > 0 ? 'warn' : 'bad';
      return head('Average R', r == null ? '' : r >= .3 ? 'Healthy' : r > 0 ? 'Marginal' : 'Negative', tone) + val('Mean result in R', r == null ? '—' : sgn(r, 2) + 'R', cl(r), `${n} of ${s.n} trades had a stop`)
        + sec('What R is', p('<b>1R</b> is the money you risked when the trade opened: the distance from entry to your stop, times the size.') + tbl([{ c: ['+2R', 'you made twice what you risked'] }, { c: ['0R', 'break-even'] }, { c: ['−1R', 'the stop was hit, the planned loss'] }, { c: ['below −1R', 'a slip, or the stop was moved or missing'] }]))
        + sec('Scale (per trade)', r == null ? '' : scale([{ w: 1, label: '&lt;0', tone: 'bad' }, { w: .3, label: '0–0.3', tone: 'warn' }, { w: .7, label: '0.3–1', tone: 'mid' }, { w: 1, label: '1+', tone: 'ok' }], -1, 2, Math.max(-1, Math.min(2, r)), v => sgn(v, 2) + 'R'))
        + sec('Coverage', bars([{ l: 'With a stop', v: n, tone: 'mid', t: String(n) }, { l: 'Without', v: s.n - n, tone: 'warn', t: String(s.n - n) }]) + p('Trades without a stop have no R, so they are left out here. The other figures on the page use every trade, which is why they can disagree.'))
        + use('R makes trades of different sizes comparable. Above +0.3R per trade over 100+ trades is a good book.');
    },
    'Max drawdown'(s) {
      const d = s.mdd, tone = d < 10 ? 'ok' : d < 20 ? 'warn' : 'bad';
      return head('Maximum drawdown', d < 10 ? 'Contained' : d < 20 ? 'Notable' : 'Heavy', tone) + val('Deepest fall from a peak', pct(-d, 2), 'dn', 'over the closed trades')
        + sec('Your curve, the worst fall marked', ddSvg(s) + p('From the highest balance to the lowest point that followed, as a share of that peak.'))
        + sec('Scale', scale([{ w: 10, label: '&lt;10%', tone: 'ok' }, { w: 10, label: '10–20%', tone: 'warn' }, { w: 30, label: '20%+', tone: 'bad' }], 0, 50, Math.min(d, 50), v => v.toFixed(1) + '%'))
        + sec('Climbing back', tbl([{ c: ['Fall of 10%', 'needs +11% to recover'] }, { c: ['Fall of 20%', 'needs +25%'] }, { c: ['Fall of 33%', 'needs +50%'] }, { c: ['Fall of 50%', 'needs +100%'] }]))
        + warn('It counts closed trades only: a loss still open is not in it. A future drawdown can be deeper than this one.')
        + use('Choose your size so that a fall at least twice as deep as this one is still bearable.');
    },
    'Best / worst'(s) {
      const share = s.best > 0 && s.net > 0 ? s.best / s.net : null, avgL = Math.abs(s.avgL);
      const wr5 = avgL ? Math.abs(s.worst) / avgL : 0, bt = (share != null && share > .5) || wr5 > 5 ? 'bad' : (share != null && share > .3) || wr5 > 3 ? 'warn' : 'ok';
      return head('Best / worst trade', bt === 'ok' ? 'the result does not hang on one trade' : share != null && share > .3 ? `best win is ${pc(share)} of the net` : `worst loss is ${wr5.toFixed(1)}× the average loss`, bt) + val('Largest win · largest loss', `<span class="up">${usd(s.best, true)}</span> · <span class="dn">${usd(s.worst, true)}</span>`)
        + sec('Against the average', bars([{ l: 'Best win', v: s.best, tone: 'up', t: usd(s.best) }, { l: 'Average win', v: s.avgW, tone: 'up', t: usd(s.avgW) }, { l: 'Average loss', v: avgL, tone: 'dn', t: usd(avgL) }, { l: 'Worst loss', v: Math.abs(s.worst), tone: 'dn', t: usd(Math.abs(s.worst)) }]))
        + sec('How to read it', tbl([{ c: ['Best win ÷ Net P&L', share != null ? `<b>${pc(share)}</b>` : '—'], on: share != null && share > .3 }, { c: ['Worst loss ÷ average loss', avgL ? `<b>${(Math.abs(s.worst) / avgL).toFixed(1)}×</b>` : '—'] }, { c: ['Net without the best trade', `<b class="${cl(s.net - s.best)}">${usd(s.net - s.best, true)}</b>`] }]))
        + use('A worst loss several times the average loss means a stop was missing or moved. Open that trade in Trade notes and write down why.');
    }
  };

  // one plain sentence per figure, with the trader's own numbers
  const PL = {
    'Net P&L': s => `Over ${s.n} closed trades you ${s.net >= 0 ? 'made' : 'lost'} <b>${usd(Math.abs(s.net))}</b> in total, after paying commission. ${s.net >= 0 ? 'The account is ahead of where it started.' : 'The account is behind where it started.'}`,
    'Trades': s => `You have closed <b>${s.n}</b> trades. ${s.n < 30 ? 'That is still a small sample, so most figures here can be chance.' : s.n < 100 ? 'That is enough to see habits, not yet enough to be sure of them.' : 'That is a solid base: the figures on this page can be trusted much more.'}`,
    'Win rate': s => `<b>${s.nWin}</b> of your <b>${s.n}</b> trades ended in profit. That alone does not say whether you are efficient: what matters is how it compares to the rate you need to break even, shown below.`,
    'Profit factor': s => { const gl = Math.abs(s.avgL * s.nLoss), pf = gl ? s.avgW * s.nWin / gl : Infinity; return `For every <b>$1</b> you lose, you make <b>${isFinite(pf) ? '$' + pf.toFixed(2) : 'more than you lose'}</b>. ${pf >= 1.3 ? 'That is a healthy margin.' : pf >= 1 ? 'That is a thin margin: costs or a bad week can erase it.' : 'That means the book loses money.'}`; },
    'Avg win': s => `When a trade wins, it brings in <b>${usd(s.avgW)}</b> on average. A winner is worth <b>${s.avgL ? (s.avgW / Math.abs(s.avgL)).toFixed(2) : '—'}</b> average losses.`,
    'Avg loss': s => `When a trade loses, it costs <b>${usd(Math.abs(s.avgL))}</b> on average. ${s.avgW >= Math.abs(s.avgL) ? 'Your losses are smaller than your wins: good, that lets you be wrong often.' : 'Your losses are bigger than your wins: you must win most trades to stay level.'}`,
    'Expectancy': s => `Each new trade like these is worth <b>${usd(s.exp, true)}</b> on average. ${s.exp > 0 ? 'The habit, taken as a whole, makes money.' : 'The habit, taken as a whole, loses money.'}`,
    'Avg R': s => s.avgR == null ? '' : `On trades with a stop, you earn <b>${sgn(s.avgR, 2)}R</b> per trade on average: ${s.avgR >= .3 ? 'a healthy return for the risk taken.' : s.avgR > 0 ? 'a small return for the risk taken.' : 'you lose more than you risk, on average.'}`,
    'Max drawdown': s => `At its worst, your balance fell <b>${s.mdd.toFixed(1)}%</b> from a peak before recovering. ${s.mdd < 10 ? 'That is a contained fall.' : s.mdd < 20 ? 'That is a fall many traders find hard to sit through.' : 'That is a deep fall: it takes a long time to win back.'}`,
    'Best / worst': s => `Your best trade made <b>${usd(s.best)}</b> and your worst lost <b>${usd(Math.abs(s.worst))}</b>. ${s.best > 0 && s.net > 0 && s.best / s.net > .3 ? 'A large part of your result comes from that one winner.' : 'No single trade dominates the result.'}`
  };
  const T = {
    equity() {
      const s = stat(), c = s.curve, up = c.length > 1 && c[c.length - 1] > c[0], tn = !up ? 'bad' : s.mdd < 10 ? 'ok' : 'warn';
      return head('Equity curve', up ? `ends above the start · worst fall ${s.mdd.toFixed(1)}%` : 'ends below the start', tn) + sec('What it shows', p('The balance after each closed trade, from the start (dashed line) to now. Move across it to read the balance after any trade.'))
        + sec('Three shapes', shapesSvg() + tbl([{ c: ['Steady slope', 'consistency: the habit repeats'] }, { c: ['Long flat, then jumps', 'the result rides on a few trades'] }, { c: ['Peak, then a long fall', 'drawdown: check what changed after the peak'] }]))
        + use('Look for the point where the slope changes, then open the trades around it in Trade notes.');
    },
    coach() {
      const bad = (typeof coachInsights === 'function' ? coachInsights() : []).filter(i => i.tone === 'bad').length;
      return head('Coach', bad ? `${bad} habit${bad > 1 ? 's' : ''} flagged as costly` : 'no costly habit flagged', bad >= 2 ? 'bad' : bad ? 'warn' : 'ok') + sec('What it does', p('Reads your closed trades and points at habits: what costs you, what works. Each line is the short form.'))
        + sec('Marks', tbl([{ c: ['<span class="rt-dot bad"></span>', 'a habit that costs you'] }, { c: ['<span class="rt-dot ok"></span>', 'a habit that helps'] }, { c: ['<span class="rt-dot"></span>', 'information'] }, { c: ['‡', 'small sample: may be chance'] }]))
        + use('Take the first line, turn it into a rule, and check next week whether it moved. Details opens every insight and the tables behind them.');
    },
    notes() {
      const tr = tradesOf(S.history), tg = tr.filter(x => (x.note || '').trim()).length, sh = tr.length ? tg / tr.length : 0;
      return head('Trade notes', `${tg} of ${tr.length} trades have a note`, !tr.length ? '' : sh >= .7 ? 'ok' : sh < .3 ? 'bad' : 'warn') + sec('What it is', p('Every closed trade with your note. What you write stays on the trade.'))
        + use('Write a line on every loss: what you saw, what you would change. Use the filters to look at one kind of trade at a time.');
    }
  };
  const F = {
    all: ['All trades', 'Every closed trade, newest first.', ''],
    loss: ['Losses', 'Trades that closed at zero or below, net of commission.', 'Read these first: what repeats? Same pair, same hour, same size after a loss?'],
    nostop: ['No stop', 'Trades opened without a stop loss. They have no R and an unbounded risk.', 'They are left out of Average R. Set a stop before you enter.'],
    reentry: ['After a loss', 'Trades opened within the revenge window after a losing trade closed.', 'A habit of quick re-entries is how revenge trading starts. Check their win rate in Coach › Details.']
  };
  const filt = k => { const f = F[k]; if (!f) return null; const s = stat(), n = s.n, tr = s.trades;
    const cnt = { all: n, loss: tr.filter(x => x.net <= 0).length, nostop: tr.filter(x => x.r == null).length, reentry: tr.filter(x => { const y = tr; return y.some(z => z !== x && z.net < 0 && z.close <= x.open && x.open - z.close < REVENGE_MIN * 60); }).length }[k], sh = n ? cnt / n : 0;
    const tn = { all: '', loss: '', nostop: cnt === 0 ? 'ok' : sh > .1 ? 'bad' : 'warn', reentry: sh < .1 ? 'ok' : sh > .2 ? 'bad' : 'warn' }[k];
    const chip = k === 'all' ? `${n} closed trades` : `${cnt} of ${n} trades · ${pc(sh)}`;
    return head(f[0], chip, tn) + val('Trades in this filter', String(cnt), '', n ? `${pc(sh)} of all trades` : '') + sec('What it shows', p(f[1])) + (f[2] ? use(f[2]) : ''); };

  // ---- more cards: Statistics overview, Coach lines, one trade, a pair, a side, the Details cells and a glossary of column heads ----
  const trs = () => tradesOf(S.history).map(x => { const y = { ...x, pnl: x.net }; y.rows = x.rows; return y; }); // rows is not enumerable: carried over by hand
  const nsum = a => a.reduce((t, x) => t + x.pnl, 0), nwin = a => a.filter(x => x.pnl > 0).length, wrp = a => a.length ? nwin(a) / a.length : 0;
  const revSet = h => { const cl = [...h].sort((x, y) => x.close - y.close); return new Set(h.filter(x => cl.some(y => y !== x && y.pnl < 0 && y.close <= x.open && x.open - y.close < REVENGE_MIN * 60))); };
  const fmH = m => m >= 1440 ? (m / 1440).toFixed(1) + 'd' : m >= 60 ? (m / 60).toFixed(1) + 'h' : Math.max(0, Math.round(m)) + 'm';
  const IM = [
    [/^Suggested rule/, 'A kind of entry (a warning that was active) that has gone with worse results for you than trades without it.', 'Make it a rule: before such a trade, stop and write the pre-mortem (what would make this fail?).'],
    [/^Costliest warning/, 'Among the situations the app warns about, this is the one that has cost you the most money so far.', 'Fix this one first: it is where the biggest gain from changing a habit sits.'],
    [/^Disposition effect/, 'You realise gains faster than losses: winners are closed early, losers are kept open hoping.', 'Let stops close the losers and give winners room: set the exit before you enter.'],
    [/^Best pair/, 'The instrument where your results are best so far.', 'Do not read it as a recommendation until it has 30+ trades. If it holds, concentrate size there.'],
    [/^Weakest pair/, 'The instrument where you lose the most so far.', 'Check spread, size and the hours you trade it before blaming the pair; if it persists, drop it.'],
    [/hold losers/, 'Losing trades stay open longer than winning ones: the classic sign of loss aversion.', 'Let the stop do its job and write down why you moved or removed one.'],
    [/let winners run/i, 'Winners stay open longer than losers: you cut losses fast and let profit run.', 'Keep doing it; it is the pattern most profitable traders share.'],
    [/Average loss/, 'Your average loss is much larger than your average win, so you need an unusually high win rate to stay level.', 'Tighten stops, or take profit later. Compare the average loss with the risk you planned.'],
    [/of longs|of shorts/, 'Your results differ between buying and selling.', 'Treat it as a hint if each side has under 30 trades. If it holds, trade the stronger side more.'],
    [/no stop loss/, 'Some trades were opened without a stop loss: their loss is unbounded and they have no R.', 'Set a stop before every entry. If you cannot place one, the size is too large.'],
    [/within \d+ minutes of a loss/, 'You re-enter very quickly after a losing trade. That is how revenge trading starts.', 'After a loss, take a break (10+ minutes) and re-read the plan before the next trade.'],
    [/^Best session/, 'The part of the day (by open time, UTC) where you do best.', 'Consider concentrating there, after checking that each session has 30+ trades.'],
  ];
  const ciCard = n => {
    const list = typeof coachInsights === 'function' ? coachInsights() : [], it = list[+n]; if (!it) return null;
    const plain = it.t.replace(/<[^>]+>/g, ''), m = IM.find(x => x[0].test(plain)), few = /may be chance/.test(plain), tone = it.tone === 'bad' ? 'bad' : it.tone === 'good' ? 'ok' : /^Best /.test(plain) ? (few ? 'warn' : 'ok') : /^Weakest|no stop loss/.test(plain) ? 'warn' : few ? 'warn' : '';
    return head('Coach insight', tone === 'bad' ? 'a habit that costs you' : tone === 'ok' ? 'something that works for you' : few ? 'small sample: may be chance' : tone === 'warn' ? 'a weak spot to look at' : 'information', tone)
      + `<div class="rt-plain"><b>What the Coach says</b>${it.t.replace(/<b>/g, '<b>')}</div>`
      + sec('What it means', p(m ? m[1] : 'A pattern the Coach found in your closed trades.'))
      + sec('How sure is it?', few ? p('The group behind this line has fewer than 30 trades, so it can easily be chance. Collect more trades before acting on it.') : p('The group has enough trades for the pattern to be taken seriously. Look at the intervals in Details to see how wide the uncertainty still is.'))
      + (m ? use(m[2]) : '') + warn('The Coach describes the past. It does not predict the next trade.');
  };
  const tradeCard = i => {
    const h = trs(), x = h.find(t => S.history.indexOf(t.rows[t.rows.length - 1]) === +i); if (!x) return null;
    const rv = revSet(h).has(x), noSL = x.r == null, fl0 = (x.ctx || []).map(k => (typeof FLAG_NAMES === 'object' && FLAG_NAMES[k]) || k), flags = [...fl0, noSL && !fl0.some(f => /no stop/i.test(f)) ? 'No stop loss' : '', rv && !fl0.some(f => /min of a loss/i.test(f)) ? `Opened within ${REVENGE_MIN} min of a loss` : ''].filter((v, k, a) => v && a.indexOf(v) === k);
    const win = x.net > 0, tone = win ? (flags.length ? 'warn' : 'ok') : (noSL || (x.r != null && x.r < -1.5) ? 'bad' : flags.length ? 'warn' : '');
    const pz = typeof pretty === 'function' ? pretty(x.sym) : x.sym, dt = t => new Date(t * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC', fp2 = typeof fp === 'function' ? fp : (a, v) => v;
    return head(`${x.side === 'buy' ? 'Buy' : 'Sell'} ${x.lots.toFixed(2)} ${pz}`, win ? (flags.length ? 'won, but with warnings' : 'a clean win') : (tone === 'bad' ? 'a loss that went beyond the plan' : 'a loss within the plan'), tone)
      + val('Net result', usd(x.net, true), cl(x.net), x.r == null ? 'no stop, so no R' : `${sgn(x.r, 2)}R`)
      + `<div class="rt-plain"><b>In plain words</b>You ${x.side === 'buy' ? 'bought' : 'sold'} ${pz} and it ${win ? 'made' : 'lost'} <b>${usd(Math.abs(x.net))}</b> after commission, ${fmH((x.close - x.open) / 60)} later${x.reason ? `, closed by <b>${esc(x.reason)}</b>` : ''}.${x.r != null ? ` That is <b>${sgn(x.r, 2)}R</b>: ${x.r >= 0 ? 'a return of ' + x.r.toFixed(2) + ' times the money risked.' : x.r >= -1.1 ? 'about the loss you planned.' : 'more than you planned to lose.'}` : ' Without a stop the risk was open-ended.'}</div>`
      + sec('The trade', tbl([{ c: ['Entry → exit', `${fp2(x.sym, x.entry)} → ${fp2(x.sym, x.exit)}`] }, { c: ['Pips / points', `<b class="${cl(x.pips)}">${sgn(+x.pips, 1)}</b>`] }, { c: ['R multiple', x.r == null ? '—' : `<b>${sgn(x.r, 2)}R</b>`] }, { c: ['Held', fmH((x.close - x.open) / 60)] }, { c: ['Commission', usd(x.comm || 0)] }, { c: ['Closed', dt(x.close)] }]))
      + sec('Warnings at entry', flags.length ? tbl(flags.map(f => ({ c: [esc(f)], on: true }))) + p('Trades with warnings are tracked in Behaviour: check whether they perform worse than clean ones.') : p('None: this trade was taken with no warning active. Clean entries are the baseline to compare the others against.'))
      + sec('Your note', tbl([{ c: ['Note', esc(x.note || '—')] }]))
      + use(win ? 'Write in the note what made it work, so you can repeat it on purpose.' : 'Write in the note what you would change. If the stop was moved or missing, say so: that is the lesson.');
  };
  const pairCard = sym => {
    const h = trs(), g = h.filter(x => x.sym === sym); if (!g.length) return null; const n = g.length, net = nsum(g), w = wrp(g), all = wrp(h), tone = n < 10 ? '' : net > 0 && w >= all - .02 ? 'ok' : net < 0 ? 'bad' : 'warn', pz = typeof pretty === 'function' ? pretty(sym) : sym;
    return head(pz, `${n} trades · ${n < 30 ? 'small sample' : 'enough trades'}`, tone) + val('Net on this instrument', usd(net, true), cl(net), `${n} closed trades`)
      + `<div class="rt-plain"><b>In plain words</b>On ${esc(pz)} you made <b>${usd(net, true)}</b> over <b>${n}</b> trades, winning <b>${pc(w)}</b> of them (all trades: ${pc(all)}).${n < 30 ? ' With so few trades it may be chance.' : ''}</div>`
      + sec('Against all trades', tbl([{ c: ['', 'This pair', 'All'] }, { c: ['Win rate', pc(w), pc(all)] }, { c: ['Average per trade', usd(net / n, true), usd(nsum(h) / h.length, true)] }, { c: ['Trades', String(n), String(h.length)] }]))
      + use(n < 30 ? 'Keep it in the mix; judge it after 30 trades.' : net > 0 ? 'A pair that works for you: it can carry more size, with the same stop discipline.' : 'A pair that costs you: check spread, hours and size before the next trade, or drop it.');
  };
  const sideCard = side => {
    const h = trs(), g = h.filter(x => x.side === side), o = h.filter(x => x.side !== side), n = g.length; if (!n) return null; const w = wrp(g), wo = wrp(o), tone = n < 10 ? '' : nsum(g) > 0 && w >= wo ? 'ok' : nsum(g) < 0 ? 'bad' : 'warn', nm = side === 'buy' ? 'Buy (long)' : 'Sell (short)';
    return head(nm, `${n} trades`, tone) + val('Net on ' + (side === 'buy' ? 'longs' : 'shorts'), usd(nsum(g), true), cl(nsum(g)), `${n} trades · win rate ${pc(w)}`)
      + sec('Longs against shorts', tbl([{ c: ['', 'Buy', 'Sell'] }, { c: ['Trades', String(h.filter(x => x.side === 'buy').length), String(h.filter(x => x.side === 'sell').length)] }, { c: ['Net', usd(nsum(h.filter(x => x.side === 'buy')), true), usd(nsum(h.filter(x => x.side === 'sell')), true)] }, { c: ['Win rate', pc(wrp(h.filter(x => x.side === 'buy'))), pc(wrp(h.filter(x => x.side === 'sell')))] }]))
      + use('A clear gap between the two sides, over 30+ trades each, is worth acting on: trade the stronger side with more size.');
  };
  const GL = {
    'Symbol': ['The instrument traded. A trade closed in several parts shows once, with the number of parts.', 'Hover the symbol for your results on that instrument.'],
    'Side': ['Buy (long) profits when the price rises; Sell (short) when it falls.', 'Compare your results on the two sides in the card of each tag.'],
    'P&L': ['The result of the trade after commission. Click a value for the full story of that trade.', 'Look at the biggest losses first.'],
    'Note': ['Your own words: what you saw, what you would change. Saved on the trade.', 'Write at least a line on every loss.'],
    'Closed': ['When the trade closed, UTC.', 'Sort by time to see whether results change after a certain date.'],
    'Trade': ['Side, size and instrument, with the number of warnings that applied at entry.', 'Hover a warning count in the table to see which.'],
    'Entry → exit': ['The average entry price and the average exit price (for a trade closed in parts).', 'Compare with your planned stop and target.'],
    'Pips / pt': ['Distance gained or lost: pips on FX pairs, points on other instruments.', 'Useful to compare trades of different sizes.'],
    'R': ['The result as a multiple of the money you risked at the stop. +2R means you made twice the risk; −1R is the planned loss.', 'Without a stop there is no R: shown as —.'],
    'Hold': ['How long the trade stayed open.', 'Losers held much longer than winners is loss aversion.'],
    'Exit': ['How the trade ended: by hand, stop loss, take profit, trailing stop, time stop or stop-out.', 'Many manual exits on losers can mean a stop was cancelled.'],
    'Net': ['The result of the group after commission.', 'Read with the trade count next to it.'],
    'Win rate': ['The share of the group that closed in profit.', 'Compare with the break-even rate, not 50%.'],
    'Trades': ['Number of closed trades in the group.', 'Under 30 trades: treat the figures as hints.'],
    '95% interval': ['The range where the true win rate plausibly lies. Computed with the Wilson method.', 'A wide interval means the sample is too small to conclude.'],
    'Avg': ['The average result per trade in the group.', 'Positive means the group pays on average.']
  };
  const glCard = k => { const g = GL[k]; if (!g) return null; return head(k, 'a column of the table', '') + sec('What it is', p(g[0])) + use(g[1]); };
  const detCard = k => {
    const s = stat(), h = trs();
    if (K[k] && ['Trades', 'Win rate', 'Avg win', 'Avg loss'].includes(k)) return K[k](s) && wrapK(k, s);
    if (k === 'Net') return wrapK('Net P&L', s);
    const W = h.filter(x => x.pnl > 0 && x.complete), L = h.filter(x => x.pnl <= 0 && x.complete), av = a => a.length ? a.reduce((t, x) => t + (x.close - x.open), 0) / a.length / 60 : 0;
    if (k === 'Hold W / L') { const hw = av(W), hl = av(L), tn = !W.length || !L.length ? '' : hl > hw * 1.3 ? 'bad' : hw > hl * 1.3 ? 'ok' : 'warn';
      return head('Hold time: winners / losers', hl > hw * 1.3 ? 'losers are held longer' : hw > hl * 1.3 ? 'winners run longer' : 'about the same', tn) + val('Winners · Losers', `${fmH(hw)} · ${fmH(hl)}`, '', 'average time open, closed positions only')
        + sec('Compared', bars([{ l: 'Winners', v: hw, tone: 'up', t: fmH(hw) }, { l: 'Losers', v: hl, tone: 'dn', t: fmH(hl) }])) + sec('How to read it', p('Healthy: winners are held at least as long as losers. If losers stay open much longer, hope is replacing the stop.')) + use('Let stops close losers; give winners time.'); }
    if (k === 'No stop loss') { const ns = h.filter(x => x.r == null), sh = h.length ? ns.length / h.length : 0, tn = !ns.length ? 'ok' : sh > .1 ? 'bad' : 'warn';
      return head('Trades without a stop loss', ns.length ? `${ns.length} of ${h.length} · ${pc(sh)}` : 'none', tn) + val('Trades with no stop', String(ns.length), ns.length ? 'dn' : 'up', `net ${usd(nsum(ns), true)}`)
        + sec('Why it matters', p('A trade without a stop has an unbounded loss and no R. One of these can wipe out many good trades.')) + use('Set a stop before every entry. If the stop makes the size too large, reduce the size, not the stop.'); }
    if (k === 'Re-entries') { const rv = [...revSet(h)], sh = h.length ? rv.length / h.length : 0, tn = sh < .1 ? 'ok' : sh > .2 ? 'bad' : 'warn';
      return head(`Re-entries within ${REVENGE_MIN} min of a loss`, `${rv.length} of ${h.length} · ${pc(sh)}`, tn) + val('Quick re-entries', String(rv.length), '', rv.length ? `win rate ${pc(wrp(rv))} · net ${usd(nsum(rv), true)}` : '')
        + sec('Against all trades', tbl([{ c: ['', 'Re-entries', 'All'] }, { c: ['Win rate', rv.length ? pc(wrp(rv)) : '—', pc(wrp(h))] }, { c: ['Average', rv.length ? usd(nsum(rv) / rv.length, true) : '—', usd(nsum(h) / Math.max(1, h.length), true)] }]))
        + sec('How to read it', p('If quick re-entries win less than your other trades, they are emotional. This is the signature of revenge trading.')) + use('After a loss, take 10+ minutes before the next trade.'); }
    return null;
  };
  const wrapK = (k, s) => { let h = K[k](s); const t = PL[k] && PL[k](s); if (t) h = h.replace(/(<div class="rt-val">[\s\S]*?<\/span><\/div>|<div class="rt-val">[\s\S]*?<\/strong><\/div>)/, m => m + `<div class="rt-plain"><b>In plain words</b>${t}</div>`); return h; };
  const groupCard = key => {
    const [g, lab] = [key.slice(0, key.indexOf('|')), key.slice(key.indexOf('|') + 1)], h = trs();
    const f = { Pair: x => (typeof pretty === 'function' ? pretty(x.sym) : x.sym), Session: x => SESS_OF(x.open), Side: x => x.side === 'buy' ? 'Long' : 'Short' }[g]; if (!f) return null;
    const a = h.filter(x => f(x) === lab); if (!a.length) return null; const n = a.length, net = nsum(a), w = wrp(a), ci = wilson(nwin(a), n), all = wrp(h), tone = n < 10 ? '' : net > 0 && w >= all - .02 ? 'ok' : net < 0 ? 'bad' : 'warn';
    return head(`${g}: ${lab}`, `${n} trades${n < 30 ? ' · small sample' : ''}`, tone) + val('Net in this group', usd(net, true), cl(net), `${n} trades · win rate ${pc(w)}${ci ? ` (${pc(ci.lo)}–${pc(ci.hi)})` : ''}`)
      + sec('Against all trades', tbl([{ c: ['', 'This group', 'All'] }, { c: ['Win rate', pc(w), pc(all)] }, { c: ['Average per trade', usd(net / n, true), usd(nsum(h) / h.length, true)] }]))
      + sec('How sure is it?', p(n < 30 ? 'Under 30 trades: this may be chance. Wait for more trades.' : 'Enough trades for the gap to mean something. The interval shows the remaining uncertainty.')) + use(net > 0 ? 'A group that pays: give it more of your trades.' : 'A group that costs you: reduce it or fix what goes wrong in it.');
  };
  const statsCard = () => head('Statistics', '', '') + `<div class="rt-plain"><b>What this block is</b>Ten figures computed from every trade you closed, after commission. Together they say whether your trading is efficient. Click any figure for its own explanation.</div>`
    + sec('What good looks like', tbl([{ c: ['Net P&L', 'above zero'] }, { c: ['Win rate', 'above the break-even rate'] }, { c: ['Profit factor', 'above 1.3'] }, { c: ['Expectancy', 'above zero, growing'] }, { c: ['Avg R', 'above +0.3R'] }, { c: ['Max drawdown', 'under 10%'] }]))
    + sec('Read them together', p('One good figure proves little. A high win rate with a large average loss still loses. A high profit factor on 10 trades is luck. Start with <b>expectancy</b>, then check <b>drawdown</b> and the <b>trade count</b>.'))
    + use('Look at the verdict colour in each card: green is efficient, red costs you, yellow needs attention.');
  const btnCard = k => {
    if (k === 'details') { const n = tradesOf(S.history).length, ins = typeof coachInsights === 'function' ? coachInsights().length : 0;
      return head('Details', 'opens the full Coach', '') + `<div class="rt-plain"><b>What this button does</b>Opens the Coach on the whole window: all <b>${ins}</b> insights in full, the breakdown of your <b>${n}</b> trades by pair, session and side, and every trade with its note.</div>`
        + sec('Inside', tbl([{ c: ['Summary strip', 'trades, net, win rate, averages, hold time, no-stop count, re-entries'] }, { c: ['Insights', 'every Coach line, in full'] }, { c: ['Breakdown', 'results by pair, session and side, with intervals'] }, { c: ['Trades', 'every closed trade, with the note you can edit'] }]))
        + use('Open it after a few days of trading: look at the breakdown first, then at the trades behind the weakest group.'); }
    if (k === 'hints') { const on = !document.body.classList.contains('no-hints');
      return head('Hints', on ? 'explanations are on' : 'explanations are off', '') + `<div class="rt-plain"><b>What this switch does</b>Turns the explanations on or off for the whole app. When it is <b>${on ? 'on' : 'off'}</b>, ${on ? 'the pointer shows a yellow ? over any figure with an explanation, and a click opens it.' : 'figures behave as before, with no ? and no explanation.'}</div>`
        + sec('The two states', tbl([{ c: ['<b>?</b> on yellow', 'on: explanations available'], on: on }, { c: ['<b>?</b> on dark', 'off: plain interface'], on: !on }])) + use('Leave it on while you learn what each figure means, then turn it off for a quieter screen.'); }
    return null;
  };
  return { head, val, sec, scale, tbl, p, use, warn, ex, bars, K, T, PL, btnCard, filt, usd, esc, ciCard, tradeCard, pairCard, sideCard, glCard, detCard, groupCard, statsCard };
})();
// the card for a data-rich key: "kpi:<label>", "j:equity|coach|notes", "jf:<filter>", "ci:<insight text>", "x:<n>" (hint engine, hints-engine.js: every zone registered there)
function hintRich(key, el) {
  try {
    const [a, b] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]; let h = null;
    if (a === 'kpi') { const s = journalStats(); if (!s.n) h = HT.head(b, 'no closed trades yet', '') + '<div class="rt-plain"><b>In plain words</b>This figure is computed from the trades you have closed, after commission. It shows a dash until you close your first trade, and it becomes useful with a few dozen.</div>' + HT.use('Close a trade (or load the demo trades) and open this card again: it then shows your own figures, with a verdict.'); else if (s.n && HT.K[b]) { h = HT.K[b](s); const t = HT.PL[b] && HT.PL[b](s); if (t) h = h.replace(/(<div class="rt-val">[\s\S]*?<\/span><\/div>|<div class="rt-val">[\s\S]*?<\/strong><\/div>)/, m => m + `<div class="rt-plain"><b>In plain words</b>${t}</div>`); } }
    else if (a === 'j') h = b === 'stats' ? HT.statsCard() : HT.T[b] && HT.T[b]();
    else if (a === 'jf') h = HT.filt(b);
    else if (a === 'ci') h = HT.ciCard(b); else if (a === 'jt') h = HT.tradeCard(b); else if (a === 'jp') h = HT.pairCard(b); else if (a === 'js') h = HT.sideCard(b);
    else if (a === 'x') h = typeof HX === 'object' ? HX.cardFor(el) : null; // the hint engine (hints-engine.js): cards of every zone
    else if (a === 'cb') h = HT.btnCard(b); else if (a === 'gl') h = HT.glCard(b); else if (a === 'cd') h = HT.detCard(b); else if (a === 'cg') h = HT.groupCard(b);
    return h ? `<div class="rt">${h}</div>` : null;
  } catch (e) { return null; }
}

// ---- the pointer turns into a "?" over an element with a card (CSS cursor); a click opens the centred modal (front 15.11.2026) ----
(() => {
  let dlg = null, lastFocus = null;
  const off = () => document.body.classList.contains('no-hints');
  const target = e => { const el = e.target.closest && e.target.closest('[data-rich]'); return el && !el._go && !el.closest('#hintDlg,[data-hx-off]') && !off() && !(dlg && !dlg.hidden) ? el : null; };
  document.addEventListener('click', e => { const el = target(e); if (el && !(e.target.closest('button,input,select,a,[data-rich-tip],[role=button]') && e.target.closest('button,input,select,a,[data-rich-tip],[role=button]') !== el)) hintOpen(el.dataset.rich, el); });
  document.addEventListener('keydown', e => { if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('[data-rich]') && !e.target.closest('#hintDlg') && !off() && !/^(BUTTON|INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) { e.preventDefault(); hintOpen(e.target.dataset.rich, e.target); } });
  window.hintOpen = (key, el) => {
    const html = hintRich(key, el); if (!html) return; const t = document.getElementById('brTip'); if (t) t.style.display = 'none';
    if (!dlg) { dlg = document.createElement('div'); dlg.className = 'overlay'; dlg.id = 'hintDlg'; document.body.appendChild(dlg);
      dlg.addEventListener('click', e => { if (e.target === dlg || e.target.closest('[data-hx]')) hintClose(); });
      dlg.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); hintClose(); } }); }
    lastFocus = document.activeElement;
    dlg.innerHTML = `<div class="modal hint-modal" role="dialog" aria-modal="true" aria-label="Explanation"><button type="button" class="hint-x" data-hx aria-label="Close">Close</button><div class="hint-body">${html}</div></div>`;
    dlg.hidden = false; dlg.querySelector('[data-hx]').focus({ preventScroll: true });
  };
  window.hintClose = () => { if (dlg) dlg.hidden = true; if (lastFocus && lastFocus.focus) try { lastFocus.focus({ preventScroll: true }); } catch (e) {} };
})();
