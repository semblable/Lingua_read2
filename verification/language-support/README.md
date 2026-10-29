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
