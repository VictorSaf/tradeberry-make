-- Opening Note: an administrator's request for a new edition today; tools/edition.mjs (Claude Code CLI on the
-- administrator's Mac) picks it up, writes the edition and deletes the request
CREATE TABLE edition_req (
  id INTEGER PRIMARY KEY,
  day TEXT NOT NULL,
  by TEXT NOT NULL,
  at INTEGER NOT NULL
);
