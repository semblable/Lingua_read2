# Language support evidence — 2026-10-29

This is a baseline audit, not a claim that all 44 presets are ready. The product
readiness definition remains in [the roadmap](LANGUAGE_SUPPORT_PLAN.md). Original
synthetic inputs and reproducible commands live in
[the experiment directory](../verification/language-support/README.md).

## Matrix

`T` = a narrow automated check, not full readiness; `F` = a reproduced unresolved
failure; `U` = not established per language. `—` means RTL is not required for the
default script, not that custom scripts are forbidden. `H` = romanization is
unavailable and its ineffective switch is hidden. `tag` proves a valid speech tag
only; actual installed voices, provider support and pronunciation remain unverified.
Every core-readiness cell remains `U` until import, lookup/status after reload,
selection, mining, review, resume and offline use pass together for that language.

| Language | Core reading | Surface words | Unicode keys | Sentences | RTL | Imports | Dictionary live | Speech | Romanization | Offline |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Afrikaans `af` | U | F¹ | U | U | — | U | U | tag | H | U |
| Arabic `ar` | U | T | U | U | T² | U | U | tag | H | U |
| Bengali `bn` | U | T | F³ | U | — | U | U | tag | H | U |
| Bulgarian `bg` | U | U | U | U | — | U | U | tag | H | U |
| Catalan `ca` | U | T | U | U | — | U | U | tag | H | U |
| Chinese `zh` | U | F⁴ | U | U | — | U | U | tag | H | U |
| Croatian `hr` | U | U | U | U | — | U | U | tag | H | U |
| Czech `cs` | U | T | U | U | — | U | U | tag | H | U |
| Danish `da` | U | U | U | U | — | U | U | tag | H | U |
| Dutch `nl` | U | T⁵ | U | U | — | U | U | tag | H | U |
| English `en` | U | T | U | U | — | U | U | tag | H | U |
| Estonian `et` | U | U | U | U | — | U | U | tag | H | U |
| Finnish `fi` | U | U | U | U | — | U | U | tag | H | U |
| French `fr` | U | T | U | U | — | U | U | tag | H | U |
| German `de` | U | T | U | U | — | U | U | tag | H | U |
| Greek `el` | U | T/F⁶ | F⁶ | U | — | U | U | tag | H | U |
| Hebrew `he` | U | T/F⁷ | U | U | T² | U | U | tag | H | U |
| Hindi `hi` | U | T | F³ | U | — | U | U | tag | H | U |
| Hungarian `hu` | U | T | U | U | — | U | U | tag | H | U |
| Indonesian `id` | U | U | U | U | — | U | U | tag | H | U |
| Italian `it` | U | T/F¹ | U | U | — | U | U | tag | H | U |
| Japanese `ja` | U | F⁴ | U | U | — | U | U | tag | H | U |
| Korean `ko` | U | T⁸ | F³ | U | — | U | U | tag | H | U |
| Latvian `lv` | U | U | U | U | — | U | U | tag | H | U |
| Lithuanian `lt` | U | T | U | U | — | U | U | tag | H | U |
| Malay `ms` | U | U | U | U | —² | U | U | tag | H | U |
| Norwegian `no` | U | U | U | U | — | U | U | tag | H | U |
| Persian `fa` | U | T | U | U | T² | U | U | tag | H | U |
| Polish `pl` | U | T | U | U | — | U | U | tag | H | U |
| Portuguese `pt` | U | T | U | U | — | U | U | tag⁹ | H | U |
| Romanian `ro` | U | T | U | U | — | U | U | tag | H | U |
| Russian `ru` | U | T | U | U | — | U | U | tag | H | U |
| Serbian `sr` | U | T | U | U | — | U | U | tag | H | U |
| Slovak `sk` | U | U | U | U | — | U | U | tag | H | U |
| Slovenian `sl` | U | U | U | U | — | U | U | tag | H | U |
| Spanish `es` | U | T | U | U | — | U | U | tag | H | U |
| Swahili `sw` | U | U | U | U | — | U | U | tag | H | U |
| Swedish `sv` | U | U | U | U | — | U | U | tag | H | U |
| Tamil `ta` | U | T | U | U | — | U | U | tag | H | U |
| Thai `th` | U | F⁴ | U | U | — | U | U | tag | H | U |
| Turkish `tr` | U | T | T¹⁰ | U | — | U | U | tag | H | U |
| Ukrainian `uk` | U | T | U | U | — | U | U | tag | H | U |
| Urdu `ur` | U | T | U | U | T² | U | U | tag | H | U |
| Vietnamese `vi` | U | T⁸ | U | U | — | U | U | tag | H | U |

1. Audit reproduces missing Afrikaans leading apostrophe and Italian trailing
   apostrophe. Existing elision/clitic golden vectors still pass.
2. Tests verify that saved direction reaches reader content and is independent
   from controls/translation. A custom `ms-Arab` record with RTL enabled is covered.
   Font shaping, mixed-direction selection and physical/mobile behavior are not.
3. Audit reproduces unequal keys for Bengali RRA, Hindi nukta and composed versus
   decomposed Hangul. Do not interpret correct display words as canonical identity.
4. Current parser names do not invoke engines. Chinese/Japanese runs become one
   word and an unpunctuated 100k-unit Thai sample becomes one vocabulary term,
   exceeding the model's 100-character limit. Rare Han `𠮷` is dropped from the word
   stream. Native ICU is experimental only; no production boundary change ships.
5. Ordinary Dutch apostrophes are covered; leading forms are still an audit gap.
6. Greek oxia and U+0387 punctuation have existing passing cases. U+00B7 still
   glues words; JS contextual sigma casing and .NET simple casing disagree.
7. Hebrew points stay within words, but gershayim in `צה״ל` splits a word.
8. Korean space-delimited forms and Vietnamese syllables pass surface fixtures.
   Useful particle/lexical grouping is not established.
9. `pt` is region-neutral. Explicit `pt-BR`/`pt-PT` tags and device preferences
   remain available inside the same catalog language. No database records merge.
10. A previously failing Turkish reader test now restores `IŞIK`/`İZMİR` status
    from saved `ışık`/`izmir` rows after remount and updates the original WordId.
    This is not a general key migration or verification of every Turkish path.

Dictionary source filtering is verified with synthetic response buckets for flat,
rich and batch APIs. No live-provider coverage for 44 languages is inferred from
those adapter tests. Browser voice presence and paid translation capabilities are
similarly not implied by a syntactically valid tag.

## Segmentation experiment and decision

The spike uses six original Chinese/Japanese/Thai strings, plus 10k/100k UTF-16-unit
repetitions per language. Its advance limits are documented in the experiment
README. No packages, dictionaries or model downloads were added. Native ICU came
from the already cached deployment image/system, and the Linux container had no
network and only the experiment folder mounted read-only.

Observed word output agrees across tested runtimes on these six examples, but
matches only **2/6 provisional engineering expectations**. Japanese `食べ` becomes
`食` + `べ`, rare-Han names split differently than hypothesized, Chinese `我在` is
grouped, and Thai `กับOpenAI` stays together. All experimental segment spans
reconstruct the original UTF-16 text, including supplementary Han. The existing
production tokenizer still omits the supplementary character from word tokens.

Decision: do not ship a universal ICU replacement. Compare language-specific
engines next; budget for native review and pinned engine/data packaging. The
probe's ad hoc dynamic loader is deliberately not application infrastructure.
Current reports include runtime/ICU versions, initialization time, warm timings
and process memory. These synthetic measurements are not full import/database
benchmarks or estimates of a separate engine's dictionary/download size.

| Runtime | ICU | First engine initialization + sample | Warm 100k zh / ja / th | End-of-run process memory |
| --- | --- | --- | --- | --- |
| Node 24.22.1, Windows | 78.3 | 11.2 ms | 31.6 / 33.3 / 10.1 ms | RSS 115.2 MiB |
| .NET 10.0.14, Windows | 72.1.0.4 | 14.7 ms | 26.0 / 35.9 / 7.0 ms | Working set 61.3 MiB |
| .NET 10.0.14, Ubuntu 24.04.5 | 74.2.0.0 | 28.2 ms | 43.9 / 60.8 / 11.5 ms | Working set 76.1 MiB |

Single local runs, not statistically stable benchmarks. Initialization excludes
process launch; memory is sampled, not peak memory. Warm timings and final samples
fit the exploratory rejection thresholds, but peak-memory and full-application
startup/import budgets are not established. No native-language quality gate passes.

## Validation record

- Initial focused frontend baseline: 135 passing tests. New speech regressions
  then produced nine failures; the fixes pass them. The separate Turkish reader
  regression failed with an untracked status before the matching fix and passed
  after it, including remount and editing the existing row.
- Full backend: 1,159 passed before the additional surface-vector expansion.
  This includes existing SQLite upgrade/rekey/collision, cleanup, SRS and word
  linking regressions; no new database migration is introduced here.
- Full frontend: 1,194 passed before the additional surface vectors, speech-tag
  matrix check and Turkish reader regression. Production typecheck/build and
  asset/license verification passed before the final Turkish matching change.
  Final scoped reruns are recorded below after the last edits.
- Final changed-path checks: **279 frontend tests across nine files** passed,
  including the Turkish reload/update regression, all shared surface vectors,
  speech tags/preferences, reader direction and preservation of hidden settings.
  **49 backend tokenizer/upgrade/Wiktionary checks plus 96 shared golden-vector
  checks** passed after fixture expansion. Final TypeScript checking passed.
- Final production build passed, including asset/license verification (400 static
  assets, 11 notices). ESLint passed the repository's configured limit with
  0 errors and 46 warnings; it is not a warning-free run.
- Test-host connections time out inside the sandbox; the actual backend suite
  passes when allowed its local test connection. The standalone probe's initial
  restore could not fetch NuGet vulnerability metadata; compilation succeeded
  using cached application dependencies. This is not a clean online audit result.
- No live service calls, user library/database, native-speaker review, physical
  devices, full RTL browser QA, offline reconnect or production upgrade/rollback
  were exercised by this batch. Those remain release gates.

Additional source-inspection constraints: `Language.Code` and its edit field still
limit stored codes to ten characters, so longer valid BCP-47 tags cannot yet be
saved even though the speech helper preserves them. Desktop transcripts still use
a fixed row-height estimate. These need bounded fixes and validation; neither is
covered by passing direction/tag-helper tests.

## Independent review before the dev push

A separate review covered the complete language update and confirmed five defect
groups: duplicate DELETE calls, unsupported `Object.hasOwn`, regional/script voice
ranking and stale cross-language voice preferences, Turkish batch/poll merging,
and deprecated Wiktionary source-code aliases. The fixes are recorded in the
roadmap; eight new frontend checks failed before repair and now pass. Three new
backend alias fixtures pass. The guide now describes the available controls and
regional voice workflow. The reviewer found no further verified blocking defects
in this bounded update; the broader readiness limitations above remain open.

Final validation after the review fixes:

- **1,216 frontend tests** passed across 92 files.
- **1,174 backend tests** passed; none skipped.
- **4 static-demo tests** passed.
- Production and demo TypeScript checks/builds passed. Production asset checks
  verified 404 static assets and 11 retained license notices; demo notices passed.
- ESLint passed the configured threshold: 0 errors, 46 warnings. Frontend tests
  emitted Node `TimeoutNaNWarning` messages; no tests failed. Real Safari/device
  checks remain unperformed; missing `Object.hasOwn` was simulated in a regression.
- No schema, tokenizer version, sentence-index or learner-data migration is part
  of this commit. The experimental ICU loader remains outside the application.

## Statistics follow-up after the push

[CI, image builds, staging deployment and smoke checks for `c00ce187` succeeded](https://github.com/semblable/Lingua_read2/actions/runs/40933654143).
An additional **85 targeted tests passed**: 33 for statistics recomputation,
sentence-mode activity, activity APIs and word linking; 52 for text/book completion,
user statistics and goal progress. These verify existing counting/credit contracts,
including repeated occurrences, chapter/book aggregation, ignored words, duplicate
credit prevention, remaining credit after sentence mode and repeat completions.
No new breaking statistics regression was found in those tested paths.

Source comparison confirms this update did not change the server tokenizer,
linking version (still 3), word-count utility, stats recomputation or activity/text/
book completion implementations. Existing vocabulary IDs, schema and historical
activity are not migrated by this update. This is preservation evidence, not a
claim that the existing counting definitions are correct for every language.

| Metric | Current counting unit | Remaining limitation |
| --- | --- | --- |
| Vocabulary size | Stored vocabulary terms | Surface forms/phrases and unresolved legacy identity collisions are not validated lexical or lemma counts. |
| Text/book known-word coverage | Sum of linked `OccurrenceCount`; ignored words excluded | Accuracy depends on current word segmentation, which remains inadequate for unspaced scripts. |
| Reading-volume credit | Chunks split on ASCII space, tab, CR and LF by `WordCountUtility.CountTotalWords` | Unspaced passages are undercounted; punctuation and Unicode spaces can disagree with tokenizer units. |

These limitations predate `c00ce187` and remain unresolved. Future fixes must define
and version the counting contract, test compatibility with completion/sentence
credit and offline replay, and preserve historical activity instead of silently
recalculating previously earned reading credit. All-44-language statistics readiness
remains unverified.

## Second batch: reading-credit compatibility — 2026-10-29

The [bounded experiment](../verification/language-support/reading-credit-experiment.md)
and [before/review/after reports](../verification/language-support/README.md#reading-credit-compatibility-experiment)
separate **saved term records**, **linked nonignored occurrences for coverage**,
and **earned event volume for activity**. Four synthetic saved records (including
an ignored phrase and a legacy case collision) coexist with three coverage
occurrences and 100 historical activity units. No metric requires matching totals.

Nine short counting fixtures reproduce unspaced Chinese/Japanese/Thai, punctuation
and Unicode-space discrepancies. For example, `one\u00a0two\u202fthree\u3000four`
earns one legacy activity unit versus four current tokens, and `... !!!` earns two
versus zero. Current CJK/Thai tokens are still unsplit runs; changing to them would
not establish usable linguistic counting. Even unchanged activity counts are not
additive across all sentence splits: `one.two` counts once as a whole and twice as
two sentence events. Preserve earned excess; do not silently recalculate history.

The initial 15-case experiment produced **10 passes and 5 failures**. Implemented:

- Initial book completion reconciles already earned sentence credit. Two sentence
  units plus a three-unit completion previously gave five; now their sum is three.
- A later standalone reread earns the full three units. It previously earned only
  one when the original two sentence units were subtracted again. Both routes keep
  unique-completion counts separate from repeat completions and dedup immediate retries.
- Independent review found explicit statistics reset retaining stale deductible
  sentence credit. Two added checks failed before repair. The reset now clears only
  that amount in the same atomic save as activity deletion/counter reset, retaining
  segment-index dedup and reading position. It leaves goal baselines, vocabulary,
  meanings, mined sentences and SRS state unchanged. This runs only on the explicit
  user reset operation, never automatically during upgrade/startup.

Verification after review:

- **1,200 backend tests passed**, none skipped, including **26 experiment cases**
  using relational SQLite and real controllers/services. Scalar snapshots preserve
  historical activity and vocabulary IDs/terms/statuses, edited meanings, mined
  source sentences, SRS scheduling/review logs, and active/completed goals.
- Interruption after standalone's activity write and before its second save rolls
  the whole completion back. Book-save interruption also rolls back and retries.
  A SQL trigger interrupts explicit reset inside its save; activity/totals/credit
  remain intact. Another learner's rows survive failed and successful resets.
- Full/excess prior sentence credit is preserved; coverage cache recomputation
  leaves earned activity unchanged. `skipStats`/`FinishBook` earn no completion
  activity, while later intentional rereads earn full volume. The legacy global
  `Language.WordsRead` completion accumulator remains separate and unchanged.
- **31 focused frontend offline tests passed** across three files, including a new
  production-handler regression proving stored Unicode sentence text/indices replay
  verbatim. TypeScript checking and ESLint on the changed test passed.

Remaining material limitations: unseen sentence replay after completion still adds
one extra unit in the diagnostic; same-index retries remain deduplicated. No durable
completion identity exists beyond the ten-second window. Concurrent reading/reset/
completion, PostgreSQL serialization/retry behavior, real browser reconnect and
production migration/rollback were not established by this sequential experiment.
Explicit reset retains old goal baselines and segment dedup; unseen queued actions
have no reset/cycle identity. These are documented gaps, not passing readiness gates.

Decision: ship the bounded reconciliation/reset fixes with the legacy unit intact.
Accept segmentation/layouts and a versioned credit checkpoint before new reading
units; pursue indexed Unicode identities with separate conflict-preservation
experiments. No schema, tokenizer version, sentence layout, vocabulary migration,
offline payload reinterpretation, historical recredit or new catalog split ships.
All-44-language practical readiness, native review and physical-device gates remain open.

## Third batch: explicit repeats and stronger verification — 2026-10-30

The [repeat-tracking record](../verification/language-support/repeat-tracking.md)
defines the new complete-pass counts and preserves existing volume units. Reader
controls show **Read × / Listened ×** from newly recorded events, record deliberate
reads without navigation, and log a completed listen with optional external time.
Listening defaults to zero extra time because playback already credits seconds,
including repeated playback. Past per-lesson repeats cannot be reliably recovered
from old aggregate history; no inferred backfill or historical recredit is performed.

The additive `LessonStudyEvents` migration retains operation identity, source/credit
snapshots and counting version 1. Matching retries remain deduplicated after ten
seconds and after explicit statistics reset. New actual read events provide the
missing checkpoint against late initial sentence credit. Suppressed retry records
are explicitly not proof of earned completion. Old historical rows with only an
`IsFinished` flag receive no guessed checkpoint.

All activity writers now share a user-level PostgreSQL transaction lock. Manual
activity's event and totals writes roll back together. Explicit statistics reset
retains replay-protection records but excludes them from visible totals/counts;
the reset UI discloses that. Explicit language-content reset deletes that scoped
history. Ordinary lesson deletion preserves study history and earned activity.

Independent review confirmed and repaired five integration defects before release:
suppressed retries becoming credit checkpoints, normal/explicit-repeat intent
collision, missing listen revision validation, stale ETags preventing revision
refresh, and `URLSearchParams.size` dropping standalone query parameters on older
Safari. Regressions also cover stale counter responses and late acknowledgements.

Final local validation: **1,209 backend tests passed, 3 PostgreSQL facts skipped**
after the local Docker engine became unavailable on resumption. The preceding
PostgreSQL-enabled run passed **1,211/1,211**, including the three integration facts;
the final scoped language-content-reset regression also passes locally. **1,229
frontend tests** and **4 static-demo tests** passed. Production/demo builds and
TypeScript checks passed; production asset verification retained 402 assets and
11 license notices. ESLint passed the configured limit with **0 errors, 46 warnings**.
CI supplies PostgreSQL to rerun all **1,212** backend checks on the pushed batch.

[The CI and staging run for `18e8d73`](https://github.com/semblable/Lingua_read2/actions/runs/41017440350)
subsequently passed, including **1,212 backend tests with no skips**, client tests,
image builds, deployment and smoke checks. This includes the fresh PostgreSQL run.

PostgreSQL verification uses only a named disposable
18.6 database and generated schemas, with no learner library or provider calls.
Its three checks exercise concurrent different-lesson completions and old/new
listening paths, sentence/completion/reset races, the actual prior-to-current
migration, empty downgrade/re-upgrade, preservation of synthetic vocabulary/SRS
history and refusal to drop a nonempty ledger. CI now runs those checks with its
own PostgreSQL service. Sanitized results and screenshots are linked in the record.

Desktop/390px Chromium inspection covers light/dark themes, wrapping, 44px mobile
pass buttons and the count-only listening dialog. It renders the real component
with synthetic HTTP data, not a production learner session. Automated UI checks
cover repeated clicks, retry identity, stale loads and invalid external durations.
Real Safari, physical devices, full reader visual QA and production rollback remain
unperformed. Existing React `act`/Node timer warnings are not evidence of those gates.

New completed-pass actions are **online-only**: older offline queue code can delete
unknown operation types. Existing sentence/listening queues remain unchanged. Retry
intents last for the browser session, not indefinitely after session storage loss.
Sentence checkpoints remain lifetime per text, including after edits; explicit
whole rereads earn volume, while new sentence cycles still require versioned IDs.
Automatic completed-listen detection, native-reviewed unspaced-script counting,
general offline reset/cycle identity and all-44-language readiness remain open.

Security-scanner follow-up: a `Username Password` GitGuardian alert against
`18e8d73` matches the literal invented PostgreSQL test credentials in its workflow
and verification commands. Replace that reusable literal with a fresh per-run
password, mask it in CI logs and bind the test database to loopback. No learner or
production credential was copied into this setup. The private incident's exact
occurrence requires dashboard access; removing the literal does not resolve or
erase the historical incident automatically.

Visual follow-up: bind the new panel/dialog to the app's actual theme variables,
including classic-dark mode; the app does not use Bootstrap's `data-bs-theme`.
Regenerate the fixture screenshots with the real theme CSS, keep status/scope text
readable, and use contrasting dialog controls with 44px mobile targets.

## Header refinement and partial-listening decision — 2026-10-30

The counters now sit beside the desktop title, or in one row below the mobile
title inside the Lesson header. Counter menus retain explicit recording actions.
Lessons without attached audio omit both the Listened counter and its action;
book audiobook tracks also qualify. The permanent tracking-scope note and visible
success banner are removed; errors remain visible and success is announced to
assistive technology. Counting, replay identity and historical totals are unchanged.

Focused verification passed **119 tests in six files**, including reader integration
for plain text, audio lessons and book audio; header placement, retry serialization,
stale loads, duration validation and existing listening-time behavior are covered.
Independent review found no blocker and requested the added reader integration and
narrow-header checks. Chromium checks rendered the real header components with
synthetic HTTP data: long title, open menus at 390/320px, 44px counter/menu targets,
no horizontal document overflow, read counter refresh and the 320px listen dialog.
An initial mobile layout stacked the counters; the revised header gives them a
full-width row. Physical-device and full installed-reader checks remain open.
TypeScript/production build and scoped ESLint checks passed; the production guard
retained 402 static assets and all 11 license notices.

The chosen next design is fractional listening exposure based on source duration,
with actual elapsed listening minutes kept separate and transcript credit limited
to explicit read-along. **Fractional counters/read-along are not implemented.** The
[plan](LANGUAGE_SUPPORT_PLAN.md#header-refinement-and-fractional-listening-decision-2026-10-30)
records the required compatibility experiment and seek/repeat/speed/offline cases.
