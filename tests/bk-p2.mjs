// Baskets: the usefulness (P2) items of the Observatory review (24.10.2026, section 9), points 28–32 of the bk3 brief.
// The clock is pinned on a weekday (Fri 16.10 10:30 UTC, FX open) and the market is frozen (fills at the quote); the
// index is moved with Engine.jump on whole currencies.
const ready = async page => {
  await page.evaluate(() => loadLazy());
  await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof bkCfg === 'function', null, { timeout: 30000 });
  await page.evaluate(() => {
    T.reset(); S.bkPos = []; S.bkOrders = []; S.bkAlerts = []; S.bkHist = [];
    const c = bkCfg(); c.bkMode = 'risk'; c.bkRisk = .5; c.bkSl = 'auto'; c.bkTp = 'auto'; c.bkTrail = 0; c.bkBe = 0; c.bkEntry = 'market'; c.bkCmp = 'none'; c.bkAn = 'attr';
    window.TL = [];
    const ot = window.toast; window.toast = function (title, body, kind) { TL.push({ title, body: body || '', kind }); return ot.apply(this, arguments); };
  });
};
const show = async (page, sel = 'dxy', pane = 'tr') => page.evaluate(async ([sel, pane]) => {
  const c = bkCfg(); c.bkSel = sel; c.bkPane = pane; obsCfg().view = 'bask'; for (let k = 0; k < 60 && !window.setView; k++) await new Promise(r => setTimeout(r, 50)); window.setView ? setView('research', 'obs') : setTab('obs'); renderObs(); obsDraw();
  for (let k = 0; k < 40 && !(BK.series && document.querySelector('#bkChart')); k++) await new Promise(r => setTimeout(r, 50));
}, [sel, pane]);
// USD alone on the long side: USD moves (every other currency by −x); otherwise each long currency moves by x
const MOVE = `window.bkMoveIdx = (g, x) => { const L = bkNorm(g.long); if (L.USD === 1) { Engine.jump('USD', x); return; } for (const k of Object.keys(L)) Engine.jump(k, x); };`;
const pane = 'document.querySelector(".bk-pn:not([hidden])").textContent.replace(/\\s+/g, " ")';

export const tests = [
  {
    name: 'BKP28 the stop and target of an open basket can be changed: same rules as the ticket, disaster stops recomputed, toast old → new, Enter / Escape',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.evaluate(MOVE);
      await show(page);
      const r = await page.evaluate(async () => {
        const out = {}, b = bkGet('dxy'), c = bkCfg();
        c.bkSl = 20; c.bkTp = 30;
        const g = bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        const legs = () => S.positions.filter(p => p.bgid === g.gid);
        out.sl0 = legs().map(p => p.sl);
        const dis = (p, sl) => { const q = Engine.quote(p.sym), d = p.side === 'buy' ? 1 : -1; return p.entry - d * Math.max(3 * sl / 1e4 * p.entry, 3 * (q.ask - q.bid)); };
        out.open0 = legs().map(p => [p.sl, dis(p, 20)]);
        obsDraw();
        // the Edit button is a real button, opens the editor with the current values and the net R:R
        const ed = document.querySelector(`[data-bk-ed="${g.gid}"]`);
        out.edTag = ed && ed.tagName;
        ed.click(); await new Promise(r => setTimeout(r, 0));
        const sl = document.querySelector('#bkEdSl'), tp = document.querySelector('#bkEdTp');
        out.vals = [sl && sl.value, tp && tp.value];
        out.focus = document.activeElement === sl;
        sl.value = '35'; sl.dispatchEvent(new Event('input', { bubbles: true }));
        tp.value = '60'; tp.dispatchEvent(new Event('input', { bubbles: true }));
        out.rr = document.querySelector('[data-bk-ed-rr]').textContent.replace(/\s+/g, ' ');
        out.rrWant = `${(60 - g.cost).toFixed(1)} : ${(35 + g.cost).toFixed(1)}`;
        // Escape cancels: nothing changes
        sl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise(r => setTimeout(r, 0));
        out.esc = { sl: g.sl, tp: g.tp, open: !!document.querySelector('#bkEdSl'), legs: legs().map(p => p.sl), focusBack: document.activeElement === document.querySelector(`[data-bk-ed="${g.gid}"]`) };
        // Enter saves
        document.querySelector(`[data-bk-ed="${g.gid}"]`).click(); await new Promise(r => setTimeout(r, 0));
        document.querySelector('#bkEdSl').value = '35'; document.querySelector('#bkEdTp').value = '60';
        TL.length = 0;
        document.querySelector('#bkEdTp').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await new Promise(r => setTimeout(r, 0));
        out.ent = { sl: g.sl, tp: g.tp, risk: g.risk, riskWant: g.lots * 1e5 * (35 + g.cost) / 1e4, toast: TL.map(x => x.title + ' | ' + x.body).join(' / '), legs: legs().map(p => [p.sl, dis(p, 35)]), open: !!document.querySelector('#bkEdSl') };
        out.stTxt = bkStopTxt(g);
        // the stop on the losing side, the target on the winning side, and not already crossed by the index
        out.bad = [bkEditApply(g.gid, -5, 60), bkEditApply(g.gid, 35, 0), bkEditApply(g.gid, 35, -10)];
        bkMoveIdx(b, -12 / 1e4); const mv = bkGroupState(g).mv; out.mv = mv;
        TL.length = 0;
        out.crossed = bkEditApply(g.gid, 10, 60);
        out.after = { sl: g.sl, tp: g.tp };
        // trail and break-even stay consistent: a stop below an active trail leaves the trail in charge and says so
        bkMoveIdx(b, 30 / 1e4); g.trail = 10; bkMonitor(); out.pk = g.pk;
        out.crossedTp = bkEditApply(g.gid, 35, Math.max(1, Math.floor(g.pk) - 2));
        out.after2 = { sl: g.sl, tp: g.tp };
        TL.length = 0;
        out.trOk = bkEditApply(g.gid, 50, 80);
        out.trKind = bkStopKind(g); out.trToast = TL.map(x => x.title + ' | ' + x.body).join(' / ');
        // a cleared stop: no basket stop, no disaster stops (as a basket opened without a stop), risk unknown
        g.trail = 0; out.clr = bkEditApply(g.gid, null, 80);
        out.clrState = { sl: g.sl, legs: legs().map(p => p.sl), risk: g.risk };
        // closing groups cannot be edited
        g.closing = 'Basket close'; out.closing = bkEditApply(g.gid, 30, 80); delete g.closing;
        return out;
      });
      t.eq(r.edTag, 'BUTTON', 'Edit is a button (keyboard reachable)');
      t.deep(r.vals, ['20', '30'], 'the editor opens on the current stop and target');
      t.ok(r.focus, 'focus goes to the stop field');
      t.ok(r.rr.includes(r.rrWant) && /net/i.test(r.rr), `net R:R shown live: "${r.rr}" contains ${r.rrWant}`);
      for (const [a, b] of r.open0) t.near(a, b, 'disaster stop at the open = 3× stop from the entry (or 3 spreads)', 1e-6, 1e-6);
      t.eq(r.esc.sl, 20, 'Escape: stop unchanged'); t.eq(r.esc.tp, 30, 'Escape: target unchanged'); t.ok(!r.esc.open, 'Escape closes the editor');
      t.deep(r.esc.legs, r.sl0, 'Escape: leg stops unchanged'); t.ok(r.esc.focusBack, 'focus back on Edit after Escape');
      t.eq(r.ent.sl, 35, 'Enter: new stop'); t.eq(r.ent.tp, 60, 'Enter: new target'); t.ok(!r.ent.open, 'the editor closes');
      t.near(r.ent.risk, r.ent.riskWant, 'risk = notional × new stop + entry cost', 1e-9, 1e-6);
      for (const [a, b] of r.ent.legs) t.near(a, b, 'leg disaster stop recomputed: 3 × 35 bp from the entry', 1e-6, 1e-6);
      t.ok(/20/.test(r.ent.toast) && /35/.test(r.ent.toast) && /30/.test(r.ent.toast) && /60/.test(r.ent.toast) && /→/.test(r.ent.toast), 'toast with old and new values: ' + r.ent.toast);
      t.ok(/105 bp|3×/.test(r.ent.toast), 'toast names the new disaster stops: ' + r.ent.toast);
      t.ok(/stop −35 bp/.test(r.stTxt) && /target 60 bp/.test(r.stTxt), 'the row shows the new levels: ' + r.stTxt);
      for (const x of r.bad) t.ok(typeof x === 'string' && x.length > 0, 'refused: ' + x);
      t.ok(r.mv < -10, 'index moved against the basket: ' + r.mv);
      t.ok(/close .*at once|already/i.test(r.crossed), 'a stop the index already crossed is refused: ' + r.crossed);
      t.ok(/already|at once/i.test(r.crossedTp), 'a target the index already reached is refused: ' + r.crossedTp);
      t.deep(r.after, { sl: 35, tp: 60 }, 'refusals change nothing'); t.deep(r.after2, { sl: 35, tp: 60 }, 'nor the target refusal');
      t.ok(r.pk >= 10, 'best move recorded: ' + r.pk);
      t.eq(r.trOk, '', 'stop moved under an active trail');
      t.eq(r.trKind, 'trail', 'the trail still sets the stop');
      t.ok(/trail/i.test(r.trToast), 'the toast says the trail stays in charge: ' + r.trToast);
      t.eq(r.clr, '', 'the stop can be cleared, as at the open');
      t.eq(r.clrState.sl, null, 'no basket stop'); t.ok(r.clrState.legs.every(x => x == null), 'no disaster stops'); t.ok(r.clrState.risk == null, 'risk unknown without a stop');
      t.ok(/close pending|closing/i.test(r.closing), 'a closing basket cannot be edited: ' + r.closing);
      t.noErrors(page);
    }
  },
  {
    name: 'BKP29 basket vs single positions: the ticket says on which currency and how much it adds to or hedges, without blocking',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(async () => {
        const out = {};
        // a single EUR/USD sell of 4 lots: short EUR, long USD
        openPosition({ sym: 'EURUSD', side: 'sell', lots: 4, pmDone: true });
        const c = bkCfg(); c.bkSel = 'dxy'; c.bkPane = 'tr'; obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
        const b = bkGet('dxy'), sz = BK.sz;
        out.buy = bkCcyOverlap(b, 'buy', sz.lots); out.sell = bkCcyOverlap(b, 'sell', sz.lots);
        const e0 = exposureOf(S.positions.filter(p => !p.bgid)).ccy, x = exposureOf(bkLegs(b, sz.lots, 'buy')).ccy;
        out.wantEur = e0.EUR + x.EUR;
        out.txt = document.querySelector('[data-bk-ccyx]')?.textContent.replace(/\s+/g, ' ') || '';
        out.btn = [...document.querySelectorAll('[data-bk-trade]')].map(x => x.disabled);
        out.flags = bkFlags(b, 'buy', sz, bkCost(bkLegs(b, sz.lots, 'buy'), sz.lots), bkVol(b)).map(f => f.join(':'));
        out.flagsSell = bkFlags(b, 'sell', sz, bkCost(bkLegs(b, sz.lots, 'sell'), sz.lots), bkVol(b)).map(f => f[0]);
        // basket legs are not single positions: an open basket alone gives no overlap line
        T.reset(); bkExec(b, 'buy', sz, null, []); obsDraw();
        out.onlyBasket = bkCcyOverlap(b, 'buy', sz.lots).length;
        out.txt2 = document.querySelector('[data-bk-ccyx]')?.textContent || '';
        return out;
      });
      const eur = r.buy.find(x => x.k === 'EUR');
      t.ok(eur && eur.kind === 'adds', 'buying the DXY adds to the short EUR: ' + JSON.stringify(r.buy));
      t.near(eur.after, r.wantEur, 'EUR after = single positions + basket legs', 1e-9, 1);
      t.ok(/adds to your short EUR from EUR\/USD sell: EUR −\$\d/.test(r.txt) && /after this/.test(r.txt), 'the ticket line names the currency, the pair and the amount: ' + r.txt);
      const se = r.sell.find(x => x.k === 'EUR');
      t.ok(se && (se.kind === 'hedges' || se.kind === 'reverses'), 'selling the DXY hedges it: ' + JSON.stringify(r.sell));
      t.ok(/hedges your short EUR|reverses your short EUR/.test(r.txt), 'the sell side is called a hedge: ' + r.txt);
      t.deep(r.btn, [false, false], 'nothing is blocked');
      t.ok(r.flags.some(f => /^corr:.*EUR/.test(f)), 'the pre-trade flags carry the overlap on a buy: ' + r.flags.join(' / '));
      t.ok(!r.flagsSell.includes('corr'), 'a hedge is not flagged as stacking');
      t.eq(r.onlyBasket, 0, 'an open basket alone is not counted as a single position');
      t.eq(r.txt2, '', 'no overlap line then');
      t.noErrors(page);
    }
  },
  {
    name: 'BKP30 legs: share of notional and of cost on each, the costliest marked, "excluding <PAIR>" suggestion computed, with a duplicate button',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await show(page, 'riskon');
      const r = await page.evaluate(async () => {
        const out = {}, run = id => {
          const c = bkCfg(); c.bkSel = id; obsDraw();
          const b = bkGet(id), sz = BK.sz, cost = bkCost(bkLegs(b, sz.lots, 'buy'), sz.lots), sh = bkLegShares(cost.rows), sug = bkDropSug(b, sz.lots, cost);
          const rows = [...document.querySelectorAll('.bk-legs tbody tr')].map(tr => ({ txt: tr.textContent.replace(/\s+/g, ' '), max: tr.classList.contains('bk-leg-max') }));
          return { sh, sug, rows, sugTxt: document.querySelector('[data-bk-drop]')?.textContent.replace(/\s+/g, ' ') || '', btn: document.querySelector('[data-bk-dupx]')?.dataset.bkDupx || '', bp: cost.bp };
        };
        out.riskon = run('riskon'); out.bloc = run('bloc'); out.dxy = run('dxy');
        // the button duplicates the basket without the suggested currency, selects it and keeps the rest
        const id = out.riskon.sug ? 'riskon' : out.bloc.sug ? 'bloc' : 'dxy'; out.used = id;
        bkCfg().bkSel = id; obsDraw();
        const lots0 = BK.sz.lots, n0 = bkCfg().baskets.length, btn = document.querySelector('[data-bk-dupx]');
        if (btn) { btn.click(); await new Promise(r => setTimeout(r, 0)); }
        const nb = bkCfg().baskets[bkCfg().baskets.length - 1];
        out.dup = { n: bkCfg().baskets.length - n0, sel: bkCfg().bkSel === nb?.id, nb, src: bkGet(id) };
        // the cut is what the new basket actually saves at the same size
        if (btn) out.dupBp = bkCost(bkLegs(nb, lots0, 'buy'), lots0).bp;
        return out;
      });
      for (const id of ['riskon', 'bloc', 'dxy']) {
        const x = r[id];
        t.near(x.sh.reduce((a, l) => a + l.nShare, 0), 1, `${id}: notional shares sum to 100%`, 1e-9, 1e-9);
        t.near(x.sh.reduce((a, l) => a + l.cShare, 0), 1, `${id}: cost shares sum to 100%`, 1e-9, 1e-9);
        t.eq(x.rows.length, x.sh.length, `${id}: one row per leg`);
        x.sh.forEach((l, i) => t.ok(x.rows[i].txt.includes(`${Math.round(l.nShare * 100)}% of notional`) && x.rows[i].txt.includes(`${Math.round(l.cShare * 100)}% of cost`), `${id}: row shows its shares: ${x.rows[i].txt}`));
        const imax = x.sh.reduce((m, l, i) => l.cost + l.comm > x.sh[m].cost + x.sh[m].comm ? i : m, 0);
        t.ok(x.rows[imax].max && x.rows.filter(y => y.max).length === 1, `${id}: only the costliest leg is marked`);
        const over = x.sh.some(l => l.cShare > 2 * l.nShare);
        t.eq(!!x.sug, over, `${id}: a suggestion iff a leg costs more than 2× its notional share`);
        if (x.sug) {
          t.ok(x.sugTxt.includes(`excluding ${x.sug.pair}`) && x.sugTxt.includes(`${x.sug.cut.toFixed(1)} bp`), `${id}: suggestion text: ${x.sugTxt}`);
          t.ok(x.sug.cut > 0 && x.sug.to < x.bp, `${id}: the cut is a real saving: ${x.sug.cut}`);
          t.near(x.sug.from - x.sug.to, x.sug.cut, `${id}: cut = cost now − cost without it`, 1e-9, 1e-9);
          t.eq(x.btn, x.sug.ccy, `${id}: the button drops ${x.sug.ccy}`);
        }
      }
      t.ok(r.riskon.sug || r.bloc.sug, 'risk-on or bloc carries a suggestion (the review: 16 / 14.4 bp of cost)');
      t.eq(r.dup.n, 1, 'the button adds one basket'); t.ok(r.dup.sel, 'and selects it');
      const ccy = r[r.used].sug.ccy;
      t.ok(!(ccy in r.dup.nb.long) && !(ccy in r.dup.nb.short), `the copy has no ${ccy}`);
      t.ok(Object.keys(r.dup.nb.long).length + Object.keys(r.dup.nb.short).length === Object.keys(r.dup.src.long).length + Object.keys(r.dup.src.short).length - 1, 'every other currency kept');
      t.ok(/without/i.test(r.dup.nb.name), 'its name says what was dropped: ' + r.dup.nb.name);
      t.near(r.dupBp, r[r.used].sug.to, 'the copy costs what the suggestion said', 1e-6, .05);
      t.noErrors(page);
    }
  },
  {
    name: 'BKP31 replication: open basket P&L vs index move × notional ($ and bp); minimum size at which the legs replicate the index',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.evaluate(MOVE);
      await show(page);
      const r = await page.evaluate(() => {
        const out = {}, b = bkGet('dxy'), c = bkCfg();
        const g = bkExec(b, 'buy', bkSize(b, c, bkVol(b)), null, []);
        bkMoveIdx(b, 8 / 1e4); obsDraw(); bkTick();
        const st = bkGroupState(g), e = bkRepErr(g, st);
        out.e = e; out.want = st.pnl - st.mv / 1e4 * g.lots * 1e5; out.wantBp = out.want / (g.lots * 1e5) * 1e4;
        out.cell = document.querySelector(`[data-bkg-rep="${g.gid}"]`)?.textContent.replace(/\s+/g, ' ') || '';
        out.tip = document.querySelector(`[data-bkg-rep="${g.gid}"]`)?.dataset.tip || '';
        // minimum replicating size: below it a leg drops under its minimum lot or a currency drifts > 2% of notional
        const mn = bkMinRep(b); out.min = mn;
        const ok = l => bkRepOk(b, l);
        out.okAt = ok(mn); out.badBelow = ok(Math.round((mn - .01) * 100) / 100);
        out.okAbove = [mn, mn + .05, mn + .37, 1, 3.3].every(ok);
        out.dxy01 = bkRepOk(b, .1);
        c.bkMode = 'lots'; c.bkLots = .1; obsDraw();
        out.txt = document.querySelector('[data-bk-minrep]')?.textContent.replace(/\s+/g, ' ') || '';
        out.cls = document.querySelector('[data-bk-minrep]')?.className || '';
        c.bkLots = 2; obsDraw();
        out.txt2 = document.querySelector('[data-bk-minrep]')?.textContent.replace(/\s+/g, ' ') || '';
        return out;
      });
      t.near(r.e.usd, r.want, 'replication error in $ = legs P&L − index move × notional', 1e-9, 1e-6);
      t.near(r.e.bp, r.wantBp, 'and in bp of notional', 1e-9, 1e-6);
      t.ok(r.cell.includes(r.e.usd < 0 ? '−' : '+') && /bp/.test(r.cell) && /\$/.test(r.cell), 'shown next to the P&L: ' + r.cell);
      t.ok(/spread|cost/i.test(r.tip) && /round/i.test(r.tip), 'its tooltip says what the gap is made of: ' + r.tip);
      t.ok(r.min > .1 && r.min < 5, 'DXY minimum replicating size: ' + r.min);
      t.ok(r.okAt && r.okAbove, 'replicates at and above it');
      t.ok(!r.badBelow, 'not one step below');
      t.ok(!r.dxy01, 'DXY at 0.1 does not replicate (the review: the CHF leg is lost)');
      t.ok(r.txt.includes(`below ${r.min.toFixed(2)}`) && /no longer replicate the index/.test(r.txt), 'the ticket says it at 0.1: ' + r.txt);
      t.ok(/\bdn\b/.test(r.cls), 'shown as a warning below the minimum');
      t.ok(r.txt2.includes(r.min.toFixed(2)) && !/no longer replicate/.test(r.txt2), 'above it, the minimum is stated quietly: ' + r.txt2);
      t.noErrors(page);
    }
  },
  {
    name: 'BKP32 "Equalise risk" explains itself: volatility per side, correlations ignored',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const c = bkCfg(); c.baskets.push({ id: 'c9', name: 'Mine', long: { EUR: 1, GBP: 1 }, short: { USD: 1, JPY: 1 } }); c.bkSel = 'c9'; c.bkPane = 'an';
        obsCfg().view = 'bask'; setTab('obs'); renderObs(); obsDraw();
        const b = document.querySelector('[data-bk-eq]'); return { tip: b?.dataset.tip || '', tag: b?.tagName, title: b?.getAttribute('title') };
      });
      t.eq(r.tag, 'BUTTON', 'the button is there');
      t.ok(/volatility/i.test(r.tip) && /each side|on its side|per side/i.test(r.tip), 'says it equalises volatility per side: ' + r.tip);
      t.ok(/ignor\w* (the )?correlations/i.test(r.tip), 'says it ignores the correlations: ' + r.tip);
      t.eq(r.title, null, 'one tooltip layer (data-tip), no native title');
      t.noErrors(page);
    }
  },
  {
    name: 'BKP33 closed market (Saturday, pinned clock): leg shares, minimum size and the overlap line still draw',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-17T12:00:00Z') }); // a Saturday: FX closed whatever day the suite runs
      await ready(page);
      await show(page);
      const r = await page.evaluate(() => {
        const out = { open: mktState('EURUSD').open };
        // an open single position and a basket group written as if opened before the close
        S.positions.push({ id: 99001, sym: 'EURUSD', side: 'sell', lots: 4, entry: Engine.mid('EURUSD'), sl: null, tp: null, trail: 0, open: Engine.simTime, swap: 0, comm: 0 });
        obsDraw();
        out.txt = document.querySelector('.bk-pn:not([hidden])').textContent.replace(/\s+/g, ' ');
        out.minrep = !!document.querySelector('[data-bk-minrep]'); out.ccyx = !!document.querySelector('[data-bk-ccyx]');
        return out;
      });
      t.eq(r.open, false, 'the market is closed');
      t.ok(/% of notional, \d+% of cost/.test(r.txt), 'leg shares drawn');
      t.ok(r.minrep, 'minimum replicating size drawn');
      t.ok(r.ccyx && /adds to your short EUR from EUR\/USD sell/.test(r.txt), 'overlap line drawn: ' + r.txt.slice(0, 200));
      t.noErrors(page);
    }
  }
];
