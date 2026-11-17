// tradeBerry build: minify + bundle into dist/ (source files stay the source of truth)
// usage: node build.mjs   (needs esbuild: npm i -D esbuild)
import { transform } from 'esbuild';
import fs from 'fs';
import crypto from 'crypto';
const CORE = ['catalog', 'engine', 'livefeed', 'shared', 'app', 'trade', 'chart', 'ticket', 'panels', 'challenge', 'replay', 'persist', 'cloud', 'pro', 'brief', 'draw', 'mc', 'behav', 'mnav', 'pwa', 'gestures', 'ui', 'shell', 'demo', 'fit', 'opening'];
const TOOLS = ['bt', 'obs', 'basket', 'itime', 'lab'];
const VENDOR = ['vendor/lightweight-charts-5.2.1.js']; // local scripts that stay separate files
const STATIC_HTML = ['opening-note.html', 'accent-system.html'];
// fail loudly instead of shipping a bundle that silently misses a module
const fail = msg => { console.error('build failed: ' + msg); process.exit(1); };
for (const f of [...CORE, ...TOOLS]) if (!fs.existsSync(f + '.js')) fail(`${f}.js is listed in CORE/TOOLS but does not exist`);
for (const f of VENDOR) if (!fs.existsSync(f)) fail(`${f} is listed in VENDOR but does not exist`);
for (const f of STATIC_HTML) if (!fs.existsSync(f)) fail(`${f} is listed in STATIC_HTML but does not exist`);
let html = fs.readFileSync('index.html', 'utf8');
// every local <script src> must belong to a list, and the CORE tags must be exactly CORE, in order, one block
const srcs = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(m => m[1]).filter(u => !/^(https?:)?\/\//.test(u));
const known = new Set([...CORE, ...TOOLS].map(f => f + '.js').concat(VENDOR));
const stray = srcs.filter(u => !known.has(u));
if (stray.length) fail(`index.html loads local scripts that are in no list (CORE/TOOLS/VENDOR in build.mjs): ${stray.join(', ')}`);
const coreIn = srcs.filter(u => CORE.includes(u.replace(/\.js$/, '')));
if (coreIn.join() !== CORE.map(f => f + '.js').join()) fail(`CORE script tags in index.html (${coreIn.join(', ')}) do not match CORE in build.mjs (${CORE.join(', ')})`);
const block = CORE.map(f => `<script src="${f}.js"></script>\n`).join('');
if (html.split(block).length !== 2) fail('the CORE <script> tags in index.html must be one consecutive block, one per line, exactly as listed in CORE');
const hash = s => crypto.createHash('sha1').update(s).digest('hex').slice(0, 8);
const js = async files => (await transform(files.map(f => fs.readFileSync(f + '.js', 'utf8')).join('\n;\n'), { minify: true, target: 'es2020', legalComments: 'none' })).code;
fs.rmSync('dist', { recursive: true, force: true }); fs.mkdirSync('dist');
const core = await js(CORE), tools = await js(TOOLS);
const css = (await transform(fs.readFileSync('styles.css', 'utf8'), { loader: 'css', minify: true, target: ['chrome100', 'safari15', 'firefox100'] })).code;
const n = { core: `core.${hash(core)}.js`, tools: `tools.${hash(tools)}.js`, css: `styles.${hash(css)}.css` };
fs.writeFileSync('dist/' + n.core, core); fs.writeFileSync('dist/' + n.tools, tools); fs.writeFileSync('dist/' + n.css, css);
html = html.replace('<link rel="stylesheet" href="styles.css">', `<link rel="stylesheet" href="${n.css}">`);
html = html.replace(block, `<script>window.MFX_LAZY=['${n.tools}']</script>\n<script src="${n.core}"></script>\n`);
if (/<script src="(?!vendor\/|core\.)[^"]+\.js"/.test(html)) fail('a local <script src> survived the CORE replacement');
const BUILD_SW = hash(core + tools + css + html);
for (const f of fs.readdirSync('.')) if (/^(manifest\.webmanifest|sw\.js|icons|vendor)$/.test(f)) fs.cpSync(f, 'dist/' + f, { recursive: true });
for (const f of STATIC_HTML) fs.copyFileSync(f, 'dist/' + f);
if (fs.existsSync('dist/sw.js')) fs.writeFileSync('dist/sw.js', fs.readFileSync('dist/sw.js', 'utf8').replace(/\/\*A\*\/.*?\/\*A\*\//, JSON.stringify(['./', n.core, n.tools, n.css])).replace(/\/\*V\*\/.*?\/\*V\*\//, JSON.stringify(BUILD_SW)));
const BUILD = BUILD_SW;
html = html.replace('<script>window.MFX_LAZY=', `<script>window.MFX_BUILD='${BUILD}';window.MFX_LAZY=`);
fs.writeFileSync('dist/index.html', html);
const kb = f => (fs.statSync('dist/' + f).size / 1024).toFixed(1) + ' KB';
console.log('core', kb(n.core), '| tools', kb(n.tools), '| css', kb(n.css), '| html', kb('index.html'));
