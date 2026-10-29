# Experimental release plan

Updated 2026-10-29. LinguaRead is a self-hosted reading/listening workspace for
intermediate learners, with sentence mining and FSRS. Support is best-effort from
one maintainer; language/device coverage is limited.

## Current checkpoint

- Reliability fixes and context CSV/one-way Anki export are implemented and tested.
- Release docs, screenshots, licenses/notices, community templates, and artifact
  checks were merged in [PR #130](https://github.com/semblable/Lingua_read2/pull/130)
  and deployed to staging (`fa3578fb`). The maintainer reports reading/listening work.
- Cloze/mixed review is paused: open-ended blanks are ambiguous. Translation review
  remains available; a redesign needs learner validation.
- [The static demo](https://semblable.github.io/Lingua_read2/) uses prepared samples;
  it does not verify authentication, imports, scheduling, restore, or offline sync.

See [the app plan](PRE_RELEASE_APP_PLAN.md) for scope and
[the verification record](RELEASE_VERIFICATION.md) for tests, deployment links,
versions, and limitations. Personal server use is not a capacity benchmark or
proof of broad device/language support.

## Next steps

1. Confirm the cloze pause on staging; complete physical-phone and browser offline
   replay checks. See [device evidence](DEPLOYMENT_EVIDENCE.md).
2. Resolve asset/history provenance, enable and verify private security reporting,
   and validate the intended release commit using [the release checklist](RELEASING.md).
3. Observe a few real learner sessions with [the feedback protocol](LEARNER_FEEDBACK.md).
   Prioritize demonstrated friction; defer related-word links, broader parsing,
   and transcription until justified.
4. Record representative host measurements and a short truthful walkthrough;
   [architecture notes](ARCHITECTURE.md) and [the recording script](PRESENTATION.md)
   support that work.

Use the existing dev → staging → reviewed production promotion flow. A release
still requires a deliberate tag and release notes; none has been published.
The static demo publishes separately through its manual Pages workflow.
