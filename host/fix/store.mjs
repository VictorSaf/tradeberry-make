// FIX message store: per session (key "SENDER>TARGET") the last inbound seq processed and the last outbound seq sent,
// and every outbound message as written, for resend. One SQLite file per side, given by the caller; WAL with
// synchronous=FULL, so a committed row survives kill -9. Transactions nest (only the outermost commits) and
// afterCommit() defers a socket write until the commit that recorded it: nothing reaches the wire before the disk.
// openStore(file | DatabaseSync): given a connection, the app shares it; inside onApp the app writes only synchronously
// on that same connection (plain statements, or store.tx), never with its own BEGIN, so its rows commit with in_seq.
import { DatabaseSync } from 'node:sqlite';

export function openStore(fileOrDb) {
  const own = !(fileOrDb instanceof DatabaseSync), db = own ? new DatabaseSync(fileOrDb) : fileOrDb;
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
    CREATE TABLE IF NOT EXISTS fix_seq (session TEXT PRIMARY KEY, in_seq INTEGER NOT NULL DEFAULT 0, out_seq INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS fix_out (session TEXT NOT NULL, seq INTEGER NOT NULL, raw BLOB NOT NULL, PRIMARY KEY (session, seq)) WITHOUT ROWID;`);
  const q = {
    get: db.prepare('SELECT in_seq, out_seq FROM fix_seq WHERE session = ?'),
    in: db.prepare('INSERT INTO fix_seq (session, in_seq) VALUES (?, ?) ON CONFLICT (session) DO UPDATE SET in_seq = excluded.in_seq'),
    seq: db.prepare('INSERT INTO fix_seq (session, out_seq) VALUES (?, ?) ON CONFLICT (session) DO UPDATE SET out_seq = excluded.out_seq'),
    add: db.prepare('INSERT OR REPLACE INTO fix_out (session, seq, raw) VALUES (?, ?, ?)'),
    range: db.prepare('SELECT seq, raw FROM fix_out WHERE session = ? AND seq BETWEEN ? AND ? ORDER BY seq'),
  };
  let depth = 0, after = [], sp = 0;
  const st = {
    db,
    seqs: key => { const r = q.get.get(key); return { in: r ? r.in_seq : 0, out: r ? r.out_seq : 0 }; },
    tx(fn) {
      if (depth) { depth++; try { return fn(); } finally { depth--; } }
      db.exec('BEGIN IMMEDIATE'); depth = 1;
      let done = false;
      try { const r = fn(); db.exec('COMMIT'); done = true; return r; }
      finally {
        depth = 0; const a = after; after = [];
        if (!done) { try { db.exec('ROLLBACK'); } catch {} } else for (const f of a) f();
      }
    },
    // inside a tx: fn's writes and the socket writes it queued are undone together if it throws (then rethrows)
    savepoint(fn) {
      if (!depth) throw new Error('savepoint outside a transaction');
      const mark = after.length, name = 'sp' + ++sp;
      db.exec(`SAVEPOINT ${name}`);
      try { const r = fn(); db.exec(`RELEASE ${name}`); return r; }
      catch (e) { db.exec(`ROLLBACK TO ${name}`); db.exec(`RELEASE ${name}`); after.length = mark; throw e; }
    },
    afterCommit(f) { if (depth) after.push(f); else f(); },
    setIn: (key, n) => { q.in.run(key, n); },
    // records outbound message seq (raw as stored: a Logon arrives here with its credentials already masked)
    addOut: (key, seq, raw) => st.tx(() => { q.add.run(key, seq, raw); q.seq.run(key, seq); }),
    range: (key, from, to) => q.range.all(key, from, to),
    close: () => { if (own) db.close(); },
  };
  return st;
}
