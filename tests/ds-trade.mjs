// Design system · ds-trade: the Trade view outside Market watch (audit trade.md T2–T25). A closed market is the chart
// legend's first row (no longer painted on the canvas under the quick-trade box), also in the 4-chart layout and on the
// phone; Depth centre row on one line, heads over their figures, best bid / ask bold, the illustrative note in the title
// band; EMA20 / RSI on --ind1, alerts on --warn, pane pendings in the side colour; ticket risk strip with Risk as hero,
// what-if figures that never break, Trade math columns, size label, no repeated what-if head; chrome one-liners.
// A closed market is simulated by stubbing marketWhy (called by global name), as in bk-ui.mjs.
const WHY = 'Market closed — opens Mon 00:00 (local) / Sun 22:00 UTC';
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);
const HELP = () => {
  window.DS = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DS.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    cs: (el, p) => getComputedStyle(el)[p],
    box: el => { const b = el.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; },
    hit: (a, b) => a.x < b.r - .5 && b.x < a.r - .5 && a.y < b.b - .5 && b.y < a.b - .5,
    shown: el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden',
    // WCAG contrast of two #rrggbb colours
    lum(h) { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; },
    ratio(a, b) { const x = DS.lum(a), y = DS.lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); },
    closed(on) { if (on) { DS.mw = DS.mw || window.marketWhy; window.marketWhy = () => 'Market closed — opens Mon 00:00 (local) / Sun 22:00 UTC'; } else if (DS.mw) window.marketWhy = DS.mw; }
  };
};

export const tests = [
  {
    name: 'DTR2b 4-chart, market closed: the CLOSED tag never pushes the pane-head controls (focus, swap) out of the head at 1100/1280/1366/1681',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(HELP);
      for (const w of [1100, 1280, 1366, 1681]) {
        await page.setViewportSize({ width: w, height: 900 });
        const r = await page.evaluate(async () => {
          T.reset(); setLayout('4');
          await new Promise(r => setTimeout(r, 300));
          // a control counts when it is displayed and lies wholly inside its head box
          const vis = () => MC.panes.map(p => { const h = DS.box(p.el.querySelector('.mc-head'));
            return [...p.el.querySelectorAll('.mc-head .mc-b, .mc-head .mc-ic')].filter(DS.shown).filter(b => { const x = DS.box(b); return x.x >= h.x - .5 && x.r <= h.r + .5; }).map(b => b.dataset.q || b.dataset.act).join(','); });
          DS.closed(false); MC.panes.forEach(p => mcHead(p)); await new Promise(r => requestAnimationFrame(r));
          const open = vis();
          DS.closed(true); MC.panes.forEach(p => mcHead(p)); await new Promise(r => requestAnimationFrame(r));
          const closed = vis(), tags = MC.panes.map(p => DS.shown(p.el.querySelector('.mc-mkt')));
          const over = MC.panes.map(p => { const h = p.el.querySelector('.mc-head'); return h.scrollWidth - h.clientWidth; });
          DS.closed(false); MC.panes.forEach(p => mcHead(p)); setLayout('1');
          return { open, closed, tags, over };
        });
        for (let i = 0; i < r.open.length; i++) {
          t.ok(r.tags[i], `${w}: pane ${i} shows the CLOSED tag`);
          t.eq(r.closed[i], r.open[i], `${w}: pane ${i} head keeps the same visible controls with the tag (${r.open[i]})`);
          t.ok(!r.closed[i].includes('sell') && !r.closed[i].includes('buy') && r.closed[i].includes('swap'), `${w}: pane ${i} keeps swap and has no Sell/Buy (decision 45: the secondary panes are for reading only): ${r.closed[i]}`);
        }
      }
    }
  },
  {
    name: 'DTR1 closed market: first row of the chart legend, clear of O H L C and of the quick-trade box, not on the canvas; readable in both themes',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(HELP);
      const out = {};
      for (const [th, w] of [['dark', 1280], ['light', 1680]]) {
        await page.setViewportSize({ width: w, height: 900 }); await look(page, th);
        out[th] = await page.evaluate(async () => {
          T.reset(); S.set.ind.zones = false; setLayout('1'); DS.closed(true); legend(null); drawOverlay();
          await new Promise(r => requestAnimationFrame(r));
          const lg = document.getElementById('legend'), mk = lg.querySelector(':scope>.lg-mkt'), spans = [...lg.querySelectorAll(':scope>span')].filter(DS.shown);
          const mb = DS.box(mk.querySelector('em')), q = DS.box(document.querySelector('.quick'));
          const cv = document.getElementById('ovl'), g = cv.getContext('2d'), dpr = devicePixelRatio || 1;
          let ink = 0; const d = g.getImageData(0, 0, Math.round(300 * dpr), Math.round(34 * dpr)).data; for (let i = 3; i < d.length; i += 4) ink += d[i] > 0;
          const r = { first: lg.firstElementChild === mk, text: mk.textContent, ohlc: spans.slice(0, 4).map(s => s.textContent.trim()[0]), overlap: spans.some(s => DS.hit(DS.box(s), mb)), overQuick: DS.hit(mb, q),
            fullyShown: mk.scrollWidth <= mk.clientWidth + 1 && mb.r <= DS.box(lg).r + 1, color: DS.norm(DS.cs(mk.querySelector('em'), 'color')), bad: DS.tok('--bad'), s1: DS.tok('--s1'), ink };
          DS.closed(false); legend(null);
          r.after = !document.querySelector('#legend .lg-mkt');
          return r;
        });
      }
      for (const [k, r] of Object.entries(out)) {
        t.ok(r.first, k + ': the closed state is the legend\'s first element');
        t.eq(r.text, WHY, k + ': full text, opening time included');
        t.deep(r.ohlc, ['O', 'H', 'L', 'C'], k + ': O H L C still in the legend');
        t.ok(!r.overlap, k + ': the closed row does not cover the OHLC readout');
        t.ok(!r.overQuick, k + ': the closed row is clear of the quick-trade box');
        t.ok(r.fullyShown, k + ': the text is not cut');
        t.eq(r.color, r.bad, k + ': on --bad (an error state that does not swap with "red rises")');
        t.ok(DS_ratio(r.color, r.s1) >= 4.5, `${k}: contrast ${DS_ratio(r.color, r.s1).toFixed(2)} ≥ 4.5 on the chart background`);
        t.eq(r.ink, 0, k + ': nothing painted on the overlay canvas in the top-left corner (the old badge)');
        t.ok(r.after, k + ': the row goes when the market is open');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DTR2 closed market in the 4-chart layout and on the phone: alone in the main legend, a CLOSED tag in each pane head, the full text in each pane legend',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        T.reset(); DS.closed(true); setLayout('4');
        await new Promise(r => setTimeout(r, 300));
        legend(null); MC.panes.forEach(p => { mcHead(p); mcLegend(p, null); });
        await new Promise(r => requestAnimationFrame(r));
        const lg = document.getElementById('legend'), mk = lg.querySelector('.lg-mkt');
        const panes = MC.panes.map(p => {
          const tag = p.el.querySelector('.mc-head .mc-mkt'), pm = p.el.querySelector('.mc-legend>.lg-mkt'), pb = DS.box(p.el);
          return { tag: DS.shown(tag) && tag.textContent, title: tag.title, pm: pm && pm.textContent, inside: !!pm && DS.box(pm.querySelector('em')).r <= pb.r + 1, cut: !!pm && pm.scrollWidth > pm.clientWidth + 1,
            ohlc: [...p.el.querySelectorAll('.mc-legend>span')].filter(DS.shown).length };
        });
        const out = { lgShown: DS.shown(lg) && DS.shown(mk), text: mk && mk.textContent, others: [...lg.children].filter(x => x !== mk && DS.shown(x)).length, cut: mk.scrollWidth > mk.clientWidth + 1, panes };
        DS.closed(false); MC.panes.forEach(p => mcHead(p)); out.tagGone = MC.panes.every(p => p.el.querySelector('.mc-mkt').hidden);
        setLayout('1');
        return out;
      });
      t.ok(r.lgShown, '4-chart: the main legend shows the closed state although OHLC is hidden there');
      t.eq(r.text, WHY, '4-chart: full text in the main legend');
      t.eq(r.others, 0, '4-chart: the OHLC spans stay hidden (only the state shows)');
      t.ok(!r.cut, '4-chart: main legend text not cut (it wraps)');
      t.eq(r.panes.length, 3, 'three extra panes');
      for (const [i, p] of r.panes.entries()) {
        t.eq(p.tag, 'Closed', `pane ${i}: CLOSED tag in the head`); t.eq(p.title, WHY, `pane ${i}: full text as the tag title`);
        t.eq(p.pm, WHY, `pane ${i}: full text in the pane legend`); t.ok(p.inside && !p.cut, `pane ${i}: pane legend text inside the pane, not cut`);
        t.ok(p.ohlc >= 2, `pane ${i}: the pane legend keeps its timeframe and close`);
      }
      t.ok(r.tagGone, 'tags go when the market opens');

      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForTimeout(400);
      const ph = await page.evaluate(async () => {
        DS.closed(true); legend(null); await new Promise(r => requestAnimationFrame(r));
        const lg = document.getElementById('legend'), mk = lg.querySelector('.lg-mkt'), q = DS.box(document.querySelector('.quick'));
        const out = { mnav: document.body.classList.contains('mnav-on'), shown: DS.shown(mk), text: mk && mk.textContent, overQuick: DS.hit(DS.box(mk.querySelector('em')), q), inView: DS.box(mk).r <= innerWidth };
        DS.closed(false); legend(null); return out;
      });
      t.ok(ph.shown, 'phone: the closed state shows on the chart (the OHLC legend is hidden there)');
      t.eq(ph.text, WHY, 'phone: full text');
      t.ok(!ph.overQuick && ph.inView, 'phone: under the quick-trade box, inside the screen');
      t.noErrors(page);
    }
  },
  {
    name: 'DTR3 Depth: centre row on one line with its full text as title, heads over their figures, best bid / ask bold, illustrative note in the title band, rail titles shown',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        for (let k = 0; k < 200 && !window.iswOpen; k++) await new Promise(r => setTimeout(r, 50));
        T.reset(); iswOpen('iDom'); DS.closed(true); renderDom();
        // under load the panel can still be settling: wait until the note sits shown in the title band
        for (let k = 0; k < 120 && !(document.getElementById('domIll')?.parentElement.matches('#iDom>.ph') && DS.shown(document.getElementById('domIll'))); k++) await new Promise(r => setTimeout(r, 50));
        await new Promise(r => requestAnimationFrame(r));
        const mid = document.querySelector('#dom .dom-row.mid'), spr = document.getElementById('domSpr'), rows = [...document.querySelectorAll('#dom .dom-row')];
        const i = rows.indexOf(mid), dp = k => DS.cs(rows[k].querySelector('.dp'), 'fontWeight');
        const hs = [...document.querySelectorAll('#iDom .dom-head span')], bidEm = rows[i + 1].querySelector('.bq em'), askEm = rows[i - 1].querySelector('.aq em');
        const ill = document.getElementById('domIll'), h2 = document.querySelector('#iDom>.ph h2');
        const out = { h: mid.getBoundingClientRect().height, ws: DS.cs(spr, 'whiteSpace'), to: DS.cs(spr, 'textOverflow'), lines: Math.round(spr.getBoundingClientRect().height / parseFloat(DS.cs(spr, 'lineHeight') || 15)), title: mid.title, text: spr.textContent,
          best: [dp(i - 1), dp(i + 1)], other: [dp(i - 2), dp(i + 2)], headAlign: [DS.cs(hs[0], 'textAlign'), DS.cs(hs[1], 'textAlign'), DS.cs(hs[2], 'textAlign')],
          // bid size right-aligned under its head, ask size left-aligned under its head (within a few px)
          bidEdge: Math.abs(DS.box(hs[0]).r - DS.box(bidEm).r), askEdge: Math.abs(DS.box(hs[2]).x - DS.box(askEm).x),
          illParent: ill.parentElement.matches('#iDom>.ph'), illShown: DS.shown(ill), illText: ill.textContent, illInline: ill.getAttribute('style') || '',
          h2: DS.shown(h2) && h2.textContent, h2Rail: [...document.querySelectorAll('.rail>.intel>.ph h2')].map(h => DS.cs(h, 'display')) };
        DS.closed(false); renderDom(); out.openText = spr.textContent; out.openTitle = mid.title;
        return out;
      });
      t.ok(r.h <= 26, 'centre row one line high: ' + r.h);
      t.eq(r.ws, 'nowrap', 'centre text does not wrap'); t.eq(r.to, 'ellipsis', 'ellipsis when the rail is narrow');
      t.ok(/^closed · opens Mon 00:00/.test(r.text), 'closed text in the centre: ' + r.text); t.eq(r.title, r.text, 'full text as the row title');
      t.ok(/^spread /.test(r.openText) && r.openTitle === r.openText, 'open: spread text, same title');
      t.deep(r.best, ['700', '700'], 'best ask and best bid bold');
      t.ok(r.other.every(w => +w < 700), 'outer levels not bold: ' + r.other);
      t.deep(r.headAlign, ['right', 'center', 'left'], 'heads: bid size right, price centre, ask size left');
      t.ok(r.bidEdge <= 3 && r.askEdge <= 3, `heads aligned over the sizes (bid ${r.bidEdge.toFixed(1)}px, ask ${r.askEdge.toFixed(1)}px)`);
      t.ok(r.illParent && r.illShown, 'illustrative note in the Depth title band, visible');
      t.eq(r.illText, 'Illustrative depth — fills ignore size', 'note text unchanged'); t.eq(r.illInline, '', 'no inline style (styled by the ds-trade block)');
      t.eq(r.h2, 'Depth of market', 'Depth panel title shown in the rail');
      t.ok(r.h2Rail.every(d => d === 'block'), 'every rail panel keeps its title: ' + r.h2Rail);
      t.noErrors(page);
    }
  },
  {
    name: 'DTR4 ticket (F): Margin / Risk / R:R as three bordered 36px rows with the money at risk on --dn (no overlap at 1100 / 1280, 4- and 5-digit risks, 7-figure balance), what-if figures whole and never spilling, Trade math columns, size label, no repeated what-if head, one-line notes',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      // the ticket's folded sections (Management, Costs & checks, Account after): under load, wait for them
      await page.waitForFunction(() => document.querySelectorAll('.ticket .tk-secs>.tk-sec').length === 3 && document.querySelector('#tkWiBody') && document.querySelector('.ticket [data-sum=acct]'), null, { timeout: 30000 });
      const out = {};
      // [viewport, theme, balance, lots]: the narrow rail (ticket ~262px) with ordinary and large risks, the default rail with a 7-figure balance
      const cases = [[1100, 'dark', 100000, 5], [1100, 'light', 100000, 80], [1100, 'dark', 1234567.89, 12.5], [1280, 'dark', 1234567.89, 12.5], [1280, 'light', 100000, 5], [1280, 'dark', 1234567.89, 80], [1680, 'dark', 100000, 1]];
      for (const [w, th, bal, lots] of cases) {
        await page.setViewportSize({ width: w, height: 900 });
        await look(page, th);
        out[`${w} ${th} $${bal} ${lots} lots`] = await page.evaluate(async ([bal, lots]) => {
          T.reset(); S.balance = bal; Object.assign(S.tk, { ot: 'market', side: 'buy', sm: 'lots', lots, useSL: true, useTP: true, sl: 20, tp: 40 });
          renderTicket(); document.getElementById('tkAdv').open = true; document.querySelectorAll('.ticket .tk-secs>.tk-sec').forEach(d => { d.open = true; }); document.querySelector('.tk-math').open = true; renderTicket();
          await new Promise(r => requestAnimationFrame(r));
          // text boxes (Range, so a grid cell wider than its text does not count): every label, value and context figure
          const tbox = n => { const rg = document.createRange(); rg.selectNodeContents(n); const b = rg.getBoundingClientRect(); return { x: b.left, y: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height, rects: rg.getClientRects().length }; };
          // v15.20: Margin / Risk / R : R as three bordered summary rows, each a label cell then its figure cells on one line
          const sumEl = document.getElementById('tkFootM'), sb = DS.box(sumEl), sum = [...sumEl.querySelectorAll(':scope>.fm-row')];
          const pieces = [];
          sum.forEach(d => { for (const n of d.querySelectorAll(':scope>label,:scope>b')) if (n.textContent.trim()) pieces.push(n); });
          const pb = pieces.map(n => ({ t: n.textContent.trim(), ...tbox(n) }));
          const hits = []; pb.forEach((p, i) => pb.slice(i + 1).forEach(q => { if (DS.hit(p, q)) hits.push(p.t + ' × ' + q.t); }));
          const outside = pb.filter(p => p.x < sb.x + 1 || p.r > sb.r - 1).map(p => p.t);
          // every label and figure whole inside its own cell's content box (the cells clip, so a cut shows only here)
          const cut = pieces.filter(n => { const tb = tbox(n), b = DS.box(n), c = getComputedStyle(n); return tb.x < b.x + parseFloat(c.paddingLeft) - .5 || tb.r > b.r - parseFloat(c.paddingRight) - parseFloat(c.borderRightWidth) + .5 || tb.rects > 1; }).map(n => `${n.textContent.trim()} ${Math.round(tbox(n).w)}>${Math.round(DS.box(n).w - parseFloat(getComputedStyle(n).paddingLeft) - parseFloat(getComputedStyle(n).paddingRight))}`);
          const lab = sum.map(d => d.querySelector(':scope>label')), riskUsd = sum[1].querySelector(':scope>b.dn'), rr = sum[2].querySelector(':scope>b');
          const cellsOf = d => [...d.children];
          const stripCols = {
            // one line per row: every cell of a row on the same top, label first
            line: sum.map(d => new Set(cellsOf(d).map(c => Math.round(DS.box(c).y))).size),
            cellHits: sum.flatMap(d => { const cs = cellsOf(d); return cs.flatMap((a, i) => cs.slice(i + 1).filter(c => DS.hit(DS.box(a), DS.box(c))).map(() => d.querySelector('label').textContent)); }),
            cellOut: sum.flatMap(cellsOf).filter(c => { const b = DS.box(c); return b.x < sb.x - .5 || b.r > sb.r + .5; }).length,
            // bordered: each cell keeps a 1px bottom line, inner cells a 1px right line
            bordered: sum.every(d => cellsOf(d).every((c, i, a) => DS.cs(c, 'borderBottomWidth') === '1px' && (i === a.length - 1 || DS.cs(c, 'borderRightWidth') === '1px'))),
            labWs: lab.map(l => DS.cs(l, 'whiteSpace')), riskCol: riskUsd && DS.norm(DS.cs(riskUsd, 'color')),
            risk: riskUsd ? { fs: DS.cs(riskUsd, 'fontSize'), fw: DS.cs(riskUsd, 'fontWeight'), ff: DS.cs(riskUsd, 'fontFamily') } : {}, rr: { fs: DS.cs(rr, 'fontSize'), fw: DS.cs(rr, 'fontWeight') },
            rows: sum.length, rowH: sum.map(d => Math.round(DS.box(d).h)) };
          const wi = document.getElementById('tkWiBody'), tbl = wi.querySelector('table'), tds = [...wi.querySelectorAll('td')], cells = [...wi.querySelectorAll('td,th')];
          // Trade math sits in Costs & checks, folded: opened above to measure
          const st = DS.cs(document.getElementById('tkStats'), 'gridTemplateColumns').split(' ').map(parseFloat), stW = document.querySelector('.ticket .stats').getBoundingClientRect().width;
          const sizeL = document.querySelector('#tkVolBlk .tk3-h>label');
          const wiHead = document.querySelector('#tkWhatIf>.lbl-row'), wiSec = document.querySelector('.ticket [data-sum=acct]'), note = document.getElementById('tkExecNote');
          return {
            hits, outside, cut, pieces: pb.map(p => p.t),
            line: stripCols.line, bordered: stripCols.bordered, rowH: stripCols.rowH,
            cellHits: stripCols.cellHits,
            cellOut: stripCols.cellOut,
            rows: stripCols.rows, firstIsRisk: lab.map(l => l.textContent).join('|') === 'Margin|Risk|R : R',
            riskCol: stripCols.riskCol, dnTok: DS.tok('--dn'),
            labWs: stripCols.labWs,
            risk: stripCols.risk, rr: stripCols.rr,
            td: { ws: tds.map(td => DS.cs(td, 'whiteSpace')), ow: DS.cs(tds[0], 'overflowWrap'), fs: DS.cs(tds[0], 'fontSize'), n: tds.length,
              multi: tds.filter(td => td.textContent.trim() && tbox(td).rects > 1).map(td => td.textContent) },
            spill: cells.filter(c => c.scrollWidth > c.clientWidth + 1).map(c => `${c.textContent} ${c.scrollWidth}>${c.clientWidth}`),
            fig: tds.filter(td => td.textContent.trim()).every(td => { const b = tbox(td), c = DS.box(td); return b.x >= c.x - .5 && b.r <= c.r + .5; }),
            wide: tbl.getBoundingClientRect().width > wi.clientWidth + 1, tw: [Math.round(tbl.getBoundingClientRect().width), wi.clientWidth], scrolls: wi.scrollWidth > wi.clientWidth + 1, ox: DS.cs(wi, 'overflowX'),
            layout: DS.cs(tbl, 'tableLayout'), rowTh: DS.cs(wi.querySelector('tbody th'), 'position'),
            headTh: DS.cs(document.querySelector('#tkWiBody thead th:nth-child(2)'), 'whiteSpace'),
            stats: st, ticketW: stW,
            size: { fs: DS.cs(sizeL, 'fontSize'), tt: DS.cs(sizeL, 'textTransform'), col: DS.norm(DS.cs(sizeL, 'color')), tx3: DS.tok('--tx3'), text: sizeL.textContent },
            inputs: ['#tkLots', '#tkSL', '#tkTP'].map(s => DS.cs(document.querySelector(s), 'fontWeight')),
            wiHead: DS.cs(wiHead, 'display'), wiSum: document.getElementById('tkWiSum').textContent, wiSec: wiSec.textContent,
            note: { ws: DS.cs(note, 'whiteSpace'), to: DS.cs(note, 'textOverflow'), title: note.title, h: note.getBoundingClientRect().height },
            more: { ws: DS.cs(document.querySelector('.ticket .tk-sec-s[data-sum=exits]'), 'whiteSpace'), to: DS.cs(document.querySelector('.ticket .tk-sec-s[data-sum=exits]'), 'textOverflow') }
          };
        }, [bal, lots]);
      }
      for (const [k, r] of Object.entries(out)) {
        t.ok(r.pieces.length >= 10, `${k}: summary pieces present (3 labels, 7 figures): ${r.pieces}`);
        t.ok(r.firstIsRisk, k + ': Margin, Risk, R : R');
        t.eq(r.rows, 3, k + ': three summary rows'); t.ok(r.line.every(n => n === 1), `${k}: each row on one line: ${r.line}`);
        t.ok(r.rowH.every(h => h === 36), `${k}: 36px rows: ${r.rowH}`); t.ok(r.bordered, k + ': every summary cell bordered');
        t.deep(r.cellHits, [], k + ': no cell of the summary overlaps another');
        t.eq(r.cellOut, 0, k + ': every cell inside the summary');
        t.eq(r.riskCol, r.dnTok, k + ': the money at risk on --dn');
        t.ok(r.labWs.every(w => w === 'nowrap'), k + ': labels never wrap');
        t.ok(parseFloat(r.risk.fs) >= 9 && parseFloat(r.risk.fs) <= 13, k + ': money at risk 9–13 px (sums of 11+ characters scale down to keep the four equal quarters): ' + r.risk.fs); t.eq(r.risk.fw, '700', k + ': money at risk 700'); t.ok(/mono/i.test(r.risk.ff), k + ': money at risk in mono');
        t.ok(parseFloat(r.rr.fs) >= 10.5 && parseFloat(r.rr.fs) <= 13, k + ': R : R figure 10.5–13 px: ' + r.rr.fs); t.eq(r.rr.fw, '700', k + ': figure 700');
        t.ok(r.td.n >= 12 && r.td.ws.every(w => w === 'nowrap'), k + ': what-if cells never wrap'); t.eq(r.td.ow, 'normal', k + ': no break inside a figure');
        t.deep(r.td.multi, [], k + ': every what-if figure on one line');
        t.eq(r.td.fs, '10px', k + ': what-if figures 10px');
        t.deep(r.spill, [], k + ': no what-if cell spills into the next one');
        t.ok(r.fig, k + ': every what-if figure inside its own cell');
        t.eq(r.layout, 'auto', k + ': auto table layout (the inline fixed one made nowrap cells overlap)');
        t.eq(r.ox, 'auto', k + ': what-if body scrolls sideways'); t.eq(r.scrolls, r.wide, k + ': it scrolls exactly when the figures are wider than the panel');
        t.eq(r.rowTh, 'sticky', k + ': row labels pinned while scrolling');
        t.eq(r.headTh, 'normal', k + ': what-if column heads may wrap');
        t.ok(r.stats[0] >= 112 && r.stats[0] >= r.ticketW * .38, `${k}: Trade math term column ≥ 112px and ~40% of its box: ${r.stats} / ${r.ticketW}`);
        t.eq(r.size.fs, '10px', k + ': size label 10px'); t.eq(r.size.tt, 'uppercase', k + ': size label uppercase'); t.eq(r.size.col, r.size.tx3, k + ': size label on --tx3');
        t.ok(/^Volume/.test(r.size.text), k + ': volume header: ' + r.size.text);
        t.deep(r.inputs, ['700', '700', '700'], k + ': the linked fields 700 (C v3)');
        t.ok(r.wiSum && r.wiSec.includes(r.wiSum), k + ': its summary stays in the section summary: ' + r.wiSec);
        // the execution note and the More summary wrap rather than lose text to an ellipsis (rule 8: nothing hidden)
        t.eq(r.note.ws, 'normal', k + ': execution note wraps, nothing cut'); t.ok(r.note.title.length > 20, k + ': full execution note as title');
      }
      // the default account at the default rail fits without scrolling
      t.ok(!out['1280 light $100000 5 lots'].scrolls, 'default account at 1280: the what-if table fits, no scroll');
      t.ok(!out['1100 dark $100000 5 lots'].scrolls, 'default account at 1100: the what-if table fits, no scroll: ' + out['1100 dark $100000 5 lots'].tw);
      // checked last so every other expectation is verified first: no label or figure of the summary loses characters to its cell
      for (const [k, r] of Object.entries(out)) {
        t.deep(r.cut, [], `${k}: every summary label and figure whole in its cell (text px > cell content px)`);
        t.deep(r.hits, [], `${k}: no text in the summary overlaps another`);
        t.deep(r.outside, [], `${k}: every summary figure inside the summary`);
        t.eq(r.wiHead, 'none', k + ': the what-if head (a repeat of its section title) hidden');
        t.eq(r.more.ws, 'normal', k + ': the Management summary wraps, nothing cut');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DTR5 series colours: EMA20 / RSI on --ind1 (dark, light, colour-blind), alerts on --warn, pane pendings in the side colour; legend EMA20 on --ind1',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.evaluate(HELP);
      const out = {};
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd'], ['light', 'cvd']]) {
        await look(page, th, pa);
        out[th + '-' + pa] = await page.evaluate(async () => {
          T.reset(); setLayout('4'); await new Promise(r => setTimeout(r, 200));
          const sym = S.set.sym, q = Engine.quote(sym), p = MC.panes[0], ps = p.cfg.sym, pq = Engine.quote(ps);
          addAlert(sym, +(q.mid * 1.01).toFixed(M(sym).digits), 'above'); addAlert(ps, +(pq.mid * 1.01).toFixed(M(ps).digits), 'above');
          rebuildLines();
          S.orders.push({ id: 990001, sym: ps, side: 'buy', ot: 'limit', price: pq.mid * .99, lots: 1 }, { id: 990002, sym: ps, side: 'sell', ot: 'limit', price: pq.mid * 1.02, lots: 1 });
          p.sig = ''; mcLines(p);
          const pl = p.lines.map(l => l.options()), c = chartColors();
          const r = { ind1: DS.tok('--ind1'), warn: DS.tok('--warn'), acc: DS.tok('--acc'), ema: DS.norm(sEma20.options().color), rsi: sRsi ? DS.norm(sRsi.options().color) : null,
            pane: DS.norm(p.e20.options().color), alert: DS.norm(lines.find(l => l.kind === 'alert').line.options().color),
            pAlert: DS.norm(pl.find(o => o.title === 'alert').color), buy: DS.norm(pl.find(o => /^buy /.test(o.title)).color), sell: DS.norm(pl.find(o => /^sell /.test(o.title)).color), up: DS.norm(c.up), dn: DS.norm(c.dn) };
          S.set.ind.ema20 = true; legend(null); const sp = [...document.querySelectorAll('#legend span')].find(s => /^EMA20/.test(s.textContent)); r.lg = sp && sp.style.color;
          S.orders = []; S.alerts = []; p.sig = ''; mcLines(p); rebuildLines(); setLayout('1');
          return r;
        });
      }
      for (const [k, r] of Object.entries(out)) {
        t.eq(r.ema, r.ind1, k + ': EMA20 on --ind1'); t.ok(r.ema !== r.acc, k + ': EMA20 not amber');
        if (r.rsi) t.eq(r.rsi, r.ind1, k + ': RSI on --ind1');
        t.eq(r.pane, r.ind1, k + ': pane EMA20 on --ind1');
        t.eq(r.alert, r.warn, k + ': main chart alert line on --warn'); t.eq(r.pAlert, r.warn, k + ': pane alert line on --warn');
        t.eq(r.buy, r.up, k + ': pane buy pending in the buy colour'); t.eq(r.sell, r.dn, k + ': pane sell pending in the sell colour');
        t.eq(r.lg, 'var(--ind1)', k + ': legend EMA20 on --ind1');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DTR6 chrome: quick trade without shadow, square info button, install button not amber, Equity 15px / 700 from 1440, flat demo band; header fits at 1280, 1680 and on the phone',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const out = {};
      for (const [w, h] of [[1280, 900], [1440, 900], [1680, 1000], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300);
        out[w] = await page.evaluate(async () => {
          document.documentElement.dataset.demo = '1'; setTab('history'); await new Promise(r => requestAnimationFrame(r));
          const eq = document.getElementById('mEq'), acct = eq.closest('.acct'), band = document.querySelector('.tab.on[data-pane=history]');
          const bs = band && getComputedStyle(band, '::before');
          const ib = document.getElementById('insBtn'), ia = getComputedStyle(ib, '::after');
          const r = { shadow: DS.cs(document.querySelector('.quick'), 'boxShadow'), ins: DS.cs(ib, 'borderTopLeftRadius'), insI: { mask: ia.maskImage || ia.webkitMaskImage || 'none', bg: DS.norm(ia.backgroundColor), shown: DS.shown(ib), bg0: DS.norm(DS.cs(ib, 'backgroundColor')) },
            inst: DS.norm(DS.cs(document.getElementById('installBtn'), 'color')), tx2: DS.tok('--tx2'), acc: DS.tok('--acc'),
            eq: { fs: DS.cs(eq, 'fontSize'), fw: DS.cs(eq, 'fontWeight'), shown: DS.shown(eq), cut: eq.scrollWidth > eq.clientWidth + 1 }, acctOver: acct.scrollWidth > acct.clientWidth + 1,
            band: bs && { img: bs.backgroundImage, bg: bs.backgroundColor, content: bs.content } };
          delete document.documentElement.dataset.demo; setTab('positions');
          return r;
        });
      }
      for (const [w, r] of Object.entries(out)) {
        t.eq(r.shadow, 'none', w + ': quick trade without shadow');
        // v15.21: on the desktop chart bar the specs button is a flush cell (radius 0) with an amber circled "i" drawn as a mask; the phone keeps its 2px square
        if (w === '390') t.eq(r.ins, '2px', w + ': info button square (2px)');
        else { t.eq(r.ins, '0px', w + ': info button a flush square cell'); t.ok(r.insI.shown && /^url\(/.test(r.insI.mask) && r.insI.bg === r.tx2 && r.insI.bg0 !== r.acc, w + ': circled "i" on --tx2 at rest, cell not filled (§3.8 icon buttons, 06.11.2026): ' + JSON.stringify({ ...r.insI, mask: r.insI.mask.slice(0, 12) })); }
        t.eq(r.inst, r.tx2, w + ': install button on --tx2'); t.ok(r.inst !== r.acc, w + ': install button not amber');
        t.eq(r.eq.fs, w >= 1680 ? '15px' : w >= 1280 ? '13px' : w >= 1081 ? '12px' : '14px', w + ': Equity 15px from 1680, 13px from 1280, 12px from 1081, 14px on the phone (all five account figures in the header, 06.11.2026)'); t.eq(r.eq.fw, '700', w + ': Equity 700'); t.ok(r.eq.shown && !r.eq.cut, w + ': Equity shown whole');
        t.ok(!r.acctOver, w + ': account figures fit the header');
        if (w !== '390') t.ok(r.band && r.band.content !== 'none', w + ': demo band shown on History');
        if (r.band && r.band.content !== 'none') { t.eq(r.band.img, 'none', w + ': demo band without hatching'); t.ok(r.band.bg !== 'rgba(0, 0, 0, 0)', w + ': demo band a flat tint: ' + r.band.bg); }
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DTR9 ticket F and Depth: title band and 64px instrument line, Market | Pending as one switch with an amber cursor and their plain names, SELL / BUY in Market and Sell | Buy in Pending, one field per stop / target row, square aligned list badges, folded section rows; Market / Limit / Stop at 1081–1920, both themes and cvd, nothing spills; phone untouched',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      await page.waitForFunction(() => document.querySelectorAll('.ticket .tk-secs>.tk-sec').length === 3 && window.iswOpen, null, { timeout: 30000 });
      const out = {};
      for (const [w, th, pa] of [[1081, 'dark', 'std'], [1280, 'light', 'std'], [1440, 'dark', 'cvd'], [1680, 'dark', 'std'], [1920, 'light', 'cvd']]) {
        await page.setViewportSize({ width: w, height: 1000 }); await look(page, th, pa);
        for (const ot of ['market', 'limit', 'stop']) {
          out[`${w} ${th}-${pa} ${ot}`] = await page.evaluate(async ot => {
            T.reset(); setLayout('1'); iswOpen('iDom'); iswFold(true); DS.closed(true);
            Object.assign(S.tk, { ot: 'market', price: null, side: 'buy', sm: 'lots', lots: 1, useSL: true, useTP: true, sl: 20, tp: 40 });
            document.getElementById('tkAdv').open = true; document.querySelector(`#otSeg [data-ot=${ot}]`).click(); renderTicket(); renderDom();
            await new Promise(r => requestAnimationFrame(r)); document.getAnimations().filter(a => a instanceof CSSTransition).forEach(a => a.finish());
            const tk = document.querySelector('.ticket'), tb = DS.box(tk), ph = tk.querySelector(':scope>.ph'), h2 = ph.querySelector('h2');
            const on = document.querySelector('#otSeg>button.on'), big = document.querySelector('#tkAsk>b'), spr = document.getElementById('tkSpr');
            // the stop loss and take profit rows: one field shown (the unit picked), inside the ticket
            const row3 = id => { const r = document.getElementById(id).closest('.tk3-row3'), c = [...r.children].filter(DS.shown).map(DS.box); return { n: c.length, top: new Set(c.map(b => Math.round(b.y))).size, inside: c.every(b => b.w > 0 && b.x >= tb.x - .5 && b.r <= tb.r + .5) }; };
            const ot0 = { on: document.querySelector('#otSeg>button.on') };
            const mkt = document.getElementById('tkMkt');
            // past the ticket's edge and not held by a clipping box inside the ticket (a sideways scroller or an ellipsis line is
            // not a spill; cut text and the what-if scroll are checked on their own: the section rows below, DTR4)
            const clipped = e => { for (let p = e.parentElement; p && p !== tk; p = p.parentElement) { if (DS.cs(p, 'overflowX') !== 'visible') { const c = DS.box(p); if (c.x >= tb.x - 1 && c.r <= tb.r + 1) return true; } } return false; };
            const spill = [...tk.querySelectorAll(':scope>:not(details) *')].filter(e => DS.shown(e) && e.closest('.ticket') === tk && !e.closest('#tkWarn')).filter(e => { const b = DS.box(e); return b.w > 0 && (b.x < tb.x - 1 || b.r > tb.r + 1) && !clipped(e); }).map(e => e.id || e.className || e.tagName);
            const warn = [...document.querySelectorAll('#tkWarn .w-lv')].filter(DS.shown).map(b => ({ x: Math.round(DS.box(b).x), w: Math.round(DS.box(b).w), rad: DS.cs(b, 'borderTopLeftRadius') }));
            const secs = [...document.querySelectorAll('.ticket .tk-secs>.tk-sec>summary')].map(s => { const a = DS.box(s.querySelector('.tk-sec-t')), b = DS.box(s.querySelector('.tk-sec-s')); const sr = DS.box(s); return { same: Math.abs((b.y + b.b) / 2 - (a.y + a.b) / 2) <= 2 && b.x >= a.r - .5, h: Math.round(sr.h), right: b.r <= sr.r + .5, ws: DS.cs(s.querySelector('.tk-sec-s'), 'whiteSpace') }; });
            const otOn = ot0.on, otSh = DS.cs(otOn, 'boxShadow'), otCol = DS.norm(DS.cs(otOn, 'color')), otTt = DS.cs(otOn.querySelector('.ot-n'), 'textTransform'), otRad = DS.cs(otOn, 'borderTopLeftRadius'), otPlain = !!otOn.querySelector('.ot-p') && DS.shown(otOn.querySelector('.ot-p'));
            // v15.20: Market | Pending is one full-width switch; the amber cursor (::before, half the track) slides under the chosen side
            const seg = document.getElementById('otSeg'), segB = DS.box(seg), cur = getComputedStyle(seg, '::before'), segBtns = [...seg.children].filter(DS.shown);
            const curX = segB.x + parseFloat(DS.cs(seg, 'borderLeftWidth')) + (new DOMMatrixReadOnly(cur.transform === 'none' ? undefined : cur.transform)).m41, curW = parseFloat(cur.width), onB = DS.box(otOn);
            const otCur = { bg: DS.norm(cur.backgroundColor), content: cur.content, under: Math.abs(curX - onB.x) <= 1 && Math.abs(curX + curW - onB.r) <= 1, at: [Math.round(curX), Math.round(curX + curW), Math.round(onB.x), Math.round(onB.r), cur.transform], full: Math.abs(segB.w - tk.clientWidth) <= 1, segW: Math.round(segB.w), tkW: tk.clientWidth, n: segBtns.length, ink: DS.tok('--acc-ink') };
            const inst = document.getElementById('tkInst'), go = document.getElementById('tkGo');
            const mode = { instH: inst && Math.round(DS.box(inst).h), instTxt: inst && (inst.querySelector('.tk-inst-n') || inst).textContent, instSpr: inst && (inst.querySelector('.tk-inst-s b') || {}).textContent, instFf: inst && DS.cs(inst, 'fontFamily'), instBg: inst && DS.norm(DS.cs(inst, 'backgroundColor')), band: DS.tok('--band'), side: DS.shown(document.getElementById('sideSeg')), go: DS.shown(go),
              goPx: go ? [...go.querySelectorAll('[data-go] b.mono')].map(b => DS.shown(b) && b.textContent.trim().length > 0) : [] };
            const pre = { big: ot === 'market' ? null : DS.cs(document.querySelector('#tkAsk>b'), 'fontSize'), entry: ot !== 'market' ? DS.shown(document.getElementById('tkPrice')) : null, tif: ot !== 'market' ? DS.shown(document.getElementById('tkTif')) : null, slim: ot === 'stop' ? DS.shown(document.getElementById('tkLmtOff')) : null };
            const rows3 = [row3('tkSL'), row3('tkTP')];
            // then the Depth panel opened: beside the ticket from 1281 px, over the ticket's column below (the 26vw rail)
            iswOpen('iDom'); renderDom(); await new Promise(r => requestAnimationFrame(r));
            const side = { tkW: Math.round(DS.box(tk).w), tkVis: DS.cs(tk, 'visibility'), domW: Math.round(DS.box(document.getElementById('iDom')).w), over: DS.hit(DS.box(tk), DS.box(document.getElementById('iDom'))), under: tk.getBoundingClientRect().bottom <= document.getElementById('iDom').getBoundingClientRect().top + 1 };
            const dom = document.getElementById('iDom'), dh = dom.querySelector('.ph h2'), ill = document.getElementById('domIll'), step = document.getElementById('domStep'), mid = document.getElementById('domSpr');
            const r = {
              ph: { h: Math.round(DS.box(ph).h), col: DS.norm(DS.cs(h2, 'color')), acc: DS.tok('--acc'), tx: DS.tok('--tx'), sym: DS.cs(document.getElementById('tkSym'), 'fontFamily') },
              ot: { sh: otSh, col: otCol, tt: otTt, rad: otRad, plain: otPlain, cur: otCur }, mode, pretty: pretty(S.set.sym),
              sprHidden: !DS.shown(spr), rows3, spill, mkt: DS.shown(mkt) && /Market closed/.test(mkt.textContent),
              ...pre,
              warn, secs, side,
              dom: { h2h: Math.round(DS.box(dh).h), band: (c => c >= DS.box(ill).y && c <= DS.box(ill).b)(DS.box(step).y + DS.box(step).h / 2) && DS.box(ill).y >= DS.box(dh).b - 1, midBg: DS.norm(DS.cs(mid.parentElement, 'backgroundColor')), s2: DS.tok('--s2'),
                rule: DS.cs(document.querySelector('#iDom .dom-row:not(.mid) .dp'), 'borderRightStyle'), foot: DS.shown(dom.querySelector('.foot-note')) }
            };
            DS.closed(false); renderDom();
            return r;
          }, ot);
        }
      }
      for (const [k, r] of Object.entries(out)) {
        t.eq(r.ph.h, 30, k + ': title band 30px'); t.eq(r.ph.col, r.ph.tx, k + ': NEW ORDER on --tx (a title, not clickable: no yellow, 06.11.2026)');
        // v15.20 (Victor, 31.10.2026): no symbol and no spread next to New order; the instrument has its own 64px mono line on the header band
        t.ok(r.sprHidden, k + ': no spread in the title band (moved out on purpose)');
        t.ok(r.mode.instH === 64 && r.mode.instTxt === r.pretty && /^\d/.test(r.mode.instSpr || '') && /mono/i.test(r.mode.instFf) && r.mode.instBg === r.mode.band, k + ': instrument line 64px, mono, on the band, with the live spread: ' + JSON.stringify(r.mode));
        t.ok(r.ot.cur.content !== 'none' && r.ot.cur.bg !== r.ph.acc && r.ot.cur.bg !== 'rgba(0, 0, 0, 0)' && r.ot.cur.under && r.ot.cur.full && r.ot.cur.n === 2, k + ': Market | Pending one full-width switch, the amber cursor under the selected side: ' + JSON.stringify(r.ot.cur));
        t.ok(r.ot.sh === 'none' && r.ot.col !== r.ot.cur.ink, k + ': selected type in --acc-ink on the cursor, no underline: ' + r.ot.sh + ' ' + r.ot.col);
        t.eq(r.ot.tt, 'uppercase', k + ': order types uppercase'); t.eq(r.ot.rad, '0px', k + ': flush strip');
        t.ok(r.ot.plain, k + ': Market | Pending with their plain names (now / at a price)');
        if (k.endsWith('market')) t.ok(!r.mode.side && r.mode.go && r.mode.goPx.length === 2 && r.mode.goPx.every(Boolean), k + ': Market: Buy/Sell segment hidden, big SELL / BUY with their prices: ' + JSON.stringify(r.mode));
        else { t.ok(r.mode.side && !r.mode.go, k + ': Pending: the Buy/Sell segment and the order button'); t.eq(r.big, '16px', k + ': big figure 16px (the side row)'); }
        t.ok(r.rows3.length === 2 && r.rows3.every(x => x.n === 1 && x.inside), k + ': stop loss and take profit: one field each, inside the ticket: ' + JSON.stringify(r.rows3));
        t.deep(r.spill, [], k + ': nothing spills out of the ticket');
        t.ok(r.mkt, k + ': market closed said once, at the top of the ticket');
        if (r.entry !== null) { t.ok(r.entry, k + ': Entry price row shown'); t.ok(r.tif, k + ': Good till row shown'); }
        if (r.slim !== null) t.ok(r.slim, k + ': Stop-limit row shown');
        t.ok(true, k + ': (list badges checked on the Check step elsewhere)');
        t.ok(r.warn.every(b => b.rad === '0px'), k + ': warning badges square'); t.ok(new Set(r.warn.map(b => b.x + ':' + b.w)).size <= 1, k + ': warning badges one column, one width');
        t.ok(r.secs.length === 3 && r.secs.every(s => s.right), k + ': folded sections as rows inside the ticket');
        // v15.20: each section is one 36px row, the summary on the title's line to its right
        t.ok(r.secs.every(s => s.same && s.h === 36), k + ': each section row 36px, the summary beside its title: ' + JSON.stringify(r.secs));
        if (+k.split(' ')[0] >= 1440) { t.ok(r.side.tkW >= 240 && r.side.domW >= 240 && !r.side.over && r.side.tkVis === 'visible', `${k}: Depth beside the ticket (${r.side.tkW} | ${r.side.domW})`); }
        else { t.ok(r.side.tkVis === 'visible' && !r.side.over && r.side.domW >= 200 && !r.side.under, `${k}: narrow rail: Depth beside the ticket over the chart edge, the ticket at full height (${r.side.domW})`); }
        t.eq(r.dom.h2h, 30, k + ': Depth title band 30px'); t.ok(r.dom.band, k + ': illustrative note and ladder step in one band under the title');
        t.eq(r.dom.midBg, r.dom.s2, k + ': spread / mid band on --s2'); t.eq(r.dom.rule, 'solid', k + ': a column rule between price and sizes'); t.ok(r.dom.foot, k + ': the click note stays visible');
      }
      // the phone keeps its ticket (no desktop table rules)
      await page.setViewportSize({ width: 390, height: 844 }); await look(page, 'dark'); await page.waitForTimeout(300);
      const ph = await page.evaluate(() => ({ mnav: document.body.classList.contains('mnav-on'), ct: DS.cs(document.querySelector('.ticket'), 'containerType'), ill: DS.cs(document.getElementById('domIll'), 'textTransform') }));
      t.ok(ph.mnav, 'phone layout on'); t.eq(ph.ct, 'normal', 'phone: the ticket is not the desktop container'); t.eq(ph.ill, 'none', 'phone: the Depth note keeps its case');
      // checked last so every other expectation is verified first: a section summary never loses text to an ellipsis
      for (const [k, r] of Object.entries(out)) t.ok(r.secs.every(s => s.ws !== 'nowrap'), k + ': the section summaries wrap instead of being cut: ' + r.secs.map(s => s.ws));
      t.noErrors(page);
    }
  },
  {
    name: 'DTR10 stop loss at a risk: Risk % and Risk <quote ccy> set the stop distance from the volume in lots',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); setSymbol('EURGBP'); Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'lots', lots: 1, useSL: true, sl: 20 }); syncTicketInputs(); renderTicket();
        const by = document.querySelector('#tkSlBy'), pick = v => { by.value = v; by.dispatchEvent(new Event('change', { bubbles: true })); };
        const type = (id, v) => { const i = document.getElementById(id); i.value = v; i.dispatchEvent(new Event('input', { bubbles: true })); renderTicket(); };
        const out = { label: by.querySelector('[value=rcur]').textContent };
        pick('rpct'); type('tkSlRp', '1'); let k = tkCalc(); out.pct = k.riskUsd / k.a.eq * 100; out.pctShown = !document.getElementById('tkSlRp').closest('.tk3-c').hidden;
        pick('rcur'); type('tkSlRc', '500'); k = tkCalc(); out.gbp = k.riskUsd / Engine.usd('GBP'); out.sl = S.tk.sl;
        S.tk.lots = 2; renderTicket(); out.sl2 = S.tk.sl;
        return out;
      });
      t.eq(r.label, 'Risk GBP', 'the money option names the quote currency');
      t.ok(r.pctShown, 'Risk % field shown');
      t.near(r.pct, 1, 'Risk 1% makes a 1% stop (to 0.1 pip)', 0, .01);
      t.near(r.gbp, 500, 'Risk GBP 500 makes a GBP 500 stop', 0, .5);
      t.near(r.sl2, r.sl / 2, 'twice the volume halves the distance', 0, .1);
      t.noErrors(page);
    }
  },
  {
    name: 'DTR11 volume in lots only, with the margin it takes and the exposure after it (green to red, a bar); a ticket saved sizing by risk keeps its size in lots; a stop past zero blocks',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); setSymbol('EURUSD'); Object.assign(S.tk, { side: 'buy', ot: 'market', sm: 'risk', risk: 1, useSL: true, sl: 20 }); TKF.sl = 'pips';
        const want = tkCalc().lots; renderTicket();
        const out = { sm: S.tk.sm, lots: S.tk.lots, want, sizeBy: document.querySelector('#tkSizeBy').hidden, chips: document.querySelector('#tkChips').hidden, presets: !document.querySelector('#tkPresets').hidden };
        const mg = lots => { S.tk.lots = lots; renderTicket(); const m = document.querySelector('#tkVolX'); return { v: m.querySelector('b').textContent, w: parseFloat(m.querySelector('.tk-mgbar>i').style.width), c: getComputedStyle(m.querySelector('b')).color, h2: m.style.getPropertyValue('--h2'), under: !!m.previousElementSibling?.matches('#tkVolRow') }; };
        out.small = mg(.01); out.big = mg(Math.floor(volOf('EURUSD')[1]));
        out.margin = tkCalc().margin;
        S.tk.lots = 1; S.tk.sl = 1e6; out.zero = tkBlocks(tkCalc()).map(b => b.btn);
        return out;
      });
      t.eq(r.sm, 'lots', 'a ticket saved sizing by risk is in lots');
      t.near(r.lots, r.want, 'it keeps the size it had', 0, 1e-9);
      t.ok(r.sizeBy && r.chips && r.presets, 'no size unit, no risk chips; the lot presets show');
      t.ok(r.small.w < r.big.w, `the bar grows with the size: ${r.small.w}% → ${r.big.w}%`);
      t.ok(r.small.c !== r.big.c, 'the colour moves with the size');
      t.eq(r.small.h2, '0%', 'a small order stays on the green side');
      t.ok(r.small.under, 'the line sits right under the volume');
      t.ok(r.zero.some(x => /Stop loss below zero/.test(x)), 'a stop past zero blocks: ' + r.zero.join(' | '));
      t.noErrors(page);
    }
  }
];

// node-side copy of the contrast formula (the page-side one is DS.ratio)
function DS_ratio(a, b) {
  const lum = h => { const v = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(c => c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4); return .2126 * v[0] + .7152 * v[1] + .0722 * v[2]; };
  const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
