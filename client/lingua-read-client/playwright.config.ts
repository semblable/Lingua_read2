import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './browser-tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 2,
  timeout: 30_000,
  reporter: [['list'], ['html', { open: 'never' }]],
  outputDir: 'test-results/browser',
  use: {
    baseURL: 'http://127.0.0.1:4175',
    browserName: 'chromium',
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [320, 390, 430, 1280].map(width => ({
    name: `chromium-${width}`,
    use: {
      viewport: { width, height: 900 },
      isMobile: width < 768,
      hasTouch: width < 768,
    },
  })),
  webServer: {
    command: 'npx vite --config vite.browser.config.ts',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
