# App validation before the beta

Use [the release plan](OPEN_SOURCE_PLAN.md) for publication priorities and [the checklist](RELEASING.md) for release gates. Reliability/export work has [dated evidence](RELEASE_VERIFICATION.md); choose new fixes from reproduced learner friction.

## Remaining work

- Have another person follow the Docker installation guide from scratch.
- Verify the full workflow on a physical phone and through a real browser disconnect/reconnect, including queued activity. Viewport and API replay tests do not complete this.
- Check context export in Anki desktop/mobile and observe a learner session using [the feedback protocol](LEARNER_FEEDBACK.md).
- For language/activity implementation, start with the [short roadmap](LANGUAGE_SUPPORT_PLAN.md) and inspect current code.

Cloze and mixed review are enabled with translation meaning cues, progressive letter-by-letter hint unlocking, and grapheme-aware answer slots; observe real learner sessions to validate prompt clarity and alternative answers. Related-word links, transcription and two-way Anki sync remain deferred.
