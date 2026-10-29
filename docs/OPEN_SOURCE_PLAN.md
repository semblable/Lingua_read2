# LinguaRead: open-source release plan

## Objective and audience

Make LinguaRead easy to understand, try, install, and evaluate for intermediate
learners reading their own books/articles, especially those who also use audio.
Positioning: **a self-hosted reading and listening workspace with integrated FSRS,
sentence mining, and your choice of AI provider**.

Use a few real learners to improve the core workflow and build credible engineering
case studies. Paid hosting can remain a later option. Choose a small set of
languages you can verify before advertising broader support.

## Current status

- [x] Static showcase reuses the production reader/player with prepared Spanish
  reading and licensed human-narrated English audio. No account, backend, provider
  calls, real scheduling, or personal-library access.
- [x] Published demo loads at [the project Pages URL](https://semblable.github.io/Lingua_read2/).
- [x] README, real screenshots, MIT license, third-party notices, contribution and
  security guidance, issue forms, backup/upgrade instructions, and demo CI checks.
- [x] App builds, 1,141 frontend tests, 1,151 backend tests, and four demo boundary
  tests passed. See the [verification record](RELEASE_VERIFICATION.md) for Docker,
  importer, earlier demo-build/publish results, caveats, and scope.
- [x] Fetched-ref history scan reviewed; the maintainer confirmed the historical
  exposed credential was revoked. Historical private-asset rights still need review.
- [x] Browser checks at phone-sized portrait/landscape viewports; see
  [mobile evidence](DEPLOYMENT_EVIDENCE.md#browser-checks-at-phone-sized-viewports).
- [ ] Physical-phone confirmation of touch selection, mobile audio/browser behavior,
  and the full installed workflow.
- [x] Isolated online app workflow and complete synthetic restore; context CSV and
  one-way Anki export implemented. See the [app plan](PRE_RELEASE_APP_PLAN.md) and
  [detailed evidence](RELEASE_VERIFICATION.md#full-app-reliability-and-export-pass-2026-10-29).
- [x] Independent correction review completed and app fixes deployed to staging;
  release-preparation changes remain a separate review. See the
  [current checkpoint](RELEASE_VERIFICATION.md#release-preparation-review-2026-10-29).
- [ ] Actual small-host measurements, asset-provenance review,
  private-reporting enablement, full-app video, initial learners, and release tag.

The maintainer reports acceptable personal operation on an Oracle Cloud free-tier
micro instance with swap enabled and good mobile performance for their workflow.
Those observations establish neither a measured minimum VM size nor concurrent-user
capacity or cross-device support. There are no external users, revenue, or established
audience yet. Keep experimental wording and unfinished Japanese/Chinese segmentation
visible.

## Workstreams and order

| Order | Outcome | Working document |
| --- | --- | --- |
| 1 | Improve first run, reader/mobile reliability, and recovery; then choose the next bounded app feature | [Pre-release app plan](PRE_RELEASE_APP_PLAN.md) |
| 2 | Complete review and recovery gates, then tag the reviewed promoted commit | [Release checklist](RELEASING.md), [backup and upgrade guide](BACKUP_AND_UPGRADE.md) |
| 3 | Record the existing small deployment and actual-device observations | [Deployment/mobile evidence](DEPLOYMENT_EVIDENCE.md) |
| 4 | Prepare a truthful walkthrough and engineering discussion | [Recording script](PRESENTATION.md), [architecture and case studies](ARCHITECTURE.md) |
| 5 | Observe approximately five learners and prioritize demonstrated friction | [Learner protocol](LEARNER_FEEDBACK.md) |

The app plan owns feature scope and acceptance criteria. This file owns release
strategy; detailed test results belong in the verification record. Avoid duplicating
those details here.

## Demo acceptance and publishing

- [x] Lookup, status changes, phrase selection, sentence mining, reset, and isolated
  temporary sample state.
- [x] Bundled human audio, cue seeking/highlighting, play/pause, and speed controls.
- [x] Project-path assets/direct hash links; unsupported/API-provider requests fail
  locally, with no production fallback.
- [x] Visible prepared-response, narration, license, and data-lifetime limitations.
- [x] Desktop and phone-sized browser checks; root-served build checked locally.
- [ ] Physical-phone check before claiming device verification.
- [ ] If moving to a root domain, verify the reviewed root build on that actual host.

Keep the demo disconnected from the maintainer's Oracle instance. The manual
`demo-pages.yml` workflow publishes the static showcase only. Follow the existing
`dev` → staging → promotion to `main` flow and review the returned deployment URL
before updating public links. See the [demo guide](../client/lingua-read-client/demo/README.md)
for commands and media attribution. No production application release or new
publication was performed during this preparation.

## Six-week experiment

At roughly four to six hours a week, use this as a planning allowance rather than
an implementation estimate:

| Period | Outcome |
| --- | --- |
| Weeks 1–2 | Review demo, finish browser/device checks, prepare screenshots/video |
| Weeks 3–4 | Resolve first-run/recovery friction, record deployment evidence, observe initial learners |
| Weeks 5–6 | Fix the largest observed problem, publish one case study, use the project in role discussions |

Continue feature work when use reveals a specific need. Five learners provide
qualitative evidence, not product-market validation. Stars and compliments matter
less than returning to read. Consider paid personal hosting only when people ask
for it at a concrete price with sustainable support/storage/API costs. Keep support
best-effort; do not promise response times or continuous availability.
