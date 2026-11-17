// The status bar tells the truth about the account (UX test 09.11.2026, F1 and F2): on a signed-in page the account is on
// the execution server, so the account flag says DEMO (real executions, no money), never "example trades", and the
// storage pill speaks of preferences only, never "Export is the only guarantee"; on live prices the Speed control is
// hidden (real time only). A page without the server keeps the local texts and the control.
const read = page => page.evaluate(() => {
  const f = document.getElementById('demoPill'), p = document.getElementById('persistPill'), sp = document.getElementById('speedSel');
  const lb = sp && (sp.closest('label') || sp);
  // the element's own display (styles.css hides the whole status bar since the /front change of the header dot, so
  // offsetParent would say nothing about these cells)
  const own = el => !!el && !el.hidden && getComputedStyle(el).display !== 'none';
  return {
    flag: { text: f.textContent, title: f.title, hidden: f.hidden, shown: own(f), cls: f.className },
    pill: { text: p.textContent, title: p.title || p.dataset.hxTitle || '' },
    note: document.getElementById('persistNote').textContent,
    speed: { hidden: !!lb && lb.hidden, shown: own(lb) },
    feedOn: typeof LiveFeed === 'object' && LiveFeed.on, live: typeof TradeLink === 'object' && TradeLink.live, type: TradeLink.type
  };
});

export const tests = [
  {
    name: 'UXS1 status bar on a signed-in page: DEMO on the execution server, preferences pill, no Speed on live prices',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => typeof LiveFeed === 'object' && LiveFeed.on, null, { timeout: 15000 });
      await page.waitForFunction(() => /account on the server/.test(document.getElementById('persistPill')?.textContent || ''), null, { timeout: 10000 });
      // the type comes with the server's first snapshot; the flag follows it within persist.js's 100 ms watch: the test
      // waits for that state (the type known and the flag written for it), not for a fixed delay (round 3: UXS1 flaked)
      await page.waitForFunction(() => (TradeLink.type === 'demo' || TradeLink.type === 'live') && acctKind().key === TradeLink.type, null, { timeout: 10000 });
      const synced = await page.waitForFunction(() => { const f = document.getElementById('demoPill'), k = acctKind(); return f.textContent === k.flag && f.title === k.title && f.hidden === !k.flag; }, null, { timeout: 3000 }).then(() => true, () => false);
      t.ok(synced, 'the flag is written for the known type within the watch (3 s at most)');
      const r = await read(page);
      t.ok(r.live, 'the page is signed in (TradeLink.live)');
      t.eq(r.flag.text, 'DEMO', 'the account flag says DEMO');
      t.ok(!/example trades/i.test(r.flag.title) && !/example trades/i.test(r.flag.text), 'the flag does not speak of example trades: ' + r.flag.title);
      t.ok(/execution server/.test(r.flag.title) && /no money/.test(r.flag.title), 'the flag says where the account is and that there is no money: ' + r.flag.title);
      t.ok(r.type === 'live' ? r.flag.hidden : (!r.flag.hidden && r.flag.shown), 'the flag is shown on a demo account (type ' + r.type + ')');
      t.ok(!/demo-flag/.test(r.flag.cls), 'the server flag is not the warning-coloured example-trades flag: ' + r.flag.cls);
      t.eq(r.pill.text, 'Preferences in this browser · account on the server', 'the storage pill speaks of preferences, the account is on the server');
      t.ok(!/Export is the only guarantee/.test(r.pill.title), 'the pill title does not call Export the only guarantee: ' + r.pill.title);
      t.ok(!/Export is the only guarantee/.test(r.note), 'Help › Where your account is kept says the same: ' + r.note);
      t.ok(/execution server/.test(r.pill.title), 'the pill title says the account is on the execution server');
      t.ok(r.feedOn, 'live prices are on');
      t.ok(r.speed.hidden && !r.speed.shown, 'the Speed control is hidden on live prices, not only disabled');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS2 status bar on a page without the server: no flag on own trades, example-trades flag with the demo history, Speed kept',
    async run({ t, app }) {
      const page = await app('', { demo: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => !!document.getElementById('persistPill')?.textContent, null, { timeout: 10000 });
      const a = await read(page);
      t.ok(!a.live, 'no execution server on this page');
      t.ok(a.flag.hidden && !a.flag.shown, 'no demo flag over the account\'s own trades');
      t.ok(!/account on the server/.test(a.pill.text), 'the storage pill keeps the browser wording: ' + a.pill.text);
      t.ok(/Export is the only guarantee/.test(a.pill.title), 'here the account is in the browser: Export stays the guarantee');
      t.ok(!a.feedOn && !a.speed.hidden && a.speed.shown, 'the Speed control stays on the local market');
      await page.evaluate(() => window.loadDemoHistory());
      await page.waitForFunction(() => !document.getElementById('demoPill').hidden, null, { timeout: 5000 });
      const b = await read(page);
      t.eq(b.flag.text, 'DEMO · example trades', 'the demo history is flagged as example trades');
      t.ok(b.flag.shown && /example trades/.test(b.flag.title), 'the example-trades flag is shown with its explanation');
      await page.evaluate(() => { S.demo = null; });
      await page.waitForFunction(() => document.getElementById('demoPill').hidden, null, { timeout: 5000 });
      t.ok(true, 'the flag goes away with the demo history');
      t.noErrors(page);
    }
  },
  // round 2 (09.11.2026): the account type is said from TradeLink.type everywhere (feed pill, Help, status-bar flag,
  // account menu), only once it is known, and the account menu says it on every width (the status bar is hidden
  // below 1081 px and on the phone)
  {
    name: 'UXS3 demo account: feed pill, Help, flag and the account menu say demo · no money; the menu row shows at every width',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => typeof LiveFeed === 'object' && LiveFeed.on && TradeLink.type === 'demo', null, { timeout: 15000 });
      await page.waitForFunction(() => /Demo account on the execution server/.test(document.getElementById('feedPill').title) && document.getElementById('userKind').dataset.kind === 'demo', null, { timeout: 5000 });
      const r = await kinds(page);
      t.ok(/no money/.test(r.pill), 'the feed pill says no money on a demo account: ' + r.pill);
      t.ok(/Demo account on the execution server/.test(r.label) && /no real money/.test(r.label), 'Help says the same: ' + r.label);
      t.eq(r.flag.text, 'DEMO', 'the status-bar flag says DEMO');
      t.ok(!r.flag.hidden, 'the flag is shown');
      t.eq(r.menu.text, DEMO_LINE, 'the account menu\'s first row names the account type');
      t.eq(r.menu.title, r.flag.title, 'the menu row explains it in the same words as the flag');
      for (const [w, h] of [[1440, 900], [1243, 800], [1086, 800], [900, 800], [390, 800]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(300);
        await page.click('#userBtn');
        const m = await page.evaluate(() => {
          const pop = document.getElementById('userPop'), k = document.getElementById('userKind'), b = k.getBoundingClientRect();
          const pr = pop.getBoundingClientRect(), ub = document.getElementById('userBtn').getBoundingClientRect();
          return { rect: [b.left, b.top, b.right, b.bottom].map(Math.round), pop: [pr.left, pr.top, pr.right, pr.bottom].map(Math.round), btn: [ub.left, ub.top, ub.right, ub.bottom].map(Math.round), mnav: document.body.classList.contains('mnav-on'), open: !pop.hidden, first: pop.firstElementChild === k, text: k.textContent, vis: b.width > 0 && b.height > 0 && b.top >= 0 && b.bottom <= innerHeight && b.left >= 0 && b.right <= innerWidth, item: k.matches('[role^=menuitem],button,a,[tabindex]') };
        });
        t.ok(m.open && m.first && m.vis, `${w} px: the account type row is the first row of the open menu, on screen: ${JSON.stringify(m)}`);
        t.eq(m.text, DEMO_LINE, `${w} px: the row's text`);
        t.ok(!m.item, `${w} px: the row is not a menu item (nothing to act on, not yellow)`);
        await page.keyboard.press('Escape');
      }
      t.noErrors(page);
    }
  },
  {
    name: 'UXS4 type not known yet: no DEMO, no money claims, then demo once the server answers (re-applied without a reload)',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      // the server unreachable from the start: TradeLink.type stays null
      page.tl.cut();
      await page.reload();
      await page.waitForFunction(() => typeof S === 'object' && S && document.getElementById('boot')?.classList.contains('done') && typeof LiveFeed === 'object' && LiveFeed.on, null, { timeout: 30000 });
      await page.waitForTimeout(1500);
      const a = await kinds(page);
      t.ok(a.live && a.type === null, 'signed in, type unknown: ' + a.type);
      t.ok(a.flag.hidden, 'the status-bar flag does not say DEMO before the type is known');
      t.ok(/its type \(demo or live\) shows once the server answers/.test(a.pill) && !/no money|real money|Demo account/.test(a.pill), 'the feed pill makes no type claim: ' + a.pill);
      t.ok(/demo or a live account shows once the server answers/.test(a.label) && !/no real money|with real money|Demo account/.test(a.label), 'Help makes no type claim: ' + a.label);
      t.eq(a.menu.kind, 'pending', 'the menu row is neutral');
      t.ok(!/no money|real money/.test(a.menu.text) && /execution server/.test(a.menu.text), 'the menu row says where the account is, not its type: ' + a.menu.text);
      page.tl.mend();
      await page.waitForFunction(() => TradeLink.type === 'demo', null, { timeout: 40000 });
      await page.waitForFunction(() => /Demo account on the execution server/.test(document.getElementById('feedPill').title) && /Demo account on the execution server/.test(document.getElementById('simLabel').textContent) && !document.getElementById('demoPill').hidden && document.getElementById('userKind').dataset.kind === 'demo', null, { timeout: 5000 });
      const b = await kinds(page);
      t.eq(b.flag.text, 'DEMO', 'DEMO once the server says demo');
      t.eq(b.menu.text, DEMO_LINE, 'the menu row too');
      t.ok(/no money/.test(b.pill) && /no real money/.test(b.label), 'the feed pill and Help re-said for the demo account');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS5 live account: no DEMO, no "no money" anywhere; feed pill, Help and the menu say live · real money',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => typeof LiveFeed === 'object' && LiveFeed.on && TradeLink.type === 'demo', null, { timeout: 15000 });
      // the next connection's messages are held and passed on as from a live account (info.type 'live')
      const ctl = page.tl;
      ctl.hold(); ctl.cut(); ctl.mend();
      const t0 = Date.now();
      while (!ctl.queue.some(([, m]) => /"ev":"snapshot"/.test(m)) && Date.now() - t0 < 30000) await page.waitForTimeout(200);
      t.ok(ctl.queue.some(([, m]) => /"ev":"snapshot"/.test(m)), 'a new snapshot arrived');
      const asLive = m => { try { const o = JSON.parse(m); if (o && o.info && typeof o.info === 'object') o.info.type = 'live'; return JSON.stringify(o); } catch (e) { return m; } };
      for (const [ws, m] of ctl.queue.splice(0)) ws.send(asLive(m));
      await page.waitForFunction(() => TradeLink.type === 'live', null, { timeout: 10000 });
      await page.waitForFunction(() => /Live account on the execution server/.test(document.getElementById('feedPill').title) && document.getElementById('userKind').dataset.kind === 'live', null, { timeout: 5000 });
      const r = await kinds(page);
      t.ok(r.flag.hidden, 'a live account is not flagged DEMO');
      t.ok(/real money/.test(r.pill) && !/no money|Demo account/.test(r.pill), 'the feed pill: ' + r.pill);
      t.ok(/Live account on the execution server/.test(r.label) && /with real money/.test(r.label) && !/no real money|Demo account/.test(r.label), 'Help: ' + r.label);
      t.eq(r.menu.text, 'Live account · on the execution server · real executions, real money', 'the menu row says live');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS6 Help › Where your account is kept on a signed-in page: the read-only and newer-version explanations are kept',
    async run({ t, app }) {
      // read-only: a second tab of the same browser
      const a = await app('', { live: true });
      const b = await a.context().newPage();
      const errs = []; b.on('pageerror', e => errs.push(String(e)));
      await b.goto(a.url());
      await b.waitForFunction(() => typeof store === 'object' && store.readOnly && store.readOnly() && /does not save your preferences/.test(document.getElementById('persistNote')?.textContent || ''), null, { timeout: 30000 });
      const n1 = await b.evaluate(() => document.getElementById('persistNote').textContent);
      t.ok(/execution server/.test(n1), 'the server wording is kept: ' + n1);
      t.ok(/open in another tab/.test(n1) && /Orders still go to the execution server/.test(n1), 'the read-only explanation is there: ' + n1);
      t.ok(!/Export is the only guarantee/.test(n1), 'no "only guarantee" on the server');
      t.eq(errs.length, 0, 'no page errors in the read-only tab: ' + errs.join(' | '));
      // refused: the copy in this browser is from a newer version (the same browser, both tabs closed first)
      const origin = new URL(a.url()).origin, d = await a.context().newPage();
      const errs2 = []; d.on('pageerror', e => errs2.push(String(e)));
      await b.close(); await a.close();
      await d.goto(origin + '/catalog.js');
      await d.waitForTimeout(500);
      await d.evaluate(() => new Promise((res, rej) => {
        const r = indexedDB.open('meridian-fx', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ schemaVersion: 99, rev: 7, savedAt: 1, state: { balance: 777 } }, 'state'); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
        r.onerror = () => rej(r.error);
      }));
      await d.goto(origin + '/');
      await d.waitForFunction(() => /newer version/.test(document.getElementById('persistNote')?.textContent || ''), null, { timeout: 30000 });
      const n2 = await d.evaluate(() => document.getElementById('persistNote').textContent);
      t.ok(/execution server/.test(n2) && /does not save your preferences/.test(n2), 'the newer-version explanation, in the server wording: ' + n2);
      t.eq(errs2.length, 0, 'no page errors: ' + errs2.join(' | '));
    }
  },
  // round 3 (09.11.2026): one signal for the account type (persist.js 'tb:acct-kind'), the flag's DOM never contradicts
  // itself, the tour and Teach me say the type when they show it, the account menu's type row is announced and stays on
  // screen (every width, under the read-only banner), and the browser account has the same words everywhere
  {
    name: 'UXS7 one signal: tb:acct-kind on every change, the flag and the menu row already re-said when it fires; hidden flag keeps no old text',
    async run({ t, app }) {
      const page = await app('', { demo: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.evaluate(() => {
        window.__kinds = [];
        document.addEventListener('tb:acct-kind', e => {
          const f = document.getElementById('demoPill'), k = document.getElementById('userKind'), d = e.detail;
          window.__kinds.push({ key: d && d.key, at: performance.now(), flag: f.textContent === d.flag && f.title === d.title && f.hidden === !d.flag, row: k.textContent === d.line && k.dataset.kind === d.key });
        });
      });
      const a = await page.evaluate(() => { const f = document.getElementById('demoPill'); return { key: acctKind().key, text: f.textContent, hidden: f.hidden, cls: f.className }; });
      t.eq(a.key, 'local', 'own trades in this browser: the local account');
      t.ok(a.hidden && a.text === '' && a.cls === 'pill', 'the hidden flag keeps no text of another type (index.html said "DEMO · example trades"): ' + JSON.stringify(a));
      const t0 = await page.evaluate(() => { window.loadDemoHistory(); return performance.now(); });
      await page.waitForFunction(() => window.__kinds.length >= 1, null, { timeout: 3000 });
      const b = await page.evaluate(() => ({ ev: window.__kinds.slice(), f: document.getElementById('demoPill').textContent }));
      t.eq(b.ev.length, 1, 'one event for one change: ' + JSON.stringify(b.ev));
      t.eq(b.ev[0].key, 'example', 'the event names the new type');
      t.ok(b.ev[0].flag && b.ev[0].row, 'when it fires, the flag and the account menu row already say the new type: ' + JSON.stringify(b.ev[0]));
      t.ok(b.ev[0].at - t0 < 600, 'the change is said within the 100 ms watch on a page whose type is not final (' + Math.round(b.ev[0].at - t0) + ' ms)');
      await page.waitForTimeout(1200);
      t.eq(await page.evaluate(() => window.__kinds.length), 1, 'no repeated event while nothing changes');
      await page.evaluate(() => { S.demo = null; });
      await page.waitForFunction(() => window.__kinds.length >= 2, null, { timeout: 3000 });
      const c = await page.evaluate(() => { const f = document.getElementById('demoPill'); return { ev: window.__kinds[1], text: f.textContent, title: f.title, hidden: f.hidden, cls: f.className, k: acctKind() }; });
      t.eq(c.ev.key, 'local', 'back to the local account');
      t.ok(c.ev.flag && c.ev.row, 'flag and row re-said together');
      t.ok(c.hidden && c.text === '' && c.title === c.k.title && c.cls === 'pill', 'hidden: text, title and class are those of the local account, not the example trades: ' + JSON.stringify(c));
      // no other module polls the type: livefeed.js and ui.js only listen
      const src = await page.evaluate(async () => Promise.all(['livefeed.js', 'ui.js'].map(f => fetch(f).then(r => r.text()))));
      t.ok(src.every(x => /addEventListener\('tb:acct-kind'/.test(x)), 'livefeed.js and ui.js listen to tb:acct-kind');
      t.ok(!/shownKind|kind\(\) !== /.test(src[0]), 'livefeed.js has no poll of its own on the type');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS8 signed in: the event carries the server type; feed pill, Help, flag and menu say it in persist.js\'s words',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => typeof LiveFeed === 'object' && LiveFeed.on && TradeLink.type === 'demo', null, { timeout: 15000 });
      const ok = await page.waitForFunction(() => { const k = acctKind(); return k.key === 'demo' && document.getElementById('feedPill').title.endsWith(k.pill) && document.getElementById('simLabel').textContent.endsWith(k.label) && document.getElementById('demoPill').textContent === k.flag && document.getElementById('userKind').textContent === k.line; }, null, { timeout: 3000 }).then(() => true, () => false);
      t.ok(ok, 'every place says the demo account in the words of persist.js');
      // a change of type reaches every listener through the one event (a live account, as the server would say it)
      const r = await page.evaluate(() => {
        const k = { key: 'live', ...{ flag: '', line: 'L-line', title: 'L-title', pill: 'L-pill', label: 'L-label', tour: 'L-tour' } }, real = window.acctKind;
        window.acctKind = () => k;
        document.dispatchEvent(new CustomEvent('tb:acct-kind', { detail: k }));
        const out = { pill: document.getElementById('feedPill').title || document.getElementById('feedPill').dataset.hxTitle || '', label: document.getElementById('simLabel').textContent, row: document.getElementById('userKind').textContent, kind: document.getElementById('userKind').dataset.kind };
        window.acctKind = real; document.dispatchEvent(new CustomEvent('tb:acct-kind', { detail: real() }));
        return out;
      });
      t.ok(r.pill.endsWith('L-pill') && r.label.endsWith('L-label'), 'livefeed.js re-says the pill and Help on the event: ' + JSON.stringify(r));
      t.ok(r.row === 'L-line' && r.kind === 'live', 'ui.js re-says the menu row on the event');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS9 onboarding tour, Markets step: the account type is said when the step shows, true for the browser account and the demo history',
    async run({ t, app }) {
      const page = await app('', { demo: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => typeof window.startTour === 'function', null, { timeout: 10000 });
      const step = () => page.evaluate(async () => {
        S.set.tourSeen = true; startTour();
        for (let i = 0; i < 50 && !(document.getElementById('tourP')?.textContent); i++) await new Promise(r => setTimeout(r, 50));
        const p = document.getElementById('tourP').textContent, k = acctKind();
        document.querySelector('.tour-x')?.click();
        return { p, k };
      });
      const a = await step();
      t.eq(a.k.key, 'local', 'the browser account');
      t.ok(a.p.endsWith(a.k.tour) && /in this browser/.test(a.p) && /no execution server/.test(a.p), 'the step says where the account is: ' + a.p);
      t.ok(!/demo account/i.test(a.p), 'no "demo account" for an account in this browser');
      await page.evaluate(() => window.loadDemoHistory());
      const b = await step();
      t.eq(b.k.key, 'example', 'the demo history loaded');
      t.ok(b.p.endsWith(b.k.tour) && /example trades/.test(b.p), 'the same tour, opened again, says the new type (not the words of when it was built): ' + b.p);
      const src = await page.evaluate(() => fetch('ui.js').then(r => r.text()));
      t.ok(!/it is a demo account — nothing is real money/.test(src), 'the fixed demo sentence keyed on Engine.feedOn is gone');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS10 onboarding tour on a signed-in page: demo account on the execution server; the menu row is announced and styled by CSS',
    async run({ t, app }) {
      const page = await app('', { live: true });
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForFunction(() => TradeLink.type === 'demo' && acctKind().key === 'demo', null, { timeout: 15000 });
      const r = await page.evaluate(async () => {
        S.set.tourSeen = true; startTour();
        for (let i = 0; i < 50 && !(document.getElementById('tourP')?.textContent); i++) await new Promise(r => setTimeout(r, 50));
        const p = document.getElementById('tourP').textContent; document.querySelector('.tour-x')?.click();
        const pop = document.getElementById('userPop'), k = document.getElementById('userKind');
        return { p, tour: acctKind().tour, desc: pop.getAttribute('aria-describedby'), role: pop.getAttribute('role'), style: k.getAttribute('style'), text: k.textContent, line: acctKind().line, item: k.matches('[role],button,a,[tabindex]') };
      });
      t.ok(r.p.endsWith(r.tour) && /demo account on the execution server/.test(r.p), 'the Markets step says a demo account on the execution server: ' + r.p);
      t.eq(r.desc, 'userKind', 'the menu (role=menu) is described by the account-type row, so screen readers announce it');
      t.ok(r.role === 'menu' && !r.item, 'the row stays a description, not a menu item');
      t.eq(r.text, r.line, 'the row\'s text');
      t.eq(r.style, null, 'the row has no inline style (styles.css #userKind)');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS11 account menu stays inside the window at 320-1440 px, also when the window is resized while it is open',
    async run({ t, app }) {
      const page = await app('');
      const box = () => page.evaluate(() => {
        const p = document.getElementById('userPop'), r = p.getBoundingClientRect(), k = document.getElementById('userKind').getBoundingClientRect(), W = document.documentElement.clientWidth;
        return { open: !p.hidden, W, H: innerHeight, l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom), kt: Math.round(k.top), kb: Math.round(k.bottom), mnav: document.body.classList.contains('mnav-on') };
      });
      const inside = m => m.open && m.l >= 0 && m.r <= m.W && m.t >= 0 && m.b <= m.H + 1 && m.kt >= 0 && m.kb <= m.H;
      for (const [w, h] of [[320, 568], [375, 667], [430, 932], [761, 800], [900, 700], [1080, 800], [1086, 800], [1243, 800], [1440, 900]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(250);
        await page.click('#userBtn');
        const m = await box();
        t.ok(inside(m), `${w}x${h}: the open menu is inside the window: ${JSON.stringify(m)}`);
        await page.keyboard.press('Escape');
      }
      // resized while open: re-fitted
      await page.setViewportSize({ width: 1243, height: 800 });
      await page.waitForTimeout(250);
      await page.click('#userBtn');
      for (const [w, h] of [[1000, 800], [800, 600], [1243, 800]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(250);
        const m = await box();
        t.ok(inside(m), `resized to ${w}x${h} with the menu open: still inside: ${JSON.stringify(m)}`);
      }
      const src = await page.evaluate(() => fetch('ui.js').then(r => r.text()));
      t.ok(!/pop\.style\.right = '0'/.test(src), 'no right:0 branch that does nothing');
      t.noErrors(page);
    }
  },
  {
    name: 'UXS12 phone, read-only tab: the open account menu sits under the read-only banner, its account-type row visible',
    async run({ t, app }) {
      const a = await app('');
      const b = await a.context().newPage();
      const errs = []; b.on('pageerror', e => errs.push(String(e)));
      await b.setViewportSize({ width: 390, height: 844 });
      await b.goto(a.url());
      await b.waitForFunction(() => typeof store === 'object' && store.readOnly && store.readOnly() && !document.getElementById('persistBanner').hidden && document.body.classList.contains('mnav-on'), null, { timeout: 30000 });
      await b.waitForTimeout(300);
      // the banner also lies over the header's avatar on the phone (a layout matter outside this item): the menu is opened
      // with the button's own click, as the keyboard would
      await b.evaluate(() => document.getElementById('userBtn').click());
      const m = await b.evaluate(() => {
        const ban = document.getElementById('persistBanner').getBoundingClientRect(), k = document.getElementById('userKind'), kr = k.getBoundingClientRect(), p = document.getElementById('userPop').getBoundingClientRect();
        const hit = document.elementFromPoint(Math.round(kr.left + kr.width / 2), Math.round(kr.top + Math.min(kr.height / 2, 8)));
        return { ban: Math.round(ban.bottom), kt: Math.round(kr.top), kb: Math.round(kr.bottom), pb: Math.round(p.bottom), H: innerHeight, top: !!hit && (hit === k || k.contains(hit)), text: k.textContent };
      });
      t.ok(m.kt >= m.ban && m.top, 'the account-type row is below the banner and on top where it is: ' + JSON.stringify(m));
      t.ok(m.pb <= m.H + 1, 'the menu ends inside the window: ' + JSON.stringify(m));
      t.ok(!!m.text, 'the row says the type');
      t.eq(errs.length, 0, 'no page errors in the read-only tab: ' + errs.join(' | '));
    }
  },
  {
    name: 'UXS13 the same words everywhere: persist.js holds the texts, livefeed.js has none of its own; Teach me names the menu\'s first row',
    async run({ t, app }) {
      const page = await app('');
      await page.setViewportSize({ width: 1243, height: 800 });
      const r = await page.evaluate(async () => {
        const k = acctKind(), lf = await fetch('livefeed.js').then(x => x.text());
        return { k, lf };
      });
      t.eq(r.k.key, 'local', 'the browser account');
      t.ok(r.k.pill.startsWith(r.k.line) && r.k.label.startsWith(r.k.line) && r.k.title.startsWith(r.k.line), 'the feed pill, Help and the flag title start with the menu row\'s words: ' + JSON.stringify(r.k));
      t.ok(!/Demo account: orders and fills stay in this browser/.test(r.lf) && !/PILL_ACCT|LABEL_ACCT/.test(r.lf), 'livefeed.js keeps no account texts of its own');
      // Teach me › Account menu: the step names the first row (the account type)
      await page.evaluate(() => teachMe());
      await page.waitForSelector('.tour-card .tour-t', { timeout: 5000 });
      let found = null;
      for (let i = 0; i < 80 && !found; i++) {
        found = await page.evaluate(() => { const c = document.querySelector('.tour-card'); return c && c.querySelector('.tour-t').textContent === 'Account menu' ? c.querySelector('.br-tc').textContent : null; });
        if (!found) { const more = await page.evaluate(() => { const n = document.querySelector('.tour-card [data-t=next]'); if (!n || n.textContent === 'Finish') return false; n.click(); return true; }); if (!more) break; await page.waitForTimeout(30); }
      }
      t.ok(!!found, 'Teach me has an Account menu step');
      t.ok(found.includes('Its first row is the account type: ' + r.k.line), 'the step names the first row and says the type in the menu\'s words: ' + found);
      t.noErrors(page);
    }
  }
];

const DEMO_LINE = 'Demo account · on the execution server · real executions, no money';
// what each place says about the account type
const kinds = page => page.evaluate(() => {
  const f = document.getElementById('demoPill'), k = document.getElementById('userKind');
  return {
    live: typeof TradeLink === 'object' && TradeLink.live, type: TradeLink.type,
    flag: { text: f.textContent, title: f.title, hidden: f.hidden },
    pill: document.getElementById('feedPill').title,
    label: document.getElementById('simLabel').textContent,
    menu: { text: k.textContent, title: k.title, kind: k.dataset.kind, hidden: k.hidden }
  };
});
