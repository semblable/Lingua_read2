import React from 'react';
import { Button, Card, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

interface SrsDueWidgetProps {
  count?: number;
  loading?: boolean;
}

const SrsDueWidget: React.FC<SrsDueWidgetProps> = ({ count = 0, loading }) => {
  const heavy = count > 10;
  const some = count > 0 && !heavy;
  const variant = heavy ? 'danger' : some ? 'warning' : 'outline-secondary';
  const borderStyle =
    count > 0
      ? {
          borderLeft: `4px solid var(--bs-${heavy ? 'danger' : 'warning'}, ${
            heavy ? '#dc3545' : '#ffc107'
          })`,
        }
      : undefined;

  return (
    <Card className="shadow-sm mb-3" data-testid="srs-due-widget" style={borderStyle}>
      <Card.Body>
        <div className="text-muted small text-uppercase fw-bold mb-1">SRS reviews</div>
        {loading ? (
          <Spinner animation="border" size="sm" />
        ) : count > 0 ? (
          <>
            <div className="display-6 fw-bold lh-1 mb-2">{count.toLocaleString()}</div>
            <div className="text-muted small mb-3">
              card{count === 1 ? '' : 's'} due for review
            </div>
            <LinkContainer to="/srs">
              <Button variant={variant} size="sm">
                Review {count === 1 ? 'card' : `${count} cards`} now
              </Button>
            </LinkContainer>
          </>
        ) : (
          <>
            <div className="fw-semibold mb-1">All caught up</div>
            <div className="text-muted small mb-3">No reviews due — check back tomorrow.</div>
            <LinkContainer to="/srs">
              <Button variant="outline-secondary" size="sm">
                Open SRS
              </Button>
            </LinkContainer>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default SrsDueWidget;
