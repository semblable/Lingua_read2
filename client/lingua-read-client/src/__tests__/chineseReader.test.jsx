import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeChineseSegmentation } from '../utils/chineseRuntime';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';
import { createWord, getLanguage, getText, getTextSrt, mineSentence, updateWord } from '../utils/api';

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

vi.mock('../utils/chineseDictionary', () => ({ ensureChineseSegmentation: vi.fn(async () => {}) }));
initializeChineseSegmentation(readFileSync(resolve(process.cwd(), '../../server/LinguaReadApi/Resources/Segmentation/jieba-big-v1.txt'), 'utf8'));

describe('opt-in Chinese reader workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    getLanguage.mockResolvedValue({ languageId: 12, code: 'zh', parserType: 'jieba', wordCharacters: '\\p{L}\\p{M}' });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  const setup = (rows, profile = 'jieba-v1') => {
    getText.mockResolvedValue({ textId: 1, title: 'Chinese fixture', content: '我今天在图书馆学习中文。', languageId: 12, languageCode: 'zh', segmentationProfile: profile, words: rows });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    updateWord.mockImplementation(async (wordId, status, translation) => ({ ...rows.find(row => row.wordId === wordId), status, translation }));
  };
  test('clickable words preserve a saved term ID through reload and status edit', async () => {
    setup([{ wordId: 91, term: '图书馆', status: 3, translation: 'library' }]);
    const first = renderReader();
    await waitFor(() => expect(screen.getByText('图书馆')).toHaveClass('word-status-3'));
    expect(first.container.querySelector('.text-content').textContent).toBe('我今天在图书馆学习中文。');
    first.unmount();
    renderReader();
    await waitFor(() => expect(screen.getByText('图书馆')).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText('图书馆'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(91, 4, 'library'));
    expect(createWord).not.toHaveBeenCalled();
  });
  test('saved phrases without spaces remain selectable phrases rather than disappearing', async () => {
    setup([{ wordId: 92, term: '图书馆学习中文', status: 3, translation: 'study Chinese at the library' }]);
    renderReader();
    await waitFor(() => expect(screen.getByText('图书馆学习中文')).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText('图书馆学习中文'));
    expect(screen.getByRole('textbox')).toHaveValue('study Chinese at the library');
    vi.stubGlobal('alert', vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Mine', exact: true }));
    await waitFor(() => expect(mineSentence).toHaveBeenCalledWith(92, '我今天在图书馆学习中文。', 1, 'Chinese fixture'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(92, 4, 'study Chinese at the library'));
    expect(createWord).not.toHaveBeenCalled();
  });
  test('unprofiled legacy text keeps its whole-run boundaries', async () => {
    setup([], null);
    const { container } = renderReader();
    await screen.findByText('我今天在图书馆学习中文');
    expect(Array.from(container.querySelectorAll('.clickable-word')).map(span => span.textContent)).toEqual(['我今天在图书馆学习中文']);
  });
  test('audio lesson SRT transcript and sentence mode segment Chinese cues and preserve cue offsets and mining', async () => {
    const rows = [
      { wordId: 91, term: '图书馆', status: 3, translation: 'library' },
      { wordId: 92, term: '自然语言', status: 2, translation: 'natural language' }
    ];
    const srtRaw = [
      '1',
      '00:00:00,000 --> 00:00:02,500',
      '我今天在图书馆学习中文。',
      '',
      '2',
      '00:00:02,500 --> 00:00:05,000',
      '自然语言处理很有趣。',
      ''
    ].join('\n');
    getText.mockResolvedValue({
      textId: 1,
      title: 'Chinese Audio',
      content: '我今天在图书馆学习中文。\n自然语言处理很有趣。',
      languageId: 12,
      languageCode: 'zh',
      segmentationProfile: 'jieba-v1',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/u/1.mp3',
      hasSrtContent: true,
      words: rows
    });
    getTextSrt.mockResolvedValue(srtRaw);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    vi.stubGlobal('alert', vi.fn());

    const transcriptRender = renderReader();
    await waitFor(() => expect(screen.getByText('图书馆')).toHaveClass('word-status-3'));
    expect(screen.getByText('自然语言')).toHaveClass('word-status-2');
    const srtLineNodes = Array.from(transcriptRender.container.querySelectorAll('.srt-line'));
    expect(srtLineNodes.map(node => node.textContent)).toEqual([
      '我今天在图书馆学习中文。',
      '自然语言处理很有趣。'
    ]);
    fireEvent.click(screen.getByText('图书馆'));
    fireEvent.click(screen.getByRole('button', { name: 'Mine', exact: true }));
    await waitFor(() =>
      expect(mineSentence).toHaveBeenCalledWith(91, '我今天在图书馆学习中文。', 1, 'Chinese Audio')
    );
    transcriptRender.unmount();

    const sentenceRender = renderReader({ ...settings, sentenceMode: true });
    await waitFor(() => expect(screen.getByText('图书馆')).toHaveClass('word-status-3'));
    expect(sentenceRender.container.querySelector('.sentence-mode-text').textContent).toBe('我今天在图书馆学习中文。');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(screen.getByText('自然语言')).toHaveClass('word-status-2'));
    expect(sentenceRender.container.querySelector('.sentence-mode-text').textContent).toBe('自然语言处理很有趣。');
  });
});
