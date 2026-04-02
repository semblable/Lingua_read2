#!/bin/bash
# One-time setup: installs rclone and configures Google Drive access
set -e

echo "=== Lingua-Read Backup Setup ==="

# 1. Install rclone if missing
if ! command -v rclone &> /dev/null; then
  echo "Installing rclone..."
  curl https://rclone.org/install.sh | sudo bash
fi

# 2. Create secrets directory
mkdir -p secrets

# 3. Configure Google Drive (headless server mode)
RCLONE_CONF="secrets/rclone.conf"
if [ ! -f "$RCLONE_CONF" ]; then
  echo ""
  echo "=== Google Drive Setup ==="
  echo "We'll configure rclone for Google Drive."
  echo ""
  echo "IMPORTANT — This is a headless server. When rclone asks:"
  echo "  'Use web browser to automatically authenticate? (y/n)'"
  echo "  → Answer: n"
  echo ""
  echo "It will give you a URL. Open it on your LOCAL machine"
  echo "(the one with a browser), paste the code it gives you back here."
  echo ""
  echo "OR: On your LOCAL machine, run: rclone authorize \"drive\""
  echo "Then paste the resulting token here."
  echo ""
  read -rp "Press Enter to start rclone config..."
  rclone config --config "$RCLONE_CONF"
else
  echo "rclone.conf already exists, skipping."
fi

# 4. Verify the remote is named 'gdrive'
if ! rclone lsd gdrive: --config "$RCLONE_CONF" &>/dev/null; then
  echo "ERROR: Remote 'gdrive' not found or not accessible."
  echo "Make sure you named the remote 'gdrive' during config."
  exit 1
fi

echo ""
echo "=== Setup complete! ==="
echo "Run 'docker compose up -d' to start everything including the backup service."
echo "Test a manual backup: docker compose run --rm backup /backup.sh"
