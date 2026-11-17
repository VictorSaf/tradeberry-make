// FS4b fixture: a FIX initiator (TB-GW2) in its own process, killed -9 by the test while ExecutionReports stream in.
// Orders k1..kN go out once each (the count of sent ones commits with the send); every ExecutionReport is recorded by
// ExecID (17) in the store's own database from onApp, on the same connection, so it commits with in_seq.
// Usage: node fix-initiator.mjs <port> <store file> <N> (credentials from TB_FIX_USER / TB_FIX_PASS). Prints "got <n>".
import { createInitiator } from '../../../host/fix/session.mjs';
import { openStore } from '../../../host/fix/store.mjs';

const [port, file, N] = process.argv.slice(2), store = openStore(file);
store.db.exec('CREATE TABLE IF NOT EXISTS got (id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS sent (n INTEGER NOT NULL)');
const add = store.db.prepare('INSERT INTO got VALUES (?)'), n = store.db.prepare('SELECT COUNT(*) AS n FROM got');
const sent = store.db.prepare('INSERT INTO sent VALUES (?)'), last = store.db.prepare('SELECT COUNT(*) AS n FROM sent');
let pumping = false;
const I = createInitiator({ port: +port, compId: 'TB-GW2', target: 'TB-BROKER', user: process.env.TB_FIX_USER, pass: process.env.TB_FIX_PASS, heartBtInt: 1, store,
  onApp: m => { if (m.type === '8') { add.run(m.fields.get('17')); console.log('got ' + n.get().n); } },
  onState: s => { if (s === 'logged-on' && !pumping) { pumping = true; pump(); } } });
function pump() {
  const i = last.get().n + 1; if (i > +N) return;
  store.tx(() => { I.send('D', [[11, 'x' + i], [55, 'EURUSD'], [54, 1], [38, 0.1], [40, 1]]); sent.run(i); });
  setTimeout(pump, 15);
}
