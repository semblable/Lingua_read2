# Contributing to LinguaRead

Small, focused contributions are welcome: reproducible bugs, documentation,
accessibility improvements, language-specific examples, and reader fixes.
For substantial features, open an issue describing the learner's problem before
starting work. The priorities in [the release plan](docs/OPEN_SOURCE_PLAN.md) are
subject to actual learner feedback.

For language/activity work, start with the short [roadmap](docs/LANGUAGE_SUPPORT_PLAN.md),
then inspect code and relevant tests. Open [verification details](verification/README.md)
only when reproducing those checks; do not preload the documentation collection.
When using agents for larger work, a coordinator should pass bounded task briefs,
relevant constraints and file references to workers without inheriting the full chat
or documentation. Review the diff and results separately. Keep plans focused on
unresolved outcomes and constraints; use Git history for implementation chronology.

## Support scope

This is an experimental, single-maintainer project developed alongside a full-time
job. Issues and pull requests are reviewed as time allows; there is no response
time commitment, hosted-service support, or guarantee of support for every device,
language, provider, or custom deployment. Include the exact version and environment
when reporting a problem. Security concerns use [SECURITY.md](SECURITY.md).

## Development

Use Node.js 24 or newer, the .NET 10 SDK, and Docker Compose for PostgreSQL.
Copy `.env.example` to `.env` and supply local credentials as described in the
[installation guide](README.md#installation-docker). Never reuse production data
or keys in a development environment.

From the repository root:

```powershell
docker compose up --build -d db api
dotnet restore Lingua_Read.sln
dotnet build Lingua_Read.sln -c Release --no-restore
dotnet test Lingua_Read.sln -c Release --no-build
```

In a separate terminal:

```powershell
cd client/lingua-read-client
npm ci --legacy-peer-deps
npm run dev
```

The Vite development server proxies API and uploaded-media requests to the local
API on port 5000 (published by `docker-compose.override.yml`). Open the Local URL
printed by Vite. Provider keys are optional; use mocks in tests. You can also
work on the [static demo](client/lingua-read-client/demo/README.md) without Docker
or an API.

## Before opening a pull request

- Branch from `dev` and target `dev`; promotion to `main` follows the existing
  release workflow. Keep unrelated changes in separate pull requests.
- Explain the problem, resulting behavior, and relevant verification. Include
  screenshots for visual changes and the device/browser for mobile fixes.
- Run relevant existing tests. Add a regression test when it demonstrates a
  meaningful bug or behavior; documentation-only edits need link/command checks.
- For client changes, run `npm run lint`, `npm run typecheck`,
  `npm test -- --run`, and `npm run build` in `client/lingua-read-client`.
- For demo changes, run `npm run demo:test` and `npm run demo:build`; verify direct
  hash links and assets with a project base path. Keep prepared responses labeled
  and preserve the browser-only boundary.
- For server changes, run the solution build and tests shown above. Report a
  timeout or skipped test as such; compilation alone does not verify tests.
- Keep tokenizer changes aligned with the shared golden vectors and document
  language-specific limitations. Japanese/Chinese segmentation is unfinished.
- Include migrations when schema changes require them, and explain backup and
  upgrade implications. Update third-party notices when adding copied code,
  dependencies, fonts, or media.

Use original, public-domain, or appropriately licensed tiny fixtures. Do not
include private library material, `.env` files, database dumps, provider replies
containing private text, tokens, or data-protection keys. Review logs and
screenshots before attaching them.

Contributions are provided under the [MIT license](LICENSE), except assets with
explicit separate terms in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
Explain significant generated or AI-assisted work and how you verified it in the
pull request. Be respectful and specific in discussions.
