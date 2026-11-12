# Dashboard browser regressions

From `client/lingua-read-client`, using Node.js 24+:

```powershell
npm ci --legacy-peer-deps
npx playwright install chromium
npm run test:browser
```

On Linux use `npx playwright install --with-deps chromium`. Tests manage their own
loopback Vite server on port 4175; keep it free. To inspect one width, run
`npm run test:browser -- --project=chromium-390 --headed`.

The 40 Chromium checks cover 320/390/430/1280px with production Home, Navigation,
CSS, and fonts. Synthetic fixtures exercise long/accented titles, unbroken terms,
audio, missing metadata, and due totals of 0/1/12/12,345. Checks cover element/text
bounds, unmasked root overflow, menus, bounded SRS routes, catch-up controls, and
goal-dialog labels/focus. Negative controls verify overflow detection. Deliberate
title clamps above 400px and shelf truncation remain allowed.

Each test has fresh browser state, blocked service workers, and an API allowlist
that rejects mutations and external requests. The separate fixture skips auth and
offline startup and stays outside production/demo builds. Route probes verify
destinations without mounting the reader or SRS; goal edits are cancelled.

CI runs the suite and retains failure screenshots/traces for 14 days. Local output:
`test-results/browser/` and `playwright-report/` (open with `npx playwright show-report`).
Lint and typecheck include the suite.

Physical-phone staging verification remains pending: record revision, date,
device/OS/browser, and results for touch scrolling, menus, native selects, focus,
and goal-dialog use with the on-screen keyboard.
