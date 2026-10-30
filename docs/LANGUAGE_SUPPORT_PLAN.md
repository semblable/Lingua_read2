# Language support: next work

Goal: make all 44 catalog languages practically usable while keeping existing learner data intact. Regional varieties share catalog entries; preserve existing custom/regional records and their IDs. A preset is not a readiness claim.

Use this as a short roadmap, not an implementation specification. Inspect current code and tests, reproduce the problem, and choose the smallest useful batch. Reorder work when evidence shows a dependency. Detailed implementation history is in Git; reproduction commands and observations are in [verification](../verification/language-support/README.md).

## Current baseline

The catalog, Turkish reader matching, dictionary source filtering, speech-tag handling and basic saved-direction propagation have focused fixes. Per-lesson Read/Listened menus record whole passes; pass actions require connectivity, and partial playback already earns elapsed listening minutes. Fractional passes and read-along credit are not implemented.

No all-44-language acceptance pass exists. Chinese/Japanese parser names do not invoke their advertised engines; Thai and other unspaced text still lack useful segmentation. The ICU probe demonstrated feasibility, not acceptable linguistic boundaries: do not ship its experimental loader.

## Next candidates

### Partial listening and reading activity

Use fractional listening exposure: played source seconds divided by that source revision's duration. Keep listening minutes as actual elapsed playback time. Half a 60-minute lesson at 1.5× earns 0.5 equivalent listens and 20 listening minutes. Replayed sections add exposure; the count is not unique coverage. Seeking, pauses and buffering add none.

Keep audio-only listening separate from reading credit. An explicit read-along mode may credit transcript spans actually encountered. An open tab, auto-scroll or an unmapped audiobook track is insufficient evidence of reading.

Before changing semantics, run a bounded synthetic learner experiment covering sentence credit/completion overlap, deliberate repeats, goals/reset, variable speeds, seeks/loops, unknown duration, audio edits, multiple tracks/devices, interrupted writes, old clients and offline replay. Establish source/playback/reading-cycle identity, deduplication and compatibility with existing manual pass events. Do not guess historical fractional counts.

### Identity and useful segmentation

Reproduce Unicode identity failures before choosing normalization or key changes: Greek sigma, Hindi/Bengali canonical pairs, composed/decomposed Hangul and supplementary Han. Audit leading/trailing apostrophes, Greek middle dot and Hebrew gershayim. Existing selective normalization and rekey/relink tests do not establish a general migration.

Compare language-specific Chinese/Japanese/Thai engines on the existing corpus, then obtain native review and assess deployment size, runtime cost and licenses. Vietnamese lexical grouping and Korean particles also need learner validation. Preserve source spans, combining marks and browser selection offsets.

Boundary changes must preserve saved phrases, known statuses, sentence mining, bookmarks and progress across reload/offline use. Prove migration and recovery before relinking existing texts; do not spread a saved paragraph's status to every newly split word.

### Remaining usability

- Check RTL and mixed-direction selection, fonts and wrapping on actual devices; saved direction alone does not prove usability.
- Fix demonstrated sentence/import problems, including abbreviations, numbers, ruby/furigana and chunk joins, without losing source text or SRT timing.
- Verify provider/voice mappings and clear unavailable states. Preserve complete language/script/region tags; stored language codes still have a ten-character limit.
- Keep unavailable romanization hidden. Defer lemma grouping, cloze redesign and unrelated features until learner evidence justifies them.
- Keep vocabulary/CEFR estimates approximate unless independently validated for that language; saved-term counts do not establish proficiency.

## Non-negotiable contracts

- Preserve vocabulary IDs, meanings, edited statuses, phrases, mined sentences, SRS history and earned reading/listening activity. Resolve identity collisions without silently discarding conflicting records.
- Vocabulary size counts saved terms; coverage counts linked nonignored occurrences; reading activity counts earned events in their recorded unit. Totals need not match. Current activity uses ASCII-whitespace chunks, so unspaced text, punctuation and Unicode spaces remain inaccurate.
- Coverage is a recomputable cache; earned activity is history. Do not globally replace the counting utility, silently recredit history or reset goal baselines.
- Version semantic changes and prove compatibility, interrupted-operation recovery and rollback on synthetic data. Existing offline clients can discard unknown queue types.
- The study ledger retains retry/checkpoint evidence through statistics reset; a nonempty ledger refuses destructive schema downgrade. An old finished flag does not prove earned credit.

## Acceptance

For each language: ordinary import, useful selection/lookup, saved status after reload, phrase saving, mining/review, resume, transcripts and downloaded offline reading must work together. Native review, physical devices and real disconnect/reconnect are separate evidence from automated fixtures. Promote readiness only for the scope actually verified.

Keep [user guidance](../LANGUAGES_GUIDE.md) accurate and use the [release checklist](RELEASING.md) for publication.
