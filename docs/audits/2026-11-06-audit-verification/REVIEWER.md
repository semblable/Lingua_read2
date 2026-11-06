# Independent remediation review — 6 November 2026

Reviewed the uncommitted remediation against `7f2ba809`, including added source files and regression tests. The remediation report was treated as intent, not as proof. This review did not change production code or existing tests. Locations below describe the initial reviewed state; follow-up corrections may shift lines.

**Initial result: four actionable findings.** The first three affect data integrity or persistence; the fourth leaves a documented reauthentication fix incomplete. All four were reproduced with focused tests. Their correction and follow-up status will be recorded below rather than silently replacing this initial result.

## Findings

### R1 — [P1] Old queued word-linking work can undo an ordinary-text edit

Initial locations: `server/LinguaReadApi/Controllers/TextsController.cs:982`, `server/LinguaReadApi/Services/Tokenization/WordLinker.cs:87`, `server/LinguaReadApi/Services/Tokenization/WordLinker.cs:100`.

The new ordinary-text update path relinks the edited content atomically, but an import's existing `WordLinkingRequest` still carries the old content/language. `WordLinker.LinkAsync` takes a current-source transaction only for profiled/Korean content, and `LinkCoreAsync` replaces request arguments with the current stored content only for a segmentation profile. If an ordinary English linking request is processed after an edit has committed, it appends the obsolete words to the newly correct links. This does not require a narrowly timed thread race: enqueue old content, edit it, then process the queued request.

Reproduction: SQLite text `old word`; `UpdateText` changes it to `new token`; invoke the exact old worker call `WordLinker.LinkAsync(context, 1, "old word", 1, userId)`. Expected links `["new", "token"]`; actual links `["new", "old", "token", "word"]`. This disproves the report's claim that all ordinary edits remain synchronized once the new update action returns. The fix should make background linking validate/read the current revision and share the ordinary-text edit serialization boundary.

### R2 — [P1] Manual track navigation strands a pending restore and disables all future progress saves

Initial locations: `client/lingua-read-client/src/hooks/audio/useAudiobookProgress.ts:98`, `client/lingua-read-client/src/hooks/audio/useAudiobookProgress.ts:256`, `client/lingua-read-client/src/hooks/useAudiobookPlayer.ts:741`.

The pending seek carries a target index, but next/previous-track controls do not cancel it or mark manual position intent. When the user leaves the target track before its metadata loads, metadata for the newly selected track fails the index check and leaves the old pending seek in place. The new `saveProgress` guard then returns forever while that ref remains non-null. Starting playback after the new track's metadata has loaded does not run the seek application again, so pause and page exit cannot save the actual position.

Reproduction: restore track 2 at 330 seconds while its metadata is loading; click Next to track 3; emit track 3 metadata; play to 42 seconds; pause and unmount. The real player hook makes **zero** `updateAudiobookProgress` calls, instead of saving track 3 at 42 seconds. This is a persistence regression introduced by the unconditional pending-seek save guard. Manual transport changes need to explicitly supersede pending restoration, including cross-device deferred seeks.

The separate hypothesis that two tracks sharing the same source would strand restoration was tested and **did not reproduce**: the audio-event effect reattachment calls the metadata handler for the already-ready media. It is not a finding.

### R3 — [P2] Offline-created words never acquire their real identity after replay

Initial locations: `client/lingua-read-client/src/utils/api/words.ts:57`, `client/lingua-read-client/src/utils/offline/handlers.ts:29`, `client/lingua-read-client/src/pages/TextDisplay.tsx:1791`, `server/LinguaReadApi/Controllers/WordsController.cs:105`.

The synthetic row uses `wordId: 0`, and the replay handler discards the server's created/upserted word response. The reader consequently continues using POST for later saves even after successful sync. POST is not equivalent to PUT here: an existing word's status is only raised, and an empty translation is ignored. A word created offline at status 4 therefore cannot subsequently be demoted to status 2 or have its translation cleared through that reader row until it is reloaded. Its delete action also requires a real ID and cannot work from the stale zero-ID row.

Reproduction: use the actual SQLite `WordsController` to replay a status-4 create with translation `kot`, then issue the later reader POST with status 2 and blank translation. The status remains **4**, and the server branch explicitly retains the prior translation. The failing regression models the request sequence caused by the frontend's persistent zero ID. Reconcile the replay response with the queued/local entity identity, or route subsequent edits through a server operation that preserves PUT semantics; do not assume a create upsert is a full update.

### R4 — [P2] Background audiobook requests still hard-redirect on session expiry

Initial locations: `client/lingua-read-client/src/hooks/audio/useAudiobookProgress.ts:320`, `client/lingua-read-client/src/utils/api/audiobook.ts:81`, `client/lingua-read-client/src/utils/api/audiobook.ts:121`, `client/lingua-read-client/src/utils/api/client.ts:30`.

Only production queue replay handlers set `suppressAuthRedirect`. The paused audio progress poll uses the default API path every five seconds, and periodic audio progress/listening writers also use that default. A 401 from these background operations still navigates the entire tab to login, so it can replace the active reader while the new sync reauthentication dialog is trying to preserve it. An empty offline queue does not prevent this path.

Reproduction: run `useAudiobookProgress` with the real `getAudiobookProgress`/`fetchApi`; return successful initial responses, expire the session, then advance the paused poll by five seconds. The observed location write is `/login?redirect=%2Ftexts%2F1`. A regression asserting no hard navigation fails. Background audio requests should participate in the same non-destructive reauthentication mechanism as queue replay, while genuine foreground navigation can retain the normal login redirect.

## Validation evidence

- Two focused SQLite backend reproductions ran with the ordinary .NET test runner: both failed on the expected invariants (R1 stale links; R3 ignored demotion).
- Two actual-player-hook audio cases ran: the same-source restore passed; manual navigation followed by pause/unmount failed because no progress save occurred (R2).
- One real API-client/progress-hook case ran: it failed on the observed 401 hard redirect (R4).
- The existing full-suite results in `REVIEW.md` were not rerun by this reviewer; these focused failures explain gaps in that otherwise passing coverage.
- Temporary reproduction files were supplied to the primary agent so the failures can become permanent regression cases. They are review aids, not additional product code.

## Review limits and follow-up

Optional live PostgreSQL race tests, browser/media implementations outside happy-dom, and production deployment networking were not exercised. Existing unrelated documentation/timing/node_modules changes were excluded. The remaining npm advisory entries were not rescanned; that scan already required user authorization in the primary task.

**Initial follow-up status:** R1–R4 were sent to the primary agent with concrete reproduction results. The final independent result below supersedes the initial pending status.

## Final focused follow-up — 6 November 2026

**Result: no remaining actionable R1–R4 findings in the corrected worktree.** The original failures now pass. This is a focused review result, not a guarantee that the entire remediation or application is free of defects.

| Finding | Independent follow-up |
| --- | --- |
| R1 — stale ordinary-text linking | `WordLinker` now loads the current stored content and language for every text and uses the existing owner transaction/lock boundary for all relational texts. The stale-source regression passes. PostgreSQL's named word-key collision propagates to the transaction owner so the entire operation restarts; the synthetic collision cases verify a new transaction, rollback of a failed text edit, exclusion of unrelated constraints, and the three-attempt limit. The replacement SQLite test schedules real linker and reader operations independently and verifies the reader's status/translation plus final links/counts. |
| R2 — manual navigation strands restoration | Play, seek, and next/previous-track actions cancel the pending restoration. The original manual-navigation reproduction now saves track 3 at 42 seconds after pause/unmount. The shared-source case remains passing. Source review also checked the intent cancellation for the other transport paths. |
| R3 — offline word identity and edit semantics | Reader creates explicitly request the full-update behavior; omitted server flags retain legacy promotion behavior. Queue-key coalescing prevents an online edit from overtaking an already queued edit. Queue completion and focus/reconnect recovery resolve real IDs while retaining current optimistic status and explicit translation edits. The original demotion reproduction now passes, with backend cases for omitted, empty, and whitespace translation values. |
| R4 — background audio hard redirects | Background progress GETs, progress/listening/sentence writes, and linking-status polling suppress hard redirects and use shared in-place reauthentication. Unauthorized writes retain their original queued payloads. The original expired paused-poll test now passes. A real API-client/UI test also verifies that an initially empty queue retains three unauthorized writes, opens login, preserves the mounted reader note, and drains successfully after authentication without navigation. |

Two further R3 edge cases were identified during this follow-up and corrected before this result:

- A status-only queued natural-key create was turning an omitted translation into an explicit empty string at replay, which would clear an existing server translation under the new replacement semantics. Replay now preserves omission; the provisional row preserves missing-versus-empty, and reconciliation only fills a translation that was omitted. The frontend payload regression and backend omitted-versus-empty cases pass.
- Identity reconciliation tested disposal before an awaited IndexedDB count, allowing navigation during that wait to apply the previous text's IDs. Disposal is now checked after the await. The delayed-count/navigation regression passes.

### Independently executed checks

- Frontend: **13 passed across 5 files** — `audiobookRestoreIntent.test.js`, `backgroundAudioAuth.test.js`, `backgroundAudioReauthentication.test.tsx`, `offlineWordEdits.test.ts`, and `useSyncedWordIdentities.test.tsx`.
- Supporting frontend coverage: **51 passed across 5 files** — `enqueueIfOffline.test.js`, `syncQueue.test.js`, `OfflineIndicator.test.js`, `OfflineRetry.test.tsx`, and `useAudiobookPlayer.test.js`.
- Backend: **11 passed, none skipped** — `RemediationReviewRegressionTests` and `WordInsertRaceTests`, using the local .NET test runner and existing compiled test assembly (`--no-build`).
- Non-failing frontend output included an existing React `act(...)` warning in the volume-initialization test and a timer `TimeoutNaNWarning`. These were not silently treated as test failures or independent proof of a product defect.

No live PostgreSQL test database is configured. The named-23505 cases exercise transaction restart/rollback by injecting a PostgreSQL exception while using SQLite; they do **not** establish actual PostgreSQL MVCC race behavior. The real concurrency test exercised SQLite. Media/browser checks used the test DOM rather than a physical browser/device. The full frontend/backend suites, final build, and type generation are owned by the primary agent and are not claimed as independent full-suite reruns here. Deployment networking and dependency advisory state retain the limits recorded above.
