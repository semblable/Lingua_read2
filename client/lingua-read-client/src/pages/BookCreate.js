import React, { useState, useEffect, useContext } from 'react'; // Added useContext
import { Container, Form, Button, Card, Alert, Spinner, Row, Col, Tabs, Tab, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { createBook, uploadBook, getAllLanguages, uploadAudiobookTracks } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext'; // Import SettingsContext

const BookCreate = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [languageId, setLanguageId] = useState('');
  const [tags, setTags] = useState(''); // Renamed from tag, expect comma-separated string
  const [file, setFile] = useState(null); // State for uploaded file
  const [activeTab, setActiveTab] = useState('manual'); // State for active tab
  const [splitMethod, setSplitMethod] = useState('paragraph');
  const [maxSegmentSize, setMaxSegmentSize] = useState(3000);
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingLanguages, setLoadingLanguages] = useState(true);
  const [audioFiles, setAudioFiles] = useState([]); // State for audio files
  const [audioUploadError, setAudioUploadError] = useState(''); // Separate error for audio upload
  const navigate = useNavigate();
  const { settings: userSettings } = useContext(SettingsContext); // Get settings from context
  const [loadingText, setLoadingText] = useState(''); // New state for feedback
  const [uploadProgress, setUploadProgress] = useState(0); // Progress state 0-100

  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const data = await getAllLanguages();
        setLanguages(data);

        // Use default language from context if available and valid
        const defaultLangId = userSettings?.defaultLanguageId;

        if (data.length > 0) {
          const found = data.find(l => l.languageId === defaultLangId);
          if (found) {
            setLanguageId(found.languageId.toString());
          } else {
            // Fallback to first language if default not found or not set
            setLanguageId(data[0].languageId.toString());
          }
        }
      } catch (err) {
        setError('Failed to load languages. Please try again later.');
      } finally {
        setLoadingLanguages(false);
      }
    };

    fetchLanguages();
    // Re-run if userSettings context changes (e.g., after initial load)
  }, [userSettings?.defaultLanguageId]);

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }

    // Content/File validation depends on the active tab
    if (activeTab === 'manual' && !content.trim()) {
      setError('Please enter book content');
      return;
    }
    if (activeTab === 'upload' && !file) {
      setError('Please select a file to upload');
      return;
    }

    if (!languageId) {
      setError('Please select a language');
      return;
    }

    setLoading(true);
    setLoadingText(activeTab === 'manual' ? 'Creating book...' : 'Uploading book...');
    setError('');

    // Prepare tags array
    const tagsArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);

    try {
      let newBook;
      if (activeTab === 'manual') {
        newBook = await createBook(
          title,
          description,
          parseInt(languageId, 10),
          content,
          splitMethod,
          parseInt(maxSegmentSize, 10),
          tagsArray // Pass tags array
        );
      } else { // activeTab === 'upload'
        const formData = new FormData();
        formData.append('File', file);
        formData.append('LanguageId', languageId);
        formData.append('SplitMethod', splitMethod);
        formData.append('MaxSegmentSize', maxSegmentSize.toString());
        // Append tags individually if backend expects multiple entries, or join if it expects a single string/array
        tagsArray.forEach(tag => formData.append('Tags', tag));
        // Optional: Add TitleOverride if needed, otherwise backend uses filename
        // formData.append('TitleOverride', title);

        newBook = await uploadBook(formData, (progress) => {
          setUploadProgress(progress);
        });
      }

      // --- Start: Audiobook Upload Logic ---
      if (audioFiles.length > 0 && newBook?.bookId) {
        console.log(`Book created/uploaded (ID: ${newBook.bookId}), now uploading audio tracks...`);
        setAudioUploadError(''); // Clear previous audio error

        let successCount = 0;
        let failCount = 0;
        const totalFiles = audioFiles.length;

        for (let i = 0; i < totalFiles; i++) {
          setLoadingText(`Uploading audio track ${i + 1} of ${totalFiles}...`);
          setUploadProgress(0); // Reset progress for each file

          const audioFormData = new FormData();
          audioFormData.append('Files', audioFiles[i]);

          try {
            console.log(`Uploading audio file ${i + 1}/${totalFiles}: ${audioFiles[i].name}`);
            await uploadAudiobookTracks(newBook.bookId, audioFormData, (progress) => {
              setUploadProgress(progress);
            });
            successCount++;
          } catch (audioErr) {
            console.error(`Failed to upload ${audioFiles[i].name}:`, audioErr);
            failCount++;
          }
        }

        if (failCount > 0) {
          setAudioUploadError(`Uploaded ${successCount} tracks, but failed ${failCount}. You can retry in the book details.`);
        } else {
          console.log(`All ${successCount} audio tracks uploaded successfully.`);
        }
      }
      // --- End: Audiobook Upload Logic ---

      // Navigate even if audio upload failed, but maybe show a message?
      // We could pass state via navigation if needed: navigate(`/books/${newBook.bookId}`, { state: { audioUploadError: audioUploadError } });
      navigate(`/books/${newBook.bookId}`);

    } catch (err) {
      const errorMsg = err.response?.data?.message || err.message || `Failed to ${activeTab === 'manual' ? 'create' : 'upload'} book. Please try again.`;
      setError(errorMsg);
      // Don't proceed to audio upload if book creation failed
    } finally {
      setLoading(false);
      setLoadingText('');
    }
  };

  if (loadingLanguages) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading languages...</span>
        </Spinner>
      </Container>
    );
  }

  const handleFileChange = (e) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      // Optionally set title from filename if title is empty
      if (!title.trim()) {
        setTitle(e.target.files[0].name.replace(/\.[^/.]+$/, "")); // Remove extension
      }
    } else {
      setFile(null);
    }
  };

  const handleAudioFileChange = (e) => {
    if (e.target.files) {
      setAudioFiles(Array.from(e.target.files)); // Store as array
      setAudioUploadError(''); // Clear audio error on new selection
    } else {
      setAudioFiles([]);
    }
  };

  return (
    <Container className="py-5">
      <Card className="shadow-sm">
        <Card.Body className="p-4">
          <h2 className="mb-4">Create New Book</h2>

          {error && <Alert variant="danger">{error}</Alert>}

          {/* Use a single form, handle submit based on active tab */}
          <Form onSubmit={handleSubmit}>
            <Row>
              <Col md={6}>
                <Form.Group className="mb-3" controlId="title">
                  <Form.Label>Book Title</Form.Label>
                  <Form.Control
                    type="text"
                    placeholder="Enter a title for your book"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    required
                  />
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group className="mb-3" controlId="language">
                  <Form.Label>Language</Form.Label>
                  <Form.Select
                    value={languageId}
                    onChange={(e) => setLanguageId(e.target.value)}
                    required
                  >
                    {languages.length === 0 ? (
                      <option value="">No languages available</option>
                    ) : (
                      languages.map((language) => (
                        <option key={language.languageId} value={language.languageId.toString()}>
                          {language.name}
                        </option>
                      ))
                    )}
                  </Form.Select>
                </Form.Group>
              </Col>
            </Row>

            <Form.Group className="mb-3" controlId="description">
              <Form.Label>Description (Optional)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="Brief description of the book"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </Form.Group>

            {/* Tags Input */}
            <Form.Group className="mb-3" controlId="tags">
              <Form.Label>Tags (Optional)</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter tags separated by commas"
                value={tags}
                onChange={(e) => setTags(e.target.value)}
              />
              <Form.Text className="text-muted">
                Separate multiple tags with commas (e.g., fiction, sci-fi, classic).
              </Form.Text>
            </Form.Group>

            <Row className="mb-3">
              <Col md={6}>
                <Form.Group controlId="splitMethod">
                  <Form.Label>Split Method</Form.Label>
                  <Form.Select
                    value={splitMethod}
                    onChange={(e) => setSplitMethod(e.target.value)}
                    required
                  >
                    <option value="paragraph">By Paragraphs</option>
                    <option value="sentence">By Sentences</option>
                    <option value="length">By Character Length</option>
                  </Form.Select>
                  <Form.Text className="text-muted">
                    Choose how to split the book content. Applies to both manual input and file uploads.
                  </Form.Text>
                </Form.Group>
              </Col>

              <Col md={6}>
                <Form.Group controlId="maxSegmentSize">
                  <Form.Label>Maximum Size Per Section</Form.Label>
                  <Form.Control
                    type="number"
                    min="500"
                    max="50000"
                    value={maxSegmentSize}
                    onChange={(e) => setMaxSegmentSize(parseInt(e.target.value, 10) || 500)} // Ensure it's a number
                    required
                  />
                  <Form.Text className="text-muted">
                    Max characters per section (500-50,000). Applies to both methods.
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>

            {/* Tabs for Manual Input / Upload */}
            <Tabs
              activeKey={activeTab}
              onSelect={(k) => setActiveTab(k)}
              className="mb-3"
              id="book-create-tabs"
            >
              <Tab eventKey="manual" title="Enter Text Manually">
                <Form.Group className="mb-4" controlId="content">
                  <Form.Label>Book Content</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={12}
                    placeholder="Paste or type your book content here"
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    required={activeTab === 'manual'} // Required only if this tab is active
                  />
                  <Form.Text className="text-muted">
                    Paste the full text of your book. It will be split based on the method above.
                  </Form.Text>
                </Form.Group>
              </Tab>
              <Tab eventKey="upload" title="Upload File (.txt, .epub)">
                <Form.Group controlId="formFile" className="mb-3 mt-3">
                  <Form.Label>Select Book File</Form.Label>
                  <Form.Control
                    type="file"
                    accept=".txt,.epub"
                    onChange={handleFileChange}
                    required={activeTab === 'upload'} // Required only if this tab is active
                  />
                  <Form.Text className="text-muted">
                    Upload a .txt or .epub file. Content will be extracted and split.
                  </Form.Text>
                </Form.Group>
              </Tab>
            </Tabs>

            {/* Audiobook Upload Input */}
            <Form.Group controlId="audiobookFiles" className="mb-4 mt-3">
              <Form.Label>Upload Audiobook Tracks (Optional)</Form.Label>
              <Form.Control
                type="file"
                multiple
                accept=".mp3"
                onChange={handleAudioFileChange}
                disabled={loading}
              />
              <Form.Text className="text-muted">
                Select one or more MP3 files if you want to add an audiobook component now. You can also add them later.
              </Form.Text>
              {audioUploadError && <Alert variant="warning" className="mt-2">{audioUploadError}</Alert>}
            </Form.Group>
            <div className="d-grid gap-2">
              {/* Submit button outside tabs */}
              <Button variant="primary" type="submit" disabled={loading || languages.length === 0 || (activeTab === 'upload' && !file)}>
                {loading ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    {loadingText || (activeTab === 'upload' ? 'Uploading...' : 'Creating...')}
                  </>
                ) : `Create Book ${activeTab === 'upload' ? 'from File' : 'from Text'}`}
              </Button>
              {/* Progress Bar for Uploads */}
              {loading && activeTab === 'upload' && (
                <div className="mt-2">
                  <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} animated />
                </div>
              )}
              {/* Progress Bar for Audio Uploads (Manual Tab too if audio selected) */}
              {loading && audioFiles.length > 0 && uploadProgress > 0 && (
                <div className="mt-2">
                  <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} variant="info" animated />
                </div>
              )}
              <Button
                variant="outline-secondary"
                onClick={() => navigate('/books')}
                disabled={loading}
              >
                Cancel
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default BookCreate; 