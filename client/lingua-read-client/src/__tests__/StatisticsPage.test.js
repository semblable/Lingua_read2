import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';

const baseHookValue = {
  stats: {
    totalWords: 100,
    knownWords: 30,
    learningWords: 70,
    totalBooks: 1,
    finishedBooks: 0,
    lastActivity: null,
    totalLanguages: 1,
    languageStatistics: [
      {
        languageId: 1,
        languageName: 'French',
        languageCode: 'fr',
        wordCount: 100,
        knownWords: 30,
        learningWords: 70,
        totalWordsRead: 200,
        totalSecondsListened: 120,
        totalTextsCompleted: 0,
        bookCount: 1,
        finishedBookCount: 0,
        cefrLevel: 'A1',
        nextCefrLevel: 'A2',
        knownWordsToNextLevel: 600,
        bandProgressPercent: 30,
        isCefrApproximate: false
      }
    ]
  },
  readingActivity: {
    totalWordsRead: 200,
    activityByDate: [],
    activityByLanguage: [{ languageId: 1, languageName: 'French', totalWords: 200 }]
  },
  listeningActivity: {
    totalListeningSeconds: 120,
    listeningByDate: [],
    listeningByLanguage: [{ languageId: 1, languageName: 'French', totalSeconds: 120 }]
  },
  knownWordsActivity: {
    totalKnownWords: 30,
    knownWordsByDate: [],
    knownWordsByLanguage: []
  },
  previousReadingActivity: { totalWordsRead: 0, activityByDate: [], activityByLanguage: [] },
  previousListeningActivity: {
    totalListeningSeconds: 0,
    listeningByDate: [],
    listeningByLanguage: []
  },
  previousKnownWordsActivity: {
    totalKnownWords: 0,
    knownWordsByDate: [],
    knownWordsByLanguage: []
  },
  loading: false,
  loadingActivity: false,
  error: '',
  networkStatus: 'connected',
  refetchAll: vi.fn(),
  refetchActivity: vi.fn()
};

const mockHookFn = vi.fn(() => baseHookValue);

vi.mock('../hooks/useStatisticsData', () => ({
  default: (...args) => mockHookFn(...args),
  useStatisticsData: (...args) => mockHookFn(...args)
}));

vi.mock('../utils/api', () => ({
  API_URL: 'http://localhost/api'
}));

import Statistics from '../pages/Statistics';

const renderStatistics = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Statistics />
    </MemoryRouter>
  );

describe('Statistics page', () => {
  beforeEach(() => {
    mockHookFn.mockReset();
    mockHookFn.mockReturnValue(baseHookValue);
    baseHookValue.refetchAll.mockClear();
    baseHookValue.refetchActivity.mockClear();
  });

  test('renders the loading screen while the hook reports loading', () => {
    mockHookFn.mockReturnValue({ ...baseHookValue, loading: true });
    const { container } = renderStatistics();
    expect(container.querySelector('.spinner-border')).toBeInTheDocument();
    expect(screen.getByText(/Loading your statistics/i)).toBeInTheDocument();
  });

  test('renders the main content when data is loaded', () => {
    renderStatistics();
    expect(screen.getByText('Statistics')).toBeInTheDocument();
    // "All Languages" appears both as the page header (selectedLanguageName) and
    // as an option label in StatsFilters; both is correct.
    expect(screen.getAllByText('All Languages').length).toBeGreaterThan(0);
  });

  test('renders the error banner with a retry button when the hook reports an error', () => {
    mockHookFn.mockReturnValue({ ...baseHookValue, error: 'Failed to load' });
    renderStatistics();
    expect(screen.getByText('Error Loading Statistics')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry/i }));
    expect(baseHookValue.refetchAll).toHaveBeenCalledTimes(1);
  });

  test('renders the disconnected banner when networkStatus is "error"', () => {
    mockHookFn.mockReturnValue({ ...baseHookValue, networkStatus: 'error' });
    renderStatistics();
    expect(screen.getByText(/Unable to connect to server/i)).toBeInTheDocument();
  });

  test('renders the "no statistics" empty state when there are no languages', () => {
    // buildLanguageStats merges stats.languageStatistics with activity-by-language
    // sources, so all of them must be empty for the empty state to render.
    mockHookFn.mockReturnValue({
      ...baseHookValue,
      stats: { ...baseHookValue.stats, languageStatistics: [] },
      readingActivity: { totalWordsRead: 0, activityByDate: [], activityByLanguage: [] },
      listeningActivity: {
        totalListeningSeconds: 0,
        listeningByDate: [],
        listeningByLanguage: []
      },
      knownWordsActivity: {
        totalKnownWords: 0,
        knownWordsByDate: [],
        knownWordsByLanguage: []
      }
    });
    renderStatistics();
    expect(screen.getByText('No Statistics Available')).toBeInTheDocument();
  });
});
