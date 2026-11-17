// Node entry of the market core: runs the same classic scripts the browser loads (core/market.js, catalog.js), each in
// a function scope of this realm, so the logic stays in one file. Usage: MarketCore.create({ catalog: CATALOG, now }).
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
const load = (rel, name) => { const url = new URL(rel, import.meta.url); return runInThisContext('(function () {' + readFileSync(url, 'utf8') + '\n;return ' + name + ';\n})()', { filename: url.pathname }); };
export const MarketCore = load('./market.js', 'MarketCore');
export const CATALOG = load('../catalog.js', 'CATALOG');
