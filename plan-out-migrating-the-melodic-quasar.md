# TypeScript Migration Plan

Migrate [client/lingua-read-client](client/lingua-read-client/) from CRA + plain JavaScript (106 files, ~26.5k LOC) to Vite + TypeScript, with API types generated from the .NET backend's Swashbuckle OpenAPI spec. The backend at [server/LinguaReadApi](server/LinguaReadApi/) stays as-is.

**Decisions (locked):** Vite build · Vitest tests · Gradual conversion (`allowJs: true`, leaf-up) · `openapi-typescript` for API types.

## Status at a glance

| Phase | Scope | Status |
|---|---|---|
| **A** | Tooling foundation (CRA → Vite, jest → Vitest, tsconfig + ESLint) | ✅ Done |
| **B** | Generate API types from Swagger via `openapi-typescript` | ✅ Done |
| **C1–C9** | Convert all 106 .js → .ts/.tsx (leaf-up, in 9 sub-PRs) | ✅ Done |
| **D1a** | Resolve 9 TODO(phase-d) markers + tighten explicit `any` casts | ✅ Done |
| **D1b** | Flip `noImplicitAny: true` + sweep 527 fallout sites | ✅ Done |
| **D2a** | useState/useRef typing sweep + non-giant fallout (203 errors) | ✅ Done |
| **D2b** | Top-5 giants + flip `strictNullChecks: true` (494 errors) | ✅ Done |
| **D3** | Flip `strict: true` + `noImplicitThis` + `noFallthroughCasesInSwitch` (19 errors) | ✅ Done |
| **E1** | Extract hooks from TextDisplay.tsx (2,735 → 2,299 LOC) | ✅ Done |
| **E2** | Split AudiobookPlayer.tsx (1,239 → 178 LOC) into audio modules + hook | ✅ Done |
| **E3** | Tidy WordInfoPanel.tsx 25-prop interface (optional) | ⏳ Pending |

**Current tsconfig state:** `strict: true`, `noImplicitThis: true`, `noFallthroughCasesInSwitch: true`, `allowJs: true`, `checkJs: false`. All 108 source files under `src/` are `.ts`/`.tsx`; the 22 files in `src/__tests__/` are intentionally `.js`.

**Verification baseline (post-E2):** `npx tsc --noEmit` clean under full `strict: true` · `npx vitest run` = 336 pass + 0 skip · `npx vite build` ≈ 8s · `index.js` = 277.76 KB.

---

## ✅ Phase A — Tooling foundation

Replaced CRA with Vite + Vitest. tsconfig with `allowJs: true`, ESLint flat config, `@types/*` + Vitest deps installed. Build still emits to `build/static/...` (Dockerfile + nginx caching rule unchanged).

**Key deviations:** test env `happy-dom` (not jsdom — jsdom + react-router-dom v6 hit an `AbortSignal` error); `esbuild.loader: 'tsx'` so `.js` files containing JSX still parse; `vi.useFakeTimers({ shouldAdvanceTime: true })` so `waitFor` polling keeps working.

**Known carried-over issue:** 1 test skipped — `AudiobookPlayer.test.js > ignores aborted media error events during source replacement`. happy-dom fires `loadedmetadata` synchronously on `audio.src=` assignment, clearing `sourceSwapRef` before the test's manual `fireEvent.error`. Revisit during E2 when the source-swap path is extracted.

**Files:** [vite.config.ts](client/lingua-read-client/vite.config.ts), [tsconfig.json](client/lingua-read-client/tsconfig.json), [eslint.config.mjs](client/lingua-read-client/eslint.config.mjs), [index.html](client/lingua-read-client/index.html), [package.json](client/lingua-read-client/package.json).

---

## ✅ Phase B — Generate API types from Swagger

`openapi-typescript` generates [src/utils/api-types.d.ts](client/lingua-read-client/src/utils/api-types.d.ts) (6,022 lines) from the backend's `/swagger/v1/swagger.json`. Thin typed wrapper [src/utils/fetchApi.ts](client/lingua-read-client/src/utils/fetchApi.ts) infers body/query/path/response per endpoint via `ResponseOf<P, M>` / `RequestBodyOf<P, M>` / `PathParamsOf<P, M>` conditional types.

**Offline generation supported:** [.config/dotnet-tools.json](.config/dotnet-tools.json) pins `Swashbuckle.AspNetCore.Cli`; spec extracts via `ASPNETCORE_ENVIRONMENT=Testing dotnet swagger tofile ...`. The `Testing` env skips `dbContext.Database.Migrate()` (guarded at [server/LinguaReadApi/Program.cs:277](server/LinguaReadApi/Program.cs)). Generator script: [scripts/generate-api-types.mjs](client/lingua-read-client/scripts/generate-api-types.mjs) (`npm run api:types`).

**Regenerating:**
```bash
dotnet tool restore   # one-time
dotnet build server/LinguaReadApi -c Debug
ASPNETCORE_ENVIRONMENT=Testing dotnet swagger tofile --output /tmp/swagger.json \
  server/LinguaReadApi/bin/Debug/net8.0/LinguaReadApi.dll v1
SWAGGER_FILE=/tmp/swagger.json npm --prefix client/lingua-read-client run api:types
```

---

## ✅ Phase C — Incremental file conversion (C1–C9)

All 106 `.js` files converted to `.ts`/`.tsx`. The 19 test files under `src/__tests__/` are intentionally `.js` (Vitest doesn't need them typed).

| Sub-PR | Scope | LOC moved |
|---|---|---|
| **C1** | 9 leaf utilities in `src/utils/` (`helpers`, `storage`, `bookmarks`, `srtParser`, `parseSentenceExplanation`, `translationTags`, `browserTts`, `readerText`, `statistics`) with rich exported types | — |
| **C2** | **Split + type api.js** (1,447 LOC) into 16 files under `src/utils/api/` (`auth`, `client`, `languages`, `texts`, `books`, `audiobook`, `hardcover`, `stats`, `goals`, `words`, `srs`, `translation`, `folders`, `settings`, `admin`, `index` barrel). 36 consumer imports unchanged. | 1,447 |
| **C3** | Store (5 Zustand stores typed), hooks (`useDragSelect`, `useStatisticsData`), `SettingsContext` | — |
| **C4** | 39 non-reader components (goals, settings, library, dashboard, statistics, modals, popovers) | — |
| **C5** | 10 reader subcomponents in `src/components/reader/` | — |
| **C6** | AudiobookPlayer.js → .tsx (1,239 LOC) in place — state machine unchanged | 1,239 |
| **C7** | 18 pages (excluding TextDisplay) | — |
| **C8** | TextDisplay.js → .tsx (2,705 LOC) in place — orchestration unchanged | 2,705 |
| **C9** | Root entries (`App.tsx`, `index.tsx`, `reportWebVitals.ts`, `setupTests.ts`), script tag flip | — |

**Key pattern carried forward:** the reader subcomponents from C5 used `type Props = Record<string, any>` placeholders with `TODO(phase-d)` markers because TextDisplay (C8) was still untyped. D1a resolved them.

**Pragmatic `any` cases left across C-phases (now mostly resolved by D1b):** `<Button as={Link}>` casts for the known react-bootstrap × react-router-dom typing clash (7 sites — still present, documented); `React.ComponentType<any>` for AudiobookPlayer in [LessonHeader.tsx](client/lingua-read-client/src/components/reader/LessonHeader.tsx) and [TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) (2 sites — will go away in E2).

---

## ✅ Phase D1a — Resolve TODOs and tighten explicit `any`

Resolved 9 `TODO(phase-d)` markers (8 reader subcomponents + LanguageForm) by replacing `Record<string, any>` Props with explicit interfaces using existing C-phase exports (`Settings`, `LanguageConfig`, `NavigateFunction`, `LanguageDictionary` via `Partial<>` for in-form rows, etc.). Tightened explicit `any` casts in `GoalRow` (→ `Goal`), `WordInfoPanel` (→ typed `DisplayedWord` + augmented `LanguageConfig`), `GoalModal.editing`, `LanguageForm.language`. Removed stale `@ts-ignore` in [fetchApi.ts](client/lingua-read-client/src/utils/fetchApi.ts). Added missing `@types/react-window` devDep.

**Note on store.ts:** The 7 `[key: string]: any` index signatures on `StoredText` / `CurrentWord` / `LibraryFolder` / `LibraryBook` / `LibraryText` / `ModalWord` were planned for tightening but deferred — they're boundary escape hatches relied on by ~36 call sites. Phase E or a post-strict cleanup will revisit.

---

## ✅ Phase D1b — Flip `noImplicitAny: true`

Flag flipped in [tsconfig.json](client/lingua-read-client/tsconfig.json). **527 errors across 61 files resolved** in 7 logical batches: typed maps + critical fixes → small components → settings + statistics → StandardTextView body → mid-size pages → the four giants (TextDisplay 79, SrsReview 34, AudiobookPlayer 27, SrsStoryReview 24) → store.ts cascade (deferred per above).

**Real bug fixed:** [AudiobookPlayer.tsx](client/lingua-read-client/src/components/AudiobookPlayer.tsx) cross-device sync (lines ~952-961) read `currentAudiobookTrackId` / `currentPosition` off the audiobook-vs-lesson progress union without narrowing. Added `'currentAudiobookTrackId' in remoteProgress` / `'currentPosition' in remoteProgress` type guards.

**Other notable improvements:**
- Tightened `uploadBook` return: `Promise<unknown>` → `Promise<UploadBookResult>` in [api/books.ts](client/lingua-read-client/src/utils/api/books.ts).
- Six file-local typed `Record<Key, Value>` maps (CEFR colors, folder colors, word status, trend icons).
- Statistics components switched from API-DTO types to hook-output types (`LanguageStatsRow` instead of `LanguageStatistics`; `DisplayStats` instead of `StatisticsSummary` — page-assembled wider shape).
- Shared `SettingsChangeHandler` type exported from `AppearanceSettings.tsx`, reused across all settings panes.

**Remaining `any` budget (~80-100 sites):** all annotated with `eslint-disable` + reason. Concentrations: AudiobookPlayer heterogeneous tracks/events (~15), TextDisplay heterogeneous state setters (~25, Phase E1 territory), LinkAs casts (7), store boundary index sigs (7), per-file opaque props (~20-30).

---

## ✅ Phase D2 — `strictNullChecks: true`

**Initial inventory:** 697 errors across 61 files, 71% concentrated in 5 giants (TextDisplay 215, SrsReview 101, BookDetail 97, SrsStoryReview 50, BookList 31). Dominant root cause was `useState([])` / `useState(null)` inferring as `never[]` / `null` and cascading into TS2339 (449) and TS2345 (142). Strategy: split into D2a (non-giants) + D2b (giants) per [plan-out-bubbly-riddle.md](C:\Users\kamil\.claude\plans\f-dev-envitonment-lingua-read2-plan-out-bubbly-riddle.md).

**Persistent flag flipped** in [tsconfig.json](client/lingua-read-client/tsconfig.json) at the end of D2b.

### ✅ D2a — non-giant sweep

Dropped 697 → 494 errors (203 fixed) across ~25 small/medium files. Mechanical typing of `useState(null)` / `useState([])` with explicit type parameters using existing API DTOs (`Language`, `Book`, `Word`, `Goal`, `HardcoverCandidate`, `Language`, `SrsStats`, `RecentText`, etc.) plus boundary guards for `localStorage.getItem`, `Map.get()`, optional fields. AudiobookPlayer's 29-error ref+useState cluster handled last in D2a; `playlist` typed as a permissive `PlaylistTrack` union spanning the AudiobookTrackDto and the synthetic lesson-audio entry. `setBook((prev: any) => ...)` patterns guarded against silent null-spread.

### ✅ D2b — top-5 giants

Dropped 494 → 0 errors across the giants in ascending difficulty: BookList(31) → SrsStoryReview(50) → BookDetail(97) → SrsReview(101) → TextDisplay(215). Local augmentation types where API DTO didn't carry runtime fields (`BookWithStatus = Book & { isFinished?: boolean }`, `BookListItem = BooksList[number] & { parts?: ... }`, `ReaderText = TextDto & Record<string, any>`). `WordInfoPanel`'s `languageConfig` prop type widened to accept null per its own runtime guards. `StandardTextView`'s `ProcessedSentenceResult.sentenceElements` widened to `React.ReactNode[] | null`. `Promise.allSettled`-driven union results cast at each `results[i].value` use site.

### Risk areas — none surfaced

The two D2 risk patterns flagged in the bubbly-riddle plan didn't manifest as real bugs:
- D1b's `remoteProgress` union-narrowing pattern was already fixed in D1b; no new cases found.
- `setBook((prev: any) => ({ ...prev, isFinished: true }))` at [pages/BookDetail.tsx:109](client/lingua-read-client/src/pages/BookDetail.tsx:109) was guarded as planned (`prev => prev ? { ...prev, isFinished: true } : prev`) to avoid silent null-spread when `book` is loading.

### Outcome

- `npx tsc --noEmit` → 0 errors with persistent `strictNullChecks: true`.
- `npx vitest run` → 238 pass + 1 skip (matches baseline).
- `npx vite build` → `index.js` = 277.72 KB (within ±5% of D1b baseline 277 KB), build time 5.56s.
- `eslint-disable no-explicit-any` count: 123 (was 118 — +5 net, mostly local cast escape hatches in giants; opportunistic reduction goal met as 5 reductions in non-giants offset by 10 new in giants).
- Zero `// @ts-ignore` / `// @ts-expect-error` in `src/`.
- Non-null `!` assertion count: ≈18 across both PRs (cap was 20).

---

## ✅ Phase D3 — Full `strict: true` + remaining strict flags

### tsconfig change (applied)

```jsonc
{
  "compilerOptions": {
    "strict": true,                       // enables: strictFunctionTypes, strictBindCallApply,
                                          //          strictPropertyInitialization, alwaysStrict,
                                          //          useUnknownInCatchVariables
    "noImplicitThis": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

Kept `allowJs: true` / `checkJs: false` — the 19 test files in `src/__tests__/` stay `.js`.

### Fallout — much smaller than predicted: 19 errors total

The pre-D3 prediction held: the D1b-era `catch (err: unknown) { (err as Error)?.message }` pattern had already converted most catch sites, so `useUnknownInCatchVariables` lit up only the 13 stragglers that still used a bare `catch (err)`. Beyond that, only TextDisplay had `strictFunctionTypes` and a couple of `strictNullChecks` straggler fallouts. **Zero** `noImplicitThis` errors, **zero** `noFallthroughCasesInSwitch` errors, **zero** `strictPropertyInitialization` errors (function components — no class fields anywhere).

| Rule | Sites | Files |
|---|---|---|
| `useUnknownInCatchVariables` (TS18046) | 13 | BookCreate, Login, Setup, SrsReview (×2), TextCreate (×2), TextList (×2), TextDisplay (×3) |
| `strictFunctionTypes` (TS2322 — setter/callback narrowing) | 3 | TextDisplay → SentenceModeView/StandardTextView prop signatures |
| `strictNullChecks` straggler (TS2345 — `Map.keys().next().value` is `T \| undefined`) | 2 | TextDisplay |
| **Total** | **18** | **8 files** |

### Resolutions

- **Catch handlers (13 sites):** mechanical conversion to `catch (err: unknown) { (err as Error)?.message }`. One special case in [BookCreate.tsx:144](client/lingua-read-client/src/pages/BookCreate.tsx:144) needed an inline `{ response?: { data?: { message?: string } }; message?: string }` cast since the handler reads `err.response.data.message` (axios-shaped error envelope).
- **Setter prop narrowing (2 sites at [TextDisplay.tsx:2537,2583](client/lingua-read-client/src/pages/TextDisplay.tsx:2537)):** `setSentenceTtsEnabled` is the `useCallback`-wrapped `(nextValue: boolean) => void` — narrower than `React.Dispatch<SetStateAction<boolean>>`. Both children (`SentenceModeView`, `StandardTextView`) only ever call it with a plain boolean (`!sentenceTtsEnabled`), so I narrowed the prop type in both subcomponents from `(value: boolean | ((prev: boolean) => boolean)) => void` to `(value: boolean) => void` to match actual usage. The wider type was inherited from a `useState` shape that no longer applies.
- **`renderProcessedContentAsSentences` signature ([TextDisplay.tsx:2319](client/lingua-read-client/src/pages/TextDisplay.tsx:2319)):** the source signature was `(processedElements: any[], ...) => { sentenceElements: null \| any[], ... }` but the child's prop declared `(processed: ReactNode, ...) => ProcessedSentenceResult` (where `ProcessedSentenceResult.sentenceElements` is `React.ReactNode[] \| null`). Under `strictFunctionTypes` parameter checking became contravariant, so `any[]` is no longer a supertype of `ReactNode`. Tightened the source to take `React.ReactNode` (with an `Array.isArray` guard) and return `{ sentenceElements: React.ReactNode[] \| null; nextSentenceIndex: number }` — exact match with the child's declared shape. Side benefit: removed 2 `eslint-disable no-explicit-any` annotations.
- **`Map.keys().next().value` (2 sites at [TextDisplay.tsx:606,665](client/lingua-read-client/src/pages/TextDisplay.tsx:606)):** the iterator value is now `string | undefined`. Even though `cache.size > 100` guarantees a key exists, the typing doesn't know that — added explicit `if (oldestKey !== undefined) cache.delete(oldestKey)` guards.

### Outcome

- `npx tsc --noEmit` → 0 errors with full `strict: true` + `noImplicitThis` + `noFallthroughCasesInSwitch`.
- `npx vitest run` → 238 pass + 1 skip (unchanged).
- `npx vite build` → `index.js` = 277.76 KB (vs D2b 277.72 KB, +0.04 KB ≈ 0.01%), build time 4.98s.
- `eslint-disable no-explicit-any` count: **121** (was 123 — net **-2** from properly typing `renderProcessedContentAsSentences`).
- Zero `// @ts-ignore` / `// @ts-expect-error` in `src/`.

### Optional flags — left off (per pre-D3 plan)

- `noUnusedLocals: true` / `noUnusedParameters: true` — covered by ESLint (`@typescript-eslint/no-unused-vars`); enabling in tsc would create duplicate-report churn without catching anything ESLint misses. Skip.

---

## ✅ Phase E1 — Extract hooks from TextDisplay.tsx

Per [plan-out-synthetic-taco.md](C:\Users\kamil\.claude\plans\f-dev-envitonment-lingua-read2-plan-out-synthetic-taco.md) — extracted 5 hooks in sub-commits E1a–E1f. TextDisplay.tsx dropped from 2,787 → 2,299 LOC (~17.5% reduction).

| Sub-commit | Hook | LOC extracted |
|---|---|---|
| **E1a** | `useReaderBookmarks` — bookmarkedIndices state + load effect + 4 callbacks | ~30 |
| **E1b** | `useReaderKeyboard` — 1-5 status keys, pure side-effect hook with bound callback | ~70 |
| **E1c** | `useWordTranslation` — translation/cache/abort state + triggerAutoTranslation + appendAutoTranslation | ~140 |
| **E1d** | `useReaderAudioSync` — audio refs + sync state + handleAudioTimeUpdate + 6 playback callbacks, defines `ReaderSegment` + `SegmentPlaybackRequest` types | ~190 |
| **E1e** | `useReaderState` — data shell (text/book/words/languageConfig/etc.) + main fetch effect + audioSrc/srtLines ownership | ~310 |
| **E1f** | Reader subcomponent any-tightening + drop duplicate ReaderText/ReaderBook types in TextDisplay | — |

Each hook landed with `Use<Name>Args` / `Use<Name>Result` named types matching the existing `useDragSelect`/`useStatisticsData` style. 40 new smoke tests added (`renderHook` + mocked deps + return-shape assertions + behavioral coverage for each hook).

**Deviations from target:**
- **LOC**: 2,299 (target was <800). Render-time helpers (`processTextContent`, `renderProcessedContentAsSentences`, `getFontStyling`, `getFontFamilyForList`), the JSX (~350 LOC), and selection/segment-mode callbacks (heavily entangled with display logic) stay in the page. Realistic floor with the current JSX shape is ~1,500-2,000 LOC; further reduction needs JSX restructuring beyond E1's scope.
- **`any` in TextDisplay**: 21 (target was single digits). Remaining concentrate in: `DisplayedWord` type (boundary escape hatch — same pattern as store.ts D1a deferral), keyboard handler's `setWords/setDisplayedWord` updates, and BookData parts array indexing. Reader subcomponents dropped from ~10 to **3**.

**Real behavior preserved:** all 238 baseline tests still pass; 40 new hook smoke tests added → 278 pass + 1 skip. `vite build` `index.js` = **277.76 KB** (identical to D3 baseline).

**Flat composition** (per user preference): TextDisplay calls all 5 hooks directly in sequence (`useReaderBookmarks` → `useReaderState` → `useWordTranslation` → `useReaderAudioSync` + textId-change reset effect). `useReaderState` owns `audioSrc`/`srtLines` to break the circular dependency with `useReaderAudioSync` (which consumes them).

**Refs cross-shared via hook return:** `audioDrivenSentenceSyncRef`, `lastAutoSegmentPlaybackKeyRef`, `skipInitialAudioLessonSegmentPlaybackRef`, `pendingSentenceCreditRef` — exposed by `useReaderAudioSync` and consumed by TextDisplay's surviving SRS-credit effect + textId-change reset.

---

## ✅ Phase E2 — Split AudiobookPlayer.tsx

Per [plan-out-recursive-puddle.md](C:\Users\kamil\.claude\plans\f-dev-envitonment-lingua-read2-plan-out-recursive-puddle.md) — carved [components/AudiobookPlayer.tsx](client/lingua-read-client/src/components/AudiobookPlayer.tsx) from 1,239 → **178 LOC** (~86% reduction). Pure helpers and the listening-activity tracker moved into testable modules; the orchestrating logic moved into a hook; the component is now thin render wiring.

| Module | Scope | LOC |
|---|---|---|
| `src/audio/mediaSrc.ts` | `normalizeMediaSrc`, `isAbortLikeError`, `isLifecycleNetworkError`, `getTrackDisplayName`, `setAudioPlaybackIntent`, `getAudioPlaybackIntent`, plus new `SourceSwapState` + `createEmptySourceSwap()` + `isSourceSwapAbort()` predicate | 95 |
| `src/audio/segmentPlayback.ts` | `SegmentPlaybackState`, `SegmentPlaybackRequest`, `createSegmentPlaybackState()`, plus new pure transitions `applySegmentRequest()`, `evaluateSegmentBoundary()`, `cancelSegmentPlayback()`, `isStaleSegmentRequest()` | 98 |
| `src/audio/listeningActivity.ts` | `LISTENING_ACTIVITY_FLUSH_SECONDS` constant + `createListeningActivityTracker()` factory (replaces 4 ad-hoc refs with a typed tracker: `setLanguageId`, `startCheckpoint`, `ensureCheckpoint`, `clearCheckpoint`, `markStalling`, `markPlaying`, `prepareFlush`, `restorePending`, `hasPending`, `getPendingSeconds`) | 118 |
| `src/hooks/useAudiobookPlayer.ts` | All state/refs/effects/callbacks lifted from the component. Typed `UseAudiobookPlayerArgs` / `UseAudiobookPlayerResult` mirror the C-phase Args/Result convention. New `AudiobookTrackLike` / `AudiobookBookLike` types replace `AnyAudio`. | 1,059 |
| `components/AudiobookPlayer.tsx` | Thin render shell: `useAudiobookPlayer(props)` + JSX. Drops `AnyAudio` type alias. | 178 |

**SegmentPlaybackRequest hoisted to single source of truth:** the type now lives in [`audio/segmentPlayback.ts`](client/lingua-read-client/src/audio/segmentPlayback.ts) and is re-exported from [`hooks/useReaderAudioSync.ts`](client/lingua-read-client/src/hooks/useReaderAudioSync.ts) so existing consumers (LessonHeader, TextDisplay) keep their imports.

**Two `React.ComponentType<any>` casts removed** at [reader/LessonHeader.tsx](client/lingua-read-client/src/components/reader/LessonHeader.tsx) and [pages/TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) — both now import `AudiobookPlayer` directly with proper types. The component's prop type is exported as `AudiobookPlayerProps = UseAudiobookPlayerArgs`.

**Skipped happy-dom test replaced by unit tests on the extracted predicate.** The original `AudiobookPlayer.test.js > 'ignores aborted media error events during source replacement'` could not survive happy-dom's synchronous `loadedmetadata` (which clears `sourceSwapRef` before a synthetic error event can fire). Extracting `isSourceSwapAbort(swap, currentSrc, err)` into a pure function in `mediaSrc.ts` made the behavior directly testable without DOM timing dependencies. The skipped integration test is removed; 6 focused unit tests in [`__tests__/mediaSrc.test.js`](client/lingua-read-client/src/__tests__/mediaSrc.test.js) cover the predicate (abort-during-swap, AbortError-name, no-swap, wrong-src, non-abort-during-swap, null-error).

**New unit-test suites** ([mediaSrc.test.js](client/lingua-read-client/src/__tests__/mediaSrc.test.js), [segmentPlayback.test.js](client/lingua-read-client/src/__tests__/segmentPlayback.test.js), [listeningActivity.test.js](client/lingua-read-client/src/__tests__/listeningActivity.test.js)): **58 new tests** covering pure-function inputs/outputs without needing a render harness. All 26 surviving integration tests in `AudiobookPlayer.test.js` continue to pass — the component contract is preserved end-to-end.

**Behavioral preservation confirmed by the existing test pack.** The 11 load-bearing invariants enumerated in the recursive-puddle plan (book-mode restore, pagehide keepalive, lesson eager-load, listening activity floor/round/stall/remainder/no-double-log, segment cancel/abort/short-segment/repeat-2/repeat-1, source-swap dedup, restore race, no force-save on rerender, keyboard, ended-event advance/stop) all pass unchanged.

### Behavioral nuances preserved (subtle ones worth documenting)

- **Play-transition checkpoint guard.** The original `if (listeningLastCheckpointAtRef.current == null) { … = Date.now() }` on isPlaying → true is preserved via the new `tracker.ensureCheckpoint(now)` method, which only sets the checkpoint when missing. This prevents the React effect from overwriting a checkpoint already armed by the audio `playing` event (the two fire in nondeterministic order).
- **Floor vs round flush logic.** `prepareFlush(now, force, isPlaying)` mirrors the original: periodic flushes floor (so we never report seconds that haven't elapsed yet) and require ≥ 10s; force flushes round (so sub-second residue isn't lost across pause/unmount/lifecycle).
- **Retry-on-failure restoration.** Non-lifecycle `logListeningActivity` failures restore the pending seconds via `tracker.restorePending(seconds)` — matches the original `pendingListeningSecondsRef.current += secondsToLog` recovery path.
- **Stale segment guard on track change.** `isStaleSegmentRequest(state, request)` extracts the original guard: only reset the segment if there's no in-flight requestId or it differs from the current state's requestId. The source-effect uses this to avoid clobbering a segment request that arrived on the same tick as the track change.

### Outcome

- `npx tsc --noEmit` → 0 errors with full `strict: true`.
- `npx vitest run` → **336 pass + 0 skip** (was 278 pass + 1 skip; +58 unit tests, –1 deleted skipped test).
- `npx vite build` → `index.js` = **277.76 KB** (exact match to D3/E1 baseline), build time 8.01s.
- `eslint-disable no-explicit-any` count: dropped at the AudiobookPlayer surface (the 27-site cluster from D1b is now down to a handful inside the new typed modules — mostly the runtime-augmentation `__lrAllowPlayback` flag on HTMLAudioElement).
- Zero `// @ts-ignore` / `// @ts-expect-error` in `src/`.
- `AnyAudio` removed (0 hits in `src/`); two `React.ComponentType<any>` casts removed.

---

## ⏳ Phase E — Remaining sub-PRs

### E3 — Tidy WordInfoPanel props (1 PR, optional)

[WordInfoPanel.tsx](client/lingua-read-client/src/components/reader/WordInfoPanel.tsx) has 25 props in 5 logical groups (D1a typed each one). Pick whichever is lighter:

- **Composite types:** `TranslationState`, `SrsActions`, `SpeechState`, `UIFlags`, `Config` — caller passes a few grouped objects, fewer prop lines per call.
- **ReaderContext:** provided by `useReaderState` (E1), `WordInfoPanel` reads via `useContext` — eliminates most prop drilling entirely. Cleaner long-term but couples to E1's landing.

**Skip if** the C5/D1a-typed 25-prop interface ages fine without it (no review-loop complaints, no new props piling on). Keep this as an optional follow-up, not a blocker for "Phase E done."

---

## What's NOT in this plan

These were considered but are out of scope for the migration:
- **Backend changes.** The .NET API stays as-is. Phase B's Swagger generation handles type sync.
- **Test conversion.** `src/__tests__/*.js` stay `.js`. Vitest handles them via `allowJs`; the bulk-rename to `.ts` would yield little safety value and would require typing test mocks.
- **`noUnusedLocals` / `noUnusedParameters`.** ESLint covers these.
- **Migrating to React 19 / React Compiler.** Separate concern.
- **Replacing react-bootstrap.** The `<Button as={Link}>` typing clash is annoying but the lib still works; replacement is a much bigger UX decision.

---

## Master verification (end-to-end)

After **every** sub-PR — not just at the end of the migration:

1. `npx tsc --noEmit` — clean (matching whatever strict-level the current tsconfig declares).
2. `npx vitest run` — 238 pass + 1 skip (or 239 pass after E2 re-enables the audio test).
3. `npx vite build` — produces `build/`. `index.js` size within ±5% of D1b baseline (≈277 KB). Build time within ±2s of D1b (≈5s).
4. `npm run dev` on `:3000`, exercise the golden paths:
   - Login + setup flow.
   - Library: open a book, click a word, save a translation.
   - **Audiobook playback** — most sensitive surface: start, seek, segment transition, switch between lesson and book audio modes.
   - Settings page read + write.
   - Statistics page render with date-range filter.
   - SRS review (card mode) and SRS story review.
5. **Whenever a backend DTO changes:** re-run `npm run api:types`, confirm the diff lands in [api-types.d.ts](client/lingua-read-client/src/utils/api-types.d.ts).
6. **After any sub-PR that touches Docker/build config:** `docker compose build nginx && docker compose up` — confirm nginx serves the Vite build and frontend hits the API.

If a sub-PR regresses, roll back **only that PR's file edits** — earlier phases are independently safe.

---

## Reusable utilities to lean on (the toolkit, post-D1b)

Whenever a remaining phase needs a type, check here first before declaring locally:

- **API DTOs:** `components['schemas']['BookDto' | 'TextDto' | 'WordDto' | 'FolderDto' | 'GoalDto' | …]` from [api-types.d.ts](client/lingua-read-client/src/utils/api-types.d.ts), or the named re-exports `Book`, `Text`, `Word`, `Goal`, `Language`, `SrsStats`, `UserSettings`, `HardcoverResult` from the C2-split modules in [utils/api/](client/lingua-read-client/src/utils/api/).
- **Settings:** `Settings`, `SettingKey`, `SettingsContextValue`, plus the shared `SettingsChangeHandler` from [SettingsContext.tsx](client/lingua-read-client/src/contexts/SettingsContext.tsx) / [components/settings/AppearanceSettings.tsx](client/lingua-read-client/src/components/settings/AppearanceSettings.tsx).
- **Statistics:** `StatisticsSummary`, `LanguageStatistics`, `LanguageStatsRow`, `DisplayStats`, `ReadingActivity`, `ListeningActivity`, `KnownWordsActivity` from [utils/statistics.ts](client/lingua-read-client/src/utils/statistics.ts); plus `UseStatisticsDataResult`, `StatisticsNetworkStatus` from [hooks/useStatisticsData.ts](client/lingua-read-client/src/hooks/useStatisticsData.ts).
- **Reader text:** `LanguageConfig`, `ReaderToken`, `ReaderSegment`, `DisplayBlock` from [utils/readerText.ts](client/lingua-read-client/src/utils/readerText.ts).
- **Store:** `AuthState`, `TextsState`, `CurrentTextState`, `LibraryState`, `WordModalState`, `SelectedItem`, `SelectableType`, `LibraryContentsPayload`, `StoredText`, `CurrentText`, `CurrentWord`, `LibraryFolder`, `LibraryBook`, `LibraryText`, `ModalWord` from [utils/store.ts](client/lingua-read-client/src/utils/store.ts).
- **Goals:** `Goal`, `GoalsList`, `GoalSuggestion`, `CreateGoalInput`, `UpdateGoalInput` from [utils/api/goals.ts](client/lingua-read-client/src/utils/api/goals.ts).
- **Parsers:** `SrtEntry` from [utils/srtParser.ts](client/lingua-read-client/src/utils/srtParser.ts); `SentenceExplanation` from [utils/parseSentenceExplanation.ts](client/lingua-read-client/src/utils/parseSentenceExplanation.ts).
- **Drag-select:** `Rect` + typed `useDragSelect` from [hooks/useDragSelect.ts](client/lingua-read-client/src/hooks/useDragSelect.ts).
- **Folder colors (D1b):** `FolderColor` union from [components/library/FolderCard.tsx](client/lingua-read-client/src/components/library/FolderCard.tsx).
- **Word status (D1b):** the `WordStatus = 1 | 2 | 3 | 4 | 5` type + matching `Record<WordStatus, string>` maps duplicated across `SrsReview`, `SrsStoryReview`, `SrsWordPopover`, `WordLookupPopover`, `TermsPage`. Could be hoisted to a shared `src/types/wordStatus.ts` if E1 or D3 wants the cleanup.
