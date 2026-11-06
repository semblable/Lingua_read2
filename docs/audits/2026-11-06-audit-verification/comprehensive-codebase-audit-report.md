# LinguaRead codebase audit — verified remediation status

**Updated:** 6 November 2026
**Scope:** Current working-tree remediation against base commit `7f2ba809`
**Status:** Confirmed defects corrected; full suites passed; independent focused review completed with no remaining actionable findings in its four follow-up areas.

This report supersedes the original report's open-issue summary. The original “51 verified, deduplicated findings” and severity matrix were not accepted as evidence: the source reports contain overlapping claims, unsupported assertions and inconsistent totals. The [historical input](ORIGINAL-AUDIT.md) is preserved separately. [REVIEW.md](REVIEW.md) records the evidence and disposition of every documented claim that could be checked.

## Implemented remediation

Thirty-six remediation groups are implemented, with related duplicate IDs grouped together in the detailed review. The high-severity Zod dependency advisory is also patched. These are implementation dispositions, not an assertion that every original severity label was justified.

| Area | Implemented behavior |
| --- | --- |
| Security and authentication | Public-address guards for AI requests and Hardcover covers; explicit operator approval for local AI base URLs; owner-only default admin access; POST-only backups; login lockout; 12-character minimum for new passwords; startup JWT-key validation; explicit proxy trust. |
| Backend and library integrity | Transactional relinking/count updates for ordinary text edits; queued linking reads the current stored source; whole-transaction retry for the named PostgreSQL word-key collision; expired-streak handling; mixed-content folder creation/move ordering; append positions for new content; cleanup of cascaded lesson audio; goal handling during language reset. |
| Reader and audio | Track-bound audiobook restore seeks that yield to manual transport actions; sentence-mode cue following; shared desktop audio coordination; source-whitespace preservation; subtitle arrows/dot timestamps; valid title markup; delayed bookmark scrolling; case-aware phrase lookup; CJK quotation joins; guarded keyboard shortcuts. |
| Offline, SRS and export | Recoverable IndexedDB connections and committed enqueue writes; FIFO replay and bounded retry backoff; shared in-place reauthentication for replay and background audio; context-preserving word creation with real-ID recovery after sync; authoritative reader saves; translation-preserving coalescing; cancellation-aware failure handling; intact contractions; reactive pagination; explicit translation clearing; BOM-prefixed CSV exports. |
| Setup and dependencies | Package-manager installation replaces remote root script execution in `setup.sh`; Zod 4.6.7 replaces the affected 4.6.5 version. |

The six claims labelled critical in the original summary all have implemented corrections: custom AI network access, ordinary-text relinking, multi-track restore seeks, sentence-mode audio sync, IndexedDB recovery, and offline word/context handling. Their original critical severity labels have not been carried forward as independently verified exploit ratings.

## Remaining limitations and decisions

- **Development dependencies:** The authorized npm scan now reports zero high/critical, nine moderate and two low advisory entries. These include parent packages inheriting the same underlying advisory. Deepmerge has no patched release in the cited advisory; suggested forced major tooling downgrades were not applied. See [dependency-scan.json](dependency-scan.json) and the dependency discussion in [REVIEW.md](REVIEW.md).
- **Privileged operations sidecar:** Docker socket access remains root-equivalent and intentionally supports container state, events, logs and staging stop/start operations. No exploitable sidecar entry point was demonstrated. Restricting this boundary needs a deployment design that preserves those operations.
- **Session lifetime:** The configurable 90-day default remains a policy tradeoff. Existing persisted security stamps already revoke sessions on logout/password changes; the original “no server-side invalidation” assertion was false.
- **Disaster recovery and temporary files:** The production archive intentionally includes decryption keys. Local archive permissions and recovery from process/host crashes remain operational responsibilities; ordinary aborted response streams already use DeleteOnClose.
- **Features:** Automatic standard-view reading credit, repeated generated story contexts and MediaSession controls were not added as bug fixes. The report's claimed dictionary fallback, quota crashes, missing transaction, pipe/percent formula triggers and missing Cloze delay were not substantiated in the cited paths.
- **Unavailable evidence:** Two backend low findings were mentioned without actionable details, and the referenced backend transcript is absent. They remain unverified.
- **Local password-free setup:** Feasible as a separate, explicit local-only mode. It is not implemented in this remediation. The proposed boundary is loopback-only access, including localhost-bound Docker ports, while ordinary server/LAN deployments keep authentication.

These limitations are not silently counted as fixed. Each relevant ID and the reasoning are listed in [REVIEW.md](REVIEW.md).

## Upgrade notes

1. For a local AI server in Compose, set `AI_PRIVATE_BASE_URL` to the exact base URL entered in provider settings. Native installs use `Ai:AllowedPrivateBaseUrls`. AI redirects are disabled.
2. Native proxy deployments retain loopback trust. Other trusted proxies need `ReverseProxy:KnownNetworks`; Compose passes `TRUSTED_PROXY_NETWORK`, defaulting to `172.16.0.0/12`. Narrow it to the actual subnet on a shared host.
3. Backup API integrations must use POST with the existing CSRF header. Both endpoint aliases and generated client types are updated.
4. Missing/null word translations preserve the saved value; explicit blank values clear it. Older queued status-only operations remain compatible.
5. Newly created/changed passwords require 12 characters. Five failed logins impose a 15-minute lockout. Existing password hashes remain usable; example JWT keys now prevent non-test startup.
6. A subsequent explicit language reset archives its scoped goals and rebases unfinished global delta goals within the reset transaction. Upgrading alone does not modify existing goal data.
7. Reader natural-key word saves now send optional `replaceExisting: true`, allowing status demotion and explicit translation clearing before a real server ID is recovered. API callers omitting the flag retain the existing promotion-only create behavior. Synced provisional reader rows recover their real IDs without a page reload.

No database schema migration or deployed-data rewrite is included. See [SETTINGS.md](../../../SETTINGS.md) for local AI configuration.

## Validation already completed

| Check | Result |
| --- | --- |
| Full frontend suite | 128 files, 2,032 passed |
| Full backend suite | 1,866 passed; nine optional PostgreSQL tests skipped; zero failures |
| Proxy follow-up | Four middleware cases passed, including IPv4-mapped IPv6 peers |
| TypeScript | Passed |
| ESLint | Zero errors; 35 existing warnings |
| Production build | Passed, including bundle and license-notice verification |
| Demo | Six tests passed; static build and notice verification passed |
| Independent reviewer follow-up | 64 frontend and 11 backend tests passed; no remaining actionable R1–R4 findings |
| Whitespace/diff checks | Passed |
| npm scan | Zero high/critical; nine moderate and two low development-tool entries |

The skipped PostgreSQL checks require the existing isolated test database; SQLite/in-memory tests do not substitute for those concurrency checks. Named PostgreSQL unique-collision retries were tested with injected exceptions and distinct SQLite transactions; no live PostgreSQL MVCC result is claimed. Existing large-chunk and happy-dom transition warnings remain documented. No live database, production backup, deployment, or unrelated user edit was modified.

## Independent reviewer

The `remediation_reviewer` subagent inspected the production changes and tests and reproduced four gaps in the initial fixes. All four were corrected and independently rechecked:

- **R1:** Stale queued ordinary-text work could restore old word links. All relational linking now shares the owner transaction boundary and reads the current stored source; the specific PostgreSQL word-key collision retries the complete transaction.
- **R2:** Manual track navigation could strand a pending restore and block progress saving. Manual playback/seek/navigation now cancels restoration intent.
- **R3:** Offline-created rows retained provisional IDs and create-only update semantics. Reader saves now support exact updates, preserve omitted translations, remain ordered behind queued changes, and recover real IDs after sync. Navigation during identity lookup is guarded after asynchronous checks.
- **R4:** Background audio requests could still redirect the reader on session expiry. They now use shared in-place sign-in, retaining unauthorized activity writes for replay.

The reviewer independently passed 64 frontend tests and 11 backend tests and reported no remaining actionable R1–R4 findings. [REVIEWER.md](REVIEWER.md) preserves the initial findings, reproduction evidence, final follow-up and limits. This focused outcome is not a claim that every application path or deployment configuration has been exercised.
