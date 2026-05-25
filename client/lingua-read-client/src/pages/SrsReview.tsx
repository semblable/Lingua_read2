import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Button, Spinner, Alert, Form, Row, Col, Badge, ProgressBar, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { SettingsContext } from '../contexts/SettingsContext';
import { getAllLanguages, getSrsDueCards, submitSrsReview, getSrsStats, updateUserSettings, undoSrsReview, getSrsForecast, suspendSrsCard, burySrsCard, updateSrsCard, getSrsHeatmap, getSrsAnalytics } from '../utils/api';
import type { Language } from '../utils/api/languages';
import type { SrsDueCards, SrsStats, SrsForecast, SrsHeatmap, SrsAnalytics } from '../utils/api/srs';
import {
  WORD_STATUS_LABELS as STATUS_LABELS,
  WORD_STATUS_VARIANTS as STATUS_VARIANTS,
  type WordStatus
} from '../types/wordStatus';
import ClozeReviewCard from '../components/srs/ClozeReviewCard';
import './SrsReview.css';

type DueCard = SrsDueCards[number];
type ForecastEntry = SrsForecast[number];
type HeatmapEntry = SrsHeatmap[number];

const FLAG_COLORS = ['', '🟥', '🟧', '🟨', '🟩'];
const FLAG_LABELS = ['None', 'Red', 'Orange', 'Yellow', 'Green'];

const GRADE_LABELS = [
  { grade: 0, label: 'Again', variant: 'danger', key: '1' },
  { grade: 1, label: 'Hard', variant: 'warning', key: '2' },
  { grade: 2, label: 'Good', variant: 'success', key: '3' },
  { grade: 3, label: 'Easy', variant: 'info', key: '4' },
];

/**
 * Decide whether a given card should render as a cloze in "mixed" mode.
 * Knuth multiplicative hash of (cardId XOR sessionSeed) — deterministic
 * per (id, seed), so the card type is stable across re-renders within a
 * session, but a fresh seed each session means users can't game the
 * deterministic id-parity pattern the old `cardId % 2` produced.
 */
const shouldRenderClozeForMixedMode = (cardId: number, sessionSeed: number): boolean => {
  const h = Math.imul((cardId ^ sessionSeed) >>> 0, 2654435761) >>> 0;
  return (h & 1) === 0;
};

const SrsReview = () => {
  const navigate = useNavigate();

  // Random seed for "mixed" SRS card type — see shouldRenderClozeForMixedMode.
  // Stable for the lifetime of this mounted component (one review session),
  // so card types don't flip mid-card on re-render.
  const mixedModeSessionSeed = useMemo(() => Math.floor(Math.random() * 0x100000000), []);

  // Setup state
  const [languages, setLanguages] = useState<Language[]>([]);
  const [selectedLanguage, setSelectedLanguage] = useState(() =>
    localStorage.getItem('srsSelectedLanguage') || ''
  );
  // Include Known (5): stats count all due SRS cards; excluding 5 hid due "Known" words from sessions.
  const [statusFilter, setStatusFilter] = useState<number[]>([1, 2, 3, 4, 5]);
  const [onlyOneTarget, setOnlyOneTarget] = useState(false);

  // Load languages
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

  // Settings
  const { settings, updateSetting } = React.useContext(SettingsContext);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  // Form inputs return strings from onChange events; consumers parseInt at
  // read sites. Widen the state shape so the setters compile.
  type SrsLocalSettings = {
    srsMaxNewCards: number | string;
    srsMaxReviews: number | string;
    srsReviewOrder: string;
    srsLearningStepMinutes: string;
    srsMaxIntervalDays: number | string;
    srsLapseMinimumIntervalDays: number | string;
    srsCardType: string;
  };
  const [localSettings, setLocalSettings] = useState<SrsLocalSettings>({
    srsMaxNewCards: 20,
    srsMaxReviews: 200,
    srsReviewOrder: 'mix',
    srsLearningStepMinutes: '1,10',
    srsMaxIntervalDays: 36500,
    srsLapseMinimumIntervalDays: 1,
    srsCardType: 'translation'
  });

  useEffect(() => {
    setLocalSettings({
      srsMaxNewCards: settings?.srsMaxNewCards ?? 20,
      srsMaxReviews: settings?.srsMaxReviews ?? 100,
      srsReviewOrder: settings?.srsReviewOrder ?? 'mix',
      srsLearningStepMinutes: settings?.srsLearningStepMinutes ?? '1,10',
      srsMaxIntervalDays: settings?.srsMaxIntervalDays ?? 36500,
      srsLapseMinimumIntervalDays: settings?.srsLapseMinimumIntervalDays ?? 1,
      srsCardType: settings?.srsCardType ?? 'translation'
    });
  }, [settings]);

  const handleSaveSettings = async () => {
    const maxNew = parseInt(String(localSettings.srsMaxNewCards), 10);
    const maxReviews = parseInt(String(localSettings.srsMaxReviews), 10);
    if (isNaN(maxNew) || maxNew < 1) {
      setError('Max new cards must be a positive number.');
      return;
    }
    if (isNaN(maxReviews) || maxReviews < 1) {
      setError('Max reviews must be a positive number.');
      return;
    }
    const maxInterval = parseInt(String(localSettings.srsMaxIntervalDays), 10);
    const lapseMin = parseInt(String(localSettings.srsLapseMinimumIntervalDays), 10);
    if (isNaN(maxInterval) || maxInterval < 1) {
      setError('Max interval must be at least 1 day.');
      return;
    }
    if (isNaN(lapseMin) || lapseMin < 1) {
      setError('Lapse minimum interval must be at least 1 day.');
      return;
    }
    try {
      await updateUserSettings({
        srsMaxNewCards: maxNew,
        srsMaxReviews: maxReviews,
        srsReviewOrder: localSettings.srsReviewOrder,
        srsLearningStepMinutes: localSettings.srsLearningStepMinutes,
        srsMaxIntervalDays: maxInterval,
        srsLapseMinimumIntervalDays: lapseMin,
        srsCardType: localSettings.srsCardType
      });
      updateSetting('srsMaxNewCards', maxNew);
      updateSetting('srsMaxReviews', maxReviews);
      updateSetting('srsReviewOrder', localSettings.srsReviewOrder);
      updateSetting('srsLearningStepMinutes', localSettings.srsLearningStepMinutes);
      updateSetting('srsMaxIntervalDays', maxInterval);
      updateSetting('srsLapseMinimumIntervalDays', lapseMin);
      updateSetting('srsCardType', localSettings.srsCardType);
      setShowSettingsModal(false);
      loadStats(); // refresh visual stats
    } catch (err: unknown) {
      setError(`Failed to save settings: ${(err as Error)?.message}`);
    }
  };

  // Session state
  const [cards, setCards] = useState<DueCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isFlipped, setIsFlipped] = useState(false);
  const [sessionStarted, setSessionStarted] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);

  // Loading/error
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Stats
  const [stats, setStats] = useState<SrsStats | null>(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const [forecast, setForecast] = useState<ForecastEntry[]>([]);
  const [heatmap, setHeatmap] = useState<HeatmapEntry[]>([]);
  const [analytics, setAnalytics] = useState<SrsAnalytics | null>(null);

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
      const analyticsData = await getSrsAnalytics(selectedLanguage);
      setAnalytics(analyticsData);
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
    } catch (err: unknown) {
      setError(`Failed to load cards: ${(err as Error)?.message}`);
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

  const primaryPhrase = useMemo(() => {
    if (!currentCard?.phrases?.length || !currentCard?.term) return null;
    const lowerTerm = currentCard.term.toLowerCase();
    return currentCard.phrases.find(
      (phrase) => typeof phrase?.sentence === 'string' && phrase.sentence.toLowerCase().includes(lowerTerm)
    ) || null;
  }, [currentCard]);

  const otherPhrases = useMemo(() => {
    if (!currentCard?.phrases?.length) return [];
    if (!primaryPhrase) return currentCard.phrases.slice(0, 2);
    return currentCard.phrases
      .filter((phrase) => phrase.srsPhraseId !== primaryPhrase.srsPhraseId)
      .slice(0, 2);
  }, [currentCard, primaryPhrase]);

  // Handle grading
  const handleGrade = useCallback(async (grade: number) => {
    if (!currentCard || submitting) return;
    setSubmitting(true);
    setUndoVisible(false); // Hide any existing undo before submitting new

    try {
      if (currentCard.srsCardReviewId == null) return;
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
    } catch (err: unknown) {
      setError(`Failed to submit review: ${(err as Error)?.message}`);
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
    } catch (err: unknown) {
      setError(`Failed to undo: ${(err as Error)?.message}`);
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

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'SELECT') return;

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

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const langId = e.target.value;
    setSelectedLanguage(langId);
    localStorage.setItem('srsSelectedLanguage', langId);
    setSessionStarted(false);
    setSessionComplete(false);
    setCards([]);
  };

  const handleStatusFilterChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { value, checked } = e.target;
    const statusValue = parseInt(value, 10);
    setStatusFilter(prev =>
      checked ? [...prev, statusValue] : prev.filter(s => s !== statusValue)
    );
  };

  // Highlight target word in sentence
  const renderSentenceWithHighlight = (sentence: string | null | undefined, term: string | null | undefined): React.ReactNode => {
    if (!sentence || !term) return sentence;
    const regex = new RegExp(`(${term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
    const parts = sentence.split(regex);
    return parts.map((part: string, i: number) =>
      i % 2 === 1
        ? <span key={i} className="srs-term-highlight">{part}</span>
        : part
    );
  };

  // Parse learning steps from settings
  const learningSteps = useMemo(() => {
    const raw = localSettings.srsLearningStepMinutes || '1,10';
    return raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => n > 0);
  }, [localSettings.srsLearningStepMinutes]);

  const getIntervalLabel = (grade: number, card: DueCard | null): string => {
    if (!card) return '';
    const ef = card.easeFactor ?? 2.5;

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
          if (nextStep >= learningSteps.length) {
            const isRelearning = card.hasEverGraduated;
            const lapseMin = parseInt(String(localSettings.srsLapseMinimumIntervalDays), 10) || 1;
            return isRelearning ? `${lapseMin}d` : '1d';
          }
          return `${learningSteps[nextStep]}m`;
        }
        case 3: { // Easy: graduate immediately (from any step)
          const isRelearning = card.hasEverGraduated;
          const lapseMin = parseInt(String(localSettings.srsLapseMinimumIntervalDays), 10) || 1;
          return isRelearning ? `${lapseMin * 2}d` : '4d';
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
        else interval = Math.round((card.interval ?? 0) * ef);
        return `${interval}d`;
      case 3:
        if (card.repetitions === 0) interval = 1;
        else if (card.repetitions === 1) interval = 6;
        else interval = Math.round((card.interval ?? 0) * ef);
        interval = Math.round(interval * 1.3);
        return `${interval}d`;
      default: return '';
    }
  };

  // Remove card from session and handle index/completion
  const removeCardFromSession = (cardId: number) => {
    setCards(prev => {
      const updated = prev.filter((c) => c.srsCardReviewId !== cardId);
      if (updated.length === 0 || currentIndex >= updated.length) {
        setSessionComplete(true);
        loadStats();
      }
      return updated;
    });
  };

  // Suspend card handler
  const handleSuspend = async (cardId: number) => {
    try {
      await suspendSrsCard(cardId);
      removeCardFromSession(cardId);
    } catch (err: unknown) {
      setError(`Failed to suspend: ${(err as Error)?.message}`);
    }
  };

  // Bury card handler
  const handleBury = async (cardId: number) => {
    try {
      await burySrsCard(cardId);
      removeCardFromSession(cardId);
    } catch (err: unknown) {
      setError(`Failed to bury: ${(err as Error)?.message}`);
    }
  };

  // Flag card handler
  const handleFlag = async (cardId: number, flagValue: number) => {
    try {
      await updateSrsCard(cardId, { flag: flagValue });
      setCards(prev => prev.map((c) => c.srsCardReviewId === cardId ? { ...c, flag: flagValue } : c));
    } catch (err: unknown) {
      setError(`Failed to flag: ${(err as Error)?.message}`);
    }
  };

  // Build heatmap grid helper
  const renderHeatmap = () => {
    if (!heatmap || heatmap.length === 0) return null;
    const heatmapMap: Record<string, number> = {};
    heatmap.forEach((h) => { if (h.date) heatmapMap[h.date] = h.reviewCount ?? 0; });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const maxCount = Math.max(...heatmap.map((h) => h.reviewCount ?? 0), 1);

    interface HeatmapDay { date: string; count: number; dayOfWeek: number; }
    // Build 365 days of data ending today
    const days: HeatmapDay[] = [];
    for (let i = 364; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().slice(0, 10);
      days.push({ date: dateStr, count: heatmapMap[dateStr] || 0, dayOfWeek: d.getDay() });
    }

    // Group into weeks (columns)
    const weeks: (HeatmapDay | null)[][] = [];
    let currentWeek: (HeatmapDay | null)[] = new Array(7).fill(null);
    days.forEach((day: HeatmapDay, idx: number) => {
      currentWeek[day.dayOfWeek] = day;
      if (day.dayOfWeek === 6 || idx === days.length - 1) {
        weeks.push(currentWeek);
        currentWeek = new Array(7).fill(null);
      }
    });

    const getColor = (count: number) => {
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
            {week.map((day: HeatmapDay | null, di: number) => (
              <div
                key={di}
                className="srs-heatmap-cell"
                title={day ? `${day.date}: ${day.count} reviews` : ''}
                style={{
                  width: '10px',
                  height: '10px',
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
          <Card className="mb-3 shadow-sm srs-stats-card">
            <Card.Body className="py-3">
              <div className="d-flex justify-content-between align-items-center mb-3">
                <Badge bg="danger" className="srs-streak-badge">Streak: {stats.currentStreak}d ({stats.longestStreak} best)</Badge>
                <Badge bg="success" className="srs-streak-badge">Retention: {stats.retentionRate}%</Badge>
              </div>
              <Row className="text-center g-2 mb-3">
                <Col>
                  <div className="srs-stat-value text-danger">{stats.reviewableCount ?? stats.dueCount}</div>
                  <div className="srs-stat-label">Due{stats.reviewableCount != null && stats.reviewableCount < (stats.dueCount ?? 0) ? <small className="text-muted"> ({stats.dueCount} total)</small> : ''}</div>
                </Col>
                <Col><div className="srs-stat-value text-info">{stats.newCards}</div><div className="srs-stat-label">New</div></Col>
                <Col><div className="srs-stat-value text-warning">{stats.learningCards}</div><div className="srs-stat-label">Learning</div></Col>
                <Col><div className="srs-stat-value text-success">{stats.matureCards}</div><div className="srs-stat-label">Mature</div></Col>
                <Col><div className="srs-stat-value">{stats.reviewedToday}</div><div className="srs-stat-label">Today</div></Col>
              </Row>
              <div className="border-top pt-2">
                <Row className="text-center g-2">
                  <Col>
                    <ProgressBar
                      now={(stats.maxNewCards ?? 0) > 0 ? ((stats.studiedNewCardsToday ?? 0) / (stats.maxNewCards ?? 1)) * 100 : 0}
                      variant="info"
                      style={{ height: '4px' }}
                      className="mb-1"
                    />
                    <small className="text-muted">{stats.studiedNewCardsToday}/{stats.maxNewCards} new</small>
                  </Col>
                  <Col>
                    <ProgressBar
                      now={(stats.maxReviews ?? 0) > 0 ? ((stats.studiedReviewsToday ?? 0) / (stats.maxReviews ?? 1)) * 100 : 0}
                      variant="primary"
                      style={{ height: '4px' }}
                      className="mb-1"
                    />
                    <small className="text-muted">{stats.studiedReviewsToday}/{stats.maxReviews} reviews</small>
                  </Col>
                </Row>
              </div>
            </Card.Body>
          </Card>
        )}

        {forecast && forecast.length > 0 && !statsLoading && (
          <Card className="mb-3 shadow-sm">
            <Card.Body className="py-2">
              <small className="text-muted fw-bold mb-2 d-block text-center">Upcoming Reviews (14 Days)</small>
              <div className="d-flex align-items-end justify-content-between" style={{ height: '80px' }}>
                {forecast.map((day, idx) => {
                  const dayCount = day.count ?? 0;
                  const maxCount = Math.max(...forecast.map(f => f.count ?? 0), 1);
                  const heightPct = (dayCount / maxCount) * 100;
                  const dateObj = day.date ? new Date(day.date) : null;
                  const dayStr = idx === 0 ? 'Today' : dateObj?.toLocaleDateString(undefined, { weekday: 'short' }) ?? '';
                  return (
                    <div key={idx} className="d-flex flex-column align-items-center" style={{ flex: 1 }} title={`${day.date}: ${dayCount} cards`}>
                      <div className="bg-primary rounded-top" style={{ width: '60%', height: `${Math.max(heightPct, 5)}%`, opacity: dayCount > 0 ? 0.8 : 0.2, minHeight: '4px' }}></div>
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

        {/* Analytics: Retention by Status & Grade Distribution */}
        {analytics && !statsLoading && (
          <Row className="mb-3 g-3">
            <Col md={6}>
              <Card className="shadow-sm h-100">
                <Card.Body className="py-2">
                  <small className="text-muted fw-bold mb-2 d-block text-center">Retention by Status (30d)</small>
                  {analytics.retentionByStatus?.map((r) => (
                    <div key={r.status} className="d-flex align-items-center mb-1">
                      <Badge bg={STATUS_VARIANTS[r.status as WordStatus]} className="me-2" style={{ width: '70px', fontSize: '0.7rem' }}>
                        {STATUS_LABELS[r.status as WordStatus]}
                      </Badge>
                      <ProgressBar
                        now={r.retentionRate}
                        variant={(r.retentionRate ?? 0) >= 80 ? 'success' : (r.retentionRate ?? 0) >= 60 ? 'warning' : 'danger'}
                        style={{ height: '8px', flex: 1 }}
                      />
                      <small className="ms-2 text-muted" style={{ width: '40px', textAlign: 'right' }}>{r.retentionRate}%</small>
                    </div>
                  ))}
                  {(analytics.retentionByStatus?.length ?? 0) === 0 && (
                    <small className="text-muted d-block text-center">No review data yet</small>
                  )}
                </Card.Body>
              </Card>
            </Col>
            <Col md={6}>
              <Card className="shadow-sm h-100">
                <Card.Body className="py-2">
                  <small className="text-muted fw-bold mb-2 d-block text-center">Grade Distribution (30d)</small>
                  {[
                    { grade: 0, label: 'Again', variant: 'danger' },
                    { grade: 1, label: 'Hard', variant: 'warning' },
                    { grade: 2, label: 'Good', variant: 'success' },
                    { grade: 3, label: 'Easy', variant: 'info' },
                  ].map(({ grade, label, variant }) => {
                    const item = analytics.gradeDistribution?.find((g) => g.grade === grade);
                    const count = item?.count || 0;
                    const total = analytics.totalReviewsLast30Days || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={grade} className="d-flex align-items-center mb-1">
                        <small className="me-2" style={{ width: '45px', fontSize: '0.75rem' }}>{label}</small>
                        <ProgressBar now={pct} variant={variant} style={{ height: '8px', flex: 1 }} />
                        <small className="ms-2 text-muted" style={{ width: '50px', textAlign: 'right' }}>{count} ({pct}%)</small>
                      </div>
                    );
                  })}
                  <div className="text-center mt-1">
                    <small className="text-muted">{analytics.avgReviewsPerDay} avg/day &middot; {analytics.cardsMaturedThisWeek} matured this week</small>
                  </div>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        )}

        {/* Leech Cards */}
        {analytics && (analytics.leechCards?.length ?? 0) > 0 && !statsLoading && (
          <Card className="mb-3 shadow-sm border-warning">
            <Card.Body className="py-2">
              <small className="text-muted fw-bold mb-2 d-block">Leeches — cards with 3+ lapses (30d)</small>
              <div className="d-flex flex-wrap gap-2">
                {analytics.leechCards?.map((lc) => (
                  <Badge
                    key={lc.srsCardReviewId}
                    bg="warning"
                    text="dark"
                    className="d-flex align-items-center gap-1"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    title={`${lc.translation} — ${lc.lapseCount} lapses, ease ${(lc.easeFactor ?? 0).toFixed(2)}`}
                  >
                    {lc.term} <span className="opacity-75">({lc.lapseCount}x)</span>
                    <span
                      role="button"
                      title="Bury until tomorrow"
                      className="ms-1 opacity-50"
                      style={{ cursor: 'pointer', fontSize: '0.7rem' }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        try { if (lc.srsCardReviewId != null) { await burySrsCard(lc.srsCardReviewId); loadStats(); } }
                        catch (err: unknown) { setError(`Failed to bury: ${(err as Error)?.message}`); }
                      }}
                    >⏸</span>
                    <span
                      role="button"
                      title="Suspend card"
                      className="opacity-50"
                      style={{ cursor: 'pointer', fontSize: '0.7rem' }}
                      onClick={async (e) => {
                        e.stopPropagation();
                        try { if (lc.srsCardReviewId != null) { await suspendSrsCard(lc.srsCardReviewId); loadStats(); } }
                        catch (err: unknown) { setError(`Failed to suspend: ${(err as Error)?.message}`); }
                      }}
                    >⛔</span>
                  </Badge>
                ))}
              </div>
            </Card.Body>
          </Card>
        )}

        {statsLoading && <div className="text-center mb-3"><Spinner size="sm" /></div>}

        <Card className="shadow-sm srs-setup-card">
          <Card.Body>
            <Form.Group className="mb-3">
              <Form.Label>Language</Form.Label>
              <Form.Select value={selectedLanguage} onChange={handleLanguageChange}>
                <option value="">-- Select Language --</option>
                {languages.map((lang) => (
                  <option key={lang.languageId} value={lang.languageId}>{lang.name}</option>
                ))}
              </Form.Select>
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Word Status Filter</Form.Label>
              <div>
                {([1, 2, 3, 4, 5] as WordStatus[]).map(s => (
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
                variant="outline-info"
                size="lg"
                onClick={() => navigate('/srs/story')}
                title="Generate a story with your due words"
              >
                Story Mode
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
            <Form.Group className="mb-3">
              <Form.Label>Maximum Interval (days)</Form.Label>
              <Form.Control
                type="number"
                min={1}
                max={36500}
                value={localSettings.srsMaxIntervalDays}
                onChange={e => setLocalSettings(p => ({ ...p, srsMaxIntervalDays: e.target.value }))}
              />
              <Form.Text className="text-muted">Cards won't be scheduled further than this many days into the future. Default: 36500 (~100 years).</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3">
              <Form.Label>Lapse Minimum Interval (days)</Form.Label>
              <Form.Control
                type="number"
                min={1}
                max={365}
                value={localSettings.srsLapseMinimumIntervalDays}
                onChange={e => setLocalSettings(p => ({ ...p, srsLapseMinimumIntervalDays: e.target.value }))}
              />
              <Form.Text className="text-muted">After failing a card, its interval won't go below this value after re-learning. Default: 1.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" data-testid="srs-card-type-group">
              <Form.Label>Card Style</Form.Label>
              <Form.Check
                type="radio"
                name="srsCardType"
                id="srs-card-type-translation"
                label="Translation — show the word, recall its meaning (recognition)"
                value="translation"
                checked={localSettings.srsCardType === 'translation'}
                onChange={() => setLocalSettings(p => ({ ...p, srsCardType: 'translation' }))}
              />
              <Form.Check
                type="radio"
                name="srsCardType"
                id="srs-card-type-cloze"
                label="Cloze — hide the word in its sentence, type or recall it (active recall)"
                value="cloze"
                checked={localSettings.srsCardType === 'cloze'}
                onChange={() => setLocalSettings(p => ({ ...p, srsCardType: 'cloze' }))}
              />
              <Form.Check
                type="radio"
                name="srsCardType"
                id="srs-card-type-mixed"
                label="Mixed — alternate between translation and cloze per card"
                value="mixed"
                checked={localSettings.srsCardType === 'mixed'}
                onChange={() => setLocalSettings(p => ({ ...p, srsCardType: 'mixed' }))}
              />
              <Form.Text className="text-muted">
                Cloze cards require a mined sentence. Cards without one fall back to the translation style.
              </Form.Text>
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
        <Card className="srs-complete-card text-center">
          <Card.Body className="py-5">
            <div className="srs-complete-emoji">🎉</div>
            <h3 className="mb-2">Session Complete</h3>
            <p className="text-muted mb-4">
              You reviewed <strong>{reviewedCount}</strong> card{reviewedCount !== 1 ? 's' : ''}
            </p>

            {stats && (
              <>
                <Row className="text-center mb-3 g-3">
                  <Col>
                    <div className="srs-stat-value text-danger">{stats.reviewableCount ?? stats.dueCount}</div>
                    <div className="srs-stat-label">Still Due{stats.reviewableCount != null && stats.reviewableCount < (stats.dueCount ?? 0) ? <small className="text-muted"> ({stats.dueCount} total)</small> : ''}</div>
                  </Col>
                  <Col><div className="srs-stat-value">{stats.reviewedToday}</div><div className="srs-stat-label">Today</div></Col>
                  <Col><div className="srs-stat-value text-success">{stats.matureCards}</div><div className="srs-stat-label">Mature</div></Col>
                </Row>
                {(stats.dueCount ?? 0) > 0 && (stats.reviewableCount ?? stats.dueCount ?? 0) === 0 && (
                  <Alert variant="info" className="mb-4 text-start py-2 small">
                    {(stats.studiedNewCardsToday ?? 0) >= (stats.maxNewCards ?? 0) && <div>New card limit reached ({stats.maxNewCards}/day)</div>}
                    {(stats.studiedReviewsToday ?? 0) >= (stats.maxReviews ?? 0) && <div>Review limit reached ({stats.maxReviews}/day)</div>}
                    <div className="text-muted mt-1">Adjust limits in settings to review more.</div>
                  </Alert>
                )}
              </>
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
          className="flex-grow-1 srs-progress-bar"
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
        <Card className="srs-review-card" style={{ minHeight: '400px' }}>
          <Card.Body className="d-flex flex-column">
            {/* Card Header */}
            <div className="d-flex justify-content-between align-items-center mb-2">
              <div className="d-flex align-items-center gap-1">
                <Badge bg={STATUS_VARIANTS[currentCard.wordStatus as WordStatus]}>
                  {STATUS_LABELS[currentCard.wordStatus as WordStatus]}
                </Badge>
                {currentCard.isLearning && (
                  <Badge bg="warning" text="dark">📖 Learning</Badge>
                )}
                {(currentCard.flag ?? 0) > 0 && (
                  <span title={`Flag: ${FLAG_LABELS[currentCard.flag!]}`}>{FLAG_COLORS[currentCard.flag!]}</span>
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
                        <button className="dropdown-item" onClick={() => currentCard.srsCardReviewId != null && handleFlag(currentCard.srsCardReviewId, idx)}>
                          {idx === 0 ? '🏳️' : FLAG_COLORS[idx]} {label}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
                <Button variant="outline-secondary" size="sm" className="py-0 px-1" onClick={() => currentCard.srsCardReviewId != null && handleSuspend(currentCard.srsCardReviewId)} title="Suspend card">
                  ⏸
                </Button>
                <Button variant="outline-secondary" size="sm" className="py-0 px-1" onClick={() => currentCard.srsCardReviewId != null && handleBury(currentCard.srsCardReviewId)} title="Bury until tomorrow">
                  ⬇
                </Button>
                <small className="text-muted ms-1">
                  {(currentCard.unknownWordsInPhrase ?? 0) > 0 &&
                    <Badge bg={currentCard.unknownWordsInPhrase === 1 ? 'success' : 'warning'} className="me-1">
                      {currentCard.unknownWordsInPhrase === 1 ? '1T' : `${currentCard.unknownWordsInPhrase}T`}
                    </Badge>
                  }
                  Rep: {currentCard.repetitions} | Int: {currentCard.interval}d
                </small>
              </div>
            </div>

            {/* Front: Sentence (translation or cloze) */}
            {(() => {
              // Decide per-card whether to render a cloze view. "translation" (default)
              // never renders cloze; "cloze" always wants it; "mixed" uses a per-session
              // seeded hash so the cloze/translation choice is unpredictable across
              // sessions but stable within one. Cards lacking a server-supplied
              // clozeSentence (e.g. term not present in any mined phrase) fall back to
              // the translation view.
              const cardTypeSetting = settings?.srsCardType ?? 'translation';
              const wantCloze =
                cardTypeSetting === 'cloze' ||
                (cardTypeSetting === 'mixed' &&
                  shouldRenderClozeForMixedMode(
                    currentCard.srsCardReviewId ?? 0,
                    mixedModeSessionSeed
                  ));
              const renderCloze = wantCloze && !!currentCard.clozeSentence;

              if (renderCloze) {
                return (
                  <div
                    className="flex-grow-1 d-flex flex-column justify-content-center align-items-center"
                    style={{ minHeight: '200px' }}
                  >
                    <ClozeReviewCard
                      cardId={currentCard.srsCardReviewId ?? 0}
                      clozeSentence={currentCard.clozeSentence!}
                      term={currentCard.term ?? ''}
                      translation={currentCard.translation ?? ''}
                      isFlipped={isFlipped}
                      onReveal={() => setIsFlipped(true)}
                      otherPhrases={otherPhrases}
                    />
                  </div>
                );
              }

              return (
                <div
                  className="flex-grow-1 d-flex flex-column justify-content-center align-items-center text-center"
                  style={{ cursor: !isFlipped ? 'pointer' : 'default', minHeight: '200px' }}
                  onClick={() => !isFlipped && setIsFlipped(true)}
                  data-testid="translation-review-card"
                >
                  {primaryPhrase ? (
                    <div>
                      <p className="srs-sentence mb-2">
                        {renderSentenceWithHighlight(primaryPhrase.sentence, currentCard.term)}
                      </p>
                    </div>
                  ) : (
                    <p className="mb-2" style={{ fontSize: '1.5rem' }}>
                      <span className="srs-term-highlight">{currentCard.term}</span>
                    </p>
                  )}

                  {!isFlipped && (
                    <div className="mt-3 srs-reveal-hint">
                      Click or press <kbd>Space</kbd> to reveal
                    </div>
                  )}

                  {/* Back: Translation & Details */}
                  {isFlipped && (
                    <div className="srs-answer-area mt-3 pt-3 border-top w-100">
                      <h4 className="mb-1">{currentCard.term}</h4>
                      <p className="srs-translation mb-2">
                        {currentCard.translation || <em className="text-muted">No translation</em>}
                      </p>

                      {otherPhrases.length > 0 && (
                        <div className="mt-2 text-start">
                          <small className="text-muted d-block mb-1">Other mined sentences:</small>
                          {otherPhrases.map((phrase) => (
                            <small key={phrase.srsPhraseId} className="srs-other-phrases d-block mb-1">
                              "{phrase.sentence}"
                            </small>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Grade Buttons */}
            {isFlipped && (
              <div className="mt-3 srs-grade-buttons">
                {GRADE_LABELS.map(({ grade, label, variant, key }) => (
                  <Button
                    key={grade}
                    variant={variant}
                    onClick={() => handleGrade(grade)}
                    disabled={submitting}
                    className="srs-grade-btn"
                  >
                    <div className="fw-bold">{label}</div>
                    <div className="interval-label">{getIntervalLabel(grade, currentCard)}</div>
                    <kbd>{key}</kbd>
                  </Button>
                ))}
              </div>
            )}
          </Card.Body>
        </Card>
      )}
    </Container>
  );
};

export default SrsReview;
