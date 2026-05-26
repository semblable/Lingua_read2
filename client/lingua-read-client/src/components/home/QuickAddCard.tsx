import React from 'react';
import { Button, Card } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';

const QuickAddCard: React.FC = () => {
  return (
    <Card className="shadow-sm h-100" data-testid="quick-add-card">
      <Card.Body className="d-flex flex-column">
        <Card.Subtitle className="text-muted small text-uppercase fw-bold mb-2">
          Add new content
        </Card.Subtitle>
        <Card.Text className="text-muted small mb-3">
          Import a book, paste a text, or upload audio.
        </Card.Text>
        <div className="mt-auto d-grid gap-2">
          <LinkContainer to="/books/create">
            <Button variant="success" size="sm">
              Add book
            </Button>
          </LinkContainer>
          <LinkContainer to="/texts/create">
            <Button variant="primary" size="sm">
              Add text
            </Button>
          </LinkContainer>
          <LinkContainer to="/texts/create-audio">
            <Button variant="info" size="sm">
              Add audio
            </Button>
          </LinkContainer>
        </div>
      </Card.Body>
    </Card>
  );
};

export default QuickAddCard;
