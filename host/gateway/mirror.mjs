// The gateway's mirror of every broker account, built ONLY from the broker's reports (host/fix/dialect.mjs decodes them):
// working orders from ExecutionReports (8), positions from PositionReports (AP), the account amounts from
// CollateralReports (BA). Rebuilt whole at every logon: OrderMassStatus (AF) answers replace the orders, the
// RequestForPositions (AN) answer replaces the positions, a CollateralInquiry (BB) per account the amounts. In memory
// only (the broker holds the truth); no I/O here, so each change returns what the browsers must be told.
const ORDER_TERMS = ['ot', 'price', 'limit', 'tif', 'expires', 'posId', 'linkPos', 'leg', 'oca', 'net', 'sl', 'tp', 'slPips', 'tpPips', 'trail', 'tps', 'be']; // + the exits it carries (I5)

export function createMirror() {
  const accts = new Map();
  const A = id => { let a = accts.get(id); if (!a) accts.set(id, a = { id, summary: null, positions: new Map(), orders: new Map() }); return a; };
  const orderOf = (ids, order) => {
    const o = { clOrdId: ids.clOrdId, orderId: ids.orderId ?? null, sym: ids.sym ?? null, side: ids.side ?? null, lots: ids.lots ?? null };
    for (const k of ORDER_TERMS) if (order && order[k] !== undefined && order[k] !== null) o[k] = order[k];
    return o;
  };
  return {
    get: id => accts.get(id) || null,
    account: A,
    accounts: () => [...accts.keys()],
    // the account's type and settings as the broker's BA carries them ({ type, set }), kept across logons
    info(account, x) { A(account).info = x; return x; },
    // an ExecutionReport event (reportToExec, not a status answer) -> [{ order } | { clOrdId, gone: true }]
    exec(ev) {
      const a = A(ev.ids.account), cl = ev.ids.clOrdId, out = [];
      const gone = id => { if (a.orders.delete(id)) out.push({ clOrdId: id, gone: true }); };
      if (ev.kind === 'new' || ev.kind === 'restated' || ev.kind === 'replaced') {
        if (ev.kind === 'replaced' && ev.ids.origClOrdId && ev.ids.origClOrdId !== cl) gone(ev.ids.origClOrdId);
        if (ev.order) { const o = orderOf(ev.ids, ev.order); a.orders.set(cl, o); out.push({ order: o }); }
      } else if (ev.kind === 'fill' || ev.kind === 'reject') gone(cl);
      else if (ev.kind === 'cancel') { gone(cl); if (ev.ids.origClOrdId) gone(ev.ids.origClOrdId); }
      return out;
    },
    // an AP (apToPos().pos): the position as it is now, or gone (lots 0) -> the position, or { id, sym, lots: 0 }
    pos(account, p) {
      const a = A(account);
      if (!(p.lots > 0)) { a.positions.delete(p.id); return { id: p.id, sym: p.sym, lots: 0 }; }
      const x = { id: p.id, sym: p.sym, side: p.side, lots: p.lots, entry: p.entry, swap: p.swap ?? 0, comm: p.comm ?? 0, im: p.im ?? null, open: p.open ?? null };
      a.positions.set(p.id, x); return x;
    },
    summary(account, s) { A(account).summary = s; return s; },
    // logon: the broker's whole book. orders: [[account, ids, order]] (status answers); positions: [[account, pos]]
    replaceOrders(list) {
      for (const a of accts.values()) a.orders.clear();
      for (const [account, ids, order] of list) A(account).orders.set(ids.clOrdId, orderOf(ids, order));
    },
    replacePositions(list) {
      for (const a of accts.values()) a.positions.clear();
      for (const [account, p] of list) this.pos(account, p);
    },
    view(id) {
      const a = accts.get(id);
      return { acct: a ? a.summary : null, positions: a ? [...a.positions.values()].sort((x, y) => x.id - y.id) : [], orders: a ? [...a.orders.values()] : [] };
    },
  };
}
