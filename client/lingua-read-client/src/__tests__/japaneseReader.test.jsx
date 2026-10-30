import React, { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { useReaderState } from '../hooks/useReaderState';
import { SettingsContext } from '../contexts/SettingsContext';
import { createWord, getBook, getLanguage, getSentenceProgress, getText, getTextSrt, mineSentence, updateWord } from '../utils/api';

vi.mock('../utils/api', () => ({
  getText: vi.fn(), getTextSrt: vi.fn(async () => ''),
  getWordLinkingStatus: vi.fn(async () => ({ wordLinkingStatus: null })),
  createWord: vi.fn(), updateWord: vi.fn(), deleteWord: vi.fn(),
  updateLastRead: vi.fn(async () => ({})), completeLesson: vi.fn(), getBook: vi.fn(),
  translateText: vi.fn(), translateSentence: vi.fn(), translateFullText: vi.fn(),
  translateSelectionWithContext: vi.fn(), explainSentence: vi.fn(), mineSentence: vi.fn(),
  batchTranslateWords: vi.fn(), addTermsBatch: vi.fn(), getLanguage: vi.fn(),
  getAllLanguages: vi.fn(async () => []), summarizeText: vi.fn(), updateUserSettings: vi.fn(),
  getSentenceProgress: vi.fn(async () => ({ creditedSegmentIndices: [], creditedWordCount: 0, lastSegmentIndex: 0 })),
  logSentenceReadActivity: vi.fn(async () => ({ creditedSegmentIndices: [0] })), applySrsReadingCredit: vi.fn(),
  getLessonStudy: vi.fn(async () => ({ readCount: 0, listenCount: 0 })),
  API_URL: 'http://test.local'
}));
vi.mock('../utils/bookmarks', () => ({
  getBookmarkedSentences: vi.fn(() => []), getLastBookmarkedSentence: vi.fn(() => null),
  toggleBookmark: vi.fn(), setCachedBookmarks: vi.fn(), isLegacyBookmarkImportDone: vi.fn(() => true)
}));
vi.mock('../utils/api/bookmarks', () => ({
  getTextBookmarks: vi.fn(async () => ({ textId: 1, sentenceIndices: [], lastSentenceIndex: null })),
  setTextBookmark: vi.fn(), importLegacyBookmarks: vi.fn()
}));
vi.mock('../utils/bookmarkSync', async importOriginal => ({
  ...await importOriginal(), migrateLegacyBookmarks: vi.fn(async () => {})
}));
vi.mock('../utils/offline/syncQueue', async importOriginal => ({
  ...await importOriginal(), listPending: vi.fn(async () => [])
}));
vi.mock('../components/AudiobookPlayer', () => ({ default: () => null }));
vi.mock('../components/TranslationPopup', () => ({ default: () => null }));
vi.mock('../utils/browserTts', () => ({
  speakText: vi.fn(async () => {}), cancelSpeech: vi.fn(), isSpeechSynthesisSupported: vi.fn(() => false)
}));

const settings = {
  theme: 'dark', textSize: 16, textFont: 'sans-serif', leftPanelWidth: 85,
  autoTranslateWords: false, pauseOnWordClick: false, highlightKnownWords: true,
  sentenceMode: false, sentenceTtsEnabled: false, defaultLanguageId: 0,
  autoAdvanceToNextLesson: false, showProgressStats: true, lineSpacing: 1.5
};

const renderReader = (customSettings = settings) => render(
  <SettingsContext.Provider value={{ settings: customSettings, updateSetting: vi.fn(), loadingSettings: false, errorSettings: null, refetchSettings: vi.fn() }}>
    <MemoryRouter initialEntries={['/texts/1']}>
      <Routes><Route path="/texts/:textId" element={<TextDisplay />} /></Routes>
    </MemoryRouter>
  </SettingsContext.Provider>
);

const renderReaderStateHook = (overrides = {}) => {
  const onSentenceProgressApplied = vi.fn();
  const fetchAllLanguageWords = vi.fn().mockResolvedValue(null);
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

describe('Japanese reader profile initialization (useReaderState)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getText.mockResolvedValue({
      textId: 1,
      languageId: 15,
      languageCode: 'ja',
      content: '𠮷野家で食べる。',
      words: [],
      segmentationProfile: 'tinysegmenter-ja-v1'
    });
    getLanguage.mockResolvedValue({ languageId: 15, code: 'ja', parserType: 'mecab', wordCharacters: '\\p{L}\\p{M}' });
    getSentenceProgress.mockResolvedValue(null);
  });

  test('awaits language config before exposing a profiled Japanese text', async () => {
    let finishLang;
    getLanguage.mockReturnValue(new Promise(resolve => { finishLang = resolve; }));
    const { result } = renderReaderStateHook({ textId: '1' });
    await waitFor(() => expect(getLanguage).toHaveBeenCalledOnce());
    expect(result.current.loading).toBe(true);
    expect(result.current.text).toBeNull();
    await act(async () => finishLang({ languageId: 15, code: 'ja', parserType: 'mecab' }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.languageConfig.parserType).toBe('tinysegmenter-ja-v1');
    expect(result.current.text.textId).toBe(1);
  });

  test('fails visibly when Japanese language config is missing and maps unprofiled text back to mecab', async () => {
    getLanguage.mockResolvedValueOnce(null);
    const { result, unmount } = renderReaderStateHook({ textId: '1' });
    await waitFor(() => expect(result.current.error).toContain('Japanese language settings could not be loaded'));
    expect(result.current.text).toBeNull();
    unmount();

    getText.mockResolvedValueOnce({
      textId: 2,
      languageId: 15,
      languageCode: 'ja',
      content: '猫は魚を食べます。',
      words: [],
      segmentationProfile: null
    });
    getLanguage.mockResolvedValueOnce({ languageId: 15, code: 'ja', parserType: 'tinysegmenter-ja-v1' });
    const unprofiled = renderReaderStateHook({ textId: '2' });
    await waitFor(() => expect(unprofiled.result.current.loading).toBe(false));
    await waitFor(() => expect(unprofiled.result.current.languageConfig?.parserType).toBe('mecab'));
  });
});

describe('Japanese reader workflow (TextDisplay)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    getLanguage.mockResolvedValue({ languageId: 15, code: 'ja', parserType: 'mecab', wordCharacters: '\\p{L}\\p{M}' });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const setup = (rows, profile = 'tinysegmenter-ja-v1', content = '𠮷野家で食べる。\n私は昨日図書館で日本語の本を読みました。') => {
    getText.mockResolvedValue({
      textId: 1,
      title: 'Japanese fixture',
      content,
      languageId: 15,
      languageCode: 'ja',
      segmentationProfile: profile,
      words: rows
    });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    updateWord.mockImplementation(async (wordId, status, translation) => ({
      ...rows.find(row => row.wordId === wordId),
      status,
      translation
    }));
  };

  test('clickable Japanese words including supplementary Han preserve saved term IDs through reload and status edit', async () => {
    setup([
      { wordId: 201, term: '図書館', status: 3, translation: 'library' },
      { wordId: 202, term: '𠮷野家', status: 2, translation: 'Yoshinoya' }
    ]);
    const first = renderReader();
    await waitFor(() => expect(screen.getByText('図書館')).toHaveClass('word-status-3'));
    expect(screen.getByText('𠮷野家')).toHaveClass('word-status-2');
    expect(first.container.querySelector('.text-content').textContent).toContain('𠮷野家で食べる。');
    expect(first.container.querySelector('.text-content').textContent).toContain('私は昨日図書館で日本語の本を読みました。');
    first.unmount();

    renderReader();
    await waitFor(() => expect(screen.getByText('𠮷野家')).toHaveClass('word-status-2'));
    fireEvent.click(screen.getByText('𠮷野家'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(202, 4, 'Yoshinoya'));
    expect(createWord).not.toHaveBeenCalled();
  });

  test('saved spaceless Japanese phrases remain selectable phrases and support sentence mining', async () => {
    setup([{ wordId: 203, term: '日本語の本', status: 3, translation: 'Japanese book' }], 'tinysegmenter-ja-v1', '私は昨日図書館で日本語の本を読みました。');
    renderReader();
    await waitFor(() => expect(screen.getByText('日本語の本')).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText('日本語の本'));
    expect(screen.getByRole('textbox')).toHaveValue('Japanese book');
    vi.stubGlobal('alert', vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Mine', exact: true }));
    await waitFor(() => expect(mineSentence).toHaveBeenCalledWith(203, '私は昨日図書館で日本語の本を読みました。', 1, 'Japanese fixture'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(203, 4, 'Japanese book'));
    expect(createWord).not.toHaveBeenCalled();
  });

  test('unprofiled legacy Japanese text keeps its whole-run boundaries', async () => {
    setup([], null, '猫は魚を食べます。');
    const { container } = renderReader();
    await screen.findByText('猫は魚を食べます');
    expect(Array.from(container.querySelectorAll('.clickable-word')).map(span => span.textContent)).toEqual(['猫は魚を食べます']);
  });

  test('audio lesson SRT transcript and sentence mode segment Japanese cues and preserve mining', async () => {
    const rows = [
      { wordId: 201, term: '図書館', status: 3, translation: 'library' },
      { wordId: 202, term: '𠮷野家', status: 2, translation: 'Yoshinoya' }
    ];
    const srtRaw = [
      '1',
      '00:00:00,000 --> 00:00:02,500',
      '私は昨日図書館で日本語の本を読みました。',
      '',
      '2',
      '00:00:02,500 --> 00:00:05,000',
      '𠮷野家で食べる。',
      ''
    ].join('\n');
    getText.mockResolvedValue({
      textId: 1,
      title: 'Japanese Audio',
      content: '私は昨日図書館で日本語の本を読みました。\n𠮷野家で食べる。',
      languageId: 15,
      languageCode: 'ja',
      segmentationProfile: 'tinysegmenter-ja-v1',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/u/1.mp3',
      hasSrtContent: true,
      words: rows
    });
    getTextSrt.mockResolvedValue(srtRaw);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    vi.stubGlobal('alert', vi.fn());

    const transcriptRender = renderReader();
    await waitFor(() => expect(screen.getByText('図書館')).toHaveClass('word-status-3'));
    expect(screen.getByText('𠮷野家')).toHaveClass('word-status-2');
    const srtLineNodes = Array.from(transcriptRender.container.querySelectorAll('.srt-line'));
    expect(srtLineNodes.map(node => node.textContent)).toEqual([
      '私は昨日図書館で日本語の本を読みました。',
      '𠮷野家で食べる。'
    ]);
    fireEvent.click(screen.getByText('図書館'));
    fireEvent.click(screen.getByRole('button', { name: 'Mine', exact: true }));
    await waitFor(() =>
      expect(mineSentence).toHaveBeenCalledWith(201, '私は昨日図書館で日本語の本を読みました。', 1, 'Japanese Audio')
    );
    transcriptRender.unmount();

    const sentenceRender = renderReader({ ...settings, sentenceMode: true });
    await waitFor(() => expect(screen.getByText('図書館')).toHaveClass('word-status-3'));
    expect(sentenceRender.container.querySelector('.sentence-mode-text').textContent).toBe('私は昨日図書館で日本語の本を読みました。');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('𠮷野家')).toHaveClass('word-status-2'));
    expect(sentenceRender.container.querySelector('.sentence-mode-text').textContent).toBe('𠮷野家で食べる。');
  });

  test('EPUB structuredContent blocks segment Japanese words in standard and sentence modes', async () => {
    const rows = [
      { wordId: 201, term: '図書館', status: 3, translation: 'library' },
      { wordId: 202, term: '日本語', status: 2, translation: 'Japanese language' }
    ];
    const structuredContent = [
      { type: 'title', text: '第一章 日本語' },
      { type: 'paragraph', text: '私は昨日図書館で本を読みました。' }
    ];
    getText.mockResolvedValue({
      textId: 1,
      bookId: 5,
      title: '第一章 日本語',
      content: '第一章 日本語\n\n私は昨日図書館で本を読みました。',
      structuredContent,
      languageId: 15,
      languageCode: 'ja',
      segmentationProfile: 'tinysegmenter-ja-v1',
      words: rows
    });
    getBook.mockResolvedValue({ bookId: 5, title: 'Japanese EPUB', parts: [{ textId: 1, partNumber: 1 }] });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    vi.stubGlobal('alert', vi.fn());

    const standardRender = renderReader();
    await waitFor(() => expect(screen.getByText('図書館')).toHaveClass('word-status-3'));
    expect(screen.getByText('日本語')).toHaveClass('word-status-2');
    fireEvent.click(screen.getByText('図書館'));
    fireEvent.click(screen.getByRole('button', { name: 'Mine', exact: true }));
    await waitFor(() =>
      expect(mineSentence).toHaveBeenCalledWith(201, '私は昨日図書館で本を読みました。', 1, '第一章 日本語')
    );
    standardRender.unmount();

    const sentenceRender = renderReader({ ...settings, sentenceMode: true });
    await waitFor(() => expect(screen.getByText('日本語')).toHaveClass('word-status-2'));
    expect(sentenceRender.container.querySelector('.sentence-mode-text').textContent).toBe('第一章 日本語');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('図書館')).toHaveClass('word-status-3'));
    expect(sentenceRender.container.querySelector('.sentence-mode-text').textContent).toBe('私は昨日図書館で本を読みました。');
  });
});
