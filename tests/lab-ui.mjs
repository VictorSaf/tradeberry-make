// Observatory review, honesty (P1) and UI (P3) of Edge check, Range cone and Exit lab (lab2, 24.10.2026).
// Closed market: Saturday 24.10.2026 (FX shut); open: Wednesday 21.10.2026 14:00 UTC.
const SAT = new Date('2026-10-24T12:00:00Z'), WED = new Date('2026-10-21T14:00:00Z');
const boot = async (app, clock = WED) => { const page = await app('', { clock }); await page.evaluate(() => loadLazy()); return page; };
// the Observatory on screen (Research › Observatory), so focus and clicks reach it
async function obsApp(app, clock = WED) {
  const page = await app('', { clock });
  await page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState, null, { timeout: 30000 });
  await page.evaluate(async () => { T.reset(); await loadLazy(); setView('research', 'obs'); await new Promise(r => setTimeout(r, 200)); });
  return page;
}

export const tests = [
  /* ---------------- Edge check ---------------- */
  {
    name: 'LABUI scan 1 · one survivor is not a green box: it is set against the measured noise rate',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const out = {};
        for (const nR of [0, 1, 2]) {
          const c = { scH: 8, scF: 'all' }, x = scRun(8); x.nFdr = nR; LAB.scan = x; LAB.scanKey = `8|${Math.floor(Engine.simTime / 900)}`;
          const b = document.createElement('div'); drawScan(b, c); const v = b.querySelector('.sc-verdict');
          out[nR] = { cls: v.className, txt: v.textContent, tip: v.dataset.tip, all: b.textContent };
        }
        return { out, nul: SC_NULL };
      });
      for (const k of ['1', '2']) t.ok(!/\bok\b/.test(r.out[k].cls), `${k} survivor(s): no green box (${r.out[k].cls})`);
      const one = Math.round(1 / r.nul[8][0]);
      t.ok(r.out[1].txt.includes(`1 survivor; about 1 in ${one} scans of pure noise has one`), 'one survivor against the noise rate: ' + r.out[1].txt);
      t.ok(/2 survivors; about 1 in \d+ scans of pure noise has 2 or more/.test(r.out[2].txt), 'two survivors: ' + r.out[2].txt);
      for (const k of ['0', '1', '2']) t.ok(/not independent/.test(r.out[k].all) && /optimistic/.test(r.out[k].all), `${k}: the correction's independence assumption is stated`);
      t.ok(r.nul[4][0] > .05 && r.nul[4][0] < .2 && r.nul[16][0] > .03, 'measured rates in the code: ' + JSON.stringify(r.nul));
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI scan 2 · pooled t is clustered by time: the same triggers on two pairs are not twice the evidence',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
        const fw = Array.from({ length: 40 }, () => rnd() * 10 - 4), ts = fw.map((_, i) => 1e9 + i * 4 * 7200);
        const e = { fwAll: fw, ts }, one = scPoolT([e], 8), two = scPoolT([e, { fwAll: fw.slice(), ts: ts.slice() }], 8), naive = labT([...fw, ...fw]);
        // independent times: clustering changes nothing much
        const e2 = { fwAll: fw.map(x => -x * .5 + 1), ts: ts.map(x => x + 3600 * 4) }, ind = scPoolT([e, e2], 8), indN = labT([...fw, ...e2.fwAll]);
        return { one, two, naive, ind, indN };
      });
      t.ok(Math.abs(r.naive) > 1.3 * Math.abs(r.one), 'premise: the naive pooled t grows with the duplicate');
      t.ok(Math.abs(r.two) <= Math.abs(r.one) * 1.05, `clustered t: ${r.two} vs one pair ${r.one}`);
      t.ok(Math.abs(r.ind - r.indN) < .35 * Math.abs(r.indN) + .2, `independent triggers: ${r.ind} ≈ ${r.indN}`);
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI scan 3 · no "1 in 20"; results after the spread; Open chart sets a side only on Robust; detail neutral',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const tips = ['robust', 'unst', 'edge', 'revsig', 'rev', 'noise', 'thin'].map(k => scVtip(k, 40, 2.4));
        // a fabricated board: one row of each verdict
        const x = scRun(8), mk = (t, fdr, stable) => ({ n: 20, t, fdr, stable, hit: 55, baseHit: 50, avg: 3, avgNet: 1.5, hitNet: 51, fwAll: [] });
        x.rows = [['EURUSD', mk(3, true, true), 1], ['GBPUSD', mk(2.5, false, true), -1], ['USDJPY', mk(.5, false, true), 1], ['AUDUSD', mk(-2.5, true, true), -1]].map(([sym, e, dir]) => ({ sym, s: 'brk', dir, ago: 0, e, px: Engine.mid(sym) }));
        LAB.scan = x; LAB.scanKey = `8|${Math.floor(Engine.simTime / 900)}`;
        const b = document.createElement('div'); drawScan(b, { scH: 8, scF: 'all' });
        const rows = [...b.querySelectorAll('tr.sc-r')].map(tr => ({ v: tr.querySelector('.sc-v').textContent, side: tr.querySelector('[data-sc-go]').dataset.scSide, tag: tr.querySelector('.tag').className }));
        const head = [...b.querySelectorAll('.sc-tbl th')].map(th => th.textContent);
        const net = scEvidence([0, ...Array(200).fill(0).map((_, i) => i % 30 === 5 ? 1 : 0)], Array.from({ length: 201 }, (_, i) => 1.1 * Math.exp(Math.sin(i / 7) * 1e-3)), 4, false, null, 2);
        const det = { robust: scDetail('EURUSD', 'brk', 8, 'robust'), noise: scDetail('EURUSD', 'brk', 8, 'noise') };
        return { tips, rows, head, net, det, srcLen: OBS_SRC.scan[0].length, cellTxt: b.querySelector('tr.sc-r td:nth-child(7)')?.textContent };
      });
      t.ok(r.tips.every(s => !/1 (?:test )?in 20/.test(s)), 'no "1 in 20" in the verdict tooltips');
      t.ok(/2\.4/.test(r.tips[2]), 'the edge tooltip gives the expected count: ' + r.tips[2]);
      t.ok(/weak check/.test(r.tips[0]), 'Robust says the halves check is weak: ' + r.tips[0]);
      t.ok(r.head.some(h => /after spread/i.test(h)), 'a column after the spread: ' + r.head.join(' | '));
      t.ok(/\+1\.5/.test(r.cellTxt || ''), 'after-spread cell shows avg net: ' + r.cellTxt);
      t.ok(r.net.n > 0 && Math.abs(r.net.avgNet - (r.net.avg - 2)) < 1e-9, 'avg after the spread = avg − cost: ' + JSON.stringify([r.net.avg, r.net.avgNet]));
      t.ok(r.net.hitNet <= r.net.hit, 'hit after the spread ≤ hit');
      for (const x of r.rows) {
        if (x.v === 'Robust') t.ok(x.side === 'buy' && /buy/.test(x.tag), 'Robust: Open chart sets the side ' + JSON.stringify(x));
        else t.ok(x.side === '' && !/\b(buy|sell)\b/.test(x.tag.replace('tag', '')), `${x.v}: Open chart sets no side ` + JSON.stringify(x));
      }
      t.ok(/var\(--up\)|var\(--dn\)|class="[^"]*\b(up|dn)\b/.test(r.det.robust), 'Robust detail keeps the colours of the direction');
      t.ok(!/var\(--up\)|var\(--dn\)|class="[^"]*\b(up|dn)\b/.test(r.det.noise), 'Noise detail is neutral');
      t.ok(r.srcLen <= 64, 'the source line fits: ' + r.srcLen);
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI scan 4 · "horizon", not "look ahead"; rows open from the keyboard; the record sits under its row',
    async run({ t, app }) {
      const page = await obsApp(app);
      await page.evaluate(() => {
        const x = scRun(8), mk = t => ({ n: 20, t, fdr: false, stable: true, hit: 55, baseHit: 50, avg: 3, avgNet: 1.5, hitNet: 51, fwAll: [] });
        x.rows = [['EURUSD', mk(2.5)], ['GBPUSD', mk(-2.3)]].map(([sym, e]) => ({ sym, s: 'brk', dir: 1, ago: 0, e, px: Engine.mid(sym) }));
        const c = obsCfg(); c.view = 'scan'; c.scH = 8; c.scF = 'all'; LAB.open = null;
        LAB.scan = x; LAB.scanKey = `8|${Math.floor(Engine.simTime / 900)}`; renderObs(); LAB.scan = x; LAB.scanKey = `8|${Math.floor(Engine.simTime / 900)}`; obsDraw();
      });
      const ctl = await page.evaluate(() => ({ ctl: document.getElementById('obsCtrl').textContent, tips: Object.values(OBS_CTRL_TIP.scH).join(' ') }));
      t.ok(!/look ahead/i.test(ctl.ctl) && /horizon/.test(ctl.ctl), 'control label: ' + ctl.ctl);
      t.ok(!/look ahead/i.test(ctl.tips), 'control tooltips: ' + ctl.tips);
      await page.waitForTimeout(150);
      const sel = '#obsBody tr.sc-r [data-sc-toggle]';
      t.ok(!!(await page.$(sel)), 'each row has a details button');
      t.eq(await page.getAttribute(sel, 'aria-expanded'), 'false', 'collapsed');
      await page.focus(sel); await page.keyboard.press('Enter');
      const r = await page.evaluate(() => { const tr = document.querySelector('#obsBody tr.sc-r.on'); return { open: LAB.open, next: tr?.nextElementSibling?.className, exp: tr?.querySelector('[data-sc-toggle]')?.getAttribute('aria-expanded'), focus: document.activeElement?.dataset?.scToggle }; });
      t.eq(r.open, 'EURUSD|brk', 'Enter opens the record');
      t.eq(r.next, 'sc-dr', 'the record is the row right under it');
      t.eq(r.exp, 'true', 'aria-expanded follows');
      t.eq(r.focus, 'EURUSD|brk', 'focus stays on the button after the redraw');
      t.noErrors(page);
    }
  },
  /* ---------------- Range cone ---------------- */
  {
    name: 'LABUI cone 1 · calibration verdict: n_eff shown, too few windows below 20, the 68% band counts, neutral table',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const v = (s68, s95, n, H) => cnVerdict({ s68, s95, f68: s68, f95: s95, n }, false, H);
        const out = { ok: v(68, 95, 200, 240), narrow68: v(40, 95, 200, 240), few: v(68, 95, 70, 1440), wide: v(90, 99.5, 200, 240) };
        S.set.sym = 'EURUSD'; LAB.coneKey = ''; const b = document.createElement('div'); document.body.appendChild(b); drawCone(b, { cnH: 1440, cnMode: 'model' });
        out.txt = b.querySelector('.cn-verdict')?.textContent; out.tblCls = [...b.querySelectorAll('.cn-row .tbl td')].map(td => td.className).join(' '); b.remove();
        return out;
      });
      t.eq(r.ok[0], 'ok', 'on target: well calibrated'); t.ok(/n_eff 50/.test(r.ok[1] + r.ok[2]), 'n_eff = 200 hourly windows / 4h: ' + r.ok[2]);
      t.ok(r.narrow68[0] !== 'ok' && /68%/.test(r.narrow68[2]), 'a miss on the 68% band is not calibrated: ' + r.narrow68[1]);
      t.ok(r.few[0] !== 'ok' && /too few independent windows/i.test(r.few[1] + r.few[2]), '1D: too few windows: ' + r.few[1]);
      t.ok(r.wide[0] !== 'ok', 'too wide');
      t.ok(/n_eff \d+/.test(r.txt), 'the drawn verdict shows n_eff: ' + r.txt);
      t.ok(!/\b(up|dn)\b/.test(r.tblCls), 'no up/down colours on calibration shares: ' + r.tblCls);
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI cone 2 · const-vol over the same week; Conformal without "odds hold"; Regime KPI = its tooltip',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const Mo = cnModel('EURUSD'), rr = Mo.r.filter(x => x != null), want = rr.reduce((s, x) => s + x * x, 0) / rr.length;
        S.set.sym = 'EURUSD'; LAB.coneKey = ''; const b = document.createElement('div'); document.body.appendChild(b); drawCone(b, { cnH: 240, cnMode: 'model' });
        const k = [...b.querySelectorAll('.kpi')].find(x => /Regime/.test(x.textContent)); b.remove();
        return { cvar: Mo.cvar, want, calib: cnCalib.toString().includes('cnRv('), conf: OBS_CTRL_TIP.cnMode.conf, term: OBS_TERMS.find(x => x[0] === 'Conformal')[1], kv: k.querySelector('b').textContent, ktip: k.dataset.tip };
      });
      t.near(r.cvar, r.want, 'const-vol variance: the mean over the whole week', 1e-9, 1e-18);
      t.ok(!r.calib, 'the calibration no longer uses the 240-minute window');
      t.ok(!/odds hold/.test(r.conf) && !/odds hold/.test(r.term), 'Conformal tooltips: ' + r.conf + ' / ' + r.term);
      const v = r.kv.match(/[\d.]+/)[0];
      t.ok(r.ktip.includes(v + '×'), `Regime ${v}× in the tooltip: ${r.ktip}`);
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI cone 3 · stop/target buttons: R:R at least 1 and on the right side of the spread',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const out = {};
        for (const side of ['buy', 'sell']) {
          S.set.sym = 'GBPJPY'; S.tk.side = side; LAB.coneKey = ''; const b = document.createElement('div'); document.body.appendChild(b); drawCone(b, { cnH: 240, cnMode: 'model' });
          const st = +b.querySelector('[data-cn-stop]').dataset.cnStop, tp = +b.querySelector('[data-cn-tp]').dataset.cnTp, q = Engine.quote('GBPJPY'), m = M('GBPJPY');
          const M0 = LAB.cnM, end = M0.a.length - 1, px = M0.a[end].close, f = cnRegime(M0, end), sH = Math.sqrt(cnVarPath(M0, M0.a[end].time, 240, f).at(-1)[1]);
          const lo68 = px * Math.exp(-sH), hi68 = px * Math.exp(sH), lo95 = px * Math.exp(-1.96 * sH), hi95 = px * Math.exp(1.96 * sH), entry = side === 'buy' ? q.ask : q.bid, d = side === 'buy' ? 1 : -1;
          // the bid at which the stop and the target fire: a buy exits on the bid, a sell on the ask (bid + spread)
          const sp = q.ask - q.bid, stopBid = entry - d * st * m.pip - (d > 0 ? 0 : sp), tpBid = entry + d * tp * m.pip - (d > 0 ? 0 : sp);
          out[side] = { st, tp, stopBid, tpBid, lo68, hi68, lo95, hi95, txt: b.querySelector('.cn-act').textContent };
          b.remove();
        }
        return out;
      });
      for (const s of ['buy', 'sell']) {
        const x = r[s];
        t.ok(x.tp >= x.st, `${s}: R:R ≥ 1 (${x.st} / ${x.tp})`);
        if (s === 'buy') { t.ok(x.stopBid <= x.lo68 + 1e-9, `buy stop fires below the 68% band: ${x.stopBid} ≤ ${x.lo68}`); t.ok(x.tpBid <= x.hi95 + 1e-9 || x.tp === x.st, 'buy target within the 95% band'); }
        else { t.ok(x.stopBid >= x.hi68 - 1e-9, `sell stop fires above the 68% band: ${x.stopBid} ≥ ${x.hi68}`); t.ok(x.tpBid >= x.lo95 - 1e-9 || x.tp === x.st, 'sell target within the 95% band'); }
        t.ok(/R:R 1:\d/.test(x.txt), 'R:R shown: ' + x.txt);
      }
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI cone 4 · "Touched" is the same on every redraw (seeded, no Math.random)',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        S.set.sym = 'EURUSD'; S.tk.useSL = true; S.tk.sl = 15; S.tk.useTP = true; S.tk.tp = 20; S.tk.side = 'buy';
        const draw = () => { LAB.coneKey = ''; const b = document.createElement('div'); document.body.appendChild(b); drawCone(b, { cnH: 240, cnMode: 'model' }); const v = [...b.querySelectorAll('.cn-row .tbl')].at(-1)?.textContent; b.remove(); return v; };
        const a = draw(), rnd = Math.random; let used = 0; Math.random = () => { used++; return rnd(); };
        const c = draw(); Math.random = rnd;
        return { a, c, used };
      });
      t.ok(r.a && r.a === r.c, 'same table on a redraw: ' + r.a);
      t.eq(r.used, 0, 'no Math.random in the cone');
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI cone 5 · labels off the axis, bands distinct, history in scale with H, "+2h 45m", no native title',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        S.set.sym = 'EURUSD'; S.tk.useSL = true; S.tk.sl = 15; S.tk.useTP = true; S.tk.tp = 20; S.tk.side = 'buy';
        const out = { hm: [LAB_HM(165), LAB_HM(60), LAB_HM(45), LAB_HM(1440)] };
        for (const H of [60, 240, 1440]) {
          LAB.coneKey = ''; const b = document.createElement('div'); b.id = 'obsBody'; document.body.appendChild(b); drawCone(b, { cnH: H, cnMode: 'model' });
          const svg = b.querySelector('#cnSvg'), W = svg.viewBox.baseVal.width, g = LAB.cnGeo;
          const lv = [...svg.querySelectorAll('text.cn-lvt')].map(x => +x.getAttribute('x'));
          const b68 = getComputedStyle(svg.querySelector('.cn-b68')), b95 = getComputedStyle(svg.querySelector('.cn-b95'));
          out[H] = { lv, edge: W - g.padR, histPx: g.histW, fcPx: W - g.padR - g.histW, histMin: g.histMin, H, titles: b.querySelectorAll('[title]').length, b68: b68.fill + b68.stroke, b95: b95.fill + b95.stroke + b95.strokeDasharray };
          b.remove();
        }
        return out;
      });
      t.deep(r.hm, ['2h 45m', '1h', '45m', '24h'], 'durations');
      for (const H of [60, 240, 1440]) {
        const x = r[H];
        t.ok(x.lv.length && x.lv.every(v => v <= x.edge - 2), `${H}: level labels inside the plot, not over the axis ${JSON.stringify(x.lv)} edge ${x.edge}`);
        const sHist = x.histMin / x.histPx, sFc = H / x.fcPx;
        t.ok(sHist / sFc > .6 && sHist / sFc < 1.67, `${H}: history and forecast at about the same minutes per pixel (${sHist.toFixed(2)} vs ${sFc.toFixed(2)})`);
        t.eq(x.titles, 0, `${H}: no native title tooltips`);
        t.ok(x.b68 !== x.b95, `${H}: bands differ ${x.b68} / ${x.b95}`);
      }
      t.noErrors(page);
    }
  },
  /* ---------------- Exit lab ---------------- */
  {
    name: 'LABUI exit 1 · the sample trader: exits at the real close (no free −1R), labelled random entries, no edge',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const S0 = exMakeSample(), bad = [];
        for (const h of S0) { const a = Engine.candles[h.sym], m = M(h.sym), d = h.side === 'buy' ? 1 : -1, q = d > 0 ? 0 : exSpread(m), j = a.findIndex(k => k.time === h.close); if (j < 0 || Math.abs(h.exit - (a[j].close + q)) > 1e-12) bad.push({ id: h.id, exit: h.exit, close: a[j]?.close }); }
        LAB.sample = S0; LAB.exitKey = ''; const b = document.createElement('div'); drawExit(b, { exR: 'stop', exSrc: 'sample' });
        return { n: S0.length, bad: bad.slice(0, 3), nb: bad.length, txt: b.textContent };
      });
      t.ok(r.n > 10, 'sample trades: ' + r.n);
      t.eq(r.nb, 0, 'every exit is a bar close (+ spread on a sell): ' + JSON.stringify(r.bad));
      t.ok(/Sample trader: random entries, no edge; its numbers show costs only/.test(r.txt), 'labelled as a random-entry, no-edge sample');
      t.ok(!/synthetic|simulat|by construction/i.test(r.txt), 'no synthetic / simulated wording');
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI exit 2 · green needs a margin (Bonferroni over 8 rules); no "judgement adding value"; "Check this"',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const best = { name: 'Target 2R', avgR: .1 }, act = { avgR: 0 };
        const wf = (d, n) => ({ pick: 't2', nA: n, nB: n, inA: 3, outB: d.reduce((s, x) => s + x, 0), mineB: 0, dB: d });
        const slight = exVerdict(best, act, wf([.3, -.2, .25, .1, -.1, .2, .05, -.15, .2, .1], 10));
        const strong = exVerdict(best, act, wf(Array.from({ length: 40 }, (_, i) => .5 + (i % 5) * .05), 40));
        const odd = exVerdict({ name: 'Target 3R', avgR: 1.4 }, act, null);
        return { slight, strong, odd, src: drawExit.toString() + exVerdict.toString() };
      });
      t.ok(r.slight[0] !== 'ok' && /no reliable difference/i.test(r.slight[1]), 'a small edge out of sample: ' + r.slight[1]);
      t.eq(r.strong[0], 'ok', 'a difference far beyond the corrected margin');
      t.ok(/8 rules/.test(r.strong[2]) || /eight rules/.test(r.strong[2]), 'the correction is named: ' + r.strong[2]);
      t.ok(!/judgement is adding value/.test(r.src), 'no "your exit judgement is adding value"');
      t.ok(/^Check this: the replay disagrees with the recorded trades/.test(r.odd[1]), 'odd result: ' + r.odd[1]);
      t.ok(/1 R/.test(r.odd[2]), 'the threshold is explained: ' + r.odd[2]);
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI exit 3 · the stop × target map in R of each cell\'s own stop; negative efficiency "—"; Best rule neutral',
    async run({ t, app }) {
      const page = await boot(app);
      const r = await page.evaluate(() => {
        const S0 = exMakeSample(), x = exRun(S0, 'stop');
        let want = 0; for (const p of x.per) { const h = p.h, a = Engine.candles[h.sym], d = h.side === 'buy' ? 1 : -1; let i0 = a.length - 1; while (i0 > 0 && a[i0 - 1].time >= h.open) i0--; const g = exSim(a, i0, h.side, h.entry, p.R, 'grid', 2, 2 * 2, exSpread(M(h.sym))); want += d * (g.x - h.entry) / (p.R * 2); }
        LAB.sample = S0; const c = { exR: 'stop', exSrc: 'sample' }; LAB.exitKey = ''; const b = document.createElement('div'); drawExit(b, c);
        LAB.exit.eff = -12; drawExit(b, c);
        const kp = [...b.querySelectorAll('.kpi')], eff = kp.find(k => /efficiency/i.test(k.textContent)), best = kp.find(k => /Best rule/.test(k.textContent));
        return { got: x.grid[3][2], want, effV: eff.querySelector('b').textContent, effTip: eff.dataset.tip, bestCls: best.querySelector('b').className, bestTxt: best.textContent, gtxt: b.querySelector('.ex-gleg').textContent };
      });
      t.near(r.got, r.want, 'stop 2R, target 2× stop: total in R of the 2R stop', 1e-9, 1e-9);
      t.ok(/own stop/.test(r.gtxt), 'legend says the cells are in their own risk: ' + r.gtxt);
      t.eq(r.effV, '—', 'negative efficiency shown as —');
      t.ok(/negative/i.test(r.effTip), 'and explained: ' + r.effTip);
      t.ok(!/\b(up|dn)\b/.test(r.bestCls), 'Best rule not green/red: ' + r.bestCls);
      t.ok(/hindsight/.test(r.bestTxt), 'Best rule says hindsight: ' + r.bestTxt);
      t.noErrors(page);
    }
  },
  {
    name: 'LABUI exit 4 · "still moving" only while the market is open; CFDs said to be included',
    async run({ t, app }) {
      const out = {};
      for (const [k, c] of [['sat', SAT], ['wed', WED]]) {
        const page = await boot(app, c);
        out[k] = await page.evaluate(() => {
          T.reset(); const rows = [], a = Engine.candles.EURUSD, m = M('EURUSD');
          // opened in the last 20 minutes: the 1-hour time stop cannot have ended inside the data, so every run has live replays
          for (let k = 0; k < 6; k++) { const i = a.length - 20 - k, j = i + 2; rows.unshift({ id: k + 1, sym: 'EURUSD', side: 'buy', lots: .1, entry: a[i].close + m.spread * m.pip, exit: a[j].close, open: a[i].time + 5, close: a[j].time + 5, pips: 0, pnl: 1, comm: 0, swap: 0, sl0: a[i].close - 20 * m.pip, reason: 'Manual' }); }
          S.history = rows; LAB.exitKey = ''; const b = document.createElement('div'); drawExit(b, { exR: 'stop', exSrc: 'mine' });
          return { txt: b.textContent, live: LAB.exit.live };
        });
        t.noErrors(page);
      }
      t.ok(out.sat.live > 0 && out.wed.live > 0, 'premise: replays inside their window ' + out.sat.live + ' / ' + out.wed.live);
      t.ok(!/keep moving/.test(out.sat.txt), 'closed: no "keep moving"');
      t.ok(/last price before the close/.test(out.sat.txt), 'closed: marked at the last price before the close');
      t.ok(/keep moving/.test(out.wed.txt), 'open: the table keeps moving');
      t.ok(/FX and CFD trades/.test(out.wed.txt), 'CFDs said to be included');
    }
  },
  {
    name: 'LABUI exit 5 · R vs $ explained, descriptions as tooltips, MFE / paired t / base R explained, Use without a toast',
    async run({ t, app }) {
      const page = await obsApp(app);
      const r = await page.evaluate(() => {
        LAB.sample = exMakeSample(); const c = obsCfg(); c.view = 'exit'; c.exSrc = 'sample'; c.exR = 'stop'; LAB.exitKey = ''; renderObs();
        const b = document.getElementById('obsBody'), tips = [...b.querySelectorAll('[data-tip]')].map(x => x.dataset.tip);
        const nameTd = [...b.querySelectorAll('.ex-tbl tbody td:first-child')].map(td => td.dataset.tip || '');
        b.querySelector('[data-ex-use="t2"]').click();
        const b2 = document.getElementById('obsBody');
        return { tips, nameTd, toasts: T.toasts().length, note: b2.querySelector('.ex-note')?.textContent || '', titles: b2.querySelectorAll('[title]').length };
      });
      t.ok(r.tips.some(s => /^P&L\|/.test(s) && /size/.test(s) && /sign/.test(s)), 'P&L tooltip explains R vs $ signs (weighting by size)');
      t.ok(r.nameTd.length >= 9 && r.nameTd.slice(1).every(s => s.includes('|')), 'every rule name carries its description as a tooltip');
      t.ok(r.tips.some(s => /maximum favourable excursion/i.test(s)), 'MFE explained');
      t.ok(r.tips.some(s => /^Paired t\|/.test(s)), 'paired t explained');
      t.ok(r.tips.some(s => /^Base R\||own stop/.test(s)), 'the R of the map explained');
      t.eq(r.toasts, 0, 'Use: no toast over the table');
      t.ok(/Ticket updated/.test(r.note), 'Use: an inline note instead: ' + r.note);
      t.eq(r.titles, 0, 'no native title tooltips');
      t.noErrors(page);
    }
  }
];
