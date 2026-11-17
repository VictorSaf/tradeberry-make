/* SQL on the tradeBerry database, for the command-line tools (tb-user.mjs, edition.mjs).
   Where (first that applies): --local → this checkout's .data/tradeberry.db (npm run dev:server); TB_DB=<file> → that SQLite file (what
   the jobs on the Mac mini use); otherwise the live database on the Mac mini, over ssh (host from TB_MINI, default macmini).
   sql(command, json): json = true returns the rows of one SELECT; false runs one or more statements. */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const LIVE_DB = '~/tradeberry/data/tradeberry.db';

export function target(flags) {
  if (flags.has('--local')) return { kind: 'file', file: join(ROOT, '.data', 'tradeberry.db'), label: 'the LOCAL' };
  if (process.env.TB_DB) return { kind: 'file', file: process.env.TB_DB, label: 'the LIVE' };
  return { kind: 'ssh', host: process.env.TB_MINI || 'macmini', label: 'the LIVE' };
}

export async function opener(t) {
  if (t.kind === 'file') {
    if (!existsSync(t.file)) throw new Error(`No database at ${t.file}`);
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(t.file);
    db.exec('PRAGMA busy_timeout = 5000; PRAGMA foreign_keys = ON;');
    return (command, json = false) => { if (json) return db.prepare(command).all().map(r => ({ ...r })); db.exec(command); return ''; };
  }
  // the SQL goes on stdin, so nothing in it passes through a shell
  return (command, json = false) => {
    const out = execFileSync('ssh', ['-o', 'BatchMode=yes', t.host, `/usr/bin/sqlite3 ${json ? '-json ' : ''}${LIVE_DB}`], { input: `.timeout 5000\nPRAGMA foreign_keys = ON;\n${command};\n`, encoding: 'utf8', stdio: ['pipe', 'pipe', 'inherit'] });
    if (!json) return out;
    return out.trim() ? JSON.parse(out) : [];
  };
}
