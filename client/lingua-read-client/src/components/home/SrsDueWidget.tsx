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
  const [planDays, setPlanDays] = useState(14);
  const target = Math.min(count, sessionSize);
  return (
    <Card className="home-review-card h-100" data-testid="srs-due-widget">
      <Card.Body>
        <div className="home-section-label"><i className="bi bi-layers" aria-hidden="true" /> A little review</div>
        {loading ? <Spinner animation="border" size="sm" role="status"><span className="visually-hidden">Loading reviews</span></Spinner> : unavailable ? (
          <><h2>Reviews will be back soon</h2><p className="text-muted">We couldn't load your review count.</p><LinkContainer to="/srs"><Button variant="outline-secondary">Open SRS</Button></LinkContainer></>
        ) : count > 0 ? (
          <>
            <h2>Small session.<br /> Steady progress.</h2>
            <p className="text-muted">A few minutes to keep familiar words fresh.</p>
            <div className="home-review-due">{count.toLocaleString()} due</div>
            <LinkContainer to={{ pathname: '/srs', search: `?limit=${target}` }}>
              <Button variant="primary" className="home-review-start">Review {target} {target === 1 ? 'card' : 'cards'} <span>· ~{Math.max(1, Math.round(target / 4))} min</span><i className="bi bi-arrow-right" aria-hidden="true" /></Button>
            </LinkContainer>
            <div className="home-review-options">
              <Form.Label htmlFor="home-session-size">Session size</Form.Label>
              <Form.Select id="home-session-size" size="sm" value={sessionSize} onChange={e => setSessionSize(Number(e.target.value))}>
                {[10, 25, 50, 100, 200].map(size => <option key={size} value={size}>{size} cards</option>)}
              </Form.Select>
            </div>
            <details className={`home-catchup ${count > 200 ? 'home-catchup-prominent' : ''}`}>
              <summary>Make a catch-up plan</summary>
              <div className="home-catchup-body">
                <p className="small text-muted">Take the queue at your own pace.</p>
                <Form.Label htmlFor="home-plan-days">Spread this queue over</Form.Label>
                <Form.Select id="home-plan-days" size="sm" value={planDays} onChange={e => setPlanDays(Number(e.target.value))}>
                  {[7, 14, 30, 60].map(days => <option key={days} value={days}>{days} days</option>)}
                </Form.Select>
                <p className="small mt-2 mb-1">Aim for about <strong>{Math.ceil(count / planDays).toLocaleString()} cards a day</strong>.</p>
                <p className="small text-muted mb-0">A pacing guide for the current queue. New reviews may arrive; due dates and daily limits stay as they are.</p>
              </div>
            </details>
          </>
        ) : (
          <><h2>All caught up</h2><p className="text-muted">No reviews due. A good moment for a new chapter.</p><LinkContainer to="/srs"><Button variant="outline-secondary">Open SRS</Button></LinkContainer></>
        )}
      </Card.Body>
    </Card>
  );
};

export default SrsDueWidget;
