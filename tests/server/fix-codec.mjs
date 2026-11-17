// host/fix/codec.mjs: FIX 4.4 tag=value encoder and stream parser. FC1 compares against a hand-computed reference
// (BodyLength 63, CheckSum 068, worked out independently of the encoder). Usage, from 2-cod-sursa:
// node tests/server/fix-codec.mjs (also run by tests/server/run.mjs).
import { encode, Parser, SOH } from '../../host/fix/codec.mjs';
import { MSG, TAG } from '../../host/fix/dict.mjs';

let pass = 0, fail = 0;
const ok = (v, msg) => { if (v) pass++; else { fail++; console.log('  FAIL', msg); } };
const S = s => Buffer.from(s.replaceAll('|', '\x01'), 'latin1');
const sum = s => [...Buffer.from(s, 'latin1')].reduce((a, b) => a + b, 0) % 256;
// reference Logon: body = 35=A|49=TB|56=BROKER|34=1|52=20261102-09:30:00.000|98=0|108=30| is 63 bytes; checksum 068
const REF = '8=FIX.4.4|9=63|35=A|49=TB|56=BROKER|34=1|52=20261102-09:30:00.000|98=0|108=30|10=068|';
const HDR = { sender: 'TB', target: 'BROKER', seq: 1, sendingTime: '20261102-09:30:00.000' };
const mk = (type, fields, seq) => encode(type, fields, { ...HDR, seq });

// FC1: octet by octet
{
  ok(MSG.A === 'Logon' && TAG.CheckSum === 10 && TAG.NoPositions === 702, 'dict names the Logon and the tags');
  const b = encode('A', [[98, 0], [108, 30]], HDR);
  ok(Buffer.isBuffer(b) && b.equals(S(REF)), 'FC1 Logon is the reference, byte for byte: ' + JSON.stringify(b.toString('latin1')));
  // the same arithmetic done here on the reference string, so a typo in the literal is caught
  const body = REF.slice(REF.indexOf('|35=') + 1, REF.indexOf('10=068')).replaceAll('|', '\x01');
  ok(body.length === 63 && sum('8=FIX.4.4\x019=63\x01' + body) === 68, 'FC1 the reference literal is self-consistent');
  const p = new Parser().push(b);
  ok(p.length === 1 && p[0].type === 'A' && p[0].seq === 1 && p[0].fields.get('108') === '30' && p[0].raw.equals(b), 'FC1 round trip');
  const pd = encode('0', [], { ...HDR, seq: 7, possDup: true, origSendingTime: '20261102-09:29:00.000' }).toString('latin1');
  ok(/\x0143=Y\x01/.test(pd) && /\x01122=20261102-09:29:00\.000\x01/.test(pd), 'PossDup sets 43=Y and 122');
  const m = new Parser().push(mk('0', [], 3).subarray(0)); ok(m[0].fields.get('9') !== undefined && m[0].fields.get('10').length === 3, 'header and trailer tags are in fields');
}
// FC2: one message cut in 3 network chunks
{
  const b = mk('D', [[11, 'tb-1-1'], [55, 'EURUSD'], [54, 1], [38, 0.1], [40, 1]], 5), p = new Parser(), out = [];
  const a = 17, c = b.length - 9;
  for (const part of [b.subarray(0, a), b.subarray(a, c), b.subarray(c)]) { const r = p.push(part); out.push(r.length); }
  ok(out.join() === '0,0,1', 'FC2 cut in 3 pieces comes out whole, only on the last: ' + out);
  const q = new Parser(), got = []; for (const byte of b) got.push(...q.push(Buffer.from([byte])));
  ok(got.length === 1 && got[0].fields.get('55') === 'EURUSD', 'FC2 byte by byte');
}
// FC3: two glued messages, and one more arriving cut
{
  const a = mk('0', [], 2), b = mk('1', [[112, 'ping']], 3), c = mk('0', [], 4), p = new Parser();
  const r = p.push(Buffer.concat([a, b, c.subarray(0, 10)]));
  ok(r.length === 2 && r[0].seq === 2 && r[1].type === '1' && r[1].fields.get('112') === 'ping', 'FC3 two glued messages come out as two');
  const r2 = p.push(c.subarray(10)); ok(r2.length === 1 && r2[0].seq === 4, 'FC3 the cut third one completes');
  const g = new Parser().push(Buffer.concat([Buffer.from('noise\x01junk'), a])); ok(g.length === 1 && g[0].seq === 2, 'garbage before 8=FIX.4.4 is skipped');
}
// FC4: wrong checksum
{
  const b = Buffer.from(mk('0', [], 2)); b[b.length - 2] = b[b.length - 2] === 0x39 ? 0x30 : b[b.length - 2] + 1; // last checksum digit (the char before the final SOH)
  const p = new Parser(), r = p.push(Buffer.concat([b, mk('0', [], 3)]));
  ok(r.length === 2 && r[0].error === 'checksum' && Buffer.isBuffer(r[0].raw), 'FC4 wrong checksum gives error: checksum');
  ok(r[1].type === '0' && r[1].seq === 3 && !r[1].error, 'FC4 the next message still parses');
}
// FC5: wrong BodyLength
{
  const good = mk('0', [], 2).toString('latin1');
  const bad = Buffer.from(good.replace(/\x019=\d+\x01/, m => '\x019=' + (+m.slice(3, -1) + 5) + '\x01'), 'latin1');
  const r = new Parser().push(Buffer.concat([bad, mk('0', [], 3)]));
  ok(r[0]?.error === 'bodylength' && r[0].raw.length === bad.length, 'FC5 wrong BodyLength gives error: bodylength');
  ok(r[1]?.seq === 3 && !r[1].error, 'FC5 the next message still parses');
}
// FC6: PositionReport with two 702 entries
{
  const b = mk('AP', [[721, 'P1'], [55, 'EURUSD'], [702, 2], [703, 'TQ'], [704, 1.5], [705, 0], [703, 'SQ'], [704, 0], [705, 2.5], [753, 1], [707, 'FPNL'], [708, 12.5]], 9);
  const [m] = new Parser().push(b), g = m.groups.get('702');
  ok(g?.length === 2 && g[0].get('703') === 'TQ' && g[1].get('704') === '0' && g[1].get('705') === '2.5', 'FC6 702 gives a group of 2: ' + JSON.stringify(g && g.map(x => [...x])));
  ok(m.groups.get('753')?.length === 1 && m.groups.get('753')[0].get('708') === '12.5', 'FC6 753 group alongside');
  ok(m.fields.get('55') === 'EURUSD' && Array.isArray(m.fields.get('703')) && m.fields.get('703').length === 2, 'FC6 repeated tags are arrays in fields');
  const rel = new Parser().push(mk('AN', [[146, 2], [55, 'EURUSD'], [55, 'GOLD'], [263, 1]], 10))[0];
  ok(rel.groups.get('146').length === 2 && rel.fields.get('263') === '1', 'FC6 146 NoRelatedSym');
}
// malformed trailer eats only itself; non-latin1 text is refused
{
  const good = mk('0', [], 4), cut = Buffer.from(mk('0', [], 3).toString('latin1').replace(/10=\d{3}\x01$/, '10=12\x01'), 'latin1');
  const r = new Parser().push(Buffer.concat([cut, good]));
  ok(r.length === 2 && r[0].error && r[1].seq === 4 && !r[1].error, 'malformed trailer 10=12: one error, then the valid message: ' + r.map(x => x.error || x.seq));
  for (const ch of ['ș', '€']) { let t = false; try { mk('3', [[58, 'x' + ch]], 1); } catch (e) { t = true; } ok(t, 'encode refuses ' + ch + ' in tag 58'); }
  ok(mk('3', [[58, 'caf\xe9']], 1).includes(0xe9), 'latin1 chars still encode');
}
// malformed bodies
{
  const body = '49=AB\x01'; // 6 bytes, no 35
  const m = '8=FIX.4.4\x019=6\x01' + body, raw = Buffer.from(m + '10=' + String(sum(m)).padStart(3, '0') + '\x01', 'latin1');
  const r = new Parser().push(raw); ok(r[0]?.error === 'format', 'a message without 35 is a format error');
  ok(new Parser().push(Buffer.from('8=FIX.4.2\x019=0\x0110=000\x01')).length === 0, 'another BeginString is skipped, not taken for 4.4');
}
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
