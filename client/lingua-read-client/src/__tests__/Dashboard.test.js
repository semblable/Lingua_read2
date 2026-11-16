import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Dashboard from '../pages/Dashboard';
import { getDashboard, getTexts } from '../utils/api';

vi.mock('../utils/api', () => ({
  getDashboard: vi.fn(),
  // Dashboard renders <GoalsCard /> which loads goals on mount — silence the
  // stderr from that side-effect by mocking the API surface it uses.
  getGoals: vi.fn(() => Promise.resolve([])),
  // Dashboard renders <ResumeAtLevelSection /> which fetches texts on mount.
  getTexts: vi.fn(() => Promise.resolve([])),
}));

const renderDashboard = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Dashboard />
    </MemoryRouter>
  );

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders a spinner while loading', () => {
    getDashboard.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderDashboard();
    expect(container.querySelector('.spinner-border')).toBeInTheDocument();
  });

  test('renders the OnboardingHome takeover when no languages are returned', async () => {
    getDashboard.mockResolvedValue({ languages: [] });
    renderDashboard();
    // Dashboard now delegates the empty branch to <OnboardingHome />, which
    // shows the LinguaRead welcome and three primary CTAs.
    expect(await screen.findByTestId('onboarding-home')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Welcome to LinguaRead/i })
    ).toBeInTheDocument();
    // CTAs are LinkContainer+Button = <a role="button">
    expect(
      screen.getByRole('button', { name: /Add a text/i })
    ).toHaveAttribute('href', '/texts/create');
  });

  test('renders the dashboard with totals when data is present', async () => {
    getDashboard.mockResolvedValue({
      totalKnownWords: 1234,
      totalWordsReadWeek: 5678,
      totalListeningSecondsWeek: 7200,
      totalLanguages: 2,
      languages: [
        { languageId: 1, languageName: 'French', knownWords: 500, totalWords: 1000 },
        { languageId: 2, languageName: 'Spanish', knownWords: 734, totalWords: 1234 }
      ]
    });
    renderDashboard();

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument(); // totalKnownWords
    expect(screen.getByText('5,678')).toBeInTheDocument(); // totalWordsReadWeek
    expect(screen.getByText('2h')).toBeInTheDocument(); // 7200 sec = 120 min = 2h
  });

  test('renders an error alert when getDashboard rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDashboard.mockRejectedValue(new Error('network'));
    renderDashboard();
    expect(
      await screen.findByText(/Failed to load dashboard\. Please try again\./)
    ).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  test('passes the local timezone offset to getDashboard', async () => {
    getDashboard.mockResolvedValue({ languages: [] });
    renderDashboard();
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(1));
    const [tz] = getDashboard.mock.calls[0];
    expect(typeof tz).toBe('number');
    expect(tz).toBe(-new Date().getTimezoneOffset());
  });

  describe('What to read next', () => {
    const sampleLanguages = [
      { languageId: 1, languageName: 'French', knownWords: 500, totalWords: 1000 },
    ];

    test('renders nothing when there are no sweet-spot texts', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        // 50% — too-hard
        { textId: 1, title: 'Hard one', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 50, unknownWordPercentage: 50 },
        // 99% — too-easy
        { textId: 2, title: 'Easy one', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 99, unknownWordPercentage: 1 },
      ]);
      renderDashboard();
      await screen.findByText('Dashboard');
      await waitFor(() => expect(getTexts).toHaveBeenCalled());
      // Section card present (it's the loading or wrapper), but no language sub-block.
      expect(screen.queryByText(/What to read next/i)).not.toBeInTheDocument();
    });

    test('surfaces sweet-spot texts ordered by closeness to 94%', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        // 90% sweet-spot
        { textId: 10, title: 'Sweet 90', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 90, unknownWordPercentage: 10 },
        // 95% sweet-spot — closest to target 94
        { textId: 11, title: 'Sweet 95', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
        // 98% sweet-spot
        { textId: 12, title: 'Sweet 98', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 98, unknownWordPercentage: 2 },
        // 99% too-easy — should NOT appear
        { textId: 13, title: 'Easy 99', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 99, unknownWordPercentage: 1 },
        // Sweet-spot but already finished — should NOT appear
        { textId: 14, title: 'Done one', languageName: 'French', isFinished: true,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
      ]);
      renderDashboard();
      expect(await screen.findByText(/What to read next/i)).toBeInTheDocument();
      expect(screen.getByText('Sweet 90')).toBeInTheDocument();
      expect(screen.getByText('Sweet 95')).toBeInTheDocument();
      expect(screen.getByText('Sweet 98')).toBeInTheDocument();
      expect(screen.queryByText('Easy 99')).not.toBeInTheDocument();
      expect(screen.queryByText('Done one')).not.toBeInTheDocument();
    });

    test('distinguishes equally covered recommendations by type, length, and unfamiliar words', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        { textId: 51, title: 'Short text', languageName: 'French', totalWords: 1000, knownWords: 940, isAudioLesson: false },
        { textId: 52, title: 'Long audio', languageName: 'French', totalWords: 3000, knownWords: 2820, isAudioLesson: true },
      ]);
      renderDashboard();
      const short = await screen.findByTestId('resume-pick-51');
      const audio = screen.getByTestId('resume-pick-52');
      expect(within(short).getByText('60 unfamiliar words')).toBeInTheDocument();
      expect(within(short).getByText('~5 min read')).toBeInTheDocument();
      expect(within(short).getByText('Text')).toBeInTheDocument();
      expect(within(audio).getByText('180 unfamiliar words')).toBeInTheDocument();
      expect(within(audio).getByText('3,000 transcript words')).toBeInTheDocument();
      expect(within(audio).getByText('Audio')).toBeInTheDocument();
      expect(within(audio).getByText('94% vocabulary coverage')).toBeInTheDocument();
      expect(within(audio).queryByText(/min read/)).not.toBeInTheDocument();
    });

    test('caps each language at 3 picks', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        { textId: 20, title: 'A', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 90, unknownWordPercentage: 10 },
        { textId: 21, title: 'B', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 91, unknownWordPercentage: 9 },
        { textId: 22, title: 'C', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 94, unknownWordPercentage: 6 },
        { textId: 23, title: 'D', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
        { textId: 24, title: 'E', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 96, unknownWordPercentage: 4 },
      ]);
      renderDashboard();
      await screen.findByText(/What to read next/i);
      // C/D/E are closest to 94 — A and B drop off.
      expect(screen.getByText('C')).toBeInTheDocument();
      expect(screen.getByText('D')).toBeInTheDocument();
      expect(screen.getByText('E')).toBeInTheDocument();
      expect(screen.queryByText('A')).not.toBeInTheDocument();
      expect(screen.queryByText('B')).not.toBeInTheDocument();
    });

    test('groups picks by language with a label per language', async () => {
      getDashboard.mockResolvedValue({
        languages: [
          { languageId: 1, languageName: 'French' },
          { languageId: 2, languageName: 'Spanish' },
        ],
      });
      getTexts.mockResolvedValue([
        { textId: 30, title: 'French Sweet', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
        { textId: 31, title: 'Spanish Sweet', languageName: 'Spanish', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
      ]);
      renderDashboard();
      await screen.findByText('French Sweet');
      expect(screen.getByTestId('resume-language-French')).toBeInTheDocument();
      expect(screen.getByTestId('resume-language-Spanish')).toBeInTheDocument();
    });

    const bookPart = (textId, partNumber, overrides = {}) => ({
      textId, partNumber, title: `Chapter ${partNumber}`, bookId: 100,
      bookTitle: 'A journey along the river', bookIsFinished: false,
      languageName: 'French', isFinished: false, totalWords: 100, knownWords: 94,
      ...overrides,
    });

    test('recommends a whole book by word-weighted coverage, even when its first part is difficult', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        bookPart(2, 2, { totalWords: 900, knownWords: 882 }),
        bookPart(1, 1, { totalWords: 100, knownWords: 60 }),
      ]);
      renderDashboard();
      const pick = await screen.findByTestId('resume-pick-book-100');
      expect(pick).toHaveAttribute('href', '/texts/1');
      expect(within(pick).getByRole('heading', { name: 'A journey along the river' })).toBeInTheDocument();
      expect(within(pick).getByText('Book')).toBeInTheDocument();
      expect(within(pick).queryByText('Chapter 1')).not.toBeInTheDocument();
      expect(within(pick).getByText('Start book · Part 1')).toBeInTheDocument();
      expect(within(pick).getByText('94% vocabulary coverage')).toBeInTheDocument();
      expect(within(pick).getByText('Across the whole book')).toBeInTheDocument();
      expect(within(pick).getByText('1,000 words')).toBeInTheDocument();
      expect(within(pick).getByText('58 unfamiliar words')).toBeInTheDocument();
      expect(within(pick).queryByText(/min read/)).not.toBeInTheDocument();
      expect(screen.getAllByTestId(/^resume-pick-/)).toHaveLength(1);
    });

    test('assesses all unread parts together and opens the earliest one in numeric reading order', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        bookPart(110, 10, { totalWords: 900, knownWords: 882 }),
        bookPart(102, 2, { totalWords: 100, knownWords: 60 }),
        bookPart(103, 3, { isFinished: true }),
        bookPart(101, 1, { isFinished: true, totalWords: 10000, knownWords: 10000 }),
      ]);
      renderDashboard();
      const pick = await screen.findByTestId('resume-pick-book-100');
      expect(pick).toHaveAttribute('href', '/texts/102');
      expect(within(pick).getByText('Continue book · Part 2')).toBeInTheDocument();
      expect(within(pick).getByText('94% vocabulary coverage')).toBeInTheDocument();
      expect(within(pick).getByText('1,000 words in unread parts')).toBeInTheDocument();
      expect(within(pick).getByText('Across 2 of 4 parts still unread')).toBeInTheDocument();
      expect(within(pick).getByText('58 unfamiliar words')).toBeInTheDocument();
      expect(screen.getAllByTestId(/^resume-pick-/)).toHaveLength(1);
    });

    test.each([
      ['too difficult', { totalWords: 1000, knownWords: 880 }],
      ['above the coverage band', { totalWords: 1000, knownWords: 990 }],
      ['missing vocabulary stats', { totalWords: 0, knownWords: 0 }],
    ])('does not let completed chapters mask a remainder that is %s', async (_reason, stats) => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        // In the difficult case, the whole book is 94% covered, but the unread
        // half is only 88%. It must not be recommended as a suitable match.
        bookPart(1, 1, { isFinished: true, totalWords: 1000, knownWords: 1000 }),
        bookPart(2, 2, stats),
        { textId: 200, title: 'Standalone match', languageName: 'French', totalWords: 100, knownWords: 94 },
      ]);
      renderDashboard();
      await screen.findByTestId('resume-pick-200');
      expect(screen.getAllByTestId(/^resume-pick-/)).toHaveLength(1);
      expect(screen.queryByRole('heading', { name: 'A journey along the river' })).not.toBeInTheDocument();
    });

    test('excludes completed books and links to the book overview when part order is unavailable', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        bookPart(1, 1, { bookIsFinished: true }),
        bookPart(2, 1, { bookId: 101, isFinished: true }),
        bookPart(3, null, { bookId: 102 }),
        bookPart(4, 2, { bookId: 102 }),
      ]);
      renderDashboard();
      const pick = await screen.findByTestId('resume-pick-book-102');
      expect(screen.getAllByTestId(/^resume-pick-/)).toHaveLength(1);
      expect(pick).toHaveAttribute('href', '/books/102');
      expect(within(pick).getByText('View book')).toBeInTheDocument();
    });

    test('ranks books, texts and audio together without reserving slots for each format', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        bookPart(1, 1, { knownWords: 93 }),
        bookPart(2, 1, { bookId: 101 }),
        bookPart(3, 1, { bookId: 102, knownWords: 96 }),
        { textId: 200, title: 'An article', languageName: 'French', totalWords: 100, knownWords: 90 },
        { textId: 201, title: 'An interview', languageName: 'French', totalWords: 100, knownWords: 98, isAudioLesson: true },
      ]);
      renderDashboard();
      await screen.findByTestId('resume-pick-book-100');
      expect(screen.getAllByTestId(/^resume-pick-/).map(pick => pick.dataset.testid)).toEqual([
        'resume-pick-book-101', 'resume-pick-book-100', 'resume-pick-book-102',
      ]);
      expect(screen.queryByTestId('resume-pick-200')).not.toBeInTheDocument();
      expect(screen.queryByTestId('resume-pick-201')).not.toBeInTheDocument();
    });

    test('does not quietly omit an unread chapter whose vocabulary has not been calculated', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        bookPart(1, 1), bookPart(2, 2, { totalWords: 0, knownWords: 0 }),
        // A confirmed empty part is safe to include without changing coverage.
        bookPart(3, 1, { bookId: 101, totalWords: 0, knownWords: 0, wordLinkingStatus: 'completed', hasNoCountableWords: true }),
        bookPart(4, 2, { bookId: 101 }),
      ]);
      renderDashboard();
      await screen.findByTestId('resume-pick-book-101');
      expect(screen.queryByTestId('resume-pick-book-100')).not.toBeInTheDocument();
    });

    test.each([
      ['processing', 0, 0],
      ['failed', 0, 0],
      ['processing', 100, 94],
      ['failed', 100, 94],
      ['completed', 0, 0],
      [undefined, 0, 0],
    ])('excludes unfinished vocabulary analysis despite timestamped stats (%s, %i words)', async (wordLinkingStatus, totalWords, knownWords) => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        bookPart(1, 1),
        bookPart(2, 2, { totalWords, knownWords, wordLinkingStatus, hasNoCountableWords: false, statsUpdatedAt: '2026-11-16T10:00:00Z' }),
        { textId: 200, title: 'Ready to read', languageName: 'French', totalWords: 100, knownWords: 94 },
      ]);
      renderDashboard();
      await screen.findByTestId('resume-pick-200');
      expect(screen.queryByTestId('resume-pick-book-100')).not.toBeInTheDocument();
    });
  });
});
