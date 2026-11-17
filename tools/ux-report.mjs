#!/usr/bin/env node
/* UX report (skill ux-xx, phase "The report"): .mace/ux/findings.json → .mace/ux/RAPORT-<date>.md
     node tools/ux-report.mjs [--date 2026-11-10]
   The hand-written parts come from .mace/ux/report-notes-<date>.md: sections separated by lines "<!-- intro -->" and
   "<!-- outro -->"; in them {L2-7} or {UX-12} is replaced by the register id (with its title on request: {L2-7:t}). */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const UX = join(dirname(fileURLToPath(import.meta.url)), '..', '.mace/ux');
const di = process.argv.indexOf('--date'), date = di < 0 ? new Date().toISOString().slice(0, 10) : process.argv[di + 1];
const reg = JSON.parse(readFileSync(join(UX, 'findings.json'), 'utf8')), F = reg.findings;
const byRef = r => F.find(x => x.id === r || (x.from || []).includes(r) || (x.seenAlso || []).includes(r));
const fill = t => t.replace(/\{((?:UX|L\d)-\d+)(:t)?\}/g, (_, r, t) => { const f = byRef(r); return f ? (t ? `${f.id} (${f.title})` : f.id) : r + '?'; });
const notesFile = join(UX, `report-notes-${date}.md`), notes = existsSync(notesFile) ? readFileSync(notesFile, 'utf8') : '';
const part = n => fill(((notes.split(`<!-- ${n} -->`)[1] || '').split(/<!-- \w+ -->/)[0] || '').trim());
const conf = F.filter(x => x.status === 'confirmed'), sev = s => conf.filter(x => x.severity === s);
const cell = s => String(s || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim();
const src = f => [...(f.from || []), ...(f.seenAlso || [])].join(', ') || '—';
const full = f => [`### ${f.id} · ${f.severity} · ${f.verdict} · ${f.title}`, `- **Unde:** ${cell(f.where)} · lot ${f.lot} · \`${cell(f.control)}\``, `- **Așteptat:** ${cell(f.expected)}`, `- **S-a întâmplat:** ${cell(f.happened)}`, `- **Pași:** ${cell(f.steps)}`, `- **Sugestie:** ${cell(f.suggestion) || '—'}`, f.decision ? `- **Decizie / context:** ${cell(f.decision)}` : '', `- **Dovadă:** ${cell(f.evidence)}`, f.verifierNote ? `- **Verificator:** ${cell(f.verifierNote)}` : '', `- **Lentile:** ${f.lens} (${src(f)})${f.related && f.related.length ? ' · înrudite: ' + f.related.join(', ') : ''}`].filter(Boolean).join('\n');
const row = f => `| ${f.id} | ${f.verdict} | ${f.lot} | ${cell(f.title)} | ${cell(f.suggestion).slice(0, 160)} | ${f.lens} |`;
const out = [];
out.push(`# Test UX/UI tradeBerry · desktop · ${date}`, '');
out.push(part('intro'), '');
out.push('## Cifrele rulării', '', '| Stare | Total | S1 | S2 | S3 | S4 |', '|---|---|---|---|---|---|');
for (const st of ['confirmed', 'known', 'declined']) { const a = F.filter(x => x.status === st); out.push(`| ${{ confirmed: 'Confirmate', known: 'Deja cunoscute, încă prezente', declined: 'Respinse (decizie existentă)' }[st]} | ${a.length} | ${['S1', 'S2', 'S3', 'S4'].map(s => a.filter(x => x.severity === s).length).join(' | ')} |`); }
const lots = [...new Set(conf.map(x => x.lot))].sort((a, b) => conf.filter(x => x.lot === b).length - conf.filter(x => x.lot === a).length);
out.push('', '| Lot | Confirmate | S1 | S2 | S3 | S4 |', '|---|---|---|---|---|---|');
for (const l of lots) { const a = conf.filter(x => x.lot === l); out.push(`| ${l} | ${a.length} | ${['S1', 'S2', 'S3', 'S4'].map(s => a.filter(x => x.severity === s).length).join(' | ')} |`); }
out.push('', part('causes'), '');
out.push('## S1 · bani și risc', '', ...sev('S1').map(f => full(f) + '\n'));
out.push('## S2 · sarcina nu se poate termina sau se înțelege greșit', '', ...sev('S2').map(f => full(f) + '\n'));
out.push('## S3 · fricțiune', '', '| ID | Verdict | Lot | Ce e greșit | Sugestie | Lentile |', '|---|---|---|---|---|---|', ...sev('S3').map(row), '');
out.push('## S4 · finisaj și cereri de produs', '', '| ID | Verdict | Lot | Ce e greșit | Sugestie | Lentile |', '|---|---|---|---|---|---|', ...sev('S4').map(row), '');
out.push('## Deja cunoscute din audituri, încă prezente', '', '| ID | Sev. | Lot | Ce e | Sursa |', '|---|---|---|---|---|', ...F.filter(x => x.status === 'known').map(f => `| ${f.id} | ${f.severity} | ${f.lot} | ${cell(f.title)} | ${cell(f.decision)} |`), '');
const dec = F.filter(x => x.status === 'declined'); if (dec.length) out.push('## Respinse', '', ...dec.map(f => `- **${f.id}** ${cell(f.title)}: ${cell(f.decision || f.verifierNote)}`), '');
out.push(part('outro'), '');
const file = join(UX, `RAPORT-${date}.md`); writeFileSync(file, out.join('\n'));
console.log(file, '·', out.join('\n').split('\n').length, 'lines ·', conf.length, 'confirmed');
