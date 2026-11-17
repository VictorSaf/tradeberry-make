/* The price archive (spec 2026-11-02-admin-date-pret): a copy of the platform's own history on the Mac mini, kept as
   insurance. launchd com.victor.tradeberry-bars runs it every day at 05:30; Administration › Price data starts it too
   (functions/api/pricedata.js). The app keeps reading its history from the platform; this archive is not served.
   - bars/1/SYM/YYYY-MM.csv.gz: the 1-minute bars (as far back as the platform has them, ~9 months), one month a file;
     bars/60/SYM/YYYY.csv.gz: the 1-hour bars since 2022, one year a file. "t,o,h,l,c", t in s, prices as the platform
     gives them. The month or year a run touches is rewritten whole: .tmp, read back and counted, then renamed.
   - Incremental: a run walks back from now only to the last bar already archived (the first run: to the platform's
     start, two empty windows in a row, or the cap). A recorder gap is therefore covered by the next run.
   - Its own pace, outside the server's limiter: one request at a time, at most 1 a second. A failed request is tried 3
     times; then that instrument and resolution is marked failed and the run goes on.
   - bars/status.json: the run in progress or the last one, and per instrument and resolution first/last bar, count,
     error. bars/.lock holds the pid while a run is on, so a second start says so and leaves.
   Usage: node host/bars-import.mjs [--sym EURUSD] [--res 1|60] [--gaps (= 1-minute bars only)]. TB_DATA: the data dir. */
import { createGzip, gunzipSync } from 'node:zlib';
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, unlinkSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { once } from 'node:events';

const HOST = process.env.TB_PLATFORM || 'https://trade.capitalsvision.com/gcp';
const DATA = process.env.TB_DATA || new URL('../.data', import.meta.url).pathname, OUT = join(DATA, 'bars');
const STATUS = join(OUT, 'status.json'), LOCK = join(OUT, '.lock');
// W: the window asked per request (the platform often answers more); CAP: how far back it is worth asking
const W = { 1: 7 * 86400, 60: 365 * 86400 }, CAP = { 1: () => now() - 400 * 86400, 60: () => 1640995200 };
export const _t = { now: () => Date.now(), sleep: ms => new Promise(r => setTimeout(r, ms)), gap: 1000 };
const now = () => Math.floor(_t.now() / 1000);

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : d; };
const flag = n => process.argv.includes(n);

function readStatus() { try { return JSON.parse(readFileSync(STATUS, 'utf8')); } catch (e) { return { syms: {} }; } }
function writeStatus(s) { const t = STATUS + '.tmp'; writeFileSync(t, JSON.stringify(s)); renameSync(t, STATUS); }
const alive = pid => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

let lastAt = 0;
async function get(url) {
  for (let i = 1; ; i++) {
    const wait = lastAt + _t.gap - _t.now(); if (wait > 0) await _t.sleep(wait);
    lastAt = _t.now();
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(60000) });
      if (!r.ok) throw new Error(`platform answered ${r.status}`);
      const j = await r.json();
      if (j && j.s === 'no_data') return null;
      if (!j || j.s !== 'ok' || !Array.isArray(j.t)) throw new Error('unexpected answer from the platform');
      return j;
    } catch (e) { if (i >= 3) throw e; await _t.sleep(2000 * 2 ** i); }
  }
}

// file key of a bar: the month (1 min) or the year (1 h), UTC
const part = (res, t) => new Date(t * 1000).toISOString().slice(0, res === 60 ? 4 : 7);
const fileOf = (sym, res, p) => join(OUT, String(res), sym, p + '.csv.gz');
function readPart(f) {
  const m = new Map(); if (!existsSync(f)) return m;
  for (const l of gunzipSync(readFileSync(f)).toString().split('\n').slice(1)) { if (!l) continue; const v = l.split(','); m.set(+v[0], v.slice(1).join(',')); }
  return m;
}
async function writePart(f, m) {
  mkdirSync(dirname(f), { recursive: true });
  const tmp = f + '.tmp', gz = createGzip({ level: 9 }), out = createWriteStream(tmp), ts = [...m.keys()].sort((a, b) => a - b);
  gz.pipe(out);
  let buf = 't,o,h,l,c\n';
  for (const t of ts) { buf += t + ',' + m.get(t) + '\n'; if (buf.length > 1 << 16) { if (!gz.write(buf)) await once(gz, 'drain'); buf = ''; } }
  gz.end(buf); await once(out, 'close');
  const back = gunzipSync(readFileSync(tmp)).toString().split('\n').length - 2;
  if (back !== ts.length) throw new Error(`${f}: wrote ${ts.length} bars, read back ${back}`);
  renameSync(tmp, f);
}

// one instrument, one resolution: walk back from now to the archive's last bar (or the platform's start), then merge
export async function importOne(sym, ticker, res, prev = {}) {
  const got = new Map(), stopAt = prev.last || 0, cap = CAP[res]();
  let to = now() + 60, empties = 0;
  while (to > cap) {
    const from = Math.max(cap, to - W[res]);
    const j = await get(`${HOST}/datafeed/history?symbol=${encodeURIComponent(ticker)}&resolution=${res}&from=${from}&to=${to}`);
    if (!j || !j.t.length) { if (++empties >= 2 && !stopAt) break; to = from; if (stopAt && to <= stopAt) break; continue; }
    empties = 0;
    let lo = to;
    for (let i = 0; i < j.t.length; i++) { const t = +j.t[i]; if (t < lo) lo = t; if (t < to && t > stopAt) got.set(t, `${j.o[i]},${j.h[i]},${j.l[i]},${j.c[i]}`); }
    if (lo <= stopAt) break;
    to = lo < to ? lo : from;
  }
  // the bar still forming is not archived: it is asked again by the next run
  const open = Math.floor(now() / (res * 60)) * res * 60; got.delete(open);
  const parts = new Map();
  for (const [t, v] of got) { const p = part(res, t); if (!parts.has(p)) parts.set(p, new Map()); parts.get(p).set(t, v); }
  // the count is the files' own (per part), so a run that failed half way never leaves a wrong total
  let added = 0; const counts = { ...(prev.parts || {}) };
  for (const [p, m] of parts) {
    const f = fileOf(sym, res, p), old = readPart(f), n0 = old.size;
    for (const [t, v] of m) old.set(t, v);
    added += old.size - n0; counts[p] = old.size;
    await writePart(f, old);
  }
  let first = prev.first || Infinity, last = prev.last || 0;
  for (const t of got.keys()) { if (t < first) first = t; if (t > last) last = t; }
  return { first: first === Infinity ? null : first, last: last || null, n: Object.values(counts).reduce((a, b) => a + b, 0), parts: counts, added };
}

function dirBytes(d) { let n = 0; if (!existsSync(d)) return 0; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); n += e.isDirectory() ? dirBytes(p) : statSync(p).size; } return n; }

export async function main() {
  mkdirSync(OUT, { recursive: true });
  // the lock is taken with O_EXCL, so two starts at the same moment cannot both run; a dead process's lock is taken over
  if (existsSync(LOCK)) { const pid = +readFileSync(LOCK, 'utf8'); if (pid && alive(pid)) { console.log(new Date().toISOString(), 'bars-import: already running, pid', pid); return 2; } try { unlinkSync(LOCK); } catch (e) {} }
  try { writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); } catch (e) { console.log(new Date().toISOString(), 'bars-import: another start took the lock'); return 2; }
  const st = readStatus(), only = arg('--sym'), gaps = flag('--gaps'), resArg = arg('--res');
  const reses = gaps ? [1] : resArg ? [+resArg === 60 ? 60 : 1] : [1, 60], op = gaps ? 'gaps' : only ? 'one' : 'all';
  try {
    const r = await fetch(`${HOST}/datafeed/symbol_info?group=Main`, { signal: AbortSignal.timeout(60000) });
    if (!r.ok) throw new Error(`platform symbol list answered ${r.status}`);
    const j = await r.json(), list = [];
    j.symbol.forEach((s, i) => { if (j.ticker[i] && !list.some(x => x.sym === s) && /^[A-Z0-9][A-Z0-9._-]{1,19}$/.test(s)) list.push({ sym: s, ticker: String(j.ticker[i]) }); });
    const todo = only ? list.filter(x => x.sym === only) : list;
    if (only && !todo.length) throw new Error(`${only} is not on the platform`);
    st.run = { pid: process.pid, op, sym: only, start: _t.now(), done: 0, total: todo.length * reses.length, cur: null };
    writeStatus(st);
    let ok = 0, failed = 0, added = 0;
    for (const { sym, ticker } of todo) for (const res of reses) {
      st.run.cur = sym + ' ' + (res === 60 ? '1h' : '1m'); writeStatus(st);
      const s = st.syms[sym] = st.syms[sym] || {}, prev = s[res] || {};
      try { const v = await importOne(sym, ticker, res, prev.err ? { ...prev, err: undefined } : prev); s[res] = { first: v.first, last: v.last, n: v.n, parts: v.parts, at: _t.now() }; ok++; added += v.added; }
      catch (e) { s[res] = { ...prev, err: e.message, at: _t.now() }; failed++; console.error(new Date().toISOString(), `bars-import: ${sym} ${res}: ${e.message}`); }
      st.run.done++; writeStatus(st);
    }
    st.last = { op, sym: only, start: st.run.start, end: _t.now(), ok, failed, added };
    console.log(new Date().toISOString(), `bars-import: ${op} done, ${ok} ok, ${failed} failed, ${added} bars added`);
  } catch (e) {
    st.last = { op, sym: only, start: st.run ? st.run.start : _t.now(), end: _t.now(), error: e.message };
    console.error(new Date().toISOString(), 'bars-import:', e.message);
  } finally {
    delete st.run; st.bytes = dirBytes(OUT); writeStatus(st);
    try { unlinkSync(LOCK); } catch (e) {}
  }
  return st.last.error ? 1 : 0;
}

if (process.argv[1] && import.meta.url === new URL('file://' + process.argv[1]).href) process.exitCode = await main();
