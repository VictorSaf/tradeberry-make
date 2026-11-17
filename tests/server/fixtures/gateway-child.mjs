// G9 fixture: the gateway in its own process, so tests/server/gateway.mjs can kill -9 it. With 'fill' as the 4th
// argument the process kills itself (SIGKILL) inside the transaction that handles the first fill it receives, before it
// commits. Usage: node gateway-child.mjs <tradeberry.db> <ws port> <broker FIX port> [fill]
// (TB_FIX_USER / TB_FIX_PASS / TB_GW_SECRET from the environment). Logs go to stdout; never a field or a credential.
import { startGateway } from '../../../host/gateway.mjs';

// TB_TEST_OFF (ms) / TB_TEST_Q (JSON {sym: [bid, ask]}): the parent's market clock and a constant fake feed for the OMS
const [file, port, fixPort, crash] = process.argv.slice(2);
const OFF = +(process.env.TB_TEST_OFF || 0), Q = process.env.TB_TEST_Q ? JSON.parse(process.env.TB_TEST_Q) : null, now = () => Date.now() + OFF;
const g = await startGateway({ db: file, port: +port, fixPort: +fixPort, user: process.env.TB_FIX_USER, pass: process.env.TB_FIX_PASS, secret: process.env.TB_GW_SECRET, now,
  log: s => console.log(s), hooks: crash === 'fill' ? { exec: ev => { if (ev.kind === 'fill') process.kill(process.pid, 'SIGKILL'); } } : {} });
if (Q) setInterval(() => g.tick(Object.entries(Q).map(([s, [b, a]]) => [s, b, a, now()])), 200).unref();
process.on('SIGTERM', async () => { await g.close(); process.exit(0); });
console.log('ready');
