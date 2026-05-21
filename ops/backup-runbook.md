## Lingua-Read backups (DB + media)

This repo’s Docker stack persists:
- **Postgres data**: `db_data_pg18` volume
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
docker compose exec -T db pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f /tmp/backup.backup && docker compose cp db:/tmp/backup.backup "backups/db-$(date -u +%Y%m%dT%H%M%SZ).backup"
```

Notes:
- `-Fc` creates a **custom format** dump (compressed, supports selective & parallel restore).
- `.backup` extension matches the format used by both the automated backup container and the in-app restore UI.
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

Pick a `.backup` file and restore it:

```bash
# WARNING: this will overwrite the database contents.

cat backups/db-<timestamp>.backup | docker compose exec -T db pg_restore \
  -U "$POSTGRES_USER" \
  -d "$POSTGRES_DB" \
  --clean --if-exists --no-owner --no-privileges
```

If you need to recreate the DB from scratch, it’s often simplest to:
- stop the stack
- delete `db_data_pg18` volume
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

---

## Host maintenance (Docker cleanup)

Each deploy pushes new `sha-*` tagged images via CI/CD. Without cleanup,
old images accumulate and eventually fill the disk.

### Crontab entries

Add these to the **host** crontab (`sudo crontab -e`):

```crontab
# Prune unused Docker images older than 7 days (daily, 3:30 AM UTC — after the 2 AM backup)
30 3 * * * docker image prune -a --filter "until=168h" -f >> /var/log/docker-prune.log 2>&1

# Clean build cache, stopped containers, and dangling networks older than 30 days (1st of month, 4 AM UTC)
0 4 1 * * docker system prune --filter "until=720h" -f >> /var/log/docker-prune.log 2>&1
```

**What each does:**

| Entry | Schedule | Effect |
|---|---|---|
| `docker image prune -a` | Daily 03:30 UTC | Removes images not used by any running container and older than 7 days. Running containers' images are **never** touched. |
| `docker system prune` | Monthly (1st) 04:00 UTC | Cleans build cache, stopped containers, and unused networks older than 30 days. |

### Verify

```bash
sudo crontab -l          # confirm entries are saved
cat /var/log/docker-prune.log   # check output after first run
```

### Warning: never automate volume pruning

`docker volume prune` or `docker system prune --volumes` will **destroy data
volumes** belonging to stopped containers (e.g. `db_data_pg18` if the DB crashed).
Only run volume cleanup manually after confirming backups are current.

