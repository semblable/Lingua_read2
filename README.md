# LinguaRead

## Overview

LinguaRead is a web application for contextual language learning, inspired by Learning With Texts (LWT). It enhances vocabulary and reading comprehension by allowing users to read texts where words are dynamically highlighted based on familiarity levels (New to Known). Features include easy tooltip/click translations and content integration via modern APIs, delivering an interactive learning environment focused on reading immersion.

> 📚 **Documentation:** [Installation](#installation-docker) · [Features Guide](FEATURES.md) · [Configuration & Settings Guide](SETTINGS.md)

## Important Notice

This is an early version of the application and is still under active development. As such:

*   The application may contain bugs or incomplete features
*   Some functionality might not work as expected
*   The user interface and features may change significantly in future versions
*   It is not yet intended for use
*   LinguaRead is free, open-source software provided under the MIT License. You're welcome to use it for any reason, make changes, share it, and incorporate it into other products without cost.

## Key Features

*   **AI-Powered Lesson Generation:** Creates reading materials (lessons/stories) using Google Gemini Pro based on user prompts.
*   **Advanced Translation:** Integrates with the DeepL API for accurate word and phrase translations.
*   **Vocabulary Management:** Tracks the learning status of words.
*   **Interactive Reading:** Displays text with words color-coded by learning status. Hovering/clicking shows translations.
*   **Term Selection:** Allows selecting single words or multi-word phrases for translation and saving.
*   **Book Management:** Import longer texts by pasting content or uploading `.txt` and `.epub` files. Books are automatically split into lessons, and reading progress is tracked. Supports adding multiple tags to books for organization.
*   **Audio Lessons:** Upload audio (e.g., MP3) and corresponding SRT subtitles for synchronized listening/reading ("karaoke-style").
*   **User Customization:** Settings for default font and translation behavior. (Theme, text size, and line spacing are now highly customizable with on-the-fly controls - see 'Recent Frontend Enhancements' for details).
*   **Statistics:** Insights into reading activity, listening time (per language, per day), and vocabulary progress. Includes filtering by various time periods (Today, 7/30/90/180 Days, All Time).
*   **Batch Operations:** Translate all words, mark all as known. Create audio lessons in batches by uploading corresponding audio and SRT files (e.g., `lesson1.mp3` and `lesson1_fr.srt`).
*   **Listening Time Tracking:** Automatically tracks time spent actively listening to audio lessons and audiobooks.
*   **Terms Management Page:**
    *   View all saved terms by language.
    *   Filter by learning status (1-5).
    *   Search by term or translation.
    *   Sort by term, status, or date added (default: newest first).
    *   Export all terms or filtered terms as CSV.
    *   Import terms via the UI by uploading a CSV file (Term, Translation[Optional], Status[Optional]).
    *   Remembers last selected language.
*   **Audiobook Player:** Upload MP3 files for a book to create a persistent audiobook playlist. Tracks playback progress per book and integrates listening time into statistics.

## Language Management

LinguaRead supports a wide range of languages with customizable settings, including:

*   Right-to-left (RTL) support
*   Parser type (space-delimited, MeCab, Jieba, etc.)
*   Character substitutions for normalization
*   Sentence splitting rules
*   Word character sets
*   Dictionaries and translation sources

### Updating Language Data

Languages can be configured and updated via the **Manage Languages** UI in the app. You can:

*   Add new languages
*   Edit existing language settings
*   Configure dictionaries and parsing rules
*   Enable or disable languages for translation and content creation

### Impact on Features

Language settings influence:

*   Text parsing and sentence splitting
*   Dictionary lookups
*   Translation behavior


---

## Technology Stack

*   **Frontend:** React (using Create React App)
*   **Backend:** .NET Core (C#)
*   **Database:** PostgreSQL
*   **APIs:** Google Gemini DeepL

---

## Installation (Docker)

LinguaRead runs entirely in Docker. A single command builds and launches the React frontend, the .NET backend, and the PostgreSQL database — there is **no need to install Node.js, the .NET SDK, or PostgreSQL** on your machine.

The steps below are written for **Windows** (PowerShell), but work the same on macOS and Linux.

> 📖 For a full reference of every configuration option, see the **[Configuration & Settings Guide](SETTINGS.md)**.
> ✨ For a concise tour of what the app can do, see the **[Features Guide](FEATURES.md)**.

### 📋 Prerequisites

Install these two tools first:

1.  **[Git for Windows](https://git-scm.com/download/win)** — to download the code.
2.  **[Docker Desktop](https://www.docker.com/products/docker-desktop/)** — runs everything else.
    *   During/after install, enable the WSL 2 backend: **Docker Desktop → Settings → General → "Use the WSL 2 based engine."**
    *   **Start Docker Desktop and wait until its whale icon goes green** before continuing. Docker must be running for every command below.

---

### 🚀 Step-by-Step Installation

#### Step 1 — Get the code
Open **PowerShell** and clone the repository:

```powershell
git clone https://github.com/semblable/Lingua_read2.git
cd Lingua_read2
```

All remaining commands are run from this folder (the one containing `docker-compose.yml`).

#### Step 2 — Create the `.env` file
Create a file named exactly `.env` in this folder. In PowerShell you can open a blank one with:

```powershell
notepad .env
```

Paste the following template, then change `POSTGRES_PASSWORD` and `JWT_KEY` to your own secure values:

```env
# 1. PostgreSQL Database Configuration
POSTGRES_DB=linguaread_db
POSTGRES_USER=linguaread_user
POSTGRES_PASSWORD=your_secure_postgres_password_here

# 2. JWT Authentication Secret (must be a random 32+ character string)
JWT_KEY="replace_this_with_your_very_long_and_secure_random_jwt_key"
JWT_ISSUER=LinguaReadApi
JWT_AUDIENCE=LinguaReadClient

# 3. Optional: set a login password on first startup (otherwise use the in-app setup page)
LINGUAREAD_PASSWORD=

# 4. Optional Third-Party API Keys (leave blank to disable that feature)
DEEPL_API_KEY=
GEMINI_API_KEY=
```

> [!TIP]
> **Generate a secure `JWT_KEY`:**
> *   **Windows (PowerShell):**
>     ```powershell
>     [System.Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Minimum 0 -Maximum 256 }))
>     ```
> *   **Linux / macOS / Git Bash:**
>     ```bash
>     openssl rand -base64 32
>     ```

> [!NOTE]
> The `.env` template above covers the essentials. Every available variable (CORS, Discord scheduler, image tags, etc.) is documented in the **[Configuration & Settings Guide](SETTINGS.md)**.

#### Step 3 — Build and start
From the same folder, run:

```powershell
docker compose up --build -d
```

Docker pulls the required images, builds the containers, runs database migrations, and launches everything in the background. The first build can take several minutes.

> If your Docker version is older and `docker compose` is not recognized, use the legacy command `docker-compose up --build -d` instead.

#### Step 4 — Verify it's running
Check that all services are up and healthy:

```powershell
docker compose ps
```

You should see three services running (with `db` and `api` reporting **healthy**):
*   `db` — PostgreSQL 18
*   `api` — .NET backend
*   `nginx` — React frontend

Then open the app in your browser: **[http://localhost](http://localhost)** — you'll be logged in automatically with the default local account.

---

### 🔗 Service Access Points

| Service | URL | Notes |
| :--- | :--- | :--- |
| 🌐 **Frontend** | [http://localhost](http://localhost) (port `80`) | The app. Auto-logs you into the default local account. |
| 🔌 **Backend API** | [http://localhost:5000](http://localhost:5000) | Health check: `http://localhost:5000/api/Health/ready` |
| 🗄️ **Database** | `localhost:5432` | Connect with the PostgreSQL credentials from your `.env`. |

---

### 🛑 Management Commands

Run these from the folder containing `docker-compose.yml`:

| Action | Command | Description |
| :--- | :--- | :--- |
| **Stop** | `docker compose down` | Stops all services but **keeps** your database data. |
| **Restart** | `docker compose restart` | Restarts all running containers. |
| **View logs** | `docker compose logs -f` | Streams logs from all containers (`Ctrl+C` to exit). |
| **Update** | `git pull` then `docker compose up --build -d` | Pull the latest code and rebuild. |
| **Reset everything** | `docker compose down -v` | **⚠️ Destroys all containers and wipes the database.** |

---

### 💾 Backups

For everyday use you **don't need any extra containers**. The app has built-in backup and restore: go to **Settings → Data Management** and click **Download Backup** to save a `.backup` file, or **Restore from Backup** to load one. This is the recommended option for most users.

> The default `docker compose up -d` runs only `db`, `api`, and `nginx`. The automated-backup container below is opt-in and is **never started unless you explicitly ask for it**.

**Advanced — automated cloud backups (optional):** the stack also includes an opt-in `backup` service that periodically snapshots the database and media to a cloud remote via [rclone](https://rclone.org/). It lives behind a Compose *profile*, so it stays out of normal commands until you enable it:

1.  Configure the remote once (run in **Git Bash** or **WSL**, since it's a shell script): `bash setup.sh`
2.  Start *only then* with the profile flag: `docker compose --profile backup up -d`

For manual database + media backup and restore procedures, see **[ops/backup-runbook.md](ops/backup-runbook.md)**.

---

### 🩺 Troubleshooting (Windows)

| Symptom | Fix |
| :--- | :--- |
| `cannot connect to the Docker daemon` / commands hang | Docker Desktop isn't running — start it and wait for the whale icon to turn green. |
| `Ports are not available` / port `80` already in use | Another app (IIS, Skype, a web server) holds port 80. Stop it, or change the `nginx` mapping `"80:80"` to e.g. `"8080:80"` in `docker-compose.yml` and open [http://localhost:8080](http://localhost:8080). |
| `docker compose` not recognized | Update Docker Desktop, or use the legacy `docker-compose` command. |
| App loads but settings/login look wrong | Make sure `.env` is in the repo root, named exactly `.env` (not `.env.txt`), and that `JWT_KEY` has no smart/curly quotes. |
| `api` stays *unhealthy* right after starting | It waits for the database and runs migrations on first boot. Give it ~30 seconds, then check `docker compose logs -f api`. |
| Want a clean slate | `docker compose down -v` removes containers **and** the database, then start again from Step 3. |

---

## License

MIT License

Copyright (c) 2025 LinguaRead

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
