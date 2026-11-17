-- execution gateway (host/gateway.mjs), next to 0006: what makes it exactly-once towards the browsers and the broker.
-- gw_exec: every ExecutionReport event the gateway took from the broker, once per (account, ExecID 17), append-only; a
--   report seen again (a resend, a repeated ClOrdID's answer) finds its row and changes nothing. The snapshot's last 200.
-- gw_cid: a browser command by (account, cid): json { op, cls: [ClOrdID…], res: {ClOrdID: result}, reply }; a cid sent
--   again (after a reconnect) gets the same ClOrdIDs and the same reply, never a second order. at: unix seconds (pruned
--   after 7 days).
-- fix_seq / fix_out: the gateway's FIX store (host/fix/store.mjs creates the same tables if missing), in this database so
--   the gateway's rows commit with the inbound sequence number.
CREATE TABLE gw_exec (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  account TEXT NOT NULL,
  exec_id TEXT NOT NULL,
  t REAL NOT NULL,
  json TEXT NOT NULL,
  UNIQUE (account, exec_id)
);
CREATE INDEX gw_exec_account ON gw_exec (account, seq);
CREATE TABLE gw_cid (
  account TEXT NOT NULL,
  cid TEXT NOT NULL,
  json TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (account, cid)
);
CREATE TABLE IF NOT EXISTS fix_seq (session TEXT PRIMARY KEY, in_seq INTEGER NOT NULL DEFAULT 0, out_seq INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS fix_out (session TEXT NOT NULL, seq INTEGER NOT NULL, raw BLOB NOT NULL, PRIMARY KEY (session, seq)) WITHOUT ROWID;
