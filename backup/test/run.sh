#!/bin/bash
# Tests backup.sh's upload and retention rules in the image it ships in (busybox find and date, the
# packaged rclone), with no Drive, database or Docker socket: backup.test.sh stubs them.
# Usage: backup/test/run.sh [image]   Without an image, builds backup/ as lingua-read-backup:test.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
image=${1:-}
if [ -z "$image" ]; then
  image=lingua-read-backup:test
  docker build -q -t "$image" "$here/.." > /dev/null
fi
docker run --rm -i --entrypoint bash "$image" -s < "$here/backup.test.sh"
