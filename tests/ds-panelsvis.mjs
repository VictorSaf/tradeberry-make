// Panels on demand (ui.js pvBuild): every trading panel can be hidden from the Panels menu and brought back from the
// labelled tab it leaves at its edge. Market watch, New order, the market panels (Depth · Exposure · Strength ·
// Sessions), the positions dock (folded while empty / always open / folded to its tabs) and the quick-trade box; the
// choice survives a reload, a preset shows every panel again, and the header keeps its account figures at every width.
const snap = page => page.evaluate(() => {
  const vis = s => { const e = document.querySelector(s); return !!e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0; };
  const g = getComputedStyle(document.querySelector('.grid'));
  return { st: pvState(), cols: g.gridTemplateColumns.split(' ').map(parseFloat), rows: g.gridTemplateRows.split(' ').map(parseFloat),
    watchList: vis('#wl'), edgeW: vis('.watch>.pv-edge'), ticket: vis('.rail>.ticket'), tkbar: vis('.rail>.pv-tkbar'), edgeR: vis('.rail>.pv-edge-r'),
    market: vis('.rail .intel.isw-on'), quick: vis('.quick'), dockBody: vis('.dock .tab-body'), dockTabs: vis('#tabs'), n: document.getElementById('pvN').textContent };
});
export const tests = [
  {
    name: 'PV1 panels on demand: each panel hides from the Panels menu and comes back from its edge tab; the rail shows the market panels alone or a strip of tabs',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 950 });
      await page.waitForFunction(() => typeof pvState === 'function' && document.getElementById('pvBtn'), null, { timeout: 30000 });
      await page.evaluate(() => { localStorage.removeItem('tb.panels'); pvSet({ wl: true, tk: true, dock: 'auto', qt: true }, false); });
      const base = await snap(page);
      t.ok(base.watchList && base.ticket && base.quick && !base.market, 'by default every panel shows and the market panel is closed (its tab waits in the rail column)');
      const tabs = await page.evaluate(() => { const i = document.getElementById('isw').getBoundingClientRect(), k = document.querySelector('.rail>.ticket').getBoundingClientRect(); return { w: Math.round(i.width), right: i.left >= k.right, vertical: getComputedStyle(document.querySelector('#isw>button')).writingMode }; });
      t.ok(tabs.w >= 30 && tabs.w <= 40 && tabs.right, 'the market tabs are a column beside the ticket: ' + JSON.stringify(tabs)); t.eq(tabs.vertical, 'vertical-rl', 'tab labels vertical');
      t.ok(!(await page.isVisible('#pvBtn')), 'no Panels button (Victor 31.10.2026): panels come back from their edge tabs');
      await page.evaluate(() => pvSet({}, true)); await page.waitForTimeout(200);
      let s = await snap(page);
      const beside = await page.evaluate(() => { const i = document.querySelector('.rail>.intel.isw-on').getBoundingClientRect(), k = document.querySelector('.rail>.ticket').getBoundingClientRect(); return i.left >= k.right && Math.abs(i.top - k.top) < 2; });
      t.ok(s.market && s.ticket && beside, 'the market panel opens beside the ticket, the ticket stays');
      await page.evaluate(() => pvSet({ wl: false })); await page.waitForTimeout(150);
      s = await snap(page);
      t.ok(!s.watchList && s.edgeW, 'market watch hidden, its labelled edge tab shown'); t.ok(s.cols[0] <= 36, 'watch column narrows to the tab (36 px, as New order): ' + s.cols[0]);
      t.eq(s.n, '1', 'the Panels button counts what is hidden');
      await page.evaluate(() => pvSet({ tk: false })); await page.waitForTimeout(150);
      s = await snap(page);
      t.ok(!s.ticket && s.tkbar && s.market, 'New order hidden: the market panel takes the rail, the New order tab brings the ticket back');
      await page.evaluate(() => pvSet({}, false)); await page.waitForTimeout(150);
      s = await snap(page);
      t.ok(s.tkbar && !s.edgeR && !s.market && !s.ticket, 'both hidden: the rail is the tab column (New order and the market tabs)'); t.ok(s.cols[2] <= 40, 'rail column narrows to the tab column: ' + s.cols[2]);
      await page.evaluate(() => pvSet({ dock: 'min', qt: false })); await page.waitForTimeout(200);
      s = await snap(page);
      t.ok(!s.dockBody && s.dockTabs && s.rows[1] <= 40, 'dock folded to its tab strip: ' + s.rows[1]); t.ok(!s.quick, 'quick trade hidden');
      t.eq(s.n, '4', 'four panels counted hidden (a closed market panel is not: its tab is shown)');
      
      // bring them back from their edges
      await page.click('#isw [data-i=iStats]'); await page.waitForTimeout(150);
      s = await snap(page); t.ok(s.market && s.st.mk && await page.isVisible('#iExp') && await page.isVisible('#iStr') && await page.isVisible('#iSes'), 'Stats in the tab column opens Exposure, Strength and Sessions');
      await page.click('.rail>.pv-tkbar'); await page.waitForTimeout(150);
      s = await snap(page); t.ok(s.ticket && s.st.tk, 'the New order tab brings the ticket back');
      await page.click('.watch>.pv-edge'); await page.waitForTimeout(150);
      s = await snap(page); t.ok(s.watchList && s.st.wl, 'the edge tab brings the market watch back');
      await page.click('#tabs [data-tab=history]'); await page.waitForTimeout(200);
      s = await snap(page); t.ok(s.dockBody && s.st.dock === 'auto', 'a tab of a folded dock opens it');
      await page.click('#dockMin'); await page.waitForTimeout(150); s = await snap(page); t.ok(!s.dockBody && s.st.dock === 'min', 'Hide panel folds the dock');
      await page.click('#dockMin'); await page.waitForTimeout(150); s = await snap(page); t.ok(s.dockBody, 'Show panel opens it again');
      t.noErrors(page);
    },
  },
  {
    name: 'PV2 the panel choice survives a reload, a preset shows every panel again, the header keeps the account figures at every desktop width',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1440, height: 900 });
      // the Panels button exists once ui.js and shell.js are both ready (the market-panel fold lives in shell.js)
      await page.waitForFunction(() => typeof pvState === 'function' && document.getElementById('pvBtn'), null, { timeout: 30000 });
      await page.evaluate(() => pvSet({ wl: false, qt: false, dock: 'min', tk: true }, false));
      await page.reload(); await page.waitForFunction(() => typeof pvState === 'function' && document.getElementById('pvBtn'), null, { timeout: 30000 });
      let s = await snap(page);
      t.deep([s.st.wl, s.st.qt, s.st.dock, s.st.mk], [false, false, 'min', false], 'hidden panels stay hidden after a reload');
      await page.evaluate(() => { const l = document.getElementById('layoutSel'); l.value = 'p:standard'; l.dispatchEvent(new Event('change', { bubbles: true })); }); await page.waitForTimeout(400);
      s = await snap(page);
      t.deep([s.st.wl, s.st.tk, s.st.mk, s.st.qt, s.st.dock], [true, true, false, true, 'auto'], 'a preset shows every panel again (Standard keeps the market panel closed, its tab ready)');
      // every figure whole and inside the header, also with a hidden-panel count and a long saved layout name showing
      const fits = async tag => {
        for (const w of [1081, 1100, 1280, 1440, 1680, 1760, 1840, 1879, 1880, 1920, 2160, 2400]) {
          await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
          const r = await page.evaluate(() => {
            const a = document.querySelector('.acct').getBoundingClientRect(), tb = document.querySelector('.topbar').getBoundingClientRect();
            const ms = [...document.querySelectorAll('.acct .m')].filter(m => m.offsetParent);
            return { btn: !!document.getElementById('pvBtn').offsetParent, n: ms.length, h: Math.round(tb.height),
              fit: ms.every(m => { const b = m.getBoundingClientRect(), v = m.querySelector('b'); return b.left >= a.left - 1 && b.right <= a.right + 1 && b.right <= tb.right + 1 && v.scrollWidth <= v.clientWidth + 1; }),
              dbg: [Math.round(a.left), Math.round(a.right), ...ms.map(m => [m.textContent, Math.round(m.getBoundingClientRect().left), Math.round(m.getBoundingClientRect().right)])] };
          });
          t.ok(!r.btn, `${tag} ${w}: no Panels button`); t.ok(r.n >= 3 && r.fit, `${tag} ${w}: every account figure whole inside the header (${r.n} shown) ${r.fit ? "" : JSON.stringify(r.dbg)}`); t.eq(r.h, 40, `${tag} ${w}: header 40px`);
        }
      };
      await fits('standard');
      await page.evaluate(() => { pvSet({ wl: false, qt: false }); S.set.layouts.push({ name: 'A very long layout name x', ws: { ...wsState().cur } }); wsWl(wsState().cur.wl, 'u:A very long layout name x'); });
      t.ok(await page.evaluate(() => document.getElementById('wsTabsCur').textContent === 'A very long layout name x' && document.getElementById('pvN').textContent === '2'), 'a saved layout name and a hidden-panel count are showing');
      await fits('saved + 2 hidden');
      t.noErrors(page);
    },
  },
  {
    name: 'PV3 artboard 2 frame: 40px header of bordered cells (nav | LAYOUT + Panels | tools | account, Equity the hero), 26px status bar of cells, panels 1px --line2 4px apart on --ground, the market panel band with its close, Monitor rail, phone untouched',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 950 });
      await page.waitForFunction(() => typeof pvState === 'function' && document.getElementById('pvBtn') && document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
      await page.evaluate(() => { localStorage.removeItem('tb.panels'); wsApply('standard'); });
      await page.waitForTimeout(300);
      const read = () => page.evaluate(() => {
        const norm = c => { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; };
        const tok = n => norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim());
        const cs = s => getComputedStyle(typeof s === 'string' ? document.querySelector(s) : s);
        const box = s => document.querySelector(s).getBoundingClientRect();
        const tb = document.querySelector('.topbar'), ctrls = tb.querySelector('.ctrls');
        const cells = ['.topbar>.brand', '#views', '.topbar>.ctrls', '#acct'].map(s => Math.round(box(s).left));
        const tools = [...ctrls.children].filter(c => c.offsetParent && c.id !== 'feedPill').map(c => ({ w: Math.round(c.getBoundingClientRect().width), br: cs(c).borderRightWidth, brc: norm(cs(c).borderRightColor) }));
        const ms = [...document.querySelectorAll('#acct .m')].filter(m => m.offsetParent);
        const sb = document.getElementById('statusbar'), sbCells = [...sb.children].filter(c => c.offsetParent && !c.classList.contains('sb-sp'));
        const g = cs('.grid');
        return {
          line: tok('--line'), line2: tok('--line2'), s1: tok('--s1'), s2: tok('--s2'), acc: tok('--acc'), ground: tok('--ground'),
          h: Math.round(tb.getBoundingClientRect().height), tbBg: norm(cs(tb).backgroundColor), tbBb: [cs(tb).borderBottomWidth, norm(cs(tb).borderBottomColor)],
          cells, domOrder: ctrls.nextElementSibling && ctrls.nextElementSibling.id, brandBr: [cs('.topbar>.brand').borderRightWidth, norm(cs('.topbar>.brand').borderRightColor)],
          viewsBr: norm(cs('#views').borderRightColor), cellBr: norm(cs('#wsCell').borderRightColor),
          viewFs: cs('#views button').fontSize, viewTt: cs('#views button').textTransform,
          pvIn: !!document.querySelector('#wsCell #pvBtn'), pvTxt: document.querySelector('#pvBtn .pv-t').offsetParent ? document.querySelector('#pvBtn .pv-t').textContent : '',
          pvH: Math.round(box('#pvBtn').height), pvBorder: norm(cs('#pvBtn').borderTopColor),
          presets: !!document.querySelector('#wsTabs').offsetParent, layoutSel: !!document.getElementById('layoutSel').offsetParent,
          tools,
          acct: ms.map(m => ({ lfs: cs(m.querySelector('label')).fontSize, ltt: cs(m.querySelector('label')).textTransform, bl: [cs(m).borderLeftWidth, norm(cs(m).borderLeftColor)], font: cs(m.querySelector('b')).fontFamily })),
          eq: { fs: cs('#mEq').fontSize, fw: cs('#mEq').fontWeight, bg: norm(cs(document.getElementById('mEq').closest('.m')).backgroundColor) }, pnl: cs('#mPnl').fontSize,
          sb: { h: Math.round(sb.getBoundingClientRect().height), bt: [cs(sb).borderTopWidth, norm(cs(sb).borderTopColor)], font: cs(sb).fontFamily, fs: cs(sb).fontSize, cells: sbCells.length, ruled: sbCells.every(c => cs(c).borderRightWidth === '1px' || cs(c).borderLeftWidth === '1px') },
          grid: { gap: g.columnGap + '/' + g.rowGap, pad: g.padding, bg: norm(g.backgroundColor) },
          // the #isw column has no frame since v15.10.9 (each tab the full column width, Victor 31.10.2026): its tabs carry the rules
          panels: ['.watch', '.chartp', '.dock', '.rail>.ticket', '#isw>button'].map(s => s === '#isw>button' ? [s, cs(s).borderBottomWidth, norm(cs(s).borderBottomColor)] : [s, cs(s).borderTopWidth, norm(cs(s).borderTopColor)])
        };
      });
      const r = await read();
      t.eq(r.h, 40, 'header 40px'); t.eq(r.tbBg, r.s1, 'header on --s1'); t.deep(r.tbBb, ['1px', r.line2], 'header closed by 1px --line2');
      t.ok(r.cells.every((x, i) => !i || x > r.cells[i - 1]), 'header order: brand | navigation | tools | account (the LAYOUT cell shows only from 1880 px): ' + r.cells);
      t.eq(r.domOrder, 'acct', 'the tools come before the account figures in the DOM too (keyboard order = what is seen)');
      t.deep(r.brandBr, ['1px', r.line2], 'brand cell ruled by --line2'); t.eq(r.viewsBr, r.line2, 'navigation group closed by --line2'); 
      t.eq(r.viewFs, '13px', 'page nav: the compact segmented group at every width (13px)'); t.eq(r.viewTt, 'none', 'page nav labels as written (Trade, Monitor…)');
      t.eq(r.pvTxt, '', 'no Panels button in the header');
      t.ok(!r.presets, '1680: the presets wait for room (no status bar since 09.11.2026)');
      t.ok(r.tools.length >= 6 && r.tools.every(c => c.w >= 32 && c.br === '1px' && c.brc === r.line), 'tool icons are 32+px cells ruled by --line: ' + JSON.stringify(r.tools));
      t.ok(r.acct.length >= 3 && r.acct.every(a => a.lfs === '10px' && a.ltt === 'uppercase' && a.bl[0] === '1px' && a.bl[1] === r.line && /JetBrains Mono/.test(a.font)), 'account cells: 10px uppercase labels, mono figures, --line rules: ' + JSON.stringify(r.acct));
      t.deep(r.eq, { fs: '15px', fw: '700', bg: r.s2 }, 'Equity is the hero: 15px 700 on its --s2 band'); t.eq(r.pnl, '13px', 'Floating P&L 13px');
      t.eq(r.sb.h, 0, 'no status bar (Victor, 09.11.2026): the price source is a dot in the header');
      t.ok(await page.evaluate(() => !!document.querySelector('.topbar .ctrls>#feedPill')?.offsetParent), 'the price source dot sits among the header tools');
      t.deep(r.grid, { gap: '4px/4px', pad: '4px', bg: r.ground }, 'panels 4px apart on --ground');
      // New order like every panel (06.11.2026: yellow only where it can be clicked)
      for (const [s, w, c] of r.panels) t.ok(w === '1px' && c === r.line2, `${s}: 1px --line2 border (${w} ${c})`);
      // 1920: the presets and the LAYOUT label in the header
      await page.setViewportSize({ width: 1920, height: 1000 }); await page.waitForTimeout(200);
      const wide = await page.evaluate(() => ({ presets: [...document.querySelectorAll('#wsTabs button')].filter(b => b.offsetParent).length, lbl: !!document.querySelector('#wsCell .ws-lbl').offsetParent, on: document.querySelector('#wsTabs button.on')?.dataset.p }));
      t.deep(wide, { presets: 5, lbl: true, on: 'standard' }, '1920: LAYOUT and the five presets in the header, Standard on');
      await page.setViewportSize({ width: 1680, height: 950 }); await page.waitForTimeout(200);
      // the market panel: 30px band, its close folds it back to the tab column
      await page.evaluate(() => iswOpen('iStats')); await page.waitForTimeout(200);
      const band = await page.evaluate(() => { const ph = document.querySelector('#iExp>.ph'); return { h: Math.round(ph.getBoundingClientRect().height), x: !!ph.querySelector('.intel-x')?.offsetParent }; });
      t.ok(band.h >= 30 && band.x, 'the open market panel has its title band (30px+) and a close button: ' + JSON.stringify(band));
      await page.click('#iExp .intel-x'); await page.waitForTimeout(200);
      t.ok(await page.evaluate(() => iswFolded() && !document.getElementById('iStr').offsetParent && document.activeElement === document.querySelector('#isw button.on')), 'close folds the panel; focus goes to its tab');
      // Mirrored: the tab column on the outer (left) edge
      await page.evaluate(() => { wsApply('mirror'); iswOpen('iDom'); }); await page.waitForTimeout(300);
      t.ok(await page.evaluate(() => { const i = document.getElementById('isw').getBoundingClientRect(), d = document.getElementById('iDom').getBoundingClientRect(), k = document.querySelector('.rail>.ticket').getBoundingClientRect(); return i.right <= d.left + 1 && d.right <= k.left + 1; }), 'Mirrored: tabs | market panel | ticket from the outer edge');
      await page.evaluate(() => wsApply('standard')); await page.waitForTimeout(200);
      // Monitor: the board fills the screen; no rail at all (v15.15.1), whatever the saved market-panel state
      await page.evaluate(() => setView('monitor')); await page.waitForTimeout(300);
      const mon = () => page.evaluate(() => { const g = document.querySelector('.grid').getBoundingClientRect(), m = document.getElementById('monitor').getBoundingClientRect(); return { fill: m.height / g.height, rail: !!document.querySelector('.rail').offsetParent, str: !!document.getElementById('iStr').offsetParent, isw: !!document.getElementById('isw').offsetParent }; });
      const m0 = await mon(); t.ok(m0.fill > .85 && !m0.rail && !m0.isw, 'Monitor: the board fills the workspace, no rail and no stray tab column: ' + JSON.stringify(m0));
      await page.evaluate(() => document.getElementById('monRailBtn').click()); await page.waitForTimeout(300);
      const m1 = await mon(); t.ok(!m1.rail && !m1.isw && m1.fill > .85, 'Monitor, a saved Market panel on: still no rail, the board keeps the width (v15.15.1): ' + JSON.stringify(m1));
      await page.evaluate(() => { document.getElementById('monRailBtn').click(); setView('trade'); }); await page.waitForTimeout(200);
      // light theme keeps the same frame on its own tokens
      await page.evaluate(() => { S.set.theme = 'light'; applyTheme(); }); await page.waitForTimeout(150);
      const lt = await read();
      t.ok(lt.tbBg === lt.s1 && lt.tbBb[1] === lt.line2 && lt.grid.bg === lt.ground && lt.ground !== r.ground, 'light: header on --s1, --line2 rules, its own --ground');
      // phone: the header is unchanged (no LAYOUT cell, the tools after the account figures as before)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      const ph = await page.evaluate(() => ({ cell: !!document.getElementById('wsCell').offsetParent, after: document.getElementById('acctX').nextElementSibling?.classList.contains('ctrls') }));
      t.deep(ph, { cell: false, after: true }, 'phone: no LAYOUT cell, tools back after the account');
      t.noErrors(page);
    },
  },
  {
    name: 'PV4 the rail with a market panel open, 1081-2400: the ticket keeps its width and the tab column stays on screen (below 1440 the panel goes under the ticket), Standard, Analysis and Mirrored',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 950 });
      await page.waitForFunction(() => typeof pvState === 'function' && window.iswOpen && document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
      await page.evaluate(() => localStorage.removeItem('tb.panels'));
      const R = () => page.evaluate(() => { const b = s => { const r = document.querySelector(s).getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), w: Math.round(r.width) }; };
        return { tk: b('.grid.ws>.rail>.ticket'), mk: b('.grid.ws>.rail>:is(.intel.isw-on,.isw-stack:has(>.isw-on))'), isw: b('#isw'), ch: b('.grid.ws>.chartp'), vw: innerWidth, stack: document.querySelector('.grid').classList.contains('rail-stack') }; });
      for (const pre of ['standard', 'analysis', 'mirror']) for (const w of [1081, 1200, 1280, 1360, 1439, 1440, 1680, 2400]) {
        await page.setViewportSize({ width: w, height: 900 });
        await page.evaluate(p => { wsApply(p); iswOpen(p === 'analysis' ? 'iStr' : 'iDom'); }, pre); await page.waitForTimeout(200);
        const r = await R(), at = `${pre} ${w}: ` + JSON.stringify(r);
        t.ok(r.tk.w >= 270, 'ticket at least 270px wide, ' + at);
        t.ok(r.mk.w >= 260, 'market panel at least 260px wide, ' + at);
        t.ok(r.isw.l >= 0 && r.isw.r <= r.vw && r.tk.r <= r.vw && r.mk.r <= r.vw, 'ticket, market panel and tab column inside the viewport, ' + at);
        t.ok(r.ch.w >= 420, 'the chart keeps at least 420px, ' + at);
        t.eq(r.stack, w < 1440, 'below 1440px the market panel opens over the chart edge (rail-stack), ' + at);
        if (r.stack) t.ok((pre === 'mirror' ? r.mk.l >= r.tk.r : r.mk.r <= r.tk.l) && r.tk.b - r.tk.t >= r.mk.b - r.mk.t - 1, 'below 1440: the panel beside the ticket, over the chart edge; the ticket keeps the full height, ' + at);
        else t.ok(pre === 'mirror' ? r.isw.r <= r.mk.l && r.mk.r <= r.tk.l : r.tk.r <= r.mk.l && r.mk.r <= r.isw.l, 'beside: ticket | panel | tabs (mirrored: tabs | panel | ticket), ' + at);
        if (pre === 'mirror') t.ok(r.isw.l <= 8, 'mirrored: the tab column on the outer (left) edge, ' + at); else t.ok(r.isw.r >= r.vw - 8, 'the tab column on the outer (right) edge, ' + at);
      }
      t.noErrors(page);
    },
  },
];
