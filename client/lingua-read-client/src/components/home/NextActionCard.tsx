import React from 'react';
import { Button, Card, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import { pickAction, type ActionVariant, type RecentText } from './nextAction';

export interface NextActionCardProps {
  srsDue: number;
  recentText: RecentText | null;
  lastActivityAt: string | null;
  loading?: boolean;
}

const variantColor = (variant: ActionVariant): string => {
  switch (variant) {
    case 'danger':
      return '#dc3545';
    case 'warning':
      return '#ffc107';
    case 'primary':
      return '#0d6efd';
    default:
      return '#6c757d';
  }
};

const NextActionCard: React.FC<NextActionCardProps> = ({
  srsDue,
  recentText,
  lastActivityAt,
  loading,
}) => {
  if (loading) {
    return (
      <Card className="shadow-sm mb-4" data-testid="next-action-card">
        <Card.Body
          className="d-flex align-items-center justify-content-center"
          style={{ minHeight: 120 }}
        >
          <Spinner animation="border" />
        </Card.Body>
      </Card>
    );
  }

  const action = pickAction(srsDue, recentText, lastActivityAt);
  const accent = variantColor(action.variant);

  return (
    <Card
      className="shadow-sm mb-4"
      data-testid="next-action-card"
      data-action-kind={action.kind}
      style={{ borderLeft: `4px solid var(--bs-${action.variant}, ${accent})` }}
    >
      <Card.Body className="d-flex flex-wrap gap-3 align-items-center justify-content-between">
        <div className="flex-grow-1" style={{ minWidth: 200 }}>
          <div className="text-muted small text-uppercase fw-bold mb-1">Next up</div>
          <div className="fw-bold" style={{ fontSize: '1.35rem', lineHeight: 1.25 }}>
            {action.title}
          </div>
          <div className="text-muted small mt-1">{action.subtitle}</div>
        </div>
        <LinkContainer to={action.ctaTo}>
          <Button variant={action.variant} size="lg">
            {action.ctaLabel}
          </Button>
        </LinkContainer>
      </Card.Body>
    </Card>
  );
};

export default NextActionCard;
