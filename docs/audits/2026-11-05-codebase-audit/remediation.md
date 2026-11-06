# Remediation progress

## Wave 1 — verified

- OFFLINE-01: session-expiry redirects clear caches without deleting pending mutations. An integration test follows a real HTTP 401 through queue drain, re-authentication/replay, and explicit logout.
- OFFLINE-02: HTTP 408 and 429 remain retryable. Regression cases verify retention and successful subsequent replay.
- READER-03: phrase discovery skips loading/error states and unavailable Chinese/Thai runtimes. Regression tests render both states with dictionaries uninitialized. The actual loading hook already waits for pinned dictionary initialization; retain that behavior rather than substituting a different tokenizer.
- UI-03: root, route, and reader boundaries show recovery controls. Route/text changes reset the relevant boundary; route failures preserve navigation. Tests cover fallback, retry, reload, and reset.
- SRS-01: interval doubles are clamped before conversion to integers. Tests cover huge/infinite stability, maximum bounds, and Good/Easy reviews. The audit's one-day result did not reproduce on the local .NET 10 runtime (out-of-range conversion saturated); the explicit clamp removes runtime dependence.

Validation: `npx vitest run` — 118 files, 1,938 tests passed. `dotnet test Lingua_Read.sln --no-restore` — 1,794 passed, 9 skipped (optional PostgreSQL checks), no failures. `npm run typecheck` passed. `npm run lint` — 0 errors, 35 existing warnings.

The sandboxed .NET runner stalled while establishing its local test-host connection. Backend tests completed outside the sandbox with local socket access.

## Wave 2 — verified

- READER-01: standard and sentence modes share the same sentence splitter, including configured and built-in abbreviation handling. Multi-line titles consume one index and images consume none. Unicode sentence punctuation prevents CJK prose being inferred as a title; mixed Korean/Latin prose ending in sentence punctuation is no longer treated as an uppercase heading. Tests compare boundaries/indices across Chinese, Japanese, Arabic, Russian, English, and structured titles.
- READER-02: NFC composition, soft-hyphen removal, and built-in apostrophe substitutions run for every lookup language. Regression vectors include English, German, Spanish, Romanian, and unspecified language.
- SRS-02/SRS-03: story contexts use Unicode word segmentation for lookup and complete-word target matching, retaining original offsets/text. Tests cover short English words inside earlier words, dotted-I offsets, and CJK/Thai UI lookup.

Validation: `npx vitest run` — 120 files, 1,962 tests passed. `npm run typecheck` passed. Backend unchanged since the Wave 1 full-suite pass.

Compatibility note: corrected sentence boundaries can change indices for texts affected by the audit (including text previously misidentified as a title). Existing index-only bookmarks on those texts may need to be set again.

## Wave 3 — verified

- BACKEND-01: uploads use an execution strategy and a transaction covering book metadata, tags, and chapters. Failures roll back without compensating writes; linking is queued after commit. Relational tests inject a database outage that also rejects compensation and verify no book, tags, chapters, or queued work survives.
- GOALS-01: goal reads/updates use the existing per-user serializable transaction helper, including PostgreSQL advisory locking. Migration `20261105200000_UniqueGoalPeriods` keeps the latest duplicate history row and adds the unique `(GoalId, PeriodEnd)` index. Tests exercise concurrent reads, migration cleanup/constraint enforcement, PostgreSQL SQL generation, and model/snapshot agreement. Migration authored only; no deployed database modified.
- BACKEND-05: global language create/update/delete require the admin policy. User-scoped content reset retains its existing authorization. Regression checks cover both distinctions.
- BACKEND-06: book completion leaves the shared language counter unchanged and credits user statistics. Tests preserve an existing catalog counter and another learner's totals.
- STATS-01: already addressed in the current implementation by explicit zero-duration study passes. Added a heartbeat-plus-panel-pass regression (including retry) that proves no duplicate listening credit. Existing external-listen behavior remains covered.

Validation: full `dotnet test Lingua_Read.sln --no-restore` — 1,801 passed, 9 skipped, no failures; final migration/import targeted run — 5 passed. Frontend unchanged since the Wave 2 full-suite pass.

## Wave 4 — verified

- READER-04: SRT fractions are padded to millisecond precision; transcript parsing retains numeric dialogue by cue position and preserves line breaks rather than adding spaces to CJK text. Frontend fraction tests and backend transcript/import tests cover these cases.
- READER-05: client and server batch imports accept MP3, M4A, AAC, OGG, Opus, WAV, and ordinary matching base names. Exact names take priority over suffix heuristics; legacy language suffixes still work. Client and server regression theories exercise all six formats.
- READER-07: media errors suspend/flush listening, reset segment playback and auto-advance, and clear playing state. A regression verifies that elapsed time after an error is not credited even without a pause event.

Validation: `npx vitest run` — 120 files, 1,972 tests passed. Full `dotnet test Lingua_Read.sln --no-restore` — 1,809 passed, 9 skipped. `npm run typecheck` passed.

## Wave 5 — verified

- PERSIST-01: unguarded page, toolbar, and legacy settings writes use the shared safe storage wrapper. A quota-failure integration test proves a successful server save still completes and updates context.
- PERSIST-02: settings auto-save requests use keepalive, including requests already running when the page exits. The auto-save hook guards state updates after unmount and avoids creating completion timers after disposal. Existing exit-save tests and a deferred-request regression cover both paths.
- PERSIST-03: the form already coalesces/debounces ordinary partial patches. All settings API writers now share a request queue, including explicit secret saves, so secret/form requests cannot overlap. A deferred-request test verifies serialization and recovery after failure.
- SRS-04: out-of-range vocabulary pages clamp and refetch the last available page. A delete-from-page-two regression verifies recovery without pagination controls.
- SRS-05/SRS-06: CSV headers normalize BOM, whitespace, and casing; frontend validation, backend DTO validation, and batch persistence accept status 6. Explicit imported statuses are restored on existing rows while default mark-known and keep-existing behavior remain covered.
- SRS-07: folder deletion appends reparented folders/texts/books after existing content, including moves staged earlier in the same bulk deletion. Single/bulk deletion regression tests verify distinct sort keys.
- SRS-08: simple CSV exports use the existing formula-safe cell encoder. Regression tests cover formula triggers in terms and translations, including leading whitespace.
- UI-01/UI-02: the mobile navbar collapses on selection, exposes its expansion state, and includes Goals. A navigation interaction test verifies the behavior. UI-03 was completed in Wave 1.
- UI-04: goal and manual-entry dialogs have scrollable bodies, with regression coverage.
- A11Y-01: folder color swatches are named native buttons with selected state, covered in create/rename dialogs.
- A11Y-02: global playback/review shortcuts ignore interactive descendants, editable regions, handled events, and browser modifiers. Cloze hints retain Alt+H without intercepting Ctrl+H. Regressions cover native buttons, nested icons, review controls, and browser history.
- A11Y-03: the heatmap exposes a labelled region with labelled day images rather than an incomplete interactive grid. Regression checks retain day counts and verify semantics.

## Independent review — November 6, 2026

A user-requested subagent review found two issues, both corrected and cleared on follow-up review:

- Ambiguous import commits: capture the pending book ID before commit, verify its presence after transaction disposal before cleanup/retry, and preserve assets when verification is unavailable. Background linking publication runs outside the retry delegate. Four transaction-interceptor cases cover failures before/after commit, with/without retries, and confirm no duplicate book or lost assets.
- Oversized settings patches: choose keepalive only for complete JSON bodies at or below 64 KiB, measured in UTF-8 bytes. Larger prompts save through normal requests while the page is open. Regression cases cover ASCII and multibyte prompts.

The follow-up review reported no remaining blocking findings.

## Final verification

All five roadmap waves are complete. Other findings outside the roadmap remain outside this change.

| Check | Result |
| --- | --- |
| `dotnet test Lingua_Read.sln --no-restore` | 1,825 passed, 9 skipped, 0 failed |
| `npx vitest run` | 122 files, 1,988 passed, 0 failed |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed: 0 errors, 35 existing warnings |
| `npm run build` | Passed, including bundle and notice verification |
| `git diff --check` | Passed |

The nine skipped tests require `LINGUA_STUDY_TEST_POSTGRES` pointing to an isolated `studycheck` database. The new goal migration was verified with SQLite upgrade/uniqueness tests and PostgreSQL SQL generation/model consistency; live PostgreSQL integration was not run locally. No database migration was applied.

The build still reports a large-chunk warning; lint retains its existing warnings. No unrelated user changes were altered.
