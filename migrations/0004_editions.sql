-- Opening Note: one AI-written edition per UTC day for everyone (functions/api/edition.js)
CREATE TABLE editions (
  day TEXT PRIMARY KEY,        -- YYYY-MM-DD (UTC)
  n INTEGER NOT NULL,          -- edition number, 1 for the first one ever
  data TEXT,                   -- the edition (JSON); NULL while it is being written
  status TEXT NOT NULL,        -- 'pending' | 'ready' | 'failed'
  created_at INTEGER NOT NULL
);
