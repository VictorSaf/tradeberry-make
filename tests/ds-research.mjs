// Design system · ds-research: Monitor, Brief, Observatory, Baskets and Edge check in the terminal look (audit R4–R24).
// Amber only on selection / active / focus; values and data series in ink, direction or --ind1; title bands on the Brief
// cards; bordered tables and lists with head rows; side-panel prose folded under a visible summary line, nothing lost.
const WED = new Date('2026-10-21T14:00:00Z');
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);
const HELP = () => {
  window.DQ = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DQ.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    cs: (el, p) => getComputedStyle(el)[p],
    col: (el, p = 'color') => DQ.norm(getComputedStyle(el)[p]),
    // visible elements under root whose text colour is amber (focus and the active / selected state excluded)
    amber(root) {
      const acc = DQ.tok('--acc');
      return [...root.querySelectorAll('*')].filter(el => el.offsetParent !== null && el.childElementCount === 0 && el.textContent.trim()
        && DQ.col(el) === acc && !el.closest('.on,[aria-pressed=true],:focus,.cur')).map(el => el.className + ': ' + el.textContent.trim().slice(0, 30));
    },
    obs(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); }
  };
};
async function research(app, sub, opts = {}) {
  const page = await app('', { clock: WED, ...opts });
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView, null, { timeout: 30000 });
  await page.evaluate(async s => { T.reset(); if (typeof loadLazy === 'function') await loadLazy(); setView('research', s); await new Promise(r => setTimeout(r, 250)); }, sub);
  await page.evaluate(HELP);
  return page;
}

export const tests = [
  {
    name: 'DSR1 Monitor: the band holds the filters, an amber Sort list and a density toggle (panel switches out of the band, still wired), big figure muted, closed prices greyed not faded',
    async run({ t, app }) {
      const page = await app('', { clock: WED });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView, null, { timeout: 30000 });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        T.reset(); setView('monitor'); await new Promise(r => setTimeout(r, 400));
        const rail = document.getElementById('monRailBtn'), dock = document.getElementById('monDockBtn'), n = document.getElementById('monPosN');
        const band = { tgs: !!document.querySelector('#monitor>.ph>.mon-tgs').offsetParent, sort: !!document.querySelector('.mon-sortbtn')?.offsetParent, den: !!document.querySelector('.mon-dentg')?.offsetParent, opts: [...document.querySelectorAll('#monSort option')].map(o => o.value).join() };
        rail.click(); await new Promise(r => setTimeout(r, 50));
        const on = { pressed: rail.getAttribute('aria-pressed') };
        rail.click();
        const sb = document.querySelector('.mon-sortbtn'); sb.click(); await new Promise(r => setTimeout(r, 50));
        const pop = document.querySelector('.mon-sortpop'), sel = pop.querySelector('button.on');
        const sort = { open: !pop.hidden, bg: sel && DQ.col(sel, 'backgroundColor'), color: sel && DQ.col(sel) };
        pop.querySelector('[data-v=chg]').click();
        const picked = document.getElementById('monSort').value; document.getElementById('monSort').value = 'name'; document.getElementById('monSort').dispatchEvent(new Event('change'));
        const dg = document.querySelector('.mon-dentg'), d0 = dg.textContent; dg.click(); const d1 = dg.textContent; dg.click();
        const tile = document.querySelector('#monBoard .mq'), pre = tile.querySelector('.mq-px .mq-s span>span'), big = tile.querySelector('.mq-px .mq-s span>b');
        const fig = { pre: DQ.col(pre), big: DQ.col(big) };
        tile.classList.add('closed');
        const cl = { op: DQ.cs(tile.querySelector('.mq-px .mq-s>span'), 'opacity'), big: DQ.col(big), sp: DQ.cs(tile.querySelector('.mq-sp'), 'opacity') };
        tile.classList.remove('closed');
        return { band, on, sort, picked, den: [d0, d1], fig, cl, dockIn: !!dock, tok: { acc: DQ.tok('--acc'), tx: DQ.tok('--tx'), tx2: DQ.tok('--tx2'), tx3: DQ.tok('--tx3'), s3: DQ.tok('--s3'), line2: DQ.tok('--line2'), up: DQ.tok('--up') } };
      });
      t.ok(r.dockIn, 'both switches exist');
      t.ok(!r.band.tgs && r.band.sort && r.band.den, 'band: Sort and density buttons shown, panel switches out: ' + JSON.stringify(r.band));
      t.eq(r.band.opts, 'name,chg,abs,vol', 'Sort list without Spread');
      t.eq(r.on.pressed, 'true', 'the market panel switch still works');
      t.ok(r.sort.open && r.sort.bg === r.tok.acc, 'Sort list opens, the selected option on amber: ' + JSON.stringify(r.sort));
      t.eq(r.picked, 'chg', 'picking in the list sorts the board');
      t.ok(r.den[0] !== r.den[1], 'density toggle switches Compact / Comfort: ' + r.den.join(' → '));
      t.eq(r.fig.pre, r.tok.tx2, 'digits before the pips muted');
      t.eq(r.fig.big, r.tok.tx, 'pip digits in ink');
      t.eq(r.cl.op, '1', 'closed: no opacity on the price');
      t.eq(r.cl.sp, '1', 'closed: no opacity on the spread');
      t.eq(r.cl.big, r.tok.tx3, 'closed: the price greyed (--tx3), still distinct from an open tile');
      t.noErrors(page);
    }
  },
  {
    name: 'DSR2 Brief: KPI tiers (Trend 4H hero 17/700, the rest 14/600), a title band on every card, column heads, no amber on values or series',
    async run({ t, app }) {
      const page = await research(app, 'brief');
      const out = {};
      for (const th of ['dark', 'light']) {
        await look(page, th);
        out[th] = await page.evaluate(() => {
          generateBrief('EURUSD');
          const kp = [...document.querySelectorAll('.brx-kpis .brx-kpi b')].map(b => ({ fs: DQ.cs(b, 'fontSize'), fw: DQ.cs(b, 'fontWeight'), ff: DQ.cs(b, 'fontFamily') }));
          const cards = [...document.querySelectorAll('#brMain .brx-card')].map(c => { const h = c.firstElementChild; return { hd: h.classList.contains('brx-hd'), bg: DQ.col(h, 'backgroundColor'), bb: DQ.cs(h, 'borderBottomWidth'), title: h.querySelector('h3')?.textContent || '', tc: h.querySelector('h3') ? DQ.col(h.querySelector('h3')) : '' }; });
          const now = document.querySelector('.brx-lv.now'), dots = document.querySelector('.brx-dots');
          const fills = [...document.querySelectorAll('.brx-str .str-fill')].map(x => DQ.col(x, 'backgroundColor'));
          const tf = document.querySelector('.brx-tf td'), tfh = document.querySelector('.brx-tf th');
          const ema = document.querySelector('#brLayers [data-l="ema"] i');
          return {
            kp, cards, band: DQ.tok('--band'), tx: DQ.tok('--tx'), s2: DQ.tok('--s2'), tx2: DQ.tok('--tx2'), tx3: DQ.tok('--tx3'), acc: DQ.tok('--acc'), ind1: DQ.tok('--ind1'), up: DQ.tok('--up'), dn: DQ.tok('--dn'),
            tfIn: !!document.querySelector('.brx-hd #brTf'), layersIn: !!document.querySelector('.brx-hd #brLayers'),
            why: [...document.querySelectorAll('.brx-hd h3')].some(h => /^Why /.test(h.textContent)),
            now: now && { bg: DQ.col(now, 'backgroundColor'), color: DQ.col(now), fw: DQ.cs(now, 'fontWeight') }, dots: dots && DQ.col(dots), fills,
            tf: { br: DQ.cs(tf, 'borderRightWidth'), bb: DQ.cs(tf, 'borderBottomWidth'), hbg: DQ.col(tfh, 'backgroundColor') },
            ema: DQ.col(ema, 'backgroundColor'), scanHead: DQ.col(document.querySelector('.scan-head'), 'backgroundColor'),
            cols: [...document.querySelectorAll('#brScan .scan-cols span')].map(s => s.textContent),
            // v15.21: "Score 4H" spans the bar and score columns; heads line up with their figures and stay whole
            colAlign: (() => {
              const hc = document.querySelector('#brScan .scan-cols'), hs = [...hc.children].map(x => x.getBoundingClientRect()), row = document.querySelector('#brScan .scan-row'), hr = hc.getBoundingClientRect();
              const tr = row.querySelector('.str-track').getBoundingClientRect(), sc = row.querySelector('.sc').getBoundingClientRect(), em = row.querySelector('em').getBoundingClientRect(), pb = row.querySelector('b').getBoundingClientRect();
              return { pair: Math.abs(hs[0].left - pb.left), scL: hs[1].left - tr.left, scR: Math.abs(hs[1].right - sc.right), trend: Math.abs(hs[2].left - em.left),
                inside: hs.every(x => x.left >= hr.left - 0.5 && x.right <= hr.right + 0.5), whole: [...hc.children].every(x => x.scrollWidth <= Math.ceil(x.getBoundingClientRect().width) + 1) };
            })(),
            kpiRow: (() => { const ks = [...document.querySelectorAll('.brx-kpis .brx-kpi')].map(k => k.getBoundingClientRect()); return { oneRow: ks.every(k => Math.abs(k.top - ks[0].top) < 1), gap: DQ.cs(document.querySelector('.brx-kpis'), 'columnGap') }; })(),
            rows: [...document.querySelectorAll('#brScan .scan-row')].map(b => b.dataset.sym).filter(Boolean).length, rowsAll: document.querySelectorAll('#brScan .scan-row').length,
            lvh: [...document.querySelectorAll('.brx-lvh span')].map(s => s.textContent),
            lvCols: [document.querySelector('.brx-lvh'), document.querySelector('.brx-lv:not(.now)')].map(x => x && DQ.cs(x, 'gridTemplateColumns')),
            // the Plan template title and the current price are amber on purpose
            amber: DQ.amber(document.getElementById('brMain')).filter(x => { const v = x.slice(x.indexOf(': ') + 2); return !/^(current price|Plan template)$/i.test(v) && v !== (now && now.querySelector('.mono') || {}).textContent; })
          };
        });
      }
      for (const [th, r] of Object.entries(out)) {
        t.eq(r.kp.length, 5, `${th}: five KPIs`);
        t.ok(r.kp[0].fs === '17px' && r.kp[0].fw === '700' && /mono/i.test(r.kp[0].ff), `${th}: Trend 4H is the hero: ` + JSON.stringify(r.kp[0]));
        r.kp.slice(1).forEach((k, i) => t.ok(k.fs === '14px' && k.fw === '600', `${th}: KPI ${i + 2} key tier: ` + JSON.stringify(k)));
        t.ok(r.cards.length >= 6, `${th}: the cards are there: ${r.cards.length}`);
        // Plan template is the one card that stands out (Victor, 31.10.2026): an amber-tinted band and an amber title
        r.cards.forEach(c => c.title === 'Plan template'
          ? t.ok(c.hd && c.bg !== r.band && c.bb === '1px' && c.tc === r.acc, `${th}: Plan template band highlighted: ` + JSON.stringify(c))
          : (t.ok(c.hd && c.bg === r.band && c.bb === '1px', `${th}: title band on "${c.title}": ` + JSON.stringify(c)), t.eq(c.tc, r.tx, `${th}: "${c.title}" title in ink`)));
        t.ok(r.tfIn && r.layersIn, `${th}: timeframe switch and layers stay in the chart band`);
        t.ok(r.why, `${th}: the "Why ±n" title is kept`);
        // the current price is an amber divider between resistance and support (Victor, 31.10.2026)
        t.ok(r.now && r.now.color === r.acc, `${th}: current price row in amber: ` + JSON.stringify(r.now));
        t.eq(r.dots, r.tx3, `${th}: strength dots grey`);
        t.ok(r.fills.length === 2 && r.fills.every(f => f === r.up || f === r.dn), `${th}: strength bars by sign: ` + r.fills.join());
        t.ok(r.tf.br === '1px' && r.tf.hbg === r.s2, `${th}: timeframe table bordered, head on --s2: ` + JSON.stringify(r.tf));
        t.eq(r.ema, r.ind1, `${th}: the EMA layer swatch is --ind1`);
        t.eq(r.scanHead, r.band, `${th}: scanner head is a band`);
        t.deep(r.cols, ['Pair', 'Score 4H', 'Trend'], `${th}: scanner column head`);
        t.ok(r.colAlign.pair <= 1 && r.colAlign.scL <= 1 && r.colAlign.scR <= 1 && r.colAlign.trend <= 1 && r.colAlign.inside && r.colAlign.whole, `${th}: scanner heads over their figures ("Score 4H" spans bar + score), whole: ` + JSON.stringify(r.colAlign));
        t.ok(r.kpiRow.oneRow && r.kpiRow.gap === '1px', `${th}: the five KPI cells on one row, 1px separators: ` + JSON.stringify(r.kpiRow));
        t.ok(r.rows === 16 && r.rowsAll === 16, `${th}: 16 scanner rows, the head is not one of them`);
        t.deep(r.lvh.slice(0, 5), ['Level', 'Price', 'Why', 'Strength', 'Distance'], `${th}: key levels column head`);
        t.ok(r.lvCols[0] && r.lvCols[0] === r.lvCols[1], `${th}: head and rows share the grid: ` + r.lvCols.join(' | '));
        t.deep(r.amber, [], `${th}: no amber text on values`);
      }
      // the chart's EMA20 and RSI draw in --ind1, the price label in ink on --s3
      const cv = await page.evaluate(() => {
        const P = CanvasRenderingContext2D.prototype, o = P.stroke, f = P.fillRect, seen = new Set(), fills = new Set();
        P.stroke = function () { seen.add(DQ.norm(this.strokeStyle)); return o.apply(this, arguments); };
        P.fillRect = function () { fills.add(DQ.norm(this.fillStyle)); return f.apply(this, arguments); };
        try { brChart(); } finally { P.stroke = o; P.fillRect = f; }
        return { seen: [...seen], fills: [...fills], acc: DQ.tok('--acc'), ind1: DQ.tok('--ind1'), s3: DQ.tok('--s3') };
      });
      t.ok(cv.seen.includes(cv.ind1), 'EMA20 / RSI stroked in --ind1');
      t.ok(!cv.seen.includes(cv.acc) && !cv.fills.includes(cv.acc), 'nothing on the Brief chart is amber');
      t.ok(cv.fills.includes(cv.s3), 'the current price label sits on --s3');
      t.noErrors(page);
    }
  },
  {
    name: 'DSR3 Observatory: active view on --s3, head band, no amber on values, folded prose with visible summaries, hero lines, bordered tables and listed heads',
    async run({ t, app }) {
      const page = await research(app, 'obs');
      const r = await page.evaluate(() => {
        const out = { views: {} }, tok = { acc: DQ.tok('--acc'), tx: DQ.tok('--tx'), s2: DQ.tok('--s2'), s3: DQ.tok('--s3'), band: DQ.tok('--band'), warn: DQ.tok('--warn') };
        setSymbol('EURUSD');
        for (const v of ['const', 'regime', 'dc', 'deja', 'rp', 'drv', 'clock', 'tap']) {
          const b = DQ.obs(v), how = [...b.querySelectorAll('details.obs-how')];
          out.views[v] = {
            amber: DQ.amber(b),
            how: how.map(d => ({ open: d.open, sum: d.querySelector('summary').textContent.trim(), h: d.querySelector('summary').getBoundingClientRect().height, inner: d.textContent.length })),
            heroes: [...b.querySelectorAll('.obs-hero b')].map(x => ({ fs: DQ.cs(x, 'fontSize'), fw: DQ.cs(x, 'fontWeight'), txt: x.textContent }))
          };
          if (v === 'dc') {
            const ks = [...b.querySelectorAll('.obs-kpis .kpi')];
            out.dc = { first: ks[0].querySelector('label').textContent, hero: ks[0].classList.contains('hero'), heroB: { fs: DQ.cs(ks[0].querySelector('b'), 'fontSize'), color: DQ.col(ks[0].querySelector('b')) }, rest: ks.slice(1).map(k => DQ.cs(k.querySelector('b'), 'fontSize')), n: ks.length,
              th: DQ.col(b.querySelector('.dc-sc th'), 'backgroundColor'), tdBr: DQ.cs(b.querySelector('.dc-sc td'), 'borderRightWidth'), alert: !!b.querySelector('[data-dc-alert]') };
          }
          if (v === 'deja') out.deja = { hdr: [...b.querySelectorAll('.dj-list .dj-hdr span')].map(s => s.textContent), rows: b.querySelectorAll('.dj-list .dj-row').length, med: DQ.col(b.querySelector('[data-legend="med"]'), 'backgroundColor') };
          if (v === 'rp') out.rp = { hdr: b.querySelectorAll('.dj-hdr.rp-hdr').length, wn: b.querySelectorAll('.ins b.wn').length };
          if (v === 'drv') out.drv = { base: DQ.col(b.querySelector('[data-legend="base"]'), 'backgroundColor'), th: DQ.col(b.querySelector('.drv-tbl th'), 'backgroundColor') };
        }
        const nav = document.querySelector('.obs-nav button.on'), head = document.getElementById('obsHead');
        out.nav = { bg: DQ.col(nav, 'backgroundColor'), bw: DQ.cs(nav, 'borderTopWidth'), shadow: DQ.cs(nav, 'boxShadow') };
        out.head = DQ.col(head, 'backgroundColor');
        const src = document.querySelector('.obs-head .obs-src'); out.src = { ws: DQ.cs(src, 'whiteSpace'), cut: src.scrollWidth > src.clientWidth + 1 };
        // folded text stays in the page: open a summary, the explanation and its glossary terms are reachable
        const b = DQ.obs('regime'), d = b.querySelector('details.obs-how'); d.open = true;
        out.regimeOpen = { vis: d.querySelector('p').offsetHeight > 0, honest: /does not predict the next move/.test(d.textContent) };
        out.tok = tok; out.ind1 = DQ.tok('--ind1');
        return out;
      });
      t.eq(r.nav.bg, r.tok.s3, 'active view on --s3');
      t.ok(r.nav.bw === '0px' && /inset/.test(r.nav.shadow), 'no border, amber inset: ' + JSON.stringify(r.nav));
      t.eq(r.head, r.tok.band, 'Observatory head is a band');
      t.ok(r.src.ws !== 'nowrap' && !r.src.cut, 'the source wraps, not cut');
      for (const [v, x] of Object.entries(r.views)) t.deep(x.amber, [], `${v}: no amber text on values`);
      for (const v of ['const', 'regime', 'dc', 'rp', 'clock', 'tap']) {
        const h = r.views[v].how;
        t.ok(h.length >= 1, `${v}: prose folded under "How to read this"`);
        h.forEach(d => t.ok(!d.open && d.h > 0 && /^How to read this/.test(d.sum) && d.sum.length > 30 && d.inner > d.sum.length + 40, `${v}: summary visible, the text kept inside: ` + JSON.stringify(d)));
      }
      t.ok(r.views.regime.how.some(d => /does not predict the next move/.test(d.sum)), 'Regime: the honest reading is in the summary line');
      // v15.21 dropped the simulated-market wording everywhere on purpose; the summary still says what petals and dots are
      t.ok(r.views.clock.how.some(d => /Petals/.test(d.sum) && /today/.test(d.sum)), 'Volatility clock: the summary line says what petals and dots are');
      t.ok(r.regimeOpen.vis && r.regimeOpen.honest, 'opened, the full paragraph shows');
      for (const v of ['const', 'regime']) t.ok(r.views[v].heroes.length === 1 && r.views[v].heroes[0].fs === '17px' && r.views[v].heroes[0].fw === '700', `${v}: one hero figure: ` + JSON.stringify(r.views[v].heroes));
      t.ok(r.dc.first === 'Reversal level' && r.dc.hero && r.dc.heroB.fs === '17px' && r.dc.heroB.color === r.tok.tx, 'Intrinsic time: Reversal level is the hero in ink: ' + JSON.stringify(r.dc));
      t.ok(r.dc.n === 8 && r.dc.rest.every(f => f === '14px'), 'the other seven KPIs at 14px: ' + r.dc.rest);
      t.ok(r.dc.th === r.tok.s2 && r.dc.tdBr === '1px', 'scaling table bordered, head on --s2');
      t.ok(r.dc.alert, 'Alert at reversal still there');
      t.deep(r.deja.hdr, ['#', 'Pair', 'When (UTC)', r.deja.hdr[3]], 'Déjà vu list has a head'); t.ok(/^Next /.test(r.deja.hdr[3]) && r.deja.rows > 0, 'and its rows');
      t.eq(r.deja.med, r.ind1, 'Déjà vu median in --ind1');
      t.eq(r.drv.base, r.ind1, 'Drivers base leg in --ind1');
      t.eq(r.drv.th, r.tok.s2, 'Drivers table head on --s2');
      t.ok(r.rp.hdr === 1, 'Recurrence list has a head');
      t.noErrors(page);
    }
  },
  {
    name: 'DSR4 Baskets presets as a tab strip, "+ New basket" outside; Edge check report card is a table, one row per signal',
    async run({ t, app }) {
      const page = await research(app, 'obs');
      const r = await page.evaluate(() => {
        const b = DQ.obs('bask'), strip = b.querySelector('.bk-strip'), on = strip.querySelector('.pill.on'), off = strip.querySelector('.pill:not(.on)');
        const bk = { n: strip.querySelectorAll('[data-bk]').length, all: bkAll().length, gap: DQ.cs(strip, 'columnGap'), on: { bg: DQ.col(on, 'backgroundColor'), color: DQ.col(on), shadow: DQ.cs(on, 'boxShadow'), r: parseFloat(DQ.cs(on, 'borderTopLeftRadius')), pressed: on.getAttribute('aria-pressed') }, off: { r: parseFloat(DQ.cs(off, 'borderTopLeftRadius')) },
          addOut: !!b.querySelector('.bk-list > [data-bk-new]') && !strip.querySelector('[data-bk-new]') };
        const emaSw = b.querySelector('.bk-cleg [data-legend="ema"]');
        const ink = { ema: typeof BK !== 'undefined' && BK.ema ? DQ.norm(BK.ema.options().color) : null, emaSw: emaSw && DQ.col(emaSw, 'backgroundColor'), curve: null };
        const s = DQ.obs('scan'), tb = s.querySelector('.sc-card table.sc-rc');
        const sc = { has: !!tb, rows: tb ? tb.querySelectorAll('tbody tr').length : 0, card: LAB.scan.card.length, head: tb ? [...tb.querySelectorAll('th')].map(x => x.textContent) : [], th: tb && DQ.col(tb.querySelector('th'), 'backgroundColor'), br: tb && DQ.cs(tb.querySelector('td'), 'borderRightWidth'), band: DQ.col(s.querySelector('.sc-card > .sc-h'), 'backgroundColor'), txt: s.querySelector('.sc-card').textContent };
        const det = scDetail('EURUSD', Object.keys(SC_SIG)[0], 4, 'noise');
        ink.curve = (det.match(/<polyline[^>]*stroke="([^"]+)"/) || [])[1];
        return { bk, sc, ink, s2: DQ.tok('--s2'), s3: DQ.tok('--s3'), acc: DQ.tok('--acc'), ind1: DQ.tok('--ind1'), band: DQ.tok('--band') };
      });
      t.ok(r.bk.n === r.bk.all && r.bk.n > 1, 'every basket in the strip');
      t.eq(r.bk.gap, '1px', '1px separators');
      t.ok(r.bk.on.bg === r.s3 && r.bk.on.color === r.acc && /inset/.test(r.bk.on.shadow) && r.bk.on.pressed === 'true', 'active basket = active tab: ' + JSON.stringify(r.bk.on));
      t.ok(r.bk.on.r === 0 && r.bk.off.r === 0, 'square, not pills');
      t.ok(r.bk.addOut, '"+ New basket" outside the strip');
      t.ok(r.ink.ema && r.ink.ema === r.ind1 && r.ink.ema !== r.acc, 'basket EMA20 line on --ind1: ' + r.ink.ema);
      t.ok(r.ink.emaSw === r.ind1, 'EMA20 legend swatch on --ind1: ' + r.ink.emaSw);
      t.eq(r.ink.curve, 'var(--ind1)', 'Edge check result curve (not Robust) on --ind1, not amber');
      t.ok(r.sc.has && r.sc.rows === r.sc.card && r.sc.rows > 0, `report card table, one row per signal: ${r.sc.rows}/${r.sc.card}`);
      t.deep(r.sc.head, ['Signal', 'Cases', 'Hit base', 'Avg bp', 'Pooled t', 'Pairs t > 2'], 'column heads');
      t.ok(r.sc.th === r.s2 && r.sc.br === '1px', 'bordered, head on --s2');
      t.eq(r.sc.band, r.band, 'report card title band');
      // v15.21 removed the zero-drift claim on purpose; the correction and the chance count stay
      t.ok(/Benjamini–Hochberg/.test(r.sc.txt) && /by chance/.test(r.sc.txt), 'the correction and the chance-count notes stay');
      t.noErrors(page);
    }
  },
  {
    name: 'DSR5 phone 390 and colour-blind palette: Brief and Observatory keep every part, no page overflow, summaries visible; --ind1 follows the palette',
    async run({ t, app }) {
      const page = await research(app, 'brief');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      await look(page, 'dark', 'cvd');
      const r = await page.evaluate(async () => {
        if (typeof setView === 'function') setView('research', 'brief');
        generateBrief('EURUSD'); await new Promise(r => setTimeout(r, 100));
        const br = { cards: document.querySelectorAll('#brMain .brx-card .brx-hd').length, lvh: !!document.querySelector('.brx-lvh'), cols: !!document.querySelector('.scan-cols'), over: document.documentElement.scrollWidth - innerWidth,
          ema: DQ.col(document.querySelector('#brLayers [data-l="ema"] i'), 'backgroundColor'), ind1: DQ.tok('--ind1') };
        setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
        const b = DQ.obs('regime'), how = [...b.querySelectorAll('details.obs-how summary')].map(s => s.getBoundingClientRect().height);
        const c = DQ.obs('const'); const hubs = c.querySelectorAll('#constSide .ins:first-child .pill').length;
        return { br, how, hubs, over: document.documentElement.scrollWidth - innerWidth };
      });
      t.ok(r.br.cards >= 6 && r.br.lvh && r.br.cols, 'Brief keeps its bands and heads on the phone: ' + JSON.stringify(r.br));
      t.ok(r.br.over <= 1 && r.over <= 1, `no horizontal page scroll (${r.br.over}, ${r.over})`);
      t.eq(r.br.ema, r.br.ind1, 'cvd: the EMA swatch follows --ind1');
      t.ok(r.how.length >= 1 && r.how.every(h => h > 0), 'Observatory summaries visible on the phone');
      t.ok(r.hubs > 0, 'Constellation hubs still the first panel block');
      t.noErrors(page);
    }
  }
];
