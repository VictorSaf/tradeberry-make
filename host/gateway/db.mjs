// The gateway's tables in tradeberry.db (migrations/0006_gateway.sql, 0007_gateway_ws.sql) and its FIX store, on ONE
// SQLite connection: what the gateway writes for a broker message (gw_exec, gw_cid) commits with the inbound sequence
// number (host/fix/store.mjs), and a ClOrdID, its cid row and the NewOrderSingle that carries it commit together. Every
// write here is a plain statement: the callers run them inside store.tx (or the session's transaction), never their own BEGIN.
// The schema is the migrations' (host/migrate.mjs, run at the deploy): a database without them is refused.
//
// For the WebSocket server (host/gateway/ws.mjs), cheap checks to run every ~30 s on an open socket (one indexed
// SELECT each, no transaction):
//   sessionAlive(userId, tokenHash?) -> boolean  a session of the user that has not expired (that very session when
//                                                tokenHash, the SHA-256 hex of the cookie token, is given), and the
//                                                user exists and is not disabled; false: close the socket
//   userDisabled(userId) -> boolean              the user is disabled or no longer exists
//   accountOpen(account) -> boolean              the account is still mapped to an existing user (not closed by a delete)
//   setLive(account, userId, n)                  the number of open sockets of an account (0 removes it): the
//                                                administration's "on a device now" badge (gw_live, fresh for 90 s, so
//                                                write it at least once a minute while n > 0)
// account(userId, device) refuses (status 503, code 'MOVING') a login whose blob still holds an account the migration
// has not moved yet (tools/migrate-accounts.mjs): it never opens a fresh broker account over a trading history. The
// text is meant for the user (ws.mjs should show it, not only the status).
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../fix/store.mjs';

export const META_KEYS = ['ctx', 'pm', 'sl0', 'tp0', 'news', 'mae', 'mfe', 'note', 'setup', 'basket', 'bgid', 'timeStop', 'slLast', 'tpLast', 'vol', 'riskUsd'];
// what the gateway's OMS keeps next to them in gw_meta (never set by the meta command): prot { trail, trailNow, trailSl,
// trailed, be, beSl } (the trailing stop and break-even of the position), closedAt (unix s, its flat AP)
const DEVICE_RE = /^[a-z0-9]{12,40}$/; // server/auth.js DEVICE_RE
const CID_DAYS = 7, EXEC_DAYS = 30;
// a blob with any of these keys holds a trading account (app.js ACCT_KEYS: what tools/migrate-accounts.mjs moves)
const ACCOUNT_JSON = ['balance', 'positions', 'orders', 'history'].map(k => `json_type(data, '$.${k}') IS NOT NULL`).join(' OR ');
export const MOVING = 'Your account is being moved to the server; try again in a few minutes';

export function openGatewayDb(file) {
  const db = new DatabaseSync(file), store = openStore(db);
  db.exec('PRAGMA busy_timeout = 2000; PRAGMA foreign_keys = ON;');
  const have = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
  for (const t of ['users', 'sessions', 'state', 'dstate', 'gw_live', 'gw_accounts', 'gw_clord', 'gw_meta', 'gw_state', 'gw_exec', 'gw_cid']) if (!have.has(t)) { db.close(); throw new Error(`gateway: table ${t} is missing (run host/migrate.mjs on the database)`); }
  const q = {
    user: db.prepare('SELECT id, shared, disabled, created_at FROM users WHERE id = ?'),
    // the open account of this user (the same users.id AND created_at: an id reused after a delete is another user)
    acct: db.prepare('SELECT account_id FROM gw_accounts WHERE user_id = ? AND user_created = ? AND device = ? AND closed_at IS NULL'),
    taken: db.prepare('SELECT 1 x FROM gw_accounts WHERE account_id = ?'),
    addAcct: db.prepare('INSERT INTO gw_accounts (user_id, user_created, device, account_id, rev, saved_at) VALUES (?, ?, ?, ?, 0, ?)'),
    accts: db.prepare('SELECT account_id FROM gw_accounts WHERE closed_at IS NULL ORDER BY account_id'),
    acctOpen: db.prepare('SELECT 1 x FROM gw_accounts g JOIN users u ON u.id = g.user_id AND u.created_at = g.user_created WHERE g.account_id = ? AND g.closed_at IS NULL'),
    // a blob (the row the app reads: state for a personal login, dstate for a shared one) that still holds an account
    blob: db.prepare(`SELECT 1 x FROM state WHERE user_id = ? AND rev > 0 AND json_valid(data) AND (${ACCOUNT_JSON})`),
    dblob: db.prepare(`SELECT 1 x FROM dstate WHERE user_id = ? AND device = ? AND rev > 0 AND json_valid(data) AND (${ACCOUNT_JSON})`),
    alive: db.prepare('SELECT 1 x FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.user_id = ? AND s.expires_at > ? AND u.disabled = 0 LIMIT 1'),
    alive1: db.prepare('SELECT 1 x FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.user_id = ? AND s.expires_at > ? AND u.disabled = 0'),
    putLive: db.prepare('INSERT INTO gw_live (account, user_id, n, at) VALUES (?, ?, ?, ?) ON CONFLICT (account) DO UPDATE SET user_id = excluded.user_id, n = excluded.n, at = excluded.at'),
    delLive: db.prepare('DELETE FROM gw_live WHERE account = ?'),
    clord: db.prepare('INSERT INTO gw_clord (account, n) VALUES (?, 2) ON CONFLICT (account) DO UPDATE SET n = n + 1 RETURNING n - 1 AS n'),
    exec: db.prepare('INSERT OR IGNORE INTO gw_exec (account, exec_id, t, json) VALUES (?, ?, ?, ?)'),
    recent: db.prepare('SELECT json FROM gw_exec WHERE account = ? ORDER BY seq DESC LIMIT ?'),
    cid: db.prepare('SELECT json FROM gw_cid WHERE account = ? AND cid = ?'),
    delCid: db.prepare('DELETE FROM gw_cid WHERE account = ? AND cid = ?'),
    putCid: db.prepare('INSERT INTO gw_cid (account, cid, json, at) VALUES (?, ?, ?, ?) ON CONFLICT (account, cid) DO UPDATE SET json = excluded.json'),
    open: db.prepare("SELECT account, cid, json FROM gw_cid WHERE json ->> '$.reply' IS NULL"),
    prune: db.prepare('DELETE FROM gw_cid WHERE at < ?'),
    meta: db.prepare('SELECT pos_id, json FROM gw_meta WHERE account = ?'),
    meta1: db.prepare('SELECT json FROM gw_meta WHERE account = ? AND pos_id = ?'),
    putMeta: db.prepare('INSERT INTO gw_meta (account, pos_id, json) VALUES (?, ?, ?) ON CONFLICT (account, pos_id) DO UPDATE SET json = excluded.json'),
    state: db.prepare('SELECT key, json FROM gw_state WHERE account = ?'),
    state1: db.prepare('SELECT json FROM gw_state WHERE account = ? AND key = ?'),
    putState: db.prepare('INSERT INTO gw_state (account, key, json) VALUES (?, ?, ?) ON CONFLICT (account, key) DO UPDATE SET json = excluded.json'),
    delState: db.prepare('DELETE FROM gw_state WHERE account = ? AND key = ?'),
    stateAccts: db.prepare("SELECT DISTINCT account FROM gw_state WHERE account <> '*' UNION SELECT DISTINCT account FROM gw_meta"),
    hasFill: db.prepare("SELECT 1 x FROM gw_exec WHERE account = ? AND json ->> '$.ids.clOrdId' = ? AND json ->> '$.kind' = 'fill' LIMIT 1"),
    lastExec: db.prepare("SELECT json FROM gw_exec WHERE account = ? AND json ->> '$.ids.clOrdId' = ? AND json ->> '$.kind' IN ('fill', 'reject') ORDER BY seq DESC LIMIT 1"),
    pruneExec: db.prepare('DELETE FROM gw_exec WHERE t < ?'),
    pruneMeta: db.prepare("DELETE FROM gw_meta WHERE json ->> '$.closedAt' IS NOT NULL AND json ->> '$.closedAt' < ?"),
  };
  const J = s => JSON.parse(s), now = () => Math.floor(Date.now() / 1000);
  store.tx(() => q.prune.run(now() - CID_DAYS * 86400));
  return {
    db, store,
    // the broker account of a login: u<id>, or u<id>-<device> on a shared login (one per browser); created on first use,
    // except over a blob that still holds an account (the migration moves it first). An account id is never given to
    // a second user: one already used (a deleted user's, kept closed) gets -r2, -r3… -> { account, created } | { error, status, code? }
    account(userId, device) {
      const u = Number.isInteger(userId) ? q.user.get(userId) : null;
      if (!u || u.disabled) return { error: 'Unknown user', status: 403 };
      const dev = u.shared ? device : '';
      if (u.shared && !DEVICE_RE.test(dev || '')) return { error: 'Missing device id', status: 400 };
      const r = q.acct.get(u.id, u.created_at, dev);
      if (r) return { account: r.account_id, created: false };
      if (dev ? q.dblob.get(u.id, dev) : q.blob.get(u.id)) return { error: MOVING, status: 503, code: 'MOVING' };
      const base = dev ? `u${u.id}-${dev}` : `u${u.id}`;
      let id = base;
      for (let n = 2; q.taken.get(id); n++) id = `${base}-r${n}`;
      store.tx(() => q.addAcct.run(u.id, u.created_at, dev, id, now()));
      return { account: id, created: true };
    },
    accounts: () => q.accts.all().map(r => r.account_id),
    accountOpen: account => !!q.acctOpen.get(String(account)),
    sessionAlive: (userId, tokenHash) => Number.isInteger(userId) && !!(tokenHash ? q.alive1.get(String(tokenHash), userId, now()) : q.alive.get(userId, now())),
    userDisabled: userId => { const u = Number.isInteger(userId) ? q.user.get(userId) : null; return !u || !!u.disabled; },
    setLive: (account, userId, n) => { if (n > 0) q.putLive.run(String(account), userId, n, now()); else q.delLive.run(String(account)); },
    // the next ClOrdID of an account (gw_clord n is the next number): tb-<account>-<n>; inside the caller's transaction
    nextClOrdId: account => `tb-${account}-${q.clord.get(account).n}`,
    // false when (account, ExecID) is already recorded
    addExec: (account, execId, t, ev) => q.exec.run(account, String(execId), t, JSON.stringify(ev)).changes === 1,
    recentExecs: (account, n = 200) => q.recent.all(account, n).map(r => J(r.json)).reverse(),
    cid: (account, cid) => { const r = q.cid.get(account, cid); return r ? J(r.json) : null; },
    putCid: (account, cid, o) => { q.putCid.run(account, cid, JSON.stringify(o), now()); },
    delCid: (account, cid) => { q.delCid.run(account, cid); },
    openCids: () => q.open.all().map(r => ({ account: r.account, cid: r.cid, row: J(r.json) })),
    metaAll: account => new Map(q.meta.all(account).map(r => [r.pos_id, J(r.json)])),
    meta: (account, posId) => { const r = q.meta1.get(account, posId); return r ? J(r.json) : null; },
    putMeta: (account, posId, m) => { q.putMeta.run(account, posId, JSON.stringify(m)); },
    // every key of an account but the gateway's own bookkeeping (gw_state account '*': the OMS clock)
    state: account => Object.fromEntries(q.state.all(account).map(r => [r.key, J(r.json)])),
    state1: (account, key) => { const r = q.state1.get(account, key); return r ? J(r.json) : null; },
    putState: (account, key, v) => { if (v == null) q.delState.run(account, key); else q.putState.run(account, key, JSON.stringify(v)); },
    stateAccounts: () => q.stateAccts.all().map(r => r.account),
    hasFill: (account, cl) => !!q.hasFill.get(account, cl), // index gw_exec_cl (migrations/0008)
    lastExec: (account, cl) => { const r = q.lastExec.get(account, cl); return r ? J(r.json) : null; },
    // retention: ExecutionReports older than 30 days; the journal fields of a position closed more than 90 days ago
    // (closedAt, set when its flat AP arrives; the history row keeps its own copy at the broker)
    prune(t = now()) { return store.tx(() => ({ exec: q.pruneExec.run(t - EXEC_DAYS * 86400).changes, meta: 0, /* journals are kept as long as the trade history (never truncated) */ cid: q.prune.run(t - CID_DAYS * 86400).changes })); },
    close: () => db.close(),
  };
}
