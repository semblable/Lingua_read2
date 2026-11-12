import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Separate root: no production entry, auth bootstrap, offline synchronizer,
// service worker, API proxy, or local preview fixtures enter this test page.
export default defineConfig({
  root: fileURLToPath(new URL('./browser-tests/fixture', import.meta.url)),
  plugins: [react()],
  publicDir: false,
  define: {
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify('/api'),
    'import.meta.env.VITE_API_BASE_URL_MOBILE': JSON.stringify('/api'),
  },
  server: {
    host: '127.0.0.1',
    port: 4175,
    strictPort: true,
    hmr: false,
    fs: { allow: [fileURLToPath(new URL('.', import.meta.url))] },
  },
});
