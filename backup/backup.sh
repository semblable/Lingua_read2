#!/bin/bash
set -e
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
BACKUP_DIR=/backups
mkdir -p "$BACKUP_DIR/db" "$BACKUP_DIR/logs"

echo "=== Backup started: $TIMESTAMP ==="

# 1. Database backup
echo "[db] Dumping..."
PGPASSWORD="$POSTGRES_PASSWORD" pg_dump \
  -h db -U "$POSTGRES_USER" "$POSTGRES_DB" \
  | gzip > "$BACKUP_DIR/db/db-$TIMESTAMP.sql.gz"
echo "[db] Saved: db-$TIMESTAMP.sql.gz"

# 2. Collect last 24h of logs from all compose containers
echo "[logs] Collecting..."
CONTAINERS=$(docker ps --filter "label=com.docker.compose.project" --format "{{.Names}}")
for container in $CONTAINERS; do
  docker logs --since 24h "$container" \
    > "$BACKUP_DIR/logs/${container}-$TIMESTAMP.log" 2>&1 || true
done
echo "[logs] Done."

# 3. Upload to Google Drive
echo "[rclone] Uploading..."
rclone sync "$BACKUP_DIR" gdrive:lingua-read-backups \
  --config /rclone/rclone.conf \
  --log-level INFO

# 4. Prune local copies older than 7 days
find "$BACKUP_DIR/db"   -name "*.sql.gz" -mtime +7 -delete
find "$BACKUP_DIR/logs" -name "*.log"    -mtime +7 -delete

echo "=== Backup complete: $TIMESTAMP ==="
