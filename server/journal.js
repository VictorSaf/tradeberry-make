/* The complete journal of one client, for the Administration screen (GET /api/admin?journal=<username>; Victor,
   12.11.2026). Read only: one timeline, newest first, from three places that keep everything:
   - tradeberry.db audit_log: the user's sign-ins and sign-outs and what administrators did to the account;
   - the broker's data/broker.db (append-only, host/broker/db.mjs): executions = every ExecutionReport sent to the user's
     accounts (order accepted, filled, cancelled, rejected, restated), the order log (orders that left the book) and the
     migrated rows; trades = every closed trade. Opened here with readOnly: the broker keeps writing in WAL mode.
   The accounts are the user's by gw_accounts (user_id + user_created = users.created_at, migration 0009), so a user who
   gets a deleted user's id never sees that user's history. A shared login has one account per browser (device).
   Paging: rows with t < before, `limit` of them; next = the last row's t when there may be more. */
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { reportToExec } from '../host/fix/dialect.mjs';

export const JOURNAL_MAX = 1000;
const r6 = v => (Number.isFinite(+v) ? Math.round(+v * 1e6) / 1e6 : null);

// one stored broker execution row → a journal row (null: nothing to show)
export function execRow(account, t, j) {
  const base = { t, acc: account };
  if (j && Array.isArray(j.fields)) {
    let e;
    try { e = reportToExec({ fields: new Map(j.fields.map(([k, v]) => [String(k), String(v)])), groups: new Map() }); }
    catch (x) { return { ...base, cat: 'other', what: j.kind || 'report', cl: j.cl || null }; }
    if (e.kind === 'fill') { const r = e.receipt || {}; return { ...base, cat: 'fill', what: 'Filled', sym: r.sym, side: r.side, lots: r6(r.lots), px: r6(r.px), pos: r.pos ?? null, reason: r.reason || null, comm: r6(r.comm), slip: r6(r.slip), cl: e.ids.clOrdId || null }; }
    const o = e.order || {}, what = { new: 'Order accepted', cancel: 'Order cancelled', reject: 'Order rejected', restated: 'Order changed', replaced: 'Order modified', status: 'Order status' }[e.kind] || e.kind;
    return { ...base, cat: e.kind === 'reject' ? 'reject' : e.kind === 'cancel' ? 'cancel' : 'order', what, sym: e.ids.sym, side: e.ids.side, lots: r6(e.ids.lots), ot: o.ot || null, px: r6(o.price), limit: r6(o.limit), code: e.code || null, text: e.text || null, cl: e.ids.clOrdId || null };
  }
  if (j && j.type && (j.order || j.fill)) {
    const x = j.order || j.fill;
    return { ...base, cat: j.fill ? 'fill' : 'log', what: (j.migrated ? 'Migrated · ' : 'Order log · ') + j.type, sym: x.sym, side: x.side, lots: r6(x.lots), ot: x.ot || null, px: r6(x.px ?? x.price), status: x.status || null, text: x.why || x.reason || null };
  }
  return null;
}
export function tradeRow(account, j) {
  return { t: j.close, acc: account, cat: 'close', what: j.nbp ? 'Negative balance protection' : 'Trade closed', sym: j.sym, side: j.side, lots: r6(j.lots), entry: r6(j.entry), px: r6(j.exit), pnl: r6(j.pnl), pips: r6(j.pips), swap: r6(j.swap), reason: j.reason || null, open: j.open ?? null, pos: j.id ?? null };
}
const AUDIT_WHAT = { 'login.ok': 'Signed in', 'login.fail': 'Sign-in refused', 'login.locked': 'Sign-in locked', logout: 'Signed out' };

export async function journal(env, username, { before, limit } = {}) {
  const lim = Math.min(JOURNAL_MAX, Math.max(1, Math.round(+limit || 300))), b = +before > 0 ? +before : Infinity;
  const u = await env.DB.prepare('SELECT id, username, created_at FROM users WHERE username = ?').bind(username).first();
  if (!u) return null;
  const accRows = (await env.DB.prepare('SELECT account_id, device, closed_at FROM gw_accounts WHERE user_id = ? AND user_created = ? ORDER BY account_id').bind(u.id, u.created_at).all()).results || [];
  const rows = [], accounts = [];
  const aud = (await env.DB.prepare(`SELECT at, actor, ip, action, target, ok, detail FROM audit_log WHERE at >= ? AND at < ? AND (actor = ? OR target = ?) ORDER BY at DESC, id DESC LIMIT ?`)
    .bind(u.created_at, Number.isFinite(b) ? b : 4e9, username, username, lim).all()).results || [];
  for (const a of aud) rows.push({ t: a.at, cat: a.action.startsWith('login') || a.action === 'logout' ? 'session' : 'admin', what: AUDIT_WHAT[a.action] || (a.action.startsWith('admin.') ? 'Administrator · ' + a.action.slice(6) : a.action), actor: a.actor, ip: a.ip, ok: !!a.ok, text: a.detail || null });
  const file = join(env.TB_DATA || '.', 'broker.db');
  let broker = 'none';
  if (accRows.length && existsSync(file)) {
    const db = new DatabaseSync(file, { readOnly: true });
    try {
      broker = 'ok';
      const acct = db.prepare('SELECT type, balance, created FROM accounts WHERE id = ?');
      const nPos = db.prepare('SELECT COUNT(*) n FROM positions WHERE account = ?'), nOrd = db.prepare('SELECT COUNT(*) n FROM orders WHERE account = ?');
      const ex = db.prepare('SELECT t, json FROM executions WHERE account = ? AND t < ? ORDER BY seq DESC LIMIT ?');
      const tr = db.prepare('SELECT json FROM trades WHERE account = ? AND close_t < ? ORDER BY close_t DESC, rowid DESC LIMIT ?');
      const B = Number.isFinite(b) ? b : 4e9;
      for (const a of accRows) {
        const s = acct.get(a.account_id);
        accounts.push({ id: a.account_id, device: a.device || '', closed: a.closed_at || null, type: s ? s.type : null, balance: s ? r6(s.balance) : null, since: s ? s.created : null, positions: nPos.get(a.account_id).n, orders: nOrd.get(a.account_id).n });
        for (const e of ex.all(a.account_id, B, lim)) { let j = null; try { j = JSON.parse(e.json); } catch (x) { /* unreadable row */ } const r = execRow(a.account_id, e.t, j); if (r) rows.push(r); }
        for (const e of tr.all(a.account_id, B, lim)) { let j = null; try { j = JSON.parse(e.json); } catch (x) { continue; } rows.push(tradeRow(a.account_id, j)); }
      }
    } finally { db.close(); }
  } else if (accRows.length) broker = 'missing';
  rows.sort((x, y) => y.t - x.t);
  const out = rows.slice(0, lim);
  return { user: u.username, created: u.created_at, accounts, broker, rows: out, next: rows.length > lim ? out[out.length - 1].t : null };
}
