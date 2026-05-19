import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({
  testApiConnection: vi.fn(),
  getUserStatistics: vi.fn(),
  getReadingActivity: vi.fn(),
  getListeningActivity: vi.fn(),
  getKnownWordsActivity: vi.fn()
}));

import {
  testApiConnection,
  getUserStatistics,
  getReadingActivity,
  getListeningActivity,
  getKnownWordsActivity
} from '../utils/api';
import { useStatisticsData } from '../hooks/useStatisticsData';

const mockedTestApiConnection = vi.mocked(testApiConnection);
const mockedGetUserStatistics = vi.mocked(getUserStatistics);
const mockedGetReadingActivity = vi.mocked(getReadingActivity);
const mockedGetListeningActivity = vi.mocked(getListeningActivity);
const mockedGetKnownWordsActivity = vi.mocked(getKnownWordsActivity);

const statsResponse = {
  totalWords: 1000,
  knownWords: 400,
  learningWords: 600,
  totalBooks: 5,
  finishedBooks: 2,
  lastActivity: '2026-05-19T00:00:00Z',
  totalLanguages: 1,
  languageStatistics: [
    {
      languageId: 1,
      languageName: 'French',
      wordCount: 1000,
      knownWords: 400,
      learningWords: 600,
      totalWordsRead: 5000,
      totalSecondsListened: 1200
    }
  ]
};

const readingResponse = {
  totalWordsRead: 500,
  activityByDate: [{ date: '2026-05-19', wordsRead: 500 }],
  activityByLanguage: [{ languageId: 1, languageName: 'French', totalWords: 500 }]
};
const listeningResponse = {
  totalListeningSeconds: 600,
  listeningByDate: [{ date: '2026-05-19', minutesListened: 10 }],
  listeningByLanguage: [{ languageId: 1, languageName: 'French', totalSeconds: 600 }]
};
const knownWordsResponse = {
  totalKnownWords: 400,
  knownWordsByDate: [{ date: '2026-05-19', knownWords: 400 }],
  knownWordsByLanguage: [{ languageId: 1, languageName: 'French', totalKnown: 400 }]
};

// Casting to Awaited<ReturnType<...>> avoids restating the swagger-derived
// shape in every fixture — we only need the fields the hook actually reads.
type ReadingResult = Awaited<ReturnType<typeof getReadingActivity>>;
type ListeningResult = Awaited<ReturnType<typeof getListeningActivity>>;
type KnownWordsResult = Awaited<ReturnType<typeof getKnownWordsActivity>>;
type StatsResult = Awaited<ReturnType<typeof getUserStatistics>>;

const setHappyPath = () => {
  mockedTestApiConnection.mockResolvedValue(true);
  mockedGetUserStatistics.mockResolvedValue(statsResponse as unknown as StatsResult);
  mockedGetReadingActivity.mockResolvedValue(readingResponse as unknown as ReadingResult);
  mockedGetListeningActivity.mockResolvedValue(listeningResponse as unknown as ListeningResult);
  mockedGetKnownWordsActivity.mockResolvedValue(knownWordsResponse as unknown as KnownWordsResult);
};

describe('useStatisticsData', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setHappyPath();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('initial mount triggers connectivity check + stats + activity fetches', async () => {
    renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));

    await waitFor(() => expect(mockedTestApiConnection).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedGetUserStatistics).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mockedGetReadingActivity).toHaveBeenCalled());
    expect(mockedGetListeningActivity).toHaveBeenCalled();
    expect(mockedGetKnownWordsActivity).toHaveBeenCalled();
  });

  test('flips networkStatus to "connected" on a successful connectivity check', async () => {
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.networkStatus).toBe('connected'));
  });

  test('flips networkStatus to "error" when connectivity check resolves false', async () => {
    mockedTestApiConnection.mockResolvedValue(false);
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.networkStatus).toBe('error'));
  });

  test('flips networkStatus to "error" when connectivity check rejects', async () => {
    mockedTestApiConnection.mockRejectedValue(new Error('offline'));
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.networkStatus).toBe('error'));
    consoleSpy.mockRestore();
  });

  test('populates stats and activity on the happy path', async () => {
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    await waitFor(() => expect(result.current.loadingActivity).toBe(false));

    expect(result.current.stats?.totalWords).toBe(1000);
    expect(result.current.readingActivity.totalWordsRead).toBe(500);
    expect(result.current.listeningActivity.totalListeningSeconds).toBe(600);
    expect(result.current.knownWordsActivity.totalKnownWords).toBe(400);
    expect(result.current.error).toBe('');
  });

  test('surfaces an error message when getUserStatistics returns null', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Hook handles a null payload at runtime even though the API type forbids it.
    mockedGetUserStatistics.mockResolvedValue(null as unknown as StatsResult);
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/No statistics data available/);
    expect(result.current.stats).not.toBeNull();
    consoleSpy.mockRestore();
  });

  test('surfaces an error message when getUserStatistics rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetUserStatistics.mockRejectedValue(new Error('boom'));
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('boom');
    consoleSpy.mockRestore();
  });

  test('resets only the affected activity to empty when one fetch returns {error}', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockedGetReadingActivity.mockResolvedValue({ error: 'reading failed' });
    const { result } = renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(result.current.loadingActivity).toBe(false));

    expect(result.current.readingActivity.totalWordsRead).toBe(0);
    // Other activities still hydrate from their successful responses
    expect(result.current.listeningActivity.totalListeningSeconds).toBe(600);
    expect(result.current.knownWordsActivity.totalKnownWords).toBe(400);
    consoleSpy.mockRestore();
  });

  test('fires 3 activity calls (no previous-period) when period is "all"', async () => {
    renderHook(() => useStatisticsData({ period: 'all', languageId: 'all' }));
    await waitFor(() => expect(mockedGetReadingActivity).toHaveBeenCalledTimes(1));
    expect(mockedGetListeningActivity).toHaveBeenCalledTimes(1);
    expect(mockedGetKnownWordsActivity).toHaveBeenCalledTimes(1);
  });

  test('fires 6 activity calls (current + previous) when period is "last_week"', async () => {
    renderHook(() => useStatisticsData({ period: 'last_week', languageId: 'all' }));
    await waitFor(() => expect(mockedGetReadingActivity).toHaveBeenCalledTimes(2));
    expect(mockedGetListeningActivity).toHaveBeenCalledTimes(2);
    expect(mockedGetKnownWordsActivity).toHaveBeenCalledTimes(2);
    // previous-period fetch uses offset=1
    const [, , , offset] = mockedGetReadingActivity.mock.calls[1];
    expect(offset).toBe(1);
  });

  test('passes a concrete languageId (not "all") to the API', async () => {
    renderHook(() => useStatisticsData({ period: 'all', languageId: 1 }));
    await waitFor(() => expect(mockedGetReadingActivity).toHaveBeenCalled());
    const args = mockedGetReadingActivity.mock.calls[0];
    expect(args[2]).toBe(1);
  });

  test('passes null languageId when "all" is selected', async () => {
    renderHook(() => useStatisticsData({ period: 'all', languageId: 'all' }));
    await waitFor(() => expect(mockedGetReadingActivity).toHaveBeenCalled());
    const args = mockedGetReadingActivity.mock.calls[0];
    expect(args[2]).toBeNull();
  });

  test('refetchAll re-runs both stats and activity fetches', async () => {
    const { result } = renderHook(() => useStatisticsData({ period: 'all', languageId: 'all' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    mockedGetUserStatistics.mockClear();
    mockedGetReadingActivity.mockClear();

    act(() => {
      result.current.refetchAll();
    });

    await waitFor(() => expect(mockedGetUserStatistics).toHaveBeenCalledTimes(1));
    expect(mockedGetReadingActivity).toHaveBeenCalledTimes(1);
  });

  test('refetchActivity re-runs activity fetches but not stats', async () => {
    const { result } = renderHook(() => useStatisticsData({ period: 'all', languageId: 'all' }));
    await waitFor(() => expect(result.current.loadingActivity).toBe(false));
    mockedGetUserStatistics.mockClear();
    mockedGetReadingActivity.mockClear();

    await act(async () => {
      await result.current.refetchActivity();
    });

    expect(mockedGetUserStatistics).not.toHaveBeenCalled();
    expect(mockedGetReadingActivity).toHaveBeenCalledTimes(1);
  });

  test('visibilitychange to "visible" triggers another activity fetch', async () => {
    const { result } = renderHook(() => useStatisticsData({ period: 'all', languageId: 'all' }));
    await waitFor(() => expect(result.current.loadingActivity).toBe(false));
    mockedGetReadingActivity.mockClear();

    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(mockedGetReadingActivity).toHaveBeenCalledTimes(1));
  });
});
