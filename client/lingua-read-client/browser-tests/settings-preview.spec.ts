import { test, expect } from '@playwright/test';

test('a fresh settings visit renders marker styles without loading the reader', async ({ page, context, baseURL }) => {
  const unexpected: string[] = [];
  const readerRequests: string[] = [];
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (/TextDisplay\.(?:tsx|css)/.test(url.pathname)) readerRequests.push(url.pathname);
    if (url.origin === baseURL && request.method() === 'GET' && !url.pathname.startsWith('/api/')) await route.continue();
    else { unexpected.push(`${request.method()} ${url.href}`); await route.abort('blockedbyclient'); }
  });
  await page.goto('/settings-preview.html');
  const words = page.locator('.settings-reading-preview [class*="word-status-"]');
  await expect(words).toHaveCount(7);
  const decorations = () => words.evaluateAll(elements => elements.map(element => ({
    line: getComputedStyle(element).textDecorationLine, style: getComputedStyle(element).textDecorationStyle,
  })));
  expect((await decorations()).slice(0, 5)).toEqual(['dotted', 'solid', 'dashed', 'double', 'wavy']
    .map(style => ({ line: 'underline', style })));
  expect((await decorations()).slice(5).map(({ line }) => line)).toEqual(['none', 'none']);
  await page.evaluate(() => document.body.classList.remove('reader-status-markers'));
  expect((await decorations()).map(({ line }) => line)).toEqual(Array(7).fill('none'));
  expect(readerRequests).toEqual([]);
  expect(unexpected).toEqual([]);
});
