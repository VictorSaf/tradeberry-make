-- execution gateway (host/gateway.mjs): what the gateway keeps next to the broker's accounts (data/broker.db).
-- Keys: gw_accounts (user_id, device) → account_id, one broker account per login, or per browser on a shared login
-- (device '' for a personal account; account_id 'u<user_id>' or 'u<user_id>-<device>', unique); gw_clord one row per
-- account, n = the next ClOrdID number ('tb-<account>-<n>'); gw_meta (account, pos_id): the journal fields of an open
-- position (ctx, pm, sl0, tp0, news, mae, mfe, note, setup, basket, bgid, timeStop), JSON; gw_state (account, key):
-- the gateway's own functions (chal, bkPos, bkOrders, bkHist, bkAlerts, alerts), JSON. First filled by
-- tools/migrate-accounts.mjs from the state blob, which stays as it was; gw_accounts.rev / saved_at: the blob revision and
-- save time an account was migrated from (0 for an account the gateway opened itself).
CREATE TABLE gw_accounts (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL UNIQUE,
  rev INTEGER NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, device)
);
CREATE TABLE gw_clord (
  account TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
CREATE TABLE gw_meta (
  account TEXT NOT NULL,
  pos_id INTEGER NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (account, pos_id)
);
CREATE TABLE gw_state (
  account TEXT NOT NULL,
  key TEXT NOT NULL,
  json TEXT NOT NULL,
  PRIMARY KEY (account, key)
);
