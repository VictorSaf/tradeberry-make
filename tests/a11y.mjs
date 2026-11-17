// Accessibility pillar (EAA / WCAG 2.2 AA / colour vision): axe with color-contrast ON on the Trade, Research and Coach
// workspaces and on the phone, in both themes and both palettes; the CVD palette and the rising-colour switch
// (tokens, persistence in S.set, charts recoloured through applyTheme), non-colour cues, drag alternatives,
// 24 px targets and focus not hidden by the toasts.
import { readFileSync } from 'node:fs';
// axe-core is not a dependency of this repo: it is read from the test workspace next to it (absolute path, by decision)
const AXE_PATH = '/Users/victorsafta/Projects/MeridianFX/5-teste/node_modules/axe-core/axe.min.js';
let AXE = null;
const axeSrc = () => AXE || (AXE = readFileSync(AXE_PATH, 'utf8'));
const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
// allowlist, each with its reason. Nothing else may fail.
const ALLOW = [
  // WCAG 2.5.8 "equivalent" exception: every limit/stop the 19 px depth-ladder rows place is also placed from the
  // order ticket, whose controls are 24 px or more (design Q3, option a). On a touch screen the rows are 24 px.
  { rule: 'target-size', sel: 'body:not(.mnav-on) .dom-row', why: 'equivalent: order ticket' }
];

async function axe(page, label) {
  if (!(await page.evaluate(() => !!window.axe))) await page.addScriptTag({ content: axeSrc() });
  const v = await page.evaluate(async ({ tags, allow }) => {
    const r = await axe.run(document, { runOnly: { type: 'tag', values: tags }, rules: { 'color-contrast': { enabled: true } }, resultTypes: ['violations'] });
    const ok = (id, sel) => { const el = sel.length === 1 && document.querySelector(sel[0]); return !!el && allow.some(a => a.rule === id && el.matches(a.sel)); };
    return r.violations.flatMap(v => v.nodes.filter(n => !ok(v.id, n.target)).map(n => ({ id: v.id, target: n.target.join(' '), msg: (n.any[0] || n.all[0] || n.none[0] || {}).message || v.help })));
  }, { tags: TAGS, allow: ALLOW.map(a => ({ rule: a.rule, sel: a.sel })) });
  return v.map(x => `${x.id} ${x.target} — ${String(x.msg).slice(0, 150)} [${label}]`);
}
// a state with something in every table: a position with SL/TP, a pending order, an alert, a closed trade
async function seed(page) {
  await page.evaluate(() => {
    T.reset();
    const q = Engine.quote('EURUSD'), pip = Engine.META.EURUSD.pip;
    const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .5, dupOk: true, pmDone: true });
    if (p) { p.sl = +(q.bid - 20 * pip).toFixed(5); p.tp = +(q.bid + 40 * pip).toFixed(5); }
    const s = openPosition({ sym: 'USDJPY', side: 'sell', lots: .2, dupOk: true, pmDone: true });
    if (s) closePosition(s.id, 'Manual');
    placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.ask - 30 * pip).toFixed(5), lots: .1 });
    addAlert('EURUSD', +(q.mid + 25 * pip).toFixed(5), 'above');
    changed('pos', 'ord', 'hist', 'al'); frame(true, true); T.clearToasts();
  });
}
// one line per rule + element, with the first place it failed and how many places in all
const report = bad => { const m = new Map(); for (const b of bad) { const k = b.replace(/ — .*/, ''); m.set(k, m.has(k) ? [m.get(k)[0], m.get(k)[1] + 1] : [b, 1]); }
  return `${bad.length} violation(s), ${m.size} distinct:\n       ` + [...m.values()].slice(0, 60).map(([b, n]) => `${b} ×${n}`).join('\n       '); };
const look = (page, { theme = 'dark', palette = 'std', updn = 'green' } = {}) => page.evaluate(o => { Object.assign(S.set, o); applyTheme(); frame(true, true); }, { theme, palette, updn });
const settle = page => page.waitForTimeout(450);
// the UI layers start right after boot (they poll for it): wait until this pillar and the workspace shell are up
const ready = page => page.waitForFunction(() => document.querySelector('.chart-nav') && window.setView && window.wsState && document.getElementById('paletteSet'), null, { timeout: 30000 });
// under load the page lags behind the test: wait for the state a step leads to (generous), then assert on it as before.
// A wait that runs out is not a failure by itself: the assertion right after it says what is wrong.
const until = (page, fn, arg, ms = 15000) => page.waitForFunction(fn, arg, { timeout: ms, polling: 50 }).then(() => true, () => false);
// the chart's price scale has settled: the y of the given prices stays the same over several frames (>= 300 ms),
// so a coordinate read now is still the price under the pointer when the click lands
const scaleSettled = (page, fn, arg) => page.evaluate(async ({ src, arg }) => {
  const f = new Function('return ' + src)(), frame = () => new Promise(r => requestAnimationFrame(() => r()));
  let last = '', since = performance.now(), same = 0;
  for (const end = performance.now() + 15000; performance.now() < end;) {
    await frame();
    const r = document.getElementById('chart').getBoundingClientRect(), k = JSON.stringify([r.top, r.height, f(arg)]);
    if (k === last) { if (++same >= 5 && performance.now() - since >= 300) return true; } else { last = k; same = 0; since = performance.now(); }
  }
  return false;
}, { src: fn.toString(), arg });

async function sweep(page, label, phone) {
  const out = [];
  if (phone) {
    for (const v of ['chart', 'trade', 'markets', 'portfolio', 'tools']) { await page.evaluate(v => mnavGo(v), v); await settle(page); out.push(...await axe(page, `${label}:${v}`)); }
    await page.evaluate(() => mnavGo('chart')); out.push(...await extras(page, label));
    return out;
  }
  for (const [view, tabs] of [['trade', ['positions', 'orders', 'history', 'alerts', 'journal']], ['research', ['brief', 'obs', 'corr', 'vol', 'calendar']], ['coach', ['behav', 'chal', 'journal']]]) {
    for (const tab of tabs) {
      await page.evaluate(([v, t]) => setView(v, t), [view, tab]); await settle(page);
      out.push(...await axe(page, `${label}:${view}/${tab}`));
    }
  }
  await page.evaluate(() => setView('trade', 'positions'));
  out.push(...await extras(page, label));
  await page.evaluate(() => wsApply('scalping')); await settle(page); out.push(...await axe(page, `${label}:scalping`));
  await page.evaluate(() => wsApply('standard')); await settle(page);
  return out;
}
// the states this pillar adds: chart as text with the level editor open, and Help with the Display settings
async function extras(page, label) {
  const out = [];
  await page.evaluate(() => { document.querySelector('.chart-nav .cv-tg').click(); document.querySelector('#chartAlt .cv-edit').click(); }); await settle(page);
  out.push(...await axe(page, `${label}:chart-data+editor`));
  await page.evaluate(() => { document.querySelector('.lv-pop [data-a=x]').click(); document.querySelector('.chart-nav .cv-tg').click(); document.getElementById('help').hidden = false; }); await settle(page);
  out.push(...await axe(page, `${label}:help`));
  await page.evaluate(() => { document.getElementById('help').hidden = true; }); await settle(page);
  return out;
}

export const tests = [
  {
    name: 'A11Y-1 axe incl. color-contrast: Trade, Research, Coach (desktop), dark/light × std/cvd + dark red-rises: 0 violations',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.setViewportSize({ width: 1512, height: 945 });
      await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
      await seed(page);
      const bad = [];
      for (const lk of [{}, { palette: 'cvd' }, { theme: 'light' }, { theme: 'light', palette: 'cvd' }, { updn: 'red' }]) {
        await look(page, lk);
        bad.push(...await sweep(page, `${lk.theme || 'dark'}·${lk.palette || 'std'}·${lk.updn || 'green'}`, false));
      }
      t.ok(!bad.length, report(bad));
      t.noErrors(page);
    }
  },
  {
    name: 'A11Y-2 axe incl. color-contrast: phone 390×844, every view, dark/light × std/cvd: 0 violations',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(() => document.body.classList.contains('mnav-on') && document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });
      await seed(page);
      const bad = [];
      for (const lk of [{}, { palette: 'cvd' }, { theme: 'light' }, { theme: 'light', palette: 'cvd' }]) {
        await look(page, lk);
        bad.push(...await sweep(page, `phone·${lk.theme || 'dark'}·${lk.palette || 'std'}`, true));
      }
      t.ok(!bad.length, report(bad));
      t.noErrors(page);
    }
  },
  {
    name: 'A11Y-3 palette and rising colour: tokens per combination, state colours never swap, charts recolour, mfx:colors, persistence, reset, command',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        const hex = /^#[0-9a-f]{6}$/i, out = { combos: [], events: [] };
        document.addEventListener('mfx:colors', e => out.events.push(e.detail));
        for (const theme of ['dark', 'light']) for (const palette of ['std', 'cvd']) for (const updn of ['green', 'red']) {
          Object.assign(S.set, { theme, palette, updn }); applyTheme();
          const v = n => cssv(n), c = chartColors();
          out.combos.push({ k: `${theme}/${palette}/${updn}`, up: v('--up'), dn: v('--dn'), cg: v('--c-g'), cr: v('--c-r'), ok: v('--ok'), bad: v('--bad'), info: v('--info'), buy: v('--buy'), cgs: v('--c-g-solid'), crs: v('--c-r-solid'),
            candleUp: candle.options().upColor, mcUp: MC.panes.map(p => p.candle.options().upColor),
            alphaOk: CSS.supports('color', c.up + 'aa') && CSS.supports('color', c.dn + 'aa') && CSS.supports('color', c.info + 'aa'), hexOk: [c.up, c.dn, c.info, c.ok, c.bad, c.warn, c.acc].every(x => hex.test(x)) });
        }
        out.nEvents = out.events.length; out.detail = out.events[out.events.length - 1];
        // persistence: S.set → export → sanitizeState; an unknown value falls back to the default
        Object.assign(S.set, { theme: 'dark', palette: 'cvd', updn: 'red', candles: 'hollow' }); applyTheme();
        const back = sanitizeState(JSON.parse(JSON.stringify(S))).set;
        out.kept = [back.palette, back.updn, back.candles];
        loadState({ ...JSON.parse(JSON.stringify(S)), set: { ...S.set, palette: 'neon', updn: 1, candles: 'x' } }); out.neon = [S.set.palette, S.set.updn, S.set.candles];
        S.set.candles = 'hollow'; applyTheme(); const o = candle.options(); out.hollow = { up: o.upColor, border: o.borderVisible };
        // the command bar
        S.set.updn = 'green'; const p = parseCmd('red up'); out.cmd = p && p.desc; p.run(); out.afterCmd = S.set.updn; out.attr = document.documentElement.dataset.updn;
        parseCmd('palette cvd').run(); out.afterPal = S.set.palette; out.toast = T.toasts().pop();
        // Settings → Display
        const sel = document.getElementById('candleSet'); sel.value = 'filled'; sel.dispatchEvent(new Event('change', { bubbles: true })); out.sel = S.set.candles;
        out.labels = ['paletteSet', 'updnSet', 'candleSet'].map(id => document.getElementById(id).labels.length);
        return out;
      });
      for (const c of r.combos) {
        t.ok(/^#[0-9a-f]{6}$/i.test(c.up) && /^#[0-9a-f]{6}$/i.test(c.dn), `${c.k}: --up/--dn are 6-digit hex (${c.up} ${c.dn})`);
        const red = c.k.endsWith('red');
        t.eq(c.up, red ? c.cr : c.cg, `${c.k}: --up follows the ${red ? 'red' : 'green'} family`);
        t.eq(c.dn, red ? c.cg : c.cr, `${c.k}: --dn`);
        t.eq(c.ok, c.cg, `${c.k}: --ok never swaps`); t.eq(c.bad, c.cr, `${c.k}: --bad never swaps`);
        t.eq(c.buy, red ? c.crs : c.cgs, `${c.k}: --buy has the rising colour`);
        t.eq(c.candleUp, c.up, `${c.k}: main chart candles take --up`);
        t.ok(c.mcUp.every(x => x === c.up), `${c.k}: every multi-chart pane takes --up`);
        t.ok(c.alphaOk && c.hexOk, `${c.k}: chart colours accept an appended alpha`);
      }
      const by = k => r.combos.find(c => c.k === k);
      t.eq(by('dark/cvd/green').up, '#4aa3ff', 'dark CVD rises blue'); t.eq(by('dark/cvd/green').dn, '#ff8a3d', 'dark CVD falls orange');
      t.eq(by('light/cvd/green').up, '#0a58b0', 'light CVD rises blue'); t.eq(by('dark/std/green').dn, '#ff6274', 'dark standard red, raised for contrast');
      t.ok(by('dark/cvd/green').info !== by('dark/cvd/green').up, 'info moves off the rising blue in CVD');
      t.eq(r.nEvents, 8, 'one mfx:colors per applyTheme');
      t.deep(Object.keys(r.detail).sort(), ['candles', 'palette', 'theme', 'updn'], 'mfx:colors detail');
      t.deep(r.kept, ['cvd', 'red', 'hollow'], 'settings survive export → sanitizeState');
      t.deep(r.neon, ['std', 'green', 'filled'], 'unknown values fall back to the defaults');
      t.eq(r.hollow.up, 'rgba(0,0,0,0)', 'hollow: rising body transparent'); t.eq(r.hollow.border, true, 'hollow: borders visible');
      t.eq(r.cmd, 'Red rises, green falls', 'command bar understands red up'); t.eq(r.afterCmd, 'red', 'red up sets S.set.updn'); t.eq(r.attr, 'red', 'data-updn on <html>');
      t.eq(r.afterPal, 'cvd', 'palette cvd'); t.eq(r.toast && r.toast.title, 'Display updated', 'a change is confirmed');
      t.eq(r.sel, 'filled', 'the Candles select applies at once'); t.deep(r.labels, [1, 1, 1], 'each select has a label');
      // reset keeps the display settings
      await page.evaluate(() => { Object.assign(S.set, { palette: 'cvd', updn: 'red', candles: 'hollow' }); applyTheme(); document.getElementById('resetAcct').click(); });
      await page.waitForTimeout(100);
      t.deep(await page.evaluate(() => [S.set.palette, S.set.updn, S.set.candles, document.documentElement.dataset.palette]), ['cvd', 'red', 'hollow', 'cvd'], 'Reset demo account keeps the display settings');
      t.noErrors(page);
    }
  },
  {
    name: 'A11Y-4 text tokens reach 4.5:1 on every surface, both themes, both palettes',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const bad = await page.evaluate(() => {
        const lum = h => { const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255).map(v => v <= .03928 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
        const cr = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); };
        const out = [];
        for (const theme of ['dark', 'light']) for (const palette of ['std', 'cvd']) {
          Object.assign(S.set, { theme, palette, updn: 'green' }); applyTheme();
          for (const fg of ['--tx', '--tx2', '--tx3', '--up', '--dn', '--ok', '--bad', '--warn', '--info']) for (const bg of ['--bg', '--s1', '--s2', '--s3']) {
            const r = cr(cssv(fg), cssv(bg)); if (r < 4.5) out.push(`${theme}/${palette} ${fg} on ${bg} ${r.toFixed(2)}`);
          }
          for (const bg of ['--buy', '--sell']) { const r = cr('#ffffff', cssv(bg)); if (r < 4.5) out.push(`${theme}/${palette} white on ${bg} ${r.toFixed(2)}`); }
        }
        return out;
      });
      t.ok(!bad.length, 'below 4.5:1: ' + bad.join(' | '));
    }
  },
  {
    name: 'A11Y-5 non-colour cues: arrows on changes, R:R bar named, refusals are "bad" not "dn", depth rows name the action',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      const r = await page.evaluate(() => {
        T.reset(); frame(true, true);
        const glyph = el => el ? getComputedStyle(el, '::before').content : null;
        const up = document.querySelector('.chg.up'), dn = document.querySelector('.chg.dn');
        Object.assign(S.tk, { ot: 'market', useSL: true, useTP: true, sl: 20, tp: 40, sm: 'lots', lots: 1 }); renderTicket();
        const rr = document.getElementById('rrBar'), q = Engine.quote('EURUSD'); T.clearToasts();
        placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: q.ask + .01, lots: .1 });
        const rej = document.querySelector('#toasts .toast')?.className;
        T.clearToasts(); const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true, pmDone: true }); T.move('EURUSD', q.mid - .002); closePosition(p.id, 'Manual');
        const loss = [...document.querySelectorAll('#toasts .toast')].map(x => x.className);
        renderDom();
        const rows = [...document.querySelectorAll('#dom .dom-row[role=button]')].map(x => x.textContent.replace(/\s+/g, ' ').trim());
        return { up: glyph(up), dn: glyph(dn), rrRole: rr.getAttribute('role'), rrLabel: rr.getAttribute('aria-label'), rej, loss, rows, pressed: [...document.querySelectorAll('#sideSeg button')].map(b => b.getAttribute('aria-pressed')) };
      });
      if (r.up != null) t.ok(r.up.includes('▲'), '.chg.up shows ▲: ' + r.up);
      if (r.dn != null) t.ok(r.dn.includes('▼'), '.chg.dn shows ▼: ' + r.dn);
      t.ok(r.up != null || r.dn != null, 'at least one coloured change in the watchlist');
      t.eq(r.rrRole, 'img', 'R:R bar is an image');
      t.ok(/^Risk \$[\d,.]+, reward \$[\d,.]+, R:R 1:[\d.]+$/.test(r.rrLabel), 'R:R bar label: ' + r.rrLabel);
      t.ok(/\bbad\b/.test(r.rej) && !/\bdn\b/.test(r.rej), 'a refused order is a "bad" toast: ' + r.rej);
      t.ok(r.loss.some(c => /\bdn\b/.test(c)), 'a losing close stays "dn": ' + r.loss.join(','));
      t.ok(r.rows.length >= 2 && r.rows.every(x => /Click: (buy|sell) limit here/.test(x)), 'every depth row names its action: ' + r.rows[0]);
      t.ok(r.pressed.every(x => x === 'true' || x === 'false') && r.pressed.includes('true'), 'side buttons carry aria-pressed: ' + r.pressed);
      t.noErrors(page);
    }
  },
  {
    name: 'A11Y-6 no drag needed: level editor (SL, order, alert), pick on chart, chart navigation, splitter popover',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.setViewportSize({ width: 1512, height: 945 });
      await page.evaluate(() => { T.reset(); setSymbol('EURUSD'); setView('trade', 'positions'); });
      const ids = await page.evaluate(() => {
        const q = Engine.quote('EURUSD'), pip = Engine.META.EURUSD.pip;
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true, pmDone: true }); p.sl = +(q.bid - 20 * pip).toFixed(5); p.trail = 5;
        const o = placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.ask - 30 * pip).toFixed(5), lots: .1 });
        addAlert('EURUSD', +(q.mid + 25 * pip).toFixed(5), 'above');
        changed('pos', 'ord', 'al'); frame(true, true); T.clearToasts();
        return { p: p.id, o: o.id, a: S.alerts[S.alerts.length - 1].id };
      });
      // the chart as text, Edit on the stop-loss row (clicks only)
      await page.click('.chart-nav .cv-tg');
      await page.waitForTimeout(150);
      await page.click(`#chartAlt button[aria-label="Edit stop loss #${ids.p}"]`);
      t.ok(await page.isVisible('.lv-pop'), 'Edit opens the level editor');
      t.eq(await page.evaluate(() => document.activeElement.matches('.lv-pop input')), true, 'focus moves to the price field');
      // wrong side: refused inline, nothing changes
      const bid = await page.evaluate(() => Engine.quote('EURUSD').bid);
      await page.fill('.lv-pop input', (bid + .001).toFixed(5));
      t.eq(await page.getAttribute('.lv-pop input', 'aria-invalid'), 'true', 'a stop above the bid is invalid');
      t.eq((await page.textContent('.lv-pop .lv-why')).trim(), 'Stop loss must be below the bid', 'reason shown inline');
      t.ok(await page.isDisabled('.lv-pop [data-a=set]'), 'Set is disabled while invalid');
      const want = +(bid - .0035).toFixed(5);
      await page.fill('.lv-pop input', want.toFixed(5));
      t.ok((await page.textContent('.lv-pop .lv-dist')).includes('Trailing stop will be turned off'), 'the editor says trailing will be turned off');
      await page.keyboard.press('Enter');
      await until(page, ([id, want]) => S.positions.find(x => x.id === id).sl === want && !document.querySelector('.lv-pop'), [ids.p, want]);
      const p1 = await page.evaluate(id => { const p = S.positions.find(x => x.id === id); return { sl: p.sl, trail: p.trail, pop: !!document.querySelector('.lv-pop') }; }, ids.p);
      t.eq(p1.sl, want, 'Enter sets the stop loss'); t.eq(p1.trail, 0, 'a manual stop turns trailing off'); t.eq(p1.pop, false, 'editor closes');
      // pending order: a buy limit above the ask is refused
      await page.waitForTimeout(1100);
      await page.click(`#chartAlt button[aria-label="Edit order price #${ids.o}"]`);
      const ask = await page.evaluate(() => Engine.quote('EURUSD').ask);
      await page.fill('.lv-pop input', (ask + .001).toFixed(5));
      t.eq((await page.textContent('.lv-pop .lv-why')).trim(), 'Buy limit must be below market', 'order on the wrong side refused');
      await page.click('.lv-pop [data-a=x]');
      // alert: price and condition follow the edit
      await page.click(`#chartAlt button[aria-label="Edit alert #${ids.a}"]`);
      const mid = await page.evaluate(() => Engine.quote('EURUSD').mid), ap = +(mid - .002).toFixed(5);
      await page.fill('.lv-pop input', ap.toFixed(5)); await page.click('.lv-pop [data-a=set]');
      await until(page, ([id, ap]) => S.alerts.find(x => x.id === id)?.price === ap, [ids.a, ap]);
      t.deep(await page.evaluate(id => { const a = S.alerts.find(x => x.id === id); return [a.price, a.cond]; }, ids.a), [ap, 'below'], 'alert price and condition updated');
      // Remove takes the alert off (its line would otherwise sit under the pick click below)
      await page.waitForTimeout(1100);
      await page.click(`#chartAlt button[aria-label="Edit alert #${ids.a}"]`); await page.click('.lv-pop [data-a=rm]');
      await until(page, id => !S.alerts.some(x => x.id === id), ids.a);
      t.eq(await page.evaluate(id => S.alerts.some(x => x.id === id), ids.a), false, 'Remove deletes the alert');
      // pick on chart: one click on the chart at the y of a valid stop
      await page.waitForTimeout(1100);
      await page.click(`#chartAlt button[aria-label="Edit stop loss #${ids.p}"]`);
      await page.click('.lv-pop [data-a=pick]');
      t.ok(await page.evaluate(() => !!pickLevel && document.getElementById('toolHint').classList.contains('show')), 'picking shows the hint');
      await page.click('.chart-nav .cv-tg'); // close the text panel so the chart is free to click
      // the lines changed just before (stop set, alert removed): the scale is read only once it has stopped moving
      t.ok(await scaleSettled(page, id => [candle.priceToCoordinate(Engine.quote('EURUSD').bid), candle.priceToCoordinate(S.positions.find(x => x.id === id).sl)], ids.p), 'the price scale settles');
      // halfway between the bid and the current stop (the ticket's preview stop line may sit right there: picking wins over its drag).
      // The vertical scale follows the generated bars, so on a tight scale the stop (and halfway to it) can sit below
      // the price pane, where a click picks nothing, or under the picking hint at the foot of the chart (the hint takes the
      // click): then the point moves up, towards the bid, to the first place where the chart itself is under the pointer
      const pt = await page.evaluate(id => {
        const p = S.positions.find(x => x.id === id), yb = candle.priceToCoordinate(Engine.quote('EURUSD').bid), ys = candle.priceToCoordinate(p.sl), ph = pricePaneH();
        const r = document.getElementById('chart').getBoundingClientRect(), x = r.left + r.width * .4;
        let y = Math.min((yb + ys) / 2, ph - 4);
        while (y > yb + 20 && !document.elementFromPoint(x, r.top + y)?.closest('#chart')) y -= 2;
        return { x, y: r.top + y, gap: ys - yb, below: y - yb, inPane: y > 0 && y < ph && !!document.elementFromPoint(x, r.top + y)?.closest('#chart'), want: candle.coordinateToPrice(y) };
      }, ids.p);
      t.ok(pt.gap > 40, 'bid and stop are apart on screen: ' + pt.gap);
      t.ok(pt.inPane && pt.below > 20, `the picked point is on the chart's price pane, well below the bid: ${pt.below} px`);
      await page.mouse.click(pt.x, pt.y);
      await until(page, ([id, sl0]) => !pickLevel && S.positions.find(x => x.id === id).sl !== sl0, [ids.p, want]);
      const picked = await page.evaluate(id => ({ sl: S.positions.find(x => x.id === id).sl, bid: Engine.quote('EURUSD').bid, pick: pickLevel}), ids.p);
      t.ok(Math.abs(pt.want - picked.sl) < .0002 && picked.sl < picked.bid, `picked stop ${picked.sl} at the clicked price ${pt.want}`);
      t.eq(picked.pick, null, 'picking ends after the click');
      // the target disappears while the editor is open
      await page.evaluate(o => editLevel({ kind: 'ord', ref: S.orders.find(x => x.id === o) }, null), ids.o);
      await page.evaluate(id => { cancelOrder(id); T.clearToasts(); }, ids.o);
      await until(page, () => !document.querySelector('.lv-pop') && T.toasts().some(x => x.title === 'Level no longer exists'));
      t.ok(await page.evaluate(() => !document.querySelector('.lv-pop') && T.toasts().some(x => x.title === 'Level no longer exists')), 'editor closes when its order is gone');
      // chart navigation
      // (the library applies a new range on its next frame: one click per frame, as a person would)
      const rng = () => page.evaluate(() => { const r = chart.timeScale().getVisibleLogicalRange(); return { from: r.from, to: r.to, n: disp.length }; });
      // a click is read back once the range has moved (each of these clicks moves it)
      const navClick = async k => { const r0 = await rng(); await page.click(`.chart-nav [data-nav=${k}]`); await until(page, r0 => { const r = chart.timeScale().getVisibleLogicalRange(); return r && (r.from !== r0.from || r.to !== r0.to); }, r0); return rng(); };
      await page.evaluate(() => chart.timeScale().setVisibleLogicalRange({ from: disp.length - 160, to: disp.length + 8 }));
      await until(page, () => { const r = chart.timeScale().getVisibleLogicalRange(); return r && Math.abs(r.to - disp.length - 8) < 1e-6 && Math.abs(r.from - disp.length + 160) < 1e-6; });
      const r0 = await rng(), r1 = await navClick('in'), r2 = await navClick('back'), r3 = await navClick('latest');
      const nav = { w0: r0.to - r0.from, w1: r1.to - r1.from, back: r2.to, to: r3.to, n: r3.n };
      t.near(nav.w1 / nav.w0, .8, 'Zoom in narrows the range by 20%', .05);
      t.ok(nav.back < nav.n, 'Scroll back moves into history');
      t.near(nav.to, nav.n + 8, 'Back to latest', 0, 1);
      // splitter: a plain click opens − / Reset / +
      const h = await page.evaluate(() => { const e = document.querySelector('.ws-split[data-k=rail]').getBoundingClientRect(); return { x: e.left + e.width / 2, y: e.top + e.height / 2 }; });
      await page.mouse.click(h.x, h.y); await until(page, () => !!document.querySelector('.split-pop') && document.querySelector('.split-pop').getBoundingClientRect().width > 0);
      t.ok(await page.isVisible('.split-pop'), 'a click on the splitter opens the popover');
      const w0 = await page.evaluate(() => wsState().cur.rail);
      await page.click('.split-pop [data-sp="1"]');
      await until(page, w0 => wsState().cur.rail === w0 + 16, w0);
      t.eq(await page.evaluate(() => wsState().cur.rail), w0 + 16, '+ grows the ticket column by 16 px');
      await page.click('.split-pop [data-sp="0"]');
      await until(page, () => wsState().cur.rail === 360);
      t.eq(await page.evaluate(() => wsState().cur.rail), 360, 'Reset returns to the preset'); t.eq(await page.isVisible('.split-pop'), false, 'Reset closes the popover');
      t.noErrors(page);
    }
  },
  {
    name: 'A11Y-7 focus is never hidden under the toasts; the chart text is plain text and descriptive',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await ready(page);
      await page.setViewportSize({ width: 1512, height: 945 });
      const r = await page.evaluate(async () => {
        T.reset(); for (let i = 0; i < 4; i++) toast('Note ' + i, 'body', 'info');
        const ts = document.getElementById('toasts').getBoundingClientRect();
        const b = document.createElement('button'); b.textContent = 'probe'; Object.assign(b.style, { position: 'fixed', left: ts.left + 10 + 'px', top: ts.top + 10 + 'px', zIndex: 1 }); document.body.appendChild(b);
        b.focus(); const on = document.getElementById('toasts').classList.contains('yield');
        b.blur(); await new Promise(r => setTimeout(r, 20)); const off = !document.getElementById('toasts').classList.contains('yield'); b.remove();
        // a free-text journal note cannot become markup in the chart text
        S.hlines.EURUSD = [1.1]; document.querySelector('.chart-nav .cv-tg').click();
        return { on, off, sum: document.getElementById('chartAltSum').textContent, desc: document.getElementById('chart').getAttribute('aria-describedby'), imgs: document.querySelectorAll('#chartAlt img').length, tables: document.querySelectorAll('#chartAlt table').length };
      });
      t.eq(r.on, true, 'toasts step aside while the focused control is under them'); t.eq(r.off, true, 'and come back on blur');
      t.eq(r.desc, 'chartAltSum', 'the chart is described by its summary');
      t.ok(/EUR\/USD/.test(r.sum) && /(no live prices|live platform prices)/.test(r.sum), 'summary names the pair and the price source: ' + r.sum);
      t.ok(!/simulat|synthetic/i.test(r.sum), 'summary never says simulated: ' + r.sum);
      t.ok(!/bullish|bearish|will (rise|fall)|signal/i.test(r.sum), 'summary describes, does not predict');
      t.eq(r.tables, 2, 'levels and bars tables'); t.eq(r.imgs, 0, 'no markup from text');
      const sym = await page.evaluate(async () => { setSymbol('USDJPY'); await new Promise(r => setTimeout(r, 700)); return document.getElementById('chartAltSum').textContent; });
      t.ok(/USD\/JPY/.test(sym), 'summary follows the symbol within a second: ' + sym);
      t.noErrors(page);
    }
  },
  {
    name: 'A11Y-8 chart data tables are patched in place: a focused Edit survives the refresh, Enter after 1-3 s opens the editor',
    async run({ t, app }) {
      const page = await app('', { clock: 'run' });
      await ready(page);
      await page.setViewportSize({ width: 1512, height: 945 });
      const id = await page.evaluate(() => {
        T.reset(); setSymbol('EURUSD'); setView('trade', 'positions');
        const q = Engine.quote('EURUSD'), pip = Engine.META.EURUSD.pip;
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 1, dupOk: true, pmDone: true }); p.sl = +(q.bid - 20 * pip).toFixed(5);
        changed('pos'); frame(true, true); T.clearToasts(); return p.id;
      });
      await page.click('.chart-nav .cv-tg');
      await page.waitForTimeout(150);
      const sel = `#chartAlt button[aria-label="Edit stop loss #${id}"]`;
      const probe = await page.evaluate(async sel => {
        const b = document.querySelector(sel); b.focus();
        const tables = [...document.querySelectorAll('#chartAlt table')], seen = [];
        for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 400)); seen.push(document.activeElement === b); }
        return { seen, same: tables.every(x => x.isConnected), btn: b.isConnected };
      }, sel);
      t.eq(probe.seen.every(Boolean), true, 'focus stays on the same Edit button for 3.2 s: ' + probe.seen.join(','));
      t.eq(probe.same, true, 'the tables are not replaced'); t.eq(probe.btn, true, 'the button is not replaced');
      let opened = 0;
      for (const wait of [700, 1000, 1300, 2100]) {
        await page.focus(sel); await page.waitForTimeout(wait); await page.keyboard.press('Enter');
        if (await page.isVisible('.lv-pop')) opened++;
        await page.keyboard.press('Escape'); await page.waitForTimeout(50);
      }
      t.eq(opened, 4, 'Enter opens the editor every time, whatever the wait');
      // the row changes under the focus: the level moves, the button and its new target follow
      // (the tables refresh on their own timer, at most once a second: the row is read once it shows the new stop, and
      // the focus is checked all along that wait, on the same button)
      await page.evaluate(({ sel, id }) => {
        const b = window.__editBtn = document.querySelector(sel); b.focus(); window.__lostFocus = 0;
        window.__focusWatch = setInterval(() => { if (document.activeElement !== b) window.__lostFocus++; }, 50);
        const p = S.positions.find(x => x.id === id); p.sl = +(p.sl - .001).toFixed(5); changed('pos');
      }, { sel, id });
      await until(page, id => { const row = window.__editBtn.closest('tr'), p = S.positions.find(x => x.id === id); return !!row && row.cells[2].textContent === fp('EURUSD', p.sl); }, id);
      const moved = await page.evaluate(id => {
        clearInterval(window.__focusWatch);
        const b = window.__editBtn, row = b.closest('tr'), p = S.positions.find(x => x.id === id);
        return { focus: document.activeElement === b && window.__lostFocus === 0 && b.isConnected, price: row && row.cells[2].textContent, want: fp('EURUSD', p.sl) };
      }, id);
      t.eq(moved.focus, true, 'focus kept when the row values change'); t.eq(moved.price, moved.want, 'the row shows the moved stop');
      t.noErrors(page);
    }
  }
];
