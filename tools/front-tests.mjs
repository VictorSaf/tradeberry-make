/* The area tests for the uncommitted UI changes (tools/front-deploy.sh): reads `git diff -U0 HEAD`, takes the tokens it
   touches — ids and classes (CSS selectors, id="…", class="…"), and the functions named in the hunk headers — and picks
   every test (tests/*.mjs) whose code mentions one of them. Prints one line: the test ids (first word of each name),
   comma-separated, for node tests/run.mjs; an empty line when none match. --why lists token → tests on stderr. */
import { execSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';

const diff = execSync(`git diff -U0 ${process.env.FRONT_BASE || 'HEAD'} -- . ":(exclude)tests" ":(exclude)tools" ":(exclude).claude" ":(exclude)docs" ":(exclude).mace"`, { encoding: 'utf8', maxBuffer: 64 << 20 });
// too common to point at an area: they would pull in half the suite
const COMMON = new Set('buy sell pos ord count link pri static dock fff on off tbl tab pad small muted l r up dn hi md lo ok wn btn row col on active open hide show empty tag pill foot note wrap name val num px mono sm xs lg dim sep ticket panel tk3'.split(' '));
const tokens = new Set();
for (const line of diff.split('\n')) {
  const h = line.match(/^@@[^@]*@@\s*(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/); if (h) { tokens.add(h[1]); continue; }
  if (!/^[+-](?![+-])/.test(line)) continue;
  for (const m of line.matchAll(/(?:^|[\s,{>+~(])[#.]([a-zA-Z][\w-]{2,})(?=[\s,{:.#[>)+~]|$)/g)) tokens.add(m[1]);
  for (const m of line.matchAll(/\bid="([\w-]{3,})"/g)) tokens.add(m[1]);
  for (const m of line.matchAll(/\bclass="([^"$]+)"/g)) for (const c of m[1].split(/\s+/)) if (c.length > 2) tokens.add(c);
  for (const m of line.matchAll(/\bfunction\s+([A-Za-z_$][\w$]{3,})/g)) tokens.add(m[1]);
}
for (const c of COMMON) tokens.delete(c);

const dir = new URL('../tests/', import.meta.url), ids = new Set(), why = [];
for (const f of (await readdir(dir)).filter(f => f.endsWith('.mjs') && f !== 'run.mjs').sort()) {
  let m; try { m = await import(new URL(f, dir)); } catch { continue; }
  const tests = m.tests || [], seen = new Set();
  for (const t of tests) {
    const src = String(t.run), hit = [...tokens].filter(k => src.includes(k));
    hit.forEach(k => seen.add(k));
    if (hit.length) { const id = t.name.split(' ')[0]; ids.add(id); why.push(`${id}: ${hit.join(' ')}`); }
  }
  // a token only in the file's helpers (e.g. W.edit in w0-app.mjs): every test of that file
  const text = await readFile(new URL(f, dir), 'utf8'), viaHelper = [...tokens].filter(k => !seen.has(k) && text.includes(k));
  if (viaHelper.length) for (const t of tests) { const id = t.name.split(' ')[0]; ids.add(id); why.push(`${id}: ${viaHelper.join(' ')} (helper in ${f})`); }
}
if (process.argv.includes('--why')) console.error(`tokens: ${[...tokens].join(' ') || '(none)'}\n${why.join('\n') || 'no test mentions them'}`);
console.log([...ids].map(i => i + ' ').join(','));   // "M1 ": the id as a word, so it does not also pick M10, M11…
