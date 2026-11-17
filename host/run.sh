#!/bin/zsh
# Started by launchd (com.victor.tradeberry) on the Mac mini: reads the settings and the platform key from ~/tradeberry/env
# (chmod 600, never in git) and runs the server. Logs: ~/tradeberry/logs/server.log
umask 077 # what this service creates (databases, WAL, backups) is readable by its owner only (security audit 09.11.2026, F12)
set -a; source "$HOME/tradeberry/env"; set +a
export TB_FEED_HUB=127.0.0.1:8799 # prices from host/feed-hub.mjs, the one reader of the platform
export TB_APP="$HOME/tradeberry/app" TB_DB="$HOME/tradeberry/data/tradeberry.db"
exec /opt/homebrew/bin/node "$HOME/tradeberry/code/host/server.mjs"
