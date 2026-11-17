#!/bin/zsh
# tradeBerry v16 cut-over: the trading accounts move from the browser (state blobs) to the execution server (the FIX
# broker host/broker.mjs + the gateway host/gateway.mjs). Run ONCE, from 2-cod-sursa on the dev Mac, like host/deploy.sh:
#   zsh tools/cutover.sh            (TB_MINI: the ssh host, default macmini; TB_CUTOVER_WAIT: seconds, default 65)
# Order, each step stopping the run on failure:
#   1. build, copy the app and the code (as host/deploy.sh), the schema migrations (host/migrate.mjs)
#   2. broker and gateway stopped if loaded; their secrets made in ~/tradeberry/env if missing (never printed)
#   3. the web server restarted on the new code: blobs frozen (ops_flags 'state_frozen': every PUT /api/state answers
#      503 until step 5 is through; the new state.js never writes the account keys, and an old build's PUT {state} and
#      /api/lease answer 423, so its pages stop running the account), /api/trade 503 (no gateway yet); then
#      TB_CUTOVER_WAIT seconds, so every old page open somewhere has asked for its lease (every 40 s, throttled to once
#      a minute in a background tab) and stopped
#   4. a snapshot of tradeberry.db (and broker.db if any) in ~/tradeberry/backups/precutover-<time>-*.db.gz
#   5. tools/migrate-accounts.mjs, then --verify: any refusal or difference stops the cut-over here (the broker and the
#      gateway stay off and the blobs stay frozen; nobody trades, nothing is lost; fix and run this script again, it is
#      idempotent per account, or go back with tools/rollback.sh); both through: the freeze is lifted (preferences save)
#   6. the broker installed and started → its FIX port 9878 → the gateway → its log says it is linked to the broker
#   7. health check of the web server and a short summary
# After it, host/deploy.sh (npm run deploy) does the normal deploys. Rollback: tools/rollback.sh <git ref>.
set -e
cd "$(dirname "$0")/.."
MINI=${TB_MINI:-macmini}
WAIT=${TB_CUTOVER_WAIT:-65}
LA='~/Library/LaunchAgents'
NODE=/opt/homebrew/bin/node
step() { print -P "%B== $*%b"; }
die() { echo "CUT-OVER STOPPED: $*" >&2; exit 1; }
EXEC_COMMON='host/fix core catalog.js server/legacy.js host/package.json host/package-lock.json'
EXEC_broker="host/broker.mjs host/broker.sh host/broker host/com.victor.tradeberry-broker.plist $EXEC_COMMON host/feed-client.mjs host/feed-hub.mjs"
EXEC_gateway="host/gateway.mjs host/gateway.sh host/gateway host/com.victor.tradeberry-gateway.plist host/feed-client.mjs host/feed-hub.mjs $EXEC_COMMON"
codeHash() { ssh "$MINI" "cd ~/tradeberry/code && find $1 -type f ! -name .DS_Store 2>/dev/null | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-64"; }

if ssh "$MINI" "test -f $LA/com.victor.tradeberry-broker.plist || test -f $LA/com.victor.tradeberry-gateway.plist"; then
  die "the broker / gateway services are installed on $MINI already: the cut-over was done (the accounts trade there since). Use npm run deploy, or tools/rollback.sh <ref> to go back."
fi

step "1. build, copy, schema"
npm run release
rsync -a --delete ../1-aplicatie-publicabila/ "${MINI}:tradeberry/app/"
rsync -a --delete --exclude '.DS_Store' functions server migrations host tools core catalog.js engine.js app.js trade.js challenge.js "${MINI}:tradeberry/code/"
ssh "$MINI" 'echo "{\"type\":\"module\",\"private\":true}" > ~/tradeberry/code/package.json'
ssh "$MINI" "$NODE ~/tradeberry/code/host/migrate.mjs ~/tradeberry/data/tradeberry.db ~/tradeberry/code/migrations" || die "schema migrations failed"

step "2. broker and gateway off, secrets"
for s in gateway broker; do
  ssh "$MINI" "launchctl print gui/\$(id -u)/com.victor.tradeberry-$s >/dev/null 2>&1 && launchctl bootout gui/\$(id -u)/com.victor.tradeberry-$s; true"
done
# made on the mini, once, straight into ~/tradeberry/env (chmod 600): never printed, never leave it. The web server needs
# TB_GW_SECRET before its restart (host/run.sh), the gateway the same value.
ssh "$MINI" 'E=~/tradeberry/env; touch $E; chmod 600 $E
  for k in TB_FIX_USER TB_FIX_PASS TB_GW_SECRET; do grep -q "^$k=" $E || echo "$k=$(openssl rand -hex 24)" >> $E; done'

step "3. web server on the new code (blobs frozen), then ${WAIT} s for the old pages to stop"
SQ='/usr/bin/sqlite3 ~/tradeberry/data/tradeberry.db'
ssh "$MINI" "$SQ \"INSERT OR REPLACE INTO ops_flags (k, v) VALUES ('state_frozen', 'tools/cutover.sh');\"" || die "could not freeze the blobs"
ssh "$MINI" 'launchctl kickstart -k gui/$(id -u)/com.victor.tradeberry'
ssh "$MINI" 'for i in $(seq 30); do curl -sf -o /dev/null http://127.0.0.1:8796/icons/favicon-32.png && exit 0; sleep 1; done; exit 1' || die "the web server did not come back; see ~/tradeberry/logs/server.log"
sleep "$WAIT"

step "4. snapshot of the databases"
STAMP=$(date +%Y%m%d-%H%M%S)
ssh "$MINI" "B=~/tradeberry/backups; mkdir -p \$B
  /usr/bin/sqlite3 ~/tradeberry/data/tradeberry.db \".backup '\$B/precutover-$STAMP-tradeberry.db'\" && /usr/bin/gzip -f \$B/precutover-$STAMP-tradeberry.db
  if [ -f ~/tradeberry/data/broker.db ]; then /usr/bin/sqlite3 ~/tradeberry/data/broker.db \".backup '\$B/precutover-$STAMP-broker.db'\" && /usr/bin/gzip -f \$B/precutover-$STAMP-broker.db; fi" || die "the snapshot failed"

step "5. accounts: migrate, then verify"
MIG="cd ~/tradeberry/code && TB_DB=~/tradeberry/data/tradeberry.db TB_BROKER_DB=~/tradeberry/data/broker.db $NODE tools/migrate-accounts.mjs"
ssh "$MINI" "$MIG" || die "tools/migrate-accounts.mjs reported refusals or differences (above). The broker and the gateway stay off; fix and run tools/cutover.sh again, or tools/rollback.sh <ref>."
ssh "$MINI" "$MIG --verify" || die "--verify found differences (above). The broker and the gateway stay off; fix and run tools/cutover.sh again, or tools/rollback.sh <ref>."
ssh "$MINI" "$SQ \"DELETE FROM ops_flags WHERE k = 'state_frozen';\"" || die "could not lift the freeze of the blobs (ops_flags)"

step "6. broker, then gateway"
MARK=$(ssh "$MINI" 'wc -l < ~/tradeberry/logs/gateway.log 2>/dev/null || echo 0' | tr -d ' ')
for s in broker gateway; do
  ssh "$MINI" "cp ~/tradeberry/code/host/com.victor.tradeberry-$s.plist $LA/ && launchctl bootstrap gui/\$(id -u) $LA/com.victor.tradeberry-$s.plist" || die "could not install $s"
  if [[ $s == broker ]]; then
    ssh "$MINI" 'for i in $(seq 30); do nc -z 127.0.0.1 9878 && exit 0; sleep 1; done; exit 1' || die "the broker did not open its FIX port 9878; see ~/tradeberry/logs/broker.log"
  fi
done
ssh "$MINI" "for i in \$(seq 120); do tail -n +$((MARK + 1)) ~/tradeberry/logs/gateway.log 2>/dev/null | grep -q 'gateway: linked to the broker' && exit 0; sleep 1; done; exit 1" \
  || die "the gateway did not link to the broker within 120 s; see ~/tradeberry/logs/gateway.log and broker.log (the services stay installed: launchctl keeps retrying)"
for s in broker gateway; do eval "files=\$EXEC_$s"; h=$(codeHash "$files"); ssh "$MINI" "echo $h > ~/tradeberry/exec-$s.sha"; done

step "7. health check"
BUILD=$(grep -o "MFX_BUILD *= *'[^']*'" ../1-aplicatie-publicabila/index.html | head -1)
ssh "$MINI" "curl -sf -o /dev/null http://127.0.0.1:8796/icons/favicon-32.png && grep -qF \"$BUILD\" ~/tradeberry/app/index.html && nc -z 127.0.0.1 8797" || die "health check failed (web server, build or gateway port 8797)"
ssh "$MINI" "/usr/bin/sqlite3 ~/tradeberry/data/tradeberry.db \"SELECT 'gateway accounts: ' || COUNT(*) || ' (' || SUM(rev > 0) || ' migrated from a blob)' FROM gw_accounts WHERE closed_at IS NULL;\"
  /usr/bin/sqlite3 ~/tradeberry/data/broker.db \"SELECT 'broker: ' || (SELECT COUNT(*) FROM accounts) || ' accounts, ' || (SELECT COUNT(*) FROM positions) || ' open positions, ' || (SELECT COUNT(*) FROM orders) || ' orders';\""
echo "snapshot before the migration: ~/tradeberry/backups/precutover-$STAMP-*.db.gz on $MINI"
echo "cut-over done: tradeBerry $BUILD runs the accounts on the execution server. Normal deploys: npm run deploy."
