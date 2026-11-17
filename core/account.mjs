// Node entry of the account core: runs the same classic script the browser loads (core/account.js) in a function
// scope of this realm, so the rules stay in one file. Usage: AccountCore.create({ market, rng, now }).
import { readFileSync } from 'node:fs';
import { runInThisContext } from 'node:vm';
const url = new URL('./account.js', import.meta.url);
export const AccountCore = runInThisContext('(function () {' + readFileSync(url, 'utf8') + '\n;return AccountCore;\n})()', { filename: url.pathname });
