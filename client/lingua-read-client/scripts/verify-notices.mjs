#!/usr/bin/env node
// Check shipped artifacts: publicDir/plugin regressions can otherwise silently
// drop notices while the app/demo still builds and runs successfully.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const clientRoot = fileURLToPath(new URL('../', import.meta.url));
const repoRoot = resolve(clientRoot, '../..');
const output = resolve(clientRoot, process.argv[2] || 'build');
const notices = [
  'README.txt', 'jieba.txt', 'tinysegmenter.txt', 'bootstrap.txt', 'bootstrap-icons.txt', 'flag-icons.txt',
  ...['atkinson-hyperlegible', 'inter', 'lato', 'lora', 'merriweather',
    'open-sans', 'roboto-slab'].map((font) => `font-${font}.txt`),
];
const requiredTerms = [
  'py-fsrs',
  'jieba',
  'jieba-v1',
  'TinySegmenter',
  'tinysegmenter-ja-v1',
  'Copyright (c) 2008, Taku Kudo',
  'BSD-3-Clause',
];
let failed = false;
try {
  const thirdPartyNotices = readFileSync(resolve(repoRoot, 'THIRD_PARTY_NOTICES.md'), 'utf8');
  for (const term of requiredTerms) {
    if (!thirdPartyNotices.includes(term)) {
      throw new Error(`THIRD_PARTY_NOTICES.md missing required term: ${term}`);
    }
  }
  const clientTinySegmenter = readFileSync(resolve(clientRoot, 'public/licenses/tinysegmenter.txt'), 'utf8');
  const serverTinySegmenter = readFileSync(
    resolve(repoRoot, 'server/LinguaReadApi/Resources/Segmentation/LICENSE.tinysegmenter.txt'),
    'utf8'
  );
  if (!clientTinySegmenter.includes('Copyright (c) 2008, Taku Kudo')) {
    throw new Error('public/licenses/tinysegmenter.txt missing Taku Kudo copyright');
  }
  if (!serverTinySegmenter.includes('Copyright (c) 2008, Taku Kudo')) {
    throw new Error('server LICENSE.tinysegmenter.txt missing Taku Kudo copyright');
  }
  const csproj = readFileSync(resolve(repoRoot, 'server/LinguaReadApi/LinguaReadApi.csproj'), 'utf8');
  if (!/ThirdPartyNotices[\\/]tinysegmenter\.txt/.test(csproj)) {
    throw new Error('LinguaReadApi.csproj missing ThirdPartyNotices/tinysegmenter.txt');
  }
} catch (error) {
  console.error(`verify-notices: ${error.message}`);
  failed = true;
}
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
