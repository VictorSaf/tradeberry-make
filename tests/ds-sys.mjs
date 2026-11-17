// Design system · ds-sys: the shared primitives the zone tasks build on. Table grid (.tbl), tab strips (#tabs, #views,
// .isw, .mc-tf), the --ind1 indicator token and the --band title-band token, KPI tiers through kpi()'s tier argument,
// the neutral primary button .btn-pri, impact tags (.tag.hi / .tag.md), light-theme bands and overlay scrim.
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);
const HELP = () => {
  window.DS = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DS.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    raw: n => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    cs: (el, p) => getComputedStyle(el)[p],
    // a tab-strip button: separators, active look
    strip(sel) {
      const box = document.querySelector(sel); if (!box) return null;
      const bs = [...box.querySelectorAll('button')].filter(b => b.offsetParent !== null);
      const on = bs.find(b => b.classList.contains('on')), off = bs.find(b => !b.classList.contains('on'));
      const c = getComputedStyle(box), o = on && getComputedStyle(on), f = off && getComputedStyle(off);
      return {
        n: bs.length, gap: c.columnGap, boxBg: DS.norm(c.backgroundColor),
        on: o && { bg: DS.norm(o.backgroundColor), color: DS.norm(o.color), shadow: o.boxShadow, radius: o.borderTopLeftRadius, weight: o.fontWeight },
        off: f && { bg: DS.norm(f.backgroundColor), color: DS.norm(f.color), shadow: f.boxShadow, radius: f.borderTopLeftRadius, br: f.borderRightWidth }
      };
    }
  };
};

export const tests = [
  {
    name: 'DSS1 tokens: --ind1 (violet, light and colour-blind variants, 6-digit hex, never amber or --info) and --band',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const out = {};
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd'], ['light', 'cvd']]) {
        await look(page, th, pa);
        out[th + '-' + pa] = await page.evaluate(() => ({ ind: DS.raw('--ind1'), indN: DS.tok('--ind1'), acc: DS.tok('--acc'), info: DS.tok('--info'), warn: DS.tok('--warn'), band: DS.tok('--band'), s2: DS.tok('--s2') }));
      }
      for (const [k, v] of Object.entries(out)) {
        t.ok(/^#[0-9a-f]{6}$/i.test(v.ind), `${k}: --ind1 is a 6-digit hex (canvas appends alpha): ${v.ind}`);
        t.ok(v.indN !== v.acc && v.indN !== v.info && v.indN !== v.warn, `${k}: --ind1 differs from amber, --info and --warn`);
      }
      t.eq(out['dark-std'].ind.toLowerCase(), '#a78bfa', 'dark --ind1 violet');
      t.eq(out['light-std'].ind.toLowerCase(), '#6b3fd1', 'light --ind1 violet');
      t.ok(out['dark-cvd'].ind.toLowerCase() !== out['dark-std'].ind.toLowerCase(), 'cvd has its own --ind1 (--info is violet there)');
      t.eq(out['dark-std'].band, out['dark-std'].s2, 'dark --band = --s2');
      t.eq(out['light-std'].band, '#e9ecf1', 'light --band is the toned grey');
      t.ok(out['light-std'].s2 !== '#e9ecf1', 'light --s2 itself unchanged');
      t.noErrors(page);
    }
  },
  {
    name: 'DSS2 .tbl grid: bordered cells, head on --s2 with 10px uppercase labels, aligned heads; dock action column fixed; calendar fixed layout',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-21T14:00:00Z') } /* a Wednesday: the position opens on any day the suite runs */);
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        T.reset();
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        setTab('positions'); renderPositions();
        await new Promise(r => setTimeout(r, 600)); // the dock unfolds once it holds a position (Folds while empty)
        const tb = document.querySelector('[data-pane=positions] .tbl'), th = tb.querySelector('th:nth-child(3)'), td = tb.querySelector('#posBody td:nth-child(3)');
        const ths = [...tb.querySelectorAll('thead th')], tds = [...tb.querySelectorAll('#posBody tr:first-child td')];
        const align = ths.map((h, i) => Math.abs(h.getBoundingClientRect().left - tds[i].getBoundingClientRect().left) < .5);
        const c = getComputedStyle(th), d = getComputedStyle(td), last = ths[ths.length - 1];
        const pos = {
          thBg: DS.norm(c.backgroundColor), s2: DS.tok('--s2'), line: DS.tok('--line'),
          thFs: c.fontSize, thTt: c.textTransform, thW: c.fontWeight, thBr: c.borderRightWidth, thBb: c.borderBottomWidth,
          tdBr: d.borderRightWidth, tdBrC: DS.norm(d.borderRightColor), tdBb: d.borderBottomWidth, tdNum: d.fontVariantNumeric, tdAl: d.textAlign, tdFont: d.fontFamily,
          firstAl: getComputedStyle(tds[0]).textAlign, lastBr: getComputedStyle(tds[tds.length - 1]).borderRightWidth,
          actW: Math.round(last.getBoundingClientRect().width), actGap: (() => { const c = tds[tds.length - 1], bs = c.querySelectorAll('.acts button'); return bs.length ? Math.round(c.getBoundingClientRect().right - bs[bs.length - 1].getBoundingClientRect().right) : -1; })(), collapse: getComputedStyle(tb).borderCollapse, align
        };
        setTab('calendar'); if (typeof renderCalendar === 'function') renderCalendar();
        await new Promise(r => requestAnimationFrame(r));
        const ct = document.querySelector('[data-pane=calendar] .tbl'), crow = ct.querySelector('tbody tr td:nth-child(3)')?.parentElement || null; // the first event row (the folded Low line spans the table)
        const cal = {
          layout: getComputedStyle(ct).tableLayout, rows: ct.querySelectorAll('tbody tr').length,
          ccyHead: getComputedStyle(ct.querySelector('th:nth-child(3)')).textAlign, ccyCell: crow && getComputedStyle(crow.children[2]).textAlign,
          evWs: crow && getComputedStyle(crow.children[3]).whiteSpace,
          align: crow ? [...ct.querySelectorAll('thead th')].every((h, i) => Math.abs(h.getBoundingClientRect().left - crow.children[i].getBoundingClientRect().left) < .5) : false
        };
        return { pos, cal };
      });
      const p = r.pos;
      t.eq(p.thBg, p.s2, 'head cell on --s2');
      t.eq(p.thFs, '10px', 'head label 10px'); t.eq(p.thTt, 'uppercase', 'head label uppercase'); t.eq(p.thW, '600', 'head label 600');
      t.eq(p.thBr, '1px', 'head cell right border'); t.eq(p.thBb, '1px', 'head cell bottom border');
      t.eq(p.tdBr, '1px', 'body cell right border'); t.eq(p.tdBb, '1px', 'body cell bottom border'); t.eq(p.tdBrC, p.line, 'grid lines on --line (low contrast)');
      t.eq(p.lastBr, '0px', 'no right border on the last column (the panel edge closes the grid)');
      t.ok(/tabular-nums/.test(p.tdNum), 'figures tabular-nums: ' + p.tdNum); t.eq(p.tdAl, 'right', 'figures right-aligned'); t.ok(/JetBrains Mono/.test(p.tdFont), 'figures in mono');
      t.eq(p.firstAl, 'left', 'first (symbol) column left');
      t.eq(p.collapse, 'separate', 'separate borders, so the sticky head keeps its lines');
      t.ok(p.align.every(Boolean), 'every head cell starts where its column starts: ' + p.align);
      t.ok(p.actW >= 150 && p.actW <= 184 && p.actGap <= 1, `Positions action column shrinks to its buttons at 1680, ✕ flush right (Victor 02.11.2026): ${p.actW}px, ${p.actGap}px after ✕`);
      t.eq(r.cal.layout, 'fixed', 'calendar table-layout fixed');
      t.ok(r.cal.rows > 0, 'calendar has rows');
      t.eq(r.cal.ccyHead, 'left', 'Ccy head left'); t.eq(r.cal.ccyCell, 'left', 'Ccy cell left');
      t.eq(r.cal.evWs, 'normal', 'event name wraps instead of being cut');
      t.ok(r.cal.align, 'calendar heads align with cells');
      t.noErrors(page);
    }
  },
  {
    name: 'DSS3 tab strips: #tabs and .mc-tf flush square buttons on 1px separators, active = --s3 + amber + underline; #views and the #isw column as artboard 2',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && document.querySelector('#isw button.on') && window.iswOpen, null, { timeout: 30000 });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        iswOpen('iDom'); await new Promise(r => setTimeout(r, 50)); // the tab column marks its tab active only while its panel is open
        const out = { tabs: DS.strip('#tabs'), views: DS.strip('#views'), isw: DS.strip('#isw') };
        const vOff = [...document.querySelectorAll('#views button')].find(b => !b.classList.contains('on'));
        out.viewsSep = { w: getComputedStyle(document.getElementById('views')).columnGap, c: DS.norm(getComputedStyle(document.getElementById('views')).backgroundColor) };
        const iOff = [...document.querySelectorAll('#isw button')].find(b => !b.classList.contains('on'));
        out.iswSep = { w: getComputedStyle(iOff).borderBottomWidth, c: DS.norm(getComputedStyle(iOff).borderBottomColor), h: Math.round(iOff.getBoundingClientRect().height) };
        if (typeof setLayout === 'function') { try { setLayout('2h'); } catch (e) {} }
        await new Promise(r => setTimeout(r, 50));
        out.mc = DS.strip('.mc-tf');
        out.s1 = DS.tok('--s1'); out.s2 = DS.tok('--s2'); out.s3 = DS.tok('--s3'); out.acc = DS.tok('--acc'); out.tx = DS.tok('--tx'); out.line = DS.tok('--line'); out.line2 = DS.tok('--line2');
        return out;
      });
      for (const k of ['tabs', 'views', 'isw']) {
        const s = r[k];
        t.ok(s && s.n > 1, k + ': visible strip with buttons');
        t.eq(s.on.radius, '0px', k + ': square'); t.ok(+s.on.weight >= 600, k + ': active bold: ' + s.on.weight);
        t.ok(s.off.color !== r.acc, k + ': inactive tab not amber');
        t.eq(s.off.shadow, 'none', k + ': inactive tab no underline');
      }
      // #tabs: the shared strip
      t.eq(r.tabs.on.bg, 'rgba(0, 0, 0, 0)', 'tabs: active tab without a background (ui-controls §3.6)'); t.ok(r.tabs.on.color !== r.acc, 'tabs: active tab text is normal (the accent is the 2px line)');
      t.ok(/inset/.test(r.tabs.on.shadow) && /-2px/.test(r.tabs.on.shadow), 'tabs: active tab has the 2px inset underline: ' + r.tabs.on.shadow);
      t.eq(r.tabs.off.br, '1px', '#tabs: 1px separator on each tab');
      // #views (v15.14.16, the compact segmented group): the active workspace like an active tab, --s3 in amber with the underline
      t.eq(r.views.on.bg, r.s1, 'views: active workspace on the bar colour --s1, no own fill (ui-controls §3.6)'); t.ok(r.views.on.color !== r.acc, 'views: active workspace text is normal (the line is the accent)');
      t.ok(/inset/.test(r.views.on.shadow) && /-2px/.test(r.views.on.shadow), 'views: active workspace has the 2px inset underline: ' + r.views.on.shadow);
      t.deep(r.viewsSep, { w: '1px', c: r.line2 }, 'views: 1px --line2 rule between the workspaces (the group gap)');
      // #isw: a column of fixed tabs on --line2 rules (v15.10.8: 108 px, blue when off); the open panel's tab on the accent tint, amber, a 2px amber edge
      t.eq(r.isw.on.bg, r.s3, 'isw: open panel tab on a neutral ground (--s3), the accent is the 2px line'); t.ok(r.isw.on.color !== r.acc, 'isw: open panel tab text is normal');
      t.ok(/inset/.test(r.isw.on.shadow) && /\b2px 0px 0px 0px/.test(r.isw.on.shadow), 'isw: open panel tab has the 2px inset edge: ' + r.isw.on.shadow);
      t.ok(r.iswSep.w === '1px' && r.iswSep.c === r.line2 && r.iswSep.h >= 40, 'isw: 1px --line2 rule under each tab, at least 40px tall: ' + JSON.stringify(r.iswSep));
      if (r.mc) { t.eq(r.mc.on.bg, r.s3, '.mc-tf active on --s3'); t.eq(r.mc.on.color, r.acc, '.mc-tf active amber'); t.eq(r.mc.boxBg, r.line2, '.mc-tf separators'); t.eq(r.mc.on.radius, '0px', '.mc-tf square'); }
      t.noErrors(page);
    }
  },
  {
    name: 'DSS4 #views fits at 1081-1280 ("Strategy Lab" whole), the dock tabs keep .count, the Portfolio tabs on the phone are 44px',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      for (const w of [1081, 1280]) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.waitForTimeout(80);
        const v = await page.evaluate(() => [...document.querySelectorAll('#views button')].map(b => ({ txt: b.textContent.trim(), cut: b.scrollWidth > b.clientWidth + 1, vis: b.offsetParent !== null })));
        t.ok(v.length >= 5 && v.every(b => b.vis && !b.cut), `${w}: every workspace button visible and not cut: ${JSON.stringify(v.filter(b => b.cut || !b.vis))}`);
      }
      const cnt = await page.evaluate(() => ['cPos', 'cOrd', 'cAl'].map(id => { const e = document.getElementById(id); return !!e && e.closest('#tabs') && getComputedStyle(e).display !== 'none'; }));
      t.ok(cnt.every(Boolean), 'tab counters still in the strip');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      const ph = await page.evaluate(async () => { mnavGo('portfolio'); await new Promise(r => setTimeout(r, 80)); const bs = [...document.querySelectorAll('#tabs button[data-tab]')].filter(b => b.offsetParent !== null); return { n: bs.length, h: Math.min(...bs.map(b => b.getBoundingClientRect().height)), on: getComputedStyle(bs.find(b => b.classList.contains('on'))).boxShadow }; });
      t.eq(ph.n, 3, 'phone Portfolio: Positions, Orders, History');
      t.ok(ph.h >= 44, 'phone Portfolio tabs at least 44px: ' + ph.h);
      t.ok(/inset/.test(ph.on), 'phone active tab underlined');
      t.noErrors(page);
    }
  },
  {
    name: 'DSS5 kpi() tier argument and the .kpi.hero / .key / .sec emphasis; existing calls unchanged',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const r = await page.evaluate(() => {
        const plain = kpi('L', '1', 'up', '');
        const box = document.createElement('div'); box.className = 'kpis'; document.body.appendChild(box);
        box.innerHTML = kpi('Net', '+1.00', '', '', 'hero') + kpi('Win rate', '50%', '', 'Win rate|x', 'key') + kpi('Trades', '12', '', '', 'sec') + kpi('Up', '+3', 'up', '', 'sec');
        const k = [...box.children].map(d => { const b = d.querySelector('b'), c = getComputedStyle(b), l = getComputedStyle(d.querySelector('label')); return { cls: d.className, fs: c.fontSize, fw: c.fontWeight, col: DS.norm(c.color), mono: /JetBrains Mono/.test(c.fontFamily), lfs: l.fontSize }; });
        box.remove();
        return { plain, k, tx: DS.tok('--tx'), tx2: DS.tok('--tx2'), up: DS.tok('--up') };
      });
      t.eq(r.plain, '<div class="kpi"><label>L</label><b class="up">1</b></div>', 'a call without a tier renders exactly as before');
      const [h, k, s, su] = r.k;
      t.eq(h.cls, 'kpi hero', 'hero class on the tile');
      t.eq(h.fs, '16px', 'hero 16px'); t.eq(h.fw, '700', 'hero 700'); t.ok(h.mono, 'hero mono'); t.eq(h.col, r.tx, 'hero --tx');
      t.eq(k.fs, '13px', 'key 13px'); t.eq(k.fw, '600', 'key 600'); t.eq(k.col, r.tx, 'key --tx');
      t.eq(s.fs, '11px', 'secondary 11px'); t.eq(s.fw, '400', 'secondary 400'); t.eq(s.col, r.tx2, 'secondary --tx2');
      t.eq(su.col, r.up, 'a value class (.up) keeps its colour on a secondary tile');
      t.ok(r.k.every(x => x.lfs === '10px'), 'labels stay 10px');
      t.noErrors(page);
    }
  },
  {
    name: 'DSS6 .btn-pri neutral (never amber), .tag.hi on --bad, .tag.md on --warn (alert Active stays neutral), light bands and scrim',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const probe = () => page.evaluate(() => {
        const box = document.createElement('div');
        box.innerHTML = '<button class="btn-pri">Run</button><button class="btn-pri" disabled>Run</button><span class="tag hi">High</span><span class="tag md">Med</span><span class="tag lo">Low</span>';
        document.querySelector('.dock').appendChild(box);
        const [b, bd, hi, md, lo] = box.children, cb = getComputedStyle(b);
        const out = {
          btn: { bg: DS.norm(cb.backgroundColor), col: DS.norm(cb.color), rad: cb.borderTopLeftRadius, fw: cb.fontWeight }, dis: DS.norm(getComputedStyle(bd).backgroundColor),
          hi: DS.norm(getComputedStyle(hi).color), md: DS.norm(getComputedStyle(md).color), mdSh: getComputedStyle(md).boxShadow, lo: DS.norm(getComputedStyle(lo).color),
          tx: DS.tok('--tx'), s1: DS.tok('--s1'), s2: DS.tok('--s2'), acc: DS.tok('--acc'), bad: DS.tok('--bad'), dn: DS.tok('--dn'), warn: DS.tok('--warn'), band: DS.tok('--band'),
          ph: DS.norm(getComputedStyle(document.querySelector('.panel>.ph')).backgroundColor),
          wl: document.querySelector('.watch .wl-head') && DS.norm(getComputedStyle(document.querySelector('.watch .wl-head')).backgroundColor),
          dockBand: DS.norm(getComputedStyle(document.getElementById('tabs')).backgroundColor)
        };
        box.remove();
        const ov = document.createElement('div'); ov.className = 'overlay'; document.body.appendChild(ov); out.ov = getComputedStyle(ov).backgroundColor; ov.remove();
        return out;
      });
      const d = await probe();
      t.eq(d.btn.bg, d.acc, 'dark: .btn-pri solid accent (accent contract)'); t.ok(d.btn.col !== d.acc, 'dark: .btn-pri text is ink');
      t.eq(d.btn.rad, '0px', '.btn-pri square'); t.eq(d.btn.fw, '600', '.btn-pri 600');
      t.eq(d.dis, 'rgba(0, 0, 0, 0)', 'disabled .btn-pri: no fill (§3.7)');
      t.eq(d.hi, d.bad, '.tag.hi on --bad'); t.eq(d.md, d.warn, '.tag.md on --warn'); t.ok(/inset/.test(d.mdSh), '.tag.md outlined');
      t.ok(d.hi !== d.acc && d.md !== d.acc, 'impact tags no longer amber');
      t.eq(d.dockBand, d.band, 'dock tab strip is a title band');
      // red rises swaps --dn, never the impact colour
      const rr = await page.evaluate(() => { document.documentElement.dataset.updn = 'red'; const s = document.createElement('span'); s.className = 'tag hi'; document.body.appendChild(s); const c = DS.norm(getComputedStyle(s).color), dn = DS.tok('--dn'), bad = DS.tok('--bad'); s.remove(); delete document.documentElement.dataset.updn; return { c, dn, bad }; });
      t.eq(rr.c, rr.bad, 'red rises: High stays on the error red'); t.ok(rr.c !== rr.dn, 'red rises: High does not follow --dn');
      // Alert "Active" is a status: neutral
      const al = await page.evaluate(async () => { T.reset(); S.alerts.push({ id: 99, sym: 'EURUSD', cond: 'above', price: 2, done: false }); dirty.al = true; renderAlerts(); const tg = document.querySelector('#alBody .tag.md'); return tg && { c: DS.norm(getComputedStyle(tg).color), tx: DS.tok('--tx'), txt: tg.textContent }; });
      t.ok(al && al.c === al.tx && al.txt === 'Active', 'alert Active tag neutral and still shown: ' + JSON.stringify(al));
      await look(page, 'light');
      const l = await probe();
      t.eq(l.btn.bg, l.acc, 'light: .btn-pri solid accent (accent contract)'); t.ok(l.btn.col !== l.acc, 'light: .btn-pri text is ink');
      t.eq(l.ph, '#e9ecf1', 'light: panel title band toned'); t.eq(l.wl, '#e9ecf1', 'light: market watch head toned');
      t.eq(l.ov, 'rgba(18, 23, 32, 0.35)', 'light: darker overlay scrim');
      t.noErrors(page);
    }
  }
];
