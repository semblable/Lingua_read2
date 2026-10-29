# App improvements before the first experimental release

This is the execution order for app work. Release administration belongs in
[RELEASING.md](RELEASING.md); detailed test results belong in
[RELEASE_VERIFICATION.md](RELEASE_VERIFICATION.md). Implementation and isolated
verification below were updated on 2026-10-29.
External learner validation and actual-device checks remain separate gates.
The app commits through `2e9c93f8` passed independent correction review and staging
CI. The maintainer is testing that staging build; no new device/offline result is
inferred from existing personal use. See the
[current checkpoint](RELEASE_VERIFICATION.md#release-preparation-review-2026-10-29).

## 1. Make the first complete session dependable

Start with a small, permitted EPUB/TXT plus audio/SRT in an isolated full-app
installation. Exercise password setup → import → lookup/status → phrase → mined
sentence → real FSRS review → reload/reconnect. Record friction and fix reproduced
failures before adding features. The static demo cannot verify authentication,
imports, database scheduling, backup restore, or offline replay end to end.

- [x] **First-run clarity:** make password setup, optional provider configuration,
  and the first import understandable without a guided call. Missing provider keys
  should produce an actionable message while basic reading remains usable.
- [x] **Reader/browser regressions:** verify word/status drawers, phrase extension,
  sentence mode, playback/cue seeking, and reachable controls in portrait and
  landscape. Browser viewport checks are recorded separately from touch/phone tests.
  Add targeted regression coverage for any reproduced failure.
- [x] **Recovery clarity in the app:** explain alongside Download Backup/Restore
  that the file is database-only, media and encryption keys need separate backups,
  and restore overwrites the target database. Verify a full isolated restore.
- [x] **Focused security pass:** reproduce and triage
  session revocation/password recovery, first-start setup exposure, and configurable
  webhook destinations. Implemented persisted session stamps, password change,
  operator-token setup, and exact relay-host/public-address guards. Verified auth
  failure/replay paths and operator recovery on the disposable restore target.
  This is a scoped code/test review, not an exhaustive external security audit.

- [ ] **Remaining device/offline gate:** perform a physical-phone/touch session
  and a full browser network disconnect/reconnect with queued mutations. The
  current browser tool has no network-disconnect control. Audio caching, online
  reload, client queue tests, and real server-side replay passed separately.

Isolated Docker installation, real FSRS, and full restore passed; see the
[verification record](RELEASE_VERIFICATION.md#full-app-reliability-and-export-pass-2026-10-29)
and [repeatable fixture workflow](../verification/README.md).

Done when a clean install can complete that small workflow, the supported browser
and device checks are recorded, and blocking security/data-loss failures are fixed
or the affected feature is explicitly excluded from the experimental release.

## 2. First feature increment: export vocabulary with its context

The current [CSV endpoint](../server/LinguaReadApi/Controllers/WordsController.cs)
retains the simple `Term,Translation,Status,Language` format. Optional exports now
preserve why a learner saved a term when they take it out of LinguaRead.

- [x] Add an optional context-rich CSV export containing mined sentence/context,
  source book/text title, and source identifiers when present.
- [x] Define how multiple contexts per term are represented, and retain terms
  with no mined sentence. Keep the existing simple export/import usable.
- [x] Preserve selected language/status filters and user ownership. Verify Unicode,
  quotes, commas, line breaks, empty translations, and spreadsheet-safe field handling.
- [x] Follow with a **one-way Anki export** using a documented field mapping after
  stabilizing the context format. Verified a six-field UTF-8 text export with
  Anki 26.9.3's real importer in a disposable collection, including repeat import.
  Desktop/mobile Anki UI checks remain unverified; two-way sync is outside scope.

Context CSV uses one row per mined sentence and retains context-free terms.
Anki groups all contexts per word into one note. See the
[format and import guide](VOCABULARY_EXPORT.md). The simple CSV contract/import is
unchanged; spreadsheet-safe protection applies to the new context format.

Acceptance: export a tiny fixture library, inspect its term/context/source data,
and import the supported output without losing or mixing contexts. Add focused
endpoint and UI coverage. Implemented and verified as recorded below; evaluate
the formats with learners before expanding this scope.

## 3. Related-word links, only after validating the need

- [ ] Observe whether learners need manual parent/related-word links for inflected
  forms before choosing a schema and UI.
- [ ] If justified, support an explicit optional relation while keeping difficult
  forms' familiarity and review state independent. Deleting/changing a relation
  must not silently reset learning history or merge unrelated terms.
- [ ] Verify existing lookup, highlighting, mining, and review behavior for linked
  and unlinked words. Keep automatic lemmatization outside this first step.

This follows export and concrete learner feedback; it is not a prerequisite for
inviting the first testers.

## 4. Language and audio work selected from observed friction

- [ ] Choose the initial languages to support and verify representative passages.
  Add shared tokenizer/sentence examples for reported failures before changing
  parsing. Review abbreviation/dialogue splitting and locale-sensitive matching
  only where a current reproduction demonstrates a problem.
- [ ] Keep Japanese MeCab/Chinese Jieba explicitly unfinished until their engines
  and workflows are implemented and verified. Configurable language entries alone
  do not establish support.
- [ ] Add automatic transcription only if audio learners identify preparing SRT
  as their main obstacle. First define local/external execution, correction flow,
  cost/privacy expectations, and timestamp acceptance checks.

## Recommended next session

**Complete the physical-phone and actual browser disconnect/reconnect checks**
using the isolated fixture app, then observe a learner session. Reliability fixes
and context/Anki export are implemented and tested within the scope recorded
above. Use [the learner protocol](LEARNER_FEEDBACK.md) to decide whether
related-word links, parsing, or transcription should follow.

Preserve the existing integrated FSRS/review depth. Extra AI providers, unrelated
dashboards, classroom/SaaS accounts, a broad reader rewrite, and infrastructure
changes solely to reduce container count are outside this release's default scope.
