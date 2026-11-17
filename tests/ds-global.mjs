// Design system · ds-global: overlays, phone reach, replay, toasts (audit global.md G1-G5, G7, G10, G12-G14 + LOW).
// Title bands on every overlay, neutral primary buttons (amber is selection only, Reset on --bad), Specifications as a
// bordered grid, the replay summary as a table, Help and sound settings reachable on the phone, the replay bar on two
// rows there with Close visible, touch targets of 32px and chart data tables that fit 390px without losing a column.
const look = (page, theme, palette = 'std') => page.evaluate(([th, pa]) => { S.set.theme = th; S.set.palette = pa; applyTheme(); }, [theme, palette]);
const HELP = () => {
  window.DG = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    tok: n => DG.norm(getComputedStyle(document.documentElement).getPropertyValue(n).trim()),
    // a title band: own background, a bottom hairline, flush with its box (top and left edges inside the border)
    band(el, box) {
      if (!el) return null;
      const c = getComputedStyle(el), r = el.getBoundingClientRect(), b = box.getBoundingClientRect(), bc = getComputedStyle(box);
      return { bg: DG.norm(c.backgroundColor), bb: c.borderBottomWidth, dt: Math.round(r.top - b.top - parseFloat(bc.borderTopWidth)), dl: Math.round(r.left - b.left - parseFloat(bc.borderLeftWidth)), dr: Math.round(b.right - parseFloat(bc.borderRightWidth) - r.right) };
    },
    btn(el) { const c = getComputedStyle(el); return { bg: DG.norm(c.backgroundColor), col: DG.norm(c.color) }; },
    rect(el) { const r = el.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; }
  };
};
// the Help additions (tour button, Display group, margin note) and the Specifications popover are built after boot
const ready = page => page.waitForFunction(() => document.querySelector('#help .help-tour .tour-next') && document.querySelector('#help .set-disp h4') && document.getElementById('marginNote') && document.getElementById('insPop'), null, { timeout: 30000 });

// the replay document of the current rid (as in replay.mjs)
async function replayFrame(page) {
  for (let i = 0; i < 400; i++) {
    const r = await page.evaluate(() => window.__mfxRpRid || null);
    const f = r && page.frames().find(x => x !== page.mainFrame() && x.url().includes('rid=' + r));
    if (f) {
      try { await f.waitForFunction(() => window.RP && (RP.state === 'paused' || RP.state === 'ended'), null, { timeout: 30000 }); return f; }
      catch (e) { if (!/detached|destroyed|navigat/i.test(String(e))) throw e; }
    }
    await page.waitForTimeout(50);
  }
  throw new Error('replay document did not appear');
}
const SPEC = { kind: 'sim', seed: 4821, start: 1760425200, rates: [0.89222, 0.75491, 157.98, 0.83021, 1.447, 1.4207, 1.7855], rateDate: '2026-10-15' };

export const tests = [
  {
    name: 'DSG1 overlay title bands: Help, Confirm, Save layout, Specifications, tour, sound settings (dark and light)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await ready(page);
      await page.evaluate(HELP);
      for (const th of ['dark', 'light']) {
        await look(page, th);
        const r = await page.evaluate(async () => {
          const out = { tokBand: DG.tok('--band'), line2: DG.tok('--line2'), tx: DG.tok('--tx') };
          document.getElementById('help').hidden = false;
          const hm = document.querySelector('#help .modal'), hph = hm.querySelector(':scope>.ph'), h2 = hph.querySelector('h2'), h3 = hm.querySelector('.help-grid h3'), c2 = getComputedStyle(h2), c3 = getComputedStyle(h3);
          out.help = { ...DG.band(hph, hm), h2: { col: DG.norm(c2.color), fw: c2.fontWeight, fs: parseFloat(c2.fontSize) }, h3fs: parseFloat(c3.fontSize), h3tt: c3.textTransform, close: !!hph.querySelector('[data-close]') };
          const h4 = getComputedStyle(document.querySelector('#help .set-disp h4')), sh3 = getComputedStyle(document.querySelector('#help .help-set h3'));
          out.heads = { same: h4.fontSize === sh3.fontSize && h4.textTransform === sh3.textTransform && h4.color === sh3.color && h4.fontWeight === sh3.fontWeight };
          const mn = document.getElementById('marginNote'); out.margin = mn && { fs: getComputedStyle(mn).fontSize, col: DG.norm(getComputedStyle(mn).color), tx3: DG.tok('--tx3') };
          document.getElementById('help').hidden = true;
          askConfirm({ title: 'Test', body: 'Body', ok: 'OK', onOk: () => {} });
          await new Promise(r => setTimeout(r, 30));
          const cm = document.querySelector('.cf-modal'); out.cf = { ...DG.band(cm.querySelector('.ph'), cm), lab: !!document.getElementById('cfT') };
          cm.querySelector('[data-cf=cancel]').click();
          const sel = document.getElementById('layoutSel'); sel.value = 'save'; sel.dispatchEvent(new Event('change'));
          await new Promise(r => setTimeout(r, 30));
          const wb = document.querySelector('#wsSave .ws-box'); out.ws = DG.band(wb.querySelector(':scope>h2'), wb);
          const q = wb.querySelector('.ws-q'), chip = wb.querySelector('.chip'); out.wsq = { gap: getComputedStyle(q).columnGap, rad: getComputedStyle(chip).borderTopLeftRadius };
          document.getElementById('wsSave').hidden = true;
          document.getElementById('insBtn').click(); await new Promise(r => setTimeout(r, 60));
          const ip = document.getElementById('insPop'); out.ins = ip && !ip.hidden ? { ...DG.band(ip.querySelector('.ins-h'), ip), x: !!ip.querySelector('.ins-x') } : null;
          if (ip && !ip.hidden) ip.querySelector('.ins-x').click();
          document.getElementById('sonMore').click(); await new Promise(r => setTimeout(r, 30));
          const sp = document.getElementById('sonPop'); out.son = DG.band(sp.querySelector(':scope>b'), sp);
          document.getElementById('sonMore').click();
          startTour(); await new Promise(r => setTimeout(r, 60));
          const tc = document.querySelector('.tour-card'); out.tour = { ...DG.band(tc.querySelector('.tour-top'), tc), lab: !!document.getElementById('tourT'), n: DG.norm(getComputedStyle(tc.querySelector('.tour-n')).color), acc: DG.tok('--acc') };
          tc.querySelector('[data-t=skip]').click();
          return out;
        });
        for (const k of ['help', 'cf', 'ws', 'ins', 'son', 'tour']) {
          const b = r[k];
          t.ok(b, `${th} ${k}: overlay opened`);
          t.eq(b.bg, r.tokBand, `${th} ${k}: band background = --band`);
          t.eq(b.bb, '1px', `${th} ${k}: band has a bottom hairline`);
          t.ok(Math.abs(b.dt) <= 1 && Math.abs(b.dl) <= 1 && Math.abs(b.dr) <= 1, `${th} ${k}: band flush with the box edges: ${JSON.stringify(b)}`);
        }
        t.eq(r.help.h2.col, r.tx, `${th}: Help title in --tx`); t.eq(r.help.h2.fw, '700', `${th}: Help title bold`);
        t.ok(r.help.h3fs <= r.help.h2.fs, `${th}: section headings no larger than the title (${r.help.h3fs} vs ${r.help.h2.fs})`);
        t.ok(r.help.close && r.cf.lab && r.tour.lab && r.ins.x, `${th}: close buttons and aria-labelledby targets kept`);
        t.ok(r.heads.same, `${th}: Settings (h3) and Display (h4) share one heading style`);
        t.ok(r.margin && r.margin.fs === '11px' && r.margin.col === r.margin.tx3, `${th}: #marginNote styled fs-xs --tx3: ${JSON.stringify(r.margin)}`);
        t.ok(r.tour.n !== r.tour.acc, `${th}: tour step counter not amber`);
        t.eq(r.wsq.gap, '1px', `${th}: Save layout quick names as a flush strip`); t.ok(parseFloat(r.wsq.rad) <= 2, `${th}: quick names square`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSG2 primary buttons neutral (never amber): tour, Save layout, Confirm, level editor, replay launcher; sell confirmation stays --sell; Reset on --bad; toasts',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1680, height: 1000 });
      await ready(page);
      await page.evaluate(HELP);
      for (const [th, pa] of [['dark', 'std'], ['light', 'std'], ['dark', 'cvd']]) {
        await look(page, th, pa);
        const r = await page.evaluate(async () => {
          const out = { tx: DG.tok('--tx'), s1: DG.tok('--s1'), acc: DG.tok('--acc'), sell: DG.tok('--sell'), bad: DG.tok('--bad'), tx3: DG.tok('--tx3') };
          out.helpTour = DG.btn(document.querySelector('#help .help-tour .tour-next'));
          startTour(); await new Promise(r => setTimeout(r, 40)); out.tourNext = DG.btn(document.querySelector('.tour-card .tour-next')); document.querySelector('.tour-card [data-t=skip]').click();
          const sel = document.getElementById('layoutSel'); sel.value = 'save'; sel.dispatchEvent(new Event('change')); await new Promise(r => setTimeout(r, 30));
          out.wsSave = DG.btn(document.querySelector('#wsSave .primary')); document.getElementById('wsSave').hidden = true;
          askConfirm({ title: 'T', body: 'B', ok: 'OK', onOk: () => {} }); await new Promise(r => setTimeout(r, 30));
          out.cf = DG.btn(document.querySelector('.cf-modal [data-cf=ok]')); document.querySelector('.cf-modal [data-cf=cancel]').click();
          askConfirm({ title: 'T', body: 'B', ok: 'Sell', kind: 'sell', onOk: () => {} }); await new Promise(r => setTimeout(r, 30));
          out.cfSell = DG.btn(document.querySelector('.cf-modal [data-cf=ok]')); document.querySelector('.cf-modal [data-cf=cancel]').click();
          editLevel({ kind: 'hline', ref: 0, sym: S.set.sym }, document.body); await new Promise(r => setTimeout(r, 30));
          const set = document.querySelector('.lv-pop [data-a=set]'); out.lv = set && !set.disabled ? DG.btn(set) : null; const x = document.querySelector('.lv-pop [data-a=x]'); if (x) x.click();
          RP.launcher(); await new Promise(r => setTimeout(r, 40));
          const dlg = document.getElementById('rpDlg'); out.rpGo = DG.btn(dlg.querySelector('#rpGo'));
          out.rpBand = DG.band(dlg.querySelector('.modal>.ph'), dlg.querySelector('.modal')); out.band = DG.tok('--band');
          out.rpSeg = [...dlg.querySelectorAll('.mini-seg[role=radiogroup]>button')].map(b => Math.round(b.getBoundingClientRect().width));
          dlg.hidden = true;
          const rs = getComputedStyle(document.getElementById('resetAcct')); out.reset = DG.norm(rs.color);
          toast('Plain', 'A sentence of prose'); await new Promise(r => setTimeout(r, 30));
          const ts = [...document.querySelectorAll('#toasts .toast')].pop(); out.toast = { stripe: DG.norm(getComputedStyle(ts).borderLeftColor), span: getComputedStyle(ts.querySelector('span')).fontFamily };
          return out;
        });
        const tag = `${th}/${pa}`;
        // the primary buttons, the confirm dialog's neutral OK (cf, a .cta) included (ui-controls §3.7)
        for (const k of ['helpTour', 'tourNext', 'wsSave', 'cf', 'lv', 'rpGo']) {
          t.ok(r[k], `${tag} ${k}: button present`);
          t.eq(r[k].bg, r.acc, `${tag} ${k}: primary is solid accent (accent contract)`);
          t.ok(r[k].col !== r.acc, `${tag} ${k}: primary text is the ink on the solid accent`);
        }
        t.eq(r.cfSell.bg, r.sell, `${tag}: a sell confirmation keeps --sell`);
        t.eq(r.reset, r.bad, `${tag}: Reset demo account on --bad`);
        t.eq(r.rpBand.bg, r.band, `${tag}: replay launcher title band`);
        t.ok(r.rpSeg.length === 2 && Math.abs(r.rpSeg[0] - r.rpSeg[1]) <= 1, `${tag}: launcher source strip fills its row: ${r.rpSeg}`);
        t.ok(r.toast.stripe !== r.acc && r.toast.stripe === r.tx3, `${tag}: a plain toast's stripe is neutral: ${r.toast.stripe}`);
        t.ok(!/JetBrains Mono/.test(r.toast.span), `${tag}: toast prose in the base font: ${r.toast.span}`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'DSG3 Specifications: flush grouped sheet (group heads, label cells on --s3, 1px row lines, rows grow), key-figure strip, sessions table fixed with borders and a --s2 head',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1280, height: 900 });
      await ready(page);
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        document.getElementById('insBtn').click(); await new Promise(r => setTimeout(r, 60));
        const ip = document.getElementById('insPop'), gs = [...ip.querySelectorAll('.ins-g')], g = gs[0], row = g.querySelector('div'), dt = row.querySelector('dt'), dd = row.querySelector('dd');
        const ss = ip.querySelector('.ins-sess'), th = ss.querySelector('thead th'), td = ss.querySelector('tbody td');
        const cp = getComputedStyle(ip), cr = getComputedStyle(row), cdt = getComputedStyle(dt), cdd = getComputedStyle(dd), cs = getComputedStyle(ss), cth = getComputedStyle(th), ctd = getComputedStyle(td);
        // between two groups only one line: the last row's bottom line plus the next group head's top line
        const seams = gs.map(x => { const n = x.nextElementSibling; return parseFloat(getComputedStyle(x.lastElementChild).borderBottomWidth) + (n ? parseFloat(getComputedStyle(n).borderTopWidth) : 0); });
        const heads = gs.map(x => x.previousElementSibling && x.previousElementSibling.classList.contains('ins-gh'));
        const kc = [...ip.querySelectorAll('.ins-k > div')], pr = ip.getBoundingClientRect();
        return {
          rows: gs.reduce((n, x) => n + x.querySelectorAll(':scope>div').length, 0), groups: gs.length, heads: heads.every(Boolean),
          popBorder: cp.borderTopWidth, popRad: cp.borderTopLeftRadius, rowBb: cr.borderBottomWidth, sep: [cdt.borderRightWidth, cdd.borderLeftWidth], dtBg: DG.norm(cdt.backgroundColor), s3: DG.tok('--s3'), s2: DG.tok('--s2'),
          ddWrap: cdd.overflowWrap, ddH: cdd.height !== '0px', seams,
          keys: kc.length, keysFit: kc.every(k => { const b = k.querySelector('b'), br = b.getBoundingClientRect(), kr = k.getBoundingClientRect(); return b.scrollWidth <= b.clientWidth + 1 && br.right <= kr.right + 0.5 && br.left >= kr.left - 0.5; }),
          sessHead: ss.previousElementSibling && ss.previousElementSibling.classList.contains('ins-gh'),
          layout: cs.tableLayout, thBg: DG.norm(cth.backgroundColor), thTt: cth.textTransform, tdBr: ctd.borderRightWidth, tdBb: ctd.borderBottomWidth,
          fits: ss.scrollWidth <= ss.clientWidth + 1, inCard: ss.getBoundingClientRect().right <= pr.right + 1
        };
      });
      t.ok(r.rows >= 15, 'every specification row still there: ' + r.rows);
      t.ok(r.groups >= 3 && r.heads, 'rows grouped, each group under a head: ' + r.groups);
      t.eq(r.popBorder, '1px', 'card border frames the sheet'); t.eq(r.popRad, '0px', 'card square');
      t.eq(r.rowBb, '1px', 'row separators'); t.ok(r.seams.every(x => x <= 1), 'no double line between groups: ' + r.seams);
      t.ok(r.sep.includes('1px'), 'label | value separator: ' + r.sep); t.eq(r.dtBg, r.s3, 'label cells on --s3');
      t.eq(r.ddWrap, 'anywhere', 'long values wrap'); t.ok(r.ddH, 'rows have height auto');
      t.ok(r.keys >= 6 && r.keysFit, 'key-figure strip: every figure whole (' + r.keys + ')');
      t.ok(r.sessHead, 'sessions table under a group head');
      t.eq(r.layout, 'fixed', 'sessions table fixed'); t.eq(r.thBg, r.s2, 'sessions head on --s2'); t.eq(r.thTt, 'uppercase', 'head labels uppercase');
      t.eq(r.tdBr, '1px', 'cell column borders'); t.eq(r.tdBb, '1px', 'cell row borders'); t.ok(r.fits && r.inCard, 'sessions table fits its card');
      t.noErrors(page);
    }
  },
  {
    name: 'DSG4 phone 390: Help & settings tile opens Help with every control reachable; sound settings reachable; toasts under the header; 32px targets; chart tables fit',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      await ready(page);
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        const out = {};
        mnavGo('tools'); await new Promise(r => setTimeout(r, 120));
        const tile = document.querySelector('.mtools-grid button[data-mt=help]'); out.tile = tile && { vis: tile.offsetParent !== null, txt: tile.textContent };
        tile.click(); await new Promise(r => setTimeout(r, 60));
        const help = document.getElementById('help'), m = help.querySelector('.modal'); out.open = !help.hidden;
        // demo history left the app (spec 2026-11-02 §Conturi demo): its two buttons are no longer in Help
        const ids = ['exportBtn', 'importBtn', 'resetAcct', 'oneClickSet', 'jurSel', 'paletteSet', 'updnSet', 'candleSet', 'persistNote', 'marginNote', 'simLabel', 'chartLicence'];
        out.reach = ids.map(id => {
          const e = document.getElementById(id); if (!e) return [id, 'missing'];
          e.scrollIntoView({ block: 'center' }); const r = e.getBoundingClientRect(), mr = m.getBoundingClientRect();
          const ok = e.getClientRects().length > 0 && r.left >= mr.left - 1 && r.right <= mr.right + 1 && r.right <= innerWidth && r.width > 0;
          return [id, ok];
        }).filter(x => x[1] !== true);
        out.mScroll = m.scrollWidth <= m.clientWidth + 1;
        help.hidden = true;
        // sound settings
        const sm = document.getElementById('sonMore'); out.son = { ...DG.rect(sm), vis: sm.offsetParent !== null };
        sm.click(); await new Promise(r => setTimeout(r, 40));
        const sp = document.getElementById('sonPop'); out.sonPop = { open: !sp.hidden, ...DG.rect(sp), ctrls: ['sonTicks', 'sonHeart', 'sonVol', 'sonSens'].every(id => { const r = document.getElementById(id).getBoundingClientRect(); return r.width > 0 && r.left >= 0 && r.right <= innerWidth; }) };
        sm.click();
        // toasts below the header
        toast('Phone', 'Under the header'); await new Promise(r => setTimeout(r, 40));
        const tb = document.querySelector('.topbar').getBoundingClientRect(), ts = document.getElementById('toasts').getBoundingClientRect(); out.toast = { top: Math.round(ts.top), header: Math.round(tb.bottom) };
        // touch targets
        T.reset(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true });
        mnavGo('portfolio'); setTab('positions'); renderPositions(); await new Promise(r => setTimeout(r, 120));
        const acts = [...document.querySelectorAll('#posBody tr:first-child .acts button')];
        out.acts = acts.map(b => { const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), Math.round(r.right)]; });
        out.posFit = document.documentElement.scrollWidth <= 390;
        mnavGo('chart'); await new Promise(r => setTimeout(r, 120));
        out.targets = ['acctMore', 'insBtn', 'favBtn'].map(id => { const r = document.getElementById(id).getBoundingClientRect(); return [id, Math.round(r.width), Math.round(r.height)]; });
        out.ins = getComputedStyle(document.getElementById('insBtn')).borderTopLeftRadius;
        // chart data tables (G13): no column off screen, Edit reachable
        const ch = document.getElementById('chart'), box = ch && ch._cvAlt;
        if (box) {
          box.hidden = false; a11yFigure(ch, chartFigure()); await new Promise(r => setTimeout(r, 60));
          const br = box.getBoundingClientRect();
          out.alt = { tables: [...box.querySelectorAll(':scope>table')].map(tb => ({ cols: tb.tHead.rows[0].cells.length, fit: tb.scrollWidth <= box.clientWidth + 1, last: tb.tHead.rows[0].lastElementChild.getBoundingClientRect().right <= br.right + 1, layout: getComputedStyle(tb).tableLayout })),
            edit: [...box.querySelectorAll('.cv-edit')].map(b => { const r = b.getBoundingClientRect(); return r.right <= br.right + 1 && r.height >= 32; }) };
          box.hidden = true;
        }
        return out;
      });
      t.ok(r.tile && r.tile.vis && /Help/.test(r.tile.txt), 'Tools has a visible Help & settings tile: ' + JSON.stringify(r.tile));
      t.ok(r.open, 'the tile opens Help');
      t.deep(r.reach, [], 'every Help control and note on screen inside the modal');
      t.ok(r.mScroll, 'Help has no sideways scroll on the phone');
      t.ok(r.son.vis && r.son.w >= 32 && r.son.h >= 32 && r.son.r <= 390, 'sound settings button visible, 32px: ' + JSON.stringify(r.son));
      t.ok(r.sonPop.open && r.sonPop.l >= 0 && r.sonPop.r <= 390 && r.sonPop.ctrls, 'sound settings inside the screen: ' + JSON.stringify(r.sonPop));
      t.ok(r.toast.top >= r.toast.header, `toasts start under the header (${r.toast.top} >= ${r.toast.header})`);
      t.ok(r.acts.length >= 4 && r.acts.every(([w, h, rr]) => w >= 32 && h >= 32 && rr <= 390), 'position actions 32px and on screen: ' + JSON.stringify(r.acts));
      t.ok(r.posFit, 'positions fit 390px');
      t.ok(r.targets.every(([, w, h]) => w >= 32 && h >= 32), 'phone targets at least 32px: ' + JSON.stringify(r.targets));
      t.ok(parseFloat(r.ins) <= 2, 'Specifications button square: ' + r.ins);
      t.ok(r.alt && r.alt.tables.length >= 1 && r.alt.tables.every(x => x.fit && x.last && x.layout === 'fixed' && x.cols >= 5), 'chart tables fit, every column kept: ' + JSON.stringify(r.alt && r.alt.tables));
      t.ok(r.alt.edit.every(Boolean), 'every Edit button on screen and 32px tall');
      t.noErrors(page);
    }
  },
  {
    name: 'DSG5 replay: phone bar wraps with Close on the first row and the scrubber full width; summary is a bordered table with Net P&L as the key figure; desktop bar one row',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.evaluate(o => RP.open(o), SPEC);
      const f = await replayFrame(page);
      const ph = await f.evaluate(async () => {
        const R = id => { const e = document.getElementById(id), r = e.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), vis: r.width > 0 && r.height > 0 } };
        const ids = ['rpTag', 'rpClose', 'rpBack', 'rpPlay', 'rpStep', 'rpJump', 'rpScrub', 'rpClock', 'rpSum'];
        const out = { vw: innerWidth, el: Object.fromEntries(ids.map(id => [id, R(id)])), speed: [...document.querySelectorAll('#rpBar [data-sp]')].map(b => { const r = b.getBoundingClientRect(); return r.right <= innerWidth && r.width >= 32; }) };
        const bar = document.getElementById('rpBar'); out.sw = bar.scrollWidth <= bar.clientWidth + 1;
        out.play = getComputedStyle(document.getElementById('rpPlay')).backgroundColor; out.acc = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
        const a = document.querySelector('.rp-acct'); out.acct = a && { col: getComputedStyle(a).gridColumnStart, vis: a.getBoundingClientRect().right <= innerWidth };
        document.getElementById('rpSum').click(); await new Promise(r => setTimeout(r, 40));
        const p = document.getElementById('rpSumPop'), tb = p.querySelector('table'), rows = [...tb.querySelectorAll('tr')];
        const pr = p.getBoundingClientRect(), h = p.querySelector('.rp-sum-h');
        out.sum = {
          open: !p.hidden, inside: pr.left >= 0 && pr.right <= innerWidth && pr.bottom <= innerHeight, cls: tb.className, rows: rows.map(r => [r.children[0].tagName, r.children[0].textContent, r.children.length]),
          tdBr: getComputedStyle(rows[0].children[0]).borderRightWidth, tdBb: getComputedStyle(rows[0].children[1]).borderBottomWidth, tbl: getComputedStyle(tb).borderTopWidth,
          key: { fs: getComputedStyle(rows[0].children[1]).fontSize, fw: getComputedStyle(rows[0].children[1]).fontWeight }, other: getComputedStyle(rows[1].children[1]).fontSize,
          band: h && getComputedStyle(h).borderBottomWidth, journal: !!p.querySelector('[data-go=journal]'), note: /separate from your main account/.test(p.textContent)
        };
        return out;
      });
      const e = ph.el;
      t.ok(Object.values(e).every(x => x.vis && x.l >= 0 && x.r <= ph.vw), 'every replay control on screen at 390: ' + JSON.stringify(e));
      t.ok(ph.speed.length === 5 && ph.speed.every(Boolean), 'all five speeds on screen and at least 32px');
      t.ok(ph.sw, 'the bar does not scroll sideways');
      t.ok(e.rpClose.t < e.rpPlay.t, 'Close sits on the first row, above the transport');
      t.ok(Math.abs(e.rpBack.t - e.rpPlay.t) <= 2 && Math.abs(e.rpStep.t - e.rpPlay.t) <= 2, 'transport buttons on one row');
      t.ok(e.rpScrub.t > e.rpPlay.t && e.rpScrub.w >= ph.vw - 20, 'scrubber below the transport, full width: ' + JSON.stringify(e.rpScrub));
      t.ok(e.rpJump.t > e.rpScrub.t, 'Jump below the scrubber');
      t.ok(ph.acct && ph.acct.col === '1' && ph.acct.vis, 'the replay account label spans the account grid: ' + JSON.stringify(ph.acct));
      t.ok(ph.play.includes('232, 176, 74'), 'Play is the primary: solid accent: ' + ph.play);
      const s = ph.sum;
      t.ok(s.open && s.inside, 'summary opens inside the screen');
      t.ok(/\btbl\b/.test(s.cls), 'summary is a .tbl table');
      t.deep(s.rows.map(x => [x[0], x[2]]), [['TH', 2], ['TH', 2], ['TH', 2], ['TH', 2]], 'four rows, label header + value');
      t.eq(s.rows[0][1], 'Net P&L', 'Net P&L first');
      t.ok(s.rows.some(x => /Largest drawdown/.test(x[1])) && s.rows.some(x => /Replay trades/.test(x[1])) && s.rows.some(x => /Open positions/.test(x[1])), 'every figure kept');
      t.eq(s.tdBr, '1px', 'column border'); t.eq(s.tdBb, '1px', 'row border'); t.eq(s.tbl, '1px', 'table border');
      t.eq(s.key.fw, '600', 'Net P&L key weight'); t.ok(parseFloat(s.key.fs) > parseFloat(s.other), `Net P&L larger than the rest (${s.key.fs} vs ${s.other})`);
      t.eq(s.band, '1px', 'summary title band'); t.ok(s.journal && s.note, 'Open Journal and the separate-account note kept');
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.waitForTimeout(120);
      const dk = await f.evaluate(() => { const bar = document.getElementById('rpBar'), ts = ['rpBack', 'rpPlay', 'rpScrub', 'rpClose'].map(id => Math.round(document.getElementById(id).getBoundingClientRect().top + document.getElementById(id).getBoundingClientRect().height / 2)); return { ws: getComputedStyle(bar).flexWrap, ts }; });
      t.eq(dk.ws, 'nowrap', 'desktop bar stays one row');
      t.ok(Math.max(...dk.ts) - Math.min(...dk.ts) <= 2, 'desktop controls on one line: ' + dk.ts);
      t.noErrors(page);
    }
  }
];
