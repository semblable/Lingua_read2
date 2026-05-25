import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// Mock the whole api surface so Home + its children don't hit real endpoints.
vi.mock('../utils/api', () => ({
  getDashboard: vi.fn(),
  getRecentTexts: vi.fn(),
  getSrsStats: vi.fn(),
  getGoals: vi.fn(),
  getText: vi.fn(),
  getTexts: vi.fn(),
}));

// Recharts inside LanguageDashboardCard needs ResizeObserver — stub it out
// so the dashboard-card render path doesn't crash in happy-dom.
vi.mock('../components/dashboard/LanguageDashboardCard', () => ({
  default: ({ lang }: { lang: { languageId: number; languageName: string } }) => (
    <div data-testid={`lang-card-${lang.languageId}`}>{lang.languageName}</div>
  ),
}));

import {
  getDashboard,
  getGoals,
  getRecentTexts,
  getSrsStats,
  getText,
  getTexts,
} from '../utils/api';
import Home from '../pages/Home';

const mockedGetDashboard = vi.mocked(getDashboard);
const mockedGetRecentTexts = vi.mocked(getRecentTexts);
const mockedGetSrsStats = vi.mocked(getSrsStats);
const mockedGetGoals = vi.mocked(getGoals);
const mockedGetText = vi.mocked(getText);
const mockedGetTexts = vi.mocked(getTexts);

const renderHome = () =>
  render(
    <MemoryRouter>
      <Home />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  // Default: empty everything — Home should fall into the onboarding path.
  mockedGetDashboard.mockResolvedValue({
    totalKnownWords: 0,
    totalWordsReadWeek: 0,
    totalListeningSecondsWeek: 0,
    totalLanguages: 0,
    languages: [],
  } as unknown as Awaited<ReturnType<typeof getDashboard>>);
  mockedGetRecentTexts.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getRecentTexts>>);
  mockedGetSrsStats.mockResolvedValue({ dueCount: 0 } as unknown as Awaited<ReturnType<typeof getSrsStats>>);
  mockedGetGoals.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getGoals>>);
  mockedGetTexts.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof getTexts>>);
  mockedGetText.mockResolvedValue({
    textId: 99,
    title: 'Recent',
    totalWords: 100,
    knownWords: 80,
  } as unknown as Awaited<ReturnType<typeof getText>>);
});

afterEach(() => cleanup());

describe('Home (integration)', () => {
  test('shows the onboarding takeover when the user has no languages and no recent texts', async () => {
    renderHome();
    await waitFor(() => expect(screen.getByTestId('onboarding-home')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Add a book/i })).toHaveAttribute(
      'href',
      '/books/create'
    );
  });

  test('fires all four dashboard fetches in parallel on mount', async () => {
    renderHome();
    // React's dev double-invoke (when enabled by the test env) can fire the
    // effect twice — we only care that each endpoint was contacted at least once.
    await waitFor(() => expect(mockedGetDashboard).toHaveBeenCalled());
    expect(mockedGetRecentTexts).toHaveBeenCalled();
    expect(mockedGetSrsStats).toHaveBeenCalled();
    expect(mockedGetGoals).toHaveBeenCalled();
  });

  test('renders the command-center sections when the user has languages', async () => {
    mockedGetDashboard.mockResolvedValue({
      totalKnownWords: 5432,
      totalWordsReadWeek: 1234,
      totalListeningSecondsWeek: 600,
      totalLanguages: 1,
      languages: [
        {
          languageId: 1,
          languageName: 'Spanish',
          knownWords: 5432,
          totalWords: 9000,
          cefrLevel: 'B1',
          nextCefrLevel: 'B2',
          knownWordsToNextLevel: 1000,
          bandProgressPercent: 50,
          isCefrApproximate: false,
          todayWordsRead: 120,
          todayListeningSeconds: 0,
          currentReadingStreakDays: 4,
          last14DaysWords: [],
          continueReadingTextId: 7,
          lastActivityAt: '2026-05-25',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getDashboard>>);
    mockedGetRecentTexts.mockResolvedValue([
      {
        textId: 7,
        title: 'Una historia',
        languageName: 'Spanish',
        isAudioLesson: false,
      },
    ] as unknown as Awaited<ReturnType<typeof getRecentTexts>>);
    mockedGetSrsStats.mockResolvedValue({ dueCount: 12 } as unknown as Awaited<ReturnType<typeof getSrsStats>>);

    renderHome();

    // Hero greeting (any time-of-day) eventually appears once dashboard data lands.
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument()
    );

    // Quick stats row hydrates with formatted values.
    await waitFor(() => expect(screen.getByText('5,432')).toBeInTheDocument());
    expect(screen.getByText('1,234')).toBeInTheDocument();

    // SRS widget surfaces the due count and the warning/danger CTA.
    expect(await screen.findByText(/Review 12 cards now/)).toBeInTheDocument();

    // Continue learning card renders with the most-recent text title.
    expect(await screen.findByText('Una historia')).toBeInTheDocument();

    // Languages strip mirrors the one language back.
    expect(screen.getByTestId('lang-card-1')).toHaveTextContent('Spanish');

    // Quick-add footer is present (Bootstrap Button via LinkContainer = role="button").
    expect(screen.getByRole('button', { name: /Add book/i })).toHaveAttribute(
      'href',
      '/books/create'
    );
  });

  test('falls back gracefully when individual fetches reject', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetDashboard.mockResolvedValue({
      totalKnownWords: 100,
      totalWordsReadWeek: 0,
      totalListeningSecondsWeek: 0,
      totalLanguages: 1,
      languages: [
        {
          languageId: 1,
          languageName: 'Spanish',
          knownWords: 100,
          totalWords: 500,
          cefrLevel: 'A2',
          nextCefrLevel: 'B1',
          knownWordsToNextLevel: 200,
          bandProgressPercent: 30,
          isCefrApproximate: false,
          todayWordsRead: 0,
          todayListeningSeconds: 0,
          currentReadingStreakDays: 0,
          last14DaysWords: [],
          continueReadingTextId: null,
          lastActivityAt: '2026-05-25',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getDashboard>>);
    mockedGetSrsStats.mockRejectedValue(new Error('srs offline'));
    mockedGetGoals.mockRejectedValue(new Error('goals offline'));

    renderHome();

    // Page still renders the languages strip even though two fetches failed.
    await waitFor(() => expect(screen.getByTestId('lang-card-1')).toBeInTheDocument());
    // SRS widget falls back to the zero / all-caught-up state when stats fail.
    expect(screen.getByText('All caught up')).toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });

  test('builds the goal-summary fallback without a leading space when title and language are missing', async () => {
    mockedGetDashboard.mockResolvedValue({
      totalKnownWords: 1,
      totalWordsReadWeek: 0,
      totalListeningSecondsWeek: 0,
      totalLanguages: 1,
      languages: [
        {
          languageId: 1,
          languageName: 'Spanish',
          knownWords: 1,
          totalWords: 10,
          cefrLevel: 'A1',
          nextCefrLevel: 'A2',
          knownWordsToNextLevel: 9,
          bandProgressPercent: 10,
          isCefrApproximate: false,
          todayWordsRead: 0,
          todayListeningSeconds: 0,
          currentReadingStreakDays: 0,
          last14DaysWords: [],
          continueReadingTextId: null,
          lastActivityAt: '2026-05-25',
        },
      ],
    } as unknown as Awaited<ReturnType<typeof getDashboard>>);
    // Overdue goal with no title and no language to drive the bare-fallback path.
    mockedGetGoals.mockResolvedValue([
      {
        goalId: 1,
        title: null,
        languageName: null,
        state: 'overdue',
        remainingToTarget: 0,
      },
    ] as unknown as Awaited<ReturnType<typeof getGoals>>);

    renderHome();

    // Subtitle is built from SRS · goal · streak; the goal slice must not
    // contain `" goal"` with a leading space inside the quotes.
    await waitFor(() =>
      expect(screen.getByText(/Goal "goal" is overdue/)).toBeInTheDocument()
    );
    expect(screen.queryByText(/Goal " goal" is overdue/)).not.toBeInTheDocument();
  });

  test('shows the fatal-error alert (not onboarding) when every fetch rejects', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetDashboard.mockRejectedValue(new Error('dashboard offline'));
    mockedGetRecentTexts.mockRejectedValue(new Error('recent offline'));
    mockedGetSrsStats.mockRejectedValue(new Error('srs offline'));
    mockedGetGoals.mockRejectedValue(new Error('goals offline'));

    renderHome();

    // With no data at all the page would otherwise fall through to onboarding,
    // which is misleading. The user should see the actual failure.
    await waitFor(() =>
      expect(screen.getByText(/couldn't load your home page/i)).toBeInTheDocument()
    );
    expect(screen.queryByTestId('onboarding-home')).not.toBeInTheDocument();
    consoleErrorSpy.mockRestore();
  });
});
