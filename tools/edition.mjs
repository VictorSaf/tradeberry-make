#!/usr/bin/env node
/* tradeBerry · the Opening Note's edition of the day, written with Claude Code (CLI, the administrator's own
   subscription; no API key) and stored in the live database (tools/tbdb.mjs; the job runs on the Mac mini).
     node tools/edition.mjs              write today's edition now (replaces it if there is one)
     node tools/edition.mjs --if-needed  write it only if today has none yet or an administrator asked for a new one
                                         (Account → the Opening Note's "New edition ↻"); what the scheduled job runs
     node tools/edition.mjs --dry        write it and print it, store nothing
   Claude picks the photograph itself on Unsplash (web search); the script checks that the image answers before it
   keeps it. One edition per UTC day for everyone. Log lines go to stdout. */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { target, opener } from './tbdb.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Set(process.argv.slice(2)), DRY = flags.has('--dry');
const CLAUDE = process.env.TB_CLAUDE || join(process.env.HOME, '.local/bin/claude');
const log = m => console.log(`${new Date().toISOString()} ${m}`);
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
const db = await opener(target(flags)), sql = c => db(c, /^\s*SELECT/i.test(c)); // on the Mac mini the job sets TB_DB to the live file

const day = new Date().toISOString().slice(0, 10);
if (flags.has('--if-needed')) {
  const [t] = sql(`SELECT (SELECT COUNT(*) FROM editions WHERE day = ${q(day)} AND status = 'ready') AS have, (SELECT COUNT(*) FROM edition_req WHERE day = ${q(day)}) AS asked`);
  if (t.have && !t.asked) process.exit(0);
  log(t.asked ? 'a new edition was asked for' : 'no edition yet today');
}

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['kicker', 'title', 'body', 'quote', 'quoteBy', 'theme', 'photo'],
  properties: {
    kicker: { type: 'string', description: 'Topic label beside "Opening note", 1-3 words (e.g. Market history, Trading psychology, Risk)' },
    title: { type: 'string', description: 'Memorable headline, at most 8 words, ending with a full stop' },
    body: { type: 'string', description: '2-3 sentences, 35-60 words, plain English' },
    quote: { type: 'string', description: 'The line to remember: a real quotation or a question to the reader, at most 25 words, no quotation marks' },
    quoteBy: { type: 'string', description: 'Author of a real quotation (name only); empty string for a question' },
    theme: { type: 'string', description: 'One word for the theme' },
    photo: {
      type: 'object', additionalProperties: false, required: ['image', 'page', 'by', 'byUrl'],
      properties: {
        image: { type: 'string', description: 'Direct image URL on images.unsplash.com (https://images.unsplash.com/photo-...)' },
        page: { type: 'string', description: 'The photo page on unsplash.com' },
        by: { type: 'string', description: "Photographer's name as shown on Unsplash" },
        byUrl: { type: 'string', description: "Photographer's Unsplash profile URL" }
      }
    }
  }
};

const rows = sql("SELECT day, data FROM editions WHERE status = 'ready' ORDER BY day DESC LIMIT 30");
const past = rows.map(r => { try { return { day: r.day, ...JSON.parse(r.data) }; } catch (e) { return null; } }).filter(Boolean);
const recent = past.map(e => `${e.day}: ${e.title} | ${e.theme} | ${e.quoteBy || 'question'} | ${e.photo && e.photo.image || ''}`).join('\n') || 'none yet';
const long = new Intl.DateTimeFormat('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(day + 'T12:00:00Z'));

const PROMPT = `You write the Opening Note of tradeBerry, a trading terminal: one short editorial per day that every trader sees when they open the app, set like a poster over a black-and-white photograph. It must be memorable and worth the 20 seconds.

Today is ${long}.

Pick one of: a famous market quotation (Livermore, Buffett, Soros, Keynes, Graham, Taleb, Dalio, Marks, Tudor Jones and others), a market event that happened on this calendar date in history, a lesson of trading psychology, or a principle of risk. Vary the kind and the theme; never repeat a recent title, quotation, theme or photograph.

Rules:
- Facts must be real and well documented; check dates and wording with web search when in doubt. A historical event only if its date is confirmed. Never invent quotations or attribute words someone did not say; when the exact wording cannot be confirmed, write a question to the reader and leave quoteBy empty.
- No trading signals, no predictions, no advice to buy or sell anything, no promises of profit.
- Calm, confident, precise; English; no emojis, hashtags or exclamation marks. The body leads into the quote: the quote is the line the reader keeps.
- The photograph: find one on Unsplash (unsplash.com) that suits today's message as a strong landscape-format poster background (it is shown in black and white, on the right two thirds of the screen): a concrete scene, no readable text, no logos, no close-up faces. Give its direct images.unsplash.com URL, its unsplash.com page, and the photographer's name and profile URL exactly as Unsplash shows them.

Recent editions (day: title | theme | quote author | photo) - do not repeat:
${recent}`;

const work = mkdtempSync(join(tmpdir(), 'tb-edition-'));
let e;
try {
  log('writing with Claude Code…');
  const r = spawnSync(CLAUDE, ['-p', PROMPT, '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA), '--allowedTools', 'WebSearch', 'WebFetch'], { cwd: work, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 15 * 60 * 1000 });
  if (r.status !== 0) throw new Error('claude exited ' + r.status + ': ' + (r.stderr || '').slice(0, 400));
  const out = JSON.parse(r.stdout);
  if (out.is_error || !out.structured_output) throw new Error('no structured output: ' + String(out.result || out.subtype).slice(0, 300));
  e = out.structured_output;
  log(`cost $${(+out.total_cost_usd || 0).toFixed(2)} (subscription), ${out.num_turns} turns`);
} finally { rmSync(work, { recursive: true, force: true }); }

for (const k of SCHEMA.required) if (k !== 'photo' && typeof e[k] !== 'string') throw new Error('missing ' + k);
// keep the photograph only if it is a real Unsplash image that answers
let photo = null;
try {
  const p = e.photo || {}, u = new URL(p.image);
  if (u.hostname === 'images.unsplash.com') {
    u.searchParams.set('w', '1800'); u.searchParams.set('q', '86'); u.searchParams.set('fm', 'jpg'); u.searchParams.set('fit', 'max'); u.searchParams.set('crop', 'entropy');
    const res = await fetch(u, { method: 'HEAD' });
    if (res.ok && (res.headers.get('content-type') || '').startsWith('image/')) {
      const utm = 'utm_source=tradeberry&utm_medium=referral', add = s => /^https:\/\/unsplash\.com\//.test(s) ? s + (s.includes('?') ? '&' : '?') + utm : 'https://unsplash.com/?' + utm;
      photo = { url: u.href, by: String(p.by || 'Unsplash').slice(0, 80), link: add(p.byUrl), page: add(p.page) };
    } else log('photo does not answer: ' + res.status);
  } else log('photo not on images.unsplash.com: ' + u.hostname);
} catch (err) { log('photo rejected: ' + err.message); }
const edition = { kicker: e.kicker, title: e.title, body: e.body, quote: e.quote, quoteBy: e.quoteBy, theme: e.theme, photo, by: 'claude-code' };
if (DRY) { console.log(JSON.stringify(edition, null, 2)); process.exit(0); }

const [c] = sql(`SELECT COUNT(*) AS c FROM editions WHERE status = 'ready' AND day <> ${q(day)}`);
const t = Math.floor(Date.now() / 1000);
sql(`INSERT INTO editions (day, n, data, status, created_at) VALUES (${q(day)}, ${(c.c | 0) + 1}, ${q(JSON.stringify(edition))}, 'ready', ${t}) ON CONFLICT(day) DO UPDATE SET n = excluded.n, data = excluded.data, status = 'ready', created_at = excluded.created_at; DELETE FROM edition_req WHERE day <= ${q(day)}`);
log(`edition ${(c.c | 0) + 1} stored: ${edition.title}${photo ? ' · photo by ' + photo.by : ' · built-in photo'}`);
