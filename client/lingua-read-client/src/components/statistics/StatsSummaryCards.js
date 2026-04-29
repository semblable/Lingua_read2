import React from 'react';
import { Col, Row } from 'react-bootstrap';
import StatCard from './StatCard';
import { formatDuration, periodDayCount } from '../../utils/statistics';

const StatsSummaryCards = ({ displayStats, readingActivity, listeningActivity, activityPeriod, totalLanguages }) => {
  const completionPercentage = displayStats.totalWords > 0
    ? Math.round((displayStats.knownWords / displayStats.totalWords) * 100)
    : 0;
  const days = periodDayCount(activityPeriod);
  const dailyAverage = days
    ? Math.round((readingActivity.totalWordsRead || 0) / days).toLocaleString()
    : '-';

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
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Time Listened"
            value={formatDuration(listeningActivity.totalListeningSeconds || 0)}
            detail="in selected period"
            tone="primary"
          />
        </Col>
        <Col sm={6} xl={3}>
          <StatCard
            title="Active Days"
            value={(readingActivity.activityByDate || []).length.toLocaleString()}
            detail="days with reading"
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

