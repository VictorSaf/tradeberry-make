// tradeBerry cut-over and operations (tools/cutover.sh, tools/rollback.sh): what the server code guarantees around them.
//   O1 migration 0009 keeps the gw_accounts rows of 0006 and gives them their owner's created_at
//   O2 the gateway never opens a fresh broker account over a blob that still holds an account (the migration moves it)
//   O3 a deleted user's broker accounts are archived (closed, kept) and never given to a new user with the same id
//   O4 the WebSocket checks: sessionAlive, userDisabled, accountOpen; gw_live → the admin "on a device now" badge
//   O5 old builds are stopped: /api/lease and PUT /api/state {base, state} answer 423 {since}
//   O6 the blob's execution settings (rollback copy) stay when the new UI saves its display settings
//   O7 the cut-over's freeze: PUT /api/state 503 while ops_flags has 'state_frozen'
// Throwaway SQLite files only. Usage, from 2-cod-sursa: node tests/server/ops.mjs
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, copyFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openGatewayDb, MOVING } from '../../host/gateway/db.mjs';
import { openD1 } from '../../host/d1.mjs';
import * as stateFn from '../../functions/api/state.js';
import * as leaseFn from '../../functions/api/lease.js';
import * as adminFn from '../../functions/api/admin.js';

const DIR = mkdtempSync(join(tmpdir(), 'tb-ops-')), DB = join(DIR, 'tradeberry.db');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const migrate = (dir) => execFileSync(process.execPath, ['host/migrate.mjs', DB, ...(dir ? [dir] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
const DEV = 'abcdef123456', DEV2 = 'fedcba654321';

try {
  // O1: a database at 0008 with a row the gateway opened, then 0009
  {
    const old = join(DIR, 'm8'); mkdirSync(old);
    for (const f of readdirSync('migrations').filter(f => f < '0009')) copyFileSync(join('migrations', f), join(old, f));
    migrate(old);
    const db = new DatabaseSync(DB);
    const user = (id, name, shared = 0, created = 1000) => db.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at, shared) VALUES (?, ?, '00', '00', 1, ?, ?)").run(id, name, created, shared);
    user(1, 'alice'); user(2, 'bob'); user(3, 'team', 1); user(4, 'carol'); user(5, 'boss'); db.prepare('UPDATE users SET admin = 1 WHERE id = 5').run();
    db.prepare("INSERT INTO gw_accounts (user_id, device, account_id) VALUES (1, '', 'u1')").run();
    db.close();
    migrate();
    const d2 = new DatabaseSync(DB), r = d2.prepare("SELECT * FROM gw_accounts WHERE account_id = 'u1'").get();
    ok(r && r.user_id === 1 && r.user_created === 1000 && r.closed_at === null, 'O1 the 0006 row is kept, with its owner created_at: ' + JSON.stringify(r));
    // tools/migrate-accounts.mjs inserts without user_created: the trigger fills it
    d2.prepare("INSERT INTO gw_accounts (user_id, device, account_id, rev, saved_at) VALUES (2, '', 'u2', 7, 1)").run();
    ok(d2.prepare("SELECT user_created FROM gw_accounts WHERE account_id = 'u2'").get().user_created === 1000, 'O1 an insert without user_created takes users.created_at');
    d2.close();
  }
  const G = openGatewayDb(DB), raw = G.db;
  // O2: the guard
  {
    const blob = (uid, data, rev = 3) => raw.prepare('INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (?, ?, ?, NULL, 1) ON CONFLICT (user_id) DO UPDATE SET rev = excluded.rev, data = excluded.data').run(uid, rev, JSON.stringify(data));
    ok(G.account(1, '').account === 'u1' && G.account(2, '').account === 'u2', 'O2 a mapped account is found');
    blob(4, { balance: 100000, positions: [{ id: 1 }], set: { fav: [] } });
    const r4 = G.account(4, '');
    ok(r4.error === MOVING && r4.status === 503 && r4.code === 'MOVING' && !raw.prepare('SELECT 1 FROM gw_accounts WHERE user_id = 4').get(), 'O2 a blob with an account not migrated yet: refused, nothing created: ' + JSON.stringify(r4));
    ok(/being moved to the server; try again in a few minutes/.test(MOVING), 'O2 the refusal says why, for the user');
    blob(4, { set: { fav: ['EURUSD'] }, tk: {} }, 5);
    const r4b = G.account(4, '');
    ok(r4b.account === 'u4' && r4b.created, 'O2 a blob of preferences only: the account opens: ' + JSON.stringify(r4b));
    raw.prepare('INSERT INTO dstate (user_id, device, rev, data, market, saved_at) VALUES (3, ?, 2, ?, NULL, 1)').run(DEV, JSON.stringify({ balance: 5, history: [] }));
    ok(G.account(3, DEV).code === 'MOVING', 'O2 shared login: the browser whose blob holds an account waits for the migration');
    ok(G.account(3, DEV2).account === 'u3-' + DEV2, 'O2 shared login: another browser opens its own portfolio');
    raw.prepare("INSERT INTO gw_accounts (user_id, device, account_id, rev, saved_at) VALUES (3, ?, ?, 2, 1)").run(DEV, 'u3-' + DEV);
    ok(G.account(3, DEV).account === 'u3-' + DEV && !G.account(3, DEV).created, 'O2 once migrated, the same browser gets its moved account');
    ok(G.account(99, '').status === 403, 'O2 an unknown user is refused');
  }
  const D1 = openD1(DB), env = { DB: D1 };
  const boss = { id: 5, username: 'boss', admin: true, shared: false };
  const admin = (b) => adminFn.onRequestPost({ request: new Request('http://x/api/admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }), env, data: { user: boss } });
  const users = async () => (await (await adminFn.onRequestGet({ env, data: { user: boss } })).json()).users;
  // O4: the socket checks and the live badge
  {
    const t = Math.floor(Date.now() / 1000);
    raw.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 1, ?, ?)').run('a'.repeat(64), t, t + 3600);
    raw.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, 2, ?, ?)').run('b'.repeat(64), t - 7200, t - 1);
    ok(G.sessionAlive(1) && G.sessionAlive(1, 'a'.repeat(64)), 'O4 a live session is alive');
    ok(!G.sessionAlive(1, 'c'.repeat(64)) && !G.sessionAlive(2) && !G.sessionAlive(4), 'O4 another token, an expired session or none: not alive');
    ok(!G.userDisabled(1) && G.userDisabled(99), 'O4 userDisabled: a missing user counts as disabled');
    ok((await admin({ op: 'disable', username: 'alice' })).status === 200 && G.userDisabled(1) && !G.sessionAlive(1), 'O4 a disabled user: disabled, no session alive');
    await admin({ op: 'enable', username: 'alice' });
    ok(G.accountOpen('u1') && !G.accountOpen('u404'), 'O4 accountOpen');
    ok(!(await users()).find(u => u.username === 'bob').active, 'O4 no gateway socket: no "on a device now"');
    G.setLive('u2', 2, 2);
    ok((await users()).find(u => u.username === 'bob').active, 'O4 the gateway reports sockets: "on a device now"');
    raw.prepare("UPDATE gw_live SET at = at - 120 WHERE account = 'u2'").run();
    ok(!(await users()).find(u => u.username === 'bob').active, 'O4 a report older than 90 s says nothing');
    G.setLive('u2', 2, 3); G.setLive('u2', 2, 0);
    ok(!raw.prepare("SELECT 1 FROM gw_live WHERE account = 'u2'").get(), 'O4 setLive 0 removes the row');
  }
  // O3: delete archives, a reused id gets a new account
  {
    raw.prepare("INSERT INTO gw_state (account, key, json) VALUES ('u2', 'alerts', '[]')").run();
    G.setLive('u2', 2, 1);
    ok((await admin({ op: 'delete', username: 'bob' })).status === 200, 'O3 bob deleted');
    const row = raw.prepare("SELECT * FROM gw_accounts WHERE account_id = 'u2'").get();
    ok(row && row.closed_at > 0 && row.user_id === 2, 'O3 his broker account is archived (closed, kept): ' + JSON.stringify(row));
    ok(raw.prepare("SELECT 1 FROM gw_state WHERE account = 'u2'").get(), 'O3 its gateway data stay');
    ok(!G.accounts().includes('u2') && !G.accountOpen('u2') && !raw.prepare('SELECT 1 FROM gw_live WHERE user_id = 2').get(), 'O3 the gateway no longer maps it');
    // SQLite gives the id again (here explicitly), same second or not
    raw.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at) VALUES (2, 'dave', '00', '00', 1, 1000)").run();
    const r = G.account(2, '');
    ok(r.account === 'u2-r2' && r.created, 'O3 a new user with the same id gets a new account id: ' + JSON.stringify(r));
    ok(G.account(2, '').account === 'u2-r2', 'O3 and keeps it');
    ok((await admin({ op: 'delete', username: 'dave' })).status === 200, 'O3 dave deleted too');
    raw.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at) VALUES (2, 'erin', '00', '00', 1, 2000)").run();
    ok(G.account(2, '').account === 'u2-r3', 'O3 a third user with the id: u2-r3');
    // a delete that bypassed the archive (a row left open, the user gone): the next user with the id is still another owner
    raw.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at) VALUES (6, 'fay', '00', '00', 1, 3000)").run();
    ok(G.account(6, '').account === 'u6', 'O3 fay: u6');
    raw.prepare('DELETE FROM users WHERE id = 6').run();
    raw.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at) VALUES (6, 'gus', '00', '00', 1, 3001)").run();
    ok(G.account(6, '').account === 'u6-r2' && !G.accountOpen('u6'), 'O3 an open row of a vanished owner is never handed on');
    // tools/tb-user.mjs delete (on a file: TB_DB), the same archive
    const out = execFileSync(process.execPath, ['tools/tb-user.mjs', 'delete', 'gus'], { env: { ...process.env, TB_DB: DB }, input: 'gus\n', encoding: 'utf8' });
    const g = raw.prepare("SELECT closed_at FROM gw_accounts WHERE account_id = 'u6-r2'").get();
    ok(/archived/.test(out) && g.closed_at > 0 && !raw.prepare('SELECT 1 FROM users WHERE id = 6').get(), 'O3 tb-user delete archives the broker accounts too: ' + out.trim().split('\n').pop());
  }
  // O5 / O6: old builds stopped, the blob's execution settings kept
  {
    const alice = { id: 1, username: 'alice', shared: false };
    const req = (method, body) => new Request('http://x/api/state', { method, headers: { 'Content-Type': 'application/json', 'X-TB-Device': DEV }, body: body === undefined ? undefined : JSON.stringify(body) });
    for (const m of ['POST', 'GET']) {
      const r = await leaseFn['onRequest' + (m === 'POST' ? 'Post' : 'Get')]({ request: new Request('http://x/api/lease', { method: m, headers: { 'X-TB-Device': DEV }, body: m === 'POST' ? '{}' : undefined }), env, data: { user: alice } });
      const j = await r.json();
      ok(r.status === 423 && Math.abs(j.since - Date.now() / 1000) < 5, `O5 ${m} /api/lease → 423 {since: now}: ${r.status} ${JSON.stringify(j)}`);
    }
    raw.prepare('INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (1, 4, ?, NULL, 1)').run(JSON.stringify({ balance: 123, positions: [{ id: 9 }], set: { jur: 'eu', lev: 30, slip: 1, slipSd: 0.5, latMs: 80, comm: 7, fav: ['EURUSD'], theme: 'dark' } }));
    const old = await stateFn.onRequestPut({ request: req('PUT', { base: 4, state: { balance: 1 } }), env, data: { user: alice } });
    ok(old.status === 423 && (await old.json()).since > 0, 'O5 an old build saving its account: 423, as "open on another device"');
    const put = await stateFn.onRequestPut({ request: req('PUT', { base: 4, prefs: { set: { fav: ['GBPUSD'], theme: 'light', jur: 'uk', lev: 500 } } }), env, data: { user: alice } });
    const st = JSON.parse(raw.prepare('SELECT data FROM state WHERE user_id = 1').get().data);
    ok(put.status === 200 && st.set.fav.join() === 'GBPUSD' && st.set.theme === 'light', 'O6 the display settings are saved: ' + JSON.stringify(st.set));
    ok(st.set.jur === 'eu' && st.set.lev === 30 && st.set.slip === 1 && st.set.slipSd === 0.5 && st.set.latMs === 80 && st.set.comm === 7, 'O6 the execution settings stay as stored (rollback copy), whatever the browser sent');
    ok(st.balance === 123 && st.positions.length === 1, 'O6 the account keys of the blob stay frozen');
    await stateFn.onRequestPut({ request: req('PUT', { base: 5, prefs: { set: { fav: [] } } }), env, data: { user: alice } });
    const st2 = JSON.parse(raw.prepare('SELECT data FROM state WHERE user_id = 1').get().data);
    ok(!('theme' in st2.set) && st2.set.jur === 'eu', 'O6 a display setting removed is removed; the execution ones still stay');
    // the cut-over's freeze (tools/cutover.sh): every save waits, an old build is still told to stop
    raw.prepare("INSERT INTO ops_flags (k, v) VALUES ('state_frozen', 'test')").run();
    const fr = await stateFn.onRequestPut({ request: req('PUT', { base: 6, prefs: { tk: { lots: 1 } } }), env, data: { user: alice } });
    const rev = raw.prepare('SELECT rev FROM state WHERE user_id = 1').get().rev;
    ok(fr.status === 503 && /being moved to the server/.test((await fr.json()).error) && rev === 6, 'O7 frozen: a save answers 503 and the blob does not change (rev ' + rev + ')');
    ok((await stateFn.onRequestPut({ request: req('PUT', { base: 6, state: {} }), env, data: { user: alice } })).status === 423, 'O7 frozen: an old build still gets 423');
    raw.prepare("DELETE FROM ops_flags WHERE k = 'state_frozen'").run();
    ok((await stateFn.onRequestPut({ request: req('PUT', { base: 6, prefs: { tk: { lots: 1 } } }), env, data: { user: alice } })).status === 200, 'O7 unfrozen: saves again');
  }
  G.close(); D1.sqlite.close();
} catch (e) { fail++; console.log('  ABORT', e.stack); } finally { rmSync(DIR, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
