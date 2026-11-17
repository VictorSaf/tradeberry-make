/* The tick recorder: its own process on the Mac mini (launchd com.victor.tradeberry-recorder), running whether or not
   anyone has tradeBerry open. Hears the platform's quotes table every 100 ms (from host/feed-hub.mjs when TB_FEED_HUB is
   set, else by reading it itself) and
   stores every price that changed, in a database of its own (TB_TICKS, default data/ticks.db) so the app's database and
   its daily backup stay small.
   - ticks: one row per change, (s = syms.id, t = the platform's timestamp in ms) → bid, ask; a later price with the same
     timestamp replaces the earlier one.
   - runs: the stretches the recorder was hearing the platform. A gap is anything between one run's `last` and the next
     run's `start`; a run ends when the platform has not answered for GAP_MS. Gaps are what an import fills later.
   The platform keeps no tick history, so a gap can only ever be filled with its 1-minute bars. */
import { DatabaseSync } from 'node:sqlite';
import { statfsSync } from 'node:fs';
import { parseQuotes } from '../server/legacy.js';
import { subscribeFeed } from './feed-client.mjs';

// MIN_FREE: below this much free disk the recorder pauses (the gap is logged as one), so ticks never starve the app's database
const TICK_MS = 100, GAP_MS = 5000, RUN_EVERY_MS = 5000, LOG_EVERY_MS = 600000, DISK_EVERY_MS = 60000, MIN_FREE = 5e9;
const env = process.env, FILE = env.TB_TICKS || new URL('../.data/ticks.db', import.meta.url).pathname;
if (!env.LEGACY_API_KEY) { console.error('recorder: LEGACY_API_KEY is not set'); process.exit(1); }
const URL_Q = `${env.LEGACY_BASE || 'https://trade.capitalsvision.com/gcp/api'}/quotes?apiKey=${encodeURIComponent(env.LEGACY_API_KEY)}`;

const db = new DatabaseSync(FILE);
db.exec(`PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA busy_timeout = 10000;
  CREATE TABLE IF NOT EXISTS syms (id INTEGER PRIMARY KEY, sym TEXT NOT NULL UNIQUE);
  CREATE TABLE IF NOT EXISTS ticks (s INTEGER NOT NULL, t INTEGER NOT NULL, b REAL NOT NULL, a REAL NOT NULL, PRIMARY KEY (s, t)) WITHOUT ROWID;
  CREATE TABLE IF NOT EXISTS runs (id INTEGER PRIMARY KEY, start INTEGER NOT NULL, last INTEGER NOT NULL);`);
const ids = new Map(db.prepare('SELECT id, sym FROM syms').all().map(r => [r.sym, r.id]));
const addSym = db.prepare('INSERT INTO syms (sym) VALUES (?) RETURNING id'), put = db.prepare('INSERT OR REPLACE INTO ticks (s, t, b, a) VALUES (?, ?, ?, ?)');
const newRun = db.prepare('INSERT INTO runs (start, last) VALUES (?, ?) RETURNING id'), touch = db.prepare('UPDATE runs SET last = ? WHERE id = ?');
const sid = s => { let id = ids.get(s); if (id == null) { id = addSym.get(s).id; ids.set(s, id); } return id; };

const last = new Map(); // sym → [bid, ask, t]: only changes are stored
let run = null, okAt = 0, runAt = 0, stored = 0, errs = 0, logAt = Date.now(), stop = false;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function poll() {
  let rows;
  try {
    const r = await fetch(URL_Q, { signal: AbortSignal.timeout(5000) });
    if (!r.ok) throw new Error(`Platform answered ${r.status}`);
    rows = parseQuotes(await r.text());
  } catch (e) { errs++; if (errs === 1 || errs % 600 === 0) console.error(new Date().toISOString(), 'recorder:', e.message); return; }
  store(rows);
}
function store(rows) {
  const now = Date.now();
  if (errs) { console.log(new Date().toISOString(), `recorder: platform back after ${errs} failed reads`); errs = 0; }
  db.exec('BEGIN');
  try {
    // a new run after a silence: the time between the old run's last and now is a gap
    if (!run || now - okAt > GAP_MS) { run = newRun.get(now, now).id; runAt = now; }
    var ch = rows.filter(([s, b, a, t]) => { const k = last.get(s); return !(k && k[0] === b && k[1] === a && k[2] === t); });
    for (const [s, b, a, t] of ch) put.run(sid(s), t, b, a);
    if (now - runAt >= RUN_EVERY_MS) { touch.run(now, run); runAt = now; }
    db.exec('COMMIT');
  } catch (e) { try { db.exec('ROLLBACK'); } catch (x) {} run = null; console.error(new Date().toISOString(), 'recorder: write failed:', e.message); return; }
  // only a committed change counts as seen, so a failed write is tried again with the next read
  for (const [s, b, a, t] of ch) last.set(s, [b, a, t]);
  stored += ch.length;
  okAt = now;
  if (now - logAt >= LOG_EVERY_MS) { console.log(new Date().toISOString(), `recorder: ${stored} ticks in ${Math.round((now - logAt) / 60000)} min, ${ids.size} instruments`); stored = 0; logAt = now; }
}

const end = () => { stop = true; };
process.on('SIGTERM', end); process.on('SIGINT', end);
console.log(new Date().toISOString(), 'recorder: writing to', FILE);
let diskAt = 0, full = false;
const freeBytes = () => { try { const s = statfsSync(FILE); return s.bavail * s.bsize; } catch (e) { return Infinity; } };
// on the Mac mini (TB_FEED_HUB) the rows come from host/feed-hub.mjs, the one reader of the platform: no reads here
const hub = env.TB_FEED_HUB ? subscribeFeed({ onRows: rows => { if (!full) store(rows); }, log: s => console.error(new Date().toISOString(), 'recorder: ' + s) }) : null;
while (!stop) {
  const t0 = Date.now();
  if (t0 - diskAt >= DISK_EVERY_MS) {
    diskAt = t0; const f = freeBytes(), was = full; full = f < MIN_FREE;
    if (full !== was) console.error(new Date().toISOString(), full ? `recorder: paused, only ${(f / 1e9).toFixed(1)} GB free` : 'recorder: disk space back, recording again');
  }
  if (!full && !hub) await poll();
  const wait = TICK_MS - (Date.now() - t0);
  if (wait > 0) await sleep(wait);
}
if (hub) hub.close();
if (run && okAt) touch.run(okAt, run);
db.close();
console.log(new Date().toISOString(), 'recorder: stopped');
