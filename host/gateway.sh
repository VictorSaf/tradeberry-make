#!/bin/zsh
# Started by launchd (com.victor.tradeberry-gateway) on the Mac mini: the FIX credentials (TB_FIX_USER / TB_FIX_PASS)
# and the proxy secret TB_GW_SECRET (the same value host/run.sh gives host/server.mjs) from ~/tradeberry/env (chmod 600,
# never in git); its tables and FIX store in ~/tradeberry/data/tradeberry.db (host/migrate.mjs first).
# WebSocket on 127.0.0.1:8797, FIX to the broker on 127.0.0.1:9878. Logs: ~/tradeberry/logs/gateway.log
umask 077 # what this service creates (databases, WAL, backups) is readable by its owner only (security audit 09.11.2026, F12)
set -a; source "$HOME/tradeberry/env"; set +a
export TB_FEED_HUB=127.0.0.1:8799 # prices from host/feed-hub.mjs, the one reader of the platform
export TB_DB="$HOME/tradeberry/data/tradeberry.db" TB_DATA="$HOME/tradeberry/data" # TB_DATA: the 1-minute bar archive (OMS recovery)
exec /opt/homebrew/bin/node "$HOME/tradeberry/code/host/gateway.mjs"
