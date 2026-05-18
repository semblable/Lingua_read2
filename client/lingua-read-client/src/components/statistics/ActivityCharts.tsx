import React, { useMemo, useState } from 'react';
import { Button, ButtonGroup, Card, Col, Row, Spinner } from 'react-bootstrap';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { toCumulative } from '../../utils/statistics';
import type {
  KnownWordsActivity,
  ListeningActivity,
  ReadingActivity,
  DisplayStats,
  LanguageStatsRow
} from '../../utils/statistics';

const EmptyChart = ({ children }: { children: React.ReactNode }) => (
  <div className="stats-empty-chart text-muted">{children}</div>
);

const ChartCard = ({ title, summary, children }: { title: React.ReactNode; summary?: React.ReactNode; children: React.ReactNode }) => (
  <Card className="stats-card h-100 shadow-sm">
    <Card.Body>
      <Card.Title className="stats-eyebrow mb-2">{title}</Card.Title>
      {summary && <div className="small text-muted mb-3">{summary}</div>}
      <div className="stats-chart">{children}</div>
    </Card.Body>
  </Card>
);

// Row shape used across reading/listening/known-words activity series. The
// input variants carry one of wordsRead/minutesListened/knownWords; the
// comparison output adds dynamic previous-* keys (hence the index signature).
type AnyActivityRow = {
  date?: string;
  label?: string;
  wordsRead?: number | null;
  minutesListened?: number | null;
  knownWords?: number | null;
  [key: string]: string | number | null | undefined;
};

const buildComparisonSeries = (
  current: AnyActivityRow[],
  previous: AnyActivityRow[],
  currentKey: string,
  previousKey: string
): AnyActivityRow[] => {
  const cur = Array.isArray(current) ? current : [];
  const prev = Array.isArray(previous) ? previous : [];
  const length = Math.max(cur.length, prev.length);
  const series: AnyActivityRow[] = [];
  for (let i = 0; i < length; i += 1) {
    const c = cur[i];
    const p = prev[i];
    series.push({
      label: c?.date || p?.date || `Day ${i + 1}`,
      [currentKey]: c ? c[currentKey] ?? c.wordsRead ?? c.minutesListened ?? c.knownWords ?? 0 : null,
      [previousKey]: p ? p[currentKey] ?? p.wordsRead ?? p.minutesListened ?? p.knownWords ?? 0 : null
    });
  }
  return series;
};

interface ActivityChartsProps {
  displayStats: DisplayStats | null;
  readingActivity: ReadingActivity;
  listeningActivity: ListeningActivity;
  knownWordsActivity: KnownWordsActivity;
  previousReadingActivity?: ReadingActivity | null;
  previousListeningActivity?: ListeningActivity | null;
  previousKnownWordsActivity?: KnownWordsActivity | null;
  languages: LanguageStatsRow[];
  loadingActivity: boolean;
  showComparison: boolean;
}

const ActivityCharts = ({
  displayStats,
  readingActivity,
  listeningActivity,
  knownWordsActivity,
  previousReadingActivity,
  previousListeningActivity,
  previousKnownWordsActivity,
  languages,
  loadingActivity,
  showComparison
}: ActivityChartsProps) => {
  const [chartMode, setChartMode] = useState('daily');
  const isCumulative = chartMode === 'cumulative';

  const readingByDate = useMemo(
    () => readingActivity.activityByDate || [],
    [readingActivity]
  );
  const listeningByDate = useMemo(
    () => listeningActivity.listeningByDate || [],
    [listeningActivity]
  );
  const knownWordsByDate = useMemo(
    () => knownWordsActivity?.knownWordsByDate || [],
    [knownWordsActivity]
  );
  const prevReadingByDate = useMemo(
    () => previousReadingActivity?.activityByDate || [],
    [previousReadingActivity]
  );
  const prevListeningByDate = useMemo(
    () => previousListeningActivity?.listeningByDate || [],
    [previousListeningActivity]
  );
  const prevKnownWordsByDate = useMemo(
    () => previousKnownWordsActivity?.knownWordsByDate || [],
    [previousKnownWordsActivity]
  );

  const hasReadingComparison = showComparison && prevReadingByDate.length > 0;
  const hasListeningComparison = showComparison && prevListeningByDate.length > 0;
  const hasKnownWordsComparison = showComparison && prevKnownWordsByDate.length > 0;

  const cumulate = (series: AnyActivityRow[], key: string): AnyActivityRow[] =>
    (isCumulative ? toCumulative(series, key) : series);

  const readingSeries = useMemo(() => {
    const cur = cumulate(readingByDate, 'wordsRead');
    if (!hasReadingComparison) return cur;
    const prev = cumulate(prevReadingByDate, 'wordsRead');
    return buildComparisonSeries(cur, prev, 'wordsRead', 'previousWordsRead');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasReadingComparison, readingByDate, prevReadingByDate, isCumulative]);

  const listeningSeries = useMemo(() => {
    const cur = cumulate(listeningByDate, 'minutesListened');
    if (!hasListeningComparison) return cur;
    const prev = cumulate(prevListeningByDate, 'minutesListened');
    return buildComparisonSeries(cur, prev, 'minutesListened', 'previousMinutesListened');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasListeningComparison, listeningByDate, prevListeningByDate, isCumulative]);

  const knownWordsSeries = useMemo(() => {
    const cur = cumulate(knownWordsByDate, 'knownWords');
    if (!hasKnownWordsComparison) return cur;
    const prev = cumulate(prevKnownWordsByDate, 'knownWords');
    return buildComparisonSeries(cur, prev, 'knownWords', 'previousKnownWords');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasKnownWordsComparison, knownWordsByDate, prevKnownWordsByDate, isCumulative]);

  const languageVocabulary = languages.map((language: LanguageStatsRow) => ({
    name: language.languageName,
    known: language.knownWords,
    learning: language.learningWords
  }));

  const readingXKey = hasReadingComparison ? 'label' : 'date';
  const listeningXKey = hasListeningComparison ? 'label' : 'date';
  const knownWordsXKey = hasKnownWordsComparison ? 'label' : 'date';

  const readingSummary = isCumulative
    ? (hasReadingComparison ? 'Running total — current vs previous period' : 'Running total of words read')
    : (hasReadingComparison ? 'Current vs previous period' : 'Daily reading activity for the selected period');

  const listeningSummary = isCumulative
    ? (hasListeningComparison ? 'Running total — current vs previous period' : 'Running total of minutes listened')
    : (hasListeningComparison ? 'Current vs previous period' : 'Daily listening minutes for the selected period');

  const knownWordsSummary = isCumulative
    ? (hasKnownWordsComparison ? 'Running total of known words (by first-encounter date)' : 'Running total of known words (by first-encounter date)')
    : (hasKnownWordsComparison ? 'Words first encountered each day that are now known' : 'Words first encountered each day that are now known');

  const renderListeningChart = () => {
    if (loadingActivity) return <EmptyChart><Spinner animation="border" size="sm" /></EmptyChart>;
    if (!listeningSeries.length) return <EmptyChart>No listening activity in this period.</EmptyChart>;

    if (isCumulative) {
      return (
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={listeningSeries}>
            <defs>
              <linearGradient id="statsListening" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#1ABC9C" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#1ABC9C" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="statsListeningPrev" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#95A5A6" stopOpacity={0.2} />
                <stop offset="95%" stopColor="#95A5A6" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey={listeningXKey} tick={{ fontSize: 10 }} />
            <YAxis tick={{ fontSize: 10 }} />
            <Tooltip />
            {hasListeningComparison && <Legend />}
            {hasListeningComparison && (
              <Area
                type="monotone"
                dataKey="previousMinutesListened"
                name="Previous period"
                stroke="#95A5A6"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                fill="url(#statsListeningPrev)"
              />
            )}
            <Area
              type="monotone"
              dataKey="minutesListened"
              name="Minutes listened"
              stroke="#1ABC9C"
              strokeWidth={2}
              fill="url(#statsListening)"
            />
          </AreaChart>
        </ResponsiveContainer>
      );
    }

    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={listeningSeries}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey={listeningXKey} tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} />
          <Tooltip />
          {hasListeningComparison && <Legend />}
          {hasListeningComparison && (
            <Bar
              dataKey="previousMinutesListened"
              name="Previous period"
              fill="#BDC3C7"
              radius={[4, 4, 0, 0]}
            />
          )}
          <Bar
            dataKey="minutesListened"
            name="Minutes listened"
            fill="#1ABC9C"
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    );
  };

  return (
    <>
      <Row className="mb-3 align-items-center g-2">
        <Col xs="auto">
          <ButtonGroup size="sm" aria-label="Chart mode">
            <Button
              variant={isCumulative ? 'outline-primary' : 'primary'}
              onClick={() => setChartMode('daily')}
            >
              Daily
            </Button>
            <Button
              variant={isCumulative ? 'primary' : 'outline-primary'}
              onClick={() => setChartMode('cumulative')}
            >
              Cumulative
            </Button>
          </ButtonGroup>
        </Col>
        {isCumulative && (
          <Col className="small text-muted">
            Running totals across the selected period. Words known curve uses first-encounter dates.
          </Col>
        )}
      </Row>

      <Row className="mb-4 g-4">
        <Col lg={4}>
          <ChartCard
            title={isCumulative ? 'Cumulative Words Known' : 'Words Known Over Time'}
            summary={knownWordsSummary}
          >
            {loadingActivity ? (
              <EmptyChart><Spinner animation="border" size="sm" /></EmptyChart>
            ) : knownWordsSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={knownWordsSeries}>
                  <defs>
                    <linearGradient id="statsKnownWords" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#2ECC71" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#2ECC71" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="statsKnownWordsPrev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#95A5A6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#95A5A6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey={knownWordsXKey} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  {hasKnownWordsComparison && <Legend />}
                  {hasKnownWordsComparison && (
                    <Area
                      type="monotone"
                      dataKey="previousKnownWords"
                      name="Previous period"
                      stroke="#95A5A6"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      fill="url(#statsKnownWordsPrev)"
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="knownWords"
                    name="Known words"
                    stroke="#2ECC71"
                    strokeWidth={2}
                    fill="url(#statsKnownWords)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>No known-word activity in this period.</EmptyChart>
            )}
          </ChartCard>
        </Col>

        <Col lg={4}>
          <ChartCard
            title={isCumulative ? 'Cumulative Words Read' : 'Words Read Over Time'}
            summary={readingSummary}
          >
            {loadingActivity ? (
              <EmptyChart><Spinner animation="border" size="sm" /></EmptyChart>
            ) : readingSeries.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={readingSeries}>
                  <defs>
                    <linearGradient id="statsWordsRead" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3498DB" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3498DB" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="statsWordsReadPrev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#95A5A6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#95A5A6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey={readingXKey} tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
                  {hasReadingComparison && <Legend />}
                  {hasReadingComparison && (
                    <Area
                      type="monotone"
                      dataKey="previousWordsRead"
                      name="Previous period"
                      stroke="#95A5A6"
                      strokeWidth={1.5}
                      strokeDasharray="4 3"
                      fill="url(#statsWordsReadPrev)"
                    />
                  )}
                  <Area
                    type="monotone"
                    dataKey="wordsRead"
                    name="Words read"
                    stroke="#3498DB"
                    strokeWidth={2}
                    fill="url(#statsWordsRead)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>No reading activity in this period.</EmptyChart>
            )}
          </ChartCard>
        </Col>

        <Col lg={4}>
          <ChartCard
            title={isCumulative ? 'Cumulative Listening' : 'Listening Over Time'}
            summary={listeningSummary}
          >
            {renderListeningChart()}
          </ChartCard>
        </Col>
      </Row>

      {languageVocabulary.length > 1 && (
        <Row className="mb-4">
          <Col>
            <ChartCard title="Vocabulary by Language" summary="Known and learning words by language">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={languageVocabulary} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 12 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="known" stackId="vocab" fill="#2ECC71" name="Known" />
                  <Bar dataKey="learning" stackId="vocab" fill="#F1C40F" name="Learning" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </Col>
        </Row>
      )}
    </>
  );
};

export default ActivityCharts;
