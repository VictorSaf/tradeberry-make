/* tradeBerry — Teach me: one entry in the user menu. teachMe() walks the page that is open now, element by element
   (teachTour, brief.js). Market Brief and the Observatory keep their own walks (brTeach, OBS_TEACH); every other page
   has its steps here. A step is [getElement, title, () => [what, read, use]]; steps not on screen are skipped. */
(function teach() {
  const q = s => () => document.querySelector(s);
  const up = (s, c) => () => document.querySelector(s)?.closest(c) || null;
  // the card of a page whose heading starts with `text`
  const sec = (root, text, c = 'section,.bt-sec,.calc,.bh-card') => () => [...document.querySelectorAll(root + ' h3')].find(h => h.textContent.trim().startsWith(text))?.closest(c) || null;
  const bhPg = k => () => { const b = document.querySelector(`#behav .bh-pgs [data-bhpg="${k}"]`); if (b && !b.classList.contains('on')) b.click(); };
  const tx = s => (document.querySelector(s)?.innerText || '').replace(/\s+/g, ' ').trim();
  // a part of the ticket inside Advanced and its sections: explained only while every fold around it is open
  // (an element inside a closed <details> still reports a box)
  const adv = s => () => { const e = document.querySelector(s); return e && !e.parentElement.closest('details:not([open])') ? e : null; };

  const NAV = [
    [q('#views'), 'Workspaces', () => ['The five pages of the terminal: Trade, Monitor, Research, Strategy Lab and Coach.', 'The highlighted one is the page you are on. Each page keeps the tool you last opened in it.', 'Click a page or press Alt+1 … Alt+5. Teach me in the account menu always explains the page that is open.']],
  ];
  const TABS = name => [[q('#tabs'), name + ' tools', () => ['The tool strip of this page.', 'The highlighted tab is the tool on screen; the numbers count what is open (positions, orders, alerts).', 'Click a tab to switch tools; run Teach me again to have the new tool explained.']],
    [q('#guideBtn:not([hidden])'), 'Guide', () => ['The written guide of the tool on screen, in a new tab.', 'It explains every part of the tool, how each number is calculated and how to use it, with diagrams and examples.', 'Read it once in full; Back to the terminal brings you back here.']]];
  const ACCT = [
    [q('#acct'), 'Account at a glance', () => [`Equity, open P&L and margin level of the account: ${tx('#acct').slice(0, 80)}.`, 'Equity = balance + open P&L. Margin level = equity ÷ used margin; “—” means nothing is open.', 'Watch the margin level when you add positions: the lower it gets, the closer a stop-out. The arrow shows balance and free margin.']],
    // the first row says the account type, in persist.js's words (acctKind().line), read when the step shows
    [q('#userBtn'), 'Account menu', () => { const live = typeof TradeLink === 'object' && TradeLink.live, k = typeof acctKind === 'function' ? acctKind() : null; const rest = live ? 'who is signed in, the save state of your preferences, Export / Import (preferences only: the account is the execution server’s) / Reset (demo accounts), the page guides, Help and Teach me.' : 'who is signed in, the save state, Export / Import / Reset, the page guides, Help and Teach me.'; return [k ? `Its first row is the account type: ${k.line}. Under it: ${rest}` : rest[0].toUpperCase() + rest.slice(1), 'The dot on the avatar is the sync state when signed in: amber while saving, red on a problem.', live ? 'Your trades and balance live on the execution server and follow you to any browser where you sign in; Export keeps a copy of your interface preferences.' : 'Export the account regularly: the file is your own copy of trades, journal and settings.']; }]
  ];
  const STATUS = [
    [q('#feedPill'), 'Price source', () => [`The dot in the header says where prices come from: now ${tx('#feedPill')}.`, 'Filled green: live prices from the broker platform. Red ring: the platform has stopped answering, prices are frozen and trading pauses. Grey ring: no live prices reach the terminal.', 'Hover it for the details. If it is not green, do not trade on the prices you see.']],
    [q('#tlBar'), 'Execution server', () => [`The link to the server that holds your account: ${tx('#tlBar')}`, 'While it is not reachable nothing can be sent, and the account on screen is the last one seen.', 'It reconnects by itself; check the account once it is back.']],
  ];

  // header steps shared by every page: a new user's first-visit walks show them once (shared, teachTour)
  [...NAV, ...ACCT, ...STATUS].forEach(st => { st.shared = true; });

  const TRADE = () => [
    ...NAV,
    [q('.panel.watch'), 'Market watch', () => ['Every instrument with its bid, ask and change: FX, indices, commodities, crypto and stocks.', 'Green and red flash on each tick; the star marks favourites; the class tag shows the leverage cap.', 'Click a row to load it on the chart and the ticket. Type in the search box to filter; “‹” hides the panel.']],
    [q('#wlColsBtn'), 'More columns', () => ['Adds spread, 24 h change and range to the watch.', 'A wide spread is a cost you pay on every entry; the range tells how much the market moved today.', 'Turn it on when you choose what to trade; off when you only need prices.']],
    [q('#wlDet'), 'Instrument details', () => ['The selected instrument’s session state, spread and range.', 'It follows the row you clicked.', 'Check it before trading something new: hours, spread and typical move.']],
    [q('#symName'), 'Instrument', () => [`The instrument on the chart: ${tx('#symName')}${tx('#symCls') ? `, with its state and leverage class (${tx('#symCls')})` : ', with its state'}.`, '“Closed” means the market is shut and orders wait for the open.', 'Click the name to switch instrument; the star adds it to favourites.']],
    [q('#insBtn'), 'Specifications', () => ['The contract sheet: contract size, pip value, trading hours, swaps, minimum and maximum lots.', 'Every figure comes from the instrument sheet of the account profile.', 'Open it before your first trade on an instrument.']],
    [q('#briefBtn'), 'Market brief', () => ['Opens Research › Market Brief for this instrument.', 'The brief reads trend, momentum, levels and events into one plan.', 'Press I from anywhere for the same jump.']],
    [q('#tfSeg'), 'Timeframe', () => ['The period of each candle.', 'Shorter frames show detail and noise; longer frames show the trend.', 'Read the trend on a longer frame, time the entry on a shorter one.']],
    [q('#typeBtn'), 'Chart type', () => ['Candles, Heikin-Ashi or intrinsic-time candles.', 'Intrinsic time draws one candle per move of δ instead of per period; the timeframe buttons then set δ.', 'Candles for execution; Heikin-Ashi to see trend runs; intrinsic time for quiet or hectic markets.']],
    [q('#indBtn'), 'Indicators', () => [`Overlays on the chart; the number counts those switched on (${tx('#indN')}).`, 'EMAs show trend direction and pace; the others are listed with what they measure.', 'Keep two or three: more indicators repeat the same price, they do not add information.']],
    [q('#layBtn'), 'Chart layout', () => ['One, two or four charts side by side.', 'Each chart keeps its own instrument and timeframe.', 'Use two charts for two timeframes of the same instrument. G cycles layouts.']],
    [q('#toolStrip'), 'Chart tools', () => ['Level, Alert, Measure and Clear, plus Trend, Ray, Channel, Fib and Fib extension.', 'Levels and alerts are drawn as lines on the chart; Measure shows the distance between two points.', 'Draw the key levels before entering; place an alert instead of watching the screen.']],
    [q('#mcGrid'), 'Quick trade', () => [`Sell and Buy at the current bid and ask, with the size between them. With One-click trading on they send the order at once; off, they only fill in the ticket; spread ${tx('#qSpread')}.`, 'The left price is where you sell, the right where you buy; the gap is the spread.', 'Use it only with a size you already checked on the ticket. When the market is closed the buttons say so.']],
    [q('#chart'), 'Chart', () => ['Price with your positions, orders, SL and TP drawn as lines.', 'Dashed lines are stop loss and take profit; solid lines are entries and levels.', 'Drag an SL or TP line to change it; use the chart tools to draw levels and place alerts at a price. Scroll left for older prices.']],
    [q('.pv-tkbar'), 'New order', () => ['Shows the order ticket; it opens at the full height of the right column.', 'While the ticket is hidden the market panels (Depth, Stats) can use the column.', 'Open it to size and send an order; Hide on the ticket puts it away again.']],
    [q('#isw'), 'Market panels', () => [`Panels about the instrument on the chart: ${[...document.querySelectorAll('#isw>button')].map(b => b.textContent.trim()).join(', ')}.`, 'Depth is an illustrative ladder of prices above and below the market (fills ignore its sizes); Stats the day’s numbers for the instrument.', 'Click a tab to open its panel beside the ticket; its close button folds it back here.']],
    [q('#tkTypeBand'), 'Order band', () => [`What the ticket will send: ${tx('#tkTypeBand')}.`, 'Green is a buy, red a sell; the second part is the order type and price.', 'Read it last before you press the button: it is the order in one line.']],
    [q('#tkMkt'), 'Market state', () => ['Whether the instrument is open and when it opens or closes.', 'A closed market accepts pending orders only.', 'Plan entries around the open: the first minutes often have wider spreads.']],
    [q('#sideSeg'), 'Side', () => [`Sell at the bid (${tx('#tkBid')}) or Buy at the ask (${tx('#tkAsk')}).`, 'You buy at the higher price and sell at the lower one: the spread is paid on entry.', 'Choose the side that matches your plan; the whole ticket recomputes.']],
    [q('#tkInst'), 'Ticket instrument', () => [`The instrument this ticket trades and its spread now: ${tx('#tkInst')}.`, 'It is always the instrument on the chart; hover it for the contract size.', 'Check the spread before a market order: it is paid on entry.']],
    [q('#otSeg'), 'Order type', () => ['Market or Pending.', 'Market fills now at the quote; Pending waits for a price you set: below the market to buy a pullback, above it to join a breakout (and the reverse for sells).', 'Use Pending for pullbacks and breakouts; Market only when the price now is the price you want.']],
    [q('#tkPend'), 'Pending price and expiry', () => [`Where the pending order waits and for how long: ${tx('#tkPend')}.`, 'The type (limit or stop) follows from the price against the market; GTC stays until cancelled, Day ends at the close, GTD at the date you set.', 'Set the price at the level you planned; give it an expiry so a stale order does not fill days later.']],
    [q('#tkVolBlk'), 'Size', () => [`Lots, the presets and what this size means: ${tx('#sizeHint')}.`, 'The line under it shows the order value as % of equity and the margin it uses.', 'Prefer sizing by risk: set the stop first, then the size that loses only your chosen % at the stop.']],
    [q('#tkExits'), 'Stop loss and take profit', () => [`SL ${tx('#slMoney')} and TP ${tx('#tpMoney')} in money at this size.`, 'Each can be set by price, pips, ATR multiple or risk %; the money value updates as you type.', 'Always set the stop. Put it where the idea is wrong, not where the loss feels small. One position per instrument: an order on the same side adds to it (average price, the position keeps its own SL/TP), an order on the other side reduces or reverses it, and the note above these fields says which.']],
    [q('#tkFootM'), 'Margin, risk and R : R', () => [`What this order costs and risks: ${tx('#tkFootM')}.`, 'Margin is what the order locks (at the leverage shown); Risk is the loss at the stop as % of equity and in money, beside your limit; R : R is target against stop. Hover a row for the break-even win rate.', 'Keep Risk under your limit and R : R at or above what your win rate needs.']],
    [q('#tkGo'), 'Sell / Buy', () => [`Sends a market order now: Sell at ${tx('#tkGoBid')}, Buy at ${tx('#tkGoAsk')}.`, 'Each button sends the size above, with the SL and TP set, at the current price.', 'Check size and stop first; a market order fills at once.']],
    [q('#tkLastFill'), 'Last fill', () => [`Your latest execution: ${tx('#tkLastFill').replace(/\s*Receipt$/, '').replace(/^Last fill:\s*/i, '')}.`, 'Slippage says how far the fill was from the quote, and whether for or against you.', 'Receipt opens the full record of that fill.']],
    [q('#tkAlert'), 'Ticket warnings', () => ['Checks on the order: a stop too close to the spread, too much risk, an event soon.', 'They inform; they do not block the order.', 'Read each one before sending; most of them save a needless loss.']],
    [q('#tkSubmit'), 'Send', () => [typeof TradeLink === 'object' && TradeLink.live ? 'Sends the order exactly as the band describes it to the execution server; the positions table shows it as Sent until the server reports the fill.' : 'Sends the order exactly as the band describes it.', 'Its colour and text follow side and type; when the market is closed it says so.', 'Shift+B / Shift+S fill the ticket from the keyboard. One-click trading is off unless you turn it on.']],
    [q('#tkOnSym'), 'On this instrument now', () => [`Your net position on this instrument: ${tx('#tkOnNet')}.`, 'It sums positions and pending orders on the same instrument.', 'Check it before adding: a second order may double the risk you already carry.']],
    [q('#tkAdv'), 'Advanced', () => [`Trailing stop, break-even, split exits, the order checks and the full statistics: ${tx('#tkAdvS')}.`, 'A trailing stop follows price at a fixed distance; break-even moves the stop to entry after a profit.', 'Use break-even after the first target; trail only in a clear trend. Open it (and any of its sections) and run Teach me again to have each part explained.']],
    [adv('#tkSecs>details:nth-child(1)'), 'Management', () => [`How the position is managed after the fill: ${tx('#tkSecs>details:nth-child(1)>summary').replace(/^Management\s*/i, '')}.`, 'Split exits close part at a first target; the trailing stop follows price; break-even moves the stop to entry once the trade is far enough in profit.', 'Decide these before you send: changing them mid-trade is usually fear or greed.']],
    [adv('#tkSecs>details:nth-child(2)'), 'Costs and checks', () => [`What the order costs and what the checks say: ${tx('#tkSecs>details:nth-child(2)>summary').replace(/^Costs & checks\s*/i, '')}.`, 'Spread cost on entry, the swap charged for each night held, and the notes from the order checks; inside are risk : reward, the full statistics and how fills work.', 'Open it before a new kind of trade; read every note.']],
    [adv('#tkSecs>details:nth-child(3)'), 'Account after', () => [`The account once this order fills: ${tx('#tkSecs>details:nth-child(3)>summary').replace(/^Account after\s*/i, '')}.`, 'Margin level after the fill and how far price must go against you before a stop-out.', 'If the stop-out is near, reduce the size before sending.']],
    [adv('#tkRrCap'), 'Risk : reward', () => [`Money at the stop against money at the target: ${tx('#tkRrCap').replace(/^Risk : reward/, '')}.`, 'The bar shows the two side by side; the stats below give the break-even win rate.', 'If you win less often than the break-even rate, the plan loses money however good each trade looks.']],
    [adv('#tkExecNote'), 'How fills work', () => ['The execution rules: all-or-nothing fills, symmetric slippage.', 'It is the same for every order.', 'Hover it for the full model before judging a fill.']],
    [adv('#tkStats'), 'Order statistics', () => ['Spread cost, risk as % of equity, break-even win rate and margin of this order.', 'Every figure is for the size and exits in the ticket now.', 'Use the break-even win rate to decide whether the trade is worth taking.']],
    [adv('#tkWhatIf'), 'Account after this order', () => ['Equity, margin, free margin and margin level now and after the fill.', 'The change column is what this order adds.', 'If margin level after the order is low, reduce the size before sending.']],
    ...TABS('Trade'),
    [q('.tab.on[data-pane="positions"]'), 'Positions', () => ['Open positions: instrument, side, lots, price, SL, TP and P&L; one position per instrument.', 'P&L is at the current bid or ask; the total row adds them up.', 'Actions: ½ closes half, BE moves the stop to entry, Rev reverses, ✕ closes. Drag SL and TP on the chart.']],
    [q('.tab.on[data-pane="orders"]'), 'Orders', () => ['Pending orders: type, lots, price, distance, SL and TP.', 'Distance is how far price must travel to fill the order.', 'Click the SL or TP cell to set, change or remove them (a price or a distance); they apply when the order fills.', 'Cancel orders whose reason is gone; move the price from the chart.']],
    [q('.tab.on[data-pane="history"]'), 'History', () => ['Closed trades: entry, exit, pips, R and P&L, with the reason each one closed.', 'R is the result in multiples of the risk taken.', 'Look at R, not money: it shows whether losses stay small and wins run.']],
    [q('.tab.on[data-pane="alerts"]'), 'Alerts', () => ['Price alerts: instrument, condition, price, distance and status.', 'Status says whether the alert waits or has fired.', 'Add one from the form or from the chart instead of watching the screen.']],
    ...(document.querySelector('.tab.on[data-pane="journal"]') ? JOURNAL().slice(-4) : []),
    ...ACCT,
    [q('#cmdBtn'), 'Command bar', () => ['Type orders and jump to any tool.', '“buy 1 eurusd sl 20 tp 40” is filled into the ticket for you to check.', 'Press ⌘K / Ctrl K anywhere.']],
    [q('#rpBtn'), 'Market replay', () => ['Plays recorded market days bar by bar.', 'The future stays hidden: you see only what a trader saw then.', 'Practise a setup on past days, then compare with the result.']],
    [q('#sonBtn'), 'Listen to the market', () => ['Turns price movement into sound.', 'Pitch follows price; density follows activity.', 'Use it to keep an ear on a market while you read elsewhere.']],
    ...STATUS
  ];

  const MONITOR = () => [
    ...NAV,
    [q('#monitor .ph'), 'Quote monitor', () => ['A dense board of every quote, one cell per instrument.', 'The board updates on every tick.', 'Use it to see the whole market at once: the name shows the instrument on the chart, Sell and Buy open the ticket.']],
    [q('#monFilter'), 'Asset filter', () => ['All, FX, Indices, Commodities, Crypto, Stocks.', 'The highlighted class is on the board.', 'Pick the class you trade to keep the board short.']],
    [q('#monitor .mon-sortbtn'), 'Sort', () => ['The order of the cells: Default, Change, Biggest movers or Range vs ATR.', 'The board re-sorts as values change.', 'Biggest movers finds who moves most now; Range vs ATR who has used the most of a normal day.']],
    [q('#monitor .mon-dentg'), 'Density', () => ['Compact or detailed cells; click to switch.', 'Compact fits more instruments on screen; detailed shows more per cell.', 'Compact to scan the market, detailed to study a few instruments.']],
    [q('#monBoard .mq'), 'One quote cell', () => [`Name, mid price and change; sell and buy; the day’s low and high; activity and ATR. Example: ${tx('#monBoard .mq').slice(0, 90)}.`, '“× typ” compares activity with a usual day; ATR is the typical move of one hour.', 'A cell far above typical activity is where the market is moving now. Click the name to chart it, Sell or Buy to open the ticket.']],
    [q('#monBoard .mq .mq-rg'), 'Day range', () => ['The low and the high of the day with price between them.', 'Price near an end means the market is testing the day’s extreme.', 'At an end, wait for a break or a rejection before trading it.']],
    ...TABS('Monitor'),
    ...ACCT
  ];

  const CORR = () => [
    ...NAV, ...TABS('Research'),
    [q('#corrSet'), 'Instrument set', () => ['G8 currencies or your own instruments.', '“Yours” uses the instruments you trade and watch.', 'Use Yours to see whether your positions are really different bets.']],
    [q('#corrSeg'), 'Window', () => ['How much history the correlation is measured on: 4 hours, 1 day or 3 days.', 'Short windows react quickly and are noisy; long windows are stable.', 'Compare 4H with 3D: a pair that changed recently shows a different colour.']],
    [q('#corrRet'), 'Return step', () => ['The step of the returns compared: 1 minute, 15 minutes or 1 hour.', 'Short steps include microstructure noise; longer steps show the true co-movement.', 'Use 15m or 1h for decisions; 1m for intraday hedges.']],
    [q('#corrOrd'), 'Order', () => ['Default order or clustered.', 'Cluster puts instruments that move together next to each other, forming blocks.', 'Use Cluster to see groups: one block is one bet, however many pairs it contains.']],
    [q('#corr'), 'Correlation matrix', () => ['Each cell is the correlation between two instruments, from −1 to +1.', 'Strong colour near +1 means they move together; near −1 they move opposite; pale is unrelated.', 'Two positions on pairs above +0.7 in the same direction double the risk; on pairs near −0.7 they cancel.']],
    [q('#corrLeg'), 'Colour scale', () => ['The key from −1 to +1.', 'The stronger the colour, the stronger the link.', 'Read the colour first, then hover a cell for the exact value.']],
    [q('#corrSum'), 'Summary', () => [`What the matrix says in words: ${tx('#corrSum').slice(0, 110)}.`, 'It names the strongest links and the most independent instruments.', 'Pick the most independent instruments when you want to spread risk.']]
  ];

  const VOL = () => [
    ...NAV, ...TABS('Research'),
    [q('.vol-intro'), 'Volatility', () => ['How much each instrument moves: the ATR of one hour against its week, and where price sits in the last 24 hours.', 'ATR (average true range) is the typical size of one bar.', 'Size stops from ATR: a stop inside one ATR is likely to be hit by noise.']],
    [q('.vol-sum'), 'Summary', () => [`The headline: ${tx('.vol-sum').slice(0, 150)}.`, '“Busier than usual” above 1× means the market moves more than in a normal week.', 'In a busy market use wider stops and smaller size; in a quiet one expect less.']],
    [q('#volSort'), 'Sort', () => ['By volatility, by change against the week, or by price at an end of the range.', 'The table re-orders at once.', 'Sort “At an end” to find instruments testing their 24 h high or low.']],
    [q('.vhead'), 'Columns', () => ['ATR of one hour, as % of price and in pips or points; vs week; 24 h range; and price in that range.', '% of price lets you compare instruments of different price; pips is what your stop is measured in.', 'Use pips for stop distance, % to compare markets.']],
    [q('.vcard'), 'One row', () => [`The most volatile now: ${tx('.vcard').slice(0, 80)}.`, '“vs week” above 1× (in bright text) is busier than its own week; the bar shows price between the 24 h low (L) and high (H).', 'Click a row to open the instrument on the chart.']],
    [q('.vcard .vpos'), 'Price in the 24 h range', () => ['Where price sits between the day’s low and high, in %.', 'Near 0% it is at the low, near 100% at the high.', 'At an extreme, wait for confirmation: breaks and reversals both start there.']]
  ];

  const CAL = () => [
    ...NAV, ...TABS('Research'),
    [q('#calF'), 'Filters', () => ['Impact (High, Med, Low; each one on or off) and currency.', 'Only the releases that pass both filters are listed.', 'Keep High and Med on and pick the currencies of the pairs you trade.']],
    [() => document.querySelector('.tab[data-pane="calendar"] thead'), 'Economic calendar', () => ['Scheduled releases: time (UTC), time left, currency, event, impact, forecast, previous and actual.', 'Times are UTC. “In” counts down to the second for Med and High releases due within 24 hours.', 'Check it every morning: high-impact releases move their currency within seconds.']],
    [q('#calBody tr:not(.cal-lo-g)'), 'One release', () => [`Example: ${tx('#calBody tr:not(.cal-lo-g)').slice(0, 90)}.`, 'Actual against forecast is the surprise; actual values are not in this feed, so read them on the release.', 'A surprise above forecast usually strengthens the currency, below weakens it.']],
    [q('#calBody .cal-x'), 'What the indicator means', () => ['Click a Med or High event name for a short note on that indicator.', 'It says what the release measures, how to read it against forecast and previous, and how it can move the market, with its sources.', 'Read it before a release you have not traded around before.']],
    [q('#calBody .cal-lo-g'), 'Low-impact releases', () => [`${tx('#calBody .cal-lo-g').replace(/^[▸▾]?\s*LOW\s*/, '').replace(/\s*(Show|Hide)$/, '')}.`, 'Low-impact releases are folded into this line; they rarely move prices.', 'Click it (or press Enter) to list them in time order; click again to fold them.']],
    [() => [...document.querySelectorAll('#calBody td')].find(td => /^(HIGH|MED|LOW)$/i.test(td.textContent.trim())), 'Impact', () => ['How much the release usually moves the market: LOW, MED or HIGH.', 'HIGH events (rates, jobs, inflation) move prices the most.', 'Avoid opening trades just before HIGH events; tighten or close positions on that currency.']],
    [q('#calFoot'), 'Source', () => [tx('#calFoot'), 'Times, impact, forecast and previous for each release.', 'Plan stops around high-impact releases.']]
  ];

  const BT = () => [
    ...NAV, ...TABS('Strategy Lab'),
    [q('#btCfg'), 'Backtest settings', () => ['The rules of the strategy to test, from instrument to costs.', 'Every field below is part of one strategy.', 'Change one thing at a time, then run again: otherwise you cannot tell what helped.']],
    [q('#btSym'), 'Instrument and history', () => ['Instrument, timeframe, direction and how much history.', 'Backtests run on the platform\'s own prices: the weeks before the live week are fetched from the platform when you press Run. More history means more trades and a more reliable result.', 'Test on at least several hundred bars; a handful of trades proves nothing.']],
    [sec('#btCfg', 'Strategy', '.bt-sec'), 'Strategy', () => ['The strategy template the rules start from.', 'It fills indicators and entries with a known setup.', 'Start from a template, then change its parameters.']],
    [sec('#btCfg', 'Indicators', '.bt-sec'), 'Indicators', () => ['The indicators the entry rules can use, with their periods.', 'Each one appears in the condition lists below.', 'Keep periods round and few: tuned periods fit the past, not the future.']],
    [sec('#btCfg', 'Long entry', '.bt-sec'), 'Long entry', () => ['The conditions for a buy; all must be true on the bar close.', 'A trade opens on the next bar.', 'Fewer conditions give more trades; each extra condition must earn its place.']],
    [() => [...document.querySelectorAll('#btCfg h3')].find(h => h.textContent.trim().startsWith('Short entry')) || null, 'Short entry', () => ['The conditions for a sell.', 'Same rule: all true on the bar close.', 'Mirror the long rules unless you have a reason not to.']],
    [sec('#btCfg', 'Exits', '.bt-sec'), 'Exits', () => ['Stop (ATR multiple or pips), target in R, maximum bars, opposite signal, trailing stop and break-even.', 'Target in R is a multiple of the stop distance.', 'Exits change results more than entries: test them deliberately.']],
    [sec('#btCfg', 'Sizing', '.bt-sec'), 'Sizing and costs', () => ['Risk per trade, slippage, out-of-sample share and which costs are charged.', 'Out-of-sample keeps the last part of history unseen while you build the rules.', 'Judge the strategy on the out-of-sample part; results without costs are fiction.']],
    [q('#btRun'), 'Run', () => ['Runs the backtest with the settings above.', '“Run on all FX pairs” tests the same rules on every pair.', 'A strategy that works on one pair only is usually fitted to it.']],
    [q('#btVerdict'), 'Verdict', () => [tx('#btVerdict').slice(0, 160), 'It states the result after costs in one sentence.', 'Read it before the numbers: it already says whether there is anything here.']],
    [q('#btOut .bt-kpis'), 'Results', () => ['Net P&L, return, trades, win rate, profit factor, expectancy, drawdown, market move, Sharpe, hold time, time in market and worst streak.', 'Profit factor above 1 and positive expectancy (in R) are the minimum; compare with “Market move” to see whether it beat simply holding.', 'Look at max drawdown and worst streak: they decide whether you could live with it.']],
    [q('#btCanvas'), 'Equity curve', () => ['The account balance trade by trade.', 'A smooth rising line is good; long flat or falling stretches are drawdowns.', 'Check where the losses cluster: a strategy that earns in one stretch only is luck.']],
    [q('#btHonest'), 'Out-of-sample check', () => ['The result on the history kept unseen.', 'If it is much worse than in-sample, the rules are fitted to the past.', 'Trust only strategies that hold up here.']],
    [q('#btToLab'), 'Send to Risk Lab', () => ['Takes the win rate and reward : risk to the Monte Carlo stress test.', 'Risk Lab shows the range of outcomes, not one path.', 'Use it to see the drawdowns this strategy can produce.']],
    [q('#btCsv'), 'Export CSV', () => ['Downloads the trade list.', 'One row per trade with entry, exit and result.', 'Open it in a spreadsheet to check any trade by hand.']]
  ];

  const LAB = () => [
    ...NAV, ...TABS('Strategy Lab'),
    [q('#labForm'), 'Monte Carlo stress test', () => ['Draws 1,000 random sequences of trades with your win rate, reward : risk and risk per trade.', 'Each path is one possible order of wins and losses.', 'Use it to see what a run of bad luck can do to the account.']],
    [q('#lWin'), 'Win rate', () => ['The share of trades that win, in %.', 'Use your real win rate, not the one you hope for.', '“Use my journal” fills it from your closed trades.']],
    [q('#lRR'), 'Reward : risk', () => ['Average win divided by average loss.', 'With 1:2 you need only one win in three to break even before costs.', 'Lower it for costs: spread and slippage cut every win.']],
    [q('#lRisk'), 'Risk per trade', () => ['The % of equity lost at each stop.', 'It changes the size of the drawdowns, not the edge.', 'Lower it until the drawdowns below are ones you could stand.']],
    [q('#lN'), 'Trades', () => ['How many trades each path has.', 'More trades let the edge show; few trades are mostly luck.', 'Set it to the number of trades you take in the period you plan for.']],
    [q('#labFromJ'), 'Use my journal', () => ['Fills win rate and reward : risk from your closed trades.', 'It uses your record, so the result is about you.', 'Run it monthly to see whether your odds improve.']],
    [q('#labToChal'), 'Challenge odds', () => ['Runs your trades against the challenge rules in Coach.', 'It gives the chance of passing with your current numbers.', 'Use it before paying for a real challenge.']],
    [q('#labOut'), 'Outcomes', () => [tx('#labOut') ? `${tx('#labOut').slice(0, 160)}.` : 'The results of the 1,000 paths: median, percentiles, drawdowns and risk of ruin.', 'Median is the typical path; 5th and 95th percentiles are bad and good luck; expectancy is the average R per trade; P(DD > 20%) is the chance of a 20% drawdown on the way; risk of ruin is the chance of losing half.', 'Decide on the 5th percentile and the drawdown odds, not on the median.']],
    [q('#labCanvas'), 'Equity paths', () => ['A sample of the random equity paths.', 'The spread of the fan is the role of luck.', 'A wide fan means the result depends on luck more than on skill: lower risk per trade.']]
  ];

  const CALC = () => [
    ...NAV, ...TABS('Strategy Lab'),
    [sec('.tab[data-pane="calc"]', 'Position size', '.calc'), 'Position size', () => [`Lots for a given account, risk % and stop: ${tx('#cpOut').slice(0, 110)}.`, 'Amount at risk = account × risk %; lots = amount ÷ (stop pips × pip value).', 'Set the stop where the idea is wrong first, then let the calculator give the size.']],
    [sec('.tab[data-pane="calc"]', 'Pip', '.calc'), 'Pip value and margin', () => [`What one pip and one position cost: ${tx('#pvOut').slice(0, 110)}.`, 'Pip value scales with lots; margin falls as leverage rises.', 'Check the spread cost: it is paid on every entry.']],
    [sec('.tab[data-pane="calc"]', 'Compounding', '.calc'), 'Compounding', () => [`Where a monthly return leads: ${tx('#cgOut').slice(0, 110)}.`, 'Returns compound: small monthly gains grow, but so do losses.', 'Use realistic monthly returns; anything above a few % a month is rare for long.']]
  ];

  const BEHAV = () => [
    ...NAV, ...TABS('Coach'),
    [q('#behav .bh-pgs'), 'Behaviour pages', () => ['Habits, Pre-mortem and Red flags; the number is how many items each holds.', 'The highlighted page is on screen.', 'Run Teach me again after switching page to have its cards explained.']],
    [q('#behav .bh-score'), 'Behaviour score', () => [`Your score from 0 to 100 with its parts: ${[tx('#behav .bh-score-g'), tx('#behav .bh-score-c')].filter(Boolean).join(' · ').slice(0, 160)}.`, 'Each part measures one habit: holding losers, clean entries, stops kept, forecast skill, discipline.', 'Work on the weakest part named in “Focus next”; the score follows.']],
    [q('#bhReport'), 'Download report', () => ['A file with the whole behaviour analysis.', 'It contains every measure and its source.', 'Keep one each month to compare.']],
    [sec('#behav', 'Disposition'), 'Disposition effect', () => ['Whether you close winners sooner than losers.', 'A ratio above 1 means you realise gains more readily than losses.', 'Let the stop and the target decide the exit, not the feeling.'], bhPg('habits')],
    [sec('#behav', 'Tilt'), 'Tilt guard', () => ['Arms after a run of losses in a row or a day down by a set %, then asks for a pre-mortem on every trade or a cool-down.', 'It counts times triggered, overrides and trades after a loss; many overrides mean the guard is not working for you.', 'Set the trigger and cool-down once while calm; use Pause to step away on your own terms.'], bhPg('habits')],
    [sec('#behav', 'Process'), 'Process vs outcome', () => ['Trades split by process (good or poor) and outcome (won or lost): deserved win, bad break, dumb luck, poetic justice.', 'A good-process loss is a bad break, not a mistake; the line under it shows how many wins came from poor process.', 'Judge yourself on process: results follow over many trades.'], bhPg('habits')],
    [sec('#behav', 'Confidence'), 'Confidence calibration', () => ['How well your confidence before a trade predicted its result (Brier score).', 'Skill (BSS) above 0 means your ratings beat chance; below 0, they mislead you.', 'Rate every trade honestly; size up only where your high-confidence trades really win more.'], bhPg('pm')],
    [sec('#behav', 'Mood'), 'Mood at entry', () => ['Results grouped by the mood you recorded at entry.', 'Moods with a clearly worse result are a warning.', 'Do not trade in the moods that cost you.'], bhPg('pm')],
    [sec('#behav', 'Pre-mortem'), 'Pre-mortem', () => ['Before each trade you name how it could fail; afterwards you mark whether it did.', 'Win rates with and without red flags have confidence ranges; overlapping ranges mean no real difference yet.', 'Set the risk from which it asks (and whether a trade without a stop always asks), then Try it on the ticket. Losses foreseen and the automatic post-mortem show whether your warnings come true.'], bhPg('pm')],
    [sec('#behav', 'Your trading hours'), 'Your trading hours', () => ['Net P&L by the UTC hour you opened each trade, with the worst and best hour.', 'Bars above zero are hours that pay, below zero hours that cost; “may be chance” means too few trades in that hour to tell.', 'Act on an hour only after it has 30+ trades; until then the gap between hours is mostly noise.'], bhPg('flags')],
    [sec('#behav', 'Red-flag scoreboard'), 'Red-flag scoreboard', () => ['Every trade checked at entry against the warnings: chasing an extended move, no stop loss, a stop inside normal noise, too many trades, costs large against the stop and more.', 'For each warning: trades, win rate with its range, average R and net result; the rule column sets whether it only warns or blocks in the pre-mortem.', 'Set the costliest warning to block: it is the cheapest improvement you can make.'], bhPg('flags')]
  ];

  const CHAL = () => [
    ...NAV, ...TABS('Coach'),
    [q('#chal .ch-rules'), 'Challenge rules', () => [`The prop-firm rules practised: ${tx('#chal .ch-rules').slice(0, 120)}.`, 'Target, daily loss, maximum drawdown and minimum days, as published by the firm.', 'Pick the preset of the firm you plan to use, or enter its current rules.']],
    [q('#chAtt'), 'Practice attempt', () => ['A practice run of the challenge on this account.', 'It tracks target, daily loss and drawdown live as you trade.', 'Start one only when you would trade the same way in the real challenge.']],
    [q('#chReady'), 'Readiness', () => [`Whether your record can pass: ${tx('#chReady').slice(0, 120)}.`, 'It needs enough trades and days of your own; demo trades never count.', 'Change risk per trade and horizon to see how the odds move.']],
    [q('#chal .ch-log'), 'Attempt log', () => ['Your finished attempts with their result.', 'It shows where each attempt failed.', 'Look for the rule that ends your attempts most often.']]
  ];

  const JOURNAL = () => [
    ...NAV, ...TABS(currentView() === 'coach' ? 'Coach' : 'Trade'),
    [q('#kpis'), 'Statistics', () => ['Net P&L, trades, win rate, profit factor, average win and loss, expectancy, average R, drawdown, best and worst.', 'Win rate has a confidence range: with few trades it is wide and means little.', 'Expectancy and profit factor tell whether you have an edge; average R whether wins pay for losses.']],
    [q('#eqCanvas'), 'Equity curve', () => ['Account balance across your closed trades.', 'Drops are drawdowns; the steeper the climb, the better the period.', 'Compare it with your notes: find what you did in the good stretches.']],
    [q('#coach'), 'Coach', () => [`What your record says: ${tx('#coach').replace(/^Coach\s*/, '').slice(0, 130)}.`, 'Each line is computed from your trades.', 'Act on the costliest warning first.']],
    [q('#jList'), 'Trade notes', () => ['Every closed trade with side, P&L and your note.', 'Filters show losses, trades without a stop and quick re-entries after a loss.', 'Write why you entered and exited, and what you would change.']]
  ];

  const PAGES = { positions: TRADE, orders: TRADE, history: TRADE, alerts: TRADE, corr: CORR, vol: VOL, calendar: CAL, bt: BT, lab: LAB, calc: CALC, behav: BEHAV, chal: CHAL };

  window.teachMe = function () {
    if (typeof teachTour !== 'function') return;
    const v = typeof currentView === 'function' ? currentView() : 'trade', t = typeof activeTab === 'string' ? activeTab : '';
    if (v === 'monitor') return teachTour(MONITOR(), 'tmTT');
    if (t === 'brief' && typeof brTeach === 'function') return brTeach();
    if (t === 'obs' && typeof OBS_TEACH === 'object' && typeof obsCfg === 'function') { const f = OBS_TEACH[obsCfg().view]; if (f) return f(); }
    if (t === 'journal') return teachTour(v === 'trade' ? TRADE() : JOURNAL(), 'tmTT');
    const f = PAGES[t] || TRADE;
    teachTour(f(), 'tmTT');
  };

  /* A new user (no trades, no positions when the account first loads in this browser) gets Teach me on the first visit
     to every page, and finishes it: no Close, no Esc (teachForced, teachTour). S.set.teach = { auto, seen: {page: true} }
     travels with the other preferences. Not in automated browsers (the tests) or inside the replay window. */
  const pageKey = () => {
    const v = typeof currentView === 'function' ? currentView() : 'trade', t = typeof activeTab === 'string' ? activeTab : '';
    if (v === 'monitor') return 'monitor';
    if (t === 'obs') { let ov = ''; try { ov = typeof obsCfg === 'function' ? obsCfg().view : ''; } catch (e) { /* not built yet */ } return ov ? 'obs-' + ov : ''; }
    if (t === 'journal') return v === 'trade' ? 'trade' : 'journal';
    if (t === 'brief') return typeof brTeach === 'function' ? 'brief' : '';
    return PAGES[t] && PAGES[t] !== TRADE ? t : 'trade';
  };
  const busy = () => document.hidden || document.querySelector('.tour-card, .guide-intro, .onote, .overlay:not([hidden]), dialog[open]') || document.documentElement.classList.contains('onote-open');
  if (!navigator.webdriver && window.top === window) {
    const t0 = Date.now(); let last = '', since = 0;
    setInterval(() => {
      if (typeof S !== 'object' || !S.set || busy()) { last = ''; return; }
      let st = S.set.teach;
      if (!st || typeof st !== 'object' || Array.isArray(st)) {
        if (Date.now() - t0 < 6000) return; // the account (trades, positions) loads from the execution server first
        st = S.set.teach = { auto: !((S.history || []).length || (S.positions || []).length), seen: {} }; save();
      }
      if (st.auto !== true) return;
      if (!st.seen || typeof st.seen !== 'object' || Array.isArray(st.seen)) st.seen = {};
      const k = pageKey();
      if (!k || st.seen[k] === true) { last = ''; return; }
      if (k !== last) { last = k; since = Date.now(); return; }
      if (Date.now() - since < 1500) return; // the page has drawn its content
      const done = () => { st.seen[k] = true; save(); };
      document.querySelectorAll('.tour-chip').forEach(x => x.remove()); S.set.tourSeen = true;
      window.teachForced = { done, skipShared: Object.values(st.seen).includes(true) };
      safe('teach me', window.teachMe);
      if (window.teachForced) { window.teachForced = null; done(); } // no walk for this page
      last = '';
    }, 700);
  }
})();
