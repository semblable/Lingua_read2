# Production app smoke

Run `npm run test:app` from `client/lingua-read-client` with Docker running and
Chromium installed (`npx playwright install chromium`; on Linux add `--with-deps`).
The runner builds the production images, starts `verification/compose.yml` under
a unique project name on an available loopback port, and removes only that
project's containers, volumes and generated image tags afterward. Data, passwords and operator tokens
are synthetic; provider keys are empty and external writes are disabled.

The single workflow uses the production app entry, router, nginx, authentication,
XHR upload, PostgreSQL persistence, service worker and IndexedDB queue. It sets
up an account, uploads a tiny original TXT book, saves a definition, reloads,
edits it offline, reloads before reconnecting to check durable replay, grades a
review, then signs out and back in to verify persisted vocabulary and the review
receipt. No API or app module is
mocked. This complements the browser component/layout matrix and unit tests.

CI runs this in its own job so image-building does not extend the existing
browser-test job's timeout. Use `npm run test:app -- --list` to discover the test
without Docker. Other Playwright flags (for example `--headed`) are forwarded;
every executing run starts with a fresh database. Failures retain traces and
screenshots in `test-results/app-smoke/`; the report is `playwright-app-report/`.
The runner prints the isolated stack's last logs before cleanup on failure.

This does not establish device-specific mobile behavior, offline audio downloads
(currently paused), or provider integrations.
