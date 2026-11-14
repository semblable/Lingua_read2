import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './layout.fixture';
import { expectPageFits, unmaskRootOverflow } from './bounds';
import { navigationIconContrast, textContrast } from './contrast';

const themes = ['light', 'dark', 'classic-dark', 'high-contrast-light', 'high-contrast-dark'] as const;

for (const theme of themes) {
  test(`${theme}: legibility, focus and translation dialog`, async ({ page, openLayout }, info) => {
    test.setTimeout(60_000);
    await openLayout('presentation');
    await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
    await unmaskRootOverflow(page);
    await expectPageFits(page);
    const menuIcon = page.locator('.app-navigation .navbar-toggler-icon');
    if (await menuIcon.isVisible()) expect(await navigationIconContrast(menuIcon)).toBeGreaterThanOrEqual(3);
    const action = page.getByRole('button', { name: 'Open translation sample' });
    for (const state of ['normal', 'hover', 'focus'] as const) {
      if (state === 'hover') await action.hover();
      if (state === 'focus') { await page.keyboard.press('Tab'); await action.focus(); }
      const contrast = await textContrast(action);
      expect(contrast.unsupportedImages).toEqual([]);
      expect(contrast.ratio, `${theme} primary ${state}`).toBeGreaterThanOrEqual(4.5);
    }
    expect(await action.evaluate(element => getComputedStyle(element).outlineWidth)).toBe('3px');
    const normal = await new AxeBuilder({ page }).include('main').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(normal.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, failure: node.failureSummary })) }))).toEqual([]);
    await action.click();
    const dialog = page.getByRole('dialog', { name: 'Translation (French → English)' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Close', exact: true }).last().focus();
    await page.keyboard.press('Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Shift+Tab');
    await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
    for (const segment of await dialog.locator('[class^="translation-segment-color-"]').all()) {
      const contrast = await textContrast(segment);
      expect(contrast.unsupportedImages).toEqual([]);
      expect(contrast.ratio, `${theme} translation ${await segment.getAttribute('class')}`).toBeGreaterThanOrEqual(4.5);
    }
    const lookup = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
    expect(lookup.violations.map(({ id, nodes }) => ({ id, nodes: nodes.map(node => ({ target: node.target, failure: node.failureSummary })) }))).toEqual([]);
    if ([320, 1280].includes(page.viewportSize()!.width)) await page.screenshot({ path: info.outputPath(`${theme}-translation.png`), animations: 'disabled' });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(action).toBeFocused();
  });
}

test('markers are independent of theme and keep Known/Ignored plain', async ({ page, openLayout }, info) => {
  await openLayout('presentation');
  await expect(page.locator('figure [class*="word-status-"]')).toHaveCount(7);
  await page.evaluate(() => document.body.classList.add('reader-status-markers'));
  const styles = await page.locator('figure [class*="word-status-"]').evaluateAll(elements => elements.map(element => ({
    line: getComputedStyle(element).textDecorationLine, style: getComputedStyle(element).textDecorationStyle,
  })));
  expect(styles.slice(0, 5).map(style => style.style)).toEqual(['dotted', 'solid', 'dashed', 'double', 'wavy']);
  expect(styles.slice(5).map(style => style.line)).toEqual(['none', 'none']);
  await page.screenshot({ path: info.outputPath('experimental-markers.png'), animations: 'disabled' });
});

test('desktop reflow and text-spacing overrides retain native controls', async ({ page, openLayout }) => {
  await openLayout('presentation');
  await page.setViewportSize({ width: 320, height: 900 });
  await unmaskRootOverflow(page);
  await page.addStyleTag({ content: 'p, h1, h2, h3, label, button, summary, td, th { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }' });
  await expectPageFits(page);
  const inspector = page.getByLabel('Inspect daily reading activity');
  await inspector.fill('2026-11-12');
  await expect(page.getByRole('status')).toContainText('321 words');
  await page.getByText('View data table: Daily reading activity').click();
  await expect(page.getByRole('table', { name: 'Daily reading activity' })).toBeVisible();
});

test('forced colors and live reduced-motion changes preserve focus and selection cues', async ({ page, openLayout }) => {
  await openLayout('presentation');
  await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
  const action = page.getByRole('button', { name: 'Open translation sample' });
  await action.focus();
  await expect(action).toBeFocused();
  expect(await action.evaluate(element => getComputedStyle(element).outlineStyle)).toBe('solid');
  expect(await action.evaluate(element => getComputedStyle(element).transitionDuration)).toBe('1e-05s');
  await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
  expect(await action.evaluate(element => getComputedStyle(element).transitionDuration)).not.toBe('1e-05s');
});

test('contrast measurement retains translucent ancestor layers and group opacity', async ({ page, openLayout }) => {
  await openLayout('presentation');
  await page.locator('main').evaluate(element => {
    const sample = document.createElement('div');
    sample.style.cssText = 'background:rgb(0,0,0); opacity:.5';
    sample.innerHTML = '<span id="contrast-probe" style="color:rgba(255,255,255,.5);background:rgba(255,255,255,.5)">Synthetic contrast probe</span>';
    element.appendChild(sample);
  });
  const contrast = await textContrast(page.locator('#contrast-probe'));
  expect(contrast.foreground[0]).toBeCloseTo(223.5, 0);
  expect(contrast.background[0]).toBeCloseTo(191.5, 0);
  expect(contrast.ratio).toBeLessThan(2);
});

test('narrow word lookup contains focus, closes with Escape and returns to its exact clicked span', async ({ page, openLayout }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await openLayout('texts/801?mixed=1');
  const word = page.locator('.text-content .clickable-word').filter({ hasText: /^rivière$/ }).first();
  await word.click();
  const dialog = page.getByRole('dialog', { name: 'Word information' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(true);
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const buttons = dialog.getByRole('button');
  await buttons.last().focus();
  await page.keyboard.press('Tab');
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await buttons.first().focus();
  await page.keyboard.press('Shift+Tab');
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  const scan = await new AxeBuilder({ page }).include('[role="dialog"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
  expect(scan.violations.map(({ id, nodes }) => ({ id, targets: nodes.map(node => ({ target: node.target, failure: node.failureSummary })) }))).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(word).toBeFocused();
  expect(await page.locator('#root').evaluate(element => (element as HTMLElement).inert)).toBe(false);
});
