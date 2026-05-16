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
| **D2** | Flip `strictNullChecks: true` + null-narrowing sweep | ⏳ Next |
| **D3** | Remaining strict flags + final cleanup | ⏳ Pending |
| **E1** | Extract hooks from TextDisplay.tsx (2,735 LOC) | ⏳ Pending |
| **E2** | Split AudiobookPlayer.tsx (1,239 LOC) into modules | ⏳ Pending |
| **E3** | Tidy WordInfoPanel.tsx 25-prop interface (optional) | ⏳ Pending |

**Current tsconfig state:** `strict: false`, `noImplicitAny: true`, `allowJs: true`, `checkJs: false`. All 105 source files under `src/` are `.ts`/`.tsx`; the 19 files in `src/__tests__/` are intentionally `.js`.

**Verification baseline (post-D1b):** `npx tsc --noEmit` clean · `npx vitest run` = 238 pass + 1 skip · `npx vite build` ≈ 5s · `index.js` ≈ 277 KB.

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

## ⏳ Phase D2 — `strictNullChecks: true`

The biggest remaining single flag. Run `npx tsc --noEmit --strictNullChecks` once to inventory; expect **hundreds of sites** (probably 400-700, mostly in event handlers, API response narrowing, and `useRef<T>(null)` access without null guards).

### tsconfig change

```jsonc
{
  "compilerOptions": {
    "strictNullChecks": true   // currently inherited as false (strict: false)
  }
}
```

### Fix recipes per pattern

| Pattern | Fix |
|---|---|
| `useRef<HTMLElement>(null)` then `.focus()`, `.style.x = ...` | Optional chain (`ref.current?.focus()`) or early-return guard |
| `useState<T>()` with no initial | Initialize explicitly: `useState<T \| null>(null)` |
| `document.getElementById(id)` consumed as non-null | `if (!el) return;` or `el!` with one-line comment |
| API response field marked optional in swagger but read as required | Narrow with `if (!field) return` — or assert with `!` when the backend truly guarantees it. Document at the site. |
| Array `.find()` / `.pop()` / `.shift()` used without guard | Optional chain or guard |
| `localStorage.getItem('x')` accessed as `string` | Default with `?? ''` or guard |
| `process.env.X` / `import.meta.env.X` of optional value | Default or guard |
| `e.target.value` where target could be `EventTarget` | Cast target to specific element type (`e.target as HTMLInputElement`) |

### Strategy

1. **Don't change runtime behavior.** Where the site is invariant the type system can't see (e.g. `useRef` set by a ref callback that always runs before access), use `!` with a one-line comment. Where the site genuinely could be null in real conditions, add a real branch.
2. **For the three giants (TextDisplay, AudiobookPlayer, store.ts):** fix sites in place; don't refactor. Phase E does the refactor.
3. **Same batch structure as D1b** — small leaves first, giants last. Run `npx tsc --noEmit --strictNullChecks` between batches to track progress. Flip the persistent flag in [tsconfig.json](client/lingua-read-client/tsconfig.json) only at the very end of the PR.
4. **If the total fallout is genuinely intractable in one PR,** split into D2a (utils/api/hooks/contexts) → D2b (components + reader) → D2c (pages) along the same C-phase boundaries.

### Reusable utilities already in place

Most of what D2 needs is already declared — D1b made sure the types exist; D2 just makes them honor `null | undefined` properly.

- API DTOs: `components['schemas']['*']` from [api-types.d.ts](client/lingua-read-client/src/utils/api-types.d.ts). The generated types correctly mark fields optional where the C# DTO is nullable — D2's job is mostly to honor those `?` modifiers at consumer sites.
- Settings, store, statistics, reader-text, goal types: all already strict-null-aware in their declarations.

### Acceptance

- `npx tsc --noEmit` clean with `strictNullChecks: true` in tsconfig.
- `npx vitest run` — 238 pass + 1 skip.
- `npx vite build` — produces `build/` (`index.js` within ±5% of D1b baseline ≈ 277 KB).
- Manual smoke (run `npm run dev`):
  - Login → setup → library.
  - Open a book, click a word, save a translation.
  - **Audiobook playback** (D2 narrowing is most likely to surface real null-access bugs there): start, seek, segment transition.
  - Settings page read + write.
  - Statistics page render with date-range filter.
  - SRS review (card) and SRS story review.

### Carry-over from D1b for D2 to revisit

- The `~80-100 any` annotations may shrink slightly under strict null checks — places where `any` was the easy way out of a union may resolve to a real type once nullability is honored. Bonus, not a goal.
- Some `setX((prev: any) => ...)` in TextDisplay become typeable once `strictNullChecks` forces useState init values — but E1's hook extraction is the canonical fix.

---

## ⏳ Phase D3 — Remaining strict flags + cleanup

### tsconfig change

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

Keep `allowJs: true` and `checkJs: false` — the 19 test files in `src/__tests__/` are still `.js` and we don't want to type them. (Phase D is about source files, not tests.)

### Likely fallout

- **`useUnknownInCatchVariables: true`** — every `catch (err)` needs `err instanceof Error` narrowing or `err: unknown` typing. **Most catch sites in the codebase already use `catch (err: unknown) { (err as Error)?.message }` from D1b** — those are fine. The strict-flag flip just forces explicit `unknown` where catch params are untyped.
- **`strictFunctionTypes`** — usually quiet; may surface in event-handler typings where a wider Event type was assigned to a narrower one.
- **`strictPropertyInitialization`** — N/A for this codebase (function components, no class fields).
- **`noFallthroughCasesInSwitch`** — flagged switches need explicit `break` / `return` / `// falls through` comment.

### Optional flags — propose but **don't** enable in D3

These create churn for limited safety value and overlap with ESLint:
- `noUnusedLocals: true`
- `noUnusedParameters: true`

[eslint.config.mjs](client/lingua-read-client/eslint.config.mjs) already covers these via `@typescript-eslint`. Skip unless we find a concrete bug they'd catch.

### Acceptance

- `npx tsc --noEmit` clean under `strict: true`.
- Tests pass.
- Build size unchanged (±5%).
- Zero `// @ts-ignore` / `// @ts-expect-error` in `src/` (verified by Grep).

---

## ⏳ Phase E — Component splits and ergonomics (3 PRs)

Now that types reveal contracts and dependency shapes, the refactors that were too risky pre-conversion become safe. Each sub-PR is independently shippable.

### E1 — Extract hooks from TextDisplay.tsx (1 PR)

**Target:** shrink [pages/TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) (currently 2,735 LOC, 78 state vars after C8) to **< 800 LOC** of render + orchestration. Resolve the ~25 `any` annotations clustered in TextDisplay's heterogeneous state setters that D1b deliberately left.

**Extract to:**
- `src/hooks/useReaderState.ts` — central reader state: current text, displayed word, selected word, mode toggles, segment indices, bookmarks, mobile/desktop layout flags.
- `src/hooks/useWordTranslation.ts` — translation API calls + local state (translation cache, isTranslating, errors, abort controllers).
- `src/hooks/useReaderKeyboard.ts` — 1-5 status keys, space-bar reveal, navigation shortcuts.
- `src/hooks/useReaderAudioSync.ts` — audio time ↔ SRT line ↔ sentence-segment sync.
- `src/hooks/useReaderBookmarks.ts` — bookmark state + persistence via [utils/bookmarks.ts](client/lingua-read-client/src/utils/bookmarks.ts).

**Defines the canonical contracts** that the C5 reader subcomponents have been waiting for. Once `useReaderState` defines `Segment` as a proper tagged union (SRT-derived vs sentence-split with `mediaBlocks`), the loose `any` typings in `SentenceModeView`, `StandardTextView`, `AudioTranscriptView` tighten naturally.

**Risk:** TextDisplay's state interdependencies are intricate. Approach: extract one hook at a time inside a single PR, verifying tests after each. Don't change behavior — pure mechanical refactor with types as the safety net.

**Acceptance:** TextDisplay.tsx < 800 LOC · all hooks have their own minimal unit-test seed (smoke tests at least) · `any` count in TextDisplay drops to single digits · tests still 238 pass + 1 skip.

### E2 — Split AudiobookPlayer.tsx (1 PR)

**Target:** carve [components/AudiobookPlayer.tsx](client/lingua-read-client/src/components/AudiobookPlayer.tsx) (1,239 LOC) into:

- `src/audio/segmentPlayback.ts` — segment state machine (pure, no React). The `SegmentPlaybackState` type from D1b is the seed.
- `src/audio/listeningActivity.ts` — listening time tracker + flush logic (currently a `LISTENING_ACTIVITY_FLUSH_SECONDS` constant + buffer in-component).
- `src/audio/mediaSrc.ts` — `normalizeMediaSrc`, `isAbortLikeError`, `isLifecycleNetworkError`, `getTrackDisplayName` (already mostly pure, just sitting in the component file).
- `src/hooks/useAudiobookPlayer.ts` — orchestrating hook combining the above + audio element refs + API progress save/load.
- `components/AudiobookPlayer.tsx` becomes < 600 LOC of render + thin wiring.

**Re-enable the skipped Phase A test** (`AudiobookPlayer.test.js > ignores aborted media error events during source replacement`) — once the source-swap path is in its own module, the test setup can target it directly without happy-dom's synchronous-loadedmetadata interference.

**Side cleanup:** the two `React.ComponentType<any>` casts at [LessonHeader.tsx](client/lingua-read-client/src/components/reader/LessonHeader.tsx) and [TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) (D1a/D1b carry-overs) can resolve to a proper typed import once the split component has stable props per usage.

**Acceptance:** AudiobookPlayer.tsx < 600 LOC · the skipped test re-enabled and passing (239 pass + 0 skip) · `AnyAudio` type alias removed · audio surface observably identical (real smoke test: book + lesson playback, seek, segment, switch between).

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
