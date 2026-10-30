#!/usr/bin/env node
// Check shipped artifacts: publicDir/plugin regressions can otherwise silently
// drop notices while the app/demo still builds and runs successfully.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const output = resolve(clientRoot, process.argv[2] || 'build');
const notices = [
  'README.txt', 'jieba.txt', 'bootstrap.txt', 'bootstrap-icons.txt', 'flag-icons.txt',
  ...['atkinson-hyperlegible', 'inter', 'lato', 'lora', 'merriweather',
    'open-sans', 'roboto-slab'].map((font) => `font-${font}.txt`),
];
let failed = false;
for (const file of notices) {
  try {
    const source = readFileSync(resolve(clientRoot, 'public/licenses', file));
    const shipped = readFileSync(resolve(output, 'licenses', file));
    if (!source.equals(shipped)) throw new Error('differs from the source notice');
  } catch (error) {
    console.error(`verify-notices: ${file}: ${error.message}`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log(`verify-notices: ${notices.length} notices retained in ${output}`);
