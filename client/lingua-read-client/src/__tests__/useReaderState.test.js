import { describe, test, expect, vi, beforeEach } from 'vitest';
import { useRef } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api', () => ({
  getText: vi.fn(),
  getTextSrt: vi.fn(),
  getWordLinkingStatus: vi.fn(),
  getLanguage: vi.fn(),
  getBook: vi.fn(),
  updateLastRead: vi.fn(),
  getSentenceProgress: vi.fn()
}));

import { getText, getLanguage, getSentenceProgress } from '../utils/api';
import { useReaderState } from '../hooks/useReaderState';

const renderReaderStateHook = (overrides = {}) => {
  const onSentenceProgressApplied = vi.fn();
  const setLeftPanelWidth = vi.fn();
  let fetchAllLanguageWords = vi.fn().mockResolvedValue(null);
  return {
    onSentenceProgressApplied,
    setLeftPanelWidth,
    fetchAllLanguageWords,
    ...renderHook(
      (props) => {
        const autoTranslateTriggeredRef = useRef(false);
        const autoTranslateTextIdRef = useRef(null);
        const fetchAllLanguageWordsRef = useRef(fetchAllLanguageWords);
        return useReaderState({
          fetchAllLanguageWordsRef,
          autoTranslateTriggeredRef,
          autoTranslateTextIdRef,
          ...props
        });
      },
      {
        initialProps: {
          textId: undefined,
          leftPanelWidthFromSettings: 85,
          setLeftPanelWidth,
          onSentenceProgressApplied,
          ...overrides
        }
      }
    )
  };
};

describe('useReaderState', () => {
  beforeEach(() => {
    getText.mockReset();
    getLanguage.mockReset();
    getSentenceProgress.mockReset();
  });

  test('returns the documented Use<Name>Result shape', () => {
    const { result } = renderReaderStateHook();
    expect(result.current).toEqual(
      expect.objectContaining({
        loading: true,
        setLoading: expect.any(Function),
        error: '',
        setError: expect.any(Function),
        text: null,
        setText: expect.any(Function),
        book: null,
        setBook: expect.any(Function),
        words: [],
        setWords: expect.any(Function),
        languageWordsLoaded: false,
        setLanguageWordsLoaded: expect.any(Function),
        languageConfig: null,
        setLanguageConfig: expect.any(Function),
        embeddedUrl: null,
        setEmbeddedUrl: expect.any(Function),
        previousTextId: null,
        nextTextId: null,
        isAudioLesson: false,
        setIsAudioLesson: expect.any(Function),
        displayMode: 'audio',
        setDisplayMode: expect.any(Function),
        audioSrc: null,
        setAudioSrc: expect.any(Function),
        srtLines: [],
        setSrtLines: expect.any(Function),
        sentenceProgressLoaded: false,
        setSentenceProgressLoaded: expect.any(Function)
      })
    );
  });

  test('no fetch when textId is undefined', async () => {
    renderReaderStateHook();
    await Promise.resolve();
    expect(getText).not.toHaveBeenCalled();
  });

  test('loads text data when textId is provided', async () => {
    getText.mockResolvedValue({
      textId: 7,
      languageId: 5,
      languageCode: 'es',
      content: 'hola',
      words: [{ wordId: 1, term: 'hola' }],
      isAudioLesson: false
    });
    getLanguage.mockResolvedValue({ languageId: 5, name: 'Spanish' });
    getSentenceProgress.mockResolvedValue({ lastSegmentIndex: 2, creditedSegmentIndices: [0, 1] });

    const { result, onSentenceProgressApplied } = renderReaderStateHook({ textId: '7' });

    await waitFor(() => {
      expect(result.current.text?.textId).toBe(7);
    });
    expect(result.current.words).toEqual([{ wordId: 1, term: 'hola' }]);
    expect(result.current.languageConfig).toEqual({ languageId: 5, name: 'Spanish' });
    expect(onSentenceProgressApplied).toHaveBeenCalledWith(2, [0, 1]);
  });

  test('falls back to empty sentence progress on rejection', async () => {
    getText.mockResolvedValue({
      textId: 8,
      languageId: 5,
      content: 'hola',
      isAudioLesson: false
    });
    getLanguage.mockResolvedValue(null);
    getSentenceProgress.mockRejectedValue(new Error('no progress'));

    const { result, onSentenceProgressApplied } = renderReaderStateHook({ textId: '8' });

    await waitFor(() => {
      expect(result.current.sentenceProgressLoaded).toBe(true);
    });
    expect(onSentenceProgressApplied).toHaveBeenCalledWith(0, []);
  });

  test('sets error when getText fails', async () => {
    getText.mockRejectedValue(new Error('boom'));

    const { result } = renderReaderStateHook({ textId: '9' });

    await waitFor(() => {
      expect(result.current.error).toBe('boom');
    });
    expect(result.current.loading).toBe(false);
  });

  test('configures audio mode for an audio lesson with SRT', async () => {
    getText.mockResolvedValue({
      textId: 10,
      languageId: 5,
      content: 'hola',
      isAudioLesson: true,
      audioFilePath: 'media/foo.mp3',
      hasSrtContent: true
    });
    getLanguage.mockResolvedValue(null);
    getSentenceProgress.mockResolvedValue(null);

    const { result } = renderReaderStateHook({ textId: '10' });

    await waitFor(() => {
      expect(result.current.isAudioLesson).toBe(true);
    });
    expect(result.current.audioSrc).toBe('/media/foo.mp3');
    expect(result.current.displayMode).toBe('audio');
  });

  test('applies leftPanelWidth from settings on mount', () => {
    const { setLeftPanelWidth } = renderReaderStateHook({
      leftPanelWidthFromSettings: 70
    });
    expect(setLeftPanelWidth).toHaveBeenCalledWith(70);
  });
});
