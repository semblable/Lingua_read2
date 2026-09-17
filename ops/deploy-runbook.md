# Deploy Runbook

How LinguaRead ships to its two environments. Related: [backup-runbook.md](backup-runbook.md).

## Pipeline overview

| Workflow | Trigger | What it does |
| :--- | :--- | :--- |
| `pr.yml` (PR Validation) | Pull requests to `dev` / `main` | Tests, lint, typecheck, full docker builds — **no** pushes, no deploys. |
| `staging.yml` (Staging) | Push to `dev` | CI → build + push `sha-<short7>` (+ `latest`) images to GHCR → deploy that tag to the **staging** host. |
| `promote-prod.yml` (Promote to Production) | Manual (`workflow_dispatch`) | Retags the staging-tested images as `:prod` **by digest (no rebuild)** → deploys the sha tag to the **production** host → creates a `prod-…` git tag → fast-forwards `main`. |
| `security-scan.yml` | Weekly + manual | Trivy CRITICAL-severity scan of the three `:prod` images. |
| `ghcr-cleanup.yml` | Monthly + manual | Deletes old GHCR versions (keeps newest 30 tagged + `latest`/`prod`/`buildcache`, removes untagged). |

Shared internals: `_ci-build.yml` (CI + builds) and `_deploy.yml` (SSH/compose deploy, parameterized by GitHub Environment).

`main` is written only by the promote workflow — it always points at the commit production runs.

## Environments & secrets

Two GitHub Environments (Settings → Environments): **staging** and **production**. Each defines the same names:

| Secret | Meaning |
| :--- | :--- |
| `DEPLOY_USER` / `DEPLOY_SSH_KEY` / `DEPLOY_PATH` | SSH login and deploy directory for the compose deploy. |
| `DOTENV` | Full contents of the host's `.env` (multiline). See `.env.example`. |

Per-environment **variables**: `DEPLOY_HOST` (required — the SSH target), `SMOKE_URL` (optional) — public base URL; when set, deploys finish with external `curl` checks of `/healthz` and `/api/Health/ready` — and `MONITORING` (optional; `true` on production starts the [monitoring dashboard](#monitoring-dashboard-production)).

The target host is the environment **variable** `DEPLOY_HOST` (an IP is public anyway). GitHub fills a missing environment *secret* or *variable* from a same-named repo-level one; none are defined at repo level, so a host can't leak between environments that way (keep it so — see below). `_deploy.yml` fails fast (before touching any host), naming each missing value.

**No repo-level deploy secrets.** Both environments are self-contained; keep `DEPLOY_*`, `DOTENV` and `PRODUCTION_ENV` out of the repository-level secrets so nothing can fill a gap in one environment with another's values. The same goes for **variables**: an environment without `DEPLOY_HOST` silently inherits a repository- (or organization-) level `DEPLOY_HOST` variable, so never create one there.

| Environment | `DEPLOY_HOST` | `DEPLOY_USER` | `DEPLOY_PATH` | Docker |
| :--- | :--- | :--- | :--- | :--- |
| staging | Oracle VM, self-signed cert (`SMOKE_URL` is its IP) | `ubuntu` | `/home/ubuntu/lingua-read` | `sudo docker` |
| production | Hetzner VM, Let's Encrypt | `deploy` | `/opt/lingua-read` | `docker` |

The deploy appends `*_IMAGE_TAG` (the sha tag) and `BACKUP_ENV` (the environment name) to `.env` itself — don't put them in `DOTENV`.

**Host sizing** is per-environment *variables* too, appended only when set (the compose defaults fit a ~4 GB host, so production sets none):

| Variable | staging (954 MiB RAM) | Default |
| :--- | :--- | :--- |
| `POSTGRES_SHARED_BUFFERS` | `256MB` | `1GB` |
| `POSTGRES_EFFECTIVE_CACHE_SIZE` | `512MB` | `2GB` |
| `API_MEMSWAP_LIMIT` | `3000M` (API may swap; its 1500M limit exceeds the RAM) | `1500M` (no swap for the API) |

Changing a `POSTGRES_*` value restarts the database container on the next deploy.

**The domain isn't in `DOTENV`.** `JWT_ISSUER`/`JWT_AUDIENCE` are opaque labels (defaults `LinguaReadApi`/`LinguaReadClient`) and the site is same-origin behind nginx, so `CORS_ALLOWED_ORIGINS` stays blank. A domain lives only in DNS, the certificate, and `SMOKE_URL`.

## Deploying

- **Staging**: merge/push to `dev`. Fully automatic.
- **Production**: Actions → *Promote to Production* → *Run workflow*. Leave the tag empty to promote whatever the last successful staging run deployed.

## Rolling back production

Run *Promote to Production* with an older `sha-XXXXXXX` tag (find candidates in the `prod-…` git tags, the Actions history, or GHCR). The same digest-retag + deploy path runs; nothing is rebuilt. If GHCR cleanup already deleted that tag, the promote fails at the verify step — rebuild the image from the corresponding `prod-…` git tag instead.

## Host expectations

**New host:** `ops/bootstrap-host.sh` sets up everything below in one idempotent run (Docker, `deploy` user + keys, deploy dir, nightly image prune in `/etc/cron.d/docker-prune`, a 2 GB swap file with swappiness 10, automatic reboot at 04:30 when a security update needs one, key-only SSH, a fail2ban SSH jail, optional Let's Encrypt cert with renewal hooks) — see its header for usage. On staging run it with `FAIL2BAN=0`: its 954 MiB of RAM has no room for another daemon. Restore data **before** the first deploy, or the API initialises an empty database.

- Docker + docker compose v2; deploy user can run docker (staging uses `sudo docker`, production plain `docker`).
- Deploy dir (`DEPLOY_PATH`) contains: `.env` (written by deploys), `certs/`, `secrets/rclone.conf` (optional, enables the backup sidecar), `secrets/beszel-agent.env` (production, enables the dashboard's agent), `predeploy/` (automatic pre-deploy `pg_dump` snapshots, last 3 kept).
- **TLS certs must be readable by uid 101** (unprivileged nginx): `sudo chown -R 101:101 certs`. The deploy script attempts this automatically. If you provision Let's Encrypt later, the certbot renewal deploy-hook must re-apply that ownership after each renewal.
- The deploy also pulls `db` (Postgres **minor** releases apply on deploy, protected by the pre-deploy dump). Major Postgres upgrades remain a manual migration.

## Login and SSH protection

- **Password endpoints** (`POST /api/auth/login` and `/api/auth/setup`, in any letter case): nginx allows 5 attempts a minute per client address, plus a burst of 5, then answers `429` with a JSON message that the login page shows. Rejections appear in the nginx container log as `limiting requests`. Configured in both `nginx.conf` and `nginx.ssl.conf` (zone `auth_password`); it's the guard against online guessing of the deliberately simple single-user password.
- **SSH** (production): fail2ban bans an address for 1 hour after 5 failures within 10 minutes, doubling for repeat offenders up to a week. Password logins are already off, so this cuts the thousands of daily bot attempts rather than closing a hole. Deploys never fail authentication, so GitHub's runners aren't affected.
  ```bash
  sudo fail2ban-client status sshd                 # failures and current bans
  sudo fail2ban-client set sshd unbanip <address>  # lift a ban
  ```
  Banned yourself? Run the unban from another address, or from the Hetzner web console.

## Monitoring dashboard (production)

Two tools run next to the stack on production (compose profile `monitoring`, started by the deploy because the `production` environment sets `MONITORING=true`; staging has no RAM to spare):

| Tool | What it shows | Address (through the tunnel) |
| :--- | :--- | :--- |
| **Beszel** (hub + agent) | CPU, memory, swap, disk and network history for the server and each container | http://localhost:8090 |
| **Dozzle** | live, searchable logs of every container | http://localhost:8081 |

Both listen on the server's loopback only, so nothing is reachable from the internet. Open an SSH tunnel and leave it running while you browse (Ctrl+C closes it):

```bash
ssh -N -L 8090:127.0.0.1:8090 -L 8081:127.0.0.1:8081 deploy@<production host>
```

**First-time Beszel setup** (once; it lives in the `beszel_data` volume):

1. With the tunnel open, go to http://localhost:8090 and create the admin account.
2. Click *Add System*: name `production`, Host / IP `/beszel_socket/beszel.sock`. Keep the dialog open and copy its **Key** and **Token**.
3. Store them where the deploy looks for them, and start the agent:
   ```bash
   ssh deploy@<production host> 'umask 077; cat > /opt/lingua-read/secrets/beszel-agent.env' <<'EOF'
   KEY="ssh-ed25519 AAAA...paste the key..."
   TOKEN=paste-the-token
   EOF
   ssh deploy@<production host> 'cd /opt/lingua-read && docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile monitoring up -d beszel-agent'
   ```
   The system turns green within a minute; later deploys keep the agent running.

Notes:

- **Memory limits:** hub 128 M, agent 64 M, Dozzle 64 M.
- **Dozzle is read-only** (no container actions, no shells) and has no login of its own: the tunnel is the access control. Dozzle and the Beszel agent both mount the Docker socket, which is root-equivalent, which is why neither is published.
- **Beszel alerts** (email or webhook) are sent from this same server, so they can't report the server itself being down. That's what the external checks below are for.
- **History isn't backed up.** Losing `beszel_data` only loses the history and the admin account.
- **Updating:** bump the image tags in `docker-compose.prod.yml`, the hub and agent together.
- **Turning it off:** set `MONITORING` to `false`, then on the host run `docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile monitoring rm -sf beszel beszel-agent dozzle`.

## Monitoring checklist (external, free tiers)

- **Uptime**: UptimeRobot (or similar) on `https://<prod-domain>/healthz` (nginx alive) and `https://<prod-domain>/api/Health/ready` (full stack: DB + seed user).
- **Backups**: healthchecks.io check pinged by `backup.sh` (set `HEALTHCHECK_URL` in the `DOTENV` secrets; ~26 h grace period for the nightly 02:00 job). Alerts on silence — catches a dead backup container, not just failed runs.

## Quarterly restore drill

A backup that has never been restored is a hope, not a backup. Every ~3 months:

1. Pull the latest dump from Google Drive (`rclone copy gdrive:lingua-read-backups/production/db/<year>/<month>/<latest>.backup .`).
2. Restore into a scratch container:
   ```bash
   docker run -d --name restore-drill -e POSTGRES_PASSWORD=drill postgres:18
   docker cp <dump>.backup restore-drill:/tmp/
   docker exec restore-drill sh -c 'createdb -U postgres drill && pg_restore -U postgres -d drill /tmp/<dump>.backup'
   ```
3. Sanity query: `docker exec restore-drill psql -U postgres -d drill -c 'SELECT count(*) FROM "Words";'`
4. `docker rm -f restore-drill`, note the date somewhere durable.

See [backup-runbook.md](backup-runbook.md) for full backup/restore procedures.
