# Security policy

LinguaRead is experimental software for a personal, self-hosted workspace. Security
fixes target the current `dev` branch and are promoted to `main`; older versions
have no maintained backport schedule. There is no guaranteed response time.

## Reporting a vulnerability

Use GitHub's private [Report a vulnerability form](https://github.com/semblable/Lingua_read2/security/advisories/new)
when it is enabled. Include the affected commit/image tag, deployment mode,
reproduction steps using synthetic data, expected impact, and any suggested fix.
Do not post credentials, private library text, dumps, or an exploit against a live
installation in a public issue.

Private reporting was disabled when checked on 2026-10-29. Until it is enabled,
use the contact-request fallback below.

If private reporting is unavailable, open an issue containing only a request for
a private security contact. Wait for the maintainer to provide a channel before
sharing vulnerability details. The maintainer must enable and verify private
reporting before advertising it as available; see the
[release checklist](docs/RELEASING.md).

If a credential has been exposed, revoke/rotate it at its issuer first. Removing
it from the latest commit does not invalidate it or remove it from Git history,
forks, caches, artifacts, or previously downloaded backups.

## Deployment and backups

Complete initial password setup on a trusted local connection. Internet access
needs HTTPS and a reviewed deployment configuration. The supplied plain-HTTP
Compose setup is for local evaluation; see [installation](README.md#installation-docker)
and [settings](SETTINGS.md) before exposing it. The app uses a shared default user;
it is not a tenant-isolation boundary for unrelated users.

Keep `.env`, provider tokens, backup remote configuration, uploaded private media,
and the `api_dp_keys` volume out of Git and public issue attachments. The key ring
can decrypt stored provider credentials and needs a separately protected backup.
A database download does not contain uploaded media or the key ring. Follow
[backup and upgrade guidance](docs/BACKUP_AND_UPGRADE.md).

The existing Trivy image scan and dependency audits complement review; they do not
establish that Git history is free of secrets. Complete the history and credential
revocation gates in [RELEASING.md](docs/RELEASING.md) before a public release.
