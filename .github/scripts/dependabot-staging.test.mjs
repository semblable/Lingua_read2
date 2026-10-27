import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { observeMerge, reconcileStaging } from './dependabot-staging.mjs';

const repository = 'owner/reader';
const repositoryId = 42;
const head = 'a'.repeat(40);
const tip = 'b'.repeat(40);
const newer = 'c'.repeat(40);
const prefix = 'repos/' + repository;
const pr = {
  number: 127, user: { login: 'dependabot[bot]' },
  head: { sha: head, repo: { id: repositoryId } },
  base: { ref: 'dev', repo: { id: repositoryId } },
  state: 'closed', merged: true, merge_commit_sha: tip,
  merged_by: { login: 'github-actions[bot]' },
};
const validation = {
  head_sha: head, head_repository: { id: repositoryId }, event: 'pull_request',
  status: 'completed', conclusion: 'success', pull_requests: [{ number: 127 }],
};
const options = { repository, repositoryId };

function fixture(overrides = {}) {
  const data = {
    pr: structuredClone(pr), validation: [structuredClone(validation)], staging: [],
    associated: [structuredClone(pr)], refs: [tip], ...overrides,
  };
  const calls = [];
  const api = async (path, request = {}) => {
    calls.push({ path, ...request });
    if (request.method === 'POST') return null;
    if (path === prefix + '/git/ref/heads/dev') {
      return { object: { sha: data.refs.length > 1 ? data.refs.shift() : data.refs[0] } };
    }
    if (path === prefix + '/pulls/127') return typeof data.pr === 'function' ? data.pr() : data.pr;
    if (path.includes('/commits/')) return data.associated;
    if (path.includes('/workflows/pr.yml/runs')) return { workflow_runs: data.validation };
    if (path.includes('/workflows/staging.yml/runs')) return { workflow_runs: data.staging };
    throw new Error('Unexpected API request: ' + path);
  };
  return { api, calls, data };
}

test('observes an asynchronous protected merge without making any mutation', async () => {
  let reads = 0;
  let sleeps = 0;
  const f = fixture({ pr: () => ++reads === 1 ? { ...pr, state: 'open', merged: false } : pr });
  const result = await observeMerge({
    ...options, api: f.api, run: validation,
    sleep: async () => { sleeps++; }, attempts: 3,
  });
  assert.equal(result.ready, true);
  assert.equal(sleeps, 1);
  assert.ok(f.calls.every(call => !call.method));
});

test('does not depend on the workflow actor (a user can rerun a bot PR)', async () => {
  const f = fixture();
  assert.equal((await observeMerge({
    ...options, api: f.api, run: { ...validation, actor: { login: 'maintainer' } },
  })).ready, true);
});

test('recovers the PR association if workflow_run omits its pull_requests list', async () => {
  const f = fixture();
  assert.equal((await observeMerge({
    ...options, api: f.api, run: { ...validation, pull_requests: [] },
  })).ready, true);
});

for (const [name, change] of [
  ['stale tested head', item => { item.head.sha = newer; }],
  ['non-bot author', item => { item.user.login = 'contributor'; }],
  ['fork PR', item => { item.head.repo.id = 99; }],
  ['different base repository', item => { item.base.repo.id = 99; }],
  ['wrong base branch', item => { item.base.ref = 'main'; }],
  ['closed without merging', item => { item.merged = false; }],
]) {
  test('observer rejects ' + name, async () => {
    const f = fixture();
    change(f.data.pr);
    assert.equal((await observeMerge({ ...options, api: f.api, run: validation })).ready, false);
  });
}

for (const [name, change] of [
  ['failed validation', item => { item.conclusion = 'failure'; }],
  ['non-PR validation', item => { item.event = 'push'; }],
  ['fork workflow run', item => { item.head_repository.id = 99; }],
]) {
  test('observer ignores ' + name + ' before making API calls', async () => {
    const run = structuredClone(validation);
    change(run);
    const f = fixture();
    assert.equal((await observeMerge({ ...options, api: f.api, run })).ready, false);
    assert.equal(f.calls.length, 0);
  });
}

test('an unmerged PR never dispatches staging and falls back after the observation window', async () => {
  const f = fixture({ pr: { ...pr, state: 'open', merged: false } });
  const result = await observeMerge({ ...options, api: f.api, run: validation, attempts: 1 });
  assert.equal(result.ready, false);
  assert.match(result.reason, /pending/);
  assert.ok(f.calls.every(call => !call.method));
});

test('dispatches only for an actual merged bot head with successful matching PR Validation', async () => {
  const f = fixture();
  assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, true);
  assert.deepEqual(f.calls.filter(call => call.method), [{
    path: prefix + '/actions/workflows/staging.yml/dispatches',
    method: 'POST', body: { ref: 'dev' },
  }]);
});

for (const [status, conclusion] of [
  ['queued', null], ['in_progress', null], ['waiting', null], ['completed', 'success'],
]) {
  test('does not duplicate ' + status + '/' + conclusion + ' staging for the same dev SHA', async () => {
    const f = fixture({ staging: [{ head_sha: tip, status, conclusion }] });
    assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, false);
    assert.ok(f.calls.every(call => !call.method));
  });
}

test('a staging run for another SHA does not cover the missing current dev merge', async () => {
  const f = fixture({ staging: [{ head_sha: newer, status: 'completed', conclusion: 'success' }] });
  assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, true);
});

test('failed staging is not silently retried hourly, but supports an explicit retry', async () => {
  const f = fixture({ staging: [{ head_sha: tip, status: 'completed', conclusion: 'failure' }] });
  assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, false);
  assert.equal((await reconcileStaging({ ...options, api: f.api, retryFailed: true })).dispatched, true);
});

for (const [name, change] of [
  ['non-bot PR', item => { item.user.login = 'maintainer'; }],
  ['fork PR', item => { item.head.repo.id = 99; }],
  ['unmerged PR', item => { item.merged = false; }],
  ['a different merge commit', item => { item.merge_commit_sha = newer; }],
  ['a custom-token or manual merger', item => { item.merged_by.login = 'maintainer'; }],
]) {
  test('reconciliation skips ' + name, async () => {
    const f = fixture();
    change(f.data.pr);
    assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, false);
    assert.ok(f.calls.every(call => !call.method));
  });
}

for (const [name, change] of [
  ['stale head', item => { item.head_sha = newer; }],
  ['failed CI', item => { item.conclusion = 'failure'; }],
  ['pending CI', item => { item.status = 'in_progress'; item.conclusion = null; }],
  ['fork validation', item => { item.head_repository.id = 99; }],
]) {
  test('reconciliation rejects ' + name, async () => {
    const f = fixture();
    change(f.data.validation[0]);
    assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, false);
    assert.ok(f.calls.every(call => !call.method));
  });
}

test('does not dispatch an old head if dev changes before the handoff', async () => {
  const f = fixture({ refs: [tip, newer, newer] });
  assert.equal((await reconcileStaging({ ...options, api: f.api })).dispatched, false);
  assert.ok(f.calls.every(call => !call.method));
});

test('API/permission failures surface instead of being reported as successful no-ops', async () => {
  const api = async () => { throw new Error('Resource not accessible'); };
  await assert.rejects(reconcileStaging({ ...options, api }), /Resource not accessible/);
});

// Execute the actual workflow shell against a fake gh function, including its
// error exits. This catches stale-event/race behavior without GitHub mutations.
const workflow = readFileSync(new URL('../workflows/dependabot-automerge.yml', import.meta.url), 'utf8');
const retargetBlock = workflow.match(/id: retarget\r?\n        run: \|\r?\n([\s\S]*?)        env:/)?.[1];
assert.ok(retargetBlock, 'The retarget step must be available to execute.');
const retargetShell = retargetBlock.split(/\r?\n/).map(line => line.slice(10)).join('\n');
const bash = process.platform === 'win32' ? join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe') : 'bash';

function runRetarget(responses, editStatus = 0, apiStatus = 0) {
  if (process.platform === 'win32') assert.ok(existsSync(bash), 'Use Git for Windows Bash for these workflow tests.');
  const folder = mkdtempSync(join(tmpdir(), 'linguaread-retarget-'));
  const slash = path => path.replaceAll('\\', '/');
  try {
    const output = join(folder, 'output');
    const count = join(folder, 'count');
    const edits = join(folder, 'edits');
    const responseFile = join(folder, 'responses');
    const stub = join(folder, 'gh-stub.sh');
    writeFileSync(output, '');
    writeFileSync(count, '0');
    writeFileSync(edits, '');
    writeFileSync(responseFile, responses.join('\n') + '\n');
    writeFileSync(stub, [
      '#!/usr/bin/env bash', 'set -euo pipefail',
      'if [ "$1" = api ]; then',
      '  if [ "$TEST_API_STATUS" != 0 ]; then exit "$TEST_API_STATUS"; fi',
      '  count="$(cat "$TEST_COUNT")"; count=$((count + 1))',
      '  echo "$count" > "$TEST_COUNT"',
      '  sed -n "$count"p "$TEST_RESPONSES"',
      'elif [ "$1" = pr ] && [ "$2" = edit ]; then',
      '  echo edit >> "$TEST_EDITS"; exit "$TEST_EDIT_STATUS"',
      'else exit 98; fi', '',
    ].join('\n'));
    const result = spawnSync(bash, ['-c', 'gh() { "$BASH" "$TEST_STUB" "$@"; }\n' + retargetShell], {
      encoding: 'utf8',
      env: {
        ...process.env, GH_TOKEN: '', GH_REPO: repository, PR_NUMBER: '127',
        PR_URL: 'https://github.com/owner/reader/pull/127',
        GITHUB_OUTPUT: slash(output), TEST_COUNT: slash(count), TEST_EDITS: slash(edits),
        TEST_STUB: slash(stub), TEST_RESPONSES: slash(responseFile),
        TEST_EDIT_STATUS: String(editStatus), TEST_API_STATUS: String(apiStatus),
      },
    });
    if (result.error) throw result.error;
    return { ...result, output: readFileSync(output, 'utf8'), edits: readFileSync(edits, 'utf8') };
  } finally {
    // Only remove this test's newly created direct child of the temporary folder.
    assert.equal(dirname(folder), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith('linguaread-retarget-'));
    rmSync(folder, { recursive: true, force: true });
  }
}

test('retarget skips an already-dev PR and reads live security labels', () => {
  const result = runRetarget(['open\tdev\ttrue', 'open\tdev\ttrue']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.edits, '');
  assert.match(result.output, /open=true\nsecurity=true/);
});

test('retarget skips an already-closed PR', () => {
  const result = runRetarget(['closed\tdev\tfalse']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.edits, '');
  assert.equal(result.output, 'open=false\n');
});

test('retarget edits a live main PR once and verifies the result', () => {
  const result = runRetarget(['open\tmain\tfalse', 'open\tdev\tfalse']);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.edits, 'edit\n');
  assert.match(result.output, /open=true/);
});

test('retarget accepts a raced edit only when live state has achieved dev', () => {
  const result = runRetarget(['open\tmain\tfalse', 'open\tdev\tfalse', 'open\tdev\tfalse'], 1);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.edits, 'edit\n');
  assert.match(result.output, /open=true/);
});

test('retarget skips a PR that closes during a raced edit', () => {
  const result = runRetarget(['open\tmain\tfalse', 'closed\tmain\tfalse', 'closed\tmain\tfalse'], 1);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'open=false\n');
});

test('retarget preserves a genuine edit failure', () => {
  const result = runRetarget(['open\tmain\tfalse', 'open\tmain\tfalse'], 1);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /::error::Retargeting failed/);
  assert.doesNotMatch(result.output, /open=true/);
});

test('retarget refuses a target changed to another branch', () => {
  const result = runRetarget(['open\tmain\tfalse', 'open\trelease\tfalse']);
  assert.equal(result.status, 1);
  assert.doesNotMatch(result.output, /open=true/);
});

test('retarget preserves a genuine live-read failure', () => {
  const result = runRetarget([], 0, 1);
  assert.equal(result.status, 1);
  assert.equal(result.output, '');
});
