// Migration of the accounts from the state blob (tradeberry.db state / dstate) to the broker (data/broker.db) and the
// gateway tables (gw_*), with tools/migrate-accounts.mjs on throwaway databases. Fixture: tests/server/fixtures/migrate-blob.json
// (multi-TP, break-even armed, trailing, an open basket, an active challenge, OCO pendings, a protection row).
// Usage, from 2-cod-sursa:  node tests/server/migrate-accounts.mjs   (exit code 1 on any failure)
import { execFileSync, spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, rmSync, readFileSync, copyFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appLoader, META_KEYS } from '../../tools/migrate-accounts.mjs';
import { startBroker } from '../../host/broker.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FX = JSON.parse(readFileSync(join(ROOT, 'tests/server/fixtures/migrate-blob.json'), 'utf8'));
const DIR = mkdtempSync(join(tmpdir(), 'tb-mig-')), DB = join(DIR, 'tradeberry.db'), BR = join(DIR, 'broker.db');
// canonical JSON: the same value whatever the key order
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const same = (a, b) => canon(a) === canon(b);
const toolB = (br, ...a) => spawnSync(process.execPath, ['tools/migrate-accounts.mjs', '--db', DB, '--broker', br, ...a], { cwd: ROOT, encoding: 'utf8' });
const tool = (...a) => toolB(BR, ...a);
const sqlOn = (f, sql, ...p) => { const x = new DatabaseSync(f); try { return /^\s*select/i.test(sql) ? x.prepare(sql).all(...p) : x.prepare(sql).run(...p); } finally { x.close(); } };
const only = (d, acc) => Object.fromEntries(Object.entries(d).map(([t, rows]) => [t, rows.filter(r => (r.account ?? r.account_id ?? r.id) === acc).map(r => { const { roll_last, seq, ...x } = r; return x; })]));

const DEV = ['aaaaaaaaaaaa01', 'bbbbbbbbbbbb02'];
execFileSync(process.execPath, ['host/migrate.mjs', DB], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
{
  const sq = new DatabaseSync(DB);
  const user = (id, name, shared = 0) => sq.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at, shared) VALUES (?, ?, '00', '00', 1, 0, ?)").run(id, name, shared);
  user(1, 'alice'); user(2, 'bob'); user(3, 'team', 1); user(4, 'carol'); user(5, 'dave'); user(6, 'erin');
  const put = (uid, s, mk) => sq.prepare('INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (?, 7, ?, ?, 1793600000)').run(uid, JSON.stringify(s), mk ? JSON.stringify(mk) : null);
  put(1, FX.simple, FX.market); put(2, FX.blob, FX.market);
  sq.prepare("INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (4, 0, 'null', NULL, 1)").run(); // a market only: no account yet
  const team2 = { ...FX.simple, balance: 101000, positions: [{ ...FX.simple.positions[0], id: 5, side: 'buy', entry: 1.0855 }] };
  sq.prepare('INSERT INTO dstate (user_id, device, rev, data, market, saved_at) VALUES (3, ?, 2, ?, ?, 1)').run(DEV[0], JSON.stringify(FX.simple), JSON.stringify(FX.market));
  sq.prepare('INSERT INTO dstate (user_id, device, rev, data, market, saved_at) VALUES (3, ?, 3, ?, ?, 1)').run(DEV[1], JSON.stringify(team2), JSON.stringify(FX.market));
  // rows the app never reads: a state row of a shared login, a dstate row of a personal one
  sq.prepare('INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (3, 1, ?, NULL, 1)').run(JSON.stringify(FX.simple));
  sq.prepare("INSERT INTO dstate (user_id, device, rev, data, market, saved_at) VALUES (1, 'cccccccccccc03', 1, ?, NULL, 1)").run(JSON.stringify(FX.simple));
  // a position without its open time and a trade without its close time
  const noTime = { ...FX.simple, positions: [{ ...FX.simple.positions[0], open: undefined }],
    history: [{ id: 1, sym: 'EURUSD', side: 'buy', lots: .1, entry: 1.08, exit: 1.081, open: 1793400000, pnl: 10, pips: 10, reason: 'Manual' }] };
  sq.prepare('INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (6, 1, ?, ?, 1793500000)').run(JSON.stringify(noTime), JSON.stringify(FX.market));
  sq.close();
}
const blobRows = () => { const sq = new DatabaseSync(DB); const r = canon([sq.prepare('SELECT * FROM state ORDER BY user_id').all(), sq.prepare('SELECT * FROM dstate ORDER BY user_id, device').all()]); sq.close(); return r; };
const BLOB0 = blobRows();
const dump = () => {
  const b = new DatabaseSync(BR), g = new DatabaseSync(DB), out = {};
  for (const t of ['accounts', 'positions', 'orders', 'executions', 'trades', 'clord']) out[t] = b.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all();
  for (const t of ['gw_accounts', 'gw_clord', 'gw_meta', 'gw_state']) out[t] = g.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all();
  b.close(); g.close(); return out;
};
const load = appLoader();

try {
  console.log('MD --dry-run writes nothing');
  {
    const r = tool('--dry-run');
    ok(r.status === 0, `dry run exits 0: ${r.status} ${r.stderr}`);
    ok(/u2\b.*4 positions.*3 orders/.test(r.stdout), 'dry run says what it would write: ' + r.stdout.split('\n').find(l => /u2\b/.test(l)));
    ok(!existsSync(BR) || dump().accounts.length === 0, 'no broker account after a dry run');
    ok((() => { const g = new DatabaseSync(DB), n = g.prepare('SELECT COUNT(*) n FROM gw_accounts').get().n; g.close(); return n === 0; })(), 'no gateway row after a dry run');
  }

  console.log('M1 a simple account: migrated, --verify finds no difference');
  const run1 = tool();
  {
    ok(run1.status === 0, `migration exits 0: ${run1.status} ${run1.stderr}`);
    const d = dump(), a = d.accounts.find(x => x.id === 'u1');
    ok(a && a.user_id === 1 && a.device === '' && a.type === 'demo' && a.balance === 99500 && a.peak === 100000 && a.next_id === 3 && a.next_fill === 2, 'u1: balance, peak, counters, demo: ' + JSON.stringify(a));
    ok(d.positions.filter(p => p.account === 'u1').length === 1 && !d.orders.some(o => o.account === 'u1'), 'u1: one position, no order');
    ok(!d.accounts.some(x => x.user_id === 4), 'a market-only row (rev 0) is not an account');
    const v = tool('--verify');
    ok(v.status === 0 && /no difference/i.test(v.stdout), `--verify: no difference (${v.status}): ${v.stdout}${v.stderr}`);
  }

  console.log('MR a migrated account carries ran = the migration time: the broker starts it with no recovery replay');
  {
    const b = new DatabaseSync(BR), r = b.prepare("SELECT v FROM meta WHERE k = 'ran:u1'").get(), n = b.prepare("SELECT COUNT(*) n FROM meta WHERE k LIKE 'ran:%'").get().n, na = b.prepare('SELECT COUNT(*) n FROM accounts').get().n; b.close();
    ok(r && Math.abs(+r.v - Date.now() / 1000) < 120 && n === na, `ran:<account> written for every account (${n}/${na}): ${r && r.v}`);
    const F = join(DIR, 'broker-run.db'); copyFileSync(BR, F); for (const x of ['-wal', '-shm']) if (existsSync(BR + x)) copyFileSync(BR + x, F + x);
    let asked = 0;
    const X = await startBroker({ db: F, port: 0, user: 'mr-user', pass: 'mr-pass', feed: false, log: () => {}, fetchBars: async () => { asked++; return []; } });
    await X.recovering;
    ok(!asked && !X.waiting('u1') && !X.recovery('u1') && X.account('u1').acct.positions.length === 1, `the broker asks no bars and releases u1 at once (asked ${asked})`);
    await X.close();
  }

  console.log('M2 multi-TP, break-even armed, trailing, an open basket, an active challenge, OCO: identical after the import');
  {
    const S = load(FX.blob, { market: FX.market, now: 1793600000 }).S, d = dump(), A = 'u2';
    const a = d.accounts.find(x => x.id === A), set = JSON.parse(a.set_json);
    ok(a.balance === S.balance && a.peak === S.peak && a.next_id === S.nextId && a.next_fill === S.nextFill, `account: balance ${a.balance}, peak ${a.peak}, next ${a.next_id}/${a.next_fill}`);
    ok(set.jur === 'eu' && set.lev === 30 && set.comm === 5 && set.slip === 'sym' && set.slipSd === .2 && set.latMs === 120 && !('theme' in set), 'set_json: the execution settings only: ' + a.set_json);
    // positions: broker json + gateway meta = the position the browser loads
    const meta = Object.fromEntries(d.gw_meta.filter(x => x.account === A).map(x => [x.pos_id, JSON.parse(x.json)]));
    const pos = d.positions.filter(x => x.account === A).map(x => ({ id: x.id, json: JSON.parse(x.json) }));
    ok(pos.length === S.positions.length, `positions: ${pos.length} of ${S.positions.length}`);
    for (const p of S.positions) {
      const b = pos.find(x => x.id === p.id);
      // the import adds what the gateway needs (gw_meta prot: the trailing / break-even rules it runs; hedge: a basket leg)
      const back = b && (({ prot, ...m }) => { const j = { ...b.json }; delete j.hedge; return { prot, all: { ...j, ...m } }; })(meta[p.id] || {});
      ok(b && same(back.all, p), `position #${p.id} identical: ${b && canon(back.all)} vs ${canon(p)}`);
      ok(b && same(back.prot ?? null, (k => (Object.keys(k).length ? k : null))(Object.fromEntries(['trail', 'trailNow', 'trailSl', 'trailed', 'be', 'beSl'].filter(k => p[k] != null).map(k => [k, p[k]])))) && !!b.json.hedge === !!p.bgid, `position #${p.id}: prot and hedge for the gateway`);
      ok(b && META_KEYS.every(k => !(k in b.json)), `position #${p.id}: no journal field at the broker`);
    }
    const p11 = pos.find(x => x.id === 11).json, p12 = pos.find(x => x.id === 12).json;
    ok(p11.tps.length === 2 && p11.tps[1].leg === 'TP2' && p11.be.at === 10 && p11.be.done === false && p11.swap === -3.2 && p11.comm === 5 && p11.im === 3617 && p11.open === 1793600000 - 7200, 'multi-TP + BE armed + swap/comm/im/open kept');
    ok(p12.trail === 15 && p12.trailNow === true && p12.trailSl === 1.3027 && p12.be.done === true && p12.src === 18, 'trailing as a stop + BE done + the order it came from kept');
    ok(meta[13].basket === 'usd-weak' && meta[13].bgid === 'g1' && meta[11].pm.own === 'pullback' && meta[11].mae === -12.5, 'journal fields in gw_meta');
    // orders: new ClOrdIDs, OCO group kept
    const ord = d.orders.filter(x => x.account === A).sort((x, y) => x.id - y.id);
    ok(ord.map(x => x.cl_ord_id).join() === 'tb-u2-1,tb-u2-2,tb-u2-3', 'ClOrdIDs tb-<account>-<n>: ' + ord.map(x => x.cl_ord_id));
    for (const o of S.orders) ok(same(JSON.parse(ord.find(x => x.id === o.id).json), o), `order #${o.id} identical`);
    ok(JSON.parse(ord[0].json).oca === 'o20' && JSON.parse(ord[1].json).oca === 'o20', 'OCO group o20 kept on both legs');
    ok(d.gw_clord.find(x => x.account === A).n === 4, 'gw_clord: the next n is 4');
    // history (with the protection row), fills and the order log
    const tr = d.trades.filter(x => x.account === A).map(x => JSON.parse(x.json));
    ok(tr.length === 2 && same(tr, [...S.history].reverse()), 'trades: the history, oldest first, identical');
    ok(tr.some(h => h.nbp === true && h.side === 'nbp' && h.lots === 0 && h.pnl === 120.5) && d.trades.find(x => x.account === A && x.id === 30).close_t === S.history[0].close, 'the negative balance protection row is a trade with its close time');
    const ex = d.executions.filter(x => x.account === A).map(x => ({ t: x.t, j: JSON.parse(x.json) }));
    ok(ex.length === S.fills.length + S.ordLog.length, `executions: ${ex.length} = ${S.fills.length} fills + ${S.ordLog.length} order log`);
    ok(ex.every((x, i) => !i || ex[i - 1].t <= x.t), 'executions in time order');
    ok(same(ex.filter(x => x.j.type === 'fill').map(x => x.j.fill), [...S.fills].reverse()), 'fills identical');
    ok(same(ex.filter(x => x.j.order).map(x => x.j.order), [...S.ordLog].reverse()) && ex.some(x => x.j.type === 'expire') && ex.some(x => x.j.type === 'filled'), 'order log identical, with its event types');
    // the gateway's functions
    const st = Object.fromEntries(d.gw_state.filter(x => x.account === A).map(x => [x.key, JSON.parse(x.json)]));
    ok(st.chal && st.chal.att && st.chal.att.status === 'active' && same(st.chal, S.chal), 'active challenge identical');
    // I6: a pending order's exits: on its broker json (the broker's fill uses them) and in the gateway's ordMeta view
    {
      const withEx = S.orders.filter(o => o.slPips > 0 || o.tpPips > 0 || o.trail > 0 || (o.tps && o.tps.length) || o.be);
      ok(withEx.length > 0, 'I6 the fixture has pending orders with exits: ' + withEx.length);
      for (const o of withEx) {
        const cl = ord.find(x => x.id === o.id).cl_ord_id, m = st.ordMeta && st.ordMeta[cl], bj = JSON.parse(ord.find(x => x.id === o.id).json);
        ok(m && m.sym === o.sym && (o.slPips > 0 ? m.exits.slPips === o.slPips : !('slPips' in m.exits)) && (o.trail > 0 ? m.exits.trail === o.trail : !('trail' in m.exits))
          && (o.tps && o.tps.length ? same(m.exits.tps, o.tps.map(r => ({ pips: r.pips, pct: r.pct }))) : (o.tpPips > 0 ? m.exits.tpPips === o.tpPips : true)) && (!o.be || (m.exits.be && m.exits.be.at === (o.be.at ?? null))),
          `I6 order #${o.id} (${cl}): exits in ordMeta ${canon(m && m.exits)}`);
        ok(bj.slPips === o.slPips && same(bj.tps ?? null, o.tps ?? null) && bj.trail === o.trail, `I6 order #${o.id}: the same exits on the broker json`);
      }
    }
    ok(same(st.bkPos, S.bkPos) && same(st.bkHist, S.bkHist) && same(st.bkOrders, []) && same(st.bkAlerts, []) && same(st.alerts, S.alerts), 'baskets and alerts identical');
    ok(d.gw_accounts.some(x => x.user_id === 2 && x.device === '' && x.account_id === A && x.rev === 7 && x.saved_at === 1793600000), 'gw_accounts maps bob to u2, with the migrated rev and save time');
    // C1: created = the start of the migrated history, so the broker's query shows every migrated trade
    const T = 1793600000, c = Math.min(...S.history.map(h => h.close), ...S.positions.map(p => p.open), ...S.orders.map(o => o.created), S.chal.att.start);
    ok(a.created === Math.floor(c) && a.created <= T - 88000, `accounts.created ${a.created} = the earliest history time ${c}`);
    const b = new DatabaseSync(BR), shown = b.prepare('SELECT json FROM trades WHERE account = ? AND close_t >= ? ORDER BY close_t, rowid').all(A, a.created); b.close();
    ok(shown.length === S.history.length, `the broker's history query (close_t >= created) returns every migrated trade: ${shown.length} of ${S.history.length}`);
  }

  console.log('M3 a second run duplicates nothing');
  {
    const before = dump(), r = tool(), after = dump();
    ok(r.status === 0 && /skipped/.test(r.stdout), `second run exits 0 and says skipped: ${r.stdout}`);
    ok(same(before, after), 'every broker and gateway table unchanged after the second run');
  }

  console.log('M4 a shared login: one broker account per dstate row');
  {
    const d = dump(), acc = d.accounts.filter(x => x.user_id === 3).map(x => x.id).sort();
    ok(same(acc, DEV.map(x => 'u3-' + x)), 'u3-<device> for each browser: ' + acc);
    ok(d.accounts.find(x => x.id === 'u3-' + DEV[1]).balance === 101000 && d.accounts.find(x => x.id === 'u3-' + DEV[0]).balance === 99500, 'each with its own balance');
    ok(DEV.every(x => d.gw_accounts.some(g => g.user_id === 3 && g.device === x && g.account_id === 'u3-' + x)), 'gw_accounts maps each device');
    ok(d.positions.find(x => x.account === 'u3-' + DEV[1]).id === 5 && d.positions.filter(x => x.account === 'u3-' + DEV[0]).length === 1, 'each with its own positions');
  }

  console.log('MI only the row the app reads is migrated (users.shared)');
  {
    const d = dump();
    ok(!d.accounts.some(x => x.id === 'u3') && !d.accounts.some(x => x.id === 'u1-cccccccccccc03'), 'no account from a state row of a shared login or a dstate row of a personal one');
    ok(/u3 ignored: a state row of a shared login/.test(run1.stdout) && /u1-cccccccccccc03 ignored: a dstate row of a personal login/.test(run1.stdout), 'both ignored rows are reported');
  }

  console.log('MT a record without its time gets the row\'s save time, never 1970');
  {
    const d = dump(), p = JSON.parse(d.positions.find(x => x.account === 'u6').json), h = JSON.parse(d.trades.find(x => x.account === 'u6').json);
    ok(p.open === 1793500000 && h.close === 1793500000, `open ${p.open}, close ${h.close} = saved_at 1793500000`);
    ok(d.accounts.find(x => x.id === 'u6').created === 1793500000, 'created from those times');
  }

  console.log('MB the blob stays as it was');
  ok(blobRows() === BLOB0, 'state and dstate rows unchanged');

  console.log('MR the loader\'s repairs: a difference for --verify unless --accept-repairs; the v14 CFDs retire at the saved price');
  {
    const mk = { ...FX.market, L: { ...FX.market.L, XAUUSD: Math.log(2650.4) } };
    const old = { balance: 50000, peak: 50000, nextId: 5, set: { jur: 'none' }, positions: [
      { id: 2, sym: 'XAUUSD', side: 'buy', lots: 1, entry: 2600, sl: null, tp: null, trail: 0, swap: -2, open: 1793000000 },
      { id: 3, sym: 'NOPE', side: 'buy', lots: 1, entry: 1, open: 1793000000 },
      { id: 4, sym: 'EURUSD', side: 'buy', lots: .1, entry: 1.08, sl: null, tp: null, trail: 0, swap: 0, open: 1793000000 }], orders: [], history: [] };
    sqlOn(DB, 'INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (5, 1, ?, ?, 1793600000)', JSON.stringify(old), JSON.stringify(mk));
    const r = tool();
    ok(r.status === 0 && /u5 migrated/.test(r.stdout), 'an account the loader repaired is migrated: ' + r.status);
    ok(/1 position\(s\) closed by the loader[\s\S]*u5 open position #2 on XAUUSD closed: instrument retired \(catalog v15\), at the last saved price 2650.4/.test(r.stdout), 'the retirement closure is in the summary: ' + r.stdout.slice(-400));
    const d = dump(), h = JSON.parse(d.trades.find(x => x.account === 'u5').json), a = d.accounts.find(x => x.id === 'u5');
    ok(h.exit === 2650.4 && Math.abs(h.pnl - (50.4 * 100 - 2)) < 1e-6 && Math.abs(a.balance - (50000 + 5040 - 2)) < 1e-6, `closed at the saved price: exit ${h.exit}, P&L ${h.pnl}, balance ${a.balance}`);
    const v = tool('--verify');
    ok(v.status !== 0 && /u5 loader: open position #3 left out/.test(v.stdout) && /u5 loader: .*XAUUSD closed/.test(v.stdout) && /u5 positions in the blob: 3 ≠ 1/.test(v.stdout) && /u5 history in the blob: 0 ≠ 1/.test(v.stdout), '--verify: the repairs and the raw counts are differences: ' + v.stdout);
    const va = tool('--verify', '--accept-repairs');
    ok(va.status === 0 && /accepted/.test(va.stdout) && /1 with the loader's repairs accepted/.test(va.stdout), '--accept-repairs: listed, exit 0: ' + va.status + ' ' + va.stdout.slice(-300));
  }

  console.log('MN a blob saved after the migration is a difference, never a silent skip');
  {
    sqlOn(DB, 'UPDATE state SET rev = 8 WHERE user_id = 2');
    const r = tool(), v = tool('--verify', '--accept-repairs');
    ok(r.status !== 0 && /u2 differs: blob rev 8 .* newer than the migrated rev 7/.test(r.stdout) && /u1 skipped/.test(r.stdout), 'migration run: u2 reported, exit 1: ' + r.status);
    ok(v.status === 0 && /u2 blob rev 8 .*preferences only/.test(v.stdout), '--verify after the cut-over: a newer rev alone (a preferences save) is no difference (M4): ' + v.status);
    const data0 = sqlOn(DB, 'SELECT data FROM state WHERE user_id = 2')[0].data;
    sqlOn(DB, "UPDATE state SET rev = 9, data = json_set(data, '$.balance', 12345) WHERE user_id = 2");
    const v2 = tool('--verify', '--accept-repairs');
    ok(v2.status !== 0 && /u2 balance/.test(v2.stdout), '--verify: an account key changed in the blob is a difference: ' + v2.status);
    sqlOn(DB, 'UPDATE state SET rev = 7, data = ? WHERE user_id = 2', data0);
  }

  console.log('MP a split commit is repaired on the next run');
  {
    const d0 = dump();
    // gateway rows without a broker account: rewritten whole
    for (const t of ['accounts', 'positions', 'orders', 'executions', 'trades']) sqlOn(BR, `DELETE FROM ${t} WHERE ${t === 'accounts' ? 'id' : 'account'} = 'u1'`);
    const r1 = tool(), d1 = dump();
    ok(r1.status === 0 && /u1 partial: gateway only, rewritten whole/.test(r1.stdout), 'u1: gateway only → rewritten: ' + r1.status);
    ok(same(only(d1, 'u1'), only(d0, 'u1')), 'u1: the same rows as before, nothing doubled');
    // a broker account without its gateway rows: completed from the blob
    for (const [t, k] of [['gw_meta', 'account'], ['gw_state', 'account'], ['gw_clord', 'account'], ['gw_accounts', 'account_id']]) sqlOn(DB, `DELETE FROM ${t} WHERE ${k} = 'u2'`);
    const r2 = tool(), d2 = dump();
    ok(r2.status === 0 && /u2 partial: broker only, gateway rows completed from the blob/.test(r2.stdout), 'u2: broker only → completed: ' + r2.status);
    ok(same(only(d2, 'u2'), only(d0, 'u2')), 'u2: the gateway rows as before');
    // … unless the broker already executed on it
    const A = 'u3-' + DEV[0];
    for (const [t, k] of [['gw_meta', 'account'], ['gw_state', 'account'], ['gw_clord', 'account'], ['gw_accounts', 'account_id']]) sqlOn(DB, `DELETE FROM ${t} WHERE ${k} = ?`, A);
    sqlOn(BR, 'INSERT INTO executions (account, t, json) VALUES (?, 1, ?)', A, JSON.stringify({ cl: 'tb-x-1', fields: {} }));
    const r3 = tool();
    ok(r3.status !== 0 && new RegExp(A + ' refused: partial: broker only, and the broker has 1 execution').test(r3.stdout) && !sqlOn(DB, 'SELECT 1 FROM gw_accounts WHERE account_id = ?', A).length, 'broker only with its own execution: refused, left alone');
    sqlOn(BR, "DELETE FROM executions WHERE account = ? AND json ->> 'migrated' IS NULL", A);
    const r4 = tool();
    ok(r4.status === 0 && same(only(dump(), A), only(d0, A)), 'once that execution is gone, completed like the others');
  }

  console.log('ME a blob the loader cannot read is refused, the run carries on; --dry-run and --verify never add tables');
  {
    sqlOn(DB, "INSERT INTO users (id, username, salt, hash, iter, created_at, shared) VALUES (7, 'frank', '00', '00', 1, 0, 0)");
    sqlOn(DB, "INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (7, 1, '{not json', NULL, 1)");
    const r = tool();
    ok(r.status !== 0 && /u7 refused: the blob is not JSON/.test(r.stdout) && /u6 skipped/.test(r.stdout), 'u7 refused, the others still handled: ' + r.status);
    sqlOn(DB, 'DELETE FROM state WHERE user_id = 7');
    const EB = join(DIR, 'empty.db'); new DatabaseSync(EB).close();
    const tables = () => sqlOn(EB, "SELECT name FROM sqlite_master WHERE type = 'table'").length;
    const v = toolB(EB, '--verify'), dr = toolB(EB, '--dry-run');
    ok(v.status !== 0 && /not a broker database/.test(v.stderr) && dr.status === 0 && tables() === 0, `an existing file without the tables: verify refuses (${v.status}), dry run reads (${dr.status}), no table added (${tables()})`);
  }

  console.log('MV --verify reports a difference and exits non-zero');
  {
    const b = new DatabaseSync(BR), row = b.prepare("SELECT json FROM positions WHERE account = 'u2' AND id = 11").get(), j = JSON.parse(row.json);
    j.sl = 1.0701; b.prepare("UPDATE positions SET json = ? WHERE account = 'u2' AND id = 11").run(JSON.stringify(j));
    b.prepare("UPDATE accounts SET balance = balance + 1 WHERE id = 'u1'").run();
    b.prepare("DELETE FROM trades WHERE rowid = (SELECT MAX(rowid) FROM trades WHERE account = 'u2')").run(); b.close();
    sqlOn(DB, "DELETE FROM gw_state WHERE account = 'u2' AND key = 'chal'");
    const v = tool('--verify');
    ok(v.status !== 0, '--verify exits non-zero on a difference: ' + v.status);
    ok(/u2.*#11.*sl/.test(v.stdout) && /u1.*balance/.test(v.stdout) && /u1.*equity/.test(v.stdout), '--verify names the account, the position and the field: ' + v.stdout);
    ok(/u2 trades: 2 ≠ 1/.test(v.stdout) && /u2 history in the blob: 2 ≠ 1/.test(v.stdout) && /u2 gw_state: .*chal.* ≠ /.test(v.stdout), '--verify counts the trades and the gateway rows');
    ok(!/u3-/.test(v.stdout.split('\n').filter(l => /differ|≠/.test(l)).join('\n')), 'accounts without a difference are not reported as different');
  }
} catch (e) { fail++; console.log('  ABORT', e.stack); } finally { rmSync(DIR, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
