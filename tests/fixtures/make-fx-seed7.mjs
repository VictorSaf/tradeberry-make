// Regenerates fx-seed7.json: the FX market of ?seed=7 under the pinned clock of run.mjs, external fetches blocked.
// v15 (Engine.VERSION 2, the catalog: 15 currencies, starting levels from the platform snapshot) builds another
// market than v14, so the v14 reference (commit 39d78e6) was retired and this was rerun on VERSION 2. The multi-asset
// test MA5 checks that the 16 G8 paths stay bit-identical: a determinism regression (seed + clock + catalog); any change
// that moves it must bump Engine.VERSION and rerun this. Usage: node tests/fixtures/make-fx-seed7.mjs (writes next to it).
import http from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const HERE = dirname(fileURLToPath(import.meta.url)), ROOT = join(HERE, '..', '..');
const server = http.createServer(async (req, res) => {
  const path = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  if (path.startsWith('..')) { res.writeHead(403).end(); return; }
  try { res.writeHead(200, { 'content-type': path.endsWith('.js') ? 'text/javascript' : 'text/html' }).end(await readFile(join(ROOT, path))); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const ctx = await browser.newContext({ serviceWorkers: 'block' });
await ctx.route(u => !u.href.startsWith(BASE), r => r.abort());
const page = await ctx.newPage();
await page.clock.setFixedTime(new Date('2026-10-16T10:30:00Z')); // FIXED in tests/run.mjs
await page.goto(BASE + '/tests/engine.html?seed=7');
const out = await page.evaluate(async () => {
  await Engine.init();
  const syms = Engine.PAIRS.map(p => p.sym);
  const hist = Object.fromEntries(syms.map(s => [s, Engine.candles[s].slice(-200).map(c => c.close)]));
  const t0 = Engine.simTime;
  Engine.speed = 60;
  for (let i = 0; i < 300; i++) Engine.tick(250);
  const after = Object.fromEntries(syms.map(s => [s, Engine.candles[s].slice(-30).map(c => [c.time, c.open, c.high, c.low, c.close])]));
  return { ev: Engine.VERSION, seed: Engine.seed, clock: '2026-10-16T10:30:00Z', source: Engine.source, t0, t1: Engine.simTime, regime: Engine.regime, hist, after,
    bids: syms.map(s => Engine.quote(s).bid) };
});
await writeFile(join(HERE, 'fx-seed7.json'), JSON.stringify(out) + '\n');
console.log('wrote fx-seed7.json', out.source, out.t0, Object.keys(out.hist).length, 'pairs');
await browser.close(); server.close();
