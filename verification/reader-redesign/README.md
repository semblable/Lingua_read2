# Reader redesign verification

Date: 2026-11-15

## Delivered behavior

- Removed **Finish (no stats)** and **Mine / Mine sentence** from the reader.
- Added one **Aa / Appearance** popover, with readable setting names and advanced density/panel-width controls. Transcript flow and alignment share that popover.
- Moved Library/Book navigation beside the title, separated completion from reading tools, and moved All Known into More lesson actions.
- Compacted Word Info, moved AI actions beside the definition, retained a two-line expanding field, and made vocabulary grades the status indicator.
- Added a persistent outline around the exact inspected token or phrase, including Known words, repeated occurrences, saved phrases, and remounted audio cues.
- Saving a learning word automatically retains its first valid example and source, including existing vocabulary and offline replay. Existing review schedules and SRS preferences are preserved; automatic creation remains the default, with an opt-out.
- Clicks and hover shortcuts resolve the actual source sentence, including repeated words in flowing audio and sentences that continue across subtitle cues.

## Independent review

An agent separate from the implementation authors reviewed the final change. The review found and verified fixes for mobile line spacing, hovered-word sentence provenance, quadratic selection-marker work, and repeated-word sentence selection in flowing audio. Final review reported no remaining actionable issues.

Visual inspection also corrected textarea padding being counted twice, an overly narrow desktop sidebar, bright utility surfaces caused by global button overrides, incomplete status-button borders in high-contrast themes, and low-contrast mobile Menu/Close controls in the light theme.

## Automated results

| Check | Result |
| --- | --- |
| Full client suite | **2,191 passed**, no failures or skips |
| Focused backend regressions | **85 passed**, including 21 new automatic-example cases |
| Demo tests | **8 passed** |
| Browser regression matrix | **185 passed** |
| Final reader/theme checks | **35 passed** after the last mobile contrast correction |
| Client and browser TypeScript checks | Passed |
| Production build and asset/license checks | Passed |
| Demo build and license checks | Passed |
| ESLint | Passed, 0 errors and 34 existing warnings |
| Diff whitespace check | Passed |

Browser coverage includes real reader, sentence, and audio components, save ordering and retry behavior, keyboard focus, Escape/focus return, selected occurrences, phrase expansion, settings changes, 4.5:1 grade/header-text contrast, axe scans, forced colors, text spacing, and root/component overflow.

The configured browser projects cover 320, 390, and 430px phones, a 1280px desktop, and a desktop browser reflowed to 320px. Screenshots cover light, dark, classic dark, high-contrast light, and high-contrast dark. Thirty representative captures are indexed below; the complete browser output also contains sentence-mode and narrow-width captures.

## Screenshots

These captures use production React components and authored local data. They do not represent a personal library. Phone layouts use Chromium device emulation; physical-phone interaction and screen-reader speech were not manually tested in this change.

| Theme | Desktop reader | Mobile lookup | Desktop Appearance | Mobile Appearance |
| --- | --- | --- | --- | --- |
| Light | [View](screenshots/desktop-light-reader.png) | [View](screenshots/mobile-light-lookup.png) | [View](screenshots/desktop-light-appearance.png) | [View](screenshots/mobile-light-appearance.png) |
| Dark | [View](screenshots/desktop-dark-reader.png) | [View](screenshots/mobile-dark-lookup.png) | [View](screenshots/desktop-dark-appearance.png) | [View](screenshots/mobile-dark-appearance.png) |
| Classic dark | [View](screenshots/desktop-classic-dark-reader.png) | [View](screenshots/mobile-classic-dark-lookup.png) | [View](screenshots/desktop-classic-dark-appearance.png) | [View](screenshots/mobile-classic-dark-appearance.png) |
| High-contrast light | [View](screenshots/desktop-high-contrast-light-reader.png) | [View](screenshots/mobile-high-contrast-light-lookup.png) | [View](screenshots/desktop-high-contrast-light-appearance.png) | [View](screenshots/mobile-high-contrast-light-appearance.png) |
| High-contrast dark | [View](screenshots/desktop-high-contrast-dark-reader.png) | [View](screenshots/mobile-high-contrast-dark-lookup.png) | [View](screenshots/desktop-high-contrast-dark-appearance.png) | [View](screenshots/mobile-high-contrast-dark-appearance.png) |

| Audio flow | Desktop | Mobile |
| --- | --- | --- |
| Light | [View](screenshots/desktop-light-audio.png) | [View](screenshots/mobile-light-audio.png) |
| Dark | [View](screenshots/desktop-dark-audio.png) | [View](screenshots/mobile-dark-audio.png) |
| Classic dark | [View](screenshots/desktop-classic-dark-audio.png) | [View](screenshots/mobile-classic-dark-audio.png) |
| High-contrast light | [View](screenshots/desktop-high-contrast-light-audio.png) | [View](screenshots/mobile-high-contrast-light-audio.png) |
| High-contrast dark | [View](screenshots/desktop-high-contrast-dark-audio.png) | [View](screenshots/mobile-high-contrast-dark-audio.png) |

## Reproduce

From `client/lingua-read-client`:

```powershell
npm test -- --run
npm run typecheck
npm run lint
npm run build
npm run demo:test
npm run demo:build
npx playwright test reader-redesign.spec.ts word-status.spec.ts layout.spec.ts accessibility.spec.ts
```

From the repository root:

```powershell
dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj --no-restore --filter 'FullyQualifiedName~ReaderAutomaticExampleTests|FullyQualifiedName~WordsControllerTests|FullyQualifiedName~SrsStatusSyncTests'
```

The browser server uses port 4175. Local socket/testhost restrictions in the default sandbox required authorized test execution outside that sandbox. The committed evidence is this summary and the thirty indexed screenshots. Detailed runner logs, JSON reports, traces, and diagnostic runs remain local artifacts excluded by this directory's `.gitignore`. The indexed screenshots are unmodified copies of the final captures.
