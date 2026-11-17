-- Security log (security audit 09.11.2026, F08): sign-ins (made, refused, locked), sign-outs and every administrator
-- action, append-only: the app never updates or deletes a row (server/auth.js audit; rows older than 400 days are
-- pruned at a sign-in). at: unix seconds UTC; actor: the username that acted (or tried to); ip: CF-Connecting-IP;
-- action: login.ok | login.fail | login.locked | logout | admin.<op> | admin.denied | pricedata.<op> | edition.regen;
-- target: the username acted on; ok: 1 done, 0 refused.
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  actor TEXT NOT NULL,
  ip TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  ok INTEGER NOT NULL,
  detail TEXT
);
CREATE INDEX audit_log_at ON audit_log(at);
