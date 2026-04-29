import React from 'react';
import { Card, Col, ProgressBar, Row } from 'react-bootstrap';
import CefrBadge from '../dashboard/CefrBadge';

const renderCard = (language) => {
  const remaining = language.knownWordsToNextLevel || 0;
  const progress = Math.max(0, Math.min(100, language.bandProgressPercent || 0));

  return (
    <Col md={6} xl={4} key={language.languageId}>
      <Card className="stats-card h-100 shadow-sm">
        <Card.Body>
          <div className="d-flex justify-content-between align-items-start mb-2">
            <Card.Title className="stats-eyebrow mb-0">Next CEFR Milestone</Card.Title>
            <CefrBadge level={language.nextCefrLevel} />
          </div>
          <div className="fw-bold mb-1">{language.languageName}</div>
          <div className="small text-muted mb-2">
            {language.cefrLevel ? `${language.cefrLevel} → ${language.nextCefrLevel}` : `Working toward ${language.nextCefrLevel}`}
          </div>
          <ProgressBar now={progress} variant="info" className="stats-card-progress mb-2" />
          <div className="small text-muted">
            {remaining > 0
              ? `${remaining.toLocaleString()} known words to go`
              : 'Within reach — keep going!'}
          </div>
          {language.isCefrApproximate && (
            <div className="small text-muted mt-1">CEFR estimate uses fallback thresholds</div>
          )}
        </Card.Body>
      </Card>
    </Col>
  );
};

const MilestoneCards = ({ languages, selectedLanguage }) => {
  if (!Array.isArray(languages) || languages.length === 0) return null;

  if (selectedLanguage && selectedLanguage !== 'all') {
    const language = languages.find((l) => String(l.languageId) === String(selectedLanguage));
    if (!language || !language.nextCefrLevel) return null;
    return (
      <Row className="mb-4 g-3">
        {renderCard(language)}
      </Row>
    );
  }

  const candidates = languages
    .filter((l) => l.nextCefrLevel)
    .sort((a, b) => (b.bandProgressPercent || 0) - (a.bandProgressPercent || 0))
    .slice(0, 3);

  if (candidates.length === 0) return null;

  return (
    <Row className="mb-4 g-3">
      {candidates.map(renderCard)}
    </Row>
  );
};

export default MilestoneCards;
