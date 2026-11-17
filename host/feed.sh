#!/bin/zsh
# Started by launchd (com.victor.tradeberry-feed) on the Mac mini: the one reader of the platform's quotes table
# (host/feed-hub.mjs), serving the other processes on 127.0.0.1:8799. The platform key from ~/tradeberry/env (chmod 600,
# never in git). Logs: ~/tradeberry/logs/feed.log
umask 077 # what this service creates (databases, WAL, backups) is readable by its owner only (security audit 09.11.2026, F12)
set -a; source "$HOME/tradeberry/env"; set +a
export TB_FEED_HUB=127.0.0.1:8799
exec /opt/homebrew/bin/node "$HOME/tradeberry/code/host/feed-hub.mjs"
