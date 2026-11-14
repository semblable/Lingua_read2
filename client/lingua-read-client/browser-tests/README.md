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

Chromium checks cover mobile 320/390/430px, desktop 1280px, and a separate
`chromium-desktop-320` project with production components,
CSS, and fonts. Dashboard fixtures exercise long/accented titles, unbroken terms,
audio, missing metadata, and due totals of 0/1/12/12,345. Checks cover element/text
bounds, unmasked root overflow, menus, review session limits/routes, and
goal-dialog labels/focus. Negative controls verify overflow detection. Deliberate
title clamps above 400px and shelf truncation remain allowed.

Layout checks mount Library, Terms, book/audio import forms, classic/modern readers,
and audio lessons (which use classic UI even with the Modern preference).
They verify gutters, local table scrolling, flush panels,
visible keyboard focus, and representative secondary-text contrast in all five
themes. Navbar/Home alignment also covers 800/1024/1600px. Theme screenshots at
320/1280px are saved under `test-results/browser/` for visual review.

Each test has fresh browser state, blocked service workers, and an API allowlist
that rejects mutations and external requests. The separate fixture skips auth and
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
