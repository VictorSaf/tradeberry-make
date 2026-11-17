// tradeBerry server tests: sign-in, the gate, and the interface preferences synced per user and per key (the trading
// account lives on the execution server: tests/trade-link.mjs and tests/server/gateway.mjs). Runs the real Pages Functions under the
// production server (host/server.mjs) with a throwaway SQLite database (never the live one). Usage, from 2-cod-sursa:
//   npm run release && node tests/server/run.mjs
// Test users are created here with random passwords that exist only for this run.
import { chromium } from 'playwright';
import { spawn, execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// 18790, not 8790: the launchd live proxy (tools/live-proxy.mjs) owns 8790 and forwards /api to the REAL server; a test server that
// failed to bind there once sent its login attempts to production and locked its owner out (15.11.2026)
const PORT = +(process.env.TB_TEST_PORT || 18790), BASE = `http://localhost:${PORT}`, DIR = mkdtempSync(join(tmpdir(), 'tb-d1-'));
const DB = join(DIR, 'tradeberry.db');
const pw = () => randomBytes(12).toString('base64url');
const USERS = { alice: pw(), bob: pw(), team: pw(), boss: pw() };
execFileSync(process.execPath, ['host/migrate.mjs', DB], { stdio: ['ignore', 'pipe', 'inherit'] });
const sq = new DatabaseSync(DB);
for (const [u, p] of Object.entries(USERS)) {
  const salt = randomBytes(16).toString('hex'), hash = pbkdf2Sync(p, Buffer.from(salt, 'hex'), 100000, 32, 'sha256').toString('hex');
  sq.prepare('INSERT INTO users (username, salt, hash, iter, created_at, shared, admin) VALUES (?, ?, ?, 100000, 0, ?, ?)').run(u, salt, hash, u === 'team' ? 1 : 0, u === 'boss' ? 1 : 0);
}
sq.close();
// Price data (/api/pricedata): a recorder database with a covered gap and a run still on, and an archive status
const TN = Date.now(), H = 3600000;
{
  const tk = new DatabaseSync(join(DIR, 'ticks.db'));
  tk.exec(`CREATE TABLE syms (id INTEGER PRIMARY KEY, sym TEXT NOT NULL UNIQUE); CREATE TABLE ticks (s INTEGER NOT NULL, t INTEGER NOT NULL, b REAL NOT NULL, a REAL NOT NULL, PRIMARY KEY (s, t)) WITHOUT ROWID;
    CREATE TABLE runs (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, last INTEGER NOT NULL);`);
  tk.exec(`INSERT INTO syms VALUES (1, 'EURUSD'), (2, 'GOLD'); INSERT INTO runs (start, last) VALUES (${TN - 3 * H}, ${TN - 2 * H}), (${TN - H}, ${TN + 24 * H});`);
  const d0 = Math.floor(TN / 86400000) * 86400000; tk.exec(`INSERT INTO ticks VALUES (1, ${d0 + 1}, 1.1, 1.2), (1, ${d0 + 2}, 1.1, 1.2), (2, ${d0 + 3}, 4000, 4001), (2, ${d0 - 5}, 4000, 4001);`);
  tk.close();
  execFileSync('mkdir', ['-p', join(DIR, 'bars')]);
  const S = x => Math.floor(x / 1000);
  writeFileSync(join(DIR, 'bars', 'status.json'), JSON.stringify({ syms: { EURUSD: { 1: { first: S(TN - 240 * H), last: S(TN), n: 9 } }, GOLD: { 1: { first: S(TN - 240 * H), last: S(TN - 2.5 * H), n: 5 } } }, last: { op: 'all', ok: 2, failed: 0 } }));
}
// the built app when there is one (npm run release), else the source tree (a worktree)
const REL = join(process.cwd(), '..', '1-aplicatie-publicabila'), APP = process.env.TB_APP || (existsSync(join(REL, 'index.html')) ? REL : process.cwd());
if (await fetch(BASE + '/icons/favicon-32.png').then(() => true, () => false)) throw new Error(`port ${PORT} is already served by something else: the tests would hit it, not their own server`);
const srv = spawn(process.execPath, ['host/server.mjs'], { env: { ...process.env, TB_APP: APP, TB_PORT: String(PORT), TB_DB: DB, LEGACY_API_KEY: '', TB_PLATFORM: 'http://127.0.0.1:9' }, stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
for (let i = 0; ; i++) { try { await fetch(BASE + '/icons/favicon-32.png'); break; } catch (e) { if (i > 120) { console.log(log); throw new Error('host/server.mjs did not start'); } await new Promise(r => setTimeout(r, 500)); } }

const browser = await chromium.launch();
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
async function page(ctx) {
  const p = await ctx.newPage(), errs = [];
  p.on('pageerror', e => errs.push(String(e.stack || e).slice(0, 400)));
  p.errs = errs; return p;
}
async function signIn(p, u, password) {
  await p.goto(BASE + '/');
  await p.fill('#u', u); await p.fill('#p', password);
  await Promise.all([p.waitForNavigation(), p.click('#b')]);
  await p.waitForFunction(() => document.getElementById('boot')?.classList.contains('done'), null, { timeout: 30000 });
  await p.waitForFunction(() => store.cloud && store.cloud().on, null, { timeout: 10000 }).catch(async e => { throw new Error('signIn ' + u + ': ' + JSON.stringify(await p.evaluate(() => ({ cookie: document.cookie, cloud: typeof store.cloud, meta: localStorage.getItem('tb-sync') })))); });
}
const settle = p => p.waitForFunction(() => store.cloud().status === "synced" && !store.cloud().dirty, null, { timeout: 20000 }).catch(async e => { throw new Error("not synced: " + JSON.stringify(await p.evaluate(async () => ({ c: store.cloud(), meta: localStorage.getItem('tb-sync'), srv: await (await fetch("/api/state")).text().then(t => t.slice(0, 300)) })))); });
// a preference changed in the page (the watchlist favourites), saved as the app saves
const fav = (p, list) => p.evaluate(l => { S.set.fav = l; persistNow(); }, list);
const stored = p => p.evaluate(async () => { const j = await (await fetch('/api/state')).json(); return j.data ? j.data.state : null; });
const put = (p, body) => p.evaluate(async b => (await fetch('/api/state', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-TB-Device': store.cloud().device }, body: JSON.stringify(b) })).status, body);

try {
  // 1. the gate
  {
    const r = await fetch(BASE + '/', { headers: { Accept: 'text/html' } }), t = await r.text();
    ok(r.status === 401 && /Sign in/.test(t) && !/MFX_BUILD/.test(t), 'page load without a session shows the login page, not the app');
    const js = await fetch(BASE + '/sw.js'); ok(js.status === 401, 'assets need a session: ' + js.status);
    const api = await fetch(BASE + '/api/state'); ok(api.status === 401, 'API needs a session: ' + api.status);
    const ic = await fetch(BASE + '/icons/favicon-32.png'); ok(ic.status === 200, 'icons stay open for the login page');
  }
  // 2. wrong password, unknown user, cross-site
  {
    const post = (b, h = {}) => fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(b) });
    const a = await post({ username: 'alice', password: 'wrong-password' }); ok(a.status === 401 && !a.headers.get('set-cookie'), 'wrong password refused, no cookie');
    const b = await post({ username: 'nobody', password: 'x' }); ok(b.status === 401, 'unknown user refused with the same answer');
    const j1 = await a.json(), j2 = await b.json(); ok(j1.error === j2.error, 'no hint whether the user exists');
    const c = await post({ username: 'alice', password: USERS.alice }, { Origin: 'https://evil.example' }); ok(c.status === 403, 'cross-site login refused');
  }
  // 3. Alice signs in and changes a preference; it is on the server, per key, and a second browser gets it
  const ctxA = await browser.newContext({ serviceWorkers: 'block' });
  const pA = await page(ctxA);
  {
    await pA.goto(BASE + '/'); await pA.fill('#u', 'alice'); await pA.fill('#p', 'nope'); await pA.click('#b');
    await pA.waitForFunction(() => /Wrong username or password/.test(document.getElementById('err').textContent));
    ok(true, 'login page shows the error');
    await signIn(pA, 'Alice', USERS.alice); // case-insensitive username
    ok((await pA.evaluate(() => store.cloud().user)) === 'alice', 'signed in as alice');
    const ck = (await ctxA.cookies()).find(c => c.name === 'tb_s'); ok(ck && ck.httpOnly && ck.sameSite === 'Lax', 'session cookie HttpOnly + SameSite=Lax');
    await fav(pA, ['GBPUSD', 'EURUSD']);
    await settle(pA);
    const st = await stored(pA);
    ok(st && st.set && st.set.fav.join() === 'GBPUSD,EURUSD', 'the preference is saved on the server');
    ok(st && !('positions' in st) && !('balance' in st) && !('history' in st) && !('jur' in st.set), 'the account is never saved there (only interface preferences): ' + Object.keys(st || {}).join(','));
    ok((await pA.evaluate(() => document.getElementById('cloudPill').textContent)) === 'alice · Synced', 'status pill says Synced');
    // no execution server in this test: the page says so and sends nothing
    ok(await pA.evaluate(async () => TradeLink.live && !TradeLink.up && (await openPosition({ sym: 'EURUSD', side: 'buy', lots: 0.1, dupOk: true, pmDone: true })) === null && /Execution server unreachable/.test(document.getElementById('tlBar').textContent)), 'without the execution server nothing is traded and the bar says so');
  }
  const ctxA2 = await browser.newContext({ serviceWorkers: 'block' });
  const pA2 = await page(ctxA2);
  {
    await signIn(pA2, 'alice', USERS.alice);
    ok((await pA2.evaluate(() => S.set.fav.join())) === 'GBPUSD,EURUSD', 'second browser of alice gets her preference from the server');
    await new Promise(r => setTimeout(r, 1000));
    ok(await pA2.evaluate(() => !document.getElementById('cloudAway') && store.cloud().status !== 'elsewhere'), 'both browsers run at once: nobody is stopped');
    ok(await put(pA2, { base: 0, prefs: { tk: { side: 'sell', lots: 2 } } }) === 200, 'a save from an old revision is merged, not refused (no 409)');
    const st = await stored(pA2);
    ok(st.tk && st.tk.lots === 2 && st.set.fav.join() === 'GBPUSD,EURUSD', 'per key: the new key is in, the other keys stay');
    ok(await put(pA2, { base: 3, state: { balance: 1 } }) === 423, 'a whole account (an old build) is refused with 423: its cloud.js stops, as "open on another device"');
    ok(await put(pA2, { base: 3, prefs: { positions: [] } }) === 400, 'an account key is refused as a preference');
    const ls = await pA2.evaluate(async () => (await fetch('/api/lease', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-TB-Device': store.cloud().device }, body: '{}' })).status);
    ok(ls === 423, 'the lease is a stub that stops old builds (423): ' + ls);
  }
  // 4. Bob in a fresh context: his preferences are his own
  const ctxB = await browser.newContext({ serviceWorkers: 'block' });
  const pB = await page(ctxB);
  {
    await signIn(pB, 'bob', USERS.bob);
    ok(!(await pB.evaluate(() => S.set.fav.includes('GBPUSD'))), 'bob does not get alice’s preferences');
    const r = await pB.evaluate(async () => { const r = await fetch('/api/state'); return (await r.json()).rev; });
    ok(r >= 0, 'bob reads only his own state');
  }
  // 5. two browsers save at once: different keys both stay, the same key goes to the last writer
  {
    await Promise.all([put(pA, { base: 0, prefs: { hlines: { EURUSD: [1.1] } } }), put(pA2, { base: 0, prefs: { drawings: { EURUSD: [] } } })]);
    let st = await stored(pA); ok(st.hlines && st.hlines.EURUSD[0] === 1.1 && st.drawings && Array.isArray(st.drawings.EURUSD), 'two saves of different keys at once: both kept');
    await put(pA, { base: 0, prefs: { hlines: { EURUSD: [1.2] } } }); await put(pA2, { base: 0, prefs: { hlines: { EURUSD: [1.3] } } });
    st = await stored(pA); ok(st.hlines.EURUSD[0] === 1.3, 'the same key: the last writer wins');
    await pA.reload(); await pA.waitForFunction(() => document.getElementById('boot')?.classList.contains('done') && store.cloud && store.cloud().on, null, { timeout: 30000 });
    ok((await pA.evaluate(() => (S.hlines.EURUSD || [])[0])) === 1.3, 'a reload takes the server’s preferences');
    await settle(pA);
  }
  // 6. sign out: back to the login page, the local copy is cleared, the session no longer works
  {
    const pB2 = pB;
    await pB2.evaluate(() => { document.getElementById('help').hidden = false; });
    pB2.once('dialog', d => d.accept());
    await Promise.all([pB2.waitForNavigation(), pB2.click('#signOutBtn')]);
    ok(/Sign in/.test(await pB2.content()), 'after sign-out the login page shows');
    const st = await pB2.evaluate(async () => (await fetch('/api/state')).status);
    ok(st === 401, 'session ended on the server: ' + st);
    // Alice signs in the browser Bob used: she gets her account, not his leftovers
    await signIn(pB2, 'alice', USERS.alice);
    ok((await pB2.evaluate(() => S.set.fav.join())) === 'GBPUSD,EURUSD', 'alice in bob’s browser gets her own preferences');
  }
  // 7d. a shared login: two browsers at once, each with its own preferences (and its own portfolio on the execution server)
  {
    const c1 = await browser.newContext({ serviceWorkers: 'block' }), c2 = await browser.newContext({ serviceWorkers: 'block' });
    const t1 = await page(c1), t2 = await page(c2);
    await signIn(t1, 'team', USERS.team); await signIn(t2, 'team', USERS.team);
    ok(await t1.evaluate(() => !document.getElementById('cloudAway')) && await t2.evaluate(() => !document.getElementById('cloudAway')), 'shared login: both browsers run at once');
    await fav(t1, ['USDJPY']); await settle(t1); await settle(t2);
    ok(!(((await stored(t2)) || {}).set || { fav: [] }).fav?.includes('USDJPY'), 'shared login: the other browser does not get this one’s preference');
    await t1.reload(); await t1.waitForFunction(() => document.getElementById('boot')?.classList.contains('done') && store.cloud && store.cloud().on, null, { timeout: 30000 });
    ok((await t1.evaluate(() => S.set.fav.join())) === 'USDJPY', 'shared login: the browser keeps its own preference after a reload');
    ok(/shared by several people/.test(await t1.evaluate(() => document.getElementById('cloudPill').title)), 'shared login says so');
    ok(!t1.errs.length && !t2.errs.length, 'no page errors (shared): ' + t1.errs.concat(t2.errs).join(' | '));
    await c1.close(); await c2.close();
  }
  // 6b. sessions end with the browser; administration is for administrators only (before the brute-force lock below)
  {
    const login = async (u, p, h = {}) => fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify({ username: u, password: p }) });
    const cookieOf = r => (r.headers.get('set-cookie') || '').split(';')[0];
    const la = await login('alice', USERS.alice), sc = la.headers.get('set-cookie') || '';
    ok(la.status === 200 && /HttpOnly/.test(sc) && !/Max-Age/i.test(sc) && !/Expires/i.test(sc), 'session cookie ends with the browser (no Max-Age): ' + sc.replace(/=[0-9a-f]{64}/, '=…'));
    const ca = cookieOf(la), get = (path, c, o = {}) => fetch(BASE + path, { ...o, headers: { Cookie: c, 'Content-Type': 'application/json', ...(o.headers || {}) } });
    const meA = await (await get('/api/me', ca)).json(); ok(meA.admin === false, 'alice is not an administrator');
    ok((await get('/api/admin', ca)).status === 403, 'GET /api/admin refused to a non-administrator');
    ok((await get('/api/admin', ca, { method: 'POST', body: JSON.stringify({ op: 'create', username: 'evil', password: 'x'.repeat(12) }) })).status === 403, 'POST /api/admin refused to a non-administrator');
    const cb = cookieOf(await login('boss', USERS.boss)), post = (b, h = {}) => get('/api/admin', cb, { method: 'POST', body: JSON.stringify(b), headers: h });
    ok((await (await get('/api/me', cb)).json()).admin === true, 'boss is an administrator');
    const list = await (await get('/api/admin', cb)).json(); ok(list.me === 'boss' && ['alice', 'bob', 'team', 'boss'].every(u => list.users.some(x => x.username === u)) && !JSON.stringify(list).includes('hash'), 'the administrator lists the accounts, no hashes');
    ok((await post({ op: 'create', username: 'carol', password: 'short' })).status === 400, 'a password under 8 characters is refused');
    const cpw = pw(); ok((await post({ op: 'create', username: 'carol', password: cpw })).status === 200, 'boss creates carol');
    ok((await login('carol', cpw)).status === 200, 'carol signs in with the password she was given');
    ok((await post({ op: 'create', username: 'carol', password: cpw })).status === 400, 'a username already taken is refused');
    ok((await post({ op: 'disable', username: 'carol' })).status === 200 && (await login('carol', cpw)).status === 401, 'disabled: carol cannot sign in');
    ok((await post({ op: 'enable', username: 'carol' })).status === 200 && (await login('carol', cpw)).status === 200, 'enabled again');
    const npw = pw(); const cc = cookieOf(await login('carol', cpw));
    ok((await post({ op: 'passwd', username: 'carol', password: npw })).status === 200 && (await login('carol', cpw)).status === 401 && (await login('carol', npw)).status === 200, 'new password: the old one stops working');
    ok((await get('/api/me', cc)).status === 401, "a new password ends carol's open sessions");
    ok((await post({ op: 'disable', username: 'boss' })).status === 400 && (await post({ op: 'delete', username: 'boss' })).status === 400 && (await post({ op: 'unadmin', username: 'boss' })).status === 400, 'an administrator cannot disable, delete or demote themself');
    // modules beyond Trade and Monitor, per user (migrations/0010_modules.sql)
    ok(JSON.stringify(meA.modules) === '[]', 'alice starts with no extra module');
    ok((await post({ op: 'modules', username: 'alice', modules: ['coach', 'research'] })).status === 200, 'boss opens Research and Coach to alice');
    ok(JSON.stringify((await (await get('/api/me', ca)).json()).modules) === '["research","coach"]', 'alice is told her modules, in a fixed order, on her next load');
    ok(JSON.stringify((await (await get('/api/admin', cb)).json()).users.find(x => x.username === 'alice').modules) === '["research","coach"]', 'the administrator sees them in the list');
    ok((await post({ op: 'modules', username: 'alice', modules: ['admin'] })).status === 400 && (await post({ op: 'modules', username: 'alice', modules: 'lab' })).status === 400, 'an unknown module or a non-list is refused');
    ok((await get('/api/admin', ca, { method: 'POST', body: JSON.stringify({ op: 'modules', username: 'alice', modules: ['lab'] }) })).status === 403, 'a user cannot give themself modules');
    ok((await post({ op: 'modules', username: 'alice', modules: [] })).status === 200 && JSON.stringify((await (await get('/api/me', ca)).json()).modules) === '[]', 'all closed again');
    ok((await post({ op: 'delete', username: 'carol' }, { Origin: 'https://evil.example' })).status === 403, 'cross-site administration refused');
    ok((await post({ op: 'delete', username: 'carol' })).status === 200 && (await login('carol', npw)).status === 401, 'carol deleted');
    // the Opening Note's edition: needs a session; without ANTHROPIC_API_KEY the page keeps its built-in note
    ok((await fetch(BASE + '/api/edition')).status === 401, 'edition needs a session');
    const ea = await (await get('/api/edition', ca)).json(); ok(ea.edition === null && ea.admin === false, 'no edition yet: the built-in note stays');
    ok((await get('/api/edition', ca, { method: 'POST', body: '{"op":"regen"}' })).status === 403, 'only an administrator regenerates the edition');
    const eb = await (await get('/api/edition', cb)).json(); ok(eb.admin === true, 'the administrator is told so (the regenerate link)');
    ok((await get('/api/edition', cb, { method: 'POST', body: '{"op":"regen"}' })).status === 200 && (await (await get('/api/edition', cb)).json()).requested === true, 'the administrator asks for a new edition: it is queued for the writer');
    // Administration › Price data
    ok((await get('/api/pricedata', ca)).status === 403 && (await get('/api/pricedata', ca, { method: 'POST', body: '{"op":"import"}' })).status === 403, 'price data: administrators only');
    const pd = await (await get('/api/pricedata', cb)).json();
    ok(pd.recorder.on === true && pd.recorder.today === 3 && pd.recorder.bytes > 0, 'price data: the recorder is on, 3 ticks today (from the database): ' + JSON.stringify(pd.recorder));
    ok(pd.gaps.length === 1 && pd.gaps[0].end - pd.gaps[0].start === H && pd.gaps[0].of === 2 && pd.gaps[0].covered === 1 && !pd.gaps[0].ongoing, 'price data: one gap of an hour, covered by 1-minute bars for 1 of 2 instruments: ' + JSON.stringify(pd.gaps));
    ok(pd.archive.syms.EURUSD[1].n === 9 && pd.archive.pid === null && pd.disk.free > 0, 'price data: the archive status and the free disk');
    ok(pd.archive.bytes > 0 && pd.total === pd.recorder.bytes + pd.recorder.daysBytes + pd.archive.bytes, 'price data: the total is the ticks database + its compressed days + the bar archive, read now: ' + pd.total);
    const pp = (b, h = {}) => get('/api/pricedata', cb, { method: 'POST', body: JSON.stringify(b), headers: h });
    ok((await pp({ op: 'import' }, { Origin: 'https://evil.example' })).status === 403 && (await pp({ op: 'wipe' })).status === 400 && (await pp({ op: 'import', sym: '../x' })).status === 400, 'price data: cross-site, unknown op and a bad instrument refused');
    writeFileSync(join(DIR, 'bars', '.lock'), String(srv.pid));
    const busy = await pp({ op: 'gaps' }); ok(busy.status === 409 && (await (await get('/api/pricedata', cb)).json()).archive.pid === srv.pid, 'price data: while an import runs, another start is refused and the running one shown');
    rmSync(join(DIR, 'bars', '.lock'));
    const st = await (await pp({ op: 'import', sym: 'EURUSD' })).json(); ok(st.ok && st.started === 'EURUSD', 'price data: an import starts');
    for (let i = 0; i < 40 && !(JSON.parse((await import('node:fs')).readFileSync(join(DIR, 'bars', 'status.json'), 'utf8')).last || {}).error; i++) await new Promise(r => setTimeout(r, 250));
    ok(/fetch failed|ECONNREFUSED|platform/i.test(JSON.parse((await import('node:fs')).readFileSync(join(DIR, 'bars', 'status.json'), 'utf8')).last.error || ''), 'price data: the started import ran as its own process and wrote its outcome (platform unreachable here)');
  }
  // 7. brute force: 10 failures lock the username for 15 minutes, even with the right password
  {
    const post = b => fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) });
    for (let i = 0; i < 10; i++) await post({ username: 'bob', password: 'wrong' + i });
    const r = await post({ username: 'bob', password: USERS.bob });
    ok(r.status === 429, 'locked after 10 failures: ' + r.status);
  }
  // 7b. parallel guesses cannot slip past the count; encoded paths under /icons/ stay closed
  {
    const post = b => fetch(BASE + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify(b) });
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => post({ username: 'alice', password: 'guess' + i })));
    const tried = rs.filter(r => r.status === 401).length;
    ok(tried <= 10, 'at most 10 parallel guesses from one address are checked: ' + tried);
    const enc = await fetch(BASE + '/icons/..%2fsw.js'); ok(enc.status === 401, 'encoded path under /icons/ needs a session: ' + enc.status);
  }
  // 7c. sign-out that cannot reach the server says so and keeps the session (nothing pretends)
  {
    await pA.route('**/api/logout', r => r.abort());
    pA.on('dialog', d => d.accept());
    await pA.evaluate(() => { document.getElementById('help').hidden = false; });
    await pA.click('#signOutBtn');
    await pA.waitForFunction(() => [...document.querySelectorAll('#toasts .toast b')].some(b => b.textContent === 'Not signed out'), null, { timeout: 15000 });
    ok(await pA.evaluate(() => store.cloud().on && !!S), 'sign-out failure is reported, the app stays');
    await pA.unroute('**/api/logout');
  }
  // 8. oversized state refused
  {
    const r = await put(pA, { base: 0, prefs: { x: 'a'.repeat(1600000) } });
    ok(r === 413, 'preferences over 1.5 MB refused: ' + r);
  }
  for (const p of [pA, pA2, pB]) ok(!p.errs.length, 'no page errors: ' + p.errs.join(' | '));
} catch (e) { fail++; console.log('  ABORT', e.message, (e.stack || '').split('\n').find(l => l.includes('run.mjs'))); } finally {
  await browser.close(); srv.kill(); rmSync(DIR, { recursive: true, force: true });
}
console.log(`\n${pass} passed, ${fail} failed`);
// the on-demand history server tests (limiter, windows, errors) run in their own process, part of the same gate
let hist = 0;
for (const f of ['tests/server/history.mjs', 'tests/server/bars-import.mjs', 'tests/server/market-core.mjs', 'tests/server/account-core.mjs', 'tests/server/fix-codec.mjs', 'tests/server/fix-session.mjs', 'tests/server/fix-dialect.mjs', 'tests/server/broker.mjs', 'tests/server/gateway.mjs', 'tests/server/migrate-accounts.mjs', 'tests/server/feed-hub.mjs', 'tests/server/ops.mjs', 'tests/server/ops-scripts.mjs', 'tests/server/journal.mjs']) { console.log('\n' + f); try { execFileSync(process.execPath, [f], { stdio: 'inherit' }); } catch (e) { hist = 1; } }
process.exit(fail || hist ? 1 : 0);
