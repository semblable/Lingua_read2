/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config replacing Create React App.
// - dev server stays on :3000 to match prior CRA setup (docker/nginx assume nothing here, but devs do)
// - build output dir is `build/` (matches Dockerfile: `COPY --from=build /app/build ./`)
// - assets nested under `static/` so nginx.conf's `location /static/` aggressive-cache rule keeps working
export default defineConfig({
  plugins: [react()],
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
  // Lets the gradual TS migration proceed without renaming every component
  // to .jsx first. Phase C will rename .js -> .tsx as files are converted.
  esbuild: {
    loader: 'jsx',
    include: /src\/.*\.jsx?$/,
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
    setupFiles: ['./src/setupTests.js'],
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
