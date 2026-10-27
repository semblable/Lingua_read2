import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout } from 'node:timers/promises';

const dependabot = 'dependabot[bot]';
const actionsBot = 'github-actions[bot]';
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const isNumber = value => Number.isSafeInteger(value) && value > 0;

function safePr(pr, repositoryId, headSha) {
  return pr.user?.login === dependabot &&
    pr.base?.ref === 'dev' &&
    pr.base?.repo?.id === repositoryId &&
    pr.head?.repo?.id === repositoryId &&
    isSha(headSha) && pr.head?.sha === headSha;
}

// Observe GitHub's normal protected auto-merge. This never approves, merges, or
// executes a pull request, and never substitutes a newer head for the tested one.
export async function observeMerge({ api, repository, repositoryId, run, sleep = setTimeout, attempts = 12 }) {
  if (run?.event !== 'pull_request' || run.conclusion !== 'success' ||
      run.head_repository?.id !== repositoryId || !isSha(run.head_sha)) {
    return { ready: false, reason: 'Not a successful same-repository PR validation.' };
  }
  let numbers = (run.pull_requests || []).map(pr => pr.number).filter(isNumber);
  if (!numbers.length) {
    const associated = await api('repos/' + repository + '/commits/' + run.head_sha + '/pulls?per_page=100');
    numbers = associated.map(pr => pr.number).filter(isNumber);
  }
  for (let attempt = 0; attempt < attempts; attempt++) {
    let waiting = false;
    for (const number of numbers) {
      const pr = await api('repos/' + repository + '/pulls/' + number);
      if (!safePr(pr, repositoryId, run.head_sha)) continue;
      if (pr.merged === true && isSha(pr.merge_commit_sha)) {
        return { ready: true, reason: 'Validated Dependabot PR has merged into dev.' };
      }
      if (pr.state === 'open') waiting = true;
    }
    if (!waiting) return { ready: false, reason: 'No matching open or merged Dependabot PR.' };
    if (attempt + 1 < attempts) await sleep(5000);
  }
  return { ready: false, reason: 'Merge is still pending; hourly reconciliation will check again.' };
}

// This is the only fallback dispatch path. Callers serialize this function
// globally, and it always reconciles current dev rather than an old PR event.
export async function reconcileStaging({ api, repository, repositoryId, retryFailed = false }) {
  const prefix = 'repos/' + repository;
  for (let attempt = 0; attempt < 3; attempt++) {
    const devSha = (await api(prefix + '/git/ref/heads/dev')).object?.sha;
    if (!isSha(devSha)) throw new Error('GitHub returned an invalid dev commit.');
    const associated = await api(prefix + '/commits/' + devSha + '/pulls?per_page=100');
    const candidate = associated.find(pr => isNumber(pr.number) && pr.merge_commit_sha === devSha &&
      pr.user?.login === dependabot && pr.base?.ref === 'dev');
    if (!candidate) return { dispatched: false, reason: 'Current dev tip is not a Dependabot merge.' };
    const pr = await api(prefix + '/pulls/' + candidate.number);
    if (!safePr(pr, repositoryId, pr.head?.sha) || pr.merged !== true || pr.merge_commit_sha !== devSha) {
      return { dispatched: false, reason: 'Current dev tip is not a verified same-repository bot merge.' };
    }
    if (pr.merged_by?.login !== actionsBot) {
      return { dispatched: false, reason: 'The merger uses the normal push-triggered staging path.' };
    }
    const validation = await api(prefix + '/actions/workflows/pr.yml/runs?event=pull_request&head_sha=' +
      pr.head.sha + '&per_page=100');
    if (!validation.workflow_runs.some(run => run.head_sha === pr.head.sha &&
        run.head_repository?.id === repositoryId && run.event === 'pull_request' &&
        run.status === 'completed' && run.conclusion === 'success')) {
      return { dispatched: false, reason: 'No successful PR Validation for this exact bot head.' };
    }
    const staging = await api(prefix + '/actions/workflows/staging.yml/runs?branch=dev&head_sha=' +
      devSha + '&per_page=100');
    const matching = staging.workflow_runs.filter(run => run.head_sha === devSha);
    if (matching.some(run => run.status !== 'completed' || run.conclusion === 'success')) {
      return { dispatched: false, reason: 'Staging already queued, running, or successful for ' + devSha };
    }
    if (matching.length && !retryFailed) {
      return { dispatched: false, reason: 'A prior staging run finished unsuccessfully; rerun it explicitly.' };
    }
    // Another bot may have merged while we read checks. Reconcile that tip
    // instead; staging always builds/tests the dev ref it actually receives.
    if ((await api(prefix + '/git/ref/heads/dev')).object?.sha !== devSha) continue;
    await api(prefix + '/actions/workflows/staging.yml/dispatches', { method: 'POST', body: { ref: 'dev' } });
    return { dispatched: true, reason: 'Dispatched missing staging for ' + devSha };
  }
  return { dispatched: false, reason: 'Dev kept moving; a later reconciliation will check again.' };
}

function githubApi(path, { method = 'GET', body } = {}) {
  const args = ['api', path, '--method', method];
  if (body !== undefined) args.push('--input', '-');
  const output = execFileSync('gh', args, {
    encoding: 'utf8', input: body === undefined ? undefined : JSON.stringify(body),
    stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 10 * 1024 * 1024,
  });
  return output.trim() ? JSON.parse(output) : null;
}

async function main() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const repository = process.env.GITHUB_REPOSITORY;
  const repositoryId = Number(process.env.GITHUB_REPOSITORY_ID);
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository || '') || !isNumber(repositoryId)) {
    throw new Error('Missing trusted repository identity.');
  }
  const options = { api: githubApi, repository, repositoryId };
  if (process.argv[2] === 'observe') {
    const result = await observeMerge({ ...options, run: event.workflow_run });
    console.log(result.reason);
    appendFileSync(process.env.GITHUB_OUTPUT, 'ready=' + result.ready + '\n');
  } else if (process.argv[2] === 'reconcile') {
    const retryFailed = process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' &&
      [true, 'true'].includes(event.inputs?.retry_failed);
    console.log((await reconcileStaging({ ...options, retryFailed })).reason);
  } else {
    throw new Error('Expected observe or reconcile.');
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
