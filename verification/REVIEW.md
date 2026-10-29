# Independent correction review — 2026-10-29

Reviewed local commits `829b9957` (first-run/session reliability) and `0e1681ea`
(context/Anki export), against base `f01e2745`. Existing uncommitted release
preparation was preserved and excluded from this correction.

## Confirmed defect and correction

A mined phrase whose saved source-title snapshot was empty or whitespace hid an
available, owned live source title. This affected both context CSV and the
contexts field in Anki export. Null snapshots already fell back correctly.

The export query now treats null, empty, and whitespace snapshots as missing.
It retains nonblank saved titles and uses only the existing ownership-scoped
live-source join. No export columns, import behavior, session policy, or source
ownership rules changed.

Six relational SQLite regression cases cover both formats and all three missing
snapshot representations. Before the correction, four failed and two passed;
after the correction all six pass. Existing tests for preserved saved titles,
deleted sources, foreign sources, context-free terms, and multiple contexts also
pass.

## Fresh verification

- Baseline focused backend tests passed: 34 across auth sessions, context/Anki
  export, webhook destination validation, and the actual named HTTP client guard.
- After the correction, `dotnet test Lingua_Read.sln -c Release` passed all
  **1,151 tests**, with no failures or skips.
- Rebuilt and started only the isolated synthetic Docker project
  `linguaread-verify-20261028`. Against PostgreSQL 18.6/Npgsql, added three original
  synthetic mined contexts with null, empty, and whitespace title snapshots.
  Context CSV returned the owned live title (`Part 1`) for all three; the Anki
  export grouped all three and included that title for each. This verifies the
  query's whitespace check is translated and works with the production provider.
- Frontend TypeScript checking passed. ESLint passed with **45 existing warnings
  and zero errors**.
- `npm test -- --run --maxWorkers=2 --pool=threads --testTimeout=10000
  --hookTimeout=10000` passed all **1,141 tests across 89 files** (91.80 seconds).
  The runner emitted `TimeoutNaNWarning` messages but exited successfully.
- The synthetic Docker source project was stopped after testing; a subsequent
  running-container query was empty. Its fixtures and volumes were retained.
  The restore project and existing deployments were not started or changed.

## Review scope and limits

Inspected persisted security-stamp validation, password changes/logout, setup
token handling and atomic initial-password claim, webhook URL validation and
named-client redirect/address guards, optional-provider feedback, export query
ownership/filtering, CSV/HTML serialization and stable Anki identity, responsive
export controls, and synthetic smoke/export/restore scripts. No other actionable
defect was confirmed within this scope.

This review did not freshly perform physical-phone testing, browser network
disconnection/replay, Anki desktop/mobile UI interaction, full restore replay,
high-volume performance testing, or concurrent setup stress testing. The live
Anki check above validates this correction's export contents, not an importer.
The main verification record distinguishes earlier completed checks from
outstanding checks; its results are not presented here as fresh review results.
No personal production data,
external reporting, deployment, publication, push, or release tag was used.
