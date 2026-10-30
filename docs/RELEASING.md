# Open-source release checklist

This is a preparation checklist, not a declaration that a release has shipped.
Follow the existing `dev` → staging → promotion to `main` flow. Do not create an
independent `main` deployment or publish a tag over unreviewed local changes.

## Before publication

- [ ] Review the [plan](OPEN_SOURCE_PLAN.md), README screenshots, static demo,
  limitations, [license](../LICENSE), and [notices](../THIRD_PARTY_NOTICES.md).
- [ ] Check screenshot/fixture provenance, including legacy icons in
  `client/lingua-read-client/public/`; remove/replace any asset whose rights cannot
  be established. Verify attribution survives the application and demo builds.
- [x] Run the [phone-sized browser checks](DEPLOYMENT_EVIDENCE.md#browser-checks-at-phone-sized-viewports)
  for the showcase, reader, and audio at portrait/landscape dimensions.
- [ ] Complete the remaining [physical-phone check](DEPLOYMENT_EVIDENCE.md#physical-phone-check).
- [ ] Verify the actual Pages URL, direct hash links, bundled audio and reset.
  For a root-domain deployment, build with `DEMO_BASE_PATH=/` and check it there.
  Publish only through the reviewed manual demo workflow.
- [ ] Enable and verify GitHub private vulnerability reporting; confirm the link
  in [SECURITY.md](../SECURITY.md) works for a potential reporter. The repository
  API returned `enabled: false` on 2026-10-29; the policy provides a fallback.
- [ ] Review all public Git history for credentials and private library/dump
  assets, including tags and remote branches. Fetch the relevant refs first.
- [x] Obtain maintainer confirmation of revocation for the historical credential
  identified by the scan. Confirmation was received on 2026-10-28; it is not an
  independent issuer-side check. Recheck new findings at the release checkpoint.
- [x] Verify an isolated synthetic [restore](BACKUP_AND_UPGRADE.md), including media
  and separately protected encryption keys. [Working-tree evidence and versions](RELEASE_VERIFICATION.md#full-app-reliability-and-export-pass-2026-10-29)
  are recorded; repeat at the intended release checkpoint.
- [ ] Run the current CI checks and record results at the release commit. Successful
  working-tree runs are recorded separately and do not verify that future commit.
- [ ] Write release notes covering experimental status, supported/tested languages
  and devices, migration impact, known issues, and backup/upgrade expectations.

App fixes and optional feature increments are tracked separately in
[PRE_RELEASE_APP_PLAN.md](PRE_RELEASE_APP_PLAN.md). Complete its reliability pass
before treating optional export/related-word features as release requirements.

## History review

Use a current Gitleaks installation from its [official project](https://github.com/gitleaks/gitleaks). Check its version,
then run from the repo root with local, private output:

```sh
gitleaks version
gitleaks git --log-opts="--all" --redact --report-format json --report-path /private/path/linguaread-history.json .
```

Use a path outside the repository for the report; never attach it to a public
issue. Even redacted reports can contain sensitive metadata. Review each finding
and scan the working tree separately if preparing uncommitted content. Also
inspect historical file paths for `.env`, dumps, key rings, remote configs, and
private media; a scanner does not establish distribution rights. Record tool
version, refs/commit, date, disposition, and limitations privately. Do not rewrite
shared history automatically; coordinate any necessary cleanup after revocation.

Local preparation on 2026-10-28 fetched remote branches and tags, then ran
checksum-verified Gitleaks 8.30.1 across all available refs (893 commits at
`f01e2745`). Six findings comprised three
synthetic JWT test-key assignments and three historical occurrences of one
Google-shaped API credential. That historical value is absent from current
`appsettings.json`. A separate snapshot scan of tracked and non-ignored release
files found only those three synthetic test-key assignments. Raw values are not
recorded here, and reports were kept outside the repository.

The maintainer confirmed on 2026-10-28 that the historical credential was revoked
at Google. This is maintainer confirmation, not an independent issuer-side check.
A scan of fetched refs does not cover forks, caches, removed refs, or artifacts.
Repeat at the final release commit and inspect historical private assets as well.
The [existing image scan](../.github/workflows/security-scan.yml) checks
container vulnerabilities and does not replace this gate.

A 2026-10-30 GitGuardian alert against `18e8d73` is consistent with the disposable
PostgreSQL setup's invented credentials; `ba9eb449` switched to per-run credentials.
Exact occurrence/classification still requires private dashboard access. Removing
the literal does not close or erase the historical incident.

## Tag and announce after the gates pass

Choose a release version deliberately; the frontend package's `0.1.0` is not
evidence of an existing release. From a clean checkout of the reviewed promoted
commit, the maintainer can create an annotated tag and push it explicitly:

```sh
git tag -a <release-tag> <reviewed-main-commit> -m "LinguaRead experimental release"
git push origin <release-tag>
```

Attach release notes and link the exact source commit, immutable image tags,
installation guide, tested backup/restore procedure, known limitations, and demo.
Record the actual release URL in the plan. Tagging or publishing is not performed
by these instructions.

Invite a few learners using the [feedback protocol](LEARNER_FEEDBACK.md). Keep
support expectations aligned with [CONTRIBUTING.md](../CONTRIBUTING.md); do not
promise response times or continuous availability.
