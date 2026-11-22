import React, { useState } from 'react';
import { Button, Card, Form, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

interface SrsDueWidgetProps {
  count?: number;
  learningToday?: number;
  reviewsToday?: number;
  newToday?: number;
  backlogNewCount?: number;
  deferredReviewsCount?: number;
  newCardsPausedByReviewLimit?: boolean;
  loading?: boolean;
  unavailable?: boolean;
}

const SrsDueWidget: React.FC<SrsDueWidgetProps> = ({
  count = 0,
  learningToday,
  reviewsToday,
  newToday,
  backlogNewCount,
  deferredReviewsCount,
  newCardsPausedByReviewLimit = false,
  loading,
  unavailable,
}) => {
  const [sessionSize, setSessionSize] = useState(50);
  const target = Math.min(count, sessionSize);
  const breakdownParts: string[] = [];
  if (learningToday != null && learningToday > 0) {
    breakdownParts.push(`${learningToday.toLocaleString()} learning`);
  }
  if (reviewsToday != null && reviewsToday > 0) {
    breakdownParts.push(`${reviewsToday.toLocaleString()} ${reviewsToday === 1 ? 'review' : 'reviews'} today`);
  }
  if (deferredReviewsCount != null && deferredReviewsCount > 0) {
    breakdownParts.push(`${deferredReviewsCount.toLocaleString()} more ${deferredReviewsCount === 1 ? 'review' : 'reviews'} queued`);
  }
  if (newToday != null && newToday > 0) {
    breakdownParts.push(`${newToday.toLocaleString()} new today`);
  }
  if (backlogNewCount != null && backlogNewCount > 0) {
    breakdownParts.push(`${backlogNewCount.toLocaleString()} saved for later`);
  }

  const zeroBacklogMessage = (() => {
    const deferred = deferredReviewsCount ?? 0;
    const saved = backlogNewCount ?? 0;
    if (deferred > 0 && saved > 0) {
      return `Today's limit is complete. ${deferred.toLocaleString()} more ${deferred === 1 ? 'review' : 'reviews'} and ${saved.toLocaleString()} saved ${saved === 1 ? 'word' : 'words'} wait for future sessions.`;
    }
    if (deferred > 0) {
      return `Daily review limit reached. ${deferred.toLocaleString()} more ${deferred === 1 ? 'review' : 'reviews'} waiting for tomorrow.`;
    }
    if (saved > 0) {
      return newCardsPausedByReviewLimit
        ? `New cards paused while reviews fill their deck limits. ${saved.toLocaleString()} saved ${saved === 1 ? 'word' : 'words'} waiting for future sessions.`
        : `${saved.toLocaleString()} saved ${saved === 1 ? 'word' : 'words'} waiting for future sessions.`;
    }
    return null;
  })();

  return (
    <Card className="home-review-card h-100" data-testid="srs-due-widget">
      <Card.Body>
        <div className="home-section-label"><i className="bi bi-layers" aria-hidden="true" /> Reviews</div>
        {loading ? <Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading reviews</span></Spinner> : unavailable ? (
          <><h2>Review count unavailable</h2><p className="text-muted">We couldn't load your review count.</p><LinkContainer to="/srs"><Button variant="outline-secondary">Open SRS</Button></LinkContainer></>
        ) : count > 0 ? (
          <>
            <h2>Cards due for review</h2>
            <p className="text-muted">Choose a session size, then select a language.</p>
            <div className="home-review-due">{count.toLocaleString()} due</div>
            {breakdownParts.length > 0 && (
              <div className="home-review-breakdown" data-testid="srs-due-breakdown">
                {breakdownParts.join(' · ')}
              </div>
            )}
            {newCardsPausedByReviewLimit && (
              <div className="home-review-note" data-testid="srs-review-limit-note">
                Some decks have paused new cards while reviews fill their daily limits.
              </div>
            )}
            <LinkContainer to={{ pathname: '/srs', search: `?limit=${target}` }}>
              <Button variant="primary" className="home-review-start">Review up to {target} {target === 1 ? 'card' : 'cards'} <i className="bi bi-arrow-right" aria-hidden="true" /></Button>
            </LinkContainer>
            <div className="home-review-options">
              <Form.Label htmlFor="home-session-size">Session size</Form.Label>
              <Form.Select id="home-session-size" size="sm" value={sessionSize} onChange={e => setSessionSize(Number(e.target.value))}>
                {[10, 25, 50, 100, 200].map(size => <option key={size} value={size}>{size} cards</option>)}
              </Form.Select>
            </div>
          </>
        ) : (
          <>
            <h2>No reviews due</h2>
            {zeroBacklogMessage && (
              <p className="text-muted" data-testid="srs-due-backlog">{zeroBacklogMessage}</p>
            )}
            <LinkContainer to="/srs"><Button variant="outline-secondary">Open SRS</Button></LinkContainer>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default SrsDueWidget;
