// The Administration journal of one client (GET /api/admin?journal=, server/journal.js):
//   J1 administrators only; a bad or unknown username is refused
//   J2 one timeline, newest first: sign-ins (audit_log), every broker report (accepted, filled, rejected), the order
//      log and the closed trades, decoded from broker.db
//   J3 only the user's own accounts: a deleted user's archived account under the same id stays out
//   J4 paging: before / limit / next
// Throwaway SQLite files only. Usage, from 2-cod-sursa: node tests/server/journal.mjs
import { DatabaseSync } from 'node:sqlite';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openD1 } from '../../host/d1.mjs';
import { openBrokerDb } from '../../host/broker/db.mjs';
import * as FX from '../../host/fix/dialect.mjs';
import * as adminFn from '../../functions/api/admin.js';

const DIR = mkdtempSync(join(tmpdir(), 'tb-journal-')), DB = join(DIR, 'tradeberry.db');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const O = { digits: () => 5, lotDigits: () => 2 };

try {
  execFileSync(process.execPath, ['host/migrate.mjs', DB], { stdio: ['ignore', 'pipe', 'inherit'] });
  const db = new DatabaseSync(DB);
  const user = (id, name, created) => db.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at) VALUES (?, ?, '00', '00', 1, ?)").run(id, name, created);
  user(1, 'alice', 2000); user(5, 'boss', 1000); db.prepare('UPDATE users SET admin = 1 WHERE id = 5').run();
  // alice's account, and the archived one of a deleted user who had id 1 before her
  db.prepare("INSERT INTO gw_accounts (user_id, user_created, device, account_id) VALUES (1, 2000, '', 'u1-b')").run();
  db.prepare("INSERT INTO gw_accounts (user_id, user_created, device, account_id, closed_at) VALUES (1, 1500, '', 'u1', 1900)").run();
  const aud = (at, actor, action, target) => db.prepare("INSERT INTO audit_log (at, actor, ip, action, target, ok) VALUES (?, ?, '1.2.3.4', ?, ?, 1)").run(at, actor, action, target);
  aud(3000, 'alice', 'login.ok', null); aud(3500, 'boss', 'admin.passwd', 'alice'); aud(1600, 'alice', 'login.ok', null); aud(3600, 'bob', 'login.ok', null);
  db.close();

  const B = openBrokerDb(join(DIR, 'broker.db'));
  const rep = (acc, t, ev, ids) => B.addExec(acc, t, { cl: ids.clOrdId, kind: ev.kind, fields: FX.execToReport(ev, { execId: 'X' + t, account: acc, ...ids }, { ...O, now: t * 1000 }) });
  rep('u1-b', 3100, { kind: 'new', order: { ot: 'limit', price: 1.1 } }, { clOrdId: 'c1', orderId: '7', sym: 'EURUSD', side: 'buy', lots: 0.5 });
  rep('u1-b', 3200, { kind: 'fill', receipt: { sym: 'EURUSD', side: 'buy', lots: 0.5, px: 1.10002, pos: 3, t: 3200 } }, { clOrdId: 'c1', orderId: '7' });
  rep('u1-b', 3300, { kind: 'reject', code: 'NO_MARGIN', text: 'Not enough free margin' }, { clOrdId: 'c2', sym: 'GOLD', side: 'sell', lots: 2 });
  B.addExec('u1-b', 3350, { type: 'cancel', order: { sym: 'USDJPY', side: 'sell', ot: 'stop', lots: 0.1, price: 150, status: 'cancelled', why: 'by user' } });
  B.addTrade('u1-b', { id: 3, sym: 'EURUSD', side: 'buy', lots: 0.5, entry: 1.10002, exit: 1.1012, open: 3200, close: 3400, pnl: 59, pips: 11.8, reason: 'Take profit', swap: 0 });
  B.addExec('u1', 1700, { type: 'cancel', order: { sym: 'OLD', side: 'buy', ot: 'limit', lots: 1, status: 'cancelled' } }); // the deleted user's
  B.db?.close?.();

  const env = { DB: openD1(DB), TB_DATA: DIR };
  const get = (qs, who = { id: 5, username: 'boss', admin: true }) => adminFn.onRequestGet({ request: new Request('http://x/api/admin?' + qs), env, data: { user: who } });

  ok((await get('journal=alice', { id: 1, username: 'alice', admin: false })).status === 403, 'J1 not an administrator: 403');
  ok((await get('journal=Bad%20Name')).status === 400, 'J1 a bad username: 400');
  ok((await get('journal=nobody')).status === 404, 'J1 an unknown user: 404');

  const j = await (await get('journal=alice')).json();
  const cats = j.rows.map(r => r.cat + '@' + r.t).join(' ');
  ok(cats === 'admin@3500 close@3400 log@3350 reject@3300 fill@3200 order@3100 session@3000', 'J2 the timeline, newest first: ' + cats);
  const fill = j.rows.find(r => r.cat === 'fill'), rej = j.rows.find(r => r.cat === 'reject'), close = j.rows.find(r => r.cat === 'close');
  ok(fill.sym === 'EURUSD' && fill.side === 'buy' && fill.lots === 0.5 && fill.px === 1.10002, 'J2 the fill decoded: ' + JSON.stringify(fill));
  ok(rej.sym === 'GOLD' && rej.text === 'Not enough free margin', 'J2 the rejection with its reason: ' + JSON.stringify(rej));
  ok(close.pnl === 59 && close.reason === 'Take profit' && close.entry === 1.10002 && close.px === 1.1012, 'J2 the closed trade: ' + JSON.stringify(close));
  ok(j.accounts.length === 1 && j.accounts[0].id === 'u1-b' && j.broker === 'ok', 'J3 only her own account: ' + JSON.stringify(j.accounts));
  ok(!j.rows.some(r => r.sym === 'OLD' || r.t === 1600 || r.t === 3600), 'J3 nothing of the deleted user, of before her account, or of another user');

  const p1 = await (await get('journal=alice&limit=3')).json();
  ok(p1.rows.length === 3 && p1.next === 3350, 'J4 a page of 3, next = 3350: ' + p1.next);
  const p2 = await (await get('journal=alice&limit=3&before=' + p1.next)).json();
  ok(p2.rows.map(r => r.t).join() === '3300,3200,3100' && p2.next === 3100, 'J4 the next page: ' + p2.rows.map(r => r.t));
} finally {
  rmSync(DIR, { recursive: true, force: true });
}
console.log(`journal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
