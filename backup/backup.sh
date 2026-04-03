#!/bin/bash
set -e
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
YEAR=$(date +%Y)
MONTH=$(date +%m)
BACKUP_DIR=/backups
mkdir -p "$BACKUP_DIR/db/$YEAR/$MONTH" "$BACKUP_DIR/logs/$YEAR/$MONTH" "$BACKUP_DIR/errors/$YEAR/$MONTH"

echo "=== Backup started: $TIMESTAMP ==="

# 1. Database backup
echo "[db] Dumping..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h db -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/db/$YEAR/$MONTH/db-$TIMESTAMP.sql.gz"
echo "[db] Saved: db/$YEAR/$MONTH/db-$TIMESTAMP.sql.gz"

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
rclone copy "$BACKUP_DIR" gdrive:lingua-read-backups \
  --config /rclone/rclone.conf \
  --log-level INFO

# 4. Prune local copies older than 7 days
find "$BACKUP_DIR/db"     -name "*.sql.gz" -mtime +7 -delete
find "$BACKUP_DIR/logs"   -name "*.log"    -mtime +7 -delete
find "$BACKUP_DIR/errors" -name "*.err"    -mtime +7 -delete

echo "=== Backup complete: $TIMESTAMP ==="
