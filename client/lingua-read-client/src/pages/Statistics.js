import React, { useEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { Alert, Button, Container, Spinner } from 'react-bootstrap';
import { API_URL } from '../utils/api';
import ManualEntryModal from '../components/ManualEntryModal';
import ActivityCharts from '../components/statistics/ActivityCharts';
import ActivityTables from '../components/statistics/ActivityTables';
import LanguageStatsSection from '../components/statistics/LanguageStatsSection';
import StatsFilters from '../components/statistics/StatsFilters';
import StatsSummaryCards from '../components/statistics/StatsSummaryCards';
import {
  buildLanguageStats,
  getDisplayStats
} from '../utils/statistics';
import useStatisticsData from '../hooks/useStatisticsData';
import '../components/statistics/Statistics.css';

const Statistics = () => {
  const location = useLocation();
  const [selectedLanguage, setSelectedLanguage] = useState('all');
  const [activityPeriod, setActivityPeriod] = useState('all');
  const [initializingLanguages, setInitializingLanguages] = useState(false);
  const [showManualEntryModal, setShowManualEntryModal] = useState(false);
  const {
    stats,
    readingActivity,
    listeningActivity,
    loading,
    loadingActivity,
    error,
    networkStatus,
    refetchAll,
    refetchActivity
  } = useStatisticsData({ period: activityPeriod, languageId: selectedLanguage });

  useEffect(() => {
    if (location.state?.refreshStats) {
      refetchAll();
      window.history.replaceState({}, document.title);
    }
  }, [location.state, refetchAll]);

  const languages = useMemo(
    () => buildLanguageStats({
      stats,
      readingActivity,
      listeningActivity,
      period: activityPeriod
    }),
    [activityPeriod, listeningActivity, readingActivity, stats]
  );

  const displayStats = useMemo(
    () => getDisplayStats({ stats, languages, selectedLanguage }),
    [languages, selectedLanguage, stats]
  );

  const selectedLanguageName = selectedLanguage === 'all'
    ? 'All Languages'
    : languages.find((language) => String(language.languageId) === String(selectedLanguage))?.languageName || 'Selected Language';

  const handleInitializeLanguages = async () => {
    try {
      setInitializingLanguages(true);
      const response = await fetch(`${API_URL}/admin/initialize-languages`, {
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'X-Requested-With': 'XMLHttpRequest'
        }
      });

      if (!response.ok) {
        throw new Error('Failed to initialize languages');
      }

      refetchAll();
    } catch (err) {
      console.error('Error initializing languages:', err);
    } finally {
      setInitializingLanguages(false);
    }
  };

  const renderNetworkBanner = () => {
    if (networkStatus === 'connected') return null;

    if (networkStatus === 'error') {
      return (
        <Alert variant="danger" className="mb-4">
          <strong>Error:</strong> Unable to connect to server. Some features may be limited.
        </Alert>
      );
    }

    return (
      <Alert variant="info" className="mb-4">
        <strong>Connecting:</strong> Establishing connection to the server...
      </Alert>
    );
  };

  if (loading) {
    return (
      <Container className="mt-4">
        {renderNetworkBanner()}
        <div className="text-center py-5">
          <Spinner animation="border" />
          <p className="mt-3">Loading your statistics...</p>
        </div>
      </Container>
    );
  }

  return (
    <Container className="mt-4 pb-5">
      {renderNetworkBanner()}

      {error && (
        <Alert variant="danger" className="mb-4">
          <Alert.Heading>Error Loading Statistics</Alert.Heading>
          <p>{error}</p>
          <div className="d-flex justify-content-end">
            <Button variant="outline-danger" onClick={refetchAll}>
              Retry
            </Button>
          </div>
        </Alert>
      )}

      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap gap-3">
        <div>
          <h2 className="fw-bold mb-1">Statistics</h2>
          <div className="text-muted">{selectedLanguageName}</div>
        </div>
        <StatsFilters
          activityPeriod={activityPeriod}
          selectedLanguage={selectedLanguage}
          languages={languages}
          onPeriodChange={setActivityPeriod}
          onLanguageChange={setSelectedLanguage}
          onLogActivity={() => setShowManualEntryModal(true)}
        />
      </div>

      {languages.length === 0 && (
        <Alert variant="info" className="mb-4">
          <Alert.Heading>No Statistics Available</Alert.Heading>
          <p>Add a text or book in any language to start tracking your progress.</p>
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={handleInitializeLanguages}
            disabled={initializingLanguages}
          >
            {initializingLanguages ? <Spinner size="sm" /> : 'Initialize Languages'}
          </Button>
        </Alert>
      )}

      <StatsSummaryCards
        displayStats={displayStats}
        readingActivity={readingActivity}
        listeningActivity={listeningActivity}
        activityPeriod={activityPeriod}
        totalLanguages={languages.length}
      />

      <ActivityCharts
        displayStats={displayStats}
        readingActivity={readingActivity}
        listeningActivity={listeningActivity}
        languages={languages}
        loadingActivity={loadingActivity}
      />

      <LanguageStatsSection languages={languages} loadingActivity={loadingActivity} />

      <ActivityTables
        readingActivity={readingActivity}
        listeningActivity={listeningActivity}
      />

      <ManualEntryModal
        show={showManualEntryModal}
        onHide={() => setShowManualEntryModal(false)}
        onSubmitSuccess={refetchActivity}
      />
    </Container>
  );
};

export default Statistics;

