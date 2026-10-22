#!/bin/bash
# Sourced (not run) by backup.sh, refresh-from-prod.sh and health-watch.sh.
#
# notify MESSAGE  POSTs {"content": MESSAGE} to BACKUP_WEBHOOK_URL (a Discord-style webhook).
# A no-op while the URL is unset. Best effort: a 10 s timeout and 3 retries, and it never fails
# the caller, so an unreachable webhook can't turn a working backup into a failed one.
notify() {
  [ -n "${BACKUP_WEBHOOK_URL:-}" ] || return 0
  # JSON-escape in bash (the image has no jq, and busybox awk's gsub treats \\ differently from
  # gawk). Discord rejects content over 2000 characters, so cut a long message short rather than
  # losing the alert.
  local s=${1:0:1900} bs='\'
  [ "${#1}" -gt 1900 ] && s="${1:0:1897}..."
  s=${s//"$bs"/"$bs$bs"}
  s=${s//\"/"$bs\""}
  s=${s//$'\r'/}
  s=${s//$'\n'/"${bs}n"}
  s=${s//$'\t'/"${bs}t"}
  curl -fsS -m 10 --retry 3 -H "Content-Type: application/json" -d "{\"content\": \"$s\"}" "$BACKUP_WEBHOOK_URL" >/dev/null 2>&1 || true
}
