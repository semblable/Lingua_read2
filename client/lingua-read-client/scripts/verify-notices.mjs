#!/usr/bin/env node
// Check shipped artifacts: publicDir/plugin regressions can otherwise silently
// drop notices while the app/demo still builds and runs successfully.
import { existsSync, readFileSync } from 'node:fs';
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
const noticesFile = resolve(repoRoot, 'THIRD_PARTY_NOTICES.md');
const serverLicense = resolve(repoRoot, 'server/LinguaReadApi/Resources/Segmentation/LICENSE.tinysegmenter.txt');
const serverProject = resolve(repoRoot, 'server/LinguaReadApi/LinguaReadApi.csproj');
let failed = false;

// The repository-level checks need the whole checkout. The web image builds from
// the client directory alone, where these files do not exist, so only the shipped
// notice comparison below runs there; a full checkout (local, CI) checks both.
const fullCheckout = existsSync(noticesFile) && existsSync(serverProject);
if (fullCheckout) {
  try {
    const thirdPartyNotices = readFileSync(noticesFile, 'utf8');
    for (const term of requiredTerms) {
      if (!thirdPartyNotices.includes(term)) {
        throw new Error(`THIRD_PARTY_NOTICES.md missing required term: ${term}`);
      }
    }
    const clientTinySegmenter = readFileSync(resolve(clientRoot, 'public/licenses/tinysegmenter.txt'), 'utf8');
    const serverTinySegmenter = readFileSync(serverLicense, 'utf8');
    if (!clientTinySegmenter.includes('Copyright (c) 2008, Taku Kudo')) {
      throw new Error('public/licenses/tinysegmenter.txt missing Taku Kudo copyright');
    }
    if (!serverTinySegmenter.includes('Copyright (c) 2008, Taku Kudo')) {
      throw new Error('server LICENSE.tinysegmenter.txt missing Taku Kudo copyright');
    }
    const csproj = readFileSync(serverProject, 'utf8');
    if (!/ThirdPartyNotices[\\/]tinysegmenter\.txt/.test(csproj)) {
      throw new Error('LinguaReadApi.csproj missing ThirdPartyNotices/tinysegmenter.txt');
    }
  } catch (error) {
    console.error(`verify-notices: ${error.message}`);
    failed = true;
  }
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
console.log(`verify-notices: ${notices.length} notices retained in ${output}${fullCheckout ? '' : ' (client-only context: repository notices not checked)'}`);
