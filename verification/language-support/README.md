# Language/activity verification

Use synthetic learners only. Read [CONTRIBUTING](../../CONTRIBUTING.md) for full checks and the [roadmap](../../docs/LANGUAGE_SUPPORT_PLAN.md) for priorities. Store generated reports/screenshots in ignored `test-results/` or CI artifacts, not Git.

## Verified checkpoint — 2026-11-05

Leading apostrophes, Finnish suffixes, dotted initialisms/abbreviations, and space-grouped decimals on tokenizer v4:
- **Server (`dotnet test -c Release`):** 1,732 passed, 0 failed, 7 PostgreSQL-only skipped locally (Docker daemon unavailable).
- **Client (`npm test -- --run`):** 1,746 passed across 114 test files; `npm run typecheck`, `npm run build`, and `npm run lint` (46 existing warnings) passed.
- **TDD evidence:** Updated the seven requested corpus cases and added mirrored span regressions before implementation. The focused Vitest run failed 15 tests, then passed after implementation. The initial xUnit run could not connect to its test host inside the sandbox; the focused run outside it passed 293 tests. Full results above include saved-ID/status/translation reuse and idempotent linking tests.
- **Gap summary:** `reference_gap_summary` in `multilingual_tokenizer_and_lemmatizer_test_suite_v4.json` is mechanically asserted by both `MultilingualGoldenTests` and `multilingualGolden.test.ts`: **89** source cases across **44** languages, **100** runtime cases, **24** cases with runtime span/key differences (down from 27 after closing `af-01`, `af-02`, and `fi-01`), and **86** cases with reference semantic lemmas. Tokenizer version stays **4**.

Afrikaans `'n` and Dutch `'s`/`'t` are language-gated and exclude closed quotes. Finnish lowercase colon suffixes, contiguous dotted initialisms, `en` `Dr.`, and `uk` `грн.` retain their punctuation. ASCII-space decimal groups require three-digit groups, comma digits, and currency/unit context. The original `uk-02` uses `2 000 грн.`; its integer gap remains. A new `uk-space-decimal` case covers `1 250,00` and supplementary-character UTF-16 offsets. English quotes, Romance elisions, bare-year exclusions, and tokenizer version 4 remain covered.

## Focused language checks

```powershell
dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj -c Release --filter "FullyQualifiedName~MultilingualGolden|FullyQualifiedName~Korean|FullyQualifiedName~LookupFallback|FullyQualifiedName~WordsBatchLookup|FullyQualifiedName~WiktionaryTranslationService|FullyQualifiedName~TokenizerV4MigrationAcceptance"
npm --prefix client/lingua-read-client test -- --run multilingualGolden korean lookupFallback indicRtlNormalization TextDisplay
```

- [Chinese (`chinese-cases.json`)](chinese-cases.json), [Japanese (`japanese-cases.json`)](japanese-cases.json), [Korean (`korean-cases.json`)](korean-cases.json): verify opt-out profiled segmentation (`jieba-v1`, `tinysegmenter-ja-v1`), EPUB ruby stripping, supplementary Han, and Korean Hangul/KRDICT candidate ranking while keeping legacy unprofiled texts unchanged.
- [Shared v4 corpus](../../tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json): xUnit `MultilingualGoldenTests` and Vitest `multilingualGolden.test.ts` assert processed surfaces, UTF-16 spans, lookup keys, normalization, validated lookup fallbacks, and Korean candidate/ranking parity. See the [reference gap audit](reference-gap-audit.md) for the 24 remaining span/key differences and 86 semantic markers.
- [KRDICT canonical headwords](../../resources/krdict_lemmas.txt): 43,445 entries verified by client/server checksum tests (`python scripts/generate-krdict-lemmas.py`).
- Core files: server `Services/Tokenization/{ChineseSegmenter,JapaneseSegmenter,ThaiSegmenter,KoreanLookup,Tokenizer,WordLinker}.cs`; client `utils/{chineseSegmenter,chineseDictionary,japaneseSegmenter,thaiSegmenter,koreanLookup,readerText}.ts` and `pages/TextDisplay.tsx`.

## Other regression suites

| Scope | Tests |
| --- | --- |
| Tokenizer v3→v4 relinking, learner data/credit/SRS snapshots, idempotency | `TokenizerV4MigrationAcceptanceTests` |
| Sentence/completion/manual passes, reset, goals, rollback | `ReadingCreditCompatibilityTests`, `ListeningCompatibilityTests` |
| PostgreSQL upgrade, downgrade, and concurrent writers | `PostgresStudyActivityTests`, PostgreSQL cases in `ChineseRolloutTests`/`ChineseIntegrationTests`/`JapaneseRolloutTests` |
| Upload file ownership and failed-copy/save cleanup | `AudiobookUploadStorageTests` |
| Playback timing and offline queue replay | `listeningCompatibility.test.js`, `audiobookListeningBoundaries.test.js`, `syncQueue.test.js` |

## Disposable PostgreSQL

Without `LINGUA_STUDY_TEST_POSTGRES`, PostgreSQL-specific concurrency/migration cases skip locally and run in CI. To run them locally against a disposable container:

```powershell
$studyPassword = [guid]::NewGuid().ToString('N')
docker run --rm --detach --name lingua-study-check --publish 127.0.0.1:55439:5432 --env "POSTGRES_PASSWORD=$studyPassword" --env POSTGRES_DB=studycheck --mount type=tmpfs,destination=/var/lib/postgresql postgres:18.6
try {
    for ($i = 0; $i -lt 30; $i++) {
        docker exec lingua-study-check pg_isready -h 127.0.0.1 -U postgres -d studycheck *> $null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    $env:LINGUA_STUDY_TEST_POSTGRES = "Host=127.0.0.1;Port=55439;Database=studycheck;Username=postgres;Password=$studyPassword"
    dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj --no-restore -c Release
} finally {
    Remove-Item Env:LINGUA_STUDY_TEST_POSTGRES -ErrorAction SilentlyContinue
    docker stop lingua-study-check
}
```
