// FS4 fixture: a FIX acceptor in its own process, so the test can kill -9 it mid-stream and restart it on the same
// store. onApp records each NewOrderSingle in the store's own database, inside the transaction that advances in_seq,
// so a message is either recorded and consumed or neither. Usage: node fix-acceptor.mjs <port> <store file>
// (credentials from TB_FIX_USER / TB_FIX_PASS). Prints "ready" and "got <n>"; never a field.
import { createAcceptor } from '../../../host/fix/session.mjs';
import { openStore } from '../../../host/fix/store.mjs';

const [port, file] = process.argv.slice(2), store = openStore(file);
store.db.exec('CREATE TABLE IF NOT EXISTS got (id TEXT NOT NULL)');
const add = store.db.prepare('INSERT INTO got VALUES (?)'), n = store.db.prepare('SELECT COUNT(*) AS n FROM got');
const a = createAcceptor({ port: +port, compId: 'TB-BROKER', store, auth: (u, p) => u === process.env.TB_FIX_USER && p === process.env.TB_FIX_PASS,
  onApp: m => { if (m.type === 'D') { add.run(m.fields.get('11')); console.log('got ' + n.get().n); } } });
a.ready.then(() => console.log('ready'));
