import React from 'react';
import { Card, ProgressBar } from 'react-bootstrap';

type Direction = 'up' | 'down' | 'flat';

const directionTone: Record<Direction, string> = {
  up: 'success',
  down: 'danger',
  flat: 'secondary'
};

const directionGlyph: Record<Direction, string> = {
  up: '▲',
  down: '▼',
  flat: '—'
};

interface StatCardDelta {
  direction: Direction | string;
  pct: number;
  label?: string;
}

interface StatCardProps {
  title: React.ReactNode;
  value: React.ReactNode;
  detail?: React.ReactNode;
  tone?: string;
  progress?: number | null;
  delta?: StatCardDelta | null;
}

const StatCard = ({ title, value, detail, tone = 'primary', progress = null, delta = null }: StatCardProps) => (
  <Card className="stats-card h-100 shadow-sm">
    <Card.Body className="d-flex flex-column justify-content-center text-center">
      <Card.Title className="stats-eyebrow">{title}</Card.Title>
      <div className={`stats-card-value text-${tone}`}>{value}</div>
      {progress !== null && (
        <ProgressBar now={progress} variant={tone} className="stats-card-progress mt-2" />
      )}
      {delta && (
        <div className={`stats-card-delta text-${directionTone[delta.direction as Direction] || 'secondary'} small mt-2`}>
          <span aria-hidden="true">{directionGlyph[delta.direction as Direction] || ''}</span>{' '}
          <span>{delta.pct > 0 ? '+' : ''}{delta.pct}%</span>
          {delta.label && <span className="text-muted ms-1">{delta.label}</span>}
        </div>
      )}
      {detail && <div className="small text-muted mt-2 fw-medium">{detail}</div>}
    </Card.Body>
  </Card>
);

export default StatCard;
