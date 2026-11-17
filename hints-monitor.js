/* Hint cards: the Monitor (quote board). Registered on the hint engine (hints-engine.js); style as hints-brief.js.
   Every figure and rule here comes from shell.js (stats(), boardTick/boardSlow, pairsShown, sessOf) and core/account.js (posPnl, pipValue):
   - change     = last price against the close at or before the start of the last 24 h window (not the calendar day);
   - range      = high - low of the last 24 h up to the last bar (a closed market: its last trading day), in pips (FX) or points;
   - x typ      = that range against the mean range of the five previous 24 h windows that traded (1-hour bars); "—" when fewer than five exist;
   - ATR        = ATR(14) on 1-hour bars, Wilder, complete hours;
   - dot        = where the mid sits between the 24 h low and high;
   - sparkline  = closes of the last 24 h, one point per 30 bars plus the last, green when the last is at or above the first.
   No band is invented: only these definitions are quoted. Cards: heading, name, Sell, Buy, the filters, the subgroups and Sort.
   Opt-out (standing rule): Compact / Comfort (plain toggle) and every data cell of the tiles (spread, change, low/high, range bar, sparkline, x typ, range, ATR, position line); the figures stay quoted inside the name and Sell/Buy cards. */
(() => {
  const { add, optout, card, plain, sec, tbl, p, esc, nm, sgn, cls, lbl, U } = HX;
  const tileOf = el => el.closest('.mq');
  const txt = (t, s) => { const e = t && t.querySelector(s); return e ? (e.textContent || '').replace(/\s+/g, ' ').trim() : ''; };
  const meta = sym => { try { return M(sym); } catch (e) { return null; } };
  const unitW = sym => { const m = meta(sym); return m && m.unit === 'pt' ? 'points' : 'pips'; };
  const unitS = sym => { const m = meta(sym); return m && m.unit === 'pt' ? 'pt' : 'p'; };
  const nice = sym => { try { return pretty(sym); } catch (e) { return sym; } };
  const kindOf = sym => { const m = meta(sym); return !m ? '' : m.kind === 'cfd' ? (m.label || '') : `${m.base} vs ${m.quote}`; };
  const sess = t => t.classList.contains('closed') ? (t.title || 'Market closed') : 'Market open';
  // the numbers of one tile, read from what it shows
  const read = t => { const sym = t.dataset.sym, dot = t.querySelector('.mq-rg i i');
    return { sym, name: nice(sym), kind: kindOf(sym), bid: txt(t, '.mq-s span'), ask: txt(t, '.mq-b span'), sp: txt(t, '.mq-sp'), chg: txt(t, '.mq-chg'), lo: txt(t, '.mq-rg span:first-child'), hi: txt(t, '.mq-rg span:last-child'),
      typ: txt(t, '.mq-typ'), rng: txt(t, '.mq-rng'), atr: txt(t, '.mq-atr'), where: dot ? parseFloat(dot.style.left) : null, closed: t.classList.contains('closed'), on: t.classList.contains('on') }; };
  const row = (k, v, on) => ({ c: [k, v], on: !!on });
  const atrN = r => { const v = r.atr.replace('ATR ', ''); return v ? `${v} ${unitW(r.sym)}` : '—'; };
  const closedNote = r => r.closed ? ' The market is closed: the prices are dimmed and the figures are those of its last trading day.' : '';

  // ---- the heading ----
  add('#monitor .mon-ph h2', () => card({ title: 'Quote monitor', chip: 'one tile per instrument: the whole market on one screen', tone: '',
    plain: 'Each tile is one instrument with its live <b>Sell</b> and <b>Buy</b> prices, the 24-hour change, the 24-hour range and the sparkline. Clicking a tile loads that instrument on the Trade chart; <b>Sell</b> and <b>Buy</b> open the ticket on that side. Nothing is sent from here.',
    secs: [sec('What a tile shows', tbl([row('Top line', 'name, spread, 24 h change'), row('Prices', 'Sell (bid) and Buy (ask)'), row('Range bar', '24 h low, where the price sits, 24 h high'), row('Sparkline', 'the last 24 h of closes'), row('Last line', 'range against a typical day, 24 h range, ATR'), row('Position line', 'only when you hold the instrument')]))],
    use: 'Scan with Sort set to Biggest movers to see where the day is happening, then click the name to look at the chart.' }));

  // ---- filters ----
  const inCat = (m, f) => f === 'fav' ? isFav(m.sym) : CAT_OF[m.group] === f;
  const catN = f => { try { const all = listedInstr(); return f === 'all' ? all.length : all.filter(m => inCat(m, f)).length; } catch (e) { return null; } };
  const CAT = { all: ['All', 'Every instrument your profile can list, plus any close-only instrument you still hold.'], fav: ['Favourites', 'The instruments you starred in the Market watch.'], fx: ['FX', 'Currency pairs.'], index: ['Indices', 'Stock indices and rates (the board groups rates with the indices).'], commodity: ['Commodities', 'Metals, energy and agriculture.'], crypto: ['Crypto', 'Crypto against fiat or against other crypto.'], stock: ['Stocks', 'Single shares.'] };
  add('#monFilter button', el => { const f = el.dataset.f, c = CAT[f]; if (!c) return null; const n = catN(f), on = el.classList.contains('on');
    return card({ title: `Filter: ${c[0]}`, chip: on ? 'the board shows this group now' : 'click to show only this group', tone: '', value: n == null ? '—' : String(n), vlabel: 'Instruments in this group', sub: on ? 'shown now' : 'on your profile',
      plain: `${c[1]} The board then lists only these tiles. ${f === 'fx' || f === 'index' || f === 'commodity' ? 'A second row of subgroups appears under it.' : ''}`.trim(),
      secs: [sec('The groups', tbl(Object.keys(CAT).map(k => ({ c: [CAT[k][0], catN(k) == null ? '—' : String(catN(k))], on: k === f }))) + p('A group with no instrument on your profile is hidden.'))],
      use: f === 'fav' ? 'Star the instruments you trade in the Market watch; this is then your short board.' : 'Pick the group you trade, then use Sort to rank it.' }); });
  add('#monSub button', el => { const s = el.dataset.s, all = s === 'all', on = el.classList.contains('on'); let n = null;
    try { const f = document.querySelector('#monFilter button.on'), fk = f ? f.dataset.f : 'all', ps = listedInstr().filter(m => fk === 'all' || inCat(m, fk)); n = all ? ps.length : ps.filter(m => subOf(m) === s).length; } catch (e) { n = null; }
    return card({ title: `Subgroup: ${lbl(el)}`, chip: on ? 'the board shows this subgroup now' : 'click to narrow the board', tone: '', value: n == null ? '—' : String(n), vlabel: 'Instruments in it', sub: all ? 'the whole group' : 'inside the chosen group',
      plain: all ? 'No narrowing: every instrument of the chosen group.' : `Only the instruments of the subgroup <b>${esc(lbl(el))}</b>. The subgroups are the same as in the Market watch (for FX: Majors, Crosses, Exotics; for indices: regions and Rates; for commodities: Metals, Energy, Agriculture).`,
      use: 'Choosing another group above resets this to All.' }); });

  // ---- sort ----
  const SORTS = [['name', 'Default', 'the order of the instrument list'], ['chg', 'Change', 'the highest 24 h change first, the lowest last'], ['abs', 'Biggest movers', 'the largest 24 h change first, up or down'], ['vol', 'Range vs ATR', 'the 24 h range as a multiple of a typical day (the “× typ” figure on each tile) first']];
  add('#monitor .mon-sortbtn', () => { const so = document.getElementById('monSort'), cur = so ? so.value : 'name', c = SORTS.find(s => s[0] === cur) || SORTS[0];
    return card({ title: 'Sort', chip: cur === 'name' ? 'default order: nothing is ranked' : cur === 'vol' ? 'ranked by the 24 h range against a typical day' : `ranked by the ${c[1].toLowerCase()} of the last 24 h`, tone: '', value: esc(c[1]), vlabel: 'Order of the tiles now',
      plain: 'Chooses the order of the tiles. The ranked orders re-sort when you pick them or change the group; the figures on the tiles keep updating.',
      secs: [sec('The four orders', tbl(SORTS.map(s => ({ c: [s[1], s[2]], on: s[0] === cur }))) + p('In every ranked order, markets that are closed go behind the open ones, so a closed market never ranks as a mover.')),
        sec('Read the name carefully', p('“Range vs ATR” ranks by the range against the typical day range (the “× typ” figure), not by the ATR figure. It finds who has used the most of a normal day.'))],
      watch: 'The tile’s “× typ” compares with the five previous days only; an instrument with fewer than five comparable days shows “—” and has no typical day to compare with. In Range vs ATR it is then ranked by its raw 24 h range in pips or points, so it can land among the first tiles without being stretched.',
      use: 'Biggest movers finds where price is moving now; Range vs ATR finds who is stretched against its own normal.' }); });

  // Compact / Comfort is a plain toggle: no card (standing rule), by the same mechanism as the list of opt-outs
  optout('#monitor .mon-dentg');

  // ---- the name ----
  add('#monBoard .mq-nm', el => { const t = tileOf(el); if (!t) return null; const r = read(t);
    return card({ title: `${r.name}`, chip: r.on ? 'this is the instrument on the Trade chart' : 'click to put it on the Trade chart', tone: '', value: esc(r.name), vlabel: r.kind || 'Instrument', sub: r.closed ? 'market closed' : 'market open',
      plain: `Click loads <b>${esc(r.name)}</b> on the chart and in the ticket; the tile is outlined while it is the current one. <b>Enter</b> on the focused name, or a double click on the tile, also opens Trade.${closedNote(r)}`,
      secs: [sec('Now', tbl([row('Sell / Buy', `${r.bid} / ${r.ask}`), row('24 h change', r.chg), row('Spread', `${r.sp} ${unitW(r.sym)}`), row('Session', sess(t))]))],
      use: 'Use the name to look before you act: the chart first, then Sell or Buy.' }); });

  // ---- Sell / Buy ----
  const sideCard = side => el => { const t = tileOf(el); if (!t) return null; const r = read(t), sell = side === 'sell', px = sell ? r.bid : r.ask; let cost = '';
    try { const m = meta(r.sym), q = Engine.quote(r.sym); cost = usdFmt(q.spread * pipValue(r.sym, 1)); } catch (e) { cost = ''; }
    return card({ title: `${sell ? 'Sell' : 'Buy'} ${r.name}`, chip: sell ? 'opens the ticket on the Sell side: nothing is sent' : 'opens the ticket on the Buy side: nothing is sent', tone: '', value: px || '—', vlabel: sell ? 'Bid: where a Sell fills' : 'Ask: where a Buy fills', sub: `spread ${r.sp} ${unitW(r.sym)}`,
      plain: sell ? `A Sell opens a <b>short</b>: you gain when the price falls. It fills at the <b>bid</b>, the lower of the two prices, and you close it at the ask. The click loads ${esc(r.name)} in the ticket with Sell selected and puts the cursor in Lots.`
        : `A Buy opens a <b>long</b>: you gain when the price rises. It fills at the <b>ask</b>, the higher of the two prices, and you close it at the bid. The click loads ${esc(r.name)} in the ticket with Buy selected and puts the cursor in Lots.`,
      secs: [sec('The two prices', tbl([row('Sell (bid)', r.bid, sell), row('Buy (ask)', r.ask, !sell), row('Spread', `${r.sp} ${unitW(r.sym)}${cost ? ' · ' + cost + ' per 1 lot' : ''}`)]))],
      watch: `The spread is paid the moment you enter: the trade starts about ${r.sp} ${unitW(r.sym)} under water.${closedNote(r)}`, use: 'The click only prepares the order. Set the size and the stop in the ticket, then send it there.' }); };
  add('#monBoard .mq-s', sideCard('sell')); add('#monBoard .mq-b', sideCard('buy'));

  // ---- the data cells of the tiles: no card (standing rule: no hover on data cells; Victor, 16.11.2026) ----
  // spread, 24 h change, low / high, range bar, sparkline, x typ, range, ATR and the position line are data, like the cells of Positions and the data tables.
  ['.mq-sp', '.mq-chg', '.mq-rg', 'canvas.mq-sk', '.mq-typ', '.mq-rng', '.mq-atr', '.mq-pn', '.mq-pp'].forEach(s => optout('#monBoard ' + s));
})();
