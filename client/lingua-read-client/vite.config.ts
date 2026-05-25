/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// Vite config replacing Create React App.
// - dev server stays on :3000 to match prior CRA setup (docker/nginx assume nothing here, but devs do)
// - build output dir is `build/` (matches Dockerfile: `COPY --from=build /app/build ./`)
// - assets nested under `static/` so nginx.conf's `location /static/` aggressive-cache rule keeps working
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      // The service worker stays out of the dev server by default; flip this
      // (or `npm run dev -- --mode pwa-dev`) when debugging caching behavior.
      devOptions: { enabled: false },
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'LinguaRead',
        short_name: 'LinguaRead',
        description: 'Contextual language learning with SRS, audio lessons, and offline reading.',
        theme_color: '#0d6efd',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        scope: '/',
        icons: [
          { src: '/favicon.ico', sizes: '64x64 32x32 24x24 16x16', type: 'image/x-icon' },
          { src: '/logo192.png', sizes: '192x192', type: 'image/png' },
          { src: '/logo512.png', sizes: '512x512', type: 'image/png' },
          { src: '/logo512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Static assets are precached by Workbox. Increase the size cap so the
        // larger React bundle from the migration fits.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        // Custom runtime caching for the API surface.
        runtimeCaching: [
          {
            // GET /api/texts/{id}/content — heaviest reads, served fresh when
            // online and from cache (up to a week old) when offline.
            urlPattern: /^.*\/api\/texts\/\d+\/content.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lr-text-content',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Book metadata + chapter list.
            urlPattern: /^.*\/api\/books\/\d+$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lr-book-meta',
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 7 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // SRS due queue — short stale window since it changes per grade.
            urlPattern: /^.*\/api\/srs\/due.*$/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'lr-srs-due',
              networkTimeoutSeconds: 3,
              expiration: { maxEntries: 20, maxAgeSeconds: 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Audio assets — only cached when user explicitly downloads them
            // via the DownloadForOfflineButton (which uses the Cache Storage
            // API directly). CacheFirst here so the service worker doesn't
            // re-fetch large MP3 files on every replay.
            //
            // rangeRequests: true installs Workbox's RangeRequestsPlugin so
            // <audio> elements can SEEK against cached files — without it,
            // the browser's Range request (`Range: bytes=N-`) would miss the
            // cache (because cache.match() is exact-URL) and fall back to the
            // network, defeating the offline guarantee.
            urlPattern: /^.*\/(audio_lessons|audiobooks)\/.*$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'lr-audio',
              rangeRequests: true,
              expiration: { maxEntries: 500, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200, 206] },
            },
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    open: false,
  },
  build: {
    outDir: 'build',
    assetsDir: 'static',
    sourcemap: true,
  },
  // Treat .js files as JSX (CRA allowed this; Vite doesn't by default).
  // Use the `tsx` loader (a permissive superset of jsx + ts) so that .ts and
  // .tsx files added during the Phase C migration are also handled — setting
  // `esbuild.include` REPLACES Vite's default ts/jsx/tsx include, so we have
  // to list every extension we want processed.
  // Phase C will rename .js -> .tsx as files are converted; this config keeps
  // working throughout the migration.
  esbuild: {
    loader: 'tsx',
    include: /src\/.*\.[jt]sx?$/,
    exclude: [],
  },
  optimizeDeps: {
    esbuildOptions: {
      loader: { '.js': 'jsx' },
    },
  },
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/setupTests.ts'],
    css: false,
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}', 'src/__tests__/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    // Match Jest's modern fake-timer behavior. Vitest's default also mocks
    // queueMicrotask/nextTick/requestAnimationFrame, which breaks
    // @testing-library's `waitFor`/`findBy*` polling. shouldAdvanceTime lets
    // the fake clock tick forward with real wall-clock time so waitFor can
    // poll without the test calling advanceTimersByTime manually (matches
    // Jest's modern-timers behavior with @testing-library).
    fakeTimers: {
      toFake: [
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'setImmediate',
        'clearImmediate',
        'Date',
        'performance',
      ],
      shouldAdvanceTime: true,
      advanceTimeDelta: 20,
    },
  },
});
