import React from 'react';
import { Card, Col, Row, Spinner } from 'react-bootstrap';

interface QuickStatsRowProps {
  totalKnownWords?: number;
  totalWordsReadWeek?: number;
  totalListeningSecondsWeek?: number;
  loading?: boolean;
}

const formatMinutes = (seconds?: number): string => {
  if (!seconds) return '0 min';
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}h ${rest}m` : `${h}h`;
};

const StatCard: React.FC<{ label: string; value: React.ReactNode; loading?: boolean }> = ({
  label,
  value,
  loading,
}) => (
  <Card className="h-100 shadow-sm">
    <Card.Body>
      <div className="text-muted small text-uppercase fw-bold">{label}</div>
      <div className="display-6 fw-bold lh-1 mt-1">
        {loading ? <Spinner animation="border" size="sm" /> : value}
      </div>
    </Card.Body>
  </Card>
);

const QuickStatsRow: React.FC<QuickStatsRowProps> = ({
  totalKnownWords,
  totalWordsReadWeek,
  totalListeningSecondsWeek,
  loading,
}) => {
  return (
    <Row className="g-3 mb-4">
      <Col xs={12} md={4}>
        <StatCard
          label="Total Known Words"
          value={(totalKnownWords ?? 0).toLocaleString()}
          loading={loading}
        />
      </Col>
      <Col xs={12} md={4}>
        <StatCard
          label="Words Read (7d)"
          value={(totalWordsReadWeek ?? 0).toLocaleString()}
          loading={loading}
        />
      </Col>
      <Col xs={12} md={4}>
        <StatCard
          label="Listened (7d)"
          value={formatMinutes(totalListeningSecondsWeek)}
          loading={loading}
        />
      </Col>
    </Row>
  );
};

export default QuickStatsRow;
