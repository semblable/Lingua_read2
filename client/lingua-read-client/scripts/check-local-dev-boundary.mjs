// Check the resolved development proxy, whose upstream can use local owner auth.
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolveConfig } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url));
const config = await resolveConfig({ root }, 'serve');
assert.ok(['localhost', '127.0.0.1', '::1'].includes(config.server.host),
  'The default development server must listen only on loopback');

for (const path of ['/api/auth/status', '/audio_lessons/fixture.mp3',
  '/audiobooks/1/fixture.mp3', '/epub_assets/fixture.png', '/hardcover-covers/fixture.jpg']) {
  const rule = Object.entries(config.server.proxy ?? {}).find(([pattern]) =>
    pattern.startsWith('^') ? new RegExp(pattern).test(path) : path.startsWith(pattern));
  assert.ok(rule, `Missing development proxy for ${path}`);
  assert.equal(typeof rule[1], 'object', `Proxy for ${path} must preserve caller information`);
  assert.equal(rule[1].xfwd, true,
    `Proxy for ${path} must forward the real caller for the local authentication boundary`);
}

console.log('Local development boundary checks passed.');
