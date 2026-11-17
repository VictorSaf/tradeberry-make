# trade.Berry — focused UX sample audit

## Scope

Representative surfaces reviewed at 1220 × 800 and 1440 × 900, in dark and light themes:

- Trade;
- Markets;
- Market Brief;
- Observatory;
- Backtester;
- Behaviour.

The review focused on action hierarchy, discoverability, obstructed controls, empty states, readability, responsive fit, and the approved accent contract. Twenty-four reference screenshots were inspected, followed by automated checks across 76 workspace, tab, theme, and viewport combinations.

## Implemented findings

### SAMPLE-01 — Getting-started invitation covered working content

**Severity:** High  
**Surfaces:** all desktop workspaces

The fixed invitation covered the Positions strip in Trade, Backtester controls and details, Behaviour content, and parts of the status bar.

**Resolution:** while the invitation is visible on desktop, the workspace reserves a 54 px lane immediately above the status bar. The invitation occupies that lane instead of floating over application content. Phone behaviour remains unchanged.

**Acceptance criteria:**

- the invitation does not intersect the workspace or status bar;
- Run backtest, dock controls, tables, and chart content remain reachable;
- dismissing the invitation restores the full workspace height;
- no horizontal overflow at 1220 or 1440 px.

### SAMPLE-02 — Behaviour explained the empty score but offered no next step

**Severity:** Medium  
**Surface:** Coach → Behaviour

With no measurable trade history, the score correctly said “not enough data,” while the only action was “Download report.”

**Resolution:** before qualifying history exists, the report action is replaced with one primary `Open Trade` action. It opens Trade and focuses the Buy/Sell decision surface. Once history exists, `Download report` returns.

**Acceptance criteria:**

- zero-history Behaviour shows one clear next action;
- the action opens Trade and moves keyboard focus to the trade direction control;
- the empty report action is not shown;
- accounts with history retain report download.

## Reviewed without changes

- Trade decision hierarchy and semantic Buy/Sell colours;
- Markets quote density and panel discoverability;
- Brief information hierarchy;
- Observatory navigation and chart/sidebar balance;
- Backtester configuration/results split after removing the overlapping invitation;
- Behaviour card layout at both target widths.

No further changes were justified by the sample. Remaining density is intentional for a professional terminal and did not hide actions, create overflow, or confuse active state.
