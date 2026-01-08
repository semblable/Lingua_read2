import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Container, Row, Col, Card, Alert, Spinner, ProgressBar, Table, Form, Button } from 'react-bootstrap';
// import { useNavigate } from 'react-router-dom'; // Removed unused import
import { getUserStatistics, getReadingActivity, getListeningActivity } from '../utils/api';
import { formatDate } from '../utils/helpers';
import {
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  LineChart, Line, ResponsiveContainer
} from 'recharts';
import ManualEntryModal from '../components/ManualEntryModal'; // Import the modal component

// Custom colors for charts
const THEMED_CHART_COLORS = ['#1ABC9C', '#3498DB', '#F1C40F', '#E74C3C', '#9B59B6', '#2ECC71'];
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
        const healthUrl = new URL('/api/health', 'http://localhost:5000').toString();
        const response = await fetch(healthUrl, {
          mode: 'cors',
          headers: { 'Accept': 'application/json' }
        });

        if (response.ok) {
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

  // Helper function to safely calculate total words read
  const calculateTotalWordsRead = (statistics) => {
    if (!statistics) {
      console.log('No statistics provided to calculateTotalWordsRead');
      return 0;
    }

    console.log('Calculating total words read from:', statistics);

    // First check if we have TotalWordsRead directly on the statistics object
    if (statistics.TotalWordsRead || statistics.totalWordsRead) {
      const directTotal = statistics.TotalWordsRead || statistics.totalWordsRead;
      console.log(`Using direct TotalWordsRead value: ${directTotal}`);
      return directTotal;
    }

    // Try to get language statistics, handling different case possibilities
    let langStats = [];

    if (Array.isArray(statistics.LanguageStatistics)) {
      langStats = statistics.LanguageStatistics;
      console.log('Using LanguageStatistics array (PascalCase)');
    } else if (Array.isArray(statistics.languageStatistics)) {
      langStats = statistics.languageStatistics;
      console.log('Using languageStatistics array (camelCase)');
    } else {
      console.log('No language statistics array found, trying to convert from object if present');
      // Try to handle if it's an object instead of an array
      if (statistics.LanguageStatistics && typeof statistics.LanguageStatistics === 'object') {
        langStats = Object.values(statistics.LanguageStatistics);
        console.log('Converted LanguageStatistics object to array');
      } else if (statistics.languageStatistics && typeof statistics.languageStatistics === 'object') {
        langStats = Object.values(statistics.languageStatistics);
        console.log('Converted languageStatistics object to array');
      }
    }

    // Log for debugging
    console.log('Language statistics for total words calculation:', langStats);

    // Handle both camelCase and PascalCase property names
    try {
      const total = langStats.reduce((total, lang) => {
        if (!lang) {
          console.log('Found null/undefined language entry in array');
          return total;
        }

        // Check for both camelCase and PascalCase versions of the property
        const wordsRead = lang.TotalWordsRead ||
                        lang.totalWordsRead ||
                        0;

        console.log(`Language ${lang.LanguageName || lang.languageName || 'unknown'}: ${wordsRead} words read`);
        return total + wordsRead;
      }, 0);

      console.log(`Total words read calculated from language stats: ${total}`);
      return total;
    } catch (err) {
      console.error('Error calculating total words read:', err);
      return 0;
    }
  };

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      setError(''); // Reset any existing errors

      try {
        console.log('Starting statistics fetch in Statistics component...');
        const data = await getUserStatistics();

        // Debug output for the raw data
        console.log('Statistics data received in component:', data);

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
          console.log('Normalized language statistics:', data.LanguageStatistics);
          console.log('Total languages:', data.TotalLanguages || data.totalLanguages || 0);
          console.log('Total words read calculation:', calculateTotalWordsRead(data));
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
  const fetchReadingActivityData = async (period) => {
    setLoadingActivity(true);
    try {
      console.log(`Starting reading activity fetch for period: ${period}`);
      let data;
      if (period && period !== 'all') {
        const timezoneOffsetMinutes = new Date().getTimezoneOffset();
        data = await getReadingActivity(period, timezoneOffsetMinutes);
      } else {
        data = await getReadingActivity(period);
      }
      console.log('Reading activity data received:', data);

      if (!data) {
        console.error('No activity data returned from getReadingActivity');
        setReadingActivity({ TotalWordsRead: 0, ActivityByDate: {}, ActivityByLanguage: {} });
        return;
      }

      // Normalize data
      data.ActivityByDate = data.ActivityByDate || data.activityByDate || {};
      data.ActivityByLanguage = data.ActivityByLanguage || data.activityByLanguage || {};
      data.TotalWordsRead = data.TotalWordsRead || data.totalWordsRead || 0;
      console.log('Normalized reading activity data:', data);
      setReadingActivity(data);
    } catch (err) {
      console.error('Failed to load reading activity', err);
      setReadingActivity({ TotalWordsRead: 0, ActivityByDate: {}, ActivityByLanguage: {} });
    } finally {
      setLoadingActivity(false);
    }
  };

  const fetchListeningActivityData = async (period) => {
    setLoadingListeningActivity(true);
    try {
      console.log(`Starting listening activity fetch for period: ${period}`);
      // Pass timezone offset for all periods except 'all'
      const timezoneOffsetMinutes = period !== 'all' ? new Date().getTimezoneOffset() : null;
      const data = await getListeningActivity(period, timezoneOffsetMinutes);
      console.log('Raw listening activity data received:', data);

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
        console.log('Normalized listening activity data:', JSON.stringify(data));
        setListeningActivity(data);
      }
    } catch (err) {
      console.error('ERROR loading listening activity:', err);
      setListeningActivity({ TotalListeningSeconds: 0, ListeningByDate: {}, ListeningByLanguage: [] });
    } finally {
      setLoadingListeningActivity(false);
    }
  };

  // Fetch activity data on initial load and when period changes
  useEffect(() => {
    fetchReadingActivityData(activityPeriod);
    fetchListeningActivityData(activityPeriod);
  }, [activityPeriod]);

  // --- End Refactored Data Fetching ---


  // Re-fetch data when the page becomes visible again (keep existing logic)
  useEffect(() => {
    console.log('[Stats Visibility useEffect] Setting up visibility listener.'); // Log hook trigger
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        console.log('[Stats Visibility] Page became visible, triggering re-fetch...');
        // Re-trigger the fetch functions using the current activityPeriod
        fetchReadingActivityData(activityPeriod);
        fetchListeningActivityData(activityPeriod);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup listener on component unmount
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activityPeriod]); // Re-run if activityPeriod changes

  // Callback function for successful manual entry
  const handleManualSubmitSuccess = () => {
    console.log("Manual entry successful, refreshing activity data...");
    // Re-fetch data for the current period
    fetchReadingActivityData(activityPeriod);
    fetchListeningActivityData(activityPeriod);
    // Optionally, could also re-fetch general stats if manual entry affects them
    // fetchStats(); // Uncomment if needed
  };


  // Function to initialize languages if none exist (Original - Keep this one)
  const handleInitializeLanguages = async () => {
    try {
      setInitializingLanguages(true);

      // Call the admin endpoint to initialize languages
      const response = await fetch('http://localhost:5000/api/admin/initialize-languages', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`,
          'Accept': 'application/json'
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
   if (hours === 0 && minutes < 10) formatted += `${seconds}s`; // Only show seconds if duration is short

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

  // Safely calculate percentages
  const completionPercentage = stats.TotalWords > 0
    ? Math.round((stats.KnownWords / stats.TotalWords) * 100)
    : 0;

  // Get language statistics safely
  // Combine all language data sources to get a unique list of languages
  const allLanguageStats = [
      ...(Array.isArray(stats?.LanguageStatistics) ? stats.LanguageStatistics : []),
      ...(Array.isArray(stats?.languageStatistics) ? stats.languageStatistics : []),
      ...(Array.isArray(readingActivity?.ActivityByLanguage) ? readingActivity.ActivityByLanguage : []),
      ...(Array.isArray(listeningActivity?.ListeningByLanguage) ? listeningActivity.ListeningByLanguage : [])
  ];

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
  console.log('languagesArray', languagesArray);

  // Prepare data for activity charts
  const readingActivityByDate = prepareActivityByDateData();
  const listeningActivityByDate = prepareListeningActivityByDateData();


  return (
    <Container className="mt-4 pb-5"> {/* Added padding-bottom */}
      {renderNetworkBanner()}

      {/* Header Row */}
      <Row className="mb-4 align-items-center justify-content-between">
        <Col md="auto">
          <h2>Statistics</h2>
        </Col>
        <Col md="auto">
          <div className="d-flex align-items-center"> {/* Flex container for period select and button */}
            <Form.Group controlId="activityPeriodSelect" className="me-3"> {/* Add margin */}
              <Form.Label className="me-2 visually-hidden">Activity Period:</Form.Label> {/* Hide label visually */}
              <Form.Select
                style={{ width: 'auto' }}
                value={activityPeriod}
                onChange={(e) => setActivityPeriod(e.target.value)}
                aria-label="Select activity period"
              >
                <option value="last_day">Today</option>
                <option value="last_week">Last 7 Days</option>
                <option value="last_month">Last 30 Days</option>
                <option value="last_90">Last 90 Days</option>
                <option value="last_180">Last 180 Days</option>
                <option value="all">All Time</option>
              </Form.Select>
            </Form.Group>

            {/* Language Filter */}
            <Form.Group controlId="languageSelect" className="me-3">
              <Form.Label className="me-2 visually-hidden">Language:</Form.Label>
              <Form.Select
                style={{ width: 'auto' }}
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                disabled={languagesArray.length === 0} // Disable if no languages
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
            </Form.Group>

            {/* Add Manual Entry Button */}
            <Button variant="outline-primary" onClick={() => setShowManualEntryModal(true)}>
              Log Manual Activity
            </Button>
          </div>
        </Col>
      </Row>

      {/* General Stats Cards */}
      <Row className="mb-4">
        {/* Total Words Card */}
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title>Total Words Encountered</Card.Title>
              <Card.Text className="fs-2">{stats.TotalWords}</Card.Text>
            </Card.Body>
          </Card>
        </Col>

        {/* Known Words Card */}
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title>Known Words</Card.Title>
              <Card.Text className="fs-2">{stats.KnownWords}</Card.Text>
              <ProgressBar
                now={completionPercentage}
                label={`${completionPercentage}%`}
                variant="success"
              />
            </Card.Body>
          </Card>
        </Col>

        {/* Books Card */}
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title>Books</Card.Title>
              <Card.Text className="fs-2">{stats.TotalBooks}</Card.Text>
              <p>{stats.FinishedBooks} Finished</p>
            </Card.Body>
          </Card>
        </Col>

        {/* Languages Card */}
        <Col md={3}>
          <Card className="text-center h-100">
            <Card.Body>
              <Card.Title>Languages</Card.Title>
              <Card.Text className="fs-2">{totalLanguages}</Card.Text>
              {/* Add language initialization button if no languages */}
              {totalLanguages === 0 && (
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleInitializeLanguages}
                  disabled={initializingLanguages}
                >
                  {initializingLanguages ? <Spinner size="sm" /> : 'Initialize Languages'}
                </Button>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Activity Summary Cards */}
      <Row className="mb-4">
         {/* Total Words Read Card */}
         <Col md={6}>
           <Card className="text-center h-100">
             <Card.Body>
               <Card.Title>Total Words Read ({activityPeriod === 'all' ? 'All Time' : `Last ${activityPeriod.split('_')[1]} Days`})</Card.Title>
               {loadingActivity ? <Spinner animation="border" size="sm" /> : <Card.Text className="fs-2">{readingActivity?.TotalWordsRead ?? 0}</Card.Text>}
             </Card.Body>
           </Card>
         </Col>
         {/* Total Time Listened Card */}
         <Col md={6}>
           <Card className="text-center h-100">
             <Card.Body>
               <Card.Title>Total Time Listened ({activityPeriod === 'all' ? 'All Time' : `Last ${activityPeriod.split('_')[1]} Days`})</Card.Title>
               {loadingListeningActivity ? <Spinner animation="border" size="sm" /> : <Card.Text className="fs-2">{formatDuration(listeningActivity?.TotalListeningSeconds ?? 0)}</Card.Text>}
             </Card.Body>
           </Card>
         </Col>
      </Row>


      {/* Per-Language Statistics Section */}
      <h3 className="mt-5 mb-3">Statistics by Language</h3>
      {languagesArray.length > 0 ? (
        languagesArray.map(lang => (
          <Card key={lang.languageId} className="mb-4">
            <Card.Header as="h5">{lang.languageName}</Card.Header>
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
                  {loadingActivity ? <Spinner size="sm"/> : <p className="mb-0">Words Read: {activityPeriod === 'all' ? lang.totalWordsRead : lang.periodWordsRead}</p>}
                  {/* Add more reading stats if available */}
                </Col>

                {/* Listening Stats */}
                <Col md={4} className="mb-3">
                  <h6>Listening ({activityPeriod === 'all' ? 'All Time' : `Selected Period`})</h6>
                   {loadingListeningActivity ? <Spinner size="sm"/> : <p className="mb-0">Time Listened: {formatDuration(activityPeriod === 'all' ? lang.totalSecondsListened : lang.periodSecondsListened)}</p>}
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

      {/* Keep Activity Over Time Charts (Aggregated for now) */}
      <h3 className="mt-5 mb-3">Activity Over Time ({activityPeriod === 'all' ? 'All Time' : `Selected Period`})</h3>
       {/* Reading Activity Over Time Chart */}
       <Row className="mb-4">
         <Col>
           <Card>
             <Card.Body>
               <Card.Title>Words Read</Card.Title>
               {loadingActivity ? <Spinner animation="border" size="sm" /> : readingActivityByDate.length > 0 ? (
                 <ResponsiveContainer width="100%" height={300}>
                   <LineChart data={readingActivityByDate}>
                     <CartesianGrid strokeDasharray="3 3" />
                     <XAxis dataKey="date" />
                     <YAxis />
                     <Tooltip />
                     <Legend />
                     <Line type="monotone" dataKey="wordsRead" name="Words Read" stroke={THEMED_CHART_COLORS[1]} activeDot={{ r: 8 }} />
                   </LineChart>
                 </ResponsiveContainer>
               ) : (
                 <p>No reading activity data for this period.</p>
               )}
             </Card.Body>
           </Card>
         </Col>
       </Row>

       {/* Listening Activity Over Time Chart */}
       <Row className="mb-4">
         <Col>
           <Card>
             <Card.Body>
               <Card.Title>Minutes Listened</Card.Title>
               {loadingListeningActivity ? <Spinner animation="border" size="sm" /> : listeningActivityByDate.length > 0 ? (
                 <ResponsiveContainer width="100%" height={300}>
                   <LineChart data={listeningActivityByDate}>
                     <CartesianGrid strokeDasharray="3 3" />
                     <XAxis dataKey="date" />
                     <YAxis />
                     <Tooltip />
                     <Legend />
                     <Line type="monotone" dataKey="minutesListened" name="Minutes Listened" stroke={THEMED_CHART_COLORS[0]} activeDot={{ r: 8 }} />
                   </LineChart>
                 </ResponsiveContainer>
               ) : (
                 <p>No listening activity data for this period.</p>
               )}
             </Card.Body>
           </Card>
         </Col>
       </Row>

      {/* Reading Activity Table */}
      {readingActivityByDate.length > 0 && (
         <Row className="mt-4">
           <Col>
             <Card>
               <Card.Body>
                 <Card.Title>Reading Activity by Date ({activityPeriod === 'all' ? 'All Time' : `Last ${activityPeriod.split('_')[1]} Days`})</Card.Title>
                 <Table striped bordered hover responsive size="sm">
                   <thead>
                     <tr>
                       <th>Date</th>
                       <th>Words Read</th>
                     </tr>
                   </thead>
                   <tbody>{/* Ensure no whitespace */}
                     {readingActivityByDate.map((item, index) => (<tr key={index}><td>{formatDate(item.date)}</td><td>{item.wordsRead}</td></tr>
                     ))}
                   </tbody>
                 </Table>
               </Card.Body>
             </Card>
           </Col>
         </Row>
      )}

      {/* Listening Activity Table */}
      {prepareListeningActivityByLanguageData().length > 0 && (
        <Row className="mt-4">
          <Col>
            <Card>
              <Card.Body>
                <Card.Title>Listening Time by Language ({activityPeriod === 'all' ? 'All Time' : `Last ${activityPeriod.split('_')[1]} Days`})</Card.Title>
                 <Table striped bordered hover responsive size="sm">
                   <thead>
                     <tr>
                       <th>Language</th>
                       <th>Total Time Listened</th>
                     </tr>
                   </thead>
                   <tbody>{/* Ensure no whitespace */}
                     {prepareListeningActivityByLanguageData().map((item, index) => (<tr key={index}><td>{item.language}</td><td>{formatDuration(item.minutesListened * 60)}</td></tr>
                     ))}
                   </tbody>
                 </Table>
              </Card.Body>
            </Card>
          </Col>
        </Row>
      )}

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