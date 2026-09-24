#!/bin/bash
set -e

# Optional healthchecks.io-style heartbeat (set HEALTHCHECK_URL in .env; empty = disabled).
# /start marks the run begun; a bare ping marks success; /fail is sent by the EXIT trap
# on any error. The monitor's grace period also catches this script never running at all.
HC_URL="${HEALTHCHECK_URL:-}"
hc() { [ -n "$HC_URL" ] && curl -fsS -m 10 --retry 3 "$HC_URL$1" >/dev/null 2>&1 || true; }
on_exit() {
  code=$1
  if [ "$code" -ne 0 ]; then
    hc /fail
  fi
}
trap 'on_exit $?' EXIT
hc /start

TIMESTAMP=$(date +%Y%m%d-%H%M%S)
YEAR=$(date +%Y)
MONTH=$(date +%m)
BACKUP_DIR=/backups
# One Drive folder per environment, and no default on purpose: `rclone sync` below makes the
# destination match the source, so staging writing into production's folder would move every
# production media file into deleted/. _deploy.yml appends BACKUP_ENV to .env.
REMOTE="gdrive:lingua-read-backups/${BACKUP_ENV:?BACKUP_ENV must be set (production|staging)}"
mkdir -p "$BACKUP_DIR/db/$YEAR/$MONTH" "$BACKUP_DIR/logs/$YEAR/$MONTH" "$BACKUP_DIR/errors/$YEAR/$MONTH"

echo "=== Backup started: $TIMESTAMP ==="

# 1. Database backup
echo "[db] Dumping..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h db -U "$POSTGRES_USER" "$POSTGRES_DB" \
  -Fc -f "$BACKUP_DIR/db/$YEAR/$MONTH/db-$TIMESTAMP.backup"
echo "[db] Saved: db/$YEAR/$MONTH/db-$TIMESTAMP.backup"

# 2. Collect last 24h of logs from all compose containers + extract errors
echo "[logs] Collecting..."
CONTAINERS=$(docker ps --filter "label=com.docker.compose.project" --format "{{.Names}}")
for container in $CONTAINERS; do
  LOG_FILE="$BACKUP_DIR/logs/$YEAR/$MONTH/${container}-$TIMESTAMP.log"
  docker logs --since 24h --timestamps "$container" > "$LOG_FILE" 2>&1 || true
  grep -iE '(fail:|warn|crit|alert|emerg|error|exception|fatal|panic|unhandled|deadlock|timed? out|refused|out of memory|" 5[0-9]{2} ")' "$LOG_FILE" \
    > "$BACKUP_DIR/errors/$YEAR/$MONTH/${container}-$TIMESTAMP.err" 2>/dev/null || true
done
echo "[logs] Done."

# 3. Upload to Google Drive
echo "[rclone] Uploading..."
cp /rclone/rclone.conf /tmp/rclone.conf
# prod-refresh/ is staging's download area for production's dump (refresh-from-prod.sh), not a backup.
rclone copy "$BACKUP_DIR" "$REMOTE" \
  --exclude "prod-refresh/**" \
  --config /tmp/rclone.conf \
  --log-level INFO

# 4. Media volumes: mirror to Drive. Files removed or replaced since the last run are
# moved into a dated deleted/ folder rather than dropped, so a bad delete is recoverable.
# api_dp_keys is left out on purpose: it decrypts the API keys inside the DB dump, so the
# two must never share a folder (losing it only means re-entering those keys in Settings).
echo "[media] Syncing..."
for d in audio_lessons audiobooks epub_assets hardcover-covers; do
  rclone sync "/srv/media/$d" "$REMOTE/media/current/$d" \
    --backup-dir "$REMOTE/media/deleted/$TIMESTAMP/$d" \
    --config /tmp/rclone.conf \
    --log-level INFO
done
echo "[media] Done."

# 5. Drive retention: DB dumps for 90 days, logs for 30, moved-aside media for 90.
# Exit 3 = directory not found. Deleted files go to Drive's trash (kept 30 more days).
# Empty folders go in a second pass WITHOUT --min-age: `delete --rmdirs` applies the age
# filter to its emptiness check too, so a folder holding only recent files looks empty,
# the rmdir is refused ("directory not empty"), and the whole run fails.
prune() {
  rclone delete "$REMOTE/$1" --min-age "$2" --config /tmp/rclone.conf || [ $? -eq 3 ]
  rclone rmdirs "$REMOTE/$1" --leave-root --config /tmp/rclone.conf || [ $? -eq 3 ]
}
prune db     90d
prune logs   30d
prune errors 30d

# Moved-aside media keeps its ORIGINAL modification time, so --min-age would judge a file
# removed today by when it was first uploaded and could delete it in the same run. Age each
# deleted/<yyyymmdd-hhmmss> snapshot by the date in its name (when it was set aside) instead.
CUTOFF=$(date -u -d "@$(( $(date +%s) - 90 * 86400 ))" +%Y%m%d)
SNAPSHOTS=$(rclone lsf --dirs-only "$REMOTE/media/deleted" --config /tmp/rclone.conf) || [ $? -eq 3 ]
for snap in $SNAPSHOTS; do
  snap=${snap%/}
  day=${snap%%-*}
  case "$day" in
    [0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]) ;;
    *) continue ;;
  esac
  if [ "$day" -lt "$CUTOFF" ]; then
    echo "[prune] media/deleted/$snap (set aside $day, before $CUTOFF)"
    rclone purge "$REMOTE/media/deleted/$snap" --config /tmp/rclone.conf
  fi
done

# 6. Prune local copies older than 7 days
find "$BACKUP_DIR/db"     -name "*.backup" -mtime +7 -delete
find "$BACKUP_DIR/logs"   -name "*.log"    -mtime +7 -delete
find "$BACKUP_DIR/errors" -name "*.err"    -mtime +7 -delete

echo "=== Backup complete: $TIMESTAMP ==="
hc ""
