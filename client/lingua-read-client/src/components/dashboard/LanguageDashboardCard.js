import React from 'react';
import { Card, ProgressBar, Button } from 'react-bootstrap';
import { Link } from 'react-router-dom';
import { ResponsiveContainer, AreaChart, Area, YAxis } from 'recharts';
import CefrBadge from './CefrBadge';

const formatMinutes = (seconds) => {
  if (!seconds) return '0 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
};

const LanguageDashboardCard = ({ lang }) => {
  const {
    languageId,
    languageName,
    knownWords,
    totalWords,
    cefrLevel,
    nextCefrLevel,
    knownWordsToNextLevel,
    bandProgressPercent,
    isCefrApproximate,
    todayWordsRead,
    todayListeningSeconds,
    currentReadingStreakDays,
    last14DaysWords,
    continueReadingTextId,
  } = lang;

  const bandProgress = Math.max(0, Math.min(100, bandProgressPercent || 0));

  const sparkData = (last14DaysWords || []).map((d) => ({
    date: d.date,
    count: d.count,
  }));
  const hasActivity = sparkData.some((d) => d.count > 0);

  return (
    <Card className="h-100 shadow-sm">
      <Card.Body className="d-flex flex-column">
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div>
            <Card.Title className="mb-0">{languageName}</Card.Title>
            <small className="text-muted">
              {totalWords.toLocaleString()} words encountered
            </small>
          </div>
          <div className="text-end">
            <CefrBadge level={cefrLevel} />
            {isCefrApproximate && (
              <div
                className="text-muted"
                style={{ fontSize: '0.7rem', lineHeight: 1 }}
                title="CEFR estimate uses fallback thresholds for this language"
              >
                approx.
              </div>
            )}
          </div>
        </div>

        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-end">
            <div>
              <div className="display-6 fw-bold lh-1">
                {knownWords.toLocaleString()}
              </div>
              <small className="text-muted">known words</small>
            </div>
            {nextCefrLevel && (
              <small className="text-muted text-end">
                {knownWordsToNextLevel.toLocaleString()} to {nextCefrLevel}
              </small>
            )}
          </div>
          <ProgressBar
            now={bandProgress}
            className="mt-2"
            style={{ height: 6 }}
            variant="primary"
          />
        </div>

        <div className="row small mb-3">
          <div className="col-4">
            <div className="text-muted">Today</div>
            <div className="fw-semibold">
              {todayWordsRead.toLocaleString()} w
            </div>
          </div>
          <div className="col-4">
            <div className="text-muted">Listened</div>
            <div className="fw-semibold">
              {formatMinutes(todayListeningSeconds)}
            </div>
          </div>
          <div className="col-4">
            <div className="text-muted">Streak</div>
            <div className="fw-semibold">
              {currentReadingStreakDays} {currentReadingStreakDays === 1 ? 'day' : 'days'}
            </div>
          </div>
        </div>

        <div style={{ height: 48 }} className="mb-3">
          {hasActivity ? (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={sparkData} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id={`spark-${languageId}`} x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3498DB" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#3498DB" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <YAxis hide domain={[0, 'dataMax']} />
                <Area
                  type="monotone"
                  dataKey="count"
                  stroke="#3498DB"
                  strokeWidth={1.5}
                  fill={`url(#spark-${languageId})`}
                />
              </AreaChart>
            </ResponsiveContainer>
          ) : (
            <div className="text-muted small d-flex align-items-center h-100">
              No reading in the last 14 days
            </div>
          )}
        </div>

        <div className="mt-auto d-flex gap-2 flex-wrap">
          {continueReadingTextId ? (
            <Button
              as={Link}
              to={`/texts/${continueReadingTextId}`}
              size="sm"
              variant="primary"
            >
              Continue reading
            </Button>
          ) : (
            <Button as={Link} to="/library" size="sm" variant="outline-primary">
              Open library
            </Button>
          )}
          <Button as={Link} to="/srs" size="sm" variant="outline-secondary">
            Review SRS
          </Button>
        </div>
      </Card.Body>
    </Card>
  );
};

export default LanguageDashboardCard;
