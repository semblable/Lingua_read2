import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Container, Row, Col, Card, Button, Spinner, Alert, Form, ButtonGroup, Badge } from 'react-bootstrap';
import LinkButton from '../components/shared/LinkButton';
import { useTextsStore } from '../utils/store';
import type { StoredText } from '../utils/store';
import { getTexts, deleteText } from '../utils/api';
// Assuming Bootstrap Icons are linked globally or via a library like react-bootstrap-icons
// For simplicity, using class names directly: <i className="bi bi-headphones"></i> <i className="bi bi-trash"></i>

const TextList = () => {
  const { texts, loading, error, setTexts, setLoading, setError } = useTextsStore();
  // sortKey is constrained to the two UI-exposed columns; sortOrder is a 2-way switch.
  const [sortKey, setSortKey] = useState<'title' | 'createdAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  // Persistent language filter
  const [languageFilter, setLanguageFilter] = useState(() => {
    return localStorage.getItem('textListLanguageFilter') || '';
  });

  const [tagFilter, setTagFilter] = useState(''); // State for tag filter
  const [typeFilter, setTypeFilter] = useState('all'); // State for type filter ('all', 'audio', 'normal')
  const [statusFilter, setStatusFilter] = useState('all'); // State for status filter ('all', 'finished', 'inprogress')

  // Update localStorage when filter changes
  useEffect(() => {
    localStorage.setItem('textListLanguageFilter', languageFilter);
  }, [languageFilter]);

  const fetchTexts = useCallback(async () => { // Wrap fetch logic in useCallback
    setLoading(true);
    try {
      const data = await getTexts();
      setTexts((data ?? []) as StoredText[]);
    } catch (err: unknown) {
      setError((err as Error)?.message || 'Failed to load texts');
      setTexts([]); // Set to empty array on error
    } finally {
      setLoading(false);
    }
  }, [setTexts, setLoading, setError]); // Dependencies for useCallback

  useEffect(() => {
    fetchTexts();
  }, [fetchTexts]); // Use fetchTexts as dependency

  // Filter, Sort texts and get unique attributes
  const { filteredAndSortedTexts, uniqueTags, uniqueLanguages } = useMemo(() => {
    if (!texts || texts.length === 0) return { filteredAndSortedTexts: [], uniqueTags: [], uniqueLanguages: [] };

    // Get unique tags and languages
    const tags = [...new Set(texts.map(text => text.tag).filter(tag => tag))]; // Filter out null/empty tags
    const languages = [...new Set(texts.map(text => text.languageName).filter(lang => lang))];

    // Filter texts
    const filtered = texts.filter(text => {
      const tagMatch = !tagFilter || text.tag === tagFilter;
      const typeMatch = typeFilter === 'all' ||
        (typeFilter === 'audio' && text.isAudioLesson) ||
        (typeFilter === 'normal' && !text.isAudioLesson);
      const languageMatch = !languageFilter || text.languageName === languageFilter;
      const statusMatch = statusFilter === 'all' ||
        (statusFilter === 'finished' && text.isFinished) ||
        (statusFilter === 'inprogress' && !text.isFinished);
      return tagMatch && typeMatch && languageMatch && statusMatch;
    });

    // Sort filtered texts. sortKey is constrained to 'title' | 'createdAt' so
    // a[sortKey] resolves to string | undefined at compile time.
    const sorted = [...filtered].sort((a, b) => {
      const rawA = a[sortKey];
      const rawB = b[sortKey];

      if (sortKey === 'createdAt') {
        const dateA = rawA ? new Date(rawA).getTime() : 0;
        const dateB = rawB ? new Date(rawB).getTime() : 0;
        if (dateA < dateB) return sortOrder === 'asc' ? -1 : 1;
        if (dateA > dateB) return sortOrder === 'asc' ? 1 : -1;
        return 0;
      }

      const strA = rawA ?? '';
      const strB = rawB ?? '';
      const comparison = strA.localeCompare(strB, undefined, { numeric: true, sensitivity: 'base' });
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return { filteredAndSortedTexts: sorted, uniqueTags: tags, uniqueLanguages: languages };
  }, [texts, sortKey, sortOrder, tagFilter, typeFilter, languageFilter, statusFilter]); // Add filters to dependencies

  const handleSort = (key: 'title' | 'createdAt') => {
    if (key === sortKey) {
      // Toggle order if same key is clicked
      setSortOrder(prevOrder => prevOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new key and default to descending for dates, ascending for titles
      setSortKey(key);
      setSortOrder(key === 'createdAt' ? 'desc' : 'asc');
    }
  };

  const handleDeleteText = async (textId: number | string, textTitle: string) => {
    if (window.confirm(`Are you sure you want to delete the text "${textTitle}"? This cannot be undone.`)) {
      // Note: We don't use the main loading state here to avoid hiding the whole list
      // Ideally, you might want a per-card loading indicator
      try {
        await deleteText(textId);
        // Refetch texts to update the list after deletion
        await fetchTexts();
      } catch (err: unknown) {
        // Display error specific to this action, maybe using a toast notification library
        setError(`Failed to delete text: ${(err as Error)?.message}`);
        // Clear error after some time or let user dismiss it
        setTimeout(() => setError(''), 5000);
      }
    }
  };

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
    <Container className="py-5">
      <div className="d-flex justify-content-between align-items-center mb-4 flex-wrap">
        <h1>My Texts</h1>
        {/* Sorting Controls */}
        <div className="d-flex align-items-center gap-2">
          <span className="text-muted me-2">Sort by:</span>
          <ButtonGroup size="sm">
            <Button
              variant={sortKey === 'title' ? 'primary' : 'outline-secondary'}
              onClick={() => handleSort('title')}
            >
              Title {sortKey === 'title' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </Button>
            <Button
              variant={sortKey === 'createdAt' ? 'primary' : 'outline-secondary'}
              onClick={() => handleSort('createdAt')}
            >
              Date {sortKey === 'createdAt' ? (sortOrder === 'asc' ? '▲' : '▼') : ''}
            </Button>
          </ButtonGroup>
        </div>
        {/* Filter Controls */}
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

          <Form.Select size="sm" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ width: '150px' }}>
            <option value="">All Tags</option>
            {uniqueTags.map(tag => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </Form.Select>
          <Form.Select size="sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: '150px' }}>
            <option value="all">All Status</option>
            <option value="finished">Finished</option>
            <option value="inprogress">In Progress</option>
          </Form.Select>
          <Form.Select size="sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: '150px' }}>
            <option value="all">All Types</option>
            <option value="normal">Normal Texts</option>
            <option value="audio">Audio Lessons</option>
          </Form.Select>
        </div>
        <div className="d-flex gap-2 mt-2 mt-md-0"> {/* Wrap buttons in a div for grouping */}
          <LinkButton to="/texts/create-batch-audio" variant="info">
            Batch Add Audio
          </LinkButton>
          <LinkButton to="/texts/create" variant="success">
            Add New Text
          </LinkButton>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {!loading && filteredAndSortedTexts.length === 0 ? ( // Check filteredAndSortedTexts
        <Card className="text-center p-5">
          <Card.Body>
            <h3>{texts.length === 0 ? "You don't have any texts yet" : "No texts match the current filters"}</h3>
            <p className="mb-4">Add your first text to start learning vocabulary</p>
            <LinkButton to="/texts/create" variant="primary">
              Add Your First Text
            </LinkButton>
            {(languageFilter || tagFilter || typeFilter !== 'all' || statusFilter !== 'all') && ( // Update condition
              <Button
                variant="outline-secondary"
                className="ms-2"
                onClick={() => {
                  setLanguageFilter('');
                  setTagFilter('');
                  setTypeFilter('all');
                  setStatusFilter('all'); // Clear status filter
                }}
              >
                Clear Filters
              </Button>
            )}
          </Card.Body>
        </Card>
      ) : (
        <Row>
          {filteredAndSortedTexts.map((text) => ( // Map over filteredAndSortedTexts
            <Col md={4} key={text.textId} className="mb-4">
              <Card className="h-100 text-card shadow-sm">
                <Card.Body>
                  <Card.Title>
                    {text.isAudioLesson && <i className="bi bi-headphones me-2" title="Audio Lesson"></i>}
                    {text.isFinished && <i className="bi bi-check-circle-fill text-success me-2" title="Completed"></i>}
                    {text.title}
                  </Card.Title>
                  <Card.Subtitle className="mb-2 text-muted">
                    {text.languageName}
                    {text.tag && <Badge bg="secondary" className="ms-2">{text.tag}</Badge>} {/* Display tag */}
                  </Card.Subtitle>
                  {/* Removed content preview */}
                  <div className="mt-3">
                    <small className="text-muted">
                      Created: {text.createdAt ? new Date(text.createdAt).toLocaleDateString() : 'N/A'}
                    </small>
                  </div>
                  {text.bookId == null && (text.totalWords ?? 0) > 0 && text.unknownWordPercentage != null && (
                    <div className="mt-1">
                      <small className="text-muted">
                        Unknown: {text.unknownWordPercentage.toFixed(1)}% ({text.unknownWords}/{text.totalWords})
                      </small>
                    </div>
                  )}
                </Card.Body>
                <Card.Footer className="bg-white border-top-0 d-flex justify-content-between align-items-center">
                  <LinkButton
                    to={`/texts/${text.textId}`}
                    variant="outline-primary"
                    size="sm" // Make button smaller
                    className="flex-grow-1 me-2" // Adjust spacing
                  >
                    Continue Reading
                  </LinkButton>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => handleDeleteText(text.textId!, text.title ?? '')} // textId always set on server-loaded texts
                    title="Delete Text"
                  >
                    <i className="bi bi-trash"></i> {/* Delete Icon */}
                  </Button>
                </Card.Footer>
              </Card>
            </Col>
          ))}
        </Row>
      )}
    </Container>
  );
};

export default TextList;