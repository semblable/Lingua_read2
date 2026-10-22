#!/bin/bash
# Sourced (not run) by backup.sh, refresh-from-prod.sh and health-watch.sh.
#
# notify MESSAGE  POSTs {"content": MESSAGE} to BACKUP_WEBHOOK_URL (a Discord-style webhook).
# A no-op while the URL is unset. Best effort: a 10 s timeout and 3 retries, and it never fails
# the caller, so an unreachable webhook can't turn a working backup into a failed one.
notify() {
  [ -n "${BACKUP_WEBHOOK_URL:-}" ] || return 0
  local payload
  # JSON-escape by hand (the image has no jq). Discord rejects content over 2000 characters, so a
  # long message (many issues at once) is cut short rather than lost.
  payload=$(MSG="$1" awk 'BEGIN {
    s = ENVIRON["MSG"]
    if (length(s) > 1900) s = substr(s, 1, 1897) "..."
    gsub(/\\/, "\\\\", s); gsub(/"/, "\\\"", s); gsub(/\r/, "", s); gsub(/\n/, "\\n", s); gsub(/\t/, "\\t", s)
    printf "{\"content\": \"%s\"}", s
  }')
  curl -fsS -m 10 --retry 3 -H "Content-Type: application/json" -d "$payload" "$BACKUP_WEBHOOK_URL" >/dev/null 2>&1 || true
}
