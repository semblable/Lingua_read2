# Isolated reader interaction experiment

The page at `/interaction.html` belongs to the loopback browser-test root. It is
not imported by production, the demo, or private preview fixtures. Content is
authored synthetic prose; its status endpoint exists only in the dedicated
Playwright request mock. Start the fixture with
`npx vite --config vite.browser.config.ts` for manual reading/AT evaluation.

The experiment uses the real `StandardTextView`, `SentenceModeView`, and
`AudioTranscriptView` components. Its synthetic content adapter walks
`prepareLanguageContext` / `consumeWordAt`, longest-first saved phrases, and the
existing Korean alias/source-span helpers. Coordinates describe UTF-16 units in
the renderer's substituted text, including sentence-seam NFC composition. They
are temporary navigation coordinates. No tokenizer version, persisted word ID,
normalization behavior, or occurrence count is changed.

## Controller seams

`src/utils/readerInteraction.ts` is a pure reducer. The supplied registry contains
only the actual top-level rendered units in logical source order. A rendered
phrase is one stop; inner words/overlapping alternatives are not hidden stops.
`createReaderOccurrence` validates the exact renderer slice and surrogate bounds.
Its ID combines generation, block/cue identity, and source span. Supply a new
generation after route/content/tokenization/presentation changes; same-generation
status/style rerenders retain anchors. No automatic term-based reanchoring occurs.

`src/hooks/useReaderInteraction.ts` owns DOM effects outside the reducer. Its
`passageProps` and `getOccurrenceProps(occurrence)` provide one passage Tab stop.
Direct entry and the native Interact control use `enter()`. Arrow keys and native
Previous/Next call `move(delta)`; native controls can pass `false` to keep their
own focus. Explicit native status/lookup controls call `enter(false)` before
`setStatus`/`openLookup` to resume the remembered keyboard target after natural
passage exit. A new pointer target never changes the keyboard roving stop or DOM
focus. Only a pointermove with changed coordinates (or reported first-event
movement) over a registered unit takes shortcut ownership.

`onStatusIntent` receives a synchronously captured `{generation, occurrenceId,
entityKey, term, sentence, languageCode, status}`. Adapt `entityKey`/`term` through
the existing exact/lemma vocabulary resolution before calling the production
mutation coordinator. The reducer contains no save state, translation, study
credit, audio seeking, or persistence logic. The fixture's tiny mocked save UI is
not evidence for production offline replay, create deduplication, SRS, or rollback.

The `ensureOccurrenceMounted(occurrence, signal)` adapter mounts/scrolls a virtual
source row, without seeking audio. Focus restoration validates generation and
request sequence after awaiting it. A missing/obsolete occurrence falls back to
the passage entry. Modal focus containment, inert background, named lookup, Close,
and Escape belong to the lookup presentation; the spike demonstrates that seam
with a portal dialog. Production transcript row pinning and playback-follow
coordination still need integration. The spike defers simulated follow while
interacting and provides an explicit full-transcript comparison, rendering one
representation at a time.

## Evidence and open decisions

On Windows, 2026-11-13, the 20 focused reducer/controller tests passed. Seven
Playwright cases passed at 1280 CSS px and at a narrow **desktop** 320 CSS px
viewport (14 passes). They cover both entry paths, natural Tab/Shift+Tab exit,
pointer A → keyboard B → status B → stationary rerender → repeated-occurrence
lookup return, deliberate hover resumption, direct/native status writes, native
input/IME/repeat guards, rejected synthetic writes/retry, logical phrase/RTL order,
Korean aliases, generation/view changes, and real virtual-row unmount/remount.
No navigation/lookup request can reach a translation, playback or study endpoint:
the interaction fixture permits only its exact synthetic status POST. The existing
layout fixture's mutation denylist remains unchanged.

An additional scoped axe case covers normal, focused, lookup, late rejection
inside lookup, and returned error states. Browser versions and project names are
recorded as Playwright test annotations. Axe results supplement the browser
observations; they do not establish screen-reader speech or key delivery.

The marker selector compares current color presentation, four learning-stage
decorations (solid/dashed/double/wavy), and a stronger candidate with visible
Untracked circles and learning-stage numerals. Known and Ignored stay plain.
Screenshot output for first-read density and mixed scripts is written under the
marker test's `test-results/browser/` directory at desktop 320/1280 widths. These
are candidates, not a chosen production default or a legibility claim. The
stronger candidate intentionally exposes the density cost for review.

The lookup is an authored placeholder. The spike does not establish production
translation preferences, child-word access within phrases, phrase extension,
touch selection, dictionary behavior, or study/playback side effects. Those
existing workflows still require their own regression and manual checks before
production interaction integration.

NVDA/Chrome, NVDA/Firefox, JAWS, VoiceOver/Safari, mobile VoiceOver, continuous
read-all speech, Browse/Focus mode key delivery, announcement timing, real browser
200%/400% zoom, physical touch/copy/selection, native-script review, color-vision
simulation and learner review are **untested**. Browser DOM focus assertions do
not establish those outcomes. No application role is used, and ordinary prose
does not become hundreds of native word buttons. Production keyboard/ARIA
integration and a final marker decision remain gated by the manual evidence in
`docs/ACCESSIBILITY_IMPLEMENTATION_PLAN.md`.

Run the focused checks from the client directory:

```powershell
npm test -- --run src/__tests__/readerInteraction.test.ts src/__tests__/useReaderInteraction.test.tsx
npm run test:browser -- interaction.spec.ts --project=chromium-1280 --project=chromium-desktop-320
```

The full browser suite also exercises mobile-emulation widths; those runs are
separate from physical-device or assistive-technology evidence.
