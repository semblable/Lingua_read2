import { test, expect } from './dashboard.fixture';
import { audioLesson, longTitle, readingLesson, sparseLesson } from './data';
import { activate, expectInside, expectPageFits, expectTextFits, horizontalOverflow, textOverflow, unmaskRootOverflow } from './bounds';

for (const [name, lesson] of [['audio', audioLesson], ['reading', readingLesson], ['missing metadata', sparseLesson]] as const) {
  test.describe(name, () => {
    test.use({ primaryLesson: lesson });

    test('content fits with normal and unmasked root overflow', async ({ page, openDashboard }) => {
      await openDashboard();
      const card = page.getByTestId('continue-card');
      const title = card.getByRole('heading', { level: 2 });
      await expect(title).toHaveText(lesson.title || 'Untitled');
      if (name === 'audio') {
        await expect(card.getByText('~12 min left', { exact: true })).toBeVisible();
        await expect(card.getByText('20%', { exact: true })).toBeVisible();
        await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '20');
      } else {
        await expect(card.getByText(name === 'reading' ? '320 words read' : 'Ready to read', { exact: true })).toBeVisible();
        await expect(card.getByRole('progressbar')).toHaveCount(0);
        await expect(card.locator('.home-resume-position')).not.toContainText('min left');
      }

      for (const unmasked of [false, true]) {
        if (unmasked) await unmaskRootOverflow(page);
        await test.step(unmasked ? 'root overflow visible' : 'production overflow rules', async () => {
          await expectPageFits(page);
          await expectInside(title, card.locator('.home-current-copy'));
          await expectTextFits(title, page.viewportSize()!.width <= 400);
          for (const locator of await card.locator('.home-resume-position > span, .home-reading-progress > div:first-child > span').all()) {
            await expectTextFits(locator);
            await expectInside(locator, card.locator('.home-current-copy'));
          }
          const estimate = page.getByTestId('resume-pick-704').getByText('~5 min read', { exact: true });
          await expectTextFits(estimate);
          const toggle = page.getByRole('button', { name: 'Toggle navigation' });
          if (page.viewportSize()!.width < 992) {
            await expectInside(toggle, page.locator('.navbar-content'));
          } else {
            await expect(toggle).toBeHidden();
          }
        });
      }
    });
  });
}

test('navigation and Add menus are reachable and follow real routes', async ({ page, openDashboard }) => {
  await openDashboard();
  await unmaskRootOverflow(page);
  const navigation = page.getByRole('navigation');
  const toggle = navigation.getByRole('button', { name: 'Toggle navigation' });
  const mobile = page.viewportSize()!.width < 992;
  if (mobile) {
    await expect(navigation.getByRole('link', { name: 'Library', exact: true })).toBeHidden();
    await navigation.getByRole('link', { name: 'LinguaRead', exact: true }).focus();
    await page.keyboard.press('Tab');
    await expect(toggle).toBeFocused();
    await toggle.press('Enter');
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(navigation.locator('.navbar-collapse')).toHaveClass(/\bshow\b/);
    await expectInside(toggle, page.locator('.navbar-content'));
  }
  await expect(navigation.getByRole('link', { name: 'Library', exact: true })).toBeVisible();
  const add = navigation.getByRole('button', { name: 'Add', exact: true });
  await add.focus();
  await add.press('Enter');
  await expect(add).toHaveAttribute('aria-expanded', 'true');
  const routes = [
    ['Add Book', '/books/create'], ['Add Text', '/texts/create'],
    ['Add Audio Lesson', '/texts/create-audio'], ['Batch Audio', '/texts/create-batch-audio'],
  ];
  for (const [label, path] of routes) {
    const item = navigation.getByRole('link', { name: label, exact: true });
    await expect(item).toHaveAttribute('href', path);
    await expectTextFits(item);
  }
  await expectPageFits(page);
  await activate(navigation.getByRole('link', { name: 'Add Text', exact: true }), page);
  await expect(page).toHaveURL(/\/texts\/create$/);
  await expect(page.getByTestId('route-destination')).toHaveText('/texts/create');
  if (mobile) await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  // Desktop has a second Add entry point; phones use the navigation menu.
  await navigation.getByRole('link', { name: 'LinguaRead', exact: true }).click();
  await expect(page.getByTestId('continue-card').getByRole('heading', { name: longTitle })).toBeVisible();
  const quickAdd = page.getByTestId('quick-add-card');
  if (mobile) {
    await expect(quickAdd).toBeHidden();
    await activate(toggle, page);
    await expect(navigation.locator('.navbar-collapse')).toHaveClass(/\bshow\b/);
    await activate(toggle, page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  } else {
    await activate(quickAdd.getByRole('button', { name: '+ Add content' }), page);
    await expectTextFits(quickAdd.getByRole('link', { name: 'Add audio', exact: true }));
    await expectPageFits(page);
    await activate(quickAdd.getByRole('link', { name: 'Add audio', exact: true }), page);
    await expect(page).toHaveURL(/\/texts\/create-audio$/);
  }
});

for (const count of [0, 1, 12, 12_345]) {
  test.describe(`${count} reviews due`, () => {
    test.use({ dueCount: count });

    test('keeps the due total and bounds the session and destination', async ({ page, openDashboard }) => {
      await openDashboard();
      await unmaskRootOverflow(page);
      const review = page.getByTestId('srs-due-widget');
      await expect(review.locator('details')).toHaveCount(0);
      await expect(review.getByRole('combobox')).toHaveCount(count === 0 ? 0 : 1);
      if (count === 0) {
        await expect(review.getByRole('heading', { name: 'No reviews due' })).toBeVisible();
        await expect(review.getByLabel('Session size')).toHaveCount(0);
        const action = review.getByRole('button', { name: 'Open SRS', exact: true });
        await expectTextFits(action);
        await expectPageFits(page);
        await activate(action, page);
        await expect(page).toHaveURL(/\/srs$/);
        await expect(page.getByTestId('route-destination')).toHaveText('/srs');
        return;
      }

      const dueTotal = review.getByText(`${count.toLocaleString('en-US')} due`, { exact: true });
      await expect(dueTotal).toBeVisible();
      const sessionSize = review.getByLabel('Session size');
      await expect(sessionSize).toHaveValue('50');
      for (const size of [50, 10, 200, 25, 100]) {
        if (size !== 50) await sessionSize.selectOption(String(size));
        const target = Math.min(count, size);
        const action = review.getByRole('button', { name: `Review ${target} ${target === 1 ? 'card' : 'cards'}`, exact: true });
        await expect(action).toBeVisible();
        await expectTextFits(action);
        await expectInside(action, review.locator('.card-body'));
        await expect(dueTotal).toBeVisible();
      }

      await expectPageFits(page);
      await sessionSize.selectOption('10');
      const target = Math.min(count, 10);
      await activate(review.getByRole('button', { name: `Review ${target} ${target === 1 ? 'card' : 'cards'}`, exact: true }), page);
      await expect(page).toHaveURL(new RegExp(`/srs\\?limit=${target}$`));
      await expect(page.getByTestId('route-destination')).toHaveText(`/srs?limit=${target}`);
    });
  });
}

test('inline goal action opens a usable dialog and restores focus', async ({ page, openDashboard }) => {
  await openDashboard();
  await unmaskRootOverflow(page);
  const action = page.getByRole('button', { name: '+ Set a goal' });
  await activate(action, page);
  const dialog = page.getByRole('dialog', { name: 'New goal' });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveClass(/\bfade\b/);
  await expect(dialog.getByRole('combobox', { name: 'Scope' })).toHaveValue('21');
  const target = dialog.getByRole('spinbutton', { name: 'Target (words)' });
  await expect(target).toHaveValue('1000');
  await target.fill('1500');
  const title = dialog.getByRole('textbox', { name: 'Title (optional)' });
  await title.fill('Une petite réussite à la fois');
  await expect(title).toBeFocused();
  await expectPageFits(page);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  await expectTextFits(cancel);
  await activate(cancel, page);
  await expect(dialog).toBeHidden();
  await expect(action).toBeFocused();
  // Motion preference changes remain live; normal animation is still enabled.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await action.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveClass(/\bfade\b/);
  await dialog.evaluate(element => Promise.all(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(action).toBeFocused();
  // Reduced motion must also support Escape immediately after reopening.
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await action.press('Enter');
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toHaveClass(/\bfade\b/);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(action).toBeFocused();
});

test('bounds checks detect masked element overflow and clipped text', async ({ page, openDashboard }) => {
  await openDashboard();
  // Negative controls prove that these assertions catch more than scrollWidth.
  await page.evaluate(() => {
    const probe = document.createElement('div');
    probe.id = 'overflow-probe';
    probe.style.cssText = 'position:fixed; left:100vw; top:0; width:80px; height:20px';
    document.querySelector('.home-dashboard')!.append(probe);
  });
  expect(await horizontalOverflow(page)).not.toEqual([]);
  await page.locator('#overflow-probe').evaluate(element => element.remove());
  await page.evaluate(() => {
    const title = document.querySelector<HTMLElement>('.home-current-copy h2')!;
    title.style.cssText = 'display:block; width:24px; white-space:nowrap; overflow:hidden';
  });
  expect(await textOverflow(page.locator('.home-current-copy h2'), false)).not.toEqual([]);
});
