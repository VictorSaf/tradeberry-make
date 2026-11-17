// Baskets: the honesty (P1) and UI (P3) items of the Observatory review (24.10.2026, section 9).
// The clock is pinned on a weekday (Fri 16.10 10:30 UTC, FX open) and the market is frozen (fills at the quote).
// A closed market is simulated where needed by stubbing marketWhy / mktState (both are called by global name).
const ready = async page => {
  await page.evaluate(() => loadLazy());
  await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof bkCfg === 'function', null, { timeout: 30000 });
  await page.evaluate(() => {
    T.reset(); S.bkPos = []; S.bkOrders = []; S.bkAlerts = []; S.bkHist = [];
    const c = bkCfg(); c.bkMode = 'risk'; c.bkRisk = .5; c.bkSl = 'auto'; c.bkTp = 'auto'; c.bkTrail = 0; c.bkBe = 0; c.bkEntry = 'market'; c.bkCmp = 'none'; c.bkAn = 'attr';
    // every toast and beep, whatever the toast layer keeps on screen (it shows at most 4)
    window.TL = []; window.BL = [];
    const ot = window.toast; window.toast = function (title, body, kind) { TL.push({ title, body: body || '' }); return ot.apply(this, arguments); };
    const ob = window.beep; window.beep = function (k) { BL.push(k); return ob.apply(this, arguments); };
  });
};
const show = async (page, sel = 'dxy', pane = 'tr') => page.evaluate(async ([sel, pane]) => {
  const c = bkCfg(); c.bkSel = sel; c.bkPane = pane; obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
  for (let k = 0; k < 40 && !(BK.series && document.querySelector('#bkChart')); k++) await new Promise(r => setTimeout(r, 50));
}, [sel, pane]);
const pane = 'document.querySelector(".bk-pn:not([hidden])").textContent.replace(/\\s+/g, " ")';

export const tests = [
  {
    name: 'BKU1 one summary toast per basket action: open, close, close pending, rollback (with its cause); no toast or beep per leg',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page);
      await page.evaluate(() => {
        const out = {}, b = bkGet('dxy'), c = bkCfg(), legRx = /^(Bought|Sold) \d|^Basket close: |^Market closed|^Order rejected|^Requote/;
        TL.length = 0; BL.length = 0;
        bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        out.open = { toasts: TL.map(x => x.title), leg: TL.filter(x => legRx.test(x.title)).length, fill: BL.filter(x => x === 'fill').length, n: S.positions.length };
        // the Close button of the open group
        obsDraw(); TL.length = 0; BL.length = 0;
        document.querySelector(`[data-bk-closeg="${S.bkPos[0].gid}"]`).click();
        out.close = { toasts: TL.map(x => x.title + ' | ' + x.body), leg: TL.filter(x => legRx.test(x.title)).length, beeps: BL.length, groups: S.bkPos.length };
        // close at a closed market: one "close pending" toast, no "Market closed" per leg, the Close button disabled.
        // Since v16 the close is gated inside the account core, which reads the market through Engine.quote: the market is
        // closed there (and in Engine.session for the labels); replacing window.marketWhy / mktState no longer closes anything
        bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        window.__bk = { out, gid: S.bkPos[0].gid };
        return null;
      });
      await page.evaluate(() => {
        const { out } = window.__bk, g = S.bkPos.find(x => x.gid === window.__bk.gid);
        const q0 = Engine.quote, s0 = Engine.session;
        Engine.quote = sym => { const q = q0(sym); return q ? { ...q, open: false, why: 'closed' } : q; };
        Engine.session = sym => ({ ...(s0(sym) || {}), open: false });
        window.__bk.restore = () => { Engine.quote = q0; Engine.session = s0; };
        out.pendOpen = mktState('EURUSD').open; const legRx = /^(Bought|Sold) \d|^Basket close: |^Market closed|^Order rejected|^Requote/;
        TL.length = 0; BL.length = 0;
        bkCloseGroup(g.gid); obsDraw();
        const btn = document.querySelector(`[data-bk-closeg="${g.gid}"]`);
        out.pend = { toasts: TL.map(x => x.title + ' | ' + x.body), leg: TL.filter(x => legRx.test(x.title)).length, beeps: BL.filter(x => x === 'err').length, disabled: btn && btn.disabled, closing: !!g.closing };
        bkTick(); const bt = document.querySelector(`[data-bk-closeg="${g.gid}"]`); out.pend.disabledTick = !!bt && bt.disabled;
      });
      const r = await page.evaluate(() => {
        const { out } = window.__bk, g = S.bkPos.find(x => x.gid === window.__bk.gid) || { gid: window.__bk.gid }, b = bkGet('dxy'), c = bkCfg(), legRx = /^(Bought|Sold) \d|^Basket close: |^Market closed|^Order rejected|^Requote/;
        window.__bk.restore(); obsDraw();
        const eb = document.querySelector(`[data-bk-closeg="${g.gid}"]`); out.pend.enabledOpen = !!eb && !eb.disabled;
        BK.retry = {}; TL.length = 0; bkMonitor();
        out.retry = { toasts: TL.map(x => x.title + ' | ' + x.body), groups: S.bkPos.length };
        // rollback: the third leg's disaster stop lands inside its spread
        const op = window.openPosition; let k = 0;
        window.openPosition = function (o) { if (o.bgid && ++k === 3) o = { ...o, slPips: .01 }; return op(o); };
        TL.length = 0; BL.length = 0;
        bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        window.openPosition = op;
        out.roll = { toasts: TL.map(x => x.title + ' | ' + x.body), leg: TL.filter(x => legRx.test(x.title)).length, err: BL.filter(x => x === 'err').length, pos: S.positions.length };
        return out;
      });
      t.ok(r.open.n >= 4, 'legs open: ' + r.open.n);
      t.eq(r.open.leg, 0, 'open: no toast per leg (' + r.open.toasts.join(' / ') + ')');
      t.eq(r.open.toasts.length, 1, 'open: one toast');
      t.ok(r.open.fill <= 1, 'open: at most one fill beep, not one per leg: ' + r.open.fill);
      t.eq(r.close.groups, 0, 'close: the group is closed');
      t.eq(r.close.leg, 0, 'close: no toast per leg (' + r.close.toasts.join(' / ') + ')');
      t.eq(r.close.toasts.length, 1, 'close: one summary toast');
      t.ok(/closed/i.test(r.close.toasts[0]) && /\$/.test(r.close.toasts[0]), 'close toast names the result: ' + r.close.toasts[0]);
      t.ok(r.close.beeps <= 1, 'close: at most one beep: ' + r.close.beeps);
      t.eq(r.pendOpen, false, 'the market is closed for the close-pending step');
      t.ok(r.pend.closing, 'closed market: the group is close pending');
      t.eq(r.pend.leg, 0, 'closed market: no "Market closed" toast per leg (' + r.pend.toasts.join(' / ') + ')');
      t.eq(r.pend.toasts.length, 1, 'closed market: one "close pending" toast');
      t.ok(/close pending/i.test(r.pend.toasts[0]) && /closed/i.test(r.pend.toasts[0]), 'it says why: ' + r.pend.toasts[0]);
      t.ok(r.pend.beeps <= 1, 'closed market: at most one error beep: ' + r.pend.beeps);
      t.ok(r.pend.disabled && r.pend.disabledTick, 'Close disabled while the group is close pending on a closed market');
      t.ok(r.pend.enabledOpen, 'enabled again once the market quotes');
      t.eq(r.retry.groups, 0, 'the retry closes the group');
      t.eq(r.retry.toasts.length, 1, 'retry: one summary toast: ' + r.retry.toasts.join(' / '));
      t.eq(r.roll.pos, 0, 'rollback: nothing left open');
      t.eq(r.roll.leg, 0, 'rollback: no toast per leg (' + r.roll.toasts.join(' / ') + ')');
      t.eq(r.roll.toasts.length, 1, 'rollback: one toast');
      t.ok(/Not opened/.test(r.roll.toasts[0]) && /disaster stop/i.test(r.roll.toasts[0]) && /spread/i.test(r.roll.toasts[0]), 'rollback toast says the cause: ' + r.roll.toasts[0]);
      t.noErrors(page);
    }
  },
  {
    name: 'BKU2 "Overlaps most": ρ > 0.7 same bet, ρ < −0.7 a hedge / the opposite bet, in between neither',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => ({ pos: bkOverlapTxt(.85), neg: bkOverlapTxt(-.85), mid: bkOverlapTxt(-.67), mid2: bkOverlapTxt(.5) }));
      t.ok(/same bet/.test(r.pos), 'ρ 0.85: ' + r.pos);
      t.ok(!/same bet/.test(r.neg) && /hedge|opposite/i.test(r.neg), 'ρ −0.85: ' + r.neg);
      t.ok(!/same bet|hedge|opposite/i.test(r.mid) && !/same bet|hedge|opposite/i.test(r.mid2), 'ρ −0.67 / 0.5: no verdict: ' + r.mid + ' / ' + r.mid2);
      t.noErrors(page);
    }
  },
  {
    name: 'BKU3 proxy sized on β (same exposure); the button carries size and stop to the ticket',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page, 'dxy', 'an');
      const r = await page.evaluate(() => {
        const b = bkGet('dxy'), c = bkCfg(), sz = bkSize(b, c, bkVol(b)), p = bkProxy(b, sz), m = M(p.sym);
        const txt = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        const btn = document.querySelector('[data-bk-proxy]');
        const want = { lots: normLots(p.sym, Math.abs(p.beta) * sz.lots / Engine.usd(m.base)), slBp: sz.sl / Math.abs(p.beta) };
        btn && btn.click();
        return { p, sz: { lots: sz.lots, sl: sz.sl }, want, txt, btn: !!btn, tk: { lots: S.tk.lots, sl: S.tk.sl, sm: S.tk.sm, useSL: S.tk.useSL, side: S.tk.side, sym: S.set.sym }, slPx: p.slPips * m.pip / Engine.mid(p.sym) * 1e4 };
      });
      t.ok(Math.abs(r.p.beta) > 0 && Math.abs(r.p.beta) < 2, 'β computed: ' + r.p.beta);
      t.near(r.p.lots, r.want.lots, 'proxy lots = |β| × basket notional in the pair base', 1e-9, .011);
      t.ok(Math.abs(r.p.lots - r.sz.lots) > .005 || Math.abs(Math.abs(r.p.beta) - 1) < .01, `not the basket size unless β ≈ 1 (${r.p.lots} vs ${r.sz.lots})`);
      t.near(r.slPx, r.want.slBp, 'proxy stop = basket stop / |β| (same dollar risk)', .02, .5);
      t.ok(/β/.test(r.txt) && /same exposure/i.test(r.txt), 'the text says the size is β-adjusted: ' + r.txt.slice(0, 600));
      t.ok(r.btn, 'proxy button shown');
      t.eq(r.tk.sym, r.p.sym, 'ticket on the proxy'); t.eq(r.tk.side, r.p.side, 'side');
      t.eq(r.tk.sm, 'lots', 'ticket in lots'); t.near(r.tk.lots, r.p.lots, 'ticket size = proxy lots', 1e-9, 1e-9);
      t.ok(r.tk.useSL && Math.abs(r.tk.sl - r.p.slPips) <= .1 + 1e-9, `ticket stop = proxy stop (${r.tk.sl} vs ${r.p.slPips})`);
      t.noErrors(page);
    }
  },
  {
    name: 'BKU4 ticket: levels in bp from now first (absolute level second, with the base date); legend only when the lines show; notional red against the sheet leverage; honest execution text',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page);
      const r = await page.evaluate(() => {
        const out = {}, c = bkCfg(), b = bkGet('dxy'), sz = bkSize(b, c, bkVol(b));
        out.sl = sz.sl; out.tp = sz.tp;
        out.lv = document.querySelector('.bk-lv').textContent.replace(/\s+/g, ' ');
        out.legend0 = document.querySelector('.bk-cleg').textContent;
        const nb = () => document.querySelector('.bk-sum b[data-tip^="Notional"]') || [...document.querySelectorAll('.bk-sum b')][0];
        out.n0 = { cls: nb().className, txt: nb().textContent, tip: nb().getAttribute('data-tip') };
        out.txt = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        out.maxLev = Math.min(...bkLegs(b, 1).map(l => effLev(l.sym)));
        // lots mode at 60% of the sheet's leverage
        c.bkMode = 'lots'; c.bkLots = Math.round(account().eq * out.maxLev * .6 / 1e5 * 10) / 10; obsDraw();
        out.n1 = { cls: nb().className, txt: nb().textContent };
        c.bkMode = 'risk'; obsDraw();
        // a group open on this basket: the ticket preview lines are not drawn, so neither is their legend
        bkExec(b, 'buy', sz, null, []); obsDraw();
        out.legend1 = document.querySelector('.bk-cleg').textContent;
        return out;
      });
      t.ok(new RegExp(`stop\\s*−${r.sl} bp`).test(r.lv) && new RegExp(`target\\s*\\+${r.tp} bp`).test(r.lv), 'levels in bp first: ' + r.lv);
      t.ok(/\d+\.\d{3}/.test(r.lv) && /100 = \d\d-\d\d/.test(r.lv), 'absolute level second, with the base date: ' + r.lv);
      t.ok(r.lv.indexOf(' bp') < r.lv.search(/\d+\.\d{3}/), 'bp before the absolute level');
      t.ok(/stop and target of the ticket/.test(r.legend0), 'legend shown with the preview lines');
      t.ok(!/stop and target of the ticket/.test(r.legend1), 'legend hidden when the preview lines are not drawn: ' + r.legend1);
      t.ok(!/\bdn\b/.test(r.n0.cls), 'default 0.5% risk: notional not red (' + r.n0.txt + ')');
      t.ok(!/\.\d\d\b/.test(r.n0.txt.split('·')[0]), 'notional without cents: ' + r.n0.txt);
      t.ok(/leverage/i.test(r.n0.tip) && new RegExp(`${r.maxLev}`).test(r.n0.tip), 'tooltip names the sheet leverage: ' + r.n0.tip);
      t.ok(/\bdn\b/.test(r.n1.cls), 'above half the sheet leverage: red (' + r.n1.txt + ')');
      t.ok(/only while this tab is open/i.test(r.txt), 'the basket stop lives in this tab: ' + r.txt.slice(0, 900));
      t.ok(/slippage/i.test(r.txt) && /one by one|separately/i.test(r.txt), 'multi-leg execution risks stated');
      t.ok(/Size × \$100k/.test(r.txt) || /× \$100k notional/.test(r.txt) || /Leg lots/.test(r.txt), 'basket size and leg lots labelled apart');
      t.noErrors(page);
    }
  },
  {
    name: 'BKU5 stretch with a random-walk reference (same rule on shuffled moves, < 200 ms); By hour shows n and no direction colour',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page, 'dxy', 'an');
      const r = await page.evaluate(() => {
        const c = bkCfg(), b = bkGet('dxy'), out = {};
        c.bkTf = 5; const t0 = performance.now(); const h = bkStretchHtml(b, c); out.ms = performance.now() - t0;
        const d = document.createElement('div'); d.innerHTML = h; out.txt = d.textContent.replace(/\s+/g, ' ');
        out.same = bkStretchHtml(b, c) === h;
        c.bkTf = 15; c.bkAn = 'sess'; obsDraw();
        const bars = [...document.querySelectorAll('.bk-sess > div')];
        out.dir = bars.filter(x => x.classList.contains('up') || x.classList.contains('dn')).length;
        out.tips = bars.map(x => x.getAttribute('data-tip') || x.title || '');
        out.sess = document.querySelector('#bkAn').textContent.replace(/\s+/g, ' ');
        return out;
      });
      t.ok(r.ms < 200, `stretch draws in ${r.ms.toFixed(0)} ms`);
      t.ok(/random walk/i.test(r.txt) && /\d+%/.test(r.txt), 'random-walk reference shown: ' + r.txt);
      t.ok(r.same, 'the reference is stable between redraws (seeded shuffle)');
      t.eq(r.dir, 0, 'By hour: no up/down colour on the bars');
      t.ok(r.tips.every(x => !x || /n = \d+/.test(x)), 'each hour names its n: ' + r.tips[10]);
      t.ok(/n = \d+|samples/i.test(r.sess), 'the caption says how few samples: ' + r.sess);
      t.ok(!/average direction/i.test(r.sess), 'no "colour = average direction"');
      t.noErrors(page);
    }
  },
  {
    name: 'BKU6 basket record: false closes from before the fix are marked excluded and left out of Win rate / Edge ratio',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page);
      const r = await page.evaluate(() => {
        const row = (o) => ({ gid: 'x' + Math.random(), name: 'Dollar index (DXY-style)', side: 'buy', t0: 0, t1: 1, mfe: 10, mae: -5, sl: 20, risk: 100, reason: 'Basket stop', ...o });
        S.bkHist = [row({ pnl: -304, mv: -13349, mfe: 0, mae: -13349 }), row({ pnl: 0, reason: 'Basket close', mv: 0 }), row({ pnl: 50, mv: 12, mfe: 15, mae: -4 }), row({ pnl: -40, mv: -21, mfe: 3, mae: -21 })];
        obsDraw();
        const box = [...document.querySelectorAll('.bk-pn:not([hidden]) .ins')].find(x => /Basket record/.test(x.textContent));
        const kp = [...box.querySelectorAll('.kpi')].map(x => x.textContent.replace(/\s+/g, ' '));
        return { lab: box.querySelector('label').textContent, kp, txt: box.textContent.replace(/\s+/g, ' '), ex: box.querySelectorAll('.bk-h.ex').length };
      });
      t.eq(r.ex, 2, 'two rows marked');
      t.ok(/excluded: recorded before the 24\.10 fix/.test(r.txt), 'with the reason');
      const wr = r.kp.find(x => /Win rate/.test(x)) || '';
      t.ok(/50%/.test(wr), 'win rate on the 2 valid rows (1 of 2): ' + wr);
      const er = r.kp.find(x => /Edge ratio/.test(x)) || '';
      t.ok(/0\.72/.test(er), 'edge ratio on the valid rows ((15+3)/2 ÷ (4+21)/2 = 0.72): ' + er);
      t.noErrors(page);
    }
  },
  {
    name: 'BKU7 layout: side column 360–400 px at ≥1400 and no overflow at 1280/1700; stacked under the chart at ≤900 (375/768/900); comparisons on their own scale; heatmap headers whole; volatility in bp',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      // the workspace shell (Research holds the Observatory) wraps setTab once it is up: measure only then
      await page.waitForFunction(() => typeof window.setView === 'function' && typeof window.currentView === 'function', null, { timeout: 15000 });
      const out = {};
      for (const w of [375, 768, 900, 1280, 1700]) {
        await page.setViewportSize({ width: w, height: 950 });
        // the shell reacts to the resize (it may switch the view on tablets): let it settle, then open Research
        await page.evaluate(() => new Promise(r => setTimeout(r, 300)));
        await page.evaluate(() => setView('research'));
        await show(page, 'bloc', 'tr');
        await page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
        out[w] = await page.evaluate(() => {
          const side = document.querySelector('.bk .obs-side'), sum = document.querySelector('.bk-sum');
          const over = [...side.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'auto' && getComputedStyle(e).overflowX !== 'hidden' && e.clientWidth > 0).map(e => e.className || e.tagName);
          const b = [...sum.querySelectorAll('b')].filter(x => x.scrollWidth > x.clientWidth + 1).length;
          return { cols: getComputedStyle(document.querySelector('.bk>.obs-split')).gridTemplateColumns.split(' ').length, main: document.querySelector('.bk-main').getBoundingClientRect().width, side: side.getBoundingClientRect().width, sideOver: side.scrollWidth - side.clientWidth, sumCut: b, over: over.slice(0, 5), chart: document.querySelector('#bkChart').getBoundingClientRect().width };
        });
      }
      t.ok(out[1700].side >= 360 && out[1700].side <= 400, 'side column at 1700: ' + out[1700].side);
      for (const w of [1280, 1700]) {
        t.ok(out[w].sideOver <= 0, `${w}: no horizontal overflow in the side column (${out[w].sideOver})`);
        t.eq(out[w].sumCut, 0, `${w}: no cut value in the summary`);
      }
      for (const w of [375, 768, 900]) {
        t.eq(out[w].cols, 1, `${w}: one grid column (side under the chart)`);
        t.ok(out[w].chart >= w - 60 && out[w].main >= w - 60, `${w}: chart and main column use the width ${JSON.stringify(out[w])}`);
      }
      t.eq(out[1280].cols, 2, '1280: two grid columns');
      t.ok(out[1280].chart >= 400, 'chart at 1280 is at least 400 px wide: ' + out[1280].chart);
      const r = await page.evaluate(async () => {
        const c = bkCfg(); c.bkCmp = 'ccy'; c.bkAn = 'corr'; c.bkPane = 'an'; obsDraw();
        for (let k = 0; k < 20 && !BK.cmp.length; k++) await new Promise(r => setTimeout(r, 50));
        const scales = BK.cmp.map(s => s.options().priceScaleId);
        const heads = [...document.querySelectorAll('.bk-corr .h')].map(x => ({ t: x.textContent, tip: x.getAttribute('data-tip') || x.title || '' }));
        const an = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        return { scales, heads, an, main: BK.series.options().priceScaleId || 'right' };
      });
      t.ok(r.scales.length === 8 && r.scales.every(s => s && s !== r.main), 'comparison lines on their own scale: ' + r.scales.join());
      const bloc = r.heads.find(x => /Commodity bloc/.test(x.tip));
      t.ok(bloc && !/Commodit$/.test(bloc.t), 'heatmap header not truncated: ' + (bloc && bloc.t));
      t.ok(r.heads.every(x => x.tip), 'every header has the full name as a tooltip');
      t.ok(/Daily volatility\s*\d+ bp/.test(r.an) && !/Daily volatility\s*[\d.]+%/.test(r.an), 'volatility in bp in Analyse too: ' + (r.an.match(/Daily volatility[^.]*/) || [''])[0]);
      await page.setViewportSize({ width: 1280, height: 800 });
      t.noErrors(page);
    }
  },
  {
    name: 'BKU8 single positions keep their own toast and beep; a basket leg closed by hand still says so',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        TL.length = 0; BL.length = 0;
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, pmDone: true });
        const one = { toasts: TL.map(x => x.title), fill: BL.filter(x => x === 'fill').length };
        TL.length = 0; BL.length = 0; closePosition(p.id, 'Manual');
        const shut = { toasts: TL.map(x => x.title), beeps: BL.length };
        const b = bkGet('dxy'); bkExec(b, 'buy', bkSize(b, bkCfg(), bkVol(b)), null, []);
        const leg = S.positions.find(x => x.bgid);
        TL.length = 0; closePosition(leg.id, 'Manual');
        return { one, shut, leg: TL.map(x => x.title) };
      });
      t.ok(r.one.toasts.some(x => /^Bought 0\.10 EUR\/USD/.test(x)) && r.one.fill === 1, 'a single position: its toast and beep: ' + r.one.toasts);
      t.ok(r.shut.toasts.some(x => /^Manual: EUR\/USD/.test(x)) && r.shut.beeps === 1, 'its close: toast and beep: ' + r.shut.toasts);
      t.ok(r.leg.some(x => /^Manual: /.test(x)), 'a leg closed by hand: its own toast: ' + r.leg);
      t.noErrors(page);
    }
  },
  {
    name: 'BKU9 closed market (Saturday, pinned clock): both panes draw, market buttons off, a basket order says it once',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-17T12:00:00Z') }); // a Saturday: FX closed whatever day the suite runs
      await ready(page);
      await show(page, 'riskon', 'an');
      const r = await page.evaluate(() => {
        const an = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        bkCfg().bkPane = 'tr'; obsDraw();
        const tr = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' '), btns = [...document.querySelectorAll('[data-bk-trade]')].map(x => x.disabled);
        TL.length = 0; BL.length = 0; const b = bkGet('riskon'); bkExec(b, 'buy', bkSize(b, bkCfg(), bkVol(b)), null, []);
        return { open: mktState('EURUSD').open, an, tr, btns, toasts: TL.map(x => x.title), beeps: BL.length };
      });
      t.ok(!r.open, 'FX closed on the real clock');
      t.ok(/Daily volatility \d+ bp/.test(r.an) && /random walk/i.test(r.an), 'Analyse draws: ' + r.an.slice(0, 200));
      t.ok(/bp/.test(r.tr) && /Leg lots/.test(r.tr), 'Trade draws');
      t.deep(r.btns, [true, true], 'market buttons off');
      t.eq(r.toasts.length, 1, 'one toast: ' + r.toasts.join(' / '));
      t.noErrors(page);
    }
  }
];
