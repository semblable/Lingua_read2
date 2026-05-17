import React, { useEffect, useState, useCallback, useRef, useMemo, useContext } from 'react';
import { Container, Card, Spinner, Alert, Button, Modal, Row, Col, Badge, ProgressBar, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom';
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
import AudiobookPlayerImpl from '../components/AudiobookPlayer';
// AudiobookPlayer is now .tsx but accepts heterogeneous prop subsets per
// usage (lesson vs book). Cast to a permissive shape until Phase E2
// extracts the sub-modules.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const AudiobookPlayer = AudiobookPlayerImpl as React.ComponentType<any>;
import './TextDisplay.css';
import { SettingsContext } from '../contexts/SettingsContext';
import { useReaderBookmarks } from '../hooks/useReaderBookmarks';
import { extractTranslatedTextFromPairedTags } from '../utils/translationTags';
import { cancelSpeech, isSpeechSynthesisSupported, speakText } from '../utils/browserTts';
import { parseSrtContent, findSrtLineIndex } from '../utils/srtParser';
import { styles, splitTextIntoSentenceSegments, prepareLanguageContext, consumeWordAt } from '../utils/readerText';
import PrimaryControls from '../components/reader/PrimaryControls';
import SecondaryControls from '../components/reader/SecondaryControls';
import ReaderLessonActions from '../components/reader/ReaderLessonActions';
import MobileLessonHeader from '../components/reader/MobileLessonHeader';
import LessonHeader from '../components/reader/LessonHeader';
import WordInfoPanel from '../components/reader/WordInfoPanel';
import AudioTranscriptView from '../components/reader/AudioTranscriptView';
import StandardTextView from '../components/reader/StandardTextView';
import SentenceModeView from '../components/reader/SentenceModeView';
import type { Text as TextDto } from '../utils/api/texts';
import type { Book as BookDto } from '../utils/api/books';
import type { Word } from '../utils/api/words';
import type { Language } from '../utils/api/languages';
import type { LanguageConfig } from '../utils/readerText';
import type { SrtEntry } from '../utils/srtParser';

// Page state often overlays extra fields the OpenAPI spec omits. Keep the
// types loose enough for the augmented runtime shape used by the reader.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReaderText = TextDto & Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReaderBook = BookDto & Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DisplayedWord = Record<string, any>;

const TextDisplay = () => {
  const { textId } = useParams();
  const navigate = useNavigate();
  const textContentRef = useRef<HTMLDivElement | null>(null);
  const readingContainerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const listRef = useRef<any>(null); // react-window FixedSizeList ref
  const autoScrollRafRef = useRef<number | null>(null);
  const autoTranslateTriggeredRef = useRef(false);
  const autoTranslateTextIdRef = useRef<number | string | null>(null);
  // Removed resizeDividerRef

  // --- State Declarations ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState<ReaderText | null>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [languageWordsLoaded, setLanguageWordsLoaded] = useState(false);
  const [selectedWord, setSelectedWord] = useState('');
  const [hoveredWordTerm, setHoveredWordTerm] = useState<string | null>(null);
  const [translation, setTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [processingWord, setProcessingWord] = useState(false);
  const [displayedWord, setDisplayedWord] = useState<DisplayedWord | null>(null);
  const [selectedWordAiContext, setSelectedWordAiContext] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [wordTranslationError, setWordTranslationError] = useState('');
  const [translatingUnknown, setTranslatingUnknown] = useState(false);
  const [translateUnknownError, setTranslateUnknownError] = useState('');
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [completing, setCompleting] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [previousTextId, setPreviousTextId] = useState<number | null>(null);
  const [nextTextId, setNextTextId] = useState<number | null>(null);
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
  const [isAudioLesson, setIsAudioLesson] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [srtLines, setSrtLines] = useState<SrtEntry[]>([]);
  const [currentSrtLineId, setCurrentSrtLineId] = useState<number | null>(null);
  const audioCurrentTimeRef = useRef(0); // Use ref instead of state to prevent re-renders
  const [displayMode, setDisplayMode] = useState('audio');
  const [languageConfig, setLanguageConfig] = useState<LanguageConfig | null>(null); // State for language settings (Phase 3)
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null); // State for embedded dictionary iframe URL (Phase 3)
  const [showMoreControls, setShowMoreControls] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [showMobileHeader, setShowMobileHeader] = useState(false);
  const showDesktopLessonControls = globalSettings.showDesktopLessonControls ?? true;
  const [isWordPanelOpen, setIsWordPanelOpen] = useState(false);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [currentSegmentIndex, setCurrentSegmentIndex] = useState(0);
  const [segmentTranslations, setSegmentTranslations] = useState<Record<number, string>>({});
  const [segmentExplanations, setSegmentExplanations] = useState<Record<number, string>>({});
  const [isTranslatingSegment, setIsTranslatingSegment] = useState(false);
  const [isExplainingSegment, setIsExplainingSegment] = useState(false);
  const [visibleTranslationIndex, setVisibleTranslationIndex] = useState<number | null>(null);
  const [visibleExplanationIndex, setVisibleExplanationIndex] = useState<number | null>(null);
  const [creditedSegmentIndices, setCreditedSegmentIndices] = useState<number[]>([]);
  const [sentenceProgressLoaded, setSentenceProgressLoaded] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [segmentPlaybackRequest, setSegmentPlaybackRequest] = useState<any | null>(null);
  const [isSpeakingSentence, setIsSpeakingSentence] = useState(false);
  const [isSpeakingWord, setIsSpeakingWord] = useState(false);
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
  const translationAbortRef = useRef<AbortController | null>(null);
  const translationCacheRef = useRef(new Map<string, unknown>());
  const pendingSentenceCreditRef = useRef(new Set<number>());
  const audioDrivenSentenceSyncRef = useRef(false);
  const lastAutoSegmentPlaybackKeyRef = useRef('');
  const skipInitialAudioLessonSegmentPlaybackRef = useRef(true);
  const textLoadRequestVersionRef = useRef(0);
  const currentTextIdForSummaryRef = useRef<number | null>(null);
  // --- End State Declarations ---

  // Create refs for values used in handleAudioTimeUpdate to keep the callback stable
  const handleAudioTimeUpdateStateRef = useRef({
    isAudioLesson: false,
    srtLines: [] as SrtEntry[],
    displayMode: 'audio',
    currentSrtLineId: null as number | null,
    isSentenceMode: false,
    currentSegmentIndex: 0,
    isMobile: false,
    listRef: listRef // Reference the listRef from scope
  });

  // Sync refs with state
  useEffect(() => {
    handleAudioTimeUpdateStateRef.current = {
      isAudioLesson,
      srtLines,
      displayMode,
      currentSrtLineId,
      isSentenceMode: globalSettings.sentenceMode,
      currentSegmentIndex,
      isMobile,
      listRef: listRef // Store the ref object
    };
  }, [isAudioLesson, srtLines, displayMode, currentSrtLineId, globalSettings.sentenceMode, currentSegmentIndex, isMobile]);

  useEffect(() => {
    currentTextIdForSummaryRef.current = text?.textId ?? null;
    setShowSummaryPopup(false);
    setSummaryText('');
    setSummaryError('');
  }, [text?.textId]);

  // --- Effects ---
  // --- End Effects ---
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
  const readingUiMode = isAudioLesson
    ? 'classic'
    : (globalSettings.readingUiMode === 'modern' ? 'modern' : 'classic');
  const readingDensity = globalSettings.readingDensity || 'balanced';
  const showWordInfoPanel = globalSettings.showWordInfoPanel ?? true;

  const setAudioPlaybackIntent = useCallback((shouldPlay: boolean) => {
    if (audioRef.current) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (audioRef.current as any).__lrAllowPlayback = shouldPlay;
    }
  }, []);

  const hasActiveTextSelection = useCallback(() => {
    const selection = window.getSelection();
    return Boolean(selection && !selection.isCollapsed && selection.toString().trim());
  }, []);

  const {
    isBookmarked,
    toggleBookmarkForIndex,
    handleSentenceContextMenu
  } = useReaderBookmarks({ textId, isMobile, hasActiveTextSelection });

  const toggleAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      setAudioPlaybackIntent(true);
      audio.play().catch((err: unknown) => console.error('Mobile audio toggle failed to play:', err));
    } else {
      setAudioPlaybackIntent(false);
      audio.pause();
    }
  }, [setAudioPlaybackIntent]);

  const pauseAudioPlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || audio.paused) return;
    setAudioPlaybackIntent(false);
    audio.pause();
  }, [setAudioPlaybackIntent]);

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

  const handleAudioPlaybackStateChange = useCallback((nextIsPlaying: boolean) => {
    if (nextIsPlaying) {
      cancelSpeech();
      setIsSpeakingSentence(false);
      setIsSpeakingWord(false);
    }
    setIsAudioPlaying(nextIsPlaying);
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setShowDesktopLessonControls = useCallback((nextValue: any) => {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setSentenceAudioRepeats = useCallback((updater: any) => {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const setSentenceTtsRate = useCallback((updater: any) => {
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
      // Corrected URL construction: Removed redundant '/api' prefix
      const response = await fetch(`${API_URL}/words/language/${languageId}?skipSort=true`, {
        credentials: 'include',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' }
      });
      if (!response.ok) throw new Error('Failed to fetch language words');
      const allLanguageWords = await response.json();
      if (!shouldApply()) return;
      // Replace the entire words state with the newly fetched data
      setWords(allLanguageWords);
      setLanguageWordsLoaded(true);
    } catch (error) {
      console.error('Error fetching language words:', error);
      if (shouldApply()) setLanguageWordsLoaded(true);
    }
  }, [setWords]); // Dependency: setWords

  const prevFetchAllLanguageWordsRef = useRef(fetchAllLanguageWords);

  // --- Optimized Data Structures ---
  // 1. Create a Map for O(1) word lookups
  const wordMap = useMemo(() => {
    const map = new Map();
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

  // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const statusStyles: Record<number, { backgroundColor: string; color: string }> = {
      0: { backgroundColor: 'var(--status-0-color, #e0e0e0)', color: '#000' },
      1: { backgroundColor: 'var(--status-1-color, #ff6666)', color: '#000' },
      2: { backgroundColor: 'var(--status-2-color, #ff9933)', color: '#000' },
      3: { backgroundColor: 'var(--status-3-color, #ffdd66)', color: '#000' },
      4: { backgroundColor: 'var(--status-4-color, #99dd66)', color: '#000' },
    };
    return { ...baseStyle, ...(statusStyles[wordStatus ?? 0] || statusStyles[0]) };
  }, [languageWordsLoaded, globalSettings?.highlightKnownWords]); // Use globalSettings from context

  const triggerAutoTranslation = useCallback(async (
    termToTranslate: string,
    options: { sentenceContext?: string; force?: boolean } = {}
  ) => {
    const { sentenceContext = '', force = false } = options;
    if (!termToTranslate || !text?.languageCode) return;
    if (!force && !globalSettings.autoTranslateWords) return;

    const cacheKey = `${text.languageCode}|${translationTargetLanguageCode}|${sentenceContext ? 'sel' : 'word'}|${sentenceContext}|${termToTranslate}`;
    const cached = translationCacheRef.current.get(cacheKey);
    if (!force && cached) {
      // Refresh LRU position
      translationCacheRef.current.delete(cacheKey);
      translationCacheRef.current.set(cacheKey, cached);
      setIsTranslating(false);
      setWordTranslationError('');
      setTranslation(cached as string);
      setDisplayedWord(prev => (prev && prev.term === termToTranslate ? { ...prev, translation: cached } : prev));
      return;
    }

    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;

    setIsTranslating(true);
    setWordTranslationError('');
    try {
      const result = sentenceContext
        ? await translateSelectionWithContext(termToTranslate, sentenceContext, text.languageCode, translationTargetLanguageCode, { signal: controller.signal })
        : await translateText(termToTranslate, text.languageCode, translationTargetLanguageCode, { signal: controller.signal });
      if (result?.translatedText) {
        const cache = translationCacheRef.current;
        cache.set(cacheKey, result.translatedText);
        if (cache.size > 100) {
          const oldestKey = cache.keys().next().value;
          if (oldestKey !== undefined) cache.delete(oldestKey);
        }
        setTranslation(result.translatedText);
        setDisplayedWord((prev: any) => (prev && prev.term === termToTranslate ? { ...prev, translation: result.translatedText } : prev));
      } else {
        setWordTranslationError('Translation not found.');
      }
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (e?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Auto-translation failed:', err);
      if (e?.status === 429) {
        setWordTranslationError('Provider rate limit reached — try again in a few seconds.');
      } else {
        setWordTranslationError(`Translation failed: ${e?.message}`);
      }
    } finally {
      if (translationAbortRef.current === controller) {
        translationAbortRef.current = null;
        setIsTranslating(false);
      }
    }
  }, [globalSettings.autoTranslateWords, text?.languageCode, translationTargetLanguageCode, setTranslation, setDisplayedWord, setIsTranslating, setWordTranslationError]);

  const appendAutoTranslation = useCallback(async (
    termToTranslate: string,
    options: { sentenceContext?: string } = {}
  ) => {
    const { sentenceContext = '' } = options;
    if (!termToTranslate || !text?.languageCode || !sentenceContext) return;

    translationAbortRef.current?.abort();
    const controller = new AbortController();
    translationAbortRef.current = controller;

    setIsTranslating(true);
    setWordTranslationError('');
    try {
      const result = await translateSelectionWithContext(
        termToTranslate,
        sentenceContext,
        text.languageCode,
        translationTargetLanguageCode,
        { signal: controller.signal }
      );
      const newTranslation = result?.translatedText?.trim();
      if (!newTranslation) {
        setWordTranslationError('Translation not found.');
        return;
      }

      const cacheKey = `${text.languageCode}|${translationTargetLanguageCode}|sel|${sentenceContext}|${termToTranslate}`;
      const cache = translationCacheRef.current;
      cache.set(cacheKey, newTranslation);
      if (cache.size > 100) {
        const oldestKey = cache.keys().next().value;
        if (oldestKey !== undefined) cache.delete(oldestKey);
      }

      setTranslation(prev => {
        const existing = (prev || '').trim();
        if (!existing) return newTranslation;
        const haystack = existing.toLowerCase();
        const needle = newTranslation.toLowerCase();
        if (haystack === needle || haystack.split(/\s*,\s*/).includes(needle)) {
          return existing;
        }
        const combined = `${existing}, ${newTranslation}`;
        setDisplayedWord((prevWord: any) => (prevWord && prevWord.term === termToTranslate ? { ...prevWord, translation: combined } : prevWord));
        return combined;
      });
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const e = err as any;
      if (e?.name === 'AbortError' || controller.signal.aborted) {
        return;
      }
      console.error('Append translation failed:', err);
      if (e?.status === 429) {
        setWordTranslationError('Provider rate limit reached — try again in a few seconds.');
      } else {
        setWordTranslationError(`Translation failed: ${e?.message}`);
      }
    } finally {
      if (translationAbortRef.current === controller) {
        translationAbortRef.current = null;
        setIsTranslating(false);
      }
    }
  }, [text?.languageCode, translationTargetLanguageCode, setTranslation, setDisplayedWord, setIsTranslating, setWordTranslationError]);

  const handleWordClick = useCallback((
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    word: any,
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
      setDisplayedWord(existingWord);
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
      translationAbortRef.current?.abort();
    };
  }, [clearPendingSelection, clearMobileSelectionPending]);

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

  const handleLineClick = useCallback((startTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = startTime;
      audioCurrentTimeRef.current = startTime;

      if (isAudioLesson && displayMode === 'audio' && srtLines.length > 0) {
        const currentLineIndex = srtLines.findIndex(line => startTime >= line.startTime && startTime < line.endTime);
        const currentLine = currentLineIndex !== -1 ? srtLines[currentLineIndex] : null;
        setCurrentSrtLineId(currentLine?.id ?? null);

        if (isSentenceMode && currentLineIndex !== -1 && currentLineIndex !== currentSegmentIndex) {
          audioDrivenSentenceSyncRef.current = true;
          setCurrentSegmentIndex(currentLineIndex);
        }
      }

      setTimeout(() => {
        if (audioRef.current) { console.log(`[handleLineClick] audioRef current time after seek attempt: ${audioRef.current.currentTime}`); }
      }, 0);
    } else {
    }
  }, [currentSegmentIndex, displayMode, isAudioLesson, isSentenceMode, srtLines]);

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

  // sentenceSegments is heterogeneous: SRT-derived segments carry startTime/
  // endTime/srtLineId; sentence-split segments carry mediaBlocks. The render
  // code branches on `startTime != null`. Use a permissive union shape.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Segment = any;

  const sentenceSegments = useMemo<Segment[]>(() => {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (text?.structuredContent as any) || [],
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

    if (currentSentenceSegment.startTime == null || currentSentenceSegment.endTime == null) {
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
    if (!isSentenceMode) {
      cancelSpeech();
      setIsSpeakingSentence(false);
      setIsSpeakingWord(false);
      lastAutoSegmentPlaybackKeyRef.current = '';
      setSegmentPlaybackRequest(null);
    }
  }, [isSentenceMode]);

  useEffect(() => () => {
    cancelSpeech();
  }, []);

  useEffect(() => {
    cancelSpeech();
    setIsSpeakingSentence(false);
    setIsSpeakingWord(false);
  }, [currentSegmentIndex]);

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

    if (isAudioLesson && currentSentenceSegment.startTime != null && currentSentenceSegment.endTime != null) {
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

  // Removed separate fetchUserSettings effect, handled by SettingsContext

  // Fetch Text Data, Restore Audio Time & Playback Rate
  useEffect(() => {
    const requestVersion = textLoadRequestVersionRef.current + 1;
    textLoadRequestVersionRef.current = requestVersion;
    let cancelled = false;
    let wordLinkingPollInterval: ReturnType<typeof setInterval> | null = null;
    const isCurrentRequest = (): boolean => !cancelled && textLoadRequestVersionRef.current === requestVersion;
    const clearWordLinkingPoll = () => {
      if (wordLinkingPollInterval) {
        clearInterval(wordLinkingPollInterval);
        wordLinkingPollInterval = null;
      }
    };
    const refreshWordsAfterLinking = async () => {
      if (!textId) return;
      try {
        const refreshed = await getText(textId);
        if (isCurrentRequest()) {
          setWords(refreshed.words || []);
        }
      } catch (refreshErr) {
        if (isCurrentRequest()) {
          console.error('Failed to refresh words after linking completed:', refreshErr);
        }
      }
    };
    const checkWordLinkingStatus = async () => {
      if (!isCurrentRequest() || !textId) return;
      try {
        const statusData = (await getWordLinkingStatus(textId)) as unknown as { wordLinkingStatus?: string } | null;
        if (!isCurrentRequest()) return;
        if (statusData?.wordLinkingStatus !== 'processing') {
          clearWordLinkingPoll();
          await refreshWordsAfterLinking();
        }
      } catch (pollErr) {
        if (isCurrentRequest()) {
          console.error('Failed to poll word linking status:', pollErr);
        }
        clearWordLinkingPoll();
      }
    };
    const startWordLinkingPoll = () => {
      clearWordLinkingPoll();
      wordLinkingPollInterval = setInterval(checkWordLinkingStatus, 5000);
    };

    // --- Debug: Check what triggered this effect ---
    if (prevFetchAllLanguageWordsRef.current !== fetchAllLanguageWords) {
      prevFetchAllLanguageWordsRef.current = fetchAllLanguageWords;
    } else {
    }

    // --- Set initial panel width from global settings ---
    // This ensures panel width resets if global settings change while component is mounted
    setLeftPanelWidth(globalSettings.leftPanelWidth || 85);
    // --- End Set initial panel width ---

    const fetchText = async () => {
      if (!textId) return;
      // Check if we are checking the same text to avoid full re-mount of children (AudiobookPlayer)
      const isSameText = text && String(text.textId) === String(textId);

      if (!isSameText) {
        setLoading(true);
        setLanguageWordsLoaded(false);
        autoTranslateTriggeredRef.current = false;
        autoTranslateTextIdRef.current = null;
        setError('');
        setBook(null);
        setPreviousTextId(null);
        setNextTextId(null);
        setCurrentSegmentIndex(0);
        setSegmentTranslations({});
        setSegmentExplanations({});
        setVisibleTranslationIndex(null);
        setVisibleExplanationIndex(null);
        setCreditedSegmentIndices([]);
        setSentenceProgressLoaded(false);
        setSegmentPlaybackRequest(null);
        lastAutoSegmentPlaybackKeyRef.current = '';
        skipInitialAudioLessonSegmentPlaybackRef.current = true;
        pendingSentenceCreditRef.current = new Set();
      } else {
      }

      try {
        const data = await getText(textId);
        if (!isCurrentRequest()) return;
        setText(data);
        setWords(data.words || []);
        if (data.isAudioLesson && data.audioFilePath && data.hasSrtContent) {
          if (!isAudioLesson) setIsAudioLesson(true);

          const newAudioSrc = `/${data.audioFilePath}`;
          if (audioSrc !== newAudioSrc) {
            setAudioSrc(newAudioSrc);
          }

          // Lazy-load SRT content separately to avoid large payloads
          getTextSrt(textId).then(srtText => {
            if (isCurrentRequest() && srtText) setSrtLines(parseSrtContent(srtText));
          }).catch(err => {
            if (isCurrentRequest()) console.error('Failed to load SRT:', err);
          });

          if (displayMode !== 'audio') setDisplayMode('audio');

          // Poll for word linking completion if still processing
          if (data.wordLinkingStatus === 'processing') {
            startWordLinkingPoll();
          }

        } else {
          if (isAudioLesson) setIsAudioLesson(false);
          if (audioSrc !== null) setAudioSrc(null);
          setSrtLines([]);
          if (displayMode !== 'text') setDisplayMode('text');
        }
        // Show text immediately with text-specific words while background data loads
        setLoading(false);

        // --- Parallel fetch of all independent data ---
        const promises = [];

        // 0: Language words
        promises.push(
          data.languageId
            ? fetchAllLanguageWords(data.languageId, isCurrentRequest)
            : Promise.resolve(null)
        );

        // 1: Language config
        promises.push(
          data.languageId
            ? getLanguage(data.languageId)
            : Promise.resolve(null)
        );

        // 2: Book data (updateLastRead then getBook, chained but parallel with others)
        promises.push(
          data.bookId && data.textId != null
            ? updateLastRead(data.bookId, data.textId).then(() => getBook(data.bookId!))
            : Promise.resolve(null)
        );

        // 3: Sentence progress
        promises.push(
          data?.textId
            ? getSentenceProgress(data.textId)
            : Promise.resolve(null)
        );

        const results = await Promise.allSettled(promises);
        if (!isCurrentRequest()) return;

        // Process result 0: fetchAllLanguageWords (already sets state internally)
        if (results[0].status === 'rejected') {
          console.error('Failed to fetch language words:', results[0].reason);
        }
        // Ensure highlights are enabled even if no languageId (fetchAllLanguageWords wasn't called)
        if (!data.languageId) setLanguageWordsLoaded(true);

        // Process result 1: language config
        if (results[1].status === 'fulfilled' && results[1].value) {
          setLanguageConfig(results[1].value as LanguageConfig);
        } else {
          if (results[1].status === 'rejected') {
            console.error('Failed to fetch language configuration:', results[1].reason);
            setError(prev => `${prev} (Warning: Failed to load language config)`);
          }
          setLanguageConfig(null);
        }

        // Process result 2: book
        if (data.bookId) {
          if (results[2].status === 'fulfilled' && results[2].value) {
            const bookData = results[2].value as ReaderBook;
            setBook(bookData);
            if (bookData?.parts) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const currentPartIndex = bookData.parts.findIndex((part: any) => part.textId === parseInt(textId ?? '', 10));
              setPreviousTextId(currentPartIndex > 0 ? (bookData.parts[currentPartIndex - 1].textId ?? null) : null);
              setNextTextId(currentPartIndex >= 0 && currentPartIndex < bookData.parts.length - 1 ? (bookData.parts[currentPartIndex + 1].textId ?? null) : null);
            }
          } else {
            // results[2] is a PromiseSettledResult; narrow before reading reason.
            console.error(
              'Failed to get book data:',
              results[2].status === 'rejected' ? results[2].reason : 'unknown'
            );
          }
        } else {
          setPreviousTextId(null);
          setNextTextId(null);
        }

        // Process result 3: sentence progress
        if (results[3].status === 'fulfilled' && results[3].value) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const sentenceProgress = results[3].value as { lastSegmentIndex?: number; creditedSegmentIndices?: number[] };
          const initialIndex = Math.max(0, sentenceProgress?.lastSegmentIndex || 0);
          setCurrentSegmentIndex(initialIndex);
          setCreditedSegmentIndices(sentenceProgress?.creditedSegmentIndices || []);
        } else {
          if (results[3].status === 'rejected') {
            console.error('Failed to fetch sentence progress:', results[3].reason);
          }
          setCreditedSegmentIndices([]);
          setCurrentSegmentIndex(0);
        }
        setSentenceProgressLoaded(true);
      } catch (err: unknown) {
        if (isCurrentRequest()) setError((err as Error)?.message || 'Failed to load text');
      }
      finally {
        if (isCurrentRequest()) setLoading(false);
      }
    };
    fetchText();

    return () => {
      cancelled = true;
      clearWordLinkingPoll();
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textId, fetchAllLanguageWords]); // 'text' and 'isAudioLesson' are intentionally omitted to prevent loops; cleanup captures correct 'text' via closure.

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [languageWordsLoaded, text, globalSettings.autoTranslateOnOpen]);

  // Audio Time Update Handler - updates ref and checks for line changes
  // Audio Time Update Handler - NOW STABLE (using refs)
  const handleAudioTimeUpdate = useCallback((newTime: number) => {
    // Read latest state from ref
    const { isAudioLesson, srtLines, displayMode, currentSrtLineId, isSentenceMode, currentSegmentIndex, isMobile, listRef: currentListRef } = handleAudioTimeUpdateStateRef.current;

    audioCurrentTimeRef.current = newTime;

    // Only check for line changes if we're in audio mode with SRT lines
    if (!isAudioLesson || srtLines.length === 0 || displayMode !== 'audio') {
      if (currentSrtLineId !== null) setCurrentSrtLineId(null);
      return;
    }

    const currentLineIndex = findSrtLineIndex(srtLines, newTime);
    const currentLine = currentLineIndex !== -1 ? srtLines[currentLineIndex] : null;

    if (isSentenceMode && currentLineIndex !== -1 && currentLineIndex !== currentSegmentIndex) {
      audioDrivenSentenceSyncRef.current = true;
      setCurrentSegmentIndex(currentLineIndex);
    }

    // Only trigger re-render if the line ID actually changed
    if (currentLine && currentLine.id !== currentSrtLineId) {
      setCurrentSrtLineId(currentLine.id);

      // Handle scrolling
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
      autoScrollRafRef.current = requestAnimationFrame(() => {
        if (!isMobile && currentListRef?.current && currentLineIndex !== -1) {
          currentListRef.current.scrollToItem(currentLineIndex, 'center');
          return;
        }
        if (isMobile) {
          const lineElement = document.getElementById(`srt-line-${currentLine.id}`);
          if (!lineElement) return;
          const rect = lineElement.getBoundingClientRect();
          const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

          // Tighten bounds to keep line in the upper-middle of the screen
          // Good reading position is usually around 30-40% from top
          const upperBound = viewportHeight * 0.3;
          const lowerBound = viewportHeight * 0.6;

          if (rect.top < upperBound || rect.bottom > lowerBound) {
            lineElement.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      });
    } else if (!currentLine && currentSrtLineId !== null) {
      setCurrentSrtLineId(null);
    }
  }, []); // Empty dependency array = STABLE CALLBACK IDENTITY

  // Cleanup for auto-scroll animation frame
  useEffect(() => {
    return () => {
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current);
      }
    };
  }, []);

  // Resizable Panel
  // Removed useEffect for drag-to-resize functionality

  // --- Keyboard Shortcuts ---

  useEffect(() => { // 1-5 keys
    const handleKeyDown = async (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || event.ctrlKey || event.altKey || event.metaKey) return;
      if (hoveredWordTerm && !processingWord && !isTranslating) {
        const key = parseInt(event.key, 10);
        if (key >= 1 && key <= 5) {
          event.preventDefault();
          const wordData = getWordData(hoveredWordTerm);
          if (wordData) {
            // If translation is missing, fetch it first
            let translationToUse = wordData.translation || '';
            if (!translationToUse && text?.languageCode) {
              try {
                const result = await translateText(hoveredWordTerm, text.languageCode, translationTargetLanguageCode);
                translationToUse = result?.translatedText || '';
              } catch (err) {
                console.error(`[Keyboard Shortcut] Failed to fetch translation for ${hoveredWordTerm}:`, err);
                // Continue with empty translation rather than failing
              }
            }

            updateWord(wordData.wordId, key, translationToUse)
              .then(() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                setWords((prevWords: any[]) => prevWords.map((w: any) => w.wordId === wordData.wordId ? { ...w, status: key, translation: translationToUse } : w));
                if (selectedWord === hoveredWordTerm && displayedWord?.term === hoveredWordTerm) {
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  setDisplayedWord((prev: any) => ({ ...prev, status: key, translation: translationToUse }));
                }
              })
              .catch((err: unknown) => console.error(`[Keyboard Shortcut] Failed update for ${hoveredWordTerm}:`, err));
          } else {
            // Unknown word - fetch translation first, then create
            (async () => {
              let translationToUse = '';
              if (text?.languageCode) {
                try {
                  const result = await translateText(hoveredWordTerm, text.languageCode, translationTargetLanguageCode);
                  translationToUse = result?.translatedText || '';
                } catch (err) {
                  console.error(`[Keyboard Shortcut] Failed to fetch translation for ${hoveredWordTerm}:`, err);
                  // Continue with empty translation rather than failing
                }
              }
              const sentenceToMine = currentSentenceSegment?.text;
              if (text?.textId == null) return;
              createWord(text.textId, hoveredWordTerm, key, translationToUse, sentenceToMine)
                .then(newWordData => {
                  // Update newWordData with the translation we fetched (if backend didn't return it)
                  const typed = newWordData as { translation?: string } | null;
                  const wordWithTranslation = { ...(typed || {}), translation: translationToUse || typed?.translation };
                  setWords(prevWords => [...prevWords, wordWithTranslation]);
                  // Still trigger auto-translate if enabled and we didn't get a translation
                  if (globalSettings.autoTranslateWords && !translationToUse) triggerAutoTranslation(hoveredWordTerm);
                })
                .catch(err => console.error(`[Keyboard Shortcut] Failed to create word ${hoveredWordTerm}:`, err));
            })();
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredWordTerm, processingWord, isTranslating, getWordData, setWords, selectedWord, displayedWord, text?.textId, text?.languageCode, currentSentenceSegment?.text, globalSettings.autoTranslateWords, triggerAutoTranslation, translationTargetLanguageCode]); // Use globalSettings
  // --- End Keyboard Shortcuts ---

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
      if (isNaN(numericStatus) || numericStatus < 1 || numericStatus > 5) throw new Error(`Invalid status: ${status}.`);
      const existingWord = getWordData(selectedWord);
      if (existingWord) {
        await updateWord(existingWord.wordId, numericStatus, translation);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updatedWords = words.map((w: any) => w.wordId === existingWord.wordId ? { ...w, status: numericStatus, translation } : w);
        setWords(updatedWords);
        setDisplayedWord((prev: any) => (prev?.term === selectedWord ? { ...prev, status: numericStatus, translation } : prev));
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setWords((prevWords: any[]) => prevWords.filter((w: any) => w.wordId !== wordToDelete.wordId));
      setDisplayedWord((prev: any) => (
        prev?.wordId === wordToDelete.wordId
          ? { term: wordToDelete.term, status: 0, translation: '', isNew: true }
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

  // Handler for saving translation via Enter key (Moved after handleSaveWord)
  const handleTranslationKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent newline in textarea
      if (displayedWord) {
        // Determine the status to save (current status, or 1 if untracked)
        const statusToSave = displayedWord.status > 0 ? displayedWord.status : 1;
        handleSaveWord(statusToSave); // handleSaveWord is now defined before this
      } else {
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const unknownWords = uniqueWordsInText.filter((word: string) => !wordsMap.has(word) || ((wordsMap.get(word) as any)?.status <= 2 && !(wordsMap.get(word) as any)?.translation));
      if (unknownWords.length === 0) { if (!silent) alert("No words found needing translation."); setTranslatingUnknown(false); return; } // Exit early
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const wordsMap = new Map(words.map((w: any) => [w.term.toLowerCase(), w]));
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
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        setStats(textStats as Record<string, any> | null); // Use the stats returned from completeText
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentSentenceElements: any[] = [];
    let sentenceIndex = startingSentenceIndex;
    const sentenceEndRegex = /^[.!?…]$/;
    const whitespaceRegex = /^\s+$/;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    processedElements.forEach((element: any, idx: number) => {
      currentSentenceElements.push(element);

      let isEndOfSentence = false;
      if (element.type === React.Fragment && element.props.children) {
        const content = String(element.props.children).trim();
        if (sentenceEndRegex.test(content)) {
          const nextElement = processedElements[idx + 1];
          if (!nextElement || (nextElement.type === React.Fragment && whitespaceRegex.test(String(nextElement.props.children)))) {
            isEndOfSentence = true;
          }
        }
      }

      if (isEndOfSentence || idx === processedElements.length - 1) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (currentSentenceElements.some((el: any) => el.type !== React.Fragment || !whitespaceRegex.test(String(el.props.children)))) {
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
                <WordInfoPanel
                  displayedWord={displayedWord}
                  saveSuccess={saveSuccess}
                  translation={translation}
                  setTranslation={setTranslation}
                  handleTranslationKeyDown={handleTranslationKeyDown}
                  isTranslating={isTranslating}
                  wordTranslationError={wordTranslationError}
                  handleSaveWord={handleSaveWord}
                  processingWord={processingWord}
                  selectedWord={selectedWord}
                  languageConfig={languageConfig}
                  setEmbeddedUrl={setEmbeddedUrl}
                  sentenceTtsEnabled={sentenceTtsEnabled}
                  canUseSentenceTts={canUseSentenceTts}
                  isSpeakingWord={isSpeakingWord}
                  onSpeakWord={speakDisplayedWord}
                  handleMineSentence={handleMineSentence}
                  onReadingCredit={async (wordId) => {
                    try {
                      const res = (await applySrsReadingCredit(wordId)) as { applied?: boolean; message?: string } | null;
                      if (res?.applied) alert('SRS reading credit applied!');
                      else alert(res?.message || 'Credit not applied.');
                    } catch (err) {
                      console.error('Reading credit failed:', err);
                    }
                  }}
                  onRetranslateWithContext={() => {
                    if (!displayedWord?.term) return;
                    triggerAutoTranslation(displayedWord.term, {
                      sentenceContext: wordInfoRetranslateContext,
                      force: true,
                    });
                  }}
                  canRetranslate={!!displayedWord?.term && !!wordInfoRetranslateContext}
                  onAddTranslationWithContext={() => {
                    if (!displayedWord?.term) return;
                    appendAutoTranslation(displayedWord.term, {
                      sentenceContext: wordInfoRetranslateContext,
                    });
                  }}
                  canAddTranslation={!!displayedWord?.term && !!wordInfoRetranslateContext}
                  onDeleteWord={handleDeleteWord}
                  isSentenceBookmarked={isBookmarked(currentSegmentIndex)}
                  onToggleBookmark={handleToggleBookmarkForCurrentSentence}
                />
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
              <WordInfoPanel
                displayedWord={displayedWord}
                saveSuccess={saveSuccess}
                translation={translation}
                setTranslation={setTranslation}
                handleTranslationKeyDown={handleTranslationKeyDown}
                isTranslating={isTranslating}
                wordTranslationError={wordTranslationError}
                handleSaveWord={handleSaveWord}
                processingWord={processingWord}
                selectedWord={selectedWord}
                languageConfig={languageConfig}
                setEmbeddedUrl={setEmbeddedUrl}
                sentenceTtsEnabled={sentenceTtsEnabled}
                canUseSentenceTts={canUseSentenceTts}
                isSpeakingWord={isSpeakingWord}
                onSpeakWord={speakDisplayedWord}
                handleMineSentence={handleMineSentence}
                onReadingCredit={async (wordId) => {
                  try {
                    const res = (await applySrsReadingCredit(wordId)) as { applied?: boolean; message?: string } | null;
                    if (res?.applied) alert('SRS reading credit applied!');
                    else alert(res?.message || 'Credit not applied.');
                  } catch (err) {
                    console.error('Reading credit failed:', err);
                  }
                }}
                onRetranslateWithContext={() => {
                  if (!displayedWord?.term) return;
                  triggerAutoTranslation(displayedWord.term, {
                    sentenceContext: wordInfoRetranslateContext,
                    force: true,
                  });
                }}
                canRetranslate={!!displayedWord?.term && !!wordInfoRetranslateContext}
                onAddTranslationWithContext={() => {
                  if (!displayedWord?.term) return;
                  appendAutoTranslation(displayedWord.term, {
                    sentenceContext: wordInfoRetranslateContext,
                  });
                }}
                canAddTranslation={!!displayedWord?.term && !!wordInfoRetranslateContext}
                onDeleteWord={handleDeleteWord}
                isSentenceBookmarked={isBookmarked(currentSegmentIndex)}
                onToggleBookmark={handleToggleBookmarkForCurrentSentence}
              />
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
