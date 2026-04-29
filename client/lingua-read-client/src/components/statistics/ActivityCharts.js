import React, { useMemo } from 'react';
import { Card, Col, Row, Spinner } from 'react-bootstrap';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';

const EmptyChart = ({ children }) => (
  <div className="stats-empty-chart text-muted">{children}</div>
);

const ChartCard = ({ title, summary, children }) => (
  <Card className="stats-card h-100 shadow-sm">
    <Card.Body>
      <Card.Title className="stats-eyebrow mb-2">{title}</Card.Title>
      {summary && <div className="small text-muted mb-3">{summary}</div>}
      <div className="stats-chart">{children}</div>
    </Card.Body>
  </Card>
);

const buildComparisonSeries = (current, previous, currentKey, previousKey) => {
  const cur = Array.isArray(current) ? current : [];
  const prev = Array.isArray(previous) ? previous : [];
  const length = Math.max(cur.length, prev.length);
  const series = [];
  for (let i = 0; i < length; i += 1) {
    const c = cur[i];
    const p = prev[i];
    series.push({
      label: c?.date || p?.date || `Day ${i + 1}`,
      [currentKey]: c ? c[currentKey] ?? c.wordsRead ?? c.minutesListened ?? 0 : null,
      [previousKey]: p ? p[currentKey] ?? p.wordsRead ?? p.minutesListened ?? 0 : null
    });
  }
  return series;
};

const ActivityCharts = ({
  displayStats,
  readingActivity,
  listeningActivity,
  previousReadingActivity,
  previousListeningActivity,
  languages,
  loadingActivity,
  showComparison
}) => {
  const wordBreakdown = [
    { name: 'Known', value: displayStats.knownWords, fill: '#2ECC71' },
    { name: 'Learning', value: displayStats.learningWords, fill: '#F1C40F' }
  ].filter((item) => item.value > 0);

  const readingByDate = useMemo(
    () => readingActivity.activityByDate || [],
    [readingActivity]
  );
  const listeningByDate = useMemo(
    () => listeningActivity.listeningByDate || [],
    [listeningActivity]
  );
  const prevReadingByDate = useMemo(
    () => previousReadingActivity?.activityByDate || [],
    [previousReadingActivity]
  );
  const prevListeningByDate = useMemo(
    () => previousListeningActivity?.listeningByDate || [],
    [previousListeningActivity]
  );

  const hasReadingComparison = showComparison && prevReadingByDate.length > 0;
  const hasListeningComparison = showComparison && prevListeningByDate.length > 0;

  const readingSeries = useMemo(() => {
    if (!hasReadingComparison) return readingByDate;
    return buildComparisonSeries(readingByDate, prevReadingByDate, 'wordsRead', 'previousWordsRead');
  }, [hasReadingComparison, readingByDate, prevReadingByDate]);

  const listeningSeries = useMemo(() => {
    if (!hasListeningComparison) return listeningByDate;
    return buildComparisonSeries(listeningByDate, prevListeningByDate, 'minutesListened', 'previousMinutesListened');
  }, [hasListeningComparison, listeningByDate, prevListeningByDate]);

  const languageVocabulary = languages.map((language) => ({
    name: language.languageName,
    known: language.knownWords,
    learning: language.learningWords
  }));

  const readingXKey = hasReadingComparison ? 'label' : 'date';
  const listeningXKey = hasListeningComparison ? 'label' : 'date';

  return (
    <>
      <Row className="mb-4 g-4">
        <Col lg={4}>
          <ChartCard
            title="Word Breakdown"
            summary={`${displayStats.knownWords.toLocaleString()} known, ${displayStats.learningWords.toLocaleString()} learning`}
          >
            {wordBreakdown.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={wordBreakdown}
                    innerRadius={58}
                    outerRadius={88}
                    paddingAngle={5}
                    dataKey="value"
                    label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                    labelLine={false}
                  >
                    {wordBreakdown.map((entry) => (
                      <Cell key={entry.name} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart>No vocabulary data yet.</EmptyChart>
            )}
          </ChartCard>
        </Col>

        <Col lg={4}>
          <ChartCard
            title="Words Read Over Time"
            summary={hasReadingComparison ? 'Current vs previous period' : 'Daily reading activity for the selected period'}
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
            title="Listening Over Time"
            summary={hasListeningComparison ? 'Current vs previous period' : 'Daily listening minutes for the selected period'}
          >
            {loadingActivity ? (
              <EmptyChart><Spinner animation="border" size="sm" /></EmptyChart>
            ) : listeningSeries.length > 0 ? (
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
            ) : (
              <EmptyChart>No listening activity in this period.</EmptyChart>
            )}
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
