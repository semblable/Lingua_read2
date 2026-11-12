import type { Locator, Page, TestInfo } from '@playwright/test';
import { test, expect } from './layout.fixture';
import { test as dashboardTest } from './dashboard.fixture';
import { activate, expectInside, expectPageFits, expectTextFits, horizontalOverflow, unmaskRootOverflow } from './bounds';

const themes = ['light', 'dark', 'classic-dark'] as const;

async function expectReadableText(element: Locator) {
  await expect(element).toBeVisible();
  await expect.poll(() => element.evaluate(node => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    let parent: Element | null = node;
    let background = [255, 255, 255, 255];
    let opacity = 1;
    while (parent) {
      const style = getComputedStyle(parent);
      opacity *= parseFloat(style.opacity);
      const color = rgba(style.backgroundColor);
      if (color[3] === 255) { background = color; break; }
      parent = parent.parentElement;
    }
    const foreground = rgba(getComputedStyle(node).color);
    const alpha = foreground[3] / 255 * opacity;
    const composite = foreground.slice(0, 3).map((value, i) => alpha * value + (1 - alpha) * background[i]);
    const luminance = (color: number[]) => color.slice(0, 3).reduce((sum, value, i) => {
      const channel = value / 255;
      return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][i];
    }, 0);
    const values = [luminance(background), luminance(composite)].sort((a, b) => a - b);
    return (values[1] + 0.05) / (values[0] + 0.05);
  }), { message: 'Secondary text must have at least 4.5:1 contrast' }).toBeGreaterThanOrEqual(4.5);
}

async function checkThemes(page: Page, selector: string, focus: Locator, info: TestInfo, secondarySelector?: string) {
  await unmaskRootOverflow(page);
  for (const theme of themes) {
    await test.step(`${theme}: bounds and keyboard focus`, async () => {
      await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
      await expectPageFits(page);
      expect(await horizontalOverflow(page, `.app-navigation, ${selector}`)).toEqual([]);
      await page.keyboard.press('Tab');
      await focus.focus();
      await expect(focus).toBeFocused();
      await expectTextFits(focus);
      expect(await focus.evaluate(element => {
        const style = getComputedStyle(element);
        return element.matches(':focus-visible') && (
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) || style.boxShadow !== 'none'
        );
      }), 'Keyboard focus must have a visible indicator').toBe(true);
      const secondary = page.locator(secondarySelector || `:is(${selector}) .text-muted, :is(${selector}) .form-text`).filter({ visible: true }).first();
      if (await secondary.count()) await expectReadableText(secondary);
      if ([320, 1280].includes(page.viewportSize()!.width)) {
        await page.screenshot({ path: info.outputPath(`${theme}.png`), fullPage: true, animations: 'disabled' });
      }
    });
  }
}

dashboardTest('navbar and dashboard share gutters across themes and breakpoints', async ({ page, openDashboard }) => {
  await openDashboard();
  await unmaskRootOverflow(page);
  for (const width of [page.viewportSize()!.width, 800, 1024, 1600]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of themes) {
      await page.evaluate(value => { document.body.className = `${value}-theme`; }, theme);
      const edges = await page.locator('.navbar-content, .home-dashboard').evaluateAll(elements => elements.map(element => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return [rect.left + parseFloat(style.paddingLeft), rect.right - parseFloat(style.paddingRight)];
      }));
      expect(edges).toHaveLength(2);
      expect(edges[0][0]).toBeCloseTo(edges[1][0], 0);
      expect(edges[0][1]).toBeCloseTo(edges[1][1], 0);
      await expectPageFits(page);
      await expectTextFits(page.locator('.home-today').first());
      const brand = page.getByRole('link', { name: 'LinguaRead', exact: true });
      await brand.focus();
      await expect(brand).toBeFocused();
    }
  }
});

test('Library cards keep Bootstrap gutters', async ({ page, openLayout }, info) => {
  await openLayout('library');
  const cards = page.locator('[data-selectable-type="text"] .card');
  await expect(cards).toHaveCount(2);
  await checkThemes(page, '.app-route-content', page.getByRole('searchbox', { name: 'Search library' }), info,
    '[data-selectable-type="text"] .text-muted');
  const [first, second] = await Promise.all([cards.nth(0).boundingBox(), cards.nth(1).boundingBox()]);
  const gap = page.viewportSize()!.width >= 576
    ? second!.x - first!.x - first!.width
    : second!.y - first!.y - first!.height;
  expect(gap, 'Library cards must have space between them').toBeGreaterThanOrEqual(8);
});

test('book form keeps split fields separated and usable', async ({ page, openLayout }, info) => {
  await openLayout('books/create');
  await expect(page.getByRole('heading', { name: 'Create New Book' })).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Book Title' });
  await title.fill('Le carnet des petites découvertes');
  await checkThemes(page, '.app-route-content', title, info);
  if (page.viewportSize()!.width >= 768) {
    const titleBox = (await title.boundingBox())!;
    const languageBox = (await page.getByRole('combobox', { name: 'Language', exact: true }).boundingBox())!;
    expect(languageBox.x - titleBox.x - titleBox.width).toBeGreaterThanOrEqual(16);
  }
});

test('audio import form stays inside its centered container', async ({ page, openLayout }, info) => {
  await openLayout('audio/create');
  await expect(page.getByRole('heading', { name: 'Create New Audio Lesson' })).toBeVisible();
  const title = page.getByRole('textbox', { name: 'Lesson Title' });
  await title.fill('Les sons du matin');
  await checkThemes(page, '.app-route-content', title, info);
  await expectInside(title, page.locator('.app-route-content > .container'));
});

test('Terms keeps full width with a locally scrolling table', async ({ page, openLayout }, info) => {
  await openLayout('terms');
  const language = page.getByRole('combobox', { name: 'Language', exact: true });
  await language.selectOption('21');
  await expect(page.getByRole('textbox', { name: 'Search', exact: true })).toBeEnabled();
  // The table is deliberately wider than phones; only its wrapper may scroll.
  await checkThemes(page, '.terms-page > .row, .terms-page > h2', language, info);
  const wrapper = page.locator('.terms-table-wrap > .table-responsive');
  await expectInside(wrapper, page.locator('.terms-page'));
  const viewport = page.viewportSize()!.width;
  expect((await page.locator('.terms-page').boundingBox())!.width).toBe(viewport);
  if (viewport < 768) {
    expect(await wrapper.evaluate(element => element.scrollWidth)).toBeGreaterThan((await wrapper.boundingBox())!.width);
    await wrapper.evaluate(element => { element.scrollLeft = 100; });
    expect(await wrapper.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
});

for (const mode of ['classic', 'modern']) {
  for (const [name, textId] of [['reader', 801], ['audio', 802]] as const) {
    test(`${mode} ${name} keeps its flush panels and controls`, async ({ page, openLayout }, info) => {
      await openLayout(`texts/${textId}?mode=${mode}`);
      const reader = page.locator('.text-display-wrapper');
      await expect(reader).toBeVisible();
      await expect(page.locator('.clickable-word').first()).toBeVisible();
      const mobile = page.viewportSize()!.width <= 768;
      const control = mobile
        ? page.getByRole('button', { name: 'Open lesson controls', exact: true })
        : page.getByRole('button', { name: 'Hide lesson controls panel', exact: true });
      await checkThemes(page, '.text-display-wrapper', control, info);
      const box = (await reader.boundingBox())!;
      expect(box.x).toBe(0);
      expect(box.width).toBe(page.viewportSize()!.width);
      if (mobile) {
        await activate(control, page);
        await expect(page.getByRole('button', { name: 'Menu', exact: true })).toBeVisible();
        await expectPageFits(page);
      }
      if (name === 'audio') {
        const player = page.locator('.audiobook-player');
        await expect(player).toBeVisible();
        await expectInside(player, reader);
        await expect(page.locator('audio')).toHaveJSProperty('readyState', 4);
        // Leaving an untouched lesson must not write a zero playback position.
        // Keep the fixture's mutation denylist active during real page teardown.
        await page.goto('/layout/library');
        await expect(page.getByRole('searchbox', { name: 'Search library' })).toBeVisible();
      }
    });
  }
}
