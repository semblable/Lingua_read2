import { test, expect } from '@playwright/test';

const password = 'synthetic-learner-password';
const title = 'Synthetic browser session';
const text = 'El gato mira la luna. Una amiga saluda.';

test('production setup, upload, vocabulary and review persist through reload and sign-in', async ({ page, context }) => {
  await page.goto('/books/create');
  await page.getByLabel('Operator setup token').fill('synthetic-operator-token');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByLabel('Confirm Password').fill(password);
  await page.getByRole('button', { name: 'Set Password', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Create New Book' })).toBeVisible();

  await page.getByLabel('Book Title', { exact: true }).fill(title);
  await page.getByLabel('Language', { exact: true }).selectOption({ label: 'Spanish' });
  const languageId = await page.getByLabel('Language', { exact: true }).inputValue();
  await page.getByRole('tab', { name: 'Upload File (.txt, .epub)', exact: true }).click();
  await page.getByLabel('Select Book File').setInputFiles({
    name: 'synthetic-browser-session.txt', mimeType: 'text/plain', buffer: Buffer.from(text),
  });
  const uploaded = page.waitForResponse(response => response.url().endsWith('/api/books/upload') && response.request().method() === 'POST');
  await page.getByRole('button', { name: 'Create Book from File', exact: true }).click();
  expect((await uploaded).status()).toBe(201);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Start Reading', exact: true }).click();
  await expect(page).toHaveURL(/\/texts\/\d+$/);
  const readerURL = page.url();
  const gato = page.locator('.clickable-word').filter({ hasText: /^gato$/ }).first();
  await gato.click();
  const translation = page.getByRole('textbox', { name: 'Translation', exact: true });
  await expect(translation).toBeEnabled();
  await translation.fill('cat');
  // Import links untracked vocabulary rows; saving grades that existing word.
  const saved = page.waitForResponse(response => /^\/api\/words\/\d+$/.test(new URL(response.url()).pathname) && response.request().method() === 'PUT');
  await page.getByRole('button', { name: 'Learning (2)', exact: true }).click();
  const savedResponse = await saved;
  expect(savedResponse.status()).toBe(204);
  const storedWord = await context.request.get(new URL(savedResponse.url()).pathname);
  expect(storedWord.ok()).toBe(true);
  const word = await storedWord.json();
  expect(word.wordId).toBeGreaterThan(0);
  expect(word.translation).toBe('cat');

  // Fresh HTTP reads through the production shell must recover persisted data.
  await page.reload();
  await gato.click();
  await expect(translation).toHaveValue('cat');
  await expect(page.getByRole('button', { name: 'Learning (2)', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // Exercise the real service worker, IndexedDB mutation queue and reconnect
  // handler together. No API or module is mocked in this suite.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL)).toContain('/sw.js');
  await context.setOffline(true);
  await translation.fill('cat — edited offline');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save', exact: true })).toHaveCount(0);
  // Discard the in-memory app before reconnecting: replay must recover the
  // durable queue. The offline navigation also needs the cached app shell.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await context.setOffline(false);
  await page.goto(readerURL);
  await expect.poll(async () => {
    const response = await context.request.get(`/api/words/${word.wordId}`);
    expect(response.ok()).toBe(true);
    return (await response.json()).translation;
  }).toBe('cat — edited offline');

  await page.goto('/srs');
  await page.locator('.srs-setup-card').getByRole('combobox').selectOption(languageId);
  await page.getByRole('button', { name: /Start Review/i }).click();
  const card = page.getByTestId('translation-review-card');
  await expect(card).toContainText('gato');
  await card.click();
  await expect(card).toContainText('cat — edited offline');
  const reviewed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/srs/review' && response.request().method() === 'POST');
  await page.getByRole('button', { name: /^Good/ }).click();
  const reviewResponse = await reviewed;
  expect(reviewResponse.ok()).toBe(true);
  const review = await reviewResponse.json();
  expect(review.srsReviewLogId).toBeGreaterThan(0);
  expect(review.stability).toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await page.getByText('Logout on all devices', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Log In', exact: true })).toBeVisible();
  await page.reload();
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Log In', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Account', exact: true })).toBeVisible();
  await page.goto(readerURL);
  await gato.click();
  await expect(translation).toHaveValue('cat — edited offline');
  const lastReview = await context.request.get('/api/srs/last-review');
  expect(lastReview.ok()).toBe(true);
  expect((await lastReview.json()).srsReviewLogId).toBe(review.srsReviewLogId);
});
