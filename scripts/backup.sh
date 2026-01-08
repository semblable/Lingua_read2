#!/usr/bin/env bash
set -euo pipefail

ts="$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p backups

echo "[backup] Dumping DB..."
docker compose exec -T db pg_dump -U "${POSTGRES_USER}" -d "${POSTGRES_DB}" -Fc > "backups/db-${ts}.dump"

echo "[backup] Archiving audio lessons volume..."
docker run --rm \
  -v api_audio_lessons:/data:ro \
  -v "$(pwd)/backups:/backups" \
  alpine:3.20 \
  sh -c "tar -czf /backups/audio_lessons-${ts}.tar.gz -C /data ."

echo "[backup] Archiving audiobooks volume..."
docker run --rm \
  -v api_audiobooks:/data:ro \
  -v "$(pwd)/backups:/backups" \
  alpine:3.20 \
  sh -c "tar -czf /backups/audiobooks-${ts}.tar.gz -C /data ."

echo "[backup] Done:"
ls -lh "backups/db-${ts}.dump" "backups/audio_lessons-${ts}.tar.gz" "backups/audiobooks-${ts}.tar.gz"

