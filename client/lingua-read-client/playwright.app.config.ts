import { defineConfig } from '@playwright/test';

// The runner starts a fresh, isolated Compose project and supplies its loopback
// port. Never accept a production/staging URL for these mutating tests.
const baseURL = process.env.LINGUA_APP_SMOKE_URL;
if (!baseURL || !/^http:\/\/127\.0\.0\.1:\d+$/.test(baseURL)) {
  throw new Error('Run npm run test:app to provision the synthetic app smoke stack.');
}

export default defineConfig({
  testDir: './app-smoke',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-app-report' }]],
  outputDir: 'test-results/app-smoke',
  use: {
    baseURL,
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    browserName: 'chromium',
    viewport: { width: 1280, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Warsaw',
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
});
