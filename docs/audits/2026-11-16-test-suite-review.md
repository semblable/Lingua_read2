# Test suite review — 16 November 2026

## Implemented follow-up

The findings below describe the original audit snapshot. The subsequent test-suite
improvement implements these changes:

- Added 11 direct upload-transport tests; verified that missing credentials,
  missing CSRF headers and skipped unauthorized handling each cause failures.
  Mutation transforms ran only in temporary test configuration; production files
  were unchanged.
- Replaced copied backend queries with SQL captured from four production entry
  points, checked actual sorting flags, and consolidated duplicate cookie tests.
- Removed six internal hook shape checks and renamed markup-only layout checks.
- Reduced browser discovery from 295 to 255 instances, retaining all 60 resulting
  logical scenarios (52 component scenarios plus eight isolated experiments).
  Added actual short-viewport modal scrolling and stronger retry-control bounds.
- Added `npm run test:app`, a production Docker-stack smoke workflow covering
  setup, XHR upload, saved vocabulary, durable offline replay, review grading and
  sign-in persistence. CI runs it separately and gates API/web image builds on it.

Verification after these changes: **2,239 client tests**, **1,976 backend tests
including the PostgreSQL cases**, and **255 browser cases** passed with no skips.
Full lint and type checking passed. The production app smoke also passed against
the real nginx/API/PostgreSQL stack; its final durable-reload check is recorded in
`tmp/test-suite-improvements-app-durable.log`. Docker production builds include
the existing build/notices checks. No production application code was changed.

## Verdict

The suite is large, but its size is not the main problem. Many tests protect expensive failures: lost edits, stale asynchronous responses, duplicate study credit, concurrent word creation, scheduling drift, multilingual offsets and unsafe migrations. Keep those. There is a smaller, identifiable tail of redundant execution and assertions that promise more than they verify.

The best next move is selective consolidation plus a small production integration layer, rather than a target percentage reduction. A green suite currently establishes considerably more about isolated components than about the assembled application.

## Scope and execution

Reviewed client unit/component tests, backend tests, browser fixtures, demo tests and CI configuration, with separate reviewers for the three major test layers. No application or test source was changed.

| Layer | Inventory / result |
| --- | --- |
| Client | 137 files; **2,234 tests passed**, zero pending, approximately 55 seconds in this local run |
| Demo | **8 tests passed** in one file; approximately 2.7 seconds |
| Backend | 1,060 ordinary Fact/Theory declarations plus 13 conditional PostgreSQL facts across 117 C# files; parameterization expands execution count |
| Browser | Playwright discovery reports **295 instances**, comprising 59 logical tests across five Chromium projects; execution not performed for this review |

The attempted backend `dotnet test Lingua_Read.sln --no-restore` produced no output and was stopped. **No backend pass is claimed.** CI provisions PostgreSQL and enables the conditional facts; a normal local run without `LINGUA_STUDY_TEST_POSTGRES` skips them. Existing historical timing artifacts were not treated as current results.

Current run artifacts are under `tmp/test-suite-audit-client.json`, `tmp/test-suite-audit-client.log`, `tmp/test-suite-audit-demo.log` and `tmp/test-suite-audit-server.log`.

## Findings, in priority order

### 1. The browser suite does not verify production assembly

`client/lingua-read-client/vite.browser.config.ts:5` explicitly excludes production entry, authentication bootstrap, offline synchronizer, service worker and API proxy. `browser-tests/fixture/main.tsx:33` replaces destination routes with a text probe. These are useful browser component/integration checks, but all 295 can remain green through failures in the omitted paths. Service workers are also blocked in `playwright.config.ts`.

Add a few real application checks against the isolated verification stack: sign in, import/open a lesson, save vocabulary, reload and verify persistence; grade a review and verify persisted state. Add one focused actual offline/reconnect scenario if offline remains a supported workflow. Existing `verification/smoke.py` is useful API evidence, but the reusable CI workflow does not run it and it cannot establish browser/service-worker behavior.

### 2. Two backend tests give specific false confidence

`server/LinguaReadApi.Tests/WordsLowerTermIndexTests.cs:31` constructs duplicate LINQ queries inside the test instead of invoking the controller/linker/counter it claims to guard. Production queries can drift while it stays green. Keep the migration assertion; replace the duplicate-query assertion with SQL capture around actual production calls. Checking an expression alone also does not establish actual index use.

`LessonLoadingOptimizationTests.cs:163` names a scenario where explicit sorting ignores `skipSort`, but the call at line 170 never passes `skipSort: true`. `server/LinguaReadApi/Controllers/WordsController.cs:277` currently skips the entire sorting switch when that flag is true. Establish the intended contract, then make the test exercise it. This is a demonstrated test mismatch, not an established product requirement.

### 3. Upload UI tests stop above the real transport

`BookCreate.test.js:15` and `BatchAudioCreate.test.js:9` mock the domain API. No source test exercises `uploadWithProgress` or `XMLHttpRequest`. Removing cookie credentials or the request header at `src/utils/api/client.ts:64` would evade those tests. Add focused transport assertions for credentials/header, success parsing, unauthorized responses and network failure, ideally complemented by the real upload smoke path.

### 4. The browser matrix has avoidable repetition

All three `browser-tests/word-status.spec.ts` cases set their own viewport, as do two accessibility cases (`accessibility.spec.ts:64,102`), then run in every project. These five logical cases generate 25 instances. Roughly 10 could retain both touch and pointer behavior without repeating every configured width. Keep the input distinctions: setting viewport width does not change `isMobile` or `hasTouch`.

`layout.spec.ts:45` loops over 800/1024/1600 inside every project. Run that explicit breakpoint loop only under relevant input profiles. The classic/modern audio loops at `layout.spec.ts:119` render the same classic audio mode because `src/pages/TextDisplay.tsx:286` forces that fallback. Keep one full audio matrix and a focused Modern-preference fallback assertion. These are candidate reductions, not measured runtime savings.

Eight `interaction.spec.ts` cases expand to 40 instances for an explicitly isolated interaction spike. Its hook has no production consumer. Keep experimental tests with the experiment, but separate their CI scope and reported coverage from released reader behavior.

### 5. Trim weak or dormant checks selectively

- `src/__tests__/DownloadForOfflineButton.test.js:63` begins 14 cases for a component with no production importer; `vite.config.ts:139` documents the paused feature. Retire component and tests together if it is abandoned, or keep them together if reactivation is planned.
- Hook tests asserting the documented result shape (`useReaderState.test.js:54` and equivalent audiobook/reader hook files) pin internal setters and refs. Prefer TypeScript checks and existing behavior tests where these cover the same contract.
- `AuditUi.test.jsx:40` claims dialogs scroll within the viewport but only checks Bootstrap classes/body existence. `Library.test.js:364` similarly claims title wrapping through markup assertions. With happy-dom and `css: false`, these cannot prove layout. Rename them honestly or transfer the promised behavior to browser bounds/scroll checks.
- `AuthControllerTests.cs:99,123` repeats setup and real password hashing to split cookie-presence and HttpOnly assertions; setup tests at 295/320 do likewise. Combine assertions within each scenario.

## Protections worth retaining

- Autosave during in-flight edits (`useAutoSave.test.tsx:137`), delayed completion after deletion (`useWordStatusMutations.test.tsx:86`), and stale translations crossing sentences (`TextDisplay.test.js:4031`).
- Browser delayed-save target identity/retry, repeated-word selection, native audio events with payload assertions, fresh Settings stylesheet checks and negative controls for overflow assertions.
- Actual PostgreSQL concurrent/deduplicated activity tests, coordinated word-insert races, repeat-safe V4/V5 migrations, HTTP cookie/session revocation tests and independent FSRS reference vectors.
- Shared multilingual golden execution on both client and server. That duplication verifies parity across independent implementations.

Forty-nine backend files use EF InMemory. They can verify branching and state changes, but cannot establish production SQL translation, database constraints or transaction behavior. The existing SQLite/PostgreSQL tests are important complements.

`TextDisplay.test.js` has 4,291 lines and expands to 155 cases in this run. Splitting it by workflow would improve failure diagnosis and maintenance; its length alone is not a reason to delete regression protection.

## Recommended order

1. Correct the misleading backend checks and cover upload transport.
2. Add a small production browser smoke layer; make CI scope explicit.
3. Reduce fixed-viewport and duplicate audio matrix executions, and separate experimental checks.
4. Consolidate internal shape/cookie checks and resolve dormant feature ownership.

No coverage or mutation-testing gate was found in the reviewed test configuration/CI. A targeted mutation exercise on save ordering, ownership and deduplication would be useful evidence of assertion strength. Neither a coverage percentage nor this inspection proves a defect-detection rate; do not introduce a repository-wide threshold simply to replace test-count targets.
