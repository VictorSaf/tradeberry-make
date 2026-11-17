/* Progress bar for a test run already going, read from its log: node tools/test-watch.mjs <log> [total]
   Redraws every second until the summary line appears. Failures are printed as they show up. */
import { readFileSync } from 'node:fs';
const [log, totalArg] = process.argv.slice(2);
const t0 = Date.now(), seen = new Set();
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
for (;;) {
  let txt = ''; try { txt = readFileSync(log, 'utf8'); } catch { /* not there yet */ }
  const lines = txt.split('\n'), m = txt.match(/^# (\d+) tests/m), total = +(m?.[1] || totalArg || 0);
  const done = lines.filter(l => /^\s+(ok|FAIL|pend)\s/.test(l)).length, fails = lines.filter(l => /^\s+FAIL\s/.test(l));
  for (const f of fails) if (!seen.has(f)) { seen.add(f); process.stdout.write(`\r\x1b[K${f}\n`); }
  const w = 40, k = total ? Math.min(w, Math.round(done / total * w)) : 0, el = (Date.now() - t0) / 1000;
  const last = (lines.filter(l => /^\s+ok\s/.test(l)).pop() || '').replace(/^\s+ok\s+(\[\d+\/\d+\]\s+)?/, '').slice(0, 50);
  process.stdout.write(`\r\x1b[K[${'#'.repeat(k)}${'-'.repeat(w - k)}] ${done}/${total || '?'} · ${fails.length} failed · ${mmss(el)} · ${last}`);
  const sum = txt.match(/^\d+ passed, \d+ failed.*$/m);
  if (sum) { process.stdout.write(`\n${sum[0]}\n`); break; }
  await new Promise(r => setTimeout(r, 1000));
}
