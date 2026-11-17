#!/usr/bin/env node
/* UX findings register (skill ux-xx, phase "Independent verification"): takes the verifiers' files .mace/ux/verify/*.json
   into .mace/ux/findings.json.      node tools/ux-register.mjs [--dry]
   - an entry whose `from` names a register id (UX-3) updates that entry; one whose `from` ids are exactly those of a registered entry
     updates it too; anything else gets the next id. Ids are never reused or renumbered.
   - `dropped` entries are not registered; they stay in the verifier's file as the trail.
   - .mace/ux/verify/related.json (optional): [["L3-2","L1-2","L1-7"], …] groups of lens ids that describe one cause; each
     registered entry of a group lists the others in `related`. */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const UX = join(dirname(fileURLToPath(import.meta.url)), '..', '.mace/ux'), DRY = process.argv.includes('--dry');
const reg = JSON.parse(readFileSync(join(UX, 'findings.json'), 'utf8')), today = new Date().toISOString().slice(0, 10);
const files = readdirSync(join(UX, 'verify')).filter(f => f.endsWith('.json') && f !== 'related.json').sort();
const ORDER = { S1: 0, S2: 1, S3: 2, S4: 3 }, incoming = [];
for (const f of files) { const j = JSON.parse(readFileSync(join(UX, 'verify', f), 'utf8')); for (const e of Array.isArray(j) ? j : j.entries) incoming.push({ ...e, file: f }); }
incoming.sort((a, b) => (a.status === 'confirmed' ? 0 : 1) - (b.status === 'confirmed' ? 0 : 1) || ORDER[a.severity] - ORDER[b.severity] || a.file.localeCompare(b.file));
let added = 0, updated = 0, skipped = 0, merged = 0;
for (const e of incoming) {
  if (e.status === 'dropped') { skipped++; continue; }
  const from = (e.from || []).map(String), uxRef = from.find(x => /^UX-\d+$/.test(x)), lensIds = from.filter(x => !/^UX-\d+$/.test(x));
  // a duplicate of a finding another lens already has (the verifier names it in `decision`): no entry of its own, the other one gets the lens and the note
  const dup = e.status === 'known' && !uxRef ? ((e.decision || '').match(/\b(UX-\d+|L\d-\d+)\b/g) || []).map(id => reg.findings.find(x => x.id === id || (x.from || []).includes(id))).find(Boolean) : null;
  if (dup) { dup.lens = [...new Set((dup.lens + ', ' + e.lens).split(/,\s*/))].join(', '); dup.seenAlso = [...new Set([...(dup.seenAlso || []), ...lensIds])]; if (e.verifierNote) dup.verifierNote = [dup.verifierNote, lensIds.join('+') + ': ' + e.verifierNote].filter(Boolean).join(' · '); dup.lastSeen = today; merged++; continue; }
  let cur = uxRef ? reg.findings.find(x => x.id === uxRef) : reg.findings.find(x => lensIds.length && (x.from || []).length === lensIds.length && lensIds.every(i => x.from.includes(i)));
  const fields = { title: e.title, lot: e.lot, control: e.control, lens: e.lens, severity: e.severity, verdict: e.verdict, where: e.where, expected: e.expected, happened: e.happened, evidence: e.evidence, steps: e.steps, suggestion: e.suggestion, status: e.status, decision: e.decision || '', verifierNote: e.verifierNote || '' };
  if (cur) {
    if (uxRef && e.status === 'known') { // another lens met a registered finding: keep the entry, add the lens and what it saw
      cur.lens = [...new Set((cur.lens + ', ' + e.lens).split(/,\s*/))].join(', '); cur.seenAlso = [...new Set([...(cur.seenAlso || []), ...lensIds])];
      if (e.verifierNote) cur.verifierNote = [cur.verifierNote, e.verifierNote].filter(Boolean).join(' · ');
      if (cur.status === 'new') cur.status = 'confirmed';
    } else Object.assign(cur, fields, { lens: uxRef ? [...new Set((cur.lens + ', ' + e.lens).split(/,\s*/).filter(x => x !== 'baleiaj' || !e.lens))].join(', ') : e.lens });
    cur.from = [...new Set([...(cur.from || []), ...lensIds])]; cur.lastSeen = today; updated++;
  } else { reg.findings.push({ id: 'UX-' + reg.next++, ...fields, from: lensIds, firstSeen: today, lastSeen: today, test: '' }); added++; }
}
const relFile = join(UX, 'verify', 'related.json');
if (existsSync(relFile)) for (const group of JSON.parse(readFileSync(relFile, 'utf8'))) {
  const ids = [...new Set(reg.findings.filter(x => (x.from || []).some(i => group.includes(i)) || group.includes(x.id)).map(x => x.id))];
  for (const x of reg.findings) if (ids.includes(x.id)) x.related = [...new Set([...(x.related || []), ...ids.filter(i => i !== x.id)])];
}
const count = (f) => reg.findings.filter(f).length, sev = s => count(x => x.status === 'confirmed' && x.severity === s);
console.log(`${files.length} verifier files · ${incoming.length} entries · added ${added} · updated ${updated} · merged into another finding ${merged} · dropped (not registered) ${skipped}`);
console.log(`register: ${reg.findings.length} findings · confirmed ${count(x => x.status === 'confirmed')} (S1 ${sev('S1')} · S2 ${sev('S2')} · S3 ${sev('S3')} · S4 ${sev('S4')}) · known ${count(x => x.status === 'known')} · declined ${count(x => x.status === 'declined')} · new ${count(x => x.status === 'new')}`);
if (!DRY) writeFileSync(join(UX, 'findings.json'), JSON.stringify(reg, null, 1));
