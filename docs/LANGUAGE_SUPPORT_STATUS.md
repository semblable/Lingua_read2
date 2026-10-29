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
