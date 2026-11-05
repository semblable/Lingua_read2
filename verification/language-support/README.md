# Language/activity verification

Use synthetic learners only. Read [CONTRIBUTING](../../CONTRIBUTING.md) for full checks and the [roadmap](../../docs/LANGUAGE_SUPPORT_PLAN.md) for priorities. Store generated reports/screenshots in ignored `test-results/` or CI artifacts, not Git.

## Verified checkpoint — 2026-11-05

Tokenizer v5 slice (Greek monotonic accents & contextual final sigma, Arabic hamza preservation, dual-key folded lookup with in-place canonical DB promotion, space-grouped integers, and bare numbers with pure-numeric status-0 filtering):
- **Server (`dotnet test -c Release`):** 1,733 passed, 0 failed, 7 PostgreSQL-only skipped locally (Docker daemon unavailable).
- **Client (`npm test -- --run`):** 1,766 passed across 114 test files; `npm run typecheck`, `npm run build`, and `npm run lint` (46 existing warnings) passed.
- **Gap summary:** `reference_gap_summary` in `multilingual_tokenizer_and_lemmatizer_test_suite_v4.json` is mechanically asserted by both `MultilingualGoldenTests` and `multilingualGolden.test.ts`: **89** source cases across **44** languages, **100** runtime cases, **15** cases with runtime span/key differences (down from 18 after closing `zh-01`, `nl-01`, and `en-02`), and **86** cases with reference semantic lemmas. Tokenizer version is **5**.

Greek canonical keys preserve monotonic accents and contextual final sigma (`ς`/`σ`), and Arabic/Persian canonical keys preserve hamza (`أ`, `إ`, `آ`, `ٱ`), while `FoldLookupKey`/`foldLookupTerm` provides secondary diacritic/sigma/hamza folding and in-place DB promotion on relink. Space-grouped integers (`2 000 грн.`) and bare integers (`2026`) are emitted as word tokens without creating `Status = 0` vocabulary clutter (`IsPureNumericToken` / `isPureNumericToken`). Sentence highlighting, Cloze blanking, and sentence mining (`splitSentenceAroundTerm`, `sentenceContainsTerm`, `pickSentenceForTerm`) match normalized, folded, and proclitic/elision tokens while preserving raw UTF-16 display slices.

## Focused language checks

```powershell
dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj -c Release --filter "FullyQualifiedName~MultilingualGolden|FullyQualifiedName~Korean|FullyQualifiedName~LookupFallback|FullyQualifiedName~WordsBatchLookup|FullyQualifiedName~WiktionaryTranslationService|FullyQualifiedName~TokenizerV4MigrationAcceptance|FullyQualifiedName~TokenizerV5MigrationAcceptance"
npm --prefix client/lingua-read-client test -- --run multilingualGolden korean lookupFallback indicRtlNormalization TextDisplay
```

- [Chinese (`chinese-cases.json`)](chinese-cases.json), [Japanese (`japanese-cases.json`)](japanese-cases.json), [Korean (`korean-cases.json`)](korean-cases.json): verify opt-out profiled segmentation (`jieba-v1`, `tinysegmenter-ja-v1`), EPUB ruby stripping, supplementary Han, and Korean Hangul/KRDICT candidate ranking while keeping legacy unprofiled texts unchanged.
- [Shared golden corpus](../../tests/golden/multilingual_tokenizer_and_lemmatizer_test_suite_v4.json): xUnit `MultilingualGoldenTests` and Vitest `multilingualGolden.test.ts` assert processed surfaces, UTF-16 spans, lookup keys, normalization, validated lookup fallbacks, and Korean candidate/ranking parity. See the [reference gap audit](reference-gap-audit.md) for the 15 remaining span/key differences and 86 semantic markers.
- [KRDICT canonical headwords](../../resources/krdict_lemmas.txt): 43,445 entries verified by client/server checksum tests (`python scripts/generate-krdict-lemmas.py`).
- Core files: server `Services/Tokenization/{ChineseSegmenter,JapaneseSegmenter,ThaiSegmenter,KoreanLookup,Tokenizer,WordLinker}.cs`; client `utils/{chineseSegmenter,chineseDictionary,japaneseSegmenter,thaiSegmenter,koreanLookup,readerText}.ts` and `pages/TextDisplay.tsx`.

## Other regression suites

| Scope | Tests |
| --- | --- |
| Tokenizer v3→v4→v5 relinking, canonical promotion, learner data/credit/SRS snapshots, idempotency | `TokenizerV4MigrationAcceptanceTests`, `TokenizerV5MigrationAcceptanceTests` |
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
