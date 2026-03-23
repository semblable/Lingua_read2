import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Button, Spinner, Alert, Form, Row, Col, Badge, ProgressBar, ButtonGroup, Modal } from 'react-bootstrap';
import { SettingsContext } from '../contexts/SettingsContext';
import { getAllLanguages, getSrsDueCards, submitSrsReview, getSrsStats, updateUserSettings, undoSrsReview, getSrsForecast, suspendSrsCard, burySrsCard, updateSrsCard, getSrsHeatmap } from '../utils/api';

const FLAG_COLORS = ['', '🟥', '🟧', '🟨', '🟩'];
const FLAG_LABELS = ['None', 'Red', 'Orange', 'Yellow', 'Green'];

const GRADE_LABELS = [
  { grade: 0, label: 'Again', variant: 'danger', key: '1' },
  { grade: 1, label: 'Hard', variant: 'warning', key: '2' },
  { grade: 2, label: 'Good', variant: 'success', key: '3' },
  { grade: 3, label: 'Easy', variant: 'info', key: '4' },
];

const STATUS_LABELS = { 1: 'New', 2: 'Learning', 3: 'Familiar', 4: 'Advanced', 5: 'Known' };
const STATUS_VARIANTS = { 1: 'danger', 2: 'warning', 3: 'info', 4: 'primary', 5: 'success' };

const SrsReview = () => {
  // Setup state
  const [languages, setLanguages] = useState([]);
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    localStorage.getItem('srsSelectedLanguage') || ''
  );
  const [statusFilter, setStatusFilter] = useState([1, 2, 3, 4]);
  const [onlyOneTarget, setOnlyOneTarget] = useState(false);

  // Settings
  const { settings, updateSetting } = React.useContext(SettingsContext);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [localSettings, setLocalSettings] = useState({
    srsMaxNewCards: 20,
    srsMaxReviews: 100,
    srsReviewOrder: 'mix',
    srsLearningStepMinutes: '1,10'
  });

  useEffect(() => {
    setLocalSettings({
      srsMaxNewCards: settings?.srsMaxNewCards ?? 20,
      srsMaxReviews: settings?.srsMaxReviews ?? 100,
      srsReviewOrder: settings?.srsReviewOrder ?? 'mix',
      srsLearningStepMinutes: settings?.srsLearningStepMinutes ?? '1,10'
    });
  }, [settings]);

  const handleSaveSettings = async () => {
    try {
      await updateUserSettings({
        srsMaxNewCards: parseInt(localSettings.srsMaxNewCards, 10),
        srsMaxReviews: parseInt(localSettings.srsMaxReviews, 10),
        srsReviewOrder: localSettings.srsReviewOrder,
        srsLearningStepMinutes: localSettings.srsLearningStepMinutes
      });
      updateSetting('srsMaxNewCards', parseInt(localSettings.srsMaxNewCards, 10));
      updateSetting('srsMaxReviews', parseInt(localSettings.srsMaxReviews, 10));
      updateSetting('srsReviewOrder', localSettings.srsReviewOrder);
      updateSetting('srsLearningStepMinutes', localSettings.srsLearningStepMinutes);
      setShowSettingsModal(false);
      loadStats(); // refresh visual stats
    } catch (err) {
      setError(`Failed to save settings: ${err.message}`);
    }
  };

  // Session state
  const [cards, setCards] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  // Loading/error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  // Stats
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [forecast, setForecast] = useState([]);
  const [heatmap, setHeatmap] = useState([]);

  // Undo state
  const [undoVisible, setUndoVisible] = useState(false);
  const [undoTimer, setUndoTimer] = useState(0);

  // Load stats when language changes
  const loadStats = useCallback(async () => {
    if (!selectedLanguage) return;
    setStatsLoading(true);
    try {
      const data = await getSrsStats(selectedLanguage);
      setStats(data);
      const forecastData = await getSrsForecast(selectedLanguage, 14);
      setForecast(forecastData);
      const heatmapData = await getSrsHeatmap(365);
      setHeatmap(heatmapData);
    } catch (err) {
      console.error('Failed to load stats, forecast, or heatmap:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [selectedLanguage]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Start review session
  const startSession = useCallback(async () => {
    if (!selectedLanguage) return;
    setLoading(true);
    setError(null);
    setSessionComplete(false);
    setReviewedCount(0);
    setCurrentIndex(0);
    setIsFlipped(false);

    try {
      const data = await getSrsDueCards(selectedLanguage, {
        status: statusFilter,
        onlyOneTarget,
        limit: 50
      });
      if (!data || data.length === 0) {
        setCards([]);
        setSessionStarted(true);
        setSessionComplete(true);
      } else {
        setCards(data);
        setSessionStarted(true);
      }
    } catch (err) {
      setError(`Failed to load cards: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedLanguage, statusFilter, onlyOneTarget]);

  const currentCard = useMemo(() => {
    if (currentIndex >= 0 && currentIndex < cards.length) {
      return cards[currentIndex];
    }
    return null;
  }, [cards, currentIndex]);

  // Handle grading
  const handleGrade = useCallback(async (grade) => {
    if (!currentCard || submitting) return;
    setSubmitting(true);
    setUndoVisible(false); // Hide any existing undo before submitting new

    try {
      await submitSrsReview(currentCard.srsCardReviewId, grade);
      setReviewedCount(prev => prev + 1);

      setUndoVisible(true);
      setUndoTimer(5);

      if (currentIndex + 1 >= cards.length) {
        setSessionComplete(true);
        loadStats();
      } else {
        setCurrentIndex(prev => prev + 1);
        setIsFlipped(false);
      }
    } catch (err) {
      setError(`Failed to submit review: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [currentCard, currentIndex, cards.length, submitting, loadStats]);

  const handleUndo = async () => {
    if (submitting) return;
    try {
      setSubmitting(true);
      await undoSrsReview();
      setUndoVisible(false);
      setReviewedCount(prev => Math.max(0, prev - 1));
      
      if (sessionComplete) {
        setSessionComplete(false);
        setCurrentIndex(cards.length - 1);
      } else {
        setCurrentIndex(prev => Math.max(0, prev - 1));
      }
      setIsFlipped(true); // Show back of the card they just undid
      loadStats(); // Refresh limits
    } catch (err) {
      setError(`Failed to undo: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (undoTimer > 0 && undoVisible) {
      const timer = setTimeout(() => setUndoTimer(t => t - 1), 1000);
      return () => clearTimeout(timer);
    } else if (undoTimer === 0) {
      setUndoVisible(false);
    }
  }, [undoTimer, undoVisible]);

  // Keyboard shortcuts
  useEffect(() => {
    if (!sessionStarted || sessionComplete) return;

    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;

      if (e.code === 'Space' || e.code === 'Enter') {
        e.preventDefault();
        if (!isFlipped) {
          setIsFlipped(true);
        }
      } else if (isFlipped) {
        switch (e.key) {
          case '1': handleGrade(0); break;
          case '2': handleGrade(1); break;
          case '3': handleGrade(2); break;
          case '4': handleGrade(3); break;
          default: break;
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sessionStarted, sessionComplete, isFlipped, handleGrade]);

  const handleLanguageChange = (e) => {
    const langId = e.target.value;
    setSelectedLanguage(langId);
    localStorage.setItem('srsSelectedLanguage', langId);
    setSessionStarted(false);
    setSessionComplete(false);
    setCards([]);
  };

  const handleStatusFilterChange = (e) => {
    const { value, checked } = e.target;
    const statusValue = parseInt(value, 10);
    setStatusFilter(prev =>
      checked ? [...prev, statusValue] : prev.filter(s => s !== statusValue)
    );
  };

  // Highlight target word in sentence
  const renderSentenceWithHighlight = (sentence, term) => {
    if (!sentence || !term) return sentence;
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = sentence.split(regex);
    return parts.map((part, i) =>
      regex.test(part)
        ? <span key={i} style={{
            backgroundColor: '#ffdd66',
            color: '#000',
            padding: '1px 4px',
            borderRadius: '3px',
            fontWeight: 'bold'
          }}>{part}</span>
        : part
    );
  };

  // Parse learning steps from settings
  const learningSteps = useMemo(() => {
    const raw = localSettings.srsLearningStepMinutes || '1,10';
    return raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
  }, [localSettings.srsLearningStepMinutes]);

  const getIntervalLabel = (grade, card) => {
    if (!card) return '';
    const ef = card.easeFactor;

    // If card is currently in learning phase
    if (card.isLearning) {
      const stepIdx = card.currentLearningStepIndex || 0;
      switch (grade) {
        case 0: // Again: reset to step 0
          return learningSteps.length > 0 ? `${learningSteps[0]}m` : '1m';
        case 1: // Hard: also reset to step 0
          return learningSteps.length > 0 ? `${learningSteps[0]}m` : '1m';
        case 2: { // Good: next step or graduate
          const nextStep = stepIdx + 1;
          if (nextStep >= learningSteps.length) return '1d'; // graduate
          return `${learningSteps[nextStep]}m`;
        }
        case 3: { // Easy: graduate immediately
          return '1d';
        }
        default: return '';
      }
    }

    // Not in learning phase (normal SM-2 preview)
    let interval;
    switch (grade) {
      case 0: // Lapse: enter learning (first step)
        return learningSteps.length > 0 ? `${learningSteps[0]}m` : '1m';
      case 1: // Hard lapse
        return learningSteps.length > 0 ? `${learningSteps[0]}m` : '1m';
      case 2:
        if (card.repetitions === 0) interval = 1;
        else if (card.repetitions === 1) interval = 6;
        else interval = Math.round(card.interval * ef);
        return `${interval}d`;
      case 3:
        if (card.repetitions === 0) interval = 1;
        else if (card.repetitions === 1) interval = 6;
        else interval = Math.round(card.interval * ef);
        interval = Math.round(interval * 1.3);
        return `${interval}d`;
      default: return '';
    }
  };

  // Suspend card handler
  const handleSuspend = async (cardId) => {
    try {
      await suspendSrsCard(cardId);
      // Remove card from session
      setCards(prev => prev.filter(c => c.srsCardReviewId !== cardId));
      if (currentIndex >= cards.length - 1) {
        setSessionComplete(true);
        loadStats();
      }
    } catch (err) {
      setError(`Failed to suspend: ${err.message}`);
    }
  };

  // Bury card handler
  const handleBury = async (cardId) => {
    try {
      await burySrsCard(cardId);
      // Remove card from session
      setCards(prev => prev.filter(c => c.srsCardReviewId !== cardId));
      if (currentIndex >= cards.length - 1) {
        setSessionComplete(true);
        loadStats();
      }
    } catch (err) {
      setError(`Failed to bury: ${err.message}`);
    }
  };

  // Flag card handler
  const handleFlag = async (cardId, flagValue) => {
    try {
      await updateSrsCard(cardId, { flag: flagValue });
      setCards(prev => prev.map(c => c.srsCardReviewId === cardId ? { ...c, flag: flagValue } : c));
    } catch (err) {
      setError(`Failed to flag: ${err.message}`);
    }
  };

  // Build heatmap grid helper
  const renderHeatmap = () => {
    if (!heatmap || heatmap.length === 0) return null;
    const heatmapMap = {};
    heatmap.forEach(h => { heatmapMap[h.date] = h.reviewCount; });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxCount = Math.max(...heatmap.map(h => h.reviewCount), 1);

    // Build 365 days of data ending today
    const days = [];
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({ date: dateStr, count: heatmapMap[dateStr] || 0, dayOfWeek: d.getDay() });
    }

    // Group into weeks (columns)
    const weeks = [];
    let currentWeek = new Array(7).fill(null);
    days.forEach((day, idx) => {
      currentWeek[day.dayOfWeek] = day;
      if (day.dayOfWeek === 6 || idx === days.length - 1) {
        weeks.push(currentWeek);
        currentWeek = new Array(7).fill(null);
      }
    });

    const getColor = (count) => {
      if (count === 0) return '#ebedf0';
      const intensity = Math.min(count / maxCount, 1);
      if (intensity < 0.25) return '#9be9a8';
      if (intensity < 0.5) return '#40c463';
      if (intensity < 0.75) return '#30a14e';
      return '#216e39';
    };

    return (
      <div style={{ display: 'flex', gap: '2px', overflowX: 'auto' }}>
        {weeks.map((week, wi) => (
          <div key={wi} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
            {week.map((day, di) => (
              <div
                key={di}
                title={day ? `${day.date}: ${day.count} reviews` : ''}
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '2px',
                  backgroundColor: day ? getColor(day.count) : 'transparent',
                }}
              />
            ))}
          </div>
        ))}
      </div>
    );
  };

  // --- Render ---

  // Setup Screen
  if (!sessionStarted) {
    return (
      <Container className="mt-4" style={{ maxWidth: '700px' }}>
        <h2 className="mb-3">📚 SRS Review</h2>

        {/* Stats Card */}
        {stats && (
          <Card className="mb-3 shadow-sm">
            <Card.Body className="py-2">
              <div className="d-flex justify-content-between align-items-center mb-2 mt-2">
                <Badge bg="danger" className="px-3 py-2" style={{ fontSize: '1rem' }}>🔥 Streak: {stats.currentStreak} ({stats.longestStreak} max)</Badge>
                <div className="fw-bold text-success" style={{ fontSize: '1.1rem' }}>Retention: {stats.retentionRate}%</div>
              </div>
              <Row className="text-center">
                <Col><div className="fw-bold text-danger">{stats.dueCount}</div><small className="text-muted">Due</small></Col>
                <Col><div className="fw-bold text-info">{stats.newCards}</div><small className="text-muted">New</small></Col>
                <Col><div className="fw-bold text-warning">{stats.learningCards}</div><small className="text-muted">Learning</small></Col>
                <Col><div className="fw-bold text-success">{stats.matureCards}</div><small className="text-muted">Mature</small></Col>
                <Col><div className="fw-bold">{stats.reviewedToday}</div><small className="text-muted">Total Today</small></Col>
              </Row>
              <hr className="my-2" />
              <Row className="text-center">
                <Col>
                  <div className="fw-bold text-info">
                    {stats.studiedNewCardsToday} <span className="text-muted fw-normal">/ {stats.maxNewCards}</span>
                  </div>
                  <small className="text-muted">New Today</small>
                </Col>
                <Col>
                  <div className="fw-bold text-primary">
                    {stats.studiedReviewsToday} <span className="text-muted fw-normal">/ {stats.maxReviews}</span>
                  </div>
                  <small className="text-muted">Reviews Today</small>
                </Col>
              </Row>
            </Card.Body>
          </Card>
        )}

        {forecast && forecast.length > 0 && !statsLoading && (
          <Card className="mb-3 shadow-sm">
            <Card.Body className="py-2">
              <small className="text-muted fw-bold mb-2 d-block text-center">Upcoming Reviews (14 Days)</small>
              <div className="d-flex align-items-end justify-content-between" style={{ height: '80px' }}>
                {forecast.map((day, idx) => {
                  const maxCount = Math.max(...forecast.map(f => f.count), 1);
                  const heightPct = (day.count / maxCount) * 100;
                  const dateObj = new Date(day.date);
                  const dayStr = idx === 0 ? 'Today' : dateObj.toLocaleDateString(undefined, { weekday: 'short' });
                  return (
                    <div key={idx} className="d-flex flex-column align-items-center" style={{ flex: 1 }} title={`${day.date}: ${day.count} cards`}>
                      <div className="bg-primary rounded-top" style={{ width: '60%', height: `${Math.max(heightPct, 5)}%`, opacity: day.count > 0 ? 0.8 : 0.2, minHeight: '4px' }}></div>
                      <small style={{ fontSize: '0.65rem', marginTop: '4px' }} className="text-muted text-truncate w-100 text-center">{dayStr}</small>
                    </div>
                  );
                })}
              </div>
            </Card.Body>
          </Card>
        )}

        {/* Heatmap Calendar */}
        {heatmap && heatmap.length > 0 && !statsLoading && (
          <Card className="mb-3 shadow-sm">
            <Card.Body className="py-2">
              <small className="text-muted fw-bold mb-2 d-block text-center">Review Activity (Past Year)</small>
              {renderHeatmap()}
            </Card.Body>
          </Card>
        )}

        {statsLoading && <div className="text-center mb-3"><Spinner size="sm" /></div>}

        <Card className="shadow-sm">
          <Card.Body>
            <Form.Group className="mb-3">
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
                {[1, 2, 3, 4].map(s => (
                  <Form.Check
                    key={s}
                    inline
                    type="checkbox"
                    id={`srs-status-${s}`}
                    label={<Badge bg={STATUS_VARIANTS[s]}>{STATUS_LABELS[s]}</Badge>}
                    value={s}
                    checked={statusFilter.includes(s)}
                    onChange={handleStatusFilterChange}
                  />
                ))}
              </div>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Check
                type="switch"
                id="oneTargetSwitch"
                label={<><strong>1T Only</strong> <small className="text-muted">— Show only sentences with exactly 1 unknown word</small></>}
                checked={onlyOneTarget}
                onChange={(e) => setOnlyOneTarget(e.target.checked)}
              />
            </Form.Group>

            <div className="d-flex gap-2 mt-3">
              <Button
                variant="primary"
                size="lg"
                className="flex-grow-1"
                onClick={startSession}
                disabled={!selectedLanguage || loading}
              >
                {loading ? <><Spinner size="sm" className="me-2" />Loading...</> : 'Start Review'}
              </Button>
              <Button
                variant="outline-secondary"
                size="lg"
                onClick={() => setShowSettingsModal(true)}
                title="Deck Options"
              >
                ⚙️ Options
              </Button>
            </div>
          </Card.Body>
        </Card>
        {error && <Alert variant="danger" className="mt-3">{error}</Alert>}

        {/* Settings Modal */}
        <Modal show={showSettingsModal} onHide={() => setShowSettingsModal(false)} centered>
          <Modal.Header closeButton>
            <Modal.Title>SRS Options</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            <Form.Group className="mb-3">
              <Form.Label>Maximum New Cards / Day</Form.Label>
              <Form.Control
                type="number"
                min="0"
                value={localSettings.srsMaxNewCards}
                onChange={e => setLocalSettings(p => ({ ...p, srsMaxNewCards: e.target.value }))}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Maximum Reviews / Day</Form.Label>
              <Form.Control
                type="number"
                min="0"
                value={localSettings.srsMaxReviews}
                onChange={e => setLocalSettings(p => ({ ...p, srsMaxReviews: e.target.value }))}
              />
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Review Order</Form.Label>
              <Form.Select
                value={localSettings.srsReviewOrder}
                onChange={e => setLocalSettings(p => ({ ...p, srsReviewOrder: e.target.value }))}
              >
                <option value="mix">Mix new cards and reviews</option>
                <option value="new_first">Show new cards before reviews</option>
                <option value="reviews_first">Show reviews before new cards</option>
              </Form.Select>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Learning Steps (minutes, comma-separated)</Form.Label>
              <Form.Control
                type="text"
                placeholder="1, 10"
                value={localSettings.srsLearningStepMinutes}
                onChange={e => setLocalSettings(p => ({ ...p, srsLearningStepMinutes: e.target.value }))}
              />
              <Form.Text className="text-muted">E.g. "1, 10" means 1 minute then 10 minute step before graduating.</Form.Text>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowSettingsModal(false)}>Cancel</Button>
            <Button variant="primary" onClick={handleSaveSettings}>Save Changes</Button>
          </Modal.Footer>
        </Modal>
      </Container>
    );
  }

  // Session Complete Screen
  if (sessionComplete) {
    return (
      <Container className="mt-4" style={{ maxWidth: '600px' }}>
        <Card className="shadow-sm text-center">
          <Card.Body className="py-5">
            <h2 className="mb-3">🎉 Session Complete!</h2>
            <p className="lead mb-4">
              You reviewed <strong>{reviewedCount}</strong> card{reviewedCount !== 1 ? 's' : ''}.
            </p>

            {stats && (
              <Row className="text-center mb-4">
                <Col><div className="fw-bold text-danger h4">{stats.dueCount}</div><small className="text-muted">Still Due</small></Col>
                <Col><div className="fw-bold h4">{stats.reviewedToday}</div><small className="text-muted">Reviewed Today</small></Col>
                <Col><div className="fw-bold text-success h4">{stats.matureCards}</div><small className="text-muted">Mature</small></Col>
              </Row>
            )}

            <div className="d-flex gap-2 justify-content-center">
              <Button variant="primary" onClick={startSession}>
                Review More
              </Button>
              <Button variant="outline-secondary" onClick={() => {
                setSessionStarted(false);
                setSessionComplete(false);
                loadStats();
              }}>
                Back to Setup
              </Button>
            </div>
          </Card.Body>
        </Card>
      </Container>
    );
  }

  // Review Card Screen
  return (
    <Container className="mt-3" style={{ maxWidth: '700px' }}>
      {/* Progress Bar */}
      <div className="d-flex align-items-center mb-2 gap-2">
        <small className="text-muted">{reviewedCount}/{cards.length}</small>
        <ProgressBar
          now={(reviewedCount / cards.length) * 100}
          className="flex-grow-1"
          style={{ height: '8px' }}
          variant="success"
        />
        {undoVisible && (
          <Button variant="warning" size="sm" onClick={handleUndo} disabled={submitting}>
            ↩ Undo ({undoTimer}s)
          </Button>
        )}
        <Button
          variant="outline-secondary"
          size="sm"
          onClick={() => {
            setSessionStarted(false);
            setSessionComplete(false);
            loadStats();
          }}
        >
          End
        </Button>
      </div>

      {error && <Alert variant="danger" className="mb-2" dismissible onClose={() => setError(null)}>{error}</Alert>}

      {currentCard && (
        <Card className="shadow-sm" style={{ minHeight: '400px' }}>
          <Card.Body className="d-flex flex-column">
            {/* Card Header */}
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="d-flex align-items-center gap-1">
                <Badge bg={STATUS_VARIANTS[currentCard.wordStatus]}>
                  {STATUS_LABELS[currentCard.wordStatus]}
                </Badge>
                {currentCard.isLearning && (
                  <Badge bg="warning" text="dark">📖 Learning</Badge>
                )}
                {currentCard.flag > 0 && (
                  <span title={`Flag: ${FLAG_LABELS[currentCard.flag]}`}>{FLAG_COLORS[currentCard.flag]}</span>
                )}
              </div>
              <div className="d-flex align-items-center gap-1">
                {/* Flag dropdown */}
                <div className="dropdown d-inline-block">
                  <Button variant="outline-secondary" size="sm" className="py-0 px-1" data-bs-toggle="dropdown" title="Set flag">
                    🏳️
                  </Button>
                  <ul className="dropdown-menu dropdown-menu-end">
                    {FLAG_LABELS.map((label, idx) => (
                      <li key={idx}>
                        <button className="dropdown-item" onClick={() => handleFlag(currentCard.srsCardReviewId, idx)}>
                          {idx === 0 ? '🏳️' : FLAG_COLORS[idx]} {label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button variant="outline-secondary" size="sm" className="py-0 px-1" onClick={() => handleSuspend(currentCard.srsCardReviewId)} title="Suspend card">
                  ⏸
                </Button>
                <Button variant="outline-secondary" size="sm" className="py-0 px-1" onClick={() => handleBury(currentCard.srsCardReviewId)} title="Bury until tomorrow">
                  ⬇
                </Button>
                <small className="text-muted ms-1">
                  {currentCard.unknownWordsInPhrase > 0 &&
                    <Badge bg={currentCard.unknownWordsInPhrase === 1 ? 'success' : 'warning'} className="me-1">
                      {currentCard.unknownWordsInPhrase === 1 ? '1T' : `${currentCard.unknownWordsInPhrase}T`}
                    </Badge>
                  }
                  Rep: {currentCard.repetitions} | Int: {currentCard.interval}d
                </small>
              </div>
            </div>

            {/* Front: Sentence */}
            <div
              className="flex-grow-1 d-flex flex-column justify-content-center align-items-center text-center"
              style={{ cursor: !isFlipped ? 'pointer' : 'default', minHeight: '200px' }}
              onClick={() => !isFlipped && setIsFlipped(true)}
            >
              {currentCard.phrases && currentCard.phrases.length > 0 ? (
                <div>
                  <p className="lead mb-2" style={{ fontSize: '1.3rem', lineHeight: '1.8' }}>
                    {renderSentenceWithHighlight(currentCard.phrases[0].sentence, currentCard.term)}
                  </p>
                  {currentCard.phrases[0].textTitle && (
                    <small className="text-muted d-block">
                      From: <em>{currentCard.phrases[0].textTitle}</em>
                    </small>
                  )}
                </div>
              ) : (
                <p className="lead mb-2" style={{ fontSize: '1.5rem' }}>
                  <span style={{
                    backgroundColor: '#ffdd66',
                    color: '#000',
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontWeight: 'bold'
                  }}>
                    {currentCard.term}
                  </span>
                </p>
              )}

              {!isFlipped && (
                <div className="mt-3">
                  <small className="text-muted">
                    Click or press <kbd>Space</kbd> to reveal
                  </small>
                </div>
              )}

              {/* Back: Translation & Details */}
              {isFlipped && (
                <div className="mt-3 pt-3 border-top w-100" style={{ animation: 'fadeIn 0.2s ease-in' }}>
                  <h4 className="mb-1">{currentCard.term}</h4>
                  <p className="text-muted mb-2" style={{ fontSize: '1.2rem' }}>
                    {currentCard.translation || <em>No translation</em>}
                  </p>

                  {/* Additional phrases */}
                  {currentCard.phrases && currentCard.phrases.length > 1 && (
                    <div className="mt-2 text-start">
                      <small className="text-muted d-block mb-1">Other mined sentences:</small>
                      {currentCard.phrases.slice(1, 3).map((phrase, i) => (
                        <small key={phrase.srsPhraseId} className="d-block text-muted mb-1" style={{ fontStyle: 'italic' }}>
                          "{phrase.sentence}"
                          {phrase.textTitle && <> — {phrase.textTitle}</>}
                        </small>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Grade Buttons */}
            {isFlipped && (
              <div className="mt-3">
                <ButtonGroup className="w-100">
                  {GRADE_LABELS.map(({ grade, label, variant, key }) => (
                    <Button
                      key={grade}
                      variant={variant}
                      onClick={() => handleGrade(grade)}
                      disabled={submitting}
                      className="py-2"
                      style={{ flex: 1 }}
                    >
                      <div className="fw-bold">{label}</div>
                      <small style={{ opacity: 0.8 }}>{getIntervalLabel(grade, currentCard)}</small>
                      <div><kbd>{key}</kbd></div>
                    </Button>
                  ))}
                </ButtonGroup>
              </div>
            )}
          </Card.Body>
        </Card>
      )}
    </Container>
  );
};

export default SrsReview;
