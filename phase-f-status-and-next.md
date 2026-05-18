# Phase F — Status & Next Changes

Follow-up to the [TypeScript migration plan](plan-out-migrating-the-melodic-quasar.md) (Phases A–E3). Phase F is type-safety cleanup of the debt the migration deliberately deferred or carried.

## Context

The migration plan ended with `strict: true` clean, ~~95~~ 78 `eslint-disable no-explicit-any` annotations, and a few documented carry-overs: 7 `LinkAs: any = Link` casts, 5 duplicate `WordStatus` declarations, 7 `[key: string]: any` boundary signatures in `store.ts`, and 1,059 LOC of untested `useAudiobookPlayer` hook. Phase F closes those gaps without touching runtime behavior.

---

## Current state (post-F.10)

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

### Verification baseline (post-F.10)

- `npx tsc --noEmit` → **0 errors** under full `strict: true`.
- `npx vitest run` → **346 pass / 0 skip** (matches baseline; no test-surface change).
- `npx vite build` → `index.js` = **278.28 KB** (exactly matches post-F baseline).
- `eslint-disable no-explicit-any` count: **95 → 18** (-77, -81% from migration end; -29 / -62% from post-F.8 baseline of 47).
- Zero `@ts-ignore` / `@ts-expect-error` in `src/`.
- No file holds more than 1 `no-explicit-any` disable.
- All deferred items from the migration plan are cleared. Both large page concentrations (SRS pages, 4 page-locals) and the largest single-file concentration (TextDisplay, 15 → 1) are cleared.

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

---

## Outstanding debt (not addressed in F.7 – F.10)

### Remaining `eslint-disable no-explicit-any` (18 total)

| File | Count | Notes |
|---|---|---|
| `pages/TextDisplay.tsx` | 1 | The documented heterogeneous SRT-vs-sentence-split `Segment` union at line 1170. Cleanup requires defining `SrtSegment \| ReaderSegment` plus updating all branches that read `.startTime`, `.srtLineId`, `.mediaBlocks`. See proposed **Phase F.11** below. |
| 17 other files | 1 each | Mostly tiny local escape hatches: settings sub-components with `type X = any` stubs for API result shapes the OpenAPI schema doesn't specify (`AiProviderSettings`, `DataManagementSettings`, `HardcoverSettings`); `[key: string]: any` index signatures on permissive DTOs (`displayedWord.ts`, `hardcover.ts`, `useReaderState`/`useWordTranslation` reader-shape augmentation); one runtime-augmentation flag (`__lrAllowPlayback` on HTMLAudioElement); the `LooseAs = any` contained inside `LinkButton.tsx`; a few user-controlled sort comparators (`TextList.tsx`). |

### Items still tracked for future

- `useAudiobookPlayer.ts` is 1,059 LOC bundling 4 orthogonal concerns (progress sync, segment playback, listening activity, audio element wiring). Not split. See **Phase G** below.
- `react-bootstrap` × `react-router-dom` typing clash is contained in `LinkButton.tsx`'s `LooseAs = any` cast. A library upgrade (e.g. react-bootstrap v3 or a `react-router-bootstrap` adoption) could remove it, but is out of scope.

---

## Phase F.11 — proposed, not executed

The one disable left in TextDisplay (line 1170, `type Segment = any`) wraps a heterogeneous union built at runtime from two different sources:

- **SRT segments** (`isAudioLesson && srtLines.length > 0`) carry `{ index, text, startTime, endTime, srtLineId, type: 'audio' }`.
- **Sentence-split segments** (text-only path) return `ReaderSegment` from `splitTextIntoSentenceSegments` — `{ index, text, type: 'sentence' \| 'title', mediaBlocks }`.

Render code branches on `currentSentenceSegment.startTime != null` to distinguish them.

**Proposed shape:**

```ts
// In utils/readerText.ts (or a new audio segment module):
export type SrtSentenceSegment = {
  index: number;
  text: string;
  type: 'audio';
  startTime: number;
  endTime: number;
  srtLineId: number | string;
};
export type SentenceSegment = ReaderSegment | SrtSentenceSegment;
```

Then in TextDisplay:
```ts
const sentenceSegments = useMemo<SentenceSegment[]>(() => { ... });
```

Render-site branches use `'startTime' in seg` (or `seg.type === 'audio'`) as the discriminant. ~10 callsite tweaks expected.

**Why deferred:** the readerText module is shared with `useReaderAudioSync` and a few tests. A discriminated-union refactor is single-day work but needs the audio-sync code path re-verified end-to-end (open an audio lesson, scrub, switch lesson/book modes). Worth doing when audiobook code is otherwise being touched, or as a focused half-day cleanup.

---

## Phase G — proposed, not executed

The plan covers a 4-step split of [hooks/useAudiobookPlayer.ts](client/lingua-read-client/src/hooks/useAudiobookPlayer.ts) (1,059 LOC → ~4 hooks, each independently testable):

| Step | Extract | Approx. LOC | What it owns |
|---|---|---|---|
| **G1** | `useAudiobookProgress` | ~200 | Progress load on mount, periodic save, cross-device sync detect+restore. Exposes `playbackStartedContentKeyRef`, `lastServerUpdateRef`. |
| **G2** | `useAudiobookSegmentPlayback` | ~150 | Consumes `audio/segmentPlayback.ts` pure module + applies requests to the live audio element. |
| **G3** | `useAudiobookListeningActivity` | ~120 | Wraps `audio/listeningActivity.ts` tracker into a hook with visibility/pagehide/periodic flush effects. |
| **G4** | Slim `useAudiobookPlayer` to orchestrator | ~400–500 | Residual audio element wiring + composition of G1–G3. |

**Why deferred:** the F3 smoke tests cover return shape and a few derivations, but don't exercise cross-device sync, listening-activity flush, or segment-request handling — exactly the concerns Phase G would relocate. Without that coverage, regressions could land silently. The 26 surviving `AudiobookPlayer.test.js` integration tests are the safety net, but they exercise the rendered component shell, not the hook directly.

**When to revisit:** before any planned change to audiobook playback behavior. Splitting it then makes the change easier to review and test in isolation; doing it preemptively is pure refactor.

---

## Recommended next steps

1. **Merge `typescript` → `main`** ✅ — F1–F10 are all independently revertable. Manual golden-path smoke (login, library DnD, reader word save / keyboard 1–5 / delete, audiobook seek + cross-tab sync, SRS card+story, settings, BatchAudioCreate fuzzy-match) passed against the F.10 state on 2026-05-18.
2. **Phase F.11** — TextDisplay `Segment` heterogeneous union (1 disable). See section above. Half-day. Best done alongside any planned audiobook playback work since the readerText module overlap means audio-sync code paths need re-verification.
3. **Phase G** — `useAudiobookPlayer.ts` 4-hook split (deferred). Best done when audiobook playback behavior is on the roadmap. See section below.
4. **Residual** — 17 remaining single-disable files. Opportunistic; each holds 1 escape hatch (settings-stub `type X = any`, permissive index signature, contained library-typing-clash cast). Address when those files get touched for unrelated reasons.
