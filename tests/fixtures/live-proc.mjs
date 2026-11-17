// One server process of the live world in its own OS process (tests/fixtures/live-env.mjs, procs: true), so a test can
// kill -9 it and start it again on the same database: node tests/fixtures/live-proc.mjs broker | gateway.
// The broker reads the fake platform's quotes itself (host/broker/feed.mjs, LEGACY_BASE) on the live world's market
// clock (TB_TEST_OFF: clock() - Date.now(), ms); its recovery bars after a restart are flat at the platform's current bid.
// The gateway is started as live-env starts it in-process (no feed). Logs go to stdout, one line each.
import { parseQuotes } from '../../server/legacy.js';

const kind = process.argv[2], env = process.env, off = +env.TB_TEST_OFF || 0, now = () => Date.now() + off;
const log = s => console.log(`${kind}: ${s}`);
const common = { user: env.TB_FIX_USER, pass: env.TB_FIX_PASS, log };
let x;
if (kind === 'broker') {
  const { startBroker } = await import('../../host/broker.mjs');
  const fetchBars = async (sym, from, to) => {
    const r = await fetch(`${env.LEGACY_BASE}/quotes`), row = parseQuotes(await r.text()).find(q => q[0] === sym);
    if (!row) return null;
    const out = []; for (let t = Math.ceil(from / 60) * 60; t + 60 <= to; t += 60) out.push({ t, o: row[1], h: row[1], l: row[1], c: row[1] });
    return out;
  };
  x = await startBroker({ ...common, db: env.TB_BROKER_DB, port: +env.TB_FIX_PORT, feed: true, now, seed: 7, fetchBars });
  await x.recovering;
} else if (kind === 'gateway') {
  const { startGateway } = await import('../../host/gateway.mjs');
  x = await startGateway({ ...common, db: env.TB_DB, port: +env.TB_GW_PORT, fixPort: +env.TB_FIX_PORT, secret: env.TB_GW_SECRET });
} else { console.error('usage: live-proc.mjs broker | gateway'); process.exit(2); }
console.log(`${kind}: ready`);
process.on('SIGTERM', async () => { await x.close().catch(() => {}); process.exit(0); });
