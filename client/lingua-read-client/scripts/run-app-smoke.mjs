import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('..', import.meta.url));
const composeFile = fileURLToPath(new URL('../../../verification/compose.yml', import.meta.url));
const playwright = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
const args = process.argv.slice(2);
const discoveryOnly = args.includes('--list');
// Every invocation owns its containers and volumes; cleanup cannot touch a
// developer's running verification stack or an earlier synthetic checkpoint.
const project = `linguaread-app-smoke-${randomBytes(6).toString('hex')}`;
const compose = ['compose', '-f', composeFile, '-p', project];
let child;
let interrupted = false;

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    interrupted = true;
    child?.kill('SIGTERM');
  });
}

function run(command, commandArgs, env, timeout) {
  return new Promise((resolve, reject) => {
    child = spawn(command, commandArgs, { cwd: clientRoot, env, stdio: 'inherit', timeout });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      child = undefined;
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with ${signal || code}`));
    });
  });
}

async function freePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}

const port = discoveryOnly ? 18082 : await freePort();
const env = {
  ...process.env,
  VERIFY_PORT: String(port),
  LINGUA_APP_SMOKE_URL: `http://127.0.0.1:${port}`,
};

async function waitForApp() {
  // Compose's --wait also accepts merely "running" services without a health
  // check. Wait for migrations and auth bootstrap behind nginx, not just PID 1.
  for (let attempt = 0; attempt < 60; attempt++) {
    if (interrupted) throw new Error('App smoke interrupted');
    try {
      const response = await fetch(`${env.LINGUA_APP_SMOKE_URL}/api/auth/status`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok && (await response.json()).needsSetup === true) return;
    } catch {
      // Connection refused / nginx 502 while the isolated API is starting.
    }
    await delay(500);
  }
  throw new Error('The fresh synthetic app did not become ready for account setup.');
}

try {
  if (!discoveryOnly) {
    await run('docker', [...compose, 'up', '--build', '--detach', '--wait', '--wait-timeout', '180'], env, 900_000);
    if (interrupted) throw new Error('App smoke interrupted');
    await waitForApp();
  }
  await run(process.execPath, [playwright, 'test', '--config=playwright.app.config.ts', ...args], env, 180_000);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
  if (!discoveryOnly) {
    await run('docker', [...compose, 'logs', '--no-color', '--tail', '80'], env, 30_000).catch(() => {});
  }
} finally {
  if (!discoveryOnly) {
    await run('docker', [...compose, 'down', '--volumes', '--remove-orphans', '--rmi', 'local'], env, 60_000).catch(error => {
      console.error(`Could not clean up synthetic stack ${project}: ${error.message}`);
      process.exitCode = 1;
    });
  }
}
