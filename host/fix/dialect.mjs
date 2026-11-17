// FIX dialect: the ONLY module that knows how tradeBerry's objects look as FIX 4.4 fields. When tradeBerry connects to the
// real server this is the file that changes (plus address, CompIDs and credentials). Functions work on `fields` arrays
// ([[tag, value], ...], ready for codec.encode) and on parsed messages (codec Parser: msg.fields is a Map keyed by tag STRINGS,
// msg.groups a Map of repeating-group entries). No browser globals: formatting comes from `opts`:
//   opts.digits     price digits, number or sym => number (prices go out as fixed-decimal strings)
//   opts.lotDigits  lot digits, number or sym => number (tag 38/32/14/151 and AP quantities)
//   opts.now        ms epoch for 60 TransactTime where the object has no time of its own (default Date.now())
//
// Custom tags (design spec, "Dialect"): only 5000-9999, plus 721 PosMaintRptID, which the spec fixes as the position id.
//   721 POS_ID   position id: on D (close that position), on 8, on AP      5001 OCO_GROUP  OCO/OCA group of a pending order
//   5002 LINK_POS  reduce-only link of an SL/TP order to a position        5003 LEG  'SL' | 'TP1'..'TP4'
//   5004 NET  Y: the order nets on its instrument's book when it fills (no basket leg); omitted when false (decodes absent)
//   5010 SLIP  5011 SPREAD  5012 LAT  5013 GAP (Y/N, or pips)  5014 COMM  5015 SWAP  5016 REASON (free text; on a D / G too: the
//        reason the broker writes on the fill and the history row of the close it makes, e.g. 'Basket stop')  5017 REJ_CODE (text in 58)
//   5018 INIT_MARGIN (position im)   5019 OPEN_TIME (position/trade open, sec)   5021 ENTRY_PX (trade entry)
//   5022 CLOSE_TIME (trade close, sec)   5023 PNL (trade)   5024 PIPS (trade)   5026 R_MULT   5027 NOTE   5028 SETUP (trade, free text)
//   5025 NBP  Y on a negative-balance-protection credit row of the history ({side:'nbp', nbp:true, lots:0, pnl}): 54 is then omitted and decode restores side 'nbp'.
//        Empty note/setup are not sent (no empty values), so they decode as absent.
//   5020 EXT_JSON  ONLY on a fill's ExecutionReport: JSON (ASCII) holding exactly the receipt keys that have no tag:
//        bid, ask, ref, refKind, model{on,sd,lat,live}, slipUsd, spreadUsd, kind. Nothing else may travel there: encoding any
//        key that is in no table throws, decoding builds the object from the same allow-list and ignores the rest. A standard
//        or custom tag always wins over the same key in 5020.
//   U1 (user-defined, temporary broker only) account settings: 5030 JUR 5031 LEV (omitted = sheet default) 5032 SLIP 5033 SLIP_SD
//        5034 LAT_MS 5035 COMM_CFG 5036 ACCT_TYPE 'demo'|'live'; 5040 U1_OP 'SET' | 'RESET' (reset a demo account) | 'UNHEDGE' with 721 (a former basket leg joins the net book). The same
//        5030-5036 ride on a BA (summary.type, summary.set): the account's type and settings as the broker holds them.
// Standard tags used out of their usual place: 730 SettlPrice = a position's entry price (AP), at full precision (a
// netted or averaged entry is not a quote: rounding it would change the position's P&L; the same for a fill's 31 / 6 and
// a trade's 5021 ENTRY_PX, which carry such entries and fill prices at full precision); 753/707/708 on BA (CollateralReport)
// carry the account amounts as a group, with NON-STANDARD 707 PosAmtType values BAL, EQ, MRG, FREE, LVL, FL (balance, equity, margin,
// free margin, margin level, floating P&L); an infinite margin level is the text INF in 708.
// Receipt: 17 ExecID is '<account>:<fid>' (unique in the session: fill ids count per account; a bare fid is accepted too),
// 37 OrderID the order (NONE when the fill has none), 60 TransactTime is the receipt's t (sec); the fid is the ExecID's suffix.
// The broker's answers (temporary broker): ExecutionReports also as restated (150=D: the broker changed the order itself, a
// linked stop or target resized to the position), replaced (150=5) and status (150=I, OrdStatus in 39, answers to H / AF
// with 584 MassStatusReqID and 911 TotNumReports), each carrying the order's terms like a D (40/44/99/59/126 and the
// dialect tags); AO (posAckToAO: 710, 727 total, 728/729); a flat AP for a position no longer open (flatToAP: 704 = 705 = 0,
// decodes as lots 0). A reject ER (150=8) right after a fill with the SAME ClOrdID and OrderID is a reversal's remainder
// refused (text "Reversal remainder not opened: …"): the fill stands, only the remainder was not opened; it does not mean
// the order was rejected. An H answer can carry 39=5 (replaced): the ClOrdID was replaced by a G. j (rejectToJ: 45/372/380, code in 5017, text in 58) and 9 (cxlRejectTo9: 434 = 1 for F, 2 for G).
// Null and undefined are "absent": no tag is ever sent with an empty value, and a decode gives null for the keys marked nullable.
// DAY and GTC orders send no 126; the gateway owns their expiry. Only GTD sends it (and requires `expires`).
// Exits of an order (final review I5, 03.11.2026): a D (market or pending), a G of a working order and the broker's order
// reports carry the exits of the position the order opens, so the broker creates its linked stop loss and targets at the
// fill, in the same step (no gateway needed then): 5050 SL_PX (stop price) 5051 TP_PX (target price) 5052 SL_PIPS 5053 TP_PIPS
// (from the fill) 5054 TRAIL (pips; with no stop the stop starts at fill ∓ trail) 5055 TPS (JSON rows, at most 4: {price, lots}
// or {pips, pct}) 5056 BE (JSON {at, off, onTp}: the broker keeps it, the gateway moves the stop). A G of a working order is
// the order in full: its exits replace the order's (absent = none).
// History (I7, M6): AD may carry 5060 MAX_ROWS and 5061 SKIP_ROWS (newest first: the window skips the newest SKIP rows and
// keeps the next MAX); the broker answers AQ (568, 748 TotNumTradeReports = every row of the history, 749 / 750 = 0) before
// the window's AE rows (oldest first within the window).
// Records (I7, temporary broker): U2 (1, 5062 REQ_ID, 5063 FILLS_MAX, 5064 LOG_MAX) asks for the newest fill receipts and
// order-log rows the broker holds (its executions, the migrated ones too); U3 (1, 5062, 5065 'fill' | 'log', 5066 JSON array
// of at most 50 rows, newest first) answers, as many as needed. Receipt keys and order-log keys are allow-listed (RECORD_KEYS).
// A BA carries the account's peak equity as the amount type PEAK (707): the drawdown readout is the same on every device.
export const TAG = {
  POS_ID: 721, OCO_GROUP: 5001, LINK_POS: 5002, LEG: 5003, NET: 5004,
  SLIP: 5010, SPREAD: 5011, LAT: 5012, GAP: 5013, COMM: 5014, SWAP: 5015, REASON: 5016, REJ_CODE: 5017,
  INIT_MARGIN: 5018, OPEN_TIME: 5019, EXT_JSON: 5020, ENTRY_PX: 5021, CLOSE_TIME: 5022, PNL: 5023, PIPS: 5024, NBP: 5025, R_MULT: 5026, NOTE: 5027, SETUP: 5028,
  SL_PX: 5050, TP_PX: 5051, SL_PIPS: 5052, TP_PIPS: 5053, TRAIL: 5054, TPS: 5055, BE: 5056, MAX_ROWS: 5060, SKIP_ROWS: 5061,
  REQ_ID: 5062, FILLS_MAX: 5063, LOG_MAX: 5064, ROW_KIND: 5065, ROWS_JSON: 5066,
  SET_JUR: 5030, SET_LEV: 5031, SET_SLIP: 5032, SET_SLIP_SD: 5033, SET_LAT_MS: 5034, SET_COMM: 5035, ACCT_TYPE: 5036, U1_OP: 5040,
};
export const MSG = { ACCOUNT: 'U1' };

const SIDE = { buy: '1', sell: '2' }, SIDE_R = { 1: 'buy', 2: 'sell' };
const OT = { market: '1', limit: '2', stop: '3', stoplimit: '4' }, OT_R = { 1: 'market', 2: 'limit', 3: 'stop', 4: 'stoplimit' };
const TIF = { DAY: '0', GTC: '1', GTD: '6' }, TIF_R = { 0: 'DAY', 1: 'GTC', 6: 'GTD' };
const AMT = { balance: 'BAL', equity: 'EQ', margin: 'MRG', free: 'FREE', level: 'LVL', fl: 'FL', peak: 'PEAK' }, AMT_R = Object.fromEntries(Object.entries(AMT).map(([k, v]) => [v, k]));
const hex4 = c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0');
const fin = v => typeof v === 'number' && Number.isFinite(v);
const bad = (what, v) => { throw new Error(`FIX dialect: ${what} ${JSON.stringify(v)}`); };

// number as plain decimal (never 1e-7), no trailing zeros
const num = v => { const s = String(v); return /e/i.test(s) ? v.toFixed(12).replace(/\.?0+$/, '') : s; };
const fixed = (v, d) => (d == null ? num(v) : v.toFixed(d));
const dig = (o, key, sym) => (typeof o?.[key] === 'function' ? o[key](sym) : o?.[key]);
const ctxOf = (opts, sym) => ({ d: dig(opts, 'digits', sym), ld: dig(opts, 'lotDigits', sym) });
// reversible latin1-safe text: backslash, control chars and anything above 0xFF become \\ and \uXXXX (0x80-0xFF stay literal)
const esc = s => s.replace(/\\/g, '\\\\').replace(/[\x00-\x1f\x7fĀ-￿]/g, hex4);
const unesc = s => s.replace(/\\(\\|u[0-9a-fA-F]{4})/g, (_, g) => (g === '\\' ? '\\' : String.fromCharCode(parseInt(g.slice(1), 16))));
const jenc = o => JSON.stringify(o).replace(/[^\x20-\x7e]/g, hex4);
const jdec = s => { try { const j = JSON.parse(s); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; } };
const t2 = n => String(n).padStart(2, '0');
// FIX UTCTimestamp: 20261102-09:30:00.123, or without milliseconds for 126 ExpireTime
export function fixTime(ms, withMs = true) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${t2(d.getUTCMonth() + 1)}${t2(d.getUTCDate())}-${t2(d.getUTCHours())}:${t2(d.getUTCMinutes())}:${t2(d.getUTCSeconds())}${withMs ? '.' + String(d.getUTCMilliseconds()).padStart(3, '0') : ''}`;
}
const parseTime = s => { const m = /^(\d{4})(\d\d)(\d\d)-(\d\d):(\d\d):(\d\d)(?:\.(\d{1,3}))?$/.exec(s); return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6], m[7] ? +m[7].padEnd(3, '0') : 0) : NaN; };
const now = o => fixTime(o?.now ?? Date.now());
const ROW_KEYS = ['price', 'lots', 'pips', 'pct'];
const tpsRow = r => !!r && typeof r === 'object' && !Array.isArray(r) && Object.keys(r).every(k => ROW_KEYS.includes(k) ? r[k] == null || fin(r[k]) : r[k] === undefined);
const cleanRow = r => Object.fromEntries(ROW_KEYS.filter(k => fin(r[k])).map(k => [k, r[k]]));
const cleanBe = b => ({ at: fin(b.at) ? b.at : null, off: fin(b.off) ? b.off : 0, onTp: !!b.onTp });

// field tables: [key, tag, kind, nullable?]; kinds: n number, p price (at digits), q lots (at lotDigits), s text, g gap (bool or number), side buy|sell
const KIND = {
  n: { ok: fin, enc: num, dec: Number },
  p: { ok: fin, enc: (v, c) => fixed(v, c.d), dec: Number },
  q: { ok: fin, enc: (v, c) => fixed(v, c.ld), dec: Number },
  s: { ok: v => typeof v === 'string' && v !== '', enc: esc, dec: unesc },
  g: { ok: v => typeof v === 'boolean' || fin(v), enc: v => (v === true ? 'Y' : v === false ? 'N' : num(v)), dec: v => (v === 'Y' ? true : v === 'N' ? false : Number(v)) },
  side: { ok: v => v in SIDE, enc: v => SIDE[v], dec: v => SIDE_R[v] },
  y: { ok: v => typeof v === 'boolean', enc: () => 'Y', dec: v => v === 'Y' }, // a flag: sent only when true
  // target rows (5055): 1-4 objects of finite price / lots / pips / pct only
  tps: { ok: v => Array.isArray(v) && v.length >= 1 && v.length <= 4 && v.every(tpsRow), enc: v => jenc(v.map(cleanRow)), dec: v => { try { const j = JSON.parse(v); return Array.isArray(j) && j.length <= 4 && j.every(tpsRow) ? j.map(cleanRow) : undefined; } catch { return undefined; } } },
  // break-even (5056): { at (pips or null), off (pips), onTp }
  be: { ok: v => !!v && typeof v === 'object' && !Array.isArray(v) && (v.at == null || fin(v.at)) && (v.off == null || fin(v.off)), enc: v => jenc(cleanBe(v)), dec: v => { try { const j = JSON.parse(v); return j && typeof j === 'object' && !Array.isArray(j) ? cleanBe(j) : undefined; } catch { return undefined; } } },
};
// obj -> tagged fields. null/undefined are absent; a key in no table (nor in `skip`/`ext`) or a value of the wrong type throws.
function put(obj, table, ctx, skip = [], ext = []) {
  const known = new Set([...table.map(e => e[0]), ...skip, ...ext]), f = [];
  for (const k of Object.keys(obj)) if (!known.has(k) && obj[k] !== undefined && obj[k] !== null && obj[k] !== '') bad('field with no tag', k);
  for (const [key, tag, kind] of table) {
    const v = obj[key]; if (v === undefined || v === null || v === '') continue;
    if (!KIND[kind].ok(v)) bad(`${key} has the wrong type`, v);
    if (kind === 'y' && v === false) continue;
    f.push([tag, KIND[kind].enc(v, ctx)]);
  }
  return f;
}
const one = (m, tag) => { const v = m.fields.get(String(tag)); return Array.isArray(v) ? v[0] : v; };
function take(msg, table) {
  const out = {};
  for (const [key, tag, kind, nul] of table) { const v = one(msg, tag); if (v !== undefined) out[key] = KIND[kind].dec(v); else if (nul) out[key] = null; }
  return out;
}
// the 5020 allow-list: values must be plain scalars; model is rebuilt from its own four keys
const MODEL = ['on', 'sd', 'lat', 'live'];
const scalar = v => v === null || typeof v === 'string' || typeof v === 'boolean' || fin(v);
const cleanModel = m => (m && typeof m === 'object' ? Object.fromEntries(MODEL.filter(k => Object.hasOwn(m, k) && scalar(m[k])).map(k => [k, m[k]])) : null);
function extOf(obj, keys) {
  const j = {};
  for (const k of keys) {
    const v = obj[k]; if (v === undefined) continue;
    if (k === 'model') { if (v !== null && typeof v !== 'object') bad('model', v); j.model = cleanModel(v); } else if (scalar(v)) j[k] = v; else bad(`${k} cannot travel in EXT_JSON`, v);
  }
  return Object.keys(j).length ? [[TAG.EXT_JSON, jenc(j)]] : [];
}
function unext(msg, out, keys) {
  const s = one(msg, TAG.EXT_JSON); if (s === undefined) return out;
  const j = jdec(s);
  for (const k of keys) if (out[k] === undefined && Object.hasOwn(j, k)) out[k] = k === 'model' ? cleanModel(j.model) : j[k];
  return out;
}

// ---- orders -----------------------------------------------------------------------------------------------------
const ORDER_X = [['posId', TAG.POS_ID, 'n'], ['linkPos', TAG.LINK_POS, 'n'], ['leg', TAG.LEG, 's'], ['oca', TAG.OCO_GROUP, 's'], ['net', TAG.NET, 'y'], ['reason', TAG.REASON, 's'],
  ['sl', TAG.SL_PX, 'n'], ['tp', TAG.TP_PX, 'n'], ['slPips', TAG.SL_PIPS, 'n'], ['tpPips', TAG.TP_PIPS, 'n'], ['trail', TAG.TRAIL, 'n'], ['tps', TAG.TPS, 'tps'], ['be', TAG.BE, 'be']];
// the exits an order carries for the position it opens (5050-5056)
export const EXIT_KEYS = ['sl', 'tp', 'slPips', 'tpPips', 'trail', 'tps', 'be'];
const ORDER_CORE = ['sym', 'side', 'lots', 'ot', 'price', 'limit', 'tif', 'expires'];

// order request {sym, side, lots, ot, price, limit, tif, expires(sec), posId?, linkPos?, leg?, oca?} -> D fields.
// price: limit -> 44; stop -> 99; stoplimit -> trigger in 99 and limit price in 44; market -> 44 only if given.
export function orderToD(req, clOrdId, account, opts) {
  if (!(req.side in SIDE)) bad('side', req.side);
  if (!(req.ot in OT)) bad('order type', req.ot);
  if (!fin(req.lots)) bad('lots', req.lots);
  const c = ctxOf(opts, req.sym), f = [[11, clOrdId], [1, account], [55, req.sym], [54, SIDE[req.side]], [60, now(opts)], [38, fixed(req.lots, c.ld)]];
  const rest = Object.fromEntries(Object.entries(req).filter(([k]) => !['sym', 'side', 'lots'].includes(k)));
  return [...f, ...orderFields(rest, c)];
}
// the order terms after 38: 40, 44/99, 59, 126 and the dialect tags (also carried by the broker's order reports)
function orderFields(req, c) {
  if (!(req.ot in OT)) bad('order type', req.ot);
  const f = [[40, OT[req.ot]]];
  const P = (tag, v) => { if (v == null) return; if (!fin(v)) bad('price', v); f.push([tag, fixed(v, c.d)]); };
  if (req.ot === 'stop' || req.ot === 'stoplimit') { P(99, req.price); if (req.ot === 'stoplimit') P(44, req.limit); else if (req.limit != null) bad('limit on a ' + req.ot, req.limit); } else { P(44, req.price); if (req.limit != null) bad('limit on a ' + req.ot, req.limit); }
  if (req.tif != null) { if (!(req.tif in TIF)) bad('tif', req.tif); f.push([59, TIF[req.tif]]); }
  if (req.tif === 'GTD') { if (!fin(req.expires)) bad('GTD without expires', req.expires); f.push([126, fixTime(Math.floor(req.expires) * 1000, false)]); }
  const rest = Object.fromEntries(Object.entries(req).filter(([k]) => !ORDER_CORE.includes(k)));
  return [...f, ...put(rest, ORDER_X, c)];
}
function takeOrder(msg) {
  const ot = OT_R[one(msg, 40)], req = { ot };
  const p44 = one(msg, 44), p99 = one(msg, 99), n = v => (v === undefined ? undefined : Number(v));
  if (ot === 'stop' || ot === 'stoplimit') { if (p99 !== undefined) req.price = n(p99); if (p44 !== undefined) req.limit = n(p44); } else if (p44 !== undefined) req.price = n(p44);
  const tif = TIF_R[one(msg, 59)]; if (tif) req.tif = tif;
  const e = one(msg, 126); if (e !== undefined && tif === 'GTD') req.expires = parseTime(e) / 1000;
  return Object.assign(req, take(msg, ORDER_X));
}
// D -> { req, clOrdId, account }
export function dToOrder(msg) {
  const req = { sym: one(msg, 55), side: SIDE_R[one(msg, 54)], lots: Number(one(msg, 38)), ...takeOrder(msg) };
  return { req, clOrdId: one(msg, 11), account: one(msg, 1) };
}
// cancel {clOrdId, origClOrdId, account, sym, side, lots} -> F fields (38 is always sent)
export function cancelToF(x, opts) {
  if (!(x.side in SIDE)) bad('side', x.side);
  if (!fin(x.lots)) bad('lots', x.lots);
  return [[41, x.origClOrdId], [11, x.clOrdId], [1, x.account], [55, x.sym], [54, SIDE[x.side]], [60, now(opts)], [38, fixed(x.lots, ctxOf(opts, x.sym).ld)]];
}
export const fToCancel = msg => ({ clOrdId: one(msg, 11), origClOrdId: one(msg, 41), account: one(msg, 1), sym: one(msg, 55), side: SIDE_R[one(msg, 54)], lots: Number(one(msg, 38)) });
// replace: the new order in full (same shape as D), with the id of the order it replaces in 41
export function replaceToG(req, clOrdId, origClOrdId, account, opts) {
  const [first, ...rest] = orderToD(req, clOrdId, account, opts);
  return [first, [41, origClOrdId], ...rest];
}
export const gToReplace = msg => ({ ...dToOrder(msg), origClOrdId: one(msg, 41) });

// ---- execution reports ------------------------------------------------------------------------------------------
const RCPT = [['sym', 55, 's'], ['side', 54, 'side'], ['lots', 32, 'q'], ['px', 31, 'n'], ['pos', TAG.POS_ID, 'n', 1],
  ['slip', TAG.SLIP, 'n'], ['spread', TAG.SPREAD, 'n'], ['lat', TAG.LAT, 'n'], ['gap', TAG.GAP, 'g'], ['comm', TAG.COMM, 'n'], ['reason', TAG.REASON, 's', 1]];
const RCPT_EXT = ['bid', 'ask', 'ref', 'refKind', 'model', 'slipUsd', 'spreadUsd', 'kind'];
const EV = [['code', TAG.REJ_CODE, 's'], ['text', 58, 's']];
const EXEC = { fill: ['F', '2'], new: ['0', '0'], cancel: ['4', '4'], reject: ['8', '8'], restated: ['D', '0'], replaced: ['5', '0'], status: ['I'] };
const EXEC_R = { F: 'fill', 0: 'new', 4: 'cancel', 8: 'reject', D: 'restated', 5: 'replaced', I: 'status' };
// OrderStatus answers (150=I): the order's state in 39
const ORD_ST = { working: '0', filled: '2', cancelled: '4', replaced: '5', rejected: '8', expired: 'C' }, ORD_ST_R = Object.fromEntries(Object.entries(ORD_ST).map(([k, v]) => [v, k]));
const idv = v => (/^-?\d+$/.test(v) ? Number(v) : v);
// the fill id inside an ExecID: the part after the last ':' ('b1:5' -> '5'; a bare '5' is itself)
const fidOf = e => { const s = String(e), i = s.lastIndexOf(':'); return i < 0 ? s : s.slice(i + 1); };

// ev: { kind: 'fill', receipt } | { kind: 'new' | 'restated' | 'replaced', order?, text? } | { kind: 'cancel', text? } |
// { kind: 'reject', code, text } | { kind: 'status', ordStatus: working|filled|cancelled|replaced|rejected|expired, order?, text? }.
// order: the terms of a working order {ot, price, limit, tif, expires, posId, linkPos, leg, oca} (40/44/99/59/126 and the
// dialect tags, as on D). restated: the broker changed the order itself (a linked stop or target cut to the position's
// size); status: an answer to H / AF (ids.massId 584 and ids.total 911 on an AF answer).
// ids: { execId (required), orderId?, clOrdId, origClOrdId?, account, sym?, side?, lots? } (sym/side/lots only outside a fill, a
// fill takes them from the receipt). A fill's execId must be receipt.fid or '<account>:<fid>', and a non-null receipt.order must equal orderId.
export function execToReport(ev, ids, opts) {
  let k = EXEC[ev.kind]; if (!k) bad('exec kind', ev.kind);
  if (ev.kind === 'status') { if (!ORD_ST[ev.ordStatus]) bad('ordStatus', ev.ordStatus); k = ['I', ORD_ST[ev.ordStatus]]; }
  if (ids.execId == null || ids.execId === '') bad('execId is required', ids);
  if (!ids.clOrdId || !ids.account) bad('clOrdId and account are required', ids);
  const r = ev.receipt;
  let orderId = ids.orderId, f2, time = now(opts);
  if (ev.kind === 'fill') {
    if (!r) bad('fill without receipt', ev);
    if (!fin(r.t)) bad('receipt.t is required', r.t);
    if (r.fid !== undefined && fidOf(ids.execId) !== String(r.fid)) bad('receipt.fid differs from execId', r.fid);
    if (r.order != null) { orderId ??= String(r.order); if (String(r.order) !== String(orderId)) bad('receipt.order differs from orderId', r.order); }
    time = fixTime(Math.round(r.t * 1000));
    const c = ctxOf(opts, r.sym);
    f2 = put(r, RCPT, c, ['fid', 'order', 't'], RCPT_EXT);
    const lots = f2.find(([t]) => t === 32), pxf = f2.find(([t]) => t === 31);
    if (!lots || !pxf) bad('a fill needs lots and px', r);
    f2.push([14, lots[1]], [151, '0'], [6, pxf[1]], ...extOf(r, RCPT_EXT));
  } else {
    if (ids.side != null && !(ids.side in SIDE)) bad('side', ids.side);
    const lots = fin(ids.lots) ? fixed(ids.lots, ctxOf(opts, ids.sym).ld) : null;
    f2 = [];
    if (ids.sym != null) f2.push([55, ids.sym]);
    if (ids.side != null) f2.push([54, SIDE[ids.side]]);
    if (lots) f2.push([38, lots]);
    f2.push([14, '0'], [151, lots ?? '0'], [6, '0']);
    if (ev.kind === 'reject') f2.push([103, 99]);
    if (ev.order) { if (ev.kind === 'reject' || ev.kind === 'cancel') bad('order terms on a ' + ev.kind, ev.order); f2.push(...orderFields(ev.order, ctxOf(opts, ids.sym))); }
    f2.push(...put({ code: ev.code, text: ev.text }, EV, {}));
  }
  const f = [[37, orderId ?? 'NONE'], [17, ids.execId], [11, ids.clOrdId]];
  if (ids.origClOrdId != null) f.push([41, ids.origClOrdId]);
  f.push([1, ids.account], [150, k[0]], [39, k[1]], [60, time], ...f2);
  if (ids.massId != null) f.push([584, ids.massId]);
  if (ids.total != null) { if (!Number.isInteger(ids.total)) bad('total', ids.total); f.push([911, ids.total]); }
  return f;
}
// 8 -> { kind, ids, receipt } for a fill, { kind, ids, code?, text? } otherwise
export function reportToExec(msg) {
  const kind = EXEC_R[one(msg, 150)] ?? bad('ExecType', one(msg, 150));
  const ids = { orderId: one(msg, 37), execId: one(msg, 17), clOrdId: one(msg, 11), account: one(msg, 1) };
  if (one(msg, 41) !== undefined) ids.origClOrdId = one(msg, 41);
  if (kind === 'fill') {
    const r = take(msg, RCPT);
    r.fid = idv(fidOf(ids.execId)); r.order = ids.orderId === 'NONE' ? null : idv(ids.orderId); r.t = parseTime(one(msg, 60)) / 1000;
    return { kind, ids, receipt: unext(msg, r, RCPT_EXT) };
  }
  if (one(msg, 55) !== undefined) ids.sym = one(msg, 55);
  if (one(msg, 54) !== undefined) ids.side = SIDE_R[one(msg, 54)];
  if (one(msg, 38) !== undefined) ids.lots = Number(one(msg, 38));
  const out = { kind, ids, ...take(msg, EV) };
  if (kind === 'status') out.ordStatus = ORD_ST_R[one(msg, 39)] ?? null;
  if (one(msg, 40) !== undefined) out.order = takeOrder(msg);
  if (one(msg, 584) !== undefined) out.massId = one(msg, 584);
  if (one(msg, 911) !== undefined) out.total = Number(one(msg, 911));
  return out;
}

// ---- positions, account, history ---------------------------------------------------------------------------------
const POS = [['id', TAG.POS_ID, 'n'], ['sym', 55, 's'], ['entry', 730, 'n'], ['swap', TAG.SWAP, 'n'], ['comm', TAG.COMM, 'n'], ['im', TAG.INIT_MARGIN, 'n'], ['open', TAG.OPEN_TIME, 'n']];
// position {id, sym, side, lots, entry, swap, comm, im, open} -> AP fields; side and lots ride in the 702 group (704 long, 705 short)
export function posToAP(p, account, opts) {
  if (!(p.side in SIDE) || !fin(p.lots) || !(p.lots > 0)) bad('position side/lots', [p.side, p.lots]);
  const c = ctxOf(opts, p.sym), f = put(p, POS, c, ['side', 'lots']), by = t => f.find(([x]) => x === t), lots = fixed(p.lots, c.ld);
  const out = [];
  if (opts?.reqId !== undefined) out.push([710, opts.reqId]);
  out.push([1, account]);
  for (const t of [55, TAG.POS_ID, 730]) if (by(t)) out.push(by(t));
  out.push([702, 1], [703, 'TQ'], [704, p.side === 'buy' ? lots : '0'], [705, p.side === 'sell' ? lots : '0']);
  for (const [t, v] of f) if (![55, TAG.POS_ID, 730].includes(t)) out.push([t, v]);
  return out;
}
// a position that is no longer open: {id, sym} with 704 = 705 = 0 (decodes as lots 0, no side)
export function flatToAP(p, account, opts) {
  if (!fin(p.id) || typeof p.sym !== 'string' || !p.sym) bad('flat position', p);
  return [...(opts?.reqId !== undefined ? [[710, opts.reqId]] : []), [1, account], [55, p.sym], [TAG.POS_ID, num(p.id)], [702, 1], [703, 'TQ'], [704, '0'], [705, '0']];
}
export function apToPos(msg) {
  const p = take(msg, POS), g = msg.groups.get('702')?.[0];
  if (g) { const l = Number(g.get('704')), s = Number(g.get('705')); if (l > 0) { p.side = 'buy'; p.lots = l; } else if (s > 0) { p.side = 'sell'; p.lots = s; } else if (l === 0 && s === 0) p.lots = 0; }
  const out = { account: one(msg, 1), pos: p };
  if (one(msg, 710) !== undefined) out.reqId = one(msg, 710);
  return out;
}
// RequestForPositionsAck {reqId, account?, total, result 0 = valid request, status 0 = completed} -> AO
export function posAckToAO({ reqId, account, total, result = 0, status = 0 }) {
  if (!Number.isInteger(total)) bad('total', total);
  return [[710, reqId], ...(account != null ? [[1, account]] : []), [727, total], [728, result], [729, status]];
}
export const aoToAck = msg => ({ reqId: one(msg, 710), account: one(msg, 1) ?? null, total: Number(one(msg, 727)), result: Number(one(msg, 728)), status: Number(one(msg, 729)) });
// account summary {balance, equity, margin, free, level, fl} -> BA fields; the amounts are the 753 group (707 type, 708 value)
export function summaryToBA(s, account, opts) {
  for (const k of Object.keys(s)) if (!AMT[k] && k !== 'type' && k !== 'set') bad('summary key', k);
  const f = [];
  if (opts?.inquiryId !== undefined) f.push([909, opts.inquiryId]);
  f.push([1, account]);
  const amts = [];
  for (const k of Object.keys(AMT)) {
    const v = s[k]; if (v === undefined || v === null) continue;
    if (typeof v !== 'number' || Number.isNaN(v)) bad(`${k} is not a number`, v);
    amts.push([707, AMT[k]], [708, Number.isFinite(v) ? num(v) : v > 0 ? 'INF' : '-INF']);
  }
  if (amts.length) f.push([753, amts.length / 2], ...amts);
  if (s.set != null || s.type != null) f.push(...put({ ...(s.set || {}), type: s.type ?? undefined }, SET, {}));
  return f;
}
// -> { account, summary, account settings: { type, set } when the BA carries them (the temporary broker does) }
export function baToSummary(msg) {
  const s = Object.fromEntries(Object.keys(AMT).filter(k => k !== 'peak').map(k => [k, null])); // peak: only when the broker sends it
  for (const e of msg.groups.get('753') ?? []) { const k = AMT_R[e.get('707')], v = e.get('708'); if (k) s[k] = v === 'INF' ? Infinity : v === '-INF' ? -Infinity : Number(v); }
  const out = { account: one(msg, 1), summary: s };
  if (one(msg, TAG.SET_JUR) !== undefined || one(msg, TAG.ACCT_TYPE) !== undefined) { const { type = null, ...set } = take(msg, SET); out.info = { type, set: { lev: null, ...set } }; }
  return out;
}
const TRADE = [['id', 571, 'n'], ['sym', 55, 's'], ['side', 54, 'side'], ['lots', 32, 'q'], ['exit', 31, 'p'], ['entry', TAG.ENTRY_PX, 'n'], ['open', TAG.OPEN_TIME, 'n'], ['close', TAG.CLOSE_TIME, 'n'],
  ['pnl', TAG.PNL, 'n'], ['pips', TAG.PIPS, 'n'], ['r', TAG.R_MULT, 'n'], ['note', TAG.NOTE, 's'], ['setup', TAG.SETUP, 's'], ['nbp', TAG.NBP, 'g'], ['reason', TAG.REASON, 's', 1], ['swap', TAG.SWAP, 'n'], ['leg', TAG.LEG, 's', 1], ['comm', TAG.COMM, 'n'], ['slip', TAG.SLIP, 'n'], ['gap', TAG.GAP, 'g']];
// closed trade {id, sym, side, lots, entry, exit, open, close, pnl, pips, reason, swap, leg, comm, slip, gap} -> AE fields.
// Other keys of a history row throw. A negative-balance-protection row (side 'nbp') goes with 5025=Y and no 54.
export function tradeToAE(t, account, opts) {
  const nbp = t.side === 'nbp'; if (nbp && t.nbp !== true) bad("side 'nbp' without nbp:true", t);
  return [[1, account], ...put(nbp ? { ...t, side: undefined } : t, TRADE, ctxOf(opts, t.sym))];
}
export function aeToTrade(msg) { const t = take(msg, TRADE); if (t.nbp === true) t.side = 'nbp'; return { account: one(msg, 1), trade: t }; }

// TradeCaptureReportRequest: the newest `max` rows after skipping `skip` (AD 5060 / 5061), and its ack (AQ, 748 the total)
export const histToAD = ({ reqId, account, max, skip = 0 }) => [[568, reqId], [569, 0], [1, account], ...(Number.isInteger(max) && max > 0 ? [[TAG.MAX_ROWS, max]] : []), ...(Number.isInteger(skip) && skip > 0 ? [[TAG.SKIP_ROWS, skip]] : [])];
export const adToHist = msg => { const n = t => { const v = one(msg, t); return v === undefined ? null : Math.max(0, Math.floor(Number(v)) || 0); }; return { reqId: one(msg, 568), account: one(msg, 1), max: n(TAG.MAX_ROWS), skip: n(TAG.SKIP_ROWS) ?? 0 }; };
export const histAckToAQ = ({ reqId, account, total }) => { if (!Number.isInteger(total)) bad('total', total); return [...(reqId != null ? [[568, reqId]] : []), [1, account], [748, total], [749, 0], [750, 0]]; };
export const aqToAck = msg => ({ reqId: one(msg, 568), account: one(msg, 1), total: Number(one(msg, 748)) });

// ---- records (U2 / U3, temporary broker): fill receipts and order-log rows ---------------------------------------
export const RECORD_KEYS = {
  fill: ['fid', 't', 'sym', 'side', 'lots', 'pos', 'order', 'kind', 'reason', 'bid', 'ask', 'ref', 'refKind', 'px', 'slip', 'slipUsd', 'spread', 'spreadUsd', 'lat', 'comm', 'gap', 'model'],
  log: ['id', 'clOrdId', 'sym', 'side', 'ot', 'price', 'limit', 'lots', 'slPips', 'tpPips', 'tps', 'be', 'trail', 'slPx', 'tpPx', 'tpsPx', 'tif', 'expires', 'oca', 'net', 'posId', 'status', 'created', 'end', 'why', 'trig'],
};
const recVal = v => (scalar(v) ? v : Array.isArray(v) ? v.slice(0, 4).map(x => (x && typeof x === 'object' ? Object.fromEntries(Object.entries(x).filter(([, y]) => scalar(y))) : null)).filter(Boolean)
  : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).filter(([, y]) => scalar(y)).slice(0, 8)) : undefined);
export const cleanRecord = (kind, r) => { const out = {}; for (const k of RECORD_KEYS[kind] || bad('record kind', kind)) if (r && r[k] !== undefined) { const v = recVal(r[k]); if (v !== undefined) out[k] = v; } return out; };
export const recordsToU2 = ({ account, reqId, fills = 500, log = 300 }) => [[1, account], [TAG.REQ_ID, reqId], [TAG.FILLS_MAX, fills], [TAG.LOG_MAX, log]];
export const u2ToRecords = msg => ({ account: one(msg, 1), reqId: one(msg, TAG.REQ_ID), fills: Math.min(500, Math.max(0, Number(one(msg, TAG.FILLS_MAX)) || 0)), log: Math.min(300, Math.max(0, Number(one(msg, TAG.LOG_MAX)) || 0)) });
// rows (newest first) -> U3 messages of at most 50 rows each
export function recordsToU3(kind, rows, account, reqId) {
  const out = [];
  for (let i = 0; i < rows.length; i += 50) out.push([[1, account], [TAG.REQ_ID, reqId], [TAG.ROW_KIND, kind], [TAG.ROWS_JSON, jenc(rows.slice(i, i + 50).map(r => cleanRecord(kind, r)))]]);
  return out;
}
export function u3ToRecords(msg) {
  const kind = one(msg, TAG.ROW_KIND), k = kind === 'fill' || kind === 'log' ? kind : null;
  let rows = []; try { const j = JSON.parse(one(msg, TAG.ROWS_JSON) || '[]'); if (Array.isArray(j) && k) rows = j.map(r => cleanRecord(k, r)); } catch { rows = []; }
  return { account: one(msg, 1), reqId: one(msg, TAG.REQ_ID), kind: k, rows };
}

// ---- account settings and demo reset (U1, temporary broker only) -------------------------------------------------
const SET = [['jur', TAG.SET_JUR, 's'], ['lev', TAG.SET_LEV, 'n', 1], ['slip', TAG.SET_SLIP, 's'], ['slipSd', TAG.SET_SLIP_SD, 'n'], ['latMs', TAG.SET_LAT_MS, 'n'], ['comm', TAG.SET_COMM, 'n'], ['type', TAG.ACCT_TYPE, 's']];
// settings {jur, lev, slip, slipSd, latMs, comm, type}: only the keys present are sent; lev null (sheet default) sends no 5031
export function settingsToU1(set, account) { return [[1, account], [TAG.U1_OP, 'SET'], ...put(set, SET, {})]; }
export const resetToU1 = account => [[1, account], [TAG.U1_OP, 'RESET']];
// a former basket leg joins the net book (temporary broker only: the real server nets by its own rules)
export const unhedgeToU1 = (account, posId) => [[1, account], [TAG.U1_OP, 'UNHEDGE'], [TAG.POS_ID, posId]];
export const u1Op = msg => one(msg, TAG.U1_OP);
export const u1ToSettings = msg => ({ account: one(msg, 1), settings: take(msg, SET) });
export const u1ToReset = msg => ({ account: one(msg, 1) });

// ---- refusals outside an ExecutionReport ---------------------------------------------------------------------------
// BusinessMessageReject {refSeq, refMsgType, reason (380, 0 = other, 3 = unsupported type), account?, code, text} -> j
export function rejectToJ({ refSeq, refMsgType, reason = 0, account, code, text }) {
  return [[45, refSeq], [372, refMsgType], [380, reason], ...(account != null ? [[1, account]] : []), ...put({ code, text }, EV, {})];
}
export const jToReject = msg => ({ refSeq: Number(one(msg, 45)), refMsgType: one(msg, 372), reason: Number(one(msg, 380)), account: one(msg, 1) ?? null, ...take(msg, EV) });
// OrderCancelReject {orderId?, clOrdId, origClOrdId, account, status (39, default 8), responseTo 'F' | 'G', code, text} -> 9
const RESP = { F: '1', G: '2' }, RESP_R = { 1: 'F', 2: 'G' };
export function cxlRejectTo9({ orderId, clOrdId, origClOrdId, account, status = '8', responseTo, code, text }) {
  if (!RESP[responseTo]) bad('responseTo', responseTo);
  return [[37, orderId ?? 'NONE'], [11, clOrdId], [41, origClOrdId], [39, status], [1, account], [434, RESP[responseTo]], [102, 0], ...put({ code, text }, EV, {})];
}
export function nineToCxlReject(msg) {
  const id = one(msg, 37);
  return { orderId: id === 'NONE' ? null : id, clOrdId: one(msg, 11), origClOrdId: one(msg, 41), account: one(msg, 1), status: one(msg, 39), responseTo: RESP_R[one(msg, 434)], ...take(msg, EV) };
}
