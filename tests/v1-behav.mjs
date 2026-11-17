// Valul 1 · honest verdicts in Behaviour and the coach: disposition after Odean (1998) with one dispoVerdict (ratio + |t| ≥ 2),
// calibration 10–90 with BSS / Murphy / Wilson, a neutral post-mortem with the random-walk odds (rwHit), the pre-mortem
// opt-out of decision 36, trading hours and win rates with their uncertainty. Frozen market (speed 0).
const ROW = `(o) => Object.assign({ sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1, pips: 0, r: 1, comm: 0, swap: 0, reason: 'Manual', note: '', setup: '', ctx: [], news: [] }, o)`;
const PM0 = `(o) => Object.assign({ flags: [], codes: [], mine: [], own: '', kill: '', timeStop: 0, conf: null, mood: null, broke: [], override: false, t: 0 }, o)`;
export const tests = [
  {
    name: 'V1B0 disposition: an all-or-nothing sample (every gain sold, no loss sold) is judged, not "not clear"; one global wilson',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        T.reset();
        S.dispo = { rg: 20, pg: 0, rl: 0, pl: 20, ev: [] };
        const ds = dispoStats(), v = dispoVerdict(ds);
        await loadLazy(); const w = wilson(7, 10);
        return { key: v.key, txt: v.text, t: ds.tstat, arr: Array.isArray(w), lo: w.lo };
      });
      t.eq(r.key, 'dispo', 'extreme sample is a disposition effect: ' + r.txt);
      t.ok(r.t > 6, 't from the pooled SE: ' + r.t);
      t.ok(!/gains — as/.test(r.txt) && /far more readily than/.test(r.txt), 'no garbled ratio: ' + r.txt);
      t.ok(r.arr && Math.abs(r.lo - .3968) < 1e-4, 'wilson stays the shared.js array after the tools load');
    },
  },
  {
    name: 'V1B1 disposition: Odean Table I is "Disposition effect" (ratio 1.52, t ≈ 35.4); a tiny sample is "not clear yet"; one dispoVerdict',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); setTab('behav');
        S.dispo = { rg: 13883, pg: 79658, rl: 11930, pl: 110348, ev: [] };
        const ds = dispoStats(), v = dispoVerdict(ds); renderBehav();
        const card = [...document.querySelectorAll('#behav .bh-card')].find(x => /Disposition effect/.test(x.querySelector('h3')?.textContent || ''))?.textContent || '';
        const coach = coachInsights().map(x => x.t).join(' | ');
        const score = BH_LAST.comp.find(c => c[0] === 'Disposition')[1];
        S.dispo = { rg: 2, pg: 2, rl: 1, pl: 3, ev: [] };
        const ds2 = dispoStats(), v2 = dispoVerdict(ds2); renderBehav();
        const card2 = [...document.querySelectorAll('#behav .bh-card')].find(x => /Disposition effect/.test(x.querySelector('h3')?.textContent || ''))?.textContent || '';
        const coach2 = coachInsights().map(x => x.t).join(' | ');
        const src = [renderBehav, dispoSale, bhReport, bindBehav].map(String).join('\n');
        return { pgr: ds.pgr, plr: ds.plr, ratio: ds.ratio, tstat: ds.tstat, key: v.key, txt: v.html, card, coach, score, key2: v2.key, txt2: v2.html, card2, coach2, score2: BH_LAST.comp.find(c => c[0] === 'Disposition')[1],
          abs: (src.match(/\.de\s*[<>]=?\s*-?\.1\b|\bde\s*[<>]\s*-?\.1\b|Math\.abs\(ds\.de\)/g) || []).length };
      });
      t.near(r.pgr, .148, 'PGR', 0, .0005); t.near(r.plr, .098, 'PLR', 0, .0005);
      t.near(r.ratio, 1.52, 'PGR / PLR', 0, .005); t.near(r.tstat, 35.4, 't-statistic', 0, .2);
      t.eq(r.key, 'dispo', 'Odean sample: disposition effect');
      t.ok(/Disposition effect/.test(r.card) && !/Balanced/.test(r.card), 'card says it: ' + r.card.slice(0, 300));
      t.ok(/1\.52×/.test(r.card), 'card shows the ratio: ' + r.card.slice(0, 300));
      t.ok(/Disposition effect/.test(r.coach), 'coach says it: ' + r.coach);
      t.ok(r.score != null && r.score < 100, 'score component counts it: ' + r.score);
      t.eq(r.key2, 'unclear', '{rg2,pg2,rl1,pl3}: not clear');
      t.ok(/not clear yet/i.test(r.card2) && !/Disposition effect\./.test(r.card2) && !/Balanced/.test(r.card2), 'card: not clear yet: ' + r.card2.slice(0, 300));
      t.ok(!/Disposition effect|cut losers faster/.test(r.coach2), 'coach stays quiet: ' + r.coach2);
      t.eq(r.score2, null, 'no score component without a clear verdict');
      t.eq(r.abs, 0, 'no absolute 0.1 threshold left in the verdict paths');
      t.noErrors(page);
    }
  },
  {
    name: 'V1B2 dispoSale: a close with nothing else open, and a zero P&L, leave S.dispo unchanged',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0; S.dispo = null; bhState();
        const snap = () => JSON.stringify(S.dispo);
        const a = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }); const s0 = snap();
        closePosition(a.id, 'Manual'); const alone = snap() === s0;
        // two positions: the held one sits at exactly zero P&L, the sold one is a loss
        const b = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true }), c = openPosition({ sym: 'GBPUSD', side: 'buy', lots: 1, dupOk: true });
        T.move('GBPUSD', Engine.mid('GBPUSD') + (c.entry - Engine.quote('GBPUSD').bid));
        const zero = bhPosNet(c);
        closePosition(b.id, 'Manual'); const d1 = { ...S.dispo, ev: S.dispo.ev.length };
        return { alone, zero, d1 };
      });
      t.ok(r.alone, 'a sale with no other position is not an Odean decision');
      t.ok(Math.abs(r.zero) < .005, 'held position at zero: ' + r.zero);
      t.deep([r.d1.rg, r.d1.rl, r.d1.pg, r.d1.pl, r.d1.ev], [0, 1, 0, 0, 1], 'the zero-P&L position is neither a paper gain nor a paper loss');
      t.noErrors(page);
    }
  },
  {
    name: 'V1B3 calibration: 9 buttons 10–90; sample A gives BSS 0.16 with the Murphy parts and a Wilson interval per bin',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); const row = eval(ROW), pm = eval(PM0), t0 = Engine.simTime - 86400 * 4;
        Object.assign(pmCfg(), { on: true, minRisk: 0, noSL: true });
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        const btns = [...document.querySelectorAll('#pmGate input[name=pmConf]')].map(x => +x.value);
        document.querySelector('#pmGate [data-pm=cancel]').click(); pmCfg().on = false;
        const H = [];
        for (let i = 0; i < 20; i++) { const hi = i < 10, win = hi ? i < 7 : i < 13; H.unshift(row({ id: i + 1, pnl: win ? 10 : -10, open: t0 + i * 3600, close: t0 + i * 3600 + 600, pm: pm({ conf: hi ? 70 : 30 }) })); }
        S.history = H; setTab('behav'); renderBehav();
        const card = [...document.querySelectorAll('#behav .bh-card')].find(x => /Confidence calibration/.test(x.textContent));
        return { btns, bss: BH_LAST.bss, txt: card.textContent, titles: [...card.querySelectorAll('circle title')].map(x => x.textContent), comp: BH_LAST.comp.map(c => c[0]) };
      }, { ROW, PM0 });
      t.deep(r.btns, [10, 20, 30, 40, 50, 60, 70, 80, 90], 'confidence buttons 10..90');
      t.near(r.bss, .16, 'BSS sample A', 1e-9, 1e-9);
      t.ok(/0\.16/.test(r.txt) && /reliability/i.test(r.txt) && /resolution/i.test(r.txt) && /uncertainty/i.test(r.txt), 'BSS and the Murphy parts shown: ' + r.txt.slice(0, 400));
      t.ok(!/coin flip/i.test(r.txt), 'no coin-flip baseline: ' + r.txt.slice(0, 400));
      t.ok(r.titles.some(x => /Said 70% · won 7 of 10 = 70% \(40–89%\)/.test(x)), 'Wilson per bin: ' + r.titles.join(' | '));
      t.ok(!r.comp.some(n => /coin flip/i.test(n)), 'score component renamed: ' + r.comp);
      t.noErrors(page);
    }
  },
  {
    name: 'V1B4 post-mortem: no "idea was right"; a stop-out then target reached says how often a random walk gets there',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); const row = eval(ROW), pm = eval(PM0), sym = 'EURUSD', a = Engine.candles[sym];
        const tc = Engine.simTime - 30 * 3600, i0 = a.findIndex(k => k.time > tc), win = a.slice(i0, i0 + 1440);
        const px = a[i0 - 1].close, hi = Math.max(...win.map(k => k.high)), pip = Engine.META[sym].pip;
        // a long stopped out at tc whose target is the highest high of the next 24h
        const h = row({ id: 1, sym, side: 'buy', entry: px - 5 * pip, exit: px, sl0: px, slLast: px, tp0: hi - pip / 10, pnl: -50, reason: 'Stop loss', open: tc - 3600, close: tc, pm: pm({ mine: ['Stop too tight for current volatility'] }) });
        S.history = [h]; const tags = postMortem(tradesOf(S.history)[0]).tags;
        setTab('behav'); renderBehav();
        const src = [postMortem, renderBehav].map(String).join('\n');
        return { tags, html: document.getElementById('behav').textContent, src: /idea was right|idea worked|the stop was not/.test(src) };
      }, { ROW, PM0 });
      const sh = r.tags.find(x => x[0] === 'stophunt');
      t.ok(sh, 'stop-out then target: tagged ' + JSON.stringify(r.tags));
      t.ok(/random walk/.test(sh[1]) && /\d+%/.test(sh[1]), 'with the random-walk probability: ' + sh[1]);
      t.ok(!/right/.test(sh[1]), 'neutral wording: ' + sh[1]);
      t.eq(r.src, false, 'no edge wording in the post-mortem or the tab');
      t.noErrors(page);
    }
  },
  {
    name: 'V1B5 pre-mortem opt-out: the modal only skips for 1 hour (recorded, auto-restart); turning off in Behaviour asks first',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); S.set.comm = 0; Object.assign(pmCfg(), { on: true, minRisk: 0, noSL: true });
        const out = {};
        out.gated = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        const g = document.getElementById('pmGate');
        out.off = !!g.querySelector('[data-pm=off]');
        const sk = g.querySelector('[data-pm=skip]'); out.skipTxt = sk?.textContent;
        sk.click();
        out.after = { on: pmCfg().on, until: pmCfg().until - Engine.simTime, skips: pmCfg().skips, placed: S.positions.length };
        out.next = !!openPosition({ sym: 'GBPUSD', side: 'buy', lots: 1, dupOk: true });
        pmCfg().until = Engine.simTime - 1; // the hour is over
        out.back = openPosition({ sym: 'USDJPY', side: 'buy', lots: 1, dupOk: true }); out.gateBack = !document.getElementById('pmGate').hidden;
        document.querySelector('#pmGate [data-pm=cancel]').click();
        setTab('behav'); renderBehav();
        const cb = document.getElementById('pmOn'); cb.click();
        const dlg = document.getElementById('confirmDlg');
        out.ask = { on: pmCfg().on, shown: !!dlg && !dlg.hidden, body: dlg?.textContent || '' };
        dlg.querySelector('[data-cf=ok]').click();
        out.final = pmCfg().on;
        return out;
      });
      t.eq(r.gated, null, 'first trade goes to the pre-mortem');
      t.eq(r.off, false, 'no one-click global off in the modal');
      t.eq(r.skipTxt, 'Skip pre-mortems for 1 hour and place this order', 'skip button');
      t.eq(r.after.on, true, 'pre-mortems stay on'); t.eq(r.after.until, 3600, 'skipped for one sim hour'); t.eq(r.after.skips, 1, 'the skip is recorded'); t.eq(r.after.placed, 1, 'the trade is placed');
      t.eq(r.next, true, 'during the hour trades go straight through');
      t.eq(r.back, null, 'after the hour the pre-mortem is back'); t.ok(r.gateBack, 'gate shown again');
      t.eq(r.ask.on, true, 'unchecking alone does not turn it off'); t.ok(r.ask.shown, 'confirmation shown');
      t.ok(/pre-mortem/i.test(r.ask.body) && /skipped|talked yourself out/i.test(r.ask.body), 'the confirmation says what pre-mortems caught: ' + r.ask.body);
      t.eq(r.final, false, 'confirmed: off');
      t.noErrors(page);
    }
  },
  {
    name: 'V1B6 hours, scoreboard, moods and coach carry their uncertainty (may be chance, Wilson)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(({ ROW, PM0 }) => {
        T.reset(); const row = eval(ROW), pm = eval(PM0), t0 = Math.floor((Engine.simTime - 86400 * 10) / 86400) * 86400, H = [];
        // 24 trades: 12 longs (9 win), 12 shorts (3 win); hour 09 and 15 UTC; all with the news flag and a mood
        for (let i = 0; i < 24; i++) { const long = i % 2 === 0, w = long ? i < 18 : i < 6; const o = t0 + Math.floor(i / 2) * 86400 + (long ? 9 : 15) * 3600; H.unshift(row({ id: i + 1, side: long ? 'buy' : 'sell', pnl: w ? 20 : -20, open: o, close: o + 600, ctx: ['news'], pm: pm({ mood: 'calm' }) })); }
        S.history = H; setTab('behav'); renderBehav();
        const txt = document.getElementById('behav').textContent, coach = coachInsights().map(x => x.t).join(' | ');
        const hrs = [...document.querySelectorAll('#behav .bh-card')].find(x => /Your trading hours/.test(x.textContent)).textContent;
        const board = [...document.querySelectorAll('#behav .bh-board')].map(x => x.textContent).join(' || ');
        return { hrs, board, coach, txt };
      }, { ROW, PM0 });
      t.ok(/may be chance/.test(r.hrs), 'hours: may be chance: ' + r.hrs.slice(-200));
      t.ok(/50% \(31–69%\)/.test(r.board), 'scoreboard and moods with a Wilson interval (12 of 24): ' + r.board.slice(0, 400));
      t.ok(/75% \(47–91%\) · n=12/.test(r.coach) && /25% \(9–53%\) · n=12/.test(r.coach), 'coach win rates with Wilson: ' + r.coach);
      t.noErrors(page);
    }
  },
  {
    name: 'V1B7 demo: revenge window from REVENGE_MIN; the demo account renders without errors',
    async run({ t, app }) {
      const page = await app('', { clock: true, demo: true });
      await page.waitForFunction(() => typeof loadDemoHistory === 'function', null, { timeout: 10000 });
      const r = await page.evaluate(async () => {
        const src = await fetch('/tests/fixtures/demo.js').then(x => x.text());
        loadDemoHistory(); setTab('behav'); renderBehav();
        return { lit: /<\s*600\b/.test(src), uses: /REVENGE_MIN\s*\*\s*60/.test(src), n: S.history.length, ds: dispoStats(), v: dispoVerdict(dispoStats()).key };
      });
      t.eq(r.lit, false, 'no 600 s literal'); t.ok(r.uses, 'REVENGE_MIN * 60');
      t.ok(r.n > 100, 'demo trades: ' + r.n); t.ok(['dispo', 'reverse', 'unclear'].includes(r.v), 'verdict: ' + r.v);
      t.noErrors(page);
    }
  }
];
