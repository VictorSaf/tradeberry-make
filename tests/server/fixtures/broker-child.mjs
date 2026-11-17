// B10 fixture: the broker in its own process, on a fake feed read from stdin (one JSON line of [sym, bid, ask] rows per
// tick), so the test can kill -9 it. With a ClOrdID as the 4th argument the process kills itself (SIGKILL) right after
// the commit that handled that order, before its report reaches the wire. Usage:
// node broker-child.mjs <port> <db file> <clock offset ms> [crash ClOrdID] (credentials from TB_FIX_USER / TB_FIX_PASS).
// Prints "ready", then "fed" at the first tick; never a field or a credential.
import { createInterface } from 'node:readline';
import { startBroker } from '../../../host/broker.mjs';

const [port, file, off, crash] = process.argv.slice(2), clock = () => Date.now() + +off;
const b = await startBroker({ db: file, port: +port, user: process.env.TB_FIX_USER, pass: process.env.TB_FIX_PASS, feed: false, now: clock, seed: 3, log: s => console.log(s),
  hooks: crash ? { afterCommit: cl => { if (cl === crash) process.kill(process.pid, 'SIGKILL'); } } : {} });
let fed = false;
createInterface({ input: process.stdin }).on('line', l => {
  try { b.tick(JSON.parse(l).map(([s, bid, ask]) => [s, bid, ask, clock()])); } catch (e) { console.log('bad feed line (' + e.name + ')'); }
  if (!fed && b.market.feedAlive()) { fed = true; console.log('fed'); }
});
process.on('SIGTERM', async () => { await b.close(); process.exit(0); });
console.log('ready');
