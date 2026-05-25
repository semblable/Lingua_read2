import React from 'react';
import { Card } from 'react-bootstrap';

interface StreakChipProps {
  days?: number;
}

const StreakChip: React.FC<StreakChipProps> = ({ days = 0 }) => {
  const active = days > 0;
  return (
    <Card
      className="shadow-sm"
      data-testid="streak-chip"
      title={
        active
          ? 'Read in any language today to keep your streak.'
          : 'Read in any language today to start a streak.'
      }
      style={
        active
          ? { borderLeft: '4px solid var(--accent-color, #1ABC9C)' }
          : undefined
      }
    >
      <Card.Body>
        <div className="text-muted small text-uppercase fw-bold mb-1">Streak</div>
        <div
          className="display-6 fw-bold lh-1"
          style={active ? { color: 'var(--accent-color, #1ABC9C)' } : undefined}
        >
          {days}
        </div>
        <div className="text-muted small mt-1">
          {active
            ? `day${days === 1 ? '' : 's'} in a row`
            : 'Start a streak today'}
        </div>
      </Card.Body>
    </Card>
  );
};

export default StreakChip;
