import React, { useEffect, useState, useMemo, useCallback } from 'react'; // Added useCallback
import { Container, Row, Col, Card, Button, Spinner, Alert, Form, ButtonGroup, Badge } from 'react-bootstrap'; // Added Badge
import { Link } from 'react-router-dom';
import { useTextsStore } from '../utils/store';
import { getTexts, deleteText } from '../utils/api'; // Import deleteText
// Assuming Bootstrap Icons are linked globally or via a library like react-bootstrap-icons
// For simplicity, using class names directly: <i className="bi bi-headphones"></i> <i className="bi bi-trash"></i>

const TextList = () => {
  const { texts, loading, error, setTexts, setLoading, setError } = useTextsStore();
  const [sortKey, setSortKey] = useState('createdAt'); // Default sort by creation date
  const [sortOrder, setSortOrder] = useState('desc'); // Default descending (newest first)
  const [tagFilter, setTagFilter] = useState(''); // State for tag filter
  const [typeFilter, setTypeFilter] = useState('all'); // State for type filter ('all', 'audio', 'normal')

  const fetchTexts = useCallback(async () => { // Wrap fetch logic in useCallback
    setLoading(true);
    try {
      const data = await getTexts();
      setTexts(data || []); // Ensure texts is always an array
    } catch (err) {
      setError(err.message || 'Failed to load texts');
      setTexts([]); // Set to empty array on error
    } finally {
      setLoading(false);
    }
  }, [setTexts, setLoading, setError]); // Dependencies for useCallback

  useEffect(() => {
    fetchTexts();
  }, [fetchTexts]); // Use fetchTexts as dependency

  // Filter, Sort texts and get unique tags
  const { filteredAndSortedTexts, uniqueTags } = useMemo(() => {
    if (!texts || texts.length === 0) return { filteredAndSortedTexts: [], uniqueTags: [] };

    // Get unique tags
    const tags = [...new Set(texts.map(text => text.tag).filter(tag => tag))]; // Filter out null/empty tags

    // Filter texts
    const filtered = texts.filter(text => {
      const tagMatch = !tagFilter || text.tag === tagFilter;
      const typeMatch = typeFilter === 'all' ||
                        (typeFilter === 'audio' && text.isAudioLesson) ||
                        (typeFilter === 'normal' && !text.isAudioLesson);
      return tagMatch && typeMatch;
    });

    // Sort filtered texts
    const sorted = [...filtered].sort((a, b) => {
       let valA = a[sortKey];
       let valB = b[sortKey];

       // Handle date sorting
       if (sortKey === 'createdAt') {
         valA = valA ? new Date(valA) : new Date(0);
         valB = valB ? new Date(valB) : new Date(0);
       }

       // Handle string sorting (case-insensitive)
       if (typeof valA === 'string') valA = valA.toLowerCase();
       if (typeof valB === 'string') valB = valB.toLowerCase();

       // Comparison logic
       if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
       if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
       return 0;
    });

    return { filteredAndSortedTexts: sorted, uniqueTags: tags };
  }, [texts, sortKey, sortOrder, tagFilter, typeFilter]); // Add filters to dependencies

  const handleSort = (key) => {
    if (key === sortKey) {
      // Toggle order if same key is clicked
      setSortOrder(prevOrder => prevOrder === 'asc' ? 'desc' : 'asc');
    } else {
      // Set new key and default to descending for dates, ascending for titles
      setSortKey(key);
      setSortOrder(key === 'createdAt' ? 'desc' : 'asc');
    }
  };

  const handleDeleteText = async (textId, textTitle) => {
    if (window.confirm(`Are you sure you want to delete the text "${textTitle}"? This cannot be undone.`)) {
      // Note: We don't use the main loading state here to avoid hiding the whole list
      // Ideally, you might want a per-card loading indicator
      try {
        await deleteText(textId);
        // Refetch texts to update the list after deletion
        await fetchTexts();
      } catch (err) {
        // Display error specific to this action, maybe using a toast notification library
        setError(`Failed to delete text: ${err.message}`);
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
           <Form.Select size="sm" value={tagFilter} onChange={(e) => setTagFilter(e.target.value)} style={{ width: '150px' }}>
             <option value="">All Tags</option>
             {uniqueTags.map(tag => (
               <option key={tag} value={tag}>{tag}</option>
             ))}
           </Form.Select>
           <Form.Select size="sm" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} style={{ width: '150px' }}>
             <option value="all">All Types</option>
             <option value="normal">Normal Texts</option>
             <option value="audio">Audio Lessons</option>
           </Form.Select>
        </div>
        <div className="d-flex gap-2 mt-2 mt-md-0"> {/* Wrap buttons in a div for grouping */}
           <Button as={Link} to="/texts/create-batch-audio" variant="info">
               Batch Add Audio
           </Button>
           <Button as={Link} to="/texts/create" variant="success">
               Add New Text
           </Button>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}

      {!loading && filteredAndSortedTexts.length === 0 ? ( // Check filteredAndSortedTexts
        <Card className="text-center p-5">
          <Card.Body>
            <h3>{texts.length === 0 ? "You don't have any texts yet" : "No texts match the current filters"}</h3>
            <p className="mb-4">Add your first text to start learning vocabulary</p>
            <Button as={Link} to="/texts/create" variant="primary">
              Add Your First Text
            </Button>
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
                </Card.Body>
                <Card.Footer className="bg-white border-top-0 d-flex justify-content-between align-items-center">
                  <Button
                    as={Link}
                    to={`/texts/${text.textId}`}
                    variant="outline-primary"
                    size="sm" // Make button smaller
                    className="flex-grow-1 me-2" // Adjust spacing
                  >
                    Continue Reading
                  </Button>
                  <Button
                    variant="outline-danger"
                    size="sm"
                    onClick={() => handleDeleteText(text.textId, text.title)} // Add delete handler
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