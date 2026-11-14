import { test, expect } from './interaction.fixture';
import AxeBuilder from '@axe-core/playwright';

test('both entry paths share one word tab stop, natural Tab exit and Escape reading return', async ({ page, openInteraction, interactionNetwork }) => {
  await openInteraction();
  const passage = page.getByTestId('interaction-passage');
  await passage.focus();
  const first = passage.locator('[data-reader-occurrence]').first();
  await expect(first).toBeFocused();
  await expect(passage.locator('[tabindex="0"]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(passage).toBeFocused();
  await expect(page.getByTestId('interaction-mode')).toHaveText('reading');
  await page.getByRole('button', { name: 'Interact with words', exact: true }).click();
  await page.keyboard.press('Shift+Tab');
  await expect(page.getByRole('button', { name: 'Exit word interaction', exact: true })).toBeFocused();
  await expect(page.getByTestId('interaction-mode')).toHaveText('reading');
  await page.getByRole('button', { name: 'Interact with words', exact: true }).click();
  await expect(first).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByTestId('after-passage')).toBeFocused();
  await expect(page.getByTestId('interaction-mode')).toHaveText('reading');
  expect(interactionNetwork.writes).toEqual([]);
});

test('stationary pointer, status snapshots, lookup and repeated-word exact return preserve their targets', async ({ page, openInteraction, interactionNetwork }) => {
  await openInteraction();
  const words = page.getByTestId('interaction-passage').locator('[data-reader-occurrence]');
  const first = words.nth(0);
  await first.hover();
  await page.mouse.move((await first.boundingBox())!.x + 3, (await first.boundingBox())!.y + 4);
  await page.getByTestId('interaction-passage').focus();
  await page.keyboard.press('ArrowRight');
  await expect(words.nth(1)).toBeFocused();
  await page.keyboard.press('3');
  await page.getByRole('button', { name: 'Rerender styles' }).evaluate((button: HTMLButtonElement) => button.click());
  await page.evaluate(() => window.scrollBy(0, 1));
  await page.keyboard.press('ArrowRight');
  const repeatedId = await words.nth(2).getAttribute('data-reader-occurrence');
  await page.keyboard.press('4');
  await expect(first).toHaveAttribute('data-status', '4');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Lookup: Alpha' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Close lookup' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(words.nth(2)).toBeFocused();
  expect(await words.nth(2).getAttribute('data-reader-occurrence')).toBe(repeatedId);
  await expect.poll(() => interactionNetwork.writes.length).toBe(2);
  expect(interactionNetwork.writes.map(intent => [intent.term, intent.status])).toEqual([['Beta', 3], ['Alpha', 4]]);
  expect(interactionNetwork.writes[1].occurrenceId).toBe(repeatedId);
  // Explicit motion reacquires hover ownership without moving the keyboard focus.
  await first.hover();
  const box = (await first.boundingBox())!;
  await page.mouse.move(box.x + 2, box.y + 2);
  await page.keyboard.press('5');
  await expect(words.nth(2)).toBeFocused();
  await expect.poll(() => interactionNetwork.writes.length).toBe(3);
  expect(interactionNetwork.writes[2].occurrenceId).toBe(await first.getAttribute('data-reader-occurrence'));
});

test('native route, character preference, IME/native input guards and failure retry remain usable', async ({ page, openInteraction, interactionNetwork }) => {
  await openInteraction();
  await page.getByLabel('Character status shortcuts').uncheck();
  await page.getByRole('button', { name: 'Next word', exact: true }).click();
  await expect(page.getByTestId('target-description')).toContainText('Alpha');
  await page.getByRole('button', { name: 'Next word', exact: true }).click();
  await expect(page.getByTestId('target-description')).toContainText('Beta');
  interactionNetwork.rejectNext = 1;
  await page.getByLabel('Set target status').selectOption('3');
  await expect(page.getByTestId('save-feedback')).toContainText('Could not save Beta');
  await page.getByRole('button', { name: 'Retry synthetic save' }).click();
  await expect(page.getByTestId('save-feedback')).toContainText('synthetic save confirmed');
  await page.getByTestId('interaction-passage').focus();
  await page.keyboard.press('4');
  await page.getByLabel('Native notes').fill('12345');
  await page.getByLabel('Character status shortcuts').check();
  await page.getByLabel('Native notes').press('3');
  await page.getByTestId('interaction-passage').focus();
  await page.locator('[data-reader-occurrence][tabindex="0"]').evaluate(word => {
    word.dispatchEvent(new KeyboardEvent('keydown', { key: '3', isComposing: true, bubbles: true }));
    word.dispatchEvent(new KeyboardEvent('keydown', { key: '3', repeat: true, bubbles: true }));
  });
  expect(interactionNetwork.writes).toHaveLength(2);
  await page.getByRole('button', { name: 'Look up target', exact: true }).click();
  await page.getByLabel('Lookup notes').fill('123');
  await page.getByLabel('Lookup notes').press('3');
  expect(interactionNetwork.writes).toHaveLength(2);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('logical phrase/RTL order and Korean alias source spans use renderer units once', async ({ page, openInteraction }) => {
  await openInteraction();
  await page.getByTestId('interaction-passage').focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-reader-occurrence][tabindex="0"]')).toHaveText('New York harbour');
  await page.getByRole('combobox', { name: 'Passage', exact: true }).selectOption('rtl');
  await expect(page.getByTestId('interaction-mode')).toHaveText('reading');
  await page.getByRole('button', { name: 'Interact with words', exact: true }).click();
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('[data-reader-occurrence][tabindex="0"]')).toHaveText('هادئ');
  await page.getByRole('combobox', { name: 'Passage', exact: true }).selectOption('korean');
  await page.getByRole('button', { name: 'Interact with words', exact: true }).click();
  await expect(page.locator('[data-reader-occurrence][tabindex="0"]')).toHaveText('한국 학교');
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('[data-reader-occurrence][tabindex="0"]')).toHaveText('옆에서');
});

test('content generation and presentation changes invalidate anchors and late UI effects', async ({ page, openInteraction, interactionNetwork }) => {
  await openInteraction();
  interactionNetwork.delayMs = 500;
  await page.getByTestId('interaction-passage').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('3');
  await page.getByRole('button', { name: 'Replace passage generation' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByTestId('interaction-passage')).toBeFocused();
  await expect(page.getByTestId('interaction-mode')).toHaveText('reading');
  await expect(page.getByTestId('save-feedback')).toHaveText('No saves yet.');
  await page.keyboard.press('3');
  await page.getByRole('combobox', { name: 'Presentation', exact: true }).selectOption('sentence');
  await page.getByRole('button', { name: 'Interact with words', exact: true }).click();
  await expect(page.locator('[data-reader-occurrence][tabindex="0"]')).toHaveText('Alpha');
  await expect.poll(() => interactionNetwork.writes.length).toBe(1);
  await expect(page.getByTestId('spike-diagnostics')).toContainText('0 seeks');
});

test('virtualized lookup return remounts its exact cue; full reading comparison has one representation', async ({ page, openInteraction, interactionNetwork }) => {
  await openInteraction('scenario=transcript');
  const passage = page.getByTestId('interaction-passage');
  expect(await passage.locator('.srt-line').count()).toBeLessThan(100);
  await passage.focus();
  const first = passage.locator('[data-reader-occurrence]').first();
  const returnId = await first.getAttribute('data-reader-occurrence');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  // Scroll the real virtual list while modal owns focus to force row unmounting.
  await passage.locator('[role="list"]').evaluate(list => { list.scrollTop = list.scrollHeight; list.dispatchEvent(new Event('scroll')); });
  await expect(passage.locator('#srt-line-1')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.readerOccurrence)).toBe(returnId);
  await expect(page.getByTestId('spike-diagnostics')).toContainText('0 seeks');
  // Move from the last mounted source unit into a genuinely absent next row.
  // preventScroll retains that virtual boundary until the controller reveals it.
  const edge = passage.locator('[data-reader-occurrence]').last();
  const nextBlock = `source-${Number((await edge.getAttribute('data-source-block'))!.replace('source-', '')) + 1}`;
  await expect(passage.locator(`[data-source-block="${nextBlock}"]`)).toHaveCount(0);
  await edge.evaluate((node: HTMLElement) => node.focus({ preventScroll: true }));
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.sourceBlock)).toBe(nextBlock);
  const followAnchor = await page.evaluate(() => (document.activeElement as HTMLElement).dataset.readerOccurrence);
  // Trigger a simulated playback-follow event without moving the focused occurrence.
  await page.getByRole('button', { name: 'Simulate playback follow' }).evaluate((button: HTMLButtonElement) => button.click());
  await expect.poll(() => page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.readerOccurrence)).toBe(followAnchor);
  await expect(page.getByTestId('spike-diagnostics')).toContainText('Playback follow deferred');
  await page.getByLabel('Full transcript reading comparison').check();
  await expect(passage.locator('.srt-line')).toHaveCount(100);
  await expect(passage.locator('[role="list"]')).toHaveCount(0);
  expect(interactionNetwork.writes).toEqual([]);
});

test('marker candidates keep Known/Ignored plain and expose exact target status in dense text', async ({ page, openInteraction }) => {
  await openInteraction('scenario=first-read');
  await page.getByLabel('Marker candidate').selectOption('stronger');
  const untracked = page.locator('.spike-word[data-status="0"]').first();
  await expect(untracked).toHaveAttribute('data-marker', '○');
  await page.getByTestId('interaction-passage').focus();
  await expect(page.getByTestId('target-description')).toContainText('Untracked');
  await page.getByLabel('Marker candidate').selectOption('stages');
  for (const status of [5, 6]) {
    const plain = page.locator(`.spike-word[data-status="${status}"]`);
    if (await plain.count()) {
      expect(await plain.first().evaluate(node => getComputedStyle(node).textDecorationLine)).toBe('none');
      await expect(plain.first()).not.toHaveAttribute('data-marker');
    }
  }
  if (['chromium-1280', 'chromium-desktop-320'].includes(test.info().project.name)) {
    for (const scenario of ['first-read', 'mixed']) {
      await page.getByRole('combobox', { name: 'Passage', exact: true }).selectOption(scenario);
      for (const candidate of ['current', 'stages', 'stronger']) {
        await page.getByLabel('Marker candidate').selectOption(candidate);
        await page.getByTestId('interaction-passage').focus();
        await page.screenshot({ path: test.info().outputPath(`markers-${scenario}-${candidate}.png`), fullPage: true });
      }
    }
  }
});

test('interaction normal, focused, lookup and rejected-save states emit no scoped axe violations', async ({ page, openInteraction, interactionNetwork }) => {
  await openInteraction();
  const scan = async (selector: string) => {
    const results = await new AxeBuilder({ page }).include(selector)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(results.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, failure: node.failureSummary })) }))).toEqual([]);
  };
  await scan('main');
  await page.getByTestId('interaction-passage').focus();
  await scan('main');
  interactionNetwork.rejectNext = 1;
  interactionNetwork.delayMs = 200;
  await page.keyboard.press('3');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible();
  await scan('[role="dialog"]');
  await expect(page.getByRole('dialog').getByTestId('save-feedback')).toContainText('Could not save');
  await expect(page.getByRole('status')).toHaveCount(1);
  await scan('[role="dialog"]');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-feedback')).toContainText('Could not save');
  await scan('main');
});
