// Wave 1 · v1-colors: the Observatory draws with the semantic tokens only (contract C5). Constellation links sit on
// the diverging scale (--div-pos / --div-neg, never the P&L red/green), its legend is built from the same tokens,
// Tapestry folds on --up / --dn, so the colour-blind palette and the red-rises switch reach both; no hex in obs.js.
import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// in the page: canvas-normalised colour (so '#27c98340' and 'rgba(39, 201, 131, 0.25)' compare equal)
const HELP = () => {
  window.CV = {
    norm(c) { const g = document.createElement('canvas').getContext('2d'); g.fillStyle = '#000'; g.fillStyle = c; return g.fillStyle; },
    css(el, p) { return CV.norm(getComputedStyle(el)[p]); },
    look(palette, updn = 'green') { S.set.palette = palette; S.set.updn = updn; applyTheme(); },
    // every fillStyle a draw uses for fillRect, normalised
    fills(fn) {
      const P = CanvasRenderingContext2D.prototype, o = P.fillRect, seen = new Set();
      P.fillRect = function () { seen.add(String(this.fillStyle)); return o.apply(this, arguments); };
      try { fn(); } finally { P.fillRect = o; }
      return [...seen];
    },
    const() {
      obsCfg().view = 'const'; setTab('obs'); renderObs();
      const svg = document.querySelector('#constWrap svg'), side = document.getElementById('constSide');
      // each link: a wide transparent hit line and the drawn line, inside a group whose tip names ρ ('… · ρ 0.82|…')
      const edges = [...svg.querySelectorAll('g[data-tip] > line:not([stroke="transparent"])')].map(l => ({ r: +/ρ (-?[\d.]+)\|/.exec(l.parentNode.dataset.tip)[1], c: CV.norm(l.getAttribute('stroke')) }));
      const nodes = [...svg.querySelectorAll('.cnode circle')].map(c => CV.norm(c.getAttribute('fill')));
      const sw = [...side.querySelectorAll('[data-legend]')].map(i => ({ k: i.dataset.legend, c: CV.css(i, 'backgroundColor'), txt: i.parentElement.textContent }));
      return { edges, nodes, sw, text: side.textContent };
    },
    tap() {
      obsCfg().view = 'tap'; setTab('obs');
      const fills = CV.fills(() => renderObs()), body = document.getElementById('obsBody');
      const sw = [...body.querySelectorAll('[data-legend]')].map(i => ({ k: i.dataset.legend, c: CV.css(i, 'backgroundColor') }));
      return { fills, sw, text: body.textContent };
    },
    tok: n => CV.norm(cssv(n)),
    // the three band shades Tapestry is expected to use for a token
    bands: n => ['40', '90', 'e0'].map(a => CV.norm(cssv(n) + a))
  };
};

export const tests = [
  {
    name: 'V1C1 obs.js has no hard-coded hex colour (contract C5: tokens only)',
    async run({ t }) {
      const src = await readFile(join(ROOT, 'obs.js'), 'utf8');
      const hits = src.split('\n').map((l, i) => [i + 1, l.match(/#[0-9a-fA-F]{3,8}\b/g)]).filter(x => x[1]);
      t.eq(hits.length, 0, 'hex literals in obs.js: ' + hits.map(([n, m]) => `${n}:${m.join(',')}`).join(' '));
    }
  },
  {
    name: 'V1C2 Constellation: links on --div-pos / --div-neg by the sign of ρ, legend swatches match the links, no colour names',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        await loadLazy(); CV.look('std');
        return { ...CV.const(), pos: CV.tok('--div-pos'), neg: CV.tok('--div-neg'), up: CV.tok('--up'), dn: CV.tok('--dn') };
      });
      t.ok(r.edges.length >= 10, 'the tree has its links: ' + r.edges.length);
      for (const e of r.edges) t.eq(e.c, e.r >= 0 ? r.pos : r.neg, `link ρ=${e.r} colour`);
      t.ok(r.edges.every(e => e.c !== r.up && e.c !== r.dn), 'no link is drawn in the P&L colours');
      const lp = r.sw.find(s => s.k === 'pos'), ln = r.sw.find(s => s.k === 'neg');
      t.ok(lp && ln, 'legend has a swatch for each link sign: ' + JSON.stringify(r.sw));
      t.eq(lp.c, r.pos, 'legend "move together" swatch = positive-link colour');
      t.eq(ln.c, r.neg, 'legend "move opposite" swatch = negative-link colour');
      t.ok(/together/i.test(lp.txt) && /opposite/i.test(ln.txt), 'legend labels name the meaning: ' + lp.txt + ' / ' + ln.txt);
      t.ok(!/\b(green|red|blue|orange)\b/i.test(r.text), 'no colour named in the side panel (it would lie in another palette): ' + r.text.match(/.{0,40}\b(green|red|blue|orange)\b.{0,20}/i)?.[0]);
      t.noErrors(page);
    }
  },
  {
    name: 'V1C3 colour-blind palette: Constellation and Tapestry colours follow it and differ from the standard ones',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        await loadLazy();
        const out = {};
        for (const p of ['std', 'cvd']) {
          CV.look(p);
          out[p] = { c: CV.const(), tap: CV.tap(), up: CV.bands('--up'), dn: CV.bands('--dn'), upTok: CV.tok('--up'), dnTok: CV.tok('--dn'), pos: CV.tok('--div-pos'), neg: CV.tok('--div-neg') };
        }
        CV.look('std');
        return out;
      });
      for (const p of ['std', 'cvd']) {
        const o = r[p], f = new Set(o.tap.fills);
        t.ok(o.up.some(x => f.has(x)) && o.dn.some(x => f.has(x)), `${p}: Tapestry folds on --up and --dn bands (fills: ${o.tap.fills.slice(0, 8).join(' ')})`);
        const other = r[p === 'std' ? 'cvd' : 'std'];
        t.ok(![...other.up, ...other.dn].some(x => f.has(x)), `${p}: Tapestry uses none of the other palette's bands`);
        t.ok(o.c.nodes.length && o.c.nodes.every(x => x === o.upTok || x === o.dnTok), `${p}: node fills on --up / --dn`);
        for (const e of o.c.edges) t.eq(e.c, e.r >= 0 ? o.pos : o.neg, `${p}: link colour`);
        const lu = o.tap.sw.find(s => s.k === 'up'), ld = o.tap.sw.find(s => s.k === 'dn');
        t.ok(lu && ld, `${p}: Tapestry legend has up / down swatches`);
        t.eq(lu.c, o.upTok, `${p}: Tapestry "above" swatch = --up`);
        t.eq(ld.c, o.dnTok, `${p}: Tapestry "below" swatch = --dn`);
        t.ok(!/\b(green|red)\b/i.test(o.tap.text), `${p}: Tapestry text names no colour`);
      }
      t.ok(r.std.upTok !== r.cvd.upTok && r.std.dnTok !== r.cvd.dnTok, 'the palettes differ on --up / --dn');
      t.ok(r.cvd.c.nodes.every(x => x !== r.std.upTok && x !== r.std.dnTok), 'Constellation node colours differ between the standard and colour-blind palettes');
      t.noErrors(page);
    }
  },
  {
    name: 'V1C4 red-rises convention reaches Tapestry (the bands swap with --up / --dn)',
    async run({ t, app }) {
      const page = await app('', { clock: true });
      await page.evaluate(HELP);
      const r = await page.evaluate(async () => {
        await loadLazy(); CV.look('std', 'red');
        const o = { tap: CV.tap(), up: CV.bands('--up'), dn: CV.bands('--dn'), red: CV.norm(cssv('--c-r')) };
        CV.look('std', 'green');
        return o;
      });
      const f = new Set(r.tap.fills);
      t.ok(r.up.some(x => f.has(x)) && r.dn.some(x => f.has(x)), 'Tapestry follows the swapped tokens');
      t.ok(r.tap.sw.find(s => s.k === 'up')?.c === r.red, '"above" swatch is red under red-rises');
      t.noErrors(page);
    }
  }
];
