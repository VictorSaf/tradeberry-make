/* The daily roll of the tick recorder (launchd com.victor.tradeberry-tickroll, every hour): every UTC day that has ended
   leaves data/ticks.db for one gzip file, data/ticks/YYYY/YYYY-MM-DD.csv.gz ("sym,t,bid,ask", sorted by instrument, then
   time; t = the platform's timestamp in ms). ~5 bytes a tick instead of ~40 in SQLite.
   Safe order: write to .tmp, read it back and count, rename, only then delete the day's rows (per instrument, so the
   recorder's writes never wait long). Ticks of a day already rolled (a late timestamp) go to YYYY-MM-DD.2.csv.gz, .3, … */
import { DatabaseSync } from 'node:sqlite';
import { createGzip, gunzipSync } from 'node:zlib';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { once } from 'node:events';

const DAY = 86400000, FILE = process.env.TB_TICKS || new URL('../.data/ticks.db', import.meta.url).pathname;
const OUT = process.env.TB_TICKS_DIR || join(dirname(FILE), 'ticks');
const db = new DatabaseSync(FILE);
db.exec('PRAGMA busy_timeout = 10000');
const today = Math.floor(Date.now() / DAY) * DAY;
const syms = db.prepare('SELECT id, sym FROM syms ORDER BY id').all();
const rows = db.prepare('SELECT t, b, a FROM ticks WHERE s = ? AND t >= ? AND t < ? ORDER BY t');
const del = db.prepare('DELETE FROM ticks WHERE s = ? AND t >= ? AND t < ?');

function target(d0) {
  const day = new Date(d0).toISOString().slice(0, 10), dir = join(OUT, day.slice(0, 4));
  mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n++) { const f = join(dir, day + (n > 1 ? '.' + n : '') + '.csv.gz'); if (!existsSync(f)) return f; }
}
async function roll(d0) {
  const d1 = d0 + DAY, f = target(d0), tmp = f + '.tmp';
  const gz = createGzip({ level: 9 }), out = createWriteStream(tmp);
  gz.pipe(out);
  const write = async s => { if (!gz.write(s)) await once(gz, 'drain'); };
  let n = 0;
  await write('sym,t,bid,ask\n');
  for (const { id, sym } of syms) {
    let buf = '';
    for (const r of rows.iterate(id, d0, d1)) { buf += `${sym},${r.t},${r.b},${r.a}\n`; n++; if (buf.length > 1 << 16) { await write(buf); buf = ''; } }
    if (buf) await write(buf);
  }
  gz.end(); await once(out, 'close');
  const back = gunzipSync(readFileSync(tmp)).toString().split('\n').length - 2; // header and the final newline
  if (back !== n) throw new Error(`${f}: wrote ${n} ticks, read back ${back}`);
  renameSync(tmp, f);
  for (const { id } of syms) del.run(id, d0, d1);
  console.log(new Date().toISOString(), `tick-roll: ${f} (${n} ticks)`);
}

for (;;) {
  const first = db.prepare('SELECT MIN(t) AS t FROM ticks WHERE t < ?').get(today).t;
  if (first == null) break;
  await roll(Math.floor(first / DAY) * DAY);
}
db.close();
