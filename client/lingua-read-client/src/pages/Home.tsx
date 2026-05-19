import React, { useState, useEffect } from 'react';
import { Container, Row, Col, Card, ListGroup, Spinner, Alert, Button } from 'react-bootstrap';
import { LinkContainer } from 'react-router-bootstrap';
import { getRecentTexts } from '../utils/api';
import type { RecentTexts } from '../utils/api/texts';

type RecentText = RecentTexts[number];

const Home = () => {
  const [recentTexts, setRecentTexts] = useState<RecentText[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(false);
  const [errorRecent, setErrorRecent] = useState('');

  useEffect(() => {
    const fetchRecent = async () => {
      setLoadingRecent(true);
      setErrorRecent('');
      try {
        const data = await getRecentTexts();
        setRecentTexts(data || []);
      } catch (err) {
        setErrorRecent('Failed to load recent texts. Please try again later.');
        console.error("Error fetching recent texts:", err);
      } finally {
        setLoadingRecent(false);
      }
    };

    fetchRecent();
  }, []);

  const renderRecentTexts = () => {
    if (loadingRecent) {
      return <Spinner animation="border" size="sm" />;
    }
    if (errorRecent) {
      return <Alert variant="warning">{errorRecent}</Alert>;
    }
    if (recentTexts.length === 0) {
      return <p>No recently read texts found.</p>;
    }
    return (
      <ListGroup variant="flush">
        {recentTexts.map((text) => (
          <LinkContainer key={text.textId} to={`/texts/${text.textId}`}>
            <ListGroup.Item
              action
              className="d-flex justify-content-between align-items-start"
            >
              <div className="ms-2 me-auto">
                <div className="fw-bold">
                  {text.bookTitle ? `${text.bookTitle} - Part ${text.partNumber || '?'}` : text.title}
                </div>
                <small className="text-muted">{text.languageName}{text.isAudioLesson ? ' (Audio)' : ''}</small>
              </div>
            </ListGroup.Item>
          </LinkContainer>
        ))}
      </ListGroup>
    );
  };

  return (
    // Reduced padding slightly
    <Container className="py-4">
      {/* Removed outer Row/Col structure that centered everything */}

      {/* --- Continue Reading Section --- */}
      <Row className="justify-content-center mb-4">
        <Col md={10} lg={8}>
          <Card className="shadow-sm">
            <Card.Header as="h5">Continue Reading</Card.Header>
            <Card.Body>
              {renderRecentTexts()}
            </Card.Body>
          </Card>
        </Col>
      </Row>
      {/* --- End Continue Reading Section --- */}

      {/* --- Action Cards Section --- */}
      {/* Removed the token check here - always show these actions */}
      <Row className="justify-content-center">
        <Col md={6} lg={5} className="mb-4"> {/* Adjusted column size */}
          <Card className="h-100 shadow-sm">
            <Card.Body className="d-flex flex-column"> {/* Use flex for button alignment */}
              <Card.Title>My Library</Card.Title>
              <Card.Text>
                Browse your books, texts, and folders.
              </Card.Text>
              <LinkContainer to="/library">
                <Button variant="primary" className="mt-auto">Go to Library</Button>
              </LinkContainer>
            </Card.Body>
          </Card>
        </Col>
        <Col md={6} lg={5} className="mb-4"> {/* Adjusted column size */}
          <Card className="h-100 shadow-sm">
            <Card.Body className="d-flex flex-column"> {/* Use flex for button alignment */}
              <Card.Title>Add New Content</Card.Title>
              <Card.Text>
                Import a new book, create a text, or upload an audio lesson.
              </Card.Text>
              <div className="mt-auto">
                <LinkContainer to="/books/create">
                  <Button variant="success" className="me-2 mb-2">Add Book</Button>
                </LinkContainer>
                <LinkContainer to="/texts/create">
                  <Button variant="secondary" className="me-2 mb-2">Add Text</Button>
                </LinkContainer>
                <LinkContainer to="/texts/create-audio">
                  <Button variant="info" className="mb-2">Add Audio Lesson</Button>
                </LinkContainer>
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>
      {/* Removed the logged-out cards section entirely */}
      {/* Removed the "How It Works" section entirely */}

    </Container>
  );
};

export default Home;