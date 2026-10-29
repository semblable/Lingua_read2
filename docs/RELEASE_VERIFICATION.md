# Release verification

Repository preparation is implemented; the real-world validation and release
gates below are still explicit. No release tag, production deployment, repository
setting change, or learner invitation was made in this work.
The app fixes were subsequently deployed to staging at the maintainer's request;
see the dated checkpoint at the end of this record.

## Initial preparation (2026-10-28)

- Reworked the README around the reading/listening workflow, the existing public
  demo URL, two actual demo screenshots with provenance, concise Docker setup,
  password setup/login, language limitations, and experimental status. Confirmed
  the public demo page loads at `https://semblable.github.io/Lingua_read2/`.
- Added `LICENSE`, `THIRD_PARTY_NOTICES.md`, the complete py-fsrs MIT notice,
  upstream attribution beside adapted C# code, and complete bundled font/icon
  notices. Verified notices in app/demo output and server publish output.
  Legacy app-icon provenance remains a maintainer review gate.
- Added `CONTRIBUTING.md`, `SECURITY.md`, bug/learner issue forms, a pull-request
  template, and sustainable support expectations. GitHub private reporting still
  needs to be enabled/verified before it can be advertised as available.
- Corrected backup expectations: the in-app download is database-only; media,
  configuration, and Data Protection keys need preservation. Added
  [backup/upgrade/recovery guidance](BACKUP_AND_UPGRADE.md) and a
  [release checklist](RELEASING.md). PostgreSQL is internal to Compose by default.
- Fetched remote refs/tags and scanned all 893 available commits with
  checksum-verified Gitleaks 8.30.1. Six findings were three synthetic test keys
  and three historical occurrences of one Google-shaped API credential, absent
  from current appsettings. The maintainer confirmed on 2026-10-28 that it was
  revoked at Google. This is maintainer confirmation, not an issuer-side check.
  A release-file snapshot scan found only the three synthetic test assignments.
  Reports and raw credential values were kept out of this repository. Historical
  private-asset/distribution-rights review remains pending, so the combined history
  private-asset gate remains open in the release checklist.
- Added [deployment/mobile evidence records](DEPLOYMENT_EVIDENCE.md), a
  [five-learner feedback protocol and invitation draft](LEARNER_FEEDBACK.md),
  [architecture and two code-based engineering walkthroughs](ARCHITECTURE.md),
  and a [recording script](PRESENTATION.md). Measurements, recruitment, first-use
  observations, contribution attribution, and an actual full-app recording are
  pending; no learner-driven feature priorities have been invented. The proposed
  app work is now maintained in [the pre-release app plan](PRE_RELEASE_APP_PLAN.md).
- Added demo boundary tests and a project-path demo build to the existing shared
  CI workflow, without publishing the demo on every push.

Verification on this checkout:

| Check | Result |
| --- | --- |
| Full frontend suite | 1,135 passed across 88 files with `--maxWorkers=2`. Initial parallel run had one navigation timeout; that test passed alone and the full reduced-worker rerun passed. |
| Focused tokenizer/offline suites | 145 passed across four files. |
| Demo boundary suite | Four passed. |
| Frontend typecheck and application build | Passed; build-output verifier passed. |
| Lint | Passed configured threshold: zero errors, 45 existing warnings. |
| Backend Release build/test | 1,120 passed, zero skipped; required execution outside socket-restricted sandbox. |
| Backend publish | Passed; py-fsrs notice retained. |
| Demo project-path and root builds | Passed; license files retained. |
| Browser | Project/root build checks plus 15 page/viewport overflow checks, embedded and full reader interactions, and audio playback/seek/speed checks. [Detailed mobile scope and screenshots](DEPLOYMENT_EVIDENCE.md#browser-checks-at-phone-sized-viewports). |
| Docs | Local relative links and Git whitespace checks passed. |

The root build was checked on a local root-served preview, not a deployed custom
domain. Physical-phone testing, a complete isolated restore drill, actual small-host
measurements, private-reporting availability, legacy icon/private-asset provenance,
recorded walkthrough, learner sessions, and tagging/publishing an application release
remain in [the release checklist](RELEASING.md). Choose subsequent feature work from
those observations using [the app plan](PRE_RELEASE_APP_PLAN.md).

## Full-app reliability and export pass (2026-10-29)

Scope: working tree based on `f01e2745`, including the pre-existing uncommitted
release preparation, which was preserved. No existing server was accessed. These
results concern a new local installation, not the maintainer's production servers.
No production data, real provider credentials, external reports, deployment, publication,
Git release tags, or learner observations were used or created.

### Isolated installation and fixture provenance

- Added [repeatable verification commands](../verification/README.md) and a
  standalone Compose file. Source project `linguaread-verify-20261028` and restore
  project `linguaread-verify-restore-20261029` have separate databases/media/keys.
  Host ports are loopback-only 18080/18081. API and database networks are internal;
  the web proxy alone joins an ingress network for port publication. External
  writes are disabled, provider keys empty, and no reporting/backup sidecar runs.
- Used the real application Dockerfiles and migrations, PostgreSQL 18.6, .NET 10,
  and the Node 26.12.1 frontend build with `npm ci`. Fixtures are original tiny
  Spanish text, a three-second generated silent WAV, and two original SRT cues.
  No downloaded book, private library, production dump, or real provider reply is
  involved. The audio checks establish playback/control behavior, not narration
  intelligibility or real-device output quality.
- Docker Desktop initially failed before starting its engine with inaccessible
  AF_UNIX runtime sockets (`dockerInference`, then `engine.sock`). Normal startup
  and restart were insufficient. After its failed processes stopped, only the
  runtime socket directories were renamed aside; no settings, containers, images,
  workload volumes, or data disk was reset or pruned. Engine 29.6.2 then ran. The
  same local issue recurred after interruption and was recovered the same way.
  No diagnostics were uploaded or external report sent. This was local Docker
  infrastructure friction, not an application failure.

### Workflow and recovery evidence

- `python verification/smoke.py` passed against the production-mode Docker API:
  tokenless first setup rejected with 403; operator-token setup and subsequent
  password login succeeded; TXT multipart import created a book/part; vocabulary
  and a multiword phrase were saved; sentence mining created a real card; grading
  Good produced FSRS stability `2.3065`. Replaying the identical client event ID
  returned the same review-log ID; a fresh request retained that result. The
  missing DeepL key produced an actionable 400 without a provider request.
- Browser testing in the desktop app's Chromium-based in-app browser exercised
  stored-word lookup, status 2→3, phrase extension (`gato`→`gato mira`), manual
  translation/status saving, mining (`SRS ✓`), and sentence navigation. Unconfigured
  sentence AI explained how to configure a provider while manual saving remained
  usable. No live provider lookup was attempted on the isolated network.
- In the same installed UI, opened the real review queue, revealed the mined
  `gato` card, graded Good with its displayed two-day interval, and reloaded. The
  persisted review activity and young-card count were visible afterwards.
- Reader/audio checks at **390×844** and **844×390** exercised vocabulary controls,
  sentence mode, next/previous cue navigation, playback, speed 1.00→1.05, and reload.
  DOM media state confirmed a three-second duration, running playback, and seeking
  to 1.4 seconds for the second cue. Save audio for offline changed to **Available
  offline**. Checked pages had no document-level horizontal overflow; reachable
  controls were exercised through the browser, not a touchscreen.
- `python verification/restore.py` passed: downloaded the real `PGDMP` database
  backup, stopped the source API for a matching separate media/key copy, restored
  into the second project's database through its API, restarted it, and logged in.
  Vocabulary CSV bytes and SRS totals/review counts matched; one restored audio
  file matched its original SHA-256. A synthetic Google provider setting remained
  decryptable. A boolean-only database query confirmed its stored value retained
  the Data Protection payload prefix; no secret value was printed. Temporary
  backups and keys were not added to Git.
- An additional operator recovery check on the disposable restore account updated
  exactly one `Users` row to clear its hash and rotate its stamp. The old cookie
  immediately became unauthenticated; token-protected setup accepted a replacement
  synthetic password; the old password failed. Logout invalidated a copied cookie,
  and that revocation remained effective after an API restart.

### Changes and security review scope

- The code review confirmed that original logout deleted only a cookie, JWTs had
  no database revocation check, initial setup was anonymously claimable, and relay
  URL validation accepted arbitrary hosts with a matching path. These were current
  code findings; historical backlog text was not treated as proof of a running
  server exploit. No production exploit or external security audit was attempted.
- Issued tokens now carry the existing user's persisted security stamp; validation
  rejects missing/changed stamps and deleted users. Logout revokes all devices in
  this single-account app. Password change requires the current password, rotates
  the stamp, and renews the current cookie. Incorrect current passwords return 400
  so the client's generic 401 handling does not unexpectedly sign the user out.
  Failed server logout clears local offline data and displays a revocation warning.
- Outside Development, setup requires an operator-configured token (or the operator
  can bootstrap an initial password). Its conditional database update permits only
  the first claim. Existing sessions must sign in again after this upgrade; no new
  schema/migration is required. Operator recovery and JWT-key rotation after restore
  are documented in [the recovery guide](BACKUP_AND_UPGRADE.md#passwords-and-session-recovery).
- Reports require HTTPS/default port, no user information/fragments, recognized
  Discord hosts or exact operator-allowlisted relay hosts. The named HTTP client
  disables redirects/proxies and uses the existing connect-time public-address
  guard. Tests verified rejected URLs, exact host matching, and the actual named
  client's refusal of a loopback address before sending. No real report was sent.
- Setup guidance explains the next import and optional providers. Empty/placeholder
  DeepL/Gemini keys now fail actionably before sending text. Tests verify no HTTP
  request. Backup/Restore UI explicitly distinguishes the database download from
  separately preserved media, configuration, and Data Protection keys.

### Export acceptance

- Added optional `format=context` and `format=anki` to the existing filtered export
  endpoint and a format choice in My Terms. Default/simple CSV and its importer
  remain compatible. Source and context joins independently enforce ownership.
- Context CSV has one row per mined sentence, stable context/source identifiers,
  saved/live titles and available book/URL metadata; a context-free term receives
  one empty-context row. Tests cover multiple/orphaned contexts, foreign ownership
  on each relationship, status/language filtering, missing values, Unicode, commas,
  quotes, CR/LF, and formula protection in every textual column. New context CSV
  prefixes dangerous spreadsheet cells; legacy simple CSV deliberately retains
  exact values. The distinction is documented in [the export guide](VOCABULARY_EXPORT.md).
- A live PostgreSQL fixture exported an accented/quoted term with two contexts and
  a context-free `=1+1` term. Three CSV data rows retained sentences, sources, and
  protection markers. A browser **Export Filtered** download also succeeded.
- Installed the official `anki==26.9.3` Python backend into an OS temporary directory,
  then ran `python verification/export.py` against a new disposable collection.
  The real importer recognized the Tab/HTML headers and six-field note type, created
  two notes from the three context rows, preserved both contexts/Unicode/literal
  markup, and assigned new Anki scheduling. Reimporting a changed translation updated
  the same note without duplication or context loss. No personal Anki profile or
  AnkiConnect server was used. This verifies the backend importer, not desktop or
  mobile Anki's UI. Export is one-way and excludes media/scheduling/history.
- Browser checks caught and fixed a new layout problem: expanded Anki instructions
  initially stretched the landscape filter row. Instructions now sit below it;
  measured language-filter document position stayed unchanged on expansion. Helper
  text uses the app's existing dark-theme contrast class. The format controls were
  checked at portrait/landscape widths. [Portrait export screenshot](evidence/context-export-portrait.png)
  shows only synthetic fixture state. No broader reader/parsing refactor was made.

### Checks and remaining limits

| Check | Result |
| --- | --- |
| Backend Release build/full suite | 1,145 passed, zero skipped. New export tests include SQLite SQL translation; live export also passed on PostgreSQL. |
| Host frontend full suite | 1,141 passed in 89 files, using two thread workers and explicit 10-second test/hook timeouts. |
| Clean Docker frontend suite | 1,141 passed in 89 files with networking disabled and the shared tokenizer golden-vector file mounted read-only. |
| Frontend typecheck/app build | Passed locally and in Docker; build-output verifier passed. API types regenerated from offline Swagger. |
| Lint | Passed configured threshold: zero errors, 45 existing warnings. |
| Demo boundary tests | Four passed after the shared API-helper change. |
| Docs/whitespace | Local Markdown targets and Git whitespace checks passed. |
| Installed smoke/restore/Anki importer | Passed as scoped above; scripts retained under `verification/`. |

Initial default-worker frontend runs stalled; complete thread-pool reruns replaced
those unverified attempts. Host runs emitted `TimeoutNaNWarning`; clean-container
runs emitted existing React `act` warnings but passed. The first clean Docker test
attempt lacked `tokenizer-golden-vectors.json`, which lives above the client build
context; mounting that exact repository fixture resolved the harness failure.

**Still unverified:** a physical phone/touchscreen, iOS/Android audio lifecycle,
actual browser network disconnect/reconnect with service-worker/IndexedDB replay,
live provider success, real public webhook delivery, Anki desktop/mobile import UI,
large-library export memory/performance, and final promoted-release commit checks.
Client offline queue tests, server duplicate replay, online reload, and cached audio
are separate evidence; they are not claimed as a complete offline browser session.
Related-word links, wider parsing changes, and automatic transcription remain
deferred pending concrete learner feedback. Complete the phone/offline check next,
then observe a learner session before choosing additional features.

Both verification stacks were stopped after the checks; their synthetic volumes
and temporary checkpoints were retained for inspection/reruns. The test viewport
override was reset. No existing deployment was stopped or changed.

## Release-preparation review (2026-10-29)

### App checkpoint and staging

- App commits `829b9957`, `0e1681ea`, and `2e9c93f8` contain the first-run/session
  fixes, context/Anki export, and independently reproduced blank-title correction.
  [Independent review](../verification/REVIEW.md) records the six regression cases
  and live PostgreSQL checks. The earlier 1,145-backend-test result above predates
  those six added cases; the current suite has 1,151 tests.
- The maintainer requested staging deployment of
  `2e9c93f82c3360456f003ee340421e64e984d3c3`. The
  [staging workflow](https://github.com/semblable/Lingua_read2/actions/runs/40842067021)
  passed CI, image build, deployment, readiness, and compression smoke checks.
  The maintainer is testing that build. No production promotion or tag occurred.
- Release preparation is reviewed separately on `codex/release-preparation` from
  this app checkpoint. It changes documentation, notices, build verification,
  and CI; it does not change application/session/export behavior or deploy a build.

### Fresh checks on the release-preparation tree

| Check | Result |
| --- | --- |
| Backend Release build and full suite | Passed: 1,151 tests, zero failed/skipped. |
| Backend Release publish | Passed; `ThirdPartyNotices/py-fsrs.txt` byte-identical to source in publish output. |
| Frontend full suite | Passed: 1,141 tests across 89 files, two thread workers and explicit 10-second test/hook timeouts. |
| Frontend typecheck/lint | Passed; lint has zero errors and 45 existing warnings. |
| App production build | Passed, including existing build-output checks and byte comparison of ten shipped notice files. |
| Demo boundary tests | Four passed. |
| Demo production builds | Passed with `/Lingua_read2/` and `/` base paths; ten bundled notice files retained. |
| Notice regression guard | Missing and altered notice fixtures are rejected; npm postbuild hooks enforce it for app and demo. |
| Upstream notice review | Nine font/Bootstrap notices match installed package licenses after line-ending normalization; py-fsrs notice checked against upstream v6.3.2. |
| Compose/docs/whitespace | Base/development and production configurations parse; local Markdown links/anchors, workflow/issue-form YAML, and Git whitespace checked. |

The notice guard checks final output rather than only source files. It catches a
future public-directory or demo-plugin change that omits or alters notices even
when the application compiles. The release review also corrected a stale language
guide anchor, outdated export-plan wording/test counts, a backup table that put
subtitles in the media volume (SRT content is in the database), and the learner
issue form's contribution link. Existing screenshot files were inspected: they
contain only the documented original Spanish/licensed English samples.

Checksum-verified Gitleaks **8.30.1** scanned a fresh snapshot of tracked and
non-ignored files. Four findings were reviewed: three pre-existing synthetic JWT
test assignments and the explicitly synthetic signing key in
`verification/compose.yml`. No real credential was identified by this snapshot
scan. Raw values and the redacted report remain outside the repository; no new
history-wide scan is claimed. The earlier history scan and its limitations remain
recorded above.

Read-only GitHub API inspection returned **private vulnerability reporting
disabled** on 2026-10-29. No repository setting was changed; SECURITY.md directs
reporters to request a private contact without disclosing details publicly.
Enablement and a reporter-side check remain release gates.

### Remaining scope

Automated checks support merging this preparation after PR validation. They do
not establish legacy-icon/private-historical-asset rights, physical-phone behavior,
full browser disconnect/reconnect replay, a new host benchmark, or a successful
learner session. Keep those gates explicit and choose further app work from
reproduced learner friction. Related-word links, broad parsing changes, automatic
transcription, and two-way Anki synchronization remain deferred.

This pass did not access personal production data, send reports or invitations,
alter the running staging build, deploy, promote production, or publish a tag.
