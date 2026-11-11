import React from 'react';
import { Dropdown } from 'react-bootstrap';
import { Link } from 'react-router-dom';

const QuickAddCard: React.FC = () => (
  <Dropdown className="home-add" data-testid="quick-add-card">
    <Dropdown.Toggle variant="outline-secondary" id="home-add-menu">+ Add content</Dropdown.Toggle>
    <Dropdown.Menu align="end">
      <Dropdown.Item as={Link} to="/books/create"><i className="bi bi-book me-2" aria-hidden="true" />Add book</Dropdown.Item>
      <Dropdown.Item as={Link} to="/texts/create"><i className="bi bi-file-text me-2" aria-hidden="true" />Add text</Dropdown.Item>
      <Dropdown.Item as={Link} to="/texts/create-audio"><i className="bi bi-headphones me-2" aria-hidden="true" />Add audio</Dropdown.Item>
    </Dropdown.Menu>
  </Dropdown>
);

export default QuickAddCard;
