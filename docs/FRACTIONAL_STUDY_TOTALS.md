# Fractional lesson practice totals

Open **Read** or **Listened** in the lesson header, enter a total or use the
**−0.1× / +0.1×** buttons, then press Enter or **Save total**. Decimal commas
are accepted. Totals range from 0 to 10,000 and use integer tenths internally.
Cancel or Escape discards the draft. An explicit save avoids submitting every
keystroke or accidentally recording a partly typed value.

## Reading credit and the rest of the app

- Increasing or reducing Read adjusts words-read activity and language totals.
  Goals and statistics already consume these activity types. Corrections appear
  on the date they are saved; a correction day can have negative net word volume.
- Fractional word credit rounds the cumulative total to the nearest whole word,
  with midpoint values rounded up. Repeated 0.1 steps do not accumulate rounding
  errors. The existing activity word-count unit is retained; vocabulary coverage
  and tokenization are not recalculated.
- Initial sentence reading and fractional passes share credit. Continuing in
  sentence mode can consume previously credited fractional words without earning
  them twice. Reductions preserve independently earned sentence words. Finishing
  without credit retains its existing behavior: later rereads earn new credit.
- Whole completed-pass statistics change by the difference between the old and
  new whole portions. Unique lessons finished, book progress, tags, and automatic
  navigation remain governed by the completion actions. Setting a total does not
  finish or reopen a lesson. **Record a read** continues to add one whole pass.
- Content changes do not revalue all old passes. Added volume uses the current
  lesson; reductions proportionally correct the retained historical credit when
  multiple content revisions are represented.
  If the lesson has changed language, editing its Read total is rejected so
  historical credit cannot be deducted from the new language.
- Listened edits change passes independently of listening time. Playback still
  tracks actual time, and **Record a listen** can explicitly add outside-app time.
- A downward correction alone does not create a reading streak day. Vocabulary,
  SRS scheduling, bookmarks, and playback/resume positions are unaffected.

## Saving and upgrades

Editing requires an online lesson revision and loaded totals. Saves use an
expected previous total, a transaction, and a retry identity. A stale edit returns
a conflict and refreshes the current value; lost-response retries cannot apply a
correction twice. Statistics resets retain retry receipts and disable the old
counter/credit entries, preventing old retries from restoring reset credit.

Apply `20261105122010_FractionalLessonStudyPasses` with the server upgrade. It
backfills existing pass events as 10 tenths and adds nullable credit metadata;
it does not invent counts for older activity lacking pass events. The downgrade
refuses to discard fractional corrections. Older server binaries do not understand
these corrections, so keep the upgraded server with data that uses this feature.

Regression coverage lives in `LessonStudyPanel.test.tsx`, `studyIntent.test.ts`,
`ReadingCreditCompatibilityTests.cs`, and `PostgresStudyActivityTests.cs`. The
static demo implements fractional counters locally without simulating real goals
or earned statistics. PostgreSQL concurrency and migration tests require the
isolated `LINGUA_STUDY_TEST_POSTGRES` database. Browser/physical phone verification
is separate from the automated component tests.
