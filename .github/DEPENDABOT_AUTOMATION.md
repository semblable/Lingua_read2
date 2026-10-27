# Dependabot merge and staging handoff

The auto-merge workflow serializes work per PR, reads the live PR target and labels,
and only retargets an open PR when necessary. Routine label additions do not create
extra approval jobs; adding the security label still reevaluates the policy.
Patch/security eligibility and protected auto-merge remain unchanged.

GitHub suppresses push and pull_request.closed workflow events from GITHUB_TOKEN
merges. The separate Dependabot Staging workflow therefore observes successful
PR Validation completion and briefly waits for GitHub's normal protected merge.
It never merges a PR itself or bypasses checks. A user rerunning CI is supported:
the live PR author, repository, and exact validated head establish its identity.

Only the staging-reconciliation job is globally serialized. It checks current dev,
an actual same-repository Dependabot merge made by github-actions[bot], and successful
PR Validation for that PR's exact head. Existing queued/running/successful staging
for the current dev SHA prevents another dispatch. Custom-token or manual mergers
keep using the ordinary push-triggered staging path.

An hourly check covers auto-merges delayed beyond the brief observation window.
Normally this performs only a few read-only API calls. Unsuccessful staging is
not retried automatically: rerun Staging itself, or manually run Dependabot Staging
with retry_failed enabled. This prevents a persistently failing commit from
creating an hourly deployment loop.

The privileged handler checks out only the repository's trusted default branch,
never the triggering PR head, merge ref, or PR artifacts. Permissions are read-only
during observation; only the serialized handoff can dispatch workflows.

**Activation:** workflow_run and schedule use the default branch. Merge this change
into dev, allow normal staging validation/deployment, then use the normal production
promotion to advance main. Do not move main independently. The missing earlier
dependency deployments are covered by that dev deployment.

Targeted tests run in the existing CI infrastructure job:

    node --test .github/scripts/dependabot-staging.test.mjs

References:
- https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run
