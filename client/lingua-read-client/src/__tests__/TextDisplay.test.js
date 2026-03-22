import React, { act } from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';
import { getBookmarkedSentences, toggleBookmark } from '../utils/bookmarks';
import {
  getText,
  createWord,
  updateWord,
  updateLastRead,
  completeLesson,
  getBook,
  translateText,
  translateSentence,
  explainSentence,
  translateFullText,
  updateUserSettings,
  batchTranslateWords,
  addTermsBatch,
  getLanguage,
  getSentenceProgress,
  logSentenceReadActivity
} from '../utils/api';

jest.mock('../utils/api', () => ({
  getText: jest.fn(),
  createWord: jest.fn(),
  updateWord: jest.fn(),
  updateLastRead: jest.fn(),
  completeLesson: jest.fn(),
  getBook: jest.fn(),
  translateText: jest.fn(),
  translateSentence: jest.fn(),
  explainSentence: jest.fn(),
  translateFullText: jest.fn(),
  updateUserSettings: jest.fn(),
  batchTranslateWords: jest.fn(),
  addTermsBatch: jest.fn(),
  getLanguage: jest.fn(),
  getSentenceProgress: jest.fn(),
  logSentenceReadActivity: jest.fn(),
  API_URL: 'http://test.local'
}));

jest.mock('../utils/bookmarks', () => ({
  getBookmarkedSentences: jest.fn(() => []),
  toggleBookmark: jest.fn()
}));

jest.mock('../components/AudiobookPlayer', () => () => <div>Audio Player</div>);

jest.mock('../components/TranslationPopup', () => () => null);

const createSettingsValue = (settingOverrides = {}) => ({
  settings: {
    theme: 'dark',
    textSize: 16,
    textFont: 'sans-serif',
    leftPanelWidth: 85,
    autoTranslateWords: false,
    pauseOnWordClick: false,
    highlightKnownWords: true,
    sentenceMode: false,
    sentenceAudioRepeats: 1,
    defaultLanguageId: 0,
    autoAdvanceToNextLesson: false,
    showProgressStats: true,
    lineSpacing: 1.5,
    ...settingOverrides
  },
  loadingSettings: false,
  errorSettings: null,
  updateSetting: jest.fn(),
  refetchSettings: jest.fn()
});

const renderTextDisplay = (settingOverrides = {}) => render(
  <SettingsContext.Provider value={createSettingsValue(settingOverrides)}>
    <MemoryRouter initialEntries={['/texts/1']}>
      <Routes>
        <Route path="/texts/:textId" element={<TextDisplay />} />
      </Routes>
    </MemoryRouter>
  </SettingsContext.Provider>
);

describe('TextDisplay', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetSelection = window.getSelection;

  beforeAll(() => {
    window.matchMedia = window.matchMedia || function matchMedia() {
      return {
        matches: false,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn()
      };
    };
  });

  beforeEach(() => {
    jest.useFakeTimers();
    getText.mockResolvedValue({
      textId: 1,
      title: 'Sample Text',
      content: 'Hello world.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });
    getBookmarkedSentences.mockReturnValue([]);
    createWord.mockReset();
    updateWord.mockReset();
    updateLastRead.mockReset();
    completeLesson.mockReset();
    getBook.mockReset();
    translateText.mockReset();
    translateSentence.mockReset();
    explainSentence.mockReset();
    translateFullText.mockReset();
    updateUserSettings.mockReset();
    batchTranslateWords.mockReset();
    addTermsBatch.mockReset();
    getLanguage.mockReset();
    getSentenceProgress.mockReset();
    logSentenceReadActivity.mockReset();
    toggleBookmark.mockReset();
    translateText.mockResolvedValue({ translatedText: 'Translated selection' });
    translateSentence.mockResolvedValue({ translatedText: 'Sentence translation' });
    explainSentence.mockResolvedValue({ explanationText: 'Grammar: Greeting.\nNuance: Friendly.\nCulture/Context: None.\nNatural phrasing: Common opener.' });
    getSentenceProgress.mockResolvedValue({
      textId: 1,
      creditedSegmentIndices: [],
      creditedWordCount: 0,
      lastSegmentIndex: 0
    });
    logSentenceReadActivity.mockResolvedValue({
      textId: 1,
      creditedSegmentIndices: [0],
      creditedWordCount: 2,
      lastSegmentIndex: 0
    });
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
    window.matchMedia = originalMatchMedia;
    window.getSelection = originalGetSelection;
  });

  test('renders text content after load', async () => {
    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    expect(await screen.findByText('Sample Text')).toBeInTheDocument();
    expect(await screen.findByText('Hello')).toBeInTheDocument();
  });

  test('clicking a word opens Word Info panel', async () => {
    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    fireEvent.click(word);

    expect(screen.getByText('Word Info')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeInTheDocument();
    expect(screen.getByText(/Untracked/i)).toBeInTheDocument();
  });

  test('mobile selectionchange translates the full selected text', async () => {
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    window.getSelection = jest.fn(() => mockSelection);

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      jest.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(translateText).toHaveBeenCalledWith('Hello world', 'ES', 'EN');
    });
  });

  test('mobile context menu does not toggle bookmarks while selecting', async () => {
    window.matchMedia = jest.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: jest.fn(),
      removeEventListener: jest.fn()
    }));

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const sentence = word.closest('.sentence');
    expect(sentence).not.toBeNull();

    window.getSelection = jest.fn(() => ({
      isCollapsed: false,
      toString: () => 'Hello'
    }));

    fireEvent.contextMenu(sentence);

    expect(toggleBookmark).not.toHaveBeenCalled();
  });

  test('sentence mode navigates sentence by sentence', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Sample Text',
      content: 'Hello world. Another sentence!',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });

    renderTextDisplay({ sentenceMode: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    expect(await screen.findByText('Hello')).toBeInTheDocument();
    expect(screen.queryByText('Another')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Next/i }));

    expect(await screen.findByText('Another')).toBeInTheDocument();
    expect(logSentenceReadActivity).toHaveBeenCalled();
  });

  test('sentence mode shows translation for current sentence', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Sample Text',
      content: 'Hello world.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });

    renderTextDisplay({ sentenceMode: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Show Translation/i }));

    await waitFor(() => {
      expect(translateSentence).toHaveBeenCalledWith('Hello world.', 'ES', 'EN');
    });
    expect(await screen.findByText('Sentence translation')).toBeInTheDocument();
  });

  test('sentence mode shows explanation for current sentence', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Sample Text',
      content: 'Hello world.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });

    renderTextDisplay({ sentenceMode: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Explain Sentence/i }));

    await waitFor(() => {
      expect(explainSentence).toHaveBeenCalledWith('Hello world.', 'ES', 'EN');
    });
    expect(await screen.findByText(/Grammar: Greeting\./i)).toBeInTheDocument();
  });
});
