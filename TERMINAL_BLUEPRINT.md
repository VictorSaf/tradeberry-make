# trade.Berry — Trade Terminal Blueprint

## 1. Product north star

trade.Berry should feel calm before it feels powerful.

The terminal is not a collection of panels. It is one continuous decision loop:

1. **Orient** — understand account and market state.
2. **Select** — choose an instrument intentionally.
3. **Analyse** — form a thesis and define invalidation.
4. **Structure** — choose entry, size, protection and target.
5. **Review** — understand risk, cost and portfolio impact.
6. **Execute** — send one explicit instruction.
7. **Manage** — protect, reduce, close or document the position.
8. **Reflect** — learn from the closed trade.

Every permanent UI element must support one of these tasks. Everything else is contextual or on demand.

## 2. Current-system diagnosis

### Scale

- Five desktop workspaces: Trade, Markets, Research, Lab and Coach.
- Five separate mobile destinations: Chart, Trade, Markets, Portfolio and Tools.
- Over 180 identifiable controls and live surfaces in the HTML shell.
- Approximately 6,100 lines across the ten modules that directly drive Trade.
- Several generations of CSS rules override the same components.
- User preferences are distributed between account state and multiple local-storage keys.

### Structural problems

1. **Several navigation models coexist**
   - workspaces in the header;
   - dock tabs;
   - market-intelligence tabs;
   - layout presets;
   - mobile destinations;
   - command-bar navigation.

2. **The screen exposes multiple phases at once**
   - discovery, analysis, order construction and position management compete for space.

3. **Data is repeated without a hierarchy**
   - P&L, margin, spread and market state appear in several regions.

4. **Guided and Pro currently differ mostly by visibility**
   - a real Guided experience needs a different task sequence, not only fewer buttons.

5. **Layout adaptation can feel unpredictable**
   - automatic resizing must be tied to an explicit user phase and be reversible.

6. **The order ticket contains two products**
   - a learning flow;
   - an expert blotter.
   These require shared calculations but distinct presentations.

7. **Position management is table-first**
   - the user sees records before understanding total risk and portfolio condition.

## 3. Target information architecture

### Global layer

Always available, never dominant:

- brand;
- workspace navigation;
- account equity;
- total open P&L;
- account menu;
- command bar.

Balance, free margin, leverage, simulation controls and display settings move behind account or environment controls.

### Trade workspace

#### A. Instrument navigator

Purpose: selection, not analysis.

Permanent:

- search;
- favourites;
- instrument groups;
- symbol, bid, ask and daily change;
- selected instrument.

Contextual:

- day range;
- spread warning;
- session state;
- current exposure.

Removed from this surface:

- deep specifications;
- multi-factor analysis;
- trading ideas.

#### B. Analysis canvas

Purpose: understand price and structure.

Permanent:

- instrument identity;
- price and daily change;
- timeframe;
- chart;
- active-position and order levels.

Contextual:

- Decision Context Bar;
- indicator controls;
- drawings;
- multi-chart;
- market brief.

The canvas remains visually dominant in every desktop state.

#### C. Execution workspace

Purpose: turn a thesis into a bounded instruction.

Guided sequence:

1. Direction.
2. Size.
3. Stop.
4. Target.
5. Entry.
6. Review.
7. Execute.

Pro structure:

- side and order type;
- linked quantity/risk fields;
- linked stop fields;
- linked target fields;
- execution constraints;
- persistent review summary;
- execute.

Both use one calculation engine and one validation model.

#### D. Management dock

Purpose: understand and manage existing obligations.

Summary before rows:

- open P&L;
- gross exposure;
- protected positions;
- winners/losers;
- margin used;
- drawdown.

Primary tabs:

- Positions;
- Orders;
- Activity;
- Alerts.

Journal belongs to Coach. Research and Lab tools never appear in the Trade dock.

## 4. Explicit workspace states

### State 0 — Observe

Trigger:

- Trade opens;
- no ticket interaction;
- no position selected.

Hierarchy:

1. Chart.
2. Instrument navigator.
3. Account risk.
4. Order-entry invitation.
5. Positions summary.

Rules:

- ticket stays compact;
- drawing and multi-chart controls are hidden in Guided;
- empty position management remains one compact band.

### State 1 — Prepare

Trigger:

- Buy or Sell selected;
- order prefilled from chart, depth, brief or command bar.

Hierarchy:

1. Ticket and pre-trade verdict.
2. Chart with planned entry/SL/TP.
3. Decision Context Bar.
4. Existing portfolio impact.
5. Instrument navigator.

Rules:

- ticket may gain width once, with a visible transition;
- existing positions never disappear;
- all layout changes reverse on Clear or successful execution;
- no market movement triggers layout changes.

### State 2 — Review

Trigger:

- user reaches Check;
- all required values exist.

Hierarchy:

1. Maximum loss.
2. Risk as percentage of equity.
3. R:R and break-even rate.
4. Margin after fill.
5. spread, commission, swap and slippage.
6. Correlated exposure and event risk.
7. Final instruction.

Rules:

- one verdict;
- warnings ordered as Block, Risk, Context;
- no duplicated numbers;
- CTA contains the complete instruction.

### State 3 — Manage

Trigger:

- a position is opened or selected.

Hierarchy:

1. Position P&L and risk.
2. Stop and target.
3. Portfolio exposure.
4. Chart and position levels.
5. Reduce, break-even, reverse and close.

Rules:

- management actions live with the selected position;
- close and reverse remain explicit destructive actions;
- the order ticket returns to Observe unless the user pins it.

### State 4 — Inspect

Trigger:

- user opens market intelligence, specifications, drawing tools or another analysis layer.

Rules:

- contextual panels overlay or replace secondary surfaces;
- chart dimensions remain stable;
- Escape returns to the previous state;
- only one inspection layer may be open.

## 5. Guided vs Pro contract

### Guided

- one decision at a time;
- plain-language labels;
- risk entered primarily as percentage or amount;
- progressive disclosure;
- automatic review step;
- one chart;
- no one-click trading;
- advanced execution settings hidden;
- layout changes follow explicit workflow states.

### Pro

- all linked fields visible;
- quantity-first and risk-first sizing;
- multi-chart and drawing tools;
- keyboard workflow;
- one-click trading as an explicit opt-in;
- stable user-controlled layout;
- advanced order and execution settings;
- no automatic panel resizing.

Switching modes never changes order values.

## 6. Visual hierarchy contract

### Accent use

trade.Berry amber means:

- selected;
- current;
- focused;
- editorial emphasis.

It never means:

- profit;
- warning;
- primary trade direction.

### Direction and state

- price direction: configured up/down palette;
- buy/sell: directional palette;
- valid/safe: semantic success;
- blocked/error: semantic danger;
- caution: semantic warning.

### Typography

- editorial typography is reserved for Opening Note and high-level learning;
- terminal labels use the product sans;
- all decision figures use tabular mono;
- labels never compete with values;
- no value below 11 px on desktop or 12 px on mobile.

### Density

- one 40 px title rhythm;
- one 30–32 px control rhythm;
- one 38–40 px data-row rhythm;
- 8 px workspace gutters;
- no nested borders where a surface change already defines hierarchy.

## 7. Interaction contract

- Hover explains; click acts.
- Every icon-only control has a label and tooltip.
- Every destructive action requires an unambiguous target.
- Every layout movement follows a user action, never a price tick.
- Every modal/drawer returns focus to its trigger.
- Escape closes the topmost contextual layer.
- Undo is preferred after reversible organisational actions.
- Trade execution remains explicit and never uses optimistic UI.

## 8. Responsive model

### Desktop ≥ 1440

- instrument navigator;
- chart;
- execution workspace;
- management dock;
- contextual intelligence drawer.

### Laptop 1081–1439

- narrower instrument navigator;
- chart remains at least 45% of usable width;
- execution workspace fixed within safe bounds;
- secondary metrics collapse;
- intelligence overlays the chart edge rather than shrinking it.

### Tablet 721–1080

- chart and ticket become sequential primary surfaces;
- positions remain available without returning to navigation;
- horizontal metric strips may scroll;
- no desktop hover dependency.

### Phone ≤ 720

Task destinations:

- Chart;
- Trade;
- Markets;
- Portfolio;
- Tools.

The phone does not reproduce desktop panels. Each destination is a complete focused task.

## 9. Implementation boundaries

### Keep

- market engine;
- chart engine;
- ticket calculations;
- risk validation;
- persistence;
- position/order records;
- workspace modules;
- accessibility infrastructure;
- keyboard command system.

### Refactor

- Trade shell markup;
- duplicated navigation;
- ticket presentation state;
- dock information architecture;
- panel visibility preferences;
- late CSS override layers.

### Do not combine

- product-state refactor and financial-calculation changes;
- visual redesign and engine changes;
- desktop and mobile markup assumptions;
- AI content generation and trading decisions.

## 10. Delivery milestones

### Milestone A — Foundation

- freeze behavioural baseline;
- visual regression references for desktop/tablet/mobile;
- consolidate semantic tokens;
- define component primitives;
- remove contradictory terminal CSS layers.

Exit criteria:

- one source of truth for panel, control, table, tab and status styles;
- no functional change.

### Milestone B — Observe

- rebuild global header;
- rebuild instrument navigator;
- rebuild chart header and Decision Context Bar;
- compact idle ticket;
- compact empty management dock.

Exit criteria:

- a new user can identify account state, instrument, price, chart and order entry in five seconds.

### Milestone C — Prepare and Review

- final Guided flow;
- final Pro layout;
- stable planned-order overlays;
- portfolio-impact preview;
- risk verdict;
- warning hierarchy;
- complete CTA.

Exit criteria:

- every order type can be built, reviewed, edited and cancelled without losing values;
- keyboard and touch paths work.

### Milestone D — Manage

- portfolio summary;
- position selection;
- contextual management inspector;
- stop/target editing;
- partial close, break-even, reverse and close;
- pending-order management.

Exit criteria:

- users can understand total open risk before reading individual rows;
- management actions never require hunting across panels.

### Milestone E — Responsive and accessibility

- tablet task layout;
- phone destinations;
- screen-reader announcements;
- focus restoration;
- zoom and text-resize verification;
- reduced-motion verification.

### Milestone F — Validation

- workflow tests;
- state-transition tests;
- screenshot matrix;
- performance pass;
- copy pass;
- empty, loading, closed-market, off-quotes and error states.

## 11. Acceptance tests for the core loop

1. Select an instrument from search, favourites and Markets.
2. Switch timeframe without losing ticket state.
3. Start Buy and Sell from ticket, chart, depth, brief and command bar.
4. Build market, limit and stop orders.
5. Size from lots, risk percentage and risk amount.
6. Edit stop by price, distance and ATR.
7. Edit target by price, distance and R.
8. Review cost, margin, risk, correlation and event warnings.
9. Clear without losing reusable defaults.
10. Execute and observe the new position.
11. Edit SL/TP from chart and management workspace.
12. Partially close, break even, reverse and close.
13. Confirm history and Coach receive the closed trade.
14. Repeat on tablet and phone.
15. Repeat with keyboard only and reduced motion.

## 12. Immediate recommendation

Do not add another visual layer.

The next implementation should begin with **Milestone A**: consolidate the terminal design system and produce stable visual baselines. After that, rebuild the **Observe** state as one complete surface before touching Prepare, Review or Manage.
