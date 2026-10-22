#!/bin/bash
# Periodic host resource & container health check (runs every 5 min from crontab).
# Alerts BACKUP_WEBHOOK_URL on:
#   - High disk usage on the host volume (/backups >= DISK_WARN_PCT, default 85%)
#   - High memory pressure on the host (MemAvailable < MEM_WARN_PCT of MemTotal, default 10%)
#   - Any container in this compose project that was OOM-killed, stopped/exited, or unhealthy
#   - Optional external HTTPS endpoint (EXTERNAL_HEALTH_URL) non-200 status or TLS cert expiring (< SSL_WARN_DAYS, default 14d)
#
# Uses a two-check confirmation (/tmp/health-watch.pending) for non-OOM issues so a brief
# container recreate during a deploy never triggers a false alarm, and deduplicates via
# /tmp/health-watch.alerted so the webhook is pinged once on failure and once on recovery.
set -euo pipefail

WEBHOOK_URL="${BACKUP_WEBHOOK_URL:-}"
[ -n "$WEBHOOK_URL" ] || exit 0

# Skip while staging's nightly refresh is intentionally stopping the api container.
if pgrep -f refresh-from-prod.sh >/dev/null 2>&1; then
  exit 0
fi

DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
MEM_WARN_PCT="${MEM_WARN_PCT:-10}"
SSL_WARN_DAYS="${SSL_WARN_DAYS:-14}"
EXTERNAL_HEALTH_URL="${EXTERNAL_HEALTH_URL:-}"
MEMINFO_PATH="${MEMINFO_PATH:-/proc/meminfo}"
DISK_PATH="${DISK_PATH:-/backups}"
PENDING_FILE=/tmp/health-watch.pending
ALERTED_FILE=/tmp/health-watch.alerted

notify() {
  local payload
  payload=$(awk -v s="$1" 'BEGIN {
    gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\r/, "", s); gsub(/\n/, "\\n", s); gsub(/\t/, "\\t", s)
    printf "{\"content\": \"%s\"}", s
  }')
  curl -fsS -m 10 --retry 3 -H "Content-Type: application/json" -d "$payload" "$WEBHOOK_URL" >/dev/null 2>&1 || true
}

issues=""
immediate=0
add_issue() {
  issues="${issues:+$issues; }$1"
}

# 1. Host disk usage (via the mounted /backups volume on the root filesystem).
disk_pct=$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {sub(/%/, "", $5); print $5}') || disk_pct=""
if [ -n "$disk_pct" ] && [ "$disk_pct" -ge "$DISK_WARN_PCT" ]; then
  add_issue "disk at ${disk_pct}% (>=${DISK_WARN_PCT}%)"
fi

# 2. Host memory availability (/proc/meminfo reflects the host kernel).
if [ -r "$MEMINFO_PATH" ]; then
  mem_check=$(awk -v warn="$MEM_WARN_PCT" '
    /^MemTotal:/     { total = $2 }
    /^MemAvailable:/ { avail = $2 }
    END {
      if (total > 0 && avail > 0) {
        pct = int((avail * 100) / total)
        if (pct < warn) printf "available RAM at %d%% (%d MiB free)", pct, int(avail / 1024)
      }
    }
  ' "$MEMINFO_PATH")
  if [ -n "$mem_check" ]; then
    add_issue "$mem_check"
  fi
fi

# 3. Compose container states & OOM-kill flag.
project="${COMPOSE_PROJECT_NAME:-lingua-read}"
ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null) || {
  add_issue "docker socket unreachable"
  ids=""
}
for id in $ids; do
  line=$(docker inspect --format '{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.OOMKilled}}' "$id" 2>/dev/null) || continue
  name=${line%%|*}; rest=${line#*|}
  name=${name#/}
  status=${rest%%|*}; rest=${rest#*|}
  health=${rest%%|*}; oom=${rest#*|}
  if [ "$oom" = "true" ]; then
    add_issue "$name was OOM-killed (status: $status)"
    immediate=1
  elif [ "$status" != "running" ]; then
    add_issue "$name is $status"
  elif [ "$health" = "unhealthy" ]; then
    add_issue "$name is unhealthy"
  fi
done

# 4. Optional external HTTPS & TLS certificate expiry check (e.g. staging probing production).
if [ -n "$EXTERNAL_HEALTH_URL" ]; then
  probe_out=$(curl -sS -m 10 -o /dev/null -w "%{http_code}\n%{certs}" "$EXTERNAL_HEALTH_URL" 2>&1) && probe_rc=0 || probe_rc=$?
  http_code=$(printf '%s\n' "$probe_out" | head -n 1)
  if [ "$probe_rc" -ne 0 ] || [ "$http_code" != "200" ]; then
    add_issue "external check $EXTERNAL_HEALTH_URL failed (HTTP ${http_code:-error})"
  else
    exp_fmt=$(printf '%s\n' "$probe_out" | awk '
      BEGIN {
        split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", m, " ")
        for (i = 1; i <= 12; i++) mon[m[i]] = sprintf("%02d", i)
      }
      /^Expire date:/ {
        sub(/^Expire date:[[:space:]]*/, "")
        printf "%s.%s.%02d-%s\n", $4, mon[$1], $2, $3
        exit
      }
    ')
    if [ -n "$exp_fmt" ]; then
      exp_ts=$(date -u -d "$exp_fmt" +%s 2>/dev/null) || exp_ts=""
      now_ts=$(date -u +%s)
      if [ -n "$exp_ts" ]; then
        days_left=$(( (exp_ts - now_ts) / 86400 ))
        if [ "$days_left" -lt "$SSL_WARN_DAYS" ]; then
          add_issue "TLS certificate for $EXTERNAL_HEALTH_URL expires in ${days_left}d (<${SSL_WARN_DAYS}d)"
        fi
      fi
    fi
  fi
fi

if [ -n "$issues" ]; then
  prev_alerted=""
  [ -f "$ALERTED_FILE" ] && prev_alerted=$(cat "$ALERTED_FILE")
  if [ "$issues" = "$prev_alerted" ]; then
    exit 0
  fi
  if [ "$immediate" = 1 ] || [ -f "$PENDING_FILE" ]; then
    printf '%s' "$issues" > "$ALERTED_FILE"
    rm -f "$PENDING_FILE"
    notify "🚨 LinguaRead (${BACKUP_ENV:-unknown}) health alert: $issues"
  else
    printf '%s' "$issues" > "$PENDING_FILE"
  fi
else
  rm -f "$PENDING_FILE"
  if [ -f "$ALERTED_FILE" ]; then
    rm -f "$ALERTED_FILE"
    notify "✅ LinguaRead (${BACKUP_ENV:-unknown}) recovered: all containers healthy${disk_pct:+, disk ${disk_pct}% used}."
  fi
fi
