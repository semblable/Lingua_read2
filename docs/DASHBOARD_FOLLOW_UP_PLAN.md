# Dashboard follow-up plan

Updated 2026-11-12. Baseline: dashboard redesign `30f8c072`.
Items 1–2 are implemented (`5147d615`, `546e507b`); preview isolation is next.
Physical-phone staging verification remains pending.

## Constraints

- Keep the due total visible and sessions bounded by `min(due cards, session size)`.
  Saved plans must also respect daily allowances and currently reviewable cards.
- Distinguish saved word forms, vocabulary occurrences, reading credits, and playback
  seconds. Reading credits divided by vocabulary totals cannot establish completion.
- Fix component sizing instead of concealing overflow at the page boundary.
- Synthetic previews need isolated auth, storage, caches, and offline queues;
  intercepting network requests alone is insufficient.

## 1. Mobile browser regressions

- [x] Render real Home/Navigation with authored synthetic API fixtures at
  320/390/430/1280px, including long/accented titles, unbroken terms, audio,
  and missing optional metadata.
- [x] Check element/text bounds and document overflow, including with root overflow
  unmasked. Preserve deliberate title clamps above 400px and compact shelf truncation.
- [x] Exercise navigation/Add menus, session sizes, catch-up controls, and the inline
  goal action; verify bounded SRS destinations for due totals 0/1/12/12,345.
- [x] Run in client CI with failure screenshots/traces and no personal data or
  external services. Negative controls verify overflow detection.
- [ ] Record a physical-phone staging check: touch scrolling, menus, focus, and
  on-screen keyboard; include revision and device/browser details.

[Run and scope](../client/lingua-read-client/browser-tests/README.md).
All 40 browser checks pass. Goal-dialog accessible names/field labels were fixed.
Lint, typecheck, production build, and 2,045 client tests passed; an offline retry
timing test failed initially and passed isolated and full reruns.

## 2. CSS ownership and layout cleanup

Bootstrap owns container padding and grid gutters again. Navbar/Home/Dashboard
opt into `.app-content-width`, using existing width/spacing tokens. Custom layouts
stay scoped; Bootstrap remains in place.

- [x] Inventory intentional flush/full-width layouts, especially reader/audio views;
  give them explicit component classes before changing shared rules.
- [x] Reuse existing layout tokens or add a small shared utility so navbar/dashboard
  widths and responsive gutters align.
- [x] Remove broad container overrides and restore grid gutters incrementally,
  checking reader, library, audio, and forms after each slice.
- [x] Retain shrinkable tracks and `min-width: 0`; allow primary titles to wrap and
  keep compact-list truncation deliberate. Check navigation, focus, and secondary
  text in every supported theme. Avoid stronger global `!important` rules.

Acceptance: intended spacing survives, mobile controls remain visible, and the
browser suite passes with overflow unmasked.

Layout inventory: `.app-route-content` is flush; `TextDisplay` owns reader/audio
widths through `.text-display-wrapper`, resizable panels, and audio bars. Terms
uses `.terms-page` for a full-width, internally scrolling table. Library uses
`.main-content-padding`; other pages use Bootstrap containers. Home recommendations
use a scoped CSS grid and its stats row explicitly has no horizontal gutters.
Other rows/columns retain Bootstrap spacing. Terms owns its scroller's positioning.

Theme cleanup uses Bootstrap/reader color variables for secondary text and valid
focus shadows; the audio player also uses the classic-dark surface token.
Validation: 76 browser checks, 2,045 client tests, typecheck, lint (34 existing
warnings), and production build passed. Theme screenshots checked; reviewer found
no actionable issues. Physical-phone staging verification remains pending above.

Reader/audio follow-up compared `5147d615` with `546e507b`: 35 screenshot pairs
and 62 browser checks passed; all 13 initial panel geometries matched. Word taps
and status updates preserved word identity/translation; sentence credits, native
play/pause/seek, two-track switching, and bounded listening payloads passed.
The reviewer reran 324 focused tests with no actionable regression found.
Selection/tracking/statistics/API/server logic is unchanged by the CSS commit.

Audio lessons intentionally use classic UI even with the Modern preference;
modern readers with audiobook tracks are a separate covered path. Dialog gutters
changed; the 390px completion dialog's Learning badge now wraps without hiding
counts/actions. Verification used synthetic Chromium sessions, not live-backend
persistence/production totals, physical-phone selection handles, or Safari.
The ad hoc screenshots/report remain local and ignored under
`client/lingua-read-client/test-results/reader-audio-audit/`; they are not CI coverage.

## 3. Preview isolation — next

The uncommitted local preview disables logout and rejects non-GET sample requests;
dedicated storage isolation remains unfinished. Its screenshot-derived fixtures
must stay out of commits.

- [ ] Replace reusable preview data with wholly authored synthetic content.
- [ ] Add a read-only adapter and isolated auth/storage/cache/offline state.
- [ ] Block production APIs and unhandled external requests. Verify actions cannot
  revoke sessions, clear real caches/queues, or pretend an unsaved change succeeded.
- [ ] Keep a visibly labelled sample entry point outside the production build.

Acceptance: production components remain interactive without mutating real state.

## 4. Saved catch-up plan

The current control is a pacing guide; it neither saves a plan nor reschedules cards.

- [ ] Persist user scope, start date, duration, and preferred session size; include
  settings in normal backup/data preservation.
- [ ] Define daily progress for distinct completed cards versus repeated learning
  steps, and separate the planned backlog from newly arriving reviews.
- [ ] Respect SRS day boundaries, time zones, daily limits, and reviewable cards.
- [ ] Support revising/stopping plans without changing study history or FSRS due dates.

Acceptance: settings survive reloads, targets remain understandable, and small queues
or exhausted allowances display honestly while sessions stay bounded.

## 5. Canonical reading progress

Unfinished reading currently shows activity counts; audio uses saved playback
position and an available duration estimate. Keep these fallbacks until comparable
reading totals exist.

- [ ] Document each metric's unit/source/limits in API contracts; define one canonical
  unit for total and covered reading, tied to source revision and segmentation.
- [ ] Preserve historical credit separately from current coverage when text changes.
- [ ] Define partial reads, completion, rereads, missing data, and source edits before
  exposing percentages or ETAs. Estimates require an explicit reading-rate assumption.
- [ ] Cover ignored vocabulary, Japanese/Chinese text, edits, and absent/stale progress.

Acceptance: vocabulary changes cannot advance reading; source edits cannot rewrite
earned history; unsupported coverage shows activity without inventing completion/ETA.

## Validation per slice

Run relevant behavioral/browser checks. Client changes require lint, typecheck,
client tests, and production build; API/data changes require solution build/server
tests. Report skips. Review the diff before pushing; exclude unrelated changes and
personal fixtures. Proceed through CSS cleanup and preview isolation before saved
plans and canonical reading progress.
