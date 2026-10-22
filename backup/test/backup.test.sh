#!/bin/bash
# Runs /backup.sh inside the backup image (backup/test/run.sh pipes this in) against a local folder
# standing in for Google Drive, with pg_dump and docker stubbed, and checks the retention rules:
# what gets uploaded, what Drive retention removes, and what the local /backups volume keeps.
set -euo pipefail

# An rclone "local" remote resolves its path against the working directory, so from /drive,
# backup.sh's gdrive:lingua-read-backups/test is this folder.
DRIVE=/drive/lingua-read-backups/test
B=/backups
now=$(date +%s)

# --- stubs --------------------------------------------------------------------
mkdir -p /stubs /rclone /drive
cat > /stubs/pg_dump <<'EOF'
#!/bin/sh
# Writes a placeholder dump to the -f argument.
while [ $# -gt 0 ]; do
  if [ "$1" = -f ]; then echo dump > "$2"; exit 0; fi
  shift
done
exit 1
EOF
cat > /stubs/docker <<'EOF'
#!/bin/sh
# `docker ps`: one compose container (scoped to lingua-read); `docker logs`: a line for logs/ and one for errors/.
case "$1" in
  ps)
    case "$*" in
      *label=com.docker.compose.project=lingua-read*) echo lingua-read-api-1 ;;
      *) echo "unscoped docker ps: $*" >&2; exit 1 ;;
    esac
    ;;
  inspect) echo "${STUB_INSPECT:-/lingua-read-api-1|running|healthy|false}" ;;
  logs) echo "info: started"; echo "fail: something broke" ;;
esac
EOF
cat > /stubs/curl <<'EOF'
#!/bin/sh
# Captures JSON payloads sent to BACKUP_WEBHOOK_URL in /tmp/webhook.log.
while [ $# -gt 0 ]; do
  if [ "$1" = -d ]; then printf '%s\n' "$2" >> /tmp/webhook.log; shift 2; continue; fi
  shift
done
exit 0
EOF
chmod +x /stubs/*
export PATH="/stubs:$PATH"
printf '[gdrive]\ntype = local\n' > /rclone/rclone.conf
for d in audio_lessons audiobooks epub_assets hardcover-covers; do mkdir -p "/srv/media/$d"; done
echo cover > /srv/media/hardcover-covers/1.jpg

# --- fixtures: files of known age (days) --------------------------------------
seed() {
  mkdir -p "$(dirname "$1")"
  echo "$1" > "$1"
  touch -d "@$(( now - $2 * 86400 ))" "$1"
}
# .sql.gz dumps of the April 2026 script, left behind when the local prune began matching only *.backup.
seed "$B/db/db-175d.sql.gz"                175
seed "$B/db/old-year/04/db-174d.sql.gz"    174
seed "$B/db/fixture/db-10d.backup"         10
seed "$B/db/fixture/db-3d.backup"          3
seed "$B/logs/fixture/api-40d.log"         40
seed "$B/logs/fixture/api-20d.log"         20
seed "$B/errors/fixture/api-40d.err"       40
seed "$B/prod-refresh/prod.backup"         0
# Uploaded by earlier runs.
seed "$DRIVE/db/fixture/db-100d.backup"    100
seed "$DRIVE/db/fixture/db-60d.backup"     60
seed "$DRIVE/logs/fixture/api-35d.log"     35

# --- run ----------------------------------------------------------------------
cd /drive
: > /tmp/webhook.log
set +e
BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d /backup.sh > /tmp/backup.log 2>&1
status=$?
set -e

# --- checks -------------------------------------------------------------------
failures=0
check() {
  local what=$1; shift
  if "$@"; then echo "ok   $what"; else echo "FAIL $what"; failures=$((failures + 1)); fi
}
exists() { [ -e "$1" ]; }
absent() { [ ! -e "$1" ]; }
found() { [ -n "$(find "$@")" ]; }
none_found() { [ -z "$(find "$@")" ]; }
# rclone logs "<path relative to the copied folder>: Copied (new)" per uploaded file.
not_uploaded() { ! grep -qF "${1#*/}: Copied" /tmp/backup.log; }
month="$(date +%Y)/$(date +%m)"

check "backup.sh exits 0"                              [ "$status" -eq 0 ]

check "today's dump is uploaded"                       found "$DRIVE/db/$month" -name 'db-*.backup'
check "today's logs are uploaded"                      found "$DRIVE/logs/$month" -name 'lingua-read-api-1-*.log'
check "today's error extract is uploaded"              found "$DRIVE/errors/$month" -name 'lingua-read-api-1-*.err'
check "a 3-day-old dump is uploaded"                   exists "$DRIVE/db/fixture/db-3d.backup"
check "a 10-day-old dump is uploaded"                  exists "$DRIVE/db/fixture/db-10d.backup"
check "a 20-day-old log is uploaded"                   exists "$DRIVE/logs/fixture/api-20d.log"
check "media is mirrored"                              exists "$DRIVE/media/current/hardcover-covers/1.jpg"

# From rclone's log, not from what is on Drive afterwards: retention later in the same run deletes
# these again, so they would be missing from Drive either way.
check "a 175-day-old .sql.gz is not uploaded"          not_uploaded db/db-175d.sql.gz
check "a 174-day-old .sql.gz is not uploaded"          not_uploaded db/old-year/04/db-174d.sql.gz
check "a 40-day-old log is not uploaded"               not_uploaded logs/fixture/api-40d.log
check "a 40-day-old error extract is not uploaded"     not_uploaded errors/fixture/api-40d.err
check "prod-refresh/ is not uploaded"                  not_uploaded prod-refresh/prod.backup

check "Drive keeps a 60-day-old dump"                  exists "$DRIVE/db/fixture/db-60d.backup"
check "Drive drops a 100-day-old dump"                 absent "$DRIVE/db/fixture/db-100d.backup"
check "Drive drops a 35-day-old log"                   absent "$DRIVE/logs/fixture/api-35d.log"

check "the volume keeps today's dump"                  found "$B/db/$month" -name 'db-*.backup'
check "the volume keeps a 3-day-old dump"              exists "$B/db/fixture/db-3d.backup"
check "the volume keeps prod-refresh/"                 exists "$B/prod-refresh/prod.backup"
check "the volume holds nothing over 7 days old"       none_found "$B/db" "$B/logs" "$B/errors" -type f -mtime +7
check "the volume has no empty folders left"           none_found "$B/db" "$B/logs" "$B/errors" -mindepth 1 -type d -empty
check "a clean run sends no failure webhook"           [ ! -s /tmp/webhook.log ]

# A broken Docker socket (e.g. dockerd restarted under live-restore) must not prevent
# the database dump and media from reaching Drive, and should notify the webhook.
cat > /stubs/docker <<'EOF'
#!/bin/sh
echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2
exit 1
EOF
rm -rf "$DRIVE/db/$month"
: > /tmp/webhook.log
set +e
BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d /backup.sh > /tmp/backup-no-docker.log 2>&1
no_docker_status=$?
set -e
check "backup.sh still exits 0 when docker ps fails"   [ "$no_docker_status" -eq 0 ]
check "dump still uploads when docker ps fails"        found "$DRIVE/db/$month" -name 'db-*.backup'
check "webhook warns when docker ps fails"             grep -qF 'docker ps failed' /tmp/webhook.log

# A fatal error (e.g. pg_dump failure) must exit non-zero and ping the failure webhook.
cat > /stubs/pg_dump <<'EOF'
#!/bin/sh
exit 1
EOF
: > /tmp/webhook.log
set +e
BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report POSTGRES_USER=u POSTGRES_PASSWORD=p POSTGRES_DB=d /backup.sh > /tmp/backup-fail.log 2>&1
fail_status=$?
set -e
check "backup.sh exits non-zero when pg_dump fails"    [ "$fail_status" -ne 0 ]
check "webhook alerts when backup.sh fails"            grep -qF 'FAILED (exit' /tmp/webhook.log

# --- health-watch.sh checks ---------------------------------------------------
cat > /stubs/docker <<'EOF'
#!/bin/sh
case "$1" in
  ps)      echo lingua-read-api-1 ;;
  inspect) echo "${STUB_INSPECT:-/lingua-read-api-1|running|healthy|false}" ;;
esac
EOF
chmod +x /stubs/docker
printf 'MemTotal:       4000000 kB\nMemAvailable:   2000000 kB\n' > /tmp/meminfo.ok
: > /tmp/webhook.log
rm -f /tmp/health-watch.pending /tmp/health-watch.alerted

BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report MEMINFO_PATH=/tmp/meminfo.ok DISK_WARN_PCT=99 /health-watch.sh
check "health-watch is silent when healthy"            [ ! -f /tmp/health-watch.pending ]

# Non-OOM failure requires 2 consecutive checks before alerting; deduplicates; then alerts on recovery.
STUB_INSPECT="/lingua-read-api-1|exited|none|false" \
  BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report MEMINFO_PATH=/tmp/meminfo.ok DISK_WARN_PCT=99 /health-watch.sh
check "health-watch 1st non-OOM failure only stages pending" [ ! -s /tmp/webhook.log ]

STUB_INSPECT="/lingua-read-api-1|exited|none|false" \
  BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report MEMINFO_PATH=/tmp/meminfo.ok DISK_WARN_PCT=99 /health-watch.sh
check "health-watch 2nd consecutive failure alerts"    grep -qF 'lingua-read-api-1 is exited' /tmp/webhook.log

: > /tmp/webhook.log
STUB_INSPECT="/lingua-read-api-1|exited|none|false" \
  BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report MEMINFO_PATH=/tmp/meminfo.ok DISK_WARN_PCT=99 /health-watch.sh
check "health-watch deduplicates repeated failure"     [ ! -s /tmp/webhook.log ]

BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report MEMINFO_PATH=/tmp/meminfo.ok DISK_WARN_PCT=99 /health-watch.sh
check "health-watch alerts on recovery"                grep -qF 'recovered: all containers healthy' /tmp/webhook.log

# OOM-kill alerts immediately on the first check without waiting for a second strike.
: > /tmp/webhook.log
STUB_INSPECT="/lingua-read-api-1|running|healthy|true" \
  BACKUP_ENV=test BACKUP_WEBHOOK_URL=http://webhook.test/report MEMINFO_PATH=/tmp/meminfo.ok DISK_WARN_PCT=99 /health-watch.sh
check "health-watch alerts immediately on OOMKilled"   grep -qF 'was OOM-killed' /tmp/webhook.log

if [ "$failures" -gt 0 ]; then
  echo "--- backup.sh output"
  cat /tmp/backup.log
  echo "$failures check(s) failed"
  exit 1
fi
echo "all checks passed"
