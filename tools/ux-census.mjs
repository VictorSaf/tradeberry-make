#!/usr/bin/env node
/* UX control census and sweep (skill ux-xx, phases "Control census" and "Control sweep"). Desktop only for now.
     node tools/ux-census.mjs                      census: every control in every state → .mace/ux/controls.json
     node tools/ux-census.mjs --sweep <lot>        activate every control of a lot once, record what it did
                                                   → .mace/ux/sweep/<lot>-<width>.json   (lots: --lots lists them)
     --w 1220,1440   viewport widths (census default 1220,1440; sweep default 1220, Victor's window)
   Runs the SOURCE on its own static server (free port) in headless Chromium, one fresh context per run: the sandbox
   account of that context only, clock started at Tue 2026-10-20 10:00 UTC (FX open), market frozen. Nothing here touches
   the live server, the Mac mini or the browser profile of a person. The tool only observes: the verdict on each control
   (honest, dead, unclear, unsafe…) is the reviewers' job, from the recorded effect. */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.mace/ux');
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1] || ''; };
const SWEEP = arg('--sweep'), HEIGHTS = { 1081: 800, 1220: 934, 1440: 900, 1920: 1080 };
const WIDTHS = (arg('--w') || (SWEEP ? '1220' : '1220,1440')).split(',').map(Number);
const CLOCK = new Date('2026-10-20T10:00:00Z');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// ---- states: how to reach each screen through the interface, and which part of it belongs to which lot ----
const click = (page, sel) => page.click(sel, { timeout: 4000 });
const view = v => async page => { await click(page, `#views [data-view="${v}"]`); await page.waitForTimeout(350); };
const tab = (v, t) => async page => { await view(v)(page); if (!await page.locator(`#tabs [data-tab="${t}"]`).isVisible()) { await page.waitForTimeout(800); await view(v)(page); } await click(page, `#tabs [data-tab="${t}"]`); await page.waitForTimeout(600); };
const seed = page => page.evaluate(() => {
  // the pre-mortem and tilt gates are off only while the fixtures are placed (they would stop the seeding); state dlg-pre-mortem covers the gate itself
  const pm = pmCfg(), tl = tiltCfg(), pm0 = pm.on, tl0 = tl.on; pm.on = false; tl.on = false;
  const q = Engine.quote ? Engine.quote('EURUSD') : { ask: Engine.mid('EURUSD'), mid: Engine.mid('EURUSD') }, pip = .0001;
  openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, sl: +(q.mid - 30 * pip).toFixed(5), tp: +(q.mid + 60 * pip).toFixed(5), dupOk: true });
  const g = Engine.mid('GBPUSD'); openPosition({ sym: 'GBPUSD', side: 'sell', lots: .2, sl: +(g + 40 * pip).toFixed(5), dupOk: true });
  placeOrder({ sym: 'EURUSD', side: 'buy', ot: 'limit', price: +(q.ask - 30 * pip).toFixed(5), lots: .1 });
  addAlert('EURUSD', +(q.mid + 25 * pip).toFixed(5));
  pm.on = pm0; tl.on = tl0;
});
const pop = (base, sel) => async page => { await base(page); await click(page, sel); await page.waitForTimeout(350); };
const trade = view('trade');
// scope: only controls inside it belong to the state; fresh: only controls that were not visible in `from`
const STATES = [
  { id: 'trade', lot: 'shell', enter: trade, scope: 'header.topbar, #statusbar' },
  { id: 'menu-account', lot: 'shell', enter: pop(trade, '#userBtn'), from: 'trade' },
  { id: 'pop-account-figures', lot: 'shell', enter: pop(trade, '#acctMore'), from: 'trade', optional: true },
  { id: 'pop-sonification', lot: 'shell', enter: pop(trade, '#sonMore'), from: 'trade', optional: true },
  { id: 'dlg-command', lot: 'shell', enter: pop(trade, '#cmdBtn'), from: 'trade' },
  { id: 'dlg-help', lot: 'shell', enter: async page => { await trade(page); await page.keyboard.press('?'); await page.waitForTimeout(400); if (!await page.evaluate(() => document.getElementById('help')?.classList.contains('on') || !!document.querySelector('#help:not([hidden]) .modal')?.offsetParent)) { await click(page, '#userBtn'); await page.getByRole('menuitem', { name: /help/i }).click({ timeout: 3000 }); await page.waitForTimeout(400); } }, from: 'trade' },
  { id: 'dlg-replay', lot: 'shell', enter: pop(trade, '#rpBtn'), from: 'trade', optional: true },

  { id: 'trade-market', lot: 'market', enter: trade, scope: '.watch, .chartp' },
  { id: 'menu-chart-type', lot: 'market', enter: pop(trade, '#typeBtn'), from: 'trade-market' },
  { id: 'menu-indicators', lot: 'market', enter: pop(trade, '#indBtn'), from: 'trade-market' },
  { id: 'menu-layout', lot: 'market', enter: pop(trade, '#layBtn'), from: 'trade-market' },
  { id: 'pop-specs', lot: 'market', enter: pop(trade, '#insBtn'), from: 'trade-market' },
  { id: 'watch-columns', lot: 'market', enter: pop(trade, '#wlColsBtn'), from: 'trade-market' },

  { id: 'ticket-market', lot: 'ticket', enter: trade, scope: '.rail' },
  { id: 'ticket-sl-tp', lot: 'ticket', enter: async page => { await trade(page); for (const s of ['#useSL', '#useTP']) await page.check(s, { timeout: 3000, force: true }).catch(() => {}); await page.evaluate(() => document.querySelectorAll('.rail details').forEach(d => d.open = true)); await page.waitForTimeout(400); }, scope: '.rail', from: 'ticket-market' },
  { id: 'ticket-pending', lot: 'ticket', enter: pop(trade, '#otSeg [data-ot="limit"]'), scope: '.rail', from: 'ticket-market' },
  { id: 'dlg-pre-mortem', lot: 'ticket', enter: async page => { await trade(page); await page.evaluate(() => { pmCfg().on = true; openPosition({ sym: 'EURUSD', side: 'buy', lots: 1 }); }); await page.waitForSelector('#pmGate .pm-modal', { timeout: 4000 }); await page.waitForTimeout(300); }, from: 'ticket-market', optional: true },
  { id: 'rail-depth', lot: 'ticket', enter: pop(trade, '#isw [data-i="iDom"]'), scope: '.rail', from: 'ticket-market', optional: true },
  { id: 'rail-stats', lot: 'ticket', enter: pop(trade, '#isw [data-i="iStats"]'), scope: '.rail', from: 'ticket-market', optional: true },

  { id: 'dock-positions', lot: 'dock', enter: async page => { await seed(page); await tab('trade', 'positions')(page); }, scope: '.dock' },
  { id: 'dock-orders', lot: 'dock', enter: async page => { await seed(page); await tab('trade', 'orders')(page); }, scope: '.dock', from: 'dock-positions' },
  { id: 'dock-history', lot: 'dock', enter: async page => { await seed(page); await page.evaluate(() => closePosition(S.positions[1].id)); await tab('trade', 'history')(page); }, scope: '.dock', from: 'dock-positions' },
  { id: 'dock-alerts', lot: 'dock', enter: async page => { await seed(page); await tab('trade', 'alerts')(page); }, scope: '.dock', from: 'dock-positions' },
  { id: 'dock-journal', lot: 'dock', enter: async page => { await seed(page); await page.evaluate(() => closePosition(S.positions[1].id)); await tab('trade', 'journal')(page); }, scope: '.dock', from: 'dock-positions' },

  { id: 'monitor', lot: 'monitor', enter: view('monitor'), scope: '#monitor', sample: '.mq' },

  { id: 'research-brief', lot: 'research', enter: tab('research', 'brief'), scope: '.dock' },
  { id: 'research-correlation', lot: 'research', enter: tab('research', 'corr'), scope: '.dock', from: 'research-brief' },
  { id: 'research-volatility', lot: 'research', enter: tab('research', 'vol'), scope: '.dock', from: 'research-brief' },
  { id: 'research-calendar', lot: 'research', enter: tab('research', 'calendar'), scope: '.dock', from: 'research-brief' },
  ...Array.from({ length: 12 }, (_, i) => ({ id: 'observatory-' + (i + 1), lot: 'observatory', enter: async page => { await tab('research', 'obs')(page); await page.locator('.obs-nav button').nth(i).click({ timeout: 4000 }); await page.waitForTimeout(900); }, scope: '.dock', nameFrom: '.obs-nav button.on' })),

  { id: 'lab-backtester', lot: 'lab', enter: tab('lab', 'bt'), scope: '.dock' },
  { id: 'lab-backtester-results', lot: 'lab', optional: true, enter: async page => { await tab('lab', 'bt')(page); await click(page, '#btRun'); await page.waitForSelector('#btView', { timeout: 20000 }); await page.waitForTimeout(600); }, scope: '#btOut' },
  ...[1, 2, 3].map(i => ({ id: 'lab-backtester-view-' + (i + 1), lot: 'lab', enter: async page => { await tab('lab', 'bt')(page); await click(page, '#btRun'); await page.waitForSelector('#btView', { timeout: 20000 }); await page.locator('#btView button').nth(i).click({ timeout: 4000 }); await page.waitForTimeout(700); }, scope: '#btView2', nameFrom: '#btView button.on', optional: true })),
  { id: 'lab-risk', lot: 'lab', enter: tab('lab', 'lab'), scope: '.dock' },
  { id: 'lab-calculators', lot: 'lab', enter: tab('lab', 'calc'), scope: '.dock' },

  { id: 'coach-behaviour', lot: 'coach', enter: tab('coach', 'behav'), scope: '.dock' },
  ...[1, 2].map(i => ({ id: 'coach-behaviour-page-' + (i + 1), lot: 'coach', enter: async page => { await tab('coach', 'behav')(page); await page.locator('.bh-pgs button').nth(i).click({ timeout: 4000 }); await page.waitForTimeout(500); }, scope: '.dock', from: 'coach-behaviour', nameFrom: '.bh-pgs button.on' })),
  { id: 'coach-challenge', lot: 'coach', enter: tab('coach', 'chal'), scope: '.dock' },
  { id: 'coach-journal', lot: 'coach', enter: tab('coach', 'journal'), scope: '.dock' },
  { id: 'dlg-coach-details', lot: 'coach', enter: async page => { await seed(page); await page.evaluate(() => { for (const p of S.positions.slice()) closePosition(p.id); }); await tab('coach', 'journal')(page); await click(page, '.coach-more'); await page.waitForTimeout(500); }, from: 'coach-journal', optional: true },
];
const LOTS = [...new Set(STATES.map(s => s.lot))];
if (argv.includes('--lots')) { for (const l of LOTS) console.log(l.padEnd(12), STATES.filter(s => s.lot === l).map(s => s.id).join(', ')); process.exit(0); }
if (SWEEP && !LOTS.includes(SWEEP)) { console.error(`Unknown lot "${SWEEP}". Lots: ${LOTS.join(', ')}`); process.exit(1); }

// ---- in the page: collect the controls, and a signature of everything a control may change ----
const collect = scope => {
  const SEL = 'button,a[href],input,select,textarea,summary,[role=button],[role=tab],[role=switch],[role=checkbox],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=slider],[role=radio],[tabindex]:not([tabindex="-1"]),[onclick],[contenteditable=true]';
  const key = el => { const parts = []; let e = el; while (e && e.nodeType === 1 && parts.length < 6) { if (e.id && !/\d{3,}/.test(e.id)) { parts.unshift('#' + e.id); break; } let s = e.tagName.toLowerCase(); const c = [...e.classList].filter(x => !/^(on|open|active|sel|cur|up|dn|hover|focus|tk-up|tk-dn)$/.test(x)).slice(0, 2).join('.'); if (c) s += '.' + c; if (e === el) for (const a of ['data-view', 'data-tab', 'data-act', 'data-i', 'data-k', 'data-u', 'data-tf', 'data-ot', 'data-f', 'data-step', 'name', 'type']) if (e.getAttribute(a)) s += `[${a}=${e.getAttribute(a)}]`; parts.unshift(s); e = e.parentElement; } return parts.join('>'); };
  const within = scope ? [...document.querySelectorAll(scope)] : null;
  const out = []; let n = 0;
  document.querySelectorAll('[data-uxk]').forEach(e => e.removeAttribute('data-uxk'));
  for (const el of document.querySelectorAll(SEL)) {
    const r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    if (!(r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0)) continue;
    if (within && !within.some(w => w.contains(el))) continue;
    const shut = el.closest('details:not([open])'); if (shut && !(el.tagName === 'SUMMARY' && el.parentElement === shut)) continue; // inside a folded section: not a control of this state
    const t = el.tagName.toLowerCase(), ty = el.getAttribute('type') || '', role = el.getAttribute('role') || '';
    let kind = role || (t === 'input' ? (ty === 'checkbox' ? 'checkbox' : 'input:' + (ty || 'text')) : t);
    const own = (el.getAttribute('aria-label') || '').trim(), text = (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60);
    const lab = el.labels && el.labels[0] ? el.labels[0].innerText.trim().replace(/\s+/g, ' ').slice(0, 60) : '';
    const tip = (el.getAttribute('title') || el.getAttribute('data-tip') || '').replace(/\s+/g, ' ').slice(0, 160);
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, top = cx >= 0 && cy >= 0 && cx < innerWidth && cy < innerHeight ? document.elementFromPoint(cx, cy) : null;
    el.setAttribute('data-uxk', n);
    out.push({ n: n++, key: key(el), kind, label: own || text || lab || el.getAttribute('placeholder') || '', named: !!(own || text || lab || el.getAttribute('aria-labelledby') || tip), tip,
      w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top),
      inView: r.right > 0 && r.bottom > 0 && r.left < innerWidth && r.top < innerHeight,
      covered: !!top && top !== el && !el.contains(top) && !top.contains(el) ? (top.id ? '#' + top.id : top.tagName.toLowerCase() + (top.classList[0] ? '.' + top.classList[0] : '')) : '',
      disabled: !!el.disabled || el.getAttribute('aria-disabled') === 'true',
      state: ['aria-pressed', 'aria-expanded', 'aria-checked', 'aria-selected', 'aria-current'].filter(a => el.hasAttribute(a)).map(a => a.slice(5) + '=' + el.getAttribute(a)).join(' ') + (el.classList.contains('on') ? ' .on' : '') + ('checked' in el && /checkbox|radio/.test(ty) ? ' checked=' + el.checked : ''),
      value: t === 'select' ? el.value + ' of ' + el.options.length : t === 'input' && !/checkbox|radio|file/.test(ty) ? String(el.value).slice(0, 30) : undefined,
      href: t === 'a' ? el.getAttribute('href') : undefined });
  }
  return out;
};
const signature = () => {
  const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
  const nm = e => e.id ? '#' + e.id : e.tagName.toLowerCase() + (e.classList[0] ? '.' + e.classList[0] : '');
  const set = {}; const walk = (o, p) => { for (const k in o) { const v = o[k]; if (v && typeof v === 'object' && !Array.isArray(v) && p.split('.').length < 3) walk(v, p + k + '.'); else set[p + k] = typeof v === 'object' ? JSON.stringify(v).slice(0, 80) : v; } };
  try { walk(S.set, ''); } catch (e) { /* no settings */ }
  return { view: document.body.dataset.view || '', tab: document.querySelector('#tabs button.on')?.dataset.tab || '',
    open: [...document.querySelectorAll('.overlay,[role=dialog],[role=alertdialog],[role=menu],[role=listbox],.dd-pop,.lv-pop,.tour-card,details[open]')].filter(vis).map(nm).sort().join(' '),
    toasts: [...document.querySelectorAll('#toasts .toast')].map(t => t.innerText.replace(/\s+/g, ' ').trim()),
    positions: S.positions.length, orders: S.orders.length, history: S.history.length, alerts: S.alerts.length, balance: Math.round(S.balance * 100) / 100,
    symbol: document.getElementById('symName')?.textContent || '', theme: document.documentElement.dataset.theme || '', body: document.body.className.split(/\s+/).sort().join(' '),
    fullscreen: !!document.fullscreenElement, set,
    fields: Object.fromEntries([...document.querySelectorAll('input:not([type=checkbox]):not([type=radio]):not([type=file]),select,textarea')].filter(vis).map((e, i) => [e.id ? '#' + e.id : nm(e) + ':' + i, String(e.value).slice(0, 40)])), text: document.body.innerText.length, focus: document.activeElement ? nm(document.activeElement) : '' };
};
const diff = (a, b) => {
  const out = [];
  for (const k of ['view', 'tab', 'open', 'positions', 'orders', 'history', 'alerts', 'balance', 'symbol', 'theme', 'fullscreen']) if (a[k] !== b[k]) out.push(`${k}: ${a[k] === '' ? '∅' : a[k]} → ${b[k] === '' ? '∅' : b[k]}`);
  if (a.body !== b.body) { const A = new Set(a.body.split(' ')), B = new Set(b.body.split(' ')); const add = [...B].filter(x => !A.has(x)), rem = [...A].filter(x => !B.has(x)); out.push('layout class: ' + [...add.map(x => '+' + x), ...rem.map(x => '−' + x)].join(' ')); }
  for (const k of new Set([...Object.keys(a.set), ...Object.keys(b.set)])) if (a.set[k] !== b.set[k]) out.push(`setting ${k}: ${a.set[k]} → ${b.set[k]}`);
  for (const k of Object.keys(b.fields)) if (k in a.fields && a.fields[k] !== b.fields[k]) out.push(`field ${k}: ${a.fields[k] || '∅'} → ${b.fields[k] || '∅'}`);
  const nt = b.toasts.filter(t => !a.toasts.includes(t)); if (nt.length) out.push('message: ' + nt.join(' | '));
  if (!out.length && Math.abs(a.text - b.text) > 12) out.push(`page text changed (${b.text - a.text > 0 ? '+' : ''}${b.text - a.text} chars)`);
  return out;
};

// ---- run ----
const server = http.createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (p.startsWith('..')) return res.writeHead(403).end();
  try { const body = await readFile(join(ROOT, p || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(p || 'index.html')] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
async function boot(width) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width, height: HEIGHTS[width] || 900 } });
  await ctx.route(u => !u.href.startsWith(BASE), r => r.abort());
  const page = await ctx.newPage();
  page.problems = [];
  page.on('pageerror', e => page.problems.push('error: ' + String(e).slice(0, 200)));
  page.on('filechooser', () => page.problems.push('file chooser opened'));
  page.on('dialog', d => { page.problems.push(`native ${d.type()}: ${d.message().slice(0, 120)}`); d.dismiss().catch(() => {}); });
  await page.clock.install({ time: CLOCK }); // starts at the pinned instant and runs: a frozen Date.now starves the page's own frame loop
  await page.goto(BASE + '/');
  await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
  // the tour invitation of a first visit is taken out for the whole run (it appears a while after boot and would sit on the controls under it; its own overlap is a finding of its own, probes/sweep/lab-run-and-tour-chip.mjs)
  await page.addStyleTag({ content: '.tour-chip{display:none!important}' });
  await page.evaluate(() => { Engine.speed = 0; document.getElementById('onote')?.remove(); });
  return page;
}
const visibleKeys = {}; // state id → keys visible, for `from`
async function enter(page, st) { await st.enter(page); const all = await page.evaluate(collect, null); visibleKeys[st.id] = new Set(all.map(c => c.key + '|' + c.label)); return page.evaluate(collect, st.scope || null); }
const own = (st, list) => st.from && visibleKeys[st.from] ? list.filter(c => !visibleKeys[st.from].has(c.key + '|' + c.label)) : list;

await mkdir(join(OUT, 'sweep'), { recursive: true });
const ONLY = arg('--only');
const wanted = STATES.filter(s => ONLY ? ONLY.split(',').includes(s.id) : !SWEEP || s.lot === SWEEP || STATES.some(x => x.lot === SWEEP && x.from === s.id));
const result = { generated: new Date().toISOString(), clock: CLOCK.toISOString(), mode: SWEEP ? 'sweep:' + SWEEP : 'census', widths: {} };
for (const width of WIDTHS) {
  const W = result.widths[width] = { states: {}, skipped: [] };
  for (const st of wanted) {
    let page = await boot(width), list;
    try { list = await enter(page, st); } catch (e) { W.skipped.push({ state: st.id, why: (L => [L.find(l => /Timeout|Error/.test(l)), L.find(l => /waiting for locator/.test(l)), L.find(l => /intercepts pointer events|not visible|not enabled|outside of the viewport/.test(l))].filter(Boolean).join(' · ').replace(/\x1b\[\d+m/g, '').replace(/\s+/g, ' ').slice(0, 400))(String(e).split('\n')), optional: !!st.optional }); await page.context().close(); continue; }
    let mine = own(st, list);
    if (st.sample) { const seen = new Set(); mine = mine.filter(c => { const k = c.key.replace(/:nth-of-type\(\d+\)/g, ''); if (seen.has(k)) { c.repeat = true; return true; } seen.add(k); return true; }); }
    const name = st.nameFrom ? await page.evaluate(s => document.querySelector(s)?.innerText.trim().split('\n')[0] || '', st.nameFrom) : '';
    const rec = W.states[st.id] = { lot: st.lot, name, controls: mine, problems: page.problems.slice() };
    if (SWEEP && st.lot === SWEEP) {
      const seenKey = new Map();
      for (const c of mine) {
        const pk = c.key + '|' + c.kind; seenKey.set(pk, (seenKey.get(pk) || 0) + 1);
        if (seenKey.get(pk) > 2) { c.effect = ['not activated: third or later copy of the same control (rows of a list)']; continue; }
        if (c.disabled) { c.effect = ['not activated: disabled' + (c.tip ? ' · tooltip: ' + c.tip : ' · no reason shown')]; continue; }
        if (/^input:(file)$/.test(c.kind) || (c.href && /^https?:/.test(c.href))) { c.effect = ['not activated: leaves the page (' + (c.href || 'file chooser') + ')']; continue; }
        if (/^input:(number|text|search|range)$|^textarea$/.test(c.kind)) { c.effect = ['field: not activated by the sweep (value ' + c.value + ')']; continue; }
        // a fresh page for every control: no effect of one control leaks into the next
        await page.context().close(); page = await boot(width);
        let now; try { now = await enter(page, st); } catch (e) { c.effect = ['state could not be reached again: ' + String(e).split('\n')[0].slice(0, 120)]; continue; }
        // the same control again: by key and label; where the label is data that changes between loads (a quote, a score), by key and position
        let same = now.filter(x => x.key === c.key && x.label === c.label), target = same[Math.min(seenKey.get(pk) - 1, same.length - 1)];
        if (!target) { const nth = mine.filter(x => x.key === c.key).indexOf(c); same = now.filter(x => x.key === c.key); target = same[nth]; }
        if (!target) { c.effect = ['unstable: not found again after a reload']; continue; }
        const before = await page.evaluate(signature), b0 = target.state, p0 = page.problems.length;
        try {
          if (c.kind === 'select') await page.locator(`[data-uxk="${target.n}"]`).evaluate(el => { el.selectedIndex = (el.selectedIndex + 1) % el.options.length; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); });
          else await page.click(`[data-uxk="${target.n}"]`, { timeout: 2000 });
        } catch (e) { const m = String(e); c.effect = [/intercepts pointer events/.test(m) ? 'not clickable: covered by ' + (m.match(/<([^>]{1,80})>[^<]*intercepts/) || [, 'another element'])[1] : /outside of the viewport/.test(m) ? 'not clickable: outside the viewport' : 'not clickable: ' + m.split('\n')[0].slice(0, 120)]; continue; }
        await page.waitForTimeout(700);
        const after = await page.evaluate(signature);
        const self = await page.evaluate(n => { const el = document.querySelector(`[data-uxk="${n}"]`); if (!el) return null; return ['aria-pressed', 'aria-expanded', 'aria-checked', 'aria-selected', 'aria-current'].filter(a => el.hasAttribute(a)).map(a => a.slice(5) + '=' + el.getAttribute(a)).join(' ') + (el.classList.contains('on') ? ' .on' : '') + ('checked' in el && /checkbox|radio/.test(el.type) ? ' checked=' + el.checked : ''); }, target.n);
        const eff = diff(before, after);
        if (self === null) eff.push('the control is gone after the click'); else if (self !== b0) eff.push(`own state: ${b0 || '∅'} → ${self || '∅'}`);
        for (const p of page.problems.slice(p0)) eff.push(p);
        if (before.focus !== after.focus && !eff.length) eff.push('focus moved to ' + after.focus + ' (nothing else observed)');
        c.effect = eff.length ? eff : [/\.on\b|selected=true|checked=true|current=page|pressed=true/.test(b0) && /^(button|tab|radio|option|menuitemradio)$/.test(c.kind) ? 'already the selected option: no change expected' : 'NO OBSERVABLE EFFECT'];
      }
    }
    await page.context().close();
  }
}
await browser.close(); server.close();

const file = SWEEP ? join(OUT, 'sweep', `${SWEEP}-${WIDTHS.join('-')}${ONLY ? '-partial' : ''}.json`) : join(OUT, ONLY ? 'controls-partial.json' : 'controls.json');
await writeFile(file, JSON.stringify(result, null, 1));
for (const [w, W] of Object.entries(result.widths)) {
  const all = Object.values(W.states).flatMap(s => s.controls), uniq = new Set(all.map(c => c.key + '|' + c.kind));
  console.log(`\n== ${w}px · ${Object.keys(W.states).length} states · ${all.length} controls (${uniq.size} unique)`);
  console.log(`   under 24px on a side: ${all.filter(c => c.w < 24 || c.h < 24).length} · no name: ${all.filter(c => !c.named).length} · covered by another element: ${all.filter(c => c.covered).length} · need a scroll to be seen: ${all.filter(c => !c.inView).length} · disabled: ${all.filter(c => c.disabled).length}`);
  for (const [id, s] of Object.entries(W.states)) console.log(`   ${id.padEnd(26)} ${String(s.controls.length).padStart(4)}  ${s.name || ''}${s.problems.length ? '  ! ' + s.problems.length + ' page problem(s)' : ''}`);
  for (const k of W.skipped) console.log(`   skipped ${k.state}${k.optional ? ' (optional)' : ''}: ${k.why}`);
  if (SWEEP) {
    const sw = Object.values(W.states).filter(s => s.lot === SWEEP).flatMap(s => s.controls).filter(c => c.effect);
    const cnt = f => sw.filter(c => f(c.effect[0])).length;
    console.log(`   sweep ${SWEEP}: ${sw.length} controls · no observable effect ${cnt(e => e === 'NO OBSERVABLE EFFECT')} · not clickable ${cnt(e => e.startsWith('not clickable'))} · not activated ${cnt(e => e.startsWith('not activated') || e.startsWith('field'))} · with page errors or native dialogs ${sw.filter(c => c.effect.some(e => /^(error|native)/.test(e))).length}`);
  }
}
console.log('\n' + file);
