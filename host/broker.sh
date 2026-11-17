#!/bin/zsh
# Started by launchd (com.victor.tradeberry-broker) on the Mac mini: the platform key and the FIX credentials
# (TB_FIX_USER / TB_FIX_PASS) from ~/tradeberry/env (chmod 600, never in git), the accounts in ~/tradeberry/data/broker.db.
# FIX on 127.0.0.1:9878 only. Logs: ~/tradeberry/logs/broker.log
umask 077 # what this service creates (databases, WAL, backups) is readable by its owner only (security audit 09.11.2026, F12)
set -a; source "$HOME/tradeberry/env"; set +a
export TB_FEED_HUB=127.0.0.1:8799 # prices from host/feed-hub.mjs, the one reader of the platform
export TB_BROKER_DB="$HOME/tradeberry/data/broker.db"
exec /opt/homebrew/bin/node "$HOME/tradeberry/code/host/broker.mjs"
