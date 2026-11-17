#!/bin/zsh
# Started by launchd (com.victor.tradeberry-recorder) on the Mac mini: the platform key from ~/tradeberry/env (chmod 600,
# never in git), the ticks in ~/tradeberry/data/ticks.db. Logs: ~/tradeberry/logs/recorder.log
umask 077 # what this service creates (databases, WAL, backups) is readable by its owner only (security audit 09.11.2026, F12)
set -a; source "$HOME/tradeberry/env"; set +a
export TB_FEED_HUB=127.0.0.1:8799 # prices from host/feed-hub.mjs, the one reader of the platform
export TB_TICKS="$HOME/tradeberry/data/ticks.db"
exec /opt/homebrew/bin/node "$HOME/tradeberry/code/host/recorder.mjs"
