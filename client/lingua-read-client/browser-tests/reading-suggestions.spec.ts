import { test, expect } from './dashboard.fixture';
import { longTitle, recommendations } from './data';
import { activate, expectPageFits, expectTextFits, unmaskRootOverflow } from './bounds';

for (const inProgress of [false, true]) {
  test.describe(inProgress ? 'a book in progress' : 'a new book', () => {
    test.use({ recommendationData: { texts: [
      ...recommendations,
      { textId: 710, title: 'Une conversation au jardin', languageName: 'Français', isAudioLesson: true, totalWords: 6000, knownWords: 5880 },
      { textId: 713, bookId: 201, bookTitle: longTitle, partNumber: 3, title: 'A later chapter', languageName: 'Français', totalWords: 900, knownWords: 882 },
      { textId: 712, bookId: 201, bookTitle: longTitle, partNumber: 2, title: 'A difficult short chapter', languageName: 'Français', totalWords: 100, knownWords: 60 },
      { textId: 711, bookId: 201, bookTitle: longTitle, partNumber: 1, title: 'The beginning', languageName: 'Français', totalWords: 1000, knownWords: 940, isFinished: inProgress },
    ] } });

    test('shows a whole book alongside text and audio, with honest coverage and a sequential destination', async ({ page, openDashboard }, testInfo) => {
      await openDashboard();
      await unmaskRootOverflow(page);
      const section = page.getByTestId('resume-at-level-section');
      const book = section.getByTestId('resume-pick-book-201');
      await expect(section.getByRole('heading', { name: 'What to read next' })).toBeVisible();
      await expect(section.locator('.resume-pick-card')).toHaveCount(3);
      await expect(section.getByTestId('resume-pick-704').getByText('Text', { exact: true })).toBeVisible();
      await expect(section.getByTestId('resume-pick-710').getByText('Audio', { exact: true })).toBeVisible();
      await expect(book.getByRole('heading', { name: longTitle })).toBeVisible();
      await expect(book.getByText('Book', { exact: true })).toBeVisible();
      await expect(book.getByText('94% vocabulary coverage')).toBeVisible();
      await expect(book.getByText(inProgress ? 'Across 2 of 3 parts still unread' : 'Across the whole book')).toBeVisible();
      await expect(book.getByText(inProgress ? '1,000 words in unread parts' : '2,000 words', { exact: true })).toBeVisible();
      await expect(book.getByText(inProgress ? 'Continue book · Part 2' : 'Start book · Part 1')).toBeVisible();
      await expect(book).toHaveAttribute('href', inProgress ? '/texts/712' : '/texts/711');
      await expectTextFits(book.getByRole('heading'));
      for (const text of await section.locator('.home-pick-meta > span, .home-pick-details > span, .home-pick-action').all()) {
        await expectTextFits(text);
      }
      await expectPageFits(page);
      await section.screenshot({ path: testInfo.outputPath('reading-suggestions.png') });
      await activate(book, page);
      await expect(page.getByTestId('route-destination')).toHaveText(inProgress ? '/texts/712' : '/texts/711');
    });
  });
}
