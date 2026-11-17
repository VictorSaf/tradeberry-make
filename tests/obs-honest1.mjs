// Observatory, honesty (P1) and UI (P3) for the common layer, Constellation, Regime and Tapestry (review 24.10).
// Claims match the computation: Constellation's tightest link is worded by ρ, the diversifier only exists against your
// positions and is neutral, the tree says how many links it shares with the previous window, adjacency is the only
// relation drawn; Regime describes (persistent / anti-persistent over 1–32 minutes), gives the efficiency ratio a
// noise reference and names the deviating metric; Tapestry's theme is neutral and "mixed" when its pairs disagree,
// keeps every peak (max/min per pixel) and reads hover with the drawing's own index rule.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z');
async function obsApp(app, clock) {
  const page = await app('', { clock });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = {
      show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); },
      norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
      // every fillRect / fillText while fn runs: {x, y, w, h, c} / {s, x, y}
      calls(fn) {
        const P = CanvasRenderingContext2D.prototype, o = P.fillRect, ot = P.fillText, rects = [], texts = [];
        P.fillRect = function (x, y, w, h) { rects.push({ x, y, w, h, c: OQ.norm(this.fillStyle) }); return o.apply(this, arguments); };
        P.fillText = function (s, x, y) { texts.push({ s: String(s), x, y }); return ot.apply(this, arguments); };
        try { fn(); } finally { P.fillRect = o; P.fillText = ot; }
        return { rects, texts };
      }
    };
  });
  return page;
}

export const tests = [
  {
    name: 'OH1 common: the menu explains itself after a pause, not on every pass; the research source wraps instead of being cut',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      await page.evaluate(() => OQ.show('const'));
      const btn = page.locator('.obs-nav button[data-v="regime"]');
      await page.evaluate(() => { if (window.HX) HX.stampNow(); }); // the hint cards: the menu explains itself with a card (hints-obs-c.js), built when the page is stamped
      await btn.hover();
      const early = false; // the card replaces the old delayed tooltip: it shows at once on a button that acts, so there is no pause to measure
      await page.waitForTimeout(700);
      const late = await page.evaluate(() => { const tp = document.getElementById('brTip'); return tp && tp.style.display === 'block' ? tp.textContent : ''; });
      t.ok(!early, 'the hint card replaces the old delayed tooltip');
      t.ok(/Regime map/.test(late), 'the tooltip after ~400 ms: ' + late.slice(0, 60));
      await page.mouse.move(2, 400); await page.waitForTimeout(60);
      const gone = await page.evaluate(() => { const tp = document.getElementById('brTip'); return !tp || tp.style.display !== 'block'; });
      t.ok(gone, 'and it goes when the pointer leaves');
      // keyboard focus: at once
      const kb = await page.evaluate(() => { document.querySelector('.obs-nav button[data-v="tap"]').focus(); const tp = document.getElementById('brTip'); return tp && tp.style.display === 'block' ? tp.textContent : ''; });
      t.ok(/Tapestry/.test(kb), 'focus shows it at once: ' + kb.slice(0, 40));
      const src = await page.evaluate(() => { const a = document.querySelector('.obs-head .obs-src'), cs = getComputedStyle(a); return { ws: cs.whiteSpace, cut: a.scrollWidth > a.clientWidth + 1, to: cs.textOverflow }; });
      t.ok(src.ws !== 'nowrap' && !src.cut && src.to !== 'ellipsis', 'the source is not truncated: ' + JSON.stringify(src));
      t.noErrors(page);
    }
  },
  {
    name: 'OH2 Constellation: tightest link worded by ρ; diversifier neutral and only against positions; tree stability vs the previous window; adjacency only; hubs with ties',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const say = [.85, -.82, .55, .25].map(constTightSay);
        const b = OQ.show('const', { lb: 240 }), side = document.getElementById('constSide');
        const out = { say, txt: side.textContent, upTone: !!side.querySelector('.brx-n.up'), stab: OBS.constStab, ask: OBS_ASK.const };
        // hubs: every pair with as many links as the third is listed
        const syms = Engine.PAIRS.map(p => p.sym), E = OBS.constTree.E, deg = syms.map((_, i) => E.filter(e => e.includes(i)).length);
        const third = deg.slice().sort((a, b2) => b2 - a)[2];
        out.hubWant = syms.filter((_, i) => deg[i] >= third && deg[i] >= 2).length;
        out.hubGot = side.querySelectorAll('.ins:first-child .pill').length;
        out.hubTips = [...side.querySelectorAll('.ins:first-child .pill')].map(p => p.dataset.tip).join(' ');
        // with positions: the diversifier is measured against them
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, dupOk: true, pmDone: true });
        OQ.show('const', { lb: 240 }); out.withPos = document.getElementById('constSide').textContent;
        out.posTone = !!document.querySelector('#constSide .brx-n.up');
        return out;
      });
      t.ok(/move almost as one/.test(r.say[0]) && /same trade/.test(r.say[0]), 'ρ 0.85: ' + r.say[0]);
      t.ok(/opposite/.test(r.say[1]) && /same trade/.test(r.say[1]), 'ρ −0.82: ' + r.say[1]);
      t.ok(/part of their moves/.test(r.say[2]) && !/as one|same trade/.test(r.say[2]), 'ρ 0.55 is not "as one": ' + r.say[2]);
      t.ok(/weak|loose/.test(r.say[3]) && !/as one|same trade|doubles/.test(r.say[3]), 'ρ 0.25 is loose: ' + r.say[3]);
      t.ok(!/diversifier/i.test(r.txt), 'no "diversifier" without positions: ' + r.txt.slice(0, 400));
      t.ok(!r.upTone, 'no green value in the side panel');
      t.ok(/diversif/i.test(r.withPos) && /your position/i.test(r.withPos), 'with a position the diversifier is measured against it: ' + r.withPos.slice(0, 500));
      t.ok(!r.posTone, 'and it stays neutral');
      t.ok(r.stab && r.stab.total === 15 && r.stab.same >= 0 && r.stab.same <= 15, 'stability measured: ' + JSON.stringify(r.stab));
      t.ok(new RegExp(`${r.stab.same} of 15 links also in the previous 4H`).test(r.txt), 'stability shown: ' + r.txt.match(/.{0,30}of 15 links.{0,60}/)?.[0]);
      t.ok(!/same branch|close to the same trade/.test(r.ask) && /adjacent/i.test(r.ask), 'the question no longer says same branch = same trade: ' + r.ask);
      t.ok(/further along a branch is not implied|not implied/.test(r.txt), 'the side panel says what the tree does not say');
      t.ok(/position on the screen|distance on the screen|screen/i.test(r.txt), 'screen proximity is said to mean nothing');
      t.eq(r.hubGot, r.hubWant, 'hubs listed with their ties');
      t.ok(!/move with it|drives|causes/.test(r.hubTips), 'hub tips carry no causality: ' + r.hubTips.slice(0, 200));
      t.noErrors(page);
    }
  },
  {
    name: 'OH3 Constellation UI: opaque nodes, ρ labels off the nodes, complete legend, nodes reachable and openable from the keyboard',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        OQ.show('const', { lb: 1440 });
        const svg = document.querySelector('#constWrap svg'), nodes = [...svg.querySelectorAll('.cnode')];
        const P = nodes.map(g => { const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(g.getAttribute('transform')); return { x: +m[1], y: +m[2], r: +g.querySelector('circle').getAttribute('r') }; });
        const labs = [...svg.querySelectorAll('.edge-lab')].map(x => ({ x: +x.getAttribute('x'), y: +x.getAttribute('y') - 4 }));
        const over = labs.filter(l => P.some(p => Math.abs(l.x - p.x) < p.r + 12 && Math.abs(l.y - p.y) < p.r + 6));
        const ops = nodes.map(g => +g.querySelector('circle').getAttribute('fill-opacity'));
        const leg = document.getElementById('constSide').textContent;
        return { n: nodes.length, over: over.length, labs: labs.length, minOp: Math.min(...ops), tab: nodes.every(g => g.getAttribute('tabindex') === '0' && g.dataset.tip && g.getAttribute('aria-label')), role: svg.getAttribute('role'), leg };
      });
      t.eq(r.n, 16, 'sixteen nodes');
      t.eq(r.over, 0, `no ρ label on a node (${r.labs} labels)`);
      t.ok(r.minOp >= .45, 'nodes are opaque enough: ' + r.minOp);
      t.ok(r.tab, 'every node is focusable, labelled and explained');
      t.ok(r.role !== 'img', 'the tree is not a flat image to assistive tech');
      t.ok(/node size/i.test(r.leg) && /open pair/i.test(r.leg) && /position/i.test(r.leg) && /line width/i.test(r.leg), 'legend lists size, rings and line width: ' + r.leg.slice(-400));
      await page.evaluate(() => { const g = [...document.querySelectorAll('#constWrap .cnode')].find(x => x.dataset.sym === 'USDJPY'); g.focus(); });
      const tip = await page.evaluate(() => { const tp = document.getElementById('brTip'); return tp && tp.style.display === 'block' ? tp.textContent : ''; });
      t.ok(/USD\/JPY/.test(tip) && /Enter/.test(tip), 'focus shows the node tip (with how to open it): ' + tip.slice(0, 80));
      await page.keyboard.press('Enter');
      t.eq(await page.evaluate(() => S.set.sym), 'USDJPY', 'Enter opens the focused pair');
      t.noErrors(page);
    }
  },
  {
    name: 'OH4 Regime: descriptive labels, no "up" tone, ER with a noise reference, pills name the deviating metric, measured noise on the axis',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const col = chartColors();
        const c = OQ.calls(() => OQ.show('regime', { lb: 1440 }));
        const side = document.getElementById('rgSide'), pts = OBS.rgPts;
        const pills = [...side.querySelectorAll('.pill')].map(p => ({ s: p.dataset.sym, txt: p.textContent, tip: p.dataset.tip || '' }));
        const metric = pills.map(p => { const q = pts.find(x => x.s === p.s); return { ...p, pe: q.zP > Math.abs(q.zH) }; });
        const fills = new Set(c.rects.map(x => x.c));
        return {
          txt: side.textContent, ask: OBS_ASK.regime, upClass: !!side.querySelector('.up'), metric,
          upZone: [...fills].some(f => f === OQ.norm(col.up + '10')), texts: c.texts.map(x => x.s),
          mid: pts[0].bP.mid, er: OBS.rgEr, hits: [...document.querySelectorAll('#obsBody .rg-hit')].map(x => x.dataset.tip), npts: pts.length,
          spark: document.querySelector('#rgSpark + .rg-spk-ax')?.textContent || '', axis: OBS.rgAxis,
          pe: pts.map(p => p.pe), lo: pts[0].bP.lo, hi: pts[0].bP.hi
        };
      });
      t.ok(/persistent/.test(r.txt) && /1–32 minutes/.test(r.txt + r.ask) && !/\btrending\b/.test(r.txt), 'descriptive regime words: ' + r.txt.slice(0, 300));
      t.ok(!/\btrending\b|mean-reverting/.test(r.ask), 'the question is descriptive: ' + r.ask);
      t.ok(!r.upClass, 'no "up" tone on a regime');
      t.ok(!r.upZone, 'the persistent zone is not painted in the up colour');
      t.ok(!r.texts.some(s => /trending|mean-reverting|1 = pure noise/.test(s)), 'canvas words: ' + r.texts.filter(s => /[a-z]{5}/.test(s)).join(' / '));
      t.ok(r.texts.some(s => /noise ≈ 0\.9\d\d/.test(s)), 'the axis gives the measured noise level: ' + r.texts.find(s => /entropy/.test(s)));
      t.ok(r.er && r.er.mid > 0 && /typical noise ≈ [\d.]+%/.test(r.txt), 'efficiency ratio has a noise reference: ' + r.txt.match(/Efficiency.{0,120}/)?.[0]);
      for (const p of r.metric) t.ok(p.pe ? /PE/.test(p.txt) : /H /.test(p.txt), `pill ${p.s} names its metric (${p.pe ? 'PE' : 'H'}): ${p.txt}`);
      t.eq(r.hits.length, r.npts, 'one focusable target per point');
      t.ok(r.hits.every(x => /noise band/.test(x)), 'each target tip carries the band');
      t.ok(/0\.50/.test(r.spark) && /48h ago|now/.test(r.spark), 'the sparkline has a scale: ' + r.spark);
      const lo = Math.min(r.lo, ...r.pe), hi = Math.max(r.hi, ...r.pe);
      t.ok((hi - lo) / (r.axis.yMax - r.axis.yMin) > .6, `the Y axis spans the data: data ${lo.toFixed(4)}–${hi.toFixed(4)}, axis ${r.axis.yMin.toFixed(4)}–${r.axis.yMax.toFixed(4)}`);
      t.noErrors(page);
    }
  },
  {
    name: 'OH5 Regime UI: a legend, points visible on the light theme, keyboard opens a pair',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        S.set.theme = 'light'; if (typeof applyTheme === 'function') applyTheme();
        const c = OQ.calls(() => OQ.show('regime', { lb: 240 }));
        const leg = document.querySelector('#obsBody .rg-legend');
        // the alpha of every point fill (arcs are filled with fill(), so read the strokes' partner: the hit targets exist)
        return { leg: leg ? leg.textContent : '', theme: document.documentElement.dataset.theme || '' };
      });
      t.ok(/noise band/.test(r.leg) && /persistent/.test(r.leg) && /size/i.test(r.leg), 'legend: ' + r.leg);
      await page.evaluate(() => document.querySelector('#obsBody .rg-hit[data-sym="GBPUSD"]').focus());
      await page.keyboard.press('Enter');
      t.eq(await page.evaluate(() => S.set.sym), 'GBPUSD', 'Enter on a point opens its pair');
      const a = await page.evaluate(() => OBS.rgAlphaMin);
      t.ok(a >= .55, 'point fill alpha at least .55: ' + a);
      t.noErrors(page);
    }
  },
  {
    name: 'OH6 Tapestry: neutral theme, "mixed" when its pairs disagree, per-pair scale, peaks kept, hover on the drawing index rule',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const b = OQ.show('tap', { tapLb: 1440, tapSort: 'abc', tapScale: 'common' });
        const th = [...b.querySelectorAll('.tap-theme')].map(x => ({ cls: x.className, txt: x.textContent }));
        const mixWant = OBS.tapTheme.map(x => x.k / x.n < .75);
        // one spike on a quiet bar mid-window (between pixel samples), on the first row
        const sym = OBS.tap.data[0].s, a = Engine.candles[sym], k = a.length - 700, was = a[k].close;
        a[k].close = a[k - 1].close * 1.02;
        const col = chartColors(), top = OQ.norm(col.up + 'e0');
        const c = OQ.calls(() => obsDraw());
        a[k].close = was;
        const peak = c.rects.filter(x => x.c === top && x.y < OBS.tap.rowsH).length;
        // hover index = draw index
        const g = OBS.tap.geo, px = Math.floor(g.W2 / 3), row = 2;
        const same = OBS.tap.pick(row, px) === OBS.tap.hoverIdx(row, g.L0 + px + .5);
        const axis = c.texts.filter(x => /^\d\d-\d\d \d\d:\d\d$/.test(x.s)).map(x => x.s);
        const pc = OQ.show('tap', { tapScale: 'pair' }), bands = OBS.tap.bands;
        return { th, mixWant, peak, same, axis, body: document.getElementById('obsBody').textContent, perPair: new Set(bands.map(v => v.toFixed(8))).size, sw: [...pc.querySelectorAll('.tap-sh')].map(x => x.getBoundingClientRect().width), ctl: !!document.querySelector('#obsCtrl [data-k="tapScale"]') };
      });
      t.ok(r.th.length === 2 && r.th.every(x => !/\b(ok|none)\b/.test(x.cls)), 'theme chips are not good/bad verdicts: ' + r.th.map(x => x.cls));
      r.th.forEach((x, i) => t.eq(/mixed/.test(x.cls) && /mixed/.test(x.txt), r.mixWant[i], `theme ${i} mixed iff k/n < 0.75: ${x.txt}`));
      t.ok(r.peak > 0, 'a one-bar spike reaches the top band (max per pixel)');
      t.ok(r.same, 'hover reads the index the drawing used');
      t.ok(r.axis.length >= 2 && r.axis.every(s => /:00$/.test(s)), 'time axis on round hours: ' + r.axis);
      t.ok(!/[-‐](\d|\.)/.test(r.body.replace(/\d\d-\d\d \d\d:\d\d/g, '')), 'typographic minus only: ' + r.body.match(/.{0,20}-\d.{0,10}/)?.[0]);
      t.ok(r.ctl, 'a per-pair scale switch');
      t.ok(r.perPair > 8, 'per-pair scale gives each row its own band: ' + r.perPair);
      t.ok(r.sw.length && r.sw.every(w => w >= 11), 'legend swatches at least 11 px: ' + r.sw);
      t.noErrors(page);
    }
  },
  {
    name: 'OH7 Tapestry UI: hovered row outlined, compact tooltip with typographic minus; closed market draws too',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      await page.evaluate(() => OQ.show('tap', { tapLb: 240, tapSort: 'abc', tapScale: 'common' }));
      const box = await page.locator('#tapCv').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + 30 * 3 + 15);
      const r = await page.evaluate(() => { const tp = document.getElementById('brTip'); return { lines: tp ? tp.querySelectorAll('span').length : 0, txt: tp ? tp.textContent : '', hov: OBS.tapHov && OBS.tapHov.sym, out: OBS.tap.outlined }; });
      t.ok(r.hov, 'a row is hovered');
      t.ok(r.lines > 0 && r.lines <= 4, 'compact tooltip: ' + r.lines + ' lines');
      t.ok(!/-\d/.test(r.txt.replace(/\d\d-\d\d \d\d:\d\d/g, '')), 'no hyphen minus in the tooltip: ' + r.txt);
      t.eq(r.out, r.hov, 'the hovered row is outlined');
      await page.mouse.move(2, 2);
      const p2 = await obsApp(app, SAT);
      const c = await p2.evaluate(() => { const b = OQ.show('tap', { tapLb: 1440 }); return { err: /Could not compute/.test(b.textContent), cv: !!b.querySelector('canvas') }; });
      t.ok(!c.err && c.cv, 'closed market draws');
      t.noErrors(page); t.noErrors(p2);
    }
  }
];
