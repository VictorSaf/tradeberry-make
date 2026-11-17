#!/usr/bin/env node
/* Applies migrations/*.sql that the database has not seen yet, in name order, each in its own transaction.
   Bookkeeping in d1_migrations, the table wrangler used on D1, so a database exported from D1 carries on where it was.
   Usage: node host/migrate.mjs <database file> [migrations dir] */
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const file = process.argv[2], dir = process.argv[3] || join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');
if (!file) { console.error('Usage: node host/migrate.mjs <database file> [migrations dir]'); process.exit(1); }
const db = new DatabaseSync(file);
db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
db.exec('CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)');
const done = new Set(db.prepare('SELECT name FROM d1_migrations').all().map(r => r.name));
const todo = readdirSync(dir).filter(f => f.endsWith('.sql')).sort().filter(f => !done.has(f));
for (const f of todo) {
  db.exec('BEGIN');
  try { db.exec(readFileSync(join(dir, f), 'utf8')); db.prepare('INSERT INTO d1_migrations (name) VALUES (?)').run(f); db.exec('COMMIT'); console.log('applied', f); }
  catch (e) { db.exec('ROLLBACK'); console.error('failed', f, e.message); process.exit(1); }
}
if (!todo.length) console.log('database is up to date');
db.close();
