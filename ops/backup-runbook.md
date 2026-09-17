## Lingua-Read backups (DB + media)

This repo’s Docker stack persists:
- **Postgres data**: `db_data_pg18` volume
- **Audio lessons**: `api_audio_lessons` volume
- **Audiobooks**: `api_audiobooks` volume
- **EPUB assets**: `api_epub_assets` volume
- **Data Protection keys**: `api_dp_keys` volume — **deliberately not backed up offsite**

Backups should cover **both** the database and the media volumes.

`api_dp_keys` only decrypts the integration secrets saved in Settings (Azure Translator and
Google Translate keys, Wiktionary token, OpenRouter key, Hardcover token, Discord webhook).
Uploading it next to the DB dump would hand anyone with the Drive folder those secrets in
the clear. Losing it doesn't affect logins (the auth cookie is a JWT signed with `JWT_KEY`):
after a restore onto a fresh volume those six fields read as unset (an error is logged) and
are re-entered in Settings. For a **planned host move**, copy the volume directly instead —
same throwaway-container `cp -a` as the restore below, with `lingua-read_api_dp_keys`.

### Automated nightly backup (the `backup` sidecar)

Runs at 00:00 UTC once `secrets/rclone.conf` exists in the deploy dir (the deploy starts the
`backup` profile only then). Each environment writes to its own Drive folder,
`gdrive:lingua-read-backups/<BACKUP_ENV>/` — `BACKUP_ENV` is appended to `.env` by the
deploy, and `backup.sh` refuses to run without it:

| Path | Contents | Kept on Drive |
|---|---|---|
| `db/<yyyy>/<mm>/db-<ts>.backup` | full `pg_dump -Fc`, every night | 90 days |
| `media/current/<volume>/` | mirror of the three media volumes (audio lessons, audiobooks, EPUB assets) | always (it's the live copy) |
| `media/deleted/<ts>/<volume>/` | files removed or replaced since the previous night | 90 days |
| `logs/`, `errors/` | last 24 h of container logs, and the error lines from them | 30 days |

Media is **incremental**: `rclone sync` compares size + modification time and uploads only
new or changed files, so after the first full upload a night costs only that day's uploads.

**Enable on a host** — authorize on a machine with a browser, then copy the config over:

```bash
rclone config create gdrive drive scope=drive.file   # drive.file: rclone sees only what it created
scp ~/.config/rclone/rclone.conf deploy@HOST:/opt/lingua-read/secrets/rclone.conf   # Windows: %APPDATA%\rclone\rclone.conf
```

Then redeploy (or `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile backup up -d backup`).
Run one immediately: `docker compose … --profile backup exec backup /backup.sh`.

**Restore from Drive:** `rclone copy gdrive:lingua-read-backups/production/media/current/audio_lessons ./audio_lessons`
(etc.), then load it into the volume with a throwaway container
(`docker run --rm -v lingua-read_api_audio_lessons:/data -v "$PWD/audio_lessons:/src:ro" alpine cp -a /src/. /data/`);
the database restore is §3 below.

The manual procedures that follow still work for one-off copies.

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

`ops/bootstrap-host.sh` installs these as `/etc/cron.d/docker-prune`. On a host set up by hand, add them to the **host** crontab (`sudo crontab -e`):

```crontab
# Prune unused Docker images older than 7 days (daily, 3:30 AM UTC — after the 2 AM backup)
30 1 * * * docker image prune -a --filter "until=168h" -f >> /var/log/docker-prune.log 2>&1

# Clean build cache, stopped containers, and dangling networks older than 30 days (1st of month, 4 AM UTC)
45 1 1 * * docker system prune --filter "until=720h" -f >> /var/log/docker-prune.log 2>&1
```

**What each does:**

| Entry | Schedule | Effect |
|---|---|---|
| `docker image prune -a` | Daily 01:30 UTC | Removes images not used by any running container and older than 7 days. Running containers' images are **never** touched. |
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

