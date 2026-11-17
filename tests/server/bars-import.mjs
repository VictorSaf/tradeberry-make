// host/bars-import.mjs against a fake platform (no network): the archive by month, the incremental run, a failing
// instrument, the lock. Usage, from 2-cod-sursa: node tests/server/bars-import.mjs (also run by tests/server/run.mjs).
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DIR = mkdtempSync(join(tmpdir(), 'tb-bars-')); process.env.TB_DATA = DIR;
const NOW = Date.UTC(2026, 10, 2, 12, 0, 30), START = Math.floor(NOW / 1000) - 40 * 86400; // the platform has 40 days
let clock = NOW, reqs = [], failSym = 'BADONE';
// like the real one: a request answers up to 3× the window asked, ending at `to`; nothing before START
globalThis.fetch = async url => {
  const u = new URL(String(url));
  if (u.pathname.endsWith('/symbol_info')) return Response.json({ symbol: ['EURUSD', 'BADONE', 'GOLD'], ticker: ['EUR A0-FX', 'BAD X', 'XAU'], pricescale: [100000, 100, 100] });
  const sym = u.searchParams.get('symbol'), res = +u.searchParams.get('resolution'), from = +u.searchParams.get('from'), to = +u.searchParams.get('to');
  reqs.push({ sym, res, from, to });
  if (sym === 'BAD X') return new Response('oops', { status: 500 });
  const step = res * 60, lo = Math.max(START, to - 3 * (to - from)), t = [], o = [], h = [], l = [], c = [];
  for (let x = Math.ceil(lo / step) * step; x < Math.min(to, Math.floor(clock / 1000) + 1); x += step) {
    if (sym === 'XAU' && new Date(x * 1000).getUTCDay() === 6) continue; // gold: closed on Saturdays
    t.push(x); o.push(1.1); h.push(1.2); l.push(1.0); c.push(1.15);
  }
  return Response.json(t.length ? { s: 'ok', t, o, h, l, c } : { s: 'no_data' });
};
const m = await import('../../host/bars-import.mjs');
m._t.now = () => clock; m._t.sleep = async ms => { clock += ms; }; m._t.gap = 1000;

let pass = 0, fail = 0;
const ok = (v, msg) => { if (v) pass++; else { fail++; console.log('  FAIL', msg); } };
const st = () => JSON.parse(readFileSync(join(DIR, 'bars', 'status.json'), 'utf8'));
const rows = f => gunzipSync(readFileSync(f)).toString().trim().split('\n');
const run = async (...a) => { process.argv = ['node', 'bars-import.mjs', ...a]; reqs = []; return m.main(); };

// BI1: first run — every instrument, 1 min by month and 1 h by year, counts from the files, the failing one marked
{
  const code = await run();
  const s = st(), e1 = s.syms.EURUSD[1], dir1 = join(DIR, 'bars', '1', 'EURUSD');
  const files = readdirSync(dir1).sort(), total = files.reduce((n, f) => n + rows(join(dir1, f)).length - 1, 0);
  ok(code === 0, 'BI1 exit 0: ' + code);
  ok(files.join() === '2026-09.csv.gz,2026-10.csv.gz,2026-11.csv.gz', 'BI1 one file a month: ' + files);
  ok(rows(join(dir1, files[0]))[0] === 't,o,h,l,c' && rows(join(dir1, files[0]))[1] === `${Math.ceil(START / 60) * 60},1.1,1.2,1,1.15`, 'BI1 header and first bar: ' + rows(join(dir1, files[0])).slice(0, 2));
  ok(total === e1.n && e1.n === (Math.floor(NOW / 60000) - Math.ceil(START / 60)), `BI1 count = the files' = every closed minute since the start: ${total} / ${e1.n}`);
  ok(e1.first === Math.ceil(START / 60) * 60 && e1.last === Math.floor(NOW / 60000) * 60 - 60, 'BI1 first/last, the forming minute left out');
  ok(s.syms.EURUSD[60].n > 900 && existsSync(join(DIR, 'bars', '60', 'EURUSD', '2026.csv.gz')), 'BI1 1-hour bars by year: ' + s.syms.EURUSD[60].n);
  ok(s.syms.BADONE[1].err && s.syms.BADONE[60].err && s.syms.GOLD[1].n > 0, 'BI1 the failing instrument is marked, the next one still runs');
  ok(s.last.ok === 4 && s.last.failed === 2 && !s.run, 'BI1 last run: 4 ok, 2 failed, nothing running: ' + JSON.stringify(s.last));
  ok(!existsSync(join(DIR, 'bars', '.lock')), 'BI1 the lock is gone');
}
// BI2: incremental — 90 minutes later only the new bars, a couple of requests, no duplicate
{
  const { n: n0, last: l0 } = st().syms.EURUSD[1]; clock += 90 * 60000;
  await run('--gaps');
  const s = st(), e1 = s.syms.EURUSD[1], eur = reqs.filter(r => r.sym === 'EUR A0-FX');
  const f = join(DIR, 'bars', '1', 'EURUSD', '2026-11.csv.gz'), ts = rows(f).slice(1).map(l => +l.split(',')[0]);
  ok(e1.n - n0 >= 90 && e1.n - n0 === (e1.last - l0) / 60, 'BI2 every new minute, none twice: ' + (e1.n - n0));
  ok(new Set(ts).size === ts.length && ts.every((x, i) => !i || x > ts[i - 1]), 'BI2 the month file is sorted, no duplicate');
  ok(eur.length <= 2 && eur.every(r => r.res === 1), 'BI2 --gaps asks 1-minute bars only, and few: ' + eur.length);
  ok(s.last.op === 'gaps', 'BI2 op gaps');
}
// BI3: one instrument; a second start while one runs says so
{
  await run('--sym', 'GOLD');
  ok(reqs.every(r => r.sym === 'XAU') && st().last.op === 'one', 'BI3 --sym asks that instrument only');
  writeFileSync(join(DIR, 'bars', '.lock'), String(process.pid));
  ok(await run() === 2 && reqs.length === 0, 'BI3 a live lock: exit 2, nothing asked');
  writeFileSync(join(DIR, 'bars', '.lock'), '999999');
  ok(await run('--sym', 'GOLD') === 0, 'BI3 a stale lock (dead pid) is taken over');
}
rmSync(DIR, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
