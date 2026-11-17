-- shared accounts: one username and password for several people; every browser (device) keeps its own portfolio
ALTER TABLE users ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
CREATE TABLE dstate (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device TEXT NOT NULL,
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  market TEXT,
  saved_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, device)
);
