# Audio lesson credit verification

Verified on 12 November 2026.

Playback now credits lesson listens in 0.1× increments from played audio divided
by its duration. Elapsed listening time remains separate, so playback speed
changes the source exposure without inflating time statistics. Smaller fractions
persist between requests. Seeking and buffering earn no source exposure; replays
add exposure. Offline requests retain their event identity and lesson metadata.

Library text cards display a book icon and read total. Audio lessons also display
a headphones icon and listen total, including fractional counts.

Validation:

- 150 targeted client tests passed across 9 files.
- 119 targeted server tests passed, including SQLite listening/reset/retry tests.
- Before pushing: the full client suite passed 2,057 tests; the full Release
  server build/test passed 1,910 tests with nine PostgreSQL-only tests skipped locally.
- 4 real-media browser checks passed at 320, 390, 430, and 1280 pixels.
- 12 existing library/audio layout checks passed across those widths and all themes.
- Type checking, lint, production build, and build asset/license checks passed.
  Lint reports 34 existing warnings and no errors.
- EF reports no model changes missing from migrations.
- Reviewer agent found a checkpoint issue when the transcript revision changed
  during playback. The fix and regression test passed; no findings remain.

Screenshots use authored sample data and silent audio in the production React
components. No account data or real lesson records were modified:

- [Desktop audio](audio-desktop.png)
- [Desktop library](library-desktop.png)
- [Mobile audio](audio-mobile.png)
- [Mobile library](library-mobile.png)

The backend includes migration `20261112155846_AutomaticLessonListeningCredit`
for persisted playback fractions. Apply it with the normal backend deployment.
Earlier time-only playback records cannot be backfilled into lesson counts,
because they did not identify the lesson or audio duration. Existing manual read
and listen totals remain valid.
