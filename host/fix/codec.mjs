// FIX 4.4 tag=value codec: encode() builds a wire message (computing 9 and 10); Parser turns a TCP byte stream into
// messages. Wire text is latin1 so one char is one byte (BodyLength and CheckSum count bytes). No data fields (95/96)
// are supported: the first "\x0110=ddd\x01" always ends a message. Credentials never pass through here to a log.
import { BEGIN_STRING, GROUPS } from './dict.mjs';

export const SOH = '\x01';
const PREFIX = `8=${BEGIN_STRING}${SOH}9=`, MAX = 1 << 20; // a message past 1 MB without a trailer is junk
const cks = s => { let n = 0; for (let i = 0; i < s.length; i++) n += s.charCodeAt(i); return String(n % 256).padStart(3, '0'); };

// encode('A', [[98, 0], [108, 30]], { sender, target, seq, sendingTime, possDup?, origSendingTime? }) -> Buffer
export function encode(msgType, fields, h) {
  let body = `35=${msgType}${SOH}49=${h.sender}${SOH}56=${h.target}${SOH}34=${h.seq}${SOH}`;
  if (h.possDup) body += `43=Y${SOH}`;
  body += `52=${h.sendingTime}${SOH}`;
  if (h.origSendingTime) body += `122=${h.origSendingTime}${SOH}`;
  for (const [t, v] of fields) {
    const s = String(v);
    if (s.includes(SOH)) throw new Error(`FIX field ${t} contains SOH`);
    for (let i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0xFF) throw new Error(`FIX field ${t} has a character outside latin1`); // never truncate silently
    body += `${t}=${s}${SOH}`;
  }
  const msg = `${PREFIX}${Buffer.byteLength(body, 'latin1')}${SOH}${body}`;
  return Buffer.from(msg + `10=${cks(msg)}${SOH}`, 'latin1');
}

// Stream parser. push(buf) -> messages completed by these bytes: { type, seq, fields: Map<tag string, value | value[]>,
// groups: Map<count tag, Map[]>, raw } or { error: 'checksum' | 'bodylength' | 'format', raw }. Bad messages are consumed
// whole so the stream resyncs on the next one.
export class Parser {
  constructor() { this.buf = ''; }
  push(chunk) {
    this.buf += Buffer.isBuffer(chunk) ? chunk.toString('latin1') : String(chunk);
    const out = [];
    for (;;) {
      const s = this.buf.indexOf(PREFIX);
      if (s < 0) { this.buf = this.buf.slice(Math.max(0, this.buf.length - PREFIX.length + 1)); break; } // keep a possible partial prefix
      if (s > 0) this.buf = this.buf.slice(s);
      const bl = this.buf.indexOf(SOH, PREFIX.length);
      if (bl < 0) { if (this.buf.length > 32) { out.push(this.bad('format', 1)); continue; } break; }
      const start = bl + 1, declared = this.buf.slice(PREFIX.length, bl);
      const t = this.buf.indexOf(SOH + '10=', bl); // the SOH ending the last body field
      if (t < 0) { if (this.buf.length > MAX) { out.push(this.bad('format', 1)); continue; } break; }
      const e = this.buf.indexOf(SOH, t + 4); // the trailer ends at its own SOH, so a malformed one eats nothing of the next message
      if (e < 0) { if (this.buf.length > t + 64) { out.push(this.bad('format', 1)); continue; } break; } // "10=...\x01" not here yet
      const end = e + 1, raw = Buffer.from(this.buf.slice(0, end), 'latin1'), tail = this.buf.slice(t + 1, end);
      this.buf = this.buf.slice(end);
      if (!/^\d+$/.test(declared) || +declared !== t + 1 - start) { out.push({ error: 'bodylength', raw }); continue; }
      if (!/^10=\d{3}\x01$/.test(tail) || tail.slice(3, 6) !== cks(raw.toString('latin1', 0, t + 1))) { out.push({ error: 'checksum', raw }); continue; }
      out.push(parse(raw.toString('latin1', 0, t + 1), tail.slice(3, 6), raw));
    }
    return out;
  }
  bad(error, skip) { const raw = Buffer.from(this.buf.slice(0, skip), 'latin1'); this.buf = this.buf.slice(skip); return { error, raw }; }
}

function parse(text, sum, raw) {
  const pairs = text.slice(0, -1).split(SOH), fields = new Map(), groups = new Map(), list = [];
  for (const p of pairs) {
    const i = p.indexOf('=');
    if (i < 1 || !/^\d+$/.test(p.slice(0, i))) return { error: 'format', raw };
    list.push([p.slice(0, i), p.slice(i + 1)]);
  }
  for (const [t, v] of list) {
    const o = fields.get(t);
    fields.set(t, o === undefined ? v : Array.isArray(o) ? (o.push(v), o) : [o, v]);
  }
  fields.set('10', sum);
  const type = fields.get('35'), seq = +fields.get('34');
  if (typeof type !== 'string' || !type || !Number.isInteger(seq) || list[2]?.[0] !== '35') return { error: 'format', raw };
  // repeating groups: after the count tag, entries start at the group's first member and take members until a stranger
  for (let i = 0; i < list.length; i++) {
    const mem = GROUPS[list[i][0]]; if (!mem) continue;
    const n = +list[i][1], set = new Set(mem.map(String)), first = String(mem[0]), entries = [];
    let cur = null, j = i + 1;
    for (; j < list.length && set.has(list[j][0]); j++) {
      if (list[j][0] === first) entries.push(cur = new Map());
      if (!cur) break;
      const o = cur.get(list[j][0]); cur.set(list[j][0], o === undefined ? list[j][1] : [].concat(o, list[j][1]));
    }
    if (entries.length !== n) return { error: 'format', raw };
    groups.set(list[i][0], entries); i = j - 1;
  }
  return { type, seq, fields, groups, raw };
}
