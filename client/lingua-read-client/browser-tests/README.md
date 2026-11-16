# Browser regressions

From `client/lingua-read-client`, using Node.js 24+:

```powershell
npm ci --legacy-peer-deps
npx playwright install chromium
npm run test:browser
```

On Linux use `npx playwright install --with-deps chromium`. Tests manage their own
loopback Vite server on port 4175; keep it free. To inspect one width, run
`npm run test:browser -- --project=chromium-390 --headed`.

These checks mount components in an isolated fixture. For the production app's
authentication, upload, persisted reviews and offline replay, run
`npm run test:app`; see [the app smoke guide](../app-smoke/README.md).

The default run includes both production-component fixtures and the isolated
interaction experiment. Select either group explicitly, or audit discovery:

```powershell
npm run test:browser -- --project="chromium-*"
npm run test:browser -- --project="experiment-interaction-*"
npm run test:browser -- --list
```

The component suite has 231 cases across mobile-emulation 320/390/430px,
desktop 1280px, and a separate `chromium-desktop-320` project with production
components, CSS, and fonts. These remain five distinct viewport/input contexts;
desktop reflow at 320px does not emulate touch. The 24 interaction-experiment
cases run in separately named desktop 1280px, desktop 320px, and touch 320px projects.
All eight experiment behaviors remain in the default run and CI. Intermediate
phone widths add no distinct interaction-controller behavior, so that experiment
does not repeat them. Total discovery is 255 cases (previously 295).

Fixed-context tests use explicit tags rather than resizing every project:

| Tag | Selected projects | Regression |
| --- | --- | --- |
| `@desktop-only` | `chromium-1280` | Hover save ordering, native definition resize, supplemental navbar breakpoints |
| `@narrow-only` | `chromium-320`, `chromium-desktop-320` | Lookup focus/retry and short-height goal-dialog scrolling with touch and pointer contexts |
| `@desktop-reflow` | `chromium-desktop-320` | Desktop reflow with text-spacing overrides |

Other component cases retain all five project widths. Dashboard fixtures
exercise long/accented titles, unbroken terms, audio, missing metadata, and due
totals of 0/1/12/12,345. Checks cover element/text
bounds, unmasked root overflow, menus, review session limits/routes, and
goal-dialog labels/focus. The 320×360px dialog regression checks actual modal-body
overflow, changes its scroll position, and verifies header and Cancel bounds and
focus return. Negative controls verify overflow detection. Deliberate
title clamps above 400px and shelf truncation remain allowed.

Layout checks mount Library, Terms, book/audio import forms, classic/modern readers,
and audio lessons. Audio retains the complete classic theme/layout matrix;
a targeted check verifies that the Modern preference still falls back to classic
panels, a usable transcript, controls and loaded media at all five widths.
They verify gutters, local table scrolling, flush panels,
visible keyboard focus, and representative secondary-text contrast in all five
themes. Navbar/Home alignment covers each project's native width plus a single
desktop pass at 800/1024/1600px, avoiding repeated width overrides in every project.
Theme screenshots at 320/1280px are saved under `test-results/browser/` for visual
review.

Each test has fresh browser state, blocked service workers, and a closed request
allowlist that rejects arbitrary mutations and external requests. The separate fixture skips auth and
offline startup and stays outside production/demo builds. Dashboard route probes
verify destinations without mounting the reader or SRS; goal edits are cancelled.
Layout pages use local settings and authored API/media responses; no edits are saved.
Sentence appearance samples use the production `SentenceModeView` with inert
action adapters; full reader sentence mode normally records progress on entry.
Goal-dialog checks cover immediate Escape with reduced motion and animated dismissal
after a live preference change. Audio checks leave unplayed lessons with the
mutation denylist active, guarding against unintended zero-position saves.

CI runs the suite and retains failure screenshots/traces for 14 days. Local output:
`test-results/browser/` and `playwright-report/` (open with `npx playwright show-report`).
Lint and typecheck include the suite.

`accessibility.spec.ts` adds scoped axe scans, computed solid-color compositing,
translation dialogs, a native heatmap date/table route, markers, text spacing,
forced colors, live motion preferences and narrow lookup focus containment/return.
`word-status.fixture.ts` adds a separate, narrowly validated synthetic PUT overlay
for real reader save ordering and rejected-save retry tests. It leaves the layout
fixture's mutation denylist intact. No external requests or real account writes
are permitted.
Its controlled-clock regression checks word coordinates through progress-row
insertion, the delayed live announcement and completion, then verifies the next
hover shortcut still saves the intended word. This catches layout races without
adding sleeps or weakening the request assertions.

`settings-preview.spec.ts` opens a separate Appearance Settings entry without
importing the reader or its stylesheet. Computed marker checks cover a fresh
Settings visit and turning markers off, so visiting a reader first cannot mask
a missing shared style dependency. This fixture also permits only same-origin
GET requests and remains outside production/demo imports.

The [isolated interaction spike](INTERACTION_SPIKE.md) lives at
`/interaction.html`. Its own authored-fixture mutation endpoint exercises target
snapshots, native alternatives, phrase/RTL traversal and virtual-row remounts.
It and its marker candidates remain outside production/demo imports. Axe and DOM
focus checks do not establish screen-reader key delivery, speech or read-all flow.
See [release evidence and manual gates](../../../docs/ACCESSIBILITY_VERIFICATION.md).

Physical-phone staging verification remains pending: record revision, date,
device/OS/browser, and results for touch scrolling, menus, native selects, focus,
and goal-dialog use with the on-screen keyboard.

`reader-redesign.spec.ts` covers exact repeated-word selection, automatic examples
on existing-word saves and hover shortcuts, sentence/audio appearance, cue-spanning
audio examples, compact growing definitions, and Appearance keyboard behavior.
It captures the reader, lookup, and Appearance popover in all five themes and
checks grade/header-text contrast. Its opt-in `redesign=1` fixture permits only
synthetic local settings and sentence-progress writes; the ordinary layout
fixture keeps its mutation denylist. Theme evidence and commands for this change
are indexed in `verification/reader-redesign/README.md` at the repository root.
