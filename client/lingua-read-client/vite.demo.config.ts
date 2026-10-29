/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readdirSync, readFileSync } from 'node:fs';

// The demo has a separate publicDir. Retain the same font/icon license texts as
// the full application without maintaining another checked-in copy.
const licensesDirectory = new URL('./public/licenses/', import.meta.url);

// A separate entry point: the normal application, authentication and service worker
// never acquire a demo mode. This build can be served by any static file host.
export default defineConfig({
  root: fileURLToPath(new URL('./demo', import.meta.url)),
  base: process.env.DEMO_BASE_PATH || '/Lingua_read2/',
  plugins: [react(), {
    name: 'bundled-asset-licenses',
    generateBundle() {
      for (const file of readdirSync(licensesDirectory)) {
        this.emitFile({
          type: 'asset', fileName: `licenses/${file}`,
          source: readFileSync(new URL(file, licensesDirectory)),
        });
      }
    },
  }],
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/__linguaread_demo_api'),
    'import.meta.env.VITE_API_BASE_URL_MOBILE': JSON.stringify('/__linguaread_demo_api'),
  },
  server: { host: '127.0.0.1', port: 4174, strictPort: true },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: {
    outDir: '../demo-dist',
    emptyOutDir: true,
    sourcemap: false,
    target: ['es2020', 'safari14'],
  },
  test: {
    environment: 'happy-dom',
    include: ['**/*.test.ts'],
  },
});
