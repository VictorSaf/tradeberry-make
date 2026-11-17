-- execution gateway OMS (host/gateway/oms.mjs): the reports of a ClOrdID are looked up by it (a reversal's remainder
-- refused after its fill, a basket leg reconciled after a restart), so gw_exec gets an index on (account, ClOrdID).
CREATE INDEX IF NOT EXISTS gw_exec_cl ON gw_exec (account, json ->> '$.ids.clOrdId');
