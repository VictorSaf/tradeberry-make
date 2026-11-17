#!/bin/zsh
# Daily copy of the tradeBerry databases (launchd com.victor.tradeberry-backup, 04:30): the app's and the temporary broker's
# (accounts, executions, FIX store), each a consistent snapshot through SQLite's own backup, gzip, kept 30 days in ~/tradeberry/backups.
#
# RESTORE THEM TOGETHER. tradeberry.db (users, gw_accounts, the gateway's gw_* tables and its FIX store) and broker.db
# (the accounts, positions, orders, executions and the broker's FIX store) describe one system: the FIX sequence numbers,
# the ClOrdIDs (gw_clord), the journal of each position (gw_meta) and the account ids must match on both sides. Always
# restore the pair with the SAME stamp (tradeberry-<stamp>.db.gz with broker-<stamp>.db.gz, made by the same run below),
# with the broker and the gateway stopped; never one file alone, never two different days. The tools/cutover.sh and
# tools/rollback.sh snapshots (precutover-<stamp>-*, prerollback-<stamp>-*) are pairs the same way.
umask 077 # what this service creates (databases, WAL, backups) is readable by its owner only (security audit 09.11.2026, F12)
set -e
B="$HOME/tradeberry/backups"; mkdir -p "$B"
STAMP=$(date +%Y%m%d-%H%M) # one stamp for the pair
F="$B/tradeberry-$STAMP.db"
/usr/bin/sqlite3 "$HOME/tradeberry/data/tradeberry.db" ".backup '$F'"
/usr/bin/gzip -f "$F"
find "$B" -name 'tradeberry-*.db.gz' -mtime +30 -delete
if [ -f "$HOME/tradeberry/data/broker.db" ]; then
  K="$B/broker-$STAMP.db"
  /usr/bin/sqlite3 "$HOME/tradeberry/data/broker.db" ".backup '$K'"
  /usr/bin/gzip -f "$K"
  find "$B" -name 'broker-*.db.gz' -mtime +30 -delete
fi
