import React, { useEffect, useState } from 'react';
import { Container, Row, Col, Card, Spinner, Alert } from 'react-bootstrap';
import { getDashboard } from '../utils/api';
import LanguageDashboardCard from '../components/dashboard/LanguageDashboardCard';
import GoalsCard from '../components/goals/GoalsCard';
import ResumeAtLevelSection from '../components/dashboard/ResumeAtLevelSection';
import OnboardingHome from '../components/home/OnboardingHome';

// Normalise keys from the API. The backend emits PascalCase camel-cased by
// System.Text.Json defaults (camelCase), but older endpoints in the codebase
// have historically been inconsistent, so tolerate both just in case.
const pick = <T = unknown>(obj: Record<string, unknown>, ...keys: string[]): T | undefined => {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k] as T;
  }
  return undefined;
};

const normaliseLang = (l: Record<string, unknown>) => ({
  languageId: pick<number>(l, 'languageId', 'LanguageId') ?? 0,
  languageCode: pick<string>(l, 'languageCode', 'LanguageCode') || '',
  languageName: pick<string>(l, 'languageName', 'LanguageName') || 'Unknown',
  knownWords: pick<number>(l, 'knownWords', 'KnownWords') || 0,
  totalWords: pick<number>(l, 'totalWords', 'TotalWords') || 0,
  cefrLevel: pick<string>(l, 'cefrLevel', 'CefrLevel') || null,
  nextCefrLevel: pick<string>(l, 'nextCefrLevel', 'NextCefrLevel') || null,
  knownWordsToNextLevel:
    pick<number>(l, 'knownWordsToNextLevel', 'KnownWordsToNextLevel') || 0,
  bandProgressPercent:
    pick<number>(l, 'bandProgressPercent', 'BandProgressPercent') || 0,
  isCefrApproximate:
    pick<boolean>(l, 'isCefrApproximate', 'IsCefrApproximate') || false,
  todayWordsRead: pick<number>(l, 'todayWordsRead', 'TodayWordsRead') || 0,
  todayListeningSeconds:
    pick<number>(l, 'todayListeningSeconds', 'TodayListeningSeconds') || 0,
  weekWordsRead: pick<number>(l, 'weekWordsRead', 'WeekWordsRead') || 0,
  weekListeningSeconds:
    pick<number>(l, 'weekListeningSeconds', 'WeekListeningSeconds') || 0,
  currentReadingStreakDays:
    pick<number>(l, 'currentReadingStreakDays', 'CurrentReadingStreakDays') || 0,
  last14DaysWords:
    (pick<Array<Record<string, unknown>>>(l, 'last14DaysWords', 'Last14DaysWords') ?? []).map((d) => ({
      date: pick<string>(d, 'date', 'Date') ?? '',
      count: pick<number>(d, 'count', 'Count') || 0,
    })),
  continueReadingTextId:
    pick<number>(l, 'continueReadingTextId', 'ContinueReadingTextId') || null,
  lastActivityAt: pick<string>(l, 'lastActivityAt', 'LastActivityAt') || null,
});

const formatMinutes = (seconds: number | null | undefined): string => {
  if (!seconds) return '0 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
};

type DashboardLang = ReturnType<typeof normaliseLang>;
type DashboardData = {
  totalKnownWords: number;
  totalWordsReadWeek: number;
  totalListeningSecondsWeek: number;
  totalLanguages: number;
  languages: DashboardLang[];
};

const Dashboard = () => {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const tz = -new Date().getTimezoneOffset();
        const raw = (await getDashboard(tz)) as Record<string, unknown>;
        if (cancelled) return;
        const languages = (
          pick<Array<Record<string, unknown>>>(raw, 'languages', 'Languages') ?? []
        ).map(normaliseLang);
        setData({
          totalKnownWords: pick<number>(raw, 'totalKnownWords', 'TotalKnownWords') || 0,
          totalWordsReadWeek:
            pick<number>(raw, 'totalWordsReadWeek', 'TotalWordsReadWeek') || 0,
          totalListeningSecondsWeek:
            pick<number>(raw, 'totalListeningSecondsWeek', 'TotalListeningSecondsWeek') || 0,
          totalLanguages: pick<number>(raw, 'totalLanguages', 'TotalLanguages') || languages.length,
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

  if (!data) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" />
      </Container>
    );
  }

  const languages = data.languages || [];

  if (languages.length === 0) {
    return <OnboardingHome />;
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

      <GoalsCard defaultLanguageId={languages[0]?.languageId} />

      <ResumeAtLevelSection />

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
