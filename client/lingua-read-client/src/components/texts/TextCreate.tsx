import React, { useState, useEffect } from 'react';
import { Container, Form, Button, Card, Alert, Spinner } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { createText, getLanguages } from '../../utils/api';

// Shape of items returned by getLanguages() — older /translation/languages
// endpoint that returns short id+name pairs.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LanguageOption = { id: number | string; name: string;[key: string]: any };

const TextCreate = () => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [languageId, setLanguageId] = useState<string | number>('');
  const [languages, setLanguages] = useState<LanguageOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingLanguages, setLoadingLanguages] = useState(true);

  const navigate = useNavigate();

  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const data = (await getLanguages()) as LanguageOption[];
        setLanguages(data);
        if (data.length > 0) {
          setLanguageId(data[0].id);
        }
      } catch {
        setError('Failed to load languages. Please try again later.');
      } finally {
        setLoadingLanguages(false);
      }
    };

    fetchLanguages();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!title.trim()) {
      setError('Please enter a title');
      return;
    }
    
    if (!content.trim()) {
      setError('Please enter some content');
      return;
    }
    
    if (!languageId) {
      setError('Please select a language');
      return;
    }
    
    setLoading(true);
    setError('');
    
    try {
      const newText = await createText(title, content, languageId);
      navigate(`/texts/${newText.textId}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : '';
      setError(message || 'Failed to create text. Please try again.');
      setLoading(false);
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

  return (
    <Container className="py-5">
      <Card className="shadow-sm">
        <Card.Body className="p-4">
          <h2 className="mb-4">Add New Text</h2>
          
          {error && <Alert variant="danger">{error}</Alert>}
          
          <Form onSubmit={handleSubmit}>
            <Form.Group className="mb-3" controlId="title">
              <Form.Label>Title</Form.Label>
              <Form.Control
                type="text"
                placeholder="Enter a title for your text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                required
              />
            </Form.Group>

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
                    <option key={language.id} value={language.id}>
                      {language.name}
                    </option>
                  ))
                )}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-4" controlId="content">
              <Form.Label>Text Content</Form.Label>
              <Form.Control
                as="textarea"
                rows={10}
                placeholder="Paste or type your text here"
                value={content}
                onChange={(e) => setContent(e.target.value)}
                required
              />
              <Form.Text className="text-muted">
                Paste text in your target language that you want to read and learn from.
              </Form.Text>
            </Form.Group>

            <div className="d-grid gap-2">
              <Button variant="primary" type="submit" disabled={loading || languages.length === 0}>
                {loading ? 'Creating...' : 'Create Text'}
              </Button>
            </div>
          </Form>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default TextCreate; 