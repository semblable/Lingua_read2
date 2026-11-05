# Release evidence

Historical checkpoints, not a claim that the current release candidate passed. Re-run relevant checks at the intended release commit; use [the release checklist](RELEASING.md) for open gates.

## Full-app reliability and export pass (2026-10-29)

Release preparation in [PR #130](https://github.com/semblable/Lingua_read2/pull/130) used isolated synthetic Docker installations, PostgreSQL 18.6, .NET 10 and the production application builds.

| Evidence | Verified scope |
| --- | --- |
| [Smoke workflow](../verification/README.md) | Protected first setup, login/revocation, TXT import, vocabulary/phrases, mining, real FSRS grading, duplicate review replay and missing-provider feedback. |
| [Restore drill](BACKUP_AND_UPGRADE.md) | Database plus separately preserved media/key volumes restored into a second isolated installation; vocabulary/review totals, audio checksum and decryptable synthetic setting matched. |
| [Context/Anki export](VOCABULARY_EXPORT.md) | Unicode, multiple/orphaned contexts, ownership, serialization and update identity; official Anki 26.9.3 backend importer passed in a disposable collection. A separate correction covered null/blank source-title fallback on SQLite and PostgreSQL. |
| Browser | Desktop Chromium at portrait/landscape widths exercised reading, saving, review, audio controls and cached audio. Fixtures used original text and silent generated audio. |
| Automated | Release-preparation suites passed 1,151 backend and 1,141 client tests, plus demo/build/notice guards. These are dated results, not current suite totals. |

No personal library, production database or real provider credentials were used. Full commands are in [verification](../verification/README.md); detailed chronology is recoverable from Git history.

## Language and activity work (2026-10-30)

[The ledger CI checkpoint](https://github.com/semblable/Lingua_read2/actions/runs/41017440350) passed 1,212 backend checks, including three PostgreSQL concurrency/migration facts, plus client checks, builds and staging smoke tests. Synthetic reports, current reproduction commands and header screenshots are in [language verification](../verification/language-support/README.md).

This supports bounded data-preservation/replay behavior, not linguistic readiness for all 44 languages. See the [short roadmap](LANGUAGE_SUPPORT_PLAN.md) for remaining work and counting constraints.

## Fractional lesson totals (2026-11-05)

[Behavior, accounting rules, review findings, and local verification](FRACTIONAL_STUDY_TOTALS.md)
cover direct input, 0.1× steps, sentence-credit reconciliation, retry/reset
protection, and migration compatibility. Feature commit `82077565` received an
independent review; both accounting findings were fixed and re-reviewed.

Local checks passed 1,810 client tests and 1,767 server tests, with nine
PostgreSQL-specific tests skipped, plus type checking, lint, builds and six demo
tests. These working-tree results included unrelated edits excluded from the
commit. The [commit-specific staging run](https://github.com/semblable/Lingua_read2/actions/runs/42029272598)
ran PostgreSQL checks: 1,774 server tests passed and one historical downgrade
assertion failed after projecting removed columns. A follow-up corrects that
assertion to inspect the surviving event ID. Deployment/promotion evidence needs
a successful subsequent run; browser access prevented visual verification.

## Still open

Physical-phone/touch and iOS/Android audio lifecycle; real browser disconnect/reconnect; independent cold install; Anki desktop/mobile import UI; live-provider success; large-library performance; and production upgrade/old-binary rollback.

Repository security/history and asset provenance have their own gates in [RELEASING.md](RELEASING.md). Personal small-host use is not a measured capacity claim: [deployment evidence](DEPLOYMENT_EVIDENCE.md).
