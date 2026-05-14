import React, { useState, useEffect, useContext } from 'react'; // Added useContext
import { Container, Form, Button, Card, Alert, Spinner, Tab, Tabs, Row, Col } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { createText, getAllLanguages, generateStory } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext'; // Import SettingsContext

const TextCreate = () => {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [languageId, setLanguageId] = useState('');
  const [tag, setTag] = useState(''); // Add state for tag
  const [languages, setLanguages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [loadingLanguages, setLoadingLanguages] = useState(true);
  
  // For story generation
  const [storyPrompt, setStoryPrompt] = useState('');
  const [storyLevel, setStoryLevel] = useState('intermediate');
  const [maxLength, setMaxLength] = useState(500);
  const [generatingStory, setGeneratingStory] = useState(false);
  const [activeTab, setActiveTab] = useState('manual');
  
  const navigate = useNavigate();

  const { settings: userSettings } = useContext(SettingsContext); // Get settings from context

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
      // Pass the tag (or null if empty) to the createText function
      const newText = await createText(title, content, parseInt(languageId, 10), tag || null);
      navigate(`/texts/${newText.textId}`);
    } catch (err) {
      setError(err.message || 'Failed to create text. Please try again.');
      setLoading(false);
    }
  };

  const handleGenerateStory = async (e) => {
    e.preventDefault();
    
    if (!storyPrompt.trim()) {
      setError('Please enter a story prompt');
      return;
    }
    
    if (!languageId) {
      setError('Please select a language');
      return;
    }
    
    setGeneratingStory(true);
    setError('');
    
    try {
      // Find the selected language name from the ID
      const selectedLanguage = languages.find(lang => lang.languageId.toString() === languageId);
      if (!selectedLanguage) {
        throw new Error('Selected language not found');
      }
      
      const result = await generateStory(
        storyPrompt, 
        selectedLanguage.name,
        storyLevel,
        maxLength
      );
      
      if (result?.generatedStory) {
        setContent(result.generatedStory);
        // Generate a title based on the prompt
        if (!title) {
          setTitle(storyPrompt.length > 50 ? `${storyPrompt.substring(0, 47)}...` : storyPrompt);
        }
      } else {
        throw new Error('Failed to generate story');
      }
    } catch (err) {
      setError(err.message || 'Failed to generate story. Please try again.');
    } finally {
      setGeneratingStory(false);
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
                  <option key={language.languageId} value={language.languageId}>
                    {language.name}
                  </option>
                ))
              )}
            </Form.Select>
          </Form.Group>

          <Form.Group className="mb-3" controlId="tag">
            <Form.Label>Tag (Optional)</Form.Label>
            <Form.Control
              type="text"
              placeholder="Enter a tag (e.g., news, fiction, chapter 1)"
              value={tag}
              onChange={(e) => setTag(e.target.value)}
              maxLength={100} // Match backend constraint
            />
          </Form.Group>
          
          <Tabs
            activeKey={activeTab}
            onSelect={(k) => setActiveTab(k)}
            className="mb-3"
          >
            <Tab eventKey="manual" title="Enter Text Manually">
              <Form onSubmit={handleSubmit}>
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
                    {loading ? <Spinner animation="border" size="sm" /> : null} {loading ? 'Creating...' : 'Create Text'}
                  </Button>
                </div>
              </Form>
            </Tab>
            
            <Tab eventKey="generate" title="Generate Story">
              <Form onSubmit={handleGenerateStory}>
                <Form.Group className="mb-3" controlId="storyPrompt">
                  <Form.Label>Story Prompt</Form.Label>
                  <Form.Control
                    as="textarea"
                    rows={3}
                    placeholder="Describe what kind of story you want to generate"
                    value={storyPrompt}
                    onChange={(e) => setStoryPrompt(e.target.value)}
                    required
                  />
                  <Form.Text className="text-muted">
                    Describe a storyline, characters, setting, or topic for your generated story.
                  </Form.Text>
                </Form.Group>
                
                <Row className="mb-3">
                  <Col md={6}>
                    <Form.Group controlId="storyLevel">
                      <Form.Label>Language Level</Form.Label>
                      <Form.Select
                        value={storyLevel}
                        onChange={(e) => setStoryLevel(e.target.value)}
                      >
                        <option value="beginner">Beginner</option>
                        <option value="intermediate">Intermediate</option>
                        <option value="advanced">Advanced</option>
                      </Form.Select>
                      <Form.Text className="text-muted">
                        Choose the language proficiency level for the generated text.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="maxLength">
                      <Form.Label>Approximate Length (words)</Form.Label>
                      <Form.Control
                        type="number"
                        min={100}
                        max={2000}
                        value={maxLength}
                        onChange={(e) => setMaxLength(parseInt(e.target.value, 10))}
                      />
                      <Form.Text className="text-muted">
                        Choose between 100-2000 words.
                      </Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
                
                <div className="d-grid gap-2 mb-4">
                  <Button 
                    variant="info" 
                    type="submit" 
                    disabled={generatingStory || languages.length === 0}
                  >
                    {generatingStory ? <Spinner animation="border" size="sm" /> : null} {generatingStory ? 'Generating...' : 'Generate Story'}
                  </Button>
                </div>
                
                {content && (
                  <>
                    <Form.Group className="mb-4" controlId="generatedContent">
                      <Form.Label>Generated Story Preview</Form.Label>
                      <div className="p-3 border rounded story-preview-area">
                        <p style={{ whiteSpace: 'pre-wrap' }}>{content}</p>
                      </div>
                    </Form.Group>
                    
                    <div className="d-grid gap-2">
                      <Button 
                        variant="primary" 
                        onClick={handleSubmit} 
                        disabled={loading || !content}
                      >
                        {loading ? <Spinner animation="border" size="sm" /> : null} {loading ? 'Creating...' : 'Create Text with Generated Story'}
                      </Button>
                    </div>
                  </>
                )}
              </Form>
            </Tab>
          </Tabs>
        </Card.Body>
      </Card>
    </Container>
  );
};

export default TextCreate; 