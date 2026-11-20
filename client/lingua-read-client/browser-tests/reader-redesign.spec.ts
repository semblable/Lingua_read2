import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { test, expect } from './reader-redesign.fixture';
import { expectPageFits, horizontalOverflow, unmaskRootOverflow } from './bounds';
import { textContrast } from './contrast';

const themes = ['light', 'dark', 'classic-dark', 'high-contrast-light', 'high-contrast-dark'] as const;

async function openTools(page: Page) {
  await expect(page.locator('.clickable-word').first()).toBeVisible();
  const lesson = page.getByRole('button', { name: 'Open lesson controls', exact: true });
  if (await lesson.isVisible()) await lesson.click();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible() && await menu.getAttribute('aria-expanded') !== 'true') await menu.click();
}

test('embedded dictionary leaves the translation editor available', async ({ page, context, openLayout }) => {
  const lookupUrl = 'https://lexique.example.test/lookup?term=rivi%C3%A8re';
  await page.route(url => url.href === lookupUrl, route => route.fulfill({
    contentType: 'text/html; charset=utf-8',
    body: '<!doctype html><title>Synthetic dictionary</title><p>river, a flowing body of water</p>',
  }));
  await openLayout('texts/801?redesign=1&dictionary=1');
  await page.locator('.text-content .clickable-word').filter({ hasText: /^rivière$/ }).first().click();
  const trigger = page.getByRole('button', { name: 'Lexique', exact: true });
  await trigger.click();
  const frame = page.locator('iframe[title="Lexique dictionary"]');
  await expect(frame.contentFrame().getByText('river, a flowing body of water')).toBeVisible();
  await expect(frame).toHaveAttribute('sandbox', 'allow-scripts allow-forms');
  await expect(page.getByRole('link', { name: 'Open in new tab', exact: true })).toHaveAttribute('href', lookupUrl);
  expect(context.pages()).toHaveLength(1);
  const editor = page.getByRole('textbox', { name: 'Translation', exact: true });
  await editor.fill('river');
  await expect(editor).toHaveValue('river');
  await page.getByRole('button', { name: 'Close dictionary', exact: true }).click();
  await expect(frame).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test('exact Known occurrence stays selected and the compact lookup is legible in all themes', async ({ page, openLayout }, info) => {
  test.setTimeout(90_000);
  await openLayout('texts/801?redesign=1&mode=modern');
  const occurrences = page.locator('.text-content .clickable-word').filter({ hasText: /^maisons$/ });
  await expect(occurrences).toHaveCount(2);
  await occurrences.nth(1).click();
  await page.mouse.move(5, 100);
  const panel = page.locator('.word-info-panel').filter({ has: page.getByRole('heading', { name: 'maisons', exact: true }) });
  const field = panel.getByRole('textbox', { name: 'Translation', exact: true });
  await expect(occurrences.nth(1)).toHaveClass(/reader-word-selected/);
  await expect(occurrences.first()).not.toHaveClass(/reader-word-selected/);
  await expect(page.locator('.reader-word-selected')).toHaveCount(1);
  await expect(field).not.toBeFocused();
  await expect(panel.getByRole('button', { name: 'Known (5)', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: /^(Mine|Mine sentence|Finish \(no stats\))$/i })).toHaveCount(0);
  const compactHeight = (await field.boundingBox())!.height;
  expect(compactHeight, 'Short definitions should occupy about two lines').toBeLessThanOrEqual(64);
  if (page.viewportSize()!.width >= 1000) {
    expect((await page.locator('.right-panel').boundingBox())!.width, 'Desktop word panel must fit its grading controls').toBeGreaterThanOrEqual(288);
  }
  await unmaskRootOverflow(page);
  for (const theme of themes) {
    await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
    await expectPageFits(page);
    expect(await horizontalOverflow(page, '.text-display-wrapper, .word-info-sheet, .word-info-panel')).toEqual([]);
    for (const status of ['New (1)', 'Learning (2)', 'Familiar (3)', 'Advanced (4)', 'Known (5)']) {
      const button = panel.getByRole('button', { name: status, exact: true });
      expect((await textContrast(button)).ratio, `${theme}: ${status} text contrast`).toBeGreaterThanOrEqual(4.5);
    }
    const selectedStyle = await occurrences.nth(1).evaluate(element => {
      const style = getComputedStyle(element);
      return { outline: style.outlineStyle, width: parseFloat(style.outlineWidth), decoration: style.textDecorationLine };
    });
    expect((selectedStyle.outline !== 'none' && selectedStyle.width > 0) || selectedStyle.decoration.includes('underline')).toBe(true);
    await page.screenshot({ path: info.outputPath(`${theme}-selected-known.png`), fullPage: true, animations: 'disabled' });
  }
  const scan = await new AxeBuilder({ page }).include('.word-info-panel').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  await page.emulateMedia({ forcedColors: 'active' });
  expect(await occurrences.nth(1).evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  await page.emulateMedia({ forcedColors: 'none' });
  await field.fill('A longer definition with a usage note.\nA second explanation with more detail.\nA third example to verify the field grows.\nA fourth line to avoid hiding the note.');
  expect((await field.boundingBox())!.height).toBeGreaterThan(compactHeight);
  await field.focus();
  expect(await field.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
});

test('definition can be resized by its native handle and keeps the chosen height in all themes', { tag: '@desktop-only' }, async ({ page, openLayout }, info) => {
  await openLayout('texts/801?redesign=1');
  await page.locator('.text-content .clickable-word').filter({ hasText: /^rivière$/ }).first().click();
  const panel = page.locator('.word-info-panel');
  const field = panel.getByRole('textbox', { name: 'Translation', exact: true });
  await expect(panel.getByRole('button', { name: 'Reading credit', exact: true })).toBeVisible();
  const original = (await field.boundingBox())!;
  await page.mouse.move(original.x + original.width - 4, original.y + original.height - 4);
  await page.mouse.down();
  await page.mouse.move(original.x + original.width - 4, original.y + original.height + 80, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await field.boundingBox())!.height).toBeGreaterThan(original.height + 50);
  const resizedHeight = (await field.boundingBox())!.height;
  // Filling rerenders the controlled field and used to restore the automatic height too.
  await field.fill('river, a flowing body of water');
  expect((await field.boundingBox())!.height).toBeGreaterThanOrEqual(resizedHeight - 1);
  for (const theme of themes) {
    await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
    await expectPageFits(page);
    await expect(field).toBeFocused();
    expect((await field.boundingBox())!.height).toBeCloseTo(resizedHeight, 0);
    const outline = await field.evaluate(element => {
      const style = getComputedStyle(element);
      return { style: style.outlineStyle, offset: parseFloat(style.outlineOffset) };
    });
    expect(outline.style).toBe('solid');
    expect(outline.offset).toBeLessThan(0);
    // Keep the interaction's viewport: full-page capture reset the desktop controls in Linux Chromium.
    await page.screenshot({ path: info.outputPath(`${theme}-resized-definition.png`), fullPage: false, animations: 'disabled' });
    await expect(field).toBeFocused();
    expect((await field.boundingBox())!.height).toBeCloseTo(resizedHeight, 0);
  }
  // Shrinking below the content height must remain scrollable, including after another edit.
  await field.fill(Array.from({ length: 8 }, (_, index) => `Definition note ${index + 1}`).join('\n'));
  expect((await field.boundingBox())!.height).toBeCloseTo(resizedHeight, 0);
  const longField = (await field.boundingBox())!;
  await page.mouse.move(longField.x + longField.width - 4, longField.y + longField.height - 4);
  await page.mouse.down();
  await page.mouse.move(longField.x + longField.width - 4, longField.y + longField.height - 56, { steps: 12 });
  await page.mouse.up();
  const shrunkHeight = (await field.boundingBox())!.height;
  expect(shrunkHeight).toBeLessThan(resizedHeight - 30);
  await field.pressSequentially(' extra note');
  await expect.poll(async () => (await field.boundingBox())!.height).toBeCloseTo(shrunkHeight, 0);
  expect(await field.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  // A panel-width change should also preserve the manually shortened field.
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect.poll(async () => (await field.boundingBox())!.height).toBeCloseTo(shrunkHeight, 0);
  await page.locator('.text-content .clickable-word').filter({ hasText: /^maisons$/ }).first().click();
  expect((await field.boundingBox())!.height).toBeLessThan(shrunkHeight);
});

test('turning automatic cards off hides reading credit while vocabulary grades still save', async ({ page, openLayout, statusNetwork }) => {
  await openLayout('texts/801?redesign=1&srs=off');
  const word = page.locator('.text-content .clickable-word').filter({ hasText: /^rivière$/ }).first();
  await word.click();
  await expect(page.getByRole('heading', { name: 'rivière', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reading credit', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Learning (2)', exact: true }).click();
  await expect.poll(() => statusNetwork.contextWrites.length).toBe(1);
  expect(statusNetwork.contextWrites[0]).toMatchObject({ wordId: 902, status: 2, textId: 801, sentence: 'Éloïse suit la rivière.' });
  await expect(word).toHaveClass(/word-status-2/);
});

test('Appearance stays in bounds, retains keyboard focus, and applies reader preferences', async ({ page, openLayout, appearanceWrites }, info) => {
  test.setTimeout(90_000);
  await openLayout('texts/801?redesign=1&mode=modern');
  await openTools(page);
  const trigger = page.getByRole('button', { name: 'Appearance', exact: true });
  await expect(trigger).toBeVisible();
  await page.keyboard.press('Tab');
  await trigger.focus();
  await page.keyboard.press('Enter');
  const appearance = page.getByRole('dialog', { name: 'Reader appearance', exact: true });
  await expect(appearance).toBeVisible();
  await unmaskRootOverflow(page);
  for (const theme of themes) {
    await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
    await expect(appearance).toBeVisible();
    await expectPageFits(page);
    expect(await horizontalOverflow(page, '[role="dialog"]')).toEqual([]);
    for (const control of await page.locator('.lesson-topbar-actions .btn').all()) {
      if (await control.isVisible()) {
        expect((await textContrast(control)).ratio, `${theme}: mobile header control contrast`).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Capture the open overlay at the tested viewport without a full-page capture's resize cycle.
    await page.screenshot({ path: info.outputPath(`${theme}-appearance.png`), fullPage: false, animations: 'disabled' });
    await expect(appearance).toBeVisible();
  }
  await appearance.getByRole('button', { name: 'Increase text size', exact: true }).click();
  await expect(page.locator('.text-content')).toHaveCSS('font-size', '18px');
  await appearance.getByRole('button', { name: 'Set line spacing to 2', exact: true }).click();
  await expect(page.locator('.text-content')).toHaveCSS('line-height', '36px');
  await expect.poll(() => appearanceWrites.some(patch => patch.textSize === 18)).toBe(true);
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => node.target) }))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(appearance).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('a saved existing word carries the selected example without a Mine action', async ({ page, openLayout, statusNetwork }) => {
  await openLayout('texts/801?redesign=1');
  const occurrences = page.locator('.text-content .clickable-word').filter({ hasText: /^maisons$/ });
  await occurrences.nth(1).click();
  await page.getByRole('button', { name: 'Learning (2)', exact: true }).click();
  await expect.poll(() => statusNetwork.contextWrites.length).toBe(1);
  expect(statusNetwork.contextWrites[0]).toMatchObject({ wordId: 904, status: 2, textId: 801, sentence: 'Les maisons bordent la rivière.' });
  await expect(occurrences.nth(1)).toHaveClass(/reader-word-selected/);
  await expect(occurrences.nth(1)).toHaveClass(/word-status-2/);
  await page.getByRole('button', { name: 'Add next word to selection', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'maisons bordent', exact: true })).toBeVisible();
  await expect(page.locator('.reader-word-selected')).toHaveCount(2);
});

test('hover shortcuts save the actual later occurrence sentence without opening lookup', async ({ page, openLayout, statusNetwork }) => {
  await openLayout('texts/801?redesign=1');
  const occurrences = page.locator('.text-content .clickable-word').filter({ hasText: /^maisons$/ });
  await expect(occurrences).toHaveCount(2);
  await occurrences.nth(1).hover();
  await page.keyboard.press('2');
  await expect.poll(() => statusNetwork.contextWrites.length).toBe(1);
  expect(statusNetwork.contextWrites[0]).toMatchObject({ wordId: 904, status: 2, textId: 801, sentence: 'Les maisons bordent la rivière.' });
  await expect(page.getByRole('textbox', { name: 'Translation', exact: true })).toHaveCount(0);
});

test('audio layout preferences live in Appearance and retain the transcript', async ({ page, openLayout }, info) => {
  await openLayout('texts/802?redesign=1');
  await expect(page.locator('.audio-transcript-container')).toBeVisible();
  await expect(page.locator('.audio-transcript-layout-controls')).toHaveCount(0);
  await openTools(page);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const appearance = page.getByRole('dialog', { name: 'Reader appearance', exact: true });
  await appearance.getByRole('switch', { name: 'Flowing text', exact: true }).check();
  await appearance.getByRole('button', { name: 'Set line spacing to 2', exact: true }).click();
  await expect(page.locator('.audio-transcript-container')).toHaveClass(/audio-transcript-layout-flow/);
  await expect(page.locator('.audio-transcript-container')).toHaveCSS('line-height', '32px');
  await page.keyboard.press('Escape');
  const closeTools = page.locator('.lesson-topbar').getByRole('button', { name: 'Close lesson controls', exact: true });
  if (await closeTools.isVisible()) await closeTools.click();
  await expect(page.locator('.audio-transcript-container .clickable-word').first()).toBeVisible();
  await page.locator('.audio-transcript-container .clickable-word').filter({ hasText: /^rivière$/ }).first().click();
  await expect(page.locator('.audio-transcript-container .reader-word-selected')).toHaveCount(1);
  await page.mouse.move(5, 100);
  for (const theme of themes) {
    await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
    await expectPageFits(page);
    await page.screenshot({ path: info.outputPath(`${theme}-audio-flow.png`), fullPage: true, animations: 'disabled' });
  }
});

test('sentence mode uses the shared appearance preferences and selection marker', async ({ page, openLayout }, info) => {
  await openLayout('texts/801?redesign=1&sentence=1');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const sentence = page.locator('.sentence-mode-text');
  await expect(sentence).toContainText('maisons');
  await sentence.locator('.clickable-word').filter({ hasText: /^maisons$/ }).click();
  await expect(sentence.locator('.reader-word-selected')).toHaveCount(1);
  const lookup = page.getByRole('dialog', { name: 'Word information', exact: true });
  if (await lookup.isVisible()) await page.keyboard.press('Escape');
  await openTools(page);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  const appearance = page.getByRole('dialog', { name: 'Reader appearance', exact: true });
  await appearance.getByRole('button', { name: 'Set line spacing to 2', exact: true }).click();
  await expect(sentence).toHaveCSS('line-height', '32px');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { document.body.className = 'classic-dark-theme'; });
  await page.screenshot({ path: info.outputPath('classic-dark-sentence.png'), fullPage: true, animations: 'disabled' });
});

test('flowing audio shortcuts save the later occurrence sentence across cue boundaries', async ({ page, openLayout, statusNetwork }) => {
  await openLayout('texts/802?redesign=1');
  await openTools(page);
  await page.getByRole('button', { name: 'Appearance', exact: true }).click();
  await page.getByRole('dialog', { name: 'Reader appearance', exact: true })
    .getByRole('switch', { name: 'Flowing text', exact: true }).check();
  await page.keyboard.press('Escape');
  const closeTools = page.locator('.lesson-topbar').getByRole('button', { name: 'Close lesson controls', exact: true });
  if (await closeTools.isVisible()) await closeTools.click();
  // Leave toolbar keyboard focus before exercising the passage's hover shortcuts.
  const wordInfoTitle = page.locator('.word-info-title');
  if (await wordInfoTitle.isVisible()) await wordInfoTitle.click();
  const laterWord = page.locator('.srt-line').filter({ hasText: /^La rivière$/ }).locator('.clickable-word').filter({ hasText: /^rivière$/ });
  await laterWord.hover();
  await page.keyboard.press('2');
  await expect.poll(() => statusNetwork.contextWrites.length).toBe(1);
  expect(statusNetwork.contextWrites[0]).toMatchObject({ wordId: 902, status: 2, textId: 802, sentence: 'La rivière traverse le village.' });
});
