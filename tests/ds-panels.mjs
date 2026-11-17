// Design system · ds-panels: what panels.js builds. Dock tables (text columns left, P&L emphasis, positions total
// row), the symbol price big figure, sessions, Journal (KPI tiers, curve on --ind1 without a gradient, notes table,
// neutral coach items), Correlation and Volatility as bordered tables, Calendar (compact rows, next release hero,
// Impact as checkboxes), Risk Lab (wrapping buttons, neutral run button, result tiers, fan off amber) and Calculators.
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);
const HELP = () => {
  window.DP = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DP.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    cs: (el, p) => getComputedStyle(el)[p],
    raf: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))),
    // every colour a canvas draw sets on stroke() / fill() / fillRect(), and whether it made a gradient
    spy(fn) {
      const P = CanvasRenderingContext2D.prototype, keep = { stroke: P.stroke, fill: P.fill, fillRect: P.fillRect, grad: P.createLinearGradient }, cols = [];
      let grads = 0;
      P.stroke = function (...a) { cols.push(String(this.strokeStyle)); return keep.stroke.apply(this, a); };
      P.fill = function (...a) { cols.push(String(this.fillStyle)); return keep.fill.apply(this, a); };
      P.fillRect = function (...a) { cols.push(String(this.fillStyle)); return keep.fillRect.apply(this, a); };
      P.createLinearGradient = function (...a) { grads++; return keep.grad.apply(this, a); };
      try { fn(); } finally { Object.assign(P, { stroke: keep.stroke, fill: keep.fill, fillRect: keep.fillRect, createLinearGradient: keep.grad }); }
      // opaque base colour of each (canvas reports #rrggbb or rgba(...); strip the alpha)
      const base = c => { const m = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(c); return m ? '#' + [m[1], m[2], m[3]].map(x => (+x).toString(16).padStart(2, '0')).join('') : c.slice(0, 7).toLowerCase(); };
      return { cols: cols.map(base), grads };
    },
    // header cells and the cells of one row start at the same x (to half a pixel)
    aligned(heads, cells) { return heads.length === cells.length && heads.every((h, i) => Math.abs(h.getBoundingClientRect().left - cells[i].getBoundingClientRect().left) < .6); }
  };
};
const MKHIST = () => { window.DP.mkHist = () => {
  T.reset(); S.set.comm = 0;
  const mk = (pnl, i) => ({ id: 900 + i, sym: i % 2 ? 'GBPUSD' : 'EURUSD', side: i % 3 ? 'buy' : 'sell', lots: 1, entry: 1.1, exit: 1.1, open: Engine.simTime - 7200 + i * 300, close: Engine.simTime - 7000 + i * 300, pnl, pips: pnl / 10, r: pnl / 50, reason: 'Manual', note: '', setup: '' });
  S.history = [40, -25, 18, 33, -12, 27].map(mk).reverse();
  changed('hist'); renderHistory();
}; };

export const tests = [
  {
    name: 'DSP1 dock: text columns left, P&L 600, positions total row (lots, P&L 15/700, sticky, hidden when flat), #symMid big figure',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.waitForFunction(() => typeof setView === 'function' && typeof mnavGo === 'function', null, { timeout: 30000 }); await page.evaluate(HELP); await page.evaluate(MKHIST);
      const r = await page.evaluate(async () => {
        T.reset(); setView('trade', 'positions');
        const a = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), b = openPosition({ sym: 'GBPUSD', side: 'sell', lots: .5, dupOk: true });
        renderPositions(); renderAccount(); await DP.raf();
        // under load the dock unfolds a few frames after the first position (MutationObserver on #posEmpty)
        for (let i = 0; i < 60 && !(document.getElementById('posFoot')?.getBoundingClientRect().height > 0); i++) await new Promise(r => setTimeout(r, 50));
        const tb = document.querySelector('[data-pane=positions] .tbl'), ft = tb.tFoot, ths = [...tb.querySelectorAll('thead th')], fcells = ft ? [...ft.rows[0].cells] : [];
        const tp = ft && ft.querySelector('[data-c=tpnl]'), want = usdFmt(S.positions.reduce((s, p) => s + posPnl(p).pnl, 0), true);
        const side = tb.querySelector('#posBody td:nth-child(2)'), pnl = tb.querySelector('#posBody td[data-c=pnl]');
        const sm = document.getElementById('symMid'), smB = sm.querySelector('b'), smS = sm.querySelector('span');
        const out = {
          ft: !!ft, ftId: ft && ft.id, ftVis: ft && !ft.hidden && ft.getBoundingClientRect().height > 0, nCells: fcells.length, nHeads: ths.length,
          lots: ft && ft.querySelector('[data-c=tlots]').textContent, tp: tp && tp.textContent, want, tpFs: tp && DP.cs(tp, 'fontSize'), tpW: tp && DP.cs(tp, 'fontWeight'),
          tpPos: tp && DP.cs(tp, 'position'), tpBottom: tp && DP.cs(tp, 'bottom'), label: ft && ft.querySelector('th').textContent,
          aligned: DP.aligned(ths, fcells), sideAl: DP.cs(side, 'textAlign'), sideHead: DP.cs(ths[1], 'textAlign'), pnlW: DP.cs(pnl, 'fontWeight'),
          smHtml: !!smB && !!smS && !!sm.querySelector('sup'), smTxt: sm.textContent, smWant: fp(S.set.sym, Engine.quote(S.set.sym).mid),
          smBFs: DP.cs(smB, 'fontSize'), smBW: DP.cs(smB, 'fontWeight'), smSCol: DP.norm(DP.cs(smS, 'color')), tx2: DP.tok('--tx2'), tx: DP.tok('--tx'), smBCol: DP.norm(DP.cs(smB, 'color')),
          mPnlW: DP.cs(document.getElementById('mPnl'), 'fontWeight')
        };
        // history and alerts: text columns on the left
        closePosition(b.id, 'Manual'); renderPositions(); setTab('history'); dirty.hist = true; renderHistory(); await DP.raf();
        const hr = document.querySelector('#histBody tr');
        out.hist = [2, 3, 10].map(i => DP.cs(hr.children[i - 1], 'textAlign')); out.histNum = DP.cs(hr.children[4], 'textAlign');
        out.histPnlW = DP.cs(hr.children[8], 'fontWeight'); out.reasonFont = DP.cs(hr.children[9], 'fontFamily');
        out.oneLots = document.querySelector('#posFoot [data-c=tlots]').textContent;
        closePosition(a.id, 'Manual'); renderPositions(); out.flatHidden = document.getElementById('posFoot').hidden;
        return out;
      });
      t.ok(r.ft && r.ftId === 'posFoot', 'positions table has a tfoot #posFoot');
      t.ok(r.ftVis, 'total row visible with open positions');
      t.eq(r.nCells, r.nHeads, 'total row has one cell per column (the column hides apply to it)');
      t.ok(r.aligned, 'total cells line up with the head');
      t.eq(r.lots, '1.50', 'total lots 1 + 0.5');
      t.eq(r.tp, r.want, 'total P&L = sum of the rows');
      t.eq(r.tpFs, '15px', 'total P&L 15px'); t.eq(r.tpW, '700', 'total P&L bold');
      t.eq(r.tpPos, 'sticky', 'total row sticky'); t.eq(r.tpBottom, '0px', 'stuck to the bottom');
      t.ok(/Total · 2 positions/.test(r.label), 'total label counts positions: ' + r.label);
      t.eq(r.sideAl, 'left', 'positions Side cell left'); t.eq(r.sideHead, 'left', 'positions Side head left');
      t.eq(r.pnlW, '600', 'positions P&L 600');
      t.eq(r.mPnlW, '600', '#mPnl 600');
      t.ok(r.smHtml, '#symMid is a big figure (span, b, sup)');
      t.eq(r.smTxt, r.smWant, '#symMid text is still the full price');
      t.eq(r.smBFs, '17px', 'chart-header price one size (artboard 2)'); t.eq(r.smBW, '700', 'pip digits bold');
      t.eq(r.smSCol, r.tx, 'whole price in full ink (artboard 2)'); t.eq(r.smBCol, r.tx, 'pip digits in full ink');
      t.deep(r.hist, ['left', 'left', 'left'], 'history Symbol, Side, Reason left');
      t.eq(r.histNum, 'right', 'history Entry stays right');
      t.eq(r.histPnlW, '600', 'history P&L 600');
      t.ok(/General Sans/.test(r.reasonFont), 'history reason in the text face: ' + r.reasonFont);
      t.eq(r.oneLots, '1.00', 'total follows a close');
      t.ok(r.flatHidden, 'total row hidden when flat');
      t.noErrors(page);
    }
  },
  {
    name: 'DSP2 Journal: Statistics title, compact rows (Net P&L hero 16/700, key 600), all 10 KPIs, notes table (head aligned, note kept, 28px rows), coach neutral, curve on --ind1 without gradient',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.waitForFunction(() => typeof setView === 'function' && typeof mnavGo === 'function', null, { timeout: 30000 }); await page.evaluate(HELP); await page.evaluate(MKHIST);
      const res = {};
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd']]) {
        await look(page, th, pa);
        res[th + pa] = await page.evaluate(async () => {
          DP.mkHist(); setView('coach', 'journal'); renderJournal(); await DP.raf();
          const ks = [...document.querySelectorAll('#kpis .kpi')], hero = ks[0], key = ks[1];
          const head = document.querySelector('#jList .jhead'), items = [...document.querySelectorAll('#jList .jitem')], it = items[0];
          const cells = it ? [it.querySelector('.jsym'), it.querySelector('.jside'), it.querySelector('.jpnl'), it.querySelector('[data-j=note]')] : [];
          const li = document.querySelector('#coach li.info');
          const cv = document.getElementById('eqCanvas'), s = journalStats();
          const sp = DP.spy(() => drawCurve(cv, s.curve, s.curveT));
          return {
            title: document.querySelector('.jkpis h3')?.textContent, kpisInJ: !!document.querySelector('.jkpis > #kpis'),
            heroCls: hero.className, heroLab: hero.querySelector('label').textContent, heroFs: DP.cs(hero.querySelector('b'), 'fontSize'), heroW: DP.cs(hero.querySelector('b'), 'fontWeight'),
            keyCls: key.className, keyFs: DP.cs(key.querySelector('b'), 'fontSize'), keyW: DP.cs(key.querySelector('b'), 'fontWeight'), nK: ks.length,
            head: head ? [...head.children].map(x => x.textContent) : null, headHidden: head && head.getAttribute('aria-hidden'),
            aligned: head ? DP.aligned([...head.children].slice(0, 3), cells.slice(0, 3)) : false, nItems: items.length, nTrades: s.n,
            hasSetup: !!it.querySelector('[data-j=setup]'), noteTitle: it.querySelector('[data-j=note]').title, pnlTxt: it.querySelector('.top > span:last-child').textContent, pnlW: DP.cs(it.querySelector('.jpnl'), 'fontWeight'),
            rowH: Math.round(it.querySelector('.jpnl').getBoundingClientRect().height), cellBr: DP.cs(cells[2], 'borderRightWidth'),
            liMark: li ? DP.norm(getComputedStyle(li, '::before').backgroundColor) : null, tx3: DP.tok('--tx3'), info: DP.tok('--info'), line2: DP.tok('--line2'), coachMore: !!document.querySelector('#coach [data-coach=more]'),
            cols: sp.cols, grads: sp.grads, ind: DP.tok('--ind1'), acc: DP.tok('--acc'), net: usdFmt(s.net, true), heroTxt: hero.querySelector('b').textContent
          };
        });
      }
      const r = res.darkstd;
      t.eq(r.title, 'Statistics', 'the KPIs have a title'); t.ok(r.kpisInJ, '#kpis kept under the title');
      t.ok(/\bhero\b/.test(r.heroCls), 'first KPI is the hero'); t.eq(r.heroLab, 'Net P&L', 'hero = Net P&L'); t.eq(r.heroTxt, r.net, 'hero value');
      t.eq(r.heroFs, '16px', 'hero 16px (compact rows, Victor 31.10.2026)'); t.eq(r.heroW, '700', 'hero 700');
      t.ok(/\bkey\b/.test(r.keyCls), 'others are key'); t.ok(parseFloat(r.keyFs) >= 12, 'key at least 12px: ' + r.keyFs); t.eq(r.keyW, '600', 'key 600'); t.eq(r.nK, 10, 'all 10 KPIs kept');
      t.deep(r.head, ['Symbol', 'Side', 'P&L', 'Note'], 'notes table head'); t.eq(r.headHidden, 'true', 'visual head, controls keep their labels');
      t.ok(r.aligned, 'notes head aligned with the cells');
      t.eq(r.nItems, r.nTrades, 'one .jitem per trade');
      t.ok(!r.hasSetup, 'no setup select: the classification is gone'); t.ok(/What did you see/.test(r.noteTitle), 'note prompt as title');
      t.ok(/^[+−-]?\$/.test(r.pnlTxt), '.top > span:last-child is still the P&L: ' + r.pnlTxt); t.eq(r.pnlW, '600', 'notes P&L 600');
      t.ok(r.rowH >= 28 && r.rowH <= 34, 'compact notes rows: ' + r.rowH); t.eq(r.cellBr, '1px', 'notes cells bordered');
      t.eq(r.liMark, r.tx3, 'neutral coach item: a --tx3 mark, not the info blue'); t.ok(r.liMark !== r.info, 'neutral is not --info'); t.ok(r.coachMore, 'Coach has its Details button');
      for (const [k, v] of Object.entries(res)) {
        t.ok(v.cols.includes(v.ind), `${k}: curve drawn on --ind1 ${v.ind}: ${[...new Set(v.cols)].join(',')}`);
        t.ok(!v.cols.includes(v.acc), `${k}: no amber in the curve`);
        t.eq(v.grads, 0, `${k}: no gradient under the curve`);
      }
      t.ok(res.darkcvd.ind !== res.darkstd.ind, 'colour-blind palette has its own curve hue');
      // the notes table fits its column at every desktop width: no sideways scroll, the Note head and input fully usable
      for (const w of [1281, 1366, 1440, 1680, 1200]) {
        await page.setViewportSize({ width: w, height: 1000 });
        const f = await page.evaluate(async () => {
          renderJournal(); await DP.raf(); await DP.raf();
          const L = document.getElementById('jList'), head = L.querySelector('.jhead'), it = L.querySelector('.jitem');
          const nh = head.children[3], ni = it.querySelector('[data-j=note]'), lr = L.getBoundingClientRect();
          const cells = [it.querySelector('.jsym'), it.querySelector('.jside'), it.querySelector('.jpnl'), ni];
          return { sw: L.scrollWidth, cw: L.clientWidth, lw: Math.round(lr.width), nhR: nh.getBoundingClientRect().right, nhFull: nh.scrollWidth <= nh.clientWidth + 1, niW: Math.round(ni.getBoundingClientRect().width), niR: ni.getBoundingClientRect().right, lR: lr.right, aligned: DP.aligned([...head.children].slice(0, 3), cells.slice(0, 3)) };
        });
        t.ok(f.sw <= f.cw + 1, `${w}: notes list does not scroll sideways (${f.sw} > ${f.cw})`);
        t.ok(f.nhFull && f.nhR <= f.lR + 1, `${w}: Note head fully visible`);
        t.ok(f.niW >= 150 && f.niR <= f.lR + 1, `${w}: note input usable and inside the list: ${f.niW}px of ${f.lw}`);
        t.ok(f.aligned, `${w}: notes head aligned with the cells`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSP3 Correlation and Volatility: bordered matrix, plain diagonal, hero link; volatility table with 8 aligned columns, ATR in three, neutral bar, hero summary',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.waitForFunction(() => typeof setView === 'function' && typeof mnavGo === 'function', null, { timeout: 30000 }); await page.evaluate(HELP); await page.evaluate(MKHIST);
      const r = await page.evaluate(async () => {
        T.reset(); setView('research', 'corr'); CORR.set = 'fx'; renderCorr(); await DP.raf();
        const g = document.getElementById('corr'), h = g.querySelector('.h'), d = g.querySelector('.d'), cell = g.querySelector('div[data-a]');
        const hero = document.querySelector('.corr-ins>div:first-child .corr-lk .mono');
        const corr = { gap: DP.cs(g, 'rowGap'), cellBr: DP.cs(cell, 'borderRightWidth'), cellBb: DP.cs(cell, 'borderBottomWidth'), cellBrC: DP.norm(DP.cs(cell, 'borderRightColor')), line: DP.tok('--line'), rad: DP.cs(cell, 'borderTopLeftRadius'),
          hBg: DP.norm(DP.cs(h, 'backgroundColor')), dBg: DP.norm(DP.cs(d, 'backgroundColor')), dImg: DP.cs(d, 'backgroundImage'), s2: DP.tok('--s2'), heroFs: hero && DP.cs(hero, 'fontSize'), heroW: hero && DP.cs(hero, 'fontWeight'),
          legImg: DP.cs(document.querySelector('.corr-leg-d b'), 'backgroundImage') };
        setView('research', 'vol'); renderVol(); await DP.raf();
        const vh = document.querySelector('#volBody .vhead'), vc = document.querySelector('#volBody .vcard');
        const cells = [vc.querySelector('.t'), vc.querySelector('.vbc'), vc.querySelector('.vpct'), vc.querySelector('.vun'), vc.querySelector('.vwk'), vc.querySelector('.vr1'), vc.querySelector('.vrng>small'), vc.querySelector('.vpos')];
        const vs = document.querySelector('.vol-sum>div:first-child>.mono');
        const vol = { heads: [...vh.children].map(x => x.textContent), aligned: DP.aligned([...vh.children], cells), all: cells.every(Boolean),
          rowH: Math.round(vc.getBoundingClientRect().height), headBg: DP.norm(DP.cs(vh, 'backgroundColor')), cellBr: DP.cs(cells[2], 'borderRightWidth'), cellBb: DP.cs(cells[2], 'borderBottomWidth'),
          numAl: DP.cs(cells[2], 'justifyContent'), symAl: DP.cs(cells[0], 'justifyContent'), bar: DP.norm(DP.cs(vc.querySelector('.vbar i'), 'backgroundColor')), tx3: DP.tok('--tx3'),
          vun: vc.querySelector('.vun').textContent, rng: vc.querySelector('.vrng').textContent, tip: !!vc.dataset.tip, role: vc.getAttribute('role'),
          heroFs: DP.cs(vs, 'fontSize'), heroW: DP.cs(vs, 'fontWeight'), n: document.querySelectorAll('#volBody .vcard').length,
          barW: Math.round(vc.querySelector('.vbar').getBoundingClientRect().width), colW: Math.round(vh.children[1].getBoundingClientRect().width), cellW: Math.round(vc.querySelector('.vbc').getBoundingClientRect().width) };
        return { corr, vol };
      });
      const c = r.corr, v = r.vol;
      t.eq(c.gap, '0px', 'matrix without gaps'); t.eq(c.cellBr, '1px', 'cell right border'); t.eq(c.cellBb, '1px', 'cell bottom border'); t.eq(c.cellBrC, c.line, 'borders on --line'); t.eq(c.rad, '0px', 'square cells');
      t.eq(c.hBg, c.s2, 'head cells on --s2'); t.eq(c.dBg, c.s2, 'diagonal plain --s2'); t.eq(c.dImg, 'none', 'diagonal not hatched'); t.eq(c.legImg, 'none', 'legend chip not hatched');
      t.eq(c.heroFs, '16px', 'first strong link hero 16px'); t.eq(c.heroW, '700', 'hero 700');
      t.deep(v.heads, ['Instrument', 'ATR(14) 1H', '% of price', 'Pips / pt', 'vs week', '24h range', '% · × 1H', 'Price in 24h range'], 'volatility head: ATR in three columns, range in two');
      t.ok(v.all, 'every cell present'); t.ok(v.cellW >= v.colW - 2, `the ATR cell fills its column (${v.cellW} of ${v.colW}px)`); t.ok(v.barW >= v.colW * 0.6, `the ATR bar is not squeezed (${v.barW} of ${v.colW}px)`); t.ok(v.aligned, 'volatility head aligned with the cells');
      t.ok(v.rowH <= 32, 'compact rows: ' + v.rowH); t.eq(v.headBg, r.corr.s2, 'head on --s2'); t.eq(v.cellBr, '1px', 'cells bordered right'); t.eq(v.cellBb, '1px', 'cells bordered bottom');
      t.eq(v.numAl, 'flex-end', 'figures right'); t.eq(v.symAl, 'flex-start', 'instrument left');
      t.eq(v.bar, v.tx3, 'ATR bar neutral --tx3');
      t.ok(/\d (pips|points)$/.test(v.vun), 'ATR in pips or points kept: ' + v.vun);
      t.ok(/^\d+p?t?\d/.test(v.rng) && /%/.test(v.rng) && /×|—/.test(v.rng), '.vrng keeps its three figures: ' + v.rng);
      t.ok(v.tip && v.role === 'button', 'row tooltip and click kept');
      t.eq(v.heroFs, '16px', 'most volatile hero 16px'); t.eq(v.heroW, '700', 'hero 700');
      t.noErrors(page);
    }
  },
  {
    name: 'DSP4 Calendar: compact rows, the next release is the hero row, Impact is a row of checkboxes that still toggles',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.waitForFunction(() => typeof setView === 'function' && typeof mnavGo === 'function', null, { timeout: 30000 }); await page.evaluate(HELP); await page.evaluate(MKHIST);
      const r = await page.evaluate(async () => {
        T.reset(); setView('research', 'calendar'); calTick(); renderCalendar(); await DP.raf();
        const rows = [...document.querySelectorAll('#calBody tr')], next = document.querySelector('#calBody tr.cal-next');
        const firstOpen = rows.find(x => !x.classList.contains('cal-done') && !x.classList.contains('cal-lo-g')); // the folded Low row (f87ff55) is not an event
        const bs = [...document.querySelectorAll('#calF [data-imp]')], b = bs[2];
        const st = x => ({ bg: DP.cs(x, 'backgroundColor'), sh: DP.cs(x, 'boxShadow'), col: DP.norm(DP.cs(x, 'color')), mark: getComputedStyle(x, '::before').content, mbg: DP.norm(getComputedStyle(x, '::before').backgroundColor) });
        const maxH = Math.max(...rows.map(x => x.getBoundingClientRect().height)), isNext = next === firstOpen && !!next, inFs = next && DP.cs(next.children[1], 'fontSize'), inW = next && DP.cs(next.children[1], 'fontWeight');
        const on = st(b); b.click(); await DP.raf(); const b2 = document.querySelectorAll('#calF [data-imp]')[2], off = st(b2), pressed = b2.getAttribute('aria-pressed'), lo = CALF.imp.lo;
        b2.click(); await DP.raf();
        // events listed: the rows plus the Low releases folded into one row since f87ff55
        const folded = rows.filter(x => x.classList.contains('cal-lo-g')).reduce((a, x) => a + (+(x.textContent.match(/\d+/) || [0])[0] || 0), 0);
        return { n: rows.filter(x => !x.classList.contains('cal-lo-g')).length + folded, maxH, next: isNext, inFs, inW,
          on, off, pressed, lo, tx: DP.tok('--tx'), tx2: DP.tok('--tx2'), tx3: DP.tok('--tx3'), acc: DP.tok('--acc'), cols: document.querySelectorAll('[data-pane=calendar] thead th').length, note: !!document.querySelector('[data-pane=calendar] .foot-note') };
      });
      t.ok(r.n >= 10, 'events listed: ' + r.n); t.ok(r.maxH <= 34, 'compact calendar rows: ' + r.maxH);
      t.ok(r.next, 'the first unreleased event carries .cal-next'); t.eq(r.inFs, '15px', 'its countdown 15px'); t.eq(r.inW, '700', 'its countdown 700');
      t.eq(r.on.sh, 'none', 'Impact: no tab underline'); t.eq(r.on.bg, 'rgba(0, 0, 0, 0)', 'Impact: no tab background'); t.eq(r.on.col, r.acc, 'checked label yellow (ui-controls §3.1)'); t.eq(r.on.mbg, r.acc, 'checked box filled yellow (the tick is drawn in it)');
      t.eq(r.off.col, r.tx2, 'unchecked label muted'); t.ok(r.off.mbg !== r.acc, 'unchecked box not filled'); t.eq(r.pressed, 'false', 'aria-pressed follows'); t.eq(r.lo, false, 'filter state follows');
      t.eq(r.cols, 8, 'all 8 calendar columns kept'); t.ok(r.note, 'simulated-events note kept');
      t.noErrors(page);
    }
  },
  {
    name: 'DSP5 Risk Lab and Calculators: buttons on one line, neutral run button, result tiers, fan off amber with swatches; calculator hero neutral, labels 10px, no gap, Stop label on one line',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForFunction(() => typeof setView === 'function' && typeof mnavGo === 'function', null, { timeout: 30000 }); await page.evaluate(HELP); await page.evaluate(MKHIST);
      const res = {};
      for (const th of ['dark', 'light']) {
        await look(page, th);
        res[th] = await page.evaluate(async () => {
          T.reset(); setView('lab', 'lab'); await DP.raf();
          let sp; sp = DP.spy(() => runLab()); await DP.raf();
          const btns = [...document.querySelectorAll('.lab-btns > button')], run = document.querySelector('#labForm button[type=submit]');
          const out = [...document.querySelectorAll('#labOut > div')], hero = out[0], key = document.querySelector('#labOut .lo-key b'), sec = document.querySelector('#labOut .lo-sec b');
          const lab = { nBtn: btns.length, maxBtnH: Math.max(...btns.map(b => b.getBoundingClientRect().height)), wrap: DP.cs(document.querySelector('.lab-btns'), 'flexWrap'), allIn: btns.every(b => { const r = b.getBoundingClientRect(), f = document.querySelector('#labForm').getBoundingClientRect(); return r.right <= f.right + .5 && r.width > 0; }),
            runBg: DP.norm(DP.cs(run, 'backgroundColor')), runCol: DP.norm(DP.cs(run, 'color')), tx: DP.tok('--tx'), s1: DP.tok('--s1'), buy: DP.tok('--buy'),
            heroLab: hero.querySelector('label').textContent, heroFs: DP.cs(hero.querySelector('b'), 'fontSize'), heroW: DP.cs(hero.querySelector('b'), 'fontWeight'), nOut: out.length,
            keyFs: DP.cs(key, 'fontSize'), keyW: DP.cs(key, 'fontWeight'), secW: DP.cs(sec, 'fontWeight'), nKey: document.querySelectorAll('#labOut .lo-key').length,
            inFont: DP.cs(document.getElementById('lWin'), 'fontFamily'), cols: sp.cols, grads: sp.grads, acc: DP.tok('--acc') };
          setView('lab', 'calc'); renderCalcs(); await DP.raf();
          const big = document.querySelector('#cpOut .big b'), lbl = document.querySelector('#cpOut > div:not(.big) > span'), stop = document.getElementById('cpUnit').parentElement;
          const calc = document.querySelector('#cpOut').closest('.calc'), lastLbl = calc.querySelector('label:last-of-type').getBoundingClientRect(), outTop = document.getElementById('cpOut').getBoundingClientRect().top;
          const calcs = { bigCol: DP.norm(DP.cs(big, 'color')), bigFs: DP.cs(big, 'fontSize'), bigW: DP.cs(big, 'fontWeight'), lblFs: DP.cs(lbl, 'fontSize'), lblTt: DP.cs(lbl, 'textTransform'), lblCol: DP.norm(DP.cs(lbl, 'color')), tx3: DP.tok('--tx3'),
            stopTag: stop.tagName, stopH: Math.round(stop.getBoundingClientRect().height), stopUnit: document.getElementById('cpUnit').textContent, gap: Math.round(outTop - lastLbl.bottom), inFont: DP.cs(document.getElementById('cpSL'), 'fontFamily'),
            levTxt: document.getElementById('pvLevTag').textContent, levWs: DP.cs(document.getElementById('pvLevTag').parentElement, 'whiteSpace'), levSw: document.getElementById('pvLevTag').parentElement.scrollWidth, levCw: document.getElementById('pvLevTag').parentElement.clientWidth };
          return { lab, calcs };
        });
      }
      for (const [k, { lab: l, calcs: c }] of Object.entries(res)) {
        t.ok(l.nBtn >= 2, `${k}: lab buttons present`); t.eq(l.wrap, 'wrap', `${k}: lab buttons wrap`); t.ok(l.maxBtnH <= 34, `${k}: no button breaks over lines: ${l.maxBtnH}`); t.ok(l.allIn, `${k}: no button cut off`);
        t.eq(l.runBg, l.tx, `${k}: run button neutral (ink background)`); t.eq(l.runCol, l.s1, `${k}: run button text on the surface colour`); t.ok(l.runBg !== l.buy, `${k}: run button not the buy green`);
        t.eq(l.heroLab, 'Median result', `${k}: median result reads first`); t.eq(l.heroFs, '17px', `${k}: hero 17px`); t.eq(l.heroW, '700', `${k}: hero 700`); t.eq(l.nOut, 8, `${k}: all 8 results kept`);
        t.eq(l.nKey, 3, `${k}: three key results`); t.eq(l.keyFs, '13px', `${k}: key 13px`); t.eq(l.keyW, '600', `${k}: key 600`); t.eq(l.secW, '400', `${k}: secondary 400`);
        t.ok(/JetBrains/.test(l.inFont), `${k}: lab inputs mono`);
        t.ok(!l.cols.includes(l.acc), `${k}: no amber in the fan: ${[...new Set(l.cols)].join(',')}`); t.ok(l.cols.includes(l.tx), `${k}: the median in full ink`); t.eq(l.grads, 0, `${k}: no gradient`);
        t.eq(c.bigCol, l.tx, `${k}: calculator hero neutral`); t.eq(c.bigFs, '16px', `${k}: calculator hero 16px`); t.eq(c.bigW, '700', `${k}: calculator hero 700`);
        t.eq(c.lblFs, '10px', `${k}: result labels 10px`); t.eq(c.lblTt, 'uppercase', `${k}: result labels uppercase`); t.eq(c.lblCol, c.tx3, `${k}: result labels --tx3`);
        t.eq(c.stopTag, 'SPAN', `${k}: Stop label text in one span`); t.ok(c.stopH <= 18, `${k}: Stop label on one line: ${c.stopH}`); t.ok(['pips', 'points'].includes(c.stopUnit), `${k}: unit kept`);
        t.ok(c.gap <= 16, `${k}: results right under the inputs: ${c.gap}px`); t.ok(/JetBrains/.test(c.inFont), `${k}: calculator inputs mono`);
        t.ok(c.levTxt.trim().length > 0, `${k}: leverage note present`); t.ok(c.levWs !== 'nowrap', `${k}: leverage note wraps: ${c.levWs}`); t.ok(c.levSw <= c.levCw + 1, `${k}: leverage note not cut off: ${c.levSw}/${c.levCw}`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSP6 sessions and phone 390: open session band green, positions total line, notes table and volatility rows reachable',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.waitForFunction(() => typeof setView === 'function' && typeof mnavGo === 'function', null, { timeout: 30000 }); await page.evaluate(HELP); await page.evaluate(MKHIST);
      const ses = await page.evaluate(async () => { renderSessions(); await DP.raf(); const b = document.querySelector('.sess-band.open'); return b ? { bg: DP.cs(b, 'backgroundColor'), op: DP.cs(b, 'opacity'), acc: DP.tok('--acc') } : null; });
      if (ses) { t.ok(!ses.bg.includes('232, 176, 74'), 'open session band not amber: ' + ses.bg); t.eq(ses.op, '1', 'band opaque fill (alpha in the colour)'); }
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        T.reset(); mnavGo('portfolio'); setTab('positions');
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); openPosition({ sym: 'USDJPY', side: 'sell', lots: 2, dupOk: true });
        renderPositions(); await new Promise(r => setTimeout(r, 80));
        const ft = document.getElementById('posFoot'), tp = ft.querySelector('[data-c=tpnl]'), fr = ft.getBoundingClientRect();
        const out = { ftH: Math.round(fr.height), tpVis: tp.getBoundingClientRect().width > 0, tpTxt: tp.textContent, lots: ft.querySelector('[data-c=tlots]').textContent, docW: document.documentElement.scrollWidth };
        DP.mkHist(); setTab('journal'); renderJournal(); await new Promise(r => setTimeout(r, 80));
        const it = document.querySelector('#jList .jitem');
        out.note = it && it.querySelector('[data-j=note]').getBoundingClientRect().width; 
        setTab('vol'); renderVol(); await new Promise(r => setTimeout(r, 80));
        const vc = document.querySelector('#volBody .vcard'), w = x => x ? x.getBoundingClientRect().width : 0;
        out.vol = [vc.querySelector('.t'), vc.querySelector('.vpct'), vc.querySelector('.vun'), vc.querySelector('.vwk'), vc.querySelector('.vr1'), vc.querySelector('.vrng>small'), vc.querySelector('.vpos')].map(w);
        out.vR = Math.max(...[...vc.querySelectorAll('*')].map(x => x.getBoundingClientRect().right)); out.vw = innerWidth;
        setTab('calc'); renderCalcs(); await new Promise(r => setTimeout(r, 80));
        const lv = document.getElementById('pvLevTag').parentElement; out.lev = { txt: document.getElementById('pvLevTag').textContent, sw: lv.scrollWidth, cw: lv.clientWidth, vis: lv.getBoundingClientRect().width > 0 };
        return out;
      });
      t.ok(r.ftH > 20 && r.tpVis, 'phone: positions total line visible: ' + r.ftH);
      t.eq(r.lots, '3.00', 'phone: total lots'); t.ok(/\$/.test(r.tpTxt), 'phone: total P&L ' + r.tpTxt);
      t.ok(r.docW <= 390, 'phone: no horizontal page scroll: ' + r.docW);
      t.ok(r.note > 30, `phone: the note field is reachable: ${r.note}`);
      t.ok(r.vol.every(x => x > 10), 'phone: every volatility cell shown: ' + r.vol.map(Math.round).join(','));
      t.ok(r.vR <= r.vw + 1, 'phone: volatility row fits the width');
      t.ok(r.lev.vis && r.lev.txt.trim().length > 0, 'phone: leverage note shown: ' + r.lev.txt); t.ok(r.lev.sw <= r.lev.cw + 1, `phone: leverage note not cut off: ${r.lev.sw}/${r.lev.cw}`);
      t.noErrors(page);
    }
  },
  {
    name: 'DSP7 artboard 2 dock: folded strip (34px, cells on --s1 and --line, P&L after Journal, Show panel last), open strip (30px, amber tab, ▾ cell), tables 10px --tx3 heads 5x8, empty state as a centred band; light, cvd, 1280-1920, phone unchanged',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 950 });
      await page.waitForFunction(() => typeof setView === 'function' && typeof pvSet === 'function' && document.getElementById('dockMin') && document.getElementById('dockPnl'), null, { timeout: 30000 });
      await page.evaluate(HELP);
      const PROBE = async () => {
        const R = e => e.getBoundingClientRect(), px = v => Math.round(parseFloat(v) * 10) / 10, wrap = document.querySelector('.dock .tabs-wrap'), tabs = document.getElementById('tabs');
        const vis = [...tabs.querySelectorAll('button[data-tab]')].filter(b => b.offsetParent), jr = tabs.querySelector('[data-tab=journal]');
        const pnl = document.querySelector('.dock .dock-pnl'), dm = document.getElementById('dockMin'), eb = document.getElementById('dockBtn'), ca = document.getElementById('closeAll');
        const cells = [...vis, pnl, eb, ca, dm], on = tabs.querySelector('button[data-tab].on'), cnt = document.getElementById('cOrd');
        return {
          dockH: Math.round(R(document.querySelector('.dock')).height), wrapH: Math.round(R(wrap).height), fits: tabs.scrollWidth <= tabs.clientWidth + 1,
          tabs: vis.map(b => b.dataset.tab), heights: [...new Set(cells.map(c => Math.round(R(c).height)))],
          tabFs: DP.cs(vis[1], 'fontSize'), tabTt: DP.cs(vis[1], 'textTransform'), tabBr: DP.cs(vis[1], 'borderRightWidth'), tabBrC: DP.norm(DP.cs(vis[1], 'borderRightColor')), tabBg: DP.norm(DP.cs(vis[1], 'backgroundColor')),
          onCol: DP.norm(DP.cs(on, 'color')), onBg: DP.norm(DP.cs(on, 'backgroundColor')), onSh: DP.cs(on, 'boxShadow'),
          cntW: DP.cs(cnt, 'fontWeight'), cntCol: DP.norm(DP.cs(cnt, 'color')),
          pnlAfterJ: Math.abs(R(pnl).left - R(jr).right) < 1.5, pnlBg: DP.norm(DP.cs(pnl, 'backgroundColor')), pnlFs: DP.cs(document.getElementById('dockPnl'), 'fontSize'), pnlW: DP.cs(document.getElementById('dockPnl'), 'fontWeight'),
          pnlTxt: document.getElementById('dockPnl').textContent, mPnl: document.getElementById('mPnl').textContent,
          order: cells.map(c => Math.round(R(c).left)), lastRight: Math.round(R(dm).right), tabsRight: Math.round(R(tabs).right),
          dmTxt: dm.textContent, dmExp: dm.getAttribute('aria-expanded'), dmW: Math.round(R(dm).width), dmAfter: getComputedStyle(dm, '::after').clipPath,
          caCol: DP.norm(DP.cs(ca, 'color')), caDis: ca.disabled, caBg: DP.cs(ca, 'backgroundColor'), ebTxt: eb.textContent,
          tok: { s1: DP.tok('--s1'), s2: DP.tok('--s2'), s3: DP.tok('--s3'), line: DP.tok('--line'), line2: DP.tok('--line2'), tx: DP.tok('--tx'), tx2: DP.tok('--tx2'), tx3: DP.tok('--tx3'), acc: DP.tok('--acc'), dn: DP.tok('--dn') }
        };
      };
      await page.evaluate(`window.DP.probe = ${PROBE.toString()}`);
      const res = {};
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd']]) {
        await look(page, th, pa);
        res[th + pa] = await page.evaluate(async () => {
          localStorage.removeItem('tb.panels'); document.querySelector('.grid').classList.remove('dock-held');
          T.reset(); dirty.pos = true; dirty.ord = true; dirty.al = true; setView('trade', 'positions'); pvSet({ dock: 'auto' }); renderPositions(); renderOrders(); renderAlerts(); frame(true); await new Promise(r => setTimeout(r, 120)); await DP.raf();
          const folded = { min: document.querySelector('.grid').classList.contains('pv-dockmin'), ...(await DP.probe()) };
          document.getElementById('dockMin').click(); await new Promise(r => setTimeout(r, 120)); await DP.raf();
          const open = await DP.probe();
          // the empty state, held open
          const pe = document.getElementById('posEmpty'), es = pe.querySelector('.es'), act = pe.querySelector('.es-act'), bs = [...act.querySelectorAll('.es-b')], tb = pe.closest('.tab-body') || document.querySelector('.dock .tab-body');
          const empty = {
            vis: !pe.hidden && pe.getBoundingClientRect().height > 0, dir: DP.cs(es, 'flexDirection'), al: DP.cs(es, 'alignItems'), ic: DP.cs(pe.querySelector('.es-ic'), 'display'),
            t: pe.querySelector('.es-t').textContent, p: pe.querySelector('.es-p').textContent.length, gap: DP.cs(act, 'columnGap'), actBg: DP.norm(DP.cs(act, 'backgroundColor')),
            btns: bs.map(b => b.textContent), bTt: DP.cs(bs[1], 'textTransform'), bFs: DP.cs(bs[1], 'fontSize'), bRad: DP.cs(bs[1], 'borderTopLeftRadius'), bBg: DP.norm(DP.cs(bs[1], 'backgroundColor')),
            priCol: DP.norm(DP.cs(bs[0], 'color')), priW: DP.cs(bs[0], 'fontWeight'), oneLine: new Set(bs.map(b => Math.round(b.getBoundingClientRect().top))).size === 1,
            noScroll: tb.scrollHeight <= tb.clientHeight + 1
          };
          // the tables with rows
          openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); renderPositions(); frame(true); await DP.raf();
          const head = document.querySelector('[data-pane=positions] .tbl thead th:nth-child(2)'), cell = document.querySelector('#posBody td:nth-child(2)');
          const tbl = { fs: DP.cs(head, 'fontSize'), w: DP.cs(head, 'fontWeight'), tt: DP.cs(head, 'textTransform'), col: DP.norm(DP.cs(head, 'color')), bg: DP.norm(DP.cs(head, 'backgroundColor')), pad: DP.cs(head, 'padding'), br: DP.norm(DP.cs(head, 'borderRightColor')), bb: DP.norm(DP.cs(head, 'borderBottomColor')), tdPl: DP.cs(cell, 'paddingLeft'), tdPr: DP.cs(cell, 'paddingRight'), open: (await DP.probe()) };
          const hs = {};
          for (const tab of ['orders', 'history', 'alerts']) { setTab(tab); await DP.raf(); const h = document.querySelector(`[data-pane=${tab}] .tbl thead th`); hs[tab] = { fs: DP.cs(h, 'fontSize'), col: DP.norm(DP.cs(h, 'color')), pad: DP.cs(h, 'padding'), first: DP.cs(h, 'textAlign') }; }
          setTab('positions');
          return { folded, open, empty, tbl, hs };
        });
      }
      for (const [k, r] of Object.entries(res)) {
        const f = r.folded, o = r.open, e = r.empty, b = r.tbl, tk = f.tok;
        // folded
        t.ok(f.min, `${k}: an empty Positions tab folds the dock`);
        t.eq(f.dockH, 34, `${k}: folded dock is one 34px strip`); t.deep(f.heights, [32], `${k}: every folded cell 32px: ${f.heights}`);
        t.deep(f.tabs, ['positions', 'orders', 'history', 'alerts', 'journal'], `${k}: the five trade tabs`);
        t.eq(f.tabFs, '11px', `${k}: tab 11px`); t.eq(f.tabTt, 'uppercase', `${k}: tab uppercase`); t.eq(f.tabBr, '1px', `${k}: tab cell border`);
        t.eq(f.tabBrC, tk.line, `${k}: folded cell lines on --line`); t.eq(f.tabBg, 'rgba(0, 0, 0, 0)', `${k}: folded tabs without a background (ui-controls §3.6)`);
        t.ok(f.onCol !== tk.acc, `${k}: folded: the active tab text is normal (the accent is the 2px line)`); t.eq(f.onBg, 'rgba(0, 0, 0, 0)', `${k}: folded: active without a background (§3.6)`);
        t.eq(f.cntW, '700', `${k}: counts bold`); t.eq(f.cntCol, tk.tx, `${k}: counts in full ink`);
        t.ok(f.pnlAfterJ, `${k}: P&L right after Journal`); t.eq(f.pnlBg, tk.s2, `${k}: P&L cell on --s2`); t.eq(f.pnlFs, '13px', `${k}: P&L 13px`); t.eq(f.pnlW, '700', `${k}: P&L bold`);
        t.eq(f.pnlTxt, f.mPnl, `${k}: strip P&L = header floating P&L`);
        t.ok(f.order.every((x, i, a) => !i || x > a[i - 1]), `${k}: cells in order tabs | P&L | Expand | Close all | Show: ${f.order}`);
        t.ok(Math.abs(f.lastRight - f.tabsRight) <= 1, `${k}: Show panel is the last cell, at the right edge`);
        t.ok(/Show panel/.test(f.dmTxt) && f.dmExp === 'false', `${k}: Show panel named and collapsed: ${f.dmTxt}`); t.eq(f.dmAfter, 'polygon(50% 0px, 100% 100%, 0px 100%)', `${k}: Show panel: an up triangle`);
        t.eq(f.ebTxt, 'Expand panel', `${k}: Expand panel kept`); t.ok(f.caDis && f.caCol !== tk.dn, `${k}: Close all disabled and quieter while flat`); t.ok(b.open.caCol === tk.dn || b.open.caCol === '#ffffff' /* solid red cell, white text (decision 44) */ || (/^light/.test(k) && /^color\(srgb/.test(b.open.caCol)), `${k}: Close all red with a position (--dn; light: --dn darkened for 4.5:1 on the tinted cell): ${b.open.caCol}`); t.ok(f.caBg !== 'rgba(0, 0, 0, 0)', `${k}: Close all: the whole cell tinted red (ui-controls §3.7)`);
        t.ok(f.fits, `${k}: folded strip fits on one line at 1680`);
        // open
        t.ok(o.wrapH >= 30 && o.wrapH <= 31, `${k}: open strip 30px: ${o.wrapH}`);
        t.ok(o.onCol !== tk.acc, `${k}: active tab text is normal (the line is the accent)`); t.eq(o.onBg, 'rgba(0, 0, 0, 0)', `${k}: active tab without a background (§3.6)`); t.ok(/inset/.test(o.onSh), `${k}: active tab underlined`);
        t.eq(o.tabBrC, tk.line2, `${k}: open cell lines on --line2`);
        t.eq(o.dmExp, 'true', `${k}: fold control expanded`); t.ok(/Hide panel/.test(o.dmTxt), `${k}: fold control keeps its name`); t.ok(o.dmW >= 30, `${k}: fold control a cell of 30px or more (Hide panel with its text from 1680 px, ui-controls §3.7): ${o.dmW}`); t.eq(o.dmAfter, 'polygon(0px 0px, 100% 0px, 50% 100%)', `${k}: a down triangle`);
        t.ok(Math.abs(o.lastRight - o.tabsRight) <= 1, `${k}: ▾ is the last cell`); t.ok(o.pnlAfterJ, `${k}: open: P&L right after Journal`);
        // empty state
        t.ok(e.vis, `${k}: empty state shown when held open`); t.eq(e.dir, 'column', `${k}: empty state stacked`); t.eq(e.al, 'center', `${k}: empty state centred`);
        t.eq(e.t, 'No open positions', `${k}: empty title`); t.ok(e.p > 60, `${k}: empty text kept`); t.eq(e.ic, 'none', `${k}: decorative icon off`);
        t.deep(e.btns, ['Open the order ticket', 'Command bar', 'Take the tour'], `${k}: the three buttons kept`);
        t.eq(e.gap, '1px', `${k}: buttons as a band of cells`); t.eq(e.actBg, tk.line2, `${k}: band lines on --line2`); t.ok(e.oneLine, `${k}: one band`);
        t.eq(e.bTt, 'uppercase', `${k}: buttons uppercase`); t.eq(e.bFs, '11px', `${k}: buttons 11px`); t.eq(e.bRad, '0px', `${k}: square cells`); t.eq(e.bBg, 'rgba(0, 0, 0, 0)', `${k}: text buttons without a fill (ui-controls §3.7)`);
        t.ok(e.priCol !== tk.acc, `${k}: first button is a primary: ink on the solid accent`); t.eq(e.priW, '600', `${k}: first button 600`);
        t.ok(e.noScroll, `${k}: the empty state fits the dock without scrolling`);
        // tables
        t.eq(b.fs, '10px', `${k}: head 10px`); t.eq(b.w, '600', `${k}: head 600`); t.eq(b.tt, 'uppercase', `${k}: head uppercase`); t.eq(b.col, tk.tx3, `${k}: head on --tx3`); t.eq(b.bg, tk.s2, `${k}: head on --s2`);
        t.eq(b.pad, '5px 8px', `${k}: head 5 x 8`); t.eq(b.br, tk.line, `${k}: head lines --line`); t.eq(b.bb, tk.line2, `${k}: head rule --line2`);
        t.eq(b.tdPl, '8px', `${k}: cells 8px in`); t.eq(b.tdPr, '8px', `${k}: cells 8px in (right)`);
        t.ok(b.open.pnlTxt === b.open.mPnl && /\$/.test(b.open.pnlTxt), `${k}: strip P&L follows a position: ${b.open.pnlTxt}`);
        for (const [tab, h] of Object.entries(r.hs)) { t.eq(h.fs, '10px', `${k} ${tab}: head 10px`); t.eq(h.col, tk.tx3, `${k} ${tab}: head --tx3`); t.eq(h.pad, '5px 8px', `${k} ${tab}: head 5 x 8`); t.eq(h.first, 'left', `${k} ${tab}: first column left`); }
      }
      // widths: one line from 1280 up; below that the buttons stay in view while the tabs scroll
      await look(page, 'dark', 'std');
      for (const w of [1081, 1280, 1440, 1920]) {
        await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
        const s = await page.evaluate(async () => {
          document.querySelector('.grid').classList.remove('dock-held'); pvSet({ dock: 'auto' }); T.reset(); dirty.pos = true; renderPositions(); await new Promise(r => setTimeout(r, 100)); await DP.raf();
          const tabs = document.getElementById('tabs'), R = e => e.getBoundingClientRect(), tr = R(tabs);
          const inView = ['dockPnl', 'closeAll', 'dockMin', 'dockBtn'].every(id => { const r = R(document.getElementById(id)); return r.width > 0 && r.left >= tr.left - 1 && r.right <= tr.right + 1; });
          return { fits: tabs.scrollWidth <= tabs.clientWidth + 1, sw: tabs.scrollWidth + '/' + tabs.clientWidth + ' ' + [...tabs.querySelectorAll('button[data-tab],.tabs-r>*')].filter(b => b.offsetParent).map(b => Math.round(R(b).width)).join(','), inView, h: Math.round(R(document.querySelector('.dock')).height) };
        });
        if (w >= 1280) t.ok(s.fits, `${w}: folded strip on one line: ${s.sw}`);
        t.ok(s.inView, `${w}: P&L, Expand, Close all and Show panel in view`); t.eq(s.h, 34, `${w}: folded 34px`);
      }
      // with open positions (folded by choice): 12 positions and a five-digit loss still fit on one line from 1280 up,
      // Show panel stays the last cell, whole; narrower, the buttons stay pinned and whole while the tabs scroll
      for (const w of [1081, 1280, 1281, 1366, 1440, 1600, 1680]) {
        await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
        const s = await page.evaluate(async () => {
          T.reset(); setView('trade', 'positions');
          // netting: one position per instrument, so twelve instruments make twelve positions
          for (const sym of ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD', 'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURCHF']) openPosition({ sym, side: 'buy', lots: 10, dupOk: true });
          T.move('EURUSD', Engine.quote('EURUSD').mid - 0.01); dirty.pos = true; renderPositions(); renderAccount();
          document.querySelector('.grid').classList.remove('dock-held'); pvSet({ dock: 'min' }); frame(true);
          await new Promise(r => setTimeout(r, 120)); await DP.raf();
          const tabs = document.getElementById('tabs'), R = e => e.getBoundingClientRect(), tr = R(tabs), dm = document.getElementById('dockMin');
          const whole = ['dockPnl', 'closeAll', 'dockMin', 'dockBtn'].every(id => { const el = document.getElementById(id), r = R(el); return r.width > 0 && r.left >= tr.left - 1 && r.right <= tr.right + 1 && el.scrollWidth <= el.clientWidth + 1; });
          const arr = document.querySelector('.dock .tabs-arr.r'), ar = R(arr), grp = R(document.querySelector('.dock .tabs-r'));
          return { over: tabs.scrollWidth - tabs.clientWidth, pnl: document.getElementById('dockPnl').textContent, n: S.positions.length, whole, last: Math.abs(R(dm).right - tr.right) <= 1, min: document.querySelector('.grid').classList.contains('pv-dockmin'),
            arrClear: getComputedStyle(arr).display === 'none' || ar.right <= grp.left + 1, name: dm.textContent, h: Math.round(R(document.querySelector('.dock')).height) };
        });
        t.ok(s.min && s.n >= 2 && /^−\$\d{1,3},\d{3}\.\d\d$/.test(s.pnl), `${w}: folded by choice with ${s.n} positions, P&L ${s.pnl}`);
        if (w >= 1280) t.ok(s.over <= 1, `${w}: with positions the folded strip fits on one line (overflow ${s.over}px)`);
        t.ok(s.whole, `${w}: with positions P&L, Expand, Close all and Show panel whole and in view`); t.ok(s.last, `${w}: Show panel the last cell`);
        t.ok(s.arrClear, `${w}: the scroll arrow never covers the buttons`); t.eq(s.name, 'Show panel', `${w}: Show panel keeps its name`); t.eq(s.h, 34, `${w}: folded 34px with positions`);
      }
      await page.evaluate(() => { T.reset(); dirty.pos = true; renderPositions(); pvSet({ dock: 'auto' }); });
      // Research and Coach: the dock is the view, the view name is a centred first cell
      await page.setViewportSize({ width: 1680, height: 950 });
      const rv = await page.evaluate(async () => { setView('research', 'brief'); await DP.raf(); const tt = document.querySelector('.dock .tabs-title'); return { txt: tt.textContent, al: DP.cs(tt, 'alignItems'), disp: DP.cs(tt, 'display'), body: document.querySelector('.dock .tab-body').getBoundingClientRect().height }; });
      t.eq(rv.txt, 'Research', 'Research: view name'); t.eq(rv.disp, 'flex', 'Research: name is a cell'); t.eq(rv.al, 'center', 'Research: name centred'); t.ok(rv.body > 300, 'Research: the dock is the view (not folded)');
      // phone: no fold control, no strip P&L (unchanged)
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      const ph = await page.evaluate(() => ({ dm: getComputedStyle(document.getElementById('dockMin')).display, pnl: getComputedStyle(document.querySelector('.dock-pnl')).display, docW: document.documentElement.scrollWidth }));
      t.eq(ph.dm, 'none', 'phone: no fold control'); t.eq(ph.pnl, 'none', 'phone: no strip P&L'); t.ok(ph.docW <= 390, 'phone: no horizontal scroll');
      t.noErrors(page);
    }
  }
];
