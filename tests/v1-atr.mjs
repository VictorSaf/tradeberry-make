// Wave 1 · v1-atr: one ATR(14) on 1H (Wilder, complete hours: atr1h in shared.js) behind the four displays (the
// volatility panel, the symbol details from shell.js, the ticket's default stop, the Market Brief); strength and
// exposure bars on the diverging tokens with explicit signs; the Journal's win rate with its Wilson interval.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// hourly bars at the symbol's price: 40 complete hours (ranges 1 pip for 20 hours, then 5 pips) and a wild partial hour.
// A simple mean of the last 14 TRs gives 5 pips, Wilder's ATR about 4.0, the partial hour (if counted) far more
const STUB = sym => {
  const m = M(sym), mid = Engine.mid(sym), now = Math.floor(Engine.simTime / 3600) * 3600, out = [];
  for (let i = 0; i < 40; i++) { const r = (i < 20 ? 1 : 5) * m.pip; out.push({ time: now - (40 - i) * 3600, open: mid, high: mid + r / 2, low: mid - r / 2, close: mid }); }
  out.push({ time: now, open: mid, high: mid * 1.05, low: mid * .95, close: mid });
  window.V1A = { real: Engine.aggregate, restore() { Engine.aggregate = V1A.real; } };
  Engine.aggregate = (s, tf, n) => s === sym ? out.slice(-(n || out.length)).map(b => ({ ...b })) : V1A.real.call(Engine, s, tf, n);
};

export const tests = [
  {
    name: 'V1A1 ATR(14) 1H: the volatility panel, the symbol details, the ticket and the Market Brief all show atr1h(sym)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.waitForFunction(() => document.getElementById('wlDet')?.textContent.includes('ATR 1H'), null, { timeout: 10000 }); // shell.js is up
      await page.evaluate(STUB, 'GBPJPY');
      const r = await page.evaluate(() => {
        const sym = 'GBPJPY', m = M(sym), a = atr1h(sym);
        setSymbol(sym); renderVol();
        const vun = document.querySelector(`#volBody .vcard[data-sym="${sym}"] .vun`)?.textContent;
        const det = document.getElementById('wlDet')?.textContent || '';
        const br = analyse(sym);
        return { a, pip: m.pip, vun, det, tk: tkAtr1h(sym), brPips: br.atrPips, brH1: br.h1.atr };
      });
      t.ok(r.a > 3.5 * r.pip && r.a < 4.5 * r.pip, 'the stub gives a Wilder ATR near 4 pips: ' + r.a / r.pip);
      const pips = (r.a / r.pip).toFixed(1);
      t.eq(r.vun, pips + ' pips', 'volatility panel');
      t.ok(r.det.includes('ATR 1H' + pips + 'p'), `symbol details show ${pips}p: ${r.det.slice(0, 200)}`);
      t.near(r.tk * r.pip, r.a, 'ticket ATR', 1e-12, 1e-15);
      t.near(r.brPips * r.pip, r.a, 'Market Brief ATR (pips)', 1e-12, 1e-15);
      t.near(r.brH1, r.a, 'Market Brief h1.atr', 1e-12, 1e-15);
      t.noErrors(page);
    }
  },
  {
    name: 'V1A2 no hand-rolled true range left in panels.js, shell.js, ticket.js',
    async run({ t }) {
      for (const f of ['panels.js', 'shell.js', 'ticket.js']) {
        const src = await readFile(join(ROOT, f), 'utf8');
        t.eq((src.match(/Math\.max\(.*high - .*low/g) || []).length, 0, f + ' has no TR formula');
      }
      const br = await readFile(join(ROOT, 'brief.js'), 'utf8');
      t.eq((br.match(/Math\.max\([^)]*high - [^)]*low/g) || []).length, 0, 'brief.js has no TR formula (atrWilder)');
    }
  },
  {
    name: 'V1A3 strength and exposure: bars on --div-pos / --div-neg, values signed, no P&L green/red',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset();
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true });
        renderStrength(); renderExposure();
        const rows = sel => [...document.querySelectorAll(sel + ' .str-row')].map(x => ({ bg: x.querySelector('.str-fill').getAttribute('style'), txt: x.querySelector('span').textContent, cls: x.querySelector('span').className, left: parseFloat(x.querySelector('.str-fill').style.left) }));
        return { st: rows('#strength'), ex: rows('#exposure') };
      });
      t.ok(r.st.length >= 8 && r.ex.length >= 2, 'rows rendered');
      for (const x of [...r.st, ...r.ex]) {
        t.ok(!/--up|--dn/.test(x.bg), 'no up/dn token on a bar: ' + x.bg);
        const neg = x.left < 50;
        t.ok(x.bg.includes(neg ? '--div-neg' : '--div-pos'), 'diverging token by side: ' + x.bg);
        t.ok(!/\b(up|dn)\b/.test(x.cls), 'value not coloured as P&L: ' + x.cls);
        t.ok(/^[+−]/.test(x.txt) || /^0\b/.test(x.txt), 'value carries its sign: ' + x.txt);
      }
      t.ok(r.ex.some(x => x.txt.startsWith('+')) && r.ex.some(x => x.txt.startsWith('−')), 'long EUR / short USD both signed');
      t.noErrors(page);
    }
  },
  {
    name: 'V1A4 Journal win rate with its 95% Wilson interval and n (wrTxt)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(() => {
        T.reset(); setTab('journal');
        const mk = (net, i) => ({ id: 'h' + i, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1, exit: 1, pnl: net, open: 1000 + i, close: 2000 + i, reason: 'Manual', posId: 'p' + i });
        S.history = [10, -5, 7, 3, -2, 8, -1, 4, 6, -3].map(mk).reverse();
        renderJournal();
        const k = [...document.querySelectorAll('#kpis .kpi')].find(x => x.querySelector('label').textContent === 'Win rate');
        const s = journalStats();
        return { txt: k.querySelector('b').textContent, want: wrTxt(s.nWin, s.n), n: s.n, w: s.nWin, title: k.getAttribute('title') || k.getAttribute('data-tip') || k.querySelector('b').getAttribute('title') || '' };
      });
      t.eq(r.n, 10, '10 trades'); t.eq(r.w, 6, '6 wins');
      t.eq(r.txt, r.want, 'Win rate KPI = wrTxt');
      t.eq(r.txt, '60% (31–83%) · n=10', 'the interval for 6 of 10');
      t.ok(/Wilson|95%/.test(r.title), 'the tooltip says what the interval is: ' + r.title);
      t.noErrors(page);
    }
  }
];
