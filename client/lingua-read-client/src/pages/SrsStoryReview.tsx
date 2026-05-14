import React, { useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Container, Card, Button, Spinner, Alert, Form, Row, Col, Badge, ProgressBar, OverlayTrigger, Tooltip, ButtonGroup, ToggleButton } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { getAllLanguages, generateSrsStory, submitSrsReview, getSrsStats, createWord, getWordsByLanguage, getSrsStories } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';
import WordLookupPopover from '../components/WordLookupPopover';
import './SrsStoryReview.css';

const STATUS_LABELS = { 1: 'New', 2: 'Learning', 3: 'Familiar', 4: 'Advanced', 5: 'Known' };
const STATUS_VARIANTS = { 1: 'danger', 2: 'warning', 3: 'info', 4: 'primary', 5: 'success' };
const GRADE_BUTTONS = [
  { grade: 0, label: 'Again', variant: 'outline-danger' },
  { grade: 1, label: 'Hard', variant: 'outline-warning' },
  { grade: 2, label: 'Good', variant: 'outline-success' },
  { grade: 3, label: 'Easy', variant: 'outline-info' },
];

const SrsStoryReview = () => {
  const navigate = useNavigate();
  const { settings } = useContext(SettingsContext);

  // Setup state
  const [languages, setLanguages] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    localStorage.getItem('srsSelectedLanguage') || ''
  );
  const [statusFilter, setStatusFilter] = useState([1, 2, 3, 4, 5]);
  const [cardType, setCardType] = useState('all');
  const [maxWords, setMaxWords] = useState(() =>
    Math.min(30, Math.max(3, settings.srsMaxNewCards || 15))
  );

  // Session state
  const [phase, setPhase] = useState('setup'); // setup | loading | review | complete
  const [microContexts, setMicroContexts] = useState([]);
  const [reviewedWords, setReviewedWords] = useState(new Map()); // wordId -> grade
  const [revealedWords, setRevealedWords] = useState(new Set()); // wordIds whose translation is unhidden
  const [error, setError] = useState('');
  const [stats, setStats] = useState(null);
  const [pastStories, setPastStories] = useState([]);
  const [gradingWordId, setGradingWordId] = useState(null);

  // Story metadata for word saving
  const [storyTextId, setStoryTextId] = useState(null);
  const [languageCode, setLanguageCode] = useState('');
  const [existingWordsMap, setExistingWordsMap] = useState({});

  // Lookup popover state (non-target words)
  const [lookupWord, setLookupWord] = useState(null);
  const [lookupRef, setLookupRef] = useState(null);

  // Word refs for popover positioning
  const wordRefs = useRef({});

  useEffect(() => {
    (async () => {
      try {
        setLanguages(await getAllLanguages());
      } catch (err) {
        console.error('Failed to load languages:', err);
      }
    })();
  }, []);

  const loadStats = useCallback(async () => {
    if (!selectedLanguage) return;
    try {
      setStats(await getSrsStats(selectedLanguage));
      setPastStories(await getSrsStories(selectedLanguage));
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
        maxWords,
        status: statusFilter,
        cardType: cardType !== 'all' ? cardType : undefined,
      });

      if (!result.microContexts || result.microContexts.length === 0) {
        setError('No micro-contexts generated. Either no due words or the AI returned an unparseable response — try again.');
        setPhase('setup');
        return;
      }

      setMicroContexts(result.microContexts);
      setReviewedWords(new Map());
      setRevealedWords(new Set());
      setStoryTextId(result.textId);
      setLanguageCode(result.languageCode || '');
      setPhase('review');

      // Load existing vocabulary for this language (for non-target lookups)
      try {
        const words = await getWordsByLanguage(parseInt(selectedLanguage));
        const map = {};
        words.forEach(w => { if (w.term) map[w.term.toLowerCase()] = w; });
        setExistingWordsMap(map);
      } catch (e) {
        console.error('Failed to load vocabulary:', e);
      }
    } catch (err) {
      setError(`Failed to generate micro-contexts: ${err.message}`);
      setPhase('setup');
    }
  };

  const handleGrade = async (mc, grade) => {
    if (reviewedWords.has(mc.wordId)) return;
    setGradingWordId(mc.wordId);
    try {
      await submitSrsReview(mc.srsCardReviewId, grade);
      setReviewedWords(prev => new Map(prev).set(mc.wordId, grade));
    } catch (err) {
      setError(`Failed to submit review: ${err.message}`);
    } finally {
      setGradingWordId(null);
    }
  };

  const handleLookupClick = (tokenText, refKey, sentenceContext) => {
    const clean = tokenText.replace(/[.,!?;:"""''()[\]{}\-—–…«»]/g, '').toLowerCase();
    if (!clean) return;
    setLookupWord({ text: clean, sentenceContext });
    setLookupRef(wordRefs.current[refKey]);
  };

  const handleSaveWord = async (term: string, translation: string, status: number) => {
    if (!storyTextId) return;
    // createWord returns Promise<unknown>; the actual payload is the new
    // word DTO plus a translation block. Cast at the boundary.
    const result = (await createWord(
      storyTextId,
      term,
      status,
      translation,
      lookupWord?.sentenceContext || ''
    )) as { translation?: { translation?: string } } & Record<string, unknown>;
    setExistingWordsMap(prev => ({
      ...prev,
      [term.toLowerCase()]: { ...result, term, translation: result?.translation?.translation || translation, status }
    }));
  };

  // Render the lookup-clickable token stream for a slice of context. Used for the
  // before/after pieces around the highlighted target span. Non-target tokens stay
  // clickable for WordLookupPopover; the target-form span is rendered separately
  // by renderContextBody().
  const renderLookupTokens = (text, mc, idx, sliceKey) => {
    const tokens = text.split(/(\s+|[.,!?;:"""''()[\]{}\-—–…«»])/);
    return tokens.map((token, tIdx) => {
      const cleanToken = token.replace(/[.,!?;:"""''()[\]{}\-—–…«»]/g, '').toLowerCase();
      if (!cleanToken) return <span key={`${sliceKey}-${tIdx}`}>{token}</span>;

      const refKey = `mc-${idx}-${sliceKey}-${tIdx}`;
      const existing = existingWordsMap[cleanToken];
      const translation = existing?.translation?.translation || existing?.translation;

      const wordSpan = (
        <span
          key={`${sliceKey}-${tIdx}`}
          ref={el => { wordRefs.current[refKey] = el; }}
          className={`srs-story-lookup-word${existing ? ' srs-story-lookup-known' : ''}`}
          onClick={() => handleLookupClick(token, refKey, mc.context)}
          role="button"
          tabIndex={0}
        >
          {token}
        </span>
      );

      return (translation && typeof translation === 'string') ? (
        <OverlayTrigger
          key={`${sliceKey}-${tIdx}`}
          placement="top"
          delay={{ show: 300, hide: 0 }}
          overlay={<Tooltip id={`tip-${idx}-${sliceKey}-${tIdx}`}>{translation}</Tooltip>}
        >
          {wordSpan}
        </OverlayTrigger>
      ) : wordSpan;
    });
  };

  // Render a single micro-context. Highlights the AI-declared `usedForm` as a single
  // contiguous span (case-insensitive substring match against the context). Falls back
  // to the raw `term` when usedForm is missing. The text on either side flows through
  // the lookup-token renderer so non-target words remain clickable.
  const renderContextBody = (mc, idx) => {
    const needle = (mc.usedForm || mc.term || '').trim();
    const ctx = mc.context;

    const matchIdx = needle
      ? ctx.toLowerCase().indexOf(needle.toLowerCase())
      : -1;

    if (matchIdx < 0) {
      // Couldn't locate the target form anywhere — render the whole context as lookup tokens.
      return renderLookupTokens(ctx, mc, idx, 'all');
    }

    const before = ctx.slice(0, matchIdx);
    const matched = ctx.slice(matchIdx, matchIdx + needle.length);
    const after = ctx.slice(matchIdx + needle.length);

    return (
      <>
        {renderLookupTokens(before, mc, idx, 'before')}
        <span className="srs-story-target-word srs-microcontext-target">{matched}</span>
        {renderLookupTokens(after, mc, idx, 'after')}
      </>
    );
  };

  const reviewedCount = reviewedWords.size;
  const totalToReview = microContexts.length;

  // --- Setup Phase ---
  if (phase === 'setup') {
    return (
      <Container className="mt-4" style={{ maxWidth: '700px' }}>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h2 className="mb-0">Micro-Context Review</h2>
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
                <Col><div className="fw-bold text-primary">{Math.max(0, (stats.maxNewCards || 20) - (stats.studiedNewCardsToday || 0))}</div><small className="text-muted">New Left</small></Col>
                <Col><div className="fw-bold text-secondary">{Math.max(0, (stats.maxReviews || 100) - (stats.studiedReviewsToday || 0))}</div><small className="text-muted">Rev Left</small></Col>
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

            <Form.Group className="mb-3">
              <Form.Label>Card Source</Form.Label>
              <div>
                <ButtonGroup>
                  {[
                    { value: 'all', label: 'All Words' },
                    { value: 'new', label: 'New Only' },
                    { value: 'review', label: 'Review Only' },
                  ].map(opt => (
                    <ToggleButton
                      key={opt.value}
                      id={`card-type-${opt.value}`}
                      type="radio"
                      variant={cardType === opt.value ? 'primary' : 'outline-secondary'}
                      name="cardType"
                      value={opt.value}
                      checked={cardType === opt.value}
                      onChange={e => setCardType(e.currentTarget.value)}
                      size="sm"
                    >
                      {opt.label}
                    </ToggleButton>
                  ))}
                </ButtonGroup>
              </div>
              {stats && cardType === 'new' && Math.max(0, (stats.maxNewCards || 20) - (stats.studiedNewCardsToday || 0)) === 0 && (
                <small className="text-danger d-block mt-1">Daily new card limit reached.</small>
              )}
              {stats && cardType === 'review' && Math.max(0, (stats.maxReviews || 100) - (stats.studiedReviewsToday || 0)) === 0 && (
                <small className="text-danger d-block mt-1">Daily review limit reached.</small>
              )}
            </Form.Group>

            <Form.Group controlId="srs-max-words-range" className="mb-3">
              <Form.Label>Max Words to Include</Form.Label>
              <Form.Range
                min={3}
                max={30}
                value={maxWords}
                onChange={e => setMaxWords(parseInt(e.target.value))}
              />
              <div className="text-center text-muted">{maxWords} micro-contexts</div>
            </Form.Group>

            <Button
              variant="primary"
              size="lg"
              className="w-100"
              onClick={handleGenerate}
              disabled={!selectedLanguage}
            >
              Generate Micro-Contexts
            </Button>
          </Card.Body>
        </Card>

        {error && <Alert variant="danger" className="mt-3" dismissible onClose={() => setError('')}>{error}</Alert>}

        {pastStories.length > 0 && (
          <Card className="mt-3 shadow-sm" style={{ borderRadius: '12px', border: 'none' }}>
            <Card.Body className="py-2">
              <small className="text-muted fw-bold d-block mb-2">Past Sessions</small>
              {pastStories.slice(0, 5).map(s => (
                <div key={s.textId} className="border-bottom py-1" style={{ fontSize: '0.85rem' }}>
                  <div className="d-flex justify-content-between">
                    <span className="text-truncate" style={{ maxWidth: '70%' }}>{s.title}</span>
                    <small className="text-muted">{new Date(s.createdAt).toLocaleDateString()}</small>
                  </div>
                  <small className="text-muted">{s.contentPreview}</small>
                </div>
              ))}
            </Card.Body>
          </Card>
        )}
      </Container>
    );
  }

  // --- Loading Phase ---
  if (phase === 'loading') {
    return (
      <Container className="mt-4 text-center" style={{ maxWidth: '700px' }}>
        <Card className="shadow-sm p-5" style={{ borderRadius: '16px', border: 'none' }}>
          <Spinner animation="border" variant="primary" className="mb-3" />
          <h5>Building micro-contexts...</h5>
          <p className="text-muted">Generating one isolated context per due word</p>
        </Card>
      </Container>
    );
  }

  // --- Review Phase ---
  if (phase === 'review') {
    return (
      <Container className="mt-4" style={{ maxWidth: '800px' }}>
        <div className="mb-3">
          <div className="d-flex justify-content-between align-items-center mb-2">
            <h5 className="mb-0">Micro-Context Review</h5>
            <Badge bg="secondary">{reviewedCount}/{totalToReview} reviewed</Badge>
          </div>
          <ProgressBar
            now={totalToReview > 0 ? (reviewedCount / totalToReview) * 100 : 0}
            variant="success"
            style={{ height: '6px', borderRadius: '3px' }}
          />
        </div>

        {microContexts.map((mc, idx) => {
          const reviewedGrade = reviewedWords.get(mc.wordId);
          const isReviewed = reviewedGrade !== undefined;
          const isGrading = gradingWordId === mc.wordId;

          if (isReviewed) {
            const gradeLabel = GRADE_BUTTONS.find(g => g.grade === reviewedGrade)?.label ?? '';
            return (
              <Card
                key={mc.wordId}
                className="srs-microcontext-card srs-microcontext-card-reviewed mb-2 shadow-sm"
                data-testid="srs-microcontext-reviewed"
              >
                <Card.Body className="py-2 d-flex justify-content-between align-items-center">
                  <span>
                    <Badge bg="success" className="me-2">✓</Badge>
                    <strong>{mc.term}</strong>
                    {mc.translation && <span className="text-muted ms-2">— {mc.translation}</span>}
                  </span>
                  <Badge bg="secondary">{gradeLabel}</Badge>
                </Card.Body>
              </Card>
            );
          }

          const isRevealed = revealedWords.has(mc.wordId);
          return (
            <Card key={mc.wordId} className="srs-microcontext-card mb-3 shadow-sm" data-testid="srs-microcontext-card">
              <Card.Body>
                <div className="d-flex justify-content-between align-items-baseline mb-2">
                  <h6 className="mb-0">
                    <span className="srs-microcontext-term">{mc.term}</span>
                    {mc.usedForm && mc.usedForm.toLowerCase() !== mc.term.toLowerCase() && (
                      <small className="srs-microcontext-usedform ms-2">→ {mc.usedForm}</small>
                    )}
                    {isRevealed && mc.translation && (
                      <small className="text-muted ms-2" data-testid="srs-microcontext-translation">— {mc.translation}</small>
                    )}
                  </h6>
                  <Badge bg={STATUS_VARIANTS[mc.wordStatus] || 'secondary'} pill>
                    {STATUS_LABELS[mc.wordStatus] || '?'}
                  </Badge>
                </div>
                <div className="srs-microcontext-body" style={{ fontSize: '1.1rem', lineHeight: '1.8' }}>
                  {renderContextBody(mc, idx)}
                </div>
                {isRevealed ? (
                  <div className="d-flex gap-2 mt-3" data-testid="srs-microcontext-grade-row">
                    {GRADE_BUTTONS.map(({ grade, label, variant }) => (
                      <Button
                        key={grade}
                        variant={variant}
                        size="sm"
                        className="flex-fill"
                        disabled={isGrading}
                        onClick={() => handleGrade(mc, grade)}
                      >
                        {label}
                      </Button>
                    ))}
                  </div>
                ) : (
                  <Button
                    variant="outline-primary"
                    size="sm"
                    className="w-100 mt-3"
                    onClick={() => setRevealedWords(prev => new Set(prev).add(mc.wordId))}
                    data-testid="srs-microcontext-reveal"
                  >
                    Show translation
                  </Button>
                )}
              </Card.Body>
            </Card>
          );
        })}

        <div className="d-flex gap-2 mt-3">
          <Button
            variant={reviewedCount >= totalToReview ? 'success' : 'outline-secondary'}
            size="sm"
            onClick={() => { setPhase('complete'); loadStats(); }}
          >
            {reviewedCount >= totalToReview ? 'Finish Review' : 'Finish Early'}
          </Button>
          <Button variant="outline-primary" size="sm" onClick={() => { setPhase('setup'); setMicroContexts([]); }}>
            New Session
          </Button>
        </div>

        <WordLookupPopover
          word={lookupWord?.text}
          targetRef={lookupRef}
          show={!!lookupWord}
          onHide={() => { setLookupWord(null); setLookupRef(null); }}
          onSave={handleSaveWord}
          sourceLanguageCode={languageCode}
          targetLanguageCode={settings.translationTargetLanguageCode || 'EN'}
          sentenceContext={lookupWord?.sentenceContext || ''}
          existingWord={lookupWord ? existingWordsMap[lookupWord.text.toLowerCase()] : null}
        />

        {error && <Alert variant="danger" className="mt-3" dismissible onClose={() => setError('')}>{error}</Alert>}
      </Container>
    );
  }

  // --- Complete Phase ---
  if (phase === 'complete') {
    const sessionGrades = Array.from(reviewedWords.values());
    return (
      <Container className="mt-4" style={{ maxWidth: '600px' }}>
        <Card className="shadow-sm text-center p-4" style={{ borderRadius: '16px', border: 'none' }}>
          <div style={{ fontSize: '3rem' }}>🎉</div>
          <h3 className="mt-2">Session Complete!</h3>
          <p className="text-muted mb-3">
            You reviewed <strong>{reviewedCount}</strong> out of <strong>{totalToReview}</strong> words in context.
          </p>
          {sessionGrades.length > 0 && (
            <div className="d-flex justify-content-center gap-3 mb-3">
              {[
                { grade: 0, label: 'Again', variant: 'danger' },
                { grade: 1, label: 'Hard', variant: 'warning' },
                { grade: 2, label: 'Good', variant: 'success' },
                { grade: 3, label: 'Easy', variant: 'info' },
              ].map(({ grade, label, variant }) => {
                const count = sessionGrades.filter(g => g === grade).length;
                return count > 0 ? (
                  <Badge key={grade} bg={variant} style={{ fontSize: '0.85rem', padding: '0.4rem 0.7rem' }}>
                    {label}: {count}
                  </Badge>
                ) : null;
              })}
            </div>
          )}
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
            <Button variant="primary" onClick={() => { setPhase('setup'); setMicroContexts([]); setReviewedWords(new Map()); setRevealedWords(new Set()); }}>
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
