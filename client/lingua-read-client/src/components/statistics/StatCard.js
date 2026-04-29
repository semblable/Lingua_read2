import React from 'react';
import { Card, ProgressBar } from 'react-bootstrap';

const StatCard = ({ title, value, detail, tone = 'primary', progress = null }) => (
  <Card className="stats-card h-100 shadow-sm">
    <Card.Body className="d-flex flex-column justify-content-center text-center">
      <Card.Title className="stats-eyebrow">{title}</Card.Title>
      <div className={`stats-card-value text-${tone}`}>{value}</div>
      {progress !== null && (
        <ProgressBar now={progress} variant={tone} className="stats-card-progress mt-2" />
      )}
      {detail && <div className="small text-muted mt-2 fw-medium">{detail}</div>}
    </Card.Body>
  </Card>
);

export default StatCard;

