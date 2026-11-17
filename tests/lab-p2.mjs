// Observatory review, usefulness (P2) of Edge check, Range cone and Exit lab (lab3, 24.10.2026): points 33, 34, 36, 38, 39, 40.
// Closed market: Saturday 24.10.2026 (FX shut); open: Wednesday 21.10.2026 14:00 UTC.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z');
const boot = async (app, clock = WED) => { const page = await app('', { clock }); await page.evaluate(() => loadLazy()); return page; };
async function obsApp(app, clock = WED, path = '') {
  const page = await app(path, { clock, demo: /demo=1/.test(path) });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => { await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200)); });
  return page;
}

export const tests = [
  /* ---------------- 33. Edge check: the sample size ---------------- */
  {
    name: 'LABP2 33 · Edge check says how much history and how many cases per test (from the data)',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        LAB.scanKey = ''; const b = document.createElement('div'); drawScan(b, { scH: 8, scF: 'all' });
        // recomputed here, independently of scRun: every signal × pair test with enough bars
        let lo = Infinity, hi = -Infinity, bars = 0;
        for (const p of Engine.PAIRS) {
          const k = scBars(p.sym); if (k.length < 150) continue; bars = Math.max(bars, k.length);
          const { out, C } = scSignals(k), T = k.map(x => x.time);
          for (const s in SC_SIG) { const n = scEvidence(out[s], C, 8, false, T).n; lo = Math.min(lo, n); hi = Math.max(hi, n); }
        }
        return { txt: b.querySelector('.sc-verdict > span').textContent, all: b.textContent, lo, hi, days: bars * 15 / 1440 };
      });
      const m = r.txt.match(/([\d.]+) trading days of 15-minute bars: (\d+)–(\d+) cases per test/);
      t.ok(!!m, 'the sample size is in the verdict: ' + r.txt);
      if (m) {
        t.eq(+m[2], r.lo, 'fewest cases of any test');
        t.eq(+m[3], r.hi, 'most cases of any test');
        t.near(+m[1], r.days, 'trading days covered by the bars', 0, .051);
      }
      t.noErrors(page);
    }
  },
  /* ---------------- 34. Edge check: "live now" with the market closed ---------------- */
  {
    name: 'LABP2 34 · market closed: "live now" becomes the last signal before the close, at the real bar time',
    async run({ t, app }) {
      const page = await boot(app, SAT);
      const r = await page.evaluate(() => {
        LAB.scanKey = ''; const b = document.createElement('div'); drawScan(b, { scH: 8, scF: 'all' });
        let last = 0; for (const p of Engine.PAIRS) { const k = scBars(p.sym); if (k.length >= 150) last = Math.max(last, k.at(-1).time); }
        const d = new Date(last * 1000);
        return { h: b.querySelector('.sc-live .sc-h').textContent, all: b.textContent, want: `${['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]} ${d.toISOString().slice(11, 16)} UTC`, open: mktState('EURUSD').open };
      });
      t.ok(!r.open, 'premise: FX closed on Saturday');
      t.ok(r.want.startsWith('Fri '), 'the last closed bar is on Friday: ' + r.want);
      t.ok(r.h.includes(`last signal before the close (${r.want})`), 'header: ' + r.h);
      t.ok(!/live now/.test(r.all), 'no "live now" while closed');
      t.noErrors(page);
      const p2 = await boot(app, WED);
      const o = await p2.evaluate(() => { LAB.scanKey = ''; const b = document.createElement('div'); drawScan(b, { scH: 8, scF: 'all' }); return b.querySelector('.sc-live .sc-h').textContent; });
      t.ok(/live now/.test(o) && !/before the close/.test(o), 'open market: live now · ' + o);
      t.noErrors(p2);
    }
  },
  /* ---------------- 36. Range cone: pending orders at the band edges ---------------- */
  {
    name: 'LABP2 36 · Range cone loads a pending limit at the band edges (bid/ask right), never submits',
    async run({ t, app }) {
      const page = await obsApp(app);
      const r = await page.evaluate(async () => {
        S.set.sym = 'GBPJPY'; S.tk.side = 'buy'; S.tk.ot = 'market'; S.tk.price = null;
        const c = obsCfg(); c.view = 'cone'; c.cnH = 240; c.cnMode = 'model'; LAB.coneKey = ''; renderObs(); obsDraw();
        await new Promise(r => setTimeout(r, 100));
        const btns = [...document.querySelectorAll('#obsBody [data-cn-ord]')].map(b => ({ k: b.dataset.cnOrd, px: +b.dataset.cnPx, txt: b.textContent, tip: b.dataset.tip || '' }));
        const M0 = LAB.cnM, end = M0.a.length - 1, px = M0.a[end].close, f = cnRegime(M0, end), sH = Math.sqrt(cnVarPath(M0, M0.a[end].time, 240, f).at(-1)[1]);
        const q = Engine.quote('GBPJPY'), sp = q.ask - q.bid, dg = M('GBPJPY').digits, rd = v => +v.toFixed(dg);
        const want = { 'buy|68': rd(px * Math.exp(-sH) + sp), 'sell|68': rd(px * Math.exp(sH)), 'buy|95': rd(px * Math.exp(-1.96 * sH) + sp), 'sell|95': rd(px * Math.exp(1.96 * sH)) };
        const nOrd = S.orders.length;
        // the sell limit at the 95% edge
        document.querySelector('#obsBody [data-cn-ord="sell|95"]').click();
        await new Promise(r => setTimeout(r, 50));
        const toasts = [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent);
        return { btns, want, tk: { side: S.tk.side, ot: S.tk.ot, price: S.tk.price }, nOrd, nOrd2: S.orders.length, toasts, priceIn: document.getElementById('tkPrice').value, otOn: document.querySelector('#otSeg .on')?.dataset.ot, sideOn: document.querySelector('#sideSeg .on')?.dataset.side };
      });
      t.eq(r.btns.length, 4, 'four pending-order buttons: ' + r.btns.map(b => b.txt).join(' | '));
      for (const b of r.btns) {
        t.near(b.px, r.want[b.k], `${b.k}: price from the band, bid/ask aware`, 1e-9);
        const [side, band] = b.k.split('|');
        t.ok(b.txt.includes(`${side === 'buy' ? 'Buy' : 'Sell'} limit`) && b.txt.includes(`${band}%`), 'label names the order type and the band: ' + b.txt);
        t.ok(/ask|bid/.test(b.tip), 'tooltip explains the bid/ask: ' + b.tip.slice(0, 120));
      }
      t.eq(r.tk.side, 'sell', 'ticket side loaded');
      t.eq(r.tk.ot, 'limit', 'ticket order type loaded');
      t.near(r.tk.price, r.want['sell|95'], 'ticket price loaded', 1e-9);
      t.eq(r.otOn, 'limit', 'ticket shows Limit'); t.eq(r.sideOn, 'sell', 'ticket shows Sell');
      t.near(+r.priceIn, r.want['sell|95'], 'price field shows it', 1e-6);
      t.eq(r.nOrd2, r.nOrd, 'nothing submitted');
      t.ok(r.toasts.some(x => /Sell limit loaded/.test(x) && /review, then submit/.test(x)), 'toast: ' + r.toasts.join(' / '));
      t.noErrors(page);
    }
  },
  /* ---------------- 38. Exit lab: by exit type ---------------- */
  {
    name: 'LABP2 38a · close reasons map to exit types',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => Object.fromEntries(['Manual', 'Close', 'Partial close', 'Reversed', 'Basket close', 'Stop loss', 'Basket stop', 'Stop loss (break-even)', 'Break-even', 'Trailing stop', 'Basket trail',
        'Take profit', 'Take profit 2', 'Take profit · limit at a loss', 'Basket target', 'Time stop', 'Stop-out', 'Stop-out (challenge breach)', undefined].map(x => [String(x), exKind(x)])));
      const want = { Manual: 'manual', Close: 'manual', 'Partial close': 'manual', Reversed: 'manual', 'Basket close': 'manual', 'Stop loss': 'sl', 'Basket stop': 'sl', 'Stop loss (break-even)': 'be', 'Break-even': 'be', 'Trailing stop': 'trail', 'Basket trail': 'trail',
        'Take profit': 'tp', 'Take profit 2': 'tp', 'Take profit · limit at a loss': 'tp', 'Basket target': 'tp', 'Time stop': 'time', 'Stop-out': 'so', 'Stop-out (challenge breach)': 'so', undefined: 'manual' };
      for (const k in want) t.eq(r[k], want[k], `"${k}" → ${want[k]}`);
      t.noErrors(page);
    }
  },
  {
    name: 'LABP2 38b · Exit lab table by exit type: n, total, average, win rate, best rule on the same trades; n < 3 is too few',
    async run({ t, app }) {
      const page = await obsApp(app, WED, '?demo=1');
      await page.waitForFunction(() => S.history.length > 50, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        const c = obsCfg(); c.view = 'exit'; c.exSrc = 'mine'; c.exR = 'stop';
        // a known mix of reasons on the replayed trades: 2 time stops (too few), the rest as recorded
        const T0 = exTrades(false); T0.forEach(h => h.rows.forEach(x => { x.reason = 'Manual'; }));
        T0.slice(0, 2).forEach(h => h.rows.forEach(x => { x.reason = 'Time stop'; }));
        T0.slice(2, 12).forEach(h => h.rows.forEach(x => { x.reason = 'Stop loss'; }));
        LAB.exitKey = ''; renderObs(); obsDraw(); await new Promise(r => setTimeout(r, 100));
        const X = LAB.exit, best = X.stats.slice(1).slice().sort((a, b) => b.sumR - a.sumR)[0].k;
        const grp = {}; for (const x of X.per) { const k = exKind(x.h.reason); (grp[k] = grp[k] || []).push(x); }
        const exp = Object.fromEntries(Object.entries(grp).map(([k, a]) => [k, { n: a.length, sum: a.reduce((s, x) => s + x.act, 0), win: a.filter(x => x.act > 0).length / a.length * 100, best: a.reduce((s, x) => s + x.alt[best], 0) }]));
        const rows = [...document.querySelectorAll('#obsBody .ex-kind tbody tr')].map(tr => ({ k: tr.dataset.exKind, cells: [...tr.cells].map(td => td.textContent.trim()) }));
        const head = [...document.querySelectorAll('#obsBody .ex-kind thead th')].map(x => x.textContent);
        return { rows, exp, head, bestName: EX_POL.find(p => p[0] === best)[1], cap: document.querySelector('#obsBody .ex-kind-w')?.textContent || '' };
      });
      t.ok(r.rows.length >= 3, 'a row per exit type present: ' + r.rows.map(x => x.k).join(','));
      t.ok(r.head.some(h => h.includes(r.bestName)), 'the best rule is named in its column: ' + r.head.join(' | '));
      const num = s => +s.replace('−', '-').replace(/[^\d.+-]/g, '');
      for (const row of r.rows) {
        const e = r.exp[row.k]; t.ok(!!e, 'row for a type that exists: ' + row.k); if (!e) continue;
        t.eq(+row.cells[1], e.n, `${row.k}: n`);
        if (e.n < 3) { t.ok(row.cells.slice(2).join(' ').includes('too few'), `${row.k}: n ${e.n} shown as too few · ${row.cells.join(' | ')}`); continue; }
        t.near(num(row.cells[2]), e.sum, `${row.k}: total R`, 0, .051);
        t.near(num(row.cells[3]), e.sum / e.n, `${row.k}: average R`, 0, .0051);
        t.near(num(row.cells[4]), e.win, `${row.k}: win rate`, 0, .51);
        t.near(num(row.cells[5]), e.best, `${row.k}: best rule on the same trades`, 0, .051);
      }
      t.ok(r.rows.some(x => x.k === 'time'), 'Time stop row present'); t.ok(r.rows.some(x => x.k === 'sl'), 'Stop loss row present');
      t.ok(/where/i.test(r.cap), 'the table says what it is for: ' + r.cap.slice(0, 160));
      t.noErrors(page);
    }
  },
  /* ---------------- 39. Exit lab: R = volatility warning ---------------- */
  {
    name: 'LABP2 39 · R = volatility shows a visible warning that the trades carry different risks',
    async run({ t, app }) {
      const page = await obsApp(app);
      const r = await page.evaluate(async () => {
        LAB.sample = exMakeSample(); const c = obsCfg(); c.view = 'exit'; c.exSrc = 'sample';
        const get = async m => { c.exR = m; LAB.exitKey = ''; renderObs(); obsDraw(); await new Promise(r => setTimeout(r, 50)); const w = document.querySelector('#obsBody .ex-volwarn'); return w ? { txt: w.textContent, vis: w.getBoundingClientRect().height > 0 } : null; };
        return { vol: await get('vol'), stop: await get('stop') };
      });
      t.ok(r.vol && r.vol.vis, 'warning visible in R = volatility');
      t.ok(r.vol && /different risks/.test(r.vol.txt) && /shape, not (?:the )?size/.test(r.vol.txt), 'warning text: ' + (r.vol && r.vol.txt));
      t.ok(!r.stop, 'no warning in R = my stop');
      t.noErrors(page);
    }
  },
  /* ---------------- 40. Exit lab: truncated tables and the 200 cap ---------------- */
  {
    name: 'LABP2 40 · "Showing 12 of N" and the 200-trade cap are said',
    async run({ t, app }) {
      const page = await obsApp(app, WED, '?demo=1');
      await page.waitForFunction(() => S.history.length > 50, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        // 204 closed trades: the demo's, repeated with fresh ids, newest first as the journal keeps them
        const base = S.history.filter(h => !h.nbp && h.side !== 'nbp' && Engine.META[h.sym]), rows = [];
        let id = 900000; while (rows.length < 204) for (const h of base) { if (rows.length >= 204) break; rows.push({ ...h, id: id++ }); }
        S.history = rows;
        const c = obsCfg(); c.view = 'exit'; c.exSrc = 'mine'; c.exR = 'stop'; LAB.exitKey = ''; renderObs(); obsDraw(); await new Promise(r => setTimeout(r, 100));
        const all = document.getElementById('obsBody').textContent, per = document.querySelector('#obsBody .ex-per-cap')?.textContent || '';
        return { all, per, n: exTrades(false).length, used: LAB.exit.used.length, ids: exTrades(false).slice(0, 3).map(h => h.id) };
      });
      t.eq(r.n, 200, 'replay capped at 200');
      t.eq(r.ids[0], 900000, 'the most recent first');
      t.ok(r.all.includes('the 200 most recent of 204'), 'cap said: ' + (r.all.match(/[^.]*most recent[^.]*/) || [''])[0]);
      t.ok(r.per.includes(`Showing 12 of ${r.used}`), 'per-trade table says it is truncated: ' + r.per);
      t.noErrors(page);
    }
  }
];
