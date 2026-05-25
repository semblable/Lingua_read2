import React, { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, Container, Row } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import {
  getDashboard,
  getGoals,
  getRecentTexts,
  getSrsStats,
} from '../utils/api';
import type { RecentTexts } from '../utils/api/texts';
import type { Goal } from '../utils/api/goals';
import type { SrsStats } from '../utils/api/srs';
import { useAuthStore } from '../utils/store';
import HomeHero from '../components/home/HomeHero';
import QuickStatsRow from '../components/home/QuickStatsRow';
import ContinueLearningCard from '../components/home/ContinueLearningCard';
import SrsDueWidget from '../components/home/SrsDueWidget';
import StreakChip from '../components/home/StreakChip';
import LanguagesStrip from '../components/home/LanguagesStrip';
import OnboardingHome from '../components/home/OnboardingHome';
import GoalsCard from '../components/goals/GoalsCard';
import ResumeAtLevelSection from '../components/dashboard/ResumeAtLevelSection';

// --- Helpers: tolerate camelCase / PascalCase from the API. ---

const pick = <T = unknown,>(obj: Record<string, unknown>, ...keys: string[]): T | undefined => {
  for (const k of keys) {
    if (obj[k] !== undefined) return obj[k] as T;
  }
  return undefined;
};

interface DashboardLang {
  languageId: number;
  languageName: string;
  knownWords: number;
  totalWords: number;
  cefrLevel: string | null;
  nextCefrLevel: string | null;
  knownWordsToNextLevel: number;
  bandProgressPercent: number;
  isCefrApproximate: boolean;
  todayWordsRead: number;
  todayListeningSeconds: number;
  currentReadingStreakDays: number;
  last14DaysWords: Array<{ date: string; count: number }>;
  continueReadingTextId: number | null;
  lastActivityAt: string | null;
}

const normaliseLang = (l: Record<string, unknown>): DashboardLang => ({
  languageId: pick<number>(l, 'languageId', 'LanguageId') ?? 0,
  languageName: pick<string>(l, 'languageName', 'LanguageName') || 'Unknown',
  knownWords: pick<number>(l, 'knownWords', 'KnownWords') || 0,
  totalWords: pick<number>(l, 'totalWords', 'TotalWords') || 0,
  cefrLevel: pick<string>(l, 'cefrLevel', 'CefrLevel') || null,
  nextCefrLevel: pick<string>(l, 'nextCefrLevel', 'NextCefrLevel') || null,
  knownWordsToNextLevel:
    pick<number>(l, 'knownWordsToNextLevel', 'KnownWordsToNextLevel') || 0,
  bandProgressPercent: pick<number>(l, 'bandProgressPercent', 'BandProgressPercent') || 0,
  isCefrApproximate: pick<boolean>(l, 'isCefrApproximate', 'IsCefrApproximate') || false,
  todayWordsRead: pick<number>(l, 'todayWordsRead', 'TodayWordsRead') || 0,
  todayListeningSeconds: pick<number>(l, 'todayListeningSeconds', 'TodayListeningSeconds') || 0,
  currentReadingStreakDays:
    pick<number>(l, 'currentReadingStreakDays', 'CurrentReadingStreakDays') || 0,
  last14DaysWords:
    (pick<Array<Record<string, unknown>>>(l, 'last14DaysWords', 'Last14DaysWords') ?? []).map(
      (d) => ({
        date: pick<string>(d, 'date', 'Date') ?? '',
        count: pick<number>(d, 'count', 'Count') || 0,
      }),
    ),
  continueReadingTextId: pick<number>(l, 'continueReadingTextId', 'ContinueReadingTextId') || null,
  lastActivityAt: pick<string>(l, 'lastActivityAt', 'LastActivityAt') || null,
});

interface DashboardData {
  totalKnownWords: number;
  totalWordsReadWeek: number;
  totalListeningSecondsWeek: number;
  totalLanguages: number;
  languages: DashboardLang[];
}

const normaliseDashboard = (raw: Record<string, unknown>): DashboardData => {
  const languages = (
    pick<Array<Record<string, unknown>>>(raw, 'languages', 'Languages') ?? []
  ).map(normaliseLang);
  return {
    totalKnownWords: pick<number>(raw, 'totalKnownWords', 'TotalKnownWords') || 0,
    totalWordsReadWeek: pick<number>(raw, 'totalWordsReadWeek', 'TotalWordsReadWeek') || 0,
    totalListeningSecondsWeek:
      pick<number>(raw, 'totalListeningSecondsWeek', 'TotalListeningSecondsWeek') || 0,
    totalLanguages: pick<number>(raw, 'totalLanguages', 'TotalLanguages') || languages.length,
    languages,
  };
};

// Derive a short, plain-English summary of the most urgent goal for the hero.
const buildTopGoalSummary = (goals: Goal[]): string | null => {
  if (!goals || goals.length === 0) return null;
  // GoalsCard already implements urgency-aware sorting; mirror just enough
  // of it here to surface the single most-pressing goal in the hero strip.
  const sorted = [...goals].sort((a, b) => {
    if (a.state === 'overdue' && b.state !== 'overdue') return -1;
    if (b.state === 'overdue' && a.state !== 'overdue') return 1;
    if (a.deadline && b.deadline) return a.deadline.localeCompare(b.deadline);
    if (a.deadline) return -1;
    if (b.deadline) return 1;
    return (b.percentComplete || 0) - (a.percentComplete || 0);
  });
  const top = sorted[0];
  if (!top) return null;
  const remaining = top.remainingToTarget;
  const lang = top.languageName ? ` ${top.languageName}` : '';
  const title = (top.title && top.title.trim()) || `${lang.trim()} goal`;
  if (top.state === 'overdue') return `Goal "${title}" is overdue`;
  if (remaining != null && Number(remaining) > 0) {
    return `${Number(remaining).toLocaleString()} to go on "${title}"`;
  }
  if (top.percentComplete != null) {
    return `"${title}" ${Math.round(top.percentComplete)}% complete`;
  }
  return null;
};

const Home: React.FC = () => {
  const { user } = useAuthStore();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [recentTexts, setRecentTexts] = useState<RecentTexts | null>(null);
  const [srsStats, setSrsStats] = useState<SrsStats | null>(null);
  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasFatalError, setHasFatalError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const tz = -new Date().getTimezoneOffset();

    setLoading(true);
    setHasFatalError(false);

    Promise.allSettled([
      getDashboard(tz) as Promise<Record<string, unknown>>,
      getRecentTexts(),
      getSrsStats(null),
      getGoals('active') as unknown as Promise<Goal[]>,
    ])
      .then(([dashRes, recentRes, srsRes, goalsRes]) => {
        if (cancelled) return;

        if (dashRes.status === 'fulfilled' && dashRes.value) {
          setDashboard(normaliseDashboard(dashRes.value));
        } else if (dashRes.status === 'rejected') {
          console.error('Home: getDashboard failed', dashRes.reason);
        }

        if (recentRes.status === 'fulfilled') {
          setRecentTexts(recentRes.value ?? []);
        } else {
          console.error('Home: getRecentTexts failed', recentRes.reason);
          setRecentTexts([]);
        }

        if (srsRes.status === 'fulfilled') {
          setSrsStats(srsRes.value ?? null);
        } else {
          console.error('Home: getSrsStats failed', srsRes.reason);
        }

        if (goalsRes.status === 'fulfilled') {
          setGoals(Array.isArray(goalsRes.value) ? goalsRes.value : []);
        } else {
          console.error('Home: getGoals failed', goalsRes.reason);
          setGoals([]);
        }

        // Fatal only if EVERY request failed — otherwise render whatever loaded.
        if (
          dashRes.status === 'rejected' &&
          recentRes.status === 'rejected' &&
          srsRes.status === 'rejected' &&
          goalsRes.status === 'rejected'
        ) {
          setHasFatalError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const languages = useMemo(() => dashboard?.languages ?? [], [dashboard]);
  const recent = recentTexts ?? [];
  const isEmpty =
    !loading && languages.length === 0 && recent.length === 0;

  const streakDays = useMemo(() => {
    if (!languages.length) return 0;
    return languages.reduce(
      (max, lang) => Math.max(max, lang.currentReadingStreakDays || 0),
      0,
    );
  }, [languages]);

  const topGoalSummary = useMemo(() => buildTopGoalSummary(goals ?? []), [goals]);

  // Type-safe access to SrsStats (camelCase per OpenAPI).
  const srsDueCount = (srsStats as { dueCount?: number } | null)?.dueCount ?? 0;

  const firstText = recent.length > 0 ? recent[0] : null;
  const firstLanguageId = languages[0]?.languageId;

  if (isEmpty) {
    return <OnboardingHome username={user?.username} />;
  }

  return (
    <Container className="py-4">
      {hasFatalError && (
        <Alert variant="danger" className="mb-4">
          We couldn't load your home page. Please refresh — if this keeps happening, check that the
          server is reachable.
        </Alert>
      )}

      {/* 1. Hero greeting */}
      <HomeHero
        username={user?.username}
        srsDue={srsDueCount}
        topGoalSummary={topGoalSummary}
        streakDays={streakDays}
      />

      {/* 2. Quick stats row */}
      <QuickStatsRow
        totalKnownWords={dashboard?.totalKnownWords}
        totalWordsReadWeek={dashboard?.totalWordsReadWeek}
        totalListeningSecondsWeek={dashboard?.totalListeningSecondsWeek}
        loading={loading && !dashboard}
      />

      {/* 3. Today panel: continue + SRS + streak */}
      <Row className="g-3 mb-4">
        <Col xs={12} lg={8}>
          <ContinueLearningCard text={firstText} loading={loading && !recentTexts} />
        </Col>
        <Col xs={12} lg={4}>
          <SrsDueWidget count={srsDueCount} loading={loading && !srsStats} />
          <StreakChip days={streakDays} />
        </Col>
      </Row>

      {/* 4. Resume at your level (self-hides when empty) */}
      <ResumeAtLevelSection />

      {/* 5. Goals */}
      <GoalsCard defaultLanguageId={firstLanguageId} />

      {/* 6. Top-3 languages strip */}
      <LanguagesStrip languages={languages} maxVisible={3} />

      {/* 7. Quick-add footer */}
      <Card className="shadow-sm mb-2">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-center flex-wrap gap-2">
            <div>
              <div className="fw-semibold mb-1">Add new content</div>
              <div className="text-muted small">Import a book, paste a text, or upload audio.</div>
            </div>
            <div className="d-flex gap-2 flex-wrap">
              <LinkContainer to="/books/create">
                <Button variant="success" size="sm">Add book</Button>
              </LinkContainer>
              <LinkContainer to="/texts/create">
                <Button variant="primary" size="sm">Add text</Button>
              </LinkContainer>
              <LinkContainer to="/texts/create-audio">
                <Button variant="info" size="sm">Add audio</Button>
              </LinkContainer>
              <LinkContainer to="/dashboard">
                <Button variant="outline-secondary" size="sm">Open dashboard →</Button>
              </LinkContainer>
            </div>
          </div>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default Home;
