import { ensureChineseSegmentation } from '../utils/chineseDictionary';
vi.mock('../utils/chineseDictionary', () => ({ ensureChineseSegmentation: vi.fn() }));
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

import { getText, getTextSrt, getWordLinkingStatus, getLanguage, getSentenceProgress, getBook, updateLastRead } from '../utils/api';
import { useReaderState } from '../hooks/useReaderState';

const renderReaderStateHook = (overrides = {}) => {
  const onSentenceProgressApplied = vi.fn();
  let fetchAllLanguageWords = vi.fn().mockResolvedValue(null);
  return {
    onSentenceProgressApplied,
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
          onSentenceProgressApplied,
          ...overrides
        }
      }
    )
  };
};


describe('Chinese reader profile initialization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getText.mockResolvedValue({ textId: 1, languageId: 12, languageCode: 'zh', content: '中文', words: [], segmentationProfile: 'jieba-v1' });
    getLanguage.mockResolvedValue({ languageId: 12, code: 'zh', parserType: 'jieba' });
    getSentenceProgress.mockResolvedValue(null);
  });
  test('does not expose a profiled text through legacy rendering while dictionary loads', async () => {
    let finish;
    ensureChineseSegmentation.mockReturnValue(new Promise(resolve => { finish = resolve; }));
    const { result } = renderReaderStateHook({ textId: '1' });
    await waitFor(() => expect(ensureChineseSegmentation).toHaveBeenCalledOnce());
    expect(result.current.loading).toBe(true);
    expect(result.current.text).toBeNull();
    await act(async () => finish());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.languageConfig.parserType).toBe('jieba-v1');
    expect(result.current.text.textId).toBe(1);
  });
  test('fails visibly when the dictionary is unavailable instead of silently reverting', async () => {
    ensureChineseSegmentation.mockRejectedValue(new Error('Dictionary unavailable offline'));
    const { result } = renderReaderStateHook({ textId: '1' });
    await waitFor(() => expect(result.current.error).toBe('Dictionary unavailable offline'));
    expect(result.current.text).toBeNull();
  });
  test('rejects an unsupported future profile', async () => {
    getText.mockResolvedValue({ textId: 1, languageId: 12, segmentationProfile: 'future-v2' });
    const { result } = renderReaderStateHook({ textId: '1' });
    await waitFor(() => expect(result.current.error).toContain('newer word segmenter'));
    expect(ensureChineseSegmentation).not.toHaveBeenCalled();
  });
  test('polls word-linking status for a processing Chinese audio lesson and merges linked words without losing in-session saves', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      ensureChineseSegmentation.mockResolvedValue();
      getText
        .mockResolvedValueOnce({
          textId: 7,
          languageId: 12,
          languageCode: 'zh',
          content: '我今天在图书馆学习中文。',
          segmentationProfile: 'jieba-v1',
          isAudioLesson: true,
          audioFilePath: 'audio_lessons/u/7.mp3',
          hasSrtContent: true,
          wordLinkingStatus: 'processing',
          words: []
        })
        .mockResolvedValueOnce({
          textId: 7,
          languageId: 12,
          languageCode: 'zh',
          content: '我今天在图书馆学习中文。',
          segmentationProfile: 'jieba-v1',
          isAudioLesson: true,
          audioFilePath: 'audio_lessons/u/7.mp3',
          hasSrtContent: true,
          wordLinkingStatus: 'completed',
          words: [
            { wordId: 101, term: '图书馆', status: 1, translation: null },
            { wordId: 102, term: '学习', status: 1, translation: null }
          ]
        });
      getTextSrt.mockResolvedValue('1\n00:00:00,000 --> 00:00:02,500\n我今天在图书馆学习中文。\n');
      getWordLinkingStatus.mockResolvedValue({ wordLinkingStatus: 'completed' });

      const { result } = renderReaderStateHook({ textId: '7' });
      await waitFor(() => expect(result.current.loading).toBe(false));
      expect(result.current.languageConfig.parserType).toBe('jieba-v1');
      await waitFor(() => expect(result.current.srtLines).toHaveLength(1));
      expect(result.current.srtLines[0].text).toBe('我今天在图书馆学习中文。');

      // Simulate user saving a word before background linking finishes
      act(() => {
        result.current.setWords([{ wordId: 101, term: '图书馆', status: 3, translation: 'library' }]);
      });

      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });

      await waitFor(() => expect(getWordLinkingStatus).toHaveBeenCalledWith('7'));
      await waitFor(() => expect(result.current.words).toHaveLength(2));
      expect(result.current.words.find(w => w.term === '图书馆')).toMatchObject({ wordId: 101, status: 3, translation: 'library' });
      expect(result.current.words.find(w => w.term === '学习')).toMatchObject({ wordId: 102, status: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
  test('reopens a profiled Chinese book part and audio lesson with cached dependencies', async () => {
    ensureChineseSegmentation.mockResolvedValue();
    getText.mockResolvedValue({
      textId: 11,
      bookId: 9,
      languageId: 12,
      languageCode: 'zh',
      content: '第一章 我爱读书。',
      segmentationProfile: 'jieba-v1',
      words: [{ wordId: 55, term: '读书', status: 4, translation: 'read' }]
    });
    getBook.mockResolvedValue({
      bookId: 9,
      title: 'Cached Chinese Book',
      parts: [{ textId: 10, partNumber: 1 }, { textId: 11, partNumber: 2 }, { textId: 12, partNumber: 3 }]
    });
    updateLastRead.mockResolvedValue({});

    const { result } = renderReaderStateHook({ textId: '11' });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.languageConfig.parserType).toBe('jieba-v1');
    await waitFor(() => expect(result.current.previousTextId).toBe(10));
    expect(result.current.nextTextId).toBe(12);
    expect(result.current.words).toEqual([{ wordId: 55, term: '读书', status: 4, translation: 'read' }]);
  });
});
