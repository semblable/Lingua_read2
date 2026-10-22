#!/bin/bash
# Periodic host resource & container health check (runs every 5 min from crontab).
# Alerts BACKUP_WEBHOOK_URL on:
#   - High disk usage on the host volume (/backups >= DISK_WARN_PCT, default 85%)
#   - High memory pressure on the host (MemAvailable < MEM_WARN_PCT of MemTotal, default 10%)
#   - Any container in this compose project that is stopped/exited/restarting or unhealthy
#   - Any container in this compose project that restarted (crash loop) or had a process
#     OOM-killed since the previous check
#   - Optional external HTTPS endpoint (EXTERNAL_HEALTH_URL) non-200 status or TLS cert expiring
#     (< SSL_WARN_DAYS, default 14d)
#
# Every issue has a stable key ("disk", "ram", "state:<container>", ...); measured values only go
# into the message, so a lasting problem alerts once even while its numbers drift.
#   - Conditions (disk, RAM, container state, external check) must show on two consecutive checks
#     before alerting, so a container recreated during a deploy never raises a false alarm, and
#     get a recovery message once they clear. Disk and RAM clear only HYSTERESIS_PCT points past
#     their threshold, so a value hovering at the line doesn't flap.
#   - Events (restarts, OOM kills) alert on the first check that sees them; a crash loop that
#     keeps going alerts once, and again only after a quiet check.
# State lives on the /backups volume, not /tmp, so it survives the deploy recreating this container
# (an open alert still gets its recovery message, and a known issue doesn't re-alert).
set -euo pipefail

[ -n "${BACKUP_WEBHOOK_URL:-}" ] || exit 0
# notify MESSAGE: posts to BACKUP_WEBHOOK_URL.
# shellcheck source=backup/notify.sh
. /notify.sh

# Skip while staging's nightly refresh is intentionally stopping the api container.
if pgrep -f refresh-from-prod.sh >/dev/null 2>&1; then
  exit 0
fi

DISK_WARN_PCT="${DISK_WARN_PCT:-85}"
MEM_WARN_PCT="${MEM_WARN_PCT:-10}"
HYSTERESIS_PCT="${HYSTERESIS_PCT:-5}"
SSL_WARN_DAYS="${SSL_WARN_DAYS:-14}"
EXTERNAL_HEALTH_URL="${EXTERNAL_HEALTH_URL:-}"
MEMINFO_PATH="${MEMINFO_PATH:-/proc/meminfo}"
DISK_PATH="${DISK_PATH:-/backups}"
STATE_DIR="${HEALTH_WATCH_STATE_DIR:-/backups/.health-watch}"
PENDING_FILE=$STATE_DIR/pending     # keys seen on the previous check, one per line
ALERTED_FILE=$STATE_DIR/alerted     # key<TAB>message of each condition alerted and not yet cleared
RESTARTS_FILE=$STATE_DIR/restarts   # "<container id> <restart count>" from the previous check
LAST_RUN_FILE=$STATE_DIR/last-run   # epoch of the previous check: start of the OOM event window
mkdir -p "$STATE_DIR"
env_label="${BACKUP_ENV:-unknown}"
project="${COMPOSE_PROJECT_NAME:-lingua-read}"
now_ts=$(date -u +%s)

declare -A pending=() alerted=() prev_restarts=() msg=() is_event=()
if [ -f "$PENDING_FILE" ]; then
  while IFS= read -r k; do [ -n "$k" ] && pending[$k]=1; done < "$PENDING_FILE"
fi
if [ -f "$ALERTED_FILE" ]; then
  while IFS=$'\t' read -r k m; do [ -n "$k" ] && alerted[$k]=$m; done < "$ALERTED_FILE"
fi
if [ -f "$RESTARTS_FILE" ]; then
  while read -r id n; do [ -n "$id" ] && prev_restarts[$id]=$n; done < "$RESTARTS_FILE"
fi
is_alerted() { [ -n "${alerted[$1]+x}" ]; }
# add_condition KEY MESSAGE / add_event KEY MESSAGE
add_condition() { msg[$1]=$2; }
add_event() { msg[$1]=$2; is_event[$1]=1; }

# 1. Host disk usage (via the mounted /backups volume on the root filesystem).
disk_pct=$(df -P "$DISK_PATH" 2>/dev/null | awk 'NR==2 {sub(/%/, "", $5); print $5}') || disk_pct=""
case $disk_pct in ''|*[!0-9]*) disk_pct="" ;; esac
disk_limit=$DISK_WARN_PCT
if is_alerted disk; then disk_limit=$((DISK_WARN_PCT - HYSTERESIS_PCT)); fi
if [ -n "$disk_pct" ] && [ "$disk_pct" -ge "$disk_limit" ]; then
  add_condition disk "disk at ${disk_pct}% (alert at ${DISK_WARN_PCT}%)"
fi

# 2. Host memory availability (/proc/meminfo reflects the host kernel).
if [ -r "$MEMINFO_PATH" ]; then
  mem_limit=$MEM_WARN_PCT
  if is_alerted ram; then mem_limit=$((MEM_WARN_PCT + HYSTERESIS_PCT)); fi
  mem_check=$(awk -v limit="$mem_limit" -v warn="$MEM_WARN_PCT" '
    /^MemTotal:/     { total = $2 }
    /^MemAvailable:/ { avail = $2 }
    END {
      if (total > 0 && avail > 0) {
        pct = int((avail * 100) / total)
        if (pct < limit) printf "available RAM at %d%% (%d MiB free, alert below %d%%)", pct, int(avail / 1024), warn
      }
    }
  ' "$MEMINFO_PATH")
  if [ -n "$mem_check" ]; then
    add_condition ram "$mem_check"
  fi
fi

# 3. Compose container states, restarts and OOM kills.
docker_ok=0
restarts_now=""
if ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project" 2>/dev/null); then
  docker_ok=1
else
  add_condition docker "Docker socket unreachable from the backup container"
  ids=""
fi
if [ -n "$ids" ]; then
  # One inspect for all ids; one that vanished in between (a deploy recreating it) is just skipped.
  # shellcheck disable=SC2086 # one argument per id
  inspect=$(docker inspect --format '{{.Id}}|{{.Name}}|{{.State.Status}}|{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}|{{.State.OOMKilled}}|{{.RestartCount}}|{{.State.ExitCode}}' $ids 2>/dev/null) || true
  while IFS='|' read -r id name status health oom count exit_code; do
    [ -n "$id" ] || continue
    name=${name#/}
    case $count in ''|*[!0-9]*) count=0 ;; esac
    restarts_now+="$id $count"$'\n'
    if [ "$status" != "running" ]; then
      detail=$status
      [ "$status" = "exited" ] && detail="exited (code $exit_code)"
      [ "$oom" = "true" ] && detail="$detail, OOM-killed"
      add_condition "state:$name" "$name is $detail"
    elif [ "$health" = "unhealthy" ]; then
      add_condition "state:$name" "$name is unhealthy"
    fi
    # RestartCount only grows on restart-policy restarts (crashes), never on a manual stop/start
    # or a deploy, and a recreated container has a new id, so neither of those alerts here. This
    # catches a crash loop even when every look at .State.Status happens to find it running.
    prev=${prev_restarts[$id]:-}
    if [ -n "$prev" ] && [ "$count" -gt "$prev" ]; then
      add_event "restart:$name" "$name restarted $((count - prev))x since the last check (restart count $count)"
    fi
  done <<< "$inspect"
fi
if [ "$docker_ok" = 1 ]; then
  # OOM kills from the daemon's event log rather than .State.OOMKilled: the flag stays true on a
  # running container after one of its processes was killed (so it can't clear), and a restart
  # can reset it before this check ever sees it.
  since=$(cat "$LAST_RUN_FILE" 2>/dev/null || true)
  case $since in ''|*[!0-9]*) since=$((now_ts - 300)) ;; esac
  [ "$since" -ge $((now_ts - 3600)) ] || since=$((now_ts - 3600))
  ooms=$(docker events --since "$since" --until "$now_ts" \
    --filter type=container --filter event=oom --filter "label=com.docker.compose.project=$project" \
    --format '{{.Actor.Attributes.name}}' 2>/dev/null | sort | uniq -c) || ooms=""
  while read -r n name; do
    [ -n "$name" ] || continue
    add_event "oom:$name" "$name had a process OOM-killed (${n}x since the last check)"
  done <<< "$ooms"
else
  # Without Docker the container checks above didn't run: keep their open alerts open rather than
  # announcing a recovery nobody observed.
  for k in "${!alerted[@]}"; do
    case $k in state:*) msg[$k]=${alerted[$k]} ;; esac
  done
fi

# 4. Optional external HTTPS & TLS certificate expiry check (e.g. staging probing production).
if [ -n "$EXTERNAL_HEALTH_URL" ]; then
  # stdout only (-w), never curl's stderr: its error text changes from one failure to the next.
  probe_rc=0
  probe_out=$(curl -s -m 10 -o /dev/null -w '%{http_code}\n%{certs}' "$EXTERNAL_HEALTH_URL" 2>/dev/null) || probe_rc=$?
  http_code=$(head -n 1 <<< "$probe_out")
  if [ "$probe_rc" -ne 0 ] || [ "$http_code" != "200" ]; then
    reason="HTTP ${http_code:-000}"
    [ "$probe_rc" -ne 0 ] && reason="$reason, curl exit $probe_rc"
    add_condition external "external check $EXTERNAL_HEALTH_URL failed ($reason)"
  else
    # "Expire date:Jan  1 00:00:00 2027 GMT" of the leaf (first) certificate -> "2027-01-01 00:00:00",
    # which both busybox and GNU date -d accept.
    exp_fmt=$(awk '
      BEGIN {
        split("Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec", m, " ")
        for (i = 1; i <= 12; i++) mon[m[i]] = sprintf("%02d", i)
      }
      /^Expire date:/ {
        sub(/^Expire date:[[:space:]]*/, "")
        printf "%s-%s-%02d %s\n", $4, mon[$1], $2, $3
        exit
      }
    ' <<< "$probe_out")
    if [ -n "$exp_fmt" ]; then
      exp_ts=$(date -u -d "$exp_fmt" +%s 2>/dev/null) || exp_ts=""
      if [ -n "$exp_ts" ]; then
        days_left=$(( (exp_ts - now_ts) / 86400 ))
        if [ "$days_left" -lt "$SSL_WARN_DAYS" ]; then
          add_condition cert "TLS certificate for $EXTERNAL_HEALTH_URL expires in ${days_left}d (alert under ${SSL_WARN_DAYS}d)"
        fi
      fi
    fi
  fi
fi

# 5. Decide what to send, then save the state for the next check.
new_alerts=""; resolved=""; still_open=""; next_alerted=""; next_pending=""
mapfile -t keys < <(printf '%s\n' "${!msg[@]}" | sort)
for k in "${keys[@]}"; do
  [ -n "$k" ] || continue
  next_pending+="$k"$'\n'
  if [ -n "${is_event[$k]+x}" ]; then
    [ -n "${pending[$k]+x}" ] || new_alerts+="${new_alerts:+; }${msg[$k]}"
  elif is_alerted "$k"; then
    next_alerted+="$k"$'\t'"${msg[$k]}"$'\n'
    still_open+="${still_open:+; }${msg[$k]}"
  elif [ -n "${pending[$k]+x}" ]; then
    next_alerted+="$k"$'\t'"${msg[$k]}"$'\n'
    new_alerts+="${new_alerts:+; }${msg[$k]}"
  fi
done
mapfile -t old_keys < <(printf '%s\n' "${!alerted[@]}" | sort)
for k in "${old_keys[@]}"; do
  [ -n "$k" ] || continue
  [ -n "${msg[$k]+x}" ] || resolved+="${resolved:+; }${alerted[$k]}"
done

printf '%s' "$next_pending" > "$PENDING_FILE"
printf '%s' "$next_alerted" > "$ALERTED_FILE"
if [ "$docker_ok" = 1 ]; then
  printf '%s' "$restarts_now" > "$RESTARTS_FILE"
  echo "$now_ts" > "$LAST_RUN_FILE"
fi

if [ -n "$new_alerts" ]; then
  notify "🚨 LinguaRead ($env_label) health alert: $new_alerts${still_open:+ (still open: $still_open)}"
fi
if [ -n "$resolved" ]; then
  if [ -z "$next_alerted" ]; then
    notify "✅ LinguaRead ($env_label) recovered, all checks passing. Cleared: $resolved"
  else
    notify "✅ LinguaRead ($env_label) cleared: $resolved (still open: ${still_open:-see previous alert})"
  fi
fi
