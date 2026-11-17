// host/fix/dialect.mjs: FD1 every order shape round-trips through real FIX bytes (codec encode -> Parser), FD2 the full fill
// receipt comes back identical, FD3 a refusal keeps code and text, FD4 no custom tag outside 5000-9999 (721 aside). Usage,
// from 2-cod-sursa: node tests/server/fix-dialect.mjs (also run by tests/server/run.mjs).
import { encode, Parser } from '../../host/fix/codec.mjs';
import { TAG as DT } from '../../host/fix/dict.mjs';
import * as D from '../../host/fix/dialect.mjs';

let pass = 0, fail = 0;
const ok = (v, msg) => { if (v) pass++; else { fail++; console.log('  FAIL', msg); } };
const HDR = { sender: 'TB', target: 'BROKER', seq: 1, sendingTime: '20261102-09:30:00.000' };
const STD = new Set(Object.values(DT)), seen = new Set();
const canon = o => JSON.stringify(o, (k, v) => (v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort()) : v));
// fields -> bytes -> parsed message (so the real wire format is exercised), recording every tag used
function wire(type, fields) {
  const b = encode(type, fields, HDR), p = new Parser().push(b);
  ok(p.length === 1 && !p[0].error && p[0].type === type, `${type} parses: ${JSON.stringify(p[0]?.error)}`);
  for (const [t] of fields) seen.add(+t);
  return p[0];
}
const O = { digits: 5, now: Date.UTC(2026, 10, 2, 9, 30, 0, 123) };
const same = (a, b, msg) => ok(canon(a) === canon(b), `${msg}: ${canon(b)} != ${canon(a)}`);

// FD1: each order shape, as the request object, returns unchanged
{
  const cases = {
    market: { sym: 'EURUSD', side: 'buy', lots: 0.1, ot: 'market', tif: 'GTC' },
    'market with price': { sym: 'USDJPY', side: 'sell', lots: 2, ot: 'market', price: 151.234, tif: 'DAY' },
    limit: { sym: 'EURUSD', side: 'buy', lots: 1.25, ot: 'limit', price: 1.0825, tif: 'GTC' },
    stop: { sym: 'GBPUSD', side: 'sell', lots: 0.01, ot: 'stop', price: 1.2301, tif: 'DAY' },
    stoplimit: { sym: 'EURUSD', side: 'buy', lots: 3, ot: 'stoplimit', price: 1.09, limit: 1.0905, tif: 'GTC' },
    gtd: { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.07, tif: 'GTD', expires: Date.UTC(2026, 10, 5, 17, 0, 0) / 1000 },
    'close on 721': { sym: 'EURUSD', side: 'sell', lots: 0.5, ot: 'market', tif: 'GTC', posId: 42 },
    'TP2 linked': { sym: 'EURUSD', side: 'sell', lots: 0.3, ot: 'limit', price: 1.1, tif: 'GTC', linkPos: 42, leg: 'TP2' },
    'SL linked': { sym: 'EURUSD', side: 'sell', lots: 1, ot: 'stop', price: 1.05, tif: 'GTC', linkPos: 42, leg: 'SL' },
    oco: { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.06, tif: 'GTC', oca: 'o17' },
    'net book': { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'stop', price: 1.11, tif: 'GTC', net: true, posId: 42 },
  };
  for (const [name, req] of Object.entries(cases)) {
    const m = wire('D', D.orderToD(req, 'tb-7-12', '7', O)), r = D.dToOrder(m);
    same(req, r.req, `FD1 ${name}`);
    ok(r.clOrdId === 'tb-7-12' && r.account === '7', `FD1 ${name} ids`);
  }
  { const n = wire('D', D.orderToD({ ...cases.limit, net: false }, 'cn', '7', O)), y = wire('D', D.orderToD(cases['net book'], 'cy', '7', O));
    ok(!n.fields.has('5004') && D.dToOrder(n).req.net === undefined && y.fields.get('5004') === 'Y' && D.TAG.NET === 5004, 'FD1 5004 NET: Y when true, omitted when false'); }
  const m = wire('D', D.orderToD(cases.gtd, 'c1', '7', O));
  ok(m.fields.get('126') === '20261105-17:00:00' && m.fields.get('59') === '6' && m.fields.get('40') === '2', 'FD1 GTD: 126 UTC, 59=6, 40=2');
  const s = wire('D', D.orderToD(cases.stoplimit, 'c2', '7', O));
  ok(s.fields.get('40') === '4' && s.fields.get('99') === '1.09000' && s.fields.get('44') === '1.09050', 'FD1 stop-limit: 99 trigger, 44 limit, prices at 5 digits');
  const j = wire('D', D.orderToD(cases['market with price'], 'c3', '7', { digits: sym => (sym === 'USDJPY' ? 3 : 5) }));
  ok(j.fields.get('44') === '151.234' && j.fields.get('54') === '2' && j.fields.get('38') === '2', 'FD1 per-symbol digits via function');
  const l = wire('D', D.orderToD({ ...cases.limit, lots: 1e-7 }, 'c4', '7', O));
  ok(l.fields.get('38') === '0.0000001', 'lots never in exponent form: ' + l.fields.get('38'));
  const c = wire('D', D.orderToD(cases['close on 721'], 'c5', '7', O));
  ok(c.fields.get('721') === '42' && c.fields.get('60') === '20261102-09:30:00.123', 'close sends 721; 60 from opts.now');
  let thrown = 0; for (const bad of [{ ...cases.limit, side: 'x' }, { ...cases.limit, ot: 'x' }, { ...cases.limit, lots: NaN }, { ...cases.limit, tif: 'FOK' }]) try { D.orderToD(bad, 'c', '7', O); } catch { thrown++; }
  ok(thrown === 4, 'bad side / type / lots / tif refused, not sent');
  // cancel and replace
  const cx = { clOrdId: 'tb-7-13', origClOrdId: 'tb-7-12', account: '7', sym: 'EURUSD', side: 'buy', lots: 1 };
  const f = wire('F', D.cancelToF(cx, O)); same(cx, D.fToCancel(f), 'FD1 cancel');
  const g = wire('G', D.replaceToG(cases.limit, 'tb-7-14', 'tb-7-12', '7', O)), gr = D.gToReplace(g);
  same(cases.limit, gr.req, 'FD1 replace order'); ok(gr.origClOrdId === 'tb-7-12' && gr.clOrdId === 'tb-7-14', 'FD1 replace ids');
}

// FD2: the full fill receipt through an ExecutionReport
{
  const rc = { fid: 31, t: 1793611800.123, sym: 'EURUSD', side: 'buy', lots: 1.5, pos: 42, order: 17, kind: 'open', reason: 'Order — limit #17 \\ ok', bid: 1.08243, ask: 1.08251, ref: 1.0825, refKind: 'limit', px: 1.08251,
    slip: 0.4, slipUsd: 0.6, spread: 0.8, spreadUsd: 1.2, lat: 132, comm: 7.5, gap: false, model: { on: true, sd: 0.2, lat: 120, live: true } };
  const ids = { orderId: '17', execId: '31', clOrdId: 'tb-7-12', account: '7' };
  const m = wire('8', D.execToReport({ kind: 'fill', receipt: rc }, ids, O)), r = D.reportToExec(m);
  same(rc, r.receipt, 'FD2 receipt identical'); ok(r.kind === 'fill' && canon(r.ids) === canon(ids), 'FD2 ids and kind');
  ok(m.fields.get('60') === '20261102-09:30:00.123', 'FIX2 60 TransactTime is the receipt t: ' + m.fields.get('60'));
  ok(m.fields.get('150') === 'F' && m.fields.get('39') === '2' && m.fields.get('32') === '1.5' && m.fields.get('31') === '1.08251' && m.fields.get('14') === '1.5' && m.fields.get('151') === '0' && m.fields.get('721') === '42', 'FD2 standard tags carry the fill');
  ok(m.fields.get('5010') === '0.4' && m.fields.get('5013') === 'N' && m.fields.get('5014') === '7.5', 'FD2 slip, gap, comm in their own tags');
  // odd values still come back: null order, a gap in pips, Infinity, close with reason, quirky ids
  const odd = { ...rc, order: null, pos: null, gap: 3.2, kind: 'close', reason: null, ref: null };
  const oddR = D.reportToExec(wire('8', D.execToReport({ kind: 'fill', receipt: odd }, { ...ids, orderId: undefined }, O)));
  same(odd, oddR.receipt, 'FD2 null order/pos/reason/ref and a gap in pips survive'); ok(oddR.ids.orderId === 'NONE', 'FD2 no order -> 37=NONE');
  const min = { fid: 1, t: 1793611800, sym: 'XAUUSD', side: 'sell', lots: 0.01, px: 2400.5 };
  same({ ...min, order: null, pos: null, reason: null }, D.reportToExec(wire('8', D.execToReport({ kind: 'fill', receipt: min }, { execId: '1', clOrdId: 'c', account: '7' }, O))).receipt, 'FD2 minimal receipt (absent = null)');
  const nw = D.reportToExec(wire('8', D.execToReport({ kind: 'new' }, { ...ids, sym: 'EURUSD', side: 'buy', lots: 1 }, O)));
  ok(nw.kind === 'new' && nw.ids.sym === 'EURUSD' && nw.ids.side === 'buy' && nw.ids.lots === 1, 'new ack keeps sym/side/lots');
  const nwm = wire('8', D.execToReport({ kind: 'new' }, { ...ids, sym: 'EURUSD', side: 'buy', lots: 1.5 }, { ...O, lotDigits: 2 }));
  ok(nwm.fields.get('14') === '0' && nwm.fields.get('151') === '1.50' && nwm.fields.get('6') === '0' && nwm.fields.get('38') === '1.50' && nwm.fields.get('60') === '20261102-09:30:00.123', 'FIX2 non-fill: 14=0, 151=lots, 6=0, 60 from now, lots at lotDigits');
  const cn = D.reportToExec(wire('8', D.execToReport({ kind: 'cancel', text: 'Cancelled by user' }, { ...ids, origClOrdId: 'tb-7-11' }, O)));
  ok(cn.kind === 'cancel' && cn.text === 'Cancelled by user' && cn.ids.origClOrdId === 'tb-7-11', 'cancel keeps text and orig id');
}

// FD3: a refusal keeps code and text
{
  const text = 'Market closed — EUR/USD opens Sunday 17:00 ≥ NY', ev = { kind: 'reject', code: 'MARKET_CLOSED', text };
  const m = wire('8', D.execToReport(ev, { execId: '0001', clOrdId: 'tb-7-12', account: '7', sym: 'EURUSD', side: 'buy', lots: 1 }, O)), r = D.reportToExec(m);
  ok(r.kind === 'reject' && r.code === 'MARKET_CLOSED' && r.text === text, 'FD3 code and text (non-latin1 text too): ' + JSON.stringify(r));
  ok(m.fields.get('150') === '8' && m.fields.get('39') === '8' && m.fields.get('103') === '99' && m.fields.get('5017') === 'MARKET_CLOSED' && m.fields.get('37') === 'NONE', 'FD3 reject is 150=8/39=8 with 5017');
  const r2 = D.reportToExec(wire('8', D.execToReport({ kind: 'reject', code: 'REQUOTE', text: 'a\\u00e9\\b' }, { execId: '2', clOrdId: 'c', account: '7' }, O)));
  ok(r2.text === 'a\\u00e9\\b' && r2.code === 'REQUOTE', 'FD3 a literal backslash-u in the text is not mistaken for an escape');
}

// positions, account summary, history, settings, reset
{
  const pos = { id: 42, sym: 'EURUSD', side: 'sell', lots: 1.5, entry: 1.0825, swap: -3.2, comm: 7.5, im: 3612.5, open: 1793611800 };
  const pm = wire('AP', D.posToAP(pos, '7', { ...O, reqId: 'r1' })), pr = D.apToPos(pm);
  same(pos, pr.pos, 'position round trip'); ok(pr.account === '7' && pm.fields.get('704') === '0' && pm.fields.get('705') === '1.5' && pm.fields.get('721') === '42', 'AP: short qty in 705, id in 721');
  same({ ...pos, side: 'buy' }, D.apToPos(wire('AP', D.posToAP({ ...pos, side: 'buy' }, '7', O))).pos, 'long position round trip');
  ok(pm.fields.get('730') === '1.0825' && pm.fields.get('5018') === '3612.5' && pm.fields.get('5019') === '1793611800', 'FIX2 entry in 730 at full precision; im and open in their own tags');
  { const avg = 1.1001466746343567, m = wire('AP', D.posToAP({ ...pos, entry: avg }, '7', O)); ok(D.apToPos(m).pos.entry === avg, 'FIX2 an averaged entry comes back exactly'); }
  let t0 = 0; try { D.posToAP({ ...pos, lots: 0 }, '7', O); } catch { t0++; } ok(t0 === 1, 'a zero-lot position is refused');
  const sm = { balance: 100000, equity: 100234.5, margin: 1200, free: 99034.5, level: Infinity, fl: -12.25 };
  const bm = wire('BA', D.summaryToBA(sm, '7', { inquiryId: 'q1' }));
  same(sm, D.baToSummary(bm).summary, 'summary round trip (level Infinity as with no margin)');
  same({ ...sm, level: 8350.1, fl: null }, D.baToSummary(wire('BA', D.summaryToBA({ ...sm, level: 8350.1, fl: null }, '7'))).summary, 'summary with null fl');
  const tr = { id: 42, sym: 'EURUSD', side: 'sell', lots: 1.5, entry: 1.0825, exit: 1.08, open: 1793611800, close: 1793615000, pnl: 37.5, pips: 25, reason: 'TP1 hit', swap: 0, leg: 'TP1', comm: 7.5, slip: 0.2, gap: true };
  same(tr, D.aeToTrade(wire('AE', D.tradeToAE(tr, '7', O))).trade, 'trade round trip');
  const tm = wire('AE', D.tradeToAE(tr, '7', O)); ok(tm.fields.get('5021') === '1.0825' && tm.fields.get('31') === '1.08000' && tm.fields.get('5019') === '1793611800' && tm.fields.get('5022') === '1793615000', 'FIX2 trade entry/open/close in their tags, exit at digits, entry at full precision');
  { const avg = 1.1001466746343567, t = D.aeToTrade(wire('AE', D.tradeToAE({ ...tr, entry: avg }, '7', O))).trade; ok(t.entry === avg, 'FIX2 a netted entry in a history row comes back exactly: ' + t.entry); }
  { const sa = { ...sm, type: 'demo', set: { jur: 'eu', lev: 30, slip: 'sym', slipSd: 0.2, latMs: 120, comm: 7 } }, b = D.baToSummary(wire('BA', D.summaryToBA(sa, '7'))); same(sm, b.summary, 'BA with settings: the amounts unchanged'); same({ type: 'demo', set: sa.set }, b.info, 'BA carries the account type and settings'); ok(D.baToSummary(bm).info === undefined, 'a BA without settings has no info'); }
  same({ ...tr, leg: null }, D.aeToTrade(wire('AE', D.tradeToAE({ ...tr, leg: null }, '7', O))).trade, 'trade with null leg');
  const nb = { id: 9, sym: 'EURUSD', side: 'nbp', lots: 0, entry: 1.0825, exit: 1.0825, open: 1793611800, close: 1793611800, pnl: 412.5, pips: 0, r: null, reason: 'Negative balance protection', note: '', setup: '', swap: 0, nbp: true };
  const nm = wire('AE', D.tradeToAE(nb, '7', O)), nr = D.aeToTrade(nm).trade;
  const { note, setup, r, ...nbExp } = nb; same({ ...nbExp, leg: null }, nr, 'nbp credit row round trip (null/empty r, note, setup are absent; leg decodes null)');
  ok(nm.fields.get('54') === undefined && nm.fields.get('5025') === 'Y' && nr.side === 'nbp' && nr.nbp === true && nr.pnl === 412.5, 'nbp row: no 54, 5025=Y, side restored');
  const st = { jur: 'eu', lev: null, slip: 'sym', slipSd: 0.2, latMs: 120, comm: 3.5, type: 'demo' };
  const um = wire(D.MSG.ACCOUNT, D.settingsToU1(st, '7')); same(st, D.u1ToSettings(um).settings, 'settings round trip (lev null = sheet default)');
  ok(D.u1Op(um) === 'SET' && D.MSG.ACCOUNT === 'U1', 'settings go as U1 SET');
  same({ ...st, lev: 100 }, D.u1ToSettings(wire('U1', D.settingsToU1({ ...st, lev: 100 }, '7'))).settings, 'settings with leverage');
  const rm = wire('U1', D.resetToU1('7')); ok(D.u1Op(rm) === 'RESET' && D.u1ToReset(rm).account === '7', 'reset request');
}

// FIX1-FIX4: allow-lists, ExecutionReport contract, lot digits, no empty values
{
  const rc = { fid: 5, t: 1793611800, sym: 'EURUSD', side: 'buy', lots: 1, pos: 1, order: 2, kind: 'open', bid: 1.1, ask: 1.2, px: 1.2 };
  const ids = { orderId: '2', execId: '5', clOrdId: 'c', account: '7' };
  const throws = f => { try { f(); return false; } catch { return true; } };
  // FIX1: unlisted keys throw on encode; decode drops unknown JSON keys and never lets 5020 override a standard tag
  ok(throws(() => D.execToReport({ kind: 'fill', receipt: { ...rc, secret: 1 } }, ids, O)), 'FIX1 receipt with an unlisted key throws');
  ok(throws(() => D.posToAP({ id: 1, sym: 'EURUSD', side: 'buy', lots: 1, sl: 1.05 }, '7', O)), 'FIX1 position with an unlisted key throws');
  ok(throws(() => D.tradeToAE({ id: 1, sym: 'EURUSD', side: 'buy', lots: 1, bogus: 'x' }, '7', O)), 'FIX1 trade with an unlisted key throws');
  ok(throws(() => D.orderToD({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'market', pm: {} }, 'c', '7', O)), 'FIX1 order with an unlisted key throws');
  const hostile = D.execToReport({ kind: 'fill', receipt: rc }, ids, O).filter(([t]) => t !== 5020);
  hostile.push([5020, '{"__proto__":{"polluted":1},"constructor":{"x":1},"evil":1,"lots":99,"px":99,"bid":7,"model":{"on":true,"zzz":1,"__proto__":{"q":1}}}']);
  const h = D.reportToExec(wire('8', hostile)).receipt;
  ok(h.bid === 7 && h.lots === 1 && h.px === 1.2 && h.evil === undefined && h.polluted === undefined && ({}).polluted === undefined && Object.getPrototypeOf(h) === Object.prototype && canon(h.model) === canon({ on: true }), 'FIX1 hostile 5020: standard tags win, unknown keys dropped, no prototype pollution: ' + canon(h));
  ok(D.reportToExec(wire('8', [...hostile.filter(([t]) => t !== 5020), [5020, 'not json{']])).receipt.lots === 1, 'FIX1 malformed 5020 is ignored');
  // FIX2
  ok(throws(() => D.execToReport({ kind: 'new' }, { clOrdId: 'c', account: '7' }, O)) && throws(() => D.execToReport({ kind: 'fill', receipt: rc }, { ...ids, execId: undefined }, O)), 'FIX2 execId is required');
  ok(throws(() => D.execToReport({ kind: 'fill', receipt: rc }, { ...ids, execId: '6' }, O)), 'FIX2 receipt.fid must match execId');
  const m = wire('8', D.execToReport({ kind: 'fill', receipt: rc }, ids, O));
  ok(!/"fid"|"order"/.test(m.fields.get('5020') ?? ''), 'FIX2 no fid/order copy in 5020: ' + m.fields.get('5020'));
  ok(m.fields.get('17') === '5' && m.fields.get('37') === '2' && D.reportToExec(m).receipt.fid === 5 && D.reportToExec(m).receipt.order === 2, 'FIX2 fid/order come from 17/37');
  // FIX2b: the session-unique ExecID '<account>:<fid>' keeps the fid derivable; a different fid still throws
  const ma = wire('8', D.execToReport({ kind: 'fill', receipt: rc }, { ...ids, execId: 'u7-dev:5' }, O)), ra = D.reportToExec(ma);
  ok(ma.fields.get('17') === 'u7-dev:5' && ra.ids.execId === 'u7-dev:5' && ra.receipt.fid === 5, 'FIX2b ExecID account:fid, fid from the suffix');
  ok(throws(() => D.execToReport({ kind: 'fill', receipt: rc }, { ...ids, execId: 'u7:6' }, O)), 'FIX2b account:fid must carry the receipt fid');
  // FIX3: lot digits everywhere
  const L = { ...O, lotDigits: sym => (sym === 'XAUUSD' ? 2 : 3) };
  ok(wire('D', D.orderToD({ sym: 'EURUSD', side: 'buy', lots: 0.1, ot: 'market' }, 'c', '7', L)).fields.get('38') === '0.100', 'FIX3 D lots at lotDigits');
  ok(wire('F', D.cancelToF({ clOrdId: 'c2', origClOrdId: 'c', account: '7', sym: 'XAUUSD', side: 'buy', lots: 2 }, L)).fields.get('38') === '2.00', 'FIX3 F always carries 38, at lotDigits');
  ok(throws(() => D.cancelToF({ clOrdId: 'c2', origClOrdId: 'c', account: '7', sym: 'XAUUSD', side: 'buy' }, L)), 'FIX3 cancel without lots throws');
  ok(wire('G', D.replaceToG({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.1 }, 'c3', 'c', '7', L)).fields.get('38') === '1.000', 'FIX3 G lots at lotDigits');
  ok(wire('8', D.execToReport({ kind: 'fill', receipt: rc }, ids, L)).fields.get('32') === '1.000' && wire('8', D.execToReport({ kind: 'fill', receipt: rc }, ids, L)).fields.get('14') === '1.000', 'FIX3 execution lots at lotDigits');
  ok(wire('AP', D.posToAP({ id: 1, sym: 'EURUSD', side: 'buy', lots: 2.5 }, '7', L)).fields.get('704') === '2.500', 'FIX3 AP quantity at lotDigits');
  // FIX4: no empty value is ever sent
  const all = [D.settingsToU1({ jur: 'eu', lev: null, slip: 'off', slipSd: 0, latMs: 0, comm: 0, type: 'demo' }, '7'), D.execToReport({ kind: 'cancel', text: '' }, ids, O),
    D.tradeToAE({ id: 1, sym: 'EURUSD', side: 'buy', lots: 1, reason: '', leg: null }, '7', O), D.summaryToBA({ balance: 1, equity: 1, margin: 0, free: 1, level: null, fl: null }, '7')];
  ok(all.every(f => f.every(([t, v]) => String(v) !== '')), 'FIX4 no field has an empty value');
  const sa = D.u1ToSettings(wire('U1', all[0])).settings; ok(sa.lev === null, 'FIX4 absent lev decodes null');
  const sb = D.baToSummary(wire('BA', all[3])).summary; ok(sb.level === null && sb.fl === null && sb.margin === 0, 'FIX4 absent amounts decode null');
  // minors: latin1 0x80-0xFF stays literal, 126 only for GTD
  const lt = wire('8', D.execToReport({ kind: 'reject', code: 'X', text: 'café —' }, { execId: '9', clOrdId: 'c', account: '7' }, O));
  ok(lt.fields.get('58') === 'café \\u2014' && D.reportToExec(lt).text === 'café —', 'esc keeps 0x80-0xFF literal and escapes only >0xFF');
  ok(throws(() => D.orderToD({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1, tif: 'GTD' }, 'c', '7', O)), 'GTD without expires throws');
  ok(wire('D', D.orderToD({ sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1, tif: 'DAY', expires: 1793611800 }, 'c', '7', O)).fields.get('126') === undefined, '126 only when tif is GTD');
  const px = wire('8', D.execToReport({ kind: 'fill', receipt: { ...rc, px: 1.2 } }, ids, O));
  ok(px.fields.get('31') === '1.2' && px.fields.get('6') === '1.2', 'report prices (31, 6) at full precision');
  { const v = 1.1001466746343567, r = D.reportToExec(wire('8', D.execToReport({ kind: 'fill', receipt: { ...rc, px: v } }, ids, O))); ok(r.receipt.px === v, 'a fill price comes back exactly: ' + r.receipt.px); }
  { const d = D.dToOrder(wire('D', D.orderToD({ sym: 'EURUSD', side: 'sell', lots: 1, ot: 'market', posId: 4, reason: 'Basket stop' }, 'c', '7', O))); ok(d.req.reason === 'Basket stop' && d.req.posId === 4, 'a D carries its reason (5016)'); }
}

// FD5 (the broker's answers): order-carrying reports (new, restated, replaced, status), AO, a flat AP, j and 9
{
  const ids = { execId: 'X9', orderId: '12', clOrdId: 'tb-7-3', account: '7', sym: 'EURUSD', side: 'sell', lots: 1 };
  const order = { ot: 'stop', price: 1.05, tif: 'GTC', linkPos: 42, leg: 'SL' };
  for (const kind of ['new', 'restated', 'replaced']) {
    const r = D.reportToExec(wire('8', D.execToReport({ kind, order }, ids, O)));
    ok(r.kind === kind && r.ids.lots === 1 && r.ids.sym === 'EURUSD', `FD5 ${kind} kind and ids`);
    same(order, r.order, `FD5 ${kind} carries the order`);
  }
  const st = wire('8', D.execToReport({ kind: 'status', ordStatus: 'working', order: { ot: 'limit', price: 1.06, tif: 'GTD', expires: 1793611800, oca: 'g1' } }, { ...ids, massId: 'm1', total: 3 }, O));
  const sr = D.reportToExec(st);
  ok(st.fields.get('150') === 'I' && st.fields.get('39') === '0' && sr.kind === 'status' && sr.ordStatus === 'working' && sr.massId === 'm1' && sr.total === 3, 'FD5 status report: 150=I, 39=0, mass id and total');
  ok(sr.order.expires === 1793611800 && sr.order.oca === 'g1', 'FD5 status keeps GTD expiry and the OCO group');
  ok(D.reportToExec(wire('8', D.execToReport({ kind: 'status', ordStatus: 'filled' }, ids, O))).ordStatus === 'filled', 'FD5 status filled');
  const ao = D.aoToAck(wire('AO', D.posAckToAO({ reqId: 'r1', account: '7', total: 2 })));
  ok(ao.reqId === 'r1' && ao.account === '7' && ao.total === 2 && ao.result === 0, 'FD5 AO round trip: ' + JSON.stringify(ao));
  const fl = D.apToPos(wire('AP', D.flatToAP({ id: 42, sym: 'EURUSD' }, '7', { reqId: 'r1' })));
  ok(fl.pos.id === 42 && fl.pos.lots === 0 && fl.pos.sym === 'EURUSD' && fl.account === '7', 'FD5 a closed position goes as a flat AP: ' + JSON.stringify(fl));
  const j = D.jToReject(wire('j', D.rejectToJ({ refSeq: 5, refMsgType: 'U1', account: '7', code: 'NOT_DEMO', text: 'Reset is available on demo accounts only' })));
  ok(j.refSeq === 5 && j.refMsgType === 'U1' && j.code === 'NOT_DEMO' && j.text === 'Reset is available on demo accounts only' && j.account === '7', 'FD5 j round trip: ' + JSON.stringify(j));
  const n9 = D.nineToCxlReject(wire('9', D.cxlRejectTo9({ clOrdId: 'c2', origClOrdId: 'c1', account: '7', responseTo: 'G', code: 'NO_ORDER', text: 'Order not found' })));
  ok(n9.clOrdId === 'c2' && n9.origClOrdId === 'c1' && n9.responseTo === 'G' && n9.code === 'NO_ORDER' && n9.text === 'Order not found' && n9.orderId === null, 'FD5 9 round trip: ' + JSON.stringify(n9));
}

// FD6 (final review): exits on D / G and on order reports, the history window (AD / AQ), records (U2 / U3), the peak in BA
{
  const req = { sym: 'EURUSD', side: 'buy', lots: 1, ot: 'limit', price: 1.09, tif: 'GTC', sl: 1.085, tp: 1.1, slPips: 20, tpPips: 40, trail: 25, tps: [{ price: 1.095, lots: .4 }, { price: 1.1, lots: .6 }], be: { at: 15, off: 1, onTp: true } };
  const r = D.dToOrder(wire('D', D.orderToD(req, 'c1', '7', O))).req;
  same(req, r, 'FD6 a D carries the exits (5050-5056)');
  const pr = D.dToOrder(wire('D', D.orderToD({ ...req, tps: [{ pips: 20, pct: 50 }, { pips: 40, pct: 50 }], be: { at: null, off: 0, onTp: true } }, 'c2', '7', O))).req;
  ok(pr.tps[1].pips === 40 && pr.tps[1].pct === 50 && pr.be.at === null && pr.be.onTp === true, 'FD6 pip rows and a break-even after TP1');
  let threw = false; try { D.orderToD({ ...req, tps: [{ price: 1, lots: 1, evil: 'x' }] }, 'c3', '7', O); } catch { threw = true; }
  ok(threw, 'FD6 a target row with a key outside price / lots / pips / pct is refused');
  const g = D.gToReplace(wire('G', D.replaceToG(req, 'c4', 'c1', '7', O)));
  ok(g.req.slPips === 20 && g.req.tps.length === 2 && g.origClOrdId === 'c1', 'FD6 a G carries them too');
  const ex = D.reportToExec(wire('8', D.execToReport({ kind: 'new', order: { ot: 'limit', price: 1.09, tif: 'GTC', slPips: 20, trail: 25, be: { at: 15, off: 1, onTp: false } } }, { execId: 'X1', clOrdId: 'c1', account: '7', sym: 'EURUSD', side: 'buy', lots: 1 }, O)));
  ok(ex.order.slPips === 20 && ex.order.trail === 25 && ex.order.be.at === 15, 'FD6 an order report carries its exits: ' + JSON.stringify(ex.order));
  ok(D.EXIT_KEYS.join() === 'sl,tp,slPips,tpPips,trail,tps,be', 'FD6 EXIT_KEYS');
  const ad = D.adToHist(wire('AD', D.histToAD({ reqId: 'h1', account: '7', max: 500, skip: 1000 })));
  ok(ad.reqId === 'h1' && ad.max === 500 && ad.skip === 1000 && ad.account === '7', 'FD6 AD window: ' + JSON.stringify(ad));
  const all = D.adToHist(wire('AD', D.histToAD({ reqId: 'h2', account: '7' })));
  ok(all.max === null && all.skip === 0, 'FD6 AD without a window: all of it');
  const aq = D.aqToAck(wire('AQ', D.histAckToAQ({ reqId: 'h1', account: '7', total: 1234 })));
  ok(aq.reqId === 'h1' && aq.total === 1234, 'FD6 AQ total');
  const fills = Array.from({ length: 120 }, (_, i) => ({ fid: 120 - i, t: 1e9 - i, sym: 'EURUSD', side: 'buy', lots: 1, pos: 3, order: null, kind: 'open', px: 1.1, model: { on: true, sd: .2, lat: 120, live: true, junk: 'x' }, extra: 'dropped' }));
  const u3 = D.recordsToU3('fill', fills, '7', 'r1');
  ok(u3.length === 3, 'FD6 U3 in messages of 50 rows: ' + u3.length);
  const back = u3.flatMap(f => D.u3ToRecords(wire('U3', f)).rows);
  ok(back.length === 120 && back[0].fid === 120 && !('extra' in back[0]) && back[0].model.sd === .2, 'FD6 U3 rows round trip, allow-listed');
  const lg = D.u3ToRecords(wire('U3', D.recordsToU3('log', [{ id: 4, sym: 'EURUSD', side: 'sell', ot: 'limit', price: 1.2, lots: 1, status: 'cancelled', why: 'Cancelled', end: 5, tps: [{ pips: 10, pct: 50 }] }], '7', 'r1')[0]));
  ok(lg.kind === 'log' && lg.rows[0].status === 'cancelled' && lg.rows[0].tps[0].pips === 10, 'FD6 an order-log row');
  const u2 = D.u2ToRecords(wire('U2', D.recordsToU2({ account: '7', reqId: 'r1', fills: 900, log: 300 })));
  ok(u2.fills === 500 && u2.log === 300 && u2.reqId === 'r1', 'FD6 U2 capped at 500 / 300');
  const ba = D.baToSummary(wire('BA', D.summaryToBA({ balance: 1, equity: 2, margin: 0, free: 2, level: Infinity, fl: 1, peak: 103210.5 }, '7')));
  ok(ba.summary.peak === 103210.5, 'FD6 the BA carries the peak (PEAK)');
}

// FD4: every tag used anywhere above is standard (dict) or custom in 5000-9999; the dialect's own constants likewise
{
  const stray = [...seen].filter(t => !STD.has(t) && !(t >= 5000 && t <= 9999));
  ok(!stray.length, 'FD4 no tag outside 5000-9999 besides the dictionary ones: ' + stray);
  ok([...seen].filter(t => !STD.has(t)).length >= 10, 'FD4 the run really used custom tags');
  const own = Object.entries(D.TAG).filter(([, t]) => t !== 721 && !(t >= 5000 && t <= 9999));
  ok(!own.length, 'FD4 dialect TAG constants: ' + JSON.stringify(own));
  ok(D.TAG.POS_ID === 721 && D.TAG.OCO_GROUP === 5001 && D.TAG.LINK_POS === 5002 && D.TAG.LEG === 5003 && D.TAG.SLIP === 5010 && D.TAG.SPREAD === 5011 && D.TAG.LAT === 5012 && D.TAG.GAP === 5013 && D.TAG.COMM === 5014 && D.TAG.SWAP === 5015 && D.TAG.REASON === 5016 && D.TAG.REJ_CODE === 5017, 'FD4 constants are the briefed numbers');
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
