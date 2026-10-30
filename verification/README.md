# Isolated full-app verification

Run from the repository root. These files are for original synthetic fixtures
only. Do not merge this Compose file with production, mount a personal library,
or replace its synthetic credentials with production credentials.

For language, statistics and repeat-credit work, use the separate
[focused checks](language-support/README.md). Release evidence is summarized in
[one record](../docs/RELEASE_VERIFICATION.md); past implementation detail is in Git.

```powershell
docker compose -f verification/compose.yml -p linguaread-verify-20261028 up --build -d
python verification/smoke.py
python verification/restore.py
```

`smoke.py` exercises production authentication/setup, TXT import, vocabulary and
phrase saving, mining, real FSRS grading, duplicate review replay, and missing-key
feedback, then creates a three-second original silent WAV/SRT lesson. It permits
successful 200/201 responses and checks rejection paths explicitly. Re-running
adds tiny synthetic books/lessons; it does not erase them. It is an API smoke
workflow, not a substitute for a browser or touch test.

The source stack exposes only `127.0.0.1:18080`. The API and database use an internal
Docker network; only the web proxy joins the ingress network needed for host port
publication. Provider keys are empty, `ExternalWrites:Disabled` is true, and there
is no backup sidecar or remote report destination. Builds may download public
packages/images. The production Dockerfiles, migrations, scheduler, database,
and frontend build are used. This does not change existing deployments.

`restore.py` takes an in-app database dump, stops the source API for a matching
media/key checkpoint, and copies the five separately preserved volumes into
`linguaread-verify-restore-20261029`. It restores through the target API at
`127.0.0.1:18081`, restarts it, signs in again, and compares vocabulary, review
counts, audio SHA-256, and the decrypted synthetic provider-key presence flag.
The target database is overwritten. Both project names are fixed, all copied
volumes belong to those projects, and no host media/key directory is mounted.
The source API is restarted in `finally`. Checkpoints are retained in a new OS
temporary directory. PostgreSQL client/server must have compatible versions.

For the actual Anki importer check, install its official backend in an isolated
temporary directory (no changes to application dependencies or an Anki profile):

```powershell
python -m pip install --target "$env:TEMP\linguaread-anki-verification" anki==26.9.3
python verification/export.py
```

This uses the live source app, verifies context rows and spreadsheet protection,
creates a new temporary Anki collection, imports all six fields, verifies multiple
contexts/Unicode/literal HTML, and repeats the import after a translation change.
It checks that notes update without duplication and receive new Anki scheduling.
See the [export guide](../docs/VOCABULARY_EXPORT.md) for learner instructions.

The fixed synthetic password is `synthetic-learner-password`; the production-mode
setup token is `synthetic-operator-token`. These are test fixtures, never operator
credentials. Open [the source app](http://localhost:18080) for reader/audio tests.
Use 390×844 and 844×390 viewports, then reset the viewport override. Record real
phone/touch testing separately. A duplicate-review HTTP replay does not establish
that a browser's service worker and IndexedDB survive an actual network loss.

To stop the verification projects while retaining their checkpoints and volumes:

```powershell
docker compose -f verification/compose.yml -p linguaread-verify-20261028 stop
docker compose -f verification/compose.yml -p linguaread-verify-restore-20261029 stop
```

No deployment, publishing, external reporting, or release tagging is part of this
workflow. Record the tested revision, versions, results, and limitations for each
run; API checks and desktop browser viewports do not establish physical-phone or
complete offline-browser support.
