/* Progress bar for node tests/run.mjs (tools/front-deploy.sh pipes the runner into it):
     node tests/run.mjs … 2>&1 | node tools/test-progress.mjs <full-log-file>
   Reads the runner's "# N tests" and "[i/N]" lines. On a terminal it redraws one line in place
   ([#####-----] 120/310 · 2:05 · ~3:20 left · 0 failed); elsewhere it prints a line every 10%.
   A failing test is printed at once, with its message. The whole output goes to the log file. */
import { createWriteStream } from 'node:fs';
import { createInterface } from 'node:readline';

const log = createWriteStream(process.argv[2] || '/dev/null');
const tty = process.stderr.isTTY, t0 = Date.now();
let total = 0, done = 0, failed = 0, lastPct = -1, inFail = false;
const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const draw = () => {
  if (!total) return;
  const pct = Math.floor(done / total * 100), el = (Date.now() - t0) / 1000, w = 30, k = Math.round(done / total * w);
  const eta = done ? ` · ~${mmss(el / done * (total - done))} left` : '';
  const line = `  [${'#'.repeat(k)}${'-'.repeat(w - k)}] ${done}/${total} · ${mmss(el)}${eta} · ${failed} failed`;
  if (tty) process.stderr.write(`\r${line}\x1b[K`);
  else if (Math.floor(pct / 10) !== Math.floor(lastPct / 10) || done === total) console.error(line);
  lastPct = pct;
};
for await (const line of createInterface({ input: process.stdin })) {
  log.write(line + '\n');
  let m;
  if ((m = line.match(/^# (\d+) tests/))) { total = +m[1]; draw(); continue; }
  if ((m = line.match(/^\s+(ok|FAIL|pend)\s+\[(\d+)\/(\d+)\]/))) {
    done = +m[2]; total = +m[3]; inFail = m[1] === 'FAIL';
    if (inFail) { failed++; if (tty) process.stderr.write('\r\x1b[K'); console.error(line); }
    draw(); continue;
  }
  // the failure message lines that follow a FAIL, and the final summary
  if (inFail && /^\s{7}/.test(line)) { if (tty) process.stderr.write('\r\x1b[K'); console.error(line); draw(); continue; }
  inFail = false;
  if (/passed, \d+ failed/.test(line)) { if (tty) process.stderr.write('\n'); console.error(line.trim()); }
}
log.end();
