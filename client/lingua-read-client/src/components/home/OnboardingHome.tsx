import React from 'react';
import { Button, Card, Col, Container, Row } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

interface OnboardingHomeProps {
  username?: string | null;
}

interface OnboardingStepProps {
  title: string;
  body: string;
  cta: string;
  to: string;
  variant?: string;
}

const OnboardingStep: React.FC<OnboardingStepProps> = ({ title, body, cta, to, variant = 'primary' }) => (
  <Card className="h-100 shadow-sm">
    <Card.Body className="d-flex flex-column">
      <Card.Title>{title}</Card.Title>
      <Card.Text className="text-muted">{body}</Card.Text>
      <LinkContainer to={to}>
        <Button variant={variant} className="mt-auto align-self-start">
          {cta}
        </Button>
      </LinkContainer>
    </Card.Body>
  </Card>
);

const OnboardingHome: React.FC<OnboardingHomeProps> = ({ username }) => {
  const name = (username && username.trim()) || null;
  return (
    <Container className="py-4" data-testid="onboarding-home">
      <div className="mb-4">
        <h1 className="mb-2 fw-bold" style={{ fontSize: 'clamp(1.8rem, 4vw, 2.5rem)' }}>
          {name ? `Welcome to LinguaRead, ${name}.` : 'Welcome to LinguaRead.'}
        </h1>
        <p className="text-muted mb-0" style={{ maxWidth: 720, fontSize: '1rem' }}>
          Read texts in any language with every word colour-coded by how well you know it. Click a
          word for an instant translation, mark it as learned, and watch your vocabulary grow.
        </p>
      </div>

      <Row className="g-3 mb-3">
        <Col xs={12} md={4}>
          <OnboardingStep
            title="Add a book"
            body="Import an EPUB or paste a long text — LinguaRead splits it into bite-sized lessons."
            cta="Add a book"
            to="/books/create"
            variant="primary"
          />
        </Col>
        <Col xs={12} md={4}>
          <OnboardingStep
            title="Add a text"
            body="Paste an article or short passage to start reading right away."
            cta="Add a text"
            to="/texts/create"
            variant="primary"
          />
        </Col>
        <Col xs={12} md={4}>
          <OnboardingStep
            title="Configure languages"
            body="Pick the languages you study and set translation preferences."
            cta="Languages"
            to="/settings/languages"
            variant="outline-primary"
          />
        </Col>
      </Row>

      <div className="text-muted small">
        Already added something? <a href="/library">Open your library →</a>
      </div>
    </Container>
  );
};

export default OnboardingHome;
