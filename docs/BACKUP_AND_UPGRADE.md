# Backups and upgrades

LinguaRead is experimental. Database migrations run when the API starts; an older
binary is not guaranteed to work against a migrated database. Record the exact
commit and image tags before every upgrade. There is no stable release or
backward-compatibility promise implied by the frontend's package version.

## What to preserve

| Item | Contents | Recovery expectation |
| --- | --- | --- |
| Settings → Data Management → Download Backup | PostgreSQL custom-format `.backup` from `pg_dump` | Database only; includes settings, vocabulary, review history, and media references |
| `api_audio_lessons` | Uploaded lesson audio; SRT content is stored in the database | Preserve audio files separately |
| `api_audiobooks` | Uploaded audiobook tracks | Preserve files separately |
| `api_epub_assets` | Extracted EPUB assets | Preserve files separately |
| `api_hardcover_covers` | Cached cover images | Preserve when recovering the same library |
| `api_dp_keys` | ASP.NET Data Protection key ring in `/app/keys` | Needed to decrypt provider secrets stored in the database |
| `.env`, deployment configuration, optional `secrets/rclone.conf` | Credentials and host/remote settings | Store privately; do not commit or attach to issues |

The optional backup sidecar snapshots the database and mirrors media. It deliberately
does **not** upload `api_dp_keys` alongside the database dump. Arrange a separate,
protected copy of those keys and configuration. Without the original keys, restored
provider credentials may need to be entered again. Never publish either backup.
Browser-only offline queues are not included in a server backup; reconnect and let
pending activity synchronize before taking a recovery checkpoint.

## Before an upgrade

1. Read the release/commit notes, including PostgreSQL major-version requirements.
   Record `git rev-parse HEAD`, `docker compose images`, and the Compose project
   name privately. Image tags such as `latest` are mutable; retain immutable
   `sha-<short7>` tags or image digests for a reproducible recovery.
2. Pause imports, reviews, and background writers while taking a consistent
   checkpoint. Download a database backup, then stop the API while making matching
   copies of the media and key volumes. Preserve configuration separately.
   Use `docker compose volumes` or `docker volume ls` to locate the actual named
   volumes; Compose prefixes them with the project name.
3. Restore the checkpoint into an **isolated** Compose project with separate
   volumes and ports. Set `EXTERNAL_WRITES_DISABLED=true`, omit backup/reporting
   services, and block external integrations at the environment/network level
   when testing private production data. The flag alone is not an egress block.
4. Verify a known book, vocabulary/statuses, review history, audio playback/seeking,
   and provider-secret recovery without sending private text to a provider.
   Record the result in [deployment evidence](DEPLOYMENT_EVIDENCE.md).

Do not treat a successful download or a successful container start as proof of
recoverability. Keep the source checkpoint until the restore has been checked.

## Upgrade and verify

For a source installation, after the checkpoint:

```powershell
git status --short
git pull --ff-only
docker compose up --build -d
docker compose ps
docker compose logs --tail 100 api
```

Resolve local modifications before pulling. A tracked release can be selected with
`git checkout <reviewed-tag>` instead of pulling the tip of a branch. On managed
staging/production hosts, use the existing promotion workflow rather than mixing
manual source builds with deployment-managed image tags.

Check the health endpoint, sign in, open an existing lesson, change a disposable
test word, review a card, and play/seek audio. Confirm media and secrets still
work. Major PostgreSQL upgrades require their own tested dump/restore procedure;
changing the image version over an old data volume is not a migration.

## Recovery

Stop writers and preserve the failed state for diagnosis. Restore the pre-upgrade
database, media, configuration, and key ring into an isolated environment running
the recorded compatible application/database versions. Verify that environment
before switching traffic. Do not assume `git checkout` or an old image tag undoes
database migrations.

The in-app **Restore from Backup** overwrites the target database and does not
restore media or keys. Use it only against the intended recovery target. Never
run `docker compose down -v` on an installation whose data you want to retain.
The [isolated synthetic restore drill](RELEASE_VERIFICATION.md#full-app-reliability-and-export-pass-2026-10-29)
passed on the current working tree. Repeat at the intended release checkpoint;
the drill does not verify every existing installation's backups.

## Passwords and session recovery

Settings → Data Management → Change password requires the current password and
revokes other sessions. Logout revokes all sessions for this single account.
The first upgrade to stamp-validated sessions signs existing browsers out once;
no database migration is needed. Revocation requires a successful server request;
closing a tab or clearing local cookies cannot revoke a copied token.

There is no public forgotten-password or email-reset endpoint. An operator who
has lost the password should take a checkpoint, restrict access, stop the API,
and use a private PostgreSQL session against the intended database:

```sql
UPDATE "Users"
SET "PasswordHash" = NULL, "SecurityStamp" = gen_random_uuid()::text
WHERE "Id" = 'a1a1a1a1-b2b2-c3c3-d4d4-e5e5e5e5e5e5';
```

Confirm exactly one row changed. Set a new private `LINGUAREAD_PASSWORD` and
recreate the API with the updated environment. The initializer fills an empty
hash only; changing that variable alone does not override an existing password.
Sign in before restoring network access. Do not reopen anonymous setup on an
exposed server as a recovery mechanism.

A database restore also restores its historical authentication stamps. Rotate
`JWT_KEY` and recreate the API after recovery to ensure previously revoked
cookies cannot become valid again. Preserve the new configuration privately.

## Report destinations

Reports accept HTTPS on the default port with no user information or fragments.
Discord hosts retain their existing support. Custom `/webhook/report/...` relays
require an exact operator-configured `Discord:AllowedReportRelayHosts` entry
(environment example: `Discord__AllowedReportRelayHosts__0=reports.example.org`).
The report HTTP client rejects redirects and connects only to public IP addresses,
including after DNS resolution. Private-network relays are excluded. Existing
relay users need this explicit allowlist on upgrade. No report is sent by the
verification workflow; `ExternalWrites:Disabled` and network isolation remain on.
