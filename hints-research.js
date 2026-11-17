/* Hint cards: Research: correlation, volatility, calendar. Registered on the hint engine (hints-engine.js); read its header for the API and hints-brief.js for the style.
   Every figure and threshold below is read from panels.js / shared.js at run time (CORR_MIN_N, CORR_RET_MIN, CORR_MAX, VOL_MAX, corrWord bands 0.7 / 0.4 / 0.2,
   the vs-week tone 1.25 / 0.8, the 10% ends of the 24h range, CAL_CD, the calendar refresh) or is quoted from the element's own text. Nothing is predicted.
   The Calendar table (class tbl), the window buttons of the matrix (4H / 1D / 3D) and the Impact buttons are opted out (Victor's standing rule: plain toggles and data tables).
   Strength, Exposure and Sessions are cards of hints-ticket.js (rail-stats): they are not registered here.
   Verify with: node tools/hint-audit.mjs research-correlation research-volatility research-calendar */
(() => {
  const { add, optout, card, plain, sec, scale, tbl, p, esc, nm, sgn, cls, lbl } = HX;
  const g = (f, d) => { try { const v = f(); return v == null ? d : v; } catch (e) { return d; } };
  const pr = s => g(() => pretty(s), s);
  const q = (el, s) => el.querySelector(s);
  const qt = (el, s) => ((q(el, s) || {}).textContent || '').trim();
  const f2 = v => (v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  const sg2 = v => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2);
  const syms = () => g(() => S.positions.map(x => x.sym), []);
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

  // plain toggles and the window buttons: no card (standing rule); the labels beside them carry the explanation
  optout('#corrSeg'); optout('#calF .mini-seg');

  // =====================================================================  CORRELATION
  const winName = lb => lb === 240 ? '4 hours' : lb === 1440 ? '1 day' : lb === 4320 ? '3 days' : lb + ' minutes';
  const lbNow = () => g(() => S.set.corrLb || 1440, 1440);
  const retNow = () => g(() => CORR.ret || 1, 1);
  const retName = k => k === 1 ? '1-minute' : k === 60 ? '1-hour' : k + '-minute';
  const setNow = () => g(() => CORR.set, 'fx');
  const minN = () => g(() => CORR_MIN_N, 30);
  const retMin = k => g(() => CORR_RET_MIN[k], 240);
  const winLab = lb => lb === 240 ? '4H' : lb === 1440 ? '1D' : lb === 4320 ? '3D' : lb + 'm';
  const BANDS = [{ w: .3, label: 'strong', tone: 'warn' }, { w: .3, label: 'moderate', tone: 'mid' }, { w: .2, label: 'weak', tone: 'mid' }, { w: .4, label: 'none', tone: 'ok' }, { w: .2, label: 'weak', tone: 'mid' }, { w: .3, label: 'moderate', tone: 'mid' }, { w: .3, label: 'strong', tone: 'warn' }];
  const rScale = r => scale(BANDS, -1, 1, Math.max(-1, Math.min(1, r)), v => sg2(v));
  const rBandsNote = p('The bands are the ones the matrix uses to word a pair: |ρ| from 0.2 is weak, from 0.4 moderate, from 0.7 strong; under 0.2 the pair is practically unrelated. Inverse pairs use the same cut-offs on the negative side.');
  const verdict = r => { const a = Math.abs(r), neg = r < 0;
    if (a >= .7) return { tone: 'warn', chip: neg ? 'strongly inverse: buying one and selling the other is close to one bet, doubled' : 'strongly correlated: buying both is close to one bet, doubled', w: 'strong' };
    if (a >= .4) return { tone: '', chip: neg ? 'moderately inverse: part of the move is shared, reversed' : 'moderately correlated: part of the move is shared', w: 'moderate' };
    if (a >= .2) return { tone: '', chip: 'weakly related: little shared movement', w: 'weak' };
    return { tone: 'ok', chip: 'practically unrelated: a real diversifier', w: 'none' }; };
  const ccyOf = s => g(() => { const m = M(s); return m && m.kind !== 'cfd' ? [m.base, m.quote] : []; }, []);
  const sharedCcy = (a, b) => { const A = ccyOf(a), B = ccyOf(b); return A.filter(c => B.includes(c)); };
  // what the user holds on a pair of symbols (the rule of the matrix summary: same side + positive ρ, or opposite sides + negative ρ = adding up)
  const heldPair = (a, b, r) => { const P = g(() => S.positions, []), pa = P.find(x => x.sym === a), pb = P.find(x => x.sym === b); if (!pa || !pb) return null;
    return { adding: (pa.side === pb.side) === (r > 0), sa: pa.side, sb: pb.side }; };
  const heldText = (a, b, r) => { const h = heldPair(a, b, r); if (!h) return ''; const A = pr(a), B = pr(b);
    return sec('Your positions', p(`You hold <b>${esc(A)}</b> (${h.sa === 'buy' ? 'long' : 'short'}) and <b>${esc(B)}</b> (${h.sb === 'buy' ? 'long' : 'short'}). With ρ ${sg2(r)} they are <b>${h.adding ? 'adding up' : 'offsetting'}</b>: ${h.adding ? 'the two positions lean on the same move, so the risk is larger than either alone' : 'one position partly cancels the other'}.`)); };
  const otherWins = (a, b) => { const k = retNow(), mine = setNow() === 'all'; const rows = [];
    for (const lb of [240, 1440, 4320]) { if (lb < retMin(k)) continue; const v = g(() => mine ? corrPair(a, b, lb).r : corrTrading(a, b, lb).r, NaN); rows.push({ c: [winLab(lb) + ' window', Number.isFinite(v) ? sg2(v) : '—'], on: lb === lbNow() }); }
    return rows; };
  const setHow = () => setNow() === 'all'
    ? `Each pair is paired on the minutes both instruments have a bar, over the window that ends at the last minute both traded. Fewer than ${minN()} common returns: no figure (—).`
    : `The last ${winName(lbNow())} of trading minutes the two pairs share, matched minute by minute.`;

  // one cell of the matrix
  const cellCard = el => {
    const tipT = (el.dataset.tip || '').split('|')[0], a = el.dataset.a, b = el.dataset.b, txt = lbl(el);
    if (el.classList.contains('d')) return card({ title: 'Same instrument', chip: 'the diagonal: always 1.00', tone: '', value: '1.00', vlabel: tipT.replace(/: 1\.00$/, ''), sub: 'an instrument against itself',
      plain: 'The diagonal of the matrix. Every instrument moves exactly with itself, so it is 1.00 by definition. It carries no information; it separates the upper triangle from the lower one, which show the same pairs.', use: 'Read the cells beside it, not this one.' });
    if (!a || !b) { const n = (tipT.match(/only (\d+) common/) || [])[1], who = tipT.split(':')[0];
      return card({ title: who || 'No figure', chip: 'not enough common data to measure', tone: 'warn', value: '—', vlabel: who, sub: n != null ? `${n} common returns, ${minN()} needed` : '',
        plain: `The two instruments share only ${n != null ? '<b>' + n + '</b>' : 'a few'} ${retName(retNow())} returns in this window; the matrix needs at least <b>${minN()}</b>. This happens when their sessions barely overlap, for example a stock and a pair, or a market that has just opened.`,
        secs: [sec('What the matrix does', p(setHow()))], use: 'Widen the window (4H, 1D, 3D) or shorten the returns (1m) to get more common observations.' }); }
    const r = nm(txt); if (r == null) return null; const v = verdict(r), A = pr(a), B = pr(b), k = retNow(), lb = lbNow(), sh = sharedCcy(a, b), nTxt = (tipT.match(/over (\d+) common/) || [])[1];
    const rows = otherWins(a, b);
    return card({ title: `${A} vs ${B}`, chip: v.chip, tone: v.tone, value: sg2(r), vcls: cls(r), vlabel: 'ρ, correlation of returns', sub: `${v.w}${r < 0 ? ' inverse' : ''} · ${retName(k)} returns over ${winName(lb)}${nTxt ? ' · ' + nTxt + ' common returns' : ''}`,
      plain: r >= 0 ? `When ${esc(A)} moves, ${esc(B)} has moved in the <b>same direction</b> to a degree of ${f2(r)} on a scale from 0 (unrelated) to 1 (one and the same). ${Math.abs(r) >= .7 ? 'Buying both is close to taking the same trade twice.' : Math.abs(r) >= .2 ? 'They share part of their moves, not all.' : 'Their moves hardly line up.'}`
        : `When ${esc(A)} moves, ${esc(B)} has moved in the <b>opposite direction</b> to a degree of ${f2(Math.abs(r))} on a scale from 0 (unrelated) to 1 (perfect mirror). ${Math.abs(r) >= .7 ? 'Buying one and selling the other is close to the same trade; buying both partly cancels out.' : Math.abs(r) >= .2 ? 'They share part of their moves, reversed.' : 'Their moves hardly line up.'}`,
      secs: [sec('Where it sits', rScale(r) + rBandsNote),
        sec('How it was measured', tbl([{ c: ['Returns', retName(k) + ' log returns'] }, { c: ['Window', winName(lb)] }, { c: ['Instruments', setNow() === 'all' ? 'Yours' : 'G8'] }]) + p(setHow())),
        rows.length ? sec('The same pair on other windows', tbl(rows)) : '', heldText(a, b, r)],
      watch: (sh.length ? `${A} and ${B} both contain <b>${sh.join(', ')}</b>, so a move of that currency hits both. ` : '') + 'ρ describes the window above. It changes with the window and the return length, and it does not say what the pair will do next.',
      use: Math.abs(r) >= .7 ? 'Count these two as one position when you size the risk, or choose one of them.' : Math.abs(r) < .2 ? 'The pair spreads risk: two positions here are two separate bets.' : 'Treat the shared part as one bet and the rest as independent.' });
  };

  // a row or a column header of the matrix
  const headCard = el => {
    const isRow = el.hasAttribute('data-row'), idx = el.getAttribute(isRow ? 'data-row' : 'data-col'), cells = [...document.querySelectorAll(`#corr > [data-${isRow ? 'i' : 'j'}="${idx}"]`)];
    const own = cells.find(c => c.dataset.a), sym = own ? (isRow ? own.dataset.a : own.dataset.b) : null, name = sym ? pr(sym) : lbl(el);
    const list = cells.filter(c => c.dataset.a).map(c => ({ s: isRow ? c.dataset.b : c.dataset.a, r: nm(lbl(c)) })).filter(x => x.r != null);
    const held = el.classList.contains('held'), cur = el.classList.contains('cur');
    const avg = list.length ? list.reduce((s, x) => s + Math.abs(x.r), 0) / list.length : null, by = list.slice().sort((x, y) => Math.abs(y.r) - Math.abs(x.r)), top = by.slice(0, 3), low = by.length > 3 ? by[by.length - 1] : null;
    const v = avg == null ? { tone: '', chip: 'an instrument of the matrix' } : avg >= .4 ? { tone: 'warn', chip: 'moves with most of the others: a poor diversifier here' } : avg < .2 ? { tone: 'ok', chip: 'moves apart from the others: a good diversifier here' } : { tone: '', chip: 'shares part of its moves with the others' };
    return card({ title: name, chip: v.chip, tone: v.tone, value: avg == null ? '—' : avg.toFixed(2), vlabel: `Average |ρ| with the others (${isRow ? 'row' : 'column'})`, sub: list.length ? `${list.length} pairs with a figure` : 'no figures in this row',
      plain: `The ${isRow ? 'row' : 'column'} of <b>${esc(name)}</b>: its correlation with each of the other instruments, in the same colours as the cells. ${held ? 'You hold a position on it (outlined). ' : ''}${cur ? 'It is the instrument on your chart. ' : ''}The average is taken on the size of ρ, so a strong inverse link counts as much as a strong direct one.`,
      secs: [list.length ? sec('Closest links', tbl(top.map(x => ({ c: [esc(pr(x.s)), sg2(x.r)] }))) + (low ? p(`Furthest from it: <b>${esc(pr(low.s))}</b> ${sg2(low.r)}.`) : '')) : '',
        avg == null ? '' : sec('Where the average sits', scale([{ w: .2, label: 'apart', tone: 'ok' }, { w: .2, label: 'some', tone: 'mid' }, { w: .6, label: 'close', tone: 'warn' }], 0, 1, Math.min(1, avg), v2 => v2.toFixed(2)) + p('The matrix words a pair as practically unrelated under 0.2 and as moderate from 0.4; the same cut-offs are used here for the average.'))],
      watch: 'Hover a cell to see its row and column light up: the pair is the crossing of two headers.', use: 'Pick the entries of a portfolio from instruments with a low average, and check the row of anything you already hold.' });
  };

  add('#corr > div.h', headCard);
  add('#corr > div:not(.h)', cellCard);

  // the control line
  const corrCtrl = el => { const t = lbl(el), k = retNow(), lb = lbNow();
    if (/^Correlation of returns/.test(t)) return card({ title: 'Correlation of returns · window', chip: 'ρ over the last ' + winName(lb), tone: '', value: winName(lb), vlabel: 'Window now', sub: `${retName(k)} returns`,
      plain: 'The matrix compares the <b>returns</b> of two instruments (how much each moved from one step to the next), not their prices, so two pairs that trend in the same direction are not mistaken for moving together.',
      secs: [sec('The window buttons', tbl([{ c: ['4H', 'the last 4 hours'], on: lb === 240 }, { c: ['1D', 'the last day'], on: lb === 1440 }, { c: ['3D', 'the last 3 days'], on: lb === 4320 }]) + p(`A longer window gives more observations and a steadier figure; a shorter one follows the current mood. 15-minute returns need at least the 1D window, hourly returns the 3D window (the app widens the window for you when needed).`))],
      watch: 'The figure is only as good as the data in the window: with fewer than ' + minN() + ' common returns a cell shows — instead of a number.', use: 'Check the pair on two windows. If ρ is stable across them, it is worth building on.' });
    if (/^returns/.test(t)) return card({ title: 'Return length', chip: retName(k) + ' returns now', tone: '', value: retName(k), vlabel: 'Return length', plain: 'How long each step is when two instruments are compared: 1 minute, 15 minutes or 1 hour. The buttons beside the label change it.',
      secs: [sec('The three lengths', tbl([{ c: ['1m', 'most data; understates ρ on a real feed'], on: k === 1 }, { c: ['15m', 'from the 1D window'], on: k === 15 }, { c: ['1h', 'from the 3D window'], on: k === 60 }]))], use: 'Use 1m for a fast look, 15m or 1h for a steadier picture of how positions behave.' });
    if (/^order/.test(t)) return card({ title: 'Order of the matrix', chip: CORR_ORD() === 'clu' ? 'Cluster: correlated instruments sit together' : 'Default: the usual order', tone: '', value: CORR_ORD() === 'clu' ? 'Cluster' : 'Default', vlabel: 'Order now',
      plain: 'Only the order of rows and columns changes, never the figures. <b>Default</b> lists the USD pairs first, then the crosses. <b>Cluster</b> puts instruments with strong links next to each other, so groups show as blocks along the diagonal.',
      secs: [sec('How Cluster orders', p('It links each instrument to the one it moves most like (strong inverse links count too, as the size of ρ is used) and walks that chain, starting from the instrument on your chart when it is in the list.'))], use: 'Switch to Cluster to see which instruments are really one trade.' });
    return null; };
  const CORR_ORD = () => g(() => CORR.ord, 'def');
  add('.corr-ctrl > span.muted.small', corrCtrl);

  // G8 / Yours
  add('#corrSet button', el => { const set = el.dataset.cs, on = el.classList.contains('on'), nG = g(() => Engine.PAIRS.length, 16), nY = g(() => mySyms().length, 0), max = g(() => CORR_MAX, 30);
    const isG = set === 'fx';
    return card({ title: isG ? 'G8 pairs' : 'Your instruments', chip: on ? 'showing now' : 'press to switch to it', tone: '', value: String(isG ? nG : Math.min(nY, max)), vlabel: isG ? 'pairs in the matrix' : `of your instruments (at most ${max})`, sub: isG ? 'the G8 currencies' : 'favourites, held and visible',
      plain: isG ? 'The <b>16 pairs of the G8 currencies</b>: the fixed set, every pair on the same minutes. It shows how the majors relate to each other, whatever you trade.'
        : 'Your <b>favourites</b>, everything you <b>hold</b> (positions, orders, active alerts) and what is <b>visible</b> (the chart, the multi-chart panes, the watchlist rows in view), up to ' + max + '. It is the correlation of your own book.',
      secs: [sec('How the pairs are measured', p(isG ? 'The last window of trading minutes both pairs share, matched minute by minute.' : `Each pair on the minutes both instruments have a bar, over the window that ends at the last minute both traded. Fewer than ${minN()} common returns: no figure.`))],
      watch: isG ? '' : 'A choice for this session only. Instruments from different sessions (a stock and a pair) share fewer minutes, so more cells may show —.', use: isG ? 'Start here to see the groups; switch to Yours to check what you actually hold.' : 'Use it before adding a position: check how it correlates with what you already hold.' }); });

  // returns and order buttons: the cards of their labels' explanation plus the live state of the button
  add('#corrRet button', el => { const k = +el.dataset.ret, on = el.classList.contains('on'), need = retMin(k), lb = lbNow();
    return card({ title: `${retName(k)} returns`, chip: on ? 'in use now' : lb < need ? `press to use it: the window widens to ${winLab(need)}` : 'press to use it', tone: '', value: el.textContent.trim(), vlabel: 'Return length', sub: `needs the ${winLab(need)} window or longer`,
      plain: k === 1 ? 'One-minute returns: <b>the most data</b>. On a real feed quotes do not update in the same instant, which understates correlation (the Epps effect).' : k === 15 ? '15-minute returns: <b>closer to how positions feel</b>. Needs the 1D or the 3D window.' : 'Hourly returns: <b>the steadiest picture</b>. Needs the 3D window.',
      secs: [sec('Window needed', tbl([{ c: ['1m', '4H or longer'], on: k === 1 }, { c: ['15m', '1D or longer'], on: k === 15 }, { c: ['1h', '3D'], on: k === 60 }]) + p(`Your window now is <b>${winLab(lb)}</b>. If it is too short for the length you press, it is widened and a notice says so.`))],
      use: 'Compare the same pair on 1m and on 1h before trusting a high or a low reading.' }); });
  add('#corrOrd button', el => { const clu = el.dataset.ord === 'clu', on = el.classList.contains('on');
    return card({ title: clu ? 'Cluster order' : 'Default order', chip: on ? 'in use now' : 'press to use it', tone: '', value: el.textContent.trim(), vlabel: 'Order of rows and columns',
      plain: clu ? 'Correlated pairs next to each other, so the groups show as <b>blocks along the diagonal</b>. Only the order changes, never the figures.' : 'The usual order: USD pairs, then the crosses. Only the order changes, never the figures.',
      use: clu ? 'Look for dark blocks on the diagonal: each block is a group that behaves as one trade.' : 'Use it to find a pair quickly, as it keeps the same place every time.' }); });

  // legend
  add('#corrLeg > span:not(.corr-leg-d)', el => { const neg = /inverse/.test(lbl(el));
    return card({ title: neg ? '−1: inverse' : '+1: together', chip: neg ? 'blue: moves the opposite way' : 'orange: moves the same way', tone: '', value: neg ? '−1' : '+1', vlabel: neg ? 'End of the colour scale' : 'End of the colour scale',
      plain: neg ? 'At −1 two instruments are a perfect mirror: when one rises the other falls by a proportional amount. The cell is the strongest blue.' : 'At +1 two instruments move as one. The cell is the strongest orange.',
      secs: [sec('The scale', p('The colour grows with the size of ρ, up to full strength at 1. The middle (no colour) is ρ near 0. Red and green are not used: they stay for buy / sell and profit / loss.'))], use: 'Read colour for the groups and the figure for the exact value.' }); });
  add('#corrLeg > i', () => card({ title: 'Colour scale', chip: 'blue inverse, none at 0, orange together', tone: '', plain: 'The colour of a cell follows ρ: blue for an inverse link, no colour around 0, orange for a link in the same direction. The stronger the link, the stronger the colour.', use: 'A cell with no colour is a pair that shares almost nothing.' }), { empty: true });
  add('#corrLeg > span.corr-leg-d', () => card({ title: 'Same pair: 1.00', chip: 'the diagonal', tone: '', value: '1.00', vlabel: 'An instrument with itself', plain: 'The cells on the diagonal of the matrix are an instrument compared with itself: always 1.00.', use: 'Ignore the diagonal: the pairs are above and below it, and each appears twice.' }));

  // summary
  add('#corrSum p.corr-intro', () => card({ title: 'What the matrix shows', chip: 'how alike two instruments move', tone: '', plain: 'Each cell is the <b>correlation (ρ)</b> of the returns of two instruments over the chosen window. Near +1 they are the same trade, near −1 the same trade in reverse, near 0 they are independent: a diversifier.',
    secs: [sec('The cut-offs', tbl([{ c: ['|ρ| ≥ 0.7', 'strong'] }, { c: ['0.4 – 0.7', 'moderate'] }, { c: ['0.2 – 0.4', 'weak'] }, { c: ['&lt; 0.2', 'practically unrelated'] }]))], use: 'Check the summary under this line before opening a new position.' }));
  add('#corrSum .term', () => card({ title: 'ρ (correlation)', chip: 'from −1 to +1', tone: '', plain: '<b>+1</b>: the two move as one. <b>−1</b>: always opposite. <b>0</b>: unrelated. It is computed on the returns of the chosen length over the window, not on the prices.',
    secs: [sec('Scale', rScale(0))], watch: 'A value says how the two moved in the window. It is not a promise about the next move.', use: 'Use |ρ| above 0.7 as the sign that two positions are one bet.' }));
  add('#corrSum .corr-ins label', el => { const t = lbl(el).toLowerCase();
    if (t.indexOf('strongest') >= 0) return card({ title: 'Strongest links', chip: 'the five pairs with the largest |ρ|', tone: '', plain: 'The pairs in the matrix with the largest <b>size</b> of ρ, direct or inverse: the places where two instruments are most nearly the same trade.', use: 'If you hold two names from this list on the same side, you hold one bet twice.' });
    if (t.indexOf('independent') >= 0) return card({ title: 'Most independent', chip: 'the instrument least tied to the others', tone: '', plain: 'The instrument with the <b>lowest average |ρ|</b> against all the others in the matrix. It is the one that adds the most separate information to a set.', use: 'When you need a second trade that does not repeat the first, start from this name.' });
    return card({ title: 'Your positions', chip: 'what your open trades share', tone: '', plain: 'Among the instruments in the matrix that you hold, the pairs with |ρ| above <b>0.7</b> are listed with a tag: <b>adding up</b> (the two positions lean on the same move) or <b>offsetting</b> (one partly cancels the other). Held instruments carry an outline in the matrix.', use: 'An "adding up" pair means your real size on that move is the sum of both.' }); });
  const lkCard = el => { const [title, body] = (el.dataset.tip || '').split('|');
    if (title.indexOf('↔') >= 0) { const m = title.match(/^(.+?) ↔ (.+?) · ρ (\S+)$/), r = m ? nm(m[3]) : null; if (!m || r == null) return null; const v = verdict(r);
      const symOf = n => (g(() => S.positions.map(x => x.sym), []).find(s => pr(s) === n)) || null, sa = symOf(m[1]), sb = symOf(m[2]), hp = sa && sb ? heldPair(sa, sb, r) : null;
      return card({ title: `${m[1]} ↔ ${m[2]}`, chip: v.chip, tone: v.tone, value: sg2(r), vcls: cls(r), vlabel: 'ρ', sub: `${retName(retNow())} returns over ${winName(lbNow())}`, plain: esc(body || '') + (hp ? ` You hold both, and they are <b>${hp.adding ? 'adding up' : 'offsetting'}</b>.` : ''),
        secs: [sec('Where it sits', rScale(r))], use: Math.abs(r) >= .7 ? 'Count the pair as one position, or keep only one.' : 'It is among the strongest links of the set, but not strong in absolute terms.' }); }
    const m2 = (body || '').match(/(\d\.\d\d)/); const a = m2 ? +m2[1] : null;
    return card({ title: title, chip: 'the best diversifier in this set', tone: 'ok', value: a == null ? '—' : a.toFixed(2), vlabel: 'Average |ρ| with the others', sub: 'the lowest of the set', plain: esc(body || ''),
      secs: a == null ? [] : [sec('Where it sits', scale([{ w: .2, label: 'apart', tone: 'ok' }, { w: .2, label: 'some', tone: 'mid' }, { w: .6, label: 'close', tone: 'warn' }], 0, 1, Math.min(1, a), v => v.toFixed(2)))], use: 'A position on this instrument repeats the others the least.' }); };
  add('#corrSum .corr-lk', lkCard);
  add('#corrSum .corr-ins .tag', el => { const add2 = /adding/.test(lbl(el));
    return card({ title: cap(lbl(el)), chip: add2 ? 'the two positions lean on the same move' : 'the two positions partly cancel', tone: add2 ? 'warn' : '', plain: add2 ? 'Both positions gain or lose on the same move: with ρ above 0.7 in size and the sides as they are, your <b>real size on that move is the sum of the two</b>.' : 'The sides you hold and the sign of ρ point in different directions: a move that helps one position tends to hurt the other, so they <b>partly cancel</b>.',
      watch: add2 ? '' : 'Offsetting positions still pay two spreads and tie up margin twice.', use: add2 ? 'Size the pair as one position, or close one of them.' : 'If the hedge is not what you meant, close one side.' }); });
  add('#corrSum .corr-ins span.small:not(.muted)', el => card({ title: 'No strong pair among yours', chip: 'no |ρ| above 0.7 among the instruments you hold', tone: 'ok', plain: esc(lbl(el)) + ' The matrix checks the pairs among your open positions that are in this set, with the threshold of 0.7 in size.', watch: 'It only sees the instruments in the matrix (G8 or Yours) and the window you chose.', use: 'Check again after you add a position.' }));
  add('#corrSum .corr-ins span.muted.small', () => card({ title: 'No held instrument here', chip: 'nothing to compare yet', tone: '', plain: 'None of your open positions is on an instrument in this matrix. When you hold one, its row and column get an <b>outline</b>, and pairs of held instruments with |ρ| above 0.7 are listed here.', use: 'Open a position, or switch to Yours, to see how what you hold lines up.' }));

  // =====================================================================  VOLATILITY
  const volRows = () => [...document.querySelectorAll('#volBody .vcard')].map(el => { const sm = qt(el, '.vrng small').split('·'), tip = el.dataset.tip || '', ft = tip.match(/from (\S+) to (\S+?);/);
    return { el, sym: el.dataset.sym, name: qt(el, '.t'), pct: nm(qt(el, '.vpct')), un: qt(el, '.vun'), vs: nm(qt(el, '.vwk')), r1: qt(el, '.vr1'), rp: nm(sm[0] || ''), rx: nm(sm[1] || ''), pos: nm(qt(el, '.vpos em')), end: /high/.test(qt(el, '.vpos em')) ? 'hi' : /low/.test(qt(el, '.vpos em')) ? 'lo' : '', lo: ft && ft[1], hi: ft && ft[2], held: el.classList.contains('held'), cur: el.classList.contains('cur') }; });
  const VS_HI = 1.25, VS_LO = .8; // the tone of the column (panels.js renderVol: tone)
  const VS_BANDS = [{ w: .8, label: 'quieter', tone: 'warn' }, { w: .45, label: 'normal', tone: 'ok' }, { w: 1.25, label: 'busier', tone: 'warn' }];
  const vsScale = v => scale(VS_BANDS, 0, 2.5, Math.max(0, Math.min(2.5, v)), x => x.toFixed(2) + '×');
  const POS_BANDS = [{ w: 10, label: 'low end', tone: 'warn' }, { w: 80, label: 'inside', tone: 'mid' }, { w: 10, label: 'high end', tone: 'warn' }];
  const vsVerdict = v => v == null ? { tone: '', chip: 'no weekly baseline yet' } : v > VS_HI ? { tone: 'warn', chip: 'busier than its usual hours: a normal stop is more likely to be hit' } : v < VS_LO ? { tone: 'warn', chip: 'quieter than its usual hours: moves are small, spread weighs more' } : { tone: 'ok', chip: 'a normal level of movement for these hours' };
  const BASE = 'The baseline is the average true range of the same hours of the day among the earlier bars of the last 101 complete hourly bars (about four days of trading, not a full week). It needs at least 10 matching hours, otherwise the cell shows —.';
  const ATRDEF = 'ATR(14) is Wilder\'s average true range over 14 complete one-hour bars (gaps included; the hour in progress is left out). An instrument needs at least 15 complete hours of history to be listed.';

  add('.vcard', el => { const r = volRows().find(x => x.el === el); if (!r) return null; const v = vsVerdict(r.vs);
    return card({ title: r.name, chip: v.chip, tone: v.tone, value: r.pct.toFixed(2) + '<small>%</small>', vlabel: 'ATR(14) of one hour, % of price', sub: r.un + ' an hour' + (r.held ? ' · you hold it' : '') + (r.cur ? ' · on your chart' : ''),
      plain: `One hour of <b>${esc(r.name)}</b> moves about <b>${r.pct.toFixed(2)}%</b> of its price (${esc(r.un)}) from low to high.` + (r.vs != null ? ` That is <b>${r.vs.toFixed(2)}×</b> its usual for these hours.` : ' There is no baseline for its hours yet.') + ` Over the last 24 hours it travelled ${esc(r.r1)} (${r.rp != null ? r.rp.toFixed(2) + '%' : '—'}${r.rx != null ? ', ' + r.rx.toFixed(1) + '× one hour of ATR' : ''}) and price sits at <b>${r.pos != null ? r.pos.toFixed(0) : '—'}%</b> of that range.`,
      secs: [r.vs == null ? '' : sec('Against its own hours', vsScale(r.vs) + p(`Above ${VS_HI}× the cell is flagged as busier, below ${VS_LO}× as quieter.`)),
        r.pos == null ? '' : sec('Price in the 24h range', scale(POS_BANDS, 0, 100, Math.max(0, Math.min(100, r.pos)), x => Math.round(x) + '%') + p(r.hi ? `Low ${esc(r.lo)}, high ${esc(r.hi)}. The ends are the bottom and top 10% of the range.` : '')),
        sec('The figures', tbl([{ c: ['ATR(14) 1H', `${r.pct.toFixed(2)}% · ${esc(r.un)}`] }, { c: ['vs usual hours', r.vs == null ? '—' : r.vs.toFixed(2) + '×'] }, { c: ['24h range', `${esc(r.r1)} · ${r.rp != null ? r.rp.toFixed(2) + '%' : '—'}`] }, { c: ['Range in ATRs', r.rx != null ? r.rx.toFixed(1) + '×' : '—'] }, { c: ['Price in range', r.pos != null ? r.pos.toFixed(0) + '%' + (r.end ? (r.end === 'hi' ? ' (high end)' : ' (low end)') : '') : '—'] }]))],
      watch: 'ATR measures how far the instrument moves, not which way. Pips and points do not compare across instruments, which is why the list ranks by % of price.' + (r.held ? ' You hold a position here: its stop and size should be judged against this ATR.' : ''),
      use: 'A rule of thumb (not a rule of the app): a stop closer than one hour of ATR sits inside the normal noise. Size the lots to the stop, not the other way round.' }); }, { go: el => 'Open ' + (qt(el, '.t') || 'it') + ' on the chart' });

  // summary blocks
  add('#volBody .vol-sum > div', el => { const t = qt(el, 'label').toLowerCase(), rows = volRows();
    if (t.indexOf('most') === 0) { const top = qt(el, 'b'), pct = nm(qt(el, 'span.mono')), bs = el.querySelectorAll('b'), lo = bs[1] ? bs[1].textContent : '', pl = el.querySelectorAll('span.mono')[1], plv = pl ? nm(pl.textContent) : null;
      return card({ title: 'Most / least volatile', chip: 'the largest and the smallest hourly ATR as a % of price', tone: '', value: esc(top), vlabel: 'Most volatile now', sub: `${pct != null ? pct.toFixed(2) + '%' : '—'} an hour · least: ${esc(lo)} ${plv != null ? plv.toFixed(2) + '%' : ''}`,
        plain: `Of the ${rows.length} instruments listed, <b>${esc(top)}</b> moves the most in an hour (${pct != null ? pct.toFixed(2) : '—'}% of its price) and <b>${esc(lo)}</b> the least (${plv != null ? plv.toFixed(2) : '—'}%). The ratio between them is ${pct && plv ? (pct / plv).toFixed(1) + '×' : '—'}.`,
        secs: [sec('Why a percentage', p('Pips and points do not compare across a JPY pair, a stock and an index. The ATR as a % of price puts them on one line.'))], use: 'The same stop in pips is a very different risk on the two ends of this list.' }); }
    if (t.indexOf('market') === 0) { const v = nm(qt(el, '.brx-t')); const vv = vsVerdict(v);
      return card({ title: 'Market vs its week', chip: v == null ? 'not enough history' : vv.chip, tone: vv.tone, value: v == null ? '—' : v.toFixed(2) + '<small>×</small>', vlabel: 'Average of the vs-week column', sub: v == null ? '' : `over ${rows.filter(x => x.vs != null).length} instruments`,
        plain: v == null ? 'The weekly baseline needs history that is not there yet.' : `On average the hourly ATR of the listed instruments is <b>${v.toFixed(2)}×</b> the same hours earlier in the period. Above ${VS_HI}× the market is busier than usual, below ${VS_LO}× quieter.`,
        secs: [v == null ? '' : sec('Scale', vsScale(v)), sec('The baseline', p(BASE))], watch: 'It is the plain average of the column, so a few instruments can pull it: check the rows before concluding the whole market is moving.', use: v != null && v > VS_HI ? 'Wider stops and smaller size are the usual response to a busy market.' : 'Plan as usual; look at the rows that stand out.' }); }
    const hi = rows.filter(x => x.end === 'hi'), lo = rows.filter(x => x.end === 'lo'), nm2 = l => l.slice(0, 6).map(x => esc(x.name)).join(', ') + (l.length > 6 ? ` +${l.length - 6}` : '');
    return card({ title: 'At the 24h high / low', chip: hi.length + lo.length ? `${hi.length} at the high, ${lo.length} at the low` : 'none at an end of its range', tone: '', value: String(hi.length + lo.length), vlabel: 'Instruments at an end of the day', sub: 'the top or bottom 10% of the last 24 hours',
      plain: hi.length + lo.length ? `${hi.length ? `At the <b>high</b> of the last 24 hours: ${nm2(hi)}. ` : ''}${lo.length ? `At the <b>low</b>: ${nm2(lo)}.` : ''}` : 'No instrument sits in the top or bottom 10% of its last 24 hours.',
      secs: [sec('The rule', p('An instrument is at the high when price is at 90% or more of its 24-hour range, at the low at 10% or less.'))], watch: 'Being at an end of the range says where price is, not that it will turn or break.', use: 'Use it to find the instruments where a breakout or a rejection could happen, then look at their chart.' }); });
  add('#volBody .vol-intro', () => card({ title: 'What this table shows', chip: 'how much each instrument moves', tone: '', plain: 'One row per instrument: how much it moves in an hour (<b>ATR</b>), how that compares with its usual for the same hours, how far it travelled in the last 24 hours and where price sits in that range. Press a row to open the instrument on the chart.',
    secs: [sec('What the numbers are', p(ATRDEF))], use: 'Check it before you set a stop: the ATR column is the size of the noise.' }));
  add('#volBody .vol-intro .term', () => card({ title: 'ATR(14) on 1H', chip: 'the size of one hour of movement', tone: '', plain: 'Average true range: how much one hour moves, from its low to its high, <b>gaps included</b>. As a % of price it compares a JPY pair, a stock and an index.',
    secs: [sec('How it is computed', p(ATRDEF))], watch: 'It measures size, never direction.', use: 'Express stops as multiples of ATR, then size the lots to that stop.' }));
  add('#volBody .vol-ctl > span.muted.small', el => { const t = lbl(el), rows = volRows();
    if (/^sort/.test(t)) return card({ title: 'Sort', chip: 'the order of the rows', tone: '', plain: 'The buttons order the rows: by <b>Volatility</b> (highest hourly ATR as a % of price first), by <b>vs week</b> (furthest above its own usual first) or by <b>At an end</b> (closest to the 24h high or low first). The figures do not change.', use: 'Switch to vs week to find what is unusually busy right now.' });
    const mine = rows.filter(x => !g(() => Engine.PAIRS.some(pp => pp.sym === x.sym), false)).length;
    return card({ title: 'Which instruments are listed', chip: `${rows.length} rows`, tone: '', value: String(rows.length), vlabel: 'Instruments in the table', sub: `the 16 G8 pairs${mine ? ' + ' + mine + ' of yours' : ''}`,
      plain: 'The 16 G8 pairs plus your <b>favourites</b>, what you <b>hold</b> and what is <b>visible</b>, at most ' + g(() => VOL_MAX, 60) + ' rows. An instrument without 15 complete hours of history is left out.', use: 'Add a favourite to see it here.' }); });
  add('#volSort button', el => { const k = el.dataset.vs, on = el.classList.contains('on'), rows = volRows();
    const D = { atr: ['Volatility', 'Highest hourly ATR as a % of price first.'], norm: ['vs week', 'Furthest above its own usual hours first.'], pos: ['At an end', 'Closest to the 24h high or low first.'] }[k] || [lbl(el), ''];
    const first = rows[0]; return card({ title: 'Sort by ' + D[0], chip: on ? 'in use now' : 'press to sort this way', tone: '', value: el.textContent.trim(), vlabel: 'Order of the rows', sub: on && first ? 'first row now: ' + first.name : '',
      plain: esc(D[1]) + ' Only the order changes, never the figures.', use: k === 'norm' ? 'The top rows are the ones busier than their usual for these hours.' : k === 'pos' ? 'The top rows are at the high or low of their last 24 hours.' : 'The top rows are the ones where a stop needs the most room.' }); });

  // column headers
  add('#volBody .vhead > span', el => { const t = lbl(el).toLowerCase(), rows = volRows(), n = rows.length, byP = rows.filter(x => x.pct != null).sort((a, b) => b.pct - a.pct), mx = byP[0], mn = byP[byP.length - 1];
    const vs = rows.filter(x => x.vs != null), avgVs = vs.length ? vs.reduce((s, x) => s + x.vs, 0) / vs.length : null;
    if (t === 'instrument') return card({ title: 'Instrument', chip: 'one row per instrument, ' + n + ' now', tone: '', value: String(n), vlabel: 'Rows', plain: 'The G8 pairs plus your favourites, held and visible instruments. Press a row to open it on the chart. Rows of instruments you hold, and the one on your chart, are marked.', use: 'Use the sort buttons to bring the interesting rows to the top.' });
    if (t.indexOf('atr(14)') === 0) return card({ title: 'ATR(14) 1H', chip: 'one hour of movement, as a bar', tone: '', value: mx ? mx.pct.toFixed(2) + '<small>%</small>' : '—', vlabel: 'Highest now', sub: mx ? mx.name : '', plain: 'The bar is the hourly ATR as a % of price, drawn against the most volatile instrument of the list, so the longest bar is always the top one. The figure beside it is the same value and, next to it, in pips or points.',
      secs: [sec('The measure', p(ATRDEF)), mn ? sec('The two ends now', tbl([{ c: [esc(mx.name), mx.pct.toFixed(2) + '%'] }, { c: [esc(mn.name), mn.pct.toFixed(2) + '%'] }])) : ''], use: 'Compare bars to see how much more room one instrument needs than another.' });
    if (t.indexOf('% of price') === 0) return card({ title: 'ATR, % of price', chip: 'comparable across instruments', tone: '', value: mx ? mx.pct.toFixed(2) + '<small>%</small>' : '—', vlabel: 'Highest now', sub: mx ? mx.name : '', plain: 'One hour of ATR divided by the last price. It puts a JPY pair, a stock and an index on the same line, which pips and points cannot do. The list ranks by this column.', use: 'Use it to compare instruments; use the pips column to place a stop.' });
    if (t.indexOf('pips') === 0) return card({ title: 'ATR, pips / points', chip: 'the unit of the order ticket', tone: '', plain: 'One hour of ATR in <b>pips</b> for currency pairs and <b>points</b> for CFDs: the unit you set stops and targets in.', watch: 'A pip is not the same amount of money on every instrument, so do not compare this column across rows.', use: 'Compare your stop in pips with this number before you send the order.' });
    if (t === 'vs week') return card({ title: 'vs week', chip: 'now against its usual for these hours', tone: '', value: avgVs == null ? '—' : avgVs.toFixed(2) + '<small>×</small>', vlabel: 'Average of the column', sub: `${vs.length} instruments`,
      plain: 'The hourly ATR now against the average of the <b>same hours of the day</b> earlier in the period, so a busy London afternoon is compared with other afternoons and not with the quiet night. Above 1.25× is flagged as busier than usual, below 0.8× as quieter.',
      secs: [avgVs == null ? '' : sec('Scale', vsScale(avgVs)), sec('The baseline', p(BASE))], watch: 'The column is called "week" but the baseline is the last 101 complete hourly bars, about four days.', use: 'Sort by this column to see what is unusual right now.' });
    if (t === '24h range') return card({ title: '24h range', chip: 'high minus low of the last 24 hours', tone: '', plain: 'How far the instrument travelled between its high and its low over the last 24 hours, in pips or points. For a market that has been closed for longer, it is its last bar.', use: 'Compare it with the ATR: a day range of several ATRs means one or more hours were unusually large.' });
    if (t.indexOf('%') === 0 && t.indexOf('×') > 0) return card({ title: '24h range, % and × ATR', chip: 'the same range, in two other units', tone: '', plain: 'The 24h range as a % of price, and as a <b>multiple of one hour of ATR</b>. A high multiple means the day\'s range is large compared with a normal hour.', use: 'Use the multiple to see whether the day was one big move or many small ones.' });
    if (t.indexOf('price in 24h') === 0) return card({ title: 'Price in the 24h range', chip: '0% is the low, 100% the high', tone: '', plain: 'Where price is now inside the range of the last 24 hours: <b>L</b> is the low, <b>H</b> the high. From 90% it is at the high, up to 10% at the low, and the cell says so.',
      secs: [sec('Scale', scale(POS_BANDS, 0, 100, 50, x => Math.round(x) + '%'))], watch: 'The ends say where price is, not that it will turn or break.', use: 'Sort by At an end to find the instruments at the edges.' });
    return null; });

  // =====================================================================  CALENDAR
  const cal = () => { const ev = g(() => CAL.events, []), c = { all: ev.length, hi: 0, md: 0, lo: 0, left: 0, ccy: {} };
    for (const e of ev) { c[e.impact]++; if (!e.done) c.left++; const k = c.ccy[e.ccy] || (c.ccy[e.ccy] = { hi: 0, md: 0, lo: 0, n: 0 }); k[e.impact]++; k.n++; }
    c.src = g(() => CAL.src, 'sim'); return c; };
  const srcWord = s => s === 'live' ? 'the real calendar of this week' : s === 'down' ? 'the calendar is unavailable' : 'built-in practice events';
  const impactCard = () => { const c = cal();
    return card({ title: 'Impact', chip: 'how important the calendar rates each release', tone: '', value: String(c.hi + c.md + c.lo), vlabel: 'Releases in the list', sub: `${c.hi} High · ${c.md} Med · ${c.lo} Low`,
      plain: 'Each release is labelled <b>High</b>, <b>Med</b> or <b>Low</b> impact' + (c.src === 'live' ? ', as published by the calendar feed' : '') + '. The three buttons beside this label show or hide each level; they are for this session only.',
      secs: [sec('In the list now', tbl([{ c: ['High', String(c.hi)] }, { c: ['Med', String(c.md)] }, { c: ['Low', String(c.lo)] }])), sec('What each level does in the table', tbl([{ c: ['High, Med', 'the name opens an explanation of the indicator; within 24 h the countdown ticks every second'] }, { c: ['Low', 'folded into one line you can open; no explanation'] }]))],
      watch: c.src === 'live' ? 'A High release can still do nothing, and a Low one can surprise. The label is the calendar\'s opinion, not a measurement.' : '', use: 'Keep High on while you hold positions on the currencies of the list; hide Low to cut the noise.' }); };
  add('#calF > span.muted.small:not(.cal-n)', impactCard);
  const ccyCard = () => { const c = cal(), cur = g(() => CALF.ccy, ''), rows = Object.keys(c.ccy).sort().map(k => ({ c: [k, `${c.ccy[k].hi} High · ${c.ccy[k].md} Med · ${c.ccy[k].lo} Low`], on: k === cur }));
    return card({ title: 'Currency filter', chip: cur ? 'showing only ' + cur : 'showing every currency', tone: '', value: cur || 'All', vlabel: 'Currency now', sub: `${Object.keys(c.ccy).length} currencies in the list`,
      plain: 'Shows only the releases of one currency. Choose the currencies of the pairs you hold: a USD release moves every pair with USD in it. The choice is <b>remembered in this browser</b>, unlike the Impact buttons.',
      secs: [rows.length ? sec('Releases by currency', tbl(rows)) : ''], watch: cur ? 'The filter is on: the table shows only ' + cur + ' releases, so a release of another currency can be hidden.' : '', use: 'Set it to the base or quote of the pair you are about to trade.' }); };
  add('#calCcy', ccyCard);
  add('#calF label.cal-ccy', ccyCard, { control: true });
  add('#calN', el => { const c = cal(), t = lbl(el), f = t.match(/(\d+) of (\d+)/), shown = f ? +f[1] : c.all;
    return card({ title: 'Events in the list', chip: f ? 'the filters hide ' + (c.all - shown) + ' of them' : 'no filter is hiding any', tone: f ? 'warn' : '', value: t, vlabel: f ? 'Matching the filters' : 'Every release loaded', sub: `${c.left} still to come`,
      plain: f ? `The filters match <b>${shown}</b> of the <b>${c.all}</b> releases loaded. The rest are hidden by the Impact buttons or the Currency filter.` : `All <b>${c.all}</b> releases loaded are shown (${c.hi} High, ${c.md} Med, ${c.lo} Low).`,
      secs: [sec('What is counted', p('Low-impact releases are counted even while they are folded into one line of the table, so the table can show fewer rows than this number.'))], use: f ? 'If an expected release is missing, reset the filters before looking for it.' : '' }); });
  add('#calFoot', () => { const c = cal(), at = g(() => CAL.at, 0), err = g(() => CAL.err, '');
    if (c.src === 'live') return card({ title: 'Where the calendar comes from', chip: 'ForexFactory, this week, as published', tone: '', value: at ? new Date(at).toISOString().slice(11, 16) + ' UTC' : '—', vlabel: 'Last read', sub: err === 'stale' ? 'the feed did not answer: last good copy' : 'read at boot, then every 30 minutes',
      plain: 'The table is <b>the real economic calendar for this week</b> from ForexFactory. Time, impact, forecast and previous are as published. <b>Actual values are not in this feed</b>, so that column stays empty.',
      secs: [sec('What the app does with it', tbl([{ c: ['Prices', 'nothing: the calendar changes no price and no spread'] }, { c: ['A High release', 'a notice appears when it falls due while the page is open'] }]))], watch: 'Spreads on the live feed usually widen around High releases; that comes from the market, not from the app.', use: 'Plan stops and size around the High releases of your currencies.' });
    if (c.src === 'down') return card({ title: 'Calendar unavailable', chip: 'it is tried again in a couple of minutes', tone: 'warn', plain: 'The calendar could not be loaded, so the table is empty. The app asks again about every 2 minutes.' + (err ? ' The last error was: ' + esc(err) + '.' : ''), watch: 'Without the calendar, a release can arrive with no warning here.', use: 'Check an outside calendar before trading around news until this one returns.' });
    return card({ title: 'Where the calendar comes from', chip: 'built-in events: not the real calendar', tone: 'warn', plain: 'There are no live prices in this session, so the table shows <b>built-in events</b>, not the real calendar. When one releases, its surprise against the forecast moves its currency, and High releases widen the spreads of that currency (×2 to ×4) from 2 minutes before to 2 minutes after.',
      watch: 'Do not use these events to plan real trades.', use: 'Use it to practise stops around releases.' }); });
})();
