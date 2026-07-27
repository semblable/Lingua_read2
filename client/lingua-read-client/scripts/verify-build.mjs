#!/usr/bin/env node
// Build-output regression guard. Runs automatically after `npm run build` (postbuild),
// so both CI and the Docker image build fail loudly if a config regression sneaks in:
//   1. Production sourcemaps re-enabled (vite.config.ts build.sourcemap)
//   2. External CDN references reintroduced (fonts/icons must stay self-hosted —
//      the nginx CSP no longer allows those hosts, so a CDN <link> would break silently)
//   3. Vendor chunk splitting removed (react/bootstrap/charts must cache independently)
//   4. Fonts no longer bundled
//   5. PWA service worker not generated
// Keep this list in sync with vite.config.ts and nginx.conf.

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const buildDir = fileURLToPath(new URL('../build', import.meta.url));

const failures = [];

if (!existsSync(buildDir)) {
  console.error(`verify-build: build directory not found at ${buildDir} — run vite build first`);
  process.exit(1);
}

const staticDir = join(buildDir, 'static');
const staticFiles = existsSync(staticDir) ? readdirSync(staticDir) : [];

// 1. No sourcemaps in production output.
const maps = staticFiles.filter((f) => f.endsWith('.map'));
if (maps.length > 0) {
  failures.push(`sourcemaps present in build/static (${maps.length} .map files) — set build.sourcemap: false in vite.config.ts`);
}

// 2. No CDN hosts anywhere in the shipped text assets.
const cdnPattern = /fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net/;
const textAssets = [
  join(buildDir, 'index.html'),
  ...staticFiles.filter((f) => /\.(css|js)$/.test(f)).map((f) => join(staticDir, f)),
];
for (const file of textAssets) {
  if (existsSync(file) && cdnPattern.test(readFileSync(file, 'utf8'))) {
    failures.push(`CDN reference found in ${file} — fonts/icons must be self-hosted (@fontsource / bootstrap-icons packages)`);
  }
}

// 3. Vendor chunks exist (manualChunks in vite.config.ts).
for (const chunk of ['vendor-react', 'vendor-bootstrap', 'vendor-charts']) {
  if (!staticFiles.some((f) => f.startsWith(`${chunk}-`) && f.endsWith('.js'))) {
    failures.push(`missing ${chunk}-*.js chunk — manualChunks config in vite.config.ts was removed or renamed`);
  }
}

// 4. Fonts are bundled locally.
if (!staticFiles.some((f) => f.endsWith('.woff2'))) {
  failures.push('no .woff2 files in build/static — @fontsource imports in src/index.tsx are missing');
}

// 5. PWA service worker generated.
if (!existsSync(join(buildDir, 'sw.js'))) {
  failures.push('build/sw.js missing — vite-plugin-pwa did not run');
}

if (failures.length > 0) {
  console.error('verify-build: FAILED');
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(1);
}

const totalKb = Math.round(
  staticFiles.reduce((sum, f) => sum + statSync(join(staticDir, f)).size, 0) / 1024
);
console.log(`verify-build: OK (${staticFiles.length} static assets, ${totalKb} KiB, 0 sourcemaps, 0 CDN refs, vendor chunks present)`);
