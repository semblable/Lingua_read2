import React, { useState, useEffect, useCallback } from 'react'; // Add useCallback
import { Container, Row, Col, Card, Button, Alert, Spinner, ListGroup, Badge, ProgressBar, Modal, Form } from 'react-bootstrap'; // Add Form
import { useParams, useNavigate, Link } from 'react-router-dom';
import { getBook, finishBook, updateBook, deleteBook, getText, updateText, deleteText, uploadAudiobookTracks } from '../utils/api'; // Import new API functions + uploadAudiobookTracks
import { formatDate, /*calculateReadingTime*/ } from '../utils/helpers'; // Removed unused calculateReadingTime
// Removed AudiobookPlayer import
const BookDetail = () => {
  const { bookId } = useParams();
  const [book, setBook] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const [finishingBook, setFinishingBook] = useState(false);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [stats, setStats] = useState(null);

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

  const handleFinishBook = async () => {
    if (window.confirm('Are you sure you want to mark this book as finished? This will mark all words in the book as known.')) {
      setFinishingBook(true);
      try {
        const updatedStats = await finishBook(bookId);
        setStats(updatedStats);
        setShowStatsModal(true);
        
        // Update book with finished status
        setBook(prev => ({
          ...prev,
          isFinished: true
        }));
      } catch (err) {
        alert(`Failed to mark book as finished: ${err.message}`);
      } finally {
        setFinishingBook(false);
      }
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
      setUploadError('Please select one or more MP3 files to upload.');
      return;
    }

    setUploadingAudio(true);
    setUploadError('');
    setUploadSuccess('');

    const formData = new FormData();
    selectedFiles.forEach(file => {
      formData.append('Files', file); // Match the backend DTO property name 'Files'
    });

    try {
      await uploadAudiobookTracks(bookId, formData);
      setUploadSuccess(`Successfully uploaded ${selectedFiles.length} audio track(s).`);
      setSelectedFiles([]); // Clear selection after successful upload
      // Refresh book data to show the new tracks
      await fetchBook(); // <-- Uncommented this line
    } catch (err) {
      setUploadError(err.message || 'Failed to upload audiobook tracks.');
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
      <div className="d-flex justify-content-between align-items-center mb-4">
        <div>
          <h1 className="mb-1">{book.title}</h1>
          <p className="text-muted mb-2">
            Language: {book.languageName} | 
            Parts: {book.parts.length} | 
            Added: {formatDate(book.createdAt)}
          </p>
          {book.description && (
            <p className="lead">{book.description}</p>
          )}
        </div>
        <div className="d-flex flex-column gap-2">
          {/* Add prominent reading button */}
          {book.parts.length > 0 && (
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
                onClick={() => navigate(`/texts/${book.parts[0].textId}`)}
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
           {/* Add Edit/Delete Book Buttons */}
           <Button variant="outline-warning" size="sm" onClick={handleOpenEditBookModal} className="ms-2">Edit Book</Button>
           <Button variant="outline-danger" size="sm" onClick={handleBookDelete} className="ms-2">Delete Book</Button>
        </div>
      </div>

      <Card className="shadow-sm mb-4">
        <Card.Header as="h5">Book Sections</Card.Header>
        <ListGroup variant="flush">
          {book.parts.map((part, index) => (
            <ListGroup.Item 
              key={part.textId}
              className="d-flex justify-content-between align-items-center"
              action
              as={Link}
              to={`/texts/${part.textId}`}
            >
              <div>
                <h6 className="mb-0">{part.title}</h6>
                <small className="text-muted">Added: {formatDate(part.createdAt)}</small>
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
              <Form.Label>Upload MP3 Tracks</Form.Label>
              <Form.Control
                type="file"
                multiple
                accept=".mp3"
                onChange={handleFileChange}
                disabled={uploadingAudio}
              />
              <Form.Text className="text-muted">
                Select one or more MP3 files for the audiobook. They will be ordered based on upload sequence or filename (ensure consistent naming for correct order if needed).
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
          </Form>
        </Card.Body>
      </Card>

      {/* Removed Audiobook Player integration */}

      {book.parts.length === 0 && (
        <Alert variant="info">
          This book doesn't have any parts yet.
        </Alert>
      )}

      <div className="d-flex justify-content-between mb-4">
        {!book.isFinished && (
          <Button 
            variant="success" 
            onClick={handleFinishBook} 
            disabled={finishingBook}
          >
            {finishingBook ? <Spinner size="sm" animation="border" /> : null}
            {' '}
            Mark Book as Finished
          </Button>
        )}
      </div>

      {/* Stats Modal */}
      <Modal show={showStatsModal} onHide={() => setShowStatsModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Book Completed!</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {stats && (
            <div>
              <p className="mb-3">You've completed the book "<strong>{book.title}</strong>"!</p>
              <p className="mb-2">Progress:</p>
              <ProgressBar now={100} label={`100%`} className="mb-3" />
              
              <Row className="mb-3">
                <Col xs={6}>
                  <div className="d-flex flex-column align-items-center p-2 border rounded">
                    <div className="h2 mb-0">{stats.totalWords}</div>
                    <div>Total Words</div>
                  </div>
                </Col>
                <Col xs={6}>
                  <div className="d-flex flex-column align-items-center p-2 border rounded bg-success text-white">
                    <div className="h2 mb-0">{stats.knownWords}</div>
                    <div>Known Words</div>
                  </div>
                </Col>
              </Row>
              
              <p>All words in this book have been marked as known. Great job!</p>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="primary" onClick={() => setShowStatsModal(false)}>
            Close
          </Button>
        </Modal.Footer>
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

export default BookDetail; 