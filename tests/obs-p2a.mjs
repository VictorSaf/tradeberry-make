// Observatory, usefulness (P2) for Constellation, Regime and Tapestry (review 24.10, task obs5).
// Constellation compares ρ now with ρ over the whole history (Fisher z, nested windows) and lists the unusual links,
// shows the net currency exposure of the positions with the hub currencies marked, switches the return interval
// (1m / 5m / 15m) with an Epps note that says what this market shows, and names an instrument outside the tree.
// Regime gives each pair how long it has stayed in its zone (hourly windows, with n) and a sortable table per pair.
// Tapestry draws the 0 line of every row, the four sessions (DST-aware, the clock's hours) and the calendar's releases
// on its axis, and filters its rows by currency with the theme recomputed on the rows shown (a soft setting).
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z');
async function obsApp(app, clock) {
  const page = await app('', { clock });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = {
      show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); },
      norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
      calls(fn) {
        const P = CanvasRenderingContext2D.prototype, o = P.fillRect, ot = P.fillText, rects = [], texts = [];
        P.fillRect = function (x, y, w, h) { rects.push({ x, y, w, h, c: OQ.norm(this.fillStyle), a: this.globalAlpha }); return o.apply(this, arguments); };
        P.fillText = function (s, x, y) { texts.push({ s: String(s), x, y }); return ot.apply(this, arguments); };
        try { fn(); } finally { P.fillRect = o; P.fillText = ot; }
        return { rects, texts };
      }
    };
  });
  return page;
}
const fz = r => Math.atanh(Math.max(-.999999, Math.min(.999999, r)));

export const tests = [
  {
    name: 'OP1 Constellation: ρ now against ρ normal (Fisher z on nested windows), unusual links marked on edges and listed, explicit empty list',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        // the classifier on known values: a link that weakened, one that appeared, one unchanged, one too short to judge
        const syms = ['A', 'B', 'C'], I = (a, b, c) => [[1, a, b], [a, 1, c], [b, c, 1]];
        const cls = constUnusual(syms, I(.2, .7, .51), 240, I(.8, .1, .5), 10000);
        const b = OQ.show('const', { lb: 1440, cFreq: 1 }), side = document.getElementById('constSide');
        const u = OBS.constUnu, out = { cls, u: JSON.parse(JSON.stringify(u)), side: side.textContent };
        // recompute every one of the 120 links by hand from the two windows
        const now = corrMatrix(1440, 0, 1), nrm = corrMatrix(u.normLb, 0, 1), n1 = now.R[0].length, n2 = nrm.R[0].length, want = [];
        for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) {
          const se = u.k * Math.sqrt(Math.max(1e-12, 1 / (n1 - 3) - 1 / (n2 - 3))), d = Math.abs(Math.atanh(now.C[i][j]) - Math.atanh(nrm.C[i][j])) / se;
          if (d > CONST_BRK_Z) want.push([now.syms[i], now.syms[j]].sort().join('|'));
        }
        // k by hand: z between consecutive windows of n1 returns of the history, pooled variance against 1/(n1−3)
        const K = Math.floor(n2 / n1); let ss = 0, df = 0;
        for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) { const zs = []; for (let w = 0; w < K; w++) zs.push(Math.atanh(Engine.corr(nrm.R[i].slice(n2 - (w + 1) * n1, n2 - w * n1), nrm.R[j].slice(n2 - (w + 1) * n1, n2 - w * n1)))); const m = zs.reduce((s, v) => s + v, 0) / K; ss += zs.reduce((s, v) => s + (v - m) ** 2, 0); df += K - 1; }
        out.kWant = Math.max(1, Math.sqrt(ss / df * (n1 - 3))); out.K = K;
        out.n1 = n1; out.n2 = n2; out.want = want.sort(); out.got = u.links.map(l => [l.a, l.b].sort().join('|')).sort();
        out.hist = Engine.candles.EURUSD.length;
        // the UI with a forced unusual link on a tree edge (the classifier wrapped, as other modules wrap globals)
        const orig = window.constUnusual, E = OBS.constTree.E, ts = OBS.constTree.syms, a0 = ts[E[0][0]], b0 = ts[E[0][1]];
        window.constUnusual = (...args) => { const res = orig(...args); res.links = [{ a: a0, b: b0, now: .21, norm: .74, dz: 5.2, kind: 'broke' }]; return res; };
        OQ.show('const', { lb: 1440 });
        const s2 = document.getElementById('constSide'), pills = [...s2.querySelectorAll('.const-unu-pill')];
        out.pill = pills.map(p => ({ txt: p.textContent, tip: p.dataset.tip, tab: p.getAttribute('tabindex') }));
        out.edgeMarks = [...document.querySelectorAll('#constWrap .const-unu')].length;
        out.edgeTip = [...document.querySelectorAll('#constWrap g[data-tip]')].map(g => g.dataset.tip).filter(x => /Unusual now/.test(x));
        window.constUnusual = (...args) => { const res = orig(...args); res.links = []; return res; };
        OQ.show('const', { lb: 1440 });
        out.empty = document.getElementById('constSide').textContent;
        window.constUnusual = orig;
        return out;
      });
      t.deep(r.cls.links.map(l => [l.a + l.b, l.kind]), [['AB', 'broke'], ['AC', 'new']], 'classifier: 0.8→0.2 broke, 0.1→0.7 new, 0.5→0.51 not marked');
      t.ok(r.cls.links.every(l => typeof l.now === 'number' && typeof l.norm === 'number' && l.dz > 3), 'each link carries ρ now, ρ normal, its size in SE');
      t.ok(r.hist > 4320, 'history longer than 3D: ' + r.hist);
      t.ok(r.u.normLb > 1440 && r.u.n2 > r.u.n1, 'normal = a longer window than now: ' + JSON.stringify({ normLb: r.u.normLb, n1: r.u.n1, n2: r.u.n2 }));
      t.eq(r.u.n1, r.n1, 'n now'); t.eq(r.u.n2, r.n2, 'n normal');
      t.ok(r.K >= 3, 'at least 3 history windows for the calibration: ' + r.K);
      t.near(r.u.k, r.kWant, 'the Fisher error widened by the spread between history windows (k ≥ 1)', 1e-9);
      t.ok(r.u.k > 1, 'on this market ρ varies more between windows than iid normal returns say: k = ' + r.u.k);
      t.ok(r.got.length <= 6, 'a calibrated threshold marks few links on a market whose links do not change: ' + r.got.length);
      t.ok(new RegExp(`widened ×${r.u.k.toFixed(2)}`).test(r.side), 'the widening is said');
      t.deep(r.got, r.want, 'the marked links are exactly those beyond the threshold');
      t.ok(/Unusual links now/.test(r.side), 'the list is in the side panel');
      t.ok(new RegExp(`120 links`).test(r.side) && new RegExp(`n = ${r.n1}`).test(r.side.replace(/,/g, '')) , 'the list says what was checked and on how many returns: ' + r.side.match(/Unusual links now.{0,300}/)?.[0]);
      t.eq(r.pill.length, 1, 'one pill for the forced link');
      t.ok(/broke/.test(r.pill[0].txt) && /0\.74/.test(r.pill[0].txt) && /0\.21/.test(r.pill[0].txt), 'pill: broke with both values: ' + r.pill[0].txt);
      t.eq(r.pill[0].tab, '0', 'the pill is focusable');
      t.ok(/normal/.test(r.pill[0].tip) && /standard error/.test(r.pill[0].tip), 'its tip explains the comparison: ' + r.pill[0].tip);
      t.eq(r.edgeMarks, 1, 'the tree edge carries the mark');
      t.ok(r.edgeTip.length === 1 && /broke/.test(r.edgeTip[0]) && /0\.74/.test(r.edgeTip[0]), 'the edge tip names it: ' + r.edgeTip);
      t.ok(/No link is unusual right now/.test(r.empty), 'empty list said explicitly');
      t.ok(!/forecast|will |signal to/i.test(r.side.match(/Unusual links now.{0,600}/)?.[0] || ''), 'no forecast wording');
      t.noErrors(page);
    }
  },
  {
    name: 'OP2 Constellation: net currency exposure of the positions (exposureOf), hub currencies marked; flat said',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        OQ.show('const', { lb: 1440 }); const flat = document.getElementById('constSide').textContent;
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true, pmDone: true });
        openPosition({ sym: 'USDJPY', side: 'buy', lots: .5, dupOk: true, pmDone: true });
        OQ.show('const', { lb: 1440 });
        const rows = [...document.querySelectorAll('#constSide .const-exp')].map(x => ({ c: x.dataset.ccy, txt: x.textContent, hub: x.classList.contains('hubc'), tip: x.dataset.tip || '' }));
        const ccy = exposureOf().ccy, { E, syms } = OBS.constTree, deg = syms.map((_, i) => E.filter(e => e.includes(i)).length);
        const third = deg.slice().sort((a, b) => b - a)[2], hubs = syms.filter((_, i) => deg[i] >= third && deg[i] >= 2);
        const hubC = new Set(hubs.flatMap(s => [Engine.META[s].base, Engine.META[s].quote]));
        return { flat, rows, ccy, hubC: [...hubC], expK: Object.fromEntries(Object.entries(ccy).map(([k, v]) => [k, expK(v)])) };
      });
      t.ok(/No open positions/.test(r.flat) && /currency exposure/i.test(r.flat), 'flat: said');
      const want = Object.keys(r.ccy).filter(k => Math.abs(r.ccy[k]) > 1).sort();
      t.deep(r.rows.map(x => x.c).sort(), want, 'one row per currency of exposureOf');
      for (const x of r.rows) {
        t.ok(x.txt.includes(r.expK[x.c]), `${x.c} shows ${r.expK[x.c]}: ${x.txt}`);
        t.eq(x.hub, r.hubC.includes(x.c), `${x.c} hub mark`);
        if (x.hub) t.ok(/hub/i.test(x.txt + x.tip), 'the mark is named: ' + x.txt);
      }
      t.ok(r.rows.find(x => x.c === 'USD') && /short|long/.test(r.rows.find(x => x.c === 'USD').txt), 'USD row says the side');
      t.noErrors(page);
    }
  },
  {
    name: 'OP3 Constellation: return interval 1m / 5m / 15m (soft setting), Epps note with what this market shows, n per interval',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        OQ.show('const', { lb: 1440, cFreq: 1 });
        out.btns = [...document.querySelectorAll('#obsCtrl [data-k="cFreq"] button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : ''));
        document.querySelector('#obsCtrl [data-k="cFreq"] [data-val="5"]').click();
        out.fq = obsCfg().cFreq; out.u = OBS.constUnu; out.side = document.getElementById('constSide').textContent; out.epps = OBS.constEpps;
        const m = fq => { const c = corrMatrix(1440, 0, fq); let s = 0, k = 0; for (let i = 0; i < 16; i++) for (let j = i + 1; j < 16; j++) { s += Math.abs(c.C[i][j]); k++; } return { r: s / k, n: c.R[0].length }; };
        out.want = [1, 5, 15].map(m);
        out.soft = OBS_SOFT.cFreq; out.known = 'cFreq' in SHAPES.obs;
        out.c15 = corrMatrix(240, 0, 15).R[0].length;
        OQ.show('const', { lb: 240, cFreq: 15 }); out.thin = document.getElementById('constSide').textContent;
        return out;
      });
      t.deep(r.btns, ['1m*', '5m', '15m'], 'the switch, 1m by default');
      t.eq(r.fq, 5, 'the click sets 5m');
      t.ok(Math.abs(r.u.n1 - r.want[1].n) === 0 && r.want[1].n < r.want[0].n / 4, '5-minute returns: n = ' + r.u.n1);
      t.ok(/Epps/.test(r.side) && /rises with the interval/.test(r.side), 'the note on real data: ' + r.side.match(/.{0,80}Epps.{0,200}/)?.[0]);
      r.want.forEach((w, i) => t.near(r.epps[i].r, w.r, `mean |ρ| at ${[1, 5, 15][i]}m`, 1e-9));
      for (const w of r.want) t.ok(r.side.includes(w.r.toFixed(2)), 'the observed mean |ρ| is shown: ' + w.r.toFixed(2));
      t.eq(r.soft, 1, 'a soft setting (default 1m)'); t.eq(r.known, false, 'sanitizeState does not know it, so it is not saved');
      t.ok(r.c15 < 30 && /too few|thin/i.test(r.thin) && new RegExp(`${r.c15} returns`).test(r.thin), '4H at 15m: thin data said: ' + r.thin.match(/.{0,60}(too few|thin).{0,80}/i)?.[0]);
      t.noErrors(page);
    }
  },
  {
    name: 'OP4 Constellation: an exotic or a CFD open is named as outside the G8 tree',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        for (const s of ['USDTRY', 'GOLD', 'EURUSD']) { if (!(s in Engine.META)) continue; setSymbol(s); OQ.show('const', { lb: 1440 }); out[s] = document.getElementById('constSide').textContent; }
        return out;
      });
      if (r.USDTRY != null) t.ok(/USD\/TRY is not in the G8 tree/.test(r.USDTRY), 'USD/TRY: ' + r.USDTRY.slice(0, 200));
      t.ok(/is not in the G8 tree/.test(r.GOLD) && /CFD/.test(r.GOLD), 'GOLD: ' + r.GOLD.slice(0, 200));
      t.ok(!/not in the G8 tree/.test(r.EURUSD), 'EUR/USD is in the tree');
      t.noErrors(page);
    }
  },
  {
    name: 'OP5 Regime: how long each pair has stayed in its zone, on hourly windows, with n',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); const b = OQ.show('regime', { lb: 240 }), band = OBS.rgBand.v.h;
        const rows = OBS.rgRows, me = rows.find(x => x.s === 'EURUSD');
        // by hand: windows of 240 bars ending every 60 bars back, Hurst against the same band
        const a = Engine.candles.EURUSD, zs = [];
        for (let k = 0; k <= RG_PW; k++) { const e = a.length - k * 60; if (e - 240 < 0) break; const w = a.slice(e - 240, e), H = hurst(obsSegs(w.map(x => x.time), w.map(x => x.close)).flat()); zs.push(H == null ? null : rgZone(H, band)); }
        let run = 1; while (run < zs.length && zs[run] === zs[0]) run++;
        return { me: JSON.parse(JSON.stringify(me)), zs, run, side: document.getElementById('rgSide').textContent };
      });
      t.eq(r.me.zone, r.zs[0], 'zone now');
      t.eq(r.me.run, r.run, 'consecutive windows in that zone');
      t.eq(r.me.nw, r.zs.length, 'windows checked');
      t.ok(['noise', 'persistent', 'anti-persistent'].includes(r.me.zone), 'zone name: ' + r.me.zone);
      t.ok(/for /.test(r.side) && new RegExp(`${r.run} of ${r.zs.length} hourly windows`).test(r.side), 'the side panel says it with n: ' + r.side.match(/.{0,120}hourly windows.{0,120}/)?.[0]);
      t.ok(/overlap/.test(r.side), 'overlapping windows said');
      t.ok(!/will (stay|continue|last)|expect/i.test(r.side), 'no forecast wording');
      t.noErrors(page);
    }
  },
  {
    name: 'OP6 Regime: per-pair table (H, PE, ER, zone, persistence), sortable, open pair marked, click opens the pair',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('GBPUSD'); OBS.rgTblOpen = true; OQ.show('regime', { lb: 1440 }); // the table is folded by default: opened here
        const tb = document.querySelector('#obsBody .rg-tbl'), out = {};
        out.heads = [...tb.querySelectorAll('thead th')].map(th => th.textContent.trim());
        const rows = () => [...tb.querySelectorAll('tbody tr')].map(tr => ({ s: tr.dataset.row, cells: [...tr.cells].map(c => c.textContent.trim()), cur: tr.classList.contains('cur'), ac: tr.getAttribute('aria-current') }));
        out.rows0 = rows();
        const hb = () => [...tb.querySelectorAll('thead button')].find(x => /^H/.test(x.textContent.trim()));
        hb().click(); out.asc = rows().map(x => x.cells[1]); out.sort1 = hb().closest('th').getAttribute('aria-sort'); out.focus = document.activeElement === hb();
        hb().click(); out.desc = rows().map(x => x.cells[1]); out.sort2 = hb().closest('th').getAttribute('aria-sort');
        out.pts = OBS.rgPts.map(p => [p.s, p.H.toFixed(2)]);
        const tr = [...document.querySelectorAll('#obsBody .rg-tbl tbody tr')].find(x => x.dataset.row === 'AUDUSD');
        tr.cells[3].click(); out.sym = S.set.sym;
        return out;
      });
      t.deep(r.heads.map(h => h.replace(/[▲▼]/g, '').trim()), ['Pair', 'H', 'PE', 'ER', 'Zone', 'In zone'], 'columns');
      t.eq(r.rows0.length, 16, 'a row per pair');
      const cur = r.rows0.filter(x => x.cur);
      t.ok(cur.length === 1 && cur[0].s === 'GBPUSD' && cur[0].ac === 'true', 'the open pair is marked');
      for (const [s, H] of r.pts) t.eq(r.rows0.find(x => x.s === s).cells[1], H, `${s} H in the table = the map's`);
      const num = a => a.filter(x => x !== '—').map(Number);
      t.deep(num(r.asc), num(r.asc).slice().sort((a, b) => a - b), 'H ascending'); t.eq(r.sort1, 'ascending', 'aria-sort ascending');
      t.deep(num(r.desc), num(r.desc).slice().sort((a, b) => b - a), 'H descending'); t.eq(r.sort2, 'descending', 'aria-sort descending');
      t.ok(r.focus, 'the sort button keeps the focus');
      t.ok(r.rows0.every(x => /^(noise|persistent|anti-persistent|—)$/.test(x.cells[4])), 'zone names: ' + r.rows0.map(x => x.cells[4]));
      t.ok(r.rows0.every(x => /^(—|<1h|≥?\d+h)$/.test(x.cells[5])), 'persistence in hours: ' + r.rows0.map(x => x.cells[5]));
      t.eq(r.sym, 'AUDUSD', 'a click on the row opens the pair');
      t.noErrors(page);
    }
  },
  {
    name: 'OP7 Tapestry: 0 line on every row, the four sessions (DST) and the calendar releases on the axis, with tooltips',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const a = Engine.candles.EURUSD, ev = { id: 'tst', t: a[a.length - 120].time + 5, ccy: 'USD', name: 'Test Payrolls', impact: 'hi', unit: 'K', fc: 150, prev: 140, sd: 60, done: true, actual: 190, move: .001 };
        CAL.events.push(ev);
        const out = {};
        const c = OQ.calls(() => OQ.show('tap', { tapLb: 1440, tapSort: 'abc', tapScale: 'common', tapCcy: 'all' }));
        const tp = OBS.tap, rowsH = tp.rowsH, line = OQ.norm(chartColors().line);
        out.zero = tp.data.map((_, r) => c.rects.filter(x => x.h <= 1 && Math.abs(x.y - (r * rowsH + rowsH - 2)) < .6 && x.w > 100).length);
        out.lanes = tp.lanes.map(l => ({ nm: l.nm, n: l.on.length }));
        // London on Wed 21.10 (summer time): 07:00–16:00 UTC
        const T = tp.data[0].t, W2 = tp.geo.W2, n = T.length, idxAt = hh => { for (let i = n - 1; i >= 0; i--) { const d = new Date(T[i] * 1000); if (d.getUTCHours() === hh && d.getUTCMinutes() === 30) return i; } return -1; };
        const pxOf = i => Math.floor((i + .5) * W2 / n), lon = tp.lanes.find(l => l.nm === 'London');
        out.lon10 = lon.on.includes(pxOf(idxAt(10))); out.lon20 = lon.on.includes(pxOf(idxAt(20)));
        out.sess = clkSessions(T[idxAt(10)]).map(x => x[0]);
        out.news = tp.news.map(x => ({ name: x.e.name, x: x.x }));
        out.wantX = tp.geo.L0 + (T.findIndex(tt => tt >= ev.t) + .5) * W2 / n;
        out.note = document.getElementById('obsBody').textContent;
        out.labels = c.texts.map(x => x.s);
        out.newsY = tp.newsY; out.cvTop = document.getElementById('tapCv').getBoundingClientRect().top; out.cvLeft = document.getElementById('tapCv').getBoundingClientRect().left;
        out.laneY = lon.y;
        return out;
      });
      t.ok(r.zero.every(k => k >= 1), 'a 0 line under every row: ' + r.zero);
      t.deep(r.lanes.map(x => x.nm), ['Sydney', 'Tokyo', 'London', 'New York'], 'four session lanes');
      t.ok(r.lanes.every(x => x.n > 0), 'each session open somewhere in 1D');
      t.ok(r.lon10 && !r.lon20, 'London open at 10:30, closed at 20:30 UTC');
      t.ok(['Sydney', 'Tokyo', 'London', 'New York'].every(s => r.labels.includes(s)) && r.labels.includes('News'), 'lanes labelled on the canvas: ' + r.labels.filter(s => /^[A-Z][a-z]/.test(s)));
      t.eq(r.news.length, 1, 'the injected release is drawn'); t.eq(r.news[0].name, 'Test Payrolls', 'by name');
      t.near(r.news[0].x, r.wantX, 'at the bar of its time', 0, 1);
      t.ok(/Test Payrolls/.test(r.note) && /calendar/.test(r.note), 'listed under the chart: ' + r.note.match(/.{0,80}Test Payrolls.{0,60}/)?.[0]);
      // tooltips: the release, then the London lane
      // the lanes sit under the rows: bring the canvas bottom into view, then read its place
      Object.assign(r, await page.evaluate(() => { const cv = document.getElementById('tapCv'); cv.scrollIntoView({ block: 'end' }); const b = cv.getBoundingClientRect(); return { cvTop: b.top, cvLeft: b.left }; }));
      await page.mouse.move(r.cvLeft + r.news[0].x, r.cvTop + r.newsY + 4);
      const tip1 = await page.evaluate(() => { const tp = document.getElementById('brTip'); return tp && tp.style.display === 'block' ? tp.textContent : ''; });
      t.ok(/Test Payrolls/.test(tip1) && /190K/.test(tip1) && /150K/.test(tip1), 'release tooltip: ' + tip1);
      await page.mouse.move(r.cvLeft + r.news[0].x, r.cvTop + r.laneY + 2);
      const tip2 = await page.evaluate(() => { const tp = document.getElementById('brTip'); return tp && tp.style.display === 'block' ? tp.textContent : ''; });
      t.ok(/London session/.test(tip2) && /07:00–16:00/.test(tip2), 'session tooltip with the day\'s hours: ' + tip2);
      t.noErrors(page);
    }
  },
  {
    name: 'OP8 Tapestry: currency filter (All + the 8), rows and theme recomputed on what is shown, soft setting',
    async run({ t, app }) {
      for (const clock of [WED, SAT]) {
        const page = await obsApp(app, clock);
        const r = await page.evaluate(() => {
          const out = {};
          OQ.show('tap', { tapLb: 1440, tapSort: 'ret', tapCcy: 'all' });
          out.btns = [...document.querySelectorAll('#obsCtrl [data-k="tapCcy"] button')].map(b => b.textContent);
          out.all = OBS.tap.data.length;
          document.querySelector('#obsCtrl [data-k="tapCcy"] [data-val="JPY"]').click();
          const d = OBS.tap.data;
          out.cfg = obsCfg().tapCcy; out.rows = d.map(x => x.s);
          out.want = Engine.PAIRS.filter(p => p.base === 'JPY' || p.quote === 'JPY').map(p => p.sym).sort();
          const mv = d.map(x => (Engine.META[x.s].base === 'JPY' ? 1 : -1) * x.v[x.v.length - 1]), avg = mv.reduce((s, v) => s + v, 0) / mv.length;
          out.avg = avg; out.k = mv.filter(v => v !== 0 && Math.sign(v) === Math.sign(avg)).length; out.th = JSON.parse(JSON.stringify(OBS.tapTheme));
          out.chips = [...document.querySelectorAll('.tap-theme b')].map(x => x.textContent);
          out.head = document.querySelector('.tap-head').textContent;
          out.common = Math.max(...d.map(x => Math.max(...x.v.map(Math.abs)))) / 3; out.band = OBS.tap.bands[0];
          out.h = document.getElementById('tapCv').style.height;
          out.soft = OBS_SOFT.tapCcy; out.known = 'tapCcy' in SHAPES.obs;
          return out;
        });
        t.deep(r.btns, ['All', 'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD'], 'All + the 8 currencies');
        t.eq(r.all, 16, 'All: 16 rows');
        t.eq(r.cfg, 'JPY', 'the click sets the filter');
        t.deep(r.rows.slice().sort(), r.want, 'only the JPY pairs');
        t.eq(r.th.length, 1, 'one theme: the filtered currency'); t.eq(r.th[0].cc, 'JPY', 'about JPY');
        t.near(r.th[0].avg, r.avg, 'JPY average over the rows shown', 1e-9, 1e-12);
        t.eq(r.th[0].k, r.k, 'consensus over the rows shown'); t.eq(r.th[0].n, r.want.length, 'n = rows shown');
        t.eq(r.chips[0], `JPY ${r.avg >= 0 ? 'strength' : 'weakness'}`, 'chip named by the sign');
        t.ok(new RegExp(`${r.want.length} of 16 pairs`).test(r.head), 'the head says how many rows are shown: ' + r.head);
        t.near(r.band, r.common, 'the common scale is taken on the rows shown', 1e-9);
        t.eq(r.soft, 'all', 'soft default'); t.eq(r.known, false, 'not in the saved state');
        t.noErrors(page);
      }
    }
  }
  ,{
    name: 'OP9 closed market (Saturday) and every window: the three tools draw their new parts, in reasonable time',
    async run({ t, app }) {
      const page = await obsApp(app, SAT);
      const r = await page.evaluate(() => {
        const out = [];
        for (const lb of [240, 1440, 4320]) {
          let t0 = performance.now(), b = OQ.show('const', { lb, cFreq: 1 });
          out.push({ v: 'const', lb, ms: performance.now() - t0, err: /Could not compute/.test(b.textContent), ok: !!b.querySelector('.const-unu-list') && !!b.querySelector('.const-expo') });
          t0 = performance.now(); b = OQ.show('regime', { lb });
          out.push({ v: 'regime', lb, ms: performance.now() - t0, err: /Could not compute/.test(b.textContent), ok: b.querySelectorAll('.rg-tbl tbody tr').length === 16 && /hourly windows/.test(b.textContent) });
          t0 = performance.now(); b = OQ.show('tap', { tapLb: lb, tapCcy: 'all' });
          out.push({ v: 'tap', lb, ms: performance.now() - t0, err: /Could not compute/.test(b.textContent), ok: OBS.tap.lanes.length === 4 && /calendar/.test(b.textContent) });
        }
        return out;
      });
      for (const x of r) {
        t.ok(!x.err && x.ok, `${x.v} ${x.lb}: drawn with its new parts`);
        t.ok(x.ms < 1500, `${x.v} ${x.lb}: ${x.ms.toFixed(0)} ms`);
      }
      console.log('       timings', r.map(x => `${x.v}/${x.lb} ${x.ms.toFixed(0)}ms`).join(' '));
      t.noErrors(page);
    }
  }
];
