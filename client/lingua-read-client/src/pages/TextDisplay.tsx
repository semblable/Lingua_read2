import React, { useEffect, useState, useCallback, useRef, useMemo, useContext } from 'react';
import { Container, Card, Spinner, Alert, Button, Modal, Row, Col, Badge, ProgressBar, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom';
import type { FixedSizeList } from 'react-window';
import {
  getText, getTextSrt, getWordLinkingStatus, createWord, updateWord, deleteWord, updateLastRead, completeLesson, getBook,
  translateText, translateSentence, translateFullText, translateSelectionWithContext, updateUserSettings,
  explainSentence, mineSentence,
  batchTranslateWords, addTermsBatch, getLanguage, getAllLanguages, summarizeText,
  getSentenceProgress, logSentenceReadActivity,
  API_URL, applySrsReadingCredit
} from '../utils/api';
import TranslationPopup from '../components/TranslationPopup';
import SummaryPopup from '../components/SummaryPopup';
import AudiobookPlayer from '../components/AudiobookPlayer';
import DownloadForOfflineButton from '../components/offline/DownloadForOfflineButton';
import './TextDisplay.css';
import { SettingsContext } from '../contexts/SettingsContext';
import { useReaderBookmarks } from '../hooks/useReaderBookmarks';
import { useReaderKeyboard, type WordStatus } from '../hooks/useReaderKeyboard';
import { useWordTranslation } from '../hooks/useWordTranslation';
import { useReaderAudioSync } from '../hooks/useReaderAudioSync';
import { useReaderState, type FetchAllLanguageWordsFn } from '../hooks/useReaderState';
import { extractTranslatedTextFromPairedTags } from '../utils/translationTags';
import { cancelSpeech, isSpeechSynthesisSupported, speakText } from '../utils/browserTts';
import { parseSrtContent, findSrtLineIndex } from '../utils/srtParser';
import { styles, splitTextIntoSentenceSegments, prepareLanguageContext, consumeWordAt } from '../utils/readerText';
import type { SentenceSegment } from '../utils/readerText';
import PrimaryControls from '../components/reader/PrimaryControls';
import SecondaryControls from '../components/reader/SecondaryControls';
import ReaderLessonActions from '../components/reader/ReaderLessonActions';
import MobileLessonHeader from '../components/reader/MobileLessonHeader';
import LessonHeader from '../components/reader/LessonHeader';
import WordInfoPanel from '../components/reader/WordInfoPanel';
import AudioTranscriptView from '../components/reader/AudioTranscriptView';
import StandardTextView from '../components/reader/StandardTextView';
import SentenceModeView from '../components/reader/SentenceModeView';
import type { Word } from '../utils/api/words';
import type { Language } from '../utils/api/languages';
import type { DisplayedWord } from '../types/displayedWord';

const TextDisplay = () => {
  const { textId } = useParams();
  const navigate = useNavigate();
  const textContentRef = useRef<HTMLDivElement | null>(null);
  const readingContainerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<FixedSizeList | null>(null);
  const autoTranslateTriggeredRef = useRef(false);
  const autoTranslateTextIdRef = useRef<number | string | null>(null);

  // --- State Declarations ---
  const [selectedWord, setSelectedWord] = useState('');
  const [hoveredWordTerm, setHoveredWordTerm] = useState<string | null>(null);
  const [processingWord, setProcessingWord] = useState(false);
  const [displayedWord, setDisplayedWord] = useState<DisplayedWord | null>(null);
  const [selectedWordAiContext, setSelectedWordAiContext] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [translatingUnknown, setTranslatingUnknown] = useState(false);
  const [translateUnknownError, setTranslateUnknownError] = useState('');
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [completing, setCompleting] = useState(false);
  // Stats returned from completeLesson; only a subset is shown in the modal.
  type LessonCompletionStats = {
    completionPercentage?: number;
    knownWords?: number;
    learningWords?: number;
    totalWords?: number;
  };
  const [stats, setStats] = useState<LessonCompletionStats | null>(null);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [showTranslationPopup, setShowTranslationPopup] = useState(false);
  const [fullTextTranslation, setFullTextTranslation] = useState('');
  const [isFullTextTranslating, setIsFullTextTranslating] = useState(false);
  // Use SettingsContext instead of local state for settings that are now global
  const { settings: globalSettings, updateSetting } = useContext(SettingsContext);
  const translationTargetLanguageCode = (globalSettings.translationTargetLanguageCode || 'EN').toUpperCase();
  const [showSummaryPopup, setShowSummaryPopup] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [summaryError, setSummaryError] = useState('');
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [summaryTargetLanguage, setSummaryTargetLanguage] = useState(translationTargetLanguageCode);
  const [summaryLanguages, setSummaryLanguages] = useState<Language[]>([]);
  const [isLoadingSummaryLanguages, setIsLoadingSummaryLanguages] = useState(false);
  // Local state only for panel width, as it's specific to this component's layout control
  const [leftPanelWidth, setLeftPanelWidth] = useState(globalSettings.leftPanelWidth || 85);
  // Local state for userSettings specific to TextDisplay (like textSize) if needed, or use globalSettings directly
  // For simplicity, let's assume textSize is also managed globally via context now.
  // If TextDisplay needs its own independent textSize, keep a local state for it.
  // Let's use globalSettings directly for textSize for now.
  // Removed isDragging state
  const [showMoreControls, setShowMoreControls] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileHeader, setShowMobileHeader] = useState(false);
  const showDesktopLessonControls = globalSettings.showDesktopLessonControls ?? true;
  const [isWordPanelOpen, setIsWordPanelOpen] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [segmentTranslations, setSegmentTranslations] = useState<Record<number, string>>({});
  const [segmentExplanations, setSegmentExplanations] = useState<Record<number, string>>({});
  const [isTranslatingSegment, setIsTranslatingSegment] = useState(false);
  const [isExplainingSegment, setIsExplainingSegment] = useState(false);
  const [visibleTranslationIndex, setVisibleTranslationIndex] = useState<number | null>(null);
  const [visibleExplanationIndex, setVisibleExplanationIndex] = useState<number | null>(null);
  const [creditedSegmentIndices, setCreditedSegmentIndices] = useState<number[]>([]);
  const selectionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileSelectionRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileSelectionPendingRef = useRef(false);
  const mobileSelectionObservedRef = useRef(false);
  const mobileSelectionWasActiveAtTouchStartRef = useRef(false);
  const mobileTouchStartedRef = useRef(false);
  const mobileTouchMovedRef = useRef(false);
  const mobileSelectionInitialTextRef = useRef('');
  const mobileSelectionGrewRef = useRef(false);
  const mobileSelectionStabilityRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastHandledSelectionRef = useRef('');
  const suppressWordClickUntilRef = useRef(0);
  const selectableWordTouchStartRef = useRef(0);
  const currentTextIdForSummaryRef = useRef<number | null>(null);
  const fetchAllLanguageWordsRef = useRef<FetchAllLanguageWordsFn | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mediaQuery = window.matchMedia('(max-width: 768px)');
    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
      if (!event.matches) {
        setShowMobileHeader(false);
        setShowMoreControls(false);
        setIsWordPanelOpen(false);
      }
    };
    setIsMobile(mediaQuery.matches);
    if (!mediaQuery.matches) {
      setShowMobileHeader(false);
      setShowMoreControls(false);
      setIsWordPanelOpen(false);
    }
    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, []);
  const clearPendingSelection = useCallback(() => {
    if (selectionDebounceRef.current) {
      clearTimeout(selectionDebounceRef.current);
      selectionDebounceRef.current = null;
    }
  }, []);

  const clearMobileSelectionRetry = useCallback(() => {
    if (mobileSelectionRetryRef.current) {
      clearTimeout(mobileSelectionRetryRef.current);
      mobileSelectionRetryRef.current = null;
    }
  }, []);

  const clearMobileSelectionStability = useCallback(() => {
    if (mobileSelectionStabilityRef.current) {
      clearTimeout(mobileSelectionStabilityRef.current);
      mobileSelectionStabilityRef.current = null;
    }
  }, []);

  const clearMobileSelectionPending = useCallback(() => {
    mobileSelectionPendingRef.current = false;
    mobileSelectionObservedRef.current = false;
    mobileSelectionWasActiveAtTouchStartRef.current = false;
    mobileTouchMovedRef.current = false;
    mobileSelectionInitialTextRef.current = '';
    mobileSelectionGrewRef.current = false;
    clearMobileSelectionRetry();
    clearMobileSelectionStability();
  }, [clearMobileSelectionRetry, clearMobileSelectionStability]);

  const isSentenceMode = globalSettings.sentenceMode;
  const sentenceAudioRepeats = globalSettings.sentenceAudioRepeats || 1;
  const sentenceTtsEnabled = globalSettings.sentenceTtsEnabled ?? false;
  const sentenceTtsRate = globalSettings.sentenceTtsRate ?? 1;
  const canUseSentenceTts = isSpeechSynthesisSupported();
  const readingDensity = globalSettings.readingDensity || 'balanced';
  const showWordInfoPanel = globalSettings.showWordInfoPanel ?? true;

  const hasActiveTextSelection = useCallback(() => {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  }, []);

  const {
    isBookmarked,
    toggleBookmarkForIndex,
    handleSentenceContextMenu
  } = useReaderBookmarks({ textId, isMobile, hasActiveTextSelection });

  const handleSentenceProgressApplied = useCallback(
    (initialSegmentIndex: number, credited: number[]) => {
      setCurrentSegmentIndex(initialSegmentIndex);
      setCreditedSegmentIndices(credited);
    },
    []
  );

  const {
    loading,
    setLoading,
    error,
    setError,
    text,
    setText,
    book,
    setBook,
    words,
    setWords,
    languageWordsLoaded,
    setLanguageWordsLoaded,
    languageConfig,
    setLanguageConfig,
    embeddedUrl,
    setEmbeddedUrl,
    previousTextId,
    nextTextId,
    isAudioLesson,
    setIsAudioLesson,
    displayMode,
    setDisplayMode,
    audioSrc,
    setAudioSrc,
    srtLines,
    setSrtLines,
    sentenceProgressLoaded,
    setSentenceProgressLoaded
  } = useReaderState({
    textId,
    fetchAllLanguageWordsRef,
    leftPanelWidthFromSettings: globalSettings.leftPanelWidth || 85,
    setLeftPanelWidth,
    onSentenceProgressApplied: handleSentenceProgressApplied,
    autoTranslateTriggeredRef,
    autoTranslateTextIdRef
  });

  const readingUiMode = isAudioLesson
    ? 'classic'
    : (globalSettings.readingUiMode === 'modern' ? 'modern' : 'classic');

  useEffect(() => {
    currentTextIdForSummaryRef.current = text?.textId ?? null;
    setShowSummaryPopup(false);
    setSummaryText('');
    setSummaryError('');
  }, [text?.textId]);

  const applyTranslationToDisplayedWord = useCallback(
    (term: string, translationText: string) => {
      setDisplayedWord(prev =>
        prev && prev.term === term ? { ...prev, translation: translationText } : prev
      );
    },
    []
  );

  const {
    translation,
    setTranslation,
    isTranslating,
    setIsTranslating,
    wordTranslationError,
    setWordTranslationError,
    triggerAutoTranslation,
    appendAutoTranslation,
    cancelInflight: cancelInflightTranslation
  } = useWordTranslation({
    text,
    globalSettings,
    targetLanguageCode: translationTargetLanguageCode,
    applyTranslationToDisplayedWord
  });

  const {
    audioRef,
    audioCurrentTimeRef,
    currentSrtLineId,
    setCurrentSrtLineId,
    isAudioPlaying,
    isSpeakingSentence,
    setIsSpeakingSentence,
    isSpeakingWord,
    setIsSpeakingWord,
    segmentPlaybackRequest,
    setSegmentPlaybackRequest,
    audioDrivenSentenceSyncRef,
    lastAutoSegmentPlaybackKeyRef,
    skipInitialAudioLessonSegmentPlaybackRef,
    pendingSentenceCreditRef,
    toggleAudioPlayback,
    pauseAudioPlayback,
    handleAudioPlaybackStateChange,
    handleLineClick,
    handleAudioTimeUpdate
  } = useReaderAudioSync({
    isAudioLesson,
    isSentenceMode,
    isMobile,
    displayMode,
    srtLines,
    currentSegmentIndex,
    setCurrentSegmentIndex,
    listRef
  });

  const previousLoadedTextIdRef = useRef<string | undefined>(textId);
  useEffect(() => {
    if (previousLoadedTextIdRef.current === textId) return;
    previousLoadedTextIdRef.current = textId;
    setCurrentSegmentIndex(0);
    setSegmentTranslations({});
    setSegmentExplanations({});
    setVisibleTranslationIndex(null);
    setVisibleExplanationIndex(null);
    setCreditedSegmentIndices([]);
    setSegmentPlaybackRequest(null);
    lastAutoSegmentPlaybackKeyRef.current = '';
    skipInitialAudioLessonSegmentPlaybackRef.current = true;
    pendingSentenceCreditRef.current = new Set();
  }, [
    textId,
    setSegmentPlaybackRequest,
    lastAutoSegmentPlaybackKeyRef,
    skipInitialAudioLessonSegmentPlaybackRef,
    pendingSentenceCreditRef
  ]);

  const focusSentenceIndexFromNode = useCallback((node: Node | null) => {
    const container = textContentRef.current;
    let currentNode: Node | null = node;
    while (currentNode && currentNode !== container) {
      if (
        currentNode.nodeType === Node.ELEMENT_NODE &&
        (currentNode as HTMLElement).classList?.contains('sentence')
      ) {
        const sentenceIndex = Number((currentNode as HTMLElement).getAttribute('data-sentence-index'));
        if (Number.isInteger(sentenceIndex) && sentenceIndex >= 0) {
          setCurrentSegmentIndex(sentenceIndex);
        }
        return;
      }
      currentNode = currentNode.parentNode;
    }
  }, []);

  /** Max chars sent as sentenceContext to avoid huge payloads; backend may also limit. */
  const MAX_AI_CONTEXT_CHARS = 100000;

  const normalizeReaderText = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim();

  const clampContext = (t: string | null | undefined): string => {
    if (!t) return '';
    return t.length > MAX_AI_CONTEXT_CHARS ? t.slice(0, MAX_AI_CONTEXT_CHARS) : t;
  };

  const readSentenceContextFromNode = useCallback((node: Node | null) => {
    const container = textContentRef.current;
    let currentNode: Node | null = node;
    while (currentNode && currentNode !== container) {
      if (
        currentNode.nodeType === Node.ELEMENT_NODE &&
        (currentNode as HTMLElement).classList?.contains('sentence')
      ) {
        const text = normalizeReaderText(currentNode.textContent);
        return text ? clampContext(text) : '';
      }
      currentNode = currentNode.parentNode;
    }
    return '';
  }, []);

  /**
   * Context for AI selection translation: prefer one .sentence, then a block (paragraph / group),
   * then full reader column, then the selection itself (so large / multi-sentence highlights still use AI).
   */
  const buildAiSelectionContext = useCallback((range: Range | null, container: HTMLElement | null, selectedText: string) => {
    if (!range || !container) {
      return clampContext(normalizeReaderText(selectedText));
    }

    let node: Node | null = range.commonAncestorContainer;
    if (node?.nodeType === Node.TEXT_NODE) {
      node = node.parentNode;
    }

    let walk: Node | null = node;
    while (walk && walk !== container) {
      if (walk.nodeType === Node.ELEMENT_NODE && (walk as HTMLElement).classList?.contains('sentence')) {
        const t = normalizeReaderText(walk.textContent);
        if (t) return clampContext(t);
      }
      walk = walk.parentNode;
    }

    const blockClassHints = [
      'reading-block',
      'reader-paragraph',
      'reader-title-block',
      'reading-block-group',
      'text-content',
      'sentence-mode-text',
      'sentence-mode-card',
      'audio-transcript-container',
      'srt-line',
      'reader-title-line'
    ];
    walk = node;
    while (walk && walk !== container) {
      if (walk.nodeType === Node.ELEMENT_NODE && (walk as HTMLElement).classList) {
        for (const cls of blockClassHints) {
          if ((walk as HTMLElement).classList.contains(cls)) {
            const t = normalizeReaderText(walk.textContent);
            if (t) return clampContext(t);
          }
        }
      }
      walk = walk.parentNode;
    }

    const full = normalizeReaderText(container.textContent);
    if (full) return clampContext(full);

    return clampContext(normalizeReaderText(selectedText));
  }, []);


  // --- Helper Functions & Memoized Values (Define BEFORE useEffects that use them) ---

  const handleLineSpacingChange = (newSpacing: number | string) => {
    const numericSpacing = parseFloat(String(newSpacing));
    if (!isNaN(numericSpacing)) {
      updateSetting('lineSpacing', numericSpacing); // Update context
      localStorage.setItem('lineSpacing', numericSpacing.toString()); // Persist to localStorage
      document.body.style.setProperty('--reading-line-height', numericSpacing.toString()); // Apply immediately
      updateUserSettings({ lineSpacing: numericSpacing })
        .catch((err: unknown) => console.error('[Save Settings] Failed to save line spacing via API:', err));
    }
  };

  const handleParagraphSpacingChange = (newSpacing: number | string) => {
    const numeric = parseFloat(String(newSpacing));
    if (!isNaN(numeric)) {
      updateSetting('paragraphSpacing', numeric);
      localStorage.setItem('paragraphSpacing', numeric.toString());
      document.body.style.setProperty('--reader-paragraph-spacing', numeric + 'em');
    }
  };

  const setReadingDensity = useCallback((nextValue: string) => {
    updateSetting('readingDensity', nextValue);
    localStorage.setItem('readingDensity', nextValue);
    updateUserSettings({ readingDensity: nextValue })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save reading density via API:', err));
  }, [updateSetting]);

  const setReaderContentWidth = useCallback((nextValue: number) => {
    const clamped = Math.max(520, Math.min(980, nextValue));
    updateSetting('readerContentWidth', clamped);
    localStorage.setItem('readerContentWidth', clamped.toString());
    updateUserSettings({ readerContentWidth: clamped })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save reader content width via API:', err));
  }, [updateSetting]);

  const setShowWordInfoPanel = useCallback((nextValue: boolean) => {
    updateSetting('showWordInfoPanel', nextValue);
    localStorage.setItem('showWordInfoPanel', nextValue.toString());
    updateUserSettings({ showWordInfoPanel: nextValue })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save word info panel visibility via API:', err));
  }, [updateSetting]);

  const setShowDesktopLessonControls = useCallback((nextValue: boolean | ((prev: boolean) => boolean)) => {
    const val = typeof nextValue === 'function' ? nextValue(globalSettings.showDesktopLessonControls ?? true) : nextValue;
    updateSetting('showDesktopLessonControls', val);
    localStorage.setItem('showDesktopLessonControls', val.toString());
    updateUserSettings({ showDesktopLessonControls: val })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save desktop lesson controls visibility via API:', err));
  }, [updateSetting, globalSettings.showDesktopLessonControls]);

  const setReaderParagraphIndent = useCallback((nextValue: boolean) => {
    updateSetting('readerParagraphIndent', nextValue);
    localStorage.setItem('readerParagraphIndent', nextValue.toString());
    updateUserSettings({ readerParagraphIndent: nextValue })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save paragraph indent via API:', err));
  }, [updateSetting]);

  const setReaderTextAlignment = useCallback((nextValue: string) => {
    updateSetting('readerTextAlignment', nextValue);
    localStorage.setItem('readerTextAlignment', nextValue);
    updateUserSettings({ readerTextAlignment: nextValue })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save text alignment via API:', err));
  }, [updateSetting]);

  const setSentenceModeEnabled = useCallback((nextValue: boolean) => {
    updateSetting('sentenceMode', nextValue);
    updateUserSettings({ sentenceMode: nextValue })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save sentence mode via API:', err));
  }, [updateSetting]);

  const setSentenceAudioRepeats = useCallback((updater: number | ((prev: number) => number)) => {
    const nextValue = typeof updater === 'function'
      ? updater(sentenceAudioRepeats)
      : updater;
    const clamped = Math.max(1, Math.min(10, nextValue));
    updateSetting('sentenceAudioRepeats', clamped);
    updateUserSettings({ sentenceAudioRepeats: clamped })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save sentence audio repeats via API:', err));
  }, [sentenceAudioRepeats, updateSetting]);

  const setSentenceTtsEnabled = useCallback((nextValue: boolean) => {
    updateSetting('sentenceTtsEnabled', nextValue);
    updateUserSettings({ sentenceTtsEnabled: nextValue })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save sentence TTS enabled via API:', err));
    if (!nextValue) {
      cancelSpeech();
      setIsSpeakingSentence(false);
      setIsSpeakingWord(false);
    }
  }, [updateSetting]);

  const setSentenceTtsRate = useCallback((updater: number | ((prev: number) => number)) => {
    const nextValue = typeof updater === 'function'
      ? updater(sentenceTtsRate)
      : updater;
    const clamped = Math.max(0.5, Math.min(1.5, Number(nextValue.toFixed(1))));
    updateSetting('sentenceTtsRate', clamped);
    updateUserSettings({ sentenceTtsRate: clamped })
      .catch((err: unknown) => console.error('[Save Settings] Failed to save sentence TTS rate via API:', err));
  }, [sentenceTtsRate, updateSetting]);

  const fetchAllLanguageWords = useCallback(async (
    languageId: number | string | null | undefined,
    shouldApply: () => boolean = () => true
  ) => {
    if (!languageId) return; // Guard against missing languageId
    try {
      const response = await fetch(`${API_URL}/words/language/${languageId}?skipSort=true`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) throw new Error('Failed to fetch language words');
      const allLanguageWords = await response.json();
      if (!shouldApply()) return;
      setWords(allLanguageWords);
      setLanguageWordsLoaded(true);
    } catch (error) {
      console.error('Error fetching language words:', error);
      if (shouldApply()) setLanguageWordsLoaded(true);
    }
  }, [setWords, setLanguageWordsLoaded]);
  fetchAllLanguageWordsRef.current = fetchAllLanguageWords as FetchAllLanguageWordsFn;

  // --- Optimized Data Structures ---
  // 1. Create a Map for O(1) word lookups
  const wordMap = useMemo<Map<string, Word>>(() => {
    const map = new Map<string, Word>();
    words.forEach(w => {
      if (w.term) map.set(w.term.toLowerCase(), w);
    });
    return map;
  }, [words]);

  // 2. Pre-calculate and sort phrases once
  const knownPhrases = useMemo(() => {
    return words
      .filter(w => w.term && w.term.includes(' '))
      .sort((a, b) => (b.term?.length ?? 0) - (a.term?.length ?? 0));
  }, [words]);

  const getWordData = useCallback((word: string | null | undefined) => {
    if (!word) return null;
    return wordMap.get(word.toLowerCase()) || null;
  }, [wordMap]);

  const getWordStyle = useCallback((wordStatus: number | null | undefined) => {
    const baseStyle = { cursor: 'pointer', padding: '2px 0', margin: '0 2px', borderRadius: '3px', transition: 'all 0.2s' };
    // Suppress highlights until full language words have loaded to avoid flash of "new" status
    if (!languageWordsLoaded) return { ...baseStyle, backgroundColor: 'transparent', color: 'inherit' };
    // Use globalSettings from context
    if (!globalSettings?.highlightKnownWords && wordStatus === 5) return { ...baseStyle, backgroundColor: 'transparent', color: 'inherit' };
    if (wordStatus === 5) return { ...baseStyle, backgroundColor: 'transparent', color: 'inherit' };
    // Ignored words render as plain text, like Known
    if (wordStatus === 6) return { ...baseStyle, backgroundColor: 'transparent', color: 'inherit' };
    const statusStyles: Record<number, { backgroundColor: string; color: string }> = {
      0: { backgroundColor: 'var(--status-0-color, #e0e0e0)', color: '#000' },
      1: { backgroundColor: 'var(--status-1-color, #ff6666)', color: '#000' },
      2: { backgroundColor: 'var(--status-2-color, #ff9933)', color: '#000' },
      3: { backgroundColor: 'var(--status-3-color, #ffdd66)', color: '#000' },
      4: { backgroundColor: 'var(--status-4-color, #99dd66)', color: '#000' },
    };
    return { ...baseStyle, ...(statusStyles[wordStatus ?? 0] || statusStyles[0]) };
  }, [languageWordsLoaded, globalSettings?.highlightKnownWords]); // Use globalSettings from context

  const handleWordClick = useCallback((
    word: string,
    options: { skipAutoTranslate?: boolean; preserveLastHandledSelection?: boolean; selectionContext?: string } = {}
  ) => {
    const { skipAutoTranslate = false, preserveLastHandledSelection = false, selectionContext = '' } = options;
    clearPendingSelection();
    if (!preserveLastHandledSelection) {
      lastHandledSelectionRef.current = '';
    }
    if (isAudioLesson && globalSettings.pauseOnWordClick) {
      pauseAudioPlayback();
      setSegmentPlaybackRequest(null);
    }
    setSelectedWord(word);
    setSelectedWordAiContext(selectionContext);
    setProcessingWord(false);
    setWordTranslationError('');
    if (isMobile) {
      setIsWordPanelOpen(true);
      setShowMobileHeader(false);
      setShowMoreControls(false);
    }
    const existingWord = getWordData(word);
    if (existingWord) {
      setDisplayedWord({
        ...existingWord,
        term: existingWord.term ?? undefined,
        translation: existingWord.translation ?? undefined
      });
      setTranslation(existingWord.translation || '');
      if (!existingWord.translation && !skipAutoTranslate) triggerAutoTranslation(word);
    } else {
      const newWord = { term: word, status: 0, translation: '', isNew: true };
      setDisplayedWord(newWord);
      setTranslation('');
      if (!skipAutoTranslate) triggerAutoTranslation(word);
    }
  }, [clearPendingSelection, getWordData, globalSettings.pauseOnWordClick, isAudioLesson, triggerAutoTranslation, setSelectedWord, setTranslation, setWordTranslationError, setDisplayedWord, isMobile, pauseAudioPlayback]); // Dependencies using globalSettings don't need it listed if context handles updates

  // Removed handleTextSelection as selection is now handled by onMouseUp on the container

  // --- New Word-Granularity Selection Logic ---
  const getSelectionDetails = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !textContentRef.current || selection.rangeCount === 0) {
      return null;
    }

    let range;
    try {
      range = selection.getRangeAt(0);
    } catch (e) {
      console.warn('Could not get selection range', e);
      return null;
    }

    const container = textContentRef.current;
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    if (!anchorNode || !focusNode) {
      return null;
    }

    if (!container.contains(range.commonAncestorContainer) || !container.contains(anchorNode) || !container.contains(focusNode)) {
      return null;
    }

    const selectedText = selection.toString().trim();
    if (!selectedText) {
      return null;
    }

    return { selection, range, container, selectedText };
  }, []);

  const handleSelectedText = useCallback((selectedText: string, sentenceContext: string = '') => {
    if (!selectedText) {
      lastHandledSelectionRef.current = '';
      setSelectedWordAiContext('');
      return;
    }

    if (selectedText === lastHandledSelectionRef.current) {
      return;
    }

    lastHandledSelectionRef.current = selectedText;
    suppressWordClickUntilRef.current = Date.now() + 400;
    setTimeout(() => {
      const useAiContext = Boolean(sentenceContext && sentenceContext.trim());
      handleWordClick(selectedText, { skipAutoTranslate: useAiContext, preserveLastHandledSelection: true, selectionContext: sentenceContext });
      if (useAiContext) {
        triggerAutoTranslation(selectedText, { sentenceContext });
      }
    }, 0);
  }, [handleWordClick, triggerAutoTranslation]);

  const handleSelectableWordClick = useCallback((event: React.MouseEvent, word: string, isPhrase: boolean = false) => {
    event.stopPropagation();
    if (Date.now() < suppressWordClickUntilRef.current || hasActiveTextSelection()) {
      return;
    }
    focusSentenceIndexFromNode(event.target as Node);
    const sentenceContext = readSentenceContextFromNode(event.target as Node);
    if (!isPhrase && globalSettings.tooltipOnlyForSavedWords) {
      const existing = getWordData(word);
      if (existing && !existing.isNew) {
        clearPendingSelection();
        return;
      }
    }
    handleWordClick(word, { selectionContext: sentenceContext });
  }, [clearPendingSelection, focusSentenceIndexFromNode, readSentenceContextFromNode, handleWordClick, hasActiveTextSelection, getWordData, globalSettings.tooltipOnlyForSavedWords]);

  const handleSelectableWordTouchStart = useCallback(() => {
    selectableWordTouchStartRef.current = Date.now();
  }, []);

  const handleSelectableWordTouchEnd = useCallback(() => {
    const touchDuration = Date.now() - selectableWordTouchStartRef.current;
    if (touchDuration >= 250 || hasActiveTextSelection()) {
      suppressWordClickUntilRef.current = Date.now() + 600;
    }
  }, [hasActiveTextSelection]);

  const processWordSelection = useCallback(() => {
    const selectionDetails = getSelectionDetails();
    if (!selectionDetails) {
      if (!isMobile) {
        lastHandledSelectionRef.current = '';
      }
      return;
    }

    const { selection, range, container, selectedText } = selectionDetails;
    const sentenceContext = buildAiSelectionContext(range, container, selectedText);
    focusSentenceIndexFromNode(range.commonAncestorContainer);
    if (isMobile) {
      mobileSelectionPendingRef.current = false;
      mobileSelectionObservedRef.current = false;
      mobileSelectionWasActiveAtTouchStartRef.current = false;
      mobileTouchStartedRef.current = false;
      mobileTouchMovedRef.current = false;
      mobileSelectionInitialTextRef.current = '';
      mobileSelectionGrewRef.current = false;
      clearMobileSelectionRetry();
      clearMobileSelectionStability();
      handleSelectedText(selectedText, sentenceContext);
      return;
    }

    let startNode = range.startContainer;
    let endNode = range.endContainer;
    let startOffset = range.startOffset;
    let endOffset = range.endOffset;

    // Helper function to find the nearest ancestor word span
    const findWordSpan = (node: Node | null): HTMLElement | null => {
      while (node && node !== container) {
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains('clickable-word')) {
          return node as HTMLElement;
        }
        node = node.parentNode;
      }
      return null;
    };

    // Helper function to find the word span containing or immediately preceding/following a text node offset
    const findWordSpanNearText = (node: Node, offset: number, lookForward: boolean): HTMLElement | null => {
      if (node.nodeType === Node.ELEMENT_NODE) {
        // If the node itself is a word span
        if ((node as HTMLElement).classList.contains('clickable-word')) return node as HTMLElement;
        // If offset points to a child node, check that child
        const childNode = node.childNodes[offset];
        if (childNode) return findWordSpan(childNode);
      }

      // If it's a text node or offset is within a text node
      let current: Node | null = node;
      while (current && current !== container) {
        const node: Node = current;
        if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).classList.contains('clickable-word')) {
          return node as HTMLElement; // Found ancestor word span
        }
        // Move to sibling or parent
        const sibling: ChildNode | null = lookForward ? node.nextSibling : node.previousSibling;
        if (sibling) {
          current = sibling;
          // If moving to a sibling element, check its children (especially if looking backward)
          if (sibling.nodeType === Node.ELEMENT_NODE) {
            let innerNode: ChildNode | null = lookForward ? sibling.firstChild : sibling.lastChild;
            while (innerNode) {
              const word = findWordSpan(innerNode);
              if (word) return word;
              innerNode = lookForward ? innerNode.nextSibling : innerNode.previousSibling;
            }
          } else { // Text node sibling
            const word = findWordSpan(sibling);
            if (word) return word;
          }

        } else {
          current = node.parentNode; // Move up if no more siblings
        }
      }
      return null; // No word span found in traversal
    };


    let startWordSpan = findWordSpan(startNode) || findWordSpanNearText(startNode, startOffset, true);
    let endWordSpan = findWordSpan(endNode) || findWordSpanNearText(endNode, endOffset, false);

    // Large / multi-block selections may not map to word spans; still translate via AI with full context.
    if (!startWordSpan || !endWordSpan) {
      handleSelectedText(selectedText, sentenceContext);
      return;
    }

    // Ensure startWordSpan actually comes before endWordSpan in the DOM
    if (startWordSpan.compareDocumentPosition(endWordSpan) & Node.DOCUMENT_POSITION_FOLLOWING) {
      // Correct order
    } else if (endWordSpan.compareDocumentPosition(startWordSpan) & Node.DOCUMENT_POSITION_FOLLOWING) {
      // Swapped order, fix it
      [startWordSpan, endWordSpan] = [endWordSpan, startWordSpan];
    } else {
      // Same node, which is fine
    }


    // Create a new range encompassing the start and end word spans
    const newRange = document.createRange();
    try {
      newRange.setStartBefore(startWordSpan);
      newRange.setEndAfter(endWordSpan);

      // Update the selection visually
      selection.removeAllRanges();
      selection.addRange(newRange);

      handleSelectedText(newRange.toString().trim(), sentenceContext);
    } catch (e) {
      console.warn("Error adjusting selection range:", e);
      // Fallback: use original selection text if possible
      handleSelectedText(selection.toString().trim(), sentenceContext);
    }

  }, [focusSentenceIndexFromNode, getSelectionDetails, buildAiSelectionContext, handleSelectedText, isMobile, clearMobileSelectionRetry, clearMobileSelectionStability]); // textContentRef is a stable ref

  const scheduleWordSelection = useCallback((delayMs: number) => {
    clearPendingSelection();
    selectionDebounceRef.current = setTimeout(() => {
      selectionDebounceRef.current = null;
      processWordSelection();
    }, delayMs);
  }, [clearPendingSelection, processWordSelection]);

  const handleWordSelection = useCallback(() => {
    if (!isMobile) {
      scheduleWordSelection(120);
      return;
    }

    if (
      mobileTouchStartedRef.current &&
      mobileSelectionObservedRef.current &&
      !mobileSelectionWasActiveAtTouchStartRef.current &&
      !mobileTouchMovedRef.current &&
      !mobileSelectionGrewRef.current
    ) {
      mobileTouchStartedRef.current = false;
      clearMobileSelectionPending();
      return;
    }

    mobileTouchStartedRef.current = false;
    mobileSelectionPendingRef.current = true;
    scheduleWordSelection(200);
    clearMobileSelectionRetry();
    mobileSelectionRetryRef.current = setTimeout(() => {
      if (mobileSelectionPendingRef.current) {
        processWordSelection();
      }
      if (mobileSelectionPendingRef.current) {
        mobileSelectionPendingRef.current = false;
      }
      mobileSelectionRetryRef.current = null;
    }, 550);
  }, [isMobile, scheduleWordSelection, clearMobileSelectionPending, clearMobileSelectionRetry, processWordSelection]);

  useEffect(() => {
    return () => {
      clearPendingSelection();
      clearMobileSelectionPending();
      cancelInflightTranslation();
    };
  }, [clearPendingSelection, clearMobileSelectionPending, cancelInflightTranslation]);

  useEffect(() => {
    if (!isMobile) return undefined;

    // Clear the dedupe ref when the user collapses the selection, so the same
    // phrase can be re-selected later and re-trigger a translation.
    const handleSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) {
        lastHandledSelectionRef.current = '';
        mobileSelectionObservedRef.current = false;
        mobileSelectionInitialTextRef.current = '';
        mobileSelectionGrewRef.current = false;
        clearMobileSelectionStability();
        return;
      }

      if (!textContentRef.current || selection.rangeCount === 0) {
        return;
      }

      let range;
      try {
        range = selection.getRangeAt(0);
      } catch {
        return;
      }

      const container = textContentRef.current;
      const anchorNode = selection.anchorNode;
      const focusNode = selection.focusNode;
      if (!anchorNode || !focusNode) return;
      if (
        !container.contains(range.commonAncestorContainer) ||
        !container.contains(anchorNode) ||
        !container.contains(focusNode)
      ) {
        return;
      }

      mobileSelectionObservedRef.current = true;

      const selectedText = selection.toString().trim();
      if (!mobileSelectionInitialTextRef.current) {
        mobileSelectionInitialTextRef.current = selectedText;
      } else if (selectedText && selectedText !== mobileSelectionInitialTextRef.current) {
        mobileSelectionGrewRef.current = true;
      }

      // iOS often suppresses touchend after the OS takes over native selection.
      // Once we've seen the selection grow past its initial long-press word, run
      // a stability timer that fires shortly after the user stops adjusting.
      if (mobileSelectionGrewRef.current) {
        clearMobileSelectionStability();
        mobileSelectionStabilityRef.current = setTimeout(() => {
          mobileSelectionStabilityRef.current = null;
          if (!mobileSelectionObservedRef.current) {
            return;
          }
          mobileSelectionPendingRef.current = false;
          processWordSelection();
        }, 500);
      }

      if (!mobileSelectionPendingRef.current) {
        return;
      }

      scheduleWordSelection(60);
    };

    const handleTouchStart = () => {
      const hadReaderSelection = Boolean(getSelectionDetails());
      const existingText = hadReaderSelection
        ? (window.getSelection()?.toString().trim() || '')
        : '';
      clearMobileSelectionPending();
      mobileTouchStartedRef.current = true;
      mobileTouchMovedRef.current = false;
      mobileSelectionWasActiveAtTouchStartRef.current = hadReaderSelection;
      mobileSelectionObservedRef.current = hadReaderSelection;
      mobileSelectionInitialTextRef.current = existingText;
      mobileSelectionGrewRef.current = false;
    };

    const handleTouchMove = () => {
      mobileTouchMovedRef.current = true;
    };

    const handleTouchRelease = (event: TouchEvent) => {
      const container = textContentRef.current;
      if (container && event.target instanceof Node && container.contains(event.target)) {
        return;
      }

      if (!mobileSelectionObservedRef.current) {
        return;
      }

      if (
        mobileTouchStartedRef.current &&
        !mobileSelectionWasActiveAtTouchStartRef.current &&
        !mobileTouchMovedRef.current &&
        !mobileSelectionGrewRef.current
      ) {
        return;
      }

      mobileTouchStartedRef.current = false;
      mobileSelectionPendingRef.current = true;
      scheduleWordSelection(60);
      clearMobileSelectionRetry();
      mobileSelectionRetryRef.current = setTimeout(() => {
        if (mobileSelectionPendingRef.current) {
          processWordSelection();
        }
        mobileSelectionPendingRef.current = false;
        mobileSelectionObservedRef.current = false;
        mobileSelectionRetryRef.current = null;
      }, 550);
    };

    document.addEventListener('selectionchange', handleSelectionChange);
    document.addEventListener('touchstart', handleTouchStart, true);
    document.addEventListener('touchmove', handleTouchMove, true);
    document.addEventListener('touchend', handleTouchRelease, true);
    document.addEventListener('touchcancel', handleTouchRelease, true);
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange);
      document.removeEventListener('touchstart', handleTouchStart, true);
      document.removeEventListener('touchmove', handleTouchMove, true);
      document.removeEventListener('touchend', handleTouchRelease, true);
      document.removeEventListener('touchcancel', handleTouchRelease, true);
    };
  }, [isMobile, getSelectionDetails, scheduleWordSelection, clearMobileSelectionPending, clearMobileSelectionRetry, clearMobileSelectionStability, processWordSelection]);
  // --- End New Word-Granularity Selection Logic ---


  const processTextContent = useCallback((content: string | null | undefined): React.ReactNode[] => {
    if (!content) return [];

    // Apply language-aware character substitutions, then walk the
    // resulting text. Phrase matching runs at every position before
    // tokenization. Words are accumulated using the language's
    // wordCharacters + universal apostrophe/hyphen connector glue.
    // We re-consume words at each position rather than pre-tokenizing
    // so that a phrase ending mid-word still tokenizes the remainder
    // correctly. See `client/.../utils/readerText.js` for the spec.
    const { processed, coreRegex } = prepareLanguageContext(content, languageConfig);

    const elements = [];
    let currentIndex = 0;
    let currentKeyIndex = 0;

    while (currentIndex < processed.length) {
      let phraseMatched = false;

      // 1. Check for known phrase matches at the current position
      for (const phrase of knownPhrases) {
        const phraseTerm = phrase.term;
        if (!phraseTerm) continue;
        if (processed.substring(currentIndex).startsWith(phraseTerm)) {
          const phraseData = phrase;
          const phraseStatus = phraseData.status;
          const phraseTranslation = phraseData.translation;

          const phraseSpan = (
            <span
              key={`phrase-${currentKeyIndex++}-${phraseTerm.replace(/\s+/g, '-')}`}
              style={{ ...styles.highlightedWord, ...getWordStyle(phraseStatus) }}
              className={`clickable-word${languageWordsLoaded ? ` word-status-${phraseStatus}` : ''}`}
              onTouchStart={handleSelectableWordTouchStart}
              onTouchEnd={handleSelectableWordTouchEnd}
              onClick={(e) => handleSelectableWordClick(e, phraseTerm, true)}
              onMouseEnter={() => setHoveredWordTerm(phraseTerm)}
              onMouseLeave={() => setHoveredWordTerm(null)}
            >
              {phraseTerm}
            </span>
          );

          elements.push(
            phraseTranslation ? (
              <OverlayTrigger key={`tooltip-phrase-${currentKeyIndex++}-${phraseTerm.replace(/\s+/g, '-')}`} placement="top" overlay={<Tooltip id={`tooltip-phrase-${currentKeyIndex}-${phraseTerm}`}>{phraseTranslation}</Tooltip>}>
                {phraseSpan}
              </OverlayTrigger>
            ) : phraseSpan
          );

          currentIndex += phraseTerm.length;
          phraseMatched = true;
          break;
        }
      }

      if (phraseMatched) {
        continue;
      }

      // 2. Try to consume a word at this position.
      const consumed = consumeWordAt(processed, currentIndex, coreRegex);
      if (consumed) {
        const currentWord = consumed.text;
        const wordData = getWordData(currentWord);
        const wordStatus = wordData ? wordData.status : 0;
        const wordTranslation = wordData ? wordData.translation : null;

        const wordSpan = (
          <span
            key={`word-${currentKeyIndex++}-${currentWord}`}
            style={{ ...styles.highlightedWord, ...getWordStyle(wordStatus) }}
            className={`clickable-word${languageWordsLoaded ? ` word-status-${wordStatus}` : ''}`}
            onTouchStart={handleSelectableWordTouchStart}
            onTouchEnd={handleSelectableWordTouchEnd}
            onClick={(e) => handleSelectableWordClick(e, currentWord)}
            onMouseEnter={() => setHoveredWordTerm(currentWord)}
            onMouseLeave={() => setHoveredWordTerm(null)}
          >
            {currentWord}
          </span>
        );

        elements.push(
          wordTranslation ? (
            <OverlayTrigger key={`tooltip-${currentKeyIndex++}-${currentWord}`} placement="top" overlay={<Tooltip id={`tooltip-${currentKeyIndex}-${currentWord}`}>{wordTranslation}</Tooltip>}>
              {wordSpan}
            </OverlayTrigger>
          ) : wordSpan
        );

        currentIndex = consumed.end;
      } else {
        // Non-word character (punctuation, whitespace, etc.)
        const ch = processed[currentIndex];
        elements.push(<React.Fragment key={`sep-${currentKeyIndex++}`}>{ch}</React.Fragment>);
        currentIndex++;
      }
    }

    return elements;

  }, [knownPhrases, getWordData, getWordStyle, languageWordsLoaded, handleSelectableWordClick, handleSelectableWordTouchEnd, handleSelectableWordTouchStart, setHoveredWordTerm, languageConfig]);


  const getFontFamilyForList = useCallback(() => {
    switch (globalSettings.textFont) { // Use globalSettings from context
      case 'serif': return "var(--font-family-serif)"; // Use Lora via CSS variable
      case 'sans-serif': return "var(--font-family-sans-serif)"; // Use Inter via CSS variable
      case 'lato': return "'Lato', sans-serif";
      case 'open-sans': return "'Open Sans', sans-serif";
      case 'atkinson': return "'Atkinson Hyperlegible', sans-serif";
      case 'merriweather': return "'Merriweather', serif";
      case 'roboto-slab': return "'Roboto Slab', serif";
      case 'comic-sans': return "'Comic Sans MS', 'Comic Sans', cursive";
      case 'monospace': return "'Courier New', monospace"; // Keep monospace as is
      case 'dyslexic': return "'OpenDyslexic', sans-serif"; // Keep dyslexic font as is
      default: return "var(--font-family-sans-serif)"; // Default to Inter
    }
  }, [globalSettings.textFont]); // Use globalSettings from context

  // Use globalSettings from context
  const getFontStyling = useCallback((currentLineSpacing: number | string): React.CSSProperties => ({ // Added currentLineSpacing parameter
    fontSize: `${globalSettings.textSize}px`,
    fontFamily: getFontFamilyForList(), // Assuming getFontFamilyForList is stable or memoized
    lineHeight: currentLineSpacing // Use the passed-in value directly
  }), [globalSettings.textSize, getFontFamilyForList]); // getFontFamilyForList already depends on textFont

  const mobileReadingConfig = useMemo(() => {
    switch (readingDensity) {
      case 'compact':
        return { lineSpacing: 1.4, chunkSize: 3, blockPadding: '0.5rem 0.65rem' };
      case 'spacious':
        return { lineSpacing: 1.9, chunkSize: 1, blockPadding: '0.8rem 0.85rem' };
      case 'balanced':
      default:
        return { lineSpacing: 1.65, chunkSize: 2, blockPadding: '0.65rem 0.75rem' };
    }
  }, [readingDensity]);

  // sentenceSegments is a discriminated union: SRT-derived segments
  // (type: 'audio') carry startTime/endTime/srtLineId; sentence-split segments
  // (type: 'sentence' | 'title') carry mediaBlocks. Render code narrows on
  // `seg.type === 'audio'`.
  const sentenceSegments = useMemo<SentenceSegment[]>(() => {
    if (isAudioLesson && srtLines.length > 0) {
      return srtLines.map((line, index) => ({
        index,
        text: line.text,
        startTime: line.startTime,
        endTime: line.endTime,
        srtLineId: line.id,
        type: 'audio'
      }));
    }

    return splitTextIntoSentenceSegments(
      text?.content || '',
      (text?.structuredContent as unknown as Parameters<typeof splitTextIntoSentenceSegments>[1]) || [],
      languageConfig,
      text?.languageCode
    );
  }, [isAudioLesson, srtLines, text?.content, text?.structuredContent, languageConfig, text?.languageCode]);

  const currentSentenceSegment = sentenceSegments[currentSegmentIndex] || null;

  const speakCurrentSentence = useCallback(async () => {
    if (!currentSentenceSegment || !sentenceTtsEnabled || !canUseSentenceTts) {
      return;
    }

    cancelSpeech();
    setIsSpeakingSentence(false);
    setIsSpeakingWord(false);
    pauseAudioPlayback();
    setSegmentPlaybackRequest(null);

    try {
      await speakText({
        text: currentSentenceSegment.text,
        languageCode: text?.languageCode,
        rate: sentenceTtsRate,
        onStart: () => setIsSpeakingSentence(true),
        onEnd: () => setIsSpeakingSentence(false),
        onError: () => setIsSpeakingSentence(false)
      });
    } catch (speechErr) {
      console.error('Sentence TTS failed:', speechErr);
      setIsSpeakingSentence(false);
    }
  }, [canUseSentenceTts, currentSentenceSegment, pauseAudioPlayback, sentenceTtsEnabled, sentenceTtsRate, text?.languageCode]);

  const speakDisplayedWord = useCallback(async () => {
    const wordToSpeak = selectedWord || displayedWord?.term;
    if (!wordToSpeak || !sentenceTtsEnabled || !canUseSentenceTts) {
      return;
    }

    cancelSpeech();
    setIsSpeakingSentence(false);
    setIsSpeakingWord(false);
    pauseAudioPlayback();
    setSegmentPlaybackRequest(null);

    try {
      await speakText({
        text: wordToSpeak,
        languageCode: text?.languageCode,
        rate: sentenceTtsRate,
        onStart: () => setIsSpeakingWord(true),
        onEnd: () => setIsSpeakingWord(false),
        onError: () => setIsSpeakingWord(false)
      });
    } catch (speechErr) {
      console.error('Word TTS failed:', speechErr);
      setIsSpeakingWord(false);
    }
  }, [canUseSentenceTts, displayedWord?.term, pauseAudioPlayback, selectedWord, sentenceTtsEnabled, sentenceTtsRate, text?.languageCode]);

  const replayCurrentSegmentAudio = useCallback(() => {
    if (!currentSentenceSegment) {
      return;
    }

    if (currentSentenceSegment.type !== 'audio') {
      speakCurrentSentence();
      return;
    }

    cancelSpeech();
    setIsSpeakingSentence(false);
    lastAutoSegmentPlaybackKeyRef.current = '';

    setSegmentPlaybackRequest({
      requestId: `replay-${currentSentenceSegment.index}-${Date.now()}`,
      startTime: currentSentenceSegment.startTime,
      endTime: currentSentenceSegment.endTime,
      repeatCount: sentenceAudioRepeats,
      forcePlay: true
    });
  }, [currentSentenceSegment, sentenceAudioRepeats, speakCurrentSentence]);

  const handleSegmentTranslationToggle = useCallback(async () => {
    if (!currentSentenceSegment || !text?.languageCode) return;

    if (visibleTranslationIndex === currentSentenceSegment.index) {
      setVisibleTranslationIndex(null);
      return;
    }

    if (segmentTranslations[currentSentenceSegment.index]) {
      setVisibleTranslationIndex(currentSentenceSegment.index);
      return;
    }

    setIsTranslatingSegment(true);
    try {
      const result = await translateSentence(currentSentenceSegment.text, text.languageCode, translationTargetLanguageCode);
      const translatedText = extractTranslatedTextFromPairedTags(
        result?.translatedText || 'Translation failed.'
      );
      setSegmentTranslations(prev => ({
        ...prev,
        [currentSentenceSegment.index]: translatedText
      }));
      setVisibleTranslationIndex(currentSentenceSegment.index);
    } catch (translationErr: unknown) {
      console.error('Sentence translation failed:', translationErr);
      setSegmentTranslations(prev => ({
        ...prev,
        [currentSentenceSegment.index]: `Translation failed: ${(translationErr as Error)?.message}`
      }));
      setVisibleTranslationIndex(currentSentenceSegment.index);
    } finally {
      setIsTranslatingSegment(false);
    }
  }, [currentSentenceSegment, segmentTranslations, text?.languageCode, translationTargetLanguageCode, visibleTranslationIndex]);

  const handleSegmentExplanationToggle = useCallback(async () => {
    if (!currentSentenceSegment || !text?.languageCode) return;

    if (visibleExplanationIndex === currentSentenceSegment.index) {
      setVisibleExplanationIndex(null);
      return;
    }

    if (segmentExplanations[currentSentenceSegment.index]) {
      setVisibleExplanationIndex(currentSentenceSegment.index);
      return;
    }

    setIsExplainingSegment(true);
    try {
      const result = await explainSentence(currentSentenceSegment.text, text.languageCode, translationTargetLanguageCode);
      const explanationText = result?.explanationText || 'Explanation failed.';
      setSegmentExplanations(prev => ({
        ...prev,
        [currentSentenceSegment.index]: explanationText
      }));
      setVisibleExplanationIndex(currentSentenceSegment.index);
    } catch (explanationErr: unknown) {
      console.error('Sentence explanation failed:', explanationErr);
      setSegmentExplanations(prev => ({
        ...prev,
        [currentSentenceSegment.index]: `Explanation failed: ${(explanationErr as Error)?.message}`
      }));
      setVisibleExplanationIndex(currentSentenceSegment.index);
    } finally {
      setIsExplainingSegment(false);
    }
  }, [currentSentenceSegment, segmentExplanations, text?.languageCode, translationTargetLanguageCode, visibleExplanationIndex]);

  useEffect(() => {
    if (sentenceSegments.length === 0) {
      if (currentSegmentIndex !== 0) {
        setCurrentSegmentIndex(0);
      }
      return;
    }

    if (currentSegmentIndex >= sentenceSegments.length) {
      setCurrentSegmentIndex(sentenceSegments.length - 1);
    }
  }, [currentSegmentIndex, sentenceSegments]);

  useEffect(() => {
    if (!isSentenceMode || !sentenceProgressLoaded || !text?.textId || !currentSentenceSegment) {
      return;
    }

    const isAudioDrivenSync = audioDrivenSentenceSyncRef.current;
    audioDrivenSentenceSyncRef.current = false;

    let cancelled = false;

    const syncSentenceProgress = async () => {
      const segmentIndex = currentSentenceSegment.index;
      if (pendingSentenceCreditRef.current.has(segmentIndex)) {
        return;
      }

      pendingSentenceCreditRef.current.add(segmentIndex);
      try {
        if (text?.textId == null) return;
        const response = await logSentenceReadActivity({
          textId: text.textId,
          currentSegmentIndex: segmentIndex,
          segments: [{
            segmentIndex,
            segmentText: currentSentenceSegment.text
          }]
        });

        if (!cancelled) {
          const typed = response as { creditedSegmentIndices?: number[] } | null;
          setCreditedSegmentIndices(typed?.creditedSegmentIndices || []);
        }
      } catch (sentenceReadErr) {
        console.error('Failed to log sentence progress:', sentenceReadErr);
      } finally {
        pendingSentenceCreditRef.current.delete(segmentIndex);
      }
    };

    syncSentenceProgress();
    setVisibleTranslationIndex(null);
    setVisibleExplanationIndex(null);

    if (isAudioLesson && currentSentenceSegment.type === 'audio') {
      setCurrentSrtLineId(currentSentenceSegment.srtLineId || null);
      if (!isAudioDrivenSync && skipInitialAudioLessonSegmentPlaybackRef.current) {
        skipInitialAudioLessonSegmentPlaybackRef.current = false;
        return () => {
          cancelled = true;
        };
      }
      if (!isAudioDrivenSync) {
        const playbackKey = [
          text.textId,
          currentSentenceSegment.index,
          currentSentenceSegment.startTime,
          currentSentenceSegment.endTime,
          sentenceAudioRepeats
        ].join(':');

        if (lastAutoSegmentPlaybackKeyRef.current !== playbackKey) {
          lastAutoSegmentPlaybackKeyRef.current = playbackKey;
          setSegmentPlaybackRequest({
            requestId: `${currentSentenceSegment.index}-${Date.now()}`,
            startTime: currentSentenceSegment.startTime,
            endTime: currentSentenceSegment.endTime,
            repeatCount: sentenceAudioRepeats,
            forcePlay: isAudioPlaying
          });
        }
      }
    }

    skipInitialAudioLessonSegmentPlaybackRef.current = false;

    return () => {
      cancelled = true;
    };
  }, [
    currentSentenceSegment,
    isAudioLesson,
    isAudioPlaying,
    isSentenceMode,
    sentenceAudioRepeats,
    sentenceProgressLoaded,
    text?.textId
  ]);

  const itemData = useMemo(() => ({
    lines: srtLines,
    currentLineId: currentSrtLineId,
    processLineContent: processTextContent,
    handleLineClick: handleLineClick,
    getFontStyling, // Pass the function as defined in step 1
    currentLineSpacing: isMobile ? mobileReadingConfig.lineSpacing : globalSettings.lineSpacing // Pass the current lineSpacing value
  }), [
    srtLines,
    currentSrtLineId,
    processTextContent,
    handleLineClick,
    getFontStyling,
    globalSettings.lineSpacing,
    isMobile,
    mobileReadingConfig.lineSpacing // CRITICAL: itemData must update when lineSpacing changes
  ]);

  const handleToggleBookmarkForCurrentSentence = useCallback(() => {
    toggleBookmarkForIndex(currentSegmentIndex);
  }, [toggleBookmarkForIndex, currentSegmentIndex]);

  // --- End Helper Functions & Memoized Values ---


  // --- Effect Hooks ---

  // Text fetch is now owned by useReaderState.

  // Ref to hold the latest handleTranslateUnknownWords (assigned after function definition below)
  const handleTranslateUnknownWordsRef = useRef<((opts?: { silent?: boolean }) => Promise<void>) | null>(null);

  // Auto-translate all unknown words on open (if setting enabled)
  useEffect(() => {
    let cancelled = false;
    if (
      globalSettings.autoTranslateOnOpen &&
      languageWordsLoaded &&
      text?.content &&
      text?.languageId &&
      !autoTranslateTriggeredRef.current &&
      handleTranslateUnknownWordsRef.current
    ) {
      // Skip if a previous text's auto-translate is still in-flight
      if (autoTranslateTextIdRef.current && autoTranslateTextIdRef.current !== text?.textId) {
        return;
      }
      autoTranslateTriggeredRef.current = true;
      autoTranslateTextIdRef.current = text?.textId ?? null;
      handleTranslateUnknownWordsRef.current?.({ silent: true }).then(() => {
        if (!cancelled) autoTranslateTextIdRef.current = null;
      });
    }
    return () => { cancelled = true; };
  }, [languageWordsLoaded, text, globalSettings.autoTranslateOnOpen]);

  const handleSetWordStatusFromKeyboard = useCallback(
    async (term: string, status: WordStatus) => {
      const wordData = getWordData(term);
      if (wordData) {
        let translationToUse = wordData.translation || '';
        if (!translationToUse && text?.languageCode) {
          try {
            const result = await translateText(term, text.languageCode, translationTargetLanguageCode);
            translationToUse = result?.translatedText || '';
          } catch (err) {
            console.error(`[Keyboard Shortcut] Failed to fetch translation for ${term}:`, err);
          }
        }
        updateWord(wordData.wordId!, status, translationToUse)
          .then(() => {
            setWords(prevWords => prevWords.map(w => w.wordId === wordData.wordId ? { ...w, status, translation: translationToUse } : w));
            if (selectedWord === term && displayedWord?.term === term) {
              setDisplayedWord((prev) => ({ ...(prev || {}), status, translation: translationToUse }));
            }
          })
          .catch((err: unknown) => console.error(`[Keyboard Shortcut] Failed update for ${term}:`, err));
      } else {
        let translationToUse = '';
        if (text?.languageCode) {
          try {
            const result = await translateText(term, text.languageCode, translationTargetLanguageCode);
            translationToUse = result?.translatedText || '';
          } catch (err) {
            console.error(`[Keyboard Shortcut] Failed to fetch translation for ${term}:`, err);
          }
        }
        const sentenceToMine = currentSentenceSegment?.text;
        if (text?.textId == null) return;
        createWord(text.textId, term, status, translationToUse, sentenceToMine)
          .then(newWordData => {
            const typed = newWordData as { translation?: string } | null;
            const wordWithTranslation = { ...(typed || {}), translation: translationToUse || typed?.translation };
            setWords(prevWords => [...prevWords, wordWithTranslation]);
            if (globalSettings.autoTranslateWords && !translationToUse) triggerAutoTranslation(term);
          })
          .catch(err => console.error(`[Keyboard Shortcut] Failed to create word ${term}:`, err));
      }
    },
    [getWordData, text?.languageCode, text?.textId, translationTargetLanguageCode, setWords, selectedWord, displayedWord?.term, currentSentenceSegment?.text, globalSettings.autoTranslateWords, triggerAutoTranslation]
  );

  useReaderKeyboard({
    enabled: !processingWord && !isTranslating,
    hoveredWordTerm,
    onSetWordStatus: handleSetWordStatusFromKeyboard
  });

  // Removed redundant text selection listener useEffect hook
  // Selection is now handled by onMouseUp on the text container div
  // --- End Effect Hooks ---


  // --- Event Handlers ---

  const handleSaveWord = useCallback(async (status: number | string) => {
    // Ensure selectedWord is used here, as displayedWord might be slightly different if selection changed rapidly
    const termToSave = selectedWord || displayedWord?.term;
    if (!termToSave || processingWord || isTranslating) {
      return;
    }
    setSaveSuccess(false); setProcessingWord(true);
    try {
      const numericStatus = parseInt(String(status), 10);
      if (isNaN(numericStatus) || numericStatus < 1 || numericStatus > 6) throw new Error(`Invalid status: ${status}.`);
      const existingWord = getWordData(selectedWord);
      if (existingWord) {
        await updateWord(existingWord.wordId!, numericStatus, translation);
        const updatedWords = words.map(w => w.wordId === existingWord.wordId ? { ...w, status: numericStatus, translation } : w);
        setWords(updatedWords);
        setDisplayedWord((prev) => (prev?.term === selectedWord ? { ...prev, status: numericStatus, translation } : prev));
      } else {
        if (text?.textId == null) return;
        const newWordData = (await createWord(text.textId, selectedWord, numericStatus, translation, currentSentenceSegment?.text)) as Record<string, unknown> | null;
        setWords((prevWords: any[]) => [...prevWords, newWordData]);
        setDisplayedWord({ ...(newWordData || {}), isNew: false });
      }
      setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 2000);
    } catch (error) { console.error('Error saving word:', error); alert(`Failed to save word: ${error instanceof Error ? error.message : ''}`); }
    finally { setProcessingWord(false); }
  }, [selectedWord, displayedWord, processingWord, isTranslating, translation, text?.textId, currentSentenceSegment?.text, words, getWordData, setWords, setDisplayedWord, setSaveSuccess, setProcessingWord]); // createWord/updateWord are module imports (stable); omit to satisfy exhaustive-deps

  const handleDeleteWord = useCallback(async () => {
    const wordToDelete = displayedWord?.wordId ? displayedWord : getWordData(selectedWord);
    if (!wordToDelete?.wordId || processingWord || isTranslating) {
      return;
    }
    if (!window.confirm(`Delete term "${wordToDelete.term}"? This will also remove its SRS data and cannot be undone.`)) {
      return;
    }

    setProcessingWord(true);
    setSaveSuccess(false);
    try {
      await deleteWord(wordToDelete.wordId);
      setWords(prevWords => prevWords.filter(w => w.wordId !== wordToDelete.wordId));
      setDisplayedWord((prev) => (
        prev?.wordId === wordToDelete.wordId
          ? { term: wordToDelete.term ?? undefined, status: 0, translation: '', isNew: true }
          : prev
      ));
      setTranslation('');
    } catch (error: unknown) {
      console.error('Error deleting word:', error);
      alert(`Failed to delete word: ${(error as Error)?.message}`);
    } finally {
      setProcessingWord(false);
    }
  }, [displayedWord, getWordData, isTranslating, processingWord, selectedWord, setWords]);

  const wordInfoRetranslateContext = selectedWordAiContext || currentSentenceSegment?.text || '';

  // WordInfoPanel handlers — hoisted from inline JSX arrows during Phase E3
  // so the panel's composite props remain referentially stable per render.
  const handleReadingCredit = useCallback(async (wordId: number | string) => {
    try {
      const res = (await applySrsReadingCredit(wordId)) as { applied?: boolean; message?: string } | null;
      if (res?.applied) alert('SRS reading credit applied!');
      else alert(res?.message || 'Credit not applied.');
    } catch (err) {
      console.error('Reading credit failed:', err);
    }
  }, []);

  const handleRetranslateWithContext = useCallback(() => {
    if (!displayedWord?.term) return;
    triggerAutoTranslation(displayedWord.term, {
      sentenceContext: wordInfoRetranslateContext,
      force: true,
    });
  }, [displayedWord?.term, triggerAutoTranslation, wordInfoRetranslateContext]);

  const handleAddTranslationWithContext = useCallback(() => {
    if (!displayedWord?.term) return;
    appendAutoTranslation(displayedWord.term, {
      sentenceContext: wordInfoRetranslateContext,
    });
  }, [displayedWord?.term, appendAutoTranslation, wordInfoRetranslateContext]);

  // Handler for saving translation via Enter key (Moved after handleSaveWord)
  const handleTranslationKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent newline in textarea
      if (displayedWord) {
        // Determine the status to save (current status, or 1 if untracked)
        const statusToSave = (displayedWord.status ?? 0) > 0 ? displayedWord.status! : 1;
        handleSaveWord(statusToSave); // handleSaveWord is now defined before this
      }
    }
  }, [displayedWord, handleSaveWord]); // handleSaveWord dependency is now safe

  const handleFullTextTranslation = async () => {
    if (!text || !text.content) return;
    setShowTranslationPopup(true); setIsFullTextTranslating(true); setFullTextTranslation('');
    try {
      const response = await translateFullText(text.content, text.languageCode || 'auto', translationTargetLanguageCode);
      setFullTextTranslation(response?.translatedText || 'Translation failed.');
    } catch (error: unknown) { setFullTextTranslation(`Translation failed: ${(error as Error)?.message}`); }
    finally { setIsFullTextTranslating(false); }
  };

  const loadSummaryLanguages = useCallback(async () => {
    if (summaryLanguages.length > 0 || isLoadingSummaryLanguages) return;

    setIsLoadingSummaryLanguages(true);
    try {
      const languages = await getAllLanguages();
      setSummaryLanguages(Array.isArray(languages) ? languages : []);
    } catch (languagesError) {
      console.error('Failed to load summary languages:', languagesError);
      setSummaryLanguages([]);
    } finally {
      setIsLoadingSummaryLanguages(false);
    }
  }, [isLoadingSummaryLanguages, summaryLanguages.length]);

  const handleOpenSummaryPopup = useCallback(() => {
    if (!text?.content) return;

    setSummaryTargetLanguage(translationTargetLanguageCode);
    setSummaryText('');
    setSummaryError('');
    setShowSummaryPopup(true);
    loadSummaryLanguages();
  }, [loadSummaryLanguages, text?.content, translationTargetLanguageCode]);

  const handleSummarizeText = useCallback(async () => {
    if (!text?.content) return;

    const requestTextId = text.textId ?? null;
    setIsSummarizing(true);
    setSummaryText('');
    setSummaryError('');

    try {
      const response = await summarizeText(
        text.content,
        text.languageCode || 'auto',
        summaryTargetLanguage,
        200
      );
      if (currentTextIdForSummaryRef.current !== requestTextId) return;
      setSummaryText(response?.summaryText || 'Summary failed.');
    } catch (summaryErr: unknown) {
      if (currentTextIdForSummaryRef.current !== requestTextId) return;
      setSummaryError(`Summary failed: ${(summaryErr as Error)?.message}`);
    } finally {
      setIsSummarizing(false);
    }
  }, [summaryTargetLanguage, text?.content, text?.languageCode, text?.textId]);

  const handleMineSentence = useCallback(async () => {
    const sentenceToMine = currentSentenceSegment?.text;
    const wordId = displayedWord?.wordId;

    if (!wordId || !sentenceToMine) {
      alert("Please select an existing tracked word and ensure a sentence is focused.");
      return;
    }

    try {
      if (text?.textId == null) return;
      // Create a temporary state indicator if you want, or just wait.
      await mineSentence(wordId, sentenceToMine, text.textId, text.title);
      alert("Sentence added to flashcards successfully!");
    } catch (err: unknown) {
      console.error("Failed to mine sentence:", err);
      alert(`Failed to mine sentence: ${(err as Error)?.message}`);
    }
  }, [displayedWord, currentSentenceSegment, text]);

  const handleTranslateUnknownWords = async ({ silent = false } = {}) => {
    if (!text || !text.content || !text.languageId) return;
    const callingTextId = text.textId; // Capture which text we're translating for
    setTranslatingUnknown(true); setTranslateUnknownError('');
    try {
      const wordsRegex = /\p{L}+(['-]\p{L}+)*/gu;
      const textWords = text.content.match(wordsRegex) || [];
      // Also extract parts of hyphenated words so they get individual translations
      const allWords: string[] = [];
      textWords.forEach((w: string) => {
        allWords.push(w);
        if (w.includes('-')) {
          w.split('-').forEach((part: string) => { if (part) allWords.push(part); });
        }
      });
      const uniqueWordsInText = [...new Set(allWords.map((w: string) => w.toLowerCase()))];
      const wordsMap = wordMap; // Reuse the memoized map
      const unknownWords = uniqueWordsInText.filter((word: string) => {
        const w = wordsMap.get(word);
        return !w || ((w.status ?? 0) <= 2 && !w.translation);
      });
      if (unknownWords.length === 0) { if (!silent) alert("No words found needing translation."); setTranslatingUnknown(false); return; } // Exit early
      const translations = (await batchTranslateWords(unknownWords, translationTargetLanguageCode, text.languageCode)) as Record<string, string>;
      // Bail out if user navigated away during the API call
      if (silent && autoTranslateTextIdRef.current !== callingTextId) { setTranslatingUnknown(false); return; }
      const originalCaseMap = new Map<string, string>();
      allWords.forEach((w: string) => { const lower = w.toLowerCase(); if (!originalCaseMap.has(lower)) { originalCaseMap.set(lower, w); } });
      const termsToAdd = unknownWords.map((word: string) => ({
        term: originalCaseMap.get(word) || word,
        translation: translations?.[word.toLowerCase()] || ''
      })).filter((t: { translation: string }) => t.translation);

      if (termsToAdd.length === 0) { if (!silent) alert("No translations received."); setTranslatingUnknown(false); return; } // Exit early

      // Two-step workflow: first fetch translations, then save terms+translations
      try {
        await addTermsBatch(text.languageId, termsToAdd);
      } catch (saveError: unknown) {
        console.error("Error saving translated terms:", saveError);
        setTranslateUnknownError(`Failed to save terms: ${(saveError as Error)?.message}`);
        if (!silent) alert(`Error saving terms: ${(saveError as Error)?.message}`);
        setTranslatingUnknown(false);
        return;
      }
      // Bail out if user navigated away before refreshing word list
      if (silent && autoTranslateTextIdRef.current !== callingTextId) { setTranslatingUnknown(false); return; }
      await fetchAllLanguageWords(text.languageId);
      if (!silent) alert(`Successfully translated and updated ${termsToAdd.length} words.`);
    } catch (err: unknown) { console.error("Error translating unknown words:", err); setTranslateUnknownError(`Failed: ${(err as Error)?.message}`); if (!silent) alert(`Error: ${(err as Error)?.message}`); }
    finally { setTranslatingUnknown(false); }
  };
  handleTranslateUnknownWordsRef.current = handleTranslateUnknownWords;

  const handleMarkAllUnknownAsKnown = async () => {
    if (!text || !text.content || !text.languageId || !text.textId) return;
    setIsMarkingAll(true); setError('');
    try {
      const wordsRegex = /\p{L}+(['-]\p{L}+)*/gu;
      const textWords = text.content.match(wordsRegex) || [];
      // Also extract parts of hyphenated words
      const allWords: string[] = [];
      textWords.forEach((w: string) => {
        allWords.push(w);
        if (w.includes('-')) {
          w.split('-').forEach((part: string) => { if (part) allWords.push(part); });
        }
      });
      const uniqueWordsInText = [...new Set(allWords.map((w: string) => w.toLowerCase()))];
      const wordsMap = new Map(words.map(w => [w.term?.toLowerCase() ?? '', w]));
      const unknownWords = uniqueWordsInText.filter((word: string) => !wordsMap.has(word));
      if (unknownWords.length === 0) { alert("No untracked words found."); setIsMarkingAll(false); return; } // Exit early
      const originalCaseMap = new Map<string, string>();
      allWords.forEach((w: string) => { const lower = w.toLowerCase(); if (!originalCaseMap.has(lower)) { originalCaseMap.set(lower, w); } });
      const termsToMark = unknownWords.map((word: string) => ({ term: originalCaseMap.get(word) || word, translation: '' }));
      await addTermsBatch(text.languageId, termsToMark);
      await fetchAllLanguageWords(text.languageId);
      alert(`Attempted to mark ${unknownWords.length} words as Known.`);
    } catch (err: unknown) { console.error("Error marking all unknown as known:", err); setError(`Failed: ${(err as Error)?.message}`); alert(`Error: ${(err as Error)?.message}`); }
    finally { setIsMarkingAll(false); }
  };

  const handleCompleteLesson = async () => {
    if (!text?.textId) return; // Require at least textId
    setCompleting(true);
    try {
      // Call the correct API endpoint using the imported completeLesson function
      // Pass bookId if available, otherwise null/undefined (handled by completeLesson in api.js)
      const textStats = await completeLesson(text?.bookId ?? null, text.textId);
      // If standalone text, always go back to texts page after completion
      if (!text?.bookId) {
        navigate('/texts');
      } else if (globalSettings.autoAdvanceToNextLesson && nextTextId) {
        navigate(`/texts/${nextTextId}`);
      } else if (globalSettings.showProgressStats) {
        setStats(textStats as LessonCompletionStats | null); // completeLesson returns Promise<unknown>; cast to the narrow stats shape consumed below.
        setShowStatsModal(true);
      } else {
        navigate(`/books/${text.bookId}`);
      }
    } catch (error: unknown) { alert(`Failed to complete lesson: ${(error as Error)?.message}`); }
    finally { setCompleting(false); }
  };

  const handleCompleteLessonNoStats = async () => {
    if (!text?.textId) return;
    setCompleting(true);
    try {
      await completeLesson(text?.bookId ?? null, text.textId, true);
      navigate('/texts');
    } catch (error: unknown) { alert(`Failed to complete lesson: ${(error as Error)?.message}`); }
    finally { setCompleting(false); }
  };

  // --- New Sentence Rendering Logic ---
  // Takes processed elements for a block (e.g., paragraph) and a starting index,
  // returns rendered sentence elements and the next sentence index.
  const renderProcessedContentAsSentences = useCallback((
    processedElements: React.ReactNode,
    startingSentenceIndex: number
  ): { sentenceElements: React.ReactNode[] | null; nextSentenceIndex: number } => {
    if (!Array.isArray(processedElements) || processedElements.length === 0) {
      return { sentenceElements: null, nextSentenceIndex: startingSentenceIndex };
    }

    const sentenceElements: React.ReactNode[] = [];
    let currentSentenceElements: React.ReactNode[] = [];
    let sentenceIndex = startingSentenceIndex;
    const sentenceEndRegex = /^[.!?…]$/;
    const whitespaceRegex = /^\s+$/;

    const fragmentChildrenString = (el: React.ReactNode): string | null => {
      if (!React.isValidElement(el) || el.type !== React.Fragment) return null;
      const { children } = el.props as { children?: React.ReactNode };
      return children == null ? null : String(children);
    };

    processedElements.forEach((element, idx) => {
      currentSentenceElements.push(element);

      let isEndOfSentence = false;
      const fragmentText = fragmentChildrenString(element);
      if (fragmentText !== null) {
        const content = fragmentText.trim();
        if (sentenceEndRegex.test(content)) {
          const nextElement = processedElements[idx + 1];
          const nextFragmentText = fragmentChildrenString(nextElement);
          if (!nextElement || (nextFragmentText !== null && whitespaceRegex.test(nextFragmentText))) {
            isEndOfSentence = true;
          }
        }
      }

      if (isEndOfSentence || idx === processedElements.length - 1) {
        if (currentSentenceElements.some(el => {
          const text = fragmentChildrenString(el);
          return text === null || !whitespaceRegex.test(text);
        })) {
          const currentSentenceIndex = sentenceIndex++;
          sentenceElements.push(
            <span
              key={`sentence-${currentSentenceIndex}`}
              className="sentence"
              data-sentence-index={currentSentenceIndex}
              onContextMenu={(e) => handleSentenceContextMenu(e, currentSentenceIndex)}
              onClickCapture={(e) => focusSentenceIndexFromNode(e.target as Node)}
              onTouchEndCapture={(e) => focusSentenceIndexFromNode(e.target as Node)}
              style={{ display: 'inline' }} // Keep inline display
            >
              {isBookmarked(currentSentenceIndex) && (
                <span className="bookmark-icon" aria-label="bookmark">🔖</span>
              )}
              {currentSentenceElements}
            </span>
          );
        }
        currentSentenceElements = [];
      }
    });

    return { sentenceElements, nextSentenceIndex: sentenceIndex };
  }, [focusSentenceIndexFromNode, handleSentenceContextMenu, isBookmarked]); // Dependencies

  // --- End New Sentence Rendering Logic ---


  // --- Rendering Logic ---
  // --- Loading/Error/NotFound States ---
  if (loading) { return <Container className="py-5 text-center"><Spinner animation="border" /></Container>; }
  if (error) { return <Container className="py-5"><Alert variant="danger">{error}<Button onClick={() => navigate(-1)}>Back</Button></Alert></Container>; }
  if (!text) { return <Container className="py-5"><Alert variant="warning">Text not found<Button onClick={() => navigate('/texts')}>Back</Button></Alert></Container>; }
  // --- End Loading/Error States ---

  // DEBUG: Log isAudioLesson state before rendering

  const primaryControls = (
    <PrimaryControls
      isAudioLesson={isAudioLesson}
      displayMode={displayMode}
      setDisplayMode={setDisplayMode}
      isSentenceMode={isSentenceMode}
      setSentenceModeEnabled={setSentenceModeEnabled}
      text={text}
      handleCompleteLesson={handleCompleteLesson}
      handleCompleteLessonNoStats={handleCompleteLessonNoStats}
      completing={completing}
      nextTextId={nextTextId}
      navigate={navigate}
    />
  );

  const secondaryControls = (
    <SecondaryControls
      isMobile={isMobile}
      globalSettings={globalSettings}
      setReadingDensity={setReadingDensity}
      setReaderContentWidth={setReaderContentWidth}
      setShowWordInfoPanel={setShowWordInfoPanel}
      setReaderParagraphIndent={setReaderParagraphIndent}
      setReaderTextAlignment={setReaderTextAlignment}
      updateSetting={updateSetting}
      updateUserSettings={updateUserSettings}
      leftPanelWidth={leftPanelWidth}
      setLeftPanelWidth={setLeftPanelWidth}
      handleLineSpacingChange={handleLineSpacingChange}
      handleParagraphSpacingChange={handleParagraphSpacingChange}
      text={text}
      loading={loading}
      handleFullTextTranslation={handleFullTextTranslation}
      handleOpenSummaryPopup={handleOpenSummaryPopup}
      isSummarizing={isSummarizing}
      handleTranslateUnknownWords={handleTranslateUnknownWords}
      translatingUnknown={translatingUnknown}
      handleMarkAllUnknownAsKnown={handleMarkAllUnknownAsKnown}
      isMarkingAll={isMarkingAll}
    />
  );

  const readerLessonActions = (
    <ReaderLessonActions
      text={text}
      isAudioLesson={isAudioLesson}
      previousTextId={previousTextId}
      nextTextId={nextTextId}
      completing={completing}
      navigate={navigate}
      handleCompleteLesson={handleCompleteLesson}
    />
  );

  // --- Main Return JSX ---
  const effectiveLeftPanelWidth = !isMobile && showWordInfoPanel ? leftPanelWidth : 100;

  // Composite props built once and reused at both WordInfoPanel callsites
  // (desktop right-panel + mobile bottom-sheet). Phase E3 grouped the
  // pre-existing 25-prop interface into 5 named composites.
  const wordInfoProps = {
    displayedWord,
    selectedWord,
    saveSuccess,
    translation: {
      value: translation,
      setValue: setTranslation,
      onKeyDown: handleTranslationKeyDown,
      isTranslating,
      error: wordTranslationError,
    },
    speech: {
      sentenceTtsEnabled,
      canUseSentenceTts,
      isSpeakingWord,
      onSpeakWord: speakDisplayedWord,
    },
    actions: {
      onSaveWord: handleSaveWord,
      onMineSentence: handleMineSentence,
      processingWord,
      onReadingCredit: handleReadingCredit,
      onRetranslateWithContext: handleRetranslateWithContext,
      canRetranslate: !!displayedWord?.term && !!wordInfoRetranslateContext,
      onAddTranslationWithContext: handleAddTranslationWithContext,
      canAddTranslation: !!displayedWord?.term && !!wordInfoRetranslateContext,
      onDeleteWord: handleDeleteWord,
    },
    bookmark: {
      isSentenceBookmarked: isBookmarked(currentSegmentIndex),
      onToggleBookmark: handleToggleBookmarkForCurrentSentence,
    },
    language: {
      languageConfig,
      setEmbeddedUrl,
    },
  };
  return (
    <div className={`text-display-wrapper lesson-page px-0 mx-0 w-100 reader-ui-${readingUiMode}`}>
      <MobileLessonHeader
        isMobile={isMobile}
        showMobileHeader={showMobileHeader}
        setShowMobileHeader={setShowMobileHeader}
        showMoreControls={showMoreControls}
        setShowMoreControls={setShowMoreControls}
        text={text ? { title: text.title ?? undefined } : text}
        primaryControls={primaryControls}
        secondaryControls={secondaryControls}
        readerLessonActions={readerLessonActions}
        isAudioLesson={isAudioLesson}
        isAudioPlaying={isAudioPlaying}
        toggleAudioPlayback={toggleAudioPlayback}
      />
      <LessonHeader
        isMobile={isMobile}
        text={text}
        words={words}
        isAudioLesson={isAudioLesson}
        book={book}
        primaryControls={primaryControls}
        secondaryControls={secondaryControls}
        readerLessonActions={readerLessonActions}
        translateUnknownError={translateUnknownError}
        audioSrc={audioSrc}
        textId={textId}
        audioRef={audioRef}
        onTimeUpdate={handleAudioTimeUpdate}
        onPlaybackStateChange={handleAudioPlaybackStateChange}
        segmentPlaybackRequest={segmentPlaybackRequest}
        showDesktopLessonControls={showDesktopLessonControls}
        setShowDesktopLessonControls={setShowDesktopLessonControls}
      />

      {/* Download-for-offline (audio lessons only). Surfaces under the header
          so users can pre-cache audio + text before going offline. */}
      {isAudioLesson && audioSrc && (
        <div className="px-3 py-1 d-flex justify-content-end" data-testid="textdisplay-offline-download">
          <DownloadForOfflineButton
            cacheName="lr-audio"
            urls={[audioSrc]}
            label="Save audio for offline"
          />
        </div>
      )}

      {/* Mobile Audio Player - Show for audio lessons on mobile only */}
      {isMobile && isAudioLesson && audioSrc && (
        <div className="audio-player-container p-2 border-bottom theme-aware-audio-player-container lesson-audio-bar">
          <AudiobookPlayer
            key="lesson-audio-player-mobile"
            type="lesson"
            audioSrc={audioSrc}
            textId={textId}
            languageId={text?.languageId}
            audioRef={audioRef}
            onTimeUpdate={handleAudioTimeUpdate}
            onPlaybackStateChange={handleAudioPlaybackStateChange}
            segmentPlaybackRequest={segmentPlaybackRequest}
          />
        </div>
      )}

      {/* Mobile Audiobook Player - book-mode playback for audiobooks on mobile */}
      {isMobile && !isAudioLesson && (book?.audiobookTracks?.length ?? 0) > 0 && (
        <div className="audio-player-container p-2 border-bottom theme-aware-audio-player-container lesson-audio-bar">
          <AudiobookPlayer
            key="book-audio-player-mobile"
            type="book"
            book={book}
          />
        </div>
      )}

      {/* Main Content Area */}
      <div className={`resizable-container resizable-container-${readingUiMode}`}>
        {/* Left Panel (Reading Area) */}
        <div
          className={`left-panel left-panel-${readingUiMode}`}
          style={{
            width: `${effectiveLeftPanelWidth}%`,
            minHeight: readingUiMode === 'modern' ? 0 : 'calc(100vh - 130px)',
            height: readingUiMode === 'modern' ? 'calc(100vh - 130px)' : 'auto',
            padding: '0',
            position: 'relative'
          }}
        >
          <div className="d-flex flex-column" style={{ minHeight: '100%', height: '100%' }}>
            <div
              className={`flex-grow-1 reader-main-surface reader-main-surface-${readingUiMode}`}
              ref={readingContainerRef}
            >
              <div
                className={`reader-main-surface-inner reader-main-surface-inner-${readingUiMode}`}
                style={{ '--reader-content-max-width': `${globalSettings.readerContentWidth || 740}px` } as React.CSSProperties}
              >
                {isSentenceMode ? (
                  <SentenceModeView
                    currentSegment={currentSentenceSegment}
                    segmentCount={sentenceSegments.length}
                    currentSegmentIndex={currentSegmentIndex}
                    creditedSegmentCount={creditedSegmentIndices.length}
                    fontStyle={getFontStyling(isMobile ? mobileReadingConfig.lineSpacing : globalSettings.lineSpacing)}
                    processTextContent={processTextContent}
                    handleWordSelection={handleWordSelection}
                    textContentRef={textContentRef}
                    canGoPrev={currentSegmentIndex > 0}
                    canGoNext={currentSegmentIndex < sentenceSegments.length - 1}
                    onPrev={() => setCurrentSegmentIndex(prev => Math.max(0, prev - 1))}
                    onNext={() => setCurrentSegmentIndex(prev => Math.min(sentenceSegments.length - 1, prev + 1))}
                    onReplayAudio={replayCurrentSegmentAudio}
                    canUseSentenceTts={canUseSentenceTts}
                    isSpeakingSentence={isSpeakingSentence}
                    sentenceTtsEnabled={sentenceTtsEnabled}
                    setSentenceTtsEnabled={setSentenceTtsEnabled}
                    sentenceTtsRate={sentenceTtsRate}
                    setSentenceTtsRate={setSentenceTtsRate}
                    isAudioLesson={isAudioLesson}
                    sentenceAudioRepeats={sentenceAudioRepeats}
                    setSentenceAudioRepeats={setSentenceAudioRepeats}
                    onShowTranslation={handleSegmentTranslationToggle}
                    onShowExplanation={handleSegmentExplanationToggle}
                    isTranslatingSegment={isTranslatingSegment}
                    isExplainingSegment={isExplainingSegment}
                    isTranslationVisible={visibleTranslationIndex === currentSentenceSegment?.index}
                    isExplanationVisible={visibleExplanationIndex === currentSentenceSegment?.index}
                    currentSegmentTranslation={currentSentenceSegment ? segmentTranslations[currentSentenceSegment.index] : ''}
                    currentSegmentExplanation={currentSentenceSegment ? segmentExplanations[currentSentenceSegment.index] : ''}
                  />
                ) : isAudioLesson && displayMode === 'audio' ? (
                  <AudioTranscriptView
                    isMobile={isMobile}
                    srtLines={srtLines}
                    currentSrtLineId={currentSrtLineId}
                    getFontStyling={getFontStyling}
                    handleLineClick={handleLineClick}
                    handleWordSelection={handleWordSelection}
                    processTextContent={processTextContent}
                    globalSettings={globalSettings}
                    mobileReadingConfig={mobileReadingConfig}
                    textContentRef={textContentRef}
                    readingContainerRef={readingContainerRef}
                    itemData={itemData}
                    listRef={listRef}
                  />
                ) : (
                  <StandardTextView
                    text={text}
                    globalSettings={globalSettings}
                    readingUiMode={readingUiMode}
                    mobileReadingConfig={mobileReadingConfig}
                    getFontFamilyForList={getFontFamilyForList}
                    handleWordSelection={handleWordSelection}
                    processTextContent={processTextContent}
                    renderProcessedContentAsSentences={renderProcessedContentAsSentences}
                    isMobile={isMobile}
                    textContentRef={textContentRef}
                    canUseSentenceTts={canUseSentenceTts}
                    isSpeakingSentence={isSpeakingSentence}
                    sentenceTtsEnabled={sentenceTtsEnabled}
                    setSentenceTtsEnabled={setSentenceTtsEnabled}
                    sentenceTtsRate={sentenceTtsRate}
                    setSentenceTtsRate={setSentenceTtsRate}
                    onSpeakSentence={speakCurrentSentence}
                    handleCompleteLesson={handleCompleteLesson}
                    completing={completing}
                    nextTextId={nextTextId}
                  />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Removed Resize Divider */}

        {/* Right Panel (Word Info) - desktop only */}
        {!isMobile && showWordInfoPanel && (
          <div className={`right-panel right-panel-${readingUiMode}`} style={{ width: `${100 - effectiveLeftPanelWidth}%`, height: 'calc(100vh - 130px)', overflowY: 'auto', padding: 'var(--space-sm)', position: 'relative' }}>
            <Card className="border-0 h-100"><Card.Body className="p-2 d-flex flex-column">
              <h5 className="mb-2 flex-shrink-0">Word Info</h5>
              <div className="flex-grow-1" style={{ overflowY: 'auto', paddingBottom: 'var(--space-xs)' }}>
                <WordInfoPanel {...wordInfoProps} />
              </div>

              {/* --- Phase 3: Embedded Dictionary Iframe --- */}
              {embeddedUrl && (
                <div className="mt-2 pt-2 border-top flex-shrink-0" style={{ position: 'relative', height: '40%', minHeight: '150px' }}>
                  <Button
                    variant="light"
                    size="sm"
                    onClick={() => setEmbeddedUrl(null)}
                    style={{ position: 'absolute', top: '5px', right: '5px', zIndex: 10, padding: '0.1rem 0.3rem', lineHeight: 1 }}
                    title="Close Dictionary View"
                  >
                    &times; {/* Close icon */}
                  </Button>
                  <iframe
                    src={embeddedUrl}
                    title="Embedded Dictionary"
                    style={{ width: '100%', height: '100%', border: 'none' }}
                    sandbox="allow-scripts allow-same-origin allow-popups allow-forms" // Security sandbox
                    referrerPolicy="no-referrer" // Privacy
                  ></iframe>
                </div>
              )}
              {/* --- End Phase 3 --- */}
            </Card.Body></Card>
          </div>
        )}
      </div>

      {isMobile && isWordPanelOpen && (
        <div
          className="word-info-sheet-backdrop"
          onClick={() => {
            setIsWordPanelOpen(false);
            lastHandledSelectionRef.current = '';
          }}
          role="presentation"
        >
          <div className="word-info-sheet" onClick={(event) => event.stopPropagation()} role="dialog" aria-label="Word information">
            <div className="word-info-sheet-handle" />
            <div className="word-info-sheet-content">
              <h5 className="mb-2">Word Info</h5>
              <WordInfoPanel {...wordInfoProps} />
            </div>
          </div>
        </div>
      )}

      {/* Modals */}
      <Modal show={showStatsModal} onHide={() => setShowStatsModal(false)} centered>
        <Modal.Header closeButton><Modal.Title>Lesson Completed!</Modal.Title></Modal.Header>
        <Modal.Body>
          {stats && (
            <div className="text-center">
              <h5>Book Progress</h5>
              <ProgressBar now={stats.completionPercentage || 0} label={`${(stats.completionPercentage || 0).toFixed(1)}%`} className="mb-3" />
              <Row>
                <Col>Known: <Badge bg="success">{stats.knownWords}</Badge></Col>
                <Col>Learning: <Badge bg="warning">{stats.learningWords}</Badge></Col>
                <Col>Total: <Badge bg="info">{stats.totalWords}</Badge></Col>
              </Row>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowStatsModal(false)}>Close</Button>
          {nextTextId && <Button variant="success" onClick={() => { setShowStatsModal(false); navigate(`/texts/${nextTextId}`); }}>Next Lesson</Button>}
          {text?.bookId && <Button variant="primary" onClick={() => navigate(`/books/${text.bookId}`)}>Back to Book</Button>}
        </Modal.Footer>
      </Modal>
      <TranslationPopup show={showTranslationPopup} handleClose={() => setShowTranslationPopup(false)} originalText={text?.content || ''} translatedText={fullTextTranslation} isTranslating={isFullTextTranslating} />
      <SummaryPopup
        show={showSummaryPopup}
        handleClose={() => setShowSummaryPopup(false)}
        title={text?.title || 'Current text'}
        sourceLanguage={text?.languageName || text?.languageCode || 'Auto'}
        targetLanguage={summaryTargetLanguage}
        setTargetLanguage={setSummaryTargetLanguage}
        languages={summaryLanguages}
        isLoadingLanguages={isLoadingSummaryLanguages}
        summaryText={summaryText}
        isSummarizing={isSummarizing}
        error={summaryError}
        onSummarize={handleSummarizeText}
      />

    </div>
  );
};

export default TextDisplay;
