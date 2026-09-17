import React from 'react';
import { Card, ProgressBar, Button } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import CefrBadge from './CefrBadge';
import Sparkline from './Sparkline';

const formatMinutes = (seconds: number | null | undefined): string => {
  if (!seconds) return '0 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
};

interface SparkDataPoint {
  date: string;
  count: number;
}

interface LanguageDashboardCardData {
  languageId: number;
  languageName: string;
  knownWords: number;
  totalWords: number;
  cefrLevel?: string | null;
  nextCefrLevel?: string | null;
  knownWordsToNextLevel: number;
  bandProgressPercent?: number;
  isCefrApproximate?: boolean;
  todayWordsRead: number;
  todayListeningSeconds?: number;
  currentReadingStreakDays: number;
  last14DaysWords?: SparkDataPoint[];
  continueReadingTextId?: number | null;
}

interface LanguageDashboardCardProps {
  lang: LanguageDashboardCardData;
}

const LanguageDashboardCard = ({ lang }: LanguageDashboardCardProps) => {
  const {
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

  const sparkData: SparkDataPoint[] = (last14DaysWords || []).map((d: SparkDataPoint) => ({
    date: d.date,
    count: d.count,
  }));
  const hasActivity = sparkData.some((d: SparkDataPoint) => d.count > 0);

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
            <Sparkline
              data={sparkData}
              ariaLabel={`${languageName}: words read over the last ${sparkData.length} days`}
            />
          ) : (
            <div className="text-muted small d-flex align-items-center h-100">
              No reading in the last 14 days
            </div>
          )}
        </div>

        <div className="mt-auto d-flex gap-2 flex-wrap">
          {continueReadingTextId ? (
            <LinkContainer to={`/texts/${continueReadingTextId}`}>
              <Button size="sm" variant="primary">Continue reading</Button>
            </LinkContainer>
          ) : (
            <LinkContainer to="/library">
              <Button size="sm" variant="outline-primary">Open library</Button>
            </LinkContainer>
          )}
          <LinkContainer to="/srs">
            <Button size="sm" variant="outline-secondary">Review SRS</Button>
          </LinkContainer>
        </div>
      </Card.Body>
    </Card>
  );
};

export default LanguageDashboardCard;
