# Release evidence

Historical checkpoints, not a claim that the current release candidate passed. Re-run relevant checks at the intended release commit; use [the release checklist](RELEASING.md) for open gates.

## Full-app reliability and export pass (2026-10-29)

Release preparation in [PR #130](https://github.com/semblable/Lingua_read2/pull/130) used isolated synthetic Docker installations, PostgreSQL 18.6, .NET 10 and the production application builds.

| Evidence | Verified scope |
| --- | --- |
| [Smoke workflow](../verification/README.md) | Protected first setup, login/revocation, TXT import, vocabulary/phrases, mining, real FSRS grading, duplicate review replay and missing-provider feedback. |
| [Restore drill](BACKUP_AND_UPGRADE.md) | Database plus separately preserved media/key volumes restored into a second isolated installation; vocabulary/review totals, audio checksum and decryptable synthetic setting matched. |
| [Context/Anki export](VOCABULARY_EXPORT.md) | Unicode, multiple/orphaned contexts, ownership, serialization and update identity; official Anki 26.9.3 backend importer passed in a disposable collection. A separate correction covered null/blank source-title fallback on SQLite and PostgreSQL. |
| Browser | Desktop Chromium at portrait/landscape widths exercised reading, saving, review, audio controls and cached audio. Fixtures used original text and silent generated audio. |
| Automated | Release-preparation suites passed 1,151 backend and 1,141 client tests, plus demo/build/notice guards. These are dated results, not current suite totals. |

No personal library, production database or real provider credentials were used. Full commands are in [verification](../verification/README.md); detailed chronology is recoverable from Git history.

## Language and activity work (2026-10-30)

[The ledger CI checkpoint](https://github.com/semblable/Lingua_read2/actions/runs/41017440350) passed 1,212 backend checks, including three PostgreSQL concurrency/migration facts, plus client checks, builds and staging smoke tests. Synthetic reports, current reproduction commands and header screenshots are in [language verification](../verification/language-support/README.md).

This supports bounded data-preservation/replay behavior, not linguistic readiness for all 44 languages. See the [short roadmap](LANGUAGE_SUPPORT_PLAN.md) for remaining work and counting constraints.

## Fractional lesson totals (2026-11-05)

[Behavior, accounting rules, review findings, and local verification](FRACTIONAL_STUDY_TOTALS.md)
cover direct input, 0.1× steps, sentence-credit reconciliation, retry/reset
protection, and migration compatibility. Feature commit `82077565` received an
independent review; both accounting findings were fixed and re-reviewed.

Local checks passed 1,810 client tests and 1,767 server tests, with nine
PostgreSQL-specific tests skipped, plus type checking, lint, builds and six demo
tests. These working-tree results included unrelated edits excluded from the
commit. The [commit-specific staging run](https://github.com/semblable/Lingua_read2/actions/runs/42029272598)
ran PostgreSQL checks: 1,774 server tests passed and one historical downgrade
assertion failed after projecting removed columns. A follow-up corrects that
assertion to inspect the surviving event ID. Deployment/promotion evidence needs
a successful subsequent run; browser access prevented visual verification.

## Password-free local mode (2026-11-06)

Feature commit `c2ab8ec1` adds opt-in `LINGUAREAD_LOCAL_MODE=true`. A subagent
implemented it, the primary agent reviewed it, and a separate reviewer subagent
completed an [independent local-mode review](audits/2026-11-06-audit-verification/LOCAL_MODE_REVIEW.md)
with no actionable findings. The reviewer independently passed 59 backend tests,
31 frontend tests, both configuration checks and a real Vite-to-mock-upstream
exercise covering API/media forwarding. It also reviewed the follow-up security,
architecture, upgrade and release-checklist documentation.

Local full runs passed 2,036 frontend tests and 1,903 backend tests, with nine
PostgreSQL integration tests skipped locally, plus typecheck, lint, production
build and six demo tests/build. Request tests cover fresh local owner access,
default-off password mode, credential preservation, CSRF without cookies,
untrusted peers/hosts/origins, forwarding-header spoofing, and admin/media gates.
Compose merge and resolved Vite proxy checks are retained in CI. The
[commit's CI/staging workflow](https://github.com/semblable/Lingua_read2/actions/runs/42219676231)
passed server, client and configuration checks, all three image builds and the
automatic staging deployment. CI uses its isolated PostgreSQL test database.

These are automated request/configuration results. An independent cold install
and actual browser/device mode-switch checks remain release gates; see the
[checklist](RELEASING.md). No physical-device or public-exposure test is claimed.

## Home redesign, offline audio pause, and audio lesson credit (2026-11-12)

Commits `30f8c072` through `e0b1841a` redesign the Home dashboard and simplify
copy (`30f8c072`, `9fc433a1`), pause offline audio downloads and Workbox audio
caching via `NetworkOnly` routing (`e3897e2d`), restore scoped CSS layout
ownership and add mobile/layout browser coverage and untouched audio/reduced-motion
fixes (`5147d615`, `546e507b`, `9525a5a4`; see
[dashboard follow-up plan](DASHBOARD_FOLLOW_UP_PLAN.md)), and add automatic `0.1×`
audio lesson playback credit with `PlaybackPasses` migration
`20261112155846_AutomaticLessonListeningCredit` and library practice counts
(`e0b1841a`; see [audio lesson verification](../verification/audio-lessons/README.md)).

Local checks at `e0b1841a` (in a working tree with separate uncommitted edits to
`CONTRIBUTING.md`, `FEATURES.md`, `docs/OPEN_SOURCE_PLAN.md`, and untracked
verification outputs) passed 2,057 client tests across 129 files, 80 Playwright
Chromium browser tests across 320/390/430/1280px, 6 static demo tests, and
1,910 server tests with nine PostgreSQL-specific tests skipped when
`LINGUA_STUDY_TEST_POSTGRES` is unset. TypeScript `typecheck`, ESLint (0 errors,
34 existing warnings), production client build (`verify-build` and `verify-notices`,
with the `NetworkOnly` audio route verified in `build/sw.js`), EF Core pending
model check (0 pending changes), and local-mode boundary scripts passed. The
auditor subagent observed one intermittent timing flake in
`OfflineRetry.test.tsx` under parallel load that passed isolated, on re-run, and
in the subsequent full client run.

The [commit-specific CI/staging workflow](https://github.com/semblable/Lingua_read2/actions/runs/43256385001)
for clean `dev` commit `e0b1841a` passed all jobs: `CI / Test server (.NET)`
passed all 1,919 server tests (0 skipped, including the nine PostgreSQL tests
against `postgres:18.6`); `CI / Test client` passed lint, typecheck, boundary
checks, unit tests, Chromium browser checks, demo tests, and demo build;
`CI / Check compose & scripts` and all three image builds succeeded; and
`Deploy / staging` succeeded including external `/healthz`, `/api/Health/ready`,
`/api/Health`, compression, and `/` checks.

An independent pre-promotion subagent audit rated `e0b1841a` safe to promote to
production with caveats (0 blockers):

- **Staging endpoint smoke check recommended before promotion:**
  `FoldersController.GetLibraryContents`, `TextsController.GetRecentTexts`, and
  `UserActivityController.LogListeningActivity` with `Lesson != null` were
  verified for Npgsql SQL translation, `[Required]` `Text.Content` nullability,
  and SQLite/in-memory behavior, but `PostgresStudyActivityTests` did not execute
  those three endpoints directly against PostgreSQL at that commit, and CI staging smoke
  checks test health/root routes only. Before triggering `promote-prod.yml`,
  verify `/`, `/library` practice badges, and `0.1×` audio lesson playback on
  staging.
- **Pre-existing non-blocking follow-up items:** `LogListeningActivity` and
  `LogManualActivity` allocate `UserActivity` objects outside
  `LessonStudyActivity.AtomicAsync` across `Serializable`/transient retries;
  book-mode audio progress checks do not skip remote re-seeks after pauses and
  can race or preserve stale local progress on pre-metadata Play or rewind to
  `0s`; `GetRecentTexts` projects non-`srs-story` accessed metadata before taking
  five items and strips HTML tags after the 320-character slice; and
  `GetListeningStats` includes `0`-second rows from sub-0.5s credited lesson
  flushes. Physical-phone touch/keyboard behavior and Safari also remain
  unverified.

### Audit follow-up verification (2026-11-12)

The local follow-up addresses the audit's code and automated coverage gaps:

- `LogListeningActivity` and `LogManualActivity` create fresh `UserActivity`
  entities inside each `AtomicAsync` attempt. Manual rows and cumulative totals
  use one `SaveChangesAsync`. Stable per-invocation identities protect legacy
  keyless listening, and neutral manual-operation receipts survive resets.
  SQLite regressions inject failures before commit and after an actual commit
  whose acknowledgement is lost, verifying fresh entities, exactly-once totals,
  separate-request additivity, and both statistics/language reset interleavings.
- Book and lesson progress saves timestamp the local snapshot before the PUT;
  pause polling preserves local playback/seek intent. Pending resume seeks survive
  transport and native Play before metadata. Intentional zero-position saves
  replace the local fallback, and a server zero outranks older local progress.
  The untouched-zero save guard and one bookmark per book remain covered.
- Recent-text metadata is deduplicated by book in SQL before taking five rows,
  with deterministic ties. Complete HTML tags are removed and entities decoded
  before the 320-character preview limit; only visible entries load content.
- Zero-second automatic listening rows stay available for deduplication/reset
  receipts but no longer create chart days/languages. Totals and negative manual
  corrections are preserved.
- Three new `PostgresStudyActivityTests` directly execute library practice-count
  projection, recent-text summaries (including a long run of book parts), and
  lesson-aware listening credit, concurrent replay, and reset receipts.
- `OfflineRetry.test.tsx` now overrides the suite's wall-time-advancing fake clock
  with `shouldAdvanceTime: false`; exact 1/2-second backoff boundaries depend only
  on explicit timer advancement, including under parallel CPU load.

Validation of the local working tree:

- `dotnet build Lingua_Read.sln -c Release`: passed, 0 warnings/errors.
- `dotnet test Lingua_Read.sln -c Release --no-build`: 1,928 passed, 12 skipped
  with `LINGUA_STUDY_TEST_POSTGRES` unset. A separate filtered run supplied an
  isolated temporary PostgreSQL 17 `studycheck` database: all 12 PostgreSQL tests
  passed, 0 skipped, including the three new endpoints. The temporary server was
  stopped and its data removed afterward.
- `npm --prefix client/lingua-read-client run typecheck`: passed.
- `npm --prefix client/lingua-read-client run lint`: passed, 0 errors and the same
  34 existing warnings.
- `npm --prefix client/lingua-read-client run test -- run`: 2,073 passed across
  129 files, including the progress and deterministic offline retry regressions.
- `npm --prefix client/lingua-read-client run test:browser`: 80 Chromium checks
  passed across 320/390/430/1280px.
- `npm --prefix client/lingua-read-client run build`: passed, including
  `verify-build` and `verify-notices` (15 notices retained).

An independent reviewer reproduced a lost-commit-acknowledgement retry that
doubled a manual request's totals, and identified the same risk for legacy
keyless listening. The stable identities/neutral receipt fix and its before/after
commit and reset regressions passed all 52 focused activity/compatibility tests.
Re-review found no remaining actionable findings; the full Release solution
build/test was rerun successfully after that fix.

The first sandboxed server test attempt could not connect to testhost, and a
sandboxed solution build exited without compiler diagnostics. The successful
server checks, PostgreSQL run, and browser checks ran outside that restriction.
Physical-phone/Safari verification and staging endpoint smoke checks remain open.
Unrelated working-tree edits and private fixtures were preserved.

## Still open

Physical-phone/touch and iOS/Android audio lifecycle; real browser disconnect/reconnect; independent cold install; Anki desktop/mobile import UI; live-provider success; large-library performance; and production upgrade/old-binary rollback.

Repository security/history and asset provenance have their own gates in [RELEASING.md](RELEASING.md). Personal small-host use is not a measured capacity claim: [deployment evidence](DEPLOYMENT_EVIDENCE.md).
