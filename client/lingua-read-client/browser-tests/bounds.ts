import { expect, type Locator, type Page } from '@playwright/test';

// Check element rectangles even when html/body hide overflow. Ignore only
// intentionally screen-reader-only content and elements without rendered boxes.
export async function horizontalOverflow(page: Page, selector = '.app-navigation, .home-dashboard, [role="dialog"]') {
  return page.locator(selector).evaluateAll(roots => {
    const viewport = document.documentElement.clientWidth;
    const elements = [...new Set(roots.flatMap(root => [root, ...root.querySelectorAll('*')]))];
    return elements.flatMap(element => {
      if (element.closest('.visually-hidden')) return [];
      if (getComputedStyle(element).visibility === 'hidden') return [];
      const rect = element.getBoundingClientRect();
      if (!element.getClientRects().length || !rect.width || !rect.height) return [];
      return rect.left < -1 || rect.right > viewport + 1
        ? [`${element.tagName.toLowerCase()}.${element.className}: ${rect.left.toFixed(1)}..${rect.right.toFixed(1)} (viewport ${viewport})`]
        : [];
    });
  });
}

export async function expectPageFits(page: Page) {
  expect(await horizontalOverflow(page), 'Visible component bounds must fit the viewport').toEqual([]);
  const documentBounds = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    width: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
  }));
  expect(documentBounds.width, 'The document must have no horizontal overflow').toBeLessThanOrEqual(documentBounds.viewport + 1);
}

// Ranges expose text extending outside a shrinkable element's own rectangle.
// Primary titles have a deliberate line clamp above 400px, so their horizontal
// bounds are checked at every width and full vertical bounds below that cutoff.
export async function textOverflow(locator: Locator, checkVertical = true) {
  return locator.evaluateAll((elements, vertical) => elements.flatMap(element => {
    const box = element.getBoundingClientRect();
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const failures: string[] = [];
    let node: Node | null;
    while ((node = walker.nextNode())) {
      if (!node.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects()) {
        if (rect.left < box.left - 1 || rect.right > box.right + 1 ||
          (vertical && (rect.top < box.top - 1 || rect.bottom > box.bottom + 1))) {
          failures.push(`${element.tagName.toLowerCase()}: ${node.textContent?.trim()} exceeds its text container`);
        }
      }
    }
    return failures;
  }), checkVertical);
}

export async function expectTextFits(locator: Locator, checkVertical = true) {
  await expect(locator).toBeVisible();
  expect(await textOverflow(locator, checkVertical), 'Text must fit its element bounds').toEqual([]);
}

export async function expectInside(element: Locator, container: Locator) {
  const child = await element.boundingBox();
  const parent = await container.boundingBox();
  expect(child, 'The control must have a rendered box').not.toBeNull();
  expect(parent, 'The container must have a rendered box').not.toBeNull();
  expect(child!.x).toBeGreaterThanOrEqual(parent!.x - 1);
  expect(child!.x + child!.width).toBeLessThanOrEqual(parent!.x + parent!.width + 1);
  expect(child!.y).toBeGreaterThanOrEqual(parent!.y - 1);
  expect(child!.y + child!.height).toBeLessThanOrEqual(parent!.y + parent!.height + 1);
}

export async function activate(control: Locator, page: Page) {
  if (await page.evaluate(() => navigator.maxTouchPoints > 0)) await control.tap();
  else await control.click();
}

export async function unmaskRootOverflow(page: Page) {
  await page.addStyleTag({ content: 'html, body { overflow-x: visible !important; }' });
}
