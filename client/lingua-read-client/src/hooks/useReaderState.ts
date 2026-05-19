import { useEffect, useRef, useState } from 'react';
import {
  getText,
  getTextSrt,
  getWordLinkingStatus,
  getLanguage,
  getBook,
  updateLastRead,
  getSentenceProgress
} from '../utils/api';
import { parseSrtContent } from '../utils/srtParser';
import type { SrtEntry } from '../utils/srtParser';
import type { LanguageConfig } from '../utils/readerText';
import type { Text as TextDto } from '../utils/api/texts';
import type { Book as BookDto } from '../utils/api/books';
import type { Word } from '../utils/api/words';

// Page state often overlays extra fields the OpenAPI spec omits. Keep the
// types loose enough for the augmented runtime shape used by the reader.
export type ReaderText = TextDto & Record<string, unknown>;
export type ReaderBook = BookDto & Record<string, unknown>;

export type FetchAllLanguageWordsFn = (
  languageId: number,
  isCurrentRequest: () => boolean
) => Promise<unknown>;

export type UseReaderStateArgs = {
  textId: string | undefined;
  fetchAllLanguageWordsRef: React.MutableRefObject<FetchAllLanguageWordsFn | null>;
  leftPanelWidthFromSettings: number;
  setLeftPanelWidth: (value: number) => void;
  onSentenceProgressApplied: (
    initialSegmentIndex: number,
    creditedIndices: number[]
  ) => void;
  autoTranslateTriggeredRef: React.MutableRefObject<boolean>;
  autoTranslateTextIdRef: React.MutableRefObject<number | string | null>;
};

export type UseReaderStateResult = {
  loading: boolean;
  setLoading: React.Dispatch<React.SetStateAction<boolean>>;
  error: string;
  setError: React.Dispatch<React.SetStateAction<string>>;
  text: ReaderText | null;
  setText: React.Dispatch<React.SetStateAction<ReaderText | null>>;
  book: ReaderBook | null;
  setBook: React.Dispatch<React.SetStateAction<ReaderBook | null>>;
  words: Word[];
  setWords: React.Dispatch<React.SetStateAction<Word[]>>;
  languageWordsLoaded: boolean;
  setLanguageWordsLoaded: React.Dispatch<React.SetStateAction<boolean>>;
  languageConfig: LanguageConfig | null;
  setLanguageConfig: React.Dispatch<React.SetStateAction<LanguageConfig | null>>;
  embeddedUrl: string | null;
  setEmbeddedUrl: React.Dispatch<React.SetStateAction<string | null>>;
  previousTextId: number | null;
  setPreviousTextId: React.Dispatch<React.SetStateAction<number | null>>;
  nextTextId: number | null;
  setNextTextId: React.Dispatch<React.SetStateAction<number | null>>;
  isAudioLesson: boolean;
  setIsAudioLesson: React.Dispatch<React.SetStateAction<boolean>>;
  displayMode: string;
  setDisplayMode: React.Dispatch<React.SetStateAction<string>>;
  audioSrc: string | null;
  setAudioSrc: React.Dispatch<React.SetStateAction<string | null>>;
  srtLines: SrtEntry[];
  setSrtLines: React.Dispatch<React.SetStateAction<SrtEntry[]>>;
  sentenceProgressLoaded: boolean;
  setSentenceProgressLoaded: React.Dispatch<React.SetStateAction<boolean>>;
};

export const useReaderState = ({
  textId,
  fetchAllLanguageWordsRef,
  leftPanelWidthFromSettings,
  setLeftPanelWidth,
  onSentenceProgressApplied,
  autoTranslateTriggeredRef,
  autoTranslateTextIdRef
}: UseReaderStateArgs): UseReaderStateResult => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState<ReaderText | null>(null);
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [words, setWords] = useState<Word[]>([]);
  const [languageWordsLoaded, setLanguageWordsLoaded] = useState(false);
  const [languageConfig, setLanguageConfig] = useState<LanguageConfig | null>(null);
  const [embeddedUrl, setEmbeddedUrl] = useState<string | null>(null);
  const [previousTextId, setPreviousTextId] = useState<number | null>(null);
  const [nextTextId, setNextTextId] = useState<number | null>(null);
  const [isAudioLesson, setIsAudioLesson] = useState(false);
  const [displayMode, setDisplayMode] = useState('audio');
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [srtLines, setSrtLines] = useState<SrtEntry[]>([]);
  const [sentenceProgressLoaded, setSentenceProgressLoaded] = useState(false);

  const textLoadRequestVersionRef = useRef(0);
  const textRef = useRef<ReaderText | null>(null);
  const isAudioLessonRef = useRef(false);
  const displayModeRef = useRef('audio');

  useEffect(() => {
    textRef.current = text;
  }, [text]);
  useEffect(() => {
    isAudioLessonRef.current = isAudioLesson;
  }, [isAudioLesson]);
  useEffect(() => {
    displayModeRef.current = displayMode;
  }, [displayMode]);

  const stableOnSentenceProgressApplied = useRef(onSentenceProgressApplied);
  stableOnSentenceProgressApplied.current = onSentenceProgressApplied;
  const stableSetLeftPanelWidth = useRef(setLeftPanelWidth);
  stableSetLeftPanelWidth.current = setLeftPanelWidth;

  useEffect(() => {
    const requestVersion = textLoadRequestVersionRef.current + 1;
    textLoadRequestVersionRef.current = requestVersion;
    let cancelled = false;
    let wordLinkingPollInterval: ReturnType<typeof setInterval> | null = null;
    const isCurrentRequest = (): boolean =>
      !cancelled && textLoadRequestVersionRef.current === requestVersion;
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
        const statusData = await getWordLinkingStatus(textId);
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

    stableSetLeftPanelWidth.current(leftPanelWidthFromSettings);

    const fetchText = async () => {
      if (!textId) return;
      const previousText = textRef.current;
      const isSameText = previousText && String(previousText.textId) === String(textId);

      if (!isSameText) {
        setLoading(true);
        setLanguageWordsLoaded(false);
        autoTranslateTriggeredRef.current = false;
        autoTranslateTextIdRef.current = null;
        setError('');
        setBook(null);
        setPreviousTextId(null);
        setNextTextId(null);
        setSentenceProgressLoaded(false);
      }

      try {
        const data = await getText(textId);
        if (!isCurrentRequest()) return;
        setText(data);
        setWords(data.words || []);
        if (data.isAudioLesson && data.audioFilePath && data.hasSrtContent) {
          if (!isAudioLessonRef.current) setIsAudioLesson(true);

          const newAudioSrc = `/${data.audioFilePath}`;
          setAudioSrc(newAudioSrc);

          getTextSrt(textId)
            .then(srtText => {
              if (isCurrentRequest() && srtText) {
                setSrtLines(parseSrtContent(srtText));
              }
            })
            .catch(err => {
              if (isCurrentRequest()) console.error('Failed to load SRT:', err);
            });

          if (displayModeRef.current !== 'audio') setDisplayMode('audio');

          if (data.wordLinkingStatus === 'processing') {
            startWordLinkingPoll();
          }
        } else {
          if (isAudioLessonRef.current) setIsAudioLesson(false);
          setAudioSrc(null);
          setSrtLines([]);
          if (displayModeRef.current !== 'text') setDisplayMode('text');
        }
        setLoading(false);

        const promises: Promise<unknown>[] = [];

        promises.push(
          data.languageId && fetchAllLanguageWordsRef.current
            ? (fetchAllLanguageWordsRef.current(data.languageId, isCurrentRequest) as Promise<unknown>)
            : Promise.resolve(null)
        );

        promises.push(
          data.languageId ? (getLanguage(data.languageId) as Promise<unknown>) : Promise.resolve(null)
        );

        promises.push(
          data.bookId && data.textId != null
            ? (updateLastRead(data.bookId, data.textId).then(() => getBook(data.bookId!)) as Promise<unknown>)
            : Promise.resolve(null)
        );

        promises.push(
          data?.textId ? (getSentenceProgress(data.textId) as Promise<unknown>) : Promise.resolve(null)
        );

        const results = await Promise.allSettled(promises);
        if (!isCurrentRequest()) return;

        if (results[0].status === 'rejected') {
          console.error('Failed to fetch language words:', results[0].reason);
        }
        if (!data.languageId) setLanguageWordsLoaded(true);

        if (results[1].status === 'fulfilled' && results[1].value) {
          setLanguageConfig(results[1].value as LanguageConfig);
        } else {
          if (results[1].status === 'rejected') {
            console.error('Failed to fetch language configuration:', results[1].reason);
            setError(prev => `${prev} (Warning: Failed to load language config)`);
          }
          setLanguageConfig(null);
        }

        if (data.bookId) {
          if (results[2].status === 'fulfilled' && results[2].value) {
            const bookData = results[2].value as ReaderBook;
            setBook(bookData);
            if (bookData?.parts) {
              const currentPartIndex = bookData.parts.findIndex((part: { textId?: number | null }) => part.textId === parseInt(textId ?? '', 10));
              setPreviousTextId(currentPartIndex > 0 ? (bookData.parts[currentPartIndex - 1].textId ?? null) : null);
              setNextTextId(currentPartIndex >= 0 && currentPartIndex < bookData.parts.length - 1 ? (bookData.parts[currentPartIndex + 1].textId ?? null) : null);
            }
          } else {
            console.error(
              'Failed to get book data:',
              results[2].status === 'rejected' ? results[2].reason : 'unknown'
            );
          }
        } else {
          setPreviousTextId(null);
          setNextTextId(null);
        }

        if (results[3].status === 'fulfilled' && results[3].value) {
          const sentenceProgress = results[3].value as {
            lastSegmentIndex?: number;
            creditedSegmentIndices?: number[];
          };
          const initialIndex = Math.max(0, sentenceProgress?.lastSegmentIndex || 0);
          stableOnSentenceProgressApplied.current(
            initialIndex,
            sentenceProgress?.creditedSegmentIndices || []
          );
        } else {
          if (results[3].status === 'rejected') {
            console.error('Failed to fetch sentence progress:', results[3].reason);
          }
          stableOnSentenceProgressApplied.current(0, []);
        }
        setSentenceProgressLoaded(true);
      } catch (err: unknown) {
        if (isCurrentRequest()) setError((err as Error)?.message || 'Failed to load text');
      } finally {
        if (isCurrentRequest()) setLoading(false);
      }
    };
    fetchText();

    return () => {
      cancelled = true;
      clearWordLinkingPoll();
    };
    // Re-fetch only when textId changes. The effect closes over many stable
    // setters/refs that should not be in deps (would re-fetch on every render).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textId]);

  return {
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
    setPreviousTextId,
    nextTextId,
    setNextTextId,
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
  };
};
