import React, { useState } from 'react';
import { Button, Card, Form, Spinner } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

interface SrsDueWidgetProps {
  count?: number;
  loading?: boolean;
  unavailable?: boolean;
}

const SrsDueWidget: React.FC<SrsDueWidgetProps> = ({ count = 0, loading, unavailable }) => {
  const [sessionSize, setSessionSize] = useState(50);
  const target = Math.min(count, sessionSize);
  return (
    <Card className="home-review-card h-100" data-testid="srs-due-widget">
      <Card.Body>
        <div className="home-section-label"><i className="bi bi-layers" aria-hidden="true" /> Reviews</div>
        {loading ? <Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading reviews</span></Spinner> : unavailable ? (
          <><h2>Review count unavailable</h2><p className="text-muted">We couldn't load your review count.</p><LinkContainer to="/srs"><Button variant="outline-secondary">Open SRS</Button></LinkContainer></>
        ) : count > 0 ? (
          <>
            <h2>Cards due for review</h2>
            <p className="text-muted">Choose how many cards to review in this session.</p>
            <div className="home-review-due">{count.toLocaleString()} due</div>
            <LinkContainer to={{ pathname: '/srs', search: `?limit=${target}` }}>
              <Button variant="primary" className="home-review-start">Review {target} {target === 1 ? 'card' : 'cards'} <i className="bi bi-arrow-right" aria-hidden="true" /></Button>
            </LinkContainer>
            <div className="home-review-options">
              <Form.Label htmlFor="home-session-size">Session size</Form.Label>
              <Form.Select id="home-session-size" size="sm" value={sessionSize} onChange={e => setSessionSize(Number(e.target.value))}>
                {[10, 25, 50, 100, 200].map(size => <option key={size} value={size}>{size} cards</option>)}
              </Form.Select>
            </div>
          </>
        ) : (
          <><h2>No reviews due</h2><LinkContainer to="/srs"><Button variant="outline-secondary">Open SRS</Button></LinkContainer></>
        )}
      </Card.Body>
    </Card>
  );
};

export default SrsDueWidget;
