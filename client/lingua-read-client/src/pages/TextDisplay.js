import React, { useEffect, useState, useCallback, useRef, useMemo, useContext } from 'react'; // Added useContext
import { Container, Card, Spinner, Alert, Button, Modal, Form, Row, Col, Badge, ProgressBar, OverlayTrigger, Tooltip, ButtonGroup } from 'react-bootstrap';
import { useParams, useNavigate } from 'react-router-dom'; // Removed unused Link import
import { FixedSizeList as List } from 'react-window';
import {
  getText, createWord, updateWord, updateLastRead, completeLesson, getBook, // Use completeLesson instead of completeText
  translateText, /*translateSentence,*/ translateFullText, updateUserSettings, // Added updateUserSettings, removed unused getUserSettings
  batchTranslateWords, addTermsBatch, getLanguage, // Added getLanguage (Phase 3)
  API_URL,
  getAudioLessonProgress, updateAudioLessonProgress // Added audio lesson progress API functions
} from '../utils/api';
import TranslationPopup from '../components/TranslationPopup';
import AudiobookPlayer from '../components/AudiobookPlayer'; // Import AudiobookPlayer
import './TextDisplay.css';
import { SettingsContext } from '../contexts/SettingsContext'; // Import SettingsContext
import { getBookmarkedSentences, toggleBookmark } from '../utils/bookmarks'; // Import bookmark utils

// --- SRT Parsing Utilities ---
const parseSrtTime = (timeString) => {
  if (!timeString) return 0;
  const parts = timeString.split(':');
  const secondsParts = parts[2]?.split(',');
  if (!secondsParts || secondsParts.length < 2) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parseInt(secondsParts[0], 10);
  const milliseconds = parseInt(secondsParts[1], 10);
  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds) || isNaN(milliseconds)) return 0;
  return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
};

const parseSrtContent = (srtContent) => {
  if (!srtContent) return [];
  const lines = srtContent.trim().split(/\r?\n/);
  const entries = [];
  let currentEntry = null;
  let textBuffer = [];
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (currentEntry === null) {
      if (/^\d+$/.test(trimmedLine)) {
        currentEntry = { id: parseInt(trimmedLine, 10), startTime: 0, endTime: 0, text: '' };
        textBuffer = [];
      }
    } else if (currentEntry.startTime === 0 && trimmedLine.includes('-->')) {
      const timeParts = trimmedLine.split(' --> ');
      if (timeParts.length === 2) {
        currentEntry.startTime = parseSrtTime(timeParts[0]);
        currentEntry.endTime = parseSrtTime(timeParts[1]);
      }
    } else if (trimmedLine === '') {
       if (currentEntry && currentEntry.startTime >= 0 && textBuffer.length > 0) { // Allow 0 start time
           currentEntry.text = textBuffer.join(' ').trim();
           entries.push(currentEntry);
           currentEntry = null;
           textBuffer = [];
       } else if (currentEntry && currentEntry.startTime >= 0) {
           currentEntry.text = '';
           entries.push(currentEntry);
           currentEntry = null;
           textBuffer = [];
       }
    } else if (currentEntry) {
      textBuffer.push(trimmedLine);
    }
  }
  if (currentEntry && currentEntry.startTime >= 0 && textBuffer.length > 0) {
    currentEntry.text = textBuffer.join(' ').trim();
    entries.push(currentEntry);
  }
  console.log(`[SRT Parser] Parsed ${entries.length} entries.`);
  return entries;
};
// --- End SRT Parsing Utilities ---

// --- Styles ---
const styles = {
  highlightedWord: { cursor: 'pointer', padding: '0 2px', margin: '0 1px', borderRadius: '3px', transition: 'all 0.2s ease' },
  wordStatus1: { color: '#000', backgroundColor: '#ff6666' }, // New (red)
  wordStatus2: { color: '#000', backgroundColor: '#ff9933' }, // Learning (orange)
  wordStatus3: { color: '#000', backgroundColor: '#ffdd66' }, // Familiar (yellow)
  wordStatus4: { color: '#000', backgroundColor: '#99dd66' }, // Advanced (light green)
  wordStatus5: { color: 'inherit', backgroundColor: 'transparent' }, // Known - no highlighting
  selectedSentence: { backgroundColor: 'rgba(0, 123, 255, 0.1)', padding: '0.25rem', borderRadius: '0.25rem', border: '1px dashed rgba(0, 123, 255, 0.5)' },
  untrackedWord: { cursor: 'pointer', color: '#007bff', textDecoration: 'underline' },
  textContainer: { height: 'calc(100vh - 120px)', overflowY: 'auto', padding: '15px', borderRight: '1px solid #eee' },
  translationPanel: { height: 'calc(100vh - 120px)', padding: '15px' },
  wordPanel: { marginTop: '20px', padding: '15px', backgroundColor: '#f8f9fa', borderRadius: '8px' },
  modalHeader: { backgroundColor: '#f8f9fa', borderBottom: '1px solid #dee2e6' }
};
// --- End Styles ---


// --- Transcript Line Component for React Window ---
// Defined outside TextDisplay as it doesn't need access to its state directly, props come via itemData
const TranscriptLine = React.memo(({ index, style, data }) => {
  const {
    lines, currentLineId, processLineContent, handleLineClick, getFontStyling, currentLineSpacing // Added currentLineSpacing
  } = data;
  const line = lines[index];
  if (!line) return null;

  return (
    <div style={style}>
      <p
        id={`srt-line-${line.id}`}
        className={`srt-line ${line.id === currentLineId ? 'active-srt-line' : ''}`}
        style={{
          ...getFontStyling(currentLineSpacing), // Call with currentLineSpacing
          marginBottom: '0.8rem',
          padding: '0.3rem 0.5rem',
          borderRadius: '4px',
          transition: 'background-color 0.3s ease',
          /* backgroundColor removed to allow CSS file to control it */
          cursor: 'pointer',
          margin: 0
        }}
        onClick={() => handleLineClick(line.startTime)}
      >
        {processLineContent(line.text)}
      </p>
    </div>
  );
});
// --- End Transcript Line Component ---


const TextDisplay = () => {
  const { textId } = useParams();
  const navigate = useNavigate();
  const textContentRef = useRef(null);
  const audioRef = useRef(null);
  const listRef = useRef(null);
  // Removed resizeDividerRef
  const lastSaveTimeRef = useRef(Date.now()); // Ref for throttling position saves
  const saveInterval = 5000; // Save position every 5 seconds
  const startTimeRef = useRef(null); // Ref for tracking listening start time
  const accumulatedDurationRef = useRef(0); // Ref for tracking total listening duration in ms for the session

  // --- State Declarations ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState(null);
  const [book, setBook] = useState(null);
  const [words, setWords] = useState([]);
  const [selectedWord, setSelectedWord] = useState('');
  const [hoveredWordTerm, setHoveredWordTerm] = useState(null);
  const [translation, setTranslation] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const [processingWord, setProcessingWord] = useState(false);
  const [displayedWord, setDisplayedWord] = useState(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [wordTranslationError, setWordTranslationError] = useState('');
  const [translatingUnknown, setTranslatingUnknown] = useState(false);
  const [translateUnknownError, setTranslateUnknownError] = useState('');
  const [isMarkingAll, setIsMarkingAll] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [stats, setStats] = useState(null);
  const [showStatsModal, setShowStatsModal] = useState(false);
  const [nextTextId, setNextTextId] = useState(null);
  const [showTranslationPopup, setShowTranslationPopup] = useState(false);
  const [fullTextTranslation, setFullTextTranslation] = useState('');
  const [isFullTextTranslating, setIsFullTextTranslating] = useState(false);
  // Use SettingsContext instead of local state for settings that are now global
  const { settings: globalSettings, updateSetting } = useContext(SettingsContext);
  // Local state only for panel width, as it's specific to this component's layout control
  const [leftPanelWidth, setLeftPanelWidth] = useState(globalSettings.leftPanelWidth || 85);
  // Local state for userSettings specific to TextDisplay (like textSize) if needed, or use globalSettings directly
  // For simplicity, let's assume textSize is also managed globally via context now.
  // If TextDisplay needs its own independent textSize, keep a local state for it.
  // Let's use globalSettings directly for textSize for now.
  // Removed isDragging state
  const [isAudioLesson, setIsAudioLesson] = useState(false);
  const [audioSrc, setAudioSrc] = useState(null);
  const [srtLines, setSrtLines] = useState([]);
  const [currentSrtLineId, setCurrentSrtLineId] = useState(null);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [displayMode, setDisplayMode] = useState('audio');
  const [initialAudioTime, setInitialAudioTime] = useState(null); // State for restored time
  const [playbackRate, setPlaybackRate] = useState(1.0); // State for playback speed
  const [languageConfig, setLanguageConfig] = useState(null); // State for language settings (Phase 3)
  const [embeddedUrl, setEmbeddedUrl] = useState(null); // State for embedded dictionary iframe URL (Phase 3)
  const [bookmarkedIndices, setBookmarkedIndices] = useState([]); // State for bookmarked sentence indices
  // --- End State Declarations ---

  // --- Effects ---
  useEffect(() => {
    console.log('[TextDisplay] globalSettings.lineSpacing updated:', globalSettings.lineSpacing);
  }, [globalSettings.lineSpacing]);
  // --- End Effects ---

  // --- Helper Functions & Memoized Values (Define BEFORE useEffects that use them) ---

  const handleLineSpacingChange = (newSpacing) => {
    const numericSpacing = parseFloat(newSpacing);
    if (!isNaN(numericSpacing)) {
      updateSetting('lineSpacing', numericSpacing); // Update context
      localStorage.setItem('lineSpacing', numericSpacing.toString()); // Persist to localStorage
      document.body.style.setProperty('--reading-line-height', numericSpacing.toString()); // Apply immediately
    }
  };

  const fetchAllLanguageWords = useCallback(async (languageId) => {
    if (!languageId) return; // Guard against missing languageId
    try {
      // Corrected URL construction: Removed redundant '/api' prefix
      const response = await fetch(`${API_URL}/words/language/${languageId}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}`, 'Accept': 'application/json' }
      });
      if (!response.ok) throw new Error('Failed to fetch language words');
      const allLanguageWords = await response.json();
      // Replace the entire words state with the newly fetched data
      setWords(allLanguageWords);
      console.log(`[fetchAllLanguageWords] Replaced words state with ${allLanguageWords.length} words from backend.`);
    } catch (error) { console.error('Error fetching language words:', error); }
  }, [setWords]); // Dependency: setWords

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getWordData = useCallback((word) => {
    if (!word) return null;
    const wordLower = word.toLowerCase();
    return words.find(w => w.term && w.term.toLowerCase() === wordLower) || null;
  }, [words]);

  const getWordStyle = useCallback((wordStatus) => {
    const baseStyle = { cursor: 'pointer', padding: '2px 0', margin: '0 2px', borderRadius: '3px', transition: 'all 0.2s' };
    // Use globalSettings from context
    if (!globalSettings?.highlightKnownWords && wordStatus === 5) return { ...baseStyle, backgroundColor: 'transparent', color: 'inherit' };
    if (wordStatus === 5) return { ...baseStyle, backgroundColor: 'transparent', color: 'inherit' };
    const statusStyles = {
      0: { backgroundColor: 'var(--status-0-color, #e0e0e0)', color: '#000' },
      1: { backgroundColor: 'var(--status-1-color, #ff6666)', color: '#000' },
      2: { backgroundColor: 'var(--status-2-color, #ff9933)', color: '#000' },
      3: { backgroundColor: 'var(--status-3-color, #ffdd66)', color: '#000' },
      4: { backgroundColor: 'var(--status-4-color, #99dd66)', color: '#000' },
    };
    return { ...baseStyle, ...(statusStyles[wordStatus] || statusStyles[0]) };
  }, [globalSettings?.highlightKnownWords]); // Use globalSettings from context

  const triggerAutoTranslation = useCallback(async (termToTranslate) => {
    // Use globalSettings from context
    if (!termToTranslate || !globalSettings.autoTranslateWords || !text?.languageCode) return;
    setIsTranslating(true);
    setWordTranslationError('');
    try {
      const result = await translateText(termToTranslate, text.languageCode, 'EN');
      if (result?.translatedText) {
        setTranslation(result.translatedText);
        setDisplayedWord(prev => (prev && prev.term === termToTranslate ? { ...prev, translation: result.translatedText } : prev));
      } else {
        setWordTranslationError('Translation not found.');
      }
    } catch (err) {
      console.error('Auto-translation failed:', err);
      setWordTranslationError(`Translation failed: ${err.message}`);
    } finally {
      setIsTranslating(false);
    }
  }, [globalSettings.autoTranslateWords, text?.languageCode, setTranslation, setDisplayedWord, setIsTranslating, setWordTranslationError]); // Use globalSettings from context

  const handleWordClick = useCallback((word) => {
    setSelectedWord(word);
    setProcessingWord(false);
    setWordTranslationError('');
    const existingWord = getWordData(word);
    if (existingWord) {
      setDisplayedWord(existingWord);
      setTranslation(existingWord.translation || '');
      if (!existingWord.translation) triggerAutoTranslation(word);
    } else {
      const newWord = { term: word, status: 0, translation: '', isNew: true };
      setDisplayedWord(newWord);
      setTranslation('');
      triggerAutoTranslation(word);
    }
  }, [getWordData, triggerAutoTranslation, setSelectedWord, setTranslation, setWordTranslationError, setDisplayedWord]); // Dependencies using globalSettings don't need it listed if context handles updates

  // Removed handleTextSelection as selection is now handled by onMouseUp on the container

  // --- New Word-Granularity Selection Logic ---
  const handleWordSelection = useCallback(() => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !textContentRef.current || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const container = textContentRef.current;

    // Ensure the selection is within the text container
    if (!container.contains(range.commonAncestorContainer)) {
        // Optionally clear selection if it's outside? Or just ignore.
        // selection.removeAllRanges();
        return;
    }

    let startNode = range.startContainer;
    let endNode = range.endContainer;
    let startOffset = range.startOffset;
    let endOffset = range.endOffset;

    // Helper function to find the nearest ancestor word span
    const findWordSpan = (node) => {
        while (node && node !== container) {
            if (node.nodeType === Node.ELEMENT_NODE && node.classList.contains('clickable-word')) {
                return node;
            }
            node = node.parentNode;
        }
        return null;
    };

    // Helper function to find the word span containing or immediately preceding/following a text node offset
     const findWordSpanNearText = (node, offset, lookForward) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
             // If the node itself is a word span
             if (node.classList.contains('clickable-word')) return node;
             // If offset points to a child node, check that child
             const childNode = node.childNodes[offset];
             if (childNode) return findWordSpan(childNode);
        }

        // If it's a text node or offset is within a text node
        let current = node;
        while (current && current !== container) {
            if (current.nodeType === Node.ELEMENT_NODE && current.classList.contains('clickable-word')) {
                return current; // Found ancestor word span
            }
            // Move to sibling or parent
            const sibling = lookForward ? current.nextSibling : current.previousSibling;
            if (sibling) {
                current = sibling;
                // If moving to a sibling element, check its children (especially if looking backward)
                 if (current.nodeType === Node.ELEMENT_NODE) {
                    let innerNode = lookForward ? current.firstChild : current.lastChild;
                    while(innerNode) {
                         const word = findWordSpan(innerNode);
                         if(word) return word;
                         innerNode = lookForward ? innerNode.nextSibling : innerNode.previousSibling;
                    }
                 } else { // Text node sibling
                     const word = findWordSpan(current);
                     if(word) return word;
                 }

            } else {
                current = current.parentNode; // Move up if no more siblings
            }
        }
        return null; // No word span found in traversal
    };


    let startWordSpan = findWordSpan(startNode) || findWordSpanNearText(startNode, startOffset, true);
    let endWordSpan = findWordSpan(endNode) || findWordSpanNearText(endNode, endOffset, false);

    // If selection starts/ends outside any word span, maybe abort
    if (!startWordSpan || !endWordSpan) {
         console.warn("Selection boundary outside clickable words.");
         // Optionally clear selection or do nothing
         // selection.removeAllRanges();
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

        // Get the text and trigger lookup (allow a tick for selection update)
        const selectedText = newRange.toString().trim();
        if (selectedText) {
             // Use a slight delay to let the selection update render
             setTimeout(() => {
                handleWordClick(selectedText);
             }, 0);
        }
    } catch (e) {
        console.error("Error adjusting selection range:", e);
        // Fallback or cleanup if range setting fails
        selection.removeAllRanges();
    }

  }, [handleWordClick, textContentRef]); // Added textContentRef dependency
  // --- End New Word-Granularity Selection Logic ---


  const processTextContent = useCallback((content) => {
    if (!content) return [];

    // --- Phase 2: Phrase Recognition Logic ---
    // 1. Get known phrases (terms with spaces) and sort longest first
    const knownPhrases = words
      .filter(w => w.term && w.term.includes(' '))
      .sort((a, b) => b.term.length - a.term.length);

    const elements = [];
    let currentIndex = 0;
    let currentKeyIndex = 0;
    const wordPattern = /\p{L}|[']/u; // Match letters and apostrophes for word accumulation

    while (currentIndex < content.length) {
      let phraseMatched = false;

      // 2. Check for known phrase matches at the current position
      for (const phrase of knownPhrases) {
        if (content.substring(currentIndex).startsWith(phrase.term)) {
          const phraseData = phrase; // Already have the data
          const phraseStatus = phraseData.status;
          const phraseTranslation = phraseData.translation;
          const phraseTerm = phraseData.term;

          const phraseSpan = (
            <span
              key={`phrase-${currentKeyIndex++}-${phraseTerm.replace(/\s+/g, '-')}`}
              style={{ ...styles.highlightedWord, ...getWordStyle(phraseStatus) }}
              className={`clickable-word word-status-${phraseStatus}`} // Treat phrase like a word visually/interactively
              onClick={(e) => { e.stopPropagation(); handleWordClick(phraseTerm); }}
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
          break; // Stop checking phrases once the longest match is found
        }
      }

      if (phraseMatched) {
        continue; // Move to the next position in the content
      }

      // 3. If no phrase matched, process the next character(s)
      const char = content[currentIndex];

      // Check if it's the start of a potential word
      if (wordPattern.test(char)) {
        let currentWord = char;
        let wordEndIndex = currentIndex + 1;
        // Accumulate subsequent word characters
        while (wordEndIndex < content.length && wordPattern.test(content[wordEndIndex])) {
          currentWord += content[wordEndIndex];
          wordEndIndex++;
        }

        // Process the accumulated word
        const wordData = getWordData(currentWord);
        const wordStatus = wordData ? wordData.status : 0;
        const wordTranslation = wordData ? wordData.translation : null;

        const wordSpan = (
          <span
            key={`word-${currentKeyIndex++}-${currentWord}`}
            style={{ ...styles.highlightedWord, ...getWordStyle(wordStatus) }}
            className={`clickable-word word-status-${wordStatus}`}
            onClick={(e) => { e.stopPropagation(); handleWordClick(currentWord); }}
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

        currentIndex = wordEndIndex; // Move index past the processed word
      } else {
        // Process non-word character (punctuation, whitespace, etc.)
        elements.push(<React.Fragment key={`sep-${currentKeyIndex++}`}>{char}</React.Fragment>);
        currentIndex++;
      }
    }

    return elements;
    // --- End Phase 2 Logic ---

  }, [words, getWordData, getWordStyle, handleWordClick, setHoveredWordTerm]); // Added 'words' dependency


  const getFontFamilyForList = useCallback(() => {
    switch (globalSettings.textFont) { // Use globalSettings from context
      case 'serif': return "var(--font-family-serif)"; // Use Lora via CSS variable
      case 'sans-serif': return "var(--font-family-sans-serif)"; // Use Inter via CSS variable
      case 'monospace': return "'Courier New', monospace"; // Keep monospace as is
      case 'dyslexic': return "'OpenDyslexic', sans-serif"; // Keep dyslexic font as is
      default: return "var(--font-family-sans-serif)"; // Default to Inter
    }
  }, [globalSettings.textFont]); // Use globalSettings from context

  // Use globalSettings from context
  const getFontStyling = useCallback((currentLineSpacing) => ({ // Added currentLineSpacing parameter
    fontSize: `${globalSettings.textSize}px`,
    fontFamily: getFontFamilyForList(), // Assuming getFontFamilyForList is stable or memoized
    lineHeight: currentLineSpacing // Use the passed-in value directly
  }), [globalSettings.textSize, getFontFamilyForList]); // getFontFamilyForList already depends on textFont

  const handleLineClick = useCallback((startTime) => {
      console.log(`[handleLineClick] Attempting seek to: ${startTime} (Type: ${typeof startTime})`);
      if (audioRef.current) {
          console.log(`[handleLineClick] audioRef found. Current time before seek: ${audioRef.current.currentTime}`);
          audioRef.current.currentTime = startTime;
          setTimeout(() => {
             if(audioRef.current) { console.log(`[handleLineClick] audioRef current time after seek attempt: ${audioRef.current.currentTime}`); }
          }, 0);
      } else {
          console.log('[handleLineClick] audioRef.current is null!');
      }
  }, []);

  const itemData = useMemo(() => ({
    lines: srtLines,
    currentLineId: currentSrtLineId,
    processLineContent: processTextContent,
    handleLineClick: handleLineClick,
    getFontStyling, // Pass the function as defined in step 1
    currentLineSpacing: globalSettings.lineSpacing // Pass the current lineSpacing value
  }), [
    srtLines,
    currentSrtLineId,
    processTextContent,
    handleLineClick,
    getFontStyling,
    globalSettings.lineSpacing // CRITICAL: itemData must update when lineSpacing changes
  ]);

  // --- Bookmark Helper Functions ---
  const isBookmarked = useCallback((sentenceIndex) => {
    return bookmarkedIndices.includes(sentenceIndex);
  }, [bookmarkedIndices]);

  const handleSentenceContextMenu = useCallback((event, sentenceIndex) => {
    event.preventDefault(); // Prevent default browser menu
    if (!text?.textId || typeof sentenceIndex !== 'number') return;

    console.log(`[Bookmark] Toggling bookmark for text ${text.textId}, sentence ${sentenceIndex}`);
    toggleBookmark(text.textId, sentenceIndex); // Call the utility

    // Re-fetch bookmarks from storage and update state to trigger UI refresh
    const updatedBookmarks = getBookmarkedSentences(text.textId);
    setBookmarkedIndices(updatedBookmarks);
  }, [text?.textId, setBookmarkedIndices]); // Dependencies: textId and the state setter

  // --- End Bookmark Helper Functions ---

  // --- End Helper Functions & Memoized Values ---


  // --- Effect Hooks ---

  // Removed separate fetchUserSettings effect, handled by SettingsContext

  // Fetch Text Data, Restore Audio Time & Playback Rate
  useEffect(() => {
    // --- Restore Playback Rate ---
    const savedRate = localStorage.getItem('audioPlaybackRate');
    if (savedRate && !isNaN(parseFloat(savedRate))) {
        const rate = parseFloat(savedRate);
        // Clamp rate between 0.5 and 2.0 on load
        setPlaybackRate(Math.max(0.5, Math.min(rate, 2.0)));
        console.log(`[Playback Rate Restore] Restored rate: ${rate}`);
    }
    // --- End Restore Playback Rate ---

    // --- Set initial panel width from global settings ---
    // This ensures panel width resets if global settings change while component is mounted
    setLeftPanelWidth(globalSettings.leftPanelWidth || 85);
    // --- End Set initial panel width ---

    const fetchText = async () => {
      setLoading(true); setError(''); setBook(null); setNextTextId(null); setInitialAudioTime(null); setBookmarkedIndices([]); // Reset bookmarks for new text
      try {
        const data = await getText(textId);
        setText(data);
        setWords(data.words || []);
        if (data.isAudioLesson && data.audioFilePath && data.srtContent) {
          setIsAudioLesson(true);
          // --- DEBUG: Log the path being used ---
          console.log(`[Audio Lesson DEBUG] Setting audio source. data.audioFilePath = "${data.audioFilePath}"`);
          // Correctly set audio source - remove API_URL prefix as it's a direct file path
          const newAudioSrc = `/${data.audioFilePath}`;
          setAudioSrc(newAudioSrc);
          // --- DEBUG: Log after setting src and check if load() needs to be called ---
          console.log(`[Audio Lesson DEBUG] Set audioSrc to: ${newAudioSrc}. Checking audioRef...`);
          // Load call moved to a separate useEffect hook dependent on audioSrc
          // --- END DEBUG ---
          // --- END DEBUG ---
          setSrtLines(parseSrtContent(data.srtContent));
          setDisplayMode('audio');

          // --- Restore Audio Time from Backend ---
          getAudioLessonProgress(textId).then(progress => {
            if (progress && progress.currentPosition != null && progress.currentPosition > 0) {
              console.log(`[Audio Restore - Backend] Restored time: ${progress.currentPosition} for textId: ${textId}`);
              setInitialAudioTime(progress.currentPosition); // Set state to trigger seek on metadata load
            } else {
              console.log(`[Audio Restore - Backend] No progress found or position is 0 for textId: ${textId}.`);
              setInitialAudioTime(0); // Ensure it starts at 0 if no progress
            }
          }).catch(err => {
            console.error("[Audio Restore - Backend] Failed to get audio lesson progress:", err);
            setInitialAudioTime(0); // Start at 0 on error
          });
          // --- End Restore Audio Time ---

        } else {
          setIsAudioLesson(false); setAudioSrc(null); setSrtLines([]); setDisplayMode('text');
        }
        // Fetch all words for the language AND the language configuration itself (Phase 3)
        if (data.languageId) {
           await fetchAllLanguageWords(data.languageId);
           try {
               // Assuming getLanguage exists in api.js from Phase 1/2
               const langConfigData = await getLanguage(data.languageId); // Make sure getLanguage is imported
               setLanguageConfig(langConfigData);
               console.log('[Language Config] Fetched:', langConfigData);
           } catch (langErr) {
               console.error('Failed to fetch language configuration:', langErr);
               setError(prev => `${prev} (Warning: Failed to load language config)`);
               setLanguageConfig(null); // Ensure it's null on error
           }
        } else {
            setLanguageConfig(null); // Reset if no languageId
        }
        if (data.bookId) {
          try {
            await updateLastRead(data.bookId, data.textId);
            const bookData = await getBook(data.bookId);
             setBook(bookData);
            if (bookData?.parts) {
              const currentPartIndex = bookData.parts.findIndex(part => part.textId === parseInt(textId));
              setNextTextId(currentPartIndex >= 0 && currentPartIndex < bookData.parts.length - 1 ? bookData.parts[currentPartIndex + 1].textId : null);
            }
          } catch (bookErr) {
               console.error('Failed to get book data:', bookErr);
               // Don't block text display if book fetch fails, but player won't show
          }
        }
        // Load bookmarks after text is set
        if (data?.textId) {
          const loadedBookmarks = getBookmarkedSentences(data.textId);
          setBookmarkedIndices(loadedBookmarks);
          console.log(`[Bookmarks] Loaded ${loadedBookmarks.length} bookmarks for text ${data.textId}`);
        }
      } catch (err) { setError(err.message || 'Failed to load text'); }
      finally { setLoading(false); }
    };
    fetchText();

    // Store audioRef.current in a variable inside the effect scope
    const currentAudioElement = audioRef.current;

    // Cleanup function to save time and log duration on unmount
    return () => {
      console.log('[TextDisplay Cleanup] Running cleanup function...');
      // Log critical state values *at the time of cleanup*
      console.log(`[TextDisplay Cleanup] State at cleanup: isAudioLesson=${isAudioLesson}, text exists=${!!text}, languageId=${text?.languageId}`);
      try {
        // Save Current Playback Position using the variable captured in the effect scope
        // Save Current Playback Position using the variable captured in the effect scope
        if (currentAudioElement && isAudioLesson) {
          const currentTime = currentAudioElement.currentTime;
          if (currentTime > 0) {
            console.log(`[Audio Save - Unmount] Saving position via API: ${currentTime} for textId: ${textId}`);
            // Use API instead of localStorage
            updateAudioLessonProgress(textId, { currentPosition: currentTime })
              .then(() => console.log(`[Audio Save - Unmount API] Success for textId: ${textId}`))
              .catch(err => console.error(`[Audio Save - Unmount API] Failed for textId: ${textId}:`, err));
          }
        }

        // Log Listening Duration
        if (isAudioLesson && text?.languageId) {
            console.log('[Audio Log - Unmount] Starting duration calculation...');
            console.log(`[Audio Log - Unmount] Accumulated duration (ms): ${accumulatedDurationRef.current}`);
            // --- Calculate final elapsed time if audio was playing on unmount ---
            if (startTimeRef.current) {
                const finalElapsed = Date.now() - startTimeRef.current;
                accumulatedDurationRef.current += finalElapsed;
                console.log(`[Audio Log - Unmount] Added final elapsed time: ${finalElapsed}ms. New Accumulated: ${accumulatedDurationRef.current}ms`);
                startTimeRef.current = null; // Clear ref after calculation
            } else {
                console.log('[Audio Log - Unmount] Audio was paused/ended.');
            }
            // --- Use the final accumulated duration ---
            const finalAccumulatedMs = accumulatedDurationRef.current; // Use the potentially updated value
            const durationInSeconds = Math.round(finalAccumulatedMs / 1000);
            console.log(`[Audio Log - Unmount] Calculated final total duration (s): ${durationInSeconds} for languageId: ${text.languageId}`);

            console.log(`[Audio Log - Unmount] Checking duration threshold (> 5s)... Duration is ${durationInSeconds}s.`);

            if (durationInSeconds > 5) { // Only log if listened for more than 5 seconds
                console.log('[Audio Log - Unmount] Duration > 5s. Preparing API call...');
                const token = localStorage.getItem('token');
                const payload = {
                  languageId: text.languageId,
                  durationSeconds: durationInSeconds
                };
                console.log('[Audio Log - Unmount] API Payload:', payload);
                console.log('[Audio Log - Unmount] Making fetch call to logListening...');
                fetch(`${API_URL}/activity/logListening`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}`
                    },
                    body: JSON.stringify(payload)
                })
                .then(response => {
                    if (!response.ok) {
                        console.error('[Audio Log - Unmount] API call failed:', response.statusText);
                    } else {
                        console.log('[Audio Log - Unmount] API call successful.');
                    }
                })
                .catch(error => {
                    console.error('[Audio Log - Unmount] API call error:', error);
                });
            } else {
                console.log('[Audio Log - Unmount] Duration <= 5s. Skipping API call.');
            }
        } else {
             console.log('[Audio Log - Unmount] Skipping duration log: Not an audio lesson or no languageId.');
        }
        // Reset refs for safety, although component is unmounting
        accumulatedDurationRef.current = 0;
        startTimeRef.current = null;
        console.log('[TextDisplay Cleanup] Refs reset.');

      } catch (cleanupError) { // Add catch block
          console.error('[TextDisplay Cleanup] Error during cleanup:', cleanupError);
      } finally { // Add finally block
          // Move ref resetting inside finally
          accumulatedDurationRef.current = 0;
          startTimeRef.current = null;
          console.log('[TextDisplay Cleanup] Finished cleanup function and reset refs.');
      }
    }; // End of return function
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textId, fetchAllLanguageWords, isAudioLesson]); // 'text' is intentionally omitted to prevent loops; cleanup captures correct 'text' via closure.


  // Audio Sync & Scroll
  useEffect(() => {
    if (!isAudioLesson || srtLines.length === 0 || displayMode !== 'audio') { setCurrentSrtLineId(null); return; }
    const currentLineIndex = srtLines.findIndex(line => audioCurrentTime >= line.startTime && audioCurrentTime < line.endTime);
    const currentLine = currentLineIndex !== -1 ? srtLines[currentLineIndex] : null;
    if (currentLine && currentLine.id !== currentSrtLineId) {
      setCurrentSrtLineId(currentLine.id);
      if (listRef.current && currentLineIndex !== -1) {
        setTimeout(() => { if (listRef.current) listRef.current.scrollToItem(currentLineIndex, 'center'); }, 50);
      }
    }
  }, [audioCurrentTime, srtLines, isAudioLesson, currentSrtLineId, displayMode]);

  // Resizable Panel
  // Removed useEffect for drag-to-resize functionality

  // --- Apply Playback Rate ---
  useEffect(() => {
      if (audioRef.current) {
          audioRef.current.playbackRate = playbackRate;
          console.log(`[Playback Rate Apply] Set audio playbackRate to: ${playbackRate}`);
      }
  }, [playbackRate]); // Apply whenever playbackRate state changes
  // --- End Apply Playback Rate ---

  // --- Save Audio Time Periodically ---
  useEffect(() => {
      if (isAudioLesson && audioCurrentTime > 0) { // Only save if playing and valid time
          const now = Date.now();
          if (now - lastSaveTimeRef.current > saveInterval) {
              console.log(`[Audio Save - Throttled API] Saving time: ${audioCurrentTime} for textId: ${textId}`);
              // Use API instead of localStorage
              updateAudioLessonProgress(textId, { currentPosition: audioCurrentTime })
                .then(() => {
                  console.log(`[Audio Save - Throttled API] Success for textId: ${textId}`);
                  lastSaveTimeRef.current = Date.now(); // Update last save time only on success
                })
                .catch(err => console.error(`[Audio Save - Throttled API] Failed for textId: ${textId}:`, err));
          }
      }
  }, [audioCurrentTime, isAudioLesson, textId]); // Depend on time, lesson status, and textId
  // --- End Save Audio Time ---

  // --- Effect to Load Audio Source ---
  // Use useLayoutEffect to ensure ref is attached before running
  React.useLayoutEffect(() => {
    if (isAudioLesson && audioSrc && displayMode === 'audio' && audioRef.current) {
      console.log(`[Audio Load LayoutEffect] Conditions met. audioSrc: ${audioSrc}. Calling load() on audioRef.`);
      audioRef.current.load();
    } else {
      console.log(`[Audio Load LayoutEffect] Skipping load(). isAudioLesson=${isAudioLesson}, audioSrc=${audioSrc}, displayMode=${displayMode}, audioRef exists=${!!audioRef.current}`);
    }
  }, [audioSrc, isAudioLesson, displayMode]);
  // --- End Effect to Load Audio Source ---


  // --- Keyboard Shortcuts ---
  useEffect(() => { // Spacebar
    const handleKeyDown = (event) => {
        // Ignore if typing in an input or textarea
        if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
            return;
        }
        // Toggle play/pause for audio lessons when space is pressed
        if (isAudioLesson && displayMode === 'audio' && event.code === 'Space') {
            event.preventDefault(); // Prevent default space behavior (like scrolling)
            if (audioRef.current) {
                if (audioRef.current.paused) {
                    audioRef.current.play();
                } else {
                    audioRef.current.pause();
                }
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isAudioLesson, displayMode]); // Add dependencies

  useEffect(() => { // 1-5 keys
    const handleKeyDown = (event) => {
      if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA' || event.ctrlKey || event.altKey || event.metaKey) return;
      if (hoveredWordTerm && !processingWord && !isTranslating) {
        const key = parseInt(event.key, 10);
        if (key >= 1 && key <= 5) {
          event.preventDefault();
          const wordData = getWordData(hoveredWordTerm);
          if (wordData) {
            updateWord(wordData.wordId, key, wordData.translation || '')
              .then(() => {
                setWords(prevWords => prevWords.map(w => w.wordId === wordData.wordId ? { ...w, status: key } : w));
                if (selectedWord === hoveredWordTerm && displayedWord?.term === hoveredWordTerm) setDisplayedWord(prev => ({...prev, status: key }));
              })
              .catch(err => console.error(`[Keyboard Shortcut] Failed update for ${hoveredWordTerm}:`, err));
          } else {
             createWord(text.textId, hoveredWordTerm, key, '')
                .then(newWordData => {
                    setWords(prevWords => [...prevWords, newWordData]);
                    if(globalSettings.autoTranslateWords) triggerAutoTranslation(hoveredWordTerm); // Use globalSettings
                })
                .catch(err => console.error(`[Keyboard Shortcut] Failed to create word ${hoveredWordTerm}:`, err));
          }
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [hoveredWordTerm, processingWord, isTranslating, getWordData, setWords, selectedWord, displayedWord, text?.textId, globalSettings.autoTranslateWords, triggerAutoTranslation]); // Use globalSettings
  // --- End Keyboard Shortcuts ---

  // Removed redundant text selection listener useEffect hook
  // Selection is now handled by onMouseUp on the text container div
  // --- End Effect Hooks ---


  // --- Event Handlers ---

   const handleSaveWord = useCallback(async (status) => {
     // Ensure selectedWord is used here, as displayedWord might be slightly different if selection changed rapidly
     const termToSave = selectedWord || displayedWord?.term;
     if (!termToSave || processingWord || isTranslating) {
        console.log(`[handleSaveWord] Aborted: termToSave=${termToSave}, processingWord=${processingWord}, isTranslating=${isTranslating}`); // Added logging
        return;
     }
     setSaveSuccess(false); setProcessingWord(true);
     try {
       const numericStatus = parseInt(status, 10);
       if (isNaN(numericStatus) || numericStatus < 1 || numericStatus > 5) throw new Error(`Invalid status: ${status}.`);
       const existingWord = getWordData(selectedWord);
       if (existingWord) {
         await updateWord(existingWord.wordId, numericStatus, translation);
         const updatedWords = words.map(w => w.wordId === existingWord.wordId ? { ...w, status: numericStatus, translation } : w);
         setWords(updatedWords);
         setDisplayedWord(prev => (prev?.term === selectedWord ? { ...prev, status: numericStatus, translation } : prev));
       } else {
         const newWordData = await createWord(text.textId, selectedWord, numericStatus, translation);
         setWords(prevWords => [...prevWords, newWordData]);
         setDisplayedWord({ ...newWordData, isNew: false });
       }
       setSaveSuccess(true); setTimeout(() => setSaveSuccess(false), 2000);
     } catch (error) { console.error('Error saving word:', error); alert(`Failed to save word: ${error.message}`); }
     finally { setProcessingWord(false); }
  }, [selectedWord, displayedWord, processingWord, isTranslating, translation, text?.textId, words, getWordData, setWords, setDisplayedWord, setSaveSuccess, setProcessingWord]); // createWord/updateWord are module imports (stable); omit to satisfy exhaustive-deps

  // Handler for saving translation via Enter key (Moved after handleSaveWord)
  const handleTranslationKeyDown = useCallback((event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault(); // Prevent newline in textarea
      if (displayedWord) {
        // Determine the status to save (current status, or 1 if untracked)
        const statusToSave = displayedWord.status > 0 ? displayedWord.status : 1;
        console.log(`[Enter Save] Saving word: "${displayedWord.term}", Status: ${statusToSave}, Translation: "${translation}"`); // Added logging
        handleSaveWord(statusToSave); // handleSaveWord is now defined before this
      } else {
         console.log('[Enter Save] No displayedWord, cannot save.'); // Added logging
      }
    }
  }, [displayedWord, handleSaveWord, translation]); // handleSaveWord dependency is now safe

   const handleFullTextTranslation = async () => {
      if (!text || !text.content) return;
      setShowTranslationPopup(true); setIsFullTextTranslating(true); setFullTextTranslation('');
      try {
        const response = await translateFullText(text.content, text.languageCode || 'auto', 'en');
        setFullTextTranslation(response?.translatedText || 'Translation failed.');
      } catch (error) { setFullTextTranslation(`Translation failed: ${error.message}`); }
      finally { setIsFullTextTranslating(false); }
    };

   const handleTranslateUnknownWords = async () => {
      if (!text || !text.content || !text.languageId) return;
      setTranslatingUnknown(true); setTranslateUnknownError('');
      try {
        const wordsRegex = /\p{L}+(['-]\p{L}+)*/gu;
        const textWords = text.content.match(wordsRegex) || [];
        const uniqueWordsInText = [...new Set(textWords.map(w => w.toLowerCase()))];
        const wordsMap = new Map(words.map(w => [w.term.toLowerCase(), w]));
        const unknownWords = uniqueWordsInText.filter(word => !wordsMap.has(word) || (wordsMap.get(word)?.status <= 2 && !wordsMap.get(word)?.translation));
        if (unknownWords.length === 0) { alert("No words found needing translation."); setTranslatingUnknown(false); return; } // Exit early
        const translations = await batchTranslateWords(unknownWords, 'EN', text.languageCode);
        const originalCaseMap = new Map();
        textWords.forEach(w => { const lower = w.toLowerCase(); if (!originalCaseMap.has(lower)) { originalCaseMap.set(lower, w); } });
        const termsToAdd = unknownWords.map(word => ({
          term: originalCaseMap.get(word) || word,
          translation: translations[word.toLowerCase()] || ''
        })).filter(t => t.translation);

        if (termsToAdd.length === 0) { alert("No translations received."); setTranslatingUnknown(false); return; } // Exit early

        // Two-step workflow: first fetch translations, then save terms+translations
        try {
          await addTermsBatch(text.languageId, termsToAdd);
        } catch (saveError) {
          console.error("Error saving translated terms:", saveError);
          setTranslateUnknownError(`Failed to save terms: ${saveError.message}`);
          alert(`Error saving terms: ${saveError.message}`);
          setTranslatingUnknown(false);
          return;
        }
        await fetchAllLanguageWords(text.languageId);
        alert(`Successfully translated and updated ${termsToAdd.length} words.`);
      } catch (err) { console.error("Error translating unknown words:", err); setTranslateUnknownError(`Failed: ${err.message}`); alert(`Error: ${err.message}`); }
      finally { setTranslatingUnknown(false); }
    };

   const handleMarkAllUnknownAsKnown = async () => {
      if (!text || !text.content || !text.languageId || !text.textId) return;
      setIsMarkingAll(true); setError('');
      try {
        const wordsRegex = /\p{L}+(['-]\p{L}+)*/gu;
        const textWords = text.content.match(wordsRegex) || [];
        const uniqueWordsInText = [...new Set(textWords.map(w => w.toLowerCase()))];
        const wordsMap = new Map(words.map(w => [w.term.toLowerCase(), w]));
        const unknownWords = uniqueWordsInText.filter(word => !wordsMap.has(word));
        if (unknownWords.length === 0) { alert("No untracked words found."); setIsMarkingAll(false); return; } // Exit early
        const originalCaseMap = new Map();
        textWords.forEach(w => { const lower = w.toLowerCase(); if (!originalCaseMap.has(lower)) { originalCaseMap.set(lower, w); } });
        const termsToMark = unknownWords.map(word => ({ term: originalCaseMap.get(word) || word, translation: null }));
        await addTermsBatch(text.languageId, termsToMark);
        await fetchAllLanguageWords(text.languageId);
        alert(`Attempted to mark ${unknownWords.length} words as Known.`);
      } catch (err) { console.error("Error marking all unknown as known:", err); setError(`Failed: ${err.message}`); alert(`Error: ${err.message}`); }
      finally { setIsMarkingAll(false); }
    };

   const handleCompleteLesson = async () => {
      if (!text?.textId) return; // Require at least textId
      setCompleting(true);
      try {
        // Call the correct API endpoint using the imported completeLesson function
        // Pass bookId if available, otherwise null/undefined (handled by completeLesson in api.js)
        const textStats = await completeLesson(text?.bookId, text.textId);
        // If standalone text, always go back to texts page after completion
        if (!text?.bookId) {
            navigate('/texts');
        } else if (globalSettings.autoAdvanceToNextLesson && nextTextId) {
            navigate(`/texts/${nextTextId}`);
        } else if (globalSettings.showProgressStats) {
            setStats(textStats); // Use the stats returned from completeText
            setShowStatsModal(true);
        } else {
            navigate(`/books/${text.bookId}`);
        }
      } catch (error) { alert(`Failed to complete lesson: ${error.message}`); }
      finally { setCompleting(false); }
    };

  // --- New Handler for Audio Metadata Load ---
  const handleAudioMetadataLoaded = () => {
      console.log(`[Audio Metadata] Loaded. Initial time from state: ${initialAudioTime}`);
      // Apply initial playback rate when metadata loads
      if (audioRef.current) {
          audioRef.current.playbackRate = playbackRate;
      }
      // --- DEBUGGING: Log values before attempting seek ---
      console.log(`[Audio Metadata DEBUG] Checking seek condition: audioRef.current exists=${!!audioRef.current}, initialAudioTime=${initialAudioTime}, initialAudioTime > 0=${initialAudioTime > 0}`);

      if (audioRef.current && initialAudioTime !== null && initialAudioTime > 0) {
          // Pause before seeking to ensure correct position is set before play
          audioRef.current.pause();
          console.log(`[Audio Metadata] Paused audio. Current time BEFORE seek: ${audioRef.current.currentTime}`);
          console.log(`[Audio Metadata] Attempting to set current time to: ${initialAudioTime}`);
          audioRef.current.currentTime = initialAudioTime;
          // --- DEBUGGING: Log time immediately after setting ---
          console.log(`[Audio Metadata DEBUG] Current time AFTER seek attempt: ${audioRef.current?.currentTime}`);
          // Optionally, resume playback if desired (uncomment next line if you want auto-play)
          // audioRef.current.play();
          // Reset initial time state after applying it once
          setInitialAudioTime(null);
      } else if (audioRef.current) {
          console.log(`[Audio Metadata] Condition NOT MET for setting initial time. initialAudioTime=${initialAudioTime}. Current time: ${audioRef.current.currentTime}`);
      } else {
          console.log(`[Audio Metadata DEBUG] Condition NOT MET because audioRef.current is null.`);
      }
  };

  // --- Handlers for Playback Speed ---
  const changePlaybackRate = (delta) => {
      setPlaybackRate(prevRate => {
          const newRate = parseFloat((prevRate + delta).toFixed(2));
          const clampedRate = Math.max(0.5, Math.min(newRate, 2.0)); // Clamp between 0.5x and 2.0x
          localStorage.setItem('audioPlaybackRate', clampedRate.toString()); // Save preference
          console.log(`[Playback Rate Change] New rate: ${clampedRate}`);
          return clampedRate;
      });
  };
  // --- End Event Handlers ---

  // --- Audio Play/Pause/End Handlers for Duration Tracking ---
  const handlePlay = () => {
      if (!startTimeRef.current) { // Start timer only if not already started
          startTimeRef.current = Date.now();
          console.log('[Audio Tracking] Play started/resumed. Start time:', startTimeRef.current);
      }
  };

  const handlePauseOrEnd = () => {
      if (startTimeRef.current) {
          const elapsed = Date.now() - startTimeRef.current;
          accumulatedDurationRef.current += elapsed;
          console.log(`[Audio Tracking] Paused/Ended. Elapsed: ${elapsed}ms. Accumulated: ${accumulatedDurationRef.current}ms`);
          startTimeRef.current = null; // Reset start time

          // --- Removed API logging from handlePauseOrEnd ---
          // Logging is now handled only in the main useEffect cleanup function
      }
  };
  // --- End Audio Tracking Handlers ---

  // --- New Sentence Rendering Logic ---
  // Takes processed elements for a block (e.g., paragraph) and a starting index,
  // returns rendered sentence elements and the next sentence index.
  const renderProcessedContentAsSentences = useCallback((processedElements, startingSentenceIndex) => {
    if (!processedElements || processedElements.length === 0) {
      return { sentenceElements: null, nextSentenceIndex: startingSentenceIndex };
    }

    const sentenceElements = [];
    let currentSentenceElements = [];
    let sentenceIndex = startingSentenceIndex;
    const sentenceEndRegex = /^[.!?…]$/;
    const whitespaceRegex = /^\s+$/;

    processedElements.forEach((element, idx) => {
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
        if (currentSentenceElements.some(el => el.type !== React.Fragment || !whitespaceRegex.test(String(el.props.children)))) {
          const currentSentenceIndex = sentenceIndex++;
          sentenceElements.push(
            <span
              key={`sentence-${currentSentenceIndex}`}
              className="sentence"
              data-sentence-index={currentSentenceIndex}
              onContextMenu={(e) => handleSentenceContextMenu(e, currentSentenceIndex)}
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
  }, [handleSentenceContextMenu, isBookmarked]); // Dependencies

  // --- End New Sentence Rendering Logic ---


  // --- Rendering Logic ---
  const renderAudioTranscript = () => {
    if (!srtLines || srtLines.length === 0) return <p className="p-3">Loading transcript...</p>;
    // Calculate itemSize dynamically
    const calculatedItemSize = (globalSettings.textSize * globalSettings.lineSpacing * 1.2) + 10;
    const LIST_HEIGHT = textContentRef.current ? textContentRef.current.clientHeight - 30 : 600;
    return (
      <div className="audio-transcript-container" style={{ padding: '15px 0', height: '100%', overflow: 'hidden' }}>
        <List height={LIST_HEIGHT} itemCount={srtLines.length} itemSize={calculatedItemSize} width="100%" itemData={itemData} overscanCount={5} ref={listRef} style={{ paddingRight: '15px', paddingLeft: '15px' }}>
            {TranscriptLine}
        </List>
      </div>
    );
  };

  const renderStandardText = () => {
    if (!text?.content) return null;
    const paragraphs = text.content.split(/(\n\s*){2,}/g).filter(p => p?.trim().length > 0);
    let currentSentenceIndex = 0; // Track sentence index across paragraphs

    return (
       <div
         className="text-content"
         ref={textContentRef}
         style={{ fontSize: `${globalSettings.textSize}px`, lineHeight: '1.6', fontFamily: getFontFamilyForList() }} // Use globalSettings, removed inline padding
         onMouseUp={handleWordSelection} // Use the new word selection handler
        >
        {paragraphs.map((paragraph, index) => {
          // Process paragraph into elements
          const processedParaElements = processTextContent(paragraph);
          // Render elements as sentences, passing and updating the global sentence index
          const { sentenceElements, nextSentenceIndex } = renderProcessedContentAsSentences(processedParaElements, currentSentenceIndex);
          currentSentenceIndex = nextSentenceIndex; // Update index for the next paragraph

          return (
            <p key={`para-${index}`} className="mb-3" style={{ textIndent: '1.5em' }}>
              {sentenceElements}
            </p>
          );
        })}
      </div>
    );
  };

  const renderSidePanel = () => {
     if (!displayedWord) return <p>Click/hover on a word.</p>;
     return (
        <div>
          <h5 className="fw-bold mb-2">{displayedWord.term}</h5>
          {saveSuccess && <Alert variant="success" size="sm">Saved!</Alert>}
          <p className="mb-1 small">Status: {displayedWord.status > 0 ? ['New','Learning','Familiar','Advanced','Known'][displayedWord.status-1] : 'Untracked'}</p>
          <Form.Control as="textarea" rows={2} value={translation} onChange={(e) => setTranslation(e.target.value)} onKeyDown={handleTranslationKeyDown} placeholder="Translation/Notes (Enter to save)" disabled={isTranslating} size="sm"/>
          {isTranslating && <Spinner size="sm"/>}
          {wordTranslationError && <Alert variant="danger" size="sm">{wordTranslationError}</Alert>}
          <div className="d-flex flex-wrap gap-1 mt-2">
             {[1, 2, 3, 4, 5].map(s => <Button key={s} variant="outline-secondary" size="sm" className="py-0 px-2" onClick={() => handleSaveWord(s)} disabled={processingWord || isTranslating || !selectedWord}>{s}</Button>)}
          </div>

          {/* --- Phase 3: Dictionary Buttons --- */}
          {languageConfig?.dictionaries && selectedWord && (
            <div className="mt-3 pt-2 border-top">
              <h6 className="mb-2 small text-muted">Dictionaries</h6>
              <div className="d-flex flex-wrap gap-1">
                {languageConfig.dictionaries
                  .filter(dict => dict.isActive && dict.purpose === 'terms')
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map(dict => {
                    const handleDictClick = () => {
                      if (!selectedWord) return;
                      const term = encodeURIComponent(selectedWord); // Ensure encoding
                      const url = dict.urlTemplate.replace('###', term);
                      console.log(`[Dictionary] Clicked: ${dict.dictionaryId}, Type: ${dict.displayType}, URL: ${url}`);
                      if (dict.displayType === 'popup') {
                        window.open(url, '_blank', 'noopener,noreferrer');
                        setEmbeddedUrl(null); // Clear any existing embedded view
                      } else if (dict.displayType === 'embedded') {
                        setEmbeddedUrl(url);
                      }
                    };
                    // Attempt to get a simple name from the URL
                    let buttonText = `Dict ${dict.sortOrder}`;
                    try {
                        const urlObj = new URL(dict.urlTemplate);
                        buttonText = urlObj.hostname.replace(/^www\./, '').split('.')[0];
                        buttonText = buttonText.charAt(0).toUpperCase() + buttonText.slice(1);
                    } catch (e) { /* Ignore invalid URL for naming */ }

                    return (
                      <Button key={dict.dictionaryId} variant="outline-info" size="sm" onClick={handleDictClick} title={dict.urlTemplate}>
                        {buttonText}
                      </Button>
                    );
                  })}
              </div>
            </div>
          )}
          {/* --- End Phase 3 --- */}

        </div>
     );
  };
  // --- End Rendering Logic ---
  // --- Loading/Error/NotFound States ---
  if (loading) { return <Container className="py-5 text-center"><Spinner animation="border" /></Container>; }
  if (error) { return <Container className="py-5"><Alert variant="danger">{error}<Button onClick={() => navigate(-1)}>Back</Button></Alert></Container>; }
  if (!text) { return <Container className="py-5"><Alert variant="warning">Text not found<Button onClick={() => navigate('/texts')}>Back</Button></Alert></Container>; }
  // --- End Loading/Error States ---

      // DEBUG: Log isAudioLesson state before rendering
      console.log(`[Render Check] isAudioLesson state: ${isAudioLesson}`);

  // --- Main Return JSX ---
  return (
    <div className="text-display-wrapper px-0 mx-0 w-100">
      {/* Header Card - Add Playback Speed Controls */}
      <Card className="shadow-sm mb-3 border-0 rounded-0">
        <Card.Body className="p-2">
           <div className="d-flex justify-content-between align-items-center flex-wrap">
             <div>
               <h2 className="mb-1">{text.title}</h2>
               <p className="text-muted mb-0 small">Lang: {text.languageName || 'N/A'} | Words: {words.length}</p>
             </div>
             <div className="d-flex gap-2 flex-wrap mt-2 mt-md-0 align-items-center">
               {/* Audiobook Player Integration - ONLY if NOT an audio lesson */}
               {!isAudioLesson && book && book.audiobookTracks && book.audiobookTracks.length > 0 && (
                 <div className="flex-grow-1 mx-2" style={{ minWidth: '450px' }}> {/* Increased minWidth significantly */}
                    <AudiobookPlayer book={book} />
                 </div>
               )}
               {/* Playback Speed Controls */}
               {isAudioLesson && displayMode === 'audio' && (
                 <ButtonGroup size="sm" className="me-1" title={`Playback Speed: ${playbackRate.toFixed(2)}x`}>
                   <Button variant="outline-secondary" onClick={() => changePlaybackRate(-0.05)} disabled={playbackRate <= 0.5}>-</Button>
                   <Button variant="outline-secondary" disabled style={{ minWidth: '45px', textAlign: 'center' }}>{playbackRate.toFixed(2)}x</Button>
                   <Button variant="outline-secondary" onClick={() => changePlaybackRate(0.05)} disabled={playbackRate >= 2.0}>+</Button>
                 </ButtonGroup>
               )}
               {/* Existing Controls */}
               <ButtonGroup size="sm" className="me-1">
                  {/* Update font size via API and context */}
                  <Button variant="outline-secondary" onClick={() => {
                      const newSize = Math.max(12, globalSettings.textSize - 2);
                      console.log('[Save Settings] Saving Text Size via API:', newSize);
                      updateSetting('textSize', newSize); // Update context immediately
                      updateUserSettings({ textSize: newSize }) // Call API
                          .catch(err => console.error('[Save Settings] Failed to save text size via API:', err));
                  }} title="Decrease text size">A-</Button>
                  <Button variant="outline-secondary" onClick={() => {
                      const newSize = Math.min(32, globalSettings.textSize + 2);
                      console.log('[Save Settings] Saving Text Size via API:', newSize);
                      updateSetting('textSize', newSize); // Update context immediately
                      updateUserSettings({ textSize: newSize }) // Call API
                          .catch(err => console.error('[Save Settings] Failed to save text size via API:', err));
                  }} title="Increase text size">A+</Button>
               </ButtonGroup>
               {/* Re-added Panel resize buttons */}
               <ButtonGroup size="sm" className="me-1">
                 <Button variant="outline-secondary" onClick={() => {
                     const newWidth = Math.min(leftPanelWidth + 5, 85); // Increase width, max 85
                     setLeftPanelWidth(newWidth);
                     updateSetting('leftPanelWidth', newWidth); // Update context
                     updateUserSettings({ leftPanelWidth: newWidth }) // Save via API
                         .catch(err => console.error('[Save Settings] Failed to save panel width via API:', err));
                 }} title="Increase reading area (Wider)">◀</Button>
                 <Button variant="outline-secondary" onClick={() => {
                     const newWidth = Math.max(leftPanelWidth - 5, 20); // Decrease width, min 20
                     setLeftPanelWidth(newWidth);
                     updateSetting('leftPanelWidth', newWidth); // Update context
                     updateUserSettings({ leftPanelWidth: newWidth }) // Save via API
                         .catch(err => console.error('[Save Settings] Failed to save panel width via API:', err));
                 }} title="Decrease reading area (Narrower)">▶</Button>
               </ButtonGroup>
{/* Line Spacing Controls */}
               <ButtonGroup size="sm" className="me-1">
                 <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Default (1.5)</Tooltip>}>
                   <Button
                     variant={parseFloat(globalSettings.lineSpacing) === 1.5 ? 'primary' : 'outline-secondary'}
                     onClick={() => handleLineSpacingChange(1.5)}
                     aria-label="Set line spacing to default"
                   >
                     1.5
                   </Button>
                 </OverlayTrigger>
                 <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Relaxed (1.75)</Tooltip>}>
                   <Button
                     variant={parseFloat(globalSettings.lineSpacing) === 1.75 ? 'primary' : 'outline-secondary'}
                     onClick={() => handleLineSpacingChange(1.75)}
                     aria-label="Set line spacing to relaxed"
                   >
                     1.75
                   </Button>
                 </OverlayTrigger>
                 <OverlayTrigger placement="top" overlay={<Tooltip>Line Spacing: Spacious (2.0)</Tooltip>}>
                   <Button
                     variant={parseFloat(globalSettings.lineSpacing) === 2.0 ? 'primary' : 'outline-secondary'}
                     onClick={() => handleLineSpacingChange(2.0)}
                     aria-label="Set line spacing to spacious"
                   >
                     2.0
                   </Button>
                 </OverlayTrigger>
               </ButtonGroup>
               {isAudioLesson && ( <Button variant="outline-info" size="sm" onClick={() => setDisplayMode(p => p === 'audio' ? 'text' : 'audio')} title={displayMode === 'audio' ? 'Text View' : 'Audio View'} className="me-1">{displayMode === 'audio' ? 'Text' : 'Audio'} View</Button> )}
               {text && !loading && ( <Button variant="info" size="sm" onClick={handleFullTextTranslation} className="me-1">Translate Text</Button> )}
               {text && !loading && ( <Button variant="secondary" size="sm" onClick={handleTranslateUnknownWords} disabled={translatingUnknown} className="ms-1" title="Translate unknown/learning words">{translatingUnknown ? <Spinner size="sm"/> : 'Translate ?'}</Button> )}
               {text && !loading && ( <Button variant="outline-success" size="sm" onClick={handleMarkAllUnknownAsKnown} disabled={isMarkingAll} className="ms-1" title="Mark all untracked words as Known">{isMarkingAll ? <Spinner size="sm"/> : 'Mark All Known'}</Button> )}
               {/* Add Complete Lesson button here specifically for Audio Lessons */}
               {/* Show top button ONLY for standalone audio lessons */}
               {isAudioLesson && !text?.bookId && (
                   <Button variant="success" onClick={handleCompleteLesson} disabled={completing} size="sm" className="ms-1">
                       {completing ? <Spinner animation="border" size="sm" /> : (nextTextId === null ? 'Finish Book' : 'Complete Lesson')}
                   </Button>
               )}
               {text?.bookId && ( <Button variant="outline-primary" size="sm" onClick={() => navigate(`/books/${text.bookId}`)} className="ms-1">Back to Book</Button> )}
               {!text?.bookId && ( <Button variant="outline-secondary" size="sm" onClick={() => navigate('/texts')} className="ms-1">Back to Texts</Button> )}
             </div>
           </div>
           {translateUnknownError && <Alert variant="danger" className="mt-1 mb-0 p-1 small">{translateUnknownError}</Alert>}
        </Card.Body>
      </Card>

      {/* Audiobook Player rendering removed from here to fix duplication */}

      {/* Audio Player */}
      {isAudioLesson && audioSrc && displayMode === 'audio' && (
        <div className="audio-player-container p-2 border-bottom theme-aware-audio-player-container">
          <audio
            ref={audioRef}
            controls
            src={audioSrc}
            onTimeUpdate={(e) => setAudioCurrentTime(e.target.currentTime)}
            onLoadedMetadata={handleAudioMetadataLoaded}
            onPlay={handlePlay} // Track play start
            onPause={handlePauseOrEnd} // Track pause
            onEnded={handlePauseOrEnd} // Track end
            style={{ width: '100%' }}
          >
            Your browser does not support the audio element.
          </audio>
        </div>
      )}

      {/* Audiobook Player rendering removed from here to fix duplication */}

      {/* Main Content Area */}
      <div className="resizable-container">
        {/* Left Panel (Reading Area) */}
        <div className="left-panel" style={{ width: `${leftPanelWidth}%`, height: 'calc(100vh - 130px)', overflowY: 'auto', padding: '0', position: 'relative' }}>
           <div className="d-flex flex-column" style={{ minHeight: '100%' }}>
             <div className="flex-grow-1" ref={textContentRef}>
               {isAudioLesson && displayMode === 'audio' ? renderAudioTranscript() : renderStandardText()}
             </div>
             {/* Show bottom button for regular texts OR any text within a book */}
             {(!isAudioLesson || text?.bookId) && (
                <div className="mt-auto pt-2 text-end px-2 pb-2">
                    <Button variant="success" onClick={handleCompleteLesson} disabled={completing} size="sm">
                        {completing ? <Spinner animation="border" size="sm" /> : (nextTextId === null ? 'Finish Book' : 'Complete Lesson')}
                    </Button>
                </div>
             )}
           </div>
        </div>

        {/* Removed Resize Divider */}

        {/* Right Panel (Word Info) */}
        <div className="right-panel" style={{ width: `${100 - leftPanelWidth}%`, height: 'calc(100vh - 130px)', overflowY: 'auto', padding: 'var(--space-sm)', position: 'relative' }}>
           <Card className="border-0 h-100"><Card.Body className="p-2 d-flex flex-column">
             <h5 className="mb-2 flex-shrink-0">Word Info</h5>
             <div className="flex-grow-1" style={{ overflowY: 'auto', paddingBottom: 'var(--space-xs)' }}>{renderSidePanel()}</div>

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
      </div>

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

    </div>
  );
};

export default TextDisplay;
