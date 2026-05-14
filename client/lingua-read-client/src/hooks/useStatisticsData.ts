import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getKnownWordsActivity,
  getListeningActivity,
  getReadingActivity,
  getUserStatistics,
  testApiConnection
} from '../utils/api';
import {
  normalizeKnownWordsActivity,
  normalizeListeningActivity,
  normalizeReadingActivity,
  normalizeStatistics,
  supportsPreviousPeriod
} from '../utils/statistics';
import type {
  KnownWordsActivity,
  ListeningActivity,
  ReadingActivity,
  StatisticsSummary
} from '../utils/statistics';

const emptyReadingActivity = normalizeReadingActivity();
const emptyListeningActivity = normalizeListeningActivity();
const emptyKnownWordsActivity = normalizeKnownWordsActivity();

export type StatisticsNetworkStatus = 'connecting' | 'connected' | 'error';

export type UseStatisticsDataArgs = {
  period: string;
  languageId: number | string | 'all';
};

export type UseStatisticsDataResult = {
  stats: StatisticsSummary | null;
  readingActivity: ReadingActivity;
  listeningActivity: ListeningActivity;
  knownWordsActivity: KnownWordsActivity;
  previousReadingActivity: ReadingActivity;
  previousListeningActivity: ListeningActivity;
  previousKnownWordsActivity: KnownWordsActivity;
  loading: boolean;
  loadingActivity: boolean;
  error: string;
  networkStatus: StatisticsNetworkStatus;
  refetchAll: () => void;
  refetchActivity: () => Promise<void>;
};

export const useStatisticsData = ({
  period,
  languageId
}: UseStatisticsDataArgs): UseStatisticsDataResult => {
  const [stats, setStats] = useState<StatisticsSummary | null>(null);
  const [readingActivity, setReadingActivity] = useState<ReadingActivity>(emptyReadingActivity);
  const [listeningActivity, setListeningActivity] =
    useState<ListeningActivity>(emptyListeningActivity);
  const [knownWordsActivity, setKnownWordsActivity] =
    useState<KnownWordsActivity>(emptyKnownWordsActivity);
  const [previousReadingActivity, setPreviousReadingActivity] =
    useState<ReadingActivity>(emptyReadingActivity);
  const [previousListeningActivity, setPreviousListeningActivity] =
    useState<ListeningActivity>(emptyListeningActivity);
  const [previousKnownWordsActivity, setPreviousKnownWordsActivity] =
    useState<KnownWordsActivity>(emptyKnownWordsActivity);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [error, setError] = useState('');
  const [networkStatus, setNetworkStatus] = useState<StatisticsNetworkStatus>('connecting');
  const requestIdRef = useRef(0);

  const checkConnectivity = useCallback(async () => {
    try {
      const ok = await testApiConnection();
      setNetworkStatus(ok ? 'connected' : 'error');
    } catch (err) {
      console.error('Network check failed:', err);
      setNetworkStatus('error');
    }
  }, []);

  const loadStats = useCallback(async () => {
    setLoadingStats(true);
    setError('');

    try {
      const data = await getUserStatistics();
      if (!data) {
        throw new Error(
          'No statistics data available. The server might be offline or experiencing issues.'
        );
      }
      setStats(normalizeStatistics(data));
    } catch (err) {
      console.error('Failed to load statistics:', err);
      const message = err instanceof Error ? err.message : String(err);
      setError(message || 'Failed to load statistics. Please try again later.');
      setStats(normalizeStatistics());
    } finally {
      setLoadingStats(false);
    }
  }, []);

  const loadActivity = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setLoadingActivity(true);

    const includePrevious = supportsPreviousPeriod(period);

    try {
      const timezoneOffsetMinutes = -new Date().getTimezoneOffset();
      const selectedLanguageId = languageId === 'all' ? null : languageId;
      const requests: Promise<unknown>[] = [
        getReadingActivity(period, timezoneOffsetMinutes, selectedLanguageId),
        getListeningActivity(period, timezoneOffsetMinutes, selectedLanguageId),
        getKnownWordsActivity(period, timezoneOffsetMinutes, selectedLanguageId)
      ];
      if (includePrevious) {
        requests.push(getReadingActivity(period, timezoneOffsetMinutes, selectedLanguageId, 1));
        requests.push(getListeningActivity(period, timezoneOffsetMinutes, selectedLanguageId, 1));
        requests.push(getKnownWordsActivity(period, timezoneOffsetMinutes, selectedLanguageId, 1));
      }

      const results = await Promise.all(requests);

      if (requestIdRef.current !== requestId) return;

      const [readingData, listeningData, knownWordsData, prevReadingData, prevListeningData, prevKnownWordsData] =
        results as Array<{ error?: string } | undefined>;

      if (readingData && 'error' in readingData && readingData.error) {
        console.error('Failed to load reading activity:', readingData.error);
        setReadingActivity(emptyReadingActivity);
      } else {
        setReadingActivity(normalizeReadingActivity(readingData));
      }

      if (listeningData && 'error' in listeningData && listeningData.error) {
        console.error('Failed to load listening activity:', listeningData.error);
        setListeningActivity(emptyListeningActivity);
      } else {
        setListeningActivity(normalizeListeningActivity(listeningData));
      }

      if (knownWordsData && 'error' in knownWordsData && knownWordsData.error) {
        console.error('Failed to load known-words activity:', knownWordsData.error);
        setKnownWordsActivity(emptyKnownWordsActivity);
      } else {
        setKnownWordsActivity(normalizeKnownWordsActivity(knownWordsData));
      }

      if (includePrevious) {
        if (prevReadingData && 'error' in prevReadingData && prevReadingData.error) {
          console.error('Failed to load previous reading activity:', prevReadingData.error);
          setPreviousReadingActivity(emptyReadingActivity);
        } else {
          setPreviousReadingActivity(normalizeReadingActivity(prevReadingData));
        }

        if (prevListeningData && 'error' in prevListeningData && prevListeningData.error) {
          console.error('Failed to load previous listening activity:', prevListeningData.error);
          setPreviousListeningActivity(emptyListeningActivity);
        } else {
          setPreviousListeningActivity(normalizeListeningActivity(prevListeningData));
        }

        if (prevKnownWordsData && 'error' in prevKnownWordsData && prevKnownWordsData.error) {
          console.error('Failed to load previous known-words activity:', prevKnownWordsData.error);
          setPreviousKnownWordsActivity(emptyKnownWordsActivity);
        } else {
          setPreviousKnownWordsActivity(normalizeKnownWordsActivity(prevKnownWordsData));
        }
      } else {
        setPreviousReadingActivity(emptyReadingActivity);
        setPreviousListeningActivity(emptyListeningActivity);
        setPreviousKnownWordsActivity(emptyKnownWordsActivity);
      }
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      console.error('Failed to load activity:', err);
      setReadingActivity(emptyReadingActivity);
      setListeningActivity(emptyListeningActivity);
      setKnownWordsActivity(emptyKnownWordsActivity);
      setPreviousReadingActivity(emptyReadingActivity);
      setPreviousListeningActivity(emptyListeningActivity);
      setPreviousKnownWordsActivity(emptyKnownWordsActivity);
    } finally {
      if (requestIdRef.current === requestId) {
        setLoadingActivity(false);
      }
    }
  }, [languageId, period]);

  const refetchAll = useCallback(() => {
    loadStats();
    loadActivity();
  }, [loadActivity, loadStats]);

  useEffect(() => {
    checkConnectivity();
    loadStats();
  }, [checkConnectivity, loadStats]);

  useEffect(() => {
    loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadActivity();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [loadActivity]);

  return {
    stats,
    readingActivity,
    listeningActivity,
    knownWordsActivity,
    previousReadingActivity,
    previousListeningActivity,
    previousKnownWordsActivity,
    loading: loadingStats,
    loadingActivity,
    error,
    networkStatus,
    refetchAll,
    refetchActivity: loadActivity
  };
};

export default useStatisticsData;
