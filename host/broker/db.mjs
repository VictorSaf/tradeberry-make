// The temporary broker's database (data/broker.db): the accounts it holds and the FIX store, on ONE SQLite connection,
// so an account change and the ExecutionReport that tells it commit together (host/fix/store.mjs, exactly-once).
// - accounts: one row per account (balance, peak, settings, the id counters, the last rollover); created = the start of
//   its history (a demo Reset starts a new one: the history shown is the trades closed since);
// - positions, orders: the open book, rewritten per account on every change; the json is the account core's object
//   (core/account.js), positions carrying their linked SL / TP orders (slLink, tps[].cl); orders also hold one row per
//   linked order ({ link: true, posId, leg }) so every working ClOrdID is unique and visible;
// - executions (every ExecutionReport sent, { cl, kind, fields }; the order log { type, order }; migrated { type, fill | order, migrated }) and trades (the closed trades, no key: a partial close repeats
//   the position id): append-only, this module has no statement that updates or deletes them;
// - clord: the answer to every ClOrdID received ({ account, out }), sent again unchanged for a repeat from the same account;
// - meta: the broker's own marks (host/broker.mjs, host/broker/recover.mjs): ran:<account> (s, the last moment its book
//   really ran), pending:<account> (JSON { from, why, at }: its recovery waits, nothing executes on it).
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../fix/store.mjs';

// exactly tools/migrate-accounts.mjs BROKER_SCHEMA (the one-off import writes this file before the broker first opens it)
const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, device TEXT NOT NULL DEFAULT '', type TEXT NOT NULL CHECK (type IN ('demo', 'live')),
  balance REAL NOT NULL, peak REAL NOT NULL, set_json TEXT NOT NULL, next_id INTEGER NOT NULL, next_fill INTEGER NOT NULL, roll_last INTEGER, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS positions (id INTEGER NOT NULL, account TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (account, id));
CREATE TABLE IF NOT EXISTS orders (id INTEGER NOT NULL, account TEXT NOT NULL, cl_ord_id TEXT NOT NULL UNIQUE, json TEXT NOT NULL, PRIMARY KEY (account, id));
CREATE TABLE IF NOT EXISTS executions (seq INTEGER PRIMARY KEY AUTOINCREMENT, account TEXT NOT NULL, t REAL NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS executions_account ON executions (account, seq);
CREATE TABLE IF NOT EXISTS trades (id INTEGER NOT NULL, account TEXT NOT NULL, close_t REAL NOT NULL, json TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS trades_account ON trades (account, close_t);
CREATE TABLE IF NOT EXISTS clord (cl_ord_id TEXT PRIMARY KEY, result_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);`;

const fixMs = s => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?$/.exec(s); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0) : NaN; };

export function openBrokerDb(file) {
  const db = new DatabaseSync(file), store = openStore(db); // the store sets WAL + synchronous=FULL
  db.exec('PRAGMA busy_timeout = 10000;' + SCHEMA);
  const q = {
    accts: db.prepare('SELECT * FROM accounts'), acct: db.prepare('SELECT * FROM accounts WHERE id = ?'),
    pos: db.prepare('SELECT json FROM positions WHERE account = ? ORDER BY id'),
    ord: db.prepare('SELECT cl_ord_id, json FROM orders WHERE account = ? ORDER BY id'),
    putAcct: db.prepare(`INSERT INTO accounts (id, user_id, device, type, balance, peak, set_json, next_id, next_fill, roll_last, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET type = excluded.type, balance = excluded.balance, peak = excluded.peak, set_json = excluded.set_json, next_id = excluded.next_id,
      next_fill = excluded.next_fill, roll_last = excluded.roll_last, created = excluded.created`),
    delPos: db.prepare('DELETE FROM positions WHERE account = ?'), addPos: db.prepare('INSERT INTO positions (id, account, json) VALUES (?, ?, ?)'),
    delOrd: db.prepare('DELETE FROM orders WHERE account = ?'), addOrd: db.prepare('INSERT INTO orders (id, account, cl_ord_id, json) VALUES (?, ?, ?, ?)'),
    addExec: db.prepare('INSERT INTO executions (account, t, json) VALUES (?, ?, ?)'),
    execSeq: db.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'executions'"),
    lastExec: db.prepare("SELECT json FROM executions WHERE account = ? AND json ->> 'cl' = ? ORDER BY seq DESC LIMIT 1"),
    // the last report naming cl as its OrigClOrdID (41): a G that replaced it, an F that cancelled it
    lastByOrig: db.prepare("SELECT e.json FROM executions e WHERE e.account = ? AND EXISTS (SELECT 1 FROM json_each(e.json, '$.fields') f WHERE f.value ->> '$[0]' = 41 AND f.value ->> '$[1]' = ?) ORDER BY e.seq DESC LIMIT 1"),
    addTrade: db.prepare('INSERT INTO trades (id, account, close_t, json) VALUES (?, ?, ?, ?)'),
    trades: db.prepare('SELECT json FROM trades WHERE account = ? AND close_t >= ? ORDER BY close_t, rowid'),
    tradeCount: db.prepare('SELECT COUNT(*) n FROM trades WHERE account = ? AND close_t >= ?'),
    tradesPage: db.prepare('SELECT json FROM trades WHERE account = ? AND close_t >= ? ORDER BY close_t DESC, rowid DESC LIMIT ? OFFSET ?'),
    // fill receipts (ERs, migrated fills) and order-log rows, newest first, from seq `from` on
    recFills: db.prepare("SELECT json FROM executions WHERE account = ? AND seq >= ? AND (json ->> '$.kind' = 'fill' OR json ->> '$.type' = 'fill') ORDER BY seq DESC LIMIT ?"),
    recLog: db.prepare("SELECT json FROM executions WHERE account = ? AND seq >= ? AND json ->> '$.type' IN ('filled', 'cancel', 'expire', 'reject') AND json ->> '$.order' IS NOT NULL ORDER BY seq DESC LIMIT ?"),
    setPeak: db.prepare('UPDATE accounts SET peak = ? WHERE id = ?'),
    lastExecT: db.prepare('SELECT MAX(t) t FROM executions WHERE account = ?'),
    metaGet: db.prepare('SELECT v FROM meta WHERE k = ?'), metaSet: db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)'),
    metaDel: db.prepare('DELETE FROM meta WHERE k = ?'), metaLike: db.prepare("SELECT k, v FROM meta WHERE substr(k, 1, length(?)) = ? ORDER BY k"),
    clGet: db.prepare('SELECT result_json FROM clord WHERE cl_ord_id = ?'), clPut: db.prepare('INSERT OR REPLACE INTO clord (cl_ord_id, result_json) VALUES (?, ?)'),
  };
  const J = s => JSON.parse(s);
  // a migrated order's ClOrdID is only in its column
  const row = r => ({ id: r.id, type: r.type, user_id: r.user_id, device: r.device, created: r.created,
    acct: { balance: r.balance, peak: r.peak, set: J(r.set_json), nextId: r.next_id, nextFill: r.next_fill, rollLast: r.roll_last,
      positions: q.pos.all(r.id).map(x => J(x.json)), orders: q.ord.all(r.id).map(x => ({ ...J(x.json), clOrdId: x.cl_ord_id })).filter(o => !o.link) } });
  return {
    db, store,
    // every account as { id, type, user_id, device, created, acct } (acct: the account core's object)
    load: () => q.accts.all().map(row),
    // one account as committed (null: not in the database)
    loadOne: id => { const r = q.acct.get(id); return r ? row(r) : null; },
    save(A) {
      const a = A.acct;
      q.putAcct.run(A.id, A.user_id ?? 0, A.device ?? '', A.type, a.balance, a.peak, JSON.stringify(a.set), a.nextId, a.nextFill, a.rollLast ?? null, A.created); // created: seconds, fractional as in memory (REAL in the INTEGER column)
      q.delPos.run(A.id); q.delOrd.run(A.id);
      for (const p of a.positions) {
        q.addPos.run(p.id, A.id, JSON.stringify(p));
        if (p.slLink) q.addOrd.run(p.slLink.oid, A.id, p.slLink.cl, JSON.stringify({ link: true, posId: p.id, leg: 'SL' }));
        if (p.tpLink) q.addOrd.run(p.tpLink.oid, A.id, p.tpLink.cl, JSON.stringify({ link: true, posId: p.id, leg: 'TP' }));
        for (const l of p.tps || []) if (l.cl) q.addOrd.run(l.oid, A.id, l.cl, JSON.stringify({ link: true, posId: p.id, leg: l.leg }));
      }
      for (const o of a.orders) q.addOrd.run(o.id, A.id, o.clOrdId, JSON.stringify(o));
    },
    nextExecSeq: () => (q.execSeq.get()?.seq ?? 0) + 1,
    addExec: (account, t, json) => { q.addExec.run(account, t, JSON.stringify(json)); },
    lastExec: (account, cl) => { const r = q.lastExec.get(account, cl); return r ? J(r.json) : null; },
    lastByOrig: (account, cl) => { const r = q.lastByOrig.get(account, cl); return r ? J(r.json) : null; },
    lastExecT: account => q.lastExecT.get(account)?.t ?? null,
    metaGet: k => q.metaGet.get(k)?.v ?? null, metaSet: (k, v) => { q.metaSet.run(k, String(v)); }, metaDel: k => Number(q.metaDel.run(k).changes),
    metaLike: prefix => q.metaLike.all(prefix, prefix).map(r => ({ k: r.k, v: r.v })),
    addTrade: (account, row) => { q.addTrade.run(row.id, account, row.close, JSON.stringify(row)); },
    trades: (account, since) => q.trades.all(account, since).map(r => J(r.json)),
    tradeCount: (account, since) => q.tradeCount.get(account, since).n,
    // the newest n after skipping the newest skip, oldest first within the window
    tradesPage: (account, since, n, skip = 0) => q.tradesPage.all(account, since, n, skip).map(r => J(r.json)).reverse(),
    records: (account, from, nFills, nLog) => [...q.recFills.all(account, from, nFills).map(r => J(r.json)), ...q.recLog.all(account, from, nLog).map(r => J(r.json))],
    setPeak: (id, peak) => { q.setPeak.run(peak, id); },
    // { account, out: [[type, fields], …] } (an answer stored before the account was kept: account null)
    clordGet: cl => { const r = q.clGet.get(cl); if (!r) return null; const v = J(r.result_json); return Array.isArray(v) ? { account: null, out: v } : v; },
    clordPut: (cl, account, out) => { q.clPut.run(cl, JSON.stringify({ account, out })); },
    /* fix_out retention: outbound messages sent before cutoffMs (their SendingTime 52) are deleted, per session. Seqs grow
       with time, so the first kept seq is found by bisection. A resend over a deleted range is gap-filled by the session
       (host/fix/session.mjs resend: a seq missing from the store becomes part of a SequenceReset-GapFill). → rows deleted */
    pruneFixOut(cutoffMs) {
      const sent = raw => { const m = /\x0152=(\d{8}-\d\d:\d\d:\d\d(?:\.\d+)?)\x01/.exec(Buffer.from(raw).toString('latin1')); return m ? fixMs(m[1]) : NaN; };
      let n = 0;
      for (const { session } of db.prepare('SELECT DISTINCT session FROM fix_out').all()) {
        const b = db.prepare('SELECT MIN(seq) lo, MAX(seq) hi FROM fix_out WHERE session = ?').get(session), at = db.prepare('SELECT raw FROM fix_out WHERE session = ? AND seq >= ? ORDER BY seq LIMIT 1');
        let lo = b.lo, hi = b.hi + 1; // the first seq sent at or after the cutoff lies in [lo, hi]
        while (lo < hi) { const mid = Math.floor((lo + hi) / 2), r = at.get(session, mid); if (!r || !(sent(r.raw) < cutoffMs)) hi = mid; else lo = mid + 1; }
        n += Number(db.prepare('DELETE FROM fix_out WHERE session = ? AND seq < ?').run(session, lo).changes);
      }
      return n;
    },
    close: () => db.close(),
  };
}
