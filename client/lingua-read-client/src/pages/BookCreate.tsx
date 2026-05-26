import React, { useState, useEffect, useContext } from 'react';
import { Container, Form, Button, Card, Alert, Spinner, Row, Col, Tabs, Tab, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { createBook, uploadBook, getAllLanguages, uploadAudiobookTracks, previewBookSplit, previewManualSplit } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';
import type { Language } from '../utils/api/languages';
import SplitPreview from '../components/library/SplitPreview';

const BookCreate = () => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState('');
  const [languageId, setLanguageId] = useState('');
  const [tags, setTags] = useState(''); // comma-separated string
  const [file, setFile] = useState<File | null>(null);
  const [activeTab, setActiveTab] = useState('manual');
  const [splitMethod, setSplitMethod] = useState('chapter'); // Default to Chapter Splitting
  const [maxSegmentSize, setMaxSegmentSize] = useState(3000);
  const [subSplitOversized, setSubSplitOversized] = useState(true); // Default sub-split to true for better readability
  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [error, setError] = useState('');
  const [loadingLanguages, setLoadingLanguages] = useState(true);
  const [audioFiles, setAudioFiles] = useState<File[]>([]);
  const [audioUploadError, setAudioUploadError] = useState('');
  const navigate = useNavigate();
  const { settings: userSettings } = useContext(SettingsContext);
  const [loadingText, setLoadingText] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);

  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const data = await getAllLanguages();
        setLanguages(data);

        const defaultLangId = userSettings?.defaultLanguageId;

        if (data.length > 0) {
          const found = data.find(l => l.languageId === defaultLangId);
          if (found && found.languageId != null) {
            setLanguageId(found.languageId.toString());
          } else if (data[0].languageId != null) {
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
  }, [userSettings?.defaultLanguageId]);

  const handlePreviewSplit = async () => {
    if (!title.trim() && activeTab === 'manual') {
      setError('Please enter a title');
      return;
    }

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

    setPreviewLoading(true);
    setError('');

    try {
      let preview;
      if (activeTab === 'manual') {
        preview = await previewManualSplit(
          title,
          content,
          splitMethod,
          maxSegmentSize,
          subSplitOversized
        );
      } else {
        const formData = new FormData();
        formData.append('File', file!);
        formData.append('LanguageId', languageId);
        formData.append('SplitMethod', splitMethod);
        formData.append('MaxSegmentSize', maxSegmentSize.toString());
        formData.append('SubSplitOversized', subSplitOversized.toString());
        if (title) formData.append('TitleOverride', title);
        
        preview = await previewBookSplit(formData);
      }
      setPreviewData(preview);
      setShowPreviewModal(true);
    } catch (err: any) {
      setError(err.message || 'Failed to generate split preview. Please try again.');
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleConfirmSplit = async (chapterTitles: string[], groupings: number[][]) => {
    setShowPreviewModal(false);
    await executeSubmit(chapterTitles, groupings);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    await executeSubmit();
  };

  const executeSubmit = async (chapterTitles: string[] = [], chapterGroupings: number[][] = []) => {
    if (!title.trim() && activeTab === 'manual') {
      setError('Please enter a title');
      return;
    }

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

    const tagsArray = tags.split(',').map(tag => tag.trim()).filter(tag => tag);

    try {
      let newBook;
      if (activeTab === 'manual') {
        newBook = await createBook(
          title,
          description,
          parseInt(String(languageId), 10),
          content,
          splitMethod,
          parseInt(String(maxSegmentSize), 10),
          tagsArray,
          subSplitOversized,
          chapterTitles,
          chapterGroupings
        );
      } else {
        const formData = new FormData();
        formData.append('File', file!);
        formData.append('LanguageId', languageId);
        formData.append('SplitMethod', splitMethod);
        formData.append('MaxSegmentSize', maxSegmentSize.toString());
        formData.append('SubSplitOversized', subSplitOversized.toString());
        tagsArray.forEach(tag => formData.append('Tags', tag));
        if (title) formData.append('TitleOverride', title);
        chapterTitles.forEach(t => formData.append('ChapterTitles', t));
        if (chapterGroupings && chapterGroupings.length > 0) {
          formData.append('ChapterGroupingsJson', JSON.stringify(chapterGroupings));
        }

        newBook = await uploadBook(formData, (progress) => {
          setUploadProgress(progress);
        });
      }

      let audioUploadFailed = false;
      if (audioFiles.length > 0 && newBook?.bookId) {
        setAudioUploadError('');
        setLoadingText(`Uploading ${audioFiles.length} audio track${audioFiles.length > 1 ? 's' : ''}...`);
        setUploadProgress(0);

        const audioFormData = new FormData();
        audioFiles.forEach(f => audioFormData.append('Files', f));
        try {
          await uploadAudiobookTracks(newBook.bookId, audioFormData, (progress) => {
            setUploadProgress(progress);
          });
        } catch (audioErr) {
          console.error('Failed to upload audio tracks:', audioErr);
          audioUploadFailed = true;
        }
      }

      navigate(
        `/books/${newBook.bookId}`,
        audioUploadFailed ? { state: { audioUploadWarning: 'Failed to upload audio tracks. You can retry here.' } } : undefined
      );

    } catch (err: unknown) {
      const e = err as { response?: { data?: { message?: string } }; message?: string };
      const errorMsg = e.response?.data?.message || e.message || `Failed to ${activeTab === 'manual' ? 'create' : 'upload'} book. Please try again.`;
      setError(errorMsg);
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

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      setFile(e.target.files[0]);
      if (!title.trim()) {
        setTitle(e.target.files[0].name.replace(/\.[^/.]+$/, ""));
      }
    } else {
      setFile(null);
    }
  };

  const handleAudioFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setAudioFiles(Array.from(e.target.files));
      setAudioUploadError('');
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
                    required={activeTab === 'manual'} // file upload uses filename if left blank
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
                        <option key={language.languageId} value={language.languageId?.toString()}>
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

            <Row className="mb-3 align-items-center">
              <Col md={splitMethod === 'chapter' ? 4 : 6}>
                <Form.Group controlId="splitMethod">
                  <Form.Label>Split Method</Form.Label>
                  <Form.Select
                    value={splitMethod}
                    onChange={(e) => setSplitMethod(e.target.value)}
                    required
                  >
                    <option value="chapter">By Chapters (Auto-detect)</option>
                    <option value="paragraph">By Paragraphs</option>
                    <option value="sentence">By Sentences</option>
                    <option value="length">By Character Length</option>
                  </Form.Select>
                  <Form.Text className="text-muted">
                    Choose how to split the book content. Chapter splitting is highly recommended.
                  </Form.Text>
                </Form.Group>
              </Col>

              {splitMethod === 'chapter' && (
                <Col md={4}>
                  <Form.Group controlId="subSplitOversized" className="pt-3">
                    <Form.Check
                      type="checkbox"
                      id="checkbox-subsplit"
                      label="Sub-split large chapters"
                      checked={subSplitOversized}
                      onChange={(e) => setSubSplitOversized(e.target.checked)}
                    />
                    <Form.Text className="text-muted block">
                      Splits oversized chapters into readable chunks.
                    </Form.Text>
                  </Form.Group>
                </Col>
              )}

              <Col md={splitMethod === 'chapter' ? 4 : 6}>
                <Form.Group controlId="maxSegmentSize">
                  <Form.Label>{splitMethod === 'chapter' ? 'Maximum Chapter Segment Size' : 'Maximum Size Per Section'}</Form.Label>
                  <Form.Control
                    type="number"
                    min="500"
                    max="50000"
                    value={maxSegmentSize}
                    onChange={(e) => setMaxSegmentSize(parseInt(e.target.value, 10) || 500)}
                    required
                  />
                  <Form.Text className="text-muted">
                    Max characters per segment (500-50,000).
                  </Form.Text>
                </Form.Group>
              </Col>
            </Row>

            <Tabs
              activeKey={activeTab}
              onSelect={(k) => setActiveTab(k ?? 'manual')}
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
                    required={activeTab === 'manual'}
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
                    required={activeTab === 'upload'}
                  />
                  <Form.Text className="text-muted">
                    Upload a .txt or .epub file. Content will be extracted and split.
                  </Form.Text>
                </Form.Group>
              </Tab>
            </Tabs>

            <Form.Group controlId="audiobookFiles" className="mb-4 mt-3">
              <Form.Label>Upload Audiobook Tracks (Optional)</Form.Label>
              <Form.Control
                type="file"
                multiple
                accept=".mp3,.m4b,.m4a,.ogg,.flac,.wav"
                onChange={handleAudioFileChange}
                disabled={loading}
              />
              <Form.Text className="text-muted">
                Select one or more audio files (MP3, M4B, M4A, OGG, FLAC, WAV) if you want to add an audiobook component now.
              </Form.Text>
              {audioUploadError && <Alert variant="warning" className="mt-2">{audioUploadError}</Alert>}
            </Form.Group>

            <div className="d-grid gap-2">
              <Button
                variant="primary"
                type="submit"
                disabled={loading || previewLoading || languages.length === 0 || (activeTab === 'upload' && !file)}
              >
                {loading ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    {loadingText || (activeTab === 'upload' ? 'Uploading...' : 'Creating...')}
                  </>
                ) : `Create Book ${activeTab === 'upload' ? 'from File' : 'from Text'}`}
              </Button>

              <Button
                variant="outline-primary"
                onClick={handlePreviewSplit}
                disabled={loading || previewLoading || languages.length === 0 || (activeTab === 'upload' && !file)}
              >
                {previewLoading ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    Analyzing Book...
                  </>
                ) : 'Preview Chapters & Customize'}
              </Button>

              {loading && activeTab === 'upload' && (
                <div className="mt-2">
                  <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} animated />
                </div>
              )}
              {loading && audioFiles.length > 0 && uploadProgress > 0 && (
                <div className="mt-2">
                  <ProgressBar now={uploadProgress} label={`${uploadProgress}%`} variant="info" animated />
                </div>
              )}
              <Button
                variant="outline-secondary"
                onClick={() => navigate('/books')}
                disabled={loading || previewLoading}
              >
                Cancel
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>

      <SplitPreview
        show={showPreviewModal}
        onHide={() => setShowPreviewModal(false)}
        previewData={previewData}
        onConfirm={handleConfirmSplit}
        submitting={loading}
      />
    </Container>
  );
};

export default BookCreate;