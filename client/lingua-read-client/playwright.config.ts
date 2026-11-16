import { defineConfig } from '@playwright/test';

// Fixed-width regressions belong to their actual input/viewport context instead
// of resizing all five projects to the same width. Keep narrow touch and mouse
// coverage separate: isMobile/hasTouch cannot be changed by setViewportSize.
const desktopOnly = /@desktop-only/;
const narrowOnly = /@narrow-only/;
const desktopReflow = /@desktop-reflow/;
const interactionExperiment = '**/interaction.spec.ts';

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
  projects: [...[320, 390, 430, 1280].map(width => ({
    name: `chromium-${width}`,
    testIgnore: interactionExperiment,
    grepInvert: width === 1280
      ? [narrowOnly, desktopReflow]
      : width === 320
        ? [desktopOnly, desktopReflow]
        : [desktopOnly, narrowOnly, desktopReflow],
    use: {
      viewport: { width, height: 900 },
      isMobile: width < 768,
      hasTouch: width < 768,
    },
  })), {
    name: 'chromium-desktop-320',
    testIgnore: interactionExperiment,
    grepInvert: desktopOnly,
    use: { viewport: { width: 320, height: 900 }, isMobile: false, hasTouch: false },
  }, ...[
    { name: 'desktop-1280', width: 1280, touch: false },
    { name: 'desktop-320', width: 320, touch: false },
    { name: 'touch-320', width: 320, touch: true },
  ].map(({ name, width, touch }) => ({
    // This fixture is an interaction experiment, not production reader evidence.
    // It stays in the default run, with desktop and narrow touch coverage.
    name: `experiment-interaction-${name}`,
    testMatch: interactionExperiment,
    use: { viewport: { width, height: 900 }, isMobile: touch, hasTouch: touch },
  }))],
  webServer: {
    command: 'npx vite --config vite.browser.config.ts',
    url: 'http://127.0.0.1:4175',
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
