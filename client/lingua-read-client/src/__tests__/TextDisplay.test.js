import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';
import { getBookmarkedSentences } from '../utils/bookmarks';
import {
  getText,
  createWord,
  updateWord,
  updateLastRead,
  completeLesson,
  getBook,
  translateText,
  translateFullText,
  updateUserSettings,
  batchTranslateWords,
  addTermsBatch,
  getLanguage
} from '../utils/api';

jest.mock('../utils/api', () => ({
  getText: jest.fn(),
  createWord: jest.fn(),
  updateWord: jest.fn(),
  updateLastRead: jest.fn(),
  completeLesson: jest.fn(),
  getBook: jest.fn(),
  translateText: jest.fn(),
  translateFullText: jest.fn(),
  updateUserSettings: jest.fn(),
  batchTranslateWords: jest.fn(),
  addTermsBatch: jest.fn(),
  getLanguage: jest.fn(),
  API_URL: 'http://test.local'
}));

jest.mock('../utils/bookmarks', () => ({
  getBookmarkedSentences: jest.fn(() => []),
  toggleBookmark: jest.fn()
}));

jest.mock('../components/AudiobookPlayer', () => () => <div>Audio Player</div>);

jest.mock('../components/TranslationPopup', () => () => null);

const settingsValue = {
  settings: {
    theme: 'dark',
    textSize: 16,
    textFont: 'sans-serif',
    leftPanelWidth: 85,
    autoTranslateWords: false,
    pauseOnWordClick: false,
    highlightKnownWords: true,
    defaultLanguageId: 0,
    autoAdvanceToNextLesson: false,
    showProgressStats: true,
    lineSpacing: 1.5
  },
  loadingSettings: false,
  errorSettings: null,
  updateSetting: jest.fn(),
  refetchSettings: jest.fn()
};

const renderTextDisplay = () => render(
  <SettingsContext.Provider value={settingsValue}>
    <MemoryRouter initialEntries={['/texts/1']}>
      <Routes>
        <Route path="/texts/:textId" element={<TextDisplay />} />
      </Routes>
    </MemoryRouter>
  </SettingsContext.Provider>
);

describe('TextDisplay', () => {
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
    translateFullText.mockReset();
    updateUserSettings.mockReset();
    batchTranslateWords.mockReset();
    addTermsBatch.mockReset();
    getLanguage.mockReset();
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
});
