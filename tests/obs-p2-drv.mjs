// Observatory, usefulness (P2) for Recurrence and Drivers (review 24.10, task obs6b).
// Recurrence says the regime now: how often the last RP_NOW_W states recur among the other states of the window,
// ranked against every stretch of the same length (n said), with the size of their moves; at 1H it warns that the
// window has too few states for stable measures. Drivers gets a window switch (1H / 4H / 1D, a soft setting) and
// every text follows it; an open exotic pair shows its exotic currency on the board, measured through USD and marked;
// a pair led by one currency links to the pair that isolates that currency best now (the other leg the calmest).
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z');
async function obsApp(app, clock) {
  const page = await app('', { clock });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = { show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); } };
  });
  return page;
}
// the regime now recomputed from the states the view used (OBS.rpIn): recurrence of each stretch against the states
// outside it, at the view's threshold
const RP_NOW_CHECK = () => {
  const r = OBS.rpIn, m = 3, A = rpBuild(r, m), N = A.N, W = RP_NOW_W, out = [];
  for (let s = 0; s + W <= N; s++) {
    let k = 0; for (let i = s; i < s + W; i++) for (let j = 0; j < N; j++) if ((j < s || j >= s + W) && A.Rb[i * N + j]) k++;
    let a = 0; for (let i = s; i < s + W; i++) a += Math.abs(r[i + m - 1]);
    out.push({ rr: k / (W * (N - W)), sz: a / W });
  }
  const now = out[out.length - 1], all = r.slice(m - 1).reduce((x, v) => x + Math.abs(v), 0) / (r.length - m + 1);
  return { N, W, rr: now.rr, rank: out.filter(x => x.rr < now.rr).length / out.length, nB: out.length, size: now.sz / all };
};

export const tests = [
  {
    name: 'OB6-1 Recurrence: the regime now (recurrence of the last states against the other stretches, n, size), closed and open',
    async run({ t, app }) {
      for (const [when, clock] of [['closed', SAT], ['open', WED]]) {
        const page = await obsApp(app, clock);
        const r = await page.evaluate(chk => {
          const lab = rpNowLabel, out = { labels: [lab(.05, 1.4), lab(.95, .7), lab(.5, 1), lab(.05, .8), lab(.95, 1.3), lab(.05, 1.02), lab(.95, .95)] };
          OQ.show('rp', { rpTf: 15, rpMode: 'grad' });
          out.now = JSON.parse(JSON.stringify(OBS.rpNow)); out.want = (0, eval)('(' + chk + ')')();
          const el = document.querySelector('#obsBody .rp-now'); out.txt = el ? el.textContent : ''; out.tip = el ? el.querySelector('[data-tip]')?.dataset.tip || '' : '';
          out.cls = el ? el.innerHTML : '';
          return out;
        }, RP_NOW_CHECK.toString());
        t.deep(r.labels, ['Busier than usual', 'Calmer than usual', 'Usual', 'Unusual states', 'Unusual states', 'Unusual states', 'Unusual states'], `${when}: the label from rank and size (a size within 10% names neither calm nor busy)`);
        t.eq(r.now.w, r.want.W, `${when}: W`); t.eq(r.now.nB, r.want.nB, `${when}: n stretches`);
        t.near(r.now.rr, r.want.rr, `${when}: recurrence rate of the last stretch`, 1e-12);
        t.near(r.now.rank, r.want.rank, `${when}: its rank among the stretches`, 1e-12);
        t.near(r.now.size, r.want.size, `${when}: the size of its moves`, 1e-9);
        t.ok(r.txt.includes('Regime now'), `${when}: the block is there: ` + r.txt);
        t.ok(r.txt.includes(r.now.label), `${when}: the label is shown: ` + r.now.label);
        t.ok(r.txt.includes(`last ${r.want.W} states`) && r.txt.includes((r.want.rr * 100).toFixed(1) + '%'), `${when}: W and the rate are shown: ` + r.txt);
        t.ok(r.txt.replace(/,/g, '').includes(`n = ${r.want.nB}`), `${when}: n is shown: ` + r.txt);
        t.ok(r.txt.includes(`×${r.want.size.toFixed(2)}`), `${when}: the size is shown: ` + r.txt);
        t.ok(/not a forecast/.test(r.txt), `${when}: says it describes, not forecasts`);
        t.ok(!/\b(up|dn)\b/.test(r.cls.match(/class="[^"]*"/g)?.join(' ') || ''), `${when}: no up/down colours on a non-directional reading`);
        t.noErrors(page);
      }
    }
  },
  {
    name: 'OB6-2 Recurrence: at 1H the window has too few states and says so; 5m and 15m do not',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        for (const tf of [5, 15, 60]) {
          OQ.show('rp', { rpTf: tf });
          const N = OBS.rpIn.length - 3 + 1, w = document.querySelector('#obsBody .rp-thin');
          out[tf] = { N, txt: w ? w.textContent : '', role: w ? w.getAttribute('role') : null };
        }
        out.min = RP_THIN;
        return out;
      });
      t.ok(r[60].N < r.min, '1H has fewer states than the minimum: ' + r[60].N);
      t.ok(r[60].txt.includes(`Only ${r[60].N} states: too few for stable measures`), '1H warns: ' + r[60].txt);
      t.ok(r[5].N >= r.min && r[15].N >= r.min, '5m/15m have enough states');
      t.eq(r[5].txt, '', '5m: no warning'); t.eq(r[15].txt, '', '15m: no warning');
      t.noErrors(page);
    }
  },
  {
    name: 'OB6-3 Drivers: window 1H / 4H / 1D (soft setting), board, verdict and baseline follow the chosen window',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); delete obsCfg().drvW;
        const out = { soft: OBS_SOFT.drvW, known: 'drvW' in SHAPES.obs };
        OQ.show('drv');
        out.btns = [...document.querySelectorAll('#obsCtrl [data-k="drvW"] button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : ''));
        out.tips = [...document.querySelectorAll('#obsCtrl [data-k="drvW"] button')].map(b => b.dataset.tip || '');
        const read = () => {
          const b = document.getElementById('obsBody'), N = Math.min(4321, Engine.candles[Engine.PAIRS[0].sym].length), P = ccyPaths(N);
          const bs = P._t.map((_, i) => Engine.ALL.reduce((s, c) => s + P[c][i], 0) / Engine.ALL.length), z = N - 1, w = obsCfg().drvW ?? OBS_SOFT.drvW, n = Math.min(w, N - 1);
          const want = Object.fromEntries(Engine.ALL.map(c => [c, (P[c][z] - P[c][z - n]) - (bs[z] - bs[z - n])]));
          return { side: b.querySelector('.obs-side').textContent, verdict: b.querySelector('.drv-verdict').textContent, sv: { ...OBS.drv.sv }, want, base: { ...OBS.drv.base }, w };
        };
        out.d = read();
        document.querySelector('#obsCtrl [data-k="drvW"] [data-val="1440"]').click(); out.cfg = obsCfg().drvW; out.D = read();
        document.querySelector('#obsCtrl [data-k="drvW"] [data-val="60"]').click(); out.H = read();
        out.btnsH = [...document.querySelectorAll('#obsCtrl [data-k="drvW"] button')].map(b => b.textContent + (b.classList.contains('on') ? '*' : ''));
        return out;
      });
      t.eq(r.soft, 240, 'default 4H'); t.eq(r.known, false, 'a soft setting: sanitizeState does not know it');
      t.deep(r.btns, ['1H', '4H*', '1D'], 'the switch with 4H on'); t.deep(r.btnsH, ['1H*', '4H', '1D'], 'the switch follows the click');
      t.ok(r.tips.every(x => /\|/.test(x) && /trading/.test(x)), 'each button has a tip: ' + r.tips.join(' / '));
      t.eq(r.cfg, 1440, 'the click sets 1D');
      for (const [x, lab, span, adj] of [[r.d, '4h', '4 hours', '4-hour'], [r.D, '24h', '24 hours', '1-day'], [r.H, '1h', 'hour', '1-hour']]) {
        for (const c of Object.keys(x.want)) t.near(x.sv[c], x.want[c], `${lab}: ${c} on the board`, 1e-9, 1e-12);
        t.ok(x.side.includes(`last ${lab} of trading vs basket`), `${lab}: board label: ` + x.side.slice(0, 80));
        t.ok(!/last 4h/.test(x.side) || lab === '4h', `${lab}: no 4h left in the side panel`);
        t.ok(/Over the last/.test(x.verdict) ? x.verdict.includes(`Over the last ${span} of trading`) : true, `${lab}: verdict span: ` + x.verdict.slice(0, 120));
        if (x.base.n >= 4) t.ok(x.verdict.includes(`earlier ${adj} windows of trading`), `${lab}: the baseline uses ${adj} windows: ` + x.verdict);
        else t.ok(x.verdict.includes(`Only ${x.base.n} earlier ${adj} window`), `${lab}: a thin baseline is said: ` + x.verdict);
      }
      t.ok(!/In the last hour of trading/.test(r.H.verdict), '1H: no "last hour took over" line (it is the window itself)');
      t.noErrors(page);
    }
  },
  {
    name: 'OB6-4 Drivers: an open exotic pair puts its exotic currency on the board, measured through USD and marked',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const G = Engine.ALL, ex = Engine.FX.filter(p => !G.includes(p.base) || !G.includes(p.quote)).filter(p => G.includes(p.base) || G.includes(p.quote));
        const pick = [ex.find(p => p.base === 'USD' || p.quote === 'USD'), ex.find(p => p.base !== 'USD' && p.quote !== 'USD')].filter(Boolean);
        const out = { picks: pick.map(p => p.sym), rows: [] };
        setSymbol('EURUSD'); OQ.show('drv', { drvW: 240 }); out.n0 = OBS.drv.n; out.rows0 = document.querySelectorAll('#obsBody .cb-ext').length;
        for (const p of pick) {
          setSymbol(p.sym); OQ.show('drv', { drvW: 240 });
          const X = G.includes(p.base) ? p.quote : p.base, row = document.querySelector('#obsBody .cb-ext');
          // X against USD over the window, from the USD/X pair (or the open cross and its major leg), then against the basket
          const N = Math.min(4321, Engine.candles[Engine.PAIRS[0].sym].length), P = ccyPaths(N), z = N - 1, n = Math.min(240, N - 1);
          const bs = P._t.map((_, i) => G.reduce((s, c) => s + P[c][i], 0) / G.length);
          const u = Engine.FX.find(q => (q.base === X && q.quote === 'USD') || (q.base === 'USD' && q.quote === X)), a = Engine.candles[u.sym], k = a.length - 1;
          const vsUsd = (u.base === X ? 1 : -1) * Math.log(a[k].close / a[k - n].close), vsB = vsUsd - (bs[z] - bs[z - n]);
          out.rows.push({ sym: p.sym, X, txt: row ? row.textContent : '', ccy: row?.dataset.ccy, tip: row?.dataset.tip || '', got: OBS.drv.ext ? { ...OBS.drv.ext } : null, vsUsd, vsB, want: obsBp(vsB), usdTxt: obsBp(vsUsd), n: OBS.drv.n, sv: Object.keys(OBS.drv.sv), times: a[k].time === Engine.candles.EURUSD.at(-1).time });
        }
        return out;
      });
      t.ok(r.picks.length === 2, 'an exotic pair with USD and an exotic cross: ' + r.picks);
      t.eq(r.rows0, 0, 'a G8 pair: no exotic row');
      for (const x of r.rows) {
        t.ok(x.times, `${x.sym}: the USD pair shares the FX timeline`);
        t.eq(x.ccy, x.X, `${x.sym}: the row is ${x.X}`);
        t.near(x.got.vsUsd, x.vsUsd, `${x.sym}: ${x.X} against USD`, 1e-6, 1e-9);
        t.near(x.got.v, x.vsB, `${x.sym}: ${x.X} against the basket (through USD)`, 1e-6, 1e-9);
        t.ok(x.txt.includes(x.want), `${x.sym}: the row shows ${x.want}: ` + x.txt);
        t.ok(/outside the eight/i.test(x.txt) || /outside the eight/i.test(x.tip), `${x.sym}: marked as outside the eight: ` + x.txt);
        t.ok(/USD/.test(x.tip) && x.tip.includes(x.usdTxt), `${x.sym}: the tip gives its move against USD: ` + x.tip);
        t.eq(x.n, r.n0, `${x.sym}: the widest-gap pool stays the pairs between the eight`);
        t.ok(!x.sv.includes(x.X), `${x.sym}: ${x.X} stays out of the basket and the strongest/weakest`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'OB6-5 Drivers: the pair that isolates the leading currency (other leg the calmest), with a button that opens it',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        // the pick on known values: USD led; EUR the calmest currency with a pair against USD
        const sv = { USD: 12e-4, EUR: .5e-4, GBP: -1e-4, JPY: -6e-4, CHF: -.2e-4, AUD: 3e-4, CAD: -4e-4, NZD: -4.3e-4 };
        out.pure = drvIso('USD', sv); out.pure2 = drvIso('JPY', sv); out.pureX = drvIso('ZZZ', sv);
        // a pair and a window where the open pair has a leader
        let hit = null;
        for (const p of Engine.PAIRS) { for (const w of [240, 60, 1440]) { setSymbol(p.sym); OQ.show('drv', { drvW: w }); if (OBS.drv.iso) { hit = { sym: p.sym, w }; break; } } if (hit) break; }
        out.hit = hit; if (!hit) return out;
        const b = document.getElementById('obsBody'), el = b.querySelector('.drv-iso');
        out.iso = { ...OBS.drv.iso }; out.txt = el ? el.textContent : ''; out.sv = { ...OBS.drv.sv };
        out.want = drvIso(OBS.drv.iso.lead, OBS.drv.sv);
        const has = (a, c) => Engine.FX.some(q => (q.base === a && q.quote === c) || (q.base === c && q.quote === a));
        out.calm = Object.keys(OBS.drv.sv).filter(c => c !== OBS.drv.iso.lead && has(c, OBS.drv.iso.lead)).every(c => Math.abs(OBS.drv.sv[c]) >= Math.abs(OBS.drv.sv[OBS.drv.iso.other]));
        const btn = el && el.querySelector('[data-sym]'); out.btn = btn ? btn.dataset.sym : null;
        if (btn && btn.dataset.sym !== S.set.sym) { btn.click(); out.after = S.set.sym; }
        return out;
      });
      t.deep(r.pure, { lead: 'USD', sym: 'USDCHF', other: 'CHF' }, 'USD led: CHF moved least, USD/CHF isolates USD');
      t.deep(r.pure2, { lead: 'JPY', sym: 'CHFJPY', other: 'CHF' }, 'JPY led: CHF/JPY (a cross) when CHF is the calmest');
      t.eq(r.pureX, null, 'a currency with no pair: nothing to link');
      t.ok(r.hit, 'some pair has a leader on some window');
      t.deep(r.iso, r.want, 'the shown pick is drvIso of the board');
      t.ok(r.calm, 'the other leg is the calmest of the currencies with a pair against the leader');
      t.ok(r.txt.includes(`${r.iso.lead} led:`) && r.txt.includes('isolates it best now'), 'the line: ' + r.txt);
      if (r.iso.sym === r.hit.sym) t.ok(r.btn === null && /this pair/.test(r.txt), 'the open pair isolates it: said, no button');
      else t.eq(r.btn, r.iso.sym, 'the button opens that pair');
      if (r.after) t.eq(r.after, r.iso.sym, 'the click opened it');
      t.ok(/not a trade idea|describes/i.test(r.txt), 'descriptive wording: ' + r.txt);
      t.noErrors(page);
    }
  }
];
