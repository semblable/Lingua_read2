## Lingua-Read backups (DB + media)

This repo’s Docker stack persists:
- **Postgres data**: `db_data` volume
- **Audio lessons**: `api_audio_lessons` volume
- **Audiobooks**: `api_audiobooks` volume

Backups should cover **both** the database and the media volumes.

### Prerequisites (on the VM)
- Docker + Compose installed
- You run these commands from the folder that contains `docker-compose.yml`

### 1) Database backup (recommended: pg_dump custom format)

Create a dated backup file:

```bash
mkdir -p backups
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "backups/db-$(date -u +%Y%m%dT%H%M%SZ).dump"
```

Notes:
- `-Fc` creates a **custom format** dump (good for restores, includes schema + data).
- This uses the `db` container’s `pg_dump` (included in the `postgres` image).

### 2) Media backup (tar each named volume)

```bash
mkdir -p backups

docker run --rm \
  -v api_audio_lessons:/data:ro \
  -v "$(pwd)/backups:/backups" \
  alpine:3.20 \
  sh -c 'tar -czf /backups/audio_lessons-'"$(date -u +%Y%m%dT%H%M%SZ)"'.tar.gz -C /data .'

docker run --rm \
  -v api_audiobooks:/data:ro \
  -v "$(pwd)/backups:/backups" \
  alpine:3.20 \
  sh -c 'tar -czf /backups/audiobooks-'"$(date -u +%Y%m%dT%H%M%SZ)"'.tar.gz -C /data .'
```

### 3) Restore (DB)

Pick a `.dump` file and restore it:

```bash
# WARNING: this will overwrite the database contents.

cat backups/db-<timestamp>.dump | docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges
```

If you need to recreate the DB from scratch, it’s often simplest to:
- stop the stack
- delete `db_data` volume
- start stack again (fresh DB)
- then restore into the fresh DB

### 4) Restore (media volumes)

```bash
# Audio lessons
docker run --rm \
  -v api_audio_lessons:/data \
  -v "$(pwd)/backups:/backups" \
  alpine:3.20 \
  sh -c 'rm -rf /data/* && tar -xzf /backups/audio_lessons-<timestamp>.tar.gz -C /data'

# Audiobooks
docker run --rm \
  -v api_audiobooks:/data \
  -v "$(pwd)/backups:/backups" \
  alpine:3.20 \
  sh -c 'rm -rf /data/* && tar -xzf /backups/audiobooks-<timestamp>.tar.gz -C /data'
```

### Suggested schedule
- **Daily** DB dump
- **Weekly** media tarballs (or daily if you upload media frequently)
- Keep at least:
  - 7 daily DB backups
  - 4 weekly media backups

