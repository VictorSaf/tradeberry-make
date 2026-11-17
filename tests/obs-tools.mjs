// Observatory: Intrinsic time, Déjà vu, Recurrence, Drivers, Volatility clock (review 24.10, errors P0).
// Intrinsic time needs an FX pair and counts its pace on trading time; Déjà vu keeps one match per look-ahead and
// gives no verdict on too few tests; Recurrence follows the tick, keeps its noise band across redraws and compares
// the present only with analogues whose look-ahead ended before it; Drivers searches every tradable pair, never puts
// a leg above 100% of the move and shows 3D; the Volatility clock knows the market is closed, uses the real session
// hours (with DST), keeps the reopening jump out, counts its days per slot and speaks the instrument's unit.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z'), MON = new Date('2026-10-26T00:30:00Z'), FRI = new Date('2026-10-23T20:00:00Z');
async function obsApp(app, clock, opts = {}) {
  const page = await app('', { clock, ...opts });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => {
    T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200));
    window.OQ = {
      show(view, extra = {}) { Object.assign(obsCfg(), { view }, extra); renderObs(); return document.getElementById('obsBody'); },
      // trading hours in a bar series: the time between consecutive bars, gaps (a closed market) left out
      openH(a) { let s = 0; for (let i = 1; i < a.length; i++) if (!isGapAt(a.map(k => k.time), i)) s += a[i].time - a[i - 1].time; return s / 3600; }
    };
  });
  return page;
}
const BAD_PLURAL = /\b1 (events|tests|directional changes|days)\b/;

export const tests = [
  {
    name: 'OX1 Intrinsic time: FX only (GOLD, BTCUSD get the guard), pace per hour of trading, no "−0", singular "1 event"',
    async run({ t, app }) {
      const page = await obsApp(app, MON);
      const r = await page.evaluate(() => {
        const out = {};
        for (const s of ['GOLD', 'BTCUSD']) { setSymbol(s); out[s] = OQ.show('dc').textContent; }
        for (const s of ['EURUSD', 'USDTRY']) {
          setSymbol(s); const txt = OQ.show('dc', { dcTh: .1 }).textContent, a = Engine.candles[s], { ev } = dcEvents(a, .001);
          out[s] = { txt, n: ev.length, rate: ev.length / OQ.openH(a), cal: ev.length / ((a[a.length - 1].time - a[0].time) / 3600), dc: OBS.dc };
        }
        out.pl = [obsPl(1, 'event'), obsPl(2, 'event'), obsPl(0, 'directional change'), obsPl(1, 'directional change')];
        out.sg = [obsSgn(-0.2, 0), obsSgn(-0.04, 1), obsSgn(-0.6, 0), obsSgn(0.3, 0)];
        return out;
      });
      for (const s of ['GOLD', 'BTCUSD']) t.ok(/Intrinsic time works on FX pairs/.test(r[s]) && /Open EUR\/USD/.test(r[s]), `${s} guarded: ` + r[s].slice(0, 200));
      for (const s of ['EURUSD', 'USDTRY']) {
        const x = r[s];
        t.ok(!/works on/.test(x.txt), `${s} runs`);
        t.ok(Math.abs(x.rate - x.cal) > .02, `${s}: the weekend makes calendar and trading pace differ (${x.rate} vs ${x.cal})`);
        t.near(x.dc.rate, x.rate, `${s}: events per hour of trading`, 1e-9);
        t.ok(x.txt.includes(`${x.rate.toFixed(1)}/h`), `${s}: the rate shown is per trading hour: ` + x.txt.slice(0, 120));
        t.ok(!/−0(?![.\d])/.test(x.txt) && !BAD_PLURAL.test(x.txt), `${s}: no −0, no "1 events": ` + x.txt.slice(0, 200));
      }
      t.deep(r.pl, ['1 event', '2 events', '0 directional changes', '1 directional change'], 'plural helper');
      t.deep(r.sg, ['0', '0.0', '−1', '0'], 'no negative zero');
      t.noErrors(page);
    }
  },
  {
    name: 'OX2 Intrinsic time: the heartbeat counts the last 6 hours of trading (the weekend does not empty it)',
    async run({ t, app }) {
      const page = await obsApp(app, MON);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); OQ.show('dc', { dcTh: .1 });
        const a = Engine.candles.EURUSD, T0 = a.map(k => k.time), O = [0];
        for (let i = 1; i < a.length; i++) O.push(O[i - 1] + (isGapAt(T0, i) ? 0 : T0[i] - T0[i - 1]));
        const ix = new Map(T0.map((x, i) => [x, i])), { ev } = dcEvents(a, .001), end = O[O.length - 1];
        const recent = ev.filter(e => O[ix.get(e.dcT)] > end - 6 * 3600).length;
        return { recent, dc: OBS.dc, gapIn6h: T0.slice(-400).some((_, i, s) => i && s[i] - s[i - 1] > 300) };
      });
      t.ok(r.gapIn6h, 'the last 6 trading hours cross the weekend');
      t.eq(r.dc.recent, r.recent, 'heartbeat events in the last 6 trading hours');
      t.noErrors(page);
    }
  },
  {
    name: 'OX3 Déjà vu: USDTRY and BTCUSD get the guard; matches are at least one look-ahead apart; verdict needs 20 tests, no NaN',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = { g: {} };
        for (const s of ['USDTRY', 'BTCUSD']) { setSymbol(s); out.g[s] = OQ.show('deja').textContent; }
        setSymbol('EURUSD'); out.runs = [];
        for (const [tf, w, h] of [[5, 32, 24], [15, 16, 24], [15, 32, 12], [60, 32, 24], [60, 16, 6], [60, 64, 24]]) {
          const b = OQ.show('deja', { dvTf: tf, dvW: w, dvH: h }), dj = OBS.dj;
          out.runs.push({ k: `${tf}/${w}/${h}`, txt: b.textContent, verdict: (b.querySelector('.dj-verdict') || {}).textContent || '', tests: dj && dj.tests, ts: dj ? dj.an.map(o => o.t) : [], sep: h * tf * 60 });
        }
        return out;
      });
      for (const s of ['USDTRY', 'BTCUSD']) t.ok(/Déjà vu works on the 16 G8/.test(r.g[s]) && !/Could not compute/.test(r.g[s]), `${s} guarded: ` + r.g[s].slice(0, 160));
      let few = 0, many = 0;
      for (const x of r.runs) {
        t.ok(!/NaN|undefined/.test(x.txt), `${x.k}: no NaN: ` + x.txt.slice(0, 300));
        t.ok(!/fewer than \d+ bars/i.test(x.txt), `${x.k}: no false "fewer than N bars"`);
        t.ok(!BAD_PLURAL.test(x.txt), `${x.k}: plural`);
        for (let i = 0; i < x.ts.length; i++) for (let j = i + 1; j < x.ts.length; j++) t.ok(Math.abs(x.ts[i] - x.ts[j]) >= x.sep, `${x.k}: matches ${i} and ${j} are ${Math.abs(x.ts[i] - x.ts[j]) / 60} min apart, under the look-ahead ${x.sep / 60}`);
        if (x.tests != null && x.tests < 20) { few++; t.ok(new RegExp(`Not enough tests \\(${x.tests} of 20\\)`).test(x.verdict) && !/edge|coin flip/i.test(x.verdict), `${x.k}: ${x.tests} tests give no verdict: ` + x.verdict); }
        if (x.tests >= 20) { many++; t.ok(/edge|coin flip/i.test(x.verdict), `${x.k}: a verdict on ${x.tests} tests: ` + x.verdict); }
      }
      t.ok(few >= 1 && many >= 1, `both cases seen (${few} few, ${many} enough)`);
      t.noErrors(page);
    }
  },
  {
    name: 'OX4 Recurrence: follows the 5 s tick; the noise band survives renderObs and is keyed by symbol/TF; analogues end before now',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); OQ.show('rp', { rpTf: 15 });
        const band = OBS.rpBand, cv = document.getElementById('rpCv');
        renderObs(); const kept = OBS.rpBand === band;
        // a new bar arrives: the tick redraws the view
        const a = Engine.candles.EURUSD, k = a[a.length - 1]; a.push({ time: k.time + 60, open: k.close, high: k.close * 1.001, low: k.close, close: k.close * 1.001 });
        obsTick(); const ticked = document.getElementById('rpCv') !== cv;
        OQ.show('rp', { rpTf: 5 }); const otherTf = OBS.rpBand.k !== band.k;
        const bad = [];
        for (const p of Engine.PAIRS) for (const tf of [5, 15, 60]) { setSymbol(p.sym); OQ.show('rp', { rpTf: tf }); const n = OBS.rpNear; for (const j of n.near) if (!(j < n.now - n.W - n.m)) bad.push(`${p.sym}/${tf}: j=${j} now=${n.now}`); }
        return { kept, ticked, otherTf, bad, live: OBS_LIVE.includes('rp') };
      });
      t.ok(r.live, 'rp is in the live views');
      t.ok(r.kept, 'renderObs keeps the band');
      t.ok(r.ticked, 'a tick with a new bar redraws the plot');
      t.ok(r.otherTf, 'another timeframe has its own band');
      t.deep(r.bad, [], 'every analogue and its look-ahead end before the current state');
      t.noErrors(page);
    }
  },
  {
    name: 'OX5 Drivers: widest gap over every tradable pair of the eight, the count said; legs never above 100%; offsetting legs named; 3D row',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        setSymbol('EURUSD'); const b = OQ.show('drv'), d = OBS.drv, sv = d.sv;
        const pool = Engine.FX.filter(m => m.base in sv && m.quote in sv), best = pool.map(m => ({ s: m.sym, g: Math.abs(sv[m.base] - sv[m.quote]) })).sort((x, y) => y.g - x.g)[0];
        const side = b.querySelector('.obs-side').textContent, pill = b.querySelector('.obs-side .pill').dataset.sym, rows = [...b.querySelectorAll('.drv-tbl tbody tr td:first-child')].map(x => x.textContent);
        const texts = [];
        for (const p of Engine.FX) { setSymbol(p.sym); const bb = OQ.show('drv'); texts.push({ s: p.sym, v: (bb.querySelector('.drv-verdict') || {}).textContent || '', led: [...bb.querySelectorAll('.drv-tbl .brx-t')].map(x => x.textContent) }); }
        const syn = [drvSay('EURUSD', 10e-4, -9e-4, '4 hours'), drvSay('EURUSD', 10e-4, -3e-4, '4 hours'), drvSay('EURUSD', 8e-4, 2e-4, '4 hours'), drvSay('EURUSD', 2e-4, 2.2e-4, '4 hours')];
        return { n: pool.length, best: best.s, pill, side, rows, texts, syn };
      });
      t.eq(r.pill, r.best, 'the widest gap is searched over all tradable pairs');
      t.ok(r.n > 16 && new RegExp(`Of the ${r.n} tradable pairs`).test(r.side), `the count is said (${r.n}): ` + r.side.slice(0, 300));
      t.deep(r.rows, ['1H', '4H', '1D', '3D'], 'four windows, 3D included');
      for (const x of r.texts) {
        for (const m of x.v.matchAll(/(\d+)% of/g)) t.ok(+m[1] <= 100, `${x.s}: ${m[0]} in "${x.v}"`);
        t.ok(!/−0(?![.\d])/.test(x.v), `${x.s}: no −0`);
      }
      const [off, partly, same, eq] = r.syn;
      t.ok(/offset/.test(off) && !/equally|genuine relative-value|% of/.test(off), 'legs that cancel are named as offsetting: ' + off);
      t.ok(/EUR moved \+10\.0 bp/.test(off) && /[−-]9\.0 bp/.test(off), 'with both moves: ' + off);
      t.ok(/partly offset/.test(partly) && !/% of/.test(partly), 'opposite signs, one larger: no share above 100%: ' + partly);
      t.ok(/80% of the move/.test(same), 'same signs: the share of the move: ' + same);
      t.ok(/equally/.test(eq), 'same signs, about equal: both legs: ' + eq);
      t.noErrors(page);
    }
  },
  {
    name: 'OX6 Drivers: focus survives the tick',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => { setSymbol('EURUSD'); const b = OQ.show('drv'), x = b.querySelector('.cb-row'); x.focus(); OBS.key = ''; obsTick(); return document.activeElement === x && x.isConnected; });
      t.ok(r, 'the focused row is still there');
      t.noErrors(page);
    }
  },
  {
    name: 'OX7 Volatility clock: closed market said, no open sessions, no "busiest coming", no ±pips; partial close in the next two hours',
    async run({ t, app }) {
      const p = await obsApp(app, SAT);
      const r = await p.evaluate(() => { setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }); return { txt: b.textContent, lab: b.querySelector('.ins label').textContent }; });
      t.ok(/FX closed · opens Sun 22:00 UTC/.test(r.txt), 'closed said: ' + r.txt.slice(0, 200));
      t.ok(!/ open\b/.test(r.lab), 'no session open now: ' + r.lab);
      t.ok(!/Busiest coming/.test(r.txt) && !/±\d+ pips/.test(r.txt) && !/running at/.test(r.txt), 'no forward-looking numbers while closed: ' + r.txt.slice(0, 600));
      t.noErrors(p);
      const f = await obsApp(app, FRI);
      const q = await f.evaluate(() => { setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }); return { txt: b.textContent, strip: [...b.querySelectorAll('.clk-strip span')].map(x => x.className), peak: OBS.clk.peakAhead, curSl: OBS.clk.curSl }; });
      t.ok(q.strip.filter(c => /closed/.test(c)).length >= 4, 'slots after the Friday close are marked closed: ' + q.strip);
      t.ok(q.peak != null && q.peak < 84, 'the busiest coming slot is before the 21:00 close: ' + q.peak);
      t.noErrors(f);
      const w = await obsApp(app, WED);
      const o = await w.evaluate(() => { setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }); return { lab: b.querySelector('.ins label').textContent, txt: b.textContent }; });
      t.ok(/London \+ New York open/.test(o.lab), 'open sessions on Wednesday: ' + o.lab);
      t.ok(/±\d+ pips/.test(o.txt), 'typical hour shown when open');
      t.noErrors(w);
    }
  },
  {
    name: 'OX8 Volatility clock: session hours follow DST (EU 25.10, US 1.11), reopening jump left out, days counted per slot',
    async run({ t, app }) {
      const page = await obsApp(app, MON);
      const r = await page.evaluate(() => {
        const at = s => Object.fromEntries(clkSessions(Date.parse(s) / 1000).map(([n, b]) => [n, b]));
        const d = [at('2026-10-21T12:00:00Z'), at('2026-10-26T12:00:00Z'), at('2026-11-02T12:00:00Z')];
        setSymbol('EURUSD'); const b = OQ.show('clock', { clkAll: false }), c = OBS.clk;
        // the same profile by hand: gap-crossing returns skipped, each day's own average per slot, then the median of the days
        const a = Engine.candles.EURUSD, T0 = a.map(k => k.time), day0 = Math.floor(Engine.simTime / 86400) * 86400;
        const raw = Array(96).fill(0), rc = Array(96).fill(0), cnt = Array(96).fill(0), days = Array.from({ length: 96 }, () => new Map());
        for (let i = 1; i < a.length; i++) { if (a[i].time >= day0) continue; const sl = Math.floor((a[i].time % 86400) / 900), v = Math.abs(Math.log(a[i].close / a[i - 1].close)); raw[sl] += v; rc[sl]++; if (isGapAt(T0, i)) continue; cnt[sl]++; const dd = Math.floor(a[i].time / 86400), e = days[sl].get(dd) || [0, 0]; e[0] += v; e[1]++; days[sl].set(dd, e); }
        const gapSl = [...Array(96).keys()].filter(k => cnt[k] !== rc[k]);
        const med = m => { const x = [...m.values()].map(e => e[0] / e[1]).sort((p, q) => p - q), n = x.length; return !n ? 0 : n % 2 ? x[n >> 1] : (x[n / 2 - 1] + x[n / 2]) / 2; };
        return { d, avg: c.avg, exp: days.map(m => med(m) * 1e4), rawGap: Object.fromEntries(gapSl.map(k => [k, raw[k] / rc[k] * 1e4])), gapSl, nd: c.nd, expNd: days.map(m => m.size), note: b.textContent };
      });
      t.deep(r.d[0].London, [[7, 16]], 'London before 25.10'); t.deep(r.d[0]['New York'], [[12, 21]], 'NY before 1.11');
      t.deep(r.d[1].London, [[8, 17]], 'London after 25.10'); t.deep(r.d[1]['New York'], [[12, 21]], 'NY still on summer time 26.10');
      t.deep(r.d[2].London, [[8, 17]], 'London in winter'); t.deep(r.d[2]['New York'], [[13, 22]], 'NY after 1.11');
      t.deep(r.d[0].Tokyo, [[0, 9]], 'Tokyo has no DST');
      t.ok(r.gapSl.length >= 1, 'the reopening falls in a slot: ' + r.gapSl);
      for (const k of r.gapSl) t.ok(Math.abs(r.avg[k] - r.rawGap[k]) > 1e-9, `slot ${k}: the jump is not in the average`);
      r.avg.forEach((v, k) => t.near(v, r.exp[k], `slot ${k}: median of the days' averages, without gaps`, 1e-9, 1e-12));
      t.deep(r.nd, r.expNd, 'days with data per slot');
      t.ok(!BAD_PLURAL.test(r.note), 'plural');
      t.noErrors(page);
    }
  },
  {
    name: 'OX9 Volatility clock on CFDs: the unit is the instrument\'s (pt) and the stop is the ticket\'s for that instrument',
    async run({ t, app }) {
      const page = await obsApp(app, WED);
      const r = await page.evaluate(() => {
        const out = {};
        for (const s of ['GOLD', 'BTCUSD']) { setSymbol(s); const b = OQ.show('clock', { clkAll: false }); out[s] = { txt: b.textContent, sl: tkDistFor(s).sl, unit: M(s).unit }; }
        return out;
      });
      for (const s of ['GOLD', 'BTCUSD']) {
        const x = r[s];
        t.eq(x.unit, 'pt', `${s} unit`);
        t.ok(!/pips?\b/.test(x.txt), `${s}: no pips: ` + x.txt.slice(0, 500));
        t.ok(new RegExp(`A ${x.sl}-pt stop`).test(x.txt), `${s}: the ticket's stop (${x.sl} pt): ` + x.txt.slice(0, 500));
        t.ok(!/ 0\.0×/.test(x.txt), `${s}: no 0.0× ratio`);
      }
      t.noErrors(page);
    }
  }
];
