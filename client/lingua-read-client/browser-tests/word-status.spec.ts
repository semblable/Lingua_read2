import { test, expect } from './word-status.fixture';

test('save feedback keeps hovered shortcut targets stationary through delayed announcements', async ({ page, openLayout, statusNetwork }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.clock.install({ time: new Date('2026-11-12T11:00:00Z') });
  await openLayout('texts/801?mixed=1');
  const words = page.locator('.text-content .clickable-word');
  const first = words.filter({ hasText: /^Éloïse$/ }).first();
  const second = words.filter({ hasText: /^suit$/ }).first();
  await expect(first).toHaveClass(/word-status-1/);
  await page.clock.pauseAt(new Date('2026-11-12T11:01:00Z'));
  const originalBounds = await second.boundingBox();
  statusNetwork.hold.add(900);
  await first.hover();
  await page.keyboard.press('3');
  await expect.poll(() => statusNetwork.writes.length).toBe(1);
  await expect(page.locator('.reader-save-pending')).toContainText('Saving 1 word.');
  expect(await second.boundingBox()).toEqual(originalBounds);
  await second.hover();
  // Let the coalesced live announcement arrive while the pointer stays on suit.
  await page.clock.runFor(160);
  await expect(page.locator('.reader-save-feedback')).toContainText('Saving');
  expect(await second.boundingBox()).toEqual(originalBounds);
  await page.keyboard.press('4');
  await expect.poll(() => statusNetwork.writes.length).toBe(2);
  expect(statusNetwork.writes).toEqual([{ wordId: 900, status: 3 }, { wordId: 901, status: 4 }]);
  await expect(second).toHaveClass(/word-status-4/);
  statusNetwork.release(900);
  await expect(page.locator('.reader-save-pending')).toBeEmpty();
  await page.clock.runFor(160);
  await expect(page.locator('.reader-save-feedback')).toContainText('saved');
  expect(await second.boundingBox()).toEqual(originalBounds);
});

test('real reader captures rapid different-word intents and does not retarget a delayed save', async ({ page, openLayout, statusNetwork }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openLayout('texts/801?mixed=1');
  const words = page.locator('.text-content .clickable-word');
  const first = words.filter({ hasText: /^Éloïse$/ }).first();
  const second = words.filter({ hasText: /^suit$/ }).first();
  statusNetwork.hold.add(900);
  await first.hover();
  await page.keyboard.press('3');
  await expect.poll(() => statusNetwork.writes.length).toBe(1);
  await second.hover();
  await page.keyboard.press('4');
  await expect.poll(() => statusNetwork.writes.length).toBe(2);
  expect(statusNetwork.writes).toEqual([{ wordId: 900, status: 3 }, { wordId: 901, status: 4 }]);
  await expect(first).toHaveClass(/word-status-3/);
  await expect(second).toHaveClass(/word-status-4/);
  statusNetwork.release(900);
  await expect(page.locator('.reader-save-feedback')).toContainText('saved');
  await expect(first).toHaveClass(/word-status-3/);
  await expect(second).toHaveClass(/word-status-4/);
});

test('real lookup keeps its rejected save and retry controls inside the narrow modal', async ({ page, openLayout, statusNetwork }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openLayout('texts/801?mixed=1');
  statusNetwork.rejectNext.add(902);
  await page.locator('.text-content .clickable-word').filter({ hasText: /^rivière$/ }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Word information' });
  await dialog.getByRole('button', { name: 'Advanced (4)' }).click();
  const retry = dialog.getByRole('button', { name: 'Retry saving rivière' });
  await expect(retry).toBeVisible();
  await expect(dialog.locator('.reader-save-feedback')).toContainText('Could not save rivière');
  await retry.click();
  await expect(retry).toBeHidden();
  await expect(dialog.locator('.reader-save-feedback')).toContainText('Advanced saved');
  expect(statusNetwork.writes).toEqual([{ wordId: 902, status: 4 }, { wordId: 902, status: 4 }]);
});
