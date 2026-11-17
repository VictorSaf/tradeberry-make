#!/usr/bin/env node
/* Hint audit (front 16.11.2026): proof that no element of a screen is missed by the hint cards.
     node tools/hint-audit.mjs --all                 every state (the same as no argument)
     node tools/hint-audit.mjs                       every state
     node tools/hint-audit.mjs research-brief trade  the named states (exit code 1 when one of them has a miss or a generic card)
     node tools/hint-audit.mjs --list                the states and their lots
     node tools/hint-audit.mjs --lot research        every state of a lot (lots: shell market ticket dock monitor research observatory lab coach misc)
     --w 1220      viewport width (Victor's window; the census default is 1220 and 1440)
     --dist        audit the built app in dist/ (the lazy hints bundle) instead of the source
   Same states and the same navigation as tools/ux-census.mjs, plus Administration, preferences, Teach me, the Opening Note and the dock Account tab.
   Runs the source on its own static server in headless Chromium, one fresh context per state, the sandbox account, the clock of the census (Tue 2026-10-20 10:00 UTC), market frozen.
   For every visible element of the state (control, value, label, header, cell, legend, canvas, svg region, element with a tip) it records:
     card     the element, or the element that holds it, has a card built for it (a control must have its own card: a button inside a stamped cell is not covered by the cell)
     generic  the card is only the old text (the fallback card of the engine): counts as a miss
     optout   the element is in hints-optouts.json (HX.optout): no hover, by decision
     miss     no card
   Every element also keeps the PLAIN TEXT of its card (HX.cardFor / hintRich with the tags removed, entities decoded, whitespace collapsed, cut at 1,500 characters) in `card`: tools/hints-catalog.mjs builds docs/hints-catalog.md from the audit files alone.
   States removed from --all because they cannot exist in this build (T13, 16.11.2026):
     dock-account          there is no Account tab in the dock (#tabs has no data-tab="account"|"acct"); the account figures live in the header and the account menu
     pop-account-figures   #acctMore (the account-figures popup) exists only in the phone layout (under 1081 px); this audit runs the desktop layout
   Fixtures of the audit (not data of the app): the server side of Administration (ADMIN_MOCK) and a deterministic platform feed for EURUSD (btFeed: the same generator as T.feed in tests/run.mjs).
   Backtester states: bt.js refuses to run without a feed (liveHas() is false on a static server), so the four lab-backtester-* states install btFeed before the Backtester opens; with it, Run gives a real result on the engine's own week plus generated history.
   Writes .mace/hints/audit-<state>.json and prints a summary. The audit only observes; it never clicks a control of the state beyond reaching it. */
import http from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, '.mace/hints');
const argv = process.argv.slice(2), arg = k => { const i = argv.indexOf(k); return i < 0 ? null : argv[i + 1] || ''; };
const FLAGS = new Set(['--all', '--list', '--dist', '--w', '--lot', '--keep']), want = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && ['--w', '--lot'].includes(argv[i - 1])));
const WIDTH = +(arg('--w') || 1220), HEIGHTS = { 1081: 800, 1220: 934, 1440: 900, 1920: 1080 };
const SERVE = argv.includes('--dist') ? join(ROOT, 'dist') : ROOT;
const CLOCK = new Date('2026-10-20T10:00:00Z');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

// ---- states: how to reach each screen (the navigation of tools/ux-census.mjs, then the zones the census did not cover) ----
const click = (page, sel) => page.click(sel, { timeout: 4000 });
const view = v => async page => { await click(page, `#views [data-view="${v}"]`); await page.waitForTimeout(350); };
const tab = (v, t) => async page => { await view(v)(page); if (!await page.locator(`#tabs [data-tab="${t}"]`).isVisible()) { await page.waitForTimeout(800); await view(v)(page); } await click(page, `#tabs [data-tab="${t}"]`); await page.waitForTimeout(600); };
const seed = page => page.evaluate(() => {
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
const helpOpen = async page => { await trade(page); await page.keyboard.press('?'); await page.waitForTimeout(400); if (!await page.evaluate(() => document.getElementById('help')?.classList.contains('on') || !!document.querySelector('#help:not([hidden]) .modal')?.offsetParent)) { await click(page, '#userBtn'); await page.getByRole('menuitem', { name: /help/i }).click({ timeout: 3000 }); await page.waitForTimeout(400); } };
// the server side of Administration is mocked: the audit has no server; these are fixtures of the audit, not data of the app
const ADMIN_MOCK = {
  me: { username: 'audit', shared: false, admin: true, modules: ['research', 'lab', 'coach'] },
  state: { rev: 1, savedAt: 1760954400, data: { state: {} } },
  admin: { me: 'audit', audit: [], users: [{ username: 'audit', shared: false, admin: true, disabled: false, created: 1760000000000, saved: 1760954000000, saves: 12, sessions: 1, active: true, devices: 1, modules: ['research', 'lab', 'coach'] }, { username: 'guest1', shared: true, admin: false, disabled: false, created: 1760100000000, saved: 1760900000000, saves: 3, sessions: 0, active: false, devices: 2, modules: ['research'] }] },
  pricedata: { recorder: { on: true, last: 1760954300000, today: 1234567, bytes: 5.2e8, daysBytes: 2.1e9 }, archive: { bytes: 4.4e9, syms: { EURUSD: { 1: { n: 400000 }, 60: { n: 9000 } }, GBPUSD: { 1: { n: 390000 }, 60: { n: 9000 } } }, last: { start: 1760900000000, end: 1760900600000, op: 'all', ok: 40, failed: 0, added: 21000 } }, total: 7.7e9, disk: { free: 6.1e10 }, gaps: [{ start: 1760800000000, end: 1760800900000, of: 15, covered: 15 }], gapsTotal: 1 }
};
// a deterministic platform feed for EURUSD (the generator of T.feed in tests/run.mjs): liveHas says yes, liveRange answers 1-minute bars while the market is open
const btFeed = page => page.evaluate(() => {
  const set = new Set(['EURUSD']), has0 = window.liveHas, rng0 = window.liveRange;
  const gen = (sym, res, from, to) => {
    const step = res * 60, out = []; let a = 0; for (const ch of sym + '|' + to) a = (Math.imul(a, 31) + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const nrm = () => Math.sqrt(-2 * Math.log(rnd() || 1e-12)) * Math.cos(2 * Math.PI * rnd());
    const c0 = Engine.candles[sym], sd = 6e-5 * Math.sqrt(res); let p = c0 && c0.length ? c0[0].open : Engine.mid(sym);
    for (let t = Math.ceil(to / step) * step - step; t >= from; t -= step) { if (t >= to || !Engine.isOpen(sym, t)) continue; const c = p, op = c * Math.exp(-sd * nrm()), h = Math.max(op, c) * (1 + Math.abs(nrm()) * sd / 2), l = Math.min(op, c) * (1 - Math.abs(nrm()) * sd / 2); out.push({ time: t, open: op, high: h, low: l, close: c }); p = op; }
    return out.reverse();
  };
  window.liveHas = s => set.has(s) || (typeof has0 === 'function' && has0(s));
  window.liveRange = (sym, res, from, to, opt = {}) => {
    if (!set.has(sym)) return typeof rng0 === 'function' ? rng0(sym, res, from, to, opt) : Promise.reject(new Error('no feed'));
    res = res === 60 ? 60 : 1; const total = Math.max(1, Math.ceil((to - from) / (res === 60 ? 31536000 : 604800)));
    return new Promise(resolve => { let i = 0; const tick = () => { i++; if (opt.onProgress) opt.onProgress(i, total); if (i < total) return setTimeout(tick, 0); const bars = gen(sym, res, from, to); resolve({ bars, start: bars.length > 0 && bars[0].time > from + 86400, from, to }); }; setTimeout(tick, 0); });
  };
});
// the Backtester with a result: the feed first (the tab runs the test by itself when it opens), then the tab; `more` goes on from there
const btResults = more => async page => {
  await trade(page); await btFeed(page);
  await page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 }).catch(() => {});
  await tab('lab', 'bt')(page);
  await page.waitForSelector('#btView', { timeout: 60000 }); await page.waitForTimeout(600);
  if (more) await more(page);
};
const adminState = (id, step) => ({ id, lot: 'misc', mock: 'admin', enter: async page => { await trade(page); await page.waitForSelector('#adminBtn', { state: 'attached', timeout: 8000 }); await click(page, '#userBtn'); await page.locator('#userPop [data-u="adminBtn"]').click({ timeout: 4000 }); await page.waitForSelector('#adminDlg .adm-tbl', { timeout: 6000 }); if (step) await step(page); await page.waitForTimeout(500); }, scope: '#adminDlg' });
const STATES = [
  { id: 'trade', lot: 'shell', enter: trade, scope: 'header.topbar, #statusbar' },
  { id: 'menu-account', lot: 'shell', enter: pop(trade, '#userBtn'), from: 'trade' },
  { id: 'pop-sonification', lot: 'shell', enter: pop(trade, '#sonMore'), from: 'trade', optional: true },
  { id: 'dlg-command', lot: 'shell', enter: pop(trade, '#cmdBtn'), from: 'trade' },
  { id: 'dlg-help', lot: 'shell', enter: helpOpen, from: 'trade' },
  { id: 'dlg-replay', lot: 'shell', enter: pop(trade, '#rpBtn'), from: 'trade', optional: true },

  { id: 'trade-market', lot: 'market', enter: trade, scope: '.watch, .chartp' },
  { id: 'menu-chart-type', lot: 'market', enter: pop(trade, '#typeBtn'), from: 'trade-market' },
  { id: 'menu-indicators', lot: 'market', enter: pop(trade, '#indBtn'), from: 'trade-market' },
  { id: 'menu-layout', lot: 'market', enter: pop(trade, '#layBtn'), from: 'trade-market' },
  { id: 'pop-specs', lot: 'market', enter: pop(trade, '#insBtn'), from: 'trade-market' },
  { id: 'watch-columns', lot: 'market', width: 1440, enter: pop(trade, '#wlColsBtn'), scope: '.watch' }, // the "more columns" button only exists from 1440 px

  { id: 'ticket-market', lot: 'ticket', enter: trade, scope: '.rail' },
  { id: 'ticket-sl-tp', lot: 'ticket', enter: async page => { await trade(page); for (const s of ['#useSL', '#useTP']) await page.check(s, { timeout: 3000, force: true }).catch(() => {}); await page.evaluate(() => document.querySelectorAll('.rail details').forEach(d => d.open = true)); await page.waitForTimeout(400); }, scope: '.rail', from: 'ticket-market' },
  { id: 'ticket-pending', lot: 'ticket', enter: pop(trade, '#otSeg [data-ot="limit"]'), scope: '.rail', from: 'ticket-market' },
  { id: 'dlg-pre-mortem', lot: 'ticket', enter: async page => { await trade(page); await page.evaluate(() => { pmCfg().on = true; openPosition({ sym: 'EURUSD', side: 'buy', lots: 1 }); }); await page.waitForSelector('#pmGate .pm-modal', { timeout: 4000 }); await page.waitForTimeout(300); }, from: 'ticket-market', optional: true },
  { id: 'rail-depth', lot: 'ticket', enter: pop(trade, '#isw [data-i="iDom"]'), scope: '.rail', from: 'ticket-market', optional: true },
  { id: 'rail-stats', lot: 'ticket', enter: pop(trade, '#isw [data-i="iStats"]'), scope: '.rail', from: 'ticket-market', optional: true },

  { id: 'dock-positions', lot: 'dock', enter: async page => { await seed(page); await tab('trade', 'positions')(page); }, scope: '.dock' },
  { id: 'dock-orders', lot: 'dock', enter: async page => { await seed(page); await tab('trade', 'orders')(page); }, scope: '.dock', from: 'dock-positions' },
  { id: 'dock-history', lot: 'dock', enter: async page => { await seed(page); await page.evaluate(() => closePosition(S.positions[1].id)); await tab('trade', 'history')(page); }, scope: '.dock', from: 'dock-positions' },
  // popups appended to <body>, outside the .dock scope: the stop-loss window of a position (app.js exitPop) and the splitter + / - / Reset popup (ui.js)
  { id: 'pop-exit-sl', lot: 'dock', optional: true, enter: async page => { await seed(page); await tab('trade', 'positions')(page); await page.evaluate(() => exitPop(S.positions[0], 'sl', document.querySelector('#posBody td'))); await page.waitForSelector('.xp-pop', { timeout: 4000 }); await page.waitForTimeout(300); }, scope: '.xp-pop' },
  { id: 'pop-splitter', lot: 'shell', optional: true, enter: async page => { await trade(page); const b = await page.evaluate(() => { const h = [...document.querySelectorAll('[data-k="rail"],[data-k="dock"],[data-k="wl"]')].find(e => !e.hidden && e.getBoundingClientRect().width > 2 && e.getBoundingClientRect().height > 2); if (!h) return null; const r = h.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; }); if (!b) throw new Error('no visible splitter handle'); await page.mouse.click(b.x, b.y); await page.waitForSelector('.split-pop', { timeout: 4000 }); await page.waitForTimeout(300); }, scope: '.split-pop' },
  { id: 'dock-alerts', lot: 'dock', enter: async page => { await seed(page); await tab('trade', 'alerts')(page); }, scope: '.dock', from: 'dock-positions' },
  { id: 'dock-journal', lot: 'dock', enter: async page => { await seed(page); await page.evaluate(() => closePosition(S.positions[1].id)); await tab('trade', 'journal')(page); }, scope: '.dock', from: 'dock-positions' },

  { id: 'monitor', lot: 'monitor', enter: view('monitor'), scope: '#monitor' },
  // the Sort popup is appended to <body> by shell.js, outside #monitor: it has its own state
  { id: 'monitor-sort', lot: 'monitor', enter: async page => { await view('monitor')(page); await click(page, '.mon-sortbtn'); await page.waitForSelector('.mon-sortpop:not([hidden])', { timeout: 4000 }); await page.waitForTimeout(300); }, scope: '.mon-sortpop' },

  { id: 'research-brief', lot: 'research', enter: tab('research', 'brief'), scope: '.dock' },
  { id: 'research-correlation', lot: 'research', enter: tab('research', 'corr'), scope: '.dock', from: 'research-brief' },
  { id: 'research-volatility', lot: 'research', enter: tab('research', 'vol'), scope: '.dock', from: 'research-brief' },
  { id: 'research-calendar', lot: 'research', enter: tab('research', 'calendar'), scope: '.dock', from: 'research-brief' },
  ...Array.from({ length: 12 }, (_, i) => ({ id: 'observatory-' + (i + 1), lot: 'observatory', enter: async page => { await tab('research', 'obs')(page); await page.locator('.obs-nav button').nth(i).click({ timeout: 4000 }); await page.waitForTimeout(900); }, scope: '.dock', nameFrom: '.obs-nav button.on' })),

  { id: 'lab-backtester', lot: 'lab', enter: tab('lab', 'bt'), scope: '.dock' },
  { id: 'lab-backtester-results', lot: 'lab', enter: btResults(), scope: '#btOut' },
  ...[1, 2, 3].map(i => ({ id: 'lab-backtester-view-' + (i + 1), lot: 'lab', enter: btResults(async page => { await page.locator('#btView button').nth(i).click({ timeout: 4000 }); await page.waitForTimeout(i === 1 ? 4000 : 1500); }), scope: '#btView2', nameFrom: '#btView button.on' })),
  { id: 'lab-risk', lot: 'lab', enter: tab('lab', 'lab'), scope: '.dock' },
  { id: 'lab-calculators', lot: 'lab', enter: tab('lab', 'calc'), scope: '.dock' },

  { id: 'coach-behaviour', lot: 'coach', enter: tab('coach', 'behav'), scope: '.dock' },
  ...[1, 2].map(i => ({ id: 'coach-behaviour-page-' + (i + 1), lot: 'coach', enter: async page => { await tab('coach', 'behav')(page); await page.locator('.bh-pgs button').nth(i).click({ timeout: 4000 }); await page.waitForTimeout(500); }, scope: '.dock', from: 'coach-behaviour', nameFrom: '.bh-pgs button.on' })),
  { id: 'coach-challenge', lot: 'coach', enter: tab('coach', 'chal'), scope: '.dock' },
  { id: 'coach-journal', lot: 'coach', enter: tab('coach', 'journal'), scope: '.dock' },
  { id: 'dlg-coach-details', lot: 'coach', enter: async page => { await seed(page); await page.evaluate(() => { for (const p of S.positions.slice()) closePosition(p.id); }); await tab('coach', 'journal')(page); await click(page, '.coach-more'); await page.waitForTimeout(500); }, from: 'coach-journal', optional: true },

  // zones the census did not reach
  adminState('admin-users'),
  adminState('admin-pricedata', async page => { const b = page.locator('#adminDlg [data-a="tab"], #adminDlg .adm-tabs button').filter({ hasText: /price/i }).first(); if (await b.count()) { await b.click({ timeout: 3000 }); await page.waitForSelector('#adminDlg .adm-pd section', { timeout: 6000 }); } else throw new Error('no Price data tab in Administration'); }),
  { id: 'preferences', lot: 'misc', enter: helpOpen, scope: '#help .help-set' },
  { id: 'teach-me', lot: 'misc', optional: true, enter: async page => { await trade(page); await click(page, '#userBtn'); await page.locator('#userPop [data-teach]').click({ timeout: 4000 }); await page.waitForSelector('.tour-card', { timeout: 6000 }); await page.waitForTimeout(500); }, scope: '.tour-card, .tour-ring, .tour-veil' },
  { id: 'opening-note', lot: 'misc', webdriver: false, keepNote: true, optional: true, enter: async page => { await page.waitForSelector('#onote', { timeout: 8000 }); await page.waitForTimeout(600); }, scope: '#onote' }
];
const LOTS = [...new Set(STATES.map(s => s.lot))];
if (argv.includes('--list')) { for (const l of LOTS) console.log(l.padEnd(12), STATES.filter(s => s.lot === l).map(s => s.id).join(', ')); process.exit(0); }
const lot = arg('--lot'); if (lot && !LOTS.includes(lot)) { console.error(`Unknown lot "${lot}". Lots: ${LOTS.join(', ')}`); process.exit(2); }
for (const w of want) if (!STATES.some(s => s.id === w)) { console.error(`Unknown state "${w}". Run --list.`); process.exit(2); }

// ---- in the page ----
const KEYFN = () => { // the key of an element, as the census builds it
  window.__hxKey = el => { const parts = []; let e = el; while (e && e.nodeType === 1 && parts.length < 6) { if (e.id && !/\d{3,}/.test(e.id)) { parts.unshift('#' + e.id); break; } let s = e.tagName.toLowerCase(); const c = [...e.classList].filter(x => !/^(on|open|active|sel|cur|up|dn|hover|focus|tk-up|tk-dn)$/.test(x)).slice(0, 2).join('.'); if (c) s += '.' + c; if (e === el) for (const a of ['data-view', 'data-tab', 'data-act', 'data-i', 'data-k', 'data-u', 'data-tf', 'data-ot', 'data-f', 'data-step', 'name', 'type']) if (e.getAttribute(a)) s += `[${a}=${e.getAttribute(a)}]`; parts.unshift(s); e = e.parentElement; } return parts.join('>'); };
};
// what the engine treats as a control (hints-engine.js CTL) plus the other interactive roles: these need a card of their own; a [tabindex] container or an [onclick] block is read by its text, like any other element
const SEL = 'button,input:not([type=hidden]),select,textarea,a[href],summary,[role=button],[role=tab],[role=switch],[role=checkbox],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=radio],[role=slider],[role=combobox],[contenteditable=true]';
const ELEMENTS = ({ SEL, scope, OFF }) => {
  const vis = e => { const r = e.getBoundingClientRect(), cs = getComputedStyle(e); return r.width >= 2 && r.height >= 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0; };
  const within = scope ? [...document.querySelectorAll(scope)] : null;
  const EXCL = '#brTip,#hintDlg,#toasts,script,style,noscript,template,option,optgroup';
  const out = [], seen = new Set(), cache = new Map();
  const plain = h => { const t = document.createElement('textarea'); t.innerHTML = h.replace(/<[^>]+>/g, ' '); return t.value.replace(/\s+/g, ' ').trim().slice(0, 1500); }; // the card as text: tags out, entities decoded
  const cardOf = anc => { if (!cache.has(anc)) { let h = null; try { const k = anc.dataset.rich !== undefined ? anc.dataset.rich : anc.dataset.richTip; h = hintRich(k, anc); } catch (e) { h = null; } cache.set(anc, h ? { title: (h.match(/<header class="rt-h"><b>([^<]*)<\/b>/) || [, ''])[1], generic: h.includes(HX.GEN), text: plain(h), html: h } : { title: '', generic: true, text: '', html: '' }); } return cache.get(anc); };
  const label = e => ((e.getAttribute('aria-label') || '') || (e.innerText || e.textContent || '') || e.getAttribute('title') || e.getAttribute('placeholder') || e.id || '').trim().replace(/\s+/g, ' ').slice(0, 60);
  const push = (el, kind) => {
    if (seen.has(el)) return; seen.add(el);
    const r = el.getBoundingClientRect(), off = !!el.closest('[data-hx-off]'), own = el.hasAttribute('data-rich') || el.hasAttribute('data-rich-tip'), anc = own ? el : kind === 'control' ? null : el.closest('[data-rich],[data-rich-tip]');
    let state = 'miss', c = null, optSel = null; if (off) { state = 'optout'; optSel = OFF.find(q => { try { return !!el.closest(q); } catch { return false; } }) || '[data-hx-off]'; } else if (anc) { c = cardOf(anc); state = c.generic ? 'generic' : 'card'; }
    out.push({ key: window.__hxKey(el), kind, tag: el.tagName.toLowerCase(), label: label(el), w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top), state, optSel, own, via: anc && anc !== el ? window.__hxKey(anc) : null, hover: !!(anc && anc.hasAttribute('data-rich-tip')), title: c ? c.title : null, card: c && state !== 'miss' ? c.text : null, cid: c ? [...cache.keys()].indexOf(anc) : -1 });
  };
  for (const el of document.querySelectorAll(SEL)) { if (el.closest(EXCL) || !vis(el)) continue; if (within && !within.some(w => w.contains(el))) continue; const shut = el.closest('details:not([open])'); if (shut && !(el.tagName === 'SUMMARY' && el.parentElement === shut)) continue; push(el, 'control'); }
  for (const el of document.body.querySelectorAll('*')) {
    if (seen.has(el) || el.closest(EXCL) || el.closest('svg') && el.tagName.toLowerCase() !== 'svg' || !vis(el)) continue;
    if (within && !within.some(w => w.contains(el))) continue; const shut = el.closest('details:not([open])'); if (shut && !(el.tagName === 'SUMMARY' && el.parentElement === shut)) continue;
    const t = el.tagName.toLowerCase(); if (el.closest(SEL)) continue; // inside a control: the control owns it
    if (t === 'canvas') { push(el, 'canvas'); continue; }
    if (t === 'svg') { if (!el.parentElement.closest('svg') && el.getBoundingClientRect().width >= 24 && el.getBoundingClientRect().height >= 24 && !el.closest(SEL)) push(el, 'svg'); continue; }
    if (t === 'img') { push(el, 'svg'); continue; }
    if ([...el.childNodes].some(n => n.nodeType === 3 && /[\p{L}\p{N}]/u.test(n.textContent))) { push(el, 'text'); continue; }
    if ((el.hasAttribute('data-tip') || el.hasAttribute('title')) && !el.querySelector('*')) push(el, 'tip');
  }
  return out;
};

// ---- run ----
const server = http.createServer(async (req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (p.startsWith('..')) return res.writeHead(403).end();
  try { const body = await readFile(join(SERVE, p || 'index.html')); res.writeHead(200, { 'content-type': TYPES[extname(p || 'index.html')] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
async function boot(st) {
  const ctx = await browser.newContext({ serviceWorkers: 'block', viewport: { width: st.width || WIDTH, height: HEIGHTS[st.width || WIDTH] || 900 } });
  await ctx.route(u => !u.href.startsWith(BASE), r => r.abort());
  if (st.mock === 'admin') await ctx.addCookies([{ name: 'tb_u', value: '1', url: BASE }]); // cloud.js only talks to the account server when the server says so
  if (st.mock === 'admin') await ctx.route(u => u.pathname.startsWith('/api/'), r => { const u = new URL(r.request().url()), j = u.pathname === '/api/me' ? ADMIN_MOCK.me : u.pathname === '/api/state' ? ADMIN_MOCK.state : u.pathname === '/api/admin' ? ADMIN_MOCK.admin : u.pathname === '/api/pricedata' ? ADMIN_MOCK.pricedata : null; return j ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(j) }) : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }); });
  const page = await ctx.newPage(); page.problems = [];
  page.on('pageerror', e => page.problems.push('error: ' + String(e).slice(0, 200)));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  if (st.webdriver === false) await page.addInitScript(() => { Object.defineProperty(navigator, 'webdriver', { get: () => false }); });
  await page.clock.install({ time: CLOCK });
  await page.goto(BASE + '/');
  await page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
  await page.addStyleTag({ content: '.tour-chip{display:none!important}' });
  await page.evaluate(keep => { Engine.speed = 0; if (!keep) document.getElementById('onote')?.remove(); }, !!st.keepNote);
  await page.waitForFunction(() => typeof HX === 'object' && typeof HX.stampNow === 'function', null, { timeout: 15000 });
  return page;
}
const visibleKeys = {};
async function enterState(st) {
  const page = await boot(st);
  try { await st.enter(page); await page.evaluate(KEYFN); await page.evaluate(() => { HX.stampNow(); }); await page.waitForTimeout(450); await page.evaluate(() => { HX.stampNow(); }); // twice: panes that finish building after the first pass
    const all = await page.evaluate(ELEMENTS, { SEL, scope: null, OFF }); visibleKeys[st.id] = new Set(all.map(c => c.key + '|' + c.label));
    return { page, all };
  } catch (e) { await page.context().close(); throw e; }
}
const sig = s => s.replace(/[-+]?\d+(?:[.,]\d+)?/g, '#');
await mkdir(OUT, { recursive: true });
const OFF = JSON.parse(await readFile(new URL('../hints-optouts.json', import.meta.url), 'utf8')).optouts.map(o => o.selector); // the selector that opts an element out is stored with it (optSel)
const wanted = STATES.filter(s => want.length ? want.includes(s.id) : lot ? s.lot === lot : true);
const rows = []; let bad = 0;
for (const st of wanted) {
  const t0 = Date.now(); let rec;
  try {
    if (st.from && !visibleKeys[st.from]) { const base = STATES.find(s => s.id === st.from); const r = await enterState(base); await r.page.context().close(); }
    const { page, all } = await enterState(st);
    const name = st.nameFrom ? await page.evaluate(s => document.querySelector(s)?.innerText.trim().split('\n')[0] || '', st.nameFrom) : '';
    const fresh = st.from ? new Set([...visibleKeys[st.from]]) : null;
    let els = await page.evaluate(ELEMENTS, { SEL, scope: st.scope || null, OFF });
    if (fresh) els = els.filter(e => !fresh.has(e.key + '|' + e.label));
    const reg = await page.evaluate(() => HX._reg());
    // cards that read the same on different elements: the text of a card (with its figures) is the same, the elements are not
    const byText = new Map(); for (const e of els) if (e.card && e.state !== 'optout' && e.cid >= 0) { const k = e.title + '|' + e.card; if (!byText.has(k)) byText.set(k, new Set()); byText.get(k).add(e.label + '@' + e.key); }
    const dupes = [...byText.entries()].filter(([, v]) => v.size > 1).map(([k, v]) => ({ card: k.slice(0, 400), elements: [...v].slice(0, 6), n: v.size }));
    const count = s => els.filter(e => e.state === s).length, by = (k, s) => els.filter(e => e.kind === k && e.state === s).length;
    rec = { state: st.id, lot: st.lot, name, width: WIDTH, source: argv.includes('--dist') ? 'dist' : 'source', registry: reg, problems: page.problems.slice(), counts: { elements: els.length, card: count('card'), generic: count('generic'), optout: count('optout'), miss: count('miss') }, byKind: Object.fromEntries(['control', 'text', 'canvas', 'svg', 'tip'].map(k => [k, { n: els.filter(e => e.kind === k).length, miss: by(k, 'miss'), generic: by(k, 'generic') }])), identicalCards: dupes, misses: els.filter(e => e.state === 'miss' || e.state === 'generic').map(e => ({ kind: e.kind, state: e.state, key: e.key, label: e.label, title: e.title })), elements: els.map(({ cid, ...e }) => e) };
    await page.context().close();
    await writeFile(join(OUT, `audit-${st.id}.json`), JSON.stringify(rec, null, 1));
  } catch (e) {
    const why = String(e).split('\n')[0].replace(/\x1b\[\d+m/g, '').slice(0, 200);
    rec = { state: st.id, lot: st.lot, unreachable: why, optional: !!st.optional, counts: { elements: 0, card: 0, generic: 0, optout: 0, miss: 0 } };
    await writeFile(join(OUT, `audit-${st.id}.json`), JSON.stringify(rec, null, 1));
  }
  rows.push(rec);
  const c = rec.counts; if (rec.unreachable) { if (want.includes(st.id) || !st.optional) bad++; } else if (c.miss || c.generic) bad++;
  console.log(`${st.id.padEnd(26)} ${rec.unreachable ? 'UNREACHABLE: ' + rec.unreachable : `${String(c.elements).padStart(5)} elements · card ${String(c.card).padStart(5)} · generic ${String(c.generic).padStart(4)} · opt-out ${String(c.optout).padStart(3)} · MISS ${String(c.miss).padStart(5)}${rec.identicalCards.length ? ` · identical cards on different elements: ${rec.identicalCards.length}` : ''}${rec.problems.length ? ` · ${rec.problems.length} page error(s)` : ''}`}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
await browser.close(); server.close();
const T = rows.filter(r => !r.unreachable).reduce((a, r) => ({ elements: a.elements + r.counts.elements, card: a.card + r.counts.card, generic: a.generic + r.counts.generic, optout: a.optout + r.counts.optout, miss: a.miss + r.counts.miss }), { elements: 0, card: 0, generic: 0, optout: 0, miss: 0 });
console.log(`\n${rows.length} state(s) · ${T.elements} elements · card ${T.card} · generic ${T.generic} · opt-out ${T.optout} · MISS ${T.miss}${rows.some(r => r.unreachable) ? ` · unreachable: ${rows.filter(r => r.unreachable).map(r => r.state).join(', ')}` : ''}\nfiles: ${OUT}/audit-<state>.json`);
process.exit(bad ? 1 : 0);
