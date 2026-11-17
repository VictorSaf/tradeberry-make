// Valul 1, v1-state (.mace/design/wave1-honest-stats.md, contracts C3/C4): sanitizeState checks the type of every
// field of S.bt, S.set.obs, S.set.pm, S.set.tilt, the basket rows (bkPos, bkHist, bkAlerts, bkOrders) and p.im
// against one declarative table (SHAPES, app.js). An invalid value is removed and reported (the module then puts its
// default back), unknown keys are dropped, S.bt.trials keeps the rules of btTrials, and a valid export comes back
// unchanged.
const lazy = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready' && typeof btCfg === 'function' && typeof bkCfg === 'function', null, { timeout: 30000 });

export const tests = [
  {
    name: 'VST-proto keys named like Object.prototype members (hasOwnProperty, toString, ...) are dropped silently, never a throw',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await lazy(page);
      const r = await page.evaluate(() => {
        const P = ['hasOwnProperty', 'valueOf', 'propertyIsEnumerable', '__defineGetter__', 'isPrototypeOf', 'toString', 'toLocaleString'];
        const junk = () => Object.fromEntries(P.map(k => [k, k === 'toString' ? '<img onerror=1>' : 1]));
        const row = { gid: 'g1', bid: 'dxy', name: 'Dollar', side: 'buy', lots: 1, v0: 0, t0: 1 };
        const out = {};
        const run = (label, st) => { const o = {}; try { const s = sanitizeState({ balance: 1e5, positions: [], ...st }, o); out[label] = { s, dropped: o.dropped || [] }; } catch (e) { out[label] = { err: String(e) }; } };
        run('bt', { bt: { slK: 2, ...junk(), p: { ...BT_DEF.p, ...junk() } } });
        run('set', { set: { obs: { view: 'bask', ...junk() }, pm: { on: true, ...junk() }, tilt: { on: false, ...junk() } } });
        run('bk', { bkPos: [{ ...row, ...junk() }] });
        const res = {};
        for (const [k, v] of Object.entries(out)) res[k] = v.err ? { err: v.err } : { dropped: v.dropped };
        if (out.bt.s) res.btKeys = Object.keys(out.bt.s.bt).sort().join() + '|' + Object.keys(out.bt.s.bt.p).join();
        if (out.set.s) res.setKeys = ['obs', 'pm', 'tilt'].map(k => Object.keys(out.set.s.set[k]).join()).join('|');
        if (out.bk.s) res.bk = JSON.stringify(out.bk.s.bkPos);
        return { res, row: JSON.stringify([row]) };
      });
      for (const k of ['bt', 'set', 'bk']) { t.ok(!r.res[k].err, `${k}: no throw ${r.res[k].err || ''}`); t.deep(r.res[k].dropped || [], [], `${k}: dropped silently, no note`); }
      t.eq(r.res.btKeys, 'p,slK|' + 'emaF,emaS,rsiN,bbN,bbK,dcN', 'only known bt keys kept');
      t.eq(r.res.setKeys, 'view|on|on', 'only known obs/pm/tilt keys kept');
      t.eq(r.res.bk, r.row, 'the bkPos row kept without the prototype-named keys');
      t.noErrors(page);
    }
  },
  {
    name: 'VST1 S.bt: a bad value is removed and reported, btCfg() puts the default back; unknown keys go; trials keep the btTrials rules',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await lazy(page);
      const r = await page.evaluate(() => {
        const cfd = Object.keys(Engine.META).find(k => Engine.META[k].kind === 'cfd');
        const good = { key: 'ema|EURUSD|15', h: 'abc', t: 1, n: 10, expR: .1, sharpe: .2 };
        const bt = { ...JSON.parse(JSON.stringify(BT_DEF)), slK: '<img onerror=1>', costMode: 'live', dir: 'up', tf: 7, junk: 1,
          p: { emaF: 'x', emaS: 21 }, long: [{ a: 'emaF', c: 'xa', b: '<b>', v: 0, on: true }], slPts: { [cfd]: 40, EURUSD: 40, [cfd + 'x']: 1 },
          trials: [good, { key: 'x', h: 1 }, 'junk', { ...good, h: 'def', sharpe: 'NaN' }, { ...good, h: 'ghi', extra: { a: 1 } }] };
        const opts = {}, s = sanitizeState({ balance: 1e5, positions: [], bt }, opts);
        const out = { has: k => k in s.bt, keys: {}, trials: s.bt.trials, dropped: opts.dropped || [] };
        for (const k of ['slK', 'costMode', 'dir', 'tf', 'junk', 'p', 'long', 'short', 'risk', 'slPts']) out.keys[k] = k in s.bt;
        out.slPts = JSON.stringify(s.bt.slPts) === JSON.stringify({ [cfd]: 40 });
        loadState({ balance: 1e5, positions: [], bt });
        const c = btCfg();
        out.after = { slK: c.slK, costMode: c.costMode, dir: c.dir, tf: c.tf, p: c.p, long: c.long, junk: 'junk' in c };
        // a non-object S.bt is removed whole
        const o2 = {}; out.notObj = 'bt' in sanitizeState({ balance: 1e5, bt: [1, 2] }, o2); out.notObjWhy = o2.dropped || [];
        // more than 500 tries: the newest 500 stay (btTrials keeps slice(-500))
        const many = Array.from({ length: 520 }, (_, i) => ({ ...good, h: 'h' + i }));
        const s3 = sanitizeState({ balance: 1e5, bt: { trials: many } }, {});
        out.many = { n: s3.bt.trials.length, first: s3.bt.trials[0].h };
        return out;
      });
      t.deep(r.keys, { slK: false, costMode: false, dir: false, tf: false, junk: false, p: false, long: false, short: true, risk: true, slPts: true }, 'invalid and unknown keys removed, valid ones kept');
      t.ok(r.slPts, 'per-instrument stop override keeps only CFD entries with a valid value');
      t.deep(r.trials.map(x => x.h), ['abc', 'ghi'], 'trials filtered by the btTrials rule');
      t.ok(!('extra' in r.trials[1]), 'unknown keys of a trial row dropped');
      t.ok(r.dropped.some(m => /backtester/.test(m) && /slK/.test(m)), 'slK reported: ' + JSON.stringify(r.dropped));
      t.ok(r.dropped.some(m => /backtester/.test(m) && /trial/.test(m)), 'left-out trials reported');
      t.ok(!r.dropped.some(m => /junk/.test(m)), 'unknown keys are dropped silently');
      t.deep(r.after, { slK: 2, costMode: 'account', dir: 'both', tf: 15, p: { emaF: 9, emaS: 21, rsiN: 14, bbN: 20, bbK: 2, dcN: 20 },
        long: [{ a: 'emaF', c: 'xa', b: 'emaS', v: 0, on: true }, { a: 'close', c: 'gt', b: 'emaS', v: 0, on: false }], junk: false }, 'btCfg() puts the defaults back');
      t.eq(r.notObj, false, 'a non-object S.bt is removed'); t.ok(r.notObjWhy.some(m => /backtester/.test(m)), 'and reported');
      t.deep(r.many, { n: 500, first: 'h20' }, 'at most 500 tries, the newest kept');
      t.noErrors(page);
    }
  },
  {
    name: 'VST2 S.set.obs / pm / tilt: lb=1e9, pm.on="yes", tilt.streak=-1 removed and reported; the modules put their defaults back',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await lazy(page);
      const r = await page.evaluate(() => {
        const set = { obs: { view: 'bask', lb: 1e9, dcTh: .1, foo: '<img>', bkSel: '<b>', bkLots: 2, bkSl: 'auto', bkTp: 30, scAlert: 'yes',
            baskets: [{ id: 'b1', name: 'Mine', long: { EUR: 1 }, short: { USD: 2 } }, { id: 'b2', name: 'Bad', long: { EUR: 'x' }, short: {} }, { id: '<b>', name: 'x', long: {}, short: {} }] },
          pm: { on: 'yes', minRisk: 1, noSL: true, until: 0, skips: 2, zz: 1 }, tilt: { on: false, streak: -1, dayLoss: 3, cool: 15 } };
        const opts = {}, s = sanitizeState({ balance: 1e5, positions: [], set }, opts), o = s.set.obs;
        const out = { obs: Object.keys(o).sort(), baskets: o.baskets.map(b => b.id), pm: s.set.pm, tilt: s.set.tilt, dropped: opts.dropped || [] };
        loadState({ balance: 1e5, positions: [], set });
        out.after = { pmOn: pmCfg().on, skips: pmCfg().skips, streak: tiltCfg().streak, tiltOn: tiltCfg().on, lb: obsCfg().lb, sel: bkCfg().bkSel, lots: bkCfg().bkLots };
        // not objects: removed whole, the module starts fresh
        const o2 = {}, s2 = sanitizeState({ balance: 1e5, set: { obs: 'x', pm: [1], tilt: 5 } }, o2);
        out.whole = { obs: 'obs' in s2.set, pm: 'pm' in s2.set, tilt: 'tilt' in s2.set, n: (o2.dropped || []).length };
        return out;
      });
      t.deep(r.obs, ['baskets', 'bkLots', 'bkSl', 'bkTp', 'dcTh', 'view'], 'S.set.obs: lb, bkSel, scAlert removed, foo dropped');
      t.deep(r.baskets, ['b1'], 'invalid custom baskets left out');
      t.deep(r.pm, { minRisk: 1, noSL: true, until: 0, skips: 2 }, 'pm.on removed, unknown key dropped');
      t.deep(r.tilt, { on: false, dayLoss: 3, cool: 15 }, 'tilt.streak removed');
      for (const re of [/Observatory.*lb/, /Observatory.*bkSel/, /Observatory.*scAlert/, /basket/i, /pre-mortem.*on/, /tilt.*streak/])
        t.ok(r.dropped.some(m => re.test(m)), `reported ${re}: ${JSON.stringify(r.dropped)}`);
      t.ok(!r.dropped.some(m => /foo|zz/.test(m)), 'unknown keys dropped silently');
      t.deep(r.after, { pmOn: true, skips: 2, streak: 3, tiltOn: false, lb: 1440, sel: 'dxy', lots: 2 }, 'defaults back, the valid choices kept');
      t.deep(r.whole, { obs: false, pm: false, tilt: false, n: 3 }, 'non-object settings removed whole and reported');
      t.noErrors(page);
    }
  },
  {
    name: 'VST3 basket rows: a bkPos row with lots "x" or side "<b>" is left out with a note; bad bkHist/bkAlerts/bkOrders rows too',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await lazy(page);
      const r = await page.evaluate(() => {
        const g = { gid: 'gabc1', bid: 'dxy', name: 'Dollar index (DXY-style)', side: 'buy', lots: 1, v0: 1.01, t0: 100, sl: 50, tp: 75, trail: 0, be: 0, pk: 3, mae: -2, risk: 500, pm: null, timeStop: 0 };
        const h = { gid: 'gabc0', name: 'Yen index', side: 'sell', t0: 1, t1: 2, pnl: -12.5, mv: -3, mfe: 1, mae: -4, sl: 50, reason: 'Basket close', risk: 500 };
        const a = { bid: 'yen', name: 'Yen index', bp: 20, t: 5, up: 1.002, dn: .998 };
        const od = { bid: 'euro', name: 'Euro index', side: 'sell', type: 'limit', bp: 15, dir: 1, trig: 1.0015, t: 9, sz: { sl: 40, tp: 60, lots: .5, risk: 200, pct: .2 }, pm: null, flags: [['size', 'Risking a lot']] };
        const raw = { balance: 1e5, positions: [],
          bkPos: [g, { ...g, gid: 'gx', lots: 'x' }, { ...g, gid: 'gy', side: '<b>' }, { ...g, gid: 'gz', zz: 1, beSet: true }, { ...g, gid: 'gneg', bid: 'yen', v0: -5.07 }, { ...g, gid: 'gnan', v0: 'NaN' }, { ...g, gid: 'ginf', v0: Infinity }],
          bkHist: [h, { ...h, pnl: 'big' }, 7], bkAlerts: [a, { ...a, up: null }], bkOrders: [od, { ...od, type: 'market' }, { ...od, sz: { lots: -1 } }] };
        const opts = {}, s = sanitizeState(raw, opts);
        const o2 = {}, s2 = sanitizeState({ balance: 1e5, bkPos: 'x', bkHist: { a: 1 } }, o2);
        return { pos: s.bkPos.map(x => x.gid), z: s.bkPos[1], hist: s.bkHist.length, al: s.bkAlerts.length, ord: s.bkOrders.length, ord0: s.bkOrders[0], dropped: opts.dropped || [],
          notList: { pos: s2.bkPos, hist: s2.bkHist, n: (o2.dropped || []).length } };
      });
      t.deep(r.pos, ['gabc1', 'gz', 'gneg'], 'bkPos keeps the valid rows, a negative index v0 (Yen index, Commodity bloc) included');
      t.ok(r.dropped.some(m => /basket position gnan/.test(m) && /v0/.test(m)) && r.dropped.some(m => /basket position ginf/.test(m) && /v0/.test(m)), 'a non-finite v0 is still left out and reported');
      t.ok(!r.dropped.some(m => /gneg/.test(m)), 'no note for the negative v0');
      t.ok(!('zz' in r.z) && r.z.beSet === true, 'unknown key dropped, beSet kept');
      t.eq(r.hist, 1, 'bkHist'); t.eq(r.al, 1, 'bkAlerts'); t.eq(r.ord, 1, 'bkOrders');
      t.deep(r.ord0.flags, [['size', 'Risking a lot']], 'order flags kept');
      t.ok(r.dropped.some(m => /basket position gx/.test(m) && /lots/.test(m)), 'lots reported: ' + JSON.stringify(r.dropped));
      t.ok(r.dropped.some(m => /basket position gy/.test(m) && /side/.test(m)), 'side reported');
      t.ok(r.dropped.filter(m => /basket/.test(m)).length >= 6, 'every row left out is reported');
      t.deep(r.notList, { pos: [], hist: [], n: 2 }, 'a basket list that is not a list is emptied and reported');
      t.noErrors(page);
    }
  },
  {
    name: 'VST4 p.im (C4): Infinity, negative, above MONEY_MAX or text removed and reported; a valid one kept; the account margins it at entry',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(() => T.reset());
      const r = await page.evaluate(() => {
        const q = Engine.quote('EURUSD'), p = (id, im) => ({ id, sym: 'EURUSD', side: 'buy', lots: 1, entry: q.ask, open: 1, im });
        const opts = {}, s = sanitizeState({ balance: 1e5, positions: [p(1, Infinity), p(2, -5), p(3, 2e12), p(4, '3666'), p(5, 3666.67), p(6)] }, opts);
        const ims = s.positions.map(x => 'im' in x ? x.im : 'none');
        loadState({ balance: 1e5, positions: [p(1, Infinity)] }); S.set.jur = 'eu'; S.set.lev = 30;
        const mg = account().mg, want = imAtEntry(S.positions[0]);
        return { n: s.positions.length, ims, dropped: opts.dropped || [], mg, want };
      });
      t.eq(r.n, 6, 'positions kept');
      t.deep(r.ims, ['none', 'none', 'none', 'none', 3666.67, 'none'], 'only the valid im kept');
      t.eq(r.dropped.filter(m => /initial margin/.test(m)).length, 4, 'each invalid im reported: ' + JSON.stringify(r.dropped));
      t.near(r.mg, r.want, 'margined at its entry price', 1e-9);
      t.noErrors(page);
    }
  },
  {
    name: 'VST5 a valid export (demo + backtests + baskets + observatory) comes back identical through sanitizeState, with no note',
    async run({ t, app }) {
      const page = await app('?demo=1', { clock: true, demo: true });
      await page.waitForFunction(() => S.demo && S.history.length > 100, null, { timeout: 30000 });
      await lazy(page);
      await page.evaluate(async () => { T.feed(['EURUSD', 'GBPUSD']); for (const s of ['EURUSD', 'GBPUSD']) await btLoad(s, btCfg().hist || 8); });
      await page.evaluate(() => setTab('bt'));
      await page.waitForFunction(() => !!document.querySelector('#btCfg #btSym') && BT.res, null, { timeout: 30000 });
      const r = await page.evaluate(() => {
        S.set.jur = 'eu'; S.set.lev = null;
        const cfd = Object.keys(Engine.META).find(k => Engine.META[k].kind === 'cfd'); setSymbol(cfd); S.tk.sl += 5; setSymbol('EURUSD');
        const c = btCfg(); c.costMode = 'declared'; c.dSpread = 1.2; btRunAll(); c.sym = 'GBPUSD'; btRunAll();
        const o = obsCfg(); labCfg(o); o.view = 'bask'; bkCfg();
        o.baskets.push({ id: 'bt1', name: 'Mine', long: { EUR: 1, GBP: .5 }, short: { USD: 1 } });
        const b = bkGet('dxy'), sz = bkSize(b, bkCfg(), bkVol(b));
        bkExec(b, 'buy', sz, null, []); bkPlace(bkGet('yen'), 'sell', sz, null, [['size', 'x']], 'limit', 15);
        S.bkAlerts.push({ bid: 'euro', name: 'Euro index', bp: 20, t: Engine.simTime, up: 1.002, dn: .998 });
        const g = S.bkPos[0]; if (g) bkHalf(g.gid);
        S.bkPos.forEach(x => bkCloseGroup(x.gid)); bkExec(b, 'sell', sz, null, []);
        // the Yen index and the Commodity bloc sit below 0 (a sum of logs): they must come back too
        for (const id of ['yen', 'bloc']) { const bb = bkGet(id); bkExec(bb, 'buy', bkSize(bb, bkCfg(), bkVol(bb)), null, []); }
        account();
        const x = JSON.parse(JSON.stringify(S)), opts = {}, y = sanitizeState(JSON.parse(JSON.stringify(S)), opts);
        const pick = v => JSON.stringify({ bt: v.bt, obs: v.set.obs, pm: v.set.pm, tilt: v.set.tilt, bkPos: v.bkPos, bkHist: v.bkHist, bkAlerts: v.bkAlerts, bkOrders: v.bkOrders, im: v.positions.map(p => p.im) });
        const sub = (a, b) => { if (!a || !b || typeof a !== 'object') return [String(JSON.stringify(a)).slice(0, 80), String(JSON.stringify(b)).slice(0, 80)]; const ks = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])); return ks.length ? ks.slice(0, 3).map(k => k + ':' + JSON.stringify(sub(a[k], b[k])).slice(0, 200)) : ['order: ' + Object.keys(a).join() + ' | ' + Object.keys(b).join()]; };
        const diff = Object.keys(x).filter(k => JSON.stringify(x[k]) !== JSON.stringify(y[k])).concat(Object.keys(y).filter(k => !(k in x))).map(k => k + ' ' + JSON.stringify(sub(x[k], y[k])));
        // the value-preserving fills sanitizeState makes on every load (flags defaulted to false, MAE/MFE/riskUsd null by challenge.js, swap 0, a null ticket price
        // left to its null default, set.lev re-added last), then the keys sorted: anything else is a change
        const canon = v => { const c = JSON.parse(JSON.stringify(v)); for (const p of c.positions) if (p.trailed === false) delete p.trailed; for (const h of c.history) { if (h.nbp === false) delete h.nbp; for (const k of ['mae', 'mfe', 'riskUsd']) if (h[k] === null) delete h[k]; if (h.swap === 0) delete h.swap; }
          if (c.tk && c.tk.price === null) delete c.tk.price; const srt = z => Array.isArray(z) ? z.map(srt) : z && typeof z === 'object' ? Object.fromEntries(Object.keys(z).sort().map(k => [k, srt(z[k])])) : z; return JSON.stringify(srt(c)); };
        const yy = sanitizeState(JSON.parse(JSON.stringify(y)), {});
        const cx = canon(x), cy = canon(y); let ci = 0; while (ci < cx.length && cx[ci] === cy[ci]) ci++;
        return { cdiff: cx.slice(ci - 150, ci + 150) + ' ||| ' + cy.slice(ci - 150, ci + 150), canon: cx === cy, fix: JSON.stringify(yy) === JSON.stringify(y), bySym: !!(x.tk.bySym && Object.keys(x.tk.bySym).length && x.tk.lotsBy && Object.keys(x.tk.lotsBy).length), diff, same: pick(x) === pick(y), whole: JSON.stringify(x) === JSON.stringify(y), a: pick(x).slice(0, 300), b: pick(y).slice(0, 300), dropped: opts.dropped || [],
          n: { trials: x.bt.trials.length, bkPos: x.bkPos.length, bkNeg: x.bkPos.filter(g => g.v0 < 0).length, bkHist: x.bkHist.length, bkOrders: x.bkOrders.length, im: x.positions.filter(p => p.im > 0).length } };
      });
      t.ok(r.n.trials >= 2 && r.n.bkPos >= 3 && r.n.bkNeg >= 1 && r.n.bkHist >= 1 && r.n.bkOrders >= 1 && r.n.im >= 3, 'the export holds every shape: ' + JSON.stringify(r.n));
      t.deep(r.dropped, [], 'no note on a valid export');
      t.ok(r.same, `checked fields identical\n${r.a}\n${r.b}`);
      t.ok(r.canon, 'the whole state identical (up to the load fills): ' + r.cdiff);
      t.ok(r.fix, 'a second pass changes nothing');
      t.ok(r.bySym, 'the ticket distances per instrument and sizes (tk.bySym, tk.lotsBy) are in the export and kept');
      t.noErrors(page);
    }
  }
];
