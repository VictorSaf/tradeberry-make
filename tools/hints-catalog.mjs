#!/usr/bin/env node
/* Catalogue of the hint cards (T13, 16.11.2026): docs/hints-catalog.md, built from .mace/hints/audit-<state>.json (no browser).
     node tools/hints-catalog.mjs            writes docs/hints-catalog.md and .mace/hints/audit-summary.md (the table, the totals, the 10 worst states)
   Run  node tools/hint-audit.mjs --all  first: this reads what the audit wrote. Plain text only (the audit stores each card with the tags removed). */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..'), DIR = join(ROOT, '.mace/hints');
const OWNER = { shell: 'T1', market: 'T2-T4 (opted out)', ticket: 'T3', dock: 'T4 (opted out)', monitor: 'T5', research: 'T6', observatory: 'T7 (3-6), T8 (7-10), T9 (11-12 and the frame)', lab: 'T10', coach: 'T11', misc: 'T12' };
const esc = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = s => '`' + String(s ?? '').replace(/`/g, "'") + '`';
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const place = k => { const p = String(k || '').split('>'); return p.slice(-3).join(' > '); };

// the states in the order of the audit (lots and their states): the audit prints them with --list
const order = []; { const r = spawnSync('node', [join(ROOT, 'tools/hint-audit.mjs'), '--list'], { encoding: 'utf8' }); for (const line of r.stdout.split('\n')) { const m = line.match(/^(\S+)\s+(.*)$/); if (m) for (const id of m[2].split(', ')) order.push({ lot: m[1], id: id.trim() }); } }
const recs = new Map();
for (const f of await readdir(DIR)) if (/^audit-.+\.json$/.test(f) && !f.startsWith('audit-baseline') && !f.startsWith('audit-summary')) { const r = JSON.parse(await readFile(join(DIR, f), 'utf8')); if (r.state) recs.set(r.state, r); }
const optouts = JSON.parse(await readFile(new URL('../hints-optouts.json', import.meta.url), 'utf8'));
const lots = [...new Set(order.map(o => o.lot))];
const states = order.filter(o => recs.has(o.id)).map(o => recs.get(o.id));
const missing = order.filter(o => !recs.has(o.id)).map(o => o.id);
const live = states.filter(r => !r.unreachable), dead = states.filter(r => r.unreachable);
const T = live.reduce((a, r) => { for (const k of ['elements', 'card', 'generic', 'optout', 'miss']) a[k] += r.counts[k]; return a; }, { elements: 0, card: 0, generic: 0, optout: 0, miss: 0 });
const when = new Date().toISOString().slice(0, 10);

// ---- docs/hints-catalog.md ----
const L = [];
L.push('# Hint cards: catalogue', '',
  `Generated ${when} by tools/hints-catalog.mjs from the audit files (.mace/hints/audit-<state>.json, written by tools/hint-audit.mjs). Do not edit by hand.`, '',
  'Every state of the app is a section; each section lists, for every element the audit found, the plain text of its hint card. A card the audit marks "generic" is the old fallback text of the engine and counts as a miss. Elements opted out by Victor have no card, by decision.', '',
  `Totals: ${live.length} states reached, ${T.elements} elements: ${T.card} with a card, ${T.generic} generic, ${T.optout} opted out, ${T.miss} misses.${dead.length ? ` Unreachable: ${dead.map(r => r.state).join(', ')}.` : ''}`, '');
L.push('| Lot | States |', '|---|---|'); for (const l of lots) L.push(`| ${l} | ${order.filter(o => o.lot === l).map(o => `[${o.id}](#${o.id})`).join(', ')} |`); L.push('');
for (const l of lots) {
  L.push(`## Lot ${l}`, '');
  for (const o of order.filter(x => x.lot === l)) {
    const r = recs.get(o.id); L.push(`### ${o.id}`, '');
    if (!r) { L.push('Not in the last audit run.', ''); continue; }
    if (r.unreachable) { L.push(`Unreachable: ${r.unreachable}`, ''); continue; }
    const c = r.counts;
    L.push(`${r.name ? `Page: ${r.name}. ` : ''}${c.elements} elements: ${c.card} with a card, ${c.generic} generic, ${c.optout} opted out, ${c.miss} misses.${r.problems && r.problems.length ? ` Page errors: ${r.problems.length}.` : ''}`, '');
    const ms = (r.elements || []).filter(e => e.state === 'miss' || e.state === 'generic');
    if (ms.length) { L.push('**Misses**', '', '| Element | Place | Kind | Why |', '|---|---|---|---|'); for (const e of ms) L.push(`| ${esc(short(e.label, 60)) || '(no text)'} | ${code(short(place(e.key), 90))} | ${e.kind} | ${e.state === 'generic' ? 'generic card' : 'no card'} |`); L.push(''); }
    const cs = (r.elements || []).filter(e => e.state === 'card');
    if (cs.length) { L.push('| Element | Place | Kind | Card title | Card text |', '|---|---|---|---|---|'); for (const e of cs) L.push(`| ${esc(short(e.label, 60)) || '(no text)'} | ${code(short(place(e.via || e.key), 80))} | ${e.kind} | ${esc(e.title)} | ${esc(e.card)} |`); L.push(''); }
    const os = (r.elements || []).filter(e => e.state === 'optout');
    if (os.length) {
      const g = new Map(); for (const e of os) { const k = e.optSel || '[data-hx-off]'; if (!g.has(k)) g.set(k, []); g.get(k).push(e); }
      L.push('**Opted out**', '', '| Selector | Elements | Examples |', '|---|---|---|');
      for (const [k, v] of [...g].sort((a, b) => b[1].length - a[1].length)) { const ex = [...new Set(v.map(e => e.label).filter(Boolean))].slice(0, 6).map(x => short(x, 28)); L.push(`| ${code(k)} | ${v.length} | ${esc(ex.join('; '))} |`); }
      L.push('');
    }
  }
}
const idn = new Map();
for (const r of live) for (const d of r.identicalCards || []) { const k = d.card; if (!idn.has(k)) idn.set(k, []); idn.get(k).push({ state: r.state, n: d.n, els: d.elements }); }
L.push('## Identical card texts', '', 'Cards whose title and text read the same on different elements of one state (figures included). Worth a look: a card should say what its own element is.', '');
if (idn.size) { L.push('| Card (title, text) | State | Elements | Examples |', '|---|---|---|---|'); for (const [k, v] of idn) for (const x of v) L.push(`| ${esc(short(k, 220))} | ${x.state} | ${x.n} | ${esc(x.els.map(e => short(e.split('@')[0], 24)).join('; '))} |`); } else L.push('None.');
L.push('', '## Opt-outs', '', `From hints-optouts.json. ${esc(optouts.about)}`, '', '| Selector | What | Why |', '|---|---|---|');
for (const o of optouts.optouts) L.push(`| ${code(o.selector)} | ${esc(o.what)} | ${esc(o.why)} |`);
L.push('');
await writeFile(join(ROOT, 'docs/hints-catalog.md'), L.join('\n'));

// ---- .mace/hints/audit-summary.md ----
const S = [`# Hint audit: summary (${when})`, '', `node tools/hint-audit.mjs --all, desktop layout (1220 px), the source. Per state: elements, with a card, generic, opted out, miss. Catalogue: docs/hints-catalog.md.`, '',
  '| State | Lot | Elements | Card | Generic | Opt-out | Miss |', '|---|---|---:|---:|---:|---:|---:|'];
for (const r of live) S.push(`| ${r.state} | ${r.lot} | ${r.counts.elements} | ${r.counts.card} | ${r.counts.generic} | ${r.counts.optout} | ${r.counts.miss} |`);
S.push(`| **Total (${live.length} states)** | | ${T.elements} | ${T.card} | ${T.generic} | ${T.optout} | ${T.miss} |`, '');
S.push('## Unreachable states', '');
if (dead.length || missing.length) for (const r of dead) S.push(`- ${r.state}: ${r.unreachable}`); else S.push('None: every state of --all was reached.');
for (const id of missing) S.push(`- ${id}: no audit file (not run)`);
S.push('', '## Removed from --all (cannot exist in this build)', '', '- dock-account: there is no Account tab in the dock.', '- pop-account-figures: #acctMore exists only in the phone layout (under 1081 px).', '');
const worst = live.filter(r => r.counts.miss + r.counts.generic > 0).sort((a, b) => (b.counts.miss + b.counts.generic) - (a.counts.miss + a.counts.generic)).slice(0, 10);
S.push('## The 10 worst states (misses + generic)', '', '| State | Miss | Generic | Elements | Owner |', '|---|---:|---:|---:|---|');
for (const r of worst) S.push(`| ${r.state} | ${r.counts.miss} | ${r.counts.generic} | ${r.counts.elements} | ${OWNER[r.lot] || ''} |`);
if (!worst.length) S.push('| none | | | | |');
S.push('', '## Misses by zone owner', '');
for (const l of lots) { const rs = live.filter(r => r.lot === l && r.counts.miss + r.counts.generic > 0); if (!rs.length) continue; S.push(`- ${l} (${OWNER[l]}): ${rs.map(r => `${r.state} ${r.counts.miss + r.counts.generic}`).join(', ')}`); }
const ids = live.filter(r => r.identicalCards && r.identicalCards.length); if (ids.length) S.push('', `Identical card texts on different elements: ${ids.map(r => `${r.state} ${r.identicalCards.length}`).join(', ')} (see the last sections of the catalogue).`);
const pe = live.filter(r => r.problems && r.problems.length); if (pe.length) S.push('', `Page errors: ${pe.map(r => `${r.state} ${r.problems.length}`).join(', ')}.`);
S.push('');
await writeFile(join(DIR, 'audit-summary.md'), S.join('\n'));
console.log(`catalogue: ${live.length} states, ${T.elements} elements, ${T.miss + T.generic} misses; docs/hints-catalog.md + .mace/hints/audit-summary.md`);
