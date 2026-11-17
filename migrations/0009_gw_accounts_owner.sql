-- execution gateway: a broker account belongs to ONE user for good. users.id is reused by SQLite (a user deleted with the
-- highest id gives that id to the next one), so gw_accounts now also keys on the owner's users.created_at (user_created)
-- and keeps the row of a deleted user, closed (closed_at, unix s), instead of losing it with the user: the broker account
-- and its history stay as they were, and a new user with the same id gets a new account id ('u<id>-r<n>', n from 2),
-- never the old one. No foreign key any more (ON DELETE CASCADE would drop the row and free the id for reuse).
-- user_created: filled from users.created_at when an insert leaves it out (tools/migrate-accounts.mjs, older code).
-- gw_live: the gateway's open WebSockets per account (n, at = when last written, unix s), for the administration's
-- "on a device now" badge; a row older than 90 s counts as nothing (the gateway stopped without clearing it).
-- ops_flags: switches of the operations scripts; 'state_frozen' (set by tools/cutover.sh from before the migration of
-- the accounts until after its --verify): PUT /api/state answers 503, so no blob changes while it is read.
CREATE TABLE gw_accounts_new (
  user_id INTEGER NOT NULL,
  user_created INTEGER,
  device TEXT NOT NULL DEFAULT '',
  account_id TEXT NOT NULL UNIQUE,
  rev INTEGER NOT NULL DEFAULT 0,
  saved_at INTEGER NOT NULL DEFAULT 0,
  closed_at INTEGER
);
INSERT INTO gw_accounts_new (user_id, user_created, device, account_id, rev, saved_at)
  SELECT g.user_id, u.created_at, g.device, g.account_id, g.rev, g.saved_at FROM gw_accounts g LEFT JOIN users u ON u.id = g.user_id;
DROP TABLE gw_accounts;
ALTER TABLE gw_accounts_new RENAME TO gw_accounts;
CREATE UNIQUE INDEX gw_accounts_open ON gw_accounts (user_id, user_created, device) WHERE closed_at IS NULL;
CREATE TRIGGER gw_accounts_owner AFTER INSERT ON gw_accounts WHEN NEW.user_created IS NULL BEGIN
  UPDATE gw_accounts SET user_created = (SELECT created_at FROM users WHERE id = NEW.user_id) WHERE account_id = NEW.account_id;
END;
CREATE TABLE gw_live (
  account TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  n INTEGER NOT NULL,
  at INTEGER NOT NULL
);
CREATE TABLE ops_flags (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
