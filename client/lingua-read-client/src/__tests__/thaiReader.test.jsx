import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeThaiSegmentation } from '../utils/thaiRuntime';
import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';
import { createWord, getBook, getLanguage, getText, getTextSrt, mineSentence, updateWord } from '../utils/api';

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

vi.mock('../utils/thaiDictionary', () => ({ ensureThaiSegmentation: vi.fn(async () => {}) }));
initializeThaiSegmentation(readFileSync(resolve(process.cwd(), '../../server/LinguaReadApi/Resources/Segmentation/words_th.txt'), 'utf8'));

describe('opt-in Thai reader workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    getLanguage.mockResolvedValue({ languageId: 13, code: 'th', parserType: 'spacedel', wordCharacters: '\\p{L}\\p{M}' });
  });
  afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

  const setup = (rows, profile = 'thai-dict-v1', content = 'ฉันชอบอ่านหนังสือที่กรุงเทพฯ') => {
    getText.mockResolvedValue({ textId: 1, title: 'Thai fixture', content, languageId: 13, languageCode: 'th', segmentationProfile: profile, words: rows });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    updateWord.mockImplementation(async (wordId, status, translation) => ({ ...rows.find(row => row.wordId === wordId), status, translation }));
  };

  test('clickable words preserve a saved term ID through reload and status edit', async () => {
    setup([{ wordId: 81, term: 'หนังสือ', status: 3, translation: 'book' }]);
    const first = renderReader();
    await waitFor(() => expect(screen.getByText('หนังสือ')).toHaveClass('word-status-3'));
    expect(first.container.querySelector('.text-content').textContent).toBe('ฉันชอบอ่านหนังสือที่กรุงเทพฯ');
    first.unmount();

    renderReader();
    await waitFor(() => expect(screen.getByText('หนังสือ')).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText('หนังสือ'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(81, 4, 'book'));
    expect(createWord).not.toHaveBeenCalled();
  });

  test('saved spaceless Thai phrases are rendered as single clickable phrase tokens', async () => {
    setup([{ wordId: 82, term: 'อ่านหนังสือ', status: 3, translation: 'read books' }]);
    renderReader();
    await waitFor(() => expect(screen.getByText('อ่านหนังสือ')).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText('อ่านหนังสือ'));
    expect(screen.getByRole('textbox')).toHaveValue('read books');
  });

  test('Paiyannoi is preserved attached to กรุงเทพฯ', async () => {
    setup([{ wordId: 83, term: 'กรุงเทพฯ', status: 2, translation: 'Bangkok' }]);
    renderReader();
    await waitFor(() => expect(screen.getByText('กรุงเทพฯ')).toHaveClass('word-status-2'));
  });

  test('Thai numerals in th-02 are selectable tokens', async () => {
    setup([{ wordId: 84, term: '๒', status: 1, translation: 'two' }], 'thai-dict-v1', 'น้ำดื่มสะอาดอยู่ที่ออฟฟิศชั้น ๒');
    renderReader();
    await waitFor(() => expect(screen.getByText('๒')).toHaveClass('word-status-1'));
  });
});
