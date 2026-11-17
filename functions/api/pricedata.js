// /api/pricedata — Administration › Price data (spec 2026-11-02-admin-date-pret), administrators only (users.admin = 1).
// GET  → { recorder: { on, last, today, bytes, daysBytes }, total (all price data, bytes), gaps: [{ start, end, ongoing, covered, of }], archive: <bars/status.json>
//          + { bytes }, disk: { free } }. Every value is read from the recorder's database and the archive, not assumed.
// POST { op: 'import' | 'gaps', sym? } → { ok, started } | 409 already running. Starts host/bars-import.mjs as its own
//   process (it outlives the request; log in logs/bars.log). Node only: the server is host/server.mjs on the Mac mini.
import { DatabaseSync } from 'node:sqlite';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, statfsSync, openSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { json, sameOrigin, audit } from '../../server/auth.js';
import { SYM_RE } from '../../server/legacy.js';

const deny = () => json({ error: 'Administrators only' }, 403);
const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'host', 'bars-import.mjs');
const LIVE_MS = 15000; // the recorder stamps its run every 5 s: older than this, it is not hearing the platform
const dataDir = env => env.TB_DATA || join(dirname(fileURLToPath(import.meta.url)), '..', '..', '.data');
const size = f => { try { return statSync(f).size; } catch (e) { return 0; } };
// a folder's bytes, read now (a few thousand files: milliseconds), so the totals are never the last run's
function dirBytes(d) { let n = 0; try { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); n += e.isDirectory() ? dirBytes(p) : size(p); } } catch (e) {} return n; }
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
function running(dir) {
  const f = join(dir, 'bars', '.lock'); if (!existsSync(f)) return 0;
  const pid = +readFileSync(f, 'utf8'); return pid && alive(pid) ? pid : 0;
}

export async function onRequestGet({ env, data }) {
  if (!data.user.admin) return deny();
  const dir = dataDir(env), T = Date.now(), tf = join(dir, 'ticks.db');
  let archive = { syms: {} };
  try { archive = JSON.parse(readFileSync(join(dir, 'bars', 'status.json'), 'utf8')); } catch (e) {}
  if (archive.run && !running(dir)) { archive.stopped = archive.run; delete archive.run; } // a run whose process is gone did not finish
  const recorder = { on: false, last: null, today: 0, bytes: size(tf) + size(tf + '-wal') }, gaps = [];
  if (existsSync(tf)) {
    const db = new DatabaseSync(tf, { readOnly: true });
    try {
      const runs = db.prepare('SELECT start, last FROM runs ORDER BY start').all();
      const d0 = Math.floor(T / 86400000) * 86400000, cnt = db.prepare('SELECT COUNT(*) AS n FROM ticks WHERE s = ? AND t >= ?');
      for (const { id } of db.prepare('SELECT id FROM syms').all()) recorder.today += cnt.get(id, d0).n;
      const lastRun = runs[runs.length - 1];
      if (lastRun) { recorder.last = lastRun.last; recorder.on = T - lastRun.last < LIVE_MS; recorder.since = runs[0].start; }
      for (let i = 1; i < runs.length; i++) gaps.push({ start: runs[i - 1].last, end: runs[i].start });
      if (lastRun && !recorder.on) gaps.push({ start: lastRun.last, end: T, ongoing: true });
    } finally { db.close(); }
  }
  // a gap is covered for an instrument when its archived 1-minute bars reach over it (the platform keeps no ticks)
  const m1 = Object.values(archive.syms || {}).map(s => s[1]).filter(v => v && v.last);
  const out = gaps.slice(-50).reverse().map(g => ({ ...g, of: m1.length, covered: g.ongoing ? 0 : m1.filter(v => v.first * 1000 <= g.start && v.last * 1000 + 60000 >= g.end).length }));
  let free = null; try { const s = statfsSync(dir); free = s.bavail * s.bsize; } catch (e) {}
  // all the price data on the server: the recorder's database, its compressed days, the bar archive
  recorder.daysBytes = dirBytes(join(dir, 'ticks')); archive.bytes = dirBytes(join(dir, 'bars'));
  const total = recorder.bytes + recorder.daysBytes + archive.bytes;
  return json({ recorder, gaps: out, gapsTotal: gaps.length, archive: { ...archive, pid: running(dir) || null }, disk: { free }, total });
}

export async function onRequestPost({ request, env, data }) {
  if (!data.user.admin) return deny();
  if (!sameOrigin(request)) return json({ error: 'Cross-site request refused' }, 403);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'Send JSON' }, 400); }
  const op = String(b.op || ''), sym = b.sym == null || b.sym === '' ? null : String(b.sym).trim().toUpperCase();
  if (op !== 'import' && op !== 'gaps') return json({ error: 'Unknown operation' }, 400);
  if (sym && !SYM_RE.test(sym)) return json({ error: 'Bad instrument' }, 400);
  const dir = dataDir(env), pid = running(dir);
  if (pid) return json({ error: 'An import is already running' }, 409);
  const logs = env.TB_LOGS || join(dir, '..', 'logs'); mkdirSync(logs, { recursive: true });
  const fd = openSync(join(logs, 'bars.log'), 'a');
  const args = [SCRIPT, ...(op === 'gaps' ? ['--gaps'] : sym ? ['--sym', sym] : [])];
  const ch = spawn(process.execPath, args, { detached: true, stdio: ['ignore', fd, fd], env: { ...process.env, TB_DATA: dir } });
  ch.unref();
  await audit(env, request, data.user.username, 'pricedata.' + op, null, true, sym || null);
  return json({ ok: true, started: op === 'gaps' ? 'gaps' : sym || 'all' });
}
