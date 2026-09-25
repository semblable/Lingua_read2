#!/bin/bash
# Nightly refresh of STAGING from production's latest backup on Google Drive: the media volumes
# (mirrored) and the database (restored into a side database, then swapped in).
#
# Runs in the staging backup container (see crontab). Does nothing unless REFRESH_FROM_PROD=1,
# which _deploy.yml only ever writes for the staging environment, and refuses to run anywhere
# BACKUP_ENV isn't "staging". It only reads from production's Drive folder.
#
# What staging keeps across a refresh:
#   - its own translation-provider and AI-provider keys (KEEP_SECRET_COLUMNS, UserAiProviders).
#     Production's secrets are encrypted with production's Data Protection keys, which never leave
#     production, so staging can't use them anyway; they are all cleared and only staging's
#     translation and AI keys are put back. The Hardcover token and Discord webhook stay empty:
#     staging must not write to those accounts (the api also refuses to there, via
#     ExternalWrites__Disabled).
#   - the previous database, as ${POSTGRES_DB}_prev, until the next refresh (manual rollback:
#     stop api, swap the names back, start api).
# Everything else (users, texts, words, media) becomes production's.
set -euo pipefail

log() { echo "[refresh $(date -u +%H:%M:%S)] $*"; }
die() { log "FAILED: $*"; exit 1; }

[ "${REFRESH_FROM_PROD:-0}" = "1" ] || exit 0
[ "${BACKUP_ENV:-}" = "staging" ] \
  || die "BACKUP_ENV is '${BACKUP_ENV:-}', not 'staging'; refusing to overwrite this environment"

SOURCE="${REFRESH_SOURCE:-gdrive:lingua-read-backups/production}"
DB="${POSTGRES_DB:?POSTGRES_DB must be set}"
NEW_DB="${DB}_refresh"
PREV_DB="${DB}_prev"
FAILED_DB="${DB}_failed"
WORK=/backups/prod-refresh
MEDIA_DIRS="audio_lessons audiobooks epub_assets hardcover-covers"
# The UserSettings columns AppDbContext encrypts with Data Protection. RefreshFromProdScriptTests
# fails when this list and the model drift apart. The only other encrypted column,
# "UserAiProviders"."ApiKey" (AI provider keys), is handled in step 4 by name.
SECRET_COLUMNS="AzureTranslatorKey GoogleTranslateApiKey WiktionaryAccessToken HardcoverApiToken DiscordWebhookUrl"
# The subset staging keeps its own values for: lookup-only providers, no writes to user accounts.
# Staging keeps its own AI provider keys too.
KEEP_SECRET_COLUMNS="AzureTranslatorKey GoogleTranslateApiKey WiktionaryAccessToken"
# Encrypted UserSettings columns of older schemas, cleared when production still has them.
LEGACY_SECRET_COLUMNS="OpenRouterApiKey"
export PGHOST="${PGHOST:-db}" PGUSER="${POSTGRES_USER:?}" PGPASSWORD="${POSTGRES_PASSWORD:?}"
export PGOPTIONS="-c client_min_messages=warning"   # no NOTICEs for DROP ... IF EXISTS

exec 9>/tmp/refresh-from-prod.lock
flock -n 9 || die "another refresh is already running"

API=""
API_STOPPED=0
on_exit() {
  # prod.backup too, also after a failure: backup.sh uploads /backups to staging's Drive folder,
  # where no retention rule would ever remove a leftover copy of production's database.
  rm -f "$WORK/staging-secrets.tsv" "$WORK/staging-ai-keys.tsv" "$WORK/prod.backup"
  if [ "$API_STOPPED" = 1 ]; then
    log "restarting api after an interrupted refresh"
    docker start "$API" >/dev/null || true
  fi
}
trap on_exit EXIT

mkdir -p "$WORK"
RCLONE_CONF=/tmp/rclone-refresh.conf
if [ -f /rclone/rclone.conf ]; then cp /rclone/rclone.conf "$RCLONE_CONF"; else : > "$RCLONE_CONF"; fi
rc() { rclone "$@" --config "$RCLONE_CONF"; }
psql_admin() { psql -X -q -v ON_ERROR_STOP=1 -d postgres "$@"; }

started=$(date +%s)
log "=== refresh from $SOURCE started ==="

# --- 1. latest production dump ---------------------------------------------
listing=$(rc lsf -R --files-only --include 'db-*.backup' "$SOURCE/db")   || die "can't list production dumps under $SOURCE/db"
latest=$(printf '%s
' "$listing" | sort | tail -n 1)
[ -n "$latest" ] || die "no production dump found under $SOURCE/db"
stamp=$(basename "$latest" .backup)
stamp=${stamp#db-}
dump_epoch=$(date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s 2>/dev/null || echo 0)
age_h=$(( ($(date +%s) - dump_epoch) / 3600 ))
log "latest production dump: $latest (${age_h} h old)"
[ "$age_h" -le 36 ] || log "WARNING: the newest production dump is over 36 h old; is production's backup failing?"
rc copyto "$SOURCE/db/$latest" "$WORK/prod.backup"
pg_restore --list "$WORK/prod.backup" >/dev/null || die "downloaded dump is not a readable pg_dump archive"

# --- 2. media: mirror production's Drive copy into staging's volumes ---------
# Before the database swap, so the swapped-in rows find their files.
for d in $MEDIA_DIRS; do
  dest="/srv/media/$d"
  if ! [ -d "$dest" ] || ! [ -w "$dest" ]; then
    log "WARNING: $dest is not a writable mount (BACKUP_MEDIA_MOUNT=rw?); media not refreshed"
    continue
  fi
  if ! rc lsf --max-depth 1 "$SOURCE/media/current/$d" >/dev/null 2>&1; then
    log "media/$d: not in production's backup, left as is"
    continue
  fi
  owner=$(stat -c '%u:%g' "$dest")
  # rclone skips deletions when a transfer fails, so a flaky run can't empty the volume.
  rc sync "$SOURCE/media/current/$d" "$dest" --transfers 2 --checkers 4
  chown -R "$owner" "$dest"   # the api runs unprivileged and writes into these directories
  log "media/$d: $(find "$dest" -type f | wc -l) files"
done

# --- 3. restore into a side database ------------------------------------------
psql_admin -c "DROP DATABASE IF EXISTS \"$NEW_DB\" WITH (FORCE)" -c "CREATE DATABASE \"$NEW_DB\""
pg_restore --no-owner --no-acl --exit-on-error -d "$NEW_DB" "$WORK/prod.backup"
log "restored into $NEW_DB: $(psql -X -At -d "$NEW_DB" -c 'SELECT count(*) FROM "Words"') words"

# --- 4. keep staging's own integration secrets --------------------------------
# Production can be a release behind staging, so the restored database may have an older schema
# than staging's own: only columns and tables a database actually has are touched.
has_table() { [ "$(psql -X -At -d "$1" -c "SELECT to_regclass('public.\"$2\"') IS NOT NULL")" = t ]; }
has_column() {
  [ "$(psql -X -At -d "$1" -c "SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '$2' AND column_name = '$3'")" = 1 ]
}

set_null=""
for c in $SECRET_COLUMNS $LEGACY_SECRET_COLUMNS; do
  if has_column "$NEW_DB" UserSettings "$c"; then set_null+="${set_null:+, }\"$c\" = NULL"; fi
done
col_list=""; set_from=""; col_defs=""
for c in $KEEP_SECRET_COLUMNS; do
  if has_column "$DB" UserSettings "$c" && has_column "$NEW_DB" UserSettings "$c"; then
    col_list+="${col_list:+, }\"$c\""
    set_from+="${set_from:+, }\"$c\" = staging_secrets.\"$c\""
    col_defs+=", \"$c\" text"
  fi
done
: > "$WORK/staging-secrets.tsv"
: > "$WORK/staging-ai-keys.tsv"
chmod 600 "$WORK/staging-secrets.tsv" "$WORK/staging-ai-keys.tsv"
if [ -n "$col_list" ]; then
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" \
    -c "\\copy (SELECT \"UserId\", $col_list FROM \"UserSettings\") TO '$WORK/staging-secrets.tsv'"
fi

# AI provider keys, one (user, provider, key) row each. Before the AddAiProviders migration the only
# one was OpenRouter's, in a UserSettings column.
if has_table "$DB" UserAiProviders; then
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" \
    -c "\\copy (SELECT \"UserId\", \"Provider\", \"ApiKey\" FROM \"UserAiProviders\" WHERE \"ApiKey\" IS NOT NULL) TO '$WORK/staging-ai-keys.tsv'"
elif has_column "$DB" UserSettings OpenRouterApiKey; then
  psql -X -q -v ON_ERROR_STOP=1 -d "$DB" \
    -c "\\copy (SELECT \"UserId\", 'openrouter', \"OpenRouterApiKey\" FROM \"UserSettings\" WHERE \"OpenRouterApiKey\" IS NOT NULL) TO '$WORK/staging-ai-keys.tsv'"
fi
if has_table "$NEW_DB" UserAiProviders; then
  ai_keys_sql="UPDATE \"UserAiProviders\" SET \"ApiKey\" = NULL;
INSERT INTO \"UserAiProviders\" (\"UserId\", \"Provider\", \"ApiKey\")
SELECT k.\"UserId\", k.\"Provider\", k.\"ApiKey\" FROM staging_ai_keys k JOIN \"Users\" u ON u.\"Id\" = k.\"UserId\"
ON CONFLICT (\"UserId\", \"Provider\") DO UPDATE SET \"ApiKey\" = EXCLUDED.\"ApiKey\";"
elif has_column "$NEW_DB" UserSettings OpenRouterApiKey; then
  # Production predates AddAiProviders; that migration moves this column into UserAiProviders
  # when staging's api starts on the refreshed database. Other providers' keys can't be kept.
  ai_keys_sql="UPDATE \"UserSettings\" u SET \"OpenRouterApiKey\" = k.\"ApiKey\"
FROM staging_ai_keys k WHERE u.\"UserId\" = k.\"UserId\" AND k.\"Provider\" = 'openrouter';"
else
  ai_keys_sql=""
fi

clear_sql=""; keep_sql=""
if [ -n "$set_null" ]; then clear_sql="UPDATE \"UserSettings\" SET $set_null;"; fi
if [ -n "$set_from" ]; then
  keep_sql="UPDATE \"UserSettings\" u SET $set_from FROM staging_secrets WHERE u.\"UserId\" = staging_secrets.\"UserId\";"
fi
psql -X -q -v ON_ERROR_STOP=1 -d "$NEW_DB" <<SQL
BEGIN;
$clear_sql
CREATE TEMP TABLE staging_secrets ("UserId" uuid$col_defs);
\copy staging_secrets FROM '$WORK/staging-secrets.tsv'
$keep_sql
CREATE TEMP TABLE staging_ai_keys ("UserId" uuid, "Provider" text, "ApiKey" text);
\copy staging_ai_keys FROM '$WORK/staging-ai-keys.tsv'
$ai_keys_sql
COMMIT;
SQL
log "kept staging's translation keys for $(wc -l < "$WORK/staging-secrets.tsv") user(s) and $(wc -l < "$WORK/staging-ai-keys.tsv") AI provider key(s); Hardcover and Discord cleared"

# --- 5. swap the databases while the api is stopped ---------------------------
project=$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$HOSTNAME")
API=$(docker ps -aq --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=api" | head -n 1)
[ -n "$API" ] || die "api container of compose project '$project' not found"

# swap <database to make live> <name to give the current live database>
# The two renames share a transaction, so a failure leaves the old names in place.
swap() {
  psql_admin -c "DROP DATABASE IF EXISTS \"$2\" WITH (FORCE)"
  psql_admin <<SQL
SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE datname = '$DB' AND pid <> pg_backend_pid();
BEGIN;
ALTER DATABASE "$DB" RENAME TO "$2";
ALTER DATABASE "$1" RENAME TO "$DB";
COMMIT;
SQL
}

wait_healthy() {
  local status
  for _ in $(seq 1 120); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$API")
    case "$status" in
      healthy|running) return 0 ;;
      unhealthy|exited|dead) return 1 ;;
    esac
    sleep 5
  done
  return 1
}

log "stopping api for the swap"
docker stop "$API" >/dev/null
API_STOPPED=1
swap "$NEW_DB" "$PREV_DB" >/dev/null
docker start "$API" >/dev/null
API_STOPPED=0
log "api started on the refreshed database (it applies staging's pending migrations now)"

if ! wait_healthy; then
  log "api is not healthy on the refreshed database; putting the previous one back"
  docker stop "$API" >/dev/null
  API_STOPPED=1
  swap "$PREV_DB" "$FAILED_DB" >/dev/null
  docker start "$API" >/dev/null
  API_STOPPED=0
  die "kept the refreshed copy as $FAILED_DB for inspection; staging is back on its previous data"
fi

log "=== refresh done in $(( $(date +%s) - started )) s (previous database kept as $PREV_DB) ==="
