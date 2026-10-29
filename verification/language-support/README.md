# Bounded language-support experiment

This is an audit, not a production tokenizer or a passing language-readiness test.
Inputs are original synthetic strings. `candidateWords` are provisional expectations;
native review is still required. Reports expose unresolved bugs rather than asserting
that today's incorrect behavior is the desired contract.

Before running: limit the spike to the six Chinese/Japanese/Thai examples and
10k/100k UTF-16-unit inputs per language, with no added package/model dependency.
Exploratory budget on this desktop: one engine's 100k pass under 1 s after initialization,
under 128 MiB total process working set, no database or private text, and no network in
the Linux container. These are rejection thresholds for this spike, not production SLAs.
Do not infer application import latency or dictionary download size from a standalone
tokenizer measurement. Record cold/warm and runtime versions with results.

From the repository root (Node 24+ supports the source's erasable TypeScript):

```powershell
node verification/language-support/probe.mjs > verification/language-support/node-report.json
dotnet build verification/language-support/LanguageSupportProbe.csproj
dotnet verification/language-support/bin/Debug/net10.0/LanguageSupportProbe.dll verification/language-support/cases.json > verification/language-support/dotnet-windows-report.json
```

For Linux use a locally built API image containing the deployed .NET runtime and ICU;
mount **only this experiment directory**, read-only, with no network:

```powershell
$probeRoot = (Resolve-Path verification/language-support).Path
docker run --rm --network none --read-only --mount "type=bind,source=$probeRoot,target=/probe,readonly" --entrypoint dotnet linguaread-verify-20261028-api:latest /probe/bin/Debug/net10.0/LanguageSupportProbe.dll /probe/cases.json > verification/language-support/dotnet-linux-report.json
```

The C# executable calls the actual application tokenizer and optionally the runtime's
native ICU word-break API. Native-library probing is deliberately confined here. This
does not choose an engine, pin deployment data, or establish native-reviewed quality.
Source-span checks cover exact UTF-16 reconstruction; they do not establish stability
between different ICU versions. Do not feed the resulting boundaries into live texts.

## Reading-credit compatibility experiment

[Contract, bounds, candidates and decisions](reading-credit-experiment.md) describe
the separate units for saved vocabulary, coverage and earned reading activity.
The experiment is `ReadingCreditCompatibilityTests` in the backend test project;
it uses only synthetic learners and short strings in isolated SQLite in-memory
databases. It does not run the ICU loader above or access a learner library.

```powershell
dotnet test server/LinguaReadApi.Tests/LinguaReadApi.Tests.csproj --no-restore --filter FullyQualifiedName~ReadingCreditCompatibilityTests --logger 'trx;LogFileName=reading-credit.trx' --results-directory verification/language-support/test-results
./verification/language-support/summarize-credit-results.ps1 -TrxPath verification/language-support/test-results/reading-credit.trx -OutputPath verification/language-support/reading-credit-after.json
```

Reports: [initial failures](reading-credit-before.json), [review reset reproduction](reading-credit-review-before.json),
[final observations](reading-credit-after.json). Raw TRX is locally ignored. The
initial report predates the reset/extra preservation cases and initially asserted
the desired late-replay invariant; that assertion failed. The final suite keeps
that scenario as an explicitly named diagnostic, checking same-index dedup without
claiming the unseen-index overcredit was fixed. Passing the diagnostics means the
documented discrepancy is reproduced, not that its linguistic/compatibility gate
passes. The Thai counting input deliberately uses CJK stops to isolate counting
from sentence-boundary quality; it is not a native Thai acceptance fixture.

The test host needs a permitted local connection in restricted environments.
Use the existing cached dependencies; the experiment adds no package/model.
