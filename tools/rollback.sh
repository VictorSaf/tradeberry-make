#!/bin/zsh
# tradeBerry: back from the execution server (v16) to a build from before it, where each browser runs its account.
# Run from 2-cod-sursa on the dev Mac:   zsh tools/rollback.sh <git ref> [--yes]     (TB_MINI: ssh host, default macmini)
#   e.g. zsh tools/rollback.sh mace-integration
#   1. the broker and the gateway stopped and their launchd services removed (host/deploy.sh then refuses to deploy
#      a v16 build until tools/cutover.sh runs again)
#   2. a snapshot of tradeberry.db and broker.db (~/tradeberry/backups/prerollback-<time>-*.db.gz)
#   3. the build of <ref> (git worktree in a temporary folder, this checkout's node_modules) copied to the mini: the app,
#      and functions server migrations host tools (+ core, catalog.js, engine.js… when the ref has them); the mini's
#      host/node_modules is kept; no migration is run (the v16 tables stay, unused by the old code)
#   4. the blob freeze lifted (ops_flags), the web server restarted on the old code, health check
# What the old build finds: each user's state blob as it was frozen at the cut-over (its account keys never written
# since; functions/api/state.js kept the execution settings of `set` too), plus the display preferences saved since.
# Everything traded on the execution server since the cut-over is NOT in the blobs: it stays in broker.db and the gw_*
# tables (kept, not deleted; tradeberry.db and broker.db belong together, see host/backup.sh).
set -e
cd "$(dirname "$0")/.."
MINI=${TB_MINI:-macmini}
REF=$1
LA='~/Library/LaunchAgents'
die() { echo "ROLLBACK STOPPED: $*" >&2; exit 1; }
[[ -n "$REF" && "$REF" != --* ]] || die "usage: zsh tools/rollback.sh <git ref> [--yes]   (the build to go back to, e.g. mace-integration)"
SHA=$(git rev-parse --verify --quiet "$REF^{commit}") || die "no commit $REF"
git cat-file -e "${SHA}:build.mjs" 2>/dev/null || die "$REF has no build.mjs"
if git cat-file -e "${SHA}:host/gateway.mjs" 2>/dev/null; then die "$REF already has the execution gateway (host/gateway.mjs): that is not a build from before the cut-over"; fi
if [[ "$2" != "--yes" ]]; then
  print "Roll $MINI back to $REF ($SHA)? Trades made on the execution server since the cut-over will not be in the accounts the"
  print -n "old build shows (they stay in broker.db). Type ROLLBACK to go on: "
  read -r a; [[ "$a" == ROLLBACK ]] || die "not confirmed; nothing changed"
fi

print "== 1. broker and gateway off and removed"
for s in gateway broker; do
  ssh "$MINI" "launchctl bootout gui/\$(id -u)/com.victor.tradeberry-$s 2>/dev/null; rm -f $LA/com.victor.tradeberry-$s.plist ~/tradeberry/exec-$s.sha ~/tradeberry/exec-$s.sha.new; true"
done

print "== 2. snapshot of the databases"
STAMP=$(date +%Y%m%d-%H%M%S)
ssh "$MINI" "B=~/tradeberry/backups; mkdir -p \$B
  for d in tradeberry broker; do [ -f ~/tradeberry/data/\$d.db ] || continue
    /usr/bin/sqlite3 ~/tradeberry/data/\$d.db \".backup '\$B/prerollback-$STAMP-\$d.db'\" && /usr/bin/gzip -f \$B/prerollback-$STAMP-\$d.db || exit 1; done" || die "the snapshot failed"

print "== 3. build $REF and copy it"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/tb-rollback.XXXXXX")
cleanup() { git worktree remove --force "$TMP/src" 2>/dev/null; rm -rf "$TMP"; }
trap cleanup EXIT
git worktree add --detach "$TMP/src" "$SHA" >/dev/null
ln -s "$PWD/node_modules" "$TMP/src/node_modules"
(cd "$TMP/src" && node build.mjs) || die "the build of $REF failed"
BUILD=$(grep -o "MFX_BUILD *= *'[^']*'" "$TMP/src/dist/index.html" | head -1)
rsync -a --delete "$TMP/src/dist/" "${MINI}:tradeberry/app/"
CODE=()
for f in functions server migrations host tools core catalog.js engine.js app.js trade.js challenge.js; do [[ -e "$TMP/src/$f" ]] && CODE+=("$f"); done
(cd "$TMP/src" && rsync -a --delete --exclude '.DS_Store' --exclude node_modules "${CODE[@]}" "${MINI}:tradeberry/code/")
ssh "$MINI" 'echo "{\"type\":\"module\",\"private\":true}" > ~/tradeberry/code/package.json'

print "== 4. web server on $REF"
ssh "$MINI" "/usr/bin/sqlite3 ~/tradeberry/data/tradeberry.db \"DELETE FROM ops_flags WHERE k = 'state_frozen';\" 2>/dev/null; true"
ssh "$MINI" 'launchctl kickstart -k gui/$(id -u)/com.victor.tradeberry'
# the recorder listened to the feed hub (gone now): restarted on the old code, it reads the platform itself again
ssh "$MINI" 'launchctl kickstart -k gui/$(id -u)/com.victor.tradeberry-recorder'
# then the feed hub, which nothing listens to any more
ssh "$MINI" "launchctl bootout gui/\$(id -u)/com.victor.tradeberry-feed 2>/dev/null; rm -f $LA/com.victor.tradeberry-feed.plist ~/tradeberry/exec-feed.sha; true"
for i in {1..20}; do
  if ssh "$MINI" "curl -sf -o /dev/null http://127.0.0.1:8796/icons/favicon-32.png && grep -qF \"$BUILD\" ~/tradeberry/app/index.html"; then
    echo "rolled back: tradeBerry $BUILD ($REF) is up on $MINI; the browsers run the accounts from their blobs again."
    echo "snapshot before the rollback: ~/tradeberry/backups/prerollback-$STAMP-*.db.gz on $MINI"
    exit 0
  fi
  sleep 1
done
die "the web server did not answer after the restart; see ~/tradeberry/logs/server.log on $MINI"
