#!/usr/bin/env node
/* tradeBerry tester accounts (the live database on the Mac mini, over ssh; see tools/tbdb.mjs). Run from 2-cod-sursa:
     node tools/tb-user.mjs add <username>        create an account; asks for the password (or --generate)
                                                  --shared: a login for several people, each browser with its own portfolio
     node tools/tb-user.mjs passwd <username>     set a new password and sign the user out everywhere
     node tools/tb-user.mjs disable <username>    block sign-in (account and saved state are kept)
     node tools/tb-user.mjs enable <username>
     node tools/tb-user.mjs logout <username>     end every session of the user
     node tools/tb-user.mjs admin <username>      make the user an administrator (Administration screen in the app)
     node tools/tb-user.mjs unadmin <username>    take the administrator role away
     node tools/tb-user.mjs modules <username> [research,lab,coach]   the modules beyond Trade and Monitor the user
                                                  may open (none: close them all); the app reads them at its next load
     node tools/tb-user.mjs reset <username>      erase the saved account state on the server (asks first)
     node tools/tb-user.mjs delete <username>     delete the user and their saved state (asks first); their broker
                                                  accounts are archived (gw_accounts closed, kept with the broker's
                                                  data) and never given to a new user with the same id
     node tools/tb-user.mjs list
   Add --local to work on the local database of `npm run dev:server` instead of the live one.
   The password never leaves this machine: only its PBKDF2-SHA256 hash (100,000 iterations, 16-byte salt; the same
   parameters as server/auth.js) is sent to the database. */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { target, opener } from './tbdb.mjs';

const ITER = 100000, USER_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/;
const args = process.argv.slice(2), flags = new Set(args.filter(a => a.startsWith('--'))), [cmd, rawUser] = args.filter(a => !a.startsWith('--'));
const where = target(flags);
const die = m => { console.error(m); process.exit(1); };

const sql = await opener(where);
const q = s => "'" + String(s).replace(/'/g, "''") + "'";

function ask(prompt, hidden) {
  return new Promise(res => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) rl._writeToOutput = s => { if (s.includes(prompt)) rl.output.write(prompt); };
    rl.question(prompt, a => { rl.close(); if (hidden) process.stdout.write('\n'); res(a); });
  });
}
async function newPassword() {
  if (flags.has('--generate')) {
    const p = randomBytes(12).toString('base64url');
    console.log(`Generated password (give it to the tester; it is not stored anywhere): ${p}`);
    return p;
  }
  const a = await ask('Password (min 8 characters): ', true);
  if (a.length < 8) die('Too short: use at least 8 characters (or --generate).');
  if (a.length > 256) die('Too long.');
  const b = await ask('Repeat the password: ', true);
  if (a !== b) die('The two passwords differ.');
  return a;
}
const hashOf = p => { const salt = randomBytes(16).toString('hex'); return { salt, hash: pbkdf2Sync(p, Buffer.from(salt, 'hex'), ITER, 32, 'sha256').toString('hex') }; };

const user = rawUser ? rawUser.trim().toLowerCase() : '';
if (cmd !== 'list' && !USER_RE.test(user)) die('Username: 2–32 characters, lowercase letters, digits, dot, dash or underscore, starting with a letter or digit.');
const t = Math.floor(Date.now() / 1000);
const exists = () => sql(`SELECT id FROM users WHERE username = ${q(user)}`, true).length > 0;

switch (cmd) {
  case 'add': {
    if (exists()) die(`User ${user} already exists (use passwd to change the password).`);
    const { salt, hash } = hashOf(await newPassword());
    const sh = flags.has('--shared') ? 1 : 0;
    sql(`INSERT INTO users (username, salt, hash, iter, disabled, created_at, shared) VALUES (${q(user)}, ${q(salt)}, ${q(hash)}, ${ITER}, 0, ${t}, ${sh})`);
    console.log(`Created ${user}${sh ? ' (shared: each browser keeps its own portfolio)' : ''}. Sign-in: https://tb.oneaigency.com`);
    break;
  }
  case 'passwd': {
    if (!exists()) die(`No user ${user}.`);
    const { salt, hash } = hashOf(await newPassword());
    sql(`UPDATE users SET salt = ${q(salt)}, hash = ${q(hash)}, iter = ${ITER} WHERE username = ${q(user)}; DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${q(user)})`);
    console.log(`Password changed for ${user}; their open sessions were ended.`);
    break;
  }
  case 'disable': case 'enable': {
    if (!exists()) die(`No user ${user}.`);
    sql(`UPDATE users SET disabled = ${cmd === 'disable' ? 1 : 0} WHERE username = ${q(user)}` + (cmd === 'disable' ? `; DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${q(user)})` : ''));
    console.log(`${user} ${cmd}d.`);
    break;
  }
  case 'logout': {
    sql(`DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE username = ${q(user)})`);
    console.log(`Sessions of ${user} ended.`);
    break;
  }
  case 'admin': case 'unadmin': {
    if (!exists()) die(`No user ${user}.`);
    sql(`UPDATE users SET admin = ${cmd === 'admin' ? 1 : 0} WHERE username = ${q(user)}`);
    console.log(cmd === 'admin' ? `${user} is an administrator (Account menu → Administration).` : `${user} is no longer an administrator.`);
    break;
  }
  case 'modules': {
    if (!exists()) die(`No user ${user}.`);
    const MODS = ['research', 'lab', 'coach'], want = (process.argv.slice(2).filter(a => !a.startsWith('--'))[2] || '').split(',').filter(Boolean);
    if (want.some(m => !MODS.includes(m))) die(`Modules: a comma list of ${MODS.join(', ')} (or nothing to close them all).`);
    sql(`UPDATE users SET modules = ${q(MODS.filter(m => want.includes(m)).join(','))} WHERE username = ${q(user)}`);
    console.log(`${user}: ${want.length ? MODS.filter(m => want.includes(m)).join(', ') : 'Trade and Monitor only'} (from their next page load).`);
    break;
  }
  case 'reset': case 'delete': {
    if (!exists()) die(`No user ${user}.`);
    const a = await ask(`${cmd === 'delete' ? 'Delete user ' + user + ' and their saved account' : 'Erase the saved account of ' + user} on ${where.label} database? Type the username to confirm: `);
    if (a.trim().toLowerCase() !== user) die('Not confirmed; nothing changed.');
    const id = `(SELECT id FROM users WHERE username = ${q(user)})`;
    // the broker accounts: closed and kept (migrations/0009_gw_accounts_owner.sql), as functions/api/admin.js delete
    const gw = cmd === 'delete' && sql("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'gw_live'", true).length
      ? `UPDATE gw_accounts SET closed_at = ${t} WHERE user_id = ${id} AND closed_at IS NULL; DELETE FROM gw_live WHERE user_id = ${id}; ` : '';
    sql(cmd === 'delete' ? gw + `DELETE FROM dstate WHERE user_id = ${id}; DELETE FROM lease WHERE user_id = ${id}; DELETE FROM state WHERE user_id = ${id}; DELETE FROM sessions WHERE user_id = ${id}; DELETE FROM users WHERE username = ${q(user)}` : `DELETE FROM state WHERE user_id = ${id}; DELETE FROM dstate WHERE user_id = ${id}`);
    console.log(cmd === 'delete' ? `Deleted ${user}${gw ? ' (their broker accounts are archived)' : ''}.` : `Saved account of ${user} erased; their browsers keep a local copy until they sign in again (it is then replaced only if they made no changes).`);
    break;
  }
  case 'list': {
    const rows = sql(`SELECT u.username, u.disabled, u.shared, u.admin, u.created_at, (SELECT COUNT(*) FROM dstate d WHERE d.user_id = u.id) AS browsers, s.rev, s.saved_at, length(s.data) AS bytes, (SELECT COUNT(*) FROM sessions x WHERE x.user_id = u.id AND x.expires_at > ${t}) AS sessions FROM users u LEFT JOIN state s ON s.user_id = u.id ORDER BY u.username`, true);
    if (!rows.length) { console.log('No users yet.'); break; }
    const d = v => v ? new Date(v * 1000).toISOString().slice(0, 16).replace('T', ' ') : '—';
    console.table(rows.map(r => ({ user: r.username, type: (r.shared ? `shared (${r.browsers} browsers)` : 'personal') + (r.admin ? ', admin' : ''), status: r.disabled ? 'disabled' : 'active', created: d(r.created_at), 'last saved': d(r.saved_at), saves: r.rev || 0, size: r.bytes ? Math.round(r.bytes / 1000) + ' KB' : '—', sessions: r.sessions })));
    break;
  }
  default:
    die('Commands: add, passwd, disable, enable, logout, admin, unadmin, modules, reset, delete, list (see the top of tools/tb-user.mjs).');
}
