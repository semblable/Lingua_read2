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
});
