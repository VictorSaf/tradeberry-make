// User flows moved from the old 5-teste suite (t19–t22, t25), now with explicit assertions: phone gestures
// (long-press order, view swipes, haptics), keyboard navigation (skip links, dock tabs, command dialog focus trap),
// workspace layouts (presets, splitter drag and keys, saved layouts, mirror, focus), the guided tour on desktop and
// phone, and an account import that carries markup in free text.

const THU_1400 = new Date('2026-10-22T14:00:00Z'); // FX open, outside the night spread window
const lazyReady = page => page.waitForFunction(() => document.documentElement.dataset.lazy === 'ready', null, { timeout: 30000 });

// a phone page (390×844, touch) in its own context, same origin and the same external-request block as the runner's
async function phone(open) {
  const p0 = await open('/manifest.webmanifest'), base = new URL(p0.url()).origin;
  const ctx = await p0.context().browser().newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.route(u => !u.href.startsWith(base), r => r.abort());
  const page = await ctx.newPage(); page.errors = [];
  page.on('pageerror', e => page.errors.push(String(e)));
  page.on('dialog', d => { page.errors.push('dialog: ' + d.message()); d.dismiss().catch(() => {}); });
  await page.clock.install({ time: THU_1400 });
  await page.addInitScript(() => { window.__vib = []; navigator.vibrate = x => { window.__vib.push(x); return true; }; });
  await page.goto(base + '/');
  await page.waitForFunction(() => document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
  await lazyReady(page);
  return { page, ctx };
}

export const tests = [
  {
    name: 'FL1 phone: a long-press on the chart offers orders at that price and places one; swipes move between views; a fill vibrates',
    async run({ t, open }) {
      const { page, ctx } = await phone(open);
      try {
        await page.evaluate(() => { pmCfg().on = false; tiltCfg().on = false; mnavGo('chart'); });
        await page.waitForTimeout(400);
        const cdp = await ctx.newCDPSession(page), touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts });
        const box = await page.locator('#chart').boundingBox(), x = box.x + box.width * .4, y = box.y + box.height * .85;
        await touch('touchStart', [{ x, y }]); await page.waitForTimeout(650); await touch('touchEnd', []); await page.waitForTimeout(200);
        const btns = await page.$$eval('.lp-pop button', bs => bs.map(b => b.textContent.trim()));
        t.ok(btns.length >= 3, `long-press menu opens with its choices (got ${JSON.stringify(btns)})`);
        t.ok(btns.some(b => /limit|stop/i.test(b)) && btns.some(b => /alert/i.test(b)), 'the menu offers an order and an alert at the pressed price');
        const n0 = await page.evaluate(() => S.orders.length);
        await page.tap('.lp-pop .lp-b[data-sd] >> nth=0'); await page.waitForTimeout(300);
        t.eq(await page.evaluate(() => S.orders.length), n0 + 1, 'the first choice places one pending order');
        const sw = async (x0, x1, yy) => { await touch('touchStart', [{ x: x0, y: yy }]); for (let i = 1; i <= 6; i++) { await touch('touchMove', [{ x: x0 + (x1 - x0) * i / 6, y: yy }]); await page.waitForTimeout(16); } await touch('touchEnd', []); await page.waitForTimeout(350); };
        const mv = () => page.evaluate(() => document.body.dataset.mv);
        await sw(330, 120, 60); t.eq(await mv(), 'trade', 'swipe left on the header: chart → trade');
        const tb = await page.locator('.ticket .ph').boundingBox();
        await sw(330, 100, tb.y + 10); t.eq(await mv(), 'markets', 'swipe left again: trade → markets');
        await sw(80, 320, 200); t.eq(await mv(), 'trade', 'swipe right: back to trade');
        const vib = await page.evaluate(() => { window.__vib = []; openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, pmDone: true }); return window.__vib.length; });
        t.ok(vib > 0, 'a fill gives haptic feedback');
        t.ok(await page.evaluate(async () => (await fetch('manifest.webmanifest')).ok && !!document.getElementById('installBtn')), 'manifest served, install button present');
        t.noErrors(page);
      } finally { await ctx.close(); }
    }
  },
  {
    name: 'FL2 keyboard: skip links first, dock tabs move with arrows/Home/End, Ctrl+K traps focus and Escape gives it back',
    async run({ t, app }) {
      const page = await app();
      await page.setViewportSize({ width: 1512, height: 945 }); await lazyReady(page); await page.waitForTimeout(300);
      const ae = () => page.evaluate(() => { const a = document.activeElement; return { id: a.id, text: (a.textContent || '').trim() }; });
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Tab'); t.ok(/skip to chart/i.test((await ae()).text), 'first Tab lands on "Skip to chart"');
      await page.keyboard.press('Tab'); await page.keyboard.press('Enter'); t.ok(['tkLots', 'tkBuyBtn'].includes((await ae()).id), 'the second skip link jumps into a visible ticket control: ' + (await ae()).id);
      await page.focus('#tab-positions'); await page.keyboard.press('ArrowRight');
      t.eq(await page.evaluate(() => [document.activeElement.id, activeTab].join()), 'tab-orders,orders', 'ArrowRight moves focus and the tab together');
      await page.keyboard.press('End'); const end = await page.evaluate(() => activeTab);
      await page.keyboard.press('Home'); t.eq(await page.evaluate(() => activeTab), 'positions', 'Home goes to the first tab');
      t.ok(end !== 'positions' && end !== 'orders', `End goes to the last tab (got ${end})`);
      await page.focus('#tkLots'); t.eq((await ae()).id, 'tkLots', 'a visible ticket control takes focus before Ctrl+K');
      await page.keyboard.press('Control+k'); await page.waitForTimeout(250);
      t.eq((await ae()).id, 'cmdInput', 'Ctrl+K opens the command dialog with focus in it');
      for (let i = 0; i < 25; i++) await page.keyboard.press('Tab');
      t.ok(await page.evaluate(() => document.getElementById('cmd').contains(document.activeElement)), 'Tab stays inside the dialog');
      await page.keyboard.press('Escape'); await page.waitForTimeout(250);
      t.eq((await ae()).id, 'tkLots', 'Escape returns focus where it was');
      t.ok(/candlestick chart/.test(await page.evaluate(() => document.getElementById('chart').getAttribute('aria-label'))), 'the chart has a descriptive label');
      t.noErrors(page);
    }
  },
  {
    name: 'FL3 layouts: presets resize the panels, the dock splitter drags and the watchlist splitter takes keys, a named layout saves and restores, mirror swaps sides, focus hides the side panels',
    async run({ t, app }) {
      const page = await app();
      await page.setViewportSize({ width: 1512, height: 945 }); await lazyReady(page); await page.waitForTimeout(300);
      const W = () => page.evaluate(() => { const r = s => document.querySelector(s).getBoundingClientRect(); return { wl: Math.round(r('.watch').width), rail: Math.round(r('.rail').width), dock: Math.round(r('.dock').height), cfg: wsState().cur.dock }; });
      const std = await W();
      t.ok(std.dock < std.cfg - 60, `an empty Positions tab folds the dock below the layout's height (${std.dock} < ${std.cfg})`);
      await page.evaluate(v => { const l = document.getElementById('layoutSel'); l.value = v; l.dispatchEvent(new Event('change', { bubbles: true })); }, 'p:scalping'); await page.waitForTimeout(300);
      const scalp0 = await W(); t.ok(scalp0.rail > std.rail && scalp0.cfg < std.cfg, `Scalping: wider rail, lower dock (${JSON.stringify([std, scalp0])})`);
      // the empty dock is folded to its tab strip and a folded dock has no splitter: Show panel opens it at the layout's height
      t.ok(await page.isHidden('.ws-split[data-k=dock]'), 'the folded empty dock has no splitter');
      await page.click('#dockMin'); await page.waitForTimeout(250);
      const scalp = await W(); t.ok(Math.abs(scalp.dock - scalp.cfg) <= 2 && await page.isVisible('.ws-split[data-k=dock]'), `Show panel opens the dock at Scalping's height, with its splitter (${scalp.dock} ~ ${scalp.cfg})`);
      const h = await page.locator('.ws-split[data-k=dock]').boundingBox();
      await page.mouse.move(h.x + 300, h.y + 4); await page.mouse.down(); await page.mouse.move(h.x + 300, h.y - 96, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(200);
      const drag = await W(); t.ok(drag.dock > scalp.dock + 60, `dragging the dock splitter up makes the dock taller (${scalp.dock} → ${drag.dock})`);
      t.eq(await page.inputValue('#layoutSel'), '', 'a dragged layout is no longer the preset');
      await page.focus('.ws-split[data-k=wl]'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
      const kbd = await W(); t.ok(kbd.wl > drag.wl, `ArrowRight on the watchlist splitter widens it (${drag.wl} → ${kbd.wl})`);
      await page.evaluate(v => { const l = document.getElementById('layoutSel'); l.value = v; l.dispatchEvent(new Event('change', { bubbles: true })); }, 'save'); await page.waitForTimeout(200);
      t.eq(await page.evaluate(() => document.activeElement.id), 'wsName', 'Save layout asks for a name');
      await page.fill('#wsName', 'London open'); await page.keyboard.press('Enter'); await page.waitForTimeout(200);
      t.ok((await page.evaluate(() => wsState().layouts.map(l => l.name))).includes('London open'), 'the named layout is saved');
      await page.evaluate(v => { const l = document.getElementById('layoutSel'); l.value = v; l.dispatchEvent(new Event('change', { bubbles: true })); }, 'p:mirror'); await page.waitForTimeout(300);
      t.ok(await page.evaluate(() => document.querySelector('.rail').getBoundingClientRect().left < document.querySelector('.watch').getBoundingClientRect().left), 'Mirrored puts the rail on the left of the watchlist');
      await page.evaluate(v => { const l = document.getElementById('layoutSel'); l.value = v; l.dispatchEvent(new Event('change', { bubbles: true })); }, 'p:focus'); await page.waitForTimeout(300);
      const foc = await W(); t.ok(foc.wl === 0 && foc.rail === 0, `Chart focus hides watchlist and rail (${JSON.stringify(foc)})`);
      const opt = await page.$$eval('#layoutSel option', o => o.find(x => x.textContent === 'London open')?.value);
      await page.evaluate(v => { const l = document.getElementById('layoutSel'); l.value = v; l.dispatchEvent(new Event('change', { bubbles: true })); }, opt); await page.waitForTimeout(300);
      const back = await W(); delete back.dock; const want = { ...kbd }; delete want.dock;
      t.deep(back, want, 'the saved layout comes back exactly (the dock by its configured height: an empty Positions tab folds it)');
      t.noErrors(page);
    }
  },
  {
    name: 'FL4 guided tour: offered on first visit, steps through to the end on desktop and on the phone (each step on its view), and is not offered again',
    async run({ t, app, open }) {
      const page = await app();
      await page.setViewportSize({ width: 1512, height: 945 }); await lazyReady(page);
      const walk = async p => {
        await p.waitForSelector('.tour-chip', { timeout: 8000 });
        await p.click('.tour-go'); await p.waitForTimeout(500);
        const total = +(await p.evaluate(() => document.querySelector('.tour-n').textContent)).split('/')[1];
        const seen = [];
        for (let i = 0; i < total + 2; i++) {
          const s = await p.evaluate(() => document.querySelector('.tour-card') && [document.querySelector('.tour-t').textContent, document.body.dataset.mv || ''].join('@'));
          if (!s) break; seen.push(s); await p.keyboard.press('Enter'); await p.waitForTimeout(450);
        }
        return { total, seen, ended: await p.evaluate(() => !document.querySelector('.tour-card') && !!S.set.tourSeen) };
      };
      const d = await walk(page);
      t.ok(d.total >= 5, `desktop tour has its steps (${d.total})`);
      t.eq(d.seen.length, d.total, `every desktop step is shown once (${d.seen.join(' | ')})`);
      t.ok(d.ended, 'the desktop tour ends and is remembered');
      await page.reload(); await page.waitForFunction(() => typeof S === 'object' && S); await page.waitForTimeout(1500);
      t.ok(!(await page.$('.tour-chip')), 'the tour is not offered again after a reload');
      t.noErrors(page);
      const { page: m, ctx } = await phone(open);
      try {
        const r = await walk(m);
        t.eq(r.seen.length, r.total, `every phone step is shown once (${r.seen.join(' | ')})`);
        t.ok(new Set(r.seen.map(s => s.split('@')[1])).size >= 3, 'the phone tour moves through the views');
        t.ok(r.ended, 'the phone tour ends and is remembered');
        t.noErrors(m);
      } finally { await ctx.close(); }
    }
  },
  {
    name: 'FL5 account import: markup in free text and names renders as text (no script runs), a clean import restores the account',
    async run({ t, app }) {
      const page = await app('', { clock: THU_1400 });
      const r = await page.evaluate(async () => {
        window.__pwn = 0; S.set.slip = 'off';
        openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, pmDone: true }); closePosition(S.positions[0].id);
        openPosition({ sym: 'GBPUSD', side: 'sell', lots: .2, pmDone: true });
        const good = JSON.parse(JSON.stringify(S)), evil = JSON.parse(JSON.stringify(S));
        evil.history.push({ ...evil.history[0], side: '<img src=x onerror="window.__pwn=1">' });
        evil.alerts = [{ id: 99, sym: 'EURUSD', price: 1.1, cond: '<img src=x onerror="window.__pwn=2">', done: false }];
        evil.history[0].sym = '<b>x</b>';
        evil.history.push({ ...good.history[0], id: 77, note: '<img src=x onerror="window.__pwn=3">', setup: '<svg onload="window.__pwn=4">' });
        const imp = o => new Promise(res => { importAccount(new File([JSON.stringify({ state: o })], 'a.json')); setTimeout(res, 600); });
        await imp(evil);
        for (const tab of ['history', 'alerts', 'journal', 'behav']) { try { setTab(tab); } catch (e) { } }
        await new Promise(r => setTimeout(r, 600));
        const evilRes = { pwn: window.__pwn, tags: document.querySelectorAll('img[onerror],svg[onload]').length, kept: S.history.some(h => h.id === 77 && /onerror/.test(h.note)) };
        await imp(good);
        return { evilRes, pos: S.positions.length, bal: S.balance === good.balance, hist: S.history.length === good.history.length };
      });
      t.eq(r.evilRes.pwn, 0, 'no injected handler ran');
      t.eq(r.evilRes.tags, 0, 'no injected element is in the page');
      t.ok(r.evilRes.kept, 'the note with markup is kept as text, not dropped');
      t.ok(r.pos === 1 && r.bal && r.hist, `the clean import restores positions, balance and history (${JSON.stringify(r)})`);
      t.noErrors(page);
    }
  },
  {
    // the bundles are what ships: a duplicated global or a load-order slip breaks only them (run `npm run build` first)
    name: 'FL6 built app (dist/): boots without page errors, loads the lazy tools, trades, and the Observatory and Lab draw',
    async run({ t, open }) {
      const page = await open('/dist/index.html', { clock: THU_1400 }); // FX open: the trade must fill
      t.ok(!(await page.evaluate(() => document.title === '' && !document.body.childElementCount)), 'dist/index.html exists (run npm run build)');
      t.ok(await page.evaluate(() => /MFX_BUILD/.test(document.documentElement.innerHTML)), 'the page is the hashed build');
      await page.waitForFunction(() => typeof S === 'object' && S && typeof Engine === 'object', null, { timeout: 30000 });
      await page.evaluate(() => loadLazy()); await lazyReady(page);
      const r = await page.evaluate(async () => {
        Engine.speed = 0; pmCfg().on = false; tiltCfg().on = false; S.set.slip = 'off';
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: .1, pmDone: true });
        const out = { pos: !!p };
        for (const v of ['const', 'bask', 'exit']) { obsCfg().view = v; setTab('obs'); renderObs(); await new Promise(r => setTimeout(r, 300)); out[v] = document.getElementById('obsBody').textContent.length; }
        return out;
      });
      t.ok(r.pos, 'a position opens in the built app');
      t.ok(r.const > 50 && r.bask > 50 && r.exit > 50, `Observatory and Lab views draw (${JSON.stringify(r)})`);
      t.noErrors(page);
    }
  }
];
