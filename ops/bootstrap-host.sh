#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# bootstrap-host.sh — prepare a fresh Ubuntu host to receive LinguaRead deploys.
#
# Installs Docker, creates the deploy user and directory the deploy workflow
# expects, schedules Docker image cleanup, adds a swap file (unless the host already
# has swap), lets security updates reboot at 04:30, turns off SSH password logins
# once a key is in place, bans SSH brute-forcers with fail2ban, and (optionally)
# issues a Let's Encrypt certificate.
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
#   SWAP_SIZE      swap file size when the host has no swap, e.g. 2G (default) or
#                  512M; 0 = leave swap alone
#   FAIL2BAN       1 (default) = install fail2ban's SSH jail; 0 = skip (staging:
#                  its 954 MiB of RAM has no room for another daemon)
#   SKIP_DOCKER_INSTALL  1 = don't install Docker (tests / pre-baked images)
# ---------------------------------------------------------------------------
set -euo pipefail

DEPLOY_USER="${DEPLOY_USER:-deploy}"
DEPLOY_PATH="${DEPLOY_PATH:-/opt/lingua-read}"
CI_PUBKEY="${CI_PUBKEY:-}"
DOMAIN="${DOMAIN:-}"
LE_EMAIL="${LE_EMAIL:-}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
FAIL2BAN="${FAIL2BAN:-1}"
SKIP_DOCKER_INSTALL="${SKIP_DOCKER_INSTALL:-0}"
export DEBIAN_FRONTEND=noninteractive

log()  { printf '==> %s\n' "$*"; }
warn() { printf '[warn] %s\n' "$*" >&2; }
die()  { printf '[fail] %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
case "$FAIL2BAN" in 0|1) ;; *) die "FAIL2BAN must be 0 or 1 (got '$FAIL2BAN')" ;; esac
case "$SWAP_SIZE" in
  0|[1-9]*[GM]) ;;
  *) die "SWAP_SIZE must look like 2G or 512M, or be 0 (got '$SWAP_SIZE')" ;;
esac
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
# The deploy user's existing lines are kept verbatim, options (from=, restrict) included, so a
# re-run never drops a key. From root, only plain key lines are imported: cloud images prefix
# root's copy with command="echo Please login as …", which logs nobody in.
grep_ok() { grep "$@" || [ $? -eq 1 ]; }   # "no match" is fine; a read error is not
HOME_DIR=$(getent passwd "$DEPLOY_USER" | cut -d: -f6)
AUTH="$HOME_DIR/.ssh/authorized_keys"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$HOME_DIR/.ssh"
touch "$AUTH"
# awk (not cat) so a file without a final newline can't glue its last key to the next one.
{
  awk 'NF' "$AUTH"
  if [ -f /root/.ssh/authorized_keys ]; then grep_ok -E '^(ssh-|ecdsa-|sk-)' /root/.ssh/authorized_keys; fi
  if [ -n "$CI_PUBKEY" ]; then printf '%s\n' "$CI_PUBKEY"; fi
} | awk '!seen[$0]++' > "$AUTH.tmp"
# Every existing line is carried over, so a shorter result means the merge went wrong.
[ "$(wc -l < "$AUTH.tmp")" -ge "$(awk 'NF && !seen[$0]++' "$AUTH" | wc -l)" ] \
  || { rm -f "$AUTH.tmp"; die "merged $AUTH is missing lines — left it unchanged"; }
mv "$AUTH.tmp" "$AUTH"
chmod 600 "$AUTH"; chown "$DEPLOY_USER:$DEPLOY_USER" "$AUTH"
KEY_COUNT=$(grep_ok -c '^[[:space:]]*[^#[:space:]]' "$AUTH")
[ -n "$CI_PUBKEY" ] || warn "CI_PUBKEY not set — fine if the environment's DEPLOY_SSH_KEY is already among the keys in $AUTH"
log "$AUTH holds $KEY_COUNT key(s)"

# --- Deploy directory -----------------------------------------------------
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH"
install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "$DEPLOY_PATH/secrets"
log "Deploy dir $DEPLOY_PATH ready"

# --- Docker cleanup -------------------------------------------------------
# Every deploy pulls new sha-* images; without pruning they fill the disk. Only unused
# images are removed (a rollback re-pulls from GHCR). Never prunes volumes.
mkdir -p /etc/cron.d
cat > /etc/cron.d/docker-prune <<'CRON'
# Managed by ops/bootstrap-host.sh. Runs after the 02:00 backup.
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 * * * root docker image prune -a --filter "until=168h" -f >> /var/log/docker-prune.log 2>&1
0 4 1 * * root docker system prune --filter "until=720h" -f >> /var/log/docker-prune.log 2>&1
CRON
chmod 644 /etc/cron.d/docker-prune
command -v cron >/dev/null 2>&1 || apt_install cron
log "Docker prune scheduled (/etc/cron.d/docker-prune)"

# --- Swap -----------------------------------------------------------------
# A safety net, not extra capacity. Without swap, a memory spike (an import during the
# nightly dump or a deploy) makes the kernel kill something, most likely Postgres, which has
# no memory limit. Swappiness 10 keeps hot memory in RAM and swaps only under real pressure.
# The API opts out through memswap_limit in docker-compose.prod.yml.
if [ "$SWAP_SIZE" = "0" ]; then
  log "Swap left alone (SWAP_SIZE=0)"
else
  if [ -n "$(swapon --noheadings --show 2>/dev/null)" ]; then
    log "Swap present: $(swapon --noheadings --show=NAME,SIZE | tr -s ' ' | paste -sd ',')"
  else
    [ ! -e /swapfile ] || die "/swapfile exists but isn't active swap — check it by hand"
    log "Creating a $SWAP_SIZE swap file at /swapfile"
    fallocate -l "$SWAP_SIZE" /swapfile || { rm -f /swapfile; die "fallocate failed — create the swap file by hand"; }
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -qE '^/swapfile[[:space:]]' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  fi
  printf '# Managed by ops/bootstrap-host.sh — swap only under real memory pressure.\nvm.swappiness = 10\n' \
    > /etc/sysctl.d/60-linguaread-swap.conf
  sysctl -q -p /etc/sysctl.d/60-linguaread-swap.conf
  log "Swappiness $(cat /proc/sys/vm/swappiness)"
fi

# --- Security updates: reboot when required --------------------------------
# unattended-upgrades installs security fixes but, by default, never reboots, so kernel and
# libc fixes wait indefinitely. Reboot at 04:30 (after the 02:00 backup and 03:30 prune) only
# when an update requires it; containers come back via their restart policies.
command -v unattended-upgrade >/dev/null 2>&1 || apt_install unattended-upgrades
cat > /etc/apt/apt.conf.d/52linguaread-auto-reboot <<'APT'
// Managed by ops/bootstrap-host.sh — reboot after security updates that need it
// (kernel, libc). 04:30 server time: after the 02:00 backup and 03:30 image prune.
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-WithUsers "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:30";
APT
log "Automatic security updates reboot at 04:30 when required"

# --- SSH: keys only -------------------------------------------------------
# Only once a key can log in — otherwise this would lock out a password-provisioned host.
# KEY_COUNT counts usable lines in $AUTH, which already holds every usable key root has; a
# root file with only cloud-init "Please login as …" lines doesn't count.
# The 00- prefix wins over cloud-init's 50-cloud-init.conf (sshd keeps the first value).
if ! command -v sshd >/dev/null 2>&1; then
  warn "sshd not installed — SSH hardening skipped"
elif [ "$KEY_COUNT" -gt 0 ]; then
  HARDEN=/etc/ssh/sshd_config.d/00-linguaread-hardening.conf
  mkdir -p /etc/ssh/sshd_config.d
  printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\n' > "$HARDEN.tmp"
  if cmp -s "$HARDEN.tmp" "$HARDEN" 2>/dev/null; then
    rm -f "$HARDEN.tmp"
    log "SSH already key-only"
  else
    mv "$HARDEN.tmp" "$HARDEN"
    mkdir -p /run/sshd   # socket-activated sshd (Ubuntu 24.04+) may not have created it yet
    sshd -t || { rm -f "$HARDEN"; die "sshd rejected the hardening config — removed it"; }
    systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || warn "reload sshd manually"
    log "SSH password logins disabled (existing sessions unaffected)"
  fi
else
  warn "no usable SSH key for $DEPLOY_USER — leaving password logins enabled"
fi

# --- fail2ban: ban SSH brute-forcers --------------------------------------
# Password logins are off, so bots can't get in, but they try thousands of times a day.
# Five failures within 10 minutes ban the address for an hour, doubling for repeat offenders
# up to a week. Deploys never fail authentication, so GitHub's runners are never banned.
# "aggressive" also counts the pre-auth disconnects that key-only bots end with. Ubuntu logs
# them as sshd-session inside ssh.service; the journalmatch covers that and plain sshd.
# Banned yourself? From another address or the Hetzner console:
#   fail2ban-client set sshd unbanip <ip>
if [ "$FAIL2BAN" = "1" ]; then
  command -v fail2ban-client >/dev/null 2>&1 || apt_install fail2ban
  JAIL=/etc/fail2ban/jail.d/linguaread.local
  cat > "$JAIL.tmp" <<'F2B'
# Managed by ops/bootstrap-host.sh
[DEFAULT]
bantime = 1h
bantime.increment = true
bantime.maxtime = 1w
findtime = 10m
maxretry = 5

[sshd]
enabled = true
mode = aggressive
backend = systemd
journalmatch = _SYSTEMD_UNIT=ssh.service + _SYSTEMD_UNIT=sshd.service + _COMM=sshd + _COMM=sshd-session
F2B
  if cmp -s "$JAIL.tmp" "$JAIL"; then
    rm -f "$JAIL.tmp"
  else
    [ -f "$JAIL" ] && cp "$JAIL" "$JAIL.prev"
    mv "$JAIL.tmp" "$JAIL"
    if ! fail2ban-client --test >/dev/null 2>&1; then
      if [ -f "$JAIL.prev" ]; then mv "$JAIL.prev" "$JAIL"; else rm -f "$JAIL"; fi
      die "fail2ban rejected $JAIL — restored the previous version"
    fi
    rm -f "$JAIL.prev"
    systemctl enable --quiet fail2ban
    systemctl restart fail2ban
  fi
  for _ in 1 2 3 4 5 6 7 8 9 10; do fail2ban-client ping >/dev/null 2>&1 && break; sleep 1; done
  fail2ban-client status sshd >/dev/null 2>&1 || die "fail2ban's sshd jail isn't running — journalctl -u fail2ban"
  log "fail2ban SSH jail active ($(fail2ban-client status sshd | awk -F'\t' '/Currently banned/ {print $2}') address(es) banned now)"
else
  log "fail2ban skipped (FAIL2BAN=0)"
fi

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
