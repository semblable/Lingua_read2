import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Card, Spinner, Alert, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { getDashboard } from '../utils/api';
import LanguageDashboardCard from '../components/dashboard/LanguageDashboardCard';

// Normalise keys from the API. The backend emits PascalCase camel-cased by
// System.Text.Json defaults (camelCase), but older endpoints in the codebase
// have historically been inconsistent, so tolerate both just in case.
const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k];
  }
  return undefined;
};

const normaliseLang = (l) => ({
  languageId: pick(l, 'languageId', 'LanguageId'),
  languageCode: pick(l, 'languageCode', 'LanguageCode') || '',
  languageName: pick(l, 'languageName', 'LanguageName') || 'Unknown',
  knownWords: pick(l, 'knownWords', 'KnownWords') || 0,
  totalWords: pick(l, 'totalWords', 'TotalWords') || 0,
  cefrLevel: pick(l, 'cefrLevel', 'CefrLevel') || 'A1',
  nextCefrLevel: pick(l, 'nextCefrLevel', 'NextCefrLevel') || null,
  knownWordsToNextLevel:
    pick(l, 'knownWordsToNextLevel', 'KnownWordsToNextLevel') || 0,
  todayWordsRead: pick(l, 'todayWordsRead', 'TodayWordsRead') || 0,
  todayListeningSeconds:
    pick(l, 'todayListeningSeconds', 'TodayListeningSeconds') || 0,
  weekWordsRead: pick(l, 'weekWordsRead', 'WeekWordsRead') || 0,
  weekListeningSeconds:
    pick(l, 'weekListeningSeconds', 'WeekListeningSeconds') || 0,
  currentReadingStreakDays:
    pick(l, 'currentReadingStreakDays', 'CurrentReadingStreakDays') || 0,
  last14DaysWords:
    (pick(l, 'last14DaysWords', 'Last14DaysWords') || []).map((d) => ({
      date: pick(d, 'date', 'Date'),
      count: pick(d, 'count', 'Count') || 0,
    })),
  continueReadingTextId:
    pick(l, 'continueReadingTextId', 'ContinueReadingTextId') || null,
  lastActivityAt: pick(l, 'lastActivityAt', 'LastActivityAt') || null,
});

const formatMinutes = (seconds) => {
  if (!seconds) return '0 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
};

const Dashboard = () => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const tz = -new Date().getTimezoneOffset();
        const raw = await getDashboard(tz);
        if (cancelled) return;
        const languages = (
          pick(raw, 'languages', 'Languages') || []
        ).map(normaliseLang);
        setData({
          totalKnownWords: pick(raw, 'totalKnownWords', 'TotalKnownWords') || 0,
          totalWordsReadWeek:
            pick(raw, 'totalWordsReadWeek', 'TotalWordsReadWeek') || 0,
          totalListeningSecondsWeek:
            pick(raw, 'totalListeningSecondsWeek', 'TotalListeningSecondsWeek') || 0,
          totalLanguages: pick(raw, 'totalLanguages', 'TotalLanguages') || languages.length,
          languages,
        });
      } catch (e) {
        if (!cancelled) setError('Failed to load dashboard. Please try again.');
        console.error('Dashboard fetch error:', e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" />
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-4">
        <Alert variant="danger">{error}</Alert>
      </Container>
    );
  }

  const languages = data?.languages || [];

  if (languages.length === 0) {
    return (
      <Container className="py-5">
        <Card className="shadow-sm">
          <Card.Body className="text-center py-5">
            <Card.Title>Your polyglot dashboard is empty</Card.Title>
            <Card.Text className="text-muted">
              Add a text or book in any language to start tracking your progress.
            </Card.Text>
            <div className="d-flex justify-content-center gap-2 flex-wrap">
              <Button as={Link} to="/texts/create" variant="primary">
                Add Text
              </Button>
              <Button as={Link} to="/books/create" variant="outline-primary">
                Add Book
              </Button>
              <Button as={Link} to="/library" variant="outline-secondary">
                Open Library
              </Button>
            </div>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <div className="d-flex justify-content-between align-items-end mb-4 flex-wrap gap-2">
        <div>
          <h2 className="mb-1">Polyglot Dashboard</h2>
          <div className="text-muted">
            {data.totalLanguages} language{data.totalLanguages === 1 ? '' : 's'} ·{' '}
            last 7 days
          </div>
        </div>
      </div>

      <Row className="mb-4 g-3">
        <Col md={4}>
          <Card className="h-100 shadow-sm">
            <Card.Body>
              <div className="text-muted small text-uppercase fw-bold">
                Total Known Words
              </div>
              <div className="display-5 fw-bold">
                {data.totalKnownWords.toLocaleString()}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card className="h-100 shadow-sm">
            <Card.Body>
              <div className="text-muted small text-uppercase fw-bold">
                Words Read (7d)
              </div>
              <div className="display-5 fw-bold">
                {data.totalWordsReadWeek.toLocaleString()}
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={4}>
          <Card className="h-100 shadow-sm">
            <Card.Body>
              <div className="text-muted small text-uppercase fw-bold">
                Listened (7d)
              </div>
              <div className="display-5 fw-bold">
                {formatMinutes(data.totalListeningSecondsWeek)}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      <Row className="g-3">
        {languages.map((lang) => (
          <Col key={lang.languageId} md={6} xl={4}>
            <LanguageDashboardCard lang={lang} />
          </Col>
        ))}
      </Row>
    </Container>
  );
};

export default Dashboard;
