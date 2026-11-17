// Persistence: account and market survive a reload, honest storage modes, one writer across tabs, update notice,
// deep-link validation. Each test runs in a fresh browser context (empty IndexedDB and localStorage).
const LABEL = {
  persistent: 'Saved in this browser',
  'best-effort': 'Best effort — may be cleared by the browser (e.g. Safari after 7 days without visits)',
  session: 'Session only — lasts until reload'
};
// wait for a (re)loaded page to finish booting
const booted = page => page.waitForFunction(() => typeof S === 'object' && S && !document.getElementById('boot')?.matches(':not(.done)'), null, { timeout: 30000 });
// run in the page before any script: make browser storage throw like a sandboxed frame or blocked site data
const BLOCK = { fn: which => { for (const k of which) Object.defineProperty(window, k, { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); }, arg: ['indexedDB', 'localStorage', 'sessionStorage'] };
// run in the page before any script: no Web Locks API (older browsers), so the localStorage heartbeat elects the writer
const NOLOCKS = { fn: () => { Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get() { return undefined; } }); }, arg: null };
const RO_TITLE = 'Read-only: this account is open in another tab — Take over here to change it';
// a second page in the same browser context (shared storage), optionally with an init script
async function second(a, init) {
  const b = await a.context().newPage();
  b.errors = []; b.on('pageerror', e => b.errors.push(String(e)));
  if (init) await b.addInitScript(init.fn, init.arg);
  await b.goto(a.url()); await booted(b);
  return b;
}
const idbPut = (page, key, val) => page.evaluate(([key, val]) => new Promise((res, rej) => {
  const r = indexedDB.open('meridian-fx', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('kv');
  r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put(val, key); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
  r.onerror = () => rej(r.error);
}), [key, val]);
const idbGet = (page, key) => page.evaluate(key => new Promise((res, rej) => {
  const r = indexedDB.open('meridian-fx'); r.onerror = () => rej(r.error);
  r.onsuccess = () => { const db = r.result; if (!db.objectStoreNames.contains('kv')) { db.close(); return res(null); } const g = db.transaction('kv').objectStore('kv').get(key); g.onsuccess = () => { db.close(); res(g.result ?? null); }; g.onerror = () => rej(g.error); };
}), key);

// run in the page before any script: no BroadcastChannel (older browsers, some embedded views)
const NOBC = { fn: () => { delete window.BroadcastChannel; }, arg: null };
// no BroadcastChannel and no localStorage: a read-only tab has no way to hear of the writer's saves
const NOBC_NOLS = { fn: () => { delete window.BroadcastChannel; Object.defineProperty(window, 'localStorage', { configurable: true, get() { throw new DOMException('The operation is insecure.', 'SecurityError'); } }); }, arg: null };
// every toast title a page shows, even those already faded out
const watchToasts = page => page.evaluate(() => {
  window.__seen = [];
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.classList && n.classList.contains('toast')) window.__seen.push(n.querySelector('b')?.textContent || ''); })
    .observe(document.getElementById('toasts'), { childList: true });
});
const seen = page => page.evaluate(() => window.__seen.slice());
const onScreen = page => page.evaluate(() => [...document.querySelectorAll('#toasts .toast')].filter(x => x.style.opacity !== '0').map(x => x.querySelector('b').textContent));
// reload a page whose scripts arrive late (a slow network or a slow device): the first script is held for ms
async function slowReload(page, ms) {
  const pat = '**/vendor/lightweight-charts-5.2.1.js';
  await page.route(pat, async r => { await new Promise(res => setTimeout(res, ms)); await r.continue(); });
  await page.reload(); await booted(page);
  await page.unroute(pat);
}
const PROMOTED = 'This tab now saves the account';

export const tests = [
  {
    name: 'P1 position, price, clock and settings survive a reload',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const before = await page.evaluate(async () => {
        T.reset();
        const m0 = Engine.mid('EURUSD');
        T.move('EURUSD', m0 * 1.03); // away from the seed rates, so a fresh market would show a jump
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.7, dupOk: true });
        persistNow(); await store.flush();
        return { m0, mid: Engine.mid('EURUSD'), simTime: Engine.simTime, id: p.id, entry: p.entry, bal: S.balance, mode: store.mode() };
      });
      t.ok(before.mode === 'persistent' || before.mode === 'best-effort', 'storage works in a normal context: ' + before.mode);
      const rec = await idbGet(page, 'state');
      t.eq(rec && rec.schemaVersion, 2, 'IndexedDB record has schemaVersion 2');
      t.ok(rec.rev > 0 && rec.savedAt > 0, 'record has rev and savedAt');
      t.eq(rec.state.positions.length, 1, 'IndexedDB holds the open position');
      await page.reload(); await booted(page);
      const after = await page.evaluate(() => ({ pos: S.positions.map(p => ({ id: p.id, entry: p.entry, lots: p.lots })), mid: Engine.mid('EURUSD'), simTime: Engine.simTime, bal: S.balance,
        note: document.getElementById('persistNote')?.textContent || '', pill: document.getElementById('persistPill')?.textContent || '', mode: store.mode() }));
      t.deep(after.pos, [{ id: before.id, entry: before.entry, lots: 0.7 }], 'the position is back');
      t.near(after.bal, before.bal, 'balance kept', 1e-12);
      t.near(after.mid, before.mid, 'price resumes where it was (no jump)', 2e-3);
      t.ok(Math.abs(after.mid / before.m0 - 1) > 0.02, 'not a fresh market from the seed rates');
      t.ok(after.simTime >= before.simTime && after.simTime - before.simTime < 120, 'clock carries on');
      t.ok(after.note.includes(LABEL[after.mode]), 'Help names the storage mode: ' + after.note);
      t.ok(after.note.includes('Export'), 'Help reminds that Export is the guarantee');
      t.ok(after.pill.length > 0, 'status pill shows the storage mode');
      // a setting changed just before the reload is written on the way out (visibilitychange/pagehide)
      await page.evaluate(() => { document.getElementById('themeBtn').click(); });
      const theme = await page.evaluate(() => S.set.theme);
      await page.reload(); await booted(page);
      t.eq(await page.evaluate(() => S.set.theme), theme, 'theme changed right before reload is kept');
      t.eq(await page.evaluate(() => S.positions.length), 1, 'position still there after a second reload');
      t.noErrors(page);
    }
  },
  {
    name: 'P2 blocked storage: Session only, the app still trades',
    async run({ t, app }) {
      const page = await app('', { clock: true, init: BLOCK });
      const r = await page.evaluate(async () => {
        T.reset();
        const p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true });
        persistNow(); await store.flush();
        return { mode: store.mode(), ok: !!p, note: document.getElementById('persistNote').textContent, pill: document.getElementById('persistPill').textContent, title: document.getElementById('persistPill').title, upd: pwaUpdateText() };
      });
      t.eq(r.mode, 'session', 'mode');
      t.ok(r.ok, 'trading works in memory');
      t.ok(r.note.includes(LABEL.session), 'Help says Session only: ' + r.note);
      t.ok(r.pill.includes('Session only'), 'pill says Session only: ' + r.pill);
      t.ok(/loses|lose/i.test(r.upd) && !/keeps your account/i.test(r.upd), 'update notice warns that reload loses the account: ' + r.upd);
      t.noErrors(page);
      // only IndexedDB blocked: localStorage fallback, still best effort and a normal update notice
      const p2 = await app('', { clock: true, init: { fn: BLOCK.fn, arg: ['indexedDB'] } });
      const r2 = await p2.evaluate(async () => { persistNow(); await store.flush(); return { mode: store.mode(), backend: store.backend(), upd: pwaUpdateText(), saved: !!localStorage.getItem('meridian-fx-state') }; });
      t.eq(r2.backend, 'localStorage', 'fallback backend');
      t.ok(r2.mode === 'best-effort' || r2.mode === 'persistent', 'fallback mode ' + r2.mode);
      t.ok(r2.saved, 'state written to localStorage');
      t.ok(/Reload keeps your account/.test(r2.upd), 'update notice: ' + r2.upd);
      t.noErrors(p2);
    }
  },
  {
    name: 'P3 localStorage fallback over 1 MB keeps the last trades and says so',
    async run({ t, app }) {
      const page = await app('', { clock: true, init: { fn: BLOCK.fn, arg: ['indexedDB'] } });
      const r = await page.evaluate(async () => {
        T.reset();
        const note = 'x'.repeat(4000);
        for (let i = 0; i < 400; i++) S.history.push({ id: 1000 + i, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, exit: 1.1005, pnl: 50, pips: 5, open: Engine.simTime - 600, close: Engine.simTime, reason: 'Manual', note });
        store.set(S); await store.flush();
        const env = JSON.parse(localStorage.getItem('meridian-fx-state'));
        return { n: env.state.history.length, first: env.state.history[0].id, len: localStorage.getItem('meridian-fx-state').length, note: document.getElementById('persistNote').textContent, toasts: T.toasts().map(x => x.title + ' ' + x.body) };
      });
      t.ok(r.n < 400 && r.n > 0, 'history trimmed: ' + r.n);
      t.eq(r.first, 1000, 'newest-first order kept (the first trades of the list)');
      t.ok(r.len <= 1024 * 1024, 'stored size under 1 MB: ' + r.len);
      t.ok(r.note.includes('last ' + r.n + ' trades'), 'Help says how many trades are kept: ' + r.note);
      t.ok(r.toasts.some(x => x.includes('last ' + r.n + ' trades')), 'one toast says it: ' + r.toasts);
      t.noErrors(page);
    }
  },
  {
    name: 'P4 a second tab is read-only; Take over here moves the writer',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'sell', lots: 0.3, dupOk: true }); persistNow(); await store.flush(); });
      const b = await a.context().newPage();
      const errs = []; b.on('pageerror', e => errs.push(String(e)));
      await b.goto(a.url()); await booted(b);
      await b.waitForSelector('#persistBanner:not([hidden])', { timeout: 5000 });
      const rb = await b.evaluate(() => {
        const bn = document.getElementById('persistBanner');
        const n0 = S.positions.length, p = openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true });
        return { ro: store.readOnly(), text: bn.textContent, btn: !!bn.querySelector('button') && bn.querySelector('button').textContent, opened: p, n0, n1: S.positions.length, speed: Engine.speed };
      });
      t.ok(rb.ro, 'second tab is read-only');
      t.ok(rb.text.includes('Open in another tab — this tab is read-only'), 'banner text: ' + rb.text);
      t.eq(rb.btn, 'Take over here', 'take-over button');
      t.eq(rb.opened, null, 'read-only tab does not trade');
      t.eq(rb.n0, 1, 'read-only tab shows the saved account');
      t.eq(rb.n1, 1, 'no position added');
      t.eq(rb.speed, 0, 'read-only tab does not run the market');
      t.eq(await a.evaluate(() => store.readOnly()), false, 'first tab stays the writer');
      t.ok(await a.evaluate(() => document.getElementById('persistBanner')?.hidden !== false), 'no banner in the writer tab');
      // the writer adds a trade after the second tab opened; take-over must carry it
      await a.evaluate(() => { openPosition({ sym: 'USDJPY', side: 'buy', lots: 0.2, dupOk: true }); });
      await Promise.all([b.waitForEvent('load', { timeout: 15000 }), b.click('#persistBanner button')]);
      await booted(b);
      await a.waitForFunction(() => store.readOnly(), null, { timeout: 5000 });
      const rb2 = await b.evaluate(() => ({ ro: store.readOnly(), syms: S.positions.map(p => p.sym).sort(), banner: document.getElementById('persistBanner')?.hidden !== false }));
      t.eq(rb2.ro, false, 'after take-over the second tab writes');
      t.deep(rb2.syms, ['EURUSD', 'USDJPY'], 'take-over loads the latest account of the old writer');
      t.ok(rb2.banner, 'no banner in the new writer');
      const ra = await a.evaluate(() => ({ text: document.getElementById('persistBanner')?.textContent || '', speed: Engine.speed, p: openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }) }));
      t.ok(ra.text.includes('this tab is read-only'), 'old writer now shows the banner');
      t.eq(ra.p, null, 'old writer no longer trades');
      t.eq(ra.speed, 0, 'old writer stopped its market');
      t.noErrors(a); t.ok(!errs.length, 'page errors: ' + errs.join(' | '));
    }
  },
  {
    name: 'P5 schema: v1 migrates, a newer schema is refused and kept',
    async run({ t, app, open }) {
      // v1: a raw account under the old key
      const p = await open('/tests/engine.html');
      await p.evaluate(() => localStorage.setItem('meridian-fx-v1', JSON.stringify({ balance: 12345, positions: [], history: [], set: { theme: 'light' } })));
      await p.goto(p.url().replace('/tests/engine.html', '/')); await booted(p);
      const r1 = await p.evaluate(async () => { persistNow(); await store.flush(); return { bal: S.balance, theme: S.set.theme }; });
      t.eq(r1.bal, 12345, 'v1 account migrated');
      t.eq(r1.theme, 'light', 'v1 settings migrated');
      t.eq((await idbGet(p, 'state')).schemaVersion, 2, 'written back as v2');
      t.noErrors(p);
      // newer schema: refused, nothing overwritten, user told
      const q = await open('/tests/engine.html');
      await q.evaluate(() => new Promise((res, rej) => {
        const r = indexedDB.open('meridian-fx', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('kv');
        r.onsuccess = () => { const tx = r.result.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ schemaVersion: 99, rev: 7, savedAt: 1, state: { balance: 777 } }, 'state'); tx.oncomplete = () => { r.result.close(); res(); }; tx.onerror = () => rej(tx.error); };
        r.onerror = () => rej(r.error);
      }));
      await q.goto(q.url().replace('/tests/engine.html', '/')); await booted(q);
      await q.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(x => /newer version/i.test(x.textContent)), null, { timeout: 3000 }).catch(() => {});
      const r2 = await q.evaluate(async () => { openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }); persistNow(); await store.flush(); return { bal: S.balance, mode: store.mode(), toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent), note: document.getElementById('persistNote').textContent }; });
      t.eq(r2.bal, 100000, 'newer account not loaded into this build');
      t.eq(r2.mode, 'session', 'this tab does not save over it');
      t.ok(r2.toasts.some(x => /newer version/i.test(x)), 'user told: ' + r2.toasts);
      t.ok(/newer version/i.test(r2.note), 'Help says why: ' + r2.note);
      const kept = await idbGet(q, 'state');
      t.eq(kept.schemaVersion, 99, 'newer record kept untouched');
      t.eq(kept.state.balance, 777, 'newer account intact');
      t.noErrors(q);
    }
  },
  {
    name: 'P6 quota error: one toast, labelled unsaved; reset clears storage',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      const r = await page.evaluate(async () => {
        T.reset(); persistNow(); await store.flush();
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function () { throw new DOMException('full', 'QuotaExceededError'); };
        openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true }); store.set(S); await store.flush();
        openPosition({ sym: 'GBPUSD', side: 'buy', lots: 0.1, dupOk: true }); store.set(S); await store.flush();
        const toasts = T.toasts().filter(x => x.title.startsWith('Not saved'));
        const res = { toasts, unsaved: store.unsaved(), pill: document.getElementById('persistPill').textContent, inMem: S.positions.length };
        IDBObjectStore.prototype.put = put;
        store.set(S); await store.flush();
        res.after = store.unsaved();
        return res;
      });
      t.eq(r.toasts.length, 1, 'exactly one toast');
      t.eq(r.toasts[0].title, 'Not saved — storage full; use Export', 'toast text');
      t.ok(r.unsaved, 'unsaved flag');
      t.ok(/unsaved/i.test(r.pill), 'pill says unsaved: ' + r.pill);
      t.eq(r.inMem, 2, 'state stays in memory');
      t.eq(r.after, false, 'a later successful save clears the flag');
      // Reset account wipes the stored account
      await page.evaluate(() => { document.getElementById('resetAcct').click(); document.querySelector('#confirmDlg [data-cf=ok]')?.click(); });
      const after = await page.evaluate(async () => { await store.flush(); return S.positions.length; });
      t.eq(after, 0, 'reset account');
      const rec = await idbGet(page, 'state');
      t.ok(!rec || rec.state.positions.length === 0, 'stored account reset too');
      t.eq(await idbGet(page, 'prev'), null, 'previous copy cleared by reset');
      t.noErrors(page);
    }
  },
  {
    name: 'P8 no Web Locks: a reloaded single tab stays the writer; a second tab follows and takes over when it closes',
    async run({ t, app }) {
      const a = await app('', { clock: 'run', init: NOLOCKS });
      t.eq(await a.evaluate(() => typeof navigator.locks), 'undefined', 'Web Locks hidden');
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.4, dupOk: true }); persistNow(); await store.flush(); });
      for (let i = 0; i < 2; i++) {
        await a.reload(); await booted(a);
        const r = await a.evaluate(() => ({ ro: store.readOnly(), n: S.positions.length, banner: document.getElementById('persistBanner').hidden }));
        t.eq(r.ro, false, 'reload ' + (i + 1) + ': still the writer');
        t.eq(r.n, 1, 'reload ' + (i + 1) + ': account loaded');
        t.ok(r.banner, 'reload ' + (i + 1) + ': no read-only banner');
      }
      const b = await second(a, NOLOCKS);
      t.eq(await b.evaluate(() => store.readOnly()), true, 'a second tab is read-only');
      t.eq(await a.evaluate(() => store.readOnly()), false, 'the first tab stays the writer');
      const t0 = Date.now();
      await a.close();
      await b.waitForFunction(() => !store.readOnly(), null, { timeout: 6000 });
      await b.waitForFunction(() => S.positions.length === 1, null, { timeout: 3000 }); // the takeover reloads the account; gates are switched off after that
      const rb = await b.evaluate(() => { pmCfg().on = false; tiltCfg().on = false; return { n: S.positions.length, banner: document.getElementById('persistBanner').hidden, p: !!openPosition({ sym: 'GBPUSD', side: 'buy', lots: 0.1, dupOk: true }), why: typeof lastReject === 'string' ? lastReject : '' }; });
      t.ok(Date.now() - t0 <= 6000, 'took over in ' + (Date.now() - t0) + ' ms');
      t.eq(rb.n, 1, 'the new writer has the account');
      t.ok(rb.banner, 'banner hidden after taking over');
      t.ok(rb.p, 'the new writer trades: ' + rb.why);
      t.noErrors(b);
    }
  },
  {
    name: 'P9 read-only tab: account controls disabled, writes refused out loud, a live copy of the writer',
    async run({ t, app }) {
      const a = await app('', { clock: 'run' });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'sell', lots: 0.3, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a);
      await b.waitForSelector('#persistBanner:not([hidden])', { timeout: 5000 });
      const rb = await b.evaluate(() => {
        const ctl = ['resetAcct', 'importBtn', 'importFile', 'demoBtn', 'demoClear'].map(id => document.getElementById(id)).filter(Boolean).map(x => ({ id: x.id, dis: x.disabled, title: x.title }));
        return { ro: store.readOnly(), ctl, pill: document.getElementById('persistPill').textContent, speed: Engine.speed, sim: Engine.simTime };
      });
      t.ok(rb.ro, 'read-only');
      t.ok(rb.ctl.some(x => x.id === 'resetAcct') && rb.ctl.some(x => x.id === 'importBtn'), 'Reset and Import found');
      for (const c of rb.ctl) { t.ok(c.dis, c.id + ' disabled'); t.eq(c.title, RO_TITLE, c.id + ' title'); }
      t.ok(rb.pill.includes('Read-only · live copy'), 'pill: ' + rb.pill);
      t.eq(rb.speed, 0, 'the market does not run here');
      t.ok(await a.evaluate(() => !document.getElementById('resetAcct').disabled && !document.getElementById('importBtn').disabled), 'writer keeps its controls');
      // the writer opens a position and moves the market: the read-only tab shows both within a second.
      // "Within a second" is counted on the pages' clock, not the wall clock (a loaded machine stretches the second
      // into several): the clock (one for both tabs of the context) stands still, the writer acts, the clock is let run
      // exactly 1000 ms (every timer due in that second fires, none after it), then the clock stays stopped while
      // the tabs finish what that second set off (storage, messages). What needs a timer later than 1 s never shows.
      // The market stands still here (speed 0), so the prices compared below are exact.
      // (each tab keeps its own page time: the pause is set just past the later of the two; that time keeps running while
      // it is read, so a loaded machine can overtake it: then it is read again with a wider margin)
      const pause = async () => {
        for (let m = 50; ; m *= 2) {
          const at = Math.max(...await Promise.all([a, b].map(pg => pg.evaluate(() => Date.now())))) + m;
          try { return await a.clock.pauseAt(at); } catch (e) { if (m >= 6400 || !/to the past/.test(String(e))) throw e; }
        }
      };
      await pause();
      const w = await a.evaluate(() => { T.move('EURUSD', Engine.mid('EURUSD') * 1.01); openPosition({ sym: 'USDJPY', side: 'buy', lots: 0.2, dupOk: true }); return { mid: Engine.mid('EURUSD') }; });
      const c0 = await a.evaluate(() => Date.now());
      await a.clock.runFor(1000);
      const seenIn1s = await b.waitForFunction(() => S.positions.some(p => p.sym === 'USDJPY') && document.querySelectorAll('#posBody tr').length === 2, null, { timeout: 15000, polling: 50 }).then(() => true, () => false);
      const c1 = await a.evaluate(() => Date.now());
      t.ok(seenIn1s, 'the read-only tab shows the new position within 1 s of page time (stopped clock)');
      t.eq(c1 - c0, 1000, 'page time spent');
      await a.clock.resume();
      // the market as the writer moved it: the read-only tab resyncs on the writer's next market save (every 20 loop ticks)
      await b.waitForFunction(m => Math.abs(Engine.mid('EURUSD') - m) <= 1e-9 * m, w.mid, { timeout: 15000, polling: 50 }).catch(() => {});
      const r2 = await b.evaluate(() => ({ syms: S.positions.map(p => p.sym).sort(), mid: Engine.mid('EURUSD'), sim: Engine.simTime, rows: document.querySelectorAll('#posBody tr').length }));
      t.deep(r2.syms, ['EURUSD', 'USDJPY'], 'read-only tab has the new position');
      t.eq(r2.rows, 2, 'and shows it in the positions table');
      t.near(r2.mid, w.mid, 'read-only market resynced to the writer', 1e-9);
      await a.evaluate(() => { Engine.speed = 60; });
      // writes in the read-only tab: no effect, one explicit toast
      const r3 = await b.evaluate(async () => {
        document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
        const before = JSON.stringify(store.get());
        const x = JSON.parse(before); x.balance = 1; x.positions = [];
        store.set(x); store.set(x); store.clear();
        await new Promise(r => setTimeout(r, 100));
        return { same: JSON.stringify(store.get()) === before, toasts: [...document.querySelectorAll('#toasts .toast')].map(e => e.textContent) };
      });
      t.ok(r3.same, 'store.set/clear change nothing in a read-only tab');
      t.eq(r3.toasts.length, 1, 'exactly one toast: ' + r3.toasts.join(' | '));
      t.ok(/read-only/i.test(r3.toasts[0] || ''), 'toast says read-only: ' + r3.toasts[0]);
      const rec = await idbGet(a, 'state');
      t.eq(rec.state.positions.length, 2, 'stored account untouched by the read-only tab');
      // the market keeps following the writer without the read-only engine moving on its own
      // (the writer saves the market every 20 loop ticks, debounced by 2 s: at most 7 s, 420 s of sim time at speed 60)
      // (under load the wall clock stretches: the wait is generous; the lag is read with the clock stopped, so both tabs
      // are compared at the same instant of page time)
      const moved = await b.waitForFunction(s0 => Engine.simTime > s0, r2.sim, { timeout: 20000, polling: 50 }).then(() => true, () => false);
      await pause();
      const r4 = await b.evaluate(() => ({ sim: Engine.simTime, speed: Engine.speed }));
      const aw = await a.evaluate(() => Engine.simTime);
      await a.clock.resume();
      t.eq(r4.speed, 0, 'still no engine in the read-only tab');
      t.ok(moved, 'read-only clock follows the writer: ' + [r2.sim, r4.sim, aw]);
      t.ok(Math.abs(aw - r4.sim) < 60 * 8, 'clock within one save interval of the writer: ' + (aw - r4.sim));
      t.noErrors(a); t.noErrors(b);
    }
  },
  {
    name: 'P10 writer closes (Web Locks): the read-only tab becomes the writer on its own',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.5, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a);
      t.eq(await b.evaluate(() => store.readOnly()), true, 'second tab read-only');
      await a.evaluate(async () => { openPosition({ sym: 'AUDUSD', side: 'sell', lots: 0.2, dupOk: true }); await store.flush(); });
      const t0 = Date.now();
      await a.close();
      // promote() drops readOnly before its pull() finishes; the market restarts at the end of it
      await b.waitForFunction(() => !store.readOnly() && S.positions.length === 2 && Engine.speed > 0, null, { timeout: 6000 });
      const ms = Date.now() - t0;
      const r = await b.evaluate(async () => {
        pmCfg().on = false; tiltCfg().on = false;
        const out = { banner: document.getElementById('persistBanner').hidden, pill: document.getElementById('persistPill').textContent, reset: document.getElementById('resetAcct').disabled, speed: Engine.speed,
          title: document.getElementById('resetAcct').title, syms: S.positions.map(p => p.sym).sort() };
        out.p = !!openPosition({ sym: 'GBPUSD', side: 'buy', lots: 0.1, dupOk: true }); await store.flush();
        return out;
      });
      t.ok(ms <= 6000, 'took over in ' + ms + ' ms');
      t.deep(r.syms, ['AUDUSD', 'EURUSD'], 'reloaded the latest account');
      t.ok(r.banner, 'banner hidden');
      t.ok(!/Read-only/.test(r.pill), 'pill no longer read-only: ' + r.pill);
      t.eq(r.reset, false, 'Reset enabled again');
      t.ok(r.title !== RO_TITLE, 'Reset title restored: ' + r.title);
      t.ok(r.speed > 0, 'market runs in the new writer');
      t.ok(r.p, 'new writer trades');
      t.eq((await idbGet(b, 'state')).state.positions.length, 3, 'and saves');
      t.noErrors(b);
    }
  },
  {
    name: 'P10b writer reloads (Web Locks) while a read-only tab is open: the writer stays the writer, the other tab stays read-only and silent',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.5, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a);
      t.eq(await b.evaluate(() => store.readOnly()), true, 'second tab read-only');
      for (let i = 0; i < 3; i++) {
        await a.reload(); await booted(a);
        await a.waitForTimeout(2600); // past the queued tab's grace period
        const ra = await a.evaluate(() => ({ ro: store.readOnly(), banner: document.getElementById('persistBanner').hidden, reset: document.getElementById('resetAcct').disabled, imp: document.getElementById('importBtn').disabled, n: S.positions.length }));
        const rb = await b.evaluate(() => ({ ro: store.readOnly(), toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent) }));
        t.eq(ra.ro, false, 'reload ' + (i + 1) + ': A still the writer');
        t.ok(ra.banner, 'reload ' + (i + 1) + ': A has no read-only banner');
        t.eq(ra.reset, false, 'reload ' + (i + 1) + ': A Reset enabled');
        t.eq(ra.imp, false, 'reload ' + (i + 1) + ': A Import enabled');
        t.eq(ra.n, 1, 'reload ' + (i + 1) + ': A loaded the account');
        t.eq(rb.ro, true, 'reload ' + (i + 1) + ': B still read-only');
        t.ok(!rb.toasts.some(x => /now saves the account/i.test(x)), 'reload ' + (i + 1) + ': B claims nothing: ' + rb.toasts);
      }
      // A still writes and B still follows
      await a.evaluate(async () => { openPosition({ sym: 'AUDUSD', side: 'sell', lots: 0.2, dupOk: true }); await store.flush(); });
      await b.waitForFunction(() => S.positions.length === 2, null, { timeout: 1500 });
      // and when A really closes, B takes over
      await a.close();
      await b.waitForFunction(() => !store.readOnly(), null, { timeout: 6000 });
      t.noErrors(b);
    }
  },
  {
    name: 'P11 a damaged saved account: the previous valid copy survives two reloads, the damaged one is kept apart',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); S.balance = 54321; openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.2, dupOk: true }); persistNow(); await store.flush(); });
      await a.reload(); await booted(a); // this session starts from the valid copy: it becomes 'prev'
      t.eq((await idbGet(a, 'prev')).state.balance, 54321, 'prev holds the valid account');
      await a.goto(a.url().replace(/\/[^/]*$/, '/tests/engine.html'));
      await idbPut(a, 'state', { schemaVersion: 2, rev: 999, savedAt: 1, state: { balance: 'corrupt', positions: 'x' } });
      await a.goto(a.url().replace('/tests/engine.html', '/')); await booted(a);
      await a.waitForFunction(() => [...document.querySelectorAll('#toasts .toast')].some(x => /damaged/i.test(x.textContent)), null, { timeout: 3000 }).catch(() => {});
      const r = await a.evaluate(() => ({ bal: S.balance, n: S.positions.length, toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.textContent), note: document.getElementById('persistNote').textContent }));
      t.eq(r.bal, 54321, 'the previous valid copy is loaded');
      t.eq(r.n, 1, 'with its position');
      t.ok(r.toasts.some(x => /damaged/i.test(x)), 'user told: ' + r.toasts);
      t.eq((await idbGet(a, 'rejected')).state.balance, 'corrupt', 'damaged copy kept as rejected');
      for (let i = 0; i < 2; i++) {
        await a.reload(); await booted(a);
        const prev = await idbGet(a, 'prev');
        t.eq(prev && prev.state.balance, 54321, 'reload ' + (i + 1) + ': prev is still the valid account');
        t.eq(await a.evaluate(() => S.balance), 54321, 'reload ' + (i + 1) + ': account intact');
        t.eq((await idbGet(a, 'rejected')).state.balance, 'corrupt', 'reload ' + (i + 1) + ': rejected kept');
      }
      // an explicit reset removes the damaged copy as well
      await a.evaluate(async () => { document.getElementById('resetAcct').click(); document.querySelector('#confirmDlg [data-cf=ok]')?.click(); await store.flush(); });
      t.eq(await idbGet(a, 'rejected'), null, 'reset removes the rejected copy');
      t.noErrors(a);
    }
  },
  {
    name: 'P12 hidden writer: saves stay debounced',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      const r = await a.evaluate(async () => {
        T.reset(); persistNow(); await store.flush();
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        await store.flush(); await new Promise(r => setTimeout(r, 50));
        let puts = 0; const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (v, k) { if (k === 'state') puts++; return put.apply(this, arguments); };
        for (let i = 0; i < 6; i++) { S.set.sound = !S.set.sound; store.set(S); await new Promise(r => setTimeout(r, 20)); }
        await new Promise(r => setTimeout(r, 100));
        const early = puts;
        await new Promise(r => setTimeout(r, 2300));
        const late = puts;
        IDBObjectStore.prototype.put = put; delete document.visibilityState;
        return { early, late };
      });
      t.eq(r.early, 0, 'no full write per set while hidden');
      t.ok(r.late >= 1 && r.late <= 2, 'one debounced write: ' + r.late);
      t.noErrors(a);
    }
  },
  {
    name: 'P13 writer navigates again in the same tab (Web Locks): it keeps the writer role, the other tab stays read-only and silent',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.5, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a);
      await watchToasts(b);
      t.eq(await b.evaluate(() => store.readOnly()), true, 'second tab read-only');
      const base = a.url().replace(/[?#].*$/, '');
      for (const [i, url] of [base, base + '?tab=journal', base].entries()) {
        await a.goto(url); await booted(a); // Enter in the address bar, a deep link, the PWA start_url
        await a.waitForTimeout(2600); // past the queued tab's grace period
        const ra = await a.evaluate(() => ({ ro: store.readOnly(), banner: document.getElementById('persistBanner').hidden, n: S.positions.length }));
        t.eq(ra.ro, false, 'navigation ' + (i + 1) + ' (' + (url.slice(base.length) || 'same URL') + '): A still the writer');
        t.ok(ra.banner, 'navigation ' + (i + 1) + ': A has no read-only banner');
        t.eq(ra.n, 1, 'navigation ' + (i + 1) + ': A loaded the account');
        t.eq(await b.evaluate(() => store.readOnly()), true, 'navigation ' + (i + 1) + ': B still read-only');
        t.ok(!(await seen(b)).includes(PROMOTED), 'navigation ' + (i + 1) + ': B claims nothing: ' + await seen(b));
      }
      await a.close();
      await b.waitForFunction(() => !store.readOnly(), null, { timeout: 6000 });
      t.noErrors(b);
    }
  },
  {
    name: 'P14 slow reload of the writer: the other tab announces nothing it must take back; a late reclaim retracts and explains',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.5, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a);
      await watchToasts(b);
      // a little past the grace period: B may stand in for a moment, but says nothing
      await slowReload(a, 3000);
      await a.waitForTimeout(800);
      let ra = await a.evaluate(() => ({ ro: store.readOnly(), n: S.positions.length }));
      t.eq(ra.ro, false, 'slow reload: A is the writer again');
      t.eq(ra.n, 1, 'slow reload: A has the account');
      t.eq(await b.evaluate(() => store.readOnly()), true, 'slow reload: B read-only again');
      t.ok(!(await seen(b)).includes(PROMOTED), 'slow reload: B never claimed the account: ' + await seen(b));
      t.ok(await b.evaluate(() => !document.getElementById('persistBanner').hidden), 'slow reload: B shows the read-only banner');
      // far past it: B announced the take-over; when A comes back the announcement goes and B explains
      await slowReload(a, 7000);
      await b.waitForFunction(() => store.readOnly(), null, { timeout: 3000 });
      await b.waitForTimeout(400);
      const s = await seen(b), now = await onScreen(b);
      t.ok(s.includes(PROMOTED), 'very slow reload: B announced it saves the account: ' + s);
      t.ok(s.includes('The original tab took the account back'), 'B explains the change: ' + s);
      t.ok(!now.includes(PROMOTED), 'the announcement is no longer on screen: ' + now);
      ra = await a.evaluate(() => ({ ro: store.readOnly(), n: S.positions.length }));
      t.eq(ra.ro, false, 'very slow reload: A is the writer');
      t.eq(ra.n, 1, 'very slow reload: A has the account');
      t.eq(await b.evaluate(() => store.readOnly()), true, 'very slow reload: B read-only');
      t.noErrors(a); t.noErrors(b);
    }
  },
  {
    name: 'P15 no BroadcastChannel: the read-only tab still follows the writer (storage event); with no way to follow it says snapshot',
    async run({ t, app }) {
      const a = await app('', { clock: true, init: NOBC });
      t.eq(await a.evaluate(() => typeof BroadcastChannel), 'undefined', 'BroadcastChannel hidden');
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'sell', lots: 0.3, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a, NOBC);
      t.eq(await b.evaluate(() => store.readOnly()), true, 'second tab read-only');
      t.ok((await b.evaluate(() => document.getElementById('persistPill').textContent)).includes('Read-only · live copy'), 'pill says live copy');
      await b.waitForTimeout(1000); // past the read-only tab's own reload at the end of its boot
      await a.evaluate(() => { openPosition({ sym: 'USDJPY', side: 'buy', lots: 0.2, dupOk: true }); });
      const live = await b.waitForFunction(() => S.positions.some(p => p.sym === 'USDJPY'), null, { timeout: 3000 }).then(() => true, () => false);
      t.ok(live, 'the read-only tab shows the writer\'s new position');
      t.noErrors(a); t.noErrors(b);
      // neither BroadcastChannel nor localStorage: the read-only tab says what it is
      const c = await app('', { clock: true, init: NOBC_NOLS });
      await c.evaluate(async () => { T.reset(); persistNow(); await store.flush(); });
      const d = await second(c, NOBC_NOLS);
      const rd = await d.evaluate(() => ({ ro: store.readOnly(), pill: document.getElementById('persistPill').textContent, banner: document.getElementById('persistBanner').textContent, note: document.getElementById('persistPill').title }));
      t.eq(rd.ro, true, 'no channel: second tab read-only');
      t.ok(rd.pill.includes('Read-only · snapshot'), 'pill: ' + rd.pill);
      t.ok(!/live copy/i.test(rd.banner), 'banner does not promise a live copy: ' + rd.banner);
      t.ok(!/live copy/i.test(rd.note), 'help does not promise a live copy: ' + rd.note);
      t.noErrors(c); t.noErrors(d);
    }
  },
  {
    name: 'P16 Export in a read-only tab leaves the shared shell (theme, layout) alone',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); persistNow(); await store.flush(); });
      const b = await second(a);
      const r = await b.evaluate(async () => {
        const sh0 = JSON.parse(localStorage.getItem('meridian-fx-shell') || '{}');
        S.set.theme = sh0.theme === 'dark' ? 'light' : 'dark'; S.set.view = 'not-the-writers';
        document.getElementById('exportBtn').click();
        await new Promise(r => setTimeout(r, 100));
        const sh1 = JSON.parse(localStorage.getItem('meridian-fx-shell') || '{}');
        return { ro: store.readOnly(), t0: sh0.theme, t1: sh1.theme, l0: JSON.stringify(sh0.layout), l1: JSON.stringify(sh1.layout) };
      });
      t.ok(r.ro, 'read-only');
      t.eq(r.t1, r.t0, 'shell theme untouched');
      t.eq(r.l1, r.l0, 'shell layout untouched');
      t.noErrors(a); t.noErrors(b);
    }
  },
  {
    name: 'P17 demo history load/clear in a read-only tab: refused out loud, account unchanged',
    async run({ t, app }) {
      const a = await app('', { clock: true });
      await a.evaluate(async () => { T.reset(); openPosition({ sym: 'EURUSD', side: 'sell', lots: 0.3, dupOk: true }); persistNow(); await store.flush(); });
      const b = await second(a);
      await b.addScriptTag({ url: '/tests/fixtures/demo.js' }); // demo history is a test fixture now (spec 2026-11-02)
      await b.waitForFunction(() => typeof clearDemoHistory === 'function' && typeof loadDemoHistory === 'function', null, { timeout: 10000 });
      const r = await b.evaluate(async () => {
        document.querySelectorAll('#toasts .toast').forEach(x => x.remove());
        const before = JSON.stringify({ p: S.positions, h: S.history, b: S.balance });
        clearDemoHistory(); loadDemoHistory();
        await new Promise(r => setTimeout(r, 100));
        return { ro: store.readOnly(), same: JSON.stringify({ p: S.positions, h: S.history, b: S.balance }) === before, demo: S.demo, toasts: [...document.querySelectorAll('#toasts .toast')].map(x => x.querySelector('b').textContent) };
      });
      t.ok(r.ro, 'read-only');
      t.ok(r.same, 'account unchanged in the read-only tab');
      t.ok(!r.demo, 'no demo flag');
      t.ok(r.toasts.includes('Read-only: this account is open in another tab'), 'refusal toast: ' + r.toasts);
      t.ok(!r.toasts.some(x => /Account cleared|Demo history loaded/.test(x)), 'no success toast: ' + r.toasts);
      t.eq((await idbGet(a, 'state')).state.positions.length, 1, 'stored account untouched');
      t.noErrors(a); t.noErrors(b);
    }
  },
  {
    name: 'P7 deep links: unknown ?tab= / ?view= ignored, known ones applied',
    async run({ t, app }) {
      const bad = await app('?tab=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E&view=nope', { clock: true });
      await bad.waitForTimeout(300);
      t.eq(await bad.evaluate(() => activeTab), 'positions', 'unknown tab ignored');
      t.noErrors(bad);
      const ok = await app('?tab=journal', { clock: true });
      await ok.waitForFunction(() => activeTab === 'journal', null, { timeout: 3000 });
      t.noErrors(ok);
    }
  },
  {
    name: 'P18 read-only copy follows the writer on all 15 currencies and on the non-FX instruments (v15 catalog)',
    async run({ t, app }) {
      const a = await app('', { clock: 'run' });
      await a.evaluate(async () => { T.reset(); persistNow(); await store.flush(); });
      const b = await second(a);
      await b.waitForSelector('#persistBanner:not([hidden])', { timeout: 5000 });
      // the writer moves a new currency, a G8 one and two non-FX instruments, then saves
      const w = await a.evaluate(async () => {
        Engine.jump('TRY', .03); Engine.jump('HUF', -.01); Engine.jump('GBP', .004); Engine.jumpX('US.500', .02); Engine.jumpX('AAPL.US', -.05);
        persistNow(); await store.flush();
        return Object.fromEntries(['USDTRY', 'EURHUF', 'GBPUSD', 'US.500', 'AAPL.US', 'BTCEUR'].map(s => [s, Engine.mid(s)]));
      });
      const ok = await b.waitForFunction(w => Object.keys(w).every(s => Math.abs(Engine.mid(s) / w[s] - 1) < 1e-9), w, { timeout: 5000 }).then(() => true, () => false);
      const r = await b.evaluate(w => Object.fromEntries(Object.keys(w).map(s => [s, Engine.mid(s) / w[s] - 1])), w);
      t.ok(ok, 'read-only copy at the writer\'s levels: ' + JSON.stringify(r));
      t.noErrors(a); t.noErrors(b);
    }
  }
];
