# Accessibility implementation plan

Updated: 2026-11-14. Status: implementation in progress; automated foundations,
save coordination, shared presentation, and opt-in themes are implemented.
Production word-navigation semantics remain gated on the manual AT spike.
See [implementation evidence and remaining gates](ACCESSIBILITY_VERIFICATION.md).

Regression review covers deletion/recreation, cross-passage offline replay,
automatic translation retry, and a fresh Settings preview. Their fixes and
verification are recorded with the implementation evidence.

Deliver a keyboard-operable language reader and optional High Contrast Light/Dark
themes while keeping the existing reading experience familiar. This plan separates
user constraints from recommendations and prototype decisions. The supplied report
and subsequent feedback are advisory inputs, not an approved specification.
The report is titled "Engineering Colorblind-Accessible UI/UX: A Technical and
Design Systems Blueprint"; this plan records the proposed product scope separately.

## 1. Constraints and scope

- Preserve hover plus `1`-`5` and `I` for changing word status. Keyboard navigation
  adds a way to target vocabulary; it must not replace the hover workflow.
- Preserve the appearance and defaults of Light, Dark, and Classic Dark as much as
  practical. Limit shared visual changes to demonstrated legibility, focus,
  link-identification, and chart-understanding problems. Capture intended changes.
- Name the new themes **High Contrast Light** and **High Contrast Dark**. Keep
  keyboard access, semantics, motion preferences, and responsive behavior shared.
- Keep Known and Ignored plain in passages. Exact learning-status markers and the
  Untracked treatment require dense-passage evaluation before being finalized.
- Preserve native text selection, copying, touch selection, phrase extension,
  language-aware lookup, existing translation preferences, SRS rules, bookmarks,
  reading credits, playback, and offline synchronization. Navigation alone must
  not translate, create vocabulary, seek audio, or award study credit.
- Do not change tokenizer version, vocabulary IDs, normalization contracts, or
  persisted occurrence counts to implement navigation. Follow the preservation
  contracts in [the language roadmap](LANGUAGE_SUPPORT_PLAN.md).
- Use WCAG 2.2 AA as the engineering target for the affected workflows. Do not
  claim whole-app conformance from contrast calculations, axe, or this project.

The first release covers reader interaction, saves and announcements, focus and
reflow, reduced motion, the two new themes, and essential presentation fixes.
Reading rulers, new special-purpose fonts, automatic captions, configurable
granularity shortcuts, and a wholesale palette/color-space migration remain
follow-up ideas. Existing font, spacing, width, sentence mode, and TTS controls
should be made discoverable without duplicating their functionality.

## 2. Current implementation and change locations

Paths below are relative to the repository root. Proposed files are explicitly
marked; existing files should be reused rather than introducing a second reader.

| Area | Existing implementation | Planned seam |
| --- | --- | --- |
| Passage tokens, phrases, lookup, status writes, mobile sheet | `client/lingua-read-client/src/pages/TextDisplay.tsx` | Extract interaction and mutation coordination; retain existing language/lookup behavior. |
| Hover status shortcuts | `client/lingua-read-client/src/hooks/useReaderKeyboard.ts`, `src/utils/keyboard.ts` under the client | Route events through one target resolver; retain input/modifier guards and add composition/dialog guards. |
| Segmentation and phrase selection | `client/lingua-read-client/src/utils/readerText.ts` | Reuse boundaries, source mappings, and phrase selection. Do not split on whitespace or traverse DOM text fragments as linguistic words. |
| Reader presentations | `client/lingua-read-client/src/components/reader/StandardTextView.tsx`, `SentenceModeView.tsx`, `AudioTranscriptView.tsx`, `TranscriptLine.tsx` | Share occurrence registration and focus behavior across views. Audio transcript rows are virtualized. |
| Word information and status controls | `client/lingua-read-client/src/components/reader/WordInfoPanel.tsx`, `src/types/wordStatus.ts` | Reuse labels and actions; provide discoverable entry/exit and native navigation alternatives. |
| Word persistence | `client/lingua-read-client/src/utils/api/words.ts`, `src/hooks/useSyncedWordIdentities.ts`, `src/utils/offline/enqueueIfOffline.ts`, `syncQueue.ts`, `handlers.ts`, `events.ts` | Distinguish pending, server-confirmed, queued offline, and rejected writes. Retain existing replay/coalescing behavior and guard background refreshes. |
| Themes and settings | `client/lingua-read-client/src/App.tsx`, `src/pages/UserSettings.tsx`, `src/contexts/SettingsContext.tsx`, `SettingsProvider.tsx`, `src/components/settings/AppearanceSettings.tsx`, `ReadingSettings.tsx` | Centralize theme application and extend preference persistence consistently. |
| Shared presentation | `client/lingua-read-client/src/index.css`, `src/pages/TextDisplay.css`, `src/components/Navigation.css`, `src/components/TranslationPopup.tsx`, `src/components/statistics/ActivityCharts.tsx`, `ActivityHeatmap.tsx`, `Statistics.css` | Scope contrast, focus, inline-link, chart, and forced-colors improvements; isolate the new theme rules. |
| Browser verification | `client/lingua-read-client/browser-tests/`, `vite.browser.config.ts`, `playwright.config.ts` | Extend the isolated synthetic harness; existing layout fixtures reject writes and external requests. |

Confirmed starting points from source inspection:

- Learning statuses 1-4 differ by background fill; the panel already exposes a
  named status and numbered status controls. Status 0 is Untracked; 1-4 are New,
  Learning, Familiar, Advanced; 5 is Known; 6 is Ignored.
- The base white-on-turquoise primary-button pair calculates to about 2.41:1.
  Some light-theme translation foreground/background pairs calculate below 2:1.
  Recheck computed styles on the actual components, including overrides and alpha
  compositing, before choosing a fix.
- Theme application is duplicated between startup and settings. Merely adding
  select options would leave some entry paths using the old fallback behavior.
- Status shortcuts currently use a hovered term and can fetch a translation.
  Preserve intended translation behavior while separating movement from mutation.
- Existing browser projects cover Chromium at 320/390/430/1280px. They do not
  establish NVDA, JAWS, VoiceOver, real browser zoom, or continuous reading support.

## 3. Delivery sequence

Each slice should remain independently reviewable. The sizes describe relative
scope, not calendar estimates. Checked items indicate implemented automated work;
they do not replace the manual exit criteria or establish accessibility conformance.

| Slice | Deliverable | Dependency | Scope |
| --- | --- | --- | --- |
| 0 | Baseline captures, interaction contract, synthetic fixtures | None | Small |
| 1 | Shared interaction prototype and screen-reader/marker spike | 0 | Medium; highest uncertainty |
| 2 | Reliable status mutation coordination and feedback | 0; incorporate findings from 1 | Medium |
| 3 | Production keyboard interaction and focus restoration | 1 and 2 | Large |
| 4 | Shared focus, reflow, reduced motion, essential legibility | 0; coordinate reader work with 3 | Medium |
| 5 | High Contrast themes, chosen markers, settings integration | Marker decision from 1; foundation from 4 | Medium |
| 6 | Integrated verification, documentation, release evidence | Relevant slices above | Medium |

Shared legibility and layout fixes can progress while manual AT results are
pending. Production word-interaction semantics require the spike results first.
Do not mark a slice verified when its required manual checks remain untested.
Select the primary release browser/AT combinations in slice 0. The wider manual
matrix records coverage and limitations; each support claim needs its own evidence.
Theme palettes can ship after their visual/layout verification without waiting for
keyboard integration. Marker defaults depend on their visual experiment, not on
completion of every AT combination.

## 4. Slice 0: establish the baseline and a minimal interaction model

- [x] Record current hover/shortcut behavior, clicks, phrase selection, panel
  actions, translation settings, and status/offline behavior using synthetic data.
- [x] Capture all three existing themes at desktop and narrow widths, covering
  classic/modern reading, sentence mode, and audio transcripts. Use an almost
  entirely Untracked first-read passage as well as a mixed-status passage.
  The starting-revision baseline was reconstructed from a verified Git archive;
  see the evidence notes for capture scope and provenance.
- [x] Write a pure interaction reducer and its invariants. Implemented locations:
  `client/lingua-read-client/src/utils/readerInteraction.ts` and
  `src/hooks/useReaderInteraction.ts`. Keep DOM focus, network effects, and
  announcements outside the reducer.

### Provisional state contract

Use one controller for pointer shortcuts, passage Tab entry, and the explicit
"Interact with words" control. Entry mechanisms dispatch the same action; they
must not have separate targeting, saving, or announcement implementations.

State includes:

- `mode`: `reading`, `interacting`, or `lookup`.
- `inputOwner`: pointer or keyboard; pointer and keyboard occurrence references
  are remembered separately, with exactly one derived shortcut target.
- A passage-instance/generation identifier and occurrence registry.
- A lookup return anchor and the mode to resume after dismissal.
- Save state by vocabulary entity, separate from interaction mode. A pending save
  must not put the whole passage into a disabled or "saving" navigation mode.

| Event | Transition / required effect |
| --- | --- |
| Tab enters the passage, or explicit interaction control activates | Enter `interacting` through one action; focus the remembered valid navigation occurrence, otherwise the first selectable occurrence; expose the same instructions and status. |
| Keyboard navigation | Keyboard owns shortcuts; move within the occurrence registry, preserve logical order, and bring the target into view without lookup or translation. |
| Actual pointer movement over a token | Pointer owns shortcuts again. Hover does not move DOM focus. Scroll, rerender, or `pointerenter` beneath a stationary pointer must not retarget keyboard actions. |
| Status key | Resolve and capture the eligible target, vocabulary identity, status, and sentence context synchronously; dispatch a save; retain reading/navigation position. |
| Explicit lookup activation | Capture return anchor; open lookup. Move focus inside when lookup is modal. Native controls/editable text retain their own Enter/Space behavior. |
| Escape from lookup | Dismiss, remount the return occurrence if necessary, and restore focus before resuming interaction. |
| Escape from word interaction | Return to ordinary reading at the passage entry point; retain the navigation anchor in memory. |
| Tab/Shift+Tab from the passage | Leave naturally; do not loop through hundreds of tokens or redirect focus back into the passage. |
| Retokenization, content change, or route change | Invalidate obsolete occurrence references. Re-anchor only with a validated source mapping; otherwise return safely to the passage entry. Ignore stale UI effects from the old generation. |

Hover-based shortcuts remain available in ordinary reading. Typing, IME
composition, native controls, text-selection gestures, and modal ownership must
take precedence over passage shortcuts. Suppress repeated status writes from a
held key; allow intentional repeated navigation. Provide a setting to disable
character-only reader shortcuts, defaulting to the existing enabled behavior.

Keep actual DOM focus visible even when pointer movement changes the shortcut
target. Hover must not change the roving Tab stop and introduce another passage
Tab stop. Test the distinction between the focused token and pointer target.

### Occurrences and phrase traversal

- Derive occurrence identity from the passage instance/generation, block/cue
  identity, and validated source-span coordinates. Retain it through ordinary
  status/style rerenders; do not generate new identities on every React render.
- Never persist occurrence IDs in settings, bookmarks, exports, or vocabulary.
  Persistent vocabulary identity and temporary navigation identity are different:
  two occurrences can share one saved word while requiring different focus anchors.
- Keep coordinates aligned with the current renderer/tokenizer's UTF-16 mapping,
  including substitutions and supplementary characters. Do not guess offsets by
  searching for the first occurrence of a term.
- First-version proposal: traverse the actual top-level selectable units once in
  logical source order, honoring existing longest-first phrase matching and Korean
  alias resolution. A rendered phrase is one unit; inner words and overlapping
  alternative phrases are not additional hidden arrow stops.
- Preserve phrase extension and native range selection. Expose child-word access
  through the existing lookup/selection mechanisms where available; validate that
  this is sufficient in the spike before adding a granularity mode.
- Candidate binding: Right = next in LTR, Left = next in RTL, based on passage
  direction; reverse for previous. Mixed-direction passages retain source order.
  Native Previous/Next controls use the same actions. Initially leave Up/Down for
  ordinary scrolling and retain existing sentence controls. Final bindings depend
  on AT and multilingual testing; do not add letter shortcuts by default.

Exit: the contract has focused invariant tests and no unresolved disagreement about
which token a status command affects. Key delivery/ARIA details remain provisional.

## 5. Slice 1: test the reading/interaction boundary and marker candidates

- [x] Add a small spike entry under the existing isolated browser-test root, using
  wholly authored synthetic passages and the shared controller. Keep it outside
  production/demo entry points; do not use the private local preview fixtures.
- [x] Exercise both entry paths, Tab exit, word movement, direct status updates,
  explicit lookup, and focus return. Use the same events for native buttons and
  keyboard shortcuts.
- [ ] Test normal paragraph reading and "read all" through long content. Include
  the virtualized transcript boundary: offscreen rows may be absent from the DOM.
- [ ] Test how keys reach the page in Browse/Focus/interaction modes. Roving
  `tabindex` alone is not evidence of AT compatibility. Do not assume the page can
  obtain the screen reader's virtual-cursor word from DOM focus or selection.
- [ ] Keep a native-control route through Previous/Next word, status selection,
  lookup, and exit. Choose production semantics after testing; avoid a blanket
  application role or hundreds of word buttons in ordinary prose.
- [ ] If virtualized text prevents continuous reading, compare an explicit
  nonvirtual reading presentation or a suitable accessible rendering strategy.
  Expose one reading representation at a time and preserve performance. Do not
  conceal a duplicate interactive passage with ARIA as a quick workaround.

Marker experiments are design work, not a committed five-style scheme:

- Compare current presentation, four learning-stage decorations, and a stronger
  complete non-color presentation. Keep Known/Ignored plain in every candidate.
- Treat a tint as color encoding, not a non-color distinction for Untracked.
  Evaluate a subtle visible Untracked cue against the clutter it creates when
  nearly every token is unfamiliar. Hover, keyboard focus, and tap must all make
  the exact status available without relying on hover alone.
- Try text-decoration offset/ink skipping instead of borders where suitable.
  Validate Latin descenders/combining marks, Arabic/Hebrew marks, CJK/Thai/Korean,
  mixed scripts, and supported annotations. Do not assume superscripts, dot counts,
  underlines, or ink skipping are universally legible.
- Record the chosen default, any stronger opt-in presentation, and remaining
  limitations. The marker option must work independently of palette selection.

Exit: record browser/AT versions, entry/exit behavior, speech flow, and key-delivery
results. Choose semantics, first-version phrase behavior, and marker treatments
from evidence. Untested AT combinations remain explicitly unverified. A text-only
fallback can be a useful shipped option only after its interaction route is tested.

## 6. Slice 2: coordinate status writes, failures, and announcements

- [x] Extract mutation coordination, implemented as
  `client/lingua-read-client/src/hooks/useWordStatusMutations.ts`. Hover, keyboard,
  and panel status actions share it while retaining each action's intended behavior.
- [x] Resolve a stable vocabulary entity using existing exact/lemma lookup rules.
  Before a server word ID exists, use the language-scoped resolved identity;
  transfer its pending state when creation returns an ID. Do not merge distinct
  saved rows merely because a folded lookup key happens to match.
- [x] Keep at most one in-flight write per entity and preserve later explicit
  changes in order. Different words remain independently editable. Retain existing
  offline coalescing; do not add broader write coalescing without checking SRS and
  phrase side effects. Avoid duplicate creates for rapid edits to an unsaved word.
- [x] Track desired status, last confirmed status, request sequence, and whether a
  change is queued offline. Apply immediate local feedback; update all occurrences
  of that vocabulary entity without moving the navigation cursor.
- [x] A rejected latest write reverts to the last confirmed status when no newer
  intent exists. A stale response/failure cannot overwrite a newer desired status.
  Continue or fail later queued intentions explicitly rather than dropping them.
- [x] Background identity refreshes and reconnect reads must not overwrite pending
  local intent. Reconcile confirmed data with the per-entity desired state rather
  than replacing the reader's whole word list with a stale snapshot.
- [x] Offline enqueue retains the local desired status and says "Queued offline";
  it is not server confirmation and should not trigger a rollback. Reconcile after
  replay and retain actionable failures. Do not blindly clear all pending statuses
  on a generic sync-complete notification.
- [x] Preserve translations, sentence context, and configured translation behavior;
  status changes must not overwrite a newer translation with an empty/stale panel
  value. Unrelated translation work must not globally disable navigation or saves.
- [x] Protect UI updates after unmount/generation change while allowing already
  issued legitimate writes or queued offline work to complete correctly.

Use one concise polite feedback region, not a live passage. Debounce/coalesce
announcement output during rapid triage, not the different-word save intentions.
Announce the word plus status on interaction entry when needed, and short status
changes such as "Familiar" while context is clear. A later error identifies its
word, for example "Could not save rivière. Retry." Keep failures visible/reachable
even if speech is superseded; do not steal focus. Test speech timing with AT.

Exit cases include `3`, Next, `4` before either write resolves; multiple changes to
one entity; reversed responses across different words; a failed older request;
duplicate terms in a passage; offline create followed by status edits; replay
failure; and late translation responses. Holding a number key creates no write storm.

## 7. Slice 3: integrate keyboard navigation and lookup focus

- [ ] Connect the tested model to all reader presentations through one registry and
  shared hooks. Avoid adding more independent event/state branches to TextDisplay.
- [ ] Keep one passage Tab stop. Reuse the same entry transition for direct Tab
  entry and the explicit native interaction control. Keep help and exit discoverable.
- [ ] Retain hover behavior and the keyboard/pointer precedence contract. Navigation
  is local; status changes save directly; lookup opens only on explicit activation.
- [ ] Use occurrence-based focus restoration for repeated terms and phrases.
  For virtualized audio rows, mount/scroll the intended row before focusing it;
  keep the focused row available. Playback follow/scroll must not steal focus or
  discard the active anchor. Navigation itself must not seek or start playback.
- [x] Make the narrow-layout lookup sheet a complete modal interaction: named
  dialog, visible Close control, Escape, contained focus, inert background, and
  exact focus return. Retain normal access to a nonmodal desktop panel. Automated
  checks cover this lifecycle; the manual AT/touch matrix remains outstanding.
- [ ] Handle content edits, sentence/view changes, resizing while lookup is open,
  removed occurrences, and text-route changes with safe focus fallback.

Exit: full keyboard triage works without opening lookup; users can leave the
passage immediately with Tab; both entry paths produce the same behavior; touch
selection/copy, phrase selection, translations, and playback remain usable.

## 8. Slice 4: shared presentation, responsive layout, and reduced motion

- [ ] Fix demonstrated contrast issues using computed foreground/background pairs
  and alpha composition. Start with button text and translation segments; preserve
  existing hues where a readable foreground or narrowly scoped override suffices.
- [x] Underline inline prose links persistently. Avoid applying the treatment
  indiscriminately to navigation, card headings, or button-styled links.
- [ ] Give meaningful selected states a visible cue beyond hue. Provide robust
  `:focus-visible` indicators and forced-colors borders/icons; verify clipping and
  sticky-header obscuration. Keep focus-ring styling out of the theme gate.
- [ ] Combine target sizing and reflow in one layout pass. Meet the 24 CSS px
  minimum or its spacing/equivalent exceptions for relevant controls; aim for
  comfortable touch targets where space permits. Inline passage tokens retain the
  inline-text exception rather than receiving artificial button-sized padding.
- [ ] Wrap/reflow toolbars and collapse lookup based on available space. Test large
  text plus zoom together, including the on-screen keyboard and modal dismissal.
- [x] Respect OS reduced motion in CSS and JS scroll APIs, including transcript
  follow, sentence scrolling, and focus restoration. Keep navigation usable when
  smooth motion is disabled. Reuse existing motion handling where available.
- [x] Retain existing dashed comparison lines. Add labels, separators, patterns,
  or an accessible data alternative where charts otherwise depend on hue. Make
  heatmap values available through keyboard/touch as well as hover, without adding
  hundreds of unnecessary Tab stops. Validate themes and forced colors.

Exit: record the small intended visual differences in existing themes. Normal text
meets 4.5:1, large text 3:1, and necessary control/graphic cues 3:1 in the checked
states. Layout remains usable with larger controls, text, and reduced motion.

## 9. Slice 5: High Contrast themes and preference persistence

- [x] Centralize theme resolution/application for app startup, authenticated views,
  login/setup, settings changes, system changes, and test/demo paths. Remove only
  known theme classes; preserve independent presentation/state classes.
- [x] Add two opt-in theme values and scoped token/CSS rules. Preserve current
  defaults. Computed-state checks cover representative controls and translations.
- [ ] Complete the rendered-state review of body, surface, border, text, link,
  action, selection, status, translation, and chart colors, including the manual
  contrast-theme and multilingual checks.
- [ ] Implement the chosen marker design behind an independent preference. Candidate
  styles are implemented as an experimental on/off preference, default off in
  every theme. Final marker selection/defaults remain gated on slice 1 review;
  do not introduce multiple deficiency presets. The shared styles must also load
  for a direct Settings visit without first opening the reader.
- [x] Add the character-shortcut enable/disable preference with the existing hover
  shortcuts enabled by default. Respect native inputs, dialogs, IME, and modifiers
  regardless of that preference.
- [x] Update all settings seams together: `SettingsContext` defaults/merge,
  `SettingsProvider` cache, settings-page initial values and patch allowlist,
  `useSettingsSaver`, API types, and demo/browser fixtures. Use the existing shared
  settings write queue so late responses cannot overwrite newer preferences.
- [x] For new persisted preferences, update
  `server/LinguaReadApi/Models/UserSettings.cs` and
  `server/LinguaReadApi/Controllers/UserSettingsController.cs` DTOs/read/write mapping;
  add an additive migration and active model snapshot when new columns are needed.
  Check the repository's historical split migration directories before generating.
  New theme values alone should not require new columns in the existing string field.
- [x] Regenerate `client/lingua-read-client/src/utils/api-types.d.ts` with
  `npm run api:types` from the updated local Swagger schema; do not hand-edit the
  generated contract. Cover missing/old preference values and reload round trips.
- [x] Group existing reading-comfort settings and the new options with a small
  synthetic preview and concise help. Avoid implying a particular font or palette
  solves all reading/accessibility needs. Do not add global screen filters.

Exit: preferences survive local reload and server round trip, and produce
consistent pre-auth/app appearance. Cached preferences render correctly offline;
settings write failures remain visible under the existing contract. This work
does not introduce a new offline settings-write queue or label a rejected write saved.
Test Light, Dark, Classic Dark, both High Contrast variants, and System Default.

## 10. Verification and release evidence

### Automated

- [x] Add meaningful reducer tests for entry equivalence, modality precedence,
  invalid generations, target snapshots, phrase order/RTL, and exit behavior.
- [x] Extend hook/API/offline tests for request ordering, rollback, create-to-ID
  transitions, translation preservation, replay reconciliation, and speech-output
  consolidation. DOM assertions establish emitted messages, not what AT speaks.
- [ ] Add dedicated reader-interaction Playwright fixtures/specs using the existing
  isolated root. Permit only narrowly mocked intended word/settings writes;
  retain the existing layout fixture's mutation denylist. Simulate delays,
  failures, offline behavior, and duplicate terms with wholly synthetic data.
- [x] Cover pointer resting on A -> keyboard moves to B -> status changes B ->
  rerender/scroll under the stationary pointer -> lookup -> Escape returns to B.
  Then move the pointer deliberately and confirm hover shortcuts resume.
  This interaction check currently applies to the isolated shared-controller
  spike; production word navigation remains gated on manual AT results.
- [ ] Cover rapid `3`, Next, `4`; same-word edits; modal/native-input guards;
  retokenization; view changes; virtualized row unmount/remount; playback follow;
  focus restoration on an exact repeated occurrence; and phrase/RTL traversal.
- [x] Add `@axe-core/playwright` as a test-only dependency when implementing scans.
  Run scans in representative normal, focused, lookup, error, and theme states;
  update lockfile/notices as required. Do not treat an axe pass as proof of
  continuous reading, non-color usability, or actual AT focus behavior.
- [x] Extend theme/layout coverage to new themes, forced colors, and live motion
  preference changes. Verify computed contrast with full ancestor compositing;
  the current helper is not a complete contrast audit.
- [ ] Include a narrow **desktop** viewport, not only the current mobile-emulation
  projects. Check 320 CSS px reflow and user text-spacing overrides; separately
  perform real browser zoom checks. CSS zoom or viewport emulation alone is not
  evidence that the browser's actual zoom behavior has passed.

### Manual matrix

Record revision, date, OS, browser/AT versions, settings, fixture, outcome, and
remaining issue for every run. An unavailable environment is **untested**, not passed.

| Environment | Required observations |
| --- | --- |
| NVDA with Chrome and Firefox on Windows | Continuous paragraph/read-all flow, both entry paths, key delivery, concise announcements, status failures, Tab exit, modal focus return, virtualized transcript boundaries. |
| JAWS with Chrome or Edge on Windows | Repeat the interaction/read-flow checks; confirm mode entry and exit rather than assuming NVDA behavior transfers. |
| VoiceOver with Safari on macOS | Reading/interaction boundary, rotor/reading order, native alternatives, focus return, repeated words, long transcript reading. |
| Mobile Safari with VoiceOver and a physical touch device | Touch reading/lookup, sheet sizing, dismissal, on-screen keyboard, copy/selection, large text. Record touch checks separately from desktop keyboard checks. |
| Desktop browser at 200% and 400% zoom; Windows contrast theme | Passage width, toolbar reflow, modal sizing, focus visibility, system-color adaptation, no hidden controls. |
| Grayscale and protan/deutan/tritan simulation; multilingual visual review | All required status/chart information remains understandable; first-read density, diacritics, marks, and supported annotations remain readable. Simulation is supplemental evidence, not user testing. |

Use original short fixtures for Latin marks/descenders, Arabic/Hebrew and mixed
direction, Chinese, Japanese, Korean, and Thai; include long text, repeated words,
saved/overlapping phrases, numeric tokens, mixed statuses, and mostly-Untracked text.
Do not change import behavior to add annotations solely for the test. Include a
color-vision-deficient learner's usability review when available; record its absence.

### Commands and documentation

Follow [CONTRIBUTING](../CONTRIBUTING.md) and the existing
[browser-test instructions](../client/lingua-read-client/browser-tests/README.md).
After each slice, run focused tests for its changed behavior. Before release, from
`client/lingua-read-client` run:

```powershell
npm run lint
npm run typecheck
npm test -- --run
npm run test:browser
npm run build
```

If shared settings/components affect the demo, also run `npm run demo:test` and
`npm run demo:build`. For API/schema changes, from the repository root run:

```powershell
dotnet restore Lingua_Read.sln
dotnet build Lingua_Read.sln -c Release --no-restore
dotnet test Lingua_Read.sln -c Release --no-build
```

Test additive migrations against a disposable local database and verify settings
round trips. Report skipped integration tests and actual environment limits. Add
focused browser checks to the existing CI workflow without including spike/private
fixtures in production artifacts. Update settings/feature/browser documentation
when behavior lands, preserving unrelated edits currently present in those files.

Release the work in small slices. Keep old theme values/defaults compatible, make
new visual preferences opt-in, and record expected screenshots and manual results.
Removing an experimental presentation should not delete vocabulary or queued work.
Ship the keyboard/AT claim only for verified combinations; publish remaining limits
alongside the corresponding feature rather than declaring the entire app accessible.

## 11. Reference criteria

The report's numeric examples and legal statements are not implementation authority.
Use the actual computed UI and these primary references:

- [Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- [Text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
  and [Non-text Contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [Keyboard-interface practices](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)
  and [Character Key Shortcuts](https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html)
- [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
  and [Modal Dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- [Reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html),
  [Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html),
  [Target Size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html),
  and [Animation from Interactions](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
- [ARIA testing cautions](https://www.w3.org/WAI/ARIA/apg/practices/read-me-first/#browser-and-assistive-technology-support)
  and [NVDA Browse Mode](https://download.nvaccess.org/documentation/userGuide.html#BrowseMode)

Focus appearance and interaction-animation criteria include AAA guidance; useful
design targets do not become additional AA requirements merely by being listed here.
