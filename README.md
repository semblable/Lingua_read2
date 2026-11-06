# LinguaRead

A self-hosted reading and listening workspace with integrated FSRS, sentence
mining, and your choice of AI provider. Bring your own books/articles, track words
in context, save useful sentences, and review them later.

Built for intermediate learners who already read in a language they study.

[Try the interactive demo](https://semblable.github.io/Lingua_read2/) ·
[Install with Docker](#installation-docker) · [Features](FEATURES.md) ·
[Settings](SETTINGS.md) · [Contribute](CONTRIBUTING.md)

The static demo uses the real reader/player with prepared responses and temporary
sample data. It needs no account or API key. Imports, live AI, offline sync, and
FSRS scheduling run in the full application. [Run the demo locally](client/lingua-read-client/demo/README.md).

![Spanish reader with a prepared word lookup and familiarity controls](docs/images/reader-demo.jpg)
*Real reader component in the static Spanish sample; translations are prepared.*

![English audio lesson with synchronized transcript and player](docs/images/audio-demo.jpg)
*Static listening sample: human recording from P. Roach / International Phonetic
Association, CC BY-SA 3.0; caption-derived transcript CC BY-SA 4.0.
[Media attribution and changes](client/lingua-read-client/demo/public/audio/ATTRIBUTION.txt).*

## What you can do

- Import TXT/EPUB books, organize lessons, and track reading progress.
- Look up words and phrases, set familiarity levels, and mine sentences for
  configurable FSRS-6 flashcard review (translation, cloze with meaning cues and
  progressive letter hints, or mixed) and reading credit.
- Play supplied audio with SRT transcripts, seek by cue, and resume audiobook
  playlists. Download material for offline use and replay supported queued activity
  when reconnected.
- Choose translation and AI providers, including compatible local endpoints;
  customize per-task models/prompts, reader appearance, and review settings.
- Export vocabulary, view reading/listening statistics, and back up your data.

See the [features guide](FEATURES.md) for details and [architecture and engineering
notes](docs/ARCHITECTURE.md) for how the pieces fit together.

## Status and language limitations

LinguaRead is **experimental and under active development**. Bugs, incomplete
features, UI changes, and data migrations are possible. Back up before upgrading.
It is a personal workspace using a shared default user, with no tenant-isolation
promise for unrelated users. Support is best-effort from a solo maintainer with a
full-time job; there are no response-time or availability commitments.

The demo provides Spanish reading and English listening examples. Configurable
language entries do not establish that every language works equally well.
Space-delimited parsing, normalization, sentence rules, dictionaries, and RTL
settings are configurable. **Japanese MeCab and Chinese Jieba segmentation are
not implemented.** Verify a short passage in your own language before importing
an entire library; see [adding languages](LANGUAGES_GUIDE.md).

The maintainer reports acceptable personal operation on an Oracle Cloud free-tier
micro instance with swap enabled and good mobile performance in their own
workflow. Actual host specifications and representative measurements remain to
be [recorded](docs/DEPLOYMENT_EVIDENCE.md). These observations do not establish a
minimum VM size, concurrent-user capacity, or broad device support. PostgreSQL's
Compose defaults are tuned for roughly 4 GB hosts; smaller machines need reviewed
configuration and measurement.

## Installation (Docker)

Install Git and Docker with Compose 2.24.4 or later (Docker Desktop on Windows/macOS),
then start Docker. No host Node.js, .NET SDK, or PostgreSQL installation is needed.

```sh
git clone https://github.com/semblable/Lingua_read2.git
cd Lingua_read2
```

Copy `.env.example` to `.env`:

```powershell
# Windows PowerShell
Copy-Item .env.example .env
notepad .env
```

```sh
# macOS / Linux
cp .env.example .env
# Open .env with your preferred editor.
```

Set a private `POSTGRES_PASSWORD`. For personal use on this computer, also set:

```dotenv
LINGUAREAD_LOCAL_MODE=true
```

This opens your existing library without a login or password setup. The Docker
web port binds to `127.0.0.1`, and the app accepts only local hostnames. Leave
provider keys blank unless you need them. Local mode does not require `JWT_KEY`,
`LINGUAREAD_PASSWORD` or `LINGUAREAD_SETUP_TOKEN`, and preserves existing passwords.
Other processes and containers on your computer share this local trust boundary.
Use Docker Engine 28 or later for its localhost port isolation fixes.

For password login, leave `LINGUAREAD_LOCAL_MODE=false` and set a random
`JWT_KEY` of at least 32 characters. Generate a key locally with PowerShell:

```powershell
$jwtBytes = New-Object byte[] 32
$jwtRng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$jwtRng.GetBytes($jwtBytes)
[Convert]::ToBase64String($jwtBytes)
$jwtRng.Dispose()
```

Or use `openssl rand -base64 32` on macOS/Linux. Keep `.env` private. For password
login, set `LINGUAREAD_PASSWORD` (at least 12 characters) before first startup.
Alternatively, configure a random
`LINGUAREAD_SETUP_TOKEN` and enter that operator token on the setup page along
with your chosen password. Outside Development, setup requires this token.
Remove the token after setup; keep the initial connection trusted and local.

```sh
docker compose up --build -d
docker compose ps
```

The first build can take several minutes. Open [http://localhost](http://localhost)
and start reading immediately in local mode, or set up/sign in with your password.
The normal stack has three services: `db`,
`api`, and `nginx`. The optional backup service starts only with its profile.

This plain-HTTP setup is for local evaluation. Authentication cookies are secure
outside Development, so a plain-HTTP address on another device can prevent login.
For a server/phone over a network, configure HTTPS using the production settings
and complete password setup before allowing untrusted access. The production
Compose override disables local mode even if `.env` enables it. The base Compose
web port is now localhost-only; use the production override for network access.
See [settings](SETTINGS.md)
and the [security policy](SECURITY.md).

| Service | Local access |
| --- | --- |
| App | [http://localhost](http://localhost), port 80 |
| API | [Readiness](http://localhost:5000/api/Health/ready), loopback port 5000 via the development override |
| Database | Internal Compose service `db:5432`; not published to the host by default |

## Manage, back up, and upgrade

| Task | Command or guide |
| --- | --- |
| Stop, preserving volumes | `docker compose down` |
| Restart | `docker compose restart` |
| View logs | `docker compose logs -f` (Ctrl+C to exit) |
| Upgrade and recover | [Backup and upgrade guide](docs/BACKUP_AND_UPGRADE.md) |
| Advanced configuration | [Settings guide](SETTINGS.md) |

**Settings → Data Management → Download Backup** saves a PostgreSQL `.backup`.
It contains the database only. Preserve uploaded audio/EPUB assets and the
`api_dp_keys` encryption-key volume separately. Restoring only the database is
not a full-library recovery. Verify an isolated restore before relying on a
backup or upgrading. **Restore from Backup overwrites its target database.**

For optional automated cloud backups, configure the remote privately with
`bash setup.sh` in Git Bash/WSL/Linux, then start with
`docker compose --profile backup up -d`. The sidecar backs up the database and
media, but deliberately excludes the encryption keys; protect those separately.
See [backup expectations](docs/BACKUP_AND_UPGRADE.md).

## Troubleshooting

| Symptom | Next step |
| --- | --- |
| Cannot connect to Docker / commands hang | Start Docker Desktop or the Docker daemon and wait until ready. |
| Port 80 is in use | Set `HTTP_PORT=8080` in `.env`, recreate nginx, then open `http://localhost:8080`. |
| Local mode rejects a request | Open `http://localhost` or `http://127.0.0.1` on the same computer. Custom domains, LAN access and requests from nonlocal browser origins are not supported in this mode. |
| API stays unhealthy | Allow initial migrations to finish, then inspect `docker compose logs --tail 100 api`. |
| Setup/login fails | Check `.env` naming, JWT key length, password, and HTTPS/cookie behavior. |
| Missing provider feature | Configure that provider in Settings; no paid API is required to run the reader. |
| Need to reset disposable test data | `docker compose down -v` deletes volumes, including the database, media, and keys. Never use it to troubleshoot data you want to retain. |

[Report a bug](https://github.com/semblable/Lingua_read2/issues/new/choose) with your
version, device/browser, language, and a small reproducible example. Sanitize logs
and screenshots. Read [CONTRIBUTING.md](CONTRIBUTING.md) for development and support
scope, and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Application code and original demo text: [MIT](LICENSE), Copyright (c) 2025
LinguaRead. Fonts, the FSRS port, and demo audio/captions retain their upstream
terms in [third-party notices](THIRD_PARTY_NOTICES.md). The English listening
screenshot contains CC BY-SA caption material; retain its attribution when reusing it.
