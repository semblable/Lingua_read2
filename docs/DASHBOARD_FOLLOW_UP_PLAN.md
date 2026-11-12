# Dashboard follow-up plan

Updated 2026-11-12. Items 1–2 are implemented; item 3 is next.
Home/Dashboard copy is simplified; catch-up controls and the review-time guess are removed.
Validation: 76 browser checks, 2,049 client tests, 6 demo tests, lint (34 existing warnings),
typecheck, production/demo builds, and boundary checks passed; independent review approved.
20 synthetic before/after captures cover Home/Dashboard at 390/1280px and Home themes.

## Constraints

- Keep due totals visible and sessions bounded by `min(due cards, session size)`;
  preserve the SRS algorithm, scheduling, and daily limits. No catch-up planner.
- Keep saved word forms, vocabulary occurrences, reading credits, and playback
  seconds distinct. Reading credits / vocabulary totals cannot establish completion.
- Fix component sizing; retain Bootstrap, shrinkable tracks, wrapping primary
  titles, and deliberate compact truncation instead of masking page overflow.
  Keep layouts scoped; avoid stronger global `!important` overrides.
- Preview isolation must cover auth, storage, caches, and offline state; network
  interception alone is insufficient. Preserve unrelated edits and private fixtures.

## 1. Mobile browser regressions — automated coverage complete

- [x] Synthetic Home/Navigation and layout coverage at 320/390/430/1280px:
  long/missing metadata, unmasked overflow, menus, bounded sessions,
  goal labels/focus/Escape, themes, and CI failure screenshots/traces.
- [x] Fix reduced-motion goal dismissal and untouched zero-position audio saves;
  retain intentional rewinds/playback saves and block fixture mutations on exit.
- [ ] Physical-phone staging check: touch scrolling/selection, menus, focus, and
  on-screen keyboard. Record revision, date, device/OS/browser, and results.

[Run and scope](../client/lingua-read-client/browser-tests/README.md).
Implementation: `5147d615`; CI fixes: `9525a5a4`
([staging pipeline and external smoke checks passed](https://github.com/semblable/Lingua_read2/actions/runs/43236764583)).

## 2. CSS ownership and layout cleanup — complete

- [x] Restore Bootstrap container/grid ownership; align navbar/Home/Dashboard
  through `.app-content-width` and existing tokens; verify theme/focus readability.

Layout ownership: flush `.app-route-content`; reader/audio `.text-display-wrapper`
with local panels; full-width Terms with its own scroller; padded Library through
`.main-content-padding`; scoped Home recommendation grid and flush stats row.
Other pages retain Bootstrap containers/gutters. Implementation: `546e507b`.

Synthetic screenshots and selection/playback/tracking checks found no unintended
regression; reviewers passed 324 focused tests. Audio lessons use classic UI even
with Modern selected; modern audiobook readers are separate. Minor difference:
the 390px completion dialog's Learning badge wraps; counts/actions remain visible.
Local ad hoc evidence: `client/lingua-read-client/test-results/reader-audio-audit/`
(ignored, not CI coverage). Live-backend persistence/production totals, physical
phones, and Safari remain unverified; staging smoke checks do not establish them.

## 3. Preview isolation — next

The local preview is not fully isolated. Do not commit its private screenshot-derived
fixtures; use wholly authored synthetic data.

- [ ] Replace reusable preview data and provide a read-only adapter.
- [ ] Isolate auth, storage, caches, IndexedDB, service workers, and offline queues.
- [ ] Block production APIs and unhandled external requests. Actions must not revoke
  real sessions, clear real caches/queues, or fake successful saves.
- [ ] Keep a visibly labelled sample entry point outside the production build.

Acceptance: production components remain interactive without mutating real state.

## 4. Reading progress measurement — optional

Keep reading activity counts and saved audio position/duration fallbacks until
comparable totals for the same text revision exist. This is future measurement
work; vocabulary knowledge and SRS scheduling remain separate.

- [ ] Document metric units/sources/limits in API contracts; define one consistent
  unit for total and covered reading tied to source revision and segmentation.
- [ ] Preserve historical credits separately from coverage when sources change.
- [ ] Define partial reads, completion, rereads, missing/stale data, and source edits
  before percentages or ETAs; estimates require an explicit reading-rate assumption.
- [ ] Cover ignored vocabulary, Japanese/Chinese segmentation, and edited sources.

Acceptance: vocabulary changes cannot advance reading; source edits cannot rewrite
earned credits; unsupported coverage shows activity without inventing completion/ETA.

## Validation per slice

Make small verified changes. Run browser checks, lint, typecheck, client tests, and
production build for client changes; solution build/server tests for API/data changes.
Report skips. Update this plan concisely; launch a reviewer before committing/pushing
the completed slice to `dev`, then monitor Staging through deployment/smoke checks.
Exclude unrelated edits and private fixtures. Finish preview isolation before item 4.
