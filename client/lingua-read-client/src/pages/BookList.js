import React, { useState, useEffect, useMemo } from 'react';
import { Container, Row, Col, Card, Button, Alert, Spinner, ProgressBar, Form } from 'react-bootstrap';
import { Link, useNavigate } from 'react-router-dom';
import { getBooks } from '../utils/api';
import { formatDate } from '../utils/helpers';

const BookList = () => {
  const [books, setBooks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Persistent language filter
  const [languageFilter, setLanguageFilter] = useState(() => {
    return localStorage.getItem('bookListLanguageFilter') || '';
  });

  const navigate = useNavigate();

  // Save filter to localStorage
  useEffect(() => {
    localStorage.setItem('bookListLanguageFilter', languageFilter);
  }, [languageFilter]);

  useEffect(() => {
    const fetchBooks = async () => {
      try {
        const data = await getBooks();
        setBooks(data);
        setError('');
      } catch (err) {
        setError(err.message || 'Failed to load books');
      } finally {
        setLoading(false);
      }
    };

    fetchBooks();
  }, []);

  // Filter books and get unique languages
  const { filteredBooks, uniqueLanguages } = useMemo(() => {
    if (!books || books.length === 0) return { filteredBooks: [], uniqueLanguages: [] };

    // Unique languages
    const languages = [...new Set(books.map(book => book.languageName).filter(lang => lang))];

    // Filtered books
    const filtered = books.filter(book => {
      return !languageFilter || book.languageName === languageFilter;
    });

    return { filteredBooks: filtered, uniqueLanguages: languages };

  }, [books, languageFilter]);


  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading...</span>
        </Spinner>
      </Container>
    );
  }

  return (
    <Container className="py-5 main-content-padding">
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap">
        <h2 className="mb-0">My Books</h2>

        <div className="d-flex align-items-center gap-2 mt-2 mt-md-0">
          {/* Language Filter */}
          <Form.Select
            size="sm"
            value={languageFilter}
            onChange={(e) => setLanguageFilter(e.target.value)}
            style={{ width: '150px' }}
          >
            <option value="">All Languages</option>
            {uniqueLanguages.map(lang => (
              <option key={lang} value={lang}>{lang}</option>
            ))}
          </Form.Select>

          <Button
            onClick={() => navigate('/books/create')}
            className="btn-primary"
            size="sm"
          >
            Add New Book
          </Button>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {!loading && books.length === 0 && (
        <Alert variant="info">
          You haven't added any books yet. Click "Add New Book" to get started.
        </Alert>
      )}

      {!loading && filteredBooks.length === 0 && books.length > 0 && (
        <Alert variant="info">
          No books match the selected language.
          <Button variant="link" onClick={() => setLanguageFilter('')} className="p-0 ms-2 align-baseline">Clear filter</Button>
        </Alert>
      )}

      <Row xs={1} md={2} lg={3} className="g-4">
        {filteredBooks.map((book) => ( // Use filteredBooks
          <Col key={book.bookId}>
            <Card className="h-100 d-flex flex-column book-card">
              <Card.Body className="d-flex flex-column flex-grow-1">
                <Card.Title as="h5" className="text-truncate mb-1">{book.title}</Card.Title>
                <Card.Subtitle className="mb-3 text-muted">
                  {book.languageName}
                </Card.Subtitle>
                <Card.Text className="text-truncate mb-3">
                  {book.description || 'No description provided'}
                </Card.Text>

                {/* Reading statistics */}
                <div className="mb-3">
                  <small className="text-muted d-block mb-1">Reading progress:</small>
                  <ProgressBar
                    now={book.completionPercentage}
                    label={`${book.completionPercentage}%`}
                    className="themed-progress-bar"
                  />
                </div>

                {book.totalWords > 0 && (
                  <div className="text-muted small mb-3">
                    <Row>
                      <Col>Known: {book.knownWords}</Col>
                      <Col>Learning: {book.learningWords}</Col>
                      <Col>Total: {book.totalWords}</Col>
                    </Row>
                  </div>
                )}

                <div className="text-muted small mt-auto">
                  Parts: {book.partCount} | Added: {formatDate(book.createdAt)}
                  {book.lastReadAt && (
                    <> | Last read: {formatDate(book.lastReadAt)}</>
                  )}
                </div>
              </Card.Body>
              <Card.Footer className="d-flex p-3">
                <Link
                  to={`/books/${book.bookId}`}
                  className="btn btn-outline-primary flex-grow-1 me-2"
                >
                  View Book
                </Link>
                {book.lastReadTextId ? (
                  <Link
                    to={`/texts/${book.lastReadTextId}`}
                    className="btn btn-primary flex-grow-1"
                  >
                    Continue Reading
                  </Link>
                ) : book.partCount > 0 ? (
                  <Button
                    className="btn-primary flex-grow-1"
                    onClick={() => navigate(`/texts/${book.parts?.[0]?.textId || ''}`)}
                    disabled={!book.parts?.[0]?.textId}
                  >
                    Start Reading
                  </Button>
                ) : null}
              </Card.Footer>
            </Card>
          </Col>
        ))}
      </Row>

      <div className="mt-4 text-center">
        <Button
          variant="outline-secondary"
          onClick={() => navigate('/texts')}
        >
          View Individual Texts
        </Button>
      </div>
    </Container>
  );
};

export default BookList; 