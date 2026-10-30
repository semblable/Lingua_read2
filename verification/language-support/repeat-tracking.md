# Repeat tracking and stronger verification — 2026-10-30

Continuation of the [credit compatibility experiment](reading-credit-experiment.md).
Inspired by [LingQ's documented repeated reading/listening tracking](https://www.lingq.com/blog/introducing-lingq-5-0/),
this batch records explicit complete passes. It does not claim identical automatic
tracking or derive linguistic words from playback.

## Product contract

| Action | Per-lesson count | Earned activity |
| --- | --- | --- |
| Complete lesson | Read +1 for a newly accepted completion | Remaining legacy units on initial completion; full volume on a later reread |
| Record a read | Read +1, including a deliberate repeat inside the normal retry window | Same completion rules, without navigation away from the reader |
| Record a listen, 0 added minutes | Listened +1 | No additional seconds; the player may already have tracked them |
| Record a listen with external listening time | Listened +1 | Adds the entered seconds once |
| Player playback, including rewinds/repeats | No inferred complete-pass count | Existing actual listening-time tracking continues |
| Sentence navigation | No complete-pass count | Initial-pass credit, with existing index dedup |
| Finish Book / skip statistics | No pass count | No completion volume |
| Retried same action ID | No extra pass | No extra credit, even after ten seconds or a statistics reset |

Counts start with newly recorded events; aggregate history cannot reliably identify
past per-lesson repeats. No historical totals, vocabulary identities, meanings,
statuses, mined sentences or SRS data are reconstructed or recredited. Vocabulary,
coverage and reading volume retain their separate definitions. Counting version 1
uses the existing ASCII-whitespace activity unit; CJK/Thai and Unicode-space
limitations remain. Regional catalog entries are not split.

The panel distinguishes complete passes from time. Its listening dialog defaults
to zero extra minutes so logging a completed listen does not duplicate playback
time. All pass buttons require an online request. Existing sentence/listening
offline queues and payloads remain unchanged: older queue code discards unknown
operation types, so adding new pass types there would lose data.

## Identity, preservation and migration

- `LessonStudyEvents` is additive and stores stable user/action identity, source
  ID/title/language/revision, credited units and counting version. An action ID is
  unique per user. Reusing it for another source, kind or listen duration conflicts.
  Source revision hashes content, language ID and audio path; edits invalidate new
  submissions from a stale reader. Already accepted matching retries still succeed.
- Browser-session retry intents are partitioned by account, lesson, source revision
  and normal-completion/explicit-repeat/listen mode. They survive a lost response
  and reload within that session. Only successful acknowledgement clears an intent;
  a late acknowledgement cannot clear a newer one. This is not durable offline
  operation storage or an identity guarantee after browser-session loss.
- Normal completion retains the ten-second fallback for older clients. Only an
  explicit repeat bypasses it. Suppressed keyed requests retain an invisible dedup
  tombstone. Tombstones **are not earned-completion checkpoints**.
- Actual credited completions, including zero remaining words after full sentence
  credit, create a separate immutable checkpoint. Late unseen initial sentence
  payloads cannot credit that reading again. The checkpoint persists through an
  explicit statistics reset; visibility/count flags are separate from credit proof.
- Ordinary lesson deletion keeps study history and credit snapshots. Explicit
  language-content reset deletes the requested language's study records; account
  deletion cascades them. Explicit statistics reset hides pass records while keeping
  replay protection. The reset UI discloses that retention.
- Shared activity writers use a user-wide PostgreSQL transaction lock and serializable
  transactions, protecting totals across different lessons and old listening/manual
  paths. Language-content reset participates in the same lock. Existing manual
  activity's two saves now succeed or fail together instead of swallowing a failed
  totals update. No new package or tokenizer dependency is introduced.
- The real migration from `20260927181306_AddTextImagePath` preserves synthetic
  history, vocabulary/meanings, mined sentences and SRS rows. Empty-ledger downgrade
  and re-upgrade work. Schema downgrade refuses to drop a nonempty study ledger;
  preserve/export it before such a destructive downgrade. Retaining the additive
  table is the intended app rollback approach; an old-binary production rollback
  has not been rehearsed.

## Bounded verification

SQLite scenarios cover both completion routes, partial/full/excess sentence credit,
repeat/duplicate/reset orderings, edited/deleted lessons, explicit content reset,
and preservation of existing scalar learner data. PostgreSQL 18.6 checks use only
synthetic data in generated schemas in a disposable `studycheck` database:

- Four concurrent workers with five iterations each: distinct lessons, same-ID
  reread retries, existing listening logs and new explicit listens with retries.
  Shared totals equal activity sums and only one cumulative statistics row exists.
- Six rounds racing sentence credit, completion and reset. Each valid ordering
  leaves atomic activity/cumulative totals, with no duplicate initial volume.
- Full migration rehearsal, empty downgrade/re-upgrade, nonempty downgrade refusal,
  and scalar history preservation. Each run has its own schema and cleans it up.

The suite refuses a PostgreSQL connection whose database name is not `studycheck`.
No learner database, library, provider or paid service was accessed. CI supplies a
PostgreSQL service so these checks are not silently omitted there. Without the
explicit test connection, the three PostgreSQL facts report a skip.

```powershell
$studyPassword = [guid]::NewGuid().ToString('N')
docker run --rm --detach --name lingua-study-check-20261029 --publish 127.0.0.1:55439:5432 --env "POSTGRES_PASSWORD=$studyPassword" --env POSTGRES_DB=studycheck --mount type=tmpfs,destination=/var/lib/postgresql postgres:18.6
$env:LINGUA_STUDY_TEST_POSTGRES = "Host=127.0.0.1;Port=55439;Database=studycheck;Username=postgres;Password=$studyPassword"
dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj --no-restore --logger 'trx;LogFileName=study-final-suite.trx' --results-directory verification/language-support/test-results
docker stop lingua-study-check-20261029
```

Use only the named disposable container. Stop it after verification, including on
test failure. Generate a fresh password for each run; never copy a learner credential
into this configuration. CI similarly generates a random password, masks it in logs,
binds the database to runner loopback and stops it after verification.
Sanitized observations: [SQLite credit cases](study-credit-report.json),
[PostgreSQL cases](study-postgres-report.json). Final suite/build totals are in
[the status record](../../docs/LANGUAGE_SUPPORT_STATUS.md).

## Visual and browser checks

The real `LessonStudyPanel` was rendered with a synthetic HTTP fixture and inspected
in Chromium at desktop and 390×844 viewport sizes, in light and dark themes. Controls
wrap, mobile pass buttons have 44px minimum height, the dialog explains count-only
listening, and success/failure messages distinguish recorded activity. Automated
tests cover repeated clicks, safe retry IDs, late acknowledgements, stale counter
loads, invalid durations and old cached lessons without a revision.

Review found and fixed a Safari compatibility issue: using `URLSearchParams.size`
could drop standalone parameters on older runtimes. A regression simulates its
absence and preserves `skipStats`, action ID, revision and explicit-repeat flags.
ETags now include a response-version marker and source hash, so older cached DTOs
and changed source text receive a fresh revision instead of endless 304 responses.

Screenshots (synthetic component fixture, not production learner data):
[desktop light](visuals/study-desktop-light.png), [desktop dark](visuals/study-desktop-dark.png),
[mobile dark](visuals/study-mobile-dark.png), [listen dialog](visuals/study-mobile-listen-dialog.png).
These do not establish physical-device behavior, actual Safari or full reader-layout QA.

A synthetic lost-response browser check left the displayed count at three until
retry, then confirmed four, rather than five: [retry result](visuals/study-read-retry.png).
The fixture source is [study-preview.html](study-preview.html). To reproduce visuals,
copy it temporarily to `client/lingua-read-client/study-preview.html`, run the normal
Vite dev server and open that path. Remove the temporary client copy afterwards;
the committed fixture stays outside application build inputs.

## Remaining boundaries

- No automatic completed-listen inference from seeks, loops, speed changes, TTS,
  audiobook tracks or video. Actual listening time still counts; record a complete
  pass explicitly. New pass recording remains online-only.
- Sentence credit remains initial-pass-only for the text's lifetime, including after
  edits. Old sentence payloads lack revisions/cycle IDs. Explicit whole rereads earn
  volume; independent sentence rereading cycles still need a versioned contract.
- Historical completions without ledger records cannot safely be inferred from
  `IsFinished`; that flag can represent a completion without credit. No checkpoint
  backfill is attempted. Older clients without action IDs keep the legacy retry limit.
- Deleting browser-session storage loses pending operation identity. Reset versus
  previously unseen old offline payloads still has no universal reset/cycle identity.
- Synthetic concurrency/migration evidence is bounded. Production upgrade/restore,
  rollback with old binaries, physical devices, automatic media-pass detection and
  native-reviewed segmentation remain separate acceptance gates.

## Test-credential scanner follow-up

GitGuardian reported a `Username Password` incident against `18e8d73` on 2026-10-30.
That commit contained a literal, invented password used only by the disposable
PostgreSQL test setup. No application credential was copied into that setup. The
test configuration and commands now generate per-run values rather than publishing
a reusable literal. This change does not erase the previous commit or automatically
resolve the private GitGuardian incident; verify its occurrence before classifying
it as a test credential. The dashboard required login in the available browser.
