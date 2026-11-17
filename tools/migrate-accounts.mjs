#!/usr/bin/env node
/* tradeBerry: the one-time move of the accounts from the state blob (tradeberry.db: state for a personal login, dstate
   for a shared one) to the broker (data/broker.db) and the gateway tables (gw_*, migrations/0006_gateway.sql). Run on
   the Mac mini at the deploy, before the broker starts, from the code folder:
     node tools/migrate-accounts.mjs              migrate every account not in the broker yet
     node tools/migrate-accounts.mjs --dry-run    say what would be written, write nothing
     node tools/migrate-accounts.mjs --verify     compare every account, blob against broker; exit 1 on any difference
                                     --accept-repairs: what the loader repaired or left out (and the counts that
                                     follow from it) is listed but not counted as a difference
   --db <file> (else TB_DB, else .data/tradeberry.db), --broker <file> (else TB_BROKER_DB, else broker.db next to the
   database), --quotes <file.json> ({ SYM: bid | [bid, ask] }) for --verify: the prices the equity is compared at
   (else the blob's market snapshot; an instrument still without a price is valued at the position's entry, both sides).
   Pending orders keep their exits on the broker json and get them in gw_state ordMeta too (the browser's view, the
   gateway's trail / break-even after the fill). --verify after the cut-over: a newer blob rev (a preferences save) is
   not a difference by itself; the account keys of the blob are what is compared.
   CUT-OVER ORDER: freeze PUT /api/state (no browser may save a blob any more) before migrating; a blob saved after its
   account was migrated (a newer rev than gw_accounts.rev) is reported as a difference, never skipped in silence.
   Each blob goes through the browser's own loader (sanitizeState with its wrappers, normalizeOrders, loadState), run
   here in a VM without the DOM, with the row's market snapshot (the v14 CFDs retire at their saved price) and the row's
   saved_at as the market time (a record without its time gets the save time), so the broker gets the account the
   browser would show. Only the row the app reads is migrated: state where users.shared = 0, dstate where shared = 1.
   Account ids: u<user_id>, u<user_id>-<device> for a shared login (one per dstate row). Pending orders get a new
   ClOrdID tb-<account>-<n> (gw_clord keeps the next n); ids, OCO groups (oca) and order → position links (src) stay.
   The journal fields of an open position go to gw_meta; a history row keeps its own copy (in trades). accounts.created
   is the start of the migrated history (the broker shows the trades closed since).
   Idempotent per account: an account in the broker and in gw_accounts is skipped, never replaced (the broker may have
   traded it since). Each account is written in one transaction over both databases; a split commit is repaired on the
   next run: gateway rows without a broker account are rewritten whole; a broker account without its gateway rows gets
   them from the blob while it has no execution of its own yet (else it is refused, to be checked by hand).
   The blob rows are only read; --dry-run and --verify never change either database. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync } from 'node:fs';
import { runInContext, createContext } from 'node:vm';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MarketCore, CATALOG } from '../core/market.mjs';
import { AccountCore } from '../core/account.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const META_KEYS = ['ctx', 'pm', 'sl0', 'tp0', 'news', 'mae', 'mfe', 'note', 'setup', 'basket', 'bgid', 'timeStop'];
export const STATE_KEYS = ['chal', 'bkPos', 'bkOrders', 'bkHist', 'bkAlerts', 'alerts'];
const PROT_KEYS = ['trail', 'trailNow', 'trailSl', 'trailed', 'be', 'beSl'];
const EXEC_SET = ['jur', 'lev', 'slip', 'slipSd', 'latMs', 'comm'];
const LOG_TYPE = { filled: 'filled', cancelled: 'cancel', expired: 'expire', rejected: 'reject' };
const BROKER_TABLES = ['accounts', 'positions', 'orders', 'executions', 'trades', 'clord'];
// data/broker.db: the same tables as host/broker/db.mjs (ids are per account; trades have no key, a partial close
// repeats the position id)
export const BROKER_SCHEMA = `
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

/* The browser's loader in Node: catalog, market core, engine, app, account core, trade and challenge (its sanitizeState
   wrapper) in one VM context with an inert DOM; the app never boots (readyState 'loading'). The scripts are not changed;
   only Engine.simTime (→ now) and Engine.usd (→ the snapshot's currency levels, as the engine resumed from it would
   answer) are set for each call, and store.getMarket gives the snapshot to retireLegacy.
   load(raw, { market, now }) → { S, dropped, migrated, repaired } or { reason } when the browser would refuse it. */
export function appLoader() {
  const any = new Proxy(function () {}, { get: (t, k) => k === Symbol.toPrimitive ? () => '' : any, apply: () => any, construct: () => any, set: () => true });
  const document = new Proxy({ readyState: 'loading', addEventListener() {} }, { get: (t, k) => k in t ? t[k] : any });
  const quiet = { log() {}, info() {}, warn() {}, error() {}, debug() {} };
  const ctx = createContext({ console: quiet, document, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0, clearInterval() {}, location: { search: '', hash: '' },
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} }, addEventListener() {}, removeEventListener() {} });
  ctx.window = ctx;
  for (const f of ['catalog.js', 'core/market.js', 'engine.js', 'app.js', 'core/account.js', 'trade.js', 'challenge.js']) runInContext(readFileSync(join(ROOT, f), 'utf8'), ctx, { filename: f });
  const fn = runInContext(`(() => {
    let now = 0, L = null, mk = null;
    Object.defineProperty(Engine, 'simTime', { get: () => now, configurable: true });
    const usd0 = Engine.usd;
    Engine.usd = c => { if (c === 'USD') return 1; if (L && Number.isFinite(L[c])) return Math.exp(L[c]); return usd0(c); };
    store.getMarket = () => mk;
    return (raw, market, t) => {
      now = t; mk = market; L = market && market.L && typeof market.L === 'object' ? market.L : null;
      const opts = { repairBalance: true, market };
      if (!sanitizeState(raw, opts)) return JSON.stringify({ reason: opts.reason || 'not an account' });
      store.get = () => raw; loadState();
      const mig = opts.migrated || [];
      return JSON.stringify({ S, dropped: (opts.dropped || []).filter(x => !mig.includes(x)), migrated: mig, repaired: opts.repaired || null });
    };
  })()`, ctx);
  return (raw, { market = null, now = 0 } = {}) => JSON.parse(fn(JSON.parse(JSON.stringify(raw)), market ? JSON.parse(JSON.stringify(market)) : null, now)); // plain objects of this realm
}
// what the loader changed: repaired or left out, the v14 retirement, a reset balance
export const issuesOf = L => [...L.dropped, ...L.migrated, ...(L.repaired ? [`balance ${JSON.stringify(L.repaired.balance)} not valid, reset to the starting balance`] : [])];

const pick = (o, keys) => Object.fromEntries(keys.filter(k => o && k in o).map(k => [k, o[k]]));
const accountId = (uid, device) => device ? `u${uid}-${device}` : `u${uid}`;
// the start of the account's history: its earliest closed trade, open position, pending order or challenge attempt
export function createdOf(S) {
  const ts = [...S.history.map(h => h.close), ...S.positions.map(p => p.open), ...S.orders.map(o => o.created), S.chal && S.chal.att ? S.chal.att.start : null]
    .filter(v => Number.isFinite(v) && v > 0);
  return ts.length ? Math.floor(Math.min(...ts)) : 0;
}

// the rows of one account, from the loaded S
export function plan(S, { id, uid, device, t }) {
  const positions = S.positions.map(p => {
    const json = {}, meta = {};
    for (const [k, v] of Object.entries(p)) (META_KEYS.includes(k) ? meta : json)[k] = v;
    // the gateway runs the trailing stop and the break-even (gw_meta prot); a basket leg is a hedged position at the broker
    const prot = Object.fromEntries(PROT_KEYS.filter(k => p[k] !== undefined && p[k] !== null).map(k => [k, p[k]]));
    if (Object.keys(prot).length) meta.prot = prot;
    if (p.bgid || p.basket) json.hedge = true;
    return { id: p.id, json, meta };
  });
  const orders = [...S.orders].sort((a, b) => a.id - b.id).map((o, i) => ({ id: o.id, clOrdId: `tb-${id}-${i + 1}`, json: o }));
  // a pending order's exits stay on its broker json (slPips, tpPips, tps rows, trail, be: what the broker's fill uses, I5)
  // and go to the gateway's view of it too (gw_state ordMeta, by ClOrdID): the browser shows them, and at the fill the
  // gateway takes the trail and the break-even over (prot) and the journal (pm, ctx); it creates no leg itself
  const ordMeta = {};
  for (const { clOrdId, json: o } of orders) {
    const ex = {};
    if (o.slPips > 0) ex.slPips = o.slPips;
    if (Array.isArray(o.tps) && o.tps.length) ex.tps = o.tps.map(r => ({ pips: +r.pips, pct: +r.pct })); else if (o.tpPips > 0) ex.tpPips = o.tpPips;
    if (o.trail > 0) ex.trail = o.trail;
    if (o.be && typeof o.be === 'object') ex.be = { at: o.be.at ?? null, off: +o.be.off || 0, onTp: !!o.be.onTp, done: false };
    const jm = {}; if (o.pm && typeof o.pm === 'object') jm.pm = o.pm; if (Array.isArray(o.ctx)) jm.ctx = o.ctx;
    if (Object.keys(ex).length || Object.keys(jm).length) ordMeta[clOrdId] = { t: +o.created || t, sym: o.sym, side: o.side, lots: o.lots, ot: o.limit != null ? 'stoplimit' : o.ot, exits: ex, meta: jm };
  }
  // newest first in the blob → oldest first here; fills and the order log merged in time order
  const ex = [
    ...[...(S.fills || [])].reverse().map(f => ({ t: +f.t || 0, json: { type: 'fill', fill: f, migrated: true } })),
    ...[...(S.ordLog || [])].reverse().map(o => ({ t: +(o.end ?? o.created) || 0, json: { type: LOG_TYPE[o.status] || o.status, order: o, migrated: true } }))
  ].sort((a, b) => a.t - b.t);
  return {
    account: { id, user_id: uid, device, type: 'demo', balance: S.balance, peak: S.peak, set_json: JSON.stringify(pick(S.set, EXEC_SET)), next_id: S.nextId, next_fill: S.nextFill, roll_last: t, created: createdOf(S) },
    positions, orders, executions: ex,
    trades: [...S.history].reverse().map(h => ({ id: h.id, close_t: h.close, json: h })),
    state: [...STATE_KEYS.filter(k => S[k] !== undefined).map(k => ({ key: k, json: S[k] })), ...(Object.keys(ordMeta).length ? [{ key: 'ordMeta', json: ordMeta }] : [])],
    nextN: orders.length + 1
  };
}

const J = JSON.stringify;
// t: the migration time, the account's meta ran:<account> (the time before the cut-over was executed by no one: the
// broker's recovery does not replay it)
function writeBroker(db, r, t) {
  const a = r.account;
  db.prepare('INSERT OR REPLACE INTO b.meta (k, v) VALUES (?, ?)').run('ran:' + a.id, String(t));
  db.prepare('INSERT INTO b.accounts (id, user_id, device, type, balance, peak, set_json, next_id, next_fill, roll_last, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(a.id, a.user_id, a.device, a.type, a.balance, a.peak, a.set_json, a.next_id, a.next_fill, a.roll_last, a.created);
  const ip = db.prepare('INSERT INTO b.positions (id, account, json) VALUES (?, ?, ?)');
  for (const p of r.positions) ip.run(p.id, a.id, J(p.json));
  const io = db.prepare('INSERT INTO b.orders (id, account, cl_ord_id, json) VALUES (?, ?, ?, ?)');
  for (const o of r.orders) io.run(o.id, a.id, o.clOrdId, J(o.json));
  const ie = db.prepare('INSERT INTO b.executions (account, t, json) VALUES (?, ?, ?)');
  for (const e of r.executions) ie.run(a.id, e.t, J(e.json));
  const it = db.prepare('INSERT INTO b.trades (id, account, close_t, json) VALUES (?, ?, ?, ?)');
  for (const h of r.trades) it.run(h.id, a.id, h.close_t, J(h.json));
}
function writeGw(db, r, row) {
  const a = r.account, im = db.prepare('INSERT INTO gw_meta (account, pos_id, json) VALUES (?, ?, ?)'), is = db.prepare('INSERT INTO gw_state (account, key, json) VALUES (?, ?, ?)');
  for (const p of r.positions) if (Object.keys(p.meta).length) im.run(a.id, p.id, J(p.meta));
  for (const s of r.state) is.run(a.id, s.key, J(s.json));
  db.prepare('INSERT INTO gw_clord (account, n) VALUES (?, ?)').run(a.id, r.nextN);
  db.prepare('INSERT INTO gw_accounts (user_id, device, account_id, rev, saved_at) VALUES (?, ?, ?, ?, ?)').run(a.user_id, a.device, a.id, row.rev, row.saved_at);
}
function dropGw(db, id) { for (const [t, k] of [['gw_meta', 'account'], ['gw_state', 'account'], ['gw_clord', 'account'], ['gw_accounts', 'account_id']]) db.prepare(`DELETE FROM ${t} WHERE ${k} = ?`).run(id); }
function inTx(db, f) { db.exec('BEGIN IMMEDIATE'); try { f(); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } }

/* ---------- verify: the account as the blob gives it against what the broker holds, at the same prices ---------- */
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const POS_LEVELS = ['sym', 'side', 'lots', 'entry', 'sl', 'tp', 'tps', 'be', 'beSl', 'trail', 'trailNow', 'trailSl', 'swap', 'comm', 'im', 'open', 'src'];
const ORD_LEVELS = ['sym', 'side', 'ot', 'price', 'limit', 'lots', 'slPips', 'tpPips', 'tps', 'be', 'trail', 'tif', 'expires', 'oca', 'status', 'net'];
function marketFor(snap, fixed, positions, ms) {
  const mk = MarketCore.create({ catalog: CATALOG, now: () => ms }), L = snap && snap.L && typeof snap.L === 'object' ? snap.L : {};
  const lv = c => c === 'USD' ? 0 : Number.isFinite(L[c]) ? L[c] : NaN, rows = [], at = [];
  for (const m of Object.values(mk.META)) {
    const f = fixed[m.sym];
    if (Array.isArray(f)) { rows.push([m.sym, f[0], f[1], ms]); continue; }
    const bid = Number.isFinite(f) ? f : m.kind === 'fx' ? Math.exp(lv(m.base) - lv(m.quote)) : Number.isFinite(L[m.sym]) ? Math.exp(L[m.sym]) : NaN;
    if (bid > 0) rows.push([m.sym, bid, undefined, ms]);
  }
  mk.setQuotes(rows);
  for (const p of positions) if (!mk.last(p.sym) && p.entry > 0) { mk.setQuotes([[p.sym, p.entry, undefined, ms]]); at.push(p.sym); }
  return { mk, at };
}
function compare(id, before, after, mk) {
  const out = [], core = AccountCore.create({ market: mk }), clone = v => JSON.parse(JSON.stringify(v));
  const eq = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)) : canon(a) === canon(b);
  for (const k of ['balance', 'peak']) if (!eq(before[k], after[k])) out.push(`${id} ${k}: ${before[k]} ≠ ${after[k]}`);
  const e0 = core.summary({ balance: before.balance, positions: clone(before.positions), set: before.set }).eq, e1 = core.summary({ balance: after.balance, positions: clone(after.positions), set: after.set }).eq;
  if (!Number.isFinite(e0) || !Number.isFinite(e1)) out.push(`${id} equity: not computable (no price for an instrument or a currency; pass --quotes)`);
  else if (Math.abs(e0 - e1) > 1e-6) out.push(`${id} equity: ${e0.toFixed(2)} ≠ ${e1.toFixed(2)}`);
  for (const [what, A, B, keys] of [['position', before.positions, after.positions, POS_LEVELS], ['order', before.orders, after.orders, ORD_LEVELS]]) {
    if (A.length !== B.length) out.push(`${id} ${what}s: ${A.length} ≠ ${B.length}`);
    for (const x of A) {
      const y = B.find(z => z.id === x.id);
      if (!y) { out.push(`${id} ${what} #${x.id}: missing in the broker`); continue; }
      for (const k of keys) if (!eq(x[k] ?? null, y[k] ?? null)) out.push(`${id} ${what} #${x.id}: ${k} ${canon(x[k] ?? null)} ≠ ${canon(y[k] ?? null)}`);
    }
    for (const y of B) if (!A.some(x => x.id === y.id)) out.push(`${id} ${what} #${y.id}: in the broker only`);
  }
  return { out, eq: e0 };
}
function readBack(db, id) {
  const a = db.prepare('SELECT * FROM b.accounts WHERE id = ?').get(id);
  if (!a) return null;
  const rows = t => db.prepare(`SELECT id, json FROM b.${t} WHERE account = ? ORDER BY id`).all(id).map(r => ({ ...JSON.parse(r.json), id: r.id }));
  const n = (sql, ...p) => db.prepare(sql).get(id, ...p).n;
  return {
    balance: a.balance, peak: a.peak, created: a.created, set: JSON.parse(a.set_json), positions: rows('positions'), orders: rows('orders').filter(o => !o.link),
    trades: n('SELECT COUNT(*) n FROM b.trades WHERE account = ?'), shown: n('SELECT COUNT(*) n FROM b.trades WHERE account = ? AND close_t >= ?', a.created),
    executions: n("SELECT COUNT(*) n FROM b.executions WHERE account = ? AND json ->> 'migrated' IS NOT NULL"),
    meta: db.prepare('SELECT pos_id FROM gw_meta WHERE account = ? ORDER BY pos_id').all(id).map(r => r.pos_id),
    state: db.prepare('SELECT key FROM gw_state WHERE account = ? ORDER BY key').all(id).map(r => r.key)
  };
}
const rawLen = v => Array.isArray(v) ? v.length : 0;

/* ---------- command line ---------- */
async function main() {
  const args = process.argv.slice(2), flag = n => args.includes(n), val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const die = m => { console.error(m); process.exit(1); };
  const dbFile = resolve(val('--db') || process.env.TB_DB || join(ROOT, '.data', 'tradeberry.db'));
  const brFile = resolve(val('--broker') || process.env.TB_BROKER_DB || join(dirname(dbFile), 'broker.db'));
  const dry = flag('--dry-run'), verify = flag('--verify'), accept = flag('--accept-repairs');
  if (!existsSync(dbFile)) die(`No database at ${dbFile}`);
  if (verify && !existsSync(brFile)) die(`No broker database at ${brFile}`);
  const fixed = val('--quotes') ? JSON.parse(readFileSync(val('--quotes'), 'utf8')) : {};
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
  const gwCols = db.prepare("SELECT name FROM pragma_table_info('gw_accounts')").all().map(r => r.name);
  if (!gwCols.includes('rev')) die(`No gateway tables (0006) in ${dbFile}: run node host/migrate.mjs ${dbFile} first`);
  // the broker file: written only by a migration; a dry run or a verify reads it and never adds a table to it
  const hasTables = f => { if (!existsSync(f)) return false; const x = new DatabaseSync(f, { readOnly: true }), n = x.prepare(`SELECT COUNT(*) n FROM sqlite_master WHERE type = 'table' AND name IN (${BROKER_TABLES.map(() => '?').join()})`).get(...BROKER_TABLES).n; x.close(); return n === BROKER_TABLES.length; };
  const brOk = hasTables(brFile);
  if (verify && !brOk) die(`${brFile} is not a broker database (tables missing)`);
  const mem = dry && !brOk; // a dry run on no broker yet: an empty one in memory
  db.prepare('ATTACH DATABASE ? AS b').run(mem ? ':memory:' : brFile);
  if (mem || (!dry && !verify)) db.exec(BROKER_SCHEMA.replace(/EXISTS (\w+)/g, 'EXISTS b.$1')); // tables and indexes in the attached broker file
  // the row the app reads: state for a personal login, dstate for a shared one; the others are reported and left alone
  const all = db.prepare(`SELECT s.user_id, '' AS device, s.rev, s.data, s.market, s.saved_at, u.shared, 'state' AS tbl FROM state s JOIN users u ON u.id = s.user_id WHERE s.rev > 0
    UNION ALL SELECT d.user_id, d.device, d.rev, d.data, d.market, d.saved_at, u.shared, 'dstate' AS tbl FROM dstate d JOIN users u ON u.id = d.user_id WHERE d.rev > 0 ORDER BY 1, 2`).all();
  const blobs = all.filter(r => (r.tbl === 'state') === !r.shared);
  for (const r of all) if (!blobs.includes(r)) console.log(`${accountId(r.user_id, r.device)} ignored: a ${r.tbl} row of a ${r.shared ? 'shared' : 'personal'} login (the app reads ${r.shared ? 'dstate' : 'state'})`);
  const load = appLoader(), t = Math.floor(Date.now() / 1000);
  let done = 0, skipped = 0, refused = 0, diffs = 0, repairedN = 0;
  const retired = [];
  for (const row of blobs) {
    const id = accountId(row.user_id, row.device);
    let L, raw, mk = null;
    try {
      raw = JSON.parse(row.data); mk = row.market ? JSON.parse(row.market) : null;
      L = load(raw, { market: mk, now: row.saved_at });
    } catch (e) { console.log(`${id} refused: ${e instanceof SyntaxError ? 'the blob is not JSON' : 'the loader failed: ' + e.message}`); refused++; continue; }
    if (L.reason) { console.log(`${id} refused: ${L.reason}`); refused++; continue; }
    const S = L.S, issues = issuesOf(L);
    for (const m of L.migrated.filter(x => / closed: /.test(x))) retired.push(`${id} ${m}`);
    const gw = db.prepare('SELECT rev, saved_at FROM gw_accounts WHERE account_id = ?').get(id);
    const newer = gw && row.rev > gw.rev ? `blob rev ${row.rev} (saved ${row.saved_at}) is newer than the migrated rev ${gw.rev}: saved after the migration` : '';
    const r = plan(S, { id, uid: row.user_id, device: row.device, t });
    if (verify) {
      const after = readBack(db, id), out = [];
      if (!after) { console.log(`${id} differs: not in the broker`); diffs++; continue; }
      if (!gw) out.push(`${id} gw_accounts: no row for this account`);
      // after the cut-over the blob keeps only preferences (PUT /api/state refuses the account keys): a newer rev is a
      // preferences save, not a difference; its account keys are compared with the broker below like any blob's (M4)
      if (newer) console.log(`  ${id} ${newer} (preferences only: the account keys are compared below)`);
      const raws = [['positions', rawLen(raw.positions), after.positions.length], ['orders', rawLen(raw.orders), after.orders.length], ['history', rawLen(raw.history), after.trades]].filter(x => x[1] !== x[2]);
      for (const m of issues) (accept ? console.log(`  ${id} loader (accepted): ${m}`) : out.push(`${id} loader: ${m}`));
      for (const [k, a, b] of raws) { const l = `${id} ${k} in the blob: ${a} ≠ ${b} in the broker`; if (accept && issues.length) console.log(`  ${l} (accepted: the loader's repairs)`); else out.push(l); }
      if (issues.length) repairedN++;
      const ms = (mk && Number.isFinite(mk.simTime) ? mk.simTime : row.saved_at) * 1000, { mk: market, at } = marketFor(mk, fixed, S.positions, ms);
      const c = compare(id, { balance: S.balance, peak: S.peak, set: S.set, positions: S.positions, orders: S.orders }, after, market);
      out.push(...c.out);
      if (after.trades !== r.trades.length) out.push(`${id} trades: ${r.trades.length} ≠ ${after.trades}`);
      if (after.shown !== after.trades) out.push(`${id} trades: ${after.trades - after.shown} closed before accounts.created (${after.created}), not shown`);
      if (after.executions !== r.executions.length) out.push(`${id} executions: ${r.executions.length} ≠ ${after.executions}`);
      const meta = r.positions.filter(p => Object.keys(p.meta).length).map(p => p.id).sort((a, b) => a - b), keys = r.state.map(s => s.key).sort();
      if (canon(meta) !== canon(after.meta)) out.push(`${id} gw_meta: positions ${canon(meta)} ≠ ${canon(after.meta)}`);
      if (canon(keys) !== canon(after.state)) out.push(`${id} gw_state: ${canon(keys)} ≠ ${canon(after.state)}`);
      for (const l of out) console.log('  ' + l);
      if (out.length) { console.log(`${id} differs (${out.length})`); diffs++; }
      else console.log(`${id} same: balance ${S.balance.toFixed(2)}, equity ${c.eq.toFixed(2)}${at.length ? ` (${at.join(', ')} at entry)` : ''}, ${S.positions.length} positions, ${S.orders.length} orders, ${r.trades.length} trades`);
      continue;
    }
    const br = !!db.prepare('SELECT 1 FROM b.accounts WHERE id = ?').get(id);
    const what = `${r.positions.length} positions, ${r.orders.length} orders, ${r.trades.length} trades, ${r.executions.length} executions, ${r.state.length} gateway states${issues.length ? `; repaired or left out by the loader: ${issues.join('; ')}` : ''}`;
    if (issues.length) repairedN++;
    if (br && gw) {
      if (newer) { console.log(`${id} differs: ${newer} (not migrated again: the broker holds the account now)`); diffs++; }
      else { console.log(`${id} skipped: already in the broker`); skipped++; }
      continue;
    }
    let mode = 'new';
    if (br && !gw) {
      const own = db.prepare("SELECT COUNT(*) n FROM b.executions WHERE account = ? AND json ->> 'migrated' IS NULL").get(id).n;
      if (own) { console.log(`${id} refused: partial: broker only, and the broker has ${own} execution(s) of its own since; check by hand`); refused++; continue; }
      mode = 'gw';
    } else if (!br && gw) mode = 'again';
    const say = { new: 'migrated', gw: 'partial: broker only, gateway rows completed from the blob', again: 'partial: gateway only, rewritten whole' }[mode];
    if (dry) { console.log(`${id} would write (${mode === 'new' ? 'new' : say}): balance ${S.balance.toFixed(2)}, ${what}`); continue; }
    try {
      inTx(db, () => { if (mode === 'again') dropGw(db, id); if (mode !== 'gw') writeBroker(db, r, t); writeGw(db, r, row); });
      done++; console.log(`${id} ${say}: balance ${S.balance.toFixed(2)}, ${what}`);
    } catch (e) { console.log(`${id} failed, nothing written: ${e.message}`); refused++; }
  }
  db.close();
  if (retired.length) console.log(`\n${retired.length} position(s) closed by the loader (instrument retired, catalog v15):\n  ${retired.join('\n  ')}`);
  if (verify) {
    console.log(diffs || refused ? `\n${diffs} account(s) differ, ${refused} refused` : `\n${blobs.length} account(s): no difference${repairedN ? ` (${repairedN} with the loader's repairs accepted)` : ''}`);
    process.exit(diffs || refused ? 1 : 0);
  }
  console.log(`\n${blobs.length} account(s): ${dry ? 'dry run, nothing written' : `${done} migrated, ${skipped} skipped (already in the broker)`}, ${diffs} newer than migrated, ${refused} refused${repairedN ? `; ${repairedN} repaired by the loader (listed above)` : ''}`);
  process.exit(refused || diffs ? 1 : 0);
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
