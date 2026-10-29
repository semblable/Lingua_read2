"""Database + media + key-ring drill using only the two named synthetic projects.

Leaves both projects and a temporary checkpoint intact for inspection. Never use
this script for a personal library. Run smoke.py first. Docker must be running.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import smoke

SOURCE = "linguaread-verify-20261028"
TARGET = "linguaread-verify-restore-20261029"
COMPOSE = str(Path(__file__).with_name("compose.yml").resolve())


def compose(project, *args):
    env = {**os.environ, "VERIFY_PORT": "18081" if project == TARGET else "18080"}
    subprocess.run(["docker", "compose", "--progress", "quiet", "-f", COMPOSE, "-p", project, *args], env=env, check=True)


def login():
    smoke.cookie = ""
    _, headers = smoke.request("/api/auth/login", {"password": smoke.PASSWORD})
    smoke.cookie = headers["Set-Cookie"].split(";")[0]


def main():
    smoke.BASE = "http://127.0.0.1:18080"
    login()
    smoke.request("/api/usersettings", {"googleTranslateApiKey": "synthetic-preserved-secret"}, method="PUT")
    words = smoke.request("/api/words/export")[0]
    stats = smoke.request("/api/srs/stats")[0]
    texts = smoke.request("/api/texts")[0]
    audio_texts = [smoke.request(f'/api/texts/{t["textId"]}')[0] for t in texts if t["isAudioLesson"]]
    audio_hashes = {t["audioFilePath"]: hashlib.sha256(smoke.request("/" + t["audioFilePath"].lstrip("/"))[0]).hexdigest() for t in audio_texts}
    checkpoint = Path(tempfile.mkdtemp(prefix="linguaread-synthetic-restore-"))
    backup = smoke.request("/api/admin/backup")[0]
    (checkpoint / "database.backup").write_bytes(backup)
    assert backup.startswith(b"PGDMP")
    compose(SOURCE, "stop", "api")
    try:
        compose(TARGET, "up", "--build", "-d", "db", "api")
        compose(TARGET, "stop", "api")
        for volume in ("keys", "lessons", "audiobooks", "assets", "covers"):
            # Exact verification project volumes only; no host filesystem mounts.
            subprocess.run(["docker", "run", "--rm", "--network", "none", "--user", "0",
                "-v", f"{SOURCE}_{volume}:/from:ro", "-v", f"{TARGET}_{volume}:/to",
                "alpine:3.23", "sh", "-c", "cp -a /from/. /to/"], check=True)
        compose(TARGET, "up", "-d", "api", "web")
        smoke.BASE = "http://127.0.0.1:18081"
        smoke.cookie = ""
        import time
        for attempt in range(40):
            try:
                status = smoke.request("/api/auth/status")[0]
                break
            except (OSError, AssertionError):
                if attempt == 39:
                    raise
                time.sleep(1)
        if status["needsSetup"]:
            _, headers = smoke.request("/api/auth/setup", {"password": smoke.PASSWORD, "setupToken": "synthetic-operator-token"})
            smoke.cookie = headers["Set-Cookie"].split(";")[0]
        else:
            login()
        smoke.multipart("/api/admin/restore", {}, [("backupFile", "fixture.backup", "application/octet-stream", backup)])
        compose(TARGET, "restart", "api")
        # A restore replaces the auth state too; sign in again with the restored account.
        for attempt in range(40):
            try:
                login()
                break
            except (OSError, AssertionError):
                if attempt == 39:
                    raise
                time.sleep(1)
        assert smoke.request("/api/words/export")[0] == words
        restored_stats = smoke.request("/api/srs/stats")[0]
        for key in ("totalCards", "totalPhrases", "reviewedToday"):
            assert restored_stats[key] == stats[key], key
        assert smoke.request("/api/usersettings")[0]["hasGoogleTranslateApiKey"]
        for path, expected_hash in audio_hashes.items():
            assert hashlib.sha256(smoke.request("/" + path.lstrip("/"))[0]).hexdigest() == expected_hash
        print(json.dumps({"checkpoint": str(checkpoint), "databaseRestored": True, "audioFilesVerified": len(audio_hashes),
            "providerSecretDecryptable": True, "srsHistoryPreserved": True}, indent=2))
    finally:
        compose(SOURCE, "start", "api")


if __name__ == "__main__":
    main()
