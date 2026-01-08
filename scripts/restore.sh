#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <db_dump_file> <audio_lessons_tar_gz> <audiobooks_tar_gz>"
  exit 1
fi

db_dump="$1"
audio_tar="$2"
audiobooks_tar="$3"

echo "[restore] Restoring DB from ${db_dump}..."
cat "${db_dump}" | docker compose exec -T db pg_restore \
  -U "${POSTGRES_USER}" \
  -d "${POSTGRES_DB}" \
  --clean --if-exists --no-owner --no-privileges

echo "[restore] Restoring audio lessons from ${audio_tar}..."
docker run --rm \
  -v api_audio_lessons:/data \
  -v "$(pwd):/work" \
  alpine:3.20 \
  sh -c "rm -rf /data/* && tar -xzf /work/${audio_tar} -C /data"

echo "[restore] Restoring audiobooks from ${audiobooks_tar}..."
docker run --rm \
  -v api_audiobooks:/data \
  -v "$(pwd):/work" \
  alpine:3.20 \
  sh -c "rm -rf /data/* && tar -xzf /work/${audiobooks_tar} -C /data"

echo "[restore] Done."

