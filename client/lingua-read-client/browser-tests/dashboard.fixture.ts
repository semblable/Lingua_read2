import { test as base, expect } from '@playwright/test';
import type { RecentTexts } from '../src/utils/api/texts';
import { audioLesson, dashboard, goalSuggestion, languages, readingLesson, recommendations, sparseDetail, sparseLesson } from './data';

type DashboardOptions = {
  dueCount: number;
  primaryLesson: RecentTexts[number];
};

export const test = base.extend<DashboardOptions & { openDashboard: () => Promise<void> }>({
  dueCount: [12_345, { option: true }],
  primaryLesson: [audioLesson, { option: true }],
  openDashboard: async ({ page, context, baseURL, dueCount, primaryLesson }, runFixture) => {
    const unexpectedRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    const apiResponses: Record<string, unknown> = {
      '/api/users/dashboard': dashboard,
      '/api/texts/recent': [primaryLesson, ...[audioLesson, readingLesson, sparseLesson].filter(lesson => lesson.textId !== primaryLesson.textId)],
      '/api/texts': recommendations,
      '/api/texts/703': sparseDetail,
      '/api/srs/stats': { dueCount, reviewableCount: dueCount, totalCards: dueCount },
      '/api/goals': [],
      '/api/languages': languages,
      '/api/goals/suggestions': goalSuggestion,
    };

    // A closed allowlist: no real backend, arbitrary mutations, or external
    // services. Service workers are separately blocked in playwright.config.ts.
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === baseURL && request.method() === 'GET') {
        if (Object.hasOwn(apiResponses, url.pathname)) {
          await route.fulfill({ json: apiResponses[url.pathname] });
          return;
        }
        if (!url.pathname.startsWith('/api') && ['document', 'script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) {
          await route.continue();
          return;
        }
      }
      unexpectedRequests.push(`${request.method()} ${url.href}`);
      await route.abort('blockedbyclient');
    });

    await page.clock.setFixedTime(new Date('2026-11-12T11:00:00Z'));
    await runFixture(async () => {
      await page.goto('/');
      await expect(page.getByTestId('continue-card')).toBeVisible();
      await expect(page.getByTestId('resume-pick-704')).toBeVisible();
      await expect(page.getByRole('button', { name: '+ Set a goal' })).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
    });

    expect(unexpectedRequests, 'Only authored API fixtures and local page assets may be requested').toEqual([]);
    expect(pageErrors, 'The production components must render without browser errors').toEqual([]);
  },
});

export { expect };
