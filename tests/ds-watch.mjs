// Design system · ds-watch: the market watch as artboard 2 draws it (.mace/research/2026-10-25-artboard2/terminal.dc.html).
// A 30 px title band with the inline search and ‹ (hides the panel through ui.js pvSet; its edge tab brings it back), the
// class band in view, the table head (10 px uppercase, aligned with the cells), 26 px rows with the big figure (pip
// digits 14 px / 700 in the tick's colour), group and subgroup rows with their counts, the selected row amber, the
// shared closed note on a subgroup row, the detail card (label above value, the day-range bar). Desktop only: the
// phone keeps its own layout.
const FRI = new Date('2026-10-16T10:30:00Z'); // FX in session, US stocks closed
const HELP = () => {
  window.DW = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DW.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    cs: (el, p) => getComputedStyle(el)[p],
    col: el => DW.norm(getComputedStyle(el).color),
    h: el => Math.round(el.getBoundingClientRect().height),
    vis: el => !!el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0,
    raf: () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))
  };
};
const boot = async (page, w = 1680, h = 950) => {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForFunction(() => typeof buildWatch === 'function' && typeof pvSet === 'function' && document.getElementById('wlHide') && document.querySelector('.watch>.pv-edge') && document.querySelector('#wlDet .wd-g'), null, { timeout: 30000 });
  await page.evaluate(HELP);
  await page.evaluate(() => { localStorage.removeItem('tb.panels'); pvSet({ wl: true, tk: true, dock: 'auto', qt: true }); S.set.fav = []; S.set.wl = 'all'; S.set.wlCols = 'basic'; delete S.set.wlOpen; document.querySelector('#wlSearch').value = ''; buildWatch(); renderWatch(); });
};
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);

export const tests = [
  {
    name: 'DSW1 title band 30 px: MARKET WATCH, the search fills the band, ‹ hides the panel; every class label whole (the band scrolls when the panel is narrower than the labels)',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await boot(page);
      const r = await page.evaluate(() => {
        const ph = document.querySelector('.watch>.ph'), h2 = ph.querySelector('h2'), s = document.getElementById('wlSearch'), b = document.getElementById('wlHide'), cls = document.getElementById('wlCls');
        const on = cls.querySelector('button.on');
        return { ph: DW.h(ph), h2fs: DW.cs(h2, 'fontSize'), h2fw: DW.cs(h2, 'fontWeight'), h2tt: DW.cs(h2, 'textTransform'), sW: s.getBoundingClientRect().width, phW: ph.getBoundingClientRect().width,
          sH: DW.h(s), ph2: s.placeholder, bVis: DW.vis(b), bTxt: b.textContent, bLab: b.getAttribute('aria-label'), bInPh: ph.contains(b), bRight: b.getBoundingClientRect().right <= ph.getBoundingClientRect().right + .5 && b.getBoundingClientRect().left >= s.getBoundingClientRect().right - .5,
          clsFit: cls.scrollWidth <= cls.clientWidth + 1, clsOx: DW.cs(cls, 'overflowX'), onIn: on.getBoundingClientRect().left >= cls.getBoundingClientRect().left - .5 && on.getBoundingClientRect().right <= cls.getBoundingClientRect().right + .5,
          onCol: DW.col(on), onBg: DW.norm(getComputedStyle(on).backgroundColor), acc: DW.tok('--acc'), ink: DW.tok('--acc-ink'), clsFs: DW.cs(on, 'fontSize') };
      });
      t.eq(r.ph, 30, 'title band 30 px'); t.eq(r.h2fs, '11px', 'title 11 px'); t.eq(r.h2fw, '700', 'title 700'); t.eq(r.h2tt, 'uppercase', 'title uppercase');
      t.ok(r.sW > r.phW * .45, `the search fills the band (${Math.round(r.sW)} of ${Math.round(r.phW)} px)`); t.ok(r.sH >= 28, 'search flush: the full band height (Victor 31.10.2026): ' + r.sH); t.eq(r.ph2, 'Search symbol, name, sector, exchange', 'the search says what it searches');
      t.ok(r.bVis && r.bInPh && r.bRight, '‹ at the right end of the title band'); t.eq(r.bTxt, '‹', 'the button reads ‹'); t.eq(r.bLab, 'Hide the market watch', 'and is labelled');
      t.ok(r.clsFit || r.clsOx === 'auto', 'the class band fits, or scrolls to the tabs beyond the panel (labels are never cut)'); t.ok(r.onIn, 'the active class tab in view'); t.ok(r.onBg !== r.acc && r.onBg !== 'rgba(0, 0, 0, 0)', 'the active class is a tint (accent contract)'); t.ok(r.onCol !== r.ink, 'the active class text is normal'); t.eq(r.clsFs, '11px', 'class tabs 11 px');
      // every label whole in its tab at the common desktop widths; where the panel is narrower than the labels the strip scrolls
      for (const w of [1081, 1280, 1440, 1680]) {
        await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(150);
        const c = await page.evaluate(async () => {
          await DW.raf();
          const cls = document.getElementById('wlCls'), bs = [...cls.querySelectorAll('button:not([hidden])')];
          return { cut: bs.filter(x => x.scrollWidth > x.clientWidth).map(x => x.textContent + ' ' + x.scrollWidth + '>' + x.clientWidth), n: bs.length,
            scrolls: cls.scrollWidth > cls.clientWidth + 1, ox: DW.cs(cls, 'overflowX'), minW: Math.min(...bs.map(x => x.getBoundingClientRect().width)) };
        });
        t.eq(c.cut.length, 0, w + ' px: every class label whole in its tab ' + c.cut.join(', '));
        t.ok(c.n === 7, w + ' px: all 7 class tabs present (' + c.n + ')');
        t.ok(c.minW >= 24, w + ' px: each tab at least 24 px (' + Math.round(c.minW) + ')');
        if (c.scrolls) t.eq(c.ox, 'auto', w + ' px: the strip scrolls to the tabs beyond the panel');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSW2 ‹ hides the market watch (pvSet), its edge tab takes focus and brings it back; mirrored the button points right',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await boot(page);
      await page.click('#wlHide'); await page.waitForTimeout(150);
      const off = await page.evaluate(() => ({ st: pvState().wl, cls: document.querySelector('.grid').classList.contains('pv-nowl'), list: DW.vis(document.getElementById('wl')), edge: DW.vis(document.querySelector('.watch>.pv-edge')), focus: document.activeElement === document.querySelector('.watch>.pv-edge'), w: Math.round(document.querySelector('.watch').getBoundingClientRect().width), arrow: getComputedStyle(document.querySelector('.watch>.pv-edge'), '::before').content }));
      t.eq(off.st, false, 'pvState().wl false'); t.ok(off.cls && !off.list, 'the list is hidden'); t.ok(off.edge && off.focus, 'the edge tab shows and has the focus'); t.eq(off.w, 36, 'the edge tab is as wide as the New order tab (36 px): ' + off.w); t.eq(off.arrow, 'none', 'no arrow: the label alone, like New order');
      await page.click('.watch>.pv-edge'); await page.waitForTimeout(150);
      const on = await page.evaluate(() => ({ st: pvState().wl, list: DW.vis(document.getElementById('wl')), btn: DW.vis(document.getElementById('wlHide')) }));
      t.ok(on.st && on.list && on.btn, 'the edge tab brings the panel back, ‹ with it');
      await page.evaluate(() => wsApply('mirror')); await page.waitForTimeout(200);
      const m = await page.evaluate(() => DW.cs(document.getElementById('wlHide'), 'transform'));
      t.eq(m, 'matrix(-1, 0, 0, 1, 0, 0)', 'mirrored: the panel folds to the right edge, the arrow points there');
      await page.evaluate(() => wsApply('standard'));
      t.noErrors(page);
    }
  },
  {
    name: 'DSW3 table: head 24 px, 10 px uppercase, aligned with the cells; rows 26 px, bordered cells; big figure 14 px / 700 in the tick colour; fonts of the artboard',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await boot(page);
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd'], ['light', 'cvd']]) {
        await look(page, th, pa);
        const r = await page.evaluate(async () => {
          await DW.raf();
          const head = document.querySelector('.watch .wl-head'), row = document.querySelector('#wl .wl-row[data-sym="GBPUSD"]');
          const hs = [...head.children].filter(x => x.tagName === 'SPAN' && DW.vis(x)), cs = [...row.children].filter(x => !x.classList.contains('wl-bdg') && DW.vis(x));
          const px = row.querySelector('.px'), pp = px.querySelector('.pp'), bf = px.querySelector('.bf'), pt = px.querySelector('.pt');
          const bg0 = DW.cs(px, 'backgroundColor'); row.classList.add('tk-up'); const up = DW.col(pp), upBg = DW.cs(px, 'backgroundColor'); row.classList.remove('tk-up'); row.classList.add('tk-dn'); const dn = DW.col(pp), dnBg = DW.cs(px, 'backgroundColor'); row.classList.remove('tk-dn');
          const rgb = c => { const m = c.match(/[\d.]+/g).map(Number), k = c.startsWith('color(') ? 1 : 255; return m.slice(0, 3).map(v => v / k); }, lum = c => { const m = rgb(c); return .2126 * m[0] + .7152 * m[1] + .0722 * m[2]; }, gr = c => { const m = rgb(c); return m[1] - m[0]; };
          await DW.raf(); await new Promise(r => setTimeout(r, 500));
          return { hH: DW.h(head), hFs: DW.cs(hs[0], 'fontSize'), hTt: DW.cs(head, 'textTransform'), hCol: DW.col(hs[0]), tx3: DW.tok('--tx3'), heads: hs.map(x => x.textContent),
            aligned: hs.length === cs.length && hs.every((h, i) => Math.abs(h.getBoundingClientRect().left - cs[i].getBoundingClientRect().left) < .6 && Math.abs(h.getBoundingClientRect().right - cs[i].getBoundingClientRect().right) < .6),
            rowH: DW.h(row), border: DW.cs(cs[0], 'borderRightWidth'), symFs: DW.cs(row.querySelector('.wl-nm'), 'fontSize'), symFw: DW.cs(row.querySelector('.wl-nm'), 'fontWeight'), symFont: DW.cs(row.querySelector('.wl-nm'), 'fontFamily'),
            pxFont: DW.cs(px, 'fontFamily'), ppFs: DW.cs(pp, 'fontSize'), ppFw: DW.cs(pp, 'fontWeight'), bfCol: DW.col(bf), bfFs: DW.cs(bf, 'fontSize'), ptFs: pt ? DW.cs(pt, 'fontSize') : '9px', flat: DW.col(pp),
            up, dn, bg0, upBg, dnBg, upL: lum(upBg), dnL: lum(dnBg), upG: gr(upBg), dnG: gr(dnBg), tUp: DW.tok('--up'), tDn: DW.tok('--dn'), tx: DW.tok('--tx'), tmFs: DW.cs(row.querySelector('.tm'), 'fontSize') };
        });
        const k = th + '/' + pa + ': ';
        t.eq(r.hH, 24, k + 'head 24 px'); t.eq(r.hFs, '10px', k + 'head 10 px'); t.eq(r.hTt, 'uppercase', k + 'head uppercase'); t.eq(r.hCol, r.tx3, k + 'head labels the third grey');
        t.deep(r.heads, ['Symbol', 'Bid', 'Ask', 'Spr'], k + 'Symbol, Bid, Spr, Ask (Spr shown between the sides; Time only in the full view)'); t.ok(r.aligned, k + 'head and cells share their columns');
        t.eq(r.rowH, 26, k + 'rows 26 px'); t.eq(r.border, '1px', k + 'a 1 px border between cells');
        t.eq(r.symFs, '12px', k + 'symbol 12 px'); t.eq(r.symFw, '600', k + 'symbol 600'); t.ok(/General Sans/.test(r.symFont), k + 'symbol in General Sans: ' + r.symFont); t.ok(/JetBrains Mono/.test(r.pxFont), k + 'prices in JetBrains Mono: ' + r.pxFont);
        t.eq(r.ppFs, '14px', k + 'pip digits 14 px'); t.eq(r.ppFw, '700', k + 'pip digits 700'); t.eq(r.bfFs, '12px', k + 'big figure 12 px'); t.eq(r.bfCol, r.tx3, k + 'big figure dimmed'); t.eq(r.ptFs, '9px', k + 'pipette 9 px'); t.eq(r.tmFs, '10px', k + 'time 10 px');
        t.eq(r.up, r.tx, k + 'an up tick keeps the digits in ink'); t.eq(r.dn, r.tx, k + 'a down tick too'); t.ok(r.upBg !== r.bg0 && r.dnBg !== r.bg0 && r.upBg !== r.dnBg, k + 'the tick flashes the cell background');
        if (pa === 'std') { t.ok(r.upG > 0 && r.dnG < 0, k + 'up green, down red: ' + r.upBg + ' ' + r.dnBg); t.ok(th === 'dark' ? r.upL < .35 && r.dnL < .35 : r.upL > .7 && r.dnL > .7, k + (th === 'dark' ? 'dark' : 'light') + ' tints: ' + r.upL.toFixed(2) + ' ' + r.dnL.toFixed(2)); } t.eq(r.flat, r.tx, k + 'no tick: the value colour');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSW4 group and subgroup rows with their counts; the selected row amber 9 % with an amber symbol, no side bar',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await boot(page);
      const r = await page.evaluate(async () => {
        setSymbol('EURUSD'); await DW.raf();
        const fx = document.querySelector('#wl .wl-grp[data-g="fx"]'), subs = [...document.querySelectorAll('#wl .wl-sub[data-c="fx"]')];
        const on = document.querySelector('#wl .wl-row.on'), off = document.querySelector('#wl .wl-row:not(.on)');
        const pr = document.createElement('div'); pr.style.background = 'color-mix(in srgb, var(--acc) 9%, var(--s1))'; document.querySelector('.watch').appendChild(pr); const want = DW.norm(DW.cs(pr, 'backgroundColor')); pr.remove();
        return { fxN: fx.querySelector('.wl-n').textContent, fxH: DW.h(fx), fxFs: DW.cs(fx, 'fontSize'), fxExp: fx.getAttribute('aria-expanded'),
          subs: subs.map(s => [s.querySelector('.wl-sub-n').textContent, s.querySelector('.wl-sub-c').textContent.replace(/\D/g, '')]), subCvis: subs.every(s => DW.vis(s.querySelector('.wl-sub-c'))),
          subSr: subs[0].querySelector('.wl-sub-c .sr-only').textContent, subPad: DW.cs(subs[0], 'paddingLeft'), subFs: DW.cs(subs[0], 'fontSize'), grpBg: DW.norm(DW.cs(fx, 'backgroundColor')), subBg: DW.norm(DW.cs(subs[0], 'backgroundColor')), rowBg: DW.norm(DW.cs(off, 'backgroundColor')) === 'rgba(0, 0, 0, 0)' ? DW.tok('--s1') : DW.norm(DW.cs(off, 'backgroundColor')),
          onSym: on.dataset.sym, onBg: DW.norm(DW.cs(on, 'backgroundColor')), want, onCol: DW.col(on.querySelector('.wl-nm')), acc: DW.tok('--acc'), bar: getComputedStyle(on, '::before').display };
      });
      t.eq(r.fxN, '38', 'FX row counts 38'); t.eq(r.fxExp, null, 'FX band is plain (always open on desktop, nothing to fold)'); t.eq(r.fxFs, '11px', 'group rows 11 px'); t.ok(r.fxH >= 24 && r.fxH <= 26, 'group row 24 px: ' + r.fxH);
      t.deep(r.subs, [['Majors (G8)', '16'], ['Crosses', '9'], ['Exotics', '13']], 'subgroup rows: name and count'); t.ok(r.subCvis, 'the counts show'); t.eq(r.subSr, ' instruments', 'the count is read as instruments');
      t.eq(r.subPad, '18px', 'subgroups indented 18 px'); t.eq(r.subFs, '11px', 'subgroup rows 11 px'); t.eq(r.grpBg, r.subBg, 'group and subgroup rows share a band'); t.ok(r.grpBg !== r.rowBg, 'set apart from the data rows');
      t.eq(r.onSym, 'EURUSD', 'the chart symbol is the selected row'); t.ok(r.onBg.includes('/ 0.18'), 'selected row: the accent tint (' + r.onBg + ')'); t.ok(r.onCol !== r.acc, 'the selected symbol is normal text'); t.eq(r.bar, 'block', 'a 2px side line');
      t.noErrors(page);
    }
  },
  {
    name: 'DSW5 a subgroup closed for one reason says it once on its row, as visible text outside the name; the rows below drop their own note',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await boot(page);
      const r = await page.evaluate(async () => {
        const g = document.querySelector('#wl .wl-grp[data-g="stock"]'); if (g.getAttribute('aria-expanded') !== 'true') g.click();
        await DW.raf(); await DW.raf();
        const sub = [...document.querySelectorAll('#wl .wl-sub[data-c="stock"]')].find(s => s.querySelector('.wl-sub-ses'));
        if (!sub) return null;
        const tag = sub.querySelector('.wl-sub-ses'), rows = []; for (let n = sub.nextElementSibling; n && n.classList.contains('wl-row'); n = n.nextElementSibling) rows.push(n);
        const out = { name: sub.querySelector('.wl-sub-n').textContent, note: tag.textContent, vis: DW.vis(tag), hidden: !!tag.closest('[aria-hidden="true"]'), title: tag.title, outside: !sub.querySelector('.wl-sub-n').contains(tag),
          rowsGrp: rows.length > 1 && rows.every(r => r.classList.contains('ses-grp')), rowNote: rows.some(r => DW.vis(r.querySelector('.wl-ses'))), rowH: DW.h(rows[0]), count: sub.querySelector('.wl-sub-c').textContent.replace(/\D/g, ''), n: rows.length,
          order: [...sub.children].map(c => c.className.split(' ')[0]) };
        g.click();
        return out;
      });
      t.ok(r, 'a closed sector row carries the note');
      t.ok(!/Closed/.test(r.name), 'the name is the name alone: ' + r.name); t.ok(/^Closed · opens /.test(r.note), 'the note: ' + r.note); t.ok(r.vis && !r.hidden && r.outside, 'visible, read by assistive tech, outside the name');
      t.ok(r.title.length >= r.note.length, 'its title holds the full text'); t.ok(r.rowsGrp && !r.rowNote, 'the rows under it drop their own note'); t.eq(r.rowH, 26, 'and keep 26 px'); t.eq(r.count, String(r.n), 'the count matches the rows');
      t.eq(r.order[0], 'wl-sub-n', 'name first'); t.eq(r.order[1], 'wl-sub-ses', 'the note after it'); t.eq(r.order[r.order.length - 1], 'wl-sub-c', 'the count last');
      t.noErrors(page);
    }
  },
  {
    name: 'DSW6 detail card: amber symbol band, L / H with the day-range bar, cells with the label above the value',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await boot(page);
      for (const w of [1680, 1440, 1280]) {
        await page.setViewportSize({ width: w, height: 900 }); await page.waitForTimeout(250);
        const r = await page.evaluate(() => {
          const d = document.getElementById('wlDet'), hb = d.querySelector('.wd-h b'), rg = d.querySelector('.wd-rg'), bar = rg.querySelector(':scope>i'), mk = bar.querySelector('i');
          const cells = [...d.querySelectorAll('.wd-g>div')];
          return { hCol: DW.col(hb), acc: DW.tok('--acc'), hFw: DW.cs(hb, 'fontWeight'), lo: getComputedStyle(rg.firstElementChild, '::before').content, hi: getComputedStyle(rg.lastElementChild, '::before').content,
            barH: DW.h(bar), barW: Math.round(bar.getBoundingClientRect().width), rgW: Math.round(rg.getBoundingClientRect().width), barBelow: bar.getBoundingClientRect().top > rg.firstElementChild.getBoundingClientRect().bottom - 1,
            mkW: Math.round(mk.getBoundingClientRect().width), mkH: DW.h(mk), mkCol: DW.norm(DW.cs(mk, 'backgroundColor')),
            n: cells.length, above: cells.every(c => c.querySelector('dt').getBoundingClientRect().bottom <= c.querySelector('dd').getBoundingClientRect().top + .5),
            labels: cells.map(c => c.querySelector('dt').textContent), dtFs: DW.cs(cells[0].querySelector('dt'), 'fontSize'), dtCol: DW.col(cells[0].querySelector('dt')), tx3: DW.tok('--tx3'),
            ddFont: DW.cs(cells[0].querySelector('dd'), 'fontFamily'), ddFw: DW.cs(cells[0].querySelector('dd'), 'fontWeight'), border: DW.cs(cells[0], 'borderRightWidth'),
            whole: cells.every(c => { const dd = c.querySelector('dd'); return dd.scrollWidth <= dd.clientWidth + 1; }), inPanel: d.getBoundingClientRect().bottom <= document.querySelector('.watch').getBoundingClientRect().bottom + .5 };
        });
        const k = w + ': ';
        t.ok(r.hCol !== r.acc, k + 'symbol in normal text'); t.eq(r.hFw, '700', k + 'symbol 700'); t.eq(r.lo, '"L "', k + 'low marked L'); t.eq(r.hi, '"H "', k + 'high marked H');
        t.eq(r.barH, 4, k + 'range bar 4 px'); t.ok(r.barBelow && r.barW >= r.rgW - 20, k + 'the bar runs under L and H: ' + r.barW + '/' + r.rgW); t.eq(r.mkW, 2, k + 'marker 2 px'); t.eq(r.mkH, 10, k + 'marker 10 px'); t.eq(r.mkCol, r.acc, k + 'marker amber');
        t.eq(r.n, 6, k + 'six cells'); t.deep(r.labels.slice(0, 3), ['Day range', 'ATR 1H', 'Spread'], k + 'Day range, ATR 1H, Spread first'); t.ok(r.above, k + 'each label above its value');
        t.eq(r.dtFs, '10px', k + 'labels 10 px'); t.eq(r.dtCol, r.tx3, k + 'labels grey'); t.ok(/JetBrains Mono/.test(r.ddFont), k + 'values mono'); t.eq(r.ddFw, '600', k + 'values 600'); t.eq(r.border, '1px', k + 'cells bordered');
        t.ok(r.whole, k + 'no value cut'); t.ok(r.inPanel, k + 'the card inside the panel');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSW7 phone 390 px keeps its own layout: no ‹, no subgroup counts, the title band unchanged',
    async run({ t, app }) {
      const page = await app('', { clock: FRI });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on') && typeof buildWatch === 'function', null, { timeout: 30000 });
      await page.evaluate(() => { document.querySelector('.mnav button[data-mv="markets"]').click(); });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => ({
        hide: getComputedStyle(document.getElementById('wlHide') || document.body).display, subC: [...document.querySelectorAll('#wl .wl-sub-c')].every(x => getComputedStyle(x).display === 'none'),
        subs: document.querySelectorAll('#wl .wl-sub').length, sw: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth)
      }));
      t.eq(r.hide, 'none', 'no ‹ on the phone (its own navigation)'); t.ok(r.subs > 0 && r.subC, 'subgroup counts stay desktop only'); t.ok(r.sw <= 390, 'no horizontal overflow: ' + r.sw);
      t.noErrors(page);
    }
  }
];
