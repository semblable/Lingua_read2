import React from 'react';
import { Col, Row } from 'react-bootstrap';
import StatCard from './StatCard';
import {
  computeDelta,
  formatDuration,
  periodDayCount,
  previousPeriodLabel,
  supportsPreviousPeriod
} from '../../utils/statistics';
import type {
  ListeningActivity,
  ReadingActivity,
  DisplayStats
} from '../../utils/statistics';

interface DeltaShape {
  direction: 'up' | 'down' | 'flat';
  pct: number;
}

interface StatsSummaryCardsProps {
  displayStats: DisplayStats;
  readingActivity: ReadingActivity;
  listeningActivity: ListeningActivity;
  previousReadingActivity?: ReadingActivity | null;
  previousListeningActivity?: ListeningActivity | null;
  activityPeriod: string;
  totalLanguages: number;
}

const StatsSummaryCards = ({
  displayStats,
  readingActivity,
  listeningActivity,
  previousReadingActivity,
  previousListeningActivity,
  activityPeriod,
  totalLanguages
}: StatsSummaryCardsProps) => {
  const completionPercentage = displayStats.totalWords > 0
    ? Math.round((displayStats.knownWords / displayStats.totalWords) * 100)
    : 0;
  const days = periodDayCount(activityPeriod);
  const dailyAverage = days
    ? Math.round((readingActivity.totalWordsRead || 0) / days).toLocaleString()
    : '-';

  const showDeltas = supportsPreviousPeriod(activityPeriod);
  const deltaLabel = previousPeriodLabel(activityPeriod);

  const wordsReadDelta = showDeltas
    ? computeDelta(readingActivity.totalWordsRead || 0, previousReadingActivity?.totalWordsRead || 0)
    : null;
  const listeningDelta = showDeltas
    ? computeDelta(listeningActivity.totalListeningSeconds || 0, previousListeningActivity?.totalListeningSeconds || 0)
    : null;
  const activeDaysDelta = showDeltas
    ? computeDelta(
        (readingActivity.activityByDate || []).length,
        (previousReadingActivity?.activityByDate || []).length
      )
    : null;

  const withLabel = (delta: DeltaShape | null) => (delta ? { ...delta, label: deltaLabel } : null);

  return (
    <>
      <Row className="mb-4 g-3">
        <Col sm={6} xl={3}>
          <StatCard
            title="Encountered"
            value={displayStats.totalWords.toLocaleString()}
            detail="words seen"
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Known Words"
            value={displayStats.knownWords.toLocaleString()}
            detail={`${completionPercentage}% of encountered`}
            tone="success"
            progress={completionPercentage}
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Books"
            value={displayStats.totalBooks.toLocaleString()}
            detail={`${displayStats.finishedBooks.toLocaleString()} finished`}
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Languages"
            value={totalLanguages.toLocaleString()}
            detail="with activity"
            tone="info"
          />
        </Col>
      </Row>

      <Row className="mb-4 g-3">
        <Col sm={6} xl={3}>
          <StatCard
            title="Words Read"
            value={(readingActivity.totalWordsRead || 0).toLocaleString()}
            detail="in selected period"
            delta={withLabel(wordsReadDelta)}
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Time Listened"
            value={formatDuration(listeningActivity.totalListeningSeconds || 0)}
            detail="in selected period"
            tone="primary"
            delta={withLabel(listeningDelta)}
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Active Days"
            value={(readingActivity.activityByDate || []).length.toLocaleString()}
            detail="days with reading"
            delta={withLabel(activeDaysDelta)}
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Daily Avg"
            value={dailyAverage}
            detail="words / day"
            tone="secondary"
          />
        </Col>
      </Row>
    </>
  );
};

export default StatsSummaryCards;
