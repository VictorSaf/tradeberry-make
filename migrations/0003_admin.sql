-- administrators: may manage the accounts from the app (functions/api/admin.js); set with tools/tb-user.mjs admin <user>
ALTER TABLE users ADD COLUMN admin INTEGER NOT NULL DEFAULT 0;
