# Phase F — Status & Next Changes

Follow-up to the [TypeScript migration plan](plan-out-migrating-the-melodic-quasar.md) (Phases A–E3). Phase F is type-safety cleanup of the debt the migration deliberately deferred or carried.

## Context

The migration plan ended with `strict: true` clean, ~~95~~ 78 `eslint-disable no-explicit-any` annotations, and a few documented carry-overs: 7 `LinkAs: any = Link` casts, 5 duplicate `WordStatus` declarations, 7 `[key: string]: any` boundary signatures in `store.ts`, and 1,059 LOC of untested `useAudiobookPlayer` hook. Phase F closes those gaps without touching runtime behavior.

---

## Current state (post-F.8)

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

### Verification baseline (post-F.8)

- `npx tsc --noEmit` → **0 errors** under full `strict: true`.
- `npx vitest run` → **346 pass / 0 skip** (matches baseline; no test-surface change).
- `npx vite build` → `index.js` = **278.28 KB** (exactly matches post-F baseline).
- `eslint-disable no-explicit-any` count: **95 → 47** (-48, -51% from migration end; -31 / -40% from post-F baseline of 78).
- Zero `@ts-ignore` / `@ts-expect-error` in `src/`.
- All deferred items from the migration plan are cleared. The two largest page concentrations (SRS pages + 4 page-locals) are also cleared.

### New files (F1–F6)

- [client/lingua-read-client/src/types/wordStatus.ts](client/lingua-read-client/src/types/wordStatus.ts) — `WordStatus` + `WORD_STATUS_VALUES` + `WORD_STATUS_LABELS` + `WORD_STATUS_VARIANTS`.
- [client/lingua-read-client/src/types/displayedWord.ts](client/lingua-read-client/src/types/displayedWord.ts) — `DisplayedWord` shape used by WordInfoPanel and TextDisplay.
- [client/lingua-read-client/src/components/shared/LinkButton.tsx](client/lingua-read-client/src/components/shared/LinkButton.tsx) — `LinkButton` default export + `LinkDropdownItem` + `LinkListGroupItem` wrappers.
- [client/lingua-read-client/src/__tests__/useAudiobookPlayer.test.js](client/lingua-read-client/src/__tests__/useAudiobookPlayer.test.js) — 10 smoke tests.

### Touchpoints (F.7 + F.8)

- [client/lingua-read-client/src/components/WordLookupPopover.tsx](client/lingua-read-client/src/components/WordLookupPopover.tsx) now exports `ExistingWord` (was an internal `interface`).
- [client/lingua-read-client/src/utils/store.ts](client/lingua-read-client/src/utils/store.ts) — `LibraryFolder.name`, `LibraryBook.title`, `LibraryText.title`, etc. widened to `string | null` to match the API. No consumer changes needed (F6 already added `?? default` guards).

---

## Outstanding debt (not addressed in F.7 / F.8)

### Remaining `eslint-disable no-explicit-any` (47 total, top concentrations)

| File | Count | Notes |
|---|---|---|
| `pages/TextDisplay.tsx` | 15 | Mostly `setWords((prevWords: any[]) =>)` clusters, segment-related (lines ~1165, 1182), some keyboard-handler `any` |
| `pages/SrsReview.tsx` | 0 | ✅ cleared in F.7 |
| `pages/SrsStoryReview.tsx` | 0 | ✅ cleared in F.7 |
| `pages/Dashboard.tsx`, `pages/Library.tsx`, `pages/BatchAudioCreate.tsx`, `pages/UserSettings.tsx` | 0 each | ✅ cleared in F.8 |
| `utils/store.ts` | 0 | ✅ cleared in F6 |
| 25 other files | 1–3 each | Mostly local escape hatches: `reportWebVitals.ts` (2), `hooks/useReaderState.ts` (3), `LanguageForm.tsx` (2), `UserSettings.tsx` component (2), one runtime-augmentation flag (`__lrAllowPlayback` on HTMLAudioElement) |

### Items still tracked for future

- `useAudiobookPlayer.ts` is 1,059 LOC bundling 4 orthogonal concerns (progress sync, segment playback, listening activity, audio element wiring). Not split. See **Phase G** below.
- `react-bootstrap` × `react-router-dom` typing clash is contained in `LinkButton.tsx`'s `LooseAs = any` cast. A library upgrade (e.g. react-bootstrap v3 or a `react-router-bootstrap` adoption) could remove it, but is out of scope.

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

1. **Manual golden-path verification** in `npm run dev`:
   - Login + setup flow.
   - Library: drag-drop a book/folder, multi-select, move-to-folder, rename folder.
   - Reader: open a text, click a word, save translation, mine sentence, use 1–5 keyboard shortcuts.
   - **Audiobook playback** (most sensitive): start, seek, segment transition, switch lesson↔book modes. Open the same content in a second tab and confirm cross-device sync still restores position.
   - SRS review (card mode + story mode): grade 1–5 via keyboard, flag a card, confirm word-lookup tooltips render on non-target words in story mode.
   - Settings page read + write (theme, OpenRouter token, Discord webhook).
   - BatchAudioCreate fuzzy-match: drop mixed mp3+srt files, confirm pairing.
2. **Merge `typescript` branch to `main`** when satisfied. F1–F6 + F.7 + F.8 are all independently revertable.
3. **Residual cosmetic follow-ups** (only ~5 files have 2+ disables now):
   - `pages/TextDisplay.tsx` (15) — segment-rendering keyboard handlers; needs more invasive refactor.
   - `hooks/useReaderState.ts` (3), `components/UserSettings.tsx` (2), `components/settings/LanguageForm.tsx` (2), `pages/TextCreate.tsx` (2), `pages/TermsPage.tsx` (2), `reportWebVitals.ts` (2), `components/statistics/ActivityHeatmap.tsx` (2) — opportunistic when those files get touched.
4. **Phase G** when audiobook playback work is on the roadmap.
