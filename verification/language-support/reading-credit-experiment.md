# Reading credit compatibility experiment — 2026-10-29

Synthetic data only. Bounds: nine short counting inputs, two completion routes,
one language/book/text per SQLite in-memory database (one extra learner/text in the
reset-isolation case), no provider/network
calls, no new packages or segmentation engines. Run the regression class
`ReadingCreditCompatibilityTests`; it uses real controllers, activity/goal services
and relational transactions. This is not a production migration rehearsal.

## Units and invariants (written before implementation)

- **Vocabulary size:** saved term records in a learner's language, optionally
  filtered by status. A term may be a surface form or phrase. This is neither a
  running occurrence count nor a validated lemma/CEFR estimate. Preserve IDs,
  meanings, statuses, mined sentences and SRS state even if identities conflict.
- **Coverage:** linked token occurrences, excluding ignored terms; known coverage
  uses statuses 4–5. The denominator and numerator must use the same layout.
  Text/book aggregates are recomputable caches, subject to tokenizer limitations.
- **Reading activity:** earned volume per reading event, independent of known or
  ignored vocabulary. Existing activity uses nonempty chunks separated by ASCII
  space, tab, CR or LF (with an all-whitespace guard). Call this the **legacy
  activity unit**, not a linguistic word. Activities, cumulative earned totals,
  sentence credit and goal baselines are historical state, not coverage caches.
  Future units require an explicit versioned transition; no retrospective recredit.

One initial reading can earn sentence credit plus the remaining completion credit.
Repeating a credited segment earns nothing. A later intentional whole-text reread
earns its full volume without incrementing unique texts completed. A late replay
of a previously unseen initial sentence after credited completion must not add
volume again. An interrupted transaction must commit all associated state or none.
Existing goal baselines, completed goals and activity rows must remain unchanged;
new events contribute their actual earned volume. Metrics need not have equal totals.

## Candidates to compare

1. Keep legacy counting; repair only demonstrated credit lifecycle defects.
2. Split on Unicode whitespace: handles NBSP/narrow NBSP/ideographic spaces, but
   still counts punctuation-only chunks and unspaced passages as words; historical
   sentence/completion credit and pending operations have no counting version.
3. Count current tokenizer words: handles punctuation/Unicode spaces, but CJK/Thai
   runs are still unsplit, supplementary Han can disappear and custom substitutions
   can alter counts. Counting linked terms also depends on asynchronous linking and
   status exclusion. It is not an accepted reading-volume contract.

Do not ship a replacement counter on those candidates alone. Useful unspaced-script
lexical volume depends on accepted segmentation and stable layouts first. Unicode
identity migration is needed for vocabulary correctness, but not for a lifecycle
fix that neither changes keys nor derives activity from vocabulary records.

## Compatibility boundaries

The existing offline queue stores sentence text/index pairs and replays them
unchanged. Test that payload before/after completion and repeat it after a lost
response. No queue format/count interpretation may change in this batch. Completion
requests are not queued by the current client; their existing ten-second retry
window is not durable operation identity. A delayed duplicate completion remains
indistinguishable from a deliberate reread; do not claim general offline exactly-once
completion. Concurrent sentence/completion requests also require separate scrutiny.

## Observed results and selected implementation

The initial run had **10 passes and 5 failures**. Three failures exercised the
selected credit defects (book initial completion, book retry after interruption,
standalone reread); two exposed the deferred unseen-sentence replay defect. With
100 units of historical activity and a three-unit text, two sentence units plus
book completion produced 105 instead of 103. Standalone initial completion gave
103, but a later reread gave 104 instead of 106. After the focused repair both
routes give 103 then 106, with one unique completion and two total completions.

| Original synthetic input | Legacy activity | Unicode whitespace candidate | Current word-token candidate |
| --- | ---: | ---: | ---: |
| `one two. one!` | 3 | 3 | 3 |
| `我爱读书。你呢？` | 1 | 1 | 2 |
| `私は本を読む。猫も読む。` | 1 | 1 | 2 |
| Thai run + CJK stops (see test source) | 1 | 1 | 2 |
| `one,two—three` | 1 | 1 | 3 |
| `... !!!` | 2 | 2 | 0 |
| `one\u00a0two\u202fthree\u3000four` | 1 | 4 | 4 |
| Unicode spaces only | 0 | 0 | 0 |
| `我爱读书你呢` | 1 | 1 | 1 |

The token candidate's two units for the CJK/Thai examples are unsplit runs, not
accepted lexical boundaries. The counting diagnostic freezes observations for
this audit only; change it deliberately when an accepted engine changes them.
The synthetic learner has **four saved records**, including an ignored phrase
and a conflicting `ONE`/`one` pair, **three coverage occurrences**, and **100 old
activity units**. Completion/recomputation never edits those vocabulary identities.

Selected batch: reconcile first book completion with already earned sentence
credit; award a full later standalone reread instead of repeatedly deducting that
old credit. Keep the existing retry windows, all counters' units and all persisted
layouts/keys unchanged. `Language.WordsRead` remains its separate legacy global,
book-completion-only accumulator; the learner dashboard/goals use activity and
`UserLanguageStatistics`. Its inconsistency is not silently backfilled or repurposed.

Independent review caught a compatibility dependency: explicit **Reset statistics**
deleted activity and zeroed totals while retaining deductible sentence credit.
Two regressions failed before repair. That explicit operation now zeroes only
`CreditedWordCount` in the same save as the reset. Preserve credited indices to
deduplicate queued pre-reset segments, preserve last reading position, and leave
vocabulary, SRS and existing goal baselines unchanged. This is user-requested reset
behavior, not a startup migration or a retroactive adjustment to any installation.

Final evidence: **26 experiment cases pass** within **1,200 full backend tests**;
**31 focused frontend offline checks** pass, including a new handler check proving
Unicode sentence payloads/indices replay verbatim. SQLite interruption tests fail
book's save and standalone's second save after its activity write, then verify
rollback, retry and scalar learner-history preservation. Full/excess sentence
credit is not clawed back; coverage recomputation changes only caches. Marking a
text finished via `skipStats`/`FinishBook` earns no completion volume; a later
intentional reread earns its full volume and does not increment unique completions.
Active and already completed goal fixtures retain their saved baselines/state.
A database-trigger failure during reset verifies relational rollback, and a second
learner's activity/totals/credit remain unchanged by failed and successful resets.

## Remaining gaps and next dependency

This section records the `81bd4bb0` batch. The subsequent
[repeat-tracking experiment](repeat-tracking.md) supplies checkpoints for newly
processed completions and real PostgreSQL evidence; historical unversioned rows,
new reading units and general offline-cycle identity remain separate issues.

- A previously unseen sentence arriving after completion still raises 103 to
  104; duplicate delivery of that same index adds nothing further. It needs an
  authoritative, versioned per-text credit checkpoint and reading-cycle contract.
  `IsFinished` is insufficient evidence of credited completion.
- Whole-text `one.two` (or two unspaced Chinese sentences) counts as one legacy
  unit, while separately credited sentences total two. Completion preserves
  already earned excess instead of clawing it back. Future counting/layout
  contracts must address additivity before a versioned transition is enabled.
- Concurrent sentence/completion operations and completion duplicates beyond ten
  seconds are not solved. No real browser reconnect, PostgreSQL concurrency or
  production upgrade/rollback is established by sequential SQLite tests.
- Explicit reset retains old goal baselines and dedup indices by design; it does
  not start a new goal period or rereading cycle. Previously unseen offline
  operations still lack reset/cycle identity. Do not claim all reset/offline
  orderings are resolved.
- Accept segmentation/layouts and replay/checkpoint versioning before changing
  reading units. Pursue indexed Unicode identities separately with preservation
  experiments. No universal counter replacement, ICU integration, schema change,
  tokenizer-version bump, automatic recredit or readiness promotion ships here.
