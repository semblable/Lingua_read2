# First-learner experiment

Status: **not started**. Aim for approximately five intermediate learners who
already read in a language they study. Five people provide qualitative evidence,
not product-market validation. Keep contact details and identifiable notes outside
this public repository.

## Invitation draft

> I'm building LinguaRead, an experimental self-hosted reading/listening workspace
> with vocabulary tracking and sentence review. I'd like feedback from a few people
> who already learn through reading. You can try the static sample without an
> account or API key. If you want to evaluate your own material, the full app needs
> a local installation. I'd like to hear where you get stuck and how it compares
> with what you currently use. There's no obligation to continue or endorse it.

Use existing contacts or a community's appropriate feedback thread after checking
its rules. This is a draft for the maintainer to send; no invitations have been
sent as part of repository preparation.

## Observe first use

Ask which language they study, what material they normally read/listen to, and
which tool they currently use. Let them attempt the following without a guided
tour, noting where they ask for help:

1. Open a passage and inspect an unfamiliar word.
2. Change its familiarity status and select a useful phrase.
3. Save a sentence and find it again.
4. With the full app, import their own permitted material, review a saved card,
   and return another day. The static sample resets and cannot evaluate retention
   or the backend's FSRS scheduler.
5. If they use audio, play/pause and seek via a transcript cue.

Time to first useful session means elapsed time from opening the instructions
until reading material and saving a useful word/sentence. Record whether setup
time was included and whether help was given. Ask for consent before any session
recording; ordinary written observations are sufficient.

## Private observation sheet

| Field | Observation |
| --- | --- |
| Anonymous learner ID / date | |
| Language / level / current tool | |
| Demo or full app, version, device/browser | |
| Starts unaided? Where was help needed? | |
| Time to useful session / setup included? | |
| Installation or language-specific failure | |
| Saved sentence found again? | |
| Returned another day without reminder? Date/evidence | |
| Concrete reason to choose/abandon this workflow | |
| Proposed fix and evidence it matters | |

Publish only an anonymized aggregate with consent. Do not count stars or compliments
as continued use. Do not add analytics to the static demo for this experiment.

## Decide what to build

After the sessions, rank concrete friction by affected learners, severity, and
workaround. Default to installation/reader/mobile fixes and evaluate the implemented
context-rich export with learners. Keep manual related-word links, broader parsing,
and transcription deferred until observations justify them. Record the evidence
and a success check in an issue
before starting a feature. Do not treat the plan's optional priorities as a queue
of features already validated by learners.
