#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# bootstrap-host.sh — prepare a fresh Ubuntu host to receive LinguaRead deploys.
#
# Installs Docker, creates the deploy user and directory the deploy workflow
# expects, and (optionally) issues a Let's Encrypt certificate with renewal hooks.
# Idempotent: re-running on a prepared host changes nothing. Contains no secrets.
#
# Run once as root, from your workstation:
#   ssh root@HOST "CI_PUBKEY='$(cat linguaread_ci.pub)' DOMAIN=example.com LE_EMAIL=you@example.com bash -s" \
#     < ops/bootstrap-host.sh
#
# Options (environment variables):
#   CI_PUBKEY      public half of the key in the environment's DEPLOY_SSH_KEY secret
#   DEPLOY_USER    default deploy
#   DEPLOY_PATH    default /opt/lingua-read — keep it: the basename is the compose
#                  project name, which prefixes every volume (lingua-read_*)
#   DOMAIN         if set with LE_EMAIL: issue a cert for DOMAIN and www.DOMAIN
#   LE_EMAIL       Let's Encrypt account email (setting it accepts the LE terms)
#   SKIP_DOCKER_INSTALL  1 = don't install Docker (tests / pre-baked images)
# ---------------------------------------------------------------------------
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/lingua-read}"
CI_PUBKEY="${CI_PUBKEY:-}"
DOMAIN="${DOMAIN:-}"
LE_EMAIL="${LE_EMAIL:-}"
SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
export DEBIAN_FRONTEND=noninteractive

log()  { printf '==> %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
die()  { printf '[fail] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ "$(basename "$DEPLOY_PATH")" = "lingua-read" ] \
  || warn "DEPLOY_PATH basename is not 'lingua-read': volumes will be named $(basename "$DEPLOY_PATH")_*, not lingua-read_* — restored data won't be found"

apt_install() {
  apt-get install -y -qq "$@" >/dev/null 2>&1 || { apt-get update -qq && apt-get install -y -qq "$@" >/dev/null; }
}

# --- Docker ---------------------------------------------------------------
if command -v docker >/dev/null 2>&1; then
  log "Docker present: $(docker --version)"
elif [ "$SKIP_DOCKER_INSTALL" = "1" ]; then
  warn "Docker not installed (SKIP_DOCKER_INSTALL=1)"
else
  log "Installing Docker"
  command -v curl >/dev/null || apt_install curl ca-certificates
  curl -fsSL https://get.docker.com | sh >/tmp/docker-install.log 2>&1 \
    || { tail -20 /tmp/docker-install.log >&2; die "Docker install failed (log: /tmp/docker-install.log)"; }
  log "Installed: $(docker --version)"
fi

# --- Deploy user ----------------------------------------------------------
if id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "User $DEPLOY_USER exists"
else
  log "Creating user $DEPLOY_USER"
  useradd --create-home --shell /bin/bash "$DEPLOY_USER"
fi
getent group docker >/dev/null || groupadd docker
usermod -aG docker "$DEPLOY_USER"

# Passwordless sudo: staging deploys run `sudo docker`, and every deploy chowns certs/.
command -v visudo >/dev/null || apt_install sudo
SUDOERS=/etc/sudoers.d/"$DEPLOY_USER"
printf '%s ALL=(ALL) NOPASSWD: ALL\n' "$DEPLOY_USER" > "$SUDOERS.tmp"
chmod 440 "$SUDOERS.tmp"
visudo -cf "$SUDOERS.tmp" >/dev/null || { rm -f "$SUDOERS.tmp"; die "generated sudoers file is invalid"; }
mv "$SUDOERS.tmp" "$SUDOERS"

# --- SSH keys: root's keys (your own access) + the CI key, de-duplicated ----
HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
AUTH="$HOME_DIR/.ssh/authorized_keys"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
touch "$AUTH"
{ cat "$AUTH"; [ -f /root/.ssh/authorized_keys ] && cat /root/.ssh/authorized_keys; [ -n "$CI_PUBKEY" ] && echo "$CI_PUBKEY"; } \
  | grep -E '^(ssh-|ecdsa-|sk-)' | awk '!seen[$0]++' > "$AUTH.tmp" || true
mv "$AUTH.tmp" "$AUTH"
chmod 600 "$AUTH"; chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
[ -n "$CI_PUBKEY" ] || warn "CI_PUBKEY not set — GitHub Actions can't deploy until its key is in $AUTH"
log "$AUTH holds $(wc -l < "$AUTH") key(s)"

# --- Deploy directory -----------------------------------------------------
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH/secrets"
log "Deploy dir $DEPLOY_PATH ready"

# --- TLS (optional) -------------------------------------------------------
if [ -n "$DOMAIN" ] && [ -n "$LE_EMAIL" ]; then
  command -v certbot >/dev/null || apt_install certbot
  DC="docker compose -f $DEPLOY_PATH/docker-compose.yml -f $DEPLOY_PATH/docker-compose.prod.yml"
  HOOKS=/etc/letsencrypt/renewal-hooks
  mkdir -p "$HOOKS/pre" "$HOOKS/post" "$HOOKS/deploy" "$DEPLOY_PATH/certs"
  # Standalone renewal needs port 80, which nginx holds: stop it around the challenge.
  printf '#!/bin/bash\ncd %s && %s stop nginx || true\n'  "$DEPLOY_PATH" "$DC" > "$HOOKS/pre/linguaread.sh"
  printf '#!/bin/bash\ncd %s && %s start nginx || true\n' "$DEPLOY_PATH" "$DC" > "$HOOKS/post/linguaread.sh"
  cat > "$HOOKS/deploy/linguaread.sh" <<HOOK
#!/bin/bash
# Copy renewed certs where nginx mounts them; uid 101 = nginx inside the container.
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem /etc/letsencrypt/live/$DOMAIN/privkey.pem "$DEPLOY_PATH/certs/"
chown -R 101:101 "$DEPLOY_PATH/certs" && chmod 600 "$DEPLOY_PATH"/certs/*.pem
HOOK
  chmod +x "$HOOKS"/*/linguaread.sh

  if [ -s "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ]; then
    log "Certificate for $DOMAIN already issued"
  else
    log "Issuing certificate for $DOMAIN and www.$DOMAIN (DNS must already point here)"
    certbot certonly --standalone --non-interactive --agree-tos -m "$LE_EMAIL" --no-eff-email \
      --pre-hook "$HOOKS/pre/linguaread.sh" --post-hook "$HOOKS/post/linguaread.sh" \
      -d "$DOMAIN" -d "www.$DOMAIN"
  fi
  "$HOOKS/deploy/linguaread.sh"
  log "Certs installed in $DEPLOY_PATH/certs (renewal: certbot.timer)"
elif [ -n "$DOMAIN" ] || [ -n "$LE_EMAIL" ]; then
  warn "set both DOMAIN and LE_EMAIL to issue a certificate — skipped"
fi

log "Bootstrap complete. Next: restore data (ops/deploy-runbook.md), then point the environment's DEPLOY_* secrets here."
