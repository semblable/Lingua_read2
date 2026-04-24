import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Container, Row, Col, Card, Alert, Spinner, ProgressBar, Table, Form, Button } from 'react-bootstrap';
// import { useNavigate } from 'react-router-dom'; // Removed unused import
import { API_URL, getUserStatistics, getReadingActivity, getListeningActivity, testApiConnection } from '../utils/api';
import { formatDate } from '../utils/helpers';
import {
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, PieChart, Pie, AreaChart, Area, BarChart, Bar
} from 'recharts';
import ManualEntryModal from '../components/ManualEntryModal'; // Import the modal component
import CefrBadge from '../components/dashboard/CefrBadge';

const Statistics = () => {
  const location = useLocation();
  // If navigated with state { refreshStats: true }, force a stats refresh
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedLanguage, setSelectedLanguage] = useState('all');
  const [initializingLanguages, setInitializingLanguages] = useState(false);
  const [readingActivity, setReadingActivity] = useState(null);
  const [activityPeriod, setActivityPeriod] = useState('all');
  const [loadingActivity, setLoadingActivity] = useState(false);
  const [listeningActivity, setListeningActivity] = useState(null); // State for listening data
  const [loadingListeningActivity, setLoadingListeningActivity] = useState(false); // Loading state for listening data
  const [usingFallbackData, setUsingFallbackData] = useState(false);
  const [networkStatus, setNetworkStatus] = useState('connecting');
  // const navigate = useNavigate(); // Removed unused navigate
  const [showManualEntryModal, setShowManualEntryModal] = useState(false); // State for modal visibility

  // Check API connectivity
  useEffect(() => {
    const checkConnectivity = async () => {
      try {
        const ok = await testApiConnection();
        if (ok) {
          setNetworkStatus('connected');
          setUsingFallbackData(false);
        } else {
          setNetworkStatus('error');
          setUsingFallbackData(true);
        }
      } catch (error) {
        console.error('Network check failed:', error);
        setNetworkStatus('error');
        setUsingFallbackData(true);
      }
    };

    checkConnectivity();
  }, []);

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(''); // Reset any existing errors

      try {
        const data = await getUserStatistics();

        // Debug output for the raw data

        if (!data) {
          console.error('No data returned from getUserStatistics');
          setError('No statistics data available. The server might be offline or experiencing issues.');
          setStats(null);
          return;
        }

        // Fix case sensitivity issues - ensure we have properties in both formats
        if (data) {
          // Ensure LanguageStatistics exists in both cases
          if (data.languageStatistics && !data.LanguageStatistics) {
            data.LanguageStatistics = data.languageStatistics;
          } else if (data.LanguageStatistics && !data.languageStatistics) {
            data.languageStatistics = data.LanguageStatistics;
          }

          // Ensure we have an array for language statistics
          if (!data.LanguageStatistics) {
            data.LanguageStatistics = [];
          }

          // Ensure TotalWords and KnownWords properties exist
          data.TotalWords = data.TotalWords || data.totalWords || 0;
          data.KnownWords = data.KnownWords || data.knownWords || 0;
          data.LearningWords = data.LearningWords || data.learningWords || 0;
          data.TotalBooks = data.TotalBooks || data.totalBooks || 0;
          data.FinishedBooks = data.FinishedBooks || data.finishedBooks || 0;

          // Debug logging
        }

        setStats(data);
      } catch (err) {
        console.error('Failed to load statistics:', err);
        setError(err.message || 'Failed to load statistics. Please try again later.');
        // Ensure we still show a fallback UI even when error occurs
        setStats({
          TotalWords: 0,
          KnownWords: 0,
          LearningWords: 0,
          TotalBooks: 0,
          FinishedBooks: 0,
          LastActivity: new Date().toISOString(),
          TotalLanguages: 0,
          LanguageStatistics: []
        });
      } finally {
        setLoading(false);
      }
    };

    // If navigated with state { refreshStats: true }, or on initial mount, fetch stats
    if (location.state && location.state.refreshStats) {
      fetchStats();
      // Clear the state so it doesn't refetch on every render
      window.history.replaceState({}, document.title);
    } else {
      fetchStats();
    }
  }, [location.state]);

  // --- Refactored Data Fetching ---
  const fetchReadingActivityData = async (period, languageId = null) => {
    setLoadingActivity(true);
    try {
      // Pass timezone offset for all periods except 'all'
      const timezoneOffsetMinutes = period !== 'all' ? new Date().getTimezoneOffset() : null;
      // Convert 'all' string to null for API
      const langId = languageId === 'all' ? null : languageId;
      const data = await getReadingActivity(period, timezoneOffsetMinutes, langId);

      if (!data) {
        console.error('No activity data returned from getReadingActivity');
        setReadingActivity({ TotalWordsRead: 0, ActivityByDate: {}, ActivityByLanguage: {} });
        return;
      }

      // Normalize data
      data.ActivityByDate = data.ActivityByDate || data.activityByDate || {};
      data.ActivityByLanguage = data.ActivityByLanguage || data.activityByLanguage || {};
      data.TotalWordsRead = data.TotalWordsRead || data.totalWordsRead || 0;
      setReadingActivity(data);
    } catch (err) {
      console.error('Failed to load reading activity', err);
      setReadingActivity({ TotalWordsRead: 0, ActivityByDate: {}, ActivityByLanguage: {} });
    } finally {
      setLoadingActivity(false);
    }
  };

  const fetchListeningActivityData = async (period, languageId = null) => {
    setLoadingListeningActivity(true);
    try {
      // Pass timezone offset for all periods except 'all'
      const timezoneOffsetMinutes = period !== 'all' ? new Date().getTimezoneOffset() : null;
      // Convert 'all' string to null for API
      const langId = languageId === 'all' ? null : languageId;
      const data = await getListeningActivity(period, timezoneOffsetMinutes, langId);

      if (!data || data.error) {
        console.error('No listening activity data or error in response:', data?.error);
        setListeningActivity({ TotalListeningSeconds: 0, ListeningByDate: {}, ListeningByLanguage: [] });
      } else {
        // Normalize data
        data.TotalListeningSeconds = data.TotalListeningSeconds || data.totalListeningSeconds || 0;
        data.ListeningByDate = data.ListeningByDate || data.listeningByDate || {};
        let langData = data.ListeningByLanguage || data.listeningByLanguage || [];
        if (!Array.isArray(langData)) langData = [];
        data.ListeningByLanguage = langData.map(item => ({
          languageId: item.LanguageId || item.languageId,
          languageName: item.LanguageName || item.languageName || 'Unknown',
          totalSeconds: item.TotalSeconds || item.totalSeconds || 0
        }));
        setListeningActivity(data);
      }
    } catch (err) {
      console.error('ERROR loading listening activity:', err);
      setListeningActivity({ TotalListeningSeconds: 0, ListeningByDate: {}, ListeningByLanguage: [] });
    } finally {
      setLoadingListeningActivity(false);
    }
  };

  // Fetch activity data on initial load and when period or language changes
  useEffect(() => {
    fetchReadingActivityData(activityPeriod, selectedLanguage);
    fetchListeningActivityData(activityPeriod, selectedLanguage);
  }, [activityPeriod, selectedLanguage]);

  // --- End Refactored Data Fetching ---


  // Re-fetch data when the page becomes visible again (keep existing logic)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Re-trigger the fetch functions using the current activityPeriod and selectedLanguage
        fetchReadingActivityData(activityPeriod, selectedLanguage);
        fetchListeningActivityData(activityPeriod, selectedLanguage);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup listener on component unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activityPeriod, selectedLanguage]); // Re-run if activityPeriod changes

  // Callback function for successful manual entry
  const handleManualSubmitSuccess = () => {
    // Re-fetch data for the current period and language
    fetchReadingActivityData(activityPeriod, selectedLanguage);
    fetchListeningActivityData(activityPeriod, selectedLanguage);
    // Optionally, could also re-fetch general stats if manual entry affects them
    // fetchStats(); // Uncomment if needed
  };


  // Function to initialize languages if none exist (Original - Keep this one)
  const handleInitializeLanguages = async () => {
    try {
      setInitializingLanguages(true);

      // Call the admin endpoint to initialize languages
      const response = await fetch(`${API_URL}/admin/initialize-languages`, {
        credentials: 'include',
        headers: {
          'Accept': 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to initialize languages');
      }

      // Refresh the page to reload data
      window.location.reload();
    } catch (error) {
      console.error('Error initializing languages:', error);
      setError('Failed to initialize languages. Please try again.');
    } finally {
      setInitializingLanguages(false);
    }
  };

  // Helper function to prepare activity by date data for charts
  const prepareActivityByDateData = () => {
    if (!readingActivity?.ActivityByDate) return [];

    return Object.entries(readingActivity.ActivityByDate)
      .map(([date, count]) => ({
        date,
        wordsRead: count
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort by date ascending
  };

  // Helper function to prepare language statistics data for charts
  // const prepareLanguageStatsData = () => { // Removed unused function
  //   if (!stats?.LanguageStatistics) return [];
  //
  //   return stats.LanguageStatistics.map(lang => {
  //     const langName = lang.LanguageName || lang.languageName;
  //     const wordCount = lang.WordCount || lang.wordCount || 0;
  //     const wordsRead = lang.TotalWordsRead || lang.totalWordsRead || 0;
  //
  //     return {
  //       name: langName,
  //       wordCount,
  //       wordsRead
  //     };
  //   }).sort((a, b) => b.wordCount - a.wordCount); // Sort by word count descending
  // };

  // Helper function to format duration in seconds to HH:MM:SS or similar
  const formatDuration = (totalSeconds) => {
    if (totalSeconds === 0) return '0m';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    let formatted = '';
    if (hours > 0) formatted += `${hours}h `;
    if (minutes > 0 || hours > 0) formatted += `${minutes}m `; // Show minutes if hours exist or minutes > 0
    if (hours === 0 && minutes === 0) formatted += `${seconds}s`; // Only show seconds for sub-minute durations

    return formatted.trim() || '0s'; // Handle case where duration is < 1s
  };

  // Helper function to prepare listening activity by date data for charts
  const prepareListeningActivityByDateData = () => {
    if (!listeningActivity?.ListeningByDate) return [];
    return Object.entries(listeningActivity.ListeningByDate)
      .map(([date, seconds]) => ({
        date,
        minutesListened: Math.round(seconds / 60) // Convert seconds to minutes for chart readability
      }))
      .sort((a, b) => new Date(a.date) - new Date(b.date)); // Sort by date ascending
  };

  // Helper function to prepare listening activity by language data for charts
  const prepareListeningActivityByLanguageData = () => {
    if (!listeningActivity?.ListeningByLanguage || !Array.isArray(listeningActivity.ListeningByLanguage)) return [];
    return listeningActivity.ListeningByLanguage
      .map(lang => ({
        language: lang.languageName || 'Unknown',
        minutesListened: Math.round(lang.totalSeconds / 60) // Convert seconds to minutes
      }))
      .filter(item => item.minutesListened > 0) // Only show languages with listening time
      .sort((a, b) => b.minutesListened - a.minutesListened); // Sort by duration descending
  };


  // Network Status Banner
  const renderNetworkBanner = () => {
    if (networkStatus === 'connected') {
      return null; // Don't show banner when connected
    }

    if (networkStatus === 'error') {
      return (
        <Alert variant="danger" className="mb-4">
          <strong>Error:</strong> Unable to connect to server. Some features may be limited.
        </Alert>
      );
    }

    // Default connecting message
    return (
      <Alert variant="info" className="mb-4">
        <strong>Connecting:</strong> Establishing connection to the server...
      </Alert>
    );
  };

  // Show appropriate loading UI
  if (loading) {
    return (
      <Container className="mt-4">
        {renderNetworkBanner()}
        <div className="text-center">
          <Spinner animation="border" />
          <p>Loading your statistics...</p>
        </div>
      </Container>
    );
  }

  // Show error UI with more context
  if (error) {
    return (
      <Container className="mt-4">
        {renderNetworkBanner()}
        <Alert variant="danger">
          <Alert.Heading>Error Loading Statistics</Alert.Heading>
          <p>{error}</p>
          {usingFallbackData && (
            <p>
              <strong>Note:</strong> Unable to connect to the statistics API.
              Try refreshing the page or checking your network connection.
            </p>
          )}
          <div className="d-flex justify-content-end">
            <Button variant="outline-danger" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        </Alert>
      </Container>
    );
  }

  if (!stats) {
    return (
      <Container className="mt-4 pb-5"> {/* Added padding-bottom */}
        {renderNetworkBanner()}
        <Alert variant="warning">
          <Alert.Heading>No Statistics Available</Alert.Heading>
          <p>We couldn't find any statistics data. This could be because:</p>
          <ul>
            <li>You haven't started reading any books yet</li>
            <li>The connection to the statistics server failed</li>
            <li>The statistics service is temporarily unavailable</li>
          </ul>
          <div className="d-flex justify-content-end">
            <Button variant="outline-warning" onClick={() => window.location.reload()}>
              Retry
            </Button>
          </div>
        </Alert>
      </Container>
    );
  }

  // Get language statistics safely
  // Combine all language data sources to get a unique list of languages
  const rawLanguageStats = [
    ...(Array.isArray(stats?.LanguageStatistics) ? stats.LanguageStatistics : []),
    ...(Array.isArray(stats?.languageStatistics) ? stats.languageStatistics : []),
    ...(Array.isArray(readingActivity?.ActivityByLanguage) ? readingActivity.ActivityByLanguage : []),
    ...(Array.isArray(listeningActivity?.ListeningByLanguage) ? listeningActivity.ListeningByLanguage : [])
  ];

  // Drop invalid/orphan activity buckets (LanguageId 0); server also filters these
  const allLanguageStats = rawLanguageStats.filter((langStat) => {
    const id = langStat.LanguageId ?? langStat.languageId;
    return id !== 0 && id !== '0';
  });

  const uniqueLanguages = allLanguageStats.reduce((acc, langStat) => {
    const langId = langStat.LanguageId || langStat.languageId;
    if (langId && !acc[langId]) {
      acc[langId] = {
        languageId: langId,
        languageName: langStat.LanguageName || langStat.languageName || 'Unknown',
        // Initialize cumulative stats
        knownWords: 0,
        learningWords: 0,
        totalWordsEncountered: 0,
        totalWordsRead: 0,          // Cumulative from UserLanguageStatistics
        totalSecondsListened: 0,    // Cumulative from UserLanguageStatistics
        totalTextsCompleted: 0,     // Cumulative from UserLanguageStatistics
        totalBooksCompleted: 0,     // Cumulative from UserLanguageStatistics
        bookCount: 0,               // Maybe from general stats?
        finishedBookCount: 0,       // Maybe from general stats?
        // Initialize period-specific stats
        periodWordsRead: 0,         // From readingActivity
        periodSecondsListened: 0    // From listeningActivity
      };
    }
    return acc;
  }, {});

  // Populate CUMULATIVE stats from stats.LanguageStatistics (for fields NOT available in activity endpoints)
  (stats?.LanguageStatistics || []).forEach(stat => {
    const langId = stat.LanguageId || stat.languageId;
    if (uniqueLanguages[langId]) {
      // Populate stats potentially ONLY available here (like word status counts, book counts)
      uniqueLanguages[langId].knownWords = stat.KnownWords || stat.knownWords || 0;
      uniqueLanguages[langId].learningWords = stat.LearningWords || stat.learningWords || 0;
      uniqueLanguages[langId].totalTextsCompleted = stat.TotalTextsCompleted || stat.totalTextsCompleted || 0; // Keep this for now
      uniqueLanguages[langId].totalBooksCompleted = stat.TotalBooksCompleted || stat.totalBooksCompleted || 0;
      uniqueLanguages[langId].totalWordsEncountered = stat.WordCount || stat.wordCount || 0; // Needs clarification?
      uniqueLanguages[langId].bookCount = stat.BookCount || stat.bookCount || 0; // Needs clarification?
      uniqueLanguages[langId].finishedBookCount = stat.FinishedBookCount || stat.finishedBookCount || 0; // Needs clarification?
      // Robustly map both PascalCase and camelCase to camelCase for frontend
      uniqueLanguages[langId].totalWordsRead = stat.TotalWordsRead ?? stat.totalWordsRead ?? 0;
      uniqueLanguages[langId].totalSecondsListened = stat.TotalSecondsListened ?? stat.totalSecondsListened ?? 0;
      uniqueLanguages[langId].cefrLevel = stat.CefrLevel ?? stat.cefrLevel ?? null;
      // DO NOT populate totalWordsRead or totalSecondsListened here, use activity endpoints below
    }
  });

  // Populate PERIOD stats from readingActivity
  if (activityPeriod !== 'all') {
    if (!loadingActivity) { // Only calculate if reading activity is not loading
      // Correctly iterate over the reading activity object { LanguageName: count }
      const activityByLangObject = readingActivity?.ActivityByLanguage || readingActivity?.activityByLanguage || {};
      Object.entries(activityByLangObject).forEach(([langName, wordCount]) => {
        // Find the language ID in our uniqueLanguages map using the language name
        const langEntry = Object.values(uniqueLanguages).find(lang => lang.languageName === langName);
        if (langEntry) {
          const langId = langEntry.languageId;
          uniqueLanguages[langId].periodWordsRead = wordCount || 0;
        } else {
          console.warn(`[DEBUG] Could not find language ID for language name: ${langName} in reading activity data.`);
        }
      });
    }

    // Populate PERIOD stats from listeningActivity
    if (!loadingListeningActivity) { // Only calculate if listening activity is not loading
      (listeningActivity?.ListeningByLanguage || []).forEach(stat => {
        const langId = stat.LanguageId || stat.languageId;
        if (uniqueLanguages[langId]) {
          // Update the periodSecondsListened from the activity endpoint data
          const activitySeconds = stat.TotalSeconds || stat.totalSeconds || 0;
          uniqueLanguages[langId].periodSecondsListened = activitySeconds;
        }
      });
    }
  }


  const languagesArray = Object.values(uniqueLanguages).sort((a, b) => a.languageName.localeCompare(b.languageName));
  const totalLanguages = languagesArray.length;

  // Calculate total words read safely
  // const totalWordsRead = calculateTotalWordsRead(stats); // Removed unused variable assignment

  // Filter language statistics if a specific language is selected

  // Prepare data for activity charts
  const readingActivityByDate = prepareActivityByDateData();
  const listeningActivityByDate = prepareListeningActivityByDateData();


  // Determine displayed general stats based on language selection
  const displayStats = selectedLanguage === 'all'
    ? stats
    : (uniqueLanguages[selectedLanguage] ? {
      TotalWords: uniqueLanguages[selectedLanguage].totalWordsEncountered,
      KnownWords: uniqueLanguages[selectedLanguage].knownWords,
      LearningWords: uniqueLanguages[selectedLanguage].learningWords,
      TotalBooks: uniqueLanguages[selectedLanguage].bookCount,
      FinishedBooks: uniqueLanguages[selectedLanguage].finishedBookCount
    } : stats);

  const displayCompletionPercentage = displayStats.TotalWords > 0
    ? Math.round((displayStats.KnownWords / displayStats.TotalWords) * 100)
    : 0;

  return (
    <Container className="mt-4 pb-5"> {/* Added padding-bottom */}
      {renderNetworkBanner()}

      {/* Header Row */}
      <Row className="mb-4 align-items-center justify-content-between">
        <Col md="auto">
          <h2 className="fw-bold mb-0" style={{ color: 'var(--font-color)' }}>
            Statistics
            <small className="ms-2 text-muted fs-6 fw-normal">
              {selectedLanguage !== 'all' ? `(${languagesArray.find(l => (l.LanguageId || l.languageId).toString() === selectedLanguage.toString())?.languageName || 'Selected Language'})` : '(All Languages)'}
            </small>
          </h2>
        </Col>
        <Col md="auto">
          <div className="d-flex align-items-center gap-2 p-2 rounded-3" style={{ backgroundColor: 'var(--theme-surface-bg)', border: '1px solid var(--theme-border-color)' }}>
            <Form.Select
              className="fw-medium"
              style={{
                width: 'auto',
                backgroundColor: 'var(--theme-surface-bg)',
                color: 'var(--theme-text)',
                borderColor: 'var(--theme-border-color)',
                borderRadius: 'var(--radius-md)'
              }}
              value={activityPeriod}
              onChange={(e) => setActivityPeriod(e.target.value)}
              aria-label="Select activity period"
            >
              <option value="last_day">Today</option>
              <option value="last_week">Last 7 Days</option>
              <option value="last_month">Last 30 Days</option>
              <option value="last_90">90 Days</option>
              <option value="last_180">180 Days</option>
              <option value="all">All Time</option>
            </Form.Select>

            <Form.Select
              className="fw-medium"
              style={{
                width: 'auto',
                backgroundColor: 'var(--theme-surface-bg)',
                color: 'var(--theme-text)',
                borderColor: 'var(--theme-border-color)',
                borderRadius: 'var(--radius-md)'
              }}
              value={selectedLanguage}
              onChange={(e) => setSelectedLanguage(e.target.value)}
              disabled={languagesArray.length === 0}
              aria-label="Select language"
            >
              <option value="all">All Languages</option>
              {languagesArray.map(lang => {
                const langId = lang.LanguageId || lang.languageId;
                const langName = lang.LanguageName || lang.languageName;
                return (
                  <option key={langId} value={langId}>
                    {langName}
                  </option>
                );
              })}
            </Form.Select>

            <Button
              variant="primary"
              className="rounded-pill px-4"
              style={{ backgroundColor: 'var(--accent-color)', borderColor: 'var(--accent-color)' }}
              onClick={() => setShowManualEntryModal(true)}
            >
              Log Activity
            </Button>
          </div>
        </Col>
      </Row>

      {/* General Stats Cards */}
      <Row className="mb-4">
        {/* Total Words Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Encountered</Card.Title>
              <Card.Text className="fs-1 fw-bold mb-0" style={{ color: 'var(--primary-color)' }}>{displayStats.TotalWords.toLocaleString()}</Card.Text>
            </Card.Body>
          </Card>
        </Col>

        {/* Known Words Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Known Words</Card.Title>
              <Card.Text className="fs-1 fw-bold text-success mb-2">{displayStats.KnownWords.toLocaleString()}</Card.Text>
              <ProgressBar
                now={displayCompletionPercentage}
                variant="success"
                className="mt-1"
                style={{ height: '6px', borderRadius: '3px' }}
              />
              <div className="small text-muted mt-1 fw-medium">{displayCompletionPercentage}% of total</div>
            </Card.Body>
          </Card>
        </Col>

        {/* Books Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Books</Card.Title>
              <Card.Text className="fs-1 fw-bold mb-0" style={{ color: 'var(--primary-color)' }}>{displayStats.TotalBooks}</Card.Text>
              <div className="badge bg-success-subtle text-success rounded-pill align-self-center mt-2 px-3 py-2 fw-semibold">
                {displayStats.FinishedBooks} Finished
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* Languages Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Languages</Card.Title>
              <Card.Text className="fs-1 fw-bold text-info mb-0">{totalLanguages}</Card.Text>
              {totalLanguages === 0 && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="mt-2 rounded-pill"
                  onClick={handleInitializeLanguages}
                  disabled={initializingLanguages}
                >
                  {initializingLanguages ? <Spinner size="sm" /> : 'Initialize'}
                </Button>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Styles for glassmorphism and animations */}
      <style>{`
        .ls-wide { letter-spacing: 0.05em; }
        .hover-elevate { transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275); }
        .hover-elevate:hover { transform: translateY(-5px); box-shadow: var(--shadow-md) !important; }
        .bg-success-subtle { background-color: rgba(46, 204, 113, 0.15); }
        .bg-primary-subtle { background-color: rgba(52, 152, 219, 0.15); }
        .transition-all { transition: all 0.3s ease; }
      `}</style>

      {/* Activity Summary Cards */}
      <Row className="mb-4">
        {/* Total Words Read Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Words Read</Card.Title>
              <Card.Text className="fs-1 fw-bold mb-0" style={{ color: 'var(--primary-color)' }}>{readingActivity?.TotalWordsRead?.toLocaleString() || 0}</Card.Text>
              <div className="small text-muted mt-1 fw-medium">in selected period</div>
            </Card.Body>
          </Card>
        </Col>

        {/* Total Time Listened Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Time Listened</Card.Title>
              <Card.Text className="fs-1 fw-bold text-primary mb-0">{Math.round((listeningActivity?.TotalListeningSeconds || 0) / 60)}m</Card.Text>
              <div className="small text-muted mt-1 fw-medium">in selected period</div>
            </Card.Body>
          </Card>
        </Col>

        {/* Total Lessons Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Activities</Card.Title>
              <Card.Text className="fs-1 fw-bold mb-0" style={{ color: 'var(--primary-color)' }}>{Object.keys(readingActivity?.ActivityByDate || {}).length}</Card.Text>
              <div className="small text-muted mt-1 fw-medium">active days</div>
            </Card.Body>
          </Card>
        </Col>

        {/* Daily Average Card */}
        <Col md={3}>
          <Card className="text-center h-100 border-0 shadow-sm hover-elevate transition-all" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
            <Card.Body className="d-flex flex-column justify-content-center">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-3 ls-wide">Daily Avg</Card.Title>
              <Card.Text className="fs-1 fw-bold text-accent mb-0" style={{ color: 'var(--accent-color)' }}>
                {activityPeriod === 'all'
                  ? '-'
                  : ((readingActivity?.TotalWordsRead || 0) / (activityPeriod === 'last_day' ? 1 : activityPeriod === 'last_week' ? 7 : activityPeriod === 'last_month' ? 30 : activityPeriod === 'last_90' ? 90 : 180)).toFixed(0)
                }
              </Card.Text>
              <div className="small text-muted mt-1 fw-medium">words / day</div>
            </Card.Body>
          </Card>
        </Col>
      </Row>


      {/* Per-Language Statistics Section */}
      <h3 className="mt-5 mb-3">Statistics by Language</h3>
      {languagesArray.length > 0 ? (
        languagesArray.map(lang => (
          <Card key={lang.languageId} className="mb-4">
            <Card.Header as="h5" className="d-flex justify-content-between align-items-center">
              <span>{lang.languageName}</span>
              {lang.cefrLevel && <CefrBadge level={lang.cefrLevel} />}
            </Card.Header>
            <Card.Body>
              <Row>
                {/* Vocabulary Stats */}
                <Col md={4} className="mb-3">
                  <h6>Vocabulary</h6>
                  <p className="mb-1">Known Words: {lang.knownWords}</p>
                  <p className="mb-1">Learning Words: {lang.learningWords}</p>
                  <p className="mb-0">Total Encountered: {lang.totalWordsEncountered}</p>
                  {lang.totalWordsEncountered > 0 && (
                    <ProgressBar className="mt-2">
                      <ProgressBar variant="success" now={(lang.knownWords / lang.totalWordsEncountered) * 100} key={1} label={`Known (${((lang.knownWords / lang.totalWordsEncountered) * 100).toFixed(0)}%)`} />
                      <ProgressBar variant="warning" now={(lang.learningWords / lang.totalWordsEncountered) * 100} key={2} label={`Learning (${((lang.learningWords / lang.totalWordsEncountered) * 100).toFixed(0)}%)`} />
                    </ProgressBar>
                  )}
                </Col>

                {/* Reading Stats */}
                <Col md={4} className="mb-3">
                  <h6>Reading ({activityPeriod === 'all' ? 'All Time' : `Selected Period`})</h6>
                  {loadingActivity ? <Spinner size="sm" /> : <p className="mb-0">Words Read: {activityPeriod === 'all' ? lang.totalWordsRead : lang.periodWordsRead}</p>}
                  {/* Add more reading stats if available */}
                </Col>

                {/* Listening Stats */}
                <Col md={4} className="mb-3">
                  <h6>Listening ({activityPeriod === 'all' ? 'All Time' : `Selected Period`})</h6>
                  {loadingListeningActivity ? <Spinner size="sm" /> : <p className="mb-0">Time Listened: {formatDuration(activityPeriod === 'all' ? lang.totalSecondsListened : lang.periodSecondsListened)}</p>}
                  {/* Add more listening stats if available */}
                </Col>
              </Row>
              {/* Optionally add per-language charts here later */}
            </Card.Body>
          </Card>
        ))
      ) : (
        <Alert variant="info">No language-specific data available yet.</Alert>
      )}

      {/* Charts Section */}
      <Row className="mb-4 g-4">
        {/* Word Breakdown Donut Chart */}
        <Col md={4}>
          <Card className="border-0 shadow-sm h-100" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--theme-surface-bg)' }}>
            <Card.Body className="d-flex flex-column">
              <Card.Title className="text-muted small text-uppercase fw-bold mb-4 ls-wide">Word Breakdown</Card.Title>
              <div style={{ flexGrow: 1, minHeight: 250 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'Known', value: displayStats.KnownWords, fill: '#2ECC71' },
                        { name: 'Learning', value: displayStats.LearningWords, fill: '#F1C40F' }
                      ]}
                      innerRadius={60}
                      outerRadius={90}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                    >
                      <Cell fill="#2ECC71" />
                      <Cell fill="#F1C40F" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center mt-3">
                <span className="badge rounded-pill me-2 px-3 py-2" style={{ backgroundColor: '#2ECC71', color: '#fff' }}>Known: {displayStats.KnownWords.toLocaleString()}</span>
                <span className="badge rounded-pill px-3 py-2" style={{ backgroundColor: '#F1C40F', color: '#333' }}>Learning: {displayStats.LearningWords.toLocaleString()}</span>
              </div>
            </Card.Body>
          </Card>
        </Col>

        {/* Words Read Over Time Chart */}
        <Col md={4}>
          <Card className="border-0 shadow-sm h-100" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--theme-surface-bg)' }}>
            <Card.Body>
              <Card.Title className="text-muted small text-uppercase fw-bold mb-4 ls-wide">Words Read Over Time</Card.Title>
              {loadingActivity ? (
                <div className="d-flex justify-content-center align-items-center" style={{ height: '250px' }}>
                  <Spinner animation="border" variant="primary" />
                </div>
              ) : (
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer>
                    <AreaChart data={readingActivityByDate}>
                      <defs>
                        <linearGradient id="colorRead" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3498DB" stopOpacity={0.3} />
                          <stop offset="95%" stopColor="#3498DB" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                      <Tooltip contentStyle={{ borderRadius: 'var(--radius-md)', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                      <Area type="monotone" dataKey="wordsRead" stroke="#3498DB" strokeWidth={2} fillOpacity={1} fill="url(#colorRead)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>

        {/* Listening Over Time Chart */}
        <Col md={4}>
          <Card className="border-0 shadow-sm h-100" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--theme-surface-bg)' }}>
            <Card.Body>
              <Card.Title className="text-muted small text-uppercase fw-bold mb-4 ls-wide">Listening Over Time</Card.Title>
              {loadingListeningActivity ? (
                <div className="d-flex justify-content-center align-items-center" style={{ height: '250px' }}>
                  <Spinner animation="border" variant="info" />
                </div>
              ) : (
                <div style={{ width: '100%', height: 250 }}>
                  <ResponsiveContainer>
                    <BarChart data={listeningActivityByDate}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(0,0,0,0.05)" />
                      <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                      <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: '#888' }} />
                      <Tooltip contentStyle={{ borderRadius: 'var(--radius-md)', border: 'none', boxShadow: 'var(--shadow-md)' }} cursor={{ fill: 'rgba(0,0,0,0.02)' }} />
                      <Bar dataKey="minutesListened" fill="#1ABC9C" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Language Comparison Chart */}
      {Object.keys(uniqueLanguages).length > 1 && (
        <Row className="mb-4">
          <Col>
            <Card className="border-0 shadow-sm" style={{ borderRadius: 'var(--radius-lg)', background: 'var(--theme-surface-bg)' }}>
              <Card.Body>
                <Card.Title className="text-muted small text-uppercase fw-bold mb-4 ls-wide">Vocabulary by Language</Card.Title>
                <div style={{ width: '100%', height: 300 }}>
                  <ResponsiveContainer>
                    <BarChart data={Object.values(uniqueLanguages).map(l => ({ name: l.languageName, known: l.knownWords, learning: l.learningWords }))} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="rgba(0,0,0,0.05)" />
                      <XAxis type="number" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} />
                      <YAxis type="category" dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#888' }} width={100} />
                      <Tooltip contentStyle={{ borderRadius: 'var(--radius-md)', border: 'none', boxShadow: 'var(--shadow-md)' }} />
                      <Bar dataKey="known" stackId="a" fill="#2ECC71" name="Known" radius={[0, 4, 4, 0]} />
                      <Bar dataKey="learning" stackId="a" fill="#F1C40F" name="Learning" radius={[0, 4, 4, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

      {/* Per-Language Statistics Section */}
      <h3 className="fw-bold mb-4 mt-5" style={{ color: 'var(--primary-color)' }}>Per-Language Activity</h3>
      <Row>
        {Object.values(uniqueLanguages).map(lang => (
          <Col md={4} key={lang.languageId} className="mb-4">
            <Card className="border-0 shadow-sm h-100 transition-all hover-elevate" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
              <Card.Header className="bg-transparent border-0 pt-4 pb-0">
                <h5 className="fw-bold mb-0">{lang.languageName}</h5>
              </Card.Header>
              <Card.Body>
                <div className="d-flex justify-content-between mb-2">
                  <span className="text-muted small">Words Known</span>
                  <span className="fw-bold text-success">{lang.knownWords.toLocaleString()}</span>
                </div>
                <div className="d-flex justify-content-between mb-2">
                  <span className="text-muted small">Words Reading</span>
                  <span className="fw-bold text-warning">{lang.learningWords.toLocaleString()}</span>
                </div>
                <div className="d-flex justify-content-between mb-3">
                  <span className="text-muted small">Listening Time</span>
                  <span className="fw-bold text-primary">{formatDuration(activityPeriod === 'all' ? lang.totalSecondsListened : lang.periodSecondsListened)}</span>
                </div>

                <hr className="opacity-10" />

                <div className="d-flex justify-content-between align-items-center mt-3">
                  <div>
                    <div className="small text-muted mb-1">Books Completed</div>
                    <div className="fw-bold" style={{ color: 'var(--primary-color)' }}>{lang.finishedBookCount} / {lang.bookCount}</div>
                  </div>
                  <div style={{ width: '60px', height: '60px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={[
                            { name: 'Known', value: lang.knownWords },
                            { name: 'Learning', value: lang.learningWords }
                          ]}
                          innerRadius={18}
                          outerRadius={25}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          <Cell fill="var(--accent-color)" />
                          <Cell fill="var(--color-warning)" />
                        </Pie>
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </Card.Body>
            </Card>
          </Col>
        ))}
      </Row>

      {/* Activity Tables Section */}
      <Row className="mt-5 g-4">
        {/* Reading Activity Table */}
        {readingActivityByDate.length > 0 && (
          <Col md={6}>
            <Card className="border-0 shadow-sm h-100" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
              <Card.Body>
                <Card.Title className="text-muted small text-uppercase fw-bold mb-4 ls-wide">Reading History</Card.Title>
                <div className="table-responsive">
                  <Table borderless hover size="sm" className="mb-0">
                    <thead className="text-muted small text-uppercase">
                      <tr>
                        <th className="border-bottom-0 pb-3">Date</th>
                        <th className="border-bottom-0 pb-3 text-end">Words Read</th>
                      </tr>
                    </thead>
                    <tbody>
                      {readingActivityByDate.slice(-10).reverse().map((item, index) => (
                        <tr key={index} className="align-middle">
                          <td className="py-2 text-muted">{formatDate(item.date)}</td>
                          <td className="py-2 text-end fw-bold">{item.wordsRead.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Card.Body>
            </Card>
          </Col>
        )}

        {/* Listening Activity Table */}
        {prepareListeningActivityByLanguageData().length > 0 && (
          <Col md={6}>
            <Card className="border-0 shadow-sm h-100" style={{ borderRadius: 'var(--radius-lg)', background: 'rgba(255, 255, 255, 0.7)', backdropFilter: 'blur(10px)' }}>
              <Card.Body>
                <Card.Title className="text-muted small text-uppercase fw-bold mb-4 ls-wide">Listening by Language</Card.Title>
                <div className="table-responsive">
                  <Table borderless hover size="sm" className="mb-0">
                    <thead className="text-muted small text-uppercase">
                      <tr>
                        <th className="border-bottom-0 pb-3">Language</th>
                        <th className="border-bottom-0 pb-3 text-end">Total Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {prepareListeningActivityByLanguageData().map((item, index) => (
                        <tr key={index} className="align-middle">
                          <td className="py-2 text-muted">{item.language}</td>
                          <td className="py-2 text-end fw-bold">{formatDuration(item.minutesListened * 60)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </Card.Body>
            </Card>
          </Col>
        )}
      </Row>

      {/* Render the Manual Entry Modal */}
      <ManualEntryModal
        show={showManualEntryModal}
        onHide={() => setShowManualEntryModal(false)}
        onSubmitSuccess={handleManualSubmitSuccess}
      />

    </Container>
  );
};

export default Statistics;