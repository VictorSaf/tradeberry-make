// UI and accessibility follow-ups after multi-asset and CVD (task pol-ui):
// 1 hollow / CVD candles survive a reload, 2 Coach state colours never swap, 3 toasts coloured by meaning,
// 4 axe on Monitor and Strategy Lab (and the light red-rises look on Trade/Research/Coach), 5 the chart header
// leverage tag follows the profile and the positions at once, 6 CFD exposure in USD without NaN.
import { readFileSync } from 'node:fs';
// axe-core is not a dependency of this repo: read from the test workspace next to it (as in a11y.mjs)
const AXE_PATH = '/Users/victorsafta/Projects/MeridianFX/5-teste/node_modules/axe-core/axe.min.js';
let AXE = null;
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// the one allowlisted rule of a11y.mjs, narrowed: in Monitor the order ticket is hidden, so the depth rows get no exception
const ALLOW = [{ rule: 'target-size', sel: 'body:not(.mnav-on):not([data-view=monitor]) .dom-row', why: 'equivalent: order ticket' }];
async function axe(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: AXE || (AXE = readFileSync(AXE_PATH, 'utf8')) });
  const v = await page.evaluate(async ({ tags, allow }) => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, rules: { 'color-contrast': { enabled: true } }, resultTypes: ['violations'] });
    const ok = (id, sel) => { const el = sel.length === 1 && document.querySelector(sel[0]); return !!el && allow.some(a => a.rule === id && el.matches(a.sel)); };
    return r.violations.flatMap(v => v.nodes.filter(n => !ok(v.id, n.target)).map(n => ({ id: v.id, target: n.target.join(' '), msg: (n.any[0] || n.all[0] || n.none[0] || {}).message || v.help })));
  }, { tags: TAGS, allow: ALLOW });
  return v.map(x => `${x.id} ${x.target} — ${String(x.msg).slice(0, 150)} [${label}]`);
}
const report = bad => { const m = new Map(); for (const b of bad) { const k = b.replace(/ — .*/, ''); m.set(k, m.has(k) ? [m.get(k)[0], m.get(k)[1] + 1] : [b, 1]); }
  return `${bad.length} violation(s), ${m.size} distinct:\n       ` + [...m.values()].slice(0, 60).map(([b, n]) => `${b} ×${n}`).join('\n       '); };
// wait until the view has settled: no finite animation or transition still running (fades would be measured mid-way)
const settle = page => page.waitForFunction(() => document.getAnimations().every(a => a.playState !== 'running' || a.effect?.getComputedTiming().iterations === Infinity), null, { timeout: 5000, polling: 100 }).then(() => page.waitForTimeout(150));
const ready = page => page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState && document.getElementById('paletteSet') && document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
const look = (page, o) => page.evaluate(o => { Object.assign(S.set, { theme: 'dark', palette: 'std', updn: 'green' }, o); applyTheme(); frame(true, true); }, o);
async function seed(page) {
  await page.evaluate(() => {
    T.reset();
    const q = Engine.quote('EURUSD'), pip = Engine.META.EURUSD.pip;
    const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .5, dupOk: true, pmDone: true });
    if (p) { p.sl = +(q.bid - 20 * pip).toFixed(5); p.tp = +(q.bid + 40 * pip).toFixed(5); }
    openPosition({ sym: 'DE.30', side: 'buy', lots: 1, dupOk: true, pmDone: true });
    const s = openPosition({ sym: 'USDJPY', side: 'sell', lots: .2, dupOk: true, pmDone: true });
    if (s) closePosition(s.id, 'Manual');
    placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.ask - 30 * pip).toFixed(5), lots: .1 });
    addAlert('EURUSD', +(q.mid + 25 * pip).toFixed(5), 'above');
    changed('pos', 'ord', 'hist', 'al'); frame(true, true); T.clearToasts();
  });
}

export const tests = [
  {
    name: 'POL-1 hollow candles and the CVD / red-rises colours are on the main chart right after a reload',
    async run({ t, app }) {
      const page = await app();
      await page.evaluate(async () => { Object.assign(S.set, { palette: 'cvd', updn: 'red', candles: 'hollow' }); applyTheme(); persistNow(); await store.flush(); });
      await page.reload();
      await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
      const r = await page.evaluate(() => { const o = candle.options(); return { set: [S.set.palette, S.set.updn, S.set.candles], o: { up: o.upColor, down: o.downColor, border: o.borderVisible, bUp: o.borderUpColor, wUp: o.wickUpColor }, tok: { up: cssv('--up'), dn: cssv('--dn') } }; });
      t.deep(r.set, ['cvd', 'red', 'hollow'], 'display settings came back');
      t.eq(r.o.up, 'rgba(0,0,0,0)', 'rising body is hollow after the reload');
      t.eq(r.o.border, true, 'borders visible after the reload');
      t.eq(r.o.bUp, r.tok.up, 'rising border takes --up of the restored palette');
      t.eq(r.o.wUp, r.tok.up, 'rising wick takes --up'); t.eq(r.o.down, r.tok.dn, 'falling body takes --dn');
      // the basket chart (lazy) is created with the same style
      await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
      const bk = await page.evaluate(() => typeof candleStyle === 'function' && candleStyle(chartColors()).upColor);
      t.eq(bk, 'rgba(0,0,0,0)', 'candleStyle (used by every new candle series) is hollow');
      t.noErrors(page);
    }
  },
  {
    name: 'POL-2 Coach: disposition gauge, calibration dots and verdicts use state colours that never swap',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(() => {
        const out = [];
        for (const updn of ['green', 'red']) for (const palette of ['std', 'cvd']) {
          Object.assign(S.set, { updn, palette }); applyTheme();
          const box = document.createElement('div'); document.body.appendChild(box);
          box.innerHTML = deGauge(.3) + calSvg([{ v: 70, w: 40, n: 5 }, { v: 50, w: 80, n: 3 }, { v: 60, w: 62, n: 2 }]);
          const paths = [...box.querySelectorAll('path')].map(p => getComputedStyle(p).stroke), dots = [...box.querySelectorAll('circle[fill-opacity]')].map(c => getComputedStyle(c).fill);
          const rgb = v => { const d = document.createElement('i'); d.style.color = cssv(v); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
          out.push({ k: updn + '/' + palette, html: box.innerHTML, paths, dots, ok: rgb('--ok'), bad: rgb('--bad'), warn: rgb('--warn') });
          box.remove();
        }
        return out;
      });
      for (const c of r) {
        t.ok(!/var\(--(up|dn)\)/.test(c.html), `${c.k}: no up/dn token in the gauge or the calibration chart`);
        t.eq(c.paths[0], c.ok, `${c.k}: "cuts losers" arc is --ok`); t.eq(c.paths[2], c.bad, `${c.k}: "banks winners" arc is --bad`);
        t.deep(c.dots, [c.bad, c.warn, c.ok], `${c.k}: overconfident bad, underconfident caution, calibrated ok`);
      }
      // the verdict classes in the rendered tab
      const src = await page.evaluate(() => [deGauge, calSvg, renderBehav].map(String).join('\n'));
      t.ok(!/b class="(up|dn)">(Disposition effect|The reverse|Overconfident|Underconfident)/.test(src), 'verdicts carry state classes');
      t.noErrors(page);
    }
  },
  {
    name: 'POL-3 toasts are classified by meaning (warn / bad / ok), only moves and P&L keep up / dn',
    async run({ t, app }) {
      const page = await app();
      const r = await page.evaluate(() => {
        T.reset(); S.set.updn = 'red'; applyTheme();
        const kindOf = (title, body, kind) => { T.clearToasts(); toast(title, body, kind); const el = document.querySelector('#toasts .toast'); return el.className.replace('toast', '').trim(); };
        const cases = {
          breach: kindOf('Challenge breached — max daily loss', 'Equity $95,000.00 reached the floor $95,000.00. The attempt is over.', 'dn'),
          eighty: kindOf("Challenge: 80% of today's loss limit used", 'Room left $1,000.00. For 30 min every new trade gets a pre-mortem.', 'dn'),
          attempt: kindOf('Attempt not started', 'Close your open positions first', 'dn'),
          replay: kindOf('Replay not started', 'Pick a date', 'dn'),
          margin: kindOf('Insufficient margin', 'Needs $5,000.00 · free $1,000.00', 'dn'),
          readOnly: kindOf('Not saved — this tab is read-only', 'The account is open in another tab.', 'dn'),
          target: kindOf('Target reached', 'Phase complete.', 'up'),
          loss: kindOf('Manual: EUR/USD 1.00', '−$120.00 · −12.0 pips', 'dn'),
          win: kindOf('Manual: EUR/USD 1.00', '+$80.00 · +8.0 pips', 'up'),
          sold: kindOf('Sold 1.00 EUR/USD', '@ 1.10000', 'dn'),
          news: kindOf('USD CPI m/m', 'Actual 0.4% vs 0.3% forecast', 'dn move'),
          info: kindOf('Alert set', 'EUR/USD above 1.10000', 'info')
        };
        // a real tilt-guard trip and a partial basket fill come from owned modules with their semantic kind
        T.clearToasts(); toast('Tilt guard on', 'x', 'warn'); cases.tilt = document.querySelector('#toasts .toast').className;
        // the real refusal path in trade.js
        T.clearToasts(); const q = Engine.quote('EURUSD'); placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: q.ask + .01, lots: .1 }); cases.reject = document.querySelector('#toasts .toast').className;
        const bc = el => getComputedStyle(el).borderLeftColor, mk = k => { T.clearToasts(); toast('x', '', k); return bc(document.querySelector('#toasts .toast')); };
        const col = {}; for (const updn of ['green', 'red']) { S.set.updn = updn; applyTheme(); col[updn] = { bad: mk('bad'), warn: mk('warn'), ok: mk('ok') }; }
        const tiltSrc = String(tiltCheckTrip);
        T.clearToasts(); S.set.updn = 'green'; applyTheme();
        return { cases, col, tiltSrc };
      });
      const c = r.cases;
      for (const k of ['breach', 'attempt', 'replay', 'margin']) t.eq(c[k], 'bad', `${k} is "bad"`);
      t.eq(c.eighty, 'warn', '80% of the loss limit is a caution'); t.eq(c.readOnly, 'warn', 'read-only note is a caution');
      t.eq(c.target, 'ok', 'a reached target is "ok", not the rising colour');
      t.eq(c.loss, 'dn', 'a losing close stays "dn"'); t.eq(c.win, 'up', 'a winning close stays "up"'); t.eq(c.sold, 'dn', 'a sell fill keeps its side');
      t.eq(c.news, 'dn', 'a news move marked "move" keeps its direction'); t.eq(c.info, 'info', 'info untouched');
      t.ok(/\bwarn\b/.test(c.tilt) && /'warn'\)/.test(r.tiltSrc), 'tilt guard toast is a caution');
      t.ok(/\bbad\b/.test(c.reject), 'a refused order is "bad": ' + c.reject);
      t.deep(r.col.green, r.col.red, 'state toast colours do not swap with the rising colour');
      t.noErrors(page);
    }
  },
  {
    name: 'POL-4 axe incl. color-contrast: Monitor and Strategy Lab (dark/light × std/cvd/red) + light red-rises on Trade/Research/Coach: 0 violations',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.setViewportSize({ width: 1512, height: 945 });
      await ready(page);
      await seed(page);
      const bad = [];
      for (const lk of [{}, { palette: 'cvd' }, { updn: 'red' }, { theme: 'light' }, { theme: 'light', palette: 'cvd' }, { theme: 'light', updn: 'red' }]) {
        await look(page, lk);
        const label = `${lk.theme || 'dark'}·${lk.palette || 'std'}·${lk.updn || 'green'}`;
        const views = [['monitor', ['positions', 'orders', 'history', 'alerts']], ['lab', ['bt', 'lab', 'calc']]];
        if (lk.theme === 'light' && lk.updn === 'red') views.push(['trade', ['positions', 'orders']], ['research', ['brief', 'obs']], ['coach', ['behav', 'chal']]);
        for (const [view, tabs] of views) for (const tab of tabs) {
          await page.evaluate(([v, tb]) => setView(v, tb), [view, tab]); await settle(page);
          bad.push(...await axe(page, `${label}:${view}/${tab}`));
        }
      }
      t.ok(!bad.length, report(bad));
      // Monitor tiles: a group with real buttons inside, the name button opens Trade with Enter
      await page.evaluate(() => { Object.assign(S.set, { theme: 'dark', palette: 'std', updn: 'green' }); applyTheme(); setView('monitor'); });
      await settle(page);
      const tile = await page.evaluate(() => { const el = document.querySelector('#monBoard .mq[data-sym=GBPUSD]'); return { role: el.getAttribute('role'), tab: el.getAttribute('tabindex'), btns: [...el.querySelectorAll('button')].map(b => b.className) }; });
      t.eq(tile.role, 'group', 'a quote tile is a group'); t.eq(tile.tab, null, 'the tile itself is not a tab stop');
      t.deep(tile.btns, ['mq-nm', 'mq-s', 'mq-b'], 'name, sell and buy are separate buttons');
      await page.focus('#monBoard .mq[data-sym=GBPUSD] .mq-nm'); await page.keyboard.press('Enter'); await page.waitForTimeout(150);
      t.deep(await page.evaluate(() => [S.set.sym, document.body.dataset.view]), ['GBPUSD', 'trade'], 'Enter on the name shows it in Trade');
      // the rule selects of the backtester are named by their role in the condition
      await page.evaluate(() => setView('lab', 'bt')); await settle(page);
      const names = await page.evaluate(() => [...document.querySelectorAll('#btCfg .rule[data-side=long][data-i="0"] select')].map(s => s.getAttribute('aria-label')));
      t.deep(names, ['Long condition 1: left side', 'Long condition 1: comparison', 'Long condition 1: right side'], 'rule selects named');
      t.noErrors(page);
    }
  },
  {
    name: 'POL-5 chart header leverage tag follows the profile and the positions at once (no stale leverage, no stale Close only)',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-20T14:00:00Z') });
      const r = await page.evaluate(() => {
        const head = () => { const e = document.getElementById('symCls'); return { t: e.hidden ? '' : e.textContent, title: e.title }; };
        T.reset(); applyProfile('eu'); setSymbol('BTCUSD');
        const out = { eu: head() };
        applyProfile('none:100'); out.pro = head();
        applyProfile('eu'); out.eu2 = head();
        const p = openPosition({ sym: 'BTCUSD', side: 'buy', lots: .01, dupOk: true, pmDone: true });
        applyProfile('uk'); out.co = head();
        closePosition(p.id, 'Manual'); out.closed = head();
        applyProfile('eu'); out.back = head();
        setSymbol('EURUSD'); applyProfile('us'); out.fx = head();
        applyProfile('none'); out.fxNone = head();
        applyProfile('eu'); T.clearToasts();
        return out;
      });
      t.eq(r.eu.t, 'Crypto · 1:2', 'EU retail: crypto 1:2');
      t.eq(r.pro.t, 'Crypto · 1:10', 'no cap, 1:100 chosen: crypto at its sheet maximum 1:10, at once');
      t.ok(/No jurisdiction cap/.test(r.pro.title), 'title names the new profile: ' + r.pro.title);
      t.eq(r.eu2.t, 'Crypto · 1:2', 'back to EU at once');
      t.eq(r.co.t, 'Close only', 'UK with a position: Close only');
      t.eq(r.closed.t, 'Not offered', 'after the close: Not offered, not a leverage');
      t.ok(/not offered under UK retail/.test(r.closed.title) && !/1:2/.test(r.closed.title), 'title says why: ' + r.closed.title);
      t.eq(r.back.t, 'Crypto · 1:2', 'EU again');
      t.eq(r.fx.t, '1:50', 'a pair under US retail: the NFA cap cuts the sheet 1:500');
      t.eq(r.fxNone.t, '', 'a pair with no cap: no tag');
      t.noErrors(page);
    }
  },
  {
    name: 'POL-6 exposure: non-FX positions in USD per instrument (Market panel and basket tool), no NaN',
    async run({ t, app }) {
      const page = await app('', { clock: new Date('2026-10-20T14:00:00Z') });
      await ready(page);
      const r = await page.evaluate(() => {
        T.reset(); S.set.jur = 'none'; S.set.lev = null;
        for (const [sym, side, lots] of [['EURUSD', 'buy', 1], ['DE.30', 'buy', 2], ['GOLD', 'sell', 1], ['BTCUSD', 'buy', .1], ['US.500', 'buy', 1]]) openPosition({ sym, side, lots, dupOk: true, pmDone: true });
        renderExposure();
        const ex = exposureOf(), e = ccyExposure(), cfd = cfdExposure(), html = bkExpHtml();
        const ger = notionalUsd('DE.30', 2), eur = notionalUsd('EURUSD', 1);
        const out = { n: S.positions.length, panel: document.getElementById('exposure').textContent, ccyKeys: Object.keys(e), ccyVals: Object.values(e), cfd, html, ger, eur, e };
        T.reset(); return out;
      });
      t.eq(r.n, 5, 'five positions open');
      t.ok(!/NaN|undefined|null/.test(r.panel), 'Market panel exposure has no NaN: ' + r.panel.slice(0, 120));
      t.ok(r.ccyVals.every(Number.isFinite), 'every currency exposure is a number');
      t.ok(!r.ccyKeys.includes('null'), 'no "null" currency');
      t.near(r.e.EUR, r.ger + r.eur, 'EUR = long EUR/USD + long DE.30 (quoted in EUR)', 1e-6);
      t.near(r.e.USD, -r.eur, 'USD only from the pair (USD-quoted CFDs add no currency exposure)', 1e-6);
      t.deep(Object.keys(r.cfd).sort(), ['BTCUSD', 'DE.30', 'GOLD', 'US.500'], 'one row per non-FX instrument');
      t.ok(r.cfd.GOLD < 0 && r.cfd['DE.30'] > 0, 'signs follow the side');
      t.ok(!/NaN|undefined/.test(r.html), 'basket exposure HTML has no NaN');
      t.ok(/DE\.30/.test(r.html) && /BTCUSD/.test(r.html), 'basket exposure lists the instruments');
      t.noErrors(page);
    }
  }
];
