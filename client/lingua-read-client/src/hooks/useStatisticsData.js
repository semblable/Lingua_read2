import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getListeningActivity,
  getReadingActivity,
  getUserStatistics,
  testApiConnection
} from '../utils/api';
import {
  normalizeListeningActivity,
  normalizeReadingActivity,
  normalizeStatistics,
  supportsPreviousPeriod
} from '../utils/statistics';

const emptyReadingActivity = normalizeReadingActivity();
const emptyListeningActivity = normalizeListeningActivity();

export const useStatisticsData = ({ period, languageId }) => {
  const [stats, setStats] = useState(null);
  const [readingActivity, setReadingActivity] = useState(emptyReadingActivity);
  const [listeningActivity, setListeningActivity] = useState(emptyListeningActivity);
  const [previousReadingActivity, setPreviousReadingActivity] = useState(emptyReadingActivity);
  const [previousListeningActivity, setPreviousListeningActivity] = useState(emptyListeningActivity);
  const [loadingStats, setLoadingStats] = useState(true);
  const [loadingActivity, setLoadingActivity] = useState(true);
  const [error, setError] = useState('');
  const [networkStatus, setNetworkStatus] = useState('connecting');
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
        throw new Error('No statistics data available. The server might be offline or experiencing issues.');
      }
      setStats(normalizeStatistics(data));
    } catch (err) {
      console.error('Failed to load statistics:', err);
      setError(err.message || 'Failed to load statistics. Please try again later.');
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
      const requests = [
        getReadingActivity(period, timezoneOffsetMinutes, selectedLanguageId),
        getListeningActivity(period, timezoneOffsetMinutes, selectedLanguageId)
      ];
      if (includePrevious) {
        requests.push(getReadingActivity(period, timezoneOffsetMinutes, selectedLanguageId, 1));
        requests.push(getListeningActivity(period, timezoneOffsetMinutes, selectedLanguageId, 1));
      }

      const results = await Promise.all(requests);

      if (requestIdRef.current !== requestId) return;

      const [readingData, listeningData, prevReadingData, prevListeningData] = results;

      if (readingData?.error) {
        console.error('Failed to load reading activity:', readingData.error);
        setReadingActivity(emptyReadingActivity);
      } else {
        setReadingActivity(normalizeReadingActivity(readingData));
      }

      if (listeningData?.error) {
        console.error('Failed to load listening activity:', listeningData.error);
        setListeningActivity(emptyListeningActivity);
      } else {
        setListeningActivity(normalizeListeningActivity(listeningData));
      }

      if (includePrevious) {
        if (prevReadingData?.error) {
          console.error('Failed to load previous reading activity:', prevReadingData.error);
          setPreviousReadingActivity(emptyReadingActivity);
        } else {
          setPreviousReadingActivity(normalizeReadingActivity(prevReadingData));
        }

        if (prevListeningData?.error) {
          console.error('Failed to load previous listening activity:', prevListeningData.error);
          setPreviousListeningActivity(emptyListeningActivity);
        } else {
          setPreviousListeningActivity(normalizeListeningActivity(prevListeningData));
        }
      } else {
        setPreviousReadingActivity(emptyReadingActivity);
        setPreviousListeningActivity(emptyListeningActivity);
      }
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      console.error('Failed to load activity:', err);
      setReadingActivity(emptyReadingActivity);
      setListeningActivity(emptyListeningActivity);
      setPreviousReadingActivity(emptyReadingActivity);
      setPreviousListeningActivity(emptyListeningActivity);
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
    previousReadingActivity,
    previousListeningActivity,
    loading: loadingStats,
    loadingActivity,
    error,
    networkStatus,
    refetchAll,
    refetchActivity: loadActivity
  };
};

export default useStatisticsData;

