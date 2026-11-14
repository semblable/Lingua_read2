import { test as base, expect } from '@playwright/test';
import type { ReaderStatusIntent } from '../src/utils/readerInteraction';

type SyntheticNetwork = { writes: ReaderStatusIntent[]; delayMs: number; rejectNext: number };

/** Intentionally separate from layout.fixture.ts: its mutation denylist is unchanged. */
export const test = base.extend<{
  interactionNetwork: SyntheticNetwork;
  openInteraction: (query?: string) => Promise<void>;
}>({
  interactionNetwork: async ({ page }, runFixture) => {
    // Depending on page ensures this fixture has the same per-test lifetime.
    void page;
    await runFixture({ writes: [], delayMs: 0, rejectNext: 0 });
  },
  openInteraction: async ({ page, context, baseURL, browser, interactionNetwork }, runFixture) => {
    test.info().annotations.push({ type: 'browser', description: `Chromium ${browser.version()}; ${test.info().project.name}; no AT attached` });
    const unexpectedRequests: string[] = [];
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await context.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin === baseURL && url.pathname === '/api/interaction-fixture/status' && request.method() === 'POST') {
        let intent: ReaderStatusIntent | null = null;
        try {
          const data = request.postDataJSON() as ReaderStatusIntent;
          const keys = Object.keys(data).sort();
          const expectedKeys = ['entityKey', 'generation', 'languageCode', 'occurrenceId', 'sentence', 'status', 'term'].sort();
          if (JSON.stringify(keys) === JSON.stringify(expectedKeys) && data.entityKey.startsWith('synthetic:') &&
            data.generation.startsWith('synthetic:') && typeof data.term === 'string' && typeof data.sentence === 'string' &&
            Number.isInteger(data.status) && data.status >= 1 && data.status <= 6 &&
            JSON.parse(data.occurrenceId)[0] === data.generation) intent = data;
        } catch { /* Malformed writes follow the same denylist as unexpected writes. */ }
        if (intent) {
          interactionNetwork.writes.push(intent);
          const reject = interactionNetwork.rejectNext > 0;
          if (reject) interactionNetwork.rejectNext--;
          if (interactionNetwork.delayMs) await new Promise(resolve => setTimeout(resolve, interactionNetwork.delayMs));
          await route.fulfill({ status: reject ? 409 : 200, json: { synthetic: true, saved: !reject } });
          return;
        }
      }
      if (url.origin === baseURL && request.method() === 'GET' && !url.pathname.startsWith('/api') &&
          ['document', 'script', 'stylesheet', 'font', 'image'].includes(request.resourceType())) {
        await route.continue();
        return;
      }
      unexpectedRequests.push(`${request.method()} ${url.href}`);
      await route.abort('blockedbyclient');
    });
    await runFixture(async (query = '') => {
      await page.goto(`/interaction.html${query ? `?${query}` : ''}`);
      await page.evaluate(() => document.fonts.ready);
      await expect(page.getByTestId('interaction-passage')).toBeVisible();
    });
    expect(unexpectedRequests, 'Interaction checks allow only the exact synthetic status write endpoint').toEqual([]);
    expect(pageErrors, 'Real reader rendering must not raise browser errors').toEqual([]);
  },
});

export { expect };
