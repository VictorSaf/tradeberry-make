/* The slice of Cloudflare D1 that functions/ and server/ use, over a local SQLite file (node:sqlite, built into Node).
   prepare(sql).bind(...).first(col?) / .all() / .run() / .raw(), db.batch([...]) in one transaction, db.exec(sql).
   Answers have D1's shapes: all() → { results, success, meta }, run() → { success, meta: { changes, last_row_id } }.
   Foreign keys are on, as in D1. */
import { DatabaseSync } from 'node:sqlite';

// like D1: undefined is an error, not NULL, so a bug found here is the same bug there
const arg = v => { if (v === undefined) throw new TypeError('D1_TYPE_ERROR: undefined bind value'); return typeof v === 'boolean' ? (v ? 1 : 0) : v; };

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...p) { return new Stmt(this.db, this.sql, p.map(arg)); }
  st() { return this.db.prepare(this.sql); }
  async first(col) { const r = this.st().get(...this.params); if (!r) return null; return col === undefined ? { ...r } : r[col]; }
  async all() { return this.allSync(); }
  allSync() {
    const st = this.st();
    if (!st.columns().length) { const m = st.run(...this.params); return { results: [], success: true, meta: { changes: Number(m.changes), last_row_id: Number(m.lastInsertRowid) } }; }
    return { results: st.all(...this.params).map(r => ({ ...r })), success: true, meta: { changes: 0 } };
  }
  async run() { return this.runSync(); }
  runSync() { const m = this.st().run(...this.params); return { success: true, results: [], meta: { changes: Number(m.changes), last_row_id: Number(m.lastInsertRowid) } }; }
  async raw() { const st = this.st(); st.setReturnArrays(true); return st.all(...this.params); }
}

export function openD1(file) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 1000; PRAGMA foreign_keys = ON;');
  return {
    sqlite: db,
    prepare: sql => new Stmt(db, sql),
    async exec(sql) { db.exec(sql); return { count: 1, duration: 0 }; },
    async batch(stmts) {
      db.exec('BEGIN IMMEDIATE');
      try { const out = stmts.map(s => s.allSync()); db.exec('COMMIT'); return out; }
      catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
    },
  };
}
