# Accessibility implementation evidence

Updated 2026-11-14. The implementation and regression fixes use revision
`c0e6af19` as their baseline. This records targeted engineering evidence, not whole-app WCAG
conformance or a completed release sign-off.

## Implemented scope

| Slice | Implemented | Remaining gate |
| --- | --- | --- |
| 0 | Pure interaction model/invariants; authored mixed and mostly-Untracked fixtures; original-revision and current captures across reader presentations | No manual AT baseline |
| 1 | Isolated paragraph/sentence/transcript prototype, native control route, source-span identities, exact virtual-row return, marker candidates | Screen-reader mode/key delivery, continuous reading, phrase child access and marker usability review |
| 2 | Shared panel/hover save coordinator, optimistic state, per-entity FIFO, provisional-ID transfer, rollback/retry, offline replay, generation/session protection | Human speech-timing and physical offline/reconnect review |
| 3 | Narrow lookup modal with contained focus, inert background, named close controls, Escape and validated connected-anchor return | Production passage navigation/roving focus is deliberately not wired before the AT gate; virtual remount return is only in the prototype |
| 4 | Shared focus/reflow/motion rules, scoped contrast fixes, prose-link underlines, selected-state cues, chart tables/date inspector | Actual browser zoom, OS contrast theme and physical touch/large-text review |
| 5 | Opt-in High Contrast Light/Dark; centralized theme application; persisted shortcut and experimental marker preferences; reading preview | PostgreSQL upgrade in a disposable running database; final marker choice and full visual-state review |
| 6 | Reducer/hook/API/browser tests, scoped axe scans, CI inclusion and documentation | The manual matrix below and remaining slice exits |

Production keeps the existing hover plus `1`–`5`/`I` workflow. Character shortcuts
can be disabled in Settings. Navigation experiments never look up, translate, seek
or award credit merely by moving. They remain outside production and demo imports.
See [the spike and its limitations](../client/lingua-read-client/browser-tests/INTERACTION_SPIKE.md).

## Intended appearance differences

- Existing turquoise primary buttons use readable dark text. Light prose links
  are darker; Dark/Classic Dark links are slightly brighter and prose links stay
  underlined. Navigation selection has an underline.
  High Contrast menu glyphs have explicit contrasting strokes and a system-color
  fallback in forced colors.
- Light translation colors are darker; the Dark translation blue is lighter.
  Corresponding translation segments have visible matching numbers. Their panels
  size naturally inside a scrollable dialog.
- The Familiar tint is less opaque in Dark/Classic Dark to keep passage text
  readable. Known/Ignored remain plain.
- Save feedback and the pending count each reserve a line, so their normal
  insertion, delayed announcement and completion do not move hovered words.
- Shared visible focus rings, minimum control sizes, wrapping panel actions,
  forced-colors cues and reduced-motion handling apply to every palette.
- Statistics provide native data tables, including missing comparison values.
  The heatmap has a date inspector and full daily table instead of hundreds of
  Tab stops. High Contrast chart series use scoped tokens.

Experimental markers default **off**, including in High Contrast themes. When
enabled, Untracked uses dots; New a solid underline; Learning dashes; Familiar a
double underline; Advanced a wave. They use ink-skipping text decoration and do
not add marks to Known/Ignored. This is a reviewable candidate, not a proven
multilingual or color-vision-deficiency treatment. The stronger candidate stays
in the isolated experiment. Native labels expose the exact status independently.

## Automated evidence

Environment: Windows NT 10.0.26300, Node 24.22.1, .NET 10, Playwright Chromium.
Browser projects cover mobile 320/390/430px, desktop 1280px and a separate desktop
320px project. Text-spacing overrides, forced-colors emulation and live reduced
motion changes are automated checks; they do not establish real zoom or AT support.

| Final check | Result |
| --- | --- |
| Client unit/integration suite | 2,168 passed, 135 files, no skips |
| Chromium browser suite | 250 passed, no failures, skips or flaky results; local run used four workers |
| Final narrow visual/menu-icon checks | 54 passed after the High Contrast glyph correction |
| Synthetic word-write allowlist follow-up | 10 passed after origin/payload restrictions |
| Lint / typecheck | Passed; 0 lint errors, 34 existing warnings |
| Production build and boundary/notice checks | Passed |
| Demo tests / build | 7 tests passed; build passed |
| Server restore / Release build / tests | Passed; 1,934 passed, 13 PostgreSQL-only skips |
| Original-revision visual captures | 34 checks passed, 320px/1280px, three original themes |

Builds retain the existing large-chunk advisory. No new production dependency was
introduced; axe is test-only. Automated checks cover the hover-target,
translation scroller, modal, exact-form translation and regression-review
corrections. Lint retains 34 existing warnings and no errors.

The original-style baseline was reconstructed after implementation from a Git
archive of `c0e6af19`, rather than captured before editing. Its application source
was unchanged; source blobs were verified with Git's text/line-ending filters.
Only synthetic capture adapters, the loopback port and dependency-cache location
were changed in that temporary snapshot. It covers first-read/mixed passages,
classic/modern reading, sentence presentation and audio in all three old themes
at 320px/1280px. Original fonts loaded from the installed dependencies. The
temporary source snapshot was removed after capture.

Use `verification/accessibility/baseline-original/` for the before images and
`publish-browser/` for the final implementation images; `visual-final/` records
narrow captures after the menu-icon correction. The earlier `baseline/` folder
contains early implementation images and is **not** the untouched baseline.
`baseline-source-provenance.json` records source verification. The post-review
client and browser JSON reports are `post-review-client-final.json` and
`publish-browser.json`; the earlier implementation reports remain
`client-tests-final.json` and `browser-complete.json`.

The mutation tests cover same/different-word ordering, duplicate occurrences,
create-to-ID transitions, late translations, refresh reconciliation, offline
replay/failures, reader generations/remounts, logout isolation and consolidated
feedback. The production-reader browser overlay permits only validated synthetic
word IDs/status writes. The original layout fixture still rejects every mutation
and external request. Sentence layout captures mount the production presentation
with inert action adapters because mounting full sentence mode records progress.

The contrast helper composites solid ancestor colors and group opacity; gradients
and images are reported as unsupported. Selected computed-state checks and axe
are supplemental evidence, not a complete contrast audit or speech test.

Run from `client/lingua-read-client`:

```powershell
npm run lint
npm run typecheck
npm test -- --run
npm run test:browser
npm run build
npm run demo:test
npm run demo:build
```

Run from the repository root:

```powershell
dotnet restore Lingua_Read.sln
dotnet build Lingua_Read.sln -c Release --no-restore
dotnet test Lingua_Read.sln -c Release --no-build
```

Server verification passed: **1,934 tests passed, 13 PostgreSQL-dependent tests
skipped**, zero build warnings/errors. Settings round trips are covered with
SQLite; model/snapshot discovery and the actual Npgsql-generated idempotent
migration SQL/defaults are checked. The additive migration is
`20261113143545_ReaderAccessibilityPreferences`; it only adds booleans with
defaults true (character shortcuts) and false (experimental markers). Client API
types were regenerated from locally generated updated Swagger.

Docker's Linux-engine named pipe is absent, including outside the sandbox.
No application/private database was used. The optional isolated-schema PostgreSQL
regression runs with the existing disposable `LINGUA_STUDY_TEST_POSTGRES`
`Database=studycheck` test contract, including in CI. Actual local PostgreSQL
upgrade/repeat/round-trip execution remains untested.

Local outputs are under `verification/accessibility/`: client JSON, server TRX,
browser screenshots/traces and lint JSON. The initial sandbox blocked loopback
sockets; the browser and .NET test host were rerun with approved local execution.
No unavailable environment was counted as a pass.

At the starting revision, hovering supplied the target for `1`–`5`/`I`; clicking
opened lookup; native selection and panel phrase extension supplied multiword
targets. Status paths could await a translation, blocked globally during unrelated
translation work, and updated separately after network completion. The new tests
retain the selection, language/lemma, sentence-context, bookmark, mining and
playback contracts while the shared coordinator changes persistence/feedback.
Pointer targeting now snapshots the current hover synchronously; generation
changes invalidate it. DOM assertions establish emitted feedback, not spoken AT
output. Screenshot inspection of mixed/first-read candidates found no basis to
enable experimental markers automatically; native typography/user review remains
pending.

Pending/queued word changes use a compact count so offline triage does not insert
a growing list above the passage. Per-word failures keep their reachable retry
controls; the active word/status remains in the consolidated feedback message.

## Regression review follow-up

An independent agent reviewed the tracked changes and new implementation files,
including reader saves, exact/lemma/phrase identity, translations, offline replay,
session boundaries, focus, preferences, migrations, presentation and fixtures.
The coordinator independently checked the reported failures. The follow-up covers:

- Retiring a deleted word's coordinator identity, so saving the same term again
  creates a fresh vocabulary row and late completions cannot restore the deleted
  row in the reader.
- Matching offline replay to the queued change across passages, so an older
  result cannot confirm a newer intent and a terminal failure remains actionable.
  New edits stay behind older queued creates of that word even when the passage
  changes during reconnect; unrelated words remain independently editable.
- Retaining or refetching automatic translation on save retry while preserving
  later explicit translation edits, including intentional clearing.
- Loading experimental marker styles with the shared theme styles, so a fresh
  Settings preview works without first visiting the reader. Its browser check
  uses a standalone settings import graph and asserts no reader files load.
- Reserving progress and announcement rows after a full browser run exposed a
  hover race: delayed feedback moved the next word away from a stationary
  pointer before its status key arrived. A controlled-clock regression failed
  before the fix and checks stable word bounds through insertion, delayed speech
  output and completion. All five viewport projects and five extra repetitions
  of the three status scenarios at 430px passed. Long wrapping announcements and
  error lists still expand naturally; this does not establish a fixed-height
  layout for arbitrary phrase lengths or user text settings.

Regression cases belong in the normal client test suite. The isolated review
reproductions under `verification/accessibility/review/` are local diagnostics;
they are not the release test entry point. The review also observed a pre-existing
stale-read window: a vocabulary GET started during a PUT can return its older
snapshot after the PUT confirms. That separate refresh-ordering issue is outside
these review fixes. Pending/queued intent protection does not establish ordering
for every completed write and background read.

The final focused persistence/reader run passed **212 tests in five files**;
typecheck passed. The three original introduced persistence reproductions also
passed independently after adapting the deletion diagnostic to the production
retirement lifecycle. A fresh-settings browser check verifies computed markers
without loading reader files; the full Chromium matrix includes it at all five
viewports. Production and demo builds passed their boundary/notice checks, and
all seven demo tests passed. Server results above are from the implementation
pass; the regression follow-up changes client code only.
After the feedback-layout correction, **163 reader/keyboard tests** and the full
typecheck passed; production/demo builds and lint were repeated.

## Manual release matrix

Primary first-release validation target: NVDA with Chrome on Windows, followed by
NVDA with Firefox. These are test targets, not supported-combination claims.
For every run record revision, date, OS, browser/AT version, preference values,
fixture, entry/exit, speech flow, key delivery, outcome and remaining issue.

| Environment/review | Result |
| --- | --- |
| NVDA + Chrome and Firefox, Windows | Untested; browser/AT versions not recorded |
| JAWS + Chrome/Edge, Windows | Untested |
| VoiceOver + Safari, macOS | Untested |
| VoiceOver + Mobile Safari, physical touch device | Untested |
| Real desktop 200%/400% browser zoom and on-screen keyboard | Untested |
| Real Windows contrast theme | Untested; Chromium emulation is supplemental only |
| Native multilingual typography/marks/annotation review | Untested; authored examples and screenshots only |
| Grayscale/protan/deutan/tritan simulation | Untested |
| Color-vision-deficient learner usability review | Not available |

Do not enable production passage interaction or choose automatic marker defaults
from the automated results alone. Preserve the existing tokenizer version,
vocabulary IDs, occurrence counts, bookmarks, SRS and offline queue contracts when
connecting the tested controller after these gates are resolved.
