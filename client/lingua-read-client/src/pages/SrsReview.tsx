import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Container, Card, Button, Spinner, Alert, Form, Row, Col, Badge, ProgressBar, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { SettingsContext } from '../contexts/SettingsContext';
import { getAllLanguages, getSrsDueCards, submitSrsReview, getSrsStats, updateUserSettings, undoSrsReview, cancelQueuedSrsReview, getSrsForecast, suspendSrsCard, unsuspendSrsCard, burySrsCard, updateSrsCard, getSrsHeatmap, getSrsAnalytics, getSrsSuspendedCards } from '../utils/api';
import type { Language } from '../utils/api/languages';
import type { SrsDueCards, SrsStats, SrsForecast, SrsHeatmap, SrsAnalytics, SrsSuspendedCards } from '../utils/api/srs';
import {
  createSessionQueue,
  formatInterval,
  nextCard,
  remainingCount,
  requeue,
  takeCard,
  type SessionQueue,
} from '../utils/srsSessionQueue';
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

// What undo needs to put the session back as it was before the last grade.
type LastGrade = {
  card: DueCard;
  queue: SessionQueue<DueCard>;
  clientEventId: string;
  logId: number | null; // null while the grade waits in the offline queue
};

// Local calendar date as YYYY-MM-DD. (toISOString() would give the UTC date,
// which is yesterday for part of every evening east of Greenwich.)
const localDateKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Parses a server YYYY-MM-DD as a local date, not as UTC midnight.
const parseLocalDate = (key: string): Date => new Date(`${key}T00:00:00`);

const learningDueAt = (card: DueCard): number | null =>
  card.isLearning && card.nextReviewAt ? Date.parse(card.nextReviewAt) : null;

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
 *
 * We branch on the high bit, not the low one: 2654435761 is odd, so
 * `(x * 2654435761) & 1 === x & 1` and the multiplication does nothing to
 * the low bit. Knuth's multiplicative hash puts its entropy in the upper
 * bits — `h >>> 31` gives a well-mixed bit that doesn't track input parity.
 */
const shouldRenderClozeForMixedMode = (cardId: number, sessionSeed: number): boolean => {
  const h = Math.imul((cardId ^ sessionSeed) >>> 0, 2654435761) >>> 0;
  return (h >>> 31) === 0;
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
    srsRelearningStepMinutes: string;
    srsDesiredRetention: number | string;
    srsDayStartHour: number | string;
    srsFsrsWeights: string;
    srsAutoCreateCards: string;
    srsStatusSyncMode: string;
    srsStatusLevel3Days: number | string;
    srsStatusLevel4Days: number | string;
    srsAutoKnownDays: number | string;
    srsKnownCardAction: string;
    srsLeechThreshold: number | string;
    srsLeechAction: string;
  };
  const [localSettings, setLocalSettings] = useState<SrsLocalSettings>({
    srsMaxNewCards: 20,
    srsMaxReviews: 200,
    srsReviewOrder: 'mix',
    srsLearningStepMinutes: '1,10',
    srsMaxIntervalDays: 36500,
    srsLapseMinimumIntervalDays: 1,
    srsCardType: 'translation',
    srsRelearningStepMinutes: '10',
    srsDesiredRetention: 0.9,
    srsDayStartHour: 4,
    srsFsrsWeights: '',
    srsAutoCreateCards: 'always',
    srsStatusSyncMode: 'promote',
    srsStatusLevel3Days: 7,
    srsStatusLevel4Days: 21,
    srsAutoKnownDays: 0,
    srsKnownCardAction: 'keep',
    srsLeechThreshold: 8,
    srsLeechAction: 'tag'
  });

  useEffect(() => {
    setLocalSettings({
      srsMaxNewCards: settings?.srsMaxNewCards ?? 20,
      srsMaxReviews: settings?.srsMaxReviews ?? 200,
      srsReviewOrder: settings?.srsReviewOrder ?? 'mix',
      srsLearningStepMinutes: settings?.srsLearningStepMinutes ?? '1,10',
      srsMaxIntervalDays: settings?.srsMaxIntervalDays ?? 36500,
      srsLapseMinimumIntervalDays: settings?.srsLapseMinimumIntervalDays ?? 1,
      srsCardType: settings?.srsCardType ?? 'translation',
      srsRelearningStepMinutes: settings?.srsRelearningStepMinutes ?? '10',
      srsDesiredRetention: settings?.srsDesiredRetention ?? 0.9,
      srsDayStartHour: settings?.srsDayStartHour ?? 4,
      srsFsrsWeights: settings?.srsFsrsWeights ?? '',
      srsAutoCreateCards: settings?.srsAutoCreateCards ?? 'always',
      srsStatusSyncMode: settings?.srsStatusSyncMode ?? 'promote',
      srsStatusLevel3Days: settings?.srsStatusLevel3Days ?? 7,
      srsStatusLevel4Days: settings?.srsStatusLevel4Days ?? 21,
      srsAutoKnownDays: settings?.srsAutoKnownDays ?? 0,
      srsKnownCardAction: settings?.srsKnownCardAction ?? 'keep',
      srsLeechThreshold: settings?.srsLeechThreshold ?? 8,
      srsLeechAction: settings?.srsLeechAction ?? 'tag'
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
    const desiredRetention = parseFloat(String(localSettings.srsDesiredRetention));
    if (isNaN(desiredRetention) || desiredRetention < 0.7 || desiredRetention > 0.97) {
      setError('Desired retention must be between 0.70 and 0.97.');
      return;
    }
    const dayStartHour = parseInt(String(localSettings.srsDayStartHour), 10);
    if (isNaN(dayStartHour) || dayStartHour < 0 || dayStartHour > 23) {
      setError('The new day must start at an hour from 0 to 23.');
      return;
    }
    const fsrsWeights = localSettings.srsFsrsWeights.trim();
    const level3Days = parseInt(String(localSettings.srsStatusLevel3Days), 10);
    const level4Days = parseInt(String(localSettings.srsStatusLevel4Days), 10);
    const autoKnownDays = parseInt(String(localSettings.srsAutoKnownDays), 10) || 0;
    if (isNaN(level3Days) || isNaN(level4Days) || level3Days < 1 || level4Days < level3Days
        || (autoKnownDays > 0 && autoKnownDays < level4Days)) {
      setError('Status thresholds must rise: level 3 <= level 4 <= Known (or Known set to 0 for never).');
      return;
    }
    const leechThreshold = parseInt(String(localSettings.srsLeechThreshold), 10);
    if (isNaN(leechThreshold) || leechThreshold < 0 || leechThreshold > 100) {
      setError('Leech threshold must be between 0 (off) and 100.');
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
        srsCardType: localSettings.srsCardType,
        srsRelearningStepMinutes: localSettings.srsRelearningStepMinutes,
        srsDesiredRetention: desiredRetention,
        srsDayStartHour: dayStartHour,
        srsFsrsWeights: fsrsWeights,
        srsAutoCreateCards: localSettings.srsAutoCreateCards,
        srsStatusSyncMode: localSettings.srsStatusSyncMode,
        srsStatusLevel3Days: level3Days,
        srsStatusLevel4Days: level4Days,
        srsAutoKnownDays: autoKnownDays,
        srsKnownCardAction: localSettings.srsKnownCardAction,
        srsLeechThreshold: leechThreshold,
        srsLeechAction: localSettings.srsLeechAction
      });
      updateSetting('srsMaxNewCards', maxNew);
      updateSetting('srsMaxReviews', maxReviews);
      updateSetting('srsReviewOrder', localSettings.srsReviewOrder);
      updateSetting('srsLearningStepMinutes', localSettings.srsLearningStepMinutes);
      updateSetting('srsMaxIntervalDays', maxInterval);
      updateSetting('srsLapseMinimumIntervalDays', lapseMin);
      updateSetting('srsCardType', localSettings.srsCardType);
      updateSetting('srsRelearningStepMinutes', localSettings.srsRelearningStepMinutes);
      updateSetting('srsDesiredRetention', desiredRetention);
      updateSetting('srsDayStartHour', dayStartHour);
      updateSetting('srsFsrsWeights', fsrsWeights || null);
      updateSetting('srsAutoCreateCards', localSettings.srsAutoCreateCards);
      updateSetting('srsStatusSyncMode', localSettings.srsStatusSyncMode);
      updateSetting('srsStatusLevel3Days', level3Days);
      updateSetting('srsStatusLevel4Days', level4Days);
      updateSetting('srsAutoKnownDays', autoKnownDays);
      updateSetting('srsKnownCardAction', localSettings.srsKnownCardAction);
      updateSetting('srsLeechThreshold', leechThreshold);
      updateSetting('srsLeechAction', localSettings.srsLeechAction);
      setShowSettingsModal(false);
      loadStats(); // refresh visual stats
    } catch (err: unknown) {
      setError(`Failed to save settings: ${(err as Error)?.message}`);
    }
  };

  // Session state. The queue holds the cards still to come (including learning
  // cards that come back within the session); currentCard has been taken out of it.
  const [queue, setQueue] = useState<SessionQueue<DueCard>>({ unseen: [], learning: [] });
  const [currentCard, setCurrentCard] = useState<DueCard | null>(null);
  const [lastGrade, setLastGrade] = useState<LastGrade | null>(null);
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
  const [suspendedCards, setSuspendedCards] = useState<SrsSuspendedCards>([]);

  // Shown briefly when a review moved the word's reader status (word-status sync)
  const [statusNotice, setStatusNotice] = useState<string | null>(null);

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
      const suspendedData = await getSrsSuspendedCards(selectedLanguage);
      setSuspendedCards(suspendedData ?? []);
    } catch (err) {
      console.error('Failed to load stats, forecast, or heatmap:', err);
    } finally {
      setStatsLoading(false);
    }
  }, [selectedLanguage]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  // Shows the next card from `q`, or ends the session when there is none.
  const advance = useCallback((q: SessionQueue<DueCard>) => {
    const next = nextCard(q, Date.now());
    setQueue(next ? takeCard(q, next) : q);
    setCurrentCard(next);
    setIsFlipped(false);
    if (!next) setSessionComplete(true);
    return next;
  }, [setQueue, setCurrentCard, setIsFlipped, setSessionComplete]);

  // Start review session
  const startSession = useCallback(async () => {
    if (!selectedLanguage) return;
    setLoading(true);
    setError(null);
    setSessionComplete(false);
    setReviewedCount(0);
    setLastGrade(null);
    setUndoVisible(false);

    try {
      const data = await getSrsDueCards(selectedLanguage, {
        status: statusFilter,
        onlyOneTarget,
        limit: 50
      });
      setSessionStarted(true);
      advance(createSessionQueue(data ?? [], learningDueAt, Date.now()));
    } catch (err: unknown) {
      setError(`Failed to load cards: ${(err as Error)?.message}`);
    } finally {
      setLoading(false);
    }
  }, [selectedLanguage, statusFilter, onlyOneTarget, advance]);

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
    if (currentCard.srsCardReviewId == null) return;
    setSubmitting(true);
    setUndoVisible(false); // Hide any existing undo before submitting new

    try {
      const submitted = await submitSrsReview(currentCard.srsCardReviewId, grade);
      setReviewedCount(prev => prev + 1);

      // A card sent to a (re)learning step comes back later in this session.
      // (A grade queued offline has no server result yet, so its card is done for now.)
      let nextQueue = queue;
      if (!submitted.queued) {
        const result = submitted.result;
        if (result.isLearning && !result.isSuspended && result.nextReviewAt) {
          const updated: DueCard = { ...currentCard, ...result };
          nextQueue = requeue(queue, updated, Date.parse(result.nextReviewAt), Date.now());
        }
      }

      const statusChange = submitted.queued ? null : submitted.result.wordStatusChange;
      if (!submitted.queued && submitted.result.becameLeech) {
        setStatusNotice(
          `${currentCard.term} is a leech (forgotten ${submitted.result.lapses} times)${submitted.result.isSuspended ? ' and was suspended' : ''}. Try a new sentence or mnemonic for it.`
        );
      } else if (statusChange?.from != null && statusChange.to != null) {
        setStatusNotice(
          `Word status: ${currentCard.term}: ${STATUS_LABELS[statusChange.from as WordStatus]} → ${STATUS_LABELS[statusChange.to as WordStatus]}`
        );
      }

      setLastGrade({
        card: currentCard,
        queue,
        clientEventId: submitted.clientEventId,
        logId: submitted.queued ? null : submitted.result.srsReviewLogId ?? null,
      });
      setUndoVisible(true);
      setUndoTimer(5);

      if (!advance(nextQueue)) loadStats();
    } catch (err: unknown) {
      setError(`Failed to submit review: ${(err as Error)?.message}`);
    } finally {
      setSubmitting(false);
    }
  }, [currentCard, queue, submitting, loadStats, advance]);

  const handleUndo = async () => {
    if (submitting || !lastGrade) return;
    try {
      setSubmitting(true);
      // A grade still waiting offline is simply dropped from the queue; one the
      // server already applied is reverted by its log id, or, if it was queued
      // offline and has synced since, by the clientEventId it was sent with.
      const cancelled = lastGrade.logId == null && await cancelQueuedSrsReview(lastGrade.clientEventId);
      if (!cancelled) {
        await undoSrsReview(lastGrade.logId != null
          ? { srsReviewLogId: lastGrade.logId }
          : { clientEventId: lastGrade.clientEventId });
      }
      setUndoVisible(false);
      setReviewedCount(prev => Math.max(0, prev - 1));

      // Put the session back as it was before that grade.
      setQueue(lastGrade.queue);
      setCurrentCard(lastGrade.card);
      setLastGrade(null);
      setSessionComplete(false);
      setIsFlipped(true); // Show back of the card they just undid
      loadStats(); // Refresh limits
    } catch (err: unknown) {
      setError(`Failed to undo: ${(err as Error)?.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  useEffect(() => {
    if (!statusNotice) return;
    const timer = setTimeout(() => setStatusNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [statusNotice]);

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
    setQueue({ unseen: [], learning: [] });
    setCurrentCard(null);
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

  // The server previews what each grade would do, so labels always match the scheduler.
  const getIntervalLabel = (grade: number, card: DueCard | null): string =>
    formatInterval(card?.nextIntervals?.[grade]);

  // Remove the current card from the session (suspended or buried) and move on
  const removeCardFromSession = (cardId: number) => {
    if (currentCard?.srsCardReviewId !== cardId) return;
    setLastGrade(null);
    setUndoVisible(false);
    if (!advance(queue)) loadStats();
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

  // Unsuspend handler (suspended and leech lists): the card goes back into review
  const handleUnsuspend = async (cardId: number) => {
    try {
      await unsuspendSrsCard(cardId);
      loadStats();
    } catch (err: unknown) {
      setError(`Failed to unsuspend: ${(err as Error)?.message}`);
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
      setCurrentCard(c => (c && c.srsCardReviewId === cardId ? { ...c, flag: flagValue } : c));
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
      const dateStr = localDateKey(d);
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
                <Badge bg="success" className="srs-streak-badge" title="Share of graduated cards you remembered when they came due (last 30 days)">True retention: {stats.retentionRate}%</Badge>
              </div>
              <Row className="text-center g-2 mb-3">
                <Col>
                  <div className="srs-stat-value text-danger">{stats.reviewableCount ?? stats.dueCount}</div>
                  <div className="srs-stat-label">Due{stats.reviewableCount != null && stats.reviewableCount < (stats.dueCount ?? 0) ? <small className="text-muted"> ({stats.dueCount} total)</small> : ''}</div>
                </Col>
                <Col><div className="srs-stat-value text-info">{stats.newCards}</div><div className="srs-stat-label">New</div></Col>
                <Col><div className="srs-stat-value text-warning">{stats.learningCards}</div><div className="srs-stat-label">Learning</div></Col>
                <Col><div className="srs-stat-value text-primary">{stats.youngCards}</div><div className="srs-stat-label">Young</div></Col>
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
                  const dateObj = day.date ? parseLocalDate(day.date) : null;
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
                  <small className="text-muted fw-bold mb-2 d-block text-center">True Retention by Status (30d)</small>
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
              <small className="text-muted fw-bold mb-2 d-block">
                Struggling cards — forgotten most often{(analytics.leechThreshold ?? 0) > 0 ? ` (leech at ${analytics.leechThreshold})` : ''}
              </small>
              <div className="d-flex flex-wrap gap-2">
                {analytics.leechCards?.map((lc) => (
                  <Badge
                    key={lc.srsCardReviewId}
                    bg="warning"
                    text="dark"
                    className="d-flex align-items-center gap-1"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    title={`${lc.translation} — ${lc.lapseCount} lapses${lc.difficulty != null ? `, difficulty ${lc.difficulty.toFixed(1)}/10` : ''}${lc.isSuspended ? ' (suspended)' : ''}`}
                  >
                    {lc.term} <span className="opacity-75">({lc.lapseCount}x{lc.isSuspended ? ', suspended' : ''})</span>
                    {lc.isSuspended ? (
                      <span
                        role="button"
                        title="Unsuspend: back into review"
                        aria-label={`Unsuspend ${lc.term}`}
                        className="ms-1 opacity-50"
                        style={{ cursor: 'pointer', fontSize: '0.7rem' }}
                        onClick={(e) => {
                          e.stopPropagation();
                          if (lc.srsCardReviewId != null) handleUnsuspend(lc.srsCardReviewId);
                        }}
                      >▶</span>
                    ) : (
                      <>
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
                      </>
                    )}
                  </Badge>
                ))}
              </div>
            </Card.Body>
          </Card>
        )}

        {/* Suspended cards: out of review until unsuspended. Cards suspended for their
            word's status (Ignored, retired Known) follow the status and aren't listed. */}
        {suspendedCards.length > 0 && !statsLoading && (
          <Card className="mb-3 shadow-sm">
            <Card.Body className="py-2">
              <small className="text-muted fw-bold mb-2 d-block">
                Suspended cards ({suspendedCards.length}) — out of review until unsuspended
              </small>
              <div className="d-flex flex-wrap gap-2" style={{ maxHeight: '9rem', overflowY: 'auto' }}>
                {suspendedCards.map((sc) => (
                  <Badge
                    key={sc.srsCardReviewId}
                    bg="secondary"
                    className="d-flex align-items-center gap-1"
                    style={{ fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}
                    title={`${sc.translation}${sc.suspendReason === 'leech' ? ` — leech, ${sc.lapses} lapses` : ''}`}
                  >
                    {sc.term}
                    {sc.suspendReason === 'leech' && <span className="opacity-75">(leech)</span>}
                    <span
                      role="button"
                      title="Unsuspend: back into review"
                      aria-label={`Unsuspend ${sc.term}`}
                      className="ms-1 opacity-75"
                      style={{ cursor: 'pointer', fontSize: '0.7rem' }}
                      onClick={() => { if (sc.srsCardReviewId != null) handleUnsuspend(sc.srsCardReviewId); }}
                    >▶</span>
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
              <Form.Text className="text-muted">E.g. "1, 10": a new card is shown again after 1 minute, then 10 minutes, before its first day-long interval.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="srs-relearning-steps">
              <Form.Label>Relearning Steps (minutes, comma-separated)</Form.Label>
              <Form.Control
                type="text"
                placeholder="10"
                value={localSettings.srsRelearningStepMinutes}
                onChange={e => setLocalSettings(p => ({ ...p, srsRelearningStepMinutes: e.target.value }))}
              />
              <Form.Text className="text-muted">Steps a card you forgot goes through before it returns to review.</Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="srs-desired-retention">
              <Form.Label>Desired Retention</Form.Label>
              <Form.Control
                type="number"
                min={0.7}
                max={0.97}
                step={0.01}
                value={localSettings.srsDesiredRetention}
                onChange={e => setLocalSettings(p => ({ ...p, srsDesiredRetention: e.target.value }))}
              />
              <Form.Text className="text-muted">
                How likely you should be to remember a card when it comes due (0.70-0.97, default 0.90). Higher means more reviews.
                Changing it reschedules your existing cards.
              </Form.Text>
            </Form.Group>
            <Form.Group className="mb-3" controlId="srs-day-start-hour">
              <Form.Label>Next Day Starts At (hour)</Form.Label>
              <Form.Control
                type="number"
                min={0}
                max={23}
                value={localSettings.srsDayStartHour}
                onChange={e => setLocalSettings(p => ({ ...p, srsDayStartHour: e.target.value }))}
              />
              <Form.Text className="text-muted">Daily limits and streaks roll over at this local hour (default 4, so late-night reviews count for the day before). Changing it reschedules your existing cards.</Form.Text>
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
              <Form.Text className="text-muted">After you forget a card, its next interval won't go below this. Default: 1.</Form.Text>
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
            <fieldset className="border-top pt-3 mb-3" data-testid="srs-status-sync-group">
              <legend className="fs-6">Word status sync</legend>
              <Form.Group className="mb-2" controlId="srs-auto-create-cards">
                <Form.Label>Create a card when you save a word</Form.Label>
                <Form.Select
                  value={localSettings.srsAutoCreateCards}
                  onChange={e => setLocalSettings(p => ({ ...p, srsAutoCreateCards: e.target.value }))}
                >
                  <option value="always">Always (statuses 1-4)</option>
                  <option value="with_sentence">Only when a sentence is saved with it</option>
                  <option value="never">Never (only with "Mine sentence")</option>
                </Form.Select>
              </Form.Group>
              <Form.Group className="mb-2" controlId="srs-status-sync-mode">
                <Form.Label>Reviews change the word's status</Form.Label>
                <Form.Select
                  value={localSettings.srsStatusSyncMode}
                  onChange={e => setLocalSettings(p => ({ ...p, srsStatusSyncMode: e.target.value }))}
                >
                  <option value="promote">Raise it as the card gets stronger</option>
                  <option value="promote_demote">Raise it, and lower it when you forget the card</option>
                  <option value="off">Never</option>
                </Form.Select>
              </Form.Group>
              <Row className="g-2 mb-2">
                <Col>
                  <Form.Group controlId="srs-status-level3-days">
                    <Form.Label className="small">Status 3 at (days)</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      value={localSettings.srsStatusLevel3Days}
                      onChange={e => setLocalSettings(p => ({ ...p, srsStatusLevel3Days: e.target.value }))}
                    />
                  </Form.Group>
                </Col>
                <Col>
                  <Form.Group controlId="srs-status-level4-days">
                    <Form.Label className="small">Status 4 at (days)</Form.Label>
                    <Form.Control
                      type="number"
                      min={1}
                      value={localSettings.srsStatusLevel4Days}
                      onChange={e => setLocalSettings(p => ({ ...p, srsStatusLevel4Days: e.target.value }))}
                    />
                  </Form.Group>
                </Col>
                <Col>
                  <Form.Group controlId="srs-auto-known-days">
                    <Form.Label className="small">Known at (days, 0 = never)</Form.Label>
                    <Form.Control
                      type="number"
                      min={0}
                      value={localSettings.srsAutoKnownDays}
                      onChange={e => setLocalSettings(p => ({ ...p, srsAutoKnownDays: e.target.value }))}
                    />
                  </Form.Group>
                </Col>
              </Row>
              <Form.Text className="text-muted d-block mb-2">
                Days are the card's memory strength: roughly how long until you have a 90% chance of recalling it.
                A card that leaves the learning steps makes the word at least status 2.
              </Form.Text>
              <Form.Group controlId="srs-known-card-action">
                <Form.Label>When a word becomes Known</Form.Label>
                <Form.Select
                  value={localSettings.srsKnownCardAction}
                  onChange={e => setLocalSettings(p => ({ ...p, srsKnownCardAction: e.target.value }))}
                >
                  <option value="keep">Keep reviewing its card</option>
                  <option value="suspend">Retire (suspend) its card</option>
                </Form.Select>
                <Form.Text className="text-muted">Ignored words always have their card suspended.</Form.Text>
              </Form.Group>
            </fieldset>
            <fieldset className="border-top pt-3 mb-3">
              <legend className="fs-6">Leeches</legend>
              <Row className="g-2">
                <Col xs={5}>
                  <Form.Group controlId="srs-leech-threshold">
                    <Form.Label className="small">Leech after (times forgotten)</Form.Label>
                    <Form.Control
                      type="number"
                      min={0}
                      max={100}
                      value={localSettings.srsLeechThreshold}
                      onChange={e => setLocalSettings(p => ({ ...p, srsLeechThreshold: e.target.value }))}
                    />
                  </Form.Group>
                </Col>
                <Col>
                  <Form.Group controlId="srs-leech-action">
                    <Form.Label className="small">Then</Form.Label>
                    <Form.Select
                      value={localSettings.srsLeechAction}
                      onChange={e => setLocalSettings(p => ({ ...p, srsLeechAction: e.target.value }))}
                    >
                      <option value="tag">Tag it "leech"</option>
                      <option value="suspend">Tag and suspend it</option>
                    </Form.Select>
                  </Form.Group>
                </Col>
              </Row>
              <Form.Text className="text-muted">
                A card forgotten this many times (and every half as many again) wastes review time; 0 turns this off.
              </Form.Text>
            </fieldset>
            <details className="mb-2">
              <summary className="small text-muted">Advanced: FSRS parameters</summary>
              <Form.Group className="mt-2" controlId="srs-fsrs-weights">
                <Form.Control
                  as="textarea"
                  rows={3}
                  placeholder="Leave empty to use the FSRS-6 defaults"
                  value={localSettings.srsFsrsWeights}
                  onChange={e => setLocalSettings(p => ({ ...p, srsFsrsWeights: e.target.value }))}
                />
                <Form.Text className="text-muted">
                  21 comma-separated weights, e.g. from an FSRS optimizer. Changing them reschedules your existing cards.
                </Form.Text>
              </Form.Group>
            </details>
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
              {undoVisible && (
                <Button variant="warning" onClick={handleUndo} disabled={submitting}>
                  ↩ Undo last ({undoTimer}s)
                </Button>
              )}
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
  const sessionTotal = reviewedCount + remainingCount(queue) + (currentCard ? 1 : 0);
  return (
    <Container className="mt-3" style={{ maxWidth: '700px' }}>
      {/* Progress Bar */}
      <div className="d-flex align-items-center mb-2 gap-2">
        <small className="text-muted">{reviewedCount}/{sessionTotal}</small>
        <ProgressBar
          now={sessionTotal > 0 ? (reviewedCount / sessionTotal) * 100 : 0}
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
      {statusNotice && (
        <Alert variant="success" className="mb-2 py-1 small" data-testid="srs-status-notice">
          {statusNotice}
        </Alert>
      )}

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
                  Int: {currentCard.interval}d
                  {currentCard.retrievability != null && (
                    <span title="Estimated chance of remembering this card right now"> | R: {Math.round(currentCard.retrievability * 100)}%</span>
                  )}
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
