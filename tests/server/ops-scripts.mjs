// tools/cutover.sh, host/deploy.sh and tools/rollback.sh run against a FAKE Mac mini: ssh, rsync, launchctl, curl, nc,
// npm and sleep are shims (tests' own PATH) that run the "remote" commands here, with HOME in a throwaway folder, and
// log every call; node, sqlite3 and the migrations are real. Nothing reaches the real Mac mini (TB_MINI=fake-mini, and
// the ssh shim never opens a connection).
//   S1 deploy.sh refuses a mini without the execution services: "run tools/cutover.sh first", nothing copied
//   S2 cutover.sh order: freeze → web restart → migrate → verify → unfreeze → broker → gateway (linked) ; refuses a 2nd run
//   S3 cutover.sh stops at a migration refusal: no broker/gateway installed, blobs stay frozen
//   S4 deploy.sh restarts the broker / the gateway only when their code changed, and waits for the gateway's link
//   S5 rollback.sh refuses a ref with the gateway; goes back to a pre-v16 ref: services removed, freeze lifted, old app
// Usage, from 2-cod-sursa: node tests/server/ops-scripts.mjs
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, chmodSync, appendFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ROOT = process.cwd(), T = mkdtempSync(join(tmpdir(), 'tb-opsx-')), BIN = join(T, 'bin'), LOG = join(T, 'calls.log');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  FAIL', m); } };
mkdirSync(BIN);
const shim = (name, body) => { const f = join(BIN, name); writeFileSync(f, `#!/bin/zsh\nprint -r -- "${name} $*" >> "$TB_T_LOG"\n${body}\n`); chmodSync(f, 0o755); };
// ssh [-o x]… host command…: the command runs here under zsh, HOME = the fake mini
shim('ssh', `while [[ "$1" == -* ]]; do [[ "$1" == -o ]] && shift; shift; done; shift; HOME="$TB_T_MINI" exec /bin/zsh -c "$*"`);
shim('rsync', `a=(); for x in "$@"; do if [[ "$x" == fake-mini:* ]]; then a+=("$TB_T_MINI/\${x#fake-mini:}"); else a+=("$x"); fi; done; exec /usr/bin/rsync "\${a[@]}"`);
// launchctl: bootstrap/kickstart of the gateway writes its "linked" line (as host/gateway.mjs logs it once linked)
shim('launchctl', `L="$TB_T_MINI/tradeberry/logs/gateway.log"
case "$1" in
  print) exit 1;;
  bootstrap|kickstart) [[ "$*" == *tradeberry-gateway* ]] && print -r -- "$(date -u +%FT%TZ) gateway: linked to the broker, mirror rebuilt" >> "$L";;
esac; exit 0`);
for (const n of ['curl', 'nc', 'npm', 'sleep']) shim(n, 'exit 0');
const calls = () => existsSync(LOG) ? readFileSync(LOG, 'utf8').split('\n').filter(Boolean) : [];
const idx = (re, from = 0) => calls().findIndex((l, i) => i >= from && re.test(l));

// a source tree (2/) next to its published app (1-aplicatie-publicabila/), as on the dev Mac
function tree(name) {
  const S = join(T, name, '2'), A = join(T, name, '1-aplicatie-publicabila');
  mkdirSync(S, { recursive: true }); mkdirSync(A, { recursive: true });
  execFileSync('/usr/bin/rsync', ['-a', '--exclude', 'node_modules', '--exclude', '.DS_Store', 'host', 'tools', 'functions', 'server', 'migrations', 'core', 'catalog.js', 'engine.js', 'app.js', 'trade.js', 'challenge.js', 'package.json', S + '/'], { cwd: ROOT });
  writeFileSync(join(A, 'index.html'), "<script>var MFX_BUILD = 'v16-test';</script>");
  return S;
}
// a fake mini, its database at the schema before the execution server (0005), with users and blobs
function mini(name, blobs) {
  const M = join(T, name), D = join(M, 'tradeberry', 'data');
  for (const d of ['app', 'code', 'data', 'logs', 'backups']) mkdirSync(join(M, 'tradeberry', d), { recursive: true });
  mkdirSync(join(M, 'Library', 'LaunchAgents'), { recursive: true });
  writeFileSync(join(M, 'tradeberry', 'env'), 'LEGACY_API_KEY=x\n');
  const old = join(T, name + '-m5'); mkdirSync(old);
  for (const f of readdirSync(join(ROOT, 'migrations')).filter(f => f < '0006')) writeFileSync(join(old, f), readFileSync(join(ROOT, 'migrations', f)));
  execFileSync(process.execPath, [join(ROOT, 'host/migrate.mjs'), join(D, 'tradeberry.db'), old], { stdio: 'pipe' });
  const db = new DatabaseSync(join(D, 'tradeberry.db'));
  db.prepare("INSERT INTO users (id, username, salt, hash, iter, created_at) VALUES (1, 'alice', '00', '00', 1, 1000)").run();
  for (const [uid, data] of blobs) db.prepare('INSERT INTO state (user_id, rev, data, market, saved_at) VALUES (?, 3, ?, NULL, 1793600000)').run(uid, data);
  db.close();
  return M;
}
const run = (script, cwd, M, args = [], extra = {}) => {
  writeFileSync(LOG, '');
  const r = spawnSync('/bin/zsh', [script, ...args], { cwd, encoding: 'utf8', env: { ...process.env, PATH: `${BIN}:${process.env.PATH}`, TB_MINI: 'fake-mini', TB_T_MINI: M, TB_T_LOG: LOG, TB_CUTOVER_WAIT: '0', ...extra } });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};
const sq = (M, sql) => { const d = new DatabaseSync(join(M, 'tradeberry/data/tradeberry.db')); try { return d.prepare(sql).all(); } finally { d.close(); } };
const LA = M => join(M, 'Library/LaunchAgents');

try {
  // S1
  {
    const S = tree('t1'), M = mini('m1', []);
    const r = run('host/deploy.sh', S, M);
    ok(r.code !== 0 && /run tools\/cutover\.sh first/.test(r.out) && idx(/^npm |^rsync /) < 0, 'S1 deploy.sh refuses a mini without the execution server, before copying anything: ' + r.out.trim());
  }
  // S2
  const S = tree('t2'), M = mini('m2', []);
  {
    const r = run('tools/cutover.sh', S, M);
    ok(r.code === 0 && /cut-over done/.test(r.out), 'S2 cut-over runs through: ' + r.out.trim().split('\n').slice(-4).join(' | '));
    const freeze = idx(/^ssh .*INSERT OR REPLACE INTO ops_flags/), web = idx(/^launchctl kickstart -k gui\/\d+\/com\.victor\.tradeberry$/), mig = idx(/^ssh .*migrate-accounts\.mjs$/), ver = idx(/^ssh .*migrate-accounts\.mjs --verify/),
      thaw = idx(/^ssh .*DELETE FROM ops_flags/), br = idx(/^launchctl bootstrap .*tradeberry-broker/), gw = idx(/^launchctl bootstrap .*tradeberry-gateway/), schema = idx(/^ssh .*host\/migrate\.mjs/);
    ok(schema >= 0 && schema < freeze && freeze < web && web < mig && mig < ver && ver < thaw && thaw < br && br < gw, `S2 order: schema ${schema} < freeze ${freeze} < web ${web} < migrate ${mig} < verify ${ver} < unfreeze ${thaw} < broker ${br} < gateway ${gw}`);
    ok(!sq(M, "SELECT 1 FROM ops_flags WHERE k = 'state_frozen'").length, 'S2 the freeze is lifted at the end');
    ok(existsSync(join(LA(M), 'com.victor.tradeberry-broker.plist')) && existsSync(join(LA(M), 'com.victor.tradeberry-gateway.plist')), 'S2 both services installed');
    ok(existsSync(join(M, 'tradeberry/exec-broker.sha')) && existsSync(join(M, 'tradeberry/exec-gateway.sha')), 'S2 the running code is stamped');
    const env = readFileSync(join(M, 'tradeberry/env'), 'utf8');
    ok(['TB_FIX_USER', 'TB_FIX_PASS', 'TB_GW_SECRET'].every(k => new RegExp('^' + k + '=[0-9a-f]{48}$', 'm').test(env)) && !/[0-9a-f]{48}/.test(r.out), 'S2 the secrets are made on the mini and never printed');
    ok(['engine.js', 'app.js', 'trade.js', 'challenge.js', 'core/account.js'].every(f => existsSync(join(M, 'tradeberry/code', f))), 'S2 the loader files of tools/migrate-accounts.mjs are copied');
    ok(readdirSync(join(M, 'tradeberry/backups')).some(f => /^precutover-.*-tradeberry\.db\.gz$/.test(f)), 'S2 a snapshot before the migration');
    const again = run('tools/cutover.sh', S, M);
    ok(again.code !== 0 && /cut-over was done/.test(again.out) && idx(/^npm /) < 0, 'S2 a second cut-over is refused, before anything: ' + again.out.trim());
  }
  // S3
  {
    const S3 = tree('t3'), M3 = mini('m3', [[1, 'not json at all']]);
    const r = run('tools/cutover.sh', S3, M3);
    ok(r.code !== 0 && /CUT-OVER STOPPED: tools\/migrate-accounts\.mjs/.test(r.out), 'S3 a refused account stops the cut-over: ' + r.out.trim().split('\n').slice(-2).join(' | '));
    ok(idx(/^launchctl bootstrap/) < 0 && !existsSync(join(LA(M3), 'com.victor.tradeberry-broker.plist')), 'S3 neither the broker nor the gateway is installed');
    ok(sq(M3, "SELECT 1 FROM ops_flags WHERE k = 'state_frozen'").length === 1, 'S3 the blobs stay frozen');
    const d = run('host/deploy.sh', S3, M3);
    ok(d.code !== 0 && /cutover\.sh first/.test(d.out), 'S3 and a normal deploy is still refused');
  }
  // S4
  {
    let r = run('host/deploy.sh', S, M);
    ok(r.code === 0 && /broker: code unchanged/.test(r.out) && /gateway: code unchanged/.test(r.out) && idx(/^launchctl kickstart .*tradeberry-(broker|gateway)/) < 0 && idx(/^launchctl kickstart -k gui\/\d+\/com\.victor\.tradeberry$/) >= 0, 'S4 nothing of the execution server changed: only the web server restarts: ' + r.out.trim().split('\n').slice(-3).join(' | '));
    appendFileSync(join(S, 'host/gateway/db.mjs'), '\n// changed\n');
    r = run('host/deploy.sh', S, M);
    ok(r.code === 0 && idx(/^launchctl kickstart .*tradeberry-gateway/) >= 0 && idx(/^launchctl kickstart .*tradeberry-broker/) < 0 && /restarted and linked/.test(r.out), 'S4 the gateway code changed: the gateway alone restarts, and links: ' + r.out.trim().split('\n').slice(-3).join(' | '));
    appendFileSync(join(S, 'core/account.js'), '\n// changed\n');
    r = run('host/deploy.sh', S, M);
    const b = idx(/^launchctl kickstart .*tradeberry-broker/), g = idx(/^launchctl kickstart .*tradeberry-gateway/);
    ok(r.code === 0 && b >= 0 && g > b, 'S4 the shared core changed: the broker, then the gateway');
    // a gateway that never links: the deploy fails and the stamp stays old, so the next deploy restarts it again
    writeFileSync(join(BIN, 'launchctl'), `#!/bin/zsh\nprint -r -- "launchctl $*" >> "$TB_T_LOG"\nexit 0\n`);
    const before = readFileSync(join(M, 'tradeberry/exec-gateway.sha'), 'utf8');
    appendFileSync(join(S, 'host/gateway.mjs'), '\n// changed\n');
    r = run('host/deploy.sh', S, M);
    ok(r.code !== 0 && /did not link/.test(r.out) && readFileSync(join(M, 'tradeberry/exec-gateway.sha'), 'utf8') === before, 'S4 no "linked" line: the deploy fails, the stamp is not moved');
  }
  // S5
  {
    let r = run('tools/rollback.sh', ROOT, M, ['HEAD', '--yes']);
    ok(r.code !== 0 && /already has the execution gateway/.test(r.out) && !calls().length, 'S5 a ref with the gateway is refused, before anything: ' + r.out.trim());
    r = run('tools/rollback.sh', ROOT, M, []);
    ok(r.code !== 0 && /usage/.test(r.out), 'S5 no ref: usage');
    // the commit that added the v16 spec: the last build before the execution server
    const pre = execFileSync('git', ['log', '--diff-filter=A', '--format=%H', '--', 'docs/superpowers/specs/2026-11-02-executie-server-fix44-design.md'], { cwd: ROOT, encoding: 'utf8' }).trim().split('\n').pop();
    const hasGw = spawnSync('git', ['cat-file', '-e', `${pre}:host/gateway.mjs`], { cwd: ROOT }).status === 0;
    if (hasGw) { console.log('  (S5 full rollback skipped: no pre-gateway commit found)'); }
    else {
      mkdirSync(join(M, 'tradeberry/code/host/node_modules/ws'), { recursive: true });
      sq(M, "INSERT OR REPLACE INTO ops_flags (k, v) VALUES ('state_frozen', 'test')");
      r = run('tools/rollback.sh', ROOT, M, [pre, '--yes']);
      ok(r.code === 0 && /rolled back/.test(r.out), 'S5 rollback to the pre-v16 ref runs through: ' + r.out.trim().split('\n').slice(-3).join(' | '));
      ok(!existsSync(join(LA(M), 'com.victor.tradeberry-broker.plist')) && !existsSync(join(LA(M), 'com.victor.tradeberry-gateway.plist')) && idx(/^launchctl bootout .*tradeberry-broker/) >= 0, 'S5 broker and gateway booted out and removed');
      ok(!existsSync(join(M, 'tradeberry/code/host/gateway.mjs')) && existsSync(join(M, 'tradeberry/code/host/server.mjs')) && existsSync(join(M, 'tradeberry/code/host/node_modules/ws')), 'S5 the old code is in place, the mini\'s node_modules kept');
      ok(!/v16-test/.test(readFileSync(join(M, 'tradeberry/app/index.html'), 'utf8')) && /MFX_BUILD/.test(readFileSync(join(M, 'tradeberry/app/index.html'), 'utf8')), 'S5 the old build is the app');
      ok(!sq(M, "SELECT 1 FROM ops_flags WHERE k = 'state_frozen'").length && existsSync(join(M, 'tradeberry/data/broker.db')), 'S5 the freeze lifted; broker.db kept');
      const d = run('host/deploy.sh', S, M);
      ok(d.code !== 0 && /cutover\.sh first/.test(d.out), 'S5 after a rollback, deploy.sh refuses a v16 deploy until the cut-over runs again');
      ok(!spawnSync('git', ['worktree', 'list'], { cwd: ROOT, encoding: 'utf8' }).stdout.includes('tb-rollback'), 'S5 the temporary worktree is gone');
    }
  }
} catch (e) { fail++; console.log('  ABORT', e.stack); } finally { rmSync(T, { recursive: true, force: true }); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
