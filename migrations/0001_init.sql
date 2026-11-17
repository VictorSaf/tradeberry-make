-- tradeBerry accounts: users created by the administrator (tools/tb-user.mjs), sessions, one saved state per user
CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt TEXT NOT NULL,          -- hex, 16 bytes
  hash TEXT NOT NULL,          -- hex, PBKDF2-SHA256
  iter INTEGER NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY, -- SHA-256 of the cookie token; the token itself is never stored
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE state (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  rev INTEGER NOT NULL,         -- 0: only a market saved so far
  data TEXT NOT NULL,          -- the account (JSON); compared by rev, so two devices never overwrite each other
  market TEXT,                 -- the simulated market snapshot (JSON); last writer wins
  saved_at INTEGER NOT NULL
);
CREATE TABLE login_fail (
  k TEXT NOT NULL,             -- 'u:<username>' or 'ip:<address>'
  at INTEGER NOT NULL
);
CREATE INDEX login_fail_k ON login_fail(k, at);
CREATE TABLE lease (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL,        -- the one device that runs and saves this account (random id kept in its browser)
  since INTEGER NOT NULL,      -- when that device took it
  until INTEGER NOT NULL       -- renewed by the device every 40 s; free to take once past
);
