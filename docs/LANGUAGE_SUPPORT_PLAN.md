# Language implementation roadmap

Goal: practical support for all 44 catalog languages. Regional varieties share catalog entries; preserve existing custom/regional records and IDs. Presets are not proof of support.

## Next: language coverage

Start language implementation now. Fractional listening and beta publication are independent, not prerequisites. Ship one usable language slice at a time; revise the order from results.

1. **Chinese:** validate the opt-in dictionary segmenter on new pasted texts, then extend it to book/audio imports with the same per-text profile. Preserve legacy boundaries; test selection, saving/mining, offline reopening and unknown names with native review before broader enablement. No automatic script conversion or vocabulary merging.
2. **Korean:** validate the exact-first Hangul alias lookup and raw phrase spans with learner material. Keep space-separated surface forms and existing identities. Particle/ending analysis and dictionary-form lookup remain separate work.
3. **Japanese, then Thai:** implement actual Japanese segmentation behind the ineffective `mecab` option, preserving ruby/furigana and offsets; integrate a suitable Thai segmenter. Reuse the integration contract, not Chinese boundary assumptions.
4. **Other languages:** prioritize reproduced sentence/import, Indic combining-mark, Vietnamese grouping and RTL/mixed-direction problems. Verify dictionaries, speech/provider mappings and offline use per language.

## Rollout contracts

- Use original fixtures and shared server/client expected spans. Preserve source text and selection offsets; the existing ICU probe is not a production engine.
- Version boundary changes and enable a bounded scope first. Prove compatibility/recovery before relinking existing texts. Preserve saved phrases/statuses, mined sentences, SRS, bookmarks and offline/resume state; never spread paragraph status to every new word.
- Keep vocabulary identity separate from segmentation. Reproduce canonical/case failures before normalization or rekeying; resolve collisions without losing records.
- Coverage is recomputable; earned activity is history. Preserve recorded units, manual passes, goals and reset/retry proof. Never retokenize historical credit or infer it from finished flags.

## Listening follow-up

First fix source/language attribution across switches and delayed retries; then establish audio revision/duration snapshots and compatible offline event identity. Old clients may discard unknown operations/fields. No historical fractional backfill.

Equivalents = played source duration / revision duration; minutes = elapsed playback time. Half a 60-minute lesson at 1.5× earns 0.5 equivalents and 20 minutes. Replays add exposure; seeks, pauses and buffering add none. Unknown duration earns time only. Read-along requires explicit mode and reliable transcript mapping; audio alone earns no reading credit.

## Acceptance

Verify the complete reader workflow plus transcripts/resume per language. Native review, physical devices and real disconnect/reconnect remain separate checks. Keep unsupported romanization hidden and proficiency estimates approximate.

[Verification/fixtures](../verification/language-support/README.md) · [User guide](../LANGUAGES_GUIDE.md) · [Release checklist](RELEASING.md). Keep implementation history in Git.
