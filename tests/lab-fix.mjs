// Lab errors of the Observatory review (24.10.2026): Exit lab, Edge check, Range cone.
// Closed market: Saturday 24.10.2026 (FX shut, BTC 24/7); open: Wednesday 21.10.2026 14:00 UTC.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z'), WED7 = new Date('2026-10-21T14:07:00Z');
const boot = async (app, clock) => { const page = await app('', { clock }); await page.evaluate(() => loadLazy()); return page; };

export const tests = [
  /* ---------------- Exit lab ---------------- */
  {
    name: 'LABFIX exit 1 · consistency filter: fills at the ask, news spread and max deviation are kept; the reason shown is the real one',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        T.reset(); let id = 1, seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const rows = [];
        for (const sym of ['EURUSD', 'GBPJPY', 'GOLD', 'BTCUSD', 'BCHEUR']) {
          const m = M(sym), a = Engine.candles[sym], pt = m.point, sp = (m.p.spread[2] + (m.p.jit ? m.p.jit[2][1] : 0)) * pt, dev = m.p.maxDev * pt * .95;
          for (let k = 0; k < 8; k++) {
            const i = 400 + Math.floor(rnd() * (a.length - 600)), j = i + 20 + Math.floor(rnd() * 40), side = k % 2 ? 'sell' : 'buy', d = side === 'buy' ? 1 : -1;
            // a buy fills at the ask (bid bar + news spread) plus slippage; a sell exits at the ask the same way
            const entry = d > 0 ? a[i].high + sp + dev : a[i].low - dev, exit = d > 0 ? a[j].low - dev : a[j].high + sp + dev;
            rows.unshift({ id: id++, sym, side, lots: .1, entry, exit, open: a[i].time + 30, close: a[j].time + 30, pips: d * (exit - entry) / m.pip, pnl: 1, comm: 0, swap: 0, sl0: entry - d * 30 * m.pip, reason: 'Manual' });
          }
        }
        const good = exRun(tradesOf(rows), 'stop');
        // one trade far off the path is still left out, and says why
        const a = Engine.candles.EURUSD, bad = { id: 999, sym: 'EURUSD', side: 'buy', lots: .1, entry: a[3000].close * 1.03, exit: a[3050].close, open: a[3000].time + 5, close: a[3050].time + 5, pips: 1, pnl: 1, comm: 0, sl0: a[3000].close * 1.03 - .002, reason: 'Manual' };
        S.history = [bad, ...rows]; LAB.exitKey = ''; const b = document.createElement('div'); drawExit(b, { exR: 'stop', exSrc: 'mine' });
        return { off: good.skip.off, used: good.used.length, n: rows.length, txt: b.textContent, offBad: LAB.exit.skip.off };
      });
      t.eq(r.off, 0, 'no trade filled at the ask / with max deviation is left out');
      t.eq(r.used, r.n, 'every trade replayed');
      t.eq(r.offBad, 1, 'the off-path trade is left out');
      t.ok(/not on the bar path beyond spread \+ tolerance/.test(r.txt), 'real reason shown: ' + r.txt.slice(0, 300));
      t.ok(!/older simulated sessions/.test(r.txt), 'no "older sessions" claim');
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX exit 1b · the demo history replays with at most a few trades left out',
    async run({ t, app }) {
      const page = await app('?demo=1', { clock: WED, demo: true });
      await page.waitForFunction(() => S.history.length > 50, null, { timeout: 30000 });
      const r = await page.evaluate(async () => {
        await loadLazy(); const T0 = exTrades(false), x = exRun(T0, 'stop');
        // the ones left out: the demo opens some trades while the market is closed (at Friday's close) or fills a stop
        // gapped through at the reopening at its level; those prices are genuinely not on the path
        const odd = T0.filter(h => exRun([h], 'stop').skip.off).map(h => { const a = Engine.candles[h.sym]; let j = a.length - 1; while (j > 0 && a[j].time > h.close) j--; return { closedOpen: !Engine.isOpen(h.sym, h.open), gapExit: j > 0 && a[j].time - a[j - 1].time > GAP_S }; });
        return { n: T0.length, off: x.skip.off, used: x.used.length, odd };
      });
      t.ok(r.n >= 100, 'demo trades: ' + r.n);
      t.ok(r.off <= 5, `demo trades left out by the consistency filter: ${r.off} of ${r.n} (83 of 200 before)`);
      t.ok(r.odd.every(o => o.closedOpen || o.gapExit), 'every one left out opened on a closed market or exited across a gap: ' + JSON.stringify(r.odd));
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX exit 2 · time stop counts open-market minutes across a gap (−1R, not +0.60R)',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const a = [], bar = (time, o, h, l, c) => a.push({ time, open: o, high: h, low: l, close: c });
        for (let i = 0; i < 30; i++) bar(i * 60, 100, 100, 100, 100);           // 30 minutes before the close
        const re = 30 * 60 + 3000 * 60;                                         // reopens 50 hours later
        for (let i = 0; i < 100; i++) { const p = i < 5 ? 99.7 : i === 5 ? 99.6 : i < 20 ? 99.8 : 100.3; bar(re + i * 60, p, p + .05, i === 5 ? 99.4 : p - .05, p); }
        const ts = exSim(a, 0, 'buy', 100, .5, 'ts1'), hold = exSim(a, 0, 'buy', 100, .5, 'hold');
        // no stop touched: the time stop exits at the close of the 60th open minute (30 before + 30 after the gap)
        const b = a.map(k => ({ ...k, low: Math.max(k.low, 99.6) })), ts2 = exSim(b, 0, 'buy', 100, .5, 'ts1');
        return { ts, hold, ts2, want2: b[59].close };
      });
      t.near((r.ts.x - 100) / .5, -1, 'stop hit after the gap: −1R', 1e-9, 1e-9);
      t.ok(r.ts.m <= 60, 'within 60 open minutes: ' + r.ts.m);
      t.near(r.ts2.x, r.want2, 'time stop exits at the close of the 60th open minute', 1e-9, 1e-9);
      t.eq(r.ts2.m, 60, '60 open minutes held');
      t.near((r.hold.x - 100) / .5, -1, 'hold: the same stop', 1e-9, 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX exit 3 · R→$ from pipValue and the stop distance, never from pnl (swap) or a fallback',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const out = [];
        for (const [sym, pips] of [['GBPJPY', 0], ['GOLD', 37], ['EURCHF', 12], ['BTCUSD', 0]]) {
          const m = M(sym); if (!m) continue;
          const a = Engine.candles[sym], i = a.length - 900, j = i + 200, d = -1;
          // pnl carries a large swap; pips 0 sent the old code to a quote-currency fallback
          const h = { id: 1, sym, side: 'sell', lots: 2, entry: a[i].close, exit: a[j].close, open: a[i].time + 10, close: a[j].time + 10, pips, pnl: -4321, swap: -4400, comm: 7, sl0: a[i].close + 25 * m.pip, reason: 'Manual' };
          const x = exRun(tradesOf([h]), 'stop'), p = x.per[0];
          if (!p) { out.push({ sym, skip: x.skip }); continue; }
          const want = p.alt.t2 * p.R * pipValue(sym, 2) / m.pip - 7, got = x.stats.find(s => s.k === 't2').usd;
          out.push({ sym, want, got });
        }
        return out;
      });
      t.ok(r.length >= 3, 'instruments tested: ' + JSON.stringify(r));
      for (const x of r) { t.ok(!x.skip, x.sym + ' replayed: ' + JSON.stringify(x.skip)); t.near(x.got, x.want, `${x.sym} rule P&L in $`, 1e-9, 1e-6); }
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX exit 4 · a sell exits on the ask (bid + spread), like a buy on the bid',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const a = [], bar = (i, o, h, l, c) => a.push({ time: i * 60, open: o, high: h, low: l, close: c });
        for (let i = 0; i < 10; i++) bar(i, 100, 100, 100, 100);
        bar(10, 100, 100, 98.95, 99.5); for (let i = 11; i < 40; i++) bar(i, 99.5, 99.5, 99.5, 99.5);
        const tgt = exSim(a, 0, 'sell', 100, 1, 't1', 1, undefined, .1);
        const b = [], bb = (i, o, h, l, c) => b.push({ time: i * 60, open: o, high: h, low: l, close: c });
        for (let i = 0; i < 10; i++) bb(i, 100, 100, 100, 100); bb(10, 100, 100.95, 100, 100.5); for (let i = 11; i < 40; i++) bb(i, 100.5, 100.5, 100.5, 100.5);
        const stop = exSim(b, 0, 'sell', 100, 1, 't3', 1, undefined, .1);
        // exRun passes the instrument's spread: a sell held 24h is marked at the ask
        const sym = 'GBPJPY', m = M(sym), c = Engine.candles[sym], i = c.length - 3000;
        const h = { id: 1, sym, side: 'sell', lots: 1, entry: c[i].close, exit: c[i + 60].close + m.p.spread[0] * m.point, open: c[i].time + 5, close: c[i + 60].time + 5, pips: 0, pnl: 0, comm: 0, sl0: c[i].close + 5, reason: 'Manual' };
        const x = exRun(tradesOf([h]), 'stop'), s = exSim(c, x.per[0] ? i + 1 : i, 'sell', h.entry, x.per[0]?.R || 1, 'hold', 1, undefined, m.p.spread[0] * m.point), s0 = exSim(c, i + 1, 'sell', h.entry, x.per[0]?.R || 1, 'hold');
        return { tgt, stop, sp: m.p.spread[0] * m.point, diff: s.x - s0.x, live: s.live };
      });
      t.ok(r.tgt.x !== 99, 'the bid touching the target is not a sell fill: ' + JSON.stringify(r.tgt));
      t.near(r.tgt.x, 99.6, 'marked at the ask (99.5 + 0.1)', 1e-9, 1e-9);
      t.near(r.stop.x, 101, 'the ask reaching the stop stops the sell out', 1e-9, 1e-9);
      t.near(r.diff, r.sp, 'with the spread a sell exits one spread higher', 1e-9, 1e-12);
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX exit 5 · Use: only for rules the ticket can place, with the rule stop (never 20), split and BE set to match',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        T.reset(); S.set.sym = 'EURUSD';
        const x = tkx(); x.split = true; x.be = true; S.tk.useSL = false; S.tk.sl = 0; S.tk.useTrail = false;
        const want = exVolStopPips('EURUSD');
        exUse('t2'); const a = { sl: S.tk.sl, tp: S.tk.tp, useSL: S.tk.useSL, useTP: S.tk.useTP, split: x.split, be: x.be, trail: S.tk.useTrail };
        exUse('be'); const b = { sl: S.tk.sl, tp: S.tk.tp, be: x.be, beAt: x.beAt, beOff: x.beOff, split: x.split };
        S.tk.useSL = true; S.tk.sl = 15; exUse('t1'); const c = { sl: S.tk.sl, tp: S.tk.tp, be: x.be };
        exUse('trail'); const d = { trail: S.tk.trail, useTrail: S.tk.useTrail, useSL: S.tk.useSL, useTP: S.tk.useTP };
        const tpBefore = S.tk.tp; exUse('ts1'); const e = { tp: S.tk.tp, same: S.tk.tp === tpBefore };
        // a trail-only ticket: the trail is its stop (tkCalc), so it is 1R
        S.tk.useSL = false; S.tk.useTrail = true; S.tk.trail = 12; exUse('t2'); const f = { sl: S.tk.sl, tp: S.tk.tp, useTrail: S.tk.useTrail };
        LAB.sample = exMakeSample(); LAB.exitKey = ''; const bx = document.createElement('div'); drawExit(bx, { exR: 'stop', exSrc: 'sample' });
        const rowsOf = k => [...bx.querySelectorAll('.ex-tbl tbody tr')].find(tr => tr.querySelector('b')?.textContent === EX_POL.find(p => p[0] === k)[1]);
        const use = Object.fromEntries(EX_POL.slice(1).map(([k]) => [k, !!rowsOf(k)?.querySelector('[data-ex-use]')]));
        const na = Object.fromEntries(EX_POL.slice(1).map(([k]) => [k, rowsOf(k)?.textContent || '']));
        return { want, a, b, c, d, e, f, use, na };
      });
      t.ok(r.want > 0 && r.want !== 20, 'volatility stop in pips: ' + r.want);
      t.eq(r.a.sl, r.want, 'Target 2R with no ticket stop: the rule stop (volatility), not 20');
      t.eq(r.a.tp, Math.round(r.want * 2 * 10) / 10, 'target 2 × the stop');
      t.ok(r.a.useSL && r.a.useTP && !r.a.split && !r.a.be && !r.a.trail, 'stop + target only: split, BE and trail off ' + JSON.stringify(r.a));
      t.ok(r.b.be && r.b.beAt === r.b.sl && r.b.beOff === 0 && r.b.tp === Math.round(r.b.sl * 30) / 10, 'BE + 3R: BE at 1R to entry, target 3R ' + JSON.stringify(r.b));
      t.ok(r.c.sl === 15 && r.c.tp === 15 && !r.c.be, 'an own ticket stop is 1R ' + JSON.stringify(r.c));
      t.ok(r.d.useTrail && r.d.trail === 15 && !r.d.useSL && !r.d.useTP, 'trail 1R ' + JSON.stringify(r.d));
      t.ok(r.e.same, 'a time stop changes nothing in the ticket');
      t.ok(r.f.sl === 12 && r.f.tp === 24 && !r.f.useTrail, 'a trail-only ticket: the trail is 1R ' + JSON.stringify(r.f));
      t.deep(r.use, { t1: true, t2: true, t3: true, trail: true, be: true, ts1: false, ts4: false, hold: false }, 'Use only where the ticket can place the rule');
      for (const k of ['ts1', 'ts4', 'hold']) t.ok(/time stop/i.test(r.na[k]), `${k} says why not: ${r.na[k]}`);
      t.ok(!/not in the ticket/.test(r.na.be), 'BE is in the ticket: ' + r.na.be);
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX exit 6 · walk-forward: the threshold in the code and in the text is the same number',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const S0 = exMakeSample(), at = n => exRun(S0.slice(0, n), 'stop');
        LAB.sample = S0.slice(0, EX_WF_MIN - 1); LAB.exitKey = ''; const b = document.createElement('div'); drawExit(b, { exR: 'stop', exSrc: 'sample' });
        return { min: EX_WF_MIN, below: at(EX_WF_MIN - 1).wf, at: !!at(EX_WF_MIN).wf, usedAt: at(EX_WF_MIN).used.length, txt: b.textContent };
      });
      t.eq(r.usedAt, r.min, 'all sample trades replayed');
      t.eq(r.below, null, `under ${r.min}: no walk-forward`);
      t.ok(r.at, `${r.min} trades: walk-forward runs`);
      const nums = [...r.txt.matchAll(/(?:at least|under) (\d+) replayed/g)].map(m => +m[1]);
      t.ok(nums.length && nums.every(n => n === r.min), `the text says ${r.min}: ${JSON.stringify(nums)}`);
      t.noErrors(page);
    }
  },
  /* ---------------- Edge check ---------------- */
  {
    name: 'LABFIX scan 1 · the baseline is matched on the hour of the day; the base hit is measured',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
        const T0 = Date.UTC(2026, 9, 12) / 1000, n = 700, T = [], C = [], sig = Array(n).fill(0); let p = 1.1;
        for (let i = 0; i < n; i++) { const t = T0 + i * 900, h = Math.floor((t % 86400) / 3600); T.push(t); p *= Math.exp(g() * (h >= 7 && h < 17 ? 10e-4 : 1.5e-4)); C.push(p); if (h === 2 && (t % 3600) === 0) sig[i] = 2; }
        const e = scEvidence(sig, C, 8, false, T);
        const all = []; for (let i = 0; i + 8 < n; i++) all.push(Math.abs(Math.log(C[i + 8] / C[i])) * 1e4);
        const oldBase = all.reduce((s, v) => s + v, 0) / all.length;
        return { n: e.n, avg: e.avg, baseHit: e.baseHit, oldBase };
      });
      t.ok(r.n >= 5, 'quiet-hour squeezes found: ' + r.n);
      t.ok(Math.abs(r.avg) < .3 * r.oldBase, `the squeeze is measured against its own hour: avg ${r.avg} vs all-hours base ${r.oldBase}`);
      t.ok(r.baseHit > 0 && r.baseHit < 100 && r.baseHit !== 50, 'base hit measured: ' + r.baseHit);
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX scan 2 · one verdict per row: never "survives" and "does not" at once',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => [
        { n: 20, t: -3, fdr: true, stable: true }, { n: 20, t: 2.6, fdr: true, stable: false }, { n: 20, t: 2.6, fdr: false, stable: true },
        { n: 20, t: -2.4, fdr: false, stable: true }, { n: 20, t: 3, fdr: true, stable: true }
      ].map(e => { const [k, label] = scVerdict(e); return { e, k, label, tip: scVtip(k, 40) }; }));
      for (const x of r) {
        const luck = /luck\?/.test(x.label), notSurv = /does not survive|not significant/i.test(x.tip), surv = /survives/i.test(x.tip.replace(/does not survive/gi, ''));
        if (x.e.fdr) t.ok(!luck && !notSurv, `fdr ⇒ no "luck?" / "does not survive": ${JSON.stringify(x)}`);
        else t.ok(!surv, `not fdr ⇒ no "survives": ${JSON.stringify(x)}`);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX scan 3 · the number of tests in the tooltips is computed',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const b = document.createElement('div'); LAB.scanKey = ''; drawScan(b, { scH: 8, scF: 'all' });
        return { nT: LAB.scan.nTests, tips: [...b.querySelectorAll('[data-tip]')].map(x => x.dataset.tip).filter(s => /tests? at once|tests at once/.test(s)), src: drawScan.toString().includes('49 tests') || scVtip.toString().includes('16 pairs') };
      });
      t.ok(!r.src, 'no hand-written test count');
      t.ok(r.tips.length > 0, 'a tooltip speaks of the tests');
      for (const s of r.tips) { const m = s.match(/(\d+) (?:signal–pair )?tests? at once/); t.ok(m && +m[1] === r.nT, `count = ${r.nT}: ${s}`); }
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX scan 4 · the live signal uses the last CLOSED 15-minute bar',
    async run({ t, app }) {
      const page = await boot(app, WED7);
      const r = await page.evaluate(() => { const k = scBars('EURUSD'), ag = Engine.aggregate('EURUSD', 15, 5); return { last: k.at(-1).time, now: Engine.simTime, aggLast: ag.at(-1).time, n: k.length }; });
      t.ok(r.aggLast + 900 > r.now, 'the aggregate ends on a bar in progress (test premise)');
      t.ok(r.last + 900 <= r.now, 'scan bars end on a closed bar');
      t.ok(r.n >= 400, 'the loaded week of bars: ' + r.n);
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX scan 5 · a live row appears only on the bar the trigger fired (not on 17 bars in a row)',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const sig = Array(40).fill(0); for (let i = 10; i < 27; i++) sig[i] = 1; for (let i = 30; i < 33; i++) sig[i] = -1;
        return sig.map((_, j) => scFresh(sig, j) ? j : -1).filter(j => j >= 0);
      });
      t.deep(r, [10, 30], 'only the trigger bars');
      t.noErrors(page);
    }
  },
  /* ---------------- Range cone ---------------- */
  {
    name: 'LABFIX cone 1 · market closed: no forecast, "closed · opens …"; variance only in open minutes',
    async run({ t, app }) {
      const p1 = await boot(app, SAT);
      const a = await p1.evaluate(() => {
        const out = {};
        for (const sym of ['EURUSD', 'GOLD', 'BTCUSD']) { S.set.sym = sym; LAB.coneKey = ''; const b = document.createElement('div'); document.body.appendChild(b); drawCone(b, { cnH: 240, cnMode: 'model' }); out[sym] = { txt: b.textContent, svg: !!b.querySelector('polygon'), lab: mktState(sym).label }; b.remove(); }
        return out;
      });
      for (const s of ['EURUSD', 'GOLD']) { t.ok(!a[s].svg, s + ': no cone drawn while closed'); t.ok(a[s].txt.includes(a[s].lab) && /closed/.test(a[s].lab), s + ' says closed: ' + a[s].txt.slice(0, 200)); }
      t.ok(a.BTCUSD.svg, 'BTC trades 24/7: cone drawn');
      t.noErrors(p1);
      const p2 = await boot(app, WED);
      const b = await p2.evaluate(() => {
        const fri = Date.UTC(2026, 9, 16, 20, 0) / 1000, Mo = cnModel('EURUSD'), path = cnVarPath(Mo, fri, 240, 1), at = mm => path.find(p => p[0] === mm)[1];
        const G = cnModel('GOLD'), t0 = Date.UTC(2026, 9, 20, 20, 30) / 1000, gp = cnVarPath(G, t0, 180, 1), gat = mm => gp.find(p => p[0] === mm)[1];
        return { v60: at(60), v240: at(240), v15: at(15), g15: gat(15), g30: gat(30), g90: gat(90), g180: gat(180) };
      });
      t.ok(b.v15 > 0 && b.v60 > b.v15, 'variance grows while FX is open');
      t.eq(b.v240, b.v60, 'no variance after the Friday close');
      t.ok(b.g30 > b.g15, 'GOLD open until 20:55');
      t.near(b.g90, b.g30, 'GOLD daily pause gets no variance', 1e-12, 1e-15);
      t.ok(b.g180 > b.g90, 'GOLD after the reopening');
      t.noErrors(p2);
    }
  },
  {
    name: 'LABFIX cone 2 · the seasonal profile: one jump minute or a gap cannot inflate an hour',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647, g = () => Math.sqrt(-2 * Math.log(rnd() || 1e-9)) * Math.cos(2 * Math.PI * rnd());
        const a = [], T0 = Date.UTC(2026, 9, 12) / 1000; let p = 1.1, t = T0;
        for (let i = 0; i < 5 * 1440; i++) {
          t += i === 3 * 1440 ? 2 * 86400 : 60; // a two-day gap, reopening 50% higher
          const r = i === 3 * 1440 ? Math.log(1.5) : i === 1440 + 10 * 60 + 7 ? .05 : g() * 1e-4;
          p *= Math.exp(r); a.push({ time: t, open: p, high: p, low: p, close: p });
        }
        const Mo = cnModel('EURUSD', a), pr = Mo.prof.filter(v => v > 0).sort((x, y) => x - y), med = pr[pr.length >> 1];
        const slot = tt => Mo.prof[Math.floor((tt % 86400) / 900)];
        return { jump: slot(T0 + 1440 * 60 + 10 * 3600 + 8 * 60) / med, gap: slot(a[3 * 1440].time) / med, max: pr.at(-1) / med };
      });
      t.ok(r.jump < 1.6, 'the 10:00 slot with a 5% minute: ' + r.jump.toFixed(2) + '× the median');
      t.ok(r.gap < 1.6, 'the reopening slot: ' + r.gap.toFixed(2) + '× the median');
      t.ok(r.max < 1.8, 'no slot stands out: ' + r.max.toFixed(2));
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX cone 3 · conformal probabilities use the scale of the 95% band',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => { const cal = { k68: 1.3, k95: 2.6 }, sc = cnScale(cal, true), sH = .002, px = 1.1; return { sc, model: cnScale(cal, false), p95: cnBeyond(px * Math.exp(cal.k95 * sH), px, sH, sc), p95dn: cnBeyond(px * Math.exp(-cal.k95 * sH), px, sH, sc) }; });
      t.near(r.sc, 2.6 / 1.96, 'conformal scale = k95 / 1.96', 1e-12, 1e-12);
      t.eq(r.model, 1, 'session model: scale 1');
      t.near(r.p95, 2.5, 'a level on the 95% edge: 2.5% beyond', 1e-3, 2e-2);
      t.near(r.p95dn, 2.5, 'and below', 1e-3, 2e-2);
      t.noErrors(page);
    }
  },
  {
    name: 'LABFIX cone 4 · 1D axis labels clear "now"; SVG text is not stretched; CFD units',
    async run({ t, app }) {
      const page = await boot(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        for (const [sym, H] of [['EURUSD', 1440], ['EURUSD', 480], ['EURUSD', 240], ['GOLD', 240], ['BTCUSD', 60]]) {
          S.set.sym = sym; LAB.coneKey = ''; const b = document.createElement('div'); b.id = 'obsBody'; document.body.appendChild(b); drawCone(b, { cnH: H, cnMode: 'model' });
          const svg = b.querySelector('#cnSvg'), now = [...svg.querySelectorAll('text')].find(x => x.textContent === 'now'), nx = +now.getAttribute('x');
          const ticks = [...svg.querySelectorAll('text')].filter(x => /^\+/.test(x.textContent)).map(x => +x.getAttribute('x') - nx);
          out[sym + H] = { par: svg.getAttribute('preserveAspectRatio'), ticks, txt: b.textContent, h: getComputedStyle(svg).height, w: svg.getBoundingClientRect().width, vb: svg.viewBox.baseVal.width / svg.viewBox.baseVal.height, rh: svg.getBoundingClientRect().height };
          b.remove();
        }
        return out;
      });
      for (const [k, x] of Object.entries(r)) {
        t.ok(x.par !== 'none', k + ': no preserveAspectRatio=none');
        t.ok(x.ticks.length && x.ticks.every(d => d >= 36), k + ': axis labels clear "now": ' + JSON.stringify(x.ticks));
        t.near(x.w / x.rh, x.vb, k + ': drawn at its own aspect ratio', 2e-2, 1e-6);
      }
      t.ok(!/pips|\dp\b/.test(r.GOLD240.txt), 'GOLD: no pips ' + (r.GOLD240.txt.match(/.{20}pips.{5}/) || ''));
      t.ok(/ pt\b/.test(r.GOLD240.txt), 'GOLD in points');
      t.ok(/pips/.test(r.EURUSD240.txt), 'EURUSD in pips');
      t.noErrors(page);
    }
  },
  /* ---------------- every tool renders ---------------- */
  {
    name: 'LABFIX render · Edge check, Range cone and Exit lab on EURUSD, GBPJPY, GOLD, BTCUSD, market closed and open',
    async run({ t, app }) {
      for (const c of [SAT, WED]) {
        const page = await app('?demo=1', { clock: c, demo: true });
        await page.waitForFunction(() => S.history.length > 50, null, { timeout: 30000 });
        const r = await page.evaluate(async () => {
          await loadLazy(); const out = [];
          for (const sym of ['EURUSD', 'GBPJPY', 'GOLD', 'BTCUSD']) {
            S.set.sym = sym;
            for (const [v, f, cfg] of [['scan', drawScan, { scH: 8, scF: 'all' }], ['cone', drawCone, { cnH: 240, cnMode: 'conf' }], ['cone', drawCone, { cnH: 1440, cnMode: 'model' }], ['exit', drawExit, { exR: 'stop', exSrc: 'mine' }]]) {
              LAB.scanKey = LAB.coneKey = LAB.exitKey = ''; const b = document.createElement('div'); b.id = 'obsBody'; document.body.appendChild(b);
              try { f(b, cfg); out.push([sym, v, b.textContent.length, /NaN|undefined|Infinity/.test(b.textContent)]); } catch (e) { out.push([sym, v, 'ERR ' + e.message]); }
              b.remove();
            }
          }
          return out;
        });
        for (const x of r) { t.ok(typeof x[2] === 'number' && x[2] > 100, `${c.toISOString().slice(0, 10)} ${x[0]} ${x[1]} renders: ${x[2]}`); t.ok(!x[3], `${x[0]} ${x[1]}: no NaN/undefined`); }
        t.noErrors(page);
      }
    }
  },
  {
    name: 'LABFIX ui · the Observatory tab shows the three tools without an error, closed and open',
    async run({ t, app }) {
      for (const c of [SAT, WED]) {
        const page = await app('?demo=1', { clock: c, demo: true }), cerr = [];
        page.on('console', m => { if (m.type() === 'error') cerr.push(m.text()); });
        await page.waitForFunction(() => S.history.length > 50, null, { timeout: 30000 });
        const r = await page.evaluate(async () => {
          await loadLazy(); setTab('obs'); await new Promise(f => requestAnimationFrame(() => setTimeout(f, 50))); renderObs(); const out = [];
          for (const sym of ['EURUSD', 'GOLD', 'BTCUSD']) { S.set.sym = sym; for (const v of ['scan', 'cone', 'exit']) { obsCfg().view = v; LAB.scanKey = LAB.coneKey = LAB.exitKey = ''; obsDraw(); const b = document.getElementById('obsBody'); out.push([sym, v, b.textContent.length, /Could not compute/.test(b.textContent)]); } }
          return out;
        });
        for (const x of r) t.ok(x[2] > 100 && !x[3], `${c.toISOString().slice(0, 10)} ${x[0]} ${x[1]}: ${JSON.stringify(x)}`);
        t.eq(cerr.length, 0, 'console errors: ' + cerr.join(' | '));
        t.noErrors(page);
      }
    }
  }
];
