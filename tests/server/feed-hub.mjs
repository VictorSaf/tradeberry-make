// host/feed-hub.mjs (the one reader of the platform) and its listeners (host/feed-client.mjs, the broker's createFeed,
// the relay): a fake platform, no network. Usage, from 2-cod-sursa: node tests/server/feed-hub.mjs (also run by run.mjs).
import { startHub } from '../../host/feed-hub.mjs';
import { subscribeFeed } from '../../host/feed-client.mjs';

let pass = 0, fail = 0;
const ok = (v, m) => { if (v) pass++; else { fail++; console.log('  FAIL', m); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (f, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (f()) return true; await sleep(20); } return f(); };
let down = false, calls = 0, px = 1.1;
const fake = async () => { calls++; if (down) return { ok: false, status: 503, arrayBuffer: async () => {} }; return { ok: true, text: async () => `instrument,bid,ask,timestamp\nEURUSD,${px},${(px + 0.0001).toFixed(5)},${Date.now()}\nGOLD,3900,3900.5,${Date.now()}` }; };
const addr = { host: '127.0.0.1', port: 0 };
let H = await startHub({ key: 'k', fetch: fake, every: 50, addr, log: () => {} });
const A = { host: '127.0.0.1', port: H.port };

// FH1: one read per period whatever the number of listeners; each listener gets every good answer, whole
const got1 = [], got2 = [];
const c1 = subscribeFeed({ addr: A, onRows: r => got1.push(r), log: () => {} }), c2 = subscribeFeed({ addr: A, onRows: r => got2.push(r), log: () => {} });
await until(() => got1.length >= 5 && got2.length >= 5);
const c0 = calls; await sleep(500); const per = (calls - c0) / 0.5;
ok(per > 10 && per < 25, `FH1 the platform is read ~every 50 ms with two listeners: ${per.toFixed(1)}/s`);
ok(got1.at(-1).length === 2 && got1.at(-1)[0][0] === 'EURUSD' && got1.at(-1)[0][1] === 1.1, 'FH1 rows whole: ' + JSON.stringify(got1.at(-1)));
ok(H.listeners === 2, 'FH1 two listeners: ' + H.listeners);

// FH2: a failed platform read goes out as err, no rows; back → rows again
const errs = [], c3 = subscribeFeed({ addr: A, onRows: () => {}, onErr: e => errs.push(e), log: () => {} });
down = true; const n1 = got1.length; await until(() => errs.length > 0); await sleep(150);
ok(errs[0] === 'Platform unavailable' && got1.length - n1 <= 1, `FH2 down: err "${errs[0]}", no new rows (${got1.length - n1})`);
down = false; px = 1.2; await until(() => got1.at(-1)[0][1] === 1.2);
ok(got1.at(-1)[0][1] === 1.2, 'FH2 back: the new price arrives');

// FH3: a new listener gets the last good answer at once
const late = []; const c4 = subscribeFeed({ addr: A, onRows: r => late.push(r), log: () => {} });
await until(() => late.length > 0, 1000);
ok(late.length > 0, 'FH3 a late listener gets rows at once');

// FH4: the hub restarts on the same port → listeners reconnect by themselves
const port = H.port; await H.close(); const n4 = got1.length;
H = await startHub({ key: 'k', fetch: fake, every: 50, addr: { host: '127.0.0.1', port }, log: () => {} });
ok(await until(() => got1.length > n4 + 3, 5000), `FH4 after a hub restart rows flow again (${got1.length - n4})`);

// FH5: the broker/gateway feed listens to the hub when TB_FEED_HUB is set (no platform read of its own)
process.env.TB_FEED_HUB = `127.0.0.1:${port}`;
const { createFeed } = await import('../../host/broker/feed.mjs');
const viaHub = []; let own = 0;
const F = createFeed({ key: undefined, onQuotes: r => viaHub.push(r), log: () => {} }).start();
await until(() => viaHub.length > 3);
ok(viaHub.length > 3 && viaHub.at(-1)[0][0] === 'EURUSD', `FH5 createFeed via the hub: ${viaHub.length} batches, no key needed`);
await F.stop();
// FH5b: during a platform outage a restarted broker gets the hub's replayed last answer: older than 1 s, it never feeds execution
down = true; await sleep(1300);
const stale = []; const F2 = createFeed({ onQuotes: r => stale.push(r), log: () => {} }).start();
await sleep(600);
ok(stale.length === 0, `FH5b replayed answer older than 1 s not handed to execution: ${stale.length}`);
await F2.stop(); down = false; await sleep(200);

// FH6: the relay listens to the hub and diffs: a browser gets only changed rows
const { makeRelay } = await import('../../host/relay.mjs');
const R = makeRelay({ LEGACY_API_KEY: '', TB_FEED_HUB: `127.0.0.1:${port}` });
const msgs = [], ws = { bufferedAmount: 0, on() {}, send: s => msgs.push(JSON.parse(s)), ping() {}, terminate() {}, close() {} };
await sleep(300); R.add(ws); px = 1.3;
await until(() => msgs.some(m => m.q && m.q.some(r => r[0] === 'EURUSD' && r[1] === 1.3)));
const qs = msgs.filter(m => m.q && !m.all);
ok(msgs.some(m => m.q && m.q.some(r => r[1] === 1.3)), 'FH6 relay forwards the new EURUSD price');
ok(qs.length > 0 && qs.every(m => Array.isArray(m.q)), 'FH6 relay sends row batches to the browser: ' + qs.length);
R.close();

for (const c of [c1, c2, c3, c4]) c.close();
await H.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
