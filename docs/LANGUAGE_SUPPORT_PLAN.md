# Plan: make all 44 language presets usable

Created 2026-10-29. Status: implementation in progress. The first bounded fixes and audit are recorded below; the 44-language readiness gate has **not** passed.

## Evidence and changes to the roadmap — 2026-10-29

The starting audit is in [LANGUAGE_SUPPORT_STATUS.md](LANGUAGE_SUPPORT_STATUS.md).
Reproducible synthetic probes, inputs and raw Windows/Node/Linux reports are in
[`verification/language-support`](../verification/language-support/README.md).
Treat proposed native-language boundaries separately from verified runtime behavior.

### Implemented first batch

- **Turkish reader matching:** a failing reader test reproduced `IŞIK` appearing
  untracked despite a saved `ışık` row. The server already produces the correct
  Turkish lowercase key. Reader vocabulary probes and bulk-action deduplication now
  use Turkish casing for `tr` and its regional tags. The regression reloads the
  reader, checks `IŞIK`/`İZMİR` statuses and translation, and updates the original
  WordId rather than creating another row. This does not fix every Turkish import,
  legacy database casing, phrase/highlight or canonical-key path.
- **Dictionary filtering:** an explicitly requested Wiktionary source language now
  returns no result if its bucket is absent, including when only `other` exists.
  Flat, rich and batch lookups share this behavior. Underscored regional tags map
  to their base source language. Rich results identify their English definition
  language; the settings page already documented English-only glosses.
- **Browser speech:** preserve complete script/region/variant tags; bare `pt` no longer
  selects Brazil by default. Reuse the existing device-local voice picker instead
  of adding a backend preference system. Read older voice keys as fallbacks and
  preserve them when setting/resetting a new preference, so separate existing
  regional/script records keep their choices. All 44 preset tags are checked for
  syntactic validity; installed voice availability is still unverified.
- **Reading direction:** the saved `rightToLeft` setting now reaches standard and
  sentence readers, desktop/mobile transcript containers and the selected-term
  heading. Source `lang` tags survive, translation direction is independent, and
  default paragraph alignment follows the reading direction. Automated integration
  fixtures cover Arabic, Hebrew, Persian, Urdu and custom `ms-Arab`; this is not
  complete RTL, touch, font or screen-reader validation.
- **Truthful controls/catalog:** hide the unimplemented romanization switch while
  preserving its stored value on edit. Group `nn` alongside `nb` under the existing
  Norwegian preset for display only; retain the original code/ID and distinct
  speech tag. No new catalog entry or automatic language merge is introduced.
- Extend the shared client/server surface-token fixtures with 12 script examples.
  Canonical-equivalence and segmentation failures remain explicit in the audit
  corpus, rather than freezing incorrect results into passing golden expectations.

### Material ordering and architecture decisions

1. **Allow independent fixes before the complete Phase 0 exit gate.** A full
   engine decision, per-language corpus and general profile object are unnecessary
   prerequisites for dictionary filtering, presentation, speech tags or matching
   the server's existing Turkish keys. No stored vocabulary semantics, tokenizer
   version, sentence boundaries, bookmarks or offline queue format change in this
   batch, so it introduces no database migration or automatic relink.
2. **A universal ICU switch has not earned acceptance.** A six-case experiment
   exercised native ICU directly from .NET 10 on the cached Linux API image and
   Windows, and `Intl.Segmenter` in Node. It preserves source spans and is fast on
   these samples, but only two of six engineering word expectations match. It
   splits Japanese `食べ` as `食` + `べ`, and groups Thai `กับOpenAI`. Different
   runtime versions happened to agree on this tiny corpus; that proves neither
   linguistic quality nor future layout stability. Do not integrate the probe's
   native-library loader, add models or switch persisted texts on this evidence.
   Next compare language-specific candidates on the **same** corpus, then obtain
   native review and pin deployment data/licenses before selecting an engine.
3. **Keep selective normalization until the migration is proven.** The existing
   code deliberately avoids normalizing Greek punctuation into a connector and
   leaves compatibility Han unchanged. The audit reproduces Greek sigma drift,
   missed Hindi/Bengali canonical pairs, decomposed Hangul and lost supplementary
   Han. Replacing it with whole-string NFC or locale-lowercasing everywhere would
   change existing identities; neither is a safe general repair. The next identity
   batch needs indexed keys and conflict-preserving upgrade experiments first.
4. **Reuse existing upgrade machinery, but do not overstate its coverage.**
   Tokenizer version 3, startup relinking and legacy-term repair already exist.
   They have synthetic SQLite preservation tests, but still probe SQL `lower()`
   and leave some collisions unresolved. They are not proof of a resumable general
   Unicode-key migration, occurrence-aware sentence-anchor migration or rollback.
   Persistent layouts/anchors remain a target before boundary-changing rollout,
   not a reason to rewrite the reader before these bounded fixes.

### Verification and remaining gates

- The original focused frontend baseline passed 135 tests, yet new speech cases
  failed (nine failures), demonstrating missing regression coverage. The Turkish
  reader regression separately failed with `word-status-0` before the fix and
  passed after it. Wiktionary missing-language checks pass for flat/rich/batch paths.
- Full backend and frontend suites, build results, runtime measurements and their
  exact scope are recorded in the status document. Backend tests require a local
  test-host connection outside this environment's sandbox; a sandbox timeout is
  not a failed application test. No production database or learner library was
  accessed. Existing migration/SRS tests remain regression evidence, not a new
  production upgrade rehearsal.
- Pending: full import/reading/mining/review/offline flows for each language,
  language-specific engine comparisons and native review, indexed Unicode keys,
  source-preserving layouts/anchors, provider capabilities/live opt-in checks,
  remaining RTL surfaces, wrapped desktop transcript sizing, fonts, real devices
  and rollback/older-client rehearsals. No preset is newly promoted to fully ready.

### Independent review and fixes before the dev push

A separate review agent inspected the full catalog/flag, reader, provider, test,
documentation and experiment update. Eight new frontend regressions reproduced
the following defects before repair:

- The language form and page both issued DELETE. The page now treats the form's
  callback as a success notification, refreshes the list and clears selection.
- `Object.hasOwn` exceeded the supported Safari 14 runtime surface. Preference
  lookup now uses the older-compatible `hasOwnProperty.call` operation.
- Full speech tags were retained but voice ranking still compared raw strings.
  Ranking now compares canonical language/script/region, ignores locale extensions
  for matching, and resolves omitted scripts before preferring natural voices.
  A stale preferred URI for another language is ignored; saved preferences remain.
- Turkish case handling had not reached batch-result merging and linker polling.
  Both now use the same reader casing so distinct dotted/dotless legacy terms
  remain in client state. Database records and original IDs remain untouched.

The review also caught deprecated Wiktionary source aliases (`iw`/`in`/`ji`):
map these true synonyms to `he`/`id`/`yi` while retaining strict source filtering.
Norwegian written forms remain distinct. Correct the user guide's stale
romanization switch, regional-entry and voice-picker instructions. The reviewer
confirmed the six-case probe results but did not establish linguistic readiness.
Final full-suite/build results are recorded in the status document after fixes.

### Post-push statistics follow-up

The [CI and staging run for `c00ce187`](https://github.com/semblable/Lingua_read2/actions/runs/40933654143)
completed successfully. A further 85 targeted statistics/activity/completion,
vocabulary-linking and goal checks passed (33 + 52). Coverage includes occurrence-
weighted chapter/book aggregation, ignored-word exclusion, duplicate reading
credit, sentence-mode completion credit and repeat completions. No new breaking
statistics regression was found in these paths; passing tests do not prove the
absence of every regression.

There is a **pre-existing unresolved counting inconsistency**: text/book coverage
uses linked token occurrences, while reading activity's `CountTotalWords` splits
on ASCII spaces, tabs and line endings. Unspaced Chinese/Japanese/Thai passages can
therefore receive very low reading-volume credit, and punctuation or Unicode
spacing can make activity counts disagree with tokenizer units. Vocabulary size
is a third measure (stored terms), not the running-token count. None of these
counting algorithms, the tokenizer version or historical-activity logic changed
in `c00ce187`; this does not establish accurate statistics for all 44 languages.

Before changing counting semantics, reproduce these discrepancies with fixtures,
define the units for each metric and run a bounded compatibility experiment.
Distinguish recomputable coverage caches from historical reading credit. Do not
retroactively recredit activity, reset goals, or reinterpret pending offline
actions without an explicit versioned transition and preservation evidence.
Keep this work alongside the Phase 1/4 experiments and Phase 6 acceptance gates.

### Second batch — bounded reading-credit compatibility

The [synthetic SQLite experiment](../verification/language-support/reading-credit-experiment.md)
reproduces the ASCII-whitespace, punctuation and Unicode-space discrepancies and
compares legacy activity, Unicode-whitespace and current-tokenizer candidates.
It defines vocabulary size as saved term records, coverage as linked nonignored
occurrences, and activity as earned event volume in its recorded counting unit.
These metrics are intentionally separate; equal totals are not an acceptance goal.

**Decision: preserve counting semantics in this batch.** Unicode whitespace alone
does not handle punctuation or unspaced text, and current tokenizer runs are not
accepted CJK/Thai lexical boundaries. Useful unspaced-script counting depends on
accepted segmentation and stable layouts. Both whole-text/sentence additivity and
versioned replay/credit checkpoints need evidence before a new unit can roll out.
Unicode identity work remains necessary for vocabulary, but is not a prerequisite
for the demonstrated credit lifecycle fixes. The ICU probe stays experimental.

Implement only the verified reconciliation fixes: initial book completion deducts
already earned sentence credit; later standalone rereads earn their full volume
without repeatedly deducting the original sentence credit. Preserve the existing
retry window and unique-versus-total completion behavior. Historical excess credit
is never clawed back. Coverage recomputation repairs caches and leaves earned
activity, goals and vocabulary/SRS rows untouched. The separate legacy global
`Language.WordsRead` accumulator keeps its existing book-completion-only behavior.

Independent review found stale sentence credit surviving explicit **Reset
statistics**, which would make the new book deduction undercredit a later lesson.
Reproduce it on both routes, then zero only the deductible sentence amount within
that explicit reset's atomic save. Retain credited indices for pending replay dedup
and retain reading position; do not reset goals or learner content. A SQL-trigger
failure checks rollback, and another learner's records check reset isolation.

The final verification counts are in the status record. No schema/key/tokenizer
version or offline payload changes, automatic history recalculation, catalog split
or readiness promotion is introduced. A previously unseen sentence replay **after**
completion still overcredits; a ten-second completion window is not durable event
identity. Do not suppress sentence credit based solely on `IsFinished`: `skipStats`
and `FinishBook` can set it without earning completion credit. Design a versioned
per-text credit checkpoint/reading-cycle contract before fixing those orderings.

## Product decisions

- Keep one catalog entry per language. Portuguese remains **Portuguese**, with one vocabulary collection and shared reading statistics. The same principle applies to English, Spanish and other regional varieties.
- Make speech voice/locale an optional preference inside language settings. A Portuguese learner can choose a Brazilian or European voice without adding another language. Never infer dialect from a decorative flag or silently rewrite the learner's text.
- Distinguish meaningful script or written-form choices in settings when needed: Serbian Latin/Cyrillic, Chinese simplified/traditional and Norwegian Bokmål/Nynorsk. Preserve complete BCP-47 tags for content and provider requests. These choices do not require duplicate catalog tiles.
- Preserve existing regional/custom configurations and their IDs, content and history. Canonical aliases can group them for display; do not automatically merge existing language records or delete one because its base code matches another.
- Retain the current starter languages. Additional languages remain opt-in. Search, native names and bundled flags remain available.

## Definition of done

A language is ready when a learner can reliably import/paste ordinary text, read it in the correct direction, select useful words and phrases, look up or manually save meanings, see known-word status after reload, mine sentences, review cards and resume reading. Audio transcripts and downloaded offline content must use the same saved boundaries and keys as the reader.

Translation and speech are conditional on configured providers and installed voices. Readiness requires correct language mapping, tested successful integrations where available, and useful missing-capability states. It cannot promise every commercial provider or every device supports every language.

For every language, the release evidence must cover its script, punctuation, common spelling variants, word/sentence units and representative real reading material. Native-speaker review and physical-device checks are separate gates from passing automated fixtures. No language is promoted solely because its characters render.

Optional romanization and lemma grouping have their own capability status. Provide them where useful and validated; hide unavailable controls. Core reading must remain useful without either. Vocabulary-size estimates must describe what is counted and must not imply a verified CEFR assessment.

## Architecture and migration rules

1. Start with the existing language configuration and tokenizer version. Add durable profile fields incrementally after a bounded layout/migration experiment demonstrates their need: canonical language, content script/form, direction, tokenizer/normalization version and sentence-boundary version. Keep per-device voice preferences and provider codes separate from vocabulary identity; do not add a general profile abstraction as a prerequisite for independent fixes.
2. Preserve original content and display spelling. Produce canonical lookup keys separately. Keep source-to-display offsets when normalization changes text length.
3. Use code-point-aware iteration without losing the UTF-16 offsets required by browser selections. Combining marks and grapheme clusters must remain intact. Test supplementary Han, emoji, variation selectors, malformed input and mixed scripts.
4. Make backend-produced, versioned word and sentence layouts authoritative for persisted texts. Supply them to the client and cache them with downloaded content. Browser ICU changes must not silently change bookmark targets or credited sentences. Lightweight previews must be identified as provisional until authoritative processing finishes.
5. Query an explicitly stored/indexed lookup key. Do not combine JS lowercasing, .NET locale lowercasing and database `lower()` as if they were identical.
6. Ship any semantic change with a resumable migration, old/new mappings, collision handling, synthetic upgrade tests and rollback evidence. Reuse existing tokenizer versioning and relinking infrastructure where appropriate.
7. Preserve meanings, user-edited status, mined sentences, SRS scheduling/history, phrase associations and historical activity. Merge only unambiguous duplicates; retain conflicting original records and surface a migration conflict before enforcing uniqueness. No silent selection of one user's edited meaning/history over another.
8. Give sentences persistent anchors tied to content revision and source span, with contextual fingerprints for migration. Map existing index-based bookmarks/progress before changing boundaries. Repeated identical sentences require occurrence-aware mapping. Preserve original SRT cue/timing identities.
9. Keep layout caches, service-worker data and queued offline actions versioned. Handle older clients and pending mutations during rollout; do not apply obsolete token/segment indices to a new layout.

## Phase 0 — lock the contract and regression evidence

Deliverables:

- A feature matrix for all 44 presets covering core reading, Unicode keys, word splitting, sentence splitting, RTL, imports, dictionary lookup, TTS, romanization and offline reading.
- Extend `tokenizer-golden-vectors.json` and add corresponding sentence, layout and migration fixtures. Use small original/public-domain or appropriately licensed passages; retain provenance for dictionaries/models.
- Capture the audit reproductions: Turkish dotted/dotless I; Greek final sigma and middle dot; Hindi/Bengali canonical variants; Korean Hangul composition; leading/trailing apostrophes; Hebrew punctuation; Arabic marks/tatweel; Persian joiners; unspaced scripts; rare Han; Western and non-Western sentence stops.
- Include decimal/grouping punctuation, abbreviations, dialogue quotes, ellipses, empty text, very long tokens, soft hyphens, zero-width characters, RTL with Latin/numbers and mixed-script names.
- Run a bounded segmentation dependency spike using the same Chinese/Japanese/Thai corpus. Evaluate dictionary-backed ICU and suitable language-specific engines against native-reviewed boundaries, source offsets, .NET 10/Linux deployment, memory/startup cost and license requirements. Record and pin the selected engines/data before implementation. Existing `mecab`/`jieba` configuration names do not prove engines exist.
- Record baseline import time, reader response, memory, database work and download size on representative 10k/100k-character passages and the documented deployment class. Set explicit budgets before adding engines; do not load every dictionary for every request.

Exit gate for semantic key/boundary rollout: the failures are reproducible, expected behavior is written down, the processing contract and engine decision are recorded where applicable, and upgrade fixtures contain realistic existing learner data. Independent presentation/provider fixes may land earlier with their own regression evidence; they do not imply this gate passed.

## Phase 1 — reliable word identity and vocabulary matching

Implementation:

- Implement a shared, versioned normalization/key specification for server and client consumers; prefer keys returned with authoritative tokens instead of re-deriving them throughout the UI.
- Fix Turkish I/İ/ı and Greek σ/ς/Σ consistently. Define behavior for contextual casing and test Lithuanian accented cases as well.
- Recognize canonical Hangul, Devanagari nukta and Bengali equivalences while preserving display spelling. Make Greek punctuation handling explicit before normalization can turn it into a connector.
- Replace universal connector assumptions with language policies: Catalan middle dot; Greek stops; Afrikaans `'n`; Dutch leading apostrophes; Italian `po'`; Ukrainian apostrophe variants; Hebrew geresh/gershayim and maqaf. Preserve existing French, English, Italian and Portuguese elisions/clitics.
- Define conservative per-language lookup aliases for Arabic presentation forms/tatweel and Persian/Arabic keyboard variants. Preserve distinctions that change meaning. Keep optional vocalization-insensitive lookup separate from exact spelling; do not strip all combining marks globally or remove Persian joiners indiscriminately.
- Introduce indexed canonical lookup keys, update save/import/batch/link/export paths and migrate existing terms safely. Decide explicit handling for legitimate long words/phrases; never silently truncate a term at 100 characters.

Acceptance:

- Every golden fixture produces the intended words and keys; client/server token IDs and offsets agree.
- Saving a word from title case, uppercase, pasted decomposed text or a keyboard variant behaves consistently after reload and in another text.
- Upgrade tests preserve conflicting meanings and SRS history, are resumable and do not create new duplicates or orphan references.

Primary areas: `src/utils/readerText.ts`, `src/pages/TextDisplay.tsx`, word save/batch APIs, `Services/Tokenization/Tokenizer.cs`, `WordLinker.cs`, `Models/Word.cs`, database migrations and existing vocabulary export paths.

## Phase 2 — complete RTL and complex-script presentation

Implementation:

- Apply content `lang` and `dir` consistently in standard/sentence readers, mobile/desktop transcripts, word/phrase panels, dictionary results, translations, flashcards and exports that support direction metadata.
- Use logical alignment/spacing properties and bidi isolation for mixed-direction fragments. Keep navigation controls readable and separate from content direction. Native-selection and phrase-extension logic must respect logical text order.
- Choose fonts/fallbacks and line heights that preserve Arabic joining, Hebrew points, Indic conjuncts and Urdu marks. Check wrapped/long transcript rows instead of assuming a Latin single-line height.
- Allow script-specific direction for custom profiles, including Malay Jawi, without changing unrelated language records.

Acceptance:

- Arabic, Hebrew, Persian and Urdu passages containing dates, prices, parentheses, English names, URLs and quotations read and select in the correct order.
- Translation and source paragraphs can have opposite directions without disturbing one another. Desktop/mobile, light/dark, keyboard selection and screen-reader checks pass.

Reference: [W3C structural direction guidance](https://www.w3.org/International/questions/qa-html-dir).

## Phase 3 — stable sentences, imports and progress

Implementation:

- Use one versioned sentence-boundary policy across reader layout, EPUB/plain-text import, sentence mining, TTS and long AI-translation chunks. Apply custom rules and abbreviation exceptions consistently.
- Supply language-specific abbreviation data and handle decimals, initials, dialogue punctuation, ellipses, Greek question marks, CJK full-width punctuation, Arabic/Urdu marks and Indic danda.
- Replace Latin-only short-heading heuristics for unstructured text with script-aware detection. Honor explicit EPUB paragraph/title structure.
- Preserve ruby/furigana as annotations rather than concatenating it into Japanese vocabulary text. Preserve language/direction metadata; support readable horizontal reflow of vertical-layout EPUBs while retaining original reading order.
- Respect grapheme/word boundaries when chunking long text. Avoid punctuation loss or duplicated/missing text at chunk joins.
- Introduce persistent sentence anchors and migrate legacy index-based progress/bookmarks before switching existing texts. Keep SRT cues/times stable even when linguistic sentence boundaries span cues.

Acceptance:

- Abbreviations and numbers do not fragment the regression sentences. Sentence layout is stable across browsers and fallback paths.
- Every imported source character is preserved or accounted for as markup/annotation; no furigana enters the main word stream accidentally.
- Upgrade/reload/reconnect tests restore the correct passage and credited activity. No later bookmark moves merely because an earlier paragraph splits differently.

## Phase 4 — meaningful word units for unspaced and multi-unit languages

Implementation:

- Integrate the Phase 0 engines for Chinese, Japanese and Thai behind the language-profile contract. Existing parser names must invoke a real engine or be replaced with accurate settings/migration aliases.
- Return token source spans, display text and canonical keys from the backend; cache layouts so desktop, mobile, word linking and offline reading use identical units.
- Handle simplified/traditional Chinese, kana/kanji mixtures, names, loanwords, Latin insertions, digits and supplementary Han. Preserve spelling instead of silently converting Chinese scripts.
- Add Vietnamese multi-syllable lexical grouping and useful Korean lexical/particle grouping while preserving surface spans and phrase selection. Validate choices with learners rather than treating every space as a universal word boundary.
- Relink existing texts, update word-count definitions and preserve saved phrases/known statuses through token splits/joins. Do not distribute a formerly whole-sentence known status to every newly segmented word.

Acceptance:

- Representative passages expose useful individual word lookups instead of paragraph-sized tokens; boundary quality is accepted on a native-reviewed fixture set.
- Offsets, selection, mining and linking use the accepted word layout; coverage uses its occurrence units. Reading activity keeps its explicitly versioned event-volume contract rather than assuming its totals equal coverage or vocabulary size. Very long passages cannot fail because a whole sentence was inserted as one vocabulary word.
- Failed/missing engines show a recoverable processing state; they never silently fall back to reporting an unspaced paragraph as one supported word.

References: [Unicode text segmentation](https://www.unicode.org/reports/tr29/), [ICU boundary analysis](https://unicode-org.github.io/icu/userguide/boundaryanalysis/).

## Phase 5 — translation, dictionaries and speech that match the language

Implementation:

- Add a provider-specific mapping/capability layer covering source language, target language, script, region and model restrictions. Test adapters with recorded synthetic responses; refresh capability data through supported APIs where available.
- Keep the Norwegian catalog entry, but map its chosen written form correctly (`nb`/`nn`) per provider. Pass Serbian/Chinese scripts deliberately. Preserve complete multi-part tags.
- Keep Portuguese as one language: choose the device voice/locale in settings, use a matching installed voice when available and expose regional translation preferences only when relevant. Do not hardcode a Brazil voice merely because the stored language is `pt`.
- Provide useful missing-key, unavailable-language, rate-limit and no-result states. Offer configured alternatives without silently sending text to another service or incurring new charges.
- Restrict dictionary results to the requested source language. Label the definition language. Stop returning another language's entry when the requested bucket is absent. Make English-only Wiktionary glosses explicit and add language-appropriate dictionary links.
- Implement validated optional romanization/transliteration for relevant scripts, with display and stored-source text kept separate. Until implemented for a profile, hide the currently ineffective switch. Make context-dependent readings, such as Japanese names/kanji, reviewable rather than presenting guesses as certain.

Acceptance:

- All 44 languages have a documented provider/voice capability result. An unavailable service does not disable basic reading or manual vocabulary.
- Selected regional voices persist per device without creating duplicate languages or vocabulary collections.
- End-to-end opt-in smoke tests cover each supported integration/required mapping. No credentials or private passages enter fixtures or logs.

## Phase 6 — statistics, upgrades and release validation

Implementation:

- Label counts as surface forms, lexical units or optional lemmas, according to the language profile. Keep inflected forms and per-form learning state; lemma grouping must not mark every related form known.
- Recompute derived coverage/statistics after tokenization migrations. Preserve historical reading/listening activity; do not retroactively invent activity from new counts.
- Replace unsupported CEFR precision with clearly approximate vocabulary estimates; validate any language-specific thresholds independently. New scripts do not become calibrated by reusing English numbers.
- Test older clients, cached layouts, exports/imports, backups/restores and interrupted upgrades. Use a rollout switch per processing version and promote language groups only after their gates pass.
- Add support details to the catalog without splitting Portuguese or other regional variants into separate entries. Show core readiness separately from optional provider/device features.

Final validation matrix:

| Coverage | Required evidence |
| --- | --- |
| Every one of the 44 languages | Import/paste, useful tokens, correct lookup/status after reload, phrase selection, mining/review, sentence navigation and cached offline reading. |
| Arabic, Hebrew, Persian, Urdu; custom RTL scripts | Mixed-direction text, punctuation/numbers, selected phrases, translations, flashcards and mobile selection. |
| Chinese, Japanese, Thai; Vietnamese, Korean | Native-reviewed boundaries, long input, mixed scripts, offset fidelity, persisted layouts and statistics. |
| Turkish, Greek, Hindi, Bengali, Korean | Case/Unicode-equivalence fixtures and existing-vocabulary migration with conflicts. |
| All language profiles | Appropriate abbreviations, punctuation, voice/provider mapping and clear unavailable states. |
| Chrome/Edge, Firefox, Safari | Representative script families and high-risk cases; no dependence on browser segmentation for persisted anchors. |
| Physical Android and iOS | Touch selection, complex-script layout, transcript wrapping, speech availability and real disconnect/reconnect. Viewport emulation alone is insufficient. |
| Existing installations | Synthetic upgrade/rollback, vocabulary/SRS preservation, sentence-anchor remapping, old offline queue handling and stats recomputation. |

Exit gate: all mandatory core cases pass, migrations are recoverable, each language has recorded review evidence, and any optional missing capability is accurately described in the UI. Learner feedback can still uncover new orthographic cases; keep the corpus and per-language support record maintainable.

## Suggested delivery sequence

| Batch | Deliverable | Dependency |
| --- | --- | --- |
| 1 | Reproduce failures; independent Turkish reader, dictionary, speech and direction fixes; support matrix, fixtures and initial ICU probe | First batch implemented; full Phase 0 gate and engine choice remain open. |
| 1b | Define separate metric units; bounded synthetic credit experiment; initial book/repeat standalone reconciliation and explicit-reset compatibility | Implemented without changing counting semantics; unseen offline replay and versioned credit checkpoint remain prerequisites for a new unit. |
| 2 | Prototype indexed keys and conflict-preserving upgrade on synthetic learner data, then Unicode iteration/normalization changes supported by that experiment | Phase 1; do not replace stored identities before upgrade evidence passes. |
| 3 | Remaining RTL surfaces, wrapped transcripts, fonts and mixed-direction selection | Phase 2; presentation work can proceed independently of key migration; use the shared fixtures. |
| 4 | Sentence layouts, anchor migration and import fixes | Phase 3, before changing persisted sentence boundaries. |
| 5 | Compare language-specific engines with the ICU baseline; integrate accepted Chinese/Japanese/Thai engines, then Vietnamese/Korean grouping | Native-reviewed corpus, bounded packaging/cost experiment, authoritative layouts and migration evidence. |
| 6 | Provider codes, dictionary filtering and regional speech preferences | Phase 5; land bounded adapter/voice fixes earlier when independent. |
| 7 | Optional romanization and lemma grouping with their own validation | Phase 5/6 extension; does not delay reliable core reading. |
| 8 | Statistics, full upgrade rehearsal, native/device QA and rollout | Phase 6, repeated for each promoted language group. |

Deliver in focused changes with regression evidence rather than one large reader rewrite. Migration and compatibility work accompanies each batch; it is not deferred to the final release. Do not promise a calendar date before the engine spike and native-review availability are known.
