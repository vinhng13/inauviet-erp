#!/bin/sh
# Runs inside the `backup` container. Dumps the database every night at 02:00 (Asia/Ho_Chi_Minh)
# into /backups as erp-YYYY-MM-DD.dump and deletes dumps older than KEEP_DAYS.
# Restore:  pg_restore --clean --if-exists -d erp erp-2026-11-02.dump
set -eu
KEEP_DAYS="${KEEP_DAYS:-30}"

dump() {
  file="/backups/erp-$(date +%F).dump"
  pg_dump --format=custom --file="$file.tmp" && mv "$file.tmp" "$file"
  find /backups -name 'erp-*.dump' -mtime +"$KEEP_DAYS" -delete
  echo "$(date '+%F %T') backup written: $file"
}

dump  # one backup at start-up, so a fresh install is covered immediately
while true; do
  now=$(date +%s)
  next=$(date -d "$(date +%F) 02:00" +%s 2>/dev/null || echo 0)
  [ "$next" -le "$now" ] && next=$((next + 86400))
  [ "$next" -le "$now" ] && next=$((now + 86400))
  sleep $((next - now))
  dump
done
