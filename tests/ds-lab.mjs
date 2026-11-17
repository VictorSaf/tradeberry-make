// Design system · ds-lab: the Backtester (bt.js) in the terminal design system. Net P&L / Unseen return as hero with key and
// secondary KPI tiers (all 12 + 8 still there), neutral verdict (no simulated-market line since v15.21), title bands,
// the template picker as a tab strip, neutral primary Run buttons, bordered tables with text columns on the left, the luck
// table's explanations as keyboard-reachable tooltips, optimizer marks that match their legend, equity curve without gradient.
const lazy = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof runBacktest === 'function', null, { timeout: 30000 });
// the test runner's platform feed (T.feed) for syms, with the backtest history of `load` fetched, so a run is synchronous
const feed = (page, syms, load = syms) => page.evaluate(async ([syms, load]) => { T.feed(syms); for (const s of load) await btLoad(s, btCfg().hist || 8); }, [syms, load]);
const openBt = async page => {
  await lazy(page);
  await feed(page, await page.evaluate(() => Engine.INSTR.map(m => m.sym)), ['EURUSD', 'GOLD']);
  await page.evaluate(() => { T.reset(); S.set.lev = null; S.set.jur = 'eu'; S.set.comm = 0; if (document.body.classList.contains('mnav-on')) mnavGo('tools'); setTab('bt'); });
  await page.waitForFunction(() => !!document.querySelector('#btCfg #btSym') && BT.res && document.querySelector('#btOut .bt-kpis'), null, { timeout: 30000 });
};
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);
const HELP = () => {
  window.DL = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DL.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    col: (el, p = 'color') => DL.norm(getComputedStyle(el)[p]),
    cs: (el, p) => getComputedStyle(el)[p],
    vis: el => !!el && el.offsetParent !== null && el.getBoundingClientRect().height > 0 && !el.closest('details:not([open])')
  };
};

export const tests = [
  {
    name: 'DSL1 backtest KPIs: one hero (Net P&L, mono 16/700), key tier 13/600, secondary 11/400; all 12 KPIs, Trades keeps its L/S split',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await openBt(page); await page.evaluate(HELP);
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd']]) {
        await look(page, th, pa);
        const r = await page.evaluate(() => {
          const ks = [...document.querySelectorAll('#btOut .bt-kpis .kpi')], f = k => k && { lab: k.querySelector('label').textContent, fs: DL.cs(k.querySelector('b'), 'fontSize'), fw: DL.cs(k.querySelector('b'), 'fontWeight'), ff: DL.cs(k.querySelector('b'), 'fontFamily'), color: DL.col(k.querySelector('b')) };
          const hero = ks.filter(k => k.classList.contains('hero')), key = ks.filter(k => k.classList.contains('key')), sec = ks.filter(k => k.classList.contains('sec'));
          const hb = hero[0] && hero[0].getBoundingClientRect(), kb = key[0] && key[0].getBoundingClientRect();
          return { n: ks.length, labels: ks.map(k => k.querySelector('label').textContent), hero: hero.map(f), key: key.map(f), sec: sec.map(f), split: !!ks.find(k => /Trades/.test(k.textContent))?.querySelector('small'),
            tx: DL.tok('--tx'), tx2: DL.tok('--tx2'), acc: DL.tok('--acc'), heroLeft: hb && kb && hb.left < kb.left, heroTall: hb && kb && hb.height > kb.height * 1.5 };
        });
        const k = `${th}/${pa}`;
        t.eq(r.n, 12, `${k}: 12 backtest KPIs`);
        for (const l of ['Net P&L', 'Return', 'Market move', 'Trades', 'Win rate', 'Profit factor', 'Expectancy', 'Max drawdown', 'Sharpe per trade', 'Avg hold', 'Time in market', 'Worst streak']) t.ok(r.labels.includes(l), `${k}: KPI ${l} present`);
        t.eq(r.hero.length, 1, `${k}: exactly one hero`);
        t.eq(r.hero[0].lab, 'Net P&L', `${k}: the hero is Net P&L`);
        t.eq(r.hero[0].fs, '16px', `${k}: hero 16px`); t.eq(r.hero[0].fw, '700', `${k}: hero bold`); t.ok(/JetBrains Mono/.test(r.hero[0].ff), `${k}: hero mono`);
        t.ok(r.heroLeft && r.heroTall, `${k}: the hero leads the block and spans the KPI rows`);
        t.deep(r.key.map(x => x.lab), ['Return', 'Trades', 'Win rate', 'Profit factor', 'Expectancy', 'Max drawdown'], `${k}: key tier`);
        for (const x of r.key) { t.eq(x.fs, '13px', `${k}: key ${x.lab} 13px`); t.eq(x.fw, '600', `${k}: key ${x.lab} 600`); }
        t.eq(r.sec.length, 5, `${k}: five secondary KPIs`);
        for (const x of r.sec) { t.eq(x.fs, '11px', `${k}: secondary ${x.lab} 11px`); t.eq(x.fw, '400', `${k}: secondary ${x.lab} 400`); }
        for (const x of [...r.hero, ...r.key, ...r.sec]) t.ok(x.color !== r.acc, `${k}: ${x.lab} is not amber`);
        t.ok(r.split, `${k}: Trades keeps its long / short split`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSL2 verdict neutral (never amber), no simulated-market line; warnings visible; title bands; Run buttons primary neutral',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await openBt(page); await page.evaluate(HELP);
      for (const th of ['dark', 'light']) {
        await look(page, th);
        const r = await page.evaluate(() => {
          const p = v => v == null ? '—' : (v * 100).toFixed(0) + '%';
          const vs = [btVerdict({ n: 40, net: 500 }, { N: 3, dsr: .5 }, p), btVerdict({ n: 40, net: 500 }, { N: 3, dsr: .97 }, p), btVerdict({ n: 40, net: -500 }, { N: 3, dsr: .1 }, p), btVerdict({ n: 5, net: 5 }, { N: 1, dsr: null }, p)].map(x => x[0]);
          const v = document.querySelector('#btVerdict'); const cls0 = v.className; v.className = 'wf-verdict neutral';
          const neutral = { color: DL.col(v), border: DL.col(v, 'borderTopColor') }; v.className = cls0;
          const sim = v.querySelector('.bt-sim');
          const band = s => { const e = document.querySelector(s); return e && { bg: DL.col(e, 'backgroundColor'), bb: DL.cs(e, 'borderBottomWidth'), up: DL.cs(e, 'textTransform'), fw: DL.cs(e, 'fontWeight') }; };
          const run = document.querySelector('#btRun');
          return { vs, neutral, tx: DL.tok('--tx'), line2: DL.tok('--line2'), acc: DL.tok('--acc'), bandTok: DL.tok('--band'),
            sim: sim && DL.vis(sim) && sim.textContent, simColor: sim && DL.col(sim), tx2: DL.tok('--tx2'), verdictText: v.innerText,
            bands: { cfg: band('#btCfg > .bt-band'), head: band('#btOut .bt-head'), oos: band('#btOut .bt-mid .oos > h3'), luck: band('#btHonest > h3') }, cfgBandText: document.querySelector('#btCfg > .bt-band')?.textContent,
            run: { cls: run.className, bg: DL.col(run, 'backgroundColor'), inline: run.getAttribute('style') }, all: document.querySelector('#btAll')?.className };
        });
        t.deep(r.vs, ['neutral', 'neutral', 'dn', 'dn'], `${th}: verdict classes (profitable within luck and false positive are neutral)`);
        t.eq(r.neutral.color, r.tx, `${th}: neutral verdict in ink`); t.ok(r.neutral.color !== r.acc, `${th}: neutral verdict not amber`);
        t.eq(r.neutral.border, r.line2, `${th}: neutral verdict border --line2`);
        t.ok(!r.sim, `${th}: no simulated-market line inside the verdict`);
        t.ok(!/simulat|zero drift|by construction/i.test(r.verdictText), `${th}: the verdict never says simulated / zero drift: ${r.verdictText}`);
        t.ok(/^Verdict/.test(r.verdictText), `${th}: the verdict still starts with "Verdict"`);
        t.eq(r.cfgBandText, 'Backtest settings', `${th}: config has a title band`);
        for (const [k, b] of Object.entries(r.bands)) {
          t.ok(!!b, `${th}: band ${k} present`);
          t.eq(b.bg, r.bandTok, `${th}: band ${k} on --band`);
          t.ok(k === 'oos' || k === 'luck' || b.bb === '1px', `${th}: band ${k} has a 1px bottom line`);
        }
        t.ok(/\bbtn-pri\b/.test(r.run.cls) && !r.run.inline, `${th}: Run backtest is the primary button, no inline style`);
        t.ok(r.run.bg !== 'rgba(0, 0, 0, 0)', `${th}: primary button is solid accent (accent contract)`);
        t.ok(/ghost/.test(r.all), `${th}: Run on all FX pairs stays secondary`);
      }
      // warnings: a capped GOLD run with a stop inside 2x the spread; every warning is visible, not folded
      const w = await page.evaluate(() => {
        const c = btCfg(); c.sym = 'GOLD'; c.slMode = 'pips'; c.slPts = { GOLD: 300 }; c.risk = 5; renderBtConfig(); btRunAll();
        const ws = [...document.querySelectorAll('#btOut .warn')];
        const det = document.querySelector('#btCfg .bt-cfgcost');
        return { n: ws.length, vis: ws.every(DL.vis), cfgCost: det && det.open && DL.vis(det.querySelector('p')), sum: det && det.querySelector('summary').textContent, costs: !!document.querySelector('#btOut details.bt-costs') };
      });
      t.ok(w.n >= 1, 'warnings present on a capped run: ' + w.n);
      t.ok(w.vis, 'every warning visible (not folded)');
      t.ok(w.cfgCost, 'config cost text grouped in an open <details> and readable');
      t.ok(/costs · spread .+ · 1:\d+/.test(w.sum), 'config cost summary line: ' + w.sum);
      t.ok(w.costs, 'the run\'s costs, sizing and fills stay in their folded block');
      t.noErrors(page);
    }
  },
  {
    name: 'DSL3 form and template strip: tab-strip recipe, wide selects on two tracks, inputs aligned, values in ink',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await page.setViewportSize({ width: 1280, height: 800 });
      await openBt(page); await page.evaluate(HELP);
      for (const th of ['dark', 'light']) {
        await look(page, th);
        const r = await page.evaluate(() => {
          const g = document.querySelector('#btCfg .tpl-grid'), on = g.querySelector('.tpl.on'), off = g.querySelector('.tpl:not(.on)');
          const w2 = ['#btDir', '#btSlMode', '#btTrail', '#btCost'].map(s => { const e = document.querySelector(s); return { id: s, span: DL.cs(e.closest('label'), 'gridColumnStart'), w: e.getBoundingClientRect().width, cut: e.scrollWidth > e.clientWidth + 1 }; });
          const tp = document.querySelector('#btTpR'), mx = document.querySelector('#btMax');
          return { gap: DL.cs(g, 'columnGap'), bg: DL.col(g, 'backgroundColor'), line2: DL.tok('--line2'), n: g.querySelectorAll('.tpl').length,
            on: { color: DL.col(on), bg: DL.col(on, 'backgroundColor'), shadow: DL.cs(on, 'boxShadow'), radius: DL.cs(on, 'borderTopLeftRadius'), pressed: on.getAttribute('aria-pressed') },
            off: { bg: DL.col(off, 'backgroundColor'), border: DL.cs(off, 'borderTopWidth') }, acc: DL.tok('--acc'), s3: DL.tok('--s3'), s1: DL.tok('--s1'), tx: DL.tok('--tx'),
            w2, aligned: Math.abs(tp.getBoundingClientRect().bottom - mx.getBoundingClientRect().bottom) < 1,
            inputs: [...document.querySelectorAll('#btCfg .bt-row3 input[type=number]:not(:disabled), #btCfg .bt-row3 select')].map(e => DL.col(e)) };
        });
        t.eq(r.gap, '1px', `${th}: template strip 1px separators`); t.eq(r.bg, r.line2, `${th}: separators on --line2`);
        t.ok(r.n >= 6, `${th}: every template still offered: ${r.n}`);
        t.eq(r.on.color, r.acc, `${th}: active template in amber`); t.eq(r.on.bg, r.s3, `${th}: active template on --s3`);
        t.ok(/inset/.test(r.on.shadow), `${th}: active template underline`); t.eq(r.on.radius, '0px', `${th}: square tabs`);
        t.eq(r.on.pressed, 'true', `${th}: active template is announced (aria-pressed)`);
        t.eq(r.off.bg, r.s1, `${th}: idle template flush on --s1`); t.eq(r.off.border, '0px', `${th}: no chip border`);
        for (const x of r.w2) { t.eq(x.span, 'span 2', `${th}: ${x.id} spans two tracks`); t.ok(x.w > 150 && !x.cut, `${th}: ${x.id} wide enough: ${x.w}`); }
        t.ok(r.aligned, `${th}: Target and Max bars inputs share a baseline although the Target label wraps`);
        t.ok(r.inputs.length > 10 && r.inputs.every(c => c === r.tx), `${th}: input and select values in ink`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSL4 tables: trades on fixed columns (Side and Exit reason left, bordered), luck lines + keyboard tooltips, IS/OOS heads on one line',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await openBt(page); await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        BT.view = 'trades'; renderBtView();
        const tb = document.querySelector('#btView2 .bt-trades'), th = [...tb.querySelectorAll('thead th')], td = [...tb.querySelector('tbody tr').children];
        const luck = document.querySelector('#btHonest .bt-luck'), labs = [...luck.querySelectorAll('td.bt-lk')];
        labs[1].focus(); await new Promise(r => setTimeout(r, 30));
        const tip = document.querySelector('#brTip'), shown = tip && tip.style.display === 'block' && tip.textContent;
        labs[1].blur();
        const oosTh = [...document.querySelectorAll('#btOut .bt-mid .oos thead th')];
        const cut = td.filter(c => c.scrollWidth > c.clientWidth + 1 && !c.title);
        return { layout: DL.cs(tb, 'tableLayout'), w: [1, 2, 3, 5, 13].map(i => Math.round(th[i - 1].getBoundingClientRect().width)), n: th.length,
          align: { side: [DL.cs(th[1], 'textAlign'), DL.cs(td[1], 'textAlign')], reason: [DL.cs(th[12], 'textAlign'), DL.cs(td[12], 'textAlign')], entry: DL.cs(td[3], 'textAlign') },
          border: DL.cs(td[3], 'borderRightWidth'), titles: !!td[2].title && !!td[12].title, cut: cut.length,
          luck: { n: labs.length, tab: labs.every(l => l.tabIndex === 0 && /\|/.test(l.dataset.tip || '')), lines: [...luck.querySelectorAll('td.bt-line')].map(c => [DL.cs(c, 'textAlign'), c.textContent.length]), shown, txt: document.querySelector('#btHonest').innerText },
          oos: { nowrap: oosTh.every(h => DL.cs(h, 'whiteSpace') === 'nowrap'), first: DL.cs(document.querySelector('#btOut .bt-mid .oos tbody td'), 'fontFamily'), head: oosTh[0].textContent } };
      });
      t.eq(r.layout, 'fixed', 'trades table: fixed layout');
      t.eq(r.n, 13, 'all 13 trade columns');
      t.deep(r.w, [48, 64, 128, 128, 130], 'fixed widths: #, Side, Entry time, Exit time, Exit reason');
      t.deep(r.align.side, ['left', 'left'], 'Side head and cells on the left'); t.deep(r.align.reason, ['left', 'left'], 'Exit reason on the left');
      t.eq(r.align.entry, 'right', 'figures stay right');
      t.eq(r.border, '1px', 'cells bordered');
      t.ok(r.titles, 'time and reason cells carry a title for the ellipsis');
      t.eq(r.cut, 0, 'no cut cell without a title');
      t.eq(r.luck.n, 4, 'luck table: PSR, DSR, PBO, N effective');
      t.ok(r.luck.tab, 'every luck label is focusable and has a Title|text tooltip');
      t.ok(r.luck.lines.every(([a, n]) => a === 'left' && n > 0 && n < 160), 'one short muted line per measure, on the left: ' + JSON.stringify(r.luck.lines));
      t.ok(/^DSR/.test(r.luck.shown || ''), 'focusing a label shows its explanation in the tooltip layer: ' + r.luck.shown);
      t.ok(/account/.test(r.luck.txt), 'the visible lines keep "account"');
      t.ok(!/simulat|zero drift|edge is zero|true edge/i.test(r.luck.txt), 'the luck block has no simulated-market note: ' + r.luck.txt);
      t.ok(r.oos.nowrap, 'IS/OOS heads on one line'); t.ok(!/Mono/.test(r.oos.first), 'IS/OOS row labels in the text face');
      t.eq(r.oos.head, 'Measure', 'IS/OOS first head still named');
      t.noErrors(page);
    }
  },
  {
    name: 'DSL5 optimizer: current = amber outline, best = ink ring + star, legend says so; 1px gap; walk-forward hero + tiers; all pairs caption',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await openBt(page); await page.evaluate(HELP);
      for (const th of ['dark', 'light']) {
        await look(page, th);
        const r = await page.evaluate(async () => {
          BT.view = 'opt'; renderBtView(); runSweep();
          const g = document.querySelector('#optGrid'), cur = g.querySelector('.cell.cur'), best = g.querySelector('.cell.best');
          const note = g.querySelector('.opt-note').textContent, star = best && getComputedStyle(best, '::after').content;
          return { gap: DL.cs(g, 'columnGap'), cur: cur && DL.col(cur, 'borderTopColor'), curShadow: cur && !cur.classList.contains('best') ? DL.cs(cur, 'boxShadow') : 'none', best: best && DL.cs(best, 'boxShadow'), bestCol: best && DL.norm((DL.cs(best, 'boxShadow').match(/rgba?\([^)]*\)/) || [''])[0]), star, note, acc: DL.tok('--acc'), tx: DL.tok('--tx'),
            bestTitle: best && best.title, cellCol: DL.col(g.querySelector('.cell[data-x] b')), selNames: ['#optX', '#optY', '#optM'].map(q => document.querySelector(q).getAttribute('aria-label')).every(Boolean), run: document.querySelector('#optRun').className };
        });
        t.eq(r.gap, '1px', `${th}: optimizer cells 1px apart`);
        t.eq(r.cur, r.acc, `${th}: current settings outlined in amber`);
        t.eq(r.curShadow, 'none', `${th}: current cell has no ring`);
        t.ok(!!r.best && /inset/.test(r.best), `${th}: best cell has an inset ring: ${r.best}`);
        t.eq(r.bestCol, r.tx, `${th}: best ring in ink, not amber`);
        t.ok(/★/.test(r.star || ''), `${th}: best cell marked with a star (not colour alone)`);
        t.ok(/Amber outline = current settings/.test(r.note) && /★ = best cell/.test(r.note) && !/gold/i.test(r.note), `${th}: legend tells the truth: ${r.note}`);
        t.ok(/best cell/.test(r.bestTitle || ''), `${th}: best cell title says so`);
        t.ok(/btn-pri/.test(r.run), `${th}: Run grid is the primary button`);
        t.eq(r.cellCol, r.tx, `${th}: cell figures in ink (contrast on the tinted cells in both themes)`);
        t.ok(r.selNames, `${th}: optimizer selects are named`);
      }
      const wf = await page.evaluate(async () => {
        BT.view = 'wf'; renderBtView(); runWalkForward();
        const ks = [...document.querySelectorAll('#wfBody .wf-kpis .kpi')], f = s => ks.filter(k => k.classList.contains(s)).map(k => k.querySelector('label').textContent);
        const v = document.querySelector('#wfBody .wf-verdict'), b = document.querySelector('#wfRun'), par = document.querySelector('.wf-tbl td.tx');
        return { n: ks.length, hero: f('hero'), key: f('key'), sec: f('sec'), vcls: v && v.className, vcol: v && DL.col(v), acc: DL.tok('--acc'), run: b.className, inline: b.getAttribute('style'), par: par && DL.cs(par, 'fontFamily'),
          heroFs: ks[0] && DL.cs(ks[0].querySelector('b'), 'fontSize') };
      });
      t.eq(wf.n, 8, 'walk-forward: all 8 KPIs');
      t.deep(wf.hero, ['Unseen return'], 'walk-forward hero: Unseen return'); t.eq(wf.heroFs, '16px', 'walk-forward hero 16px');
      t.deep(wf.key, ['Fixed settings', 'WF efficiency', 'Windows profitable', 'Profit factor'], 'walk-forward key tier');
      t.deep(wf.sec, ['Trades', 'Max drawdown', 'Settings changed'], 'walk-forward secondary tier');
      t.ok(!/\bacc\b/.test(wf.vcls || '') && wf.vcol !== wf.acc, 'walk-forward verdict not amber: ' + wf.vcls);
      t.ok(/btn-pri/.test(wf.run) && !wf.inline, 'Run walk-forward is the primary button, no inline style');
      t.ok(!wf.par || /JetBrains Mono/.test(wf.par), 'walk-forward parameters in mono');
      const all = await page.evaluate(async () => {
        BT.view = 'all'; renderBtView(); await runAllPairs();
        const cap = document.querySelector('#allBody .bt-all caption'), btn = document.querySelector('#allRun'), tip = cap && cap.querySelector('[data-tip]');
        return { cap: cap && cap.textContent, capSide: cap && DL.cs(cap, 'captionSide'), tip: btn.dataset.tip, btn: btn.className, rows: document.querySelectorAll('#allBody .all-tr').length, capTip: tip && tip.tabIndex === 0 && tip.dataset.tip };
      });
      t.ok(/^\d+ of 38 pairs profitable/.test(all.cap || ''), 'all pairs: the count is the table caption: ' + all.cap);
      t.ok(/independent tests/.test(all.cap), 'the caption keeps the not-independent note visible');
      t.eq(all.capSide, 'top', 'caption above the head');
      t.ok(/each of the 38 FX pairs/.test(all.tip || '') && /Other instruments/.test(all.tip), 'the explanation is the Run button tooltip');
      t.ok(/share currencies/.test(all.capTip || ''), 'the caption note has the full explanation as a focusable tooltip');
      t.ok(/btn-pri/.test(all.btn), 'Run all FX pairs is the primary button');
      t.eq(all.rows, 38, '38 rows');
      t.noErrors(page);
    }
  },
  {
    name: 'DSL6 equity curve: no gradient, stretches beside IS/OOS; exits readout; phone 390 keeps every KPI and control',
    async run({ t, app }) {
      const page = await app('?seed=7', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await openBt(page); await page.evaluate(HELP);
      // under load the result row can still be unlaid-out: wait for the final layout, not the first frame
      await page.waitForFunction(() => { const c = document.querySelector('.bt-mid .bt-curve'), o = document.querySelector('.bt-mid .oos'); return c && o && c.getBoundingClientRect().height > 0 && o.getBoundingClientRect().height > 0; }, null, { timeout: 30000 });
      const r = await page.evaluate(() => {
        const P = CanvasRenderingContext2D.prototype, o = P.createLinearGradient; let n = 0; P.createLinearGradient = function (...a) { n++; return o.apply(this, a); };
        drawBtCurve(); P.createLinearGradient = o;
        const cv = document.querySelector('.bt-mid .bt-curve'), oos = document.querySelector('.bt-mid .oos'), h0 = cv.getBoundingClientRect().height;
        drawBtCurve(); drawBtCurve();
        const ex = document.querySelector('#btView2 .ex-chip');
        return { grad: n, mid: DL.cs(document.querySelector('#btOut .bt-mid'), 'alignItems'), h: h0, h2: cv.getBoundingClientRect().height, oos: oos && oos.getBoundingClientRect().height,
          ex: ex && { radius: DL.cs(ex, 'borderTopLeftRadius'), bl: DL.cs(ex, 'borderLeftWidth'), bg: DL.cs(ex, 'backgroundColor') } };
      });
      t.eq(r.grad, 0, 'equity curve drawn without a gradient');
      t.eq(r.mid, 'stretch', 'curve row stretches');
      t.ok(r.oos && Math.abs(r.h - r.oos) < 2, `curve as tall as the IS/OOS column: ${r.h} vs ${r.oos}`);
      t.eq(r.h2, r.h, 'redrawing does not grow the curve');
      t.ok(r.ex && r.ex.radius === '0px' && r.ex.bl === '2px' && /rgba\(0, 0, 0, 0\)|transparent/.test(r.ex.bg), 'exits: a readout with a left rule, not a chip');
      // phone
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      await page.evaluate(() => { mnavGo('tools'); setTab('bt'); renderBtResults(); });
      await page.waitForTimeout(200);
      const ph = await page.evaluate(() => {
        const ks = [...document.querySelectorAll('#btOut .bt-kpis .kpi')], hero = document.querySelector('#btOut .kpi.hero');
        const ids = ['#btRun', '#btAll', '#btSym', '#btTf', '#btDir', '#btHist', '#btSlMode', '#btTrail', '#btCost', '#btRisk', '#btShow', '#btToLab', '#btCsv', '#btTrialsReset', '#btView'];
        return { n: ks.length, heroCol: hero && DL.cs(hero, 'gridColumnStart') + '/' + DL.cs(hero, 'gridColumnEnd'), heroW: hero && hero.getBoundingClientRect().width, kpisW: document.querySelector('#btOut .bt-kpis').getBoundingClientRect().width,
          missing: ids.filter(s => !DL.vis(document.querySelector(s))), sw: document.documentElement.scrollWidth, verdict: DL.vis(document.querySelector('#btVerdict')) && document.querySelector('#btVerdict').innerText, warnHidden: [...document.querySelectorAll('#btOut .warn')].filter(w => !DL.vis(w)).length };
      });
      t.eq(ph.n, 12, 'phone: all 12 KPIs');
      t.ok(ph.heroW >= ph.kpisW - 1, `phone: hero spans the row (${ph.heroCol}, ${ph.heroW} of ${ph.kpisW})`);
      t.deep(ph.missing, [], 'phone: every control reachable');
      t.ok(ph.sw <= 390, 'phone: no horizontal page scroll: ' + ph.sw);
      t.ok(/^Verdict/.test(ph.verdict || '') && !/simulat|by construction/i.test(ph.verdict), 'phone: verdict visible, without a simulated-market note: ' + ph.verdict);
      t.eq(ph.warnHidden, 0, 'phone: no warning hidden');
      t.noErrors(page);
    }
  }
];
