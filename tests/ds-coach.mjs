// Design system · ds-coach: Behaviour (behav.js, fit.js pages) and Challenge (challenge.js, CH_CSS).
// Score as the hero figure, title bands on the cards, the process matrix as a bordered table, the tilt guard coloured
// only on its state, no amber on values, folded prose with a visible summary, the challenge target first and the
// limits as one aligned table (role=meter kept), readable on a phone.
import { readFileSync } from 'node:fs';
// axe-core is read from the test workspace next to the repo, as in tests/a11y.mjs
const AXE_PATH = '/Users/victorsafta/Projects/MeridianFX/5-teste/node_modules/axe-core/axe.min.js';
const ROW = `(o) => Object.assign({ sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, pips: 0, r: 1, comm: 0, swap: 0, reason: 'Manual', note: '', setup: '', ctx: [], news: [] }, o)`;
const PM0 = `(o) => Object.assign({ flags: [], codes: [], mine: [], own: '', kill: '', timeStop: 0, conf: null, mood: null, broke: [], override: false, t: 0 }, o)`;
const HELP = () => {
  window.DC = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DC.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    col: (el, p = 'color') => DC.norm(getComputedStyle(el)[p]),
    look(th, pa) { const h = document.documentElement; h.dataset.theme = th; h.dataset.palette = pa; },
    // a few losing trades through pre-mortems, with stops: enough for a score, the matrix and the review
    seed(ROW, PM0) {
      const row = eval(ROW), pm = eval(PM0), now = Engine.simTime, rows = [];
      for (let i = 0; i < 12; i++) rows.push(row({ id: 100 + i, pnl: i % 3 ? -40 : 60, sl0: 1.09, slLast: 1.09, tp0: 1.12, r: i % 3 ? -1 : 1.5, open: now - (20 - i) * 3600 - 600, close: now - (20 - i) * 3600, vol: true, pm: pm({ mine: ['Entered against the trend'], conf: 60, mood: 'calm' }), ctx: i % 4 ? [] : ['nosl'] }));
      S.history = rows.reverse();
    }
  };
};

export const tests = [
  {
    name: 'DSC1 Behaviour score: the score is the hero (mono 17/700, ink), the grade a key value, label beside it, page strip first; light, dark, cvd',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      const out = {};
      for (const [th, pa] of [['dark', ''], ['light', ''], ['dark', 'cvd']]) {
        out[th + pa] = await page.evaluate(({ ROW, PM0, th, pa }) => {
          T.reset(); DC.seed(ROW, PM0); DC.look(th, pa); setTab('behav'); renderBehav();
          const sc = document.querySelector('#behav .bh-score'), num = sc.querySelector('.bh-score-g .bh-num'), gr = sc.querySelector('.bh-grade b');
          const cs = getComputedStyle(num), gs = getComputedStyle(gr), part = sc.querySelector('.bh-score-c>div:not(.z)>span.mono') || sc.querySelector('.bh-score-c>div>span.mono');
          return {
            score: BH_LAST.score, num: num.textContent, size: cs.fontSize, weight: cs.fontWeight, mono: /mono/i.test(cs.fontFamily), color: DC.col(num), tx: DC.tok('--tx'),
            gSize: parseFloat(gs.fontSize), gWeight: gs.fontWeight, label: sc.querySelector('.bh-score-g>.bh-lab')?.textContent,
            first: sc.firstElementChild.classList.contains('bh-pgs'), tabs: sc.querySelectorAll('.bh-pgs [role=tab]').length,
            part: { size: getComputedStyle(part).fontSize, weight: getComputedStyle(part).fontWeight }
          };
        }, { ROW, PM0, th, pa });
      }
      for (const [k, r] of Object.entries(out)) {
        t.ok(r.score != null, `${k}: a score exists`);
        t.eq(r.num, String(Math.round(r.score)), `${k}: hero shows the score`);
        t.deep([r.size, r.weight, r.mono], ['17px', '700', true], `${k}: hero mono 17/700`);
        t.eq(r.color, r.tx, `${k}: hero in ink (--tx), not the grade colour`);
        t.ok(r.gSize <= 15 && r.gWeight === '600', `${k}: grade is a key value ≤15/600: ${r.gSize}/${r.gWeight}`);
        t.eq(r.label, 'Behaviour score', `${k}: label sits with the score`);
        t.ok(r.first && r.tabs === 3, `${k}: page strip opens the panel (${r.tabs} tabs)`);
        t.deep([r.part.size, r.part.weight], ['13px', '600'], `${k}: score parts are values (13/600)`);
      }
      const nd = await page.evaluate(() => { T.reset(); S.dispo = null; S.tiltSt = null; S.bhScoreHist = []; renderBehav(); const g = document.querySelector('#behav .bh-score-g'); return { nd: g.querySelector('.bh-nd')?.textContent, num: !!g.querySelector('.bh-num'), size: getComputedStyle(g.querySelector('.bh-nd')).fontSize }; });
      t.deep(nd, { nd: 'not enough data', num: false, size: '12px' }, 'no data: secondary text, no hero number');
      t.noErrors(page);
    }
  },
  {
    name: 'DSC2 Behaviour cards: title bands on --band, the 8 cards still found by fit.js BH_MAP, citations carry a title',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 860 });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); DC.seed(ROW, PM0); setTab('behav'); renderBehav();
        const band = DC.tok('--band'), hs = [];
        for (const pg of ['habits', 'pm', 'flags']) {
          document.querySelector(`#behav .bh-pgs [data-bhpg=${pg}]`).click();
          for (const c of document.querySelectorAll(`#behav .bh-card[data-pg=${pg}]`)) {
            const h = c.querySelector(':scope>h3'), cs = getComputedStyle(h);
            hs.push({ t: h.textContent.trim().slice(0, 20), bg: DC.col(h, 'backgroundColor') === band, bb: cs.borderBottomWidth, up: cs.textTransform, w: cs.fontWeight, edge: Math.round(h.getBoundingClientRect().left - c.getBoundingClientRect().left) });
          }
        }
        const src = [...document.querySelectorAll('#behav .obs-src')].map(a => (a.getAttribute('title') || '').length > 20);
        return { cards: document.querySelectorAll('#behav .bh-card[data-pg]').length, hs, src };
      }, { ROW, PM0 });
      t.eq(r.cards, 8, 'all 8 cards keep their page (titles unchanged)');
      t.eq(r.hs.length, 8, 'every card visited');
      for (const h of r.hs) t.ok(h.bg && h.bb === '1px' && h.up === 'uppercase' && h.w === '700' && h.edge <= 1, 'title band: ' + JSON.stringify(h));
      t.ok(r.src.length === 4 && r.src.every(Boolean), 'four citations with a full title: ' + r.src);
      t.noErrors(page);
    }
  },
  {
    name: 'DSC3 process vs outcome is a bordered 3×3 table (.po kept, labels kept, no inline amber); annotations sit in fixed slots',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); DC.seed(ROW, PM0); setTab('behav'); renderBehav();
        const tb = document.querySelector('#behav table.tbl.bh-pot'), td = tb.querySelector('td.po'), b = td.querySelector('b'), cs = getComputedStyle(td);
        const heads = [...tb.querySelectorAll('th')].map(x => x.textContent), labels = [...tb.querySelectorAll('td.po>span')].map(x => x.textContent);
        document.querySelector('#behav .bh-pgs [data-bhpg=flags]').click();
        const ci = [...document.querySelectorAll('#behav .bh-board small.ci')].map(x => getComputedStyle(x)), cells = [...document.querySelectorAll('#behav .bh-board tbody tr')].map(tr => tr.children[2].getBoundingClientRect().right);
        const figs = [...document.querySelectorAll('#behav .bh-card[data-pg=flags] .bh-board tbody tr')].filter(tr => tr.children[2].querySelector('small.ci')?.textContent).map(tr => { const s = tr.children[2].querySelector('small.ci'); return Math.round(s.getBoundingClientRect().left); });
        return { rows: tb.tBodies[0].rows.length, cols: tb.tBodies[0].rows[0].cells.length, po: tb.querySelectorAll('td.po').length, heads, labels, br: cs.borderRightWidth, bbw: cs.borderBottomWidth,
          b: [getComputedStyle(b).fontSize, getComputedStyle(b).fontWeight], inline: !!document.querySelector('#behav [style*="--acc"]'), ci: ci.map(x => x.display), figs, cells: cells.length };
      }, { ROW, PM0 });
      t.deep([r.rows, r.cols, r.po], [2, 3, 4], 'two process rows × (head + Won + Lost), four .po cells');
      t.deep(r.heads, ['Process', 'Won', 'Lost', 'Good process', 'Poor process'], 'column and row heads');
      t.deep(r.labels, ['Deserved win', 'Bad break', 'Dumb luck', 'Poetic justice'], 'quadrant labels kept');
      t.deep([r.br, r.bbw], ['1px', '1px'], 'cell borders');
      t.deep(r.b, ['14px', '600'], 'counts mono 14/600');
      t.eq(r.inline, false, 'no inline amber anywhere in Behaviour');
      t.ok(r.ci.length > 0 && r.ci.every(d => d === 'inline-block'), 'Wilson intervals in their own slot: ' + r.ci);
      t.ok(r.figs.length >= 2 && new Set(r.figs).size === 1, 'win-rate figures end at the same x: ' + r.figs);
      t.noErrors(page);
    }
  },
  {
    name: 'DSC4 tilt guard: only the state is coloured (armed --warn, cooling red), counters stay ink, Overrides red only when set',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      const r = await page.evaluate(({ ROW }) => {
        T.reset(); const row = eval(ROW), now = Engine.simTime;
        S.history = [0, 1, 2].map(i => row({ id: 200 + i, pnl: -30, open: now - 4000 + i * 600, close: now - 3700 + i * 600 })).reverse();
        tiltCfg().on = true; tiltCfg().streak = 3; S.tiltSt = { until: 0, trips: 1, overrides: 0, lastTrip: null };
        setTab('behav'); renderBehav();
        const read = () => { const b = document.querySelector('#behav .bh-tilt'), st = b.querySelector(':scope>div:first-child>b'), k = b.querySelector('.kpi b'); return { cls: b.className, st: DC.col(st), kpi: DC.col(k), shadow: getComputedStyle(b).boxShadow, bg: DC.col(b, 'backgroundColor') }; };
        const armed = read(); S.tiltSt.until = now + 600; S.tiltSt.overrides = 2; renderBehav(); const cool = read();
        const ov = [...document.querySelectorAll('#behav .bh-tilt .kpi')].find(x => /Overrides/.test(x.textContent)).querySelector('b');
        return { armed, cool, ov: DC.col(ov), warn: DC.tok('--warn'), bad: DC.tok('--bad'), tx: DC.tok('--tx'), s2: DC.tok('--s2') };
      }, { ROW });
      t.ok(/\bon\b/.test(r.armed.cls) && !/\bcool\b/.test(r.armed.cls), 'armed: ' + r.armed.cls);
      t.eq(r.armed.st, r.warn, 'armed state on --warn'); t.eq(r.armed.kpi, r.tx, 'counters in ink while armed');
      t.eq(r.armed.bg, r.s2, 'no red wash on the box');
      t.ok(/\bcool\b/.test(r.cool.cls), 'cooling: ' + r.cool.cls);
      t.eq(r.cool.st, r.bad, 'cooling state red'); t.eq(r.cool.kpi, r.tx, 'counters in ink while cooling');
      t.eq(r.ov, r.bad, 'overrides stay red (st-bad)');
      t.noErrors(page);
    }
  },
  {
    name: 'DSC5 no amber on values or fake links: pre-mortem answer is a two-button strip (aria-pressed), evidence in ink, lines on --ind1, prose folded under a visible summary',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); DC.seed(ROW, PM0); S.bhScoreHist = [{ h: 1, s: 40 }, { h: 2, s: 60 }];
        setTab('behav'); renderBehav();
        const acc = DC.tok('--acc'), el = document.getElementById('behav');
        document.querySelector('#behav .bh-pgs [data-bhpg=pm]').click();
        const yn0 = el.querySelector('.pm-yn'), yn = yn0 && { n: yn0.querySelectorAll('button').length, gap: getComputedStyle(yn0).columnGap, role: yn0.getAttribute('role') };
        el.querySelector('[data-hit][data-v="1"]').click();
        const on0 = el.querySelector('.pm-yn button.on'), on = on0 && { getAttribute: () => on0.getAttribute('aria-pressed'), color: DC.col(on0) };
        const sums = [];
        for (const pg of ['habits', 'pm', 'flags']) { el.querySelector(`.bh-pgs [data-bhpg=${pg}]`).click(); for (const d of el.querySelectorAll(`.bh-card[data-pg=${pg}] details.bh-more`)) { const s = d.querySelector('summary'); sums.push({ k: d.dataset.more, h: s.offsetHeight, len: s.textContent.length, body: d.textContent.length - s.textContent.length }); } }
        const values = [...el.querySelectorAll('b, span.mono, small, td, .bh-de-v')].filter(x => x.offsetParent && x.textContent.trim() && !x.closest('.on, button, select, .bh-pgs')).filter(x => DC.col(x) === acc).map(x => x.className + ':' + x.textContent.slice(0, 20));
        const strokes = [...el.querySelectorAll('polyline')].map(p => p.getAttribute('stroke'));
        // an open fold survives a re-render
        el.querySelector('details[data-more=flags]').open = true; el.querySelector('details[data-more=flags]').dispatchEvent(new Event('toggle')); renderBehav();
        return { yn: yn && { ...yn, pressed: on && on.getAttribute('aria-pressed') }, onColor: on && on.color, acc,
          sums, values, strokes, kept: el.querySelector('details[data-more=flags]').open, oldAcc: !!el.querySelector('.bh-score-t .acc, .pm-ask .acc') };
      }, { ROW, PM0 });
      t.deep(r.yn, { n: 2, gap: '1px', role: 'group', pressed: 'true' }, 'Yes / No is one strip with 1px separators and aria-pressed');
      t.eq(r.onColor, r.acc, 'the chosen answer is the selection (amber)');
      t.eq(r.oldAcc, false, 'no amber text that looks like a link');
      t.deep(r.values, [], 'no value in amber');
      t.ok(r.strokes.length >= 1 && r.strokes.every(s => s === 'var(--ind1)'), 'series lines on --ind1: ' + r.strokes);
      t.deep(r.sums.map(s => s.k).sort(), ['cal', 'dispo', 'flags', 'po', 'tilt'], 'five folds');
      for (const s of r.sums) t.ok(s.h > 0 && s.len > 30 && s.body > 100, 'summary visible, body kept: ' + JSON.stringify(s));
      t.ok(r.kept, 'an opened fold stays open after a re-render');
      t.noErrors(page);
    }
  },
  {
    name: 'DSC6 Challenge: profit target is the hero, rooms are key; limits are one aligned table (role=meter, shapes, .ch-meter kept); bands; neutral start button; CH_CSS clean',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      const r = await page.evaluate(() => {
        T.reset(); S.chal = null; S.demo = null; setTab('chal'); renderChal();
        const sb = document.getElementById('chStartB'), btn = { pri: sb.classList.contains('btn-pri'), bg: DC.col(sb, 'backgroundColor'), tx: DC.tok('--tx') };
        chStart('2s-static'); renderChal();
        const c = document.getElementById('chal'), hero = c.querySelector('.ch-kpis .kpi.hero'), hb = getComputedStyle(hero.querySelector('b'));
        const keys = [...c.querySelectorAll('.ch-kpis .kpi.key')].map(k => [k.querySelector('label').textContent, getComputedStyle(k.querySelector('b')).fontSize, getComputedStyle(k.querySelector('b')).fontWeight]);
        const head = c.querySelector('.ch-mhead'), rows = [...c.querySelectorAll('.ch-meter')];
        const tracks = rows.map(x => getComputedStyle(x).gridTemplateColumns), headTracks = getComputedStyle(head).gridTemplateColumns;
        const room = c.querySelector('.ch-meter .ch-room'), floor = c.querySelector('.ch-meter .ch-floor');
        const band = DC.tok('--band'), bands = ['.ch-att>.ch-cap', '#chReadyH', '.ch-log>h3', '.ch-rh h3'].map(s => DC.col(c.querySelector(s), 'backgroundColor') === band);
        const st = getComputedStyle(document.getElementById('chAttH'));
        const bar = c.querySelector('.ch-meter.tgt .ch-bar'), css = document.getElementById('chStyle').textContent;
        const lefts = rows.map(x => Math.round(x.querySelector('.ch-room').getBoundingClientRect().right));
        return {
          btn, heroLab: hero.querySelector('label').textContent, hero: [hb.fontSize, hb.fontWeight], keys, before: !!(hero.compareDocumentPosition(head) & Node.DOCUMENT_POSITION_FOLLOWING),
          n: rows.length, roles: rows.every(x => x.getAttribute('role') === 'meter' && /: .+\. /.test(x.getAttribute('aria-valuetext'))), shapes: rows.map(x => x.querySelector('.ch-st span[aria-hidden]').textContent).join(''),
          same: tracks.every(x => x === headTracks), tracks: [headTracks, ...tracks], heads: [...head.children].map(x => x.textContent), br: getComputedStyle(room).borderRightWidth,
          room: [getComputedStyle(room).fontSize, getComputedStyle(room).fontWeight, DC.col(room) === DC.tok('--tx')], floor: [getComputedStyle(floor).fontSize, DC.col(floor) === DC.tok('--tx2')], lefts,
          bands, status: [st.textTransform, DC.col(document.getElementById('chAttH'), 'backgroundColor')],
          bar: [getComputedStyle(bar).display, parseFloat(getComputedStyle(bar).borderTopLeftRadius), DC.col(bar.querySelector('i'), 'backgroundColor') === DC.tok('--up')],
          css: { grad: /gradient/.test(css), acc: /var\(--acc\)/.test(css), r3: /radius:3px/.test(css) }
        };
      });
      t.deep([r.btn.pri, r.btn.bg !== 'rgba(0, 0, 0, 0)'], [true, true], 'start button is the primary (.btn-pri: yellow frame + text, no fill, ui-controls §3.7)');
      t.eq(r.heroLab, 'Profit target', 'hero is the profit target');
      t.deep(r.hero, ['16px', '700'], 'hero 16/700');
      t.deep(r.keys, [['Daily room', '13px', '600'], ['Max room', '13px', '600']], 'rooms are key values');
      t.ok(r.before, 'the hero reads before the limits table');
      t.ok(r.n >= 4 && r.roles, `${r.n} rows keep role=meter with aria-valuetext`);
      t.ok(/^[●▲✕✓]+$/.test(r.shapes), 'status shapes: ' + r.shapes);
      t.ok(r.same, 'every row uses the head row tracks: ' + JSON.stringify(r.tracks));
      t.deep(r.heads, ['Limit', 'Used', 'Allowed', 'Room', 'Floor', 'Status'], 'columns');
      t.eq(r.br, '1px', 'cell borders');
      t.deep(r.room, ['13px', '600', true], 'room is key (13/600 ink)'); t.deep(r.floor, ['11px', true], 'floor is secondary');
      t.ok(new Set(r.lefts).size === 1, 'room figures end at the same x: ' + r.lefts);
      t.ok(r.bands.every(Boolean), 'title bands on rules, attempt, readiness, log: ' + r.bands);
      t.eq(r.status[0], 'none', 'the attempt heading is a status line, not a second band');
      t.deep(r.bar, ['block', 2, true], 'target bar: block, 2px radius, --up');
      t.deep(r.css, { grad: false, acc: false, r3: false }, 'CH_CSS: no gradient, no amber, no 3px radius');
      t.noErrors(page);
    }
  },
  {
    name: 'DSC7 phone 390: Challenge limits fold into labelled two-line rows (nothing dropped, no sideways scroll); Behaviour bands and folds stay',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 5000 }).catch(() => {});
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); S.chal = null; S.demo = null; chStart('2s-static'); setTab('chal'); renderChal();
        const c = document.getElementById('chal'), rows = [...c.querySelectorAll('.ch-meter')];
        const lab = rows[0].querySelector('.ch-used'), before = getComputedStyle(lab, '::before').content;
        const out = { mnav: document.body.classList.contains('mnav-on'), head: getComputedStyle(c.querySelector('.ch-mhead')).display, n: rows.length, vis: rows.every(x => x.offsetHeight > 0),
          cells: rows.every(x => [...x.querySelectorAll('.ch-c')].every(e => e.offsetHeight > 0)), before, over: c.scrollWidth - c.clientWidth, hero: !!c.querySelector('.ch-kpis .kpi.hero') };
        DC.seed(ROW, PM0); setTab('behav'); renderBehav();
        const b = document.getElementById('behav');
        out.bh = { num: !!b.querySelector('.bh-num'), sums: [...b.querySelectorAll('.bh-card[data-pg=habits] details.bh-more>summary')].every(s => s.offsetHeight > 0), over: b.scrollWidth - b.clientWidth, who: [...b.querySelectorAll('*')].filter(e => e.offsetParent && e.getBoundingClientRect().right > b.getBoundingClientRect().right + 1).slice(0, 4).map(e => e.tagName + '.' + e.className + ':' + e.textContent.slice(0, 30) + '@' + e.parentElement.className + '/' + e.closest('.bh-card')?.querySelector('h3')?.textContent.slice(0, 15)) };
        return out;
      }, { ROW, PM0 });
      t.eq(r.head, 'none', 'no column head on a phone'); t.ok(r.n >= 4 && r.vis && r.cells, 'every row and cell still shown');
      t.eq(r.before, '"Used"', 'cells carry their label'); t.ok(r.over <= 1, 'no sideways scroll in Challenge: ' + r.over);
      t.ok(r.hero, 'hero shown on the phone');
      t.ok(r.bh.num && r.bh.sums && r.bh.over <= 1, 'Behaviour on the phone: ' + JSON.stringify(r.bh));
      t.noErrors(page);
    }
  },
  {
    name: 'DSC8 demo banner: Behaviour and Challenge share one plain band (no hatching), text kept',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        document.documentElement.dataset.demo = '1';
        const pick = p => { const el = document.querySelector(`.tab[data-pane=${p}]`), s = getComputedStyle(el, '::before'); return { img: s.backgroundImage, bg: s.backgroundColor, txt: s.content }; };
        return { behav: pick('behav'), chal: pick('chal') };
      });
      t.eq(r.behav.img, 'none', 'Behaviour banner without hatching'); t.eq(r.chal.img, 'none', 'Challenge banner plain');
      t.eq(r.behav.bg, r.chal.bg, 'same band colour');
      t.ok(/Illustrative, not achievable/.test(r.behav.txt) && /Example trades never count here/.test(r.chal.txt), 'disclosures kept');
      t.noErrors(page);
    }
  },
  {
    name: 'DSC9 axe incl. color-contrast on the filled states (three Behaviour pages with trades, a running attempt, a fold open, tilt cooling): dark/light × std/cvd, desktop and phone',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP); await page.waitForFunction(() => /bh-pgs/.test(String(renderBehav)), null, { timeout: 10000 });
      await page.addScriptTag({ content: readFileSync(AXE_PATH, 'utf8') });
      const bad = [];
      for (const [w, h] of [[1680, 1000], [390, 844]]) {
        await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(300);
        for (const [theme, palette] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd'], ['light', 'cvd']]) {
          await page.evaluate(o => { Object.assign(S.set, o); applyTheme(); }, { theme, palette });
          const v = await page.evaluate(async ({ ROW, PM0, tags }) => {
            const run = async (el, lab) => (await axe.run(el, { runOnly: { type: 'tag', values: tags }, rules: { 'color-contrast': { enabled: true } }, resultTypes: ['violations'] })).violations.flatMap(x => x.nodes.map(n => `${x.id} ${n.target.join(' ')} [${lab}]`));
            const out = [];
            T.reset(); DC.seed(ROW, PM0); S.tiltSt = { until: Engine.simTime + 600, trips: 1, overrides: 1, lastTrip: null }; tiltCfg().on = true;
            setView('coach', 'behav'); renderBehav();
            await new Promise(r => setTimeout(r, 500));
            for (const pg of ['habits', 'pm', 'flags']) {
              document.querySelector(`#behav .bh-pgs [data-bhpg=${pg}]`).click();
              document.querySelectorAll(`#behav .bh-card[data-pg=${pg}] details.bh-more`).forEach(d => { d.open = true; });
              await new Promise(r => setTimeout(r, 60)); out.push(...await run(document.getElementById('behav'), 'behav/' + pg));
            }
            S.chal = null; S.demo = null; S.positions = []; chStart('2s-static'); setView('coach', 'chal'); renderChal();
            await new Promise(r => setTimeout(r, 500));
            await new Promise(r => setTimeout(r, 60)); out.push(...await run(document.getElementById('chal'), 'chal'));
            return out;
          }, { ROW, PM0, tags: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] });
          bad.push(...v.map(x => `${x} ${w} ${theme}/${palette}`));
        }
      }
      t.deep([...new Set(bad)].slice(0, 12), [], 'no axe violation');
      t.noErrors(page);
    }
  }
];
