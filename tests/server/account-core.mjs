// Account core (core/account.js) in Node, on the market core: fills, netting, targets, OCO, stop-out, rollover, and
// the refusal texts against trade.js / ui.js before the extraction.
// Usage, from 2-cod-sursa:  node tests/server/account-core.mjs   (exit code 1 on any failure)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { MarketCore, CATALOG } from '../../core/market.mjs';
import { AccountCore } from '../../core/account.mjs';

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// a market at a fixed moment (Monday 08:00 UTC: FX open), quotes set by hand
function world({ iso = '2026-11-02T08:00:00Z', seed = null, live = false } = {}) {
  const ms = Date.parse(iso), mk = MarketCore.create({ catalog: CATALOG, now: () => ms });
  const quote = (sym, bid, ask) => mk.setQuotes([[sym, bid, ask, ms]]);
  const core = AccountCore.create({ market: mk, rng: seed == null ? Math.random : AccountCore.seeded(seed), now: () => ms / 1000, live: () => live });
  const acct = { balance: 100000, peak: 100000, positions: [], orders: [], set: { jur: 'none', lev: null, slip: 'sym', slipSd: .2, latMs: 120, comm: 0 }, nextId: 1, nextFill: 1 };
  return { mk, core, acct, quote, t: ms / 1000 };
}
const fills = r => (r.events || []).filter(e => e.type === 'fill').map(e => e.fill);

console.log('AC1 open market EURUSD 1 lot with a seeded rng: px = ask + slip, commission debited');
{
  const w = world({ seed: 11, live: true });
  w.acct.set.comm = 5;
  w.quote('EURUSD', 1.12233, 1.12245);
  const r = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1 });
  // the same draw by hand: latency (one uniform), then a Box–Muller normal (two uniforms), σ = slipSd (no volatility known)
  const u = AccountCore.seeded(11), lat = 120 * (.5 + u()), a = u(), b = u(), eps = Math.sqrt(-2 * Math.log(a)) * Math.cos(2 * Math.PI * b) * .2;
  const f = fills(r)[0];
  ok(r.ok && r.op === 'open' && r.net === null, `opened: ${r.ok} ${r.code || ''} ${r.why || ''}`);
  // the fill is on the instrument's grid (5 digits): px is the drawn price rounded, and the slip reported is the one that price makes (UX-42)
  ok(f && near(f.px, +(1.12245 + eps * 1e-4).toFixed(5), 1e-12) && near(f.px, 1.12245 + f.slip * 1e-4, 1e-12) && Math.abs(f.slip - eps) <= .05 + 1e-9, `px = ask + slip on the grid: px ${f && f.px} slip ${f && f.slip} drawn slip ${eps}`);
  ok(f && f.lat === Math.round(lat) && f.model.live === true && f.kind === 'open' && f.fid === 1 && w.acct.nextFill === 2, `receipt: lat ${f && f.lat}, kind ${f && f.kind}, fid ${f && f.fid}`);
  ok(near(w.acct.balance, 100000 - 5) && r.pos.comm === 5 && f.comm === 5, `commission 5 debited: balance ${w.acct.balance}`);
  ok(near(r.pos.im, 1e5 * 1.12233 / 500, 1e-6), `im = notional / 500: ${r.pos.im}`);
  // the receipt carries today's fields
  const keys = 'fid,t,sym,side,lots,pos,order,kind,reason,bid,ask,ref,refKind,px,slip,slipUsd,spread,spreadUsd,lat,comm,gap,model';
  ok(Object.keys(f).join(',') === keys, `receipt fields: ${Object.keys(f).join(',')}`);
  // off the live market: exactly at the quote
  const w2 = world({ seed: 11 }); w2.quote('EURUSD', 1.12233, 1.12245);
  const r2 = w2.core.openMarket(w2.acct, { sym: 'EURUSD', side: 'sell', lots: .5 });
  ok(r2.ok && r2.pos.entry === 1.12233 && fills(r2)[0].slip === 0, `not live: sell at the bid ${r2.pos && r2.pos.entry}`);
}

console.log('AC2 an add with posId: size-weighted entry, im adds up, the position keeps its own SL/TP');
{
  const w = world();
  w.quote('EURUSD', 1.1, 1.1001);
  const p = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1, sl: 1.09, tp: 1.12 }).pos;
  const im1 = p.im;
  w.quote('EURUSD', 1.105, 1.1051);
  const r = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 3, posId: p.id, sl: 1.0, tp: 1.2 });
  ok(r.ok && r.net === 'add' && r.op === 'add' && r.pos === p && w.acct.positions.length === 1, `added to #${p.id}: ${r.net}`);
  ok(near(p.entry, (1.1001 + 3 * 1.1051) / 4, 1e-12) && p.lots === 4, `weighted entry ${p.entry}, lots ${p.lots}`);
  ok(near(p.im, im1 + 3e5 * 1.105 / 500, 1e-6), `im ${p.im} = ${im1} + the add's`);
  ok(p.sl === 1.09 && p.tp === 1.12 && fills(r)[0].kind === 'add' && p.fills.length === 2, 'own SL/TP kept, fill kind add');
  const bad = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1, posId: 999 });
  ok(!bad.ok && bad.code === 'NO_POS', `unknown posId refused: ${bad.code}`);
}

console.log('AC3 the other side with posId reduces; the rest of a reversal opens a new position');
{
  const w = world();
  w.quote('EURUSD', 1.1, 1.1001);
  const p = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 2 }).pos;
  w.quote('EURUSD', 1.102, 1.1021);
  const red = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'sell', lots: .5, posId: p.id });
  const tr = red.events.find(e => e.trade).trade;
  ok(red.ok && red.net === 'reduce' && p.lots === 1.5 && w.acct.positions.length === 1, `reduced to ${p.lots}: ${red.net}`);
  ok(tr.reason === 'Offset by sell order' && near(tr.pnl, (1.102 - 1.1001) * .5 * 1e5, 1e-6) && near(w.acct.balance, 100000 + tr.pnl, 1e-6), `P/L realised ${tr.pnl}`);
  const flip = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'sell', lots: 2, posId: p.id, sl: 1.11 });
  const np = flip.pos;
  ok(flip.ok && flip.net === 'flip' && !w.acct.positions.includes(p) && w.acct.positions.length === 1, `reversed: ${flip.net}`);
  ok(np && np.side === 'sell' && np.lots === .5 && np.sl === 1.11 && np.id !== p.id && np.entry === 1.102, `the rest is a new sell .5 with the order's SL: ${np && np.lots} ${np && np.sl}`);
  ok(fills(flip).map(f => f.kind).join() === 'close,open', `fills close, open: ${fills(flip).map(f => f.kind)}`);
  const x = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: .5, posId: np.id });
  ok(x.ok && x.net === 'close' && !w.acct.positions.length, `an equal size closes it: ${x.net}`);
  // without posId: a new position (basket legs), never netted
  w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1 }); w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'sell', lots: 1 });
  ok(w.acct.positions.length === 2, `no posId: two positions ${w.acct.positions.length}`);
}

console.log('AC4 TP1/TP2 reduce-only; reduced by hand under TP2, TP2 is cut to what is left');
{
  const w = world();
  w.quote('EURUSD', 1.1, 1.1001);
  const p = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1, tps: [{ pips: 10, pct: 50 }, { pips: 20, pct: 50 }] }).pos;
  ok(p.tps.length === 2 && p.tps[0].lots === .5 && p.tps[1].lots === .5 && near(p.tp, 1.1011, 1e-12), `two legs of .5: ${JSON.stringify(p.tps)}`);
  w.quote('EURUSD', 1.1012, 1.1013);
  const ev1 = w.core.onTick(w.acct, w.t);
  const c1 = ev1.filter(e => e.type === 'fill');
  ok(c1.length === 1 && c1[0].fill.lots === .5 && c1[0].trade.leg === 'TP1' && p.lots === .5 && p.tps.length === 1, `TP1 closed .5: ${c1.map(e => e.fill.lots)}, left ${p.lots}`);
  ok(c1[0].fill.px >= 1.1011 && c1[0].fill.ref === 1.1011 && c1[0].fill.kind === 'reduce', `a limit fills at its price or better: ${c1[0].fill.px}`);
  const man = w.core.close(w.acct, p.id, .6, 'Partial close');
  ok(man.ok && p.lots === .2 && p.tps.length === 1 && p.tps[0].lots === .2 && p.tps[0].leg === 'TP2', `by hand to ${p.lots}: TP2 cut to ${p.tps && p.tps[0].lots}`);
  w.quote('EURUSD', 1.1022, 1.1023);
  const ev2 = w.core.onTick(w.acct, w.t);
  const c2 = ev2.filter(e => e.type === 'fill');
  ok(c2.length === 1 && c2[0].fill.lots === .2 && c2[0].fill.kind === 'close' && !w.acct.positions.length, `TP2 closes the .2 left, nothing more: ${c2.map(e => e.fill.lots)}`);
}

console.log('AC5 OCO: one pending fills, its sibling is cancelled in the same onTick');
{
  const w = world();
  w.quote('EURUSD', 1.1, 1.1001);
  const a = w.core.place(w.acct, { sym: 'EURUSD', side: 'buy', ot: 'stop', price: 1.102, lots: 1, slPips: 20 }).order;
  const b = w.core.place(w.acct, { sym: 'EURUSD', side: 'sell', ot: 'stop', price: 1.098, lots: 1, oca: a.id });
  ok(b.ok && b.order.oca === 'o' + a.id && a.oca === 'o' + a.id, `OCO group ${b.order && b.order.oca}`);
  w.quote('EURUSD', 1.1025, 1.1026);
  const ev = w.core.onTick(w.acct, w.t);
  const types = ev.map(e => e.type).join();
  ok(types === 'fill,filled,cancel,oco', `events: ${types}`);
  ok(!w.acct.orders.length && w.acct.positions.length === 1 && w.acct.positions[0].src === a.id, 'book empty, one position from the buy stop');
  const p = w.acct.positions[0], c = ev.find(e => e.type === 'cancel');
  ok(near(p.sl, p.entry - 20e-4, 1e-12) && p.entry === 1.1026, `SL 20 pips from the fill ${p.entry} → ${p.sl}`);
  ok(c.order.id === b.order.id && c.order.status === 'cancelled' && c.order.why === `OCO: #${a.id} filled`, `sibling: ${c.order.why}`);
  ok(ev.find(e => e.type === 'filled').order.why === `filled: position #${p.id}`, 'order-log row of the filled entry');
}

console.log('AC6 stop-out: margin level 49% closes the worst position, then the level is measured again');
{
  const w = world();
  w.acct.balance = 10000; // the notional cap is 25× equity
  w.quote('EURUSD', 1.1, 1.1001); w.quote('GBPUSD', 1.3, 1.3002);
  const A = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 2 }).pos;
  const B = w.core.openMarket(w.acct, { sym: 'GBPUSD', side: 'buy', lots: 1 }).pos;
  ok(A && B, 'two positions');
  const mg = A.im + B.im, pnlB = (1.3 - 1.3002) * 1e5, pnlA = .49 * mg - 10000 - pnlB;
  const bidA = +(1.1001 + pnlA / 2e5).toFixed(5);
  w.quote('EURUSD', bidA, bidA + .0001); w.quote('GBPUSD', 1.3, 1.3002);
  const lv = w.core.summary(w.acct).level;
  ok(lv < 50 && lv > 48, `level ${lv.toFixed(2)}%`);
  const ev = w.core.onTick(w.acct, w.t);
  const so = ev.filter(e => e.type === 'stopout'), cl = ev.filter(e => e.type === 'fill');
  ok(so.length === 1 && so[0].pos === A.id && cl.length === 1 && cl[0].trade.reason === 'Stop-out', `one stop-out, the worst (#${A.id}): ${so.map(e => e.pos)}`);
  ok(!w.acct.positions.includes(A) && w.acct.positions.includes(B) && w.core.summary(w.acct).level > 50, `B stays at ${w.core.summary(w.acct).level.toFixed(1)}%`);
  // the protection: a flat negative balance goes to 0 with an nbp row
  w.quote('GBPUSD', 1.29, 1.2902);
  const x = w.core.close(w.acct, B.id, 1, 'Manual');
  ok(x.ok && w.acct.balance < 0, `balance ${w.acct.balance.toFixed(2)}`);
  const ev2 = w.core.onTick(w.acct, w.t), n = ev2.find(e => e.type === 'nbp');
  ok(n && w.acct.balance === 0 && n.trade.nbp && near(n.trade.pnl, n.cover) && n.trade.sym === 'GBPUSD' && n.after === 'Manual', `nbp: cover ${n && n.cover}`);
}

console.log('AC7 rollover after 3 missed nights (triple Wednesday): 5 nights of swap');
{
  const w = world();
  const p = { id: 1, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, sl: null, tp: null, trail: 0, swap: 0, comm: 0, im: 220, open: 0 };
  w.acct.positions.push(p);
  const mon = Date.parse('2026-11-02T22:05:00Z') / 1000, thu = Date.parse('2026-11-05T22:05:00Z') / 1000; // 17:05 New York (EST)
  ok(!w.core.rollover(w.acct, mon).length && w.acct.rollLast === mon && p.swap === 0, 'first call: sets rollLast only');
  const ev = w.core.rollover(w.acct, thu);
  const one = -9.217 * 1e-5 * 1e5;
  ok(ev.length === 3 && ev.map(e => e.rows[0].nights).join() === '1,3,1', `rollovers Tue, Wed, Thu: ${ev.map(e => e.rows[0].nights)}`);
  ok(near(p.swap, one * 5, 1e-9), `swap = 5 nights: ${p.swap} vs ${one * 5}`);
  ok(w.acct.rollLast === thu && !w.core.rollover(w.acct, thu + 60).length, 'nothing twice');
  const sat = Date.parse('2026-11-08T23:00:00Z') / 1000;
  const e2 = w.core.rollover(w.acct, sat); // Friday's 1 night (Saturday and Sunday book nothing on FX)
  ok(e2.length === 1 && near(p.swap, one * 6, 1e-9), `to Sunday: one more night ${e2.length}`);
}

console.log('AC8 each refusal code: its text is the one in trade.js / ui.js before the extraction');
{
  const src = readFileSync(join(ROOT, 'tests', 'server', 'fixtures', 'account-texts.txt'), 'utf8'); // the lines of e15625b that built them
  // every ${…} (balanced braces) becomes {}; the core's {name} too
  const norm = s => { let o = '', i = 0; while (i < s.length) { if (s[i] === '$' && s[i + 1] === '{') { let d = 1, j = i + 2; while (j < s.length && d) { if (s[j] === '{') d++; else if (s[j] === '}') d--; j++; } o += '{}'; i = j; } else o += s[i++]; } return o; };
  const nsrc = norm(src), C = AccountCore.REJECT;
  const NEW = new Set(['NO_POS', 'NO_ORDER', 'NOT_DEMO']); // no text before: no modify / close by id from outside, no account reset
  const SAMPLES = { MOD_SL_SIDE: [{ dir: 'below', ref: 'bid' }, { dir: 'above', ref: 'ask' }], MOD_TP_SIDE: [{ dir: 'above', ref: 'bid' }, { dir: 'below', ref: 'ask' }], CLOSED: [{ opens: '' }] };
  let n = 0;
  for (const [code, r] of Object.entries(C)) {
    if (NEW.has(code)) continue;
    const t = r.tpl.replace(/\{\w+\}/g, '{}');
    const found = nsrc.includes(t) || (SAMPLES[code] || []).length && SAMPLES[code].every(a => src.includes(AccountCore.render(r.tpl, a)));
    ok(found, `${code}: "${r.tpl}" is not in trade.js / ui.js`);
    if (!r.market && !code.startsWith('MOD_') && code !== 'DUPLICATE') ok(src.includes(`'${r.title}'`), `${code}: title '${r.title}'`);
    n++;
  }
  // and the other way: every fixed reason trade.js refused with has a code
  const lit = [...src.matchAll(/\b(?:reject|no)\('Order (?:rejected|blocked)', '([^']+)'/g)].map(m => m[1]);
  const tpls = new Set(Object.values(C).map(r => r.tpl));
  for (const l of new Set(lit)) ok(tpls.has(l), `trade.js reason without a code: '${l}'`);
  console.log(`  ${n} codes checked, ${new Set(lit).size} fixed reasons of trade.js covered`);
  // texts through the operations
  const w = world(); w.acct.balance = 5000; w.acct.set.jur = 'eu'; // 30:1 on EURUSD
  w.quote('EURUSD', 1.1, 1.1001);
  w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1, posId: null });
  const free = w.core.summary(w.acct).free, m = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'sell', lots: 1 });
  const want = `Needs $3,666.67 · free ${w.core.usdFmt(free)}`;
  ok(m.code === 'MARGIN' && m.why === want && m.text === `insufficient margin (${want})` && m.title === 'Insufficient margin', `margin: ${m.why} | ${m.text}`);
  w.acct.positions = []; w.acct.balance = 100; w.acct.set.jur = 'none';
  const nc = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1 });
  ok(nc.code === 'NOTIONAL' && nc.why === 'Notional $110,000.00 is above the per-order cap of 25× equity ($2,500.00)' && nc.title === 'Order blocked', `notional: ${nc.why}`);
  const v = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: .001 });
  ok(v.code === 'VOL_MIN' && v.why === 'Minimum size is 0.01 lots', `volume: ${v.why}`);
  const pl = w.core.place(w.acct, { sym: 'EURUSD', side: 'buy', ot: 'limit', price: 1.1, lots: 1 });
  ok(pl.code === 'MIN_DIST' && pl.why === 'Too close to the market: at least 12 points (0.00012) from the ask', `min distance: ${pl.why}`);
  const sw = w.core.place(w.acct, { sym: 'EURUSD', side: 'sell', ot: 'limit', price: 1.09, lots: 1 });
  ok(sw.code === 'PRICE_SIDE' && sw.why === 'sell limit must be above market', `side: ${sw.why}`);
  const sat = world({ iso: '2026-11-07T12:00:00Z' }); sat.quote('EURUSD', 1.1, 1.1001);
  const cl = sat.core.openMarket(sat.acct, { sym: 'EURUSD', side: 'buy', lots: 1 });
  ok(cl.code === 'CLOSED' && cl.why === 'Market closed' && cl.text === 'market closed' && cl.title === 'Market closed', `closed: ${cl.why} | ${cl.text}`);
  // modify: the level editor's rules
  w.acct.balance = 100000;
  const p = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1 }).pos;
  const s1 = w.core.modify(w.acct, { posId: p.id, sl: 1.1005 });
  ok(s1.code === 'MOD_SL_SIDE' && s1.why === 'Stop loss must be below the bid', `modify SL: ${s1.why}`);
  const s2 = w.core.modify(w.acct, { posId: p.id, sl: 1.0950004, tp: 1.11 });
  ok(s2.ok && p.sl === 1.095 && p.tp === 1.11 && p.trail === 0, `modify applied on the digits: ${p.sl} ${p.tp}`);
}

console.log('AC10 rollover: a position opened after a missed rollover is not charged for it');
{
  const w = world();
  const mon = Date.parse('2026-11-02T22:05:00Z') / 1000, wedOpen = Date.parse('2026-11-04T23:00:00Z') / 1000, thu = Date.parse('2026-11-05T22:05:00Z') / 1000;
  const old = { id: 1, sym: 'EURUSD', side: 'buy', lots: 1, entry: 1.1, sl: null, tp: null, trail: 0, swap: 0, comm: 0, im: 220, open: mon - 3600 };
  const late = { ...old, id: 2, open: wedOpen }; // after Tuesday's and Wednesday's rollovers
  w.acct.positions.push(old, late);
  w.core.rollover(w.acct, mon); w.core.rollover(w.acct, thu);
  const one = -9.217;
  ok(near(old.swap, one * 5, 1e-9) && near(late.swap, one, 1e-9), `old pays 5 nights (${old.swap}), the late one only Thursday's (${late.swap})`);
}

console.log('AC11 a pending order of the net book: net is kept; its position closed meanwhile → it nets on the instrument');
{
  const w = world();
  w.quote('EURUSD', 1.1, 1.1001);
  const p = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1 }).pos;
  const o = w.core.place(w.acct, { sym: 'EURUSD', side: 'buy', ot: 'limit', price: 1.098, lots: 1, posId: p.id, net: true }).order;
  const o2 = w.core.place(w.acct, { sym: 'EURUSD', side: 'sell', ot: 'limit', price: 1.103, lots: .5 }).order;
  ok(o.net === true && o2.net === false, `net stored: ${o.net} / ${o2.net}`);
  w.core.close(w.acct, p.id, 1, 'Manual');
  const q = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: .5, net: true }).pos; // the book's buy now
  w.quote('EURUSD', 1.0978, 1.0979);
  const t1 = w.t + 30, ev = w.core.onTick(w.acct, t1);
  const f = ev.find(e => e.type === 'fill');
  ok(ev.some(e => e.type === 'filled') && f && f.fill.kind === 'add' && f.fill.pos === q.id && q.lots === 1.5, `netted into #${q.id}: ${f && f.fill.kind}, lots ${q.lots}`);
  ok(f && f.fill.t === t1, `fill stamped with the onTick time: ${f && f.fill.t}`);
  const r = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1, posId: 999 });
  ok(!r.ok && r.code === 'NO_POS', 'posId gone, no net: NO_POS');
  // a hook that throws: the order is rejected with the error on the event
  w.quote('EURUSD', 1.1035, 1.1036);
  const ev2 = w.core.onTick(w.acct, t1, { open: () => { throw new Error('boom'); } });
  const rj = ev2.find(e => e.type === 'reject');
  ok(rj && rj.err === 'Error: boom' && rj.order.why === 'could not be filled' && !w.acct.orders.length, `reject carries err: ${rj && rj.err}`);
}

console.log('AC12 a refusal after a legacy merge still reports merged');
{
  const w = world(); w.acct.balance = 5000; w.acct.set.jur = 'eu';
  w.quote('EURUSD', 1.1, 1.1001);
  const a = { id: 1, sym: 'EURUSD', side: 'buy', lots: .5, entry: 1.1, sl: null, tp: null, trail: 0, swap: 0, comm: 0, im: 1833.33, open: w.t };
  w.acct.positions.push(a, { ...a, id: 2 }); w.acct.nextId = 3;
  const r = w.core.openMarket(w.acct, { sym: 'EURUSD', side: 'buy', lots: 1, net: true });
  ok(!r.ok && r.code === 'MARGIN' && r.merged === true && w.acct.positions.length === 1, `MARGIN with merged: ${r.code} ${r.merged}`);
}

console.log('AC9 pure rules: trailNext, beLevel');
{
  ok(AccountCore.trailNext(1, null, 1.1, .001) === 1.1 - .001 && AccountCore.trailNext(1, 1.0995, 1.1, .001) === 1.0995 && AccountCore.trailNext(-1, 1.102, 1.1, .001) === 1.101, 'trailNext: starts at px ∓ dist, never loosens');
  const be = { at: 10, off: 1, onTp: false, done: false };
  ok(AccountCore.beLevel(be, 1, 1.1, 1.1009, 1e-4) === null && near(AccountCore.beLevel(be, 1, 1.1, 1.1011, 1e-4), 1.1001, 1e-12), 'beLevel: armed at 10 pips, entry + 1');
  ok(AccountCore.beLevel({ at: null, off: 0, onTp: true, tpHit: true }, -1, 1.1, 1.2, 1e-4) === 1.1 && AccountCore.beLevel({ ...be, done: true }, 1, 1.1, 1.2, 1e-4) === null, 'beLevel: after a target; done: null');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
