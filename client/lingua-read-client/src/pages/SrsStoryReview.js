import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Container, Card, Button, Spinner, Alert, Form, Row, Col, Badge, ProgressBar } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { getAllLanguages, generateSrsStory, submitSrsReview, getSrsStats } from '../utils/api';
import SrsWordPopover from '../components/SrsWordPopover';
import './SrsStoryReview.css';

const STATUS_LABELS = { 1: 'New', 2: 'Learning', 3: 'Familiar', 4: 'Advanced', 5: 'Known' };
const STATUS_VARIANTS = { 1: 'danger', 2: 'warning', 3: 'info', 4: 'primary', 5: 'success' };

const SrsStoryReview = () => {
  const navigate = useNavigate();

  // Setup state
  const [languages, setLanguages] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    localStorage.getItem('srsSelectedLanguage') || ''
  );
  const [statusFilter, setStatusFilter] = useState([1, 2, 3, 4, 5]);
  const [theme, setTheme] = useState('');
  const [maxWords, setMaxWords] = useState(15);
  const [maxLength, setMaxLength] = useState(400);

  // Session state
  const [phase, setPhase] = useState('setup'); // setup | loading | story | complete
  const [story, setStory] = useState('');
  const [targetWords, setTargetWords] = useState([]);
  const [usedWords, setUsedWords] = useState([]);
  const [reviewedWords, setReviewedWords] = useState(new Set());
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);

  // Popover state
  const [activeWord, setActiveWord] = useState(null);
  const [activeRef, setActiveRef] = useState(null);
  const [grading, setGrading] = useState(false);

  // Word refs for popover positioning
  const wordRefs = useRef({});

  useEffect(() => {
    const fetchLanguages = async () => {
      try {
        const data = await getAllLanguages();
        setLanguages(data);
      } catch (err) {
        console.error('Failed to load languages:', err);
      }
    };
    fetchLanguages();
  }, []);

  const loadStats = useCallback(async () => {
    if (!selectedLanguage) return;
    try {
      const data = await getSrsStats(selectedLanguage);
      setStats(data);
    } catch (err) {
      console.error('Failed to load stats:', err);
    }
  }, [selectedLanguage]);

  useEffect(() => { loadStats(); }, [loadStats]);

  const handleLanguageChange = (e) => {
    const langId = e.target.value;
    setSelectedLanguage(langId);
    localStorage.setItem('srsSelectedLanguage', langId);
  };

  const handleStatusFilterChange = (e) => {
    const val = parseInt(e.target.value);
    setStatusFilter(prev =>
      prev.includes(val) ? prev.filter(s => s !== val) : [...prev, val]
    );
  };

  const handleGenerate = async () => {
    if (!selectedLanguage) return;
    setError('');
    setPhase('loading');

    try {
      const result = await generateSrsStory(parseInt(selectedLanguage), {
        theme: theme || undefined,
        maxWords,
        maxLength,
        status: statusFilter
      });

      if (!result.story || result.targetWords.length === 0) {
        setError('No due words found for this language. Try standard review or come back later.');
        setPhase('setup');
        return;
      }

      setStory(result.story);
      setTargetWords(result.targetWords);
      setUsedWords(result.usedWords.map(w => w.toLowerCase()));
      setReviewedWords(new Set());
      setPhase('story');
    } catch (err) {
      setError(`Failed to generate story: ${err.message}`);
      setPhase('setup');
    }
  };

  const handleGrade = async (word, grade) => {
    setGrading(true);
    try {
      await submitSrsReview(word.srsCardReviewId, grade);
      setReviewedWords(prev => new Set([...prev, word.wordId]));
      setActiveWord(null);
      setActiveRef(null);

      // Check completion
      const usedTargetWords = targetWords.filter(tw =>
        usedWords.includes(tw.term.toLowerCase())
      );
      if (reviewedWords.size + 1 >= usedTargetWords.length) {
        setTimeout(() => setPhase('complete'), 500);
        loadStats();
      }
    } catch (err) {
      setError(`Failed to submit review: ${err.message}`);
    } finally {
      setGrading(false);
    }
  };

  const handleWordClick = (word, refKey) => {
    if (reviewedWords.has(word.wordId)) return;
    if (activeWord?.wordId === word.wordId) {
      setActiveWord(null);
      setActiveRef(null);
    } else {
      setActiveWord(word);
      setActiveRef(wordRefs.current[refKey]);
    }
  };

  // Tokenize story and match target words
  const renderStory = () => {
    if (!story) return null;

    // Build a lookup of target words that were actually used
    const wordLookup = {};
    targetWords.forEach(tw => {
      if (usedWords.includes(tw.term.toLowerCase())) {
        wordLookup[tw.term.toLowerCase()] = tw;
      }
    });

    // Split story into tokens (words and non-words)
    const tokens = story.split(/(\s+|[.,!?;:"""''()[\]{}\-—–…«»])/);
    const matchedWordIds = new Set(); // Track which words have already been matched

    return tokens.map((token, idx) => {
      const cleanToken = token.replace(/[.,!?;:"""''()[\]{}\-—–…«»]/g, '').toLowerCase();

      // Try to match against target words
      let matchedWord = wordLookup[cleanToken];

      // Try prefix matching for morphological variants
      if (!matchedWord) {
        for (const [term, tw] of Object.entries(wordLookup)) {
          if (cleanToken.length >= 3 && (cleanToken.startsWith(term) || term.startsWith(cleanToken))) {
            matchedWord = tw;
            break;
          }
        }
      }

      if (matchedWord && !matchedWordIds.has(matchedWord.wordId)) {
        // Only mark first occurrence to avoid confusion
        // Actually, mark all occurrences but only grade once
      }

      if (matchedWord) {
        const isReviewed = reviewedWords.has(matchedWord.wordId);
        const isActive = activeWord?.wordId === matchedWord.wordId;
        const refKey = `${matchedWord.wordId}-${idx}`;

        return (
          <span
            key={idx}
            ref={el => { wordRefs.current[refKey] = el; }}
            className={`srs-story-target-word ${isReviewed ? 'srs-story-target-reviewed' : ''} ${isActive ? 'srs-story-target-active' : ''}`}
            onClick={() => handleWordClick(matchedWord, refKey)}
            role="button"
            tabIndex={0}
          >
            {token}
          </span>
        );
      }

      return <span key={idx}>{token}</span>;
    });
  };

  const usedTargetWords = targetWords.filter(tw =>
    usedWords.includes(tw.term.toLowerCase())
  );
  const unusedTargetWords = targetWords.filter(tw =>
    !usedWords.includes(tw.term.toLowerCase())
  );
  const reviewedCount = reviewedWords.size;
  const totalToReview = usedTargetWords.length;

  // --- Setup Phase ---
  if (phase === 'setup') {
    return (
      <Container className="mt-4" style={{ maxWidth: '700px' }}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="mb-0">Story Review</h2>
          <Button variant="outline-secondary" size="sm" onClick={() => navigate('/srs')}>
            Card Review
          </Button>
        </div>

        {stats && (
          <Card className="mb-3 shadow-sm">
            <Card.Body className="py-3">
              <Row className="text-center g-2">
                <Col><div className="fw-bold text-danger">{stats.dueCount}</div><small className="text-muted">Due</small></Col>
                <Col><div className="fw-bold text-info">{stats.newCards}</div><small className="text-muted">New</small></Col>
                <Col><div className="fw-bold text-warning">{stats.learningCards}</div><small className="text-muted">Learning</small></Col>
                <Col><div className="fw-bold text-success">{stats.matureCards}</div><small className="text-muted">Mature</small></Col>
              </Row>
            </Card.Body>
          </Card>
        )}

        <Card className="shadow-sm" style={{ borderRadius: '12px', border: 'none' }}>
          <Card.Body>
            <Form.Group className="mb-3" controlId="srs-language-select">
              <Form.Label>Language</Form.Label>
              <Form.Select value={selectedLanguage} onChange={handleLanguageChange}>
                <option value="">-- Select Language --</option>
                {languages.map(lang => (
                  <option key={lang.languageId} value={lang.languageId}>{lang.name}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Word Status Filter</Form.Label>
              <div>
                {[1, 2, 3, 4, 5].map(s => (
                  <Form.Check
                    key={s}
                    inline
                    type="checkbox"
                    id={`story-status-${s}`}
                    label={<Badge bg={STATUS_VARIANTS[s]}>{STATUS_LABELS[s]}</Badge>}
                    value={s}
                    checked={statusFilter.includes(s)}
                    onChange={handleStatusFilterChange}
                  />
                ))}
              </div>
            </Form.Group>

            <Form.Group className="mb-3" controlId="srs-theme-input">
              <Form.Label>Theme/Topic <small className="text-muted">(optional)</small></Form.Label>
              <Form.Control
                type="text"
                placeholder="e.g. A day at the market, Mystery story..."
                value={theme}
                onChange={e => setTheme(e.target.value)}
              />
            </Form.Group>

            <Row className="mb-3">
              <Col>
                <Form.Group controlId="srs-max-words-range">
                  <Form.Label>Max Words to Include</Form.Label>
                  <Form.Range
                    min={3}
                    max={30}
                    value={maxWords}
                    onChange={e => setMaxWords(parseInt(e.target.value))}
                  />
                  <div className="text-center text-muted">{maxWords} words</div>
                </Form.Group>
              </Col>
              <Col>
                <Form.Group controlId="srs-max-length-range">
                  <Form.Label>Story Length</Form.Label>
                  <Form.Range
                    min={100}
                    max={800}
                    step={50}
                    value={maxLength}
                    onChange={e => setMaxLength(parseInt(e.target.value))}
                  />
                  <div className="text-center text-muted">~{maxLength} words</div>
                </Form.Group>
              </Col>
            </Row>

            <Button
              variant="primary"
              size="lg"
              className="w-100"
              onClick={handleGenerate}
              disabled={!selectedLanguage}
            >
              Generate Story
            </Button>
          </Card.Body>
        </Card>

        {error && <Alert variant="danger" className="mt-3" dismissible onClose={() => setError('')}>{error}</Alert>}
      </Container>
    );
  }

  // --- Loading Phase ---
  if (phase === 'loading') {
    return (
      <Container className="mt-4 text-center" style={{ maxWidth: '700px' }}>
        <Card className="shadow-sm p-5" style={{ borderRadius: '16px', border: 'none' }}>
          <Spinner animation="border" variant="primary" className="mb-3" />
          <h5>Crafting your story...</h5>
          <p className="text-muted">Generating a story with your vocabulary words</p>
        </Card>
      </Container>
    );
  }

  // --- Story Phase ---
  if (phase === 'story') {
    return (
      <Container className="mt-4" style={{ maxWidth: '800px' }}>
        {/* Progress header */}
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Story Review</h5>
            <Badge bg="secondary">{reviewedCount}/{totalToReview} reviewed</Badge>
          </div>
          <ProgressBar
            now={totalToReview > 0 ? (reviewedCount / totalToReview) * 100 : 0}
            variant="success"
            style={{ height: '6px', borderRadius: '3px' }}
          />
        </div>

        {/* Story card */}
        <Card className="shadow-sm mb-3 srs-story-card">
          <Card.Body className="srs-story-container">
            <div className="srs-story-text" style={{ fontSize: '1.15rem', lineHeight: '2' }}>
              {renderStory()}
            </div>
          </Card.Body>
        </Card>

        {/* Word legend */}
        <Card className="shadow-sm mb-3" style={{ borderRadius: '12px', border: 'none' }}>
          <Card.Body className="py-2">
            <small className="text-muted d-block mb-2 fw-bold">Target Words — click to review</small>
            <div className="d-flex flex-wrap gap-2">
              {usedTargetWords.map(tw => (
                <Badge
                  key={tw.wordId}
                  bg={reviewedWords.has(tw.wordId) ? 'success' : 'outline-primary'}
                  className={`srs-story-word-badge ${reviewedWords.has(tw.wordId) ? '' : 'srs-story-word-badge-pending'}`}
                >
                  {tw.term} {reviewedWords.has(tw.wordId) ? '✓' : ''}
                </Badge>
              ))}
            </div>
            {unusedTargetWords.length > 0 && (
              <div className="mt-2">
                <small className="text-muted">Not in story: {unusedTargetWords.map(w => w.term).join(', ')}</small>
              </div>
            )}
          </Card.Body>
        </Card>

        <div className="d-flex gap-2">
          <Button variant="outline-secondary" size="sm" onClick={() => { setPhase('complete'); loadStats(); }}>
            Finish Early
          </Button>
          <Button variant="outline-primary" size="sm" onClick={() => { setPhase('setup'); setStory(''); setTargetWords([]); }}>
            New Story
          </Button>
        </div>

        {/* Popover for active word */}
        <SrsWordPopover
          word={activeWord}
          targetRef={activeRef}
          show={!!activeWord}
          onHide={() => { setActiveWord(null); setActiveRef(null); }}
          onGrade={handleGrade}
          disabled={grading}
        />

        {error && <Alert variant="danger" className="mt-3" dismissible onClose={() => setError('')}>{error}</Alert>}
      </Container>
    );
  }

  // --- Complete Phase ---
  if (phase === 'complete') {
    return (
      <Container className="mt-4" style={{ maxWidth: '600px' }}>
        <Card className="shadow-sm text-center p-4" style={{ borderRadius: '16px', border: 'none' }}>
          <div style={{ fontSize: '3rem' }}>🎉</div>
          <h3 className="mt-2">Story Complete!</h3>
          <p className="text-muted mb-3">
            You reviewed <strong>{reviewedCount}</strong> out of <strong>{totalToReview}</strong> words in context.
          </p>
          {stats && (
            <div className="mb-3">
              <Badge bg="danger" className="me-2" style={{ fontSize: '0.9rem', padding: '0.4rem 0.8rem' }}>
                Streak: {stats.currentStreak}d
              </Badge>
              <Badge bg="success" style={{ fontSize: '0.9rem', padding: '0.4rem 0.8rem' }}>
                Retention: {stats.retentionRate}%
              </Badge>
            </div>
          )}
          <div className="d-flex gap-2 justify-content-center">
            <Button variant="primary" onClick={() => { setPhase('setup'); setStory(''); setTargetWords([]); setReviewedWords(new Set()); }}>
              Generate Another
            </Button>
            <Button variant="outline-secondary" onClick={() => navigate('/srs')}>
              Card Review
            </Button>
          </div>
        </Card>
      </Container>
    );
  }

  return null;
};

export default SrsStoryReview;
