import React from 'react';
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

const ActivityCharts = ({
  displayStats,
  readingActivity,
  listeningActivity,
  languages,
  loadingActivity
}) => {
  const wordBreakdown = [
    { name: 'Known', value: displayStats.knownWords, fill: '#2ECC71' },
    { name: 'Learning', value: displayStats.learningWords, fill: '#F1C40F' }
  ].filter((item) => item.value > 0);
  const readingByDate = readingActivity.activityByDate || [];
  const listeningByDate = listeningActivity.listeningByDate || [];
  const languageVocabulary = languages.map((language) => ({
    name: language.languageName,
    known: language.knownWords,
    learning: language.learningWords
  }));

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
          <ChartCard title="Words Read Over Time" summary="Daily reading activity for the selected period">
            {loadingActivity ? (
              <EmptyChart><Spinner animation="border" size="sm" /></EmptyChart>
            ) : readingByDate.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={readingByDate}>
                  <defs>
                    <linearGradient id="statsWordsRead" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3498DB" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3498DB" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
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
          <ChartCard title="Listening Over Time" summary="Daily listening minutes for the selected period">
            {loadingActivity ? (
              <EmptyChart><Spinner animation="border" size="sm" /></EmptyChart>
            ) : listeningByDate.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={listeningByDate}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} />
                  <Tooltip />
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

