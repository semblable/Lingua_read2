import React from 'react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';
import { addTermsBatch, batchTranslateWords, createWord, getLanguage, getText, mineSentence, updateWord } from '../utils/api';

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
  logSentenceReadActivity: vi.fn(), applySrsReadingCredit: vi.fn(),
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

const renderReader = () => render(
  <SettingsContext.Provider value={{ settings, updateSetting: vi.fn(), loadingSettings: false, errorSettings: null, refetchSettings: vi.fn() }}>
    <MemoryRouter initialEntries={['/texts/1']}>
      <Routes><Route path="/texts/:textId" element={<TextDisplay />} /></Routes>
    </MemoryRouter>
  </SettingsContext.Provider>
);

describe('Korean reader saved vocabulary identity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.matchMedia = vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
    window.getSelection()?.removeAllRanges();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const seedReader = (content, rows, code = 'ko-KR') => {
    getText.mockResolvedValue({ textId: 1, title: 'Korean lookup fixture', content, languageId: 12, languageCode: code, words: [] });
    getLanguage.mockResolvedValue({ languageId: 12, code, parserType: 'spacedel', wordCharacters: '\\p{L}\\p{M}', characterSubstitutions: '' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => structuredClone(rows) });
    updateWord.mockImplementation(async (wordId, status, translation) => {
      const row = rows.find(row => row.wordId === wordId);
      Object.assign(row, { status, translation });
      return structuredClone(row);
    });
  };

  const seedBatchSave = rows => {
    addTermsBatch.mockImplementation(async (_languageId, terms, options) => {
      for (const term of terms) {
        const saved = rows.find(row => row.term === term.term);
        if (saved) {
          if (!options?.keepExistingStatus) saved.status = term.status;
          saved.translation = term.translation;
        } else {
          rows.push({ wordId: 999, ...term });
        }
      }
      return { words: structuredClone(rows) };
    });
  };

  test.each([
    ['한글', '한글'],
    ['한글', '한글']
  ])('display %s finds saved %s and edits the same row after reload', async (surface, stored) => {
    const rows = [{ wordId: 91, term: stored, status: 3, translation: 'Korean letters' }];
    seedReader(`${surface}.`, rows);
    const first = renderReader();
    await waitFor(() => expect(screen.getByText(surface)).toHaveClass('word-status-3'));
    expect(screen.getByText(surface).textContent).toBe(surface);
    first.unmount();
    renderReader();
    await waitFor(() => expect(screen.getByText(surface)).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText(surface));
    expect(screen.getByRole('textbox')).toHaveValue('Korean letters');
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(91, 4, 'Korean letters'));
    expect(createWord).not.toHaveBeenCalled();
    expect(rows).toEqual([{ wordId: 91, term: stored, status: 4, translation: 'Korean letters' }]);
  });

  test('conflicting legacy forms retain their own status and meaning; third alias stays unresolved', async () => {
    const rows = [
      { wordId: 91, term: '각', status: 5, translation: 'first meaning' },
      { wordId: 92, term: '각', status: 2, translation: 'second meaning' },
      { wordId: 93, term: 'ㄱㅏ', status: 3, translation: 'compatibility spelling' }
    ];
    seedReader('각 각 각 ㄱㅏ.', rows);
    renderReader();
    await waitFor(() => expect(screen.getByText('각')).toHaveClass('word-status-5'));
    expect(screen.getByText('각')).toHaveClass('word-status-2');
    expect(screen.getByText('각')).toHaveClass('word-status-0');
    expect(screen.getByText('ㄱㅏ')).toHaveClass('word-status-3');
    fireEvent.click(screen.getByText('각'));
    expect(screen.getByRole('textbox')).toHaveValue('second meaning');
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(92, 4, 'second meaning'));
    expect(rows[0]).toEqual({ wordId: 91, term: '각', status: 5, translation: 'first meaning' });
    expect(rows).toHaveLength(3);
    expect(createWord).not.toHaveBeenCalled();
  });

  test.each([
    ['한글 ABC🙂 테스트', '한글 ABC🙂 테스트'],
    ['한글 ABC🙂 테스트', '한글 ABC🙂 테스트']
  ])('saved phrase %s renders in its source spelling and keeps its row after reload', async (surface, stored) => {
    const rows = [{ wordId: 101, term: stored, status: 3, translation: 'saved phrase meaning' }];
    seedReader(`🙂 앞, ${surface}! 끝.`, rows);
    const first = renderReader();
    await waitFor(() => expect(screen.getByText(surface)).toHaveClass('word-status-3'));
    expect(screen.getByText(surface).textContent).toBe(surface);
    expect(screen.getByText('끝')).toHaveClass('clickable-word');
    expect(first.container.querySelector('.text-content').textContent).toBe(`🙂 앞, ${surface}! 끝.`);
    first.unmount();
    renderReader();
    await waitFor(() => expect(screen.getByText(surface)).toHaveClass('word-status-3'));
    fireEvent.click(screen.getByText(surface));
    expect(screen.getByRole('textbox')).toHaveValue('saved phrase meaning');
    vi.stubGlobal('alert', vi.fn());
    fireEvent.click(screen.getByRole('button', { name: 'Mine', exact: true }));
    await waitFor(() => expect(mineSentence).toHaveBeenCalledWith(101, `🙂 앞, ${surface}!`, 1, 'Korean lookup fixture'));
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(101, 4, 'saved phrase meaning'));
    expect(createWord).not.toHaveBeenCalled();
    expect(rows[0].term).toBe(stored);
  });

  test('conflicting exact phrase spellings keep their IDs and an ambiguous third form stays ungrouped', async () => {
    const rows = [
      { wordId: 101, term: '각 테스트', status: 5, translation: 'first phrase' },
      { wordId: 102, term: '각 테스트', status: 2, translation: 'second phrase' }
    ];
    seedReader('각 테스트, 각 테스트, 각 테스트.', rows);
    const { container } = renderReader();
    await waitFor(() => expect(screen.getByText('각 테스트')).toHaveClass('word-status-5'));
    expect(screen.getByText('각 테스트')).toHaveClass('word-status-2');
    expect(screen.queryByText('각 테스트')).not.toBeInTheDocument();
    expect(Array.from(container.querySelectorAll('.clickable-word')).map(span => span.textContent))
      .toEqual(['각 테스트', '각 테스트', '각', '테스트']);
    fireEvent.click(screen.getByText('각 테스트'));
    expect(screen.getByRole('textbox')).toHaveValue('first phrase');
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(101, 4, 'first phrase'));
    fireEvent.click(screen.getByText('각 테스트'));
    expect(screen.getByRole('textbox')).toHaveValue('second phrase');
    fireEvent.click(screen.getByRole('button', { name: '4' }));
    await waitFor(() => expect(updateWord).toHaveBeenCalledWith(102, 4, 'second phrase'));
    expect(createWord).not.toHaveBeenCalled();
    expect(rows).toHaveLength(2);
  });

  test('other languages keep their existing lookup behavior', async () => {
    seedReader('한글.', [{ wordId: 91, term: '한글', status: 5, translation: 'saved' }], 'en');
    renderReader();
    await waitFor(() => expect(screen.getByText('한글')).toHaveClass('word-status-0'));
  });

  test('case-colliding Korean exact keys never pick one saved meaning after reload', async () => {
    const rows = [
      { wordId: 101, term: '한글ABC', status: 5, translation: 'first meaning' },
      { wordId: 102, term: '한글abc', status: 2, translation: 'second meaning' }
    ];
    const preserved = structuredClone(rows);
    seedReader('한글AbC.', rows);
    const first = renderReader();
    await waitFor(() => expect(screen.getByText('한글AbC')).toHaveClass('word-status-0'));
    fireEvent.click(screen.getByText('한글AbC'));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Mine', exact: true })).toBeDisabled();
    first.unmount();
    rows.reverse();
    renderReader();
    await waitFor(() => expect(screen.getByText('한글AbC')).toHaveClass('word-status-0'));
    fireEvent.click(screen.getByText('한글AbC'));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(updateWord).not.toHaveBeenCalled();
    expect(createWord).not.toHaveBeenCalled();
    expect(rows.toSorted((a, b) => a.wordId - b.wordId)).toEqual(preserved);
  });

  test('case-colliding exact phrase spellings stay ungrouped with both saved rows preserved', async () => {
    const rows = [
      { wordId: 101, term: '한글 ABC', status: 5, translation: 'first phrase' },
      { wordId: 102, term: '한글 abc', status: 2, translation: 'second phrase' }
    ];
    const preserved = structuredClone(rows);
    seedReader('한글 ABC, 한글 abc.', rows);
    const { container } = renderReader();
    await waitFor(() => expect(screen.getByText('ABC')).toHaveClass('word-status-0'));
    const spans = Array.from(container.querySelectorAll('.clickable-word'));
    expect(spans.map(span => span.textContent)).toEqual(['한글', 'ABC', '한글', 'abc']);
    spans.forEach(span => expect(span).toHaveClass('word-status-0'));
    fireEvent.click(screen.getByText('ABC'));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(updateWord).not.toHaveBeenCalled();
    expect(createWord).not.toHaveBeenCalled();
    expect(rows).toEqual(preserved);
  });

  test.each(['All Known', 'Auto ?'])('%s coalesces unsaved Hangul aliases before background linking finishes', async action => {
    const surface = '한글';
    const rows = [];
    seedReader(`${surface} 한글.`, rows);
    seedBatchSave(rows);
    batchTranslateWords.mockResolvedValue({ [surface]: 'Korean letters', '한글': 'Korean letters' });
    vi.stubGlobal('alert', vi.fn());
    renderReader();
    await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(addTermsBatch).toHaveBeenCalledOnce());
    expect(addTermsBatch.mock.calls[0][1]).toHaveLength(1);
    expect(addTermsBatch.mock.calls[0][1][0].term).toBe(surface);
    expect(rows).toHaveLength(1);
    expect(rows[0].term).toBe(surface);
  });

  test('All Known saves a unique decomposed alias using the existing stored term and ID once', async () => {
    const surface = '한글';
    const rows = [{ wordId: 91, term: '한글', status: 0, translation: '' }];
    seedReader(`${surface} 한글.`, rows);
    seedBatchSave(rows);
    vi.stubGlobal('alert', vi.fn());
    renderReader();
    await waitFor(() => expect(screen.getByRole('button', { name: 'All Known' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'All Known' }));
    await waitFor(() => expect(addTermsBatch).toHaveBeenCalledWith(12, [{ term: '한글', translation: '', status: 5 }]));
    await waitFor(() => expect(screen.getByText(surface)).toHaveClass('word-status-5'));
    expect(rows).toEqual([{ wordId: 91, term: '한글', status: 5, translation: '' }]);
    expect(createWord).not.toHaveBeenCalled();
  });

  test('Auto ? sends a unique alias back to its stored term and preserves its saved status', async () => {
    const surface = '한글';
    const rows = [{ wordId: 91, term: '한글', status: 2, translation: '' }];
    seedReader(`${surface}.`, rows);
    seedBatchSave(rows);
    batchTranslateWords.mockResolvedValue({ [surface]: 'Korean letters' });
    vi.stubGlobal('alert', vi.fn());
    renderReader();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Auto ?' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Auto ?' }));
    await waitFor(() => expect(addTermsBatch).toHaveBeenCalledWith(12,
      [{ term: '한글', translation: 'Korean letters', status: 5 }], { keepExistingStatus: true }));
    await waitFor(() => expect(screen.getByText(surface)).toHaveClass('word-status-2'));
    expect(rows).toEqual([{ wordId: 91, term: '한글', status: 2, translation: 'Korean letters' }]);
    expect(createWord).not.toHaveBeenCalled();
  });

  test.each([
    ['All Known', 'exact'], ['Auto ?', 'exact'],
    ['All Known', 'canonical'], ['Auto ?', 'canonical']
  ])('%s rejects ambiguous %s keys visibly before translating or saving any words', async (action, collision) => {
    const rows = collision === 'exact' ? [
      { wordId: 101, term: '한글ABC', status: 5, translation: 'first meaning' },
      { wordId: 102, term: '한글abc', status: 2, translation: 'second meaning' }
    ] : [
      { wordId: 101, term: '각', status: 5, translation: 'first meaning' },
      { wordId: 102, term: '각', status: 2, translation: 'second meaning' }
    ];
    const preserved = structuredClone(rows);
    seedReader(collision === 'exact' ? '새말 한글AbC.' : '새말 각.', rows);
    vi.stubGlobal('alert', vi.fn());
    vi.spyOn(console, 'error').mockImplementation(() => {});
    renderReader();
    await waitFor(() => expect(screen.getByRole('button', { name: action })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: action }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringMatching(/Ambiguous Korean vocabulary/)));
    expect(screen.getByText(/Ambiguous Korean vocabulary/)).toBeInTheDocument();
    expect(addTermsBatch).not.toHaveBeenCalled();
    expect(batchTranslateWords).not.toHaveBeenCalled();
    expect(updateWord).not.toHaveBeenCalled();
    expect(createWord).not.toHaveBeenCalled();
    expect(rows).toEqual(preserved);
  });
});
