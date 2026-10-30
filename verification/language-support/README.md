# Language and activity verification

Run from the repository root with synthetic data only. [The short roadmap](../../docs/LANGUAGE_SUPPORT_PLAN.md) defines future work; code/tests define current behavior. Old Markdown journals were consolidated here; detailed chronology remains in Git.

## Scope and contracts

Vocabulary counts saved terms; coverage counts linked nonignored occurrences; reading volume retains legacy ASCII-whitespace units. The metrics intentionally differ. Unicode whitespace alone does not fix unspaced scripts or punctuation. Whole-text and sentence totals can also disagree; preserve already earned excess rather than clawing it back.

The additive study ledger deduplicates accepted actions and supplies earned-completion checkpoints. Suppressed retries are not checkpoints; old finished flags cannot be backfilled safely. Initial sentence credit is lifetime per text, not a new rereading cycle after edits. Explicit rereads earn volume; new sentence/offline cycles still need versioned identity.

Statistics reset keeps replay/checkpoint proof while hiding pass totals. Lesson deletion retains earned history; explicit language-content reset deletes its scoped records. Nonempty-ledger schema downgrade refuses history loss. Old-binary production rollback remains untested.

## Reading-credit checks

These use isolated SQLite in-memory learners and cover sentence/completion/repeat/reset orderings, goal baselines, interruptions, ownership and vocabulary/SRS preservation:

```powershell
dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj --no-restore --filter FullyQualifiedName~ReadingCreditCompatibilityTests --logger 'trx;LogFileName=reading-credit.trx' --results-directory verification/language-support/test-results
./verification/language-support/summarize-credit-results.ps1 -TrxPath verification/language-support/test-results/reading-credit.trx -OutputPath verification/language-support/reading-credit-after.json
```

Observations: [initial](reading-credit-before.json), [reset reproduction](reading-credit-review-before.json), [pre-ledger follow-up](reading-credit-after.json), [ledger cases](study-credit-report.json). Earlier reports retain then-known gaps; a passing diagnostic may reproduce a discrepancy rather than prove it fixed. Thai counting input uses CJK stops to isolate counting and is not a native acceptance fixture.

## PostgreSQL concurrency and upgrade

The three optional `PostgresStudyActivityTests` exercise concurrent activity writers, sentence/completion/reset races, prior-schema upgrade, empty downgrade/re-upgrade, nonempty downgrade refusal and preservation of synthetic learner records. Without the explicit connection they skip; CI supplies a disposable database.

Use only this named disposable container and the required `studycheck` database. Generate fresh credentials; never substitute learner credentials. Wait for PostgreSQL readiness before running tests.

```powershell
$studyPassword = [guid]::NewGuid().ToString('N')
docker run --rm --detach --name lingua-study-check-20261029 --publish 127.0.0.1:55439:5432 --env "POSTGRES_PASSWORD=$studyPassword" --env POSTGRES_DB=studycheck --mount type=tmpfs,destination=/var/lib/postgresql postgres:18.6
if ($LASTEXITCODE -ne 0) { throw 'Could not create the disposable container; check name/port conflicts.' }
try {
    $studyReady = $false
    for ($studyAttempt = 0; $studyAttempt -lt 30; $studyAttempt++) {
        docker exec lingua-study-check-20261029 pg_isready -h 127.0.0.1 -U postgres -d studycheck *> $null
        if ($LASTEXITCODE -eq 0) { $studyReady = $true; break }
        Start-Sleep -Seconds 1
    }
    if (-not $studyReady) { throw 'PostgreSQL did not become ready.' }
    $env:LINGUA_STUDY_TEST_POSTGRES = "Host=127.0.0.1;Port=55439;Database=studycheck;Username=postgres;Password=$studyPassword"
    dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj --no-restore --filter FullyQualifiedName~PostgresStudyActivityTests
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL verification failed.' }
} finally {
    Remove-Item Env:LINGUA_STUDY_TEST_POSTGRES -ErrorAction SilentlyContinue
    docker stop lingua-study-check-20261029
}
```

[Saved PostgreSQL results](study-postgres-report.json) are bounded evidence, not a production upgrade/restore rehearsal. Test hosts may need a permitted local connection in restricted environments.

## Segmentation probe

Six original Chinese/Japanese/Thai examples plus 10k/100k UTF-16-unit inputs. Provisional word expectations require native review. Standalone rejection bounds were a warm 100k pass under one second and total process working set under 128 MiB; these are not application SLAs.

```powershell
node verification/language-support/probe.mjs > verification/language-support/node-report.json
dotnet build verification/language-support/LanguageSupportProbe.csproj
dotnet verification/language-support/bin/Debug/net10.0/LanguageSupportProbe.dll verification/language-support/cases.json > verification/language-support/dotnet-windows-report.json
```

Linux comparison, using the locally built API image with ICU:

```powershell
$probeRoot = (Resolve-Path verification/language-support).Path
docker run --rm --network none --read-only --mount "type=bind,source=$probeRoot,target=/probe,readonly" --entrypoint dotnet linguaread-verify-20261028-api:latest /probe/bin/Debug/net10.0/LanguageSupportProbe.dll /probe/cases.json > verification/language-support/dotnet-linux-report.json
```

Saved [Node](node-report.json), [Windows](dotnet-windows-report.json) and [Linux](dotnet-linux-report.json) reports include runtime versions and timings. Source spans reconstruct the samples, but only 2/6 provisional word expectations match. No production tokenizer change is justified; do not ship the probe's native-library loader.

## Header visuals

Copy [study-preview.html](study-preview.html) temporarily into `client/lingua-read-client/`, run Vite and open that path. Remove the client copy afterwards. It renders real headers with synthetic HTTP data, not audio playback or an installed learner session.

[Desktop](visuals/study-header-desktop.jpg) and [390px mobile](visuals/study-header-mobile.jpg) show the current layout. Browser inspection also covered the 320px menu/dialog, 44px targets, text-only hiding and count refresh. Older panel screenshots are historical. Physical devices, real Safari, complete offline reconnect and native language quality remain separate checks.
