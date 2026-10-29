# App plan before the experimental release

Updated 2026-10-29. Detailed evidence is in [the verification record](RELEASE_VERIFICATION.md);
publication gates are in [the release checklist](RELEASING.md).

## Completed

- First-run/session reliability: operator-protected setup, session revocation,
  password change/recovery guidance, provider-key feedback, and report-destination
  guards. The existing 90-day session lifetime is unchanged.
- Database-only backup/restore messaging and an isolated synthetic full restore,
  including separately preserved media and encryption keys.
- Context CSV and one-way Anki export with ownership/language/status filters,
  multiple contexts, context-free terms, Unicode/quoting, and safe serialization.
  Existing simple CSV import/export remains available. See [export instructions](VOCABULARY_EXPORT.md).
- Isolated Docker workflow through import, lookup/status, phrase saving, sentence
  mining, real FSRS review, reload, and restore; independent review corrected
  missing source-title fallback. Browser portrait/landscape checks passed.
- Release preparation merged in [PR #130](https://github.com/semblable/Lingua_read2/pull/130)
  and deployed to staging at `fa3578fb`. The maintainer reports reading/listening
  work and has inspected the raw Anki export; an actual Anki UI import is unverified.

## Cloze paused

Cloze and mixed review currently use translation cards. Arbitrary sentence blanks
can have several valid answers, while the prototype compares only the saved term.
Saved preferences, mined sentences, and FSRS history are preserved.

Before re-enabling: provide a clear meaning cue or learner-selected deletion,
represent alternative answers without claiming they are linguistically wrong,
and verify prompt usefulness with learners. Passing masking/matching tests alone
is insufficient. This pause does not affect vocabulary export.

## Next

1. Verify the cloze pause on staging, then complete a physical-phone session and
   real browser disconnect/reconnect with queued activity. Prior viewport checks,
   queue tests, and server replay do not establish those results.
2. Finish the [remaining release gates](RELEASING.md), including asset provenance
   and private security reporting.
3. Observe a learner session using [the feedback protocol](LEARNER_FEEDBACK.md).
   Keep related-word links, broader parsing, and automatic transcription deferred
   until concrete feedback justifies them. Japanese/Chinese segmentation remains
   unfinished; two-way Anki synchronization is outside scope.
