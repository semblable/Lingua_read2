import React, { useState, useEffect, useCallback, useMemo } from 'react'; // Add useCallback, useMemo
import { Container, Card, Button, Alert, Spinner, ListGroup, Badge, ProgressBar, Modal, Form } from 'react-bootstrap'; // Add Form
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import {
  getBook,
  finishBook,
  updateBook,
  deleteBook,
  getText,
  updateText,
  deleteText,
  uploadAudiobookTracks,
  matchHardcoverBook,
  importHardcoverMetadata,
  syncHardcoverProgress
} from '../utils/api'; // Import new API functions + uploadAudiobookTracks
import { formatDate, /*calculateReadingTime*/ } from '../utils/helpers'; // Removed unused calculateReadingTime
// Removed AudiobookPlayer import

const normalizeCoverUrl = (value) => {
  if (!value) return null;
  if (/^(https?:)?\/\//i.test(value) || value.startsWith('/')) {
    return value;
  }

  return `/${value.replace(/^\/+/, '')}`;
};

const BookDetail = () => {
  const { bookId } = useParams();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const [finishingBook, setFinishingBook] = useState(false);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [pendingRating, setPendingRating] = useState(null); // 0.5 .. 5.0 or null
  const [finishError, setFinishError] = useState('');

  // State for Edit/Delete Modals and Data
  const [showEditBookModal, setShowEditBookModal] = useState(false);
  const [showEditTextModal, setShowEditTextModal] = useState(false);
  const [editingBook, setEditingBook] = useState(null); // Holds { bookId, title }
  const [editingText, setEditingText] = useState(null); // Holds { textId, title, content, tag }
  const [modalLoading, setModalLoading] = useState(false);
  const [modalError, setModalError] = useState('');

  // State for Audiobook Upload
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadingAudio, setUploadingAudio] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploadSuccess, setUploadSuccess] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0); // Progress state

  // Hardcover state
  const [hardcoverLoading, setHardcoverLoading] = useState(false);
  const [hardcoverMessage, setHardcoverMessage] = useState(null);
  const [hardcoverCandidates, setHardcoverCandidates] = useState([]);
  const [showHardcoverCandidates, setShowHardcoverCandidates] = useState(false);


  const fetchBook = useCallback(async () => { // Wrap in useCallback
    setLoading(true);
    try {
      const data = await getBook(bookId);
      setBook(data);
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load book details');
    } finally {
      setLoading(false);
    }
  }, [bookId]); // Add bookId as dependency

  useEffect(() => {
    fetchBook();
  }, [fetchBook]); // Use fetchBook as dependency

  useEffect(() => {
    if (location.state?.audioUploadWarning) {
      setUploadError(location.state.audioUploadWarning);
    }
  }, [location.state]);

  // Sort parts naturally (e.g. Part 1, Part 2, ... Part 10)
  const sortedParts = useMemo(() => {
    if (!book || !book.parts) return [];
    return [...book.parts].sort((a, b) =>
      (a.title || '').localeCompare(b.title || '', undefined, { numeric: true, sensitivity: 'base' })
    );
  }, [book]);

  const handleOpenFinishModal = () => {
    setPendingRating(null);
    setFinishError('');
    setShowRatingModal(true);
  };

  const submitFinishBook = async (rating) => {
    setFinishingBook(true);
    setFinishError('');
    try {
      await finishBook(bookId, rating);
      setBook(prev => ({ ...prev, isFinished: true }));
      setShowRatingModal(false);
      setPendingRating(null);
    } catch (err) {
      setFinishError(err.message || 'Failed to mark book as finished.');
    } finally {
      setFinishingBook(false);
    }
  };

  // --- Edit/Delete Handlers ---

  const handleOpenEditBookModal = () => {
    setEditingBook({ bookId: book.bookId, title: book.title });
    setModalError('');
    setShowEditBookModal(true);
  };

  const handleOpenEditTextModal = async (textId) => {
    setModalLoading(true);
    setModalError('');
    try {
      // Fetch full text details needed for editing
      const textData = await getText(textId);
      setEditingText({
        textId: textData.textId,
        title: textData.title,
        content: textData.content,
        tag: textData.tag || '' // Ensure tag is defined, default to empty string
      });
      setShowEditTextModal(true);
    } catch (err) {
      setModalError(`Failed to load text details: ${err.message}`);
    } finally {
      setModalLoading(false);
    }
  };

  const handleCloseModals = () => {
    setShowEditBookModal(false);
    setShowEditTextModal(false);
    setEditingBook(null);
    setEditingText(null);
    setModalError('');
  };

  const handleBookUpdate = async () => {
    if (!editingBook || !editingBook.title) {
      setModalError('Book title cannot be empty.');
      return;
    }
    setModalLoading(true);
    setModalError('');
    try {
      await updateBook(editingBook.bookId, { title: editingBook.title });
      // Refresh book data after update
      await fetchBook();
      handleCloseModals();
    } catch (err) {
      setModalError(`Failed to update book: ${err.message}`);
    } finally {
      setModalLoading(false);
    }
  };

  const handleTextUpdate = async () => {
    if (!editingText || !editingText.title || !editingText.content) {
      setModalError('Text title and content cannot be empty.');
      return;
    }
    setModalLoading(true);
    setModalError('');
    try {
      await updateText(editingText.textId, {
        title: editingText.title,
        content: editingText.content,
        tag: editingText.tag || null // Send null if tag is empty
      });
      // Refresh book data to show updated text title/info in the list
      await fetchBook();
      handleCloseModals();
    } catch (err) {
      setModalError(`Failed to update text: ${err.message}`);
    } finally {
      setModalLoading(false);
    }
  };

  const handleBookDelete = async () => {
    if (window.confirm(`Are you sure you want to delete the book "${book.title}"? This cannot be undone.`)) {
      setLoading(true); // Use main loading indicator
      setError('');
      try {
        await deleteBook(bookId);
        navigate('/books'); // Navigate back to book list after deletion
      } catch (err) {
        setError(`Failed to delete book: ${err.message}. Ensure all parts are deleted first if necessary.`);
        setLoading(false);
      }
      // No finally setLoading(false) because we navigate away on success
    }
  };

  const handleTextDelete = async (textId, textTitle) => {
    if (window.confirm(`Are you sure you want to delete the text part "${textTitle}"? This cannot be undone.`)) {
      setLoading(true); // Use main loading indicator for simplicity
      setError('');
      try {
        await deleteText(textId);
        // Refresh book data to remove the text from the list
        await fetchBook();
      } catch (err) {
        setError(`Failed to delete text part: ${err.message}`);
      } finally {
        setLoading(false);
      }
    }
  };

  // --- End Edit/Delete Handlers ---

  // --- Audiobook Upload Handlers ---
  const handleFileChange = (event) => {
    setSelectedFiles(Array.from(event.target.files)); // Convert FileList to Array
    setUploadError(''); // Clear previous errors on new selection
    setUploadSuccess('');
  };

  const handleAudioUpload = async () => {
    if (selectedFiles.length === 0) {
      setUploadError('Please select one or more audio files to upload.');
      return;
    }

    setUploadingAudio(true);
    setUploadError('');
    setUploadSuccess('');

    // Sort files naturally by name to ensure 1.mp3 comes before 10.mp3 if 2.mp3 exists, etc.
    const sortedFiles = [...selectedFiles].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

    try {
      setUploadSuccess(`Uploading ${sortedFiles.length} audio track${sortedFiles.length > 1 ? 's' : ''}...`);
      setUploadProgress(0);

      const formData = new FormData();
      sortedFiles.forEach(f => formData.append('Files', f));

      await uploadAudiobookTracks(bookId, formData, (progress) => {
        setUploadProgress(progress);
      });

      setUploadSuccess(`Successfully uploaded ${sortedFiles.length} audio track(s).`);
      setUploadProgress(0);

      setSelectedFiles([]);
      // Refresh book data to show the new tracks
      await fetchBook();
    } catch (err) {
      setUploadError(err.message || 'Failed to process audiobook upload.');
    } finally {
      setUploadingAudio(false);
      // Clear the file input visually (important for UX)
      const fileInput = document.getElementById('audiobook-upload-input');
      if (fileInput) {
        fileInput.value = '';
      }
    }
  };
  // --- End Audiobook Upload Handlers ---

  const handleHardcoverMatch = async () => {
    setHardcoverLoading(true);
    setHardcoverMessage(null);
    try {
      const result = await matchHardcoverBook(bookId);
      if (result.applied) {
        setHardcoverMessage({ type: 'success', text: result.message || 'Matched Hardcover book.' });
        await fetchBook();
      } else {
        setHardcoverCandidates(result.candidates || []);
        setShowHardcoverCandidates(true);
        setHardcoverMessage({ type: 'warning', text: result.message || 'Review Hardcover candidates.' });
      }
    } catch (err) {
      setHardcoverMessage({ type: 'danger', text: err.message || 'Hardcover match failed.' });
    } finally {
      setHardcoverLoading(false);
    }
  };

  const handleHardcoverImport = async () => {
    setHardcoverLoading(true);
    setHardcoverMessage(null);
    try {
      const result = await importHardcoverMetadata(bookId);
      if (result.success) {
        setHardcoverMessage({ type: 'success', text: result.message || 'Imported Hardcover metadata.' });
        await fetchBook();
      } else {
        setHardcoverCandidates(result.candidates || []);
        setShowHardcoverCandidates(true);
        setHardcoverMessage({ type: 'warning', text: result.message || 'Review Hardcover candidates.' });
      }
    } catch (err) {
      setHardcoverMessage({ type: 'danger', text: err.message || 'Hardcover metadata import failed.' });
    } finally {
      setHardcoverLoading(false);
    }
  };

  const handleHardcoverSync = async () => {
    setHardcoverLoading(true);
    setHardcoverMessage(null);
    try {
      const result = await syncHardcoverProgress(bookId);
      setHardcoverMessage({
        type: result.success ? 'success' : 'warning',
        text: result.message || 'Hardcover progress sync completed.'
      });
      await fetchBook();
    } catch (err) {
      setHardcoverMessage({ type: 'danger', text: err.message || 'Hardcover progress sync failed.' });
    } finally {
      setHardcoverLoading(false);
    }
  };

  const handleApplyHardcoverCandidate = async (candidate) => {
    setHardcoverLoading(true);
    setHardcoverMessage(null);
    try {
      const result = await matchHardcoverBook(bookId, candidate.bookId);
      setShowHardcoverCandidates(false);
      setHardcoverMessage({
        type: result.applied ? 'success' : 'warning',
        text: result.message || 'Hardcover candidate applied.'
      });
      await fetchBook();
    } catch (err) {
      setHardcoverMessage({ type: 'danger', text: err.message || 'Failed to apply Hardcover candidate.' });
    } finally {
      setHardcoverLoading(false);
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

  if (error) {
    return (
      <Container className="py-5">
        <Alert variant="danger">
          {error}
          <div className="mt-3">
            <Button variant="outline-primary" onClick={() => navigate('/books')}>
              Back to Books
            </Button>
          </div>
        </Alert>
      </Container>
    );
  }

  if (!book) {
    return (
      <Container className="py-5">
        <Alert variant="warning">
          Book not found
          <div className="mt-3">
            <Button variant="outline-primary" onClick={() => navigate('/books')}>
              Back to Books
            </Button>
          </div>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-5">
      <div className="d-flex justify-content-between align-items-start mb-4 gap-4 flex-wrap">
        <div className="d-flex gap-4 flex-wrap align-items-start">
          {book.coverImagePath && (
            <Card className="shadow-sm" style={{ width: 'min(220px, 100%)', flexShrink: 0 }}>
              <Card.Img src={normalizeCoverUrl(book.coverImagePath)} alt={`${book.title} cover`} />
            </Card>
          )}
          <div>
          <h1 className="mb-1">
            {book.title}
            {book.isFinished && (
              <Badge bg="success" className="ms-2 align-middle" style={{ fontSize: '0.5em' }}>
                <i className="bi bi-check-circle-fill me-1"></i>
                Completed
              </Badge>
            )}
          </h1>
          <p className="text-muted mb-2">
            Language: {book.languageName} |
            Parts: {book.parts.length} |
            Added: {formatDate(book.createdAt)}
          </p>
          {book.description && (
            <p className="lead">{book.description}</p>
          )}
        </div>
        </div>
        <div className="d-flex flex-column gap-2">
          {/* Add prominent reading button */}
          {sortedParts.length > 0 && (
            book.lastReadTextId ? (
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigate(`/texts/${book.lastReadTextId}`)}
              >
                Continue Reading
              </Button>
            ) : (
              <Button
                variant="primary"
                size="lg"
                onClick={() => navigate(`/texts/${sortedParts[0].textId}`)}
              >
                Start Reading
              </Button>
            )
          )}
          <Button
            variant="outline-secondary"
            onClick={() => navigate('/books')}
          >
            Back to Books
          </Button>
          {/* Finish Book button — only shown when not finished */}
          {!book.isFinished && (
            <Button
              variant="success"
              onClick={handleOpenFinishModal}
              disabled={finishingBook}
            >
              <i className="bi bi-check-circle me-1"></i>
              Finish Book
            </Button>
          )}
          {/* Add Edit/Delete Book Buttons */}
          <Button variant="outline-warning" size="sm" onClick={handleOpenEditBookModal} className="ms-2">Edit Book</Button>
          <Button variant="outline-danger" size="sm" onClick={handleBookDelete} className="ms-2">Delete Book</Button>
        </div>
      </div>

      <Card className="shadow-sm mb-4">
        <Card.Header as="h5">Hardcover</Card.Header>
        <Card.Body>
          {hardcoverMessage && <Alert variant={hardcoverMessage.type}>{hardcoverMessage.text}</Alert>}
          <div className="mb-3">
            {book.hardcoverBookId ? (
              <div className="text-muted small">
                Linked to Hardcover book #{book.hardcoverBookId}
                {book.hardcoverSlug && (
                  <>
                    {' | '}
                    <a
                      href={`https://hardcover.app/books/${book.hardcoverSlug}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      View on Hardcover
                    </a>
                  </>
                )}
                {book.hardcoverLastSyncedAt && <> | Last synced: {formatDate(book.hardcoverLastSyncedAt)}</>}
              </div>
            ) : (
              <div className="text-muted small">This book is not linked to Hardcover yet.</div>
            )}
            {(book.author || book.isbn13 || book.publisher || book.pageCount) && (
              <div className="text-muted small mt-1">
                {book.author && <>Author: {book.author} </>}
                {book.publisher && <>| Publisher: {book.publisher} </>}
                {book.isbn13 && <>| ISBN-13: {book.isbn13} </>}
                {book.pageCount && <>| Pages: {book.pageCount}</>}
              </div>
            )}
            {book.totalWords > 0 && book.unknownWordPercentage != null && (
              <div className="text-muted small mt-1">
                Unknown words: {book.unknownWordPercentage.toFixed(1)}% ({book.unknownWords} of {book.totalWords})
              </div>
            )}
          </div>
          <div className="d-flex flex-wrap gap-2">
            <Button
              variant="outline-primary"
              size="sm"
              onClick={handleHardcoverMatch}
              disabled={hardcoverLoading}
            >
              {book.hardcoverBookId ? 'Re-match' : 'Match'}
            </Button>
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={handleHardcoverImport}
              disabled={hardcoverLoading}
            >
              Import Missing Metadata
            </Button>
            <Button
              variant="outline-success"
              size="sm"
              onClick={handleHardcoverSync}
              disabled={hardcoverLoading}
            >
              Sync Progress
            </Button>
            {hardcoverLoading && <Spinner animation="border" size="sm" />}
          </div>
        </Card.Body>
      </Card>

      <Card className="shadow-sm mb-4">
        <Card.Header as="h5">Book Sections</Card.Header>
        <ListGroup variant="flush">
          {sortedParts.map((part, index) => (
            <ListGroup.Item
              key={part.textId}
              className="d-flex justify-content-between align-items-center"
              action
              as={Link}
              to={`/texts/${part.textId}`}
            >
              <div>
                <h6 className="mb-0">{part.title}</h6>
                <small className="text-muted">
                  Added: {formatDate(part.createdAt)}
                  {part.totalWords > 0 && part.unknownWordPercentage != null && (
                    <span className="ms-2" title={`${part.unknownWords} of ${part.totalWords} unique words not yet known`}>
                      · {part.unknownWordPercentage.toFixed(1)}% new
                    </span>
                  )}
                </small>
              </div>
              <div>
                <Badge bg="primary" pill className="me-2">
                  Part {part.partNumber}
                </Badge>
                {/* Add Edit/Delete Text Buttons */}
                <Button
                  variant="outline-secondary"
                  size="sm"
                  className="me-1"
                  onClick={(e) => {
                    e.preventDefault(); // Prevent navigation
                    e.stopPropagation(); // Prevent ListGroup item click
                    handleOpenEditTextModal(part.textId);
                  }}
                >
                  Edit
                </Button>
                <Button
                  variant="outline-danger"
                  size="sm"
                  onClick={(e) => {
                    e.preventDefault(); // Prevent navigation
                    e.stopPropagation(); // Prevent ListGroup item click
                    handleTextDelete(part.textId, part.title);
                  }}
                >
                  Delete
                </Button>
              </div>
            </ListGroup.Item>
          ))}
        </ListGroup>
      </Card>

      {/* Audiobook Upload Section */}
      <Card className="shadow-sm mb-4">
        <Card.Header as="h5">Audiobook</Card.Header>
        <Card.Body>
          {uploadError && <Alert variant="danger">{uploadError}</Alert>}
          {uploadSuccess && <Alert variant="success">{uploadSuccess}</Alert>}
          <Form>
            <Form.Group controlId="audiobook-upload-input" className="mb-3">
              <Form.Label>Upload Audio Tracks</Form.Label>
              <Form.Control
                type="file"
                multiple
                accept=".mp3,.m4b,.m4a,.ogg,.flac,.wav"
                onChange={handleFileChange}
                disabled={uploadingAudio}
              />
              <Form.Text className="text-muted">
                Select one or more audio files (MP3, M4B, M4A, OGG, FLAC, WAV) for the audiobook. They will be ordered based on upload sequence or filename.
              </Form.Text>
            </Form.Group>
            <Button
              variant="info"
              onClick={handleAudioUpload}
              disabled={uploadingAudio || selectedFiles.length === 0}
            >
              {uploadingAudio ? (
                <>
                  <Spinner size="sm" animation="border" className="me-2" />
                  Uploading...
                </>
              ) : (
                'Upload Selected Tracks'
              )}
            </Button>
            {uploadingAudio && (
              <div className="mt-3">
                <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} animated variant="info" />
              </div>
            )}
          </Form>
        </Card.Body>
      </Card>

      {/* Removed Audiobook Player integration */}

      {book.parts.length === 0 && (
        <Alert variant="info">
          This book doesn't have any parts yet.
        </Alert>
      )}

      {/* Finish Book / Rating Modal */}
      <Modal
        show={showRatingModal}
        onHide={() => { if (!finishingBook) { setShowRatingModal(false); setFinishError(''); } }}
        backdrop={finishingBook ? 'static' : true}
      >
        <Modal.Header closeButton={!finishingBook}>
          <Modal.Title>Finish book</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Mark <strong>{book.title}</strong> as completed?
          </p>
          {book.hardcoverBookId && (
            <p className="text-muted small mb-2">
              Optionally rate it on Hardcover. Half-star ratings are supported.
            </p>
          )}
          <StarRatingPicker
            value={pendingRating}
            onChange={setPendingRating}
            disabled={finishingBook}
          />
          {finishError && (
            <Alert variant="danger" className="mt-3 mb-0">
              {finishError}
            </Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="outline-secondary"
            onClick={() => setShowRatingModal(false)}
            disabled={finishingBook}
          >
            Cancel
          </Button>
          <Button
            variant="outline-success"
            onClick={() => submitFinishBook(null)}
            disabled={finishingBook}
          >
            {finishingBook && pendingRating == null ? <Spinner size="sm" animation="border" className="me-2" /> : null}
            Finish without rating
          </Button>
          <Button
            variant="success"
            onClick={() => submitFinishBook(pendingRating)}
            disabled={finishingBook || pendingRating == null}
          >
            {finishingBook && pendingRating != null ? <Spinner size="sm" animation="border" className="me-2" /> : null}
            Finish with rating
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal show={showHardcoverCandidates} onHide={() => setShowHardcoverCandidates(false)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Review Hardcover Matches</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {hardcoverCandidates.length === 0 ? (
            <Alert variant="info">No candidates were returned by Hardcover.</Alert>
          ) : (
            <ListGroup>
              {hardcoverCandidates.map(candidate => (
                <ListGroup.Item key={candidate.bookId} className="d-flex justify-content-between align-items-start gap-3">
                  <div>
                    <h6 className="mb-1">{candidate.title}</h6>
                    <div className="text-muted small">
                      {candidate.author && <>Author: {candidate.author} </>}
                      {candidate.pages && <>| Pages: {candidate.pages} </>}
                      {candidate.isbn13 && <>| ISBN-13: {candidate.isbn13} </>}
                      | Confidence: {Math.round((candidate.score || 0) * 100)}%
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleApplyHardcoverCandidate(candidate)}
                    disabled={hardcoverLoading}
                  >
                    Use This Match
                  </Button>
                </ListGroup.Item>
              ))}
            </ListGroup>
          )}
        </Modal.Body>
      </Modal>

      {/* Edit Book Modal */}
      <Modal show={showEditBookModal} onHide={handleCloseModals}>
        <Modal.Header closeButton>
          <Modal.Title>Edit Book Title</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalError && <Alert variant="danger">{modalError}</Alert>}
          <Form>
            <Form.Group className="mb-3" controlId="editBookTitle">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                value={editingBook?.title || ''}
                onChange={(e) => setEditingBook(prev => ({ ...prev, title: e.target.value }))}
                required
                disabled={modalLoading}
              />
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModals} disabled={modalLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleBookUpdate} disabled={modalLoading}>
            {modalLoading ? <Spinner size="sm" animation="border" /> : 'Save Changes'}
          </Button>
        </Modal.Footer>
      </Modal>

      {/* Edit Text Modal */}
      <Modal show={showEditTextModal} onHide={handleCloseModals} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>Edit Text Part</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {modalError && <Alert variant="danger">{modalError}</Alert>}
          {editingText && (
            <Form>
              <Form.Group className="mb-3" controlId="editTextTitle">
                <Form.Label>Title</Form.Label>
                <Form.Control
                  type="text"
                  value={editingText.title}
                  onChange={(e) => setEditingText(prev => ({ ...prev, title: e.target.value }))}
                  required
                  disabled={modalLoading}
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId="editTextContent">
                <Form.Label>Content</Form.Label>
                <Form.Control
                  as="textarea"
                  rows={10}
                  value={editingText.content}
                  onChange={(e) => setEditingText(prev => ({ ...prev, content: e.target.value }))}
                  required
                  disabled={modalLoading}
                />
              </Form.Group>
              <Form.Group className="mb-3" controlId="editTextTag">
                <Form.Label>Tag (Optional)</Form.Label>
                <Form.Control
                  type="text"
                  value={editingText.tag}
                  onChange={(e) => setEditingText(prev => ({ ...prev, tag: e.target.value }))}
                  maxLength="100"
                  disabled={modalLoading}
                />
              </Form.Group>
            </Form>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseModals} disabled={modalLoading}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleTextUpdate} disabled={modalLoading}>
            {modalLoading ? <Spinner size="sm" animation="border" /> : 'Save Changes'}
          </Button>
        </Modal.Footer>
      </Modal>

    </Container>
  );
};

// Star rating picker — 1-5 stars with half-star precision (0.5 increments).
// Click a star or its left half to set the rating; clicking the currently
// active value clears it back to "no rating".
const StarRatingPicker = ({ value, onChange, disabled }) => {
  const stars = [1, 2, 3, 4, 5];
  const handleClick = (selected) => {
    if (disabled) return;
    onChange(value === selected ? null : selected);
  };

  const renderStar = (i) => {
    const fullThreshold = i;
    const halfThreshold = i - 0.5;
    let icon = 'bi-star';
    if (value != null && value >= fullThreshold) icon = 'bi-star-fill';
    else if (value != null && value >= halfThreshold) icon = 'bi-star-half';

    return (
      <span
        key={i}
        role="presentation"
        style={{
          position: 'relative',
          display: 'inline-block',
          width: '1.6rem',
          fontSize: '1.6rem',
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: '#ffc107',
          lineHeight: 1,
        }}
      >
        <i className={`bi ${icon}`} aria-hidden="true"></i>
        {/* Left half-star clickable region */}
        <button
          type="button"
          aria-label={`Rate ${halfThreshold} of 5`}
          disabled={disabled}
          onClick={() => handleClick(halfThreshold)}
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: '50%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
        {/* Right full-star clickable region */}
        <button
          type="button"
          aria-label={`Rate ${fullThreshold} of 5`}
          disabled={disabled}
          onClick={() => handleClick(fullThreshold)}
          style={{
            position: 'absolute',
            left: '50%',
            top: 0,
            width: '50%',
            height: '100%',
            background: 'transparent',
            border: 'none',
            padding: 0,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        />
      </span>
    );
  };

  return (
    <div className="d-flex align-items-center gap-2">
      <div>{stars.map(renderStar)}</div>
      <span className="text-muted small">
        {value == null ? 'No rating' : `${value} / 5`}
      </span>
    </div>
  );
};

export default BookDetail;