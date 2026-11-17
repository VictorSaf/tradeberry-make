#!/bin/zsh
# Deploy tradeBerry to the Mac mini (run from 2-cod-sursa: npm run deploy, or npm run deploy:ui to skip migrations).
#   build → copy the app and the server code to macmini:~/tradeberry → migrations (unless --ui) → the broker and the
#   gateway restarted only when their code changed (unless --ui) → web server restart → health check.
# Since v16 the trading accounts live on the execution server (host/broker.mjs + host/gateway.mjs). Its first install is
# tools/cutover.sh, never this script: a Mac mini without the broker and gateway services is refused here (deploying
# the v16 app without them would leave every account without execution, and the gateway would open fresh accounts
# for users whose blob has not been migrated yet). tools/rollback.sh removes them again.
set -e
cd "$(dirname "$0")/.."
MINI=${TB_MINI:-macmini}
LA='~/Library/LaunchAgents'
if ! ssh "$MINI" "test -f $LA/com.victor.tradeberry-broker.plist && test -f $LA/com.victor.tradeberry-gateway.plist"; then
  echo "The execution server (broker + gateway) is not installed on $MINI: run tools/cutover.sh first (nothing was deployed)." >&2; exit 1
fi
if [[ "$1" == "--ui" ]] && ! ssh "$MINI" "test -f $LA/com.victor.tradeberry-feed.plist"; then
  echo "The local price feed (com.victor.tradeberry-feed) is not installed on $MINI yet: run npm run deploy once first (nothing was deployed)." >&2; exit 1
fi
# the code each service runs: a change of any of these files restarts it (host/fix, core and catalog.js are both's)
EXEC_COMMON='host/fix core catalog.js server/legacy.js host/package.json host/package-lock.json'
EXEC_broker="host/broker.mjs host/broker.sh host/broker host/com.victor.tradeberry-broker.plist $EXEC_COMMON"
EXEC_gateway="host/gateway.mjs host/gateway.sh host/gateway host/com.victor.tradeberry-gateway.plist host/feed-client.mjs host/feed-hub.mjs $EXEC_COMMON"
# the one reader of the platform (host/feed-hub.mjs): every process below listens to it, so it goes first; the recorder too
EXEC_feed='host/feed-hub.mjs host/feed.sh host/com.victor.tradeberry-feed.plist server/legacy.js'
EXEC_recorder='host/recorder.mjs host/recorder.sh host/feed-client.mjs host/feed-hub.mjs server/legacy.js'
EXEC_broker="$EXEC_broker host/feed-client.mjs host/feed-hub.mjs"
codeHash() { ssh "$MINI" "cd ~/tradeberry/code && find $1 -type f ! -name .DS_Store 2>/dev/null | LC_ALL=C sort | xargs shasum -a 256 | shasum -a 256 | cut -c1-64"; }

# the server's dependencies (host/node_modules, copied as they are): a known HIGH or CRITICAL advisory stops the deploy
# (security audit 09.11.2026, F02: ws 8.18.3 ran in production with a DoS advisory)
npm audit --prefix host --omit=dev --audit-level=high || { echo "npm audit found a HIGH/CRITICAL advisory in host/ (nothing was deployed): update the package first" >&2; exit 1; }
npm run release
rsync -a --delete ../1-aplicatie-publicabila/ "${MINI}:tradeberry/app/"
# engine.js, app.js, trade.js, challenge.js: tools/migrate-accounts.mjs runs the browser's own loader from the code root
rsync -a --delete --exclude '.DS_Store' functions server migrations host tools core catalog.js engine.js app.js trade.js challenge.js "${MINI}:tradeberry/code/"
ssh "$MINI" 'echo "{\"type\":\"module\",\"private\":true}" > ~/tradeberry/code/package.json'
if [[ "$1" != "--ui" ]]; then
  ssh "$MINI" '/opt/homebrew/bin/node ~/tradeberry/code/host/migrate.mjs ~/tradeberry/data/tradeberry.db ~/tradeberry/code/migrations'
  # order: the broker (accounts) before the gateway (it logs on to it); each restarted only when its code changed since
  # it was last started by a deploy (~/tradeberry/exec-<service>.sha, outside code/ so rsync --delete keeps it)
  for s in feed recorder; do
    eval "files=\$EXEC_$s"; h=$(codeHash "$files")
    if [[ "$h" == "$(ssh "$MINI" "cat ~/tradeberry/exec-$s.sha 2>/dev/null")" ]]; then echo "$s: code unchanged, left running"; continue; fi
    P="$LA/com.victor.tradeberry-$s.plist"
    ssh "$MINI" "cmp -s ~/tradeberry/code/host/com.victor.tradeberry-$s.plist $P || { launchctl bootout gui/\$(id -u)/com.victor.tradeberry-$s 2>/dev/null; sleep 1; cp ~/tradeberry/code/host/com.victor.tradeberry-$s.plist $P; launchctl bootstrap gui/\$(id -u) $P; }"
    ssh "$MINI" "launchctl kickstart -k gui/\$(id -u)/com.victor.tradeberry-$s"
    if [[ $s == feed ]]; then
      ssh "$MINI" 'for i in $(seq 30); do nc -z 127.0.0.1 8799 && exit 0; sleep 1; done; exit 1' || { echo "the feed hub did not start; see ~/tradeberry/logs/feed.log on the Mac mini" >&2; exit 1; }
    fi
    ssh "$MINI" "echo $h > ~/tradeberry/exec-$s.sha"
  done
  linked_mark=''
  for s in broker gateway; do
    eval "files=\$EXEC_$s"; h=$(codeHash "$files")
    if [[ "$h" == "$(ssh "$MINI" "cat ~/tradeberry/exec-$s.sha 2>/dev/null")" ]]; then echo "$s: code unchanged, left running"; continue; fi
    [[ -z "$linked_mark" ]] && linked_mark=$(ssh "$MINI" 'wc -l < ~/tradeberry/logs/gateway.log 2>/dev/null || echo 0' | tr -d ' ')
    P="$LA/com.victor.tradeberry-$s.plist"
    ssh "$MINI" "cmp -s ~/tradeberry/code/host/com.victor.tradeberry-$s.plist $P || { launchctl bootout gui/\$(id -u)/com.victor.tradeberry-$s 2>/dev/null; cp ~/tradeberry/code/host/com.victor.tradeberry-$s.plist $P; launchctl bootstrap gui/\$(id -u) $P; }"
    ssh "$MINI" "launchctl kickstart -k gui/\$(id -u)/com.victor.tradeberry-$s"
    if [[ $s == broker ]]; then
      ssh "$MINI" 'for i in $(seq 30); do nc -z 127.0.0.1 9878 && exit 0; sleep 1; done; exit 1' || { echo "broker did not start; see ~/tradeberry/logs/broker.log on the Mac mini" >&2; exit 1; }
    fi
    ssh "$MINI" "echo $h > ~/tradeberry/exec-$s.sha.new"
  done
  if [[ -n "$linked_mark" ]]; then
    # the gateway is up only once it is linked to the broker with its mirror rebuilt (a listening port is not enough):
    # a new 'linked to the broker' line in its log after the restart (a broker restart makes the gateway link again)
    ssh "$MINI" "for i in \$(seq 90); do tail -n +$((linked_mark + 1)) ~/tradeberry/logs/gateway.log 2>/dev/null | grep -q 'gateway: linked to the broker' && exit 0; sleep 1; done; exit 1" \
      || { echo "the gateway did not link to the broker within 90 s; see ~/tradeberry/logs/gateway.log and broker.log on the Mac mini" >&2; exit 1; }
    ssh "$MINI" 'for s in broker gateway; do [ -f ~/tradeberry/exec-$s.sha.new ] && mv ~/tradeberry/exec-$s.sha.new ~/tradeberry/exec-$s.sha; done; true'
    echo "execution server restarted and linked"
  fi
fi
ssh "$MINI" 'launchctl kickstart -k gui/$(id -u)/com.victor.tradeberry'
BUILD=$(grep -o "MFX_BUILD *= *'[^']*'" ../1-aplicatie-publicabila/index.html | head -1)
for i in {1..20}; do
  # up, and the build just made is the one on disk there (the page itself sits behind the login)
  if ssh "$MINI" "curl -sf -o /dev/null http://127.0.0.1:8796/icons/favicon-32.png && grep -qF \"$BUILD\" ~/tradeberry/app/index.html"; then echo "tradeBerry is up on the Mac mini ($BUILD)"; exit 0; fi
  sleep 1
done
echo "tradeBerry did not answer after the restart; see ~/tradeberry/logs/server.log on the Mac mini" >&2; exit 1
