# Phase F — Status & Next Changes

Follow-up to the [TypeScript migration plan](plan-out-migrating-the-melodic-quasar.md) (Phases A–E3). Phase F is type-safety cleanup of the debt the migration deliberately deferred or carried.

## Context

The migration plan ended with `strict: true` clean, ~~95~~ 0 `eslint-disable no-explicit-any` annotations, and a few documented carry-overs: 7 `LinkAs: any = Link` casts, 5 duplicate `WordStatus` declarations, 7 `[key: string]: any` boundary signatures in `store.ts`, and 1,059 LOC of untested `useAudiobookPlayer` hook. Phase F closes those gaps without touching runtime behavior.

---

## Current state (post-F.13)

| Sub | What landed | Net |
|---|---|---|
| **F1** | Hoisted `WordStatus` + status color/label maps to [src/types/wordStatus.ts](client/lingua-read-client/src/types/wordStatus.ts); 5 duplicate sites now import from one source. | -3 disables (eliminated 4 duplicate declarations + 2 STATUS_LABELS/STATUS_VARIANTS pairs duplicated 4× each) |
| **F2** | Built [LinkButton + LinkDropdownItem + LinkListGroupItem](client/lingua-read-client/src/components/shared/LinkButton.tsx) wrappers. All 7 `LinkAs: any = Link` declarations removed; ~25 callsites switched to typed wrappers. Single `LooseAs = any` cast contained inside the wrapper module. | -6 disables (7 → 1) |
| **F3** | Added [useAudiobookPlayer.test.js](client/lingua-read-client/src/__tests__/useAudiobookPlayer.test.js): 10 smoke tests covering return shape, playlist derivation (lesson/book modes), API selection by mode, volume persistence, rate clamping, external `audioRef`, no-listening on unmount, contentKey change. | +10 tests |
| **F4** | Hoisted `DisplayedWord` to [src/types/displayedWord.ts](client/lingua-read-client/src/types/displayedWord.ts); both `WordInfoPanel` and `TextDisplay` import the shared type. Three `setDisplayedWord((prev: any) =>)` callbacks tightened to inferred `DisplayedWord \| null`. Guarded `displayedWord.status` access against the now-explicit `\| undefined`. | TextDisplay disables 20 → 18 (-2) |
| **F5** | `listRef` typed as `useRef<FixedSizeList \| null>(null)` (react-window). `stats` typed against a local `LessonCompletionStats` shape. To keep TextDisplay's `listRef` assignable to the hook, `useReaderAudioSync`'s loose `ListLikeRef` was tightened to `FixedSizeList \| null` directly. | TextDisplay disables 18 → 15 (-3) |
| **F6** | All 7 `[key: string]: any` index signatures in [utils/store.ts](client/lingua-read-client/src/utils/store.ts) replaced with explicit field lists derived from actual consumer grep. ~10 consumer guards added (`(folder.itemCount ?? 0) > 0`, `text.audioProgress ?? 0`, etc.). One `eslint-disable` re-added at the user-controlled sort comparator in `pages/TextList.tsx`. | store.ts disables 7 → 0 (net -6 with offset) |
| **F.7** | SRS pages: dropped redundant `(x: any)` annotations on `.map`/`.filter`/`.forEach` callbacks where `DueCard` / `HeatmapEntry` / `DuePhrase` element types are already inferable. Tightened `handleFlag(flagValue: number)`, `getIntervalLabel(card: DueCard \| null)`. In `SrsStoryReview`, reused the already-defined `MicroContext`, exported [`ExistingWord`](client/lingua-read-client/src/components/WordLookupPopover.tsx) from `WordLookupPopover`, flattened `existingWordsMap` to `Record<string, ExistingWord>`, and guarded `mc.wordId`/`mc.context` nullables. | SrsReview 9 → 0, SrsStoryReview 6 → 0 (-15) |
| **F.8** | Page-locals: `Dashboard` `pick<T>()` made generic; `Library` adopts `DragStartEvent`/`DragEndEvent` from `@dnd-kit/core` and an inline `setContents` mapper; `UserSettings` uses `PageSettings = Partial<Settings>` + a generic `syncSetting<K extends SettingKey>` helper; `BatchAudioCreate` types `Map<string, T[]>` + generic `findFuzzyMatch<T>`. [utils/store.ts](client/lingua-read-client/src/utils/store.ts) widened LibraryFolder/Book/Text/Breadcrumb string fields to `string \| null` to match the API; consumers already guard with `?? defaults` from F6. | Dashboard 4 → 0, Library 4 → 0, UserSettings 4 → 0, BatchAudioCreate 4 → 0 (-16) |
| **F.9** | Small-file polish across 7 scattered files. `reportWebVitals` imports `Metric` from `web-vitals`. `useReaderState` `Record<string, any>` → `Record<string, unknown>` on `ReaderText` / `ReaderBook`, and narrows the `parts.findIndex` callback to `{ textId?: number \| null }`. Legacy `components/UserSettings` gets an explicit `LocalSettings` shape and bridges to `UpdateUserSettingsInput` via `unknown` (the form's string `textSize` and `highlighting` pseudo-key genuinely diverge from the backend `Settings`). `LanguageForm` types `payload: LanguageFormData` with `as unknown as LanguageInput` at API call sites. `TextCreate` adopts `React.SyntheticEvent` / `React.FormEvent<HTMLFormElement>`. `TermsPage` uses `Word` + an explicit CSV row shape. `ActivityHeatmap` uses the already-exported `ReadingActivityPoint` / `ListeningActivityPoint`. | -14 disables |
| **F.10** | TextDisplay tiers 1+2 cleared. Tier 1: three setter callbacks (`setShowDesktopLessonControls`, `setSentenceAudioRepeats`, `setSentenceTtsRate`) typed as `T \| ((prev: T) => T)` instead of `any`. Tier 2 word data flow: `wordMap` typed `Map<string, Word>` (eliminates downstream `.get() as any` casts); `handleWordClick(word: string)`; all three `setWords((prev: any[]) =>)` callbacks let inference flow from `React.SetStateAction<Word[]>`. Latent nullability the `any` was masking is fixed in place: `existingWord.term ?? undefined` when assigning to `DisplayedWord`, and `wordData.wordId!` at `updateWord` call sites. Tier 2 React-element accumulator: `renderProcessedContentAsSentences` typed against `React.ReactNode[]` with a local `fragmentChildrenString` helper that centralizes `React.isValidElement` + `React.Fragment` + children-as-string narrowing. Also dropped the now-unnecessary disable above the `batchTranslateWords` cast (target is `Record<string, string>`, not `any`) and replaced `(text?.structuredContent as any)` with `as unknown as Parameters<typeof splitTextIntoSentenceSegments>[1]`. | TextDisplay 15 → 1 (-15; only the deferred Segment-union disable on line 1170 remains) |
| **F.11** | TextDisplay `Segment` heterogeneous union refactored. Added `SrtSentenceSegment` + `SentenceSegment = ReaderSegment \| SrtSentenceSegment` to [utils/readerText.ts](client/lingua-read-client/src/utils/readerText.ts) (co-located with the strict `ReaderSegment` producer). [hooks/useReaderAudioSync.ts](client/lingua-read-client/src/hooks/useReaderAudioSync.ts) drops its local permissive `ReaderSegment` + `ReaderMediaBlock` and re-exports from `readerText` (preserves the import path SentenceModeView uses). The two discriminator branches in TextDisplay (`replayCurrentSegmentAudio` and audio-driven sync effect) switched from `startTime == null` to `seg.type === 'audio'` — TS now narrows correctly. `SentenceModeView` prop type widened to `SentenceSegment \| null` (surfacing latent nullability the `any` was hiding; null guard moved above first access) and `mediaBlocks` access gated with `'mediaBlocks' in currentSegment`. `<img src={mediaBlock.imageUrl ?? undefined}>` coerces the now-explicit `string \| null` from `DisplayBlock`. | TextDisplay 1 → 0 (-1) |
| **F.12** | Four trivially-fixable residuals. `ManualEntryModal` and `CreateAudioLesson` error-object `as any` patterns replaced with `(err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? (err as { message?: string })?.message ?? ...` — no shared helper existed, inlined to match the F-phase style. `ActivityCharts` `Record<string, any>` alias replaced with a concrete `AnyActivityRow` shape (date/label/wordsRead/minutesListened/knownWords + a narrowed index signature for the dynamic `previous-*` keys). `ActivityTables` `type AnyRow = any` deleted entirely; all `(item: AnyRow)` annotations dropped — TS callback inference from `ReadingActivityPoint[]` / `ListeningActivityLanguage[]` does the job. | ManualEntryModal 1 → 0, CreateAudioLesson 1 → 0, ActivityCharts 1 → 0, ActivityTables 1 → 0 (-4) |
| **F.13** | All 13 remaining disables eliminated. **api-types-derived (5)**: `AiProviderSettings`, `DataManagementSettings`, `HardcoverSettings` adopt `ResponseOf<…>` against existing api-types schemas (`OpenRouterTestResultDto`, `AudioStorageSizeDto`, `HardcoverConnectionResult`); `utils/api/hardcover.ts` replaces the hand-written permissive `HardcoverCandidate` + `HardcoverResult` with `ResponseOf<…>`-derived `HardcoverMatchResult`/`HardcoverMetadataImportResult`/`HardcoverProgressSyncResult`/`HardcoverSyncAllResult` and `HardcoverCandidate = NonNullable<HardcoverMatchResult['candidates']>[number]` — comment claiming Hardcover responses were "opaque" is stale (the schemas exist in api-types.d.ts). Latent nullability now surfaced: `DataManagementSettings` audio-size readouts guard with `?? 0` since api-types marks the fields as optional. **index-signature narrowing (3)**: `displayedWord.ts`, `useWordTranslation.ts` `ReaderTextLike`, `TextCreate.tsx` `LanguageOption` — `[key: string]: any` → `[key: string]: unknown` (closed entirely for `LanguageOption`, just `{ id, name }`). **targeted casts (2)**: `BookDetail.tsx` uses `Awaited<ReturnType<typeof getText>> & { tag?: string \| null }` to access the missing `tag` field (backend swagger fix tracked separately); `GoalModal.tsx` `createGoal(payload as any)` → `as unknown as Parameters<typeof createGoal>[0]`. **prop boundary (1)**: `SecondaryControls.tsx` `text: any` → `text: unknown` (the toolbar only uses it as a truthiness guard). **typed runtime/library escape (3)**: `useReaderAudioSync.ts` `__lrAllowPlayback` flag → contained `HTMLAudioElement & { __lrAllowPlayback?: boolean }` cast (no global pollution); `LinkButton.tsx` `LooseAs = any` → typed `AsLinkComponent<P> = React.ForwardRefExoticComponent<Omit<P, 'as'\|'href'> & LinkBaseProps & { as: typeof Link } & React.RefAttributes<HTMLAnchorElement>>` cast that captures the merged host-props + Link-nav-props surface. **user-controlled sort (1)**: `TextList.tsx` `sortKey: string` → `sortKey: 'title' \| 'createdAt'`; comparator drops `(a: any, b: any)` and inference yields `string \| undefined`. | 13 → 0 |

### Verification baseline (post-F.13)

- `npx tsc --noEmit` → **0 errors** under full `strict: true`.
- `npx vitest run` → **346 pass / 0 skip** (matches baseline; no test-surface change).
- `npx vite build` → `index.js` = **278.28 KB** (exactly matches post-F baseline; F.11/F.12/F.13 are all type-only).
- `eslint-disable no-explicit-any` count: **95 → 0** (-95, -100% from migration end; -13 from post-F.12 baseline of 13).
- Zero `@ts-ignore` / `@ts-expect-error` in `src/`.
- Zero `no-explicit-any` disables anywhere in `src/`.

### New files (F1–F6)

- [client/lingua-read-client/src/types/wordStatus.ts](client/lingua-read-client/src/types/wordStatus.ts) — `WordStatus` + `WORD_STATUS_VALUES` + `WORD_STATUS_LABELS` + `WORD_STATUS_VARIANTS`.
- [client/lingua-read-client/src/types/displayedWord.ts](client/lingua-read-client/src/types/displayedWord.ts) — `DisplayedWord` shape used by WordInfoPanel and TextDisplay.
- [client/lingua-read-client/src/components/shared/LinkButton.tsx](client/lingua-read-client/src/components/shared/LinkButton.tsx) — `LinkButton` default export + `LinkDropdownItem` + `LinkListGroupItem` wrappers.
- [client/lingua-read-client/src/__tests__/useAudiobookPlayer.test.js](client/lingua-read-client/src/__tests__/useAudiobookPlayer.test.js) — 10 smoke tests.

### Touchpoints (F.7 + F.8)

- [client/lingua-read-client/src/components/WordLookupPopover.tsx](client/lingua-read-client/src/components/WordLookupPopover.tsx) now exports `ExistingWord` (was an internal `interface`).
- [client/lingua-read-client/src/utils/store.ts](client/lingua-read-client/src/utils/store.ts) — `LibraryFolder.name`, `LibraryBook.title`, `LibraryText.title`, etc. widened to `string | null` to match the API. No consumer changes needed (F6 already added `?? default` guards).

### Touchpoints (F.9 + F.10)

- [client/lingua-read-client/src/pages/TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) — `wordMap` retyped `Map<string, Word>`; nullability of `Word.term` / `Word.wordId` is now surfaced and guarded explicitly at the (few) sites that assign into `DisplayedWord` or pass `wordId` to `updateWord`.
- [client/lingua-read-client/src/components/UserSettings.tsx](client/lingua-read-client/src/components/UserSettings.tsx) — explicit `LocalSettings = { textSize?: string; theme?: string; textFont?: string; highlighting?: string; highlightKnownWords?: boolean }`. Form/DTO mismatch is documented; bridge to `UpdateUserSettingsInput` uses `unknown` (not `any`).
- [client/lingua-read-client/src/components/settings/LanguageForm.tsx](client/lingua-read-client/src/components/settings/LanguageForm.tsx) — `payload: LanguageFormData` with `as unknown as LanguageInput` at create/update call sites (the OpenAPI input shape and the form's typed shape differ in dictionary-nested `languageId` fields).
- [client/lingua-read-client/src/reportWebVitals.ts](client/lingua-read-client/src/reportWebVitals.ts) — imports `Metric` from `web-vitals` rather than re-declaring `type PerfMetric = any`.

### Touchpoints (F.11 + F.12)

- [client/lingua-read-client/src/utils/readerText.ts](client/lingua-read-client/src/utils/readerText.ts) — added `SrtSentenceSegment` and `SentenceSegment = ReaderSegment \| SrtSentenceSegment` after the existing strict `ReaderSegment`. Discriminator is `type` field (`'sentence' \| 'title' \| 'audio'`).
- [client/lingua-read-client/src/hooks/useReaderAudioSync.ts](client/lingua-read-client/src/hooks/useReaderAudioSync.ts) — local permissive `ReaderSegment` + `ReaderMediaBlock` deleted; re-exports from `readerText` instead.
- [client/lingua-read-client/src/components/reader/SentenceModeView.tsx](client/lingua-read-client/src/components/reader/SentenceModeView.tsx) — prop `currentSegment: SentenceSegment \| null` (null guard now precedes first access). `mediaBlocks` access gated with `'mediaBlocks' in currentSegment`. `<img src>` coerces `string \| null` from `DisplayBlock.imageUrl` to `string \| undefined`.
- [client/lingua-read-client/src/pages/TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) — `sentenceSegments = useMemo<SentenceSegment[]>(...)`. The two discriminator branches switched from `startTime == null` to `type === 'audio'`. All `.text` / `.index` reads on the union are valid without narrowing because both variants carry them.

### Touchpoints (F.13)

- [client/lingua-read-client/src/utils/api/hardcover.ts](client/lingua-read-client/src/utils/api/hardcover.ts) — completely retyped: each endpoint helper now returns `ResponseOf<…>` from the matching api-types path. `HardcoverCandidate` is derived from `HardcoverMatchResult['candidates']`. Removes the now-stale "opaque schemas" comment.
- [client/lingua-read-client/src/components/settings/AiProviderSettings.tsx](client/lingua-read-client/src/components/settings/AiProviderSettings.tsx), [DataManagementSettings.tsx](client/lingua-read-client/src/components/settings/DataManagementSettings.tsx), [HardcoverSettings.tsx](client/lingua-read-client/src/components/settings/HardcoverSettings.tsx) — switched to `ResponseOf<…>`-derived types for their test/result props.
- [client/lingua-read-client/src/pages/TextDisplay.tsx](client/lingua-read-client/src/pages/TextDisplay.tsx) — surfaced latent nullability the `DisplayedWord[key: string]: any` was hiding: `term: wordToDelete.term ?? undefined` at the post-delete state-setter site (line 1599).
- [client/lingua-read-client/src/pages/TextList.tsx](client/lingua-read-client/src/pages/TextList.tsx) — `sortKey` narrowed to a 2-value union, comparator simplified into a typed switch on `'createdAt'` vs string columns. The disable is gone, behavior identical (numeric collation, asc/desc toggle).
- [client/lingua-read-client/src/components/shared/LinkButton.tsx](client/lingua-read-client/src/components/shared/LinkButton.tsx) — `LooseAs = any` replaced with a typed `AsLinkComponent<P> = React.ForwardRefExoticComponent<…>` helper that captures the host-props ∪ Link-nav-props surface and propagates the anchor ref correctly. The polymorphism workaround is now a precise type assertion, not an `any` escape.

---

## Outstanding debt

**Zero `eslint-disable no-explicit-any` annotations remain in `src/`.** The original 95 are all resolved across F1–F.13. Phase F.14 + Phase G (below) clear the four follow-up items previously noted here.

### Phase F.14 — backend `tag` + GoalModal enum tightening + react-router-bootstrap adoption (2026-05-18)

| Sub | What landed | Net |
|---|---|---|
| **F.14a** | `TextDetailDto` (C#) gains `public string? Tag { get; set; }`; `GetText` LINQ projection adds `Tag = text.Tag`. `api-types.d.ts` regenerated from updated Swagger (now includes `tag?: string \| null`). [BookDetail.tsx](client/lingua-read-client/src/pages/BookDetail.tsx) drops the `Awaited<ReturnType<typeof getText>> & { tag?: string \| null }` widening cast + the stale "swagger fix is tracked separately" comment. Latent bug fixed: pre-F.14, the controller projection didn't include `Tag`, so the book-detail edit modal's `tag` field was always populated as `''` regardless of the saved tag. | Casts: -1 |
| **F.14b** | [goalUtils.ts](client/lingua-read-client/src/components/goals/goalUtils.ts) exports `GoalTypeValue` / `GoalModeValue` / `GoalRecurrenceValue` literal-union aliases (`typeof X[keyof typeof X]`) co-located with the `as const` declarations. [GoalModal.tsx](client/lingua-read-client/src/components/goals/GoalModal.tsx) tightens `useState<number>` → `useState<GoalTypeValue\|GoalModeValue\|GoalRecurrenceValue>`; the `as unknown as Parameters<typeof createGoal>[0]` bridge + 3-line comment removed. Strict typing surfaced a latent bug at line 361 (duplicate `type === GOAL_TYPE.ListeningSeconds ? '(hours)' : type === GOAL_TYPE.ListeningSeconds ? '(seconds)' : '(words)'` — second branch unreachable); collapsed to `'(hours)' : '(words)'`. | Casts: -1, latent bug fixes: +1 |
| **F.14c** | `react-router-bootstrap@^0.26.3` installed; ambient module declaration at `src/types/react-router-bootstrap.d.ts` preserves strict typing (no `any`). [LinkButton.tsx](client/lingua-read-client/src/components/shared/LinkButton.tsx) **deleted** (was 68 LOC with 3 `AsLinkComponent<P>` casts). All 7 consumer files migrated to `<LinkContainer to="...">` wrapping the host component: Dashboard, Library, Home, BookDetail, components/texts/TextList, pages/TextList, dashboard/LanguageDashboardCard. Navigation.tsx also migrated — replaces 7 bare `<X as={Link} to="...">` patterns with `<LinkContainer to="..."><X>` composition. | Casts: -3, files removed: -1 |

### Phase G — useAudiobookPlayer 4-hook split (2026-05-18)

| Sub | What landed | Notes |
|---|---|---|
| **G3** | Extracted [useAudiobookListeningActivity.ts](client/lingua-read-client/src/hooks/audio/useAudiobookListeningActivity.ts) (63 LOC). Owns `listeningTrackerRef`, `flushListeningActivityRef`; `flushListeningActivity` callback; `setLanguageId` effect + sync-flush-to-ref effect. | First extraction — most self-contained. |
| **G2** | Extracted [useAudiobookSegmentPlayback.ts](client/lingua-read-client/src/hooks/audio/useAudiobookSegmentPlayback.ts) (91 LOC). Owns `segmentPlaybackRef`; contentKey-tied reset effect (registered before apply so it fires first on initial mount, preserving pre-split source-order semantics); apply-on-request effect; `handleSegmentBoundary(time)` helper that the orchestrator's `handleTimeUpdate` consults each tick. | Second extraction. |
| **G1** | Extracted [useAudiobookProgress.ts](client/lingua-read-client/src/hooks/audio/useAudiobookProgress.ts) (409 LOC). Owns 7 tracking refs (`saveProgressRef`, `restoredContentKeyRef`, `playbackStartedContentKeyRef`, `userPositionIntentContentKeyRef`, `initialSeekRef`, `lastServerUpdateRef`, `justStartedPlayingRef`); `saveProgress`/`queueInitialSeek`/`applyInitialSeekIfReady` callbacks; initial-progress-load effect, sync-saveProgress-to-ref, cross-device-sync-on-play, cross-device-sync-polling (with visibilitychange listener). | Third extraction. |
| **G4** | [useAudiobookPlayer.ts](client/lingua-read-client/src/hooks/useAudiobookPlayer.ts) slimmed 1,059 → 722 LOC. Owns all 11 useState (state setters never migrate out — preserves render-batch shape), structural refs (audio element, playback snapshot, lifecycle flag), `requestAudioPlay`, `buildTrackSrc`, audio-event-listener effect, src-swap effect, transport controls (`togglePlayPause`/`seek`/`goToNextTrack`/`goToPrevTrack`/`changeRate`/`handleVolumeChange`), keyboard shortcuts. Composes G3 → G1 → G2 in fixed call order (documented in the file as a hook-order invariant). | Net source LOC: 1,059 → 1,285 (split across 4 files, +21% from per-file imports + arg type defs + ordering-invariant comments). |

#### Hook-order invariant (G4 composes in this fixed order)

1. **G3** — listening activity. Self-contained.
2. **G1** — progress + content-key tracking. Owns `userPositionIntentContentKeyRef` which G2 mutates.
3. **G2** — segment playback. Reads orchestrator's `requestAudioPlay` (defined between G1 and G2 in source order).
4. **G4 effects** — audio event listeners, lifecycle flushes, transport controls.

Reordering breaks effect-execution order: e.g., G1's progress-load effect must run before G4's audio-event-listener effect so `initialSeekRef` is populated by the time `loadedmetadata` fires. Also: G2's contentKey-tied segment reset is internal to G2 (not pulled into G4's reset-on-contentKey effect) so it fires *before* G2's segment-apply effect — mirroring the pre-split source order where the legacy hook's line-419 reset preceded line-525 segment-apply.

#### Test coverage

| File | Tests | Coverage |
|---|---|---|
| [useAudiobookListeningActivity.test.js](client/lingua-read-client/src/__tests__/useAudiobookListeningActivity.test.js) | 3 | result shape, language-id propagation, flush invokes API |
| [useAudiobookSegmentPlayback.test.js](client/lingua-read-client/src/__tests__/useAudiobookSegmentPlayback.test.js) | 3 | continue when inactive, apply seeks+plays, stop at endTime + ref-reset |
| [useAudiobookProgress.test.js](client/lingua-read-client/src/__tests__/useAudiobookProgress.test.js) | 3 | result shape, initial lesson-progress fetch, `saveProgress(true)` writes localStorage + calls update API |

All 26 [AudiobookPlayer.test.js](client/lingua-read-client/src/__tests__/AudiobookPlayer.test.js) integration tests pass **without modification** — the split is behavior-preserving. Vitest baseline: 346 → 355 (+9 from G1/G2/G3 unit tests).

### Verification baseline (post-F.14 + Phase G)

- `npx tsc --noEmit` → **0 errors** under full `strict: true`.
- `npx vitest run` → **355 pass / 0 skip** (346 pre-G baseline + 9 new unit tests).
- All 26 `AudiobookPlayer.test.js` integration tests + all 10 `useAudiobookPlayer.test.js` smoke tests pass unmodified.
- `eslint-disable no-explicit-any` count: **0** (unchanged).
- `@ts-ignore` / `@ts-expect-error`: **0** (unchanged).
- `as unknown as` in `src/`: **-5 from this batch** (LinkButton×3 + GoalModal×1 + BookDetail×1 all removed). 9 pre-existing documented bridges remain in `useReaderState`, `UserSettings`, `AiProviderSettings`, `LanguageForm`, `TextDisplay`, `client.ts` — all acknowledged in earlier Phase F sub-phases as precise type-bridges, not `any`-escapes.
- `react-hooks/exhaustive-deps` warnings on `useAudiobookPlayer.ts`: **1 → 3** (+2 from the Phase G split — destructured refs are no longer recognized as `useRef` returns by the lint plugin's analysis; the cleanup pattern is intentional and matches pre-split source-line 832-839 of the legacy hook).
- `npx vite build` succeeds. Bundle chunking differs cosmetically (Vite re-named the main chunk), but no new code paths.

Phase F + Phase G are complete. No outstanding items.

---

## Recommended next steps

1. **Merge `typescript` → `main`** — F1–F.14 + Phase G are all independently revertable. F.14 + Phase G hot paths to re-smoke before merge:
   - **Book-detail edit modal** (F.14a fixes latent `tag = ''` bug — verify a tagged text loads its tag into the edit form).
   - **Goal creation** (F.14b — create one goal per type × cadence × mode combination).
   - **All navigation surfaces** (F.14c — click every Navbar link, every Dashboard / Library / Home / TextList / BookDetail navigation button; verify URL changes and react-bootstrap active styling renders).
   - **Audiobook playback** (Phase G — book mode track advance + cross-tab sync, sentence mode segment playback with `repeatCount=2`, page-lifecycle save with `keepalive: true`).
2. **No outstanding TypeScript-strictness items.** Phase F's "Outstanding debt" follow-ups are all resolved.
