# Independent password-free local-mode review — 6 November 2026

**Result: no actionable findings in the reviewed feature and documentation changes.** This is a separate independent review of the password-free feature; the earlier remediation review did not cover this later commit. Passing checks and this result do not guarantee the absence of defects.

## Scope

Reviewed feature commit `c2ab8ec149c5318271de9abe4b0c46b6cc20e589` against parent `bc9598c2065618e6b372b9b26becc11f10bd0c94`. Read the production changes, their tests, and relevant existing authentication, authorization, CORS, static-media and nginx code. Also reviewed the primary agent's subsequent working-tree updates to `SECURITY.md`, `docs/ARCHITECTURE.md`, `docs/BACKUP_AND_UPGRADE.md`, `docs/RELEASING.md` and `docs/RELEASE_VERIFICATION.md`.

No applicable `AGENTS.md` was found in the repository or its ancestor directories. This reviewer changed only this review artifact. Unrelated contributor/open-source-plan edits, the older audit, dependencies and generated timing artifacts were excluded. No production data, running application deployment or external account was changed.

## Assessment

| Area | Independent assessment |
| --- | --- |
| Explicit opt-in and configuration ordering | Local mode defaults off. Authentication scheme selection uses final host configuration. An empty JWT key is accepted in local mode without initializing JWT options; normal password mode retains its key validation. The production Compose overlay explicitly turns both local flags off. |
| Native request boundary | The boundary runs before forwarded headers can replace the socket peer and before authentication, controllers and protected static files. Native mode requires a loopback peer, a local Host, a local Origin when supplied, and rejects cross-site browser requests. Every supplied forwarding hop must also be loopback. Missing peer information fails closed. |
| Docker proxy boundary | Proxy mode explicitly trusts configured proxy peers, requires forwarding information for a nonloopback peer, and retains Host/origin/CSRF checks. Compose publishes nginx and the development API only on host loopback. This mode deliberately trusts same-computer processes/containers and the bundled proxy; it does not establish a general external reverse-proxy boundary. That limitation is documented. |
| Vite API and media proxy | The development server binds `127.0.0.1`. Both API and all four uploaded-media proxy paths enable `xfwd`, so native mode receives the original caller information even when Vite changes the upstream Host. A real local proxy exercise confirmed that an existing nonlocal forwarding hop is retained instead of being hidden by the loopback proxy. |
| Authentication, ownership and CSRF | The local handler supplies only the existing seeded owner's identity; a missing owner does not authenticate. Normal controller/admin policies and static-media ownership checks still run. Mutations require the expected custom header even without a cookie. The pipeline tests exercise both an allowed owner/admin path and denied foreign media. |
| Credentials and switching off | Local mode does not mint a portable login cookie. Login, setup, logout and password changes reject local-mode requests, and initializer code skips password bootstrapping in that mode. Existing password hashes and security stamps are preserved. With local mode disabled, the tested password/setup flows and protected-endpoint challenges return. |
| Frontend state and controls | Auth status carries the mode into the store. The account menu removes the ineffective logout action and password settings explain how to switch modes. A stale local-mode logout invocation retains queued offline work. Ordinary status responses clear prior local-mode state. |
| Instructions and CI | README, SETTINGS and `.env.example` describe opt-in, localhost-only use, preserved credentials, Docker requirements and restoration of password login. The adjacent documentation now distinguishes the two modes and records independent cold-install/browser checks as open release gates. CI retains both the resolved Vite proxy check and Compose merge/binding checks. |

The documented Engine 28 localhost requirement agrees with [Docker's port-publishing documentation](https://docs.docker.com/engine/network/port-publishing/). The production `!override` port replacement and documented Compose 2.24.4 minimum agree with [Docker's Compose merge documentation](https://docs.docker.com/reference/compose-file/merge/).

## Independently executed validation

- **59 backend tests passed, none skipped:** `LocalModeTests`, `ProxyTrustTests` and `AuthControllerTests`, using the local .NET runner with `--no-build`. The local-mode cases include the actual `WebApplicationFactory` middleware/authentication pipeline rather than only controller invocation.
- **31 frontend tests passed across five files:** `LocalMode.test.tsx`, `PasswordSettings.test.tsx`, `Setup.test.js`, `Login.test.js` and `store.test.js`. Existing non-failing React `act(...)` warnings appeared in login/setup loading-state cases.
- `node scripts/check-local-dev-boundary.mjs` passed against the resolved Vite configuration.
- `python verification/local_mode_config.py` passed using local Docker Compose 5.3.1. This verified default-off authentication, local opt-in, a custom localhost port, development API binding and production overrides without starting containers or printing expanded credentials.
- A temporary inline Node exercise started Vite and a loopback-only mock upstream. Requests through `/api` and all four protected-media proxy prefixes reached the upstream with the loopback caller recorded; a supplied `198.51.100.9` forwarding hop remained in the appended chain. Both temporary servers were closed afterward. The first sandboxed attempt was denied a local connection; the same exercise passed with local socket permission.

## Limits

The request tests use an in-memory test database and inject the socket peer through the test host. They do not demonstrate real Kestrel binding, an actual nginx/container network boundary, firewall behavior or protection under a customized Docker direct-routing configuration. The proxy exercise used a mock upstream, not live user data. No fresh database/container cold install, physical browser/device mode switch or deliberate external exposure was performed.

The full-suite totals and CI/deployment results are tracked by the primary agent; they are not claimed as independent full-suite or deployment verification here. The documented cold-install and actual browser/device release checks remain open. No further production correction was identified within this review's scope.
