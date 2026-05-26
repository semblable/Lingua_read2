import React, { act } from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, createMemoryRouter, RouterProvider } from 'react-router-dom';
import TextDisplay from '../pages/TextDisplay';
import { SettingsContext } from '../contexts/SettingsContext';
import {
  getBookmarkedSentences,
  getLastBookmarkedSentence,
  toggleBookmark
} from '../utils/bookmarks';
import { speakText, cancelSpeech, isSpeechSynthesisSupported } from '../utils/browserTts';
import {
  getText,
  getTextSrt,
  getWordLinkingStatus,
  createWord,
  updateWord,
  deleteWord,
  updateLastRead,
  completeLesson,
  getBook,
  translateText,
  translateSelectionWithContext,
  translateSentence,
  explainSentence,
  translateFullText,
  updateUserSettings,
  batchTranslateWords,
  addTermsBatch,
  getLanguage,
  getAllLanguages,
  summarizeText,
  getSentenceProgress,
  logSentenceReadActivity
} from '../utils/api';

vi.mock('../utils/api', () => ({
  getText: vi.fn(),
  getTextSrt: vi.fn(),
  getWordLinkingStatus: vi.fn(),
  createWord: vi.fn(),
  updateWord: vi.fn(),
  deleteWord: vi.fn(),
  updateLastRead: vi.fn(),
  completeLesson: vi.fn(),
  getBook: vi.fn(),
  translateText: vi.fn(),
  translateSelectionWithContext: vi.fn(),
  translateSentence: vi.fn(),
  explainSentence: vi.fn(),
  translateFullText: vi.fn(),
  updateUserSettings: vi.fn(),
  batchTranslateWords: vi.fn(),
  addTermsBatch: vi.fn(),
  getLanguage: vi.fn(),
  getAllLanguages: vi.fn(),
  summarizeText: vi.fn(),
  getSentenceProgress: vi.fn(),
  logSentenceReadActivity: vi.fn(),
  API_URL: 'http://test.local'
}));

vi.mock('../utils/bookmarks', () => ({
  getBookmarkedSentences: vi.fn(() => []),
  getLastBookmarkedSentence: vi.fn(() => null),
  toggleBookmark: vi.fn()
}));

const mockAudiobookPlayer = vi.fn();

vi.mock('../components/AudiobookPlayer', () => ({
  default: (props) => {
    mockAudiobookPlayer(props);
    return <div>Audio Player</div>;
  }
}));

vi.mock('../components/TranslationPopup', () => ({ default: () => null }));

vi.mock('../utils/browserTts', () => ({
  speakText: vi.fn(() => Promise.resolve()),
  cancelSpeech: vi.fn(),
  isSpeechSynthesisSupported: vi.fn(() => true)
}));

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
    sentenceTtsEnabled: true,
    sentenceTtsRate: 1,
    defaultLanguageId: 0,
    autoAdvanceToNextLesson: false,
    showProgressStats: true,
    lineSpacing: 1.5,
    ...settingOverrides
  },
  loadingSettings: false,
  errorSettings: null,
  updateSetting: vi.fn(),
  refetchSettings: vi.fn()
});

const renderTextDisplay = (settingOverrides = {}) => render(
  <SettingsContext.Provider value={createSettingsValue(settingOverrides)}>
    <MemoryRouter
      initialEntries={['/texts/1']}
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Routes>
        <Route path="/texts/:textId" element={<TextDisplay />} />
      </Routes>
    </MemoryRouter>
  </SettingsContext.Provider>
);

const renderTextDisplayWithRouter = (router, settingOverrides = {}) => render(
  <SettingsContext.Provider value={createSettingsValue(settingOverrides)}>
    <RouterProvider router={router} />
  </SettingsContext.Provider>
);

describe('TextDisplay', () => {
  const originalMatchMedia = window.matchMedia;
  const originalGetSelection = window.getSelection;

  beforeAll(() => {
    window.matchMedia = window.matchMedia || function matchMedia() {
      return {
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      };
    };
  });

  beforeEach(() => {
    vi.useFakeTimers();
    mockAudiobookPlayer.mockClear();
    getText.mockReset();
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
    getLastBookmarkedSentence.mockReturnValue(null);
    createWord.mockReset();
    updateWord.mockReset();
    deleteWord.mockReset();
    updateLastRead.mockReset();
    completeLesson.mockReset();
    getBook.mockReset();
    translateText.mockReset();
    translateSelectionWithContext.mockReset();
    translateSentence.mockReset();
    explainSentence.mockReset();
    translateFullText.mockReset();
    updateUserSettings.mockReset();
    batchTranslateWords.mockReset();
    addTermsBatch.mockReset();
    getLanguage.mockReset();
    getAllLanguages.mockReset();
    summarizeText.mockReset();
    getSentenceProgress.mockReset();
    logSentenceReadActivity.mockReset();
    getTextSrt.mockReset();
    getTextSrt.mockResolvedValue('');
    getWordLinkingStatus.mockReset();
    getWordLinkingStatus.mockResolvedValue({ wordLinkingStatus: null });
    toggleBookmark.mockReset();
    speakText.mockClear();
    cancelSpeech.mockClear();
    isSpeechSynthesisSupported.mockReturnValue(true);
    translateText.mockResolvedValue({ translatedText: 'Translated selection' });
    translateSelectionWithContext.mockResolvedValue({ translatedText: 'Translated selection' });
    translateSentence.mockResolvedValue({ translatedText: 'Sentence translation' });
    getAllLanguages.mockResolvedValue([
      { languageId: 1, code: 'DE', name: 'German' },
      { languageId: 2, code: 'ES', name: 'Spanish' }
    ]);
    summarizeText.mockResolvedValue({ summaryText: 'A concise summary.' });
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
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    window.matchMedia = originalMatchMedia;
    window.getSelection = originalGetSelection;
  });

  test('renders text content after load', async () => {
    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    expect(await screen.findByText('Sample Text')).toBeInTheDocument();
    expect(await screen.findByText('Hello')).toBeInTheDocument();
  });

  test('summarizes the current text in the selected language', async () => {
    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    expect(await screen.findByText('Sample Text')).toBeInTheDocument();
    const summarizeButton = await screen.findByRole('button', { name: 'Summarize' });
    await act(async () => {
      fireEvent.click(summarizeButton);
    });

    expect(await screen.findByRole('heading', { name: 'Summarize Text' })).toBeInTheDocument();
    await waitFor(() => expect(getAllLanguages).toHaveBeenCalled());
    await screen.findByRole('option', { name: 'German' });

    await act(async () => {
      fireEvent.change(screen.getByLabelText('Summary language'), {
        target: { value: 'DE' }
      });
    });
    expect(screen.getByLabelText('Summary language')).toHaveValue('DE');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Generate Summary' }));
    });

    await waitFor(() => {
      expect(summarizeText).toHaveBeenCalledWith('Hello world.', 'ES', 'DE', 200);
    });
    expect(await screen.findByText('A concise summary.')).toBeInTheDocument();
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

  test('deleting a tracked word from Word Info removes it locally', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    deleteWord.mockResolvedValue({});
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Sample Text',
      content: 'Hello world.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [
        { wordId: 1, term: 'Hello', status: 1, translation: 'hola', isNew: true }
      ],
      bookId: null
    });

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Hello'));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(deleteWord).toHaveBeenCalledWith(1));
    await waitFor(() => expect(screen.getByText(/Untracked/i)).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  test('AI Translate reuses highlighted text context', async () => {
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
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
      toString: () => 'Hello world Another',
      getRangeAt: () => ({
        commonAncestorContainer: textContent,
        startContainer: textContent,
        endContainer: textContent,
        startOffset: 999,
        endOffset: 999
      })
    };
    window.getSelection = vi.fn(() => mockSelection);

    act(() => {
      fireEvent.mouseUp(textContent);
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world Another',
        'Hello world. Another sentence!',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    const aiTranslateButton = await screen.findByRole('button', { name: 'AI Translate' });
    await waitFor(() => expect(aiTranslateButton).not.toBeDisabled());
    translateSelectionWithContext.mockClear();
    fireEvent.click(aiTranslateButton);

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world Another',
        'Hello world. Another sentence!',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
  });

  test('mobile touchend translates the full selected text on release', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
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
    window.getSelection = vi.fn(() => mockSelection);

    // selectionchange while dragging — should NOT trigger translation by itself.
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(1000);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    // Release fires touchend on the text container → translation kicks in.
    act(() => {
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
  });

  test('mobile document touchend finalizes native selection handles', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
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
    window.getSelection = vi.fn(() => mockSelection);

    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(1000);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    act(() => {
      fireEvent.touchEnd(document);
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
    expect(await screen.findByText('Word Info')).toBeInTheDocument();
  });

  test('mobile initial long-press selection does not finalize on first selected word', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const noSelection = {
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      toString: () => ''
    };
    const withSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    let currentSelection = noSelection;
    window.getSelection = vi.fn(() => currentSelection);

    act(() => {
      fireEvent.touchStart(textContent);
    });

    currentSelection = withSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(1000);
    });

    expect(translateSelectionWithContext).not.toHaveBeenCalled();
    expect(screen.queryByText('Word Info')).not.toBeInTheDocument();
  });

  test('mobile drag selection finalizes when released', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const noSelection = {
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      toString: () => ''
    };
    const withSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    let currentSelection = noSelection;
    window.getSelection = vi.fn(() => currentSelection);

    act(() => {
      fireEvent.touchStart(textContent);
    });

    currentSelection = withSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      fireEvent.touchMove(textContent);
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
    expect(await screen.findByText('Word Info')).toBeInTheDocument();
  });

  test('mobile drag selection finalizes via stability timer when touchend is suppressed', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const noSelection = {
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      toString: () => ''
    };
    const initialSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    const grownSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    let currentSelection = noSelection;
    window.getSelection = vi.fn(() => currentSelection);

    act(() => {
      fireEvent.touchStart(textContent);
    });

    currentSelection = initialSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(50);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    currentSelection = grownSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(50);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    // No touchend fires (iOS-style suppression). The stability timer should
    // finalize the selection on its own after the user stops adjusting.
    act(() => {
      vi.advanceTimersByTime(700);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
    expect(await screen.findByText('Word Info')).toBeInTheDocument();
  });

  test('mobile repeated touchend for same selection does not loop the Word Info sheet', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
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
    window.getSelection = vi.fn(() => mockSelection);

    // First release — should open the panel and translate.
    act(() => {
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(1000);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText('Word Info')).toBeInTheDocument();

    // Releasing again on the same selection (e.g. tapping after release) must
    // not re-fire translation or flicker the sheet.
    act(() => {
      fireEvent.touchEnd(textContent);
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByText('Word Info')).toBeInTheDocument();
    expect(translateSelectionWithContext).toHaveBeenCalledTimes(1);
  });

  test('mobile selectionchange triggers translation when selection appears after touchend', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const noSelection = {
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      toString: () => ''
    };
    const withSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    let currentSelection = noSelection;
    window.getSelection = vi.fn(() => currentSelection);

    act(() => {
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(220);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    currentSelection = withSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(120);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
  });

  test('mobile collapsed selectionchange does not cancel delayed selection finalization', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const noSelection = {
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      toString: () => ''
    };
    const withSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    let currentSelection = noSelection;
    window.getSelection = vi.fn(() => currentSelection);

    act(() => {
      fireEvent.touchEnd(textContent);
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(220);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    currentSelection = withSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(120);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello world',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
  });

  test('mobile no-selection touch does not leave selectionchange pending', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    const noSelection = {
      isCollapsed: true,
      rangeCount: 0,
      anchorNode: null,
      focusNode: null,
      toString: () => ''
    };
    const withSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: textContent,
      focusNode: textContent,
      toString: () => 'Hello world',
      getRangeAt: () => ({
        commonAncestorContainer: textContent
      })
    };
    let currentSelection = noSelection;
    window.getSelection = vi.fn(() => currentSelection);

    act(() => {
      fireEvent.touchEnd(textContent);
      vi.advanceTimersByTime(800);
    });
    expect(translateSelectionWithContext).not.toHaveBeenCalled();

    currentSelection = withSelection;
    act(() => {
      document.dispatchEvent(new Event('selectionchange'));
      vi.advanceTimersByTime(120);
    });

    expect(translateSelectionWithContext).not.toHaveBeenCalled();
  });

  test('mobile: mouseup with no selection does not toggle the lesson header', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const textContent = word.closest('.text-content');
    expect(textContent).not.toBeNull();

    // Mobile FAB shows "Lesson" while header is hidden, "Hide" when open.
    const fab = screen.getByRole('button', { name: /Open lesson controls/i });
    expect(fab).toHaveTextContent('Lesson');

    // Simulate the path that previously toggled the mobile header: mouseup /
    // touchend on the reading surface with no live selection. Before the fix,
    // processWordSelection() would flip the header. After the fix, it must not.
    window.getSelection = vi.fn(() => ({
      isCollapsed: true,
      rangeCount: 0,
      toString: () => ''
    }));

    act(() => {
      fireEvent.mouseUp(textContent);
      vi.advanceTimersByTime(1000);
    });

    // FAB still says "Lesson" — header did not flip to "Hide".
    expect(screen.getByRole('button', { name: /Open lesson controls/i })).toHaveTextContent('Lesson');
  });

  test('rapid word clicks abort the previous in-flight translation', async () => {
    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const helloWord = await screen.findByText('Hello');
    const worldWord = await screen.findByText('world');

    // Now that the component has rendered, swap translateText to a never-resolving
    // implementation that captures each call's signal. This keeps the first call
    // "in flight" so the second click can abort it.
    const signals = [];
    translateText.mockImplementation((_term, _src, _tgt, opts) => {
      signals.push(opts?.signal);
      return new Promise(() => {}); // never resolves
    });

    await act(async () => { fireEvent.click(helloWord); });
    await waitFor(() => expect(signals).toHaveLength(1));
    expect(signals[0].aborted).toBe(false);

    await act(async () => { fireEvent.click(worldWord); });
    await waitFor(() => expect(signals).toHaveLength(2));

    // First request's signal must be aborted by the second click; the second is live.
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  test('repeating the same word translation hits the cache (no extra API call)', async () => {
    translateText.mockResolvedValue({ translatedText: 'Hola' });

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

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');

    await act(async () => { fireEvent.click(word); });
    await waitFor(() => expect(translateText).toHaveBeenCalledTimes(1));
    await act(async () => { await Promise.resolve(); });

    // Click the same word again — should serve from cache, no new API call.
    await act(async () => { fireEvent.click(word); });
    await act(async () => { await Promise.resolve(); });

    expect(translateText).toHaveBeenCalledTimes(1);
  });

  test('429 from translation surfaces a clear rate-limit message', async () => {
    const err = new Error('Provider rate limit reached.');
    err.status = 429;
    translateText.mockRejectedValueOnce(err);

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');

    await act(async () => { fireEvent.click(word); });
    await act(async () => { await Promise.resolve(); });

    expect(await screen.findByText(/rate limit reached/i)).toBeInTheDocument();
  });

  test('mobile context menu does not toggle bookmarks while selecting', async () => {
    window.matchMedia = vi.fn().mockImplementation(() => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }));

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');
    const sentence = word.closest('.sentence');
    expect(sentence).not.toBeNull();

    window.getSelection = vi.fn(() => ({
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
    expect(await screen.findByText('Grammar')).toBeInTheDocument();
    expect(await screen.findByText('Greeting.')).toBeInTheDocument();
    expect(await screen.findByText('Natural phrasing')).toBeInTheDocument();
  });

  test('normal reading view can speak the current sentence', async () => {
    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByRole('button', { name: /Speak Sentence/i }));

    await waitFor(() => {
      expect(speakText).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Hello world.',
        languageCode: 'ES',
        rate: 1
      }));
    });
  });

  test('word info panel can speak the selected word', async () => {
    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Hello'));
    fireEvent.click(await screen.findByRole('button', { name: /^Speak$/i }));

    await waitFor(() => {
      expect(speakText).toHaveBeenCalledWith(expect.objectContaining({
        text: 'Hello',
        languageCode: 'ES',
        rate: 1
      }));
    });
  });

  test('normal reading view hides TTS controls when disabled', async () => {
    renderTextDisplay({ sentenceTtsEnabled: false });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Hello'));

    expect(screen.queryByRole('button', { name: /Speak Sentence/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Speak$/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/TTS On/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TTS Off/i)).not.toBeInTheDocument();
  });

  test('sentence mode hides TTS controls when disabled', async () => {
    renderTextDisplay({ sentenceMode: true, sentenceTtsEnabled: false });

    await waitFor(() => expect(getText).toHaveBeenCalled());

    expect(screen.queryByRole('button', { name: /Listen/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/TTS On/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/TTS Off/i)).not.toBeInTheDocument();
  });

  test('audio lessons render the offline-download button under the header (Feature 3+)', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Audio Lesson',
      content: 'Hola mundo.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/1.mp3',
      hasSrtContent: true,
      words: [],
      bookId: null
    });
    getTextSrt.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n');

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    await screen.findByText('Audio Lesson');
    expect(await screen.findByTestId('textdisplay-offline-download')).toBeInTheDocument();
  });

  test('non-audio lessons do NOT render the offline-download button', async () => {
    getText.mockResolvedValueOnce({
      textId: 5,
      title: 'Plain text',
      content: 'Hola mundo.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    await screen.findByText('Plain text');
    expect(screen.queryByTestId('textdisplay-offline-download')).not.toBeInTheDocument();
  });

  test('audio lessons force classic UI even when modern mode is enabled', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Audio Lesson',
      content: 'Hola mundo.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/1.mp3',
      hasSrtContent: true,
      words: [],
      bookId: null
    });
    getTextSrt.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n');

    renderTextDisplay({ readingUiMode: 'modern' });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    await screen.findByText('Audio Lesson');

    const wrapper = document.querySelector('.text-display-wrapper');
    expect(wrapper).toHaveClass('reader-ui-classic');
    expect(wrapper).not.toHaveClass('reader-ui-modern');
  });

  test('switching audio lessons does not auto-play a segment during initial restore', async () => {
    let now = 1000;
    vi.spyOn(Date, 'now').mockImplementation(() => {
      now += 1000;
      return now;
    });

    getText
      .mockResolvedValueOnce({
        textId: 1,
        title: 'Lesson One',
        content: 'Hola mundo.',
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: true,
        audioFilePath: 'audio_lessons/1.mp3',
        hasSrtContent: true,
        words: [],
        bookId: null
      })
      .mockResolvedValueOnce({
        textId: 2,
        title: 'Lesson Two',
        content: 'Buenos dias.',
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: true,
        audioFilePath: 'audio_lessons/2.mp3',
        hasSrtContent: true,
        words: [],
        bookId: null
      });
    getTextSrt
      .mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n')
      .mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nBuenos dias.\n');

    getSentenceProgress
      .mockResolvedValueOnce({
        textId: 1,
        creditedSegmentIndices: [],
        creditedWordCount: 0,
        lastSegmentIndex: 0
      })
      .mockResolvedValueOnce({
        textId: 2,
        creditedSegmentIndices: [],
        creditedWordCount: 0,
        lastSegmentIndex: 0
      });

    const router = createMemoryRouter(
      [
        { path: '/texts/:textId', element: <TextDisplay /> }
      ],
      {
        initialEntries: ['/texts/1'],
        future: { v7_startTransition: true, v7_relativeSplatPath: true }
      }
    );

    renderTextDisplayWithRouter(router, { sentenceMode: true });

    const getLatestAudioProps = (textId) => (
      mockAudiobookPlayer.mock.calls
        .map(([props]) => props)
        .filter((props) => String(props.textId) === String(textId))
        .at(-1)
    );

    await waitFor(() => {
      expect(getLatestAudioProps(1)).toBeTruthy();
    });

    expect(getLatestAudioProps(1).segmentPlaybackRequest).toBeNull();

    await act(async () => {
      await router.navigate('/texts/2');
    });

    await waitFor(() => {
      expect(getLatestAudioProps(2)).toBeTruthy();
    });

    const secondProps = getLatestAudioProps(2);
    expect(secondProps.segmentPlaybackRequest).toBeNull();
  });

  test('word click with pauseOnWordClick pauses audio', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Audio Lesson',
      content: 'Hola mundo.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/1.mp3',
      hasSrtContent: true,
      words: [],
      bookId: null
    });
    getTextSrt.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n');

    renderTextDisplay({ pauseOnWordClick: true, autoTranslateWords: false });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hola');

    await act(async () => {
      fireEvent.click(word);
    });

    // Word info panel should appear (word was clicked)
    expect(screen.getByText('Word Info')).toBeInTheDocument();
  });

  test('word click without pauseOnWordClick does not interrupt audio lesson', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Audio Lesson',
      content: 'Hola mundo.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/1.mp3',
      hasSrtContent: true,
      words: [],
      bookId: null
    });
    getTextSrt.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n');

    renderTextDisplay({ pauseOnWordClick: false, autoTranslateWords: false });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hola');

    await act(async () => {
      fireEvent.click(word);
    });

    // Word info panel should still appear
    expect(screen.getByText('Word Info')).toBeInTheDocument();
  });

  test('desktop audio transcript selection triggers contextual translation', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Audio Lesson',
      content: 'Hola mundo.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: true,
      audioFilePath: 'audio_lessons/1.mp3',
      hasSrtContent: true,
      words: [],
      bookId: null
    });
    getTextSrt.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n');

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hola');
    const transcriptContainer = word.closest('.audio-transcript-container');
    expect(transcriptContainer).not.toBeNull();

    const mockSelection = {
      isCollapsed: false,
      rangeCount: 1,
      anchorNode: transcriptContainer,
      focusNode: transcriptContainer,
      removeAllRanges: vi.fn(),
      addRange: vi.fn(),
      toString: () => 'Hola mundo',
      getRangeAt: () => ({
        commonAncestorContainer: transcriptContainer,
        startContainer: transcriptContainer,
        endContainer: transcriptContainer,
        startOffset: 999,
        endOffset: 999
      })
    };
    window.getSelection = vi.fn(() => mockSelection);

    act(() => {
      fireEvent.mouseUp(transcriptContainer);
      vi.advanceTimersByTime(200);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hola mundo',
        'Hola mundo.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });
  });

  test('auto-translate triggers on word click when enabled', async () => {
    translateText.mockResolvedValue({ translatedText: 'Hello' });

    renderTextDisplay({ autoTranslateWords: true });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');

    await act(async () => {
      fireEvent.click(word);
    });

    await waitFor(() => {
      expect(translateText).toHaveBeenCalledWith(
        'Hello',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    // Flush all pending async state updates from the translate callback
    await act(async () => {
      await Promise.resolve();
    });
  });

  test('auto-translate does NOT trigger when disabled', async () => {
    renderTextDisplay({ autoTranslateWords: false });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    const word = await screen.findByText('Hello');

    await act(async () => {
      fireEvent.click(word);
    });

    expect(translateText).not.toHaveBeenCalled();
  });

  // --- Parallel loading optimization tests ---

  test('parallel loading: fetches language config and sentence progress with languageId', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Lesson',
      content: 'Hola mundo.',
      languageId: 5,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [{ wordId: 1, term: 'hola', status: 3, translation: 'hello' }],
      bookId: null
    });
    getLanguage.mockResolvedValueOnce({ languageId: 5, name: 'Spanish', code: 'ES' });
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    );

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    // Text should render while parallel fetches proceed
    expect(await screen.findByText('Lesson')).toBeInTheDocument();

    await waitFor(() => {
      expect(getLanguage).toHaveBeenCalledWith(5);
      expect(getSentenceProgress).toHaveBeenCalledWith(1);
    });

    delete global.fetch;
  });

  test('parallel loading: fetches book data when bookId is present', async () => {
    getText.mockResolvedValueOnce({
      textId: 2,
      title: 'Chapter 1',
      content: 'Content here.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: 10
    });
    updateLastRead.mockResolvedValueOnce({});
    getBook.mockResolvedValueOnce({
      bookId: 10,
      title: 'My Book',
      parts: [
        { textId: 1, title: 'Intro' },
        { textId: 2, title: 'Chapter 1' },
        { textId: 3, title: 'Chapter 2' }
      ]
    });

    renderTextDisplay();

    await waitFor(() => expect(getText).toHaveBeenCalled());
    expect(await screen.findByText('Chapter 1')).toBeInTheDocument();

    await waitFor(() => {
      expect(updateLastRead).toHaveBeenCalledWith(10, 2);
      expect(getBook).toHaveBeenCalledWith(10);
    });
  });

  test('parallel loading: text renders immediately before all fetches complete', async () => {
    // Make parallel fetches hang indefinitely
    let resolveLanguage;
    const languagePromise = new Promise(resolve => { resolveLanguage = resolve; });
    getLanguage.mockReturnValueOnce(languagePromise);
    getSentenceProgress.mockReturnValueOnce(new Promise(() => {})); // never resolves

    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Quick Text',
      content: 'Fast render.',
      languageId: 5,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });
    global.fetch = vi.fn(() => new Promise(() => {})); // fetchAllLanguageWords hangs

    renderTextDisplay();

    // Text should render even though parallel fetches haven't completed
    expect(await screen.findByText('Quick Text')).toBeInTheDocument();
    expect(await screen.findByText('Fast')).toBeInTheDocument();

    // Clean up
    resolveLanguage({ languageId: 5, name: 'Spanish', code: 'ES' });
    delete global.fetch;
  });

  test('parallel loading: handles getLanguage failure gracefully', async () => {
    // Intentional failure path — silence the console.error the component emits
    // so it doesn't pollute CI logs, and assert it was actually called.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Test',
      content: 'Content.',
      languageId: 5,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: null
    });
    getLanguage.mockRejectedValueOnce(new Error('Network error'));
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve([]) })
    );

    renderTextDisplay();

    // getLanguage failure sets error state which shows warning alert
    await waitFor(() => {
      expect(getLanguage).toHaveBeenCalledWith(5);
    });
    expect(await screen.findByText(/Warning: Failed to load language config/)).toBeInTheDocument();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      'Failed to fetch language configuration:',
      expect.any(Error)
    );

    consoleErrorSpy.mockRestore();
    delete global.fetch;
  });

  test('+ AI button appends a context translation alongside the existing one', async () => {
    getText.mockResolvedValueOnce({
      textId: 1,
      title: 'Sample Text',
      content: 'Hello world.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [
        { wordId: 1, term: 'Hello', status: 1, translation: 'first', isNew: false }
      ],
      bookId: null
    });

    renderTextDisplay({ autoTranslateWords: false });

    await waitFor(() => expect(getText).toHaveBeenCalled());
    fireEvent.click(await screen.findByText('Hello'));

    expect(screen.getByText('Word Info')).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText('Translation/Notes (Enter to save)');
    expect(textarea).toHaveValue('first');

    translateSelectionWithContext.mockResolvedValueOnce({ translatedText: 'second' });

    const addButton = await screen.findByRole('button', { name: /Add AI translation/i });
    expect(addButton).not.toBeDisabled();

    await act(async () => {
      fireEvent.click(addButton);
    });

    await waitFor(() => {
      expect(translateSelectionWithContext).toHaveBeenCalledWith(
        'Hello',
        'Hello world.',
        'ES',
        'EN',
        expect.objectContaining({ signal: expect.anything() })
      );
    });

    await waitFor(() => {
      expect(textarea).toHaveValue('first, second');
    });

    // Clicking again with the same translation must not duplicate.
    translateSelectionWithContext.mockResolvedValueOnce({ translatedText: 'second' });
    await act(async () => {
      fireEvent.click(addButton);
    });
    await act(async () => { await Promise.resolve(); });
    expect(textarea).toHaveValue('first, second');
  });

  test('parallel loading: handles getBook failure gracefully', async () => {
    // Intentional failure path — silence the console.error and assert on it.
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    getText.mockResolvedValueOnce({
      textId: 2,
      title: 'Chapter',
      content: 'Book content.',
      languageId: null,
      languageCode: 'ES',
      languageName: 'Spanish',
      isAudioLesson: false,
      words: [],
      bookId: 10
    });
    updateLastRead.mockRejectedValueOnce(new Error('Server error'));

    renderTextDisplay();

    // Should still render text despite book fetch failure
    expect(await screen.findByText('Chapter')).toBeInTheDocument();
    expect(await screen.findByText('Book')).toBeInTheDocument();

    await waitFor(() => {
      expect(updateLastRead).toHaveBeenCalledWith(10, 2);
    });
    await waitFor(() => {
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Failed to get book data:',
        expect.any(Error)
      );
    });

    consoleErrorSpy.mockRestore();
  });

  describe('scroll to bookmark on text load', () => {
    const longText = 'Sentence one. Sentence two. Sentence three. Sentence four. Sentence five.';

    test('scrolls to the last bookmarked sentence on text load', async () => {
      getText.mockResolvedValueOnce({
        textId: 1,
        title: 'Bookmark Test',
        content: longText,
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: false,
        words: [],
        bookId: null
      });
      getLastBookmarkedSentence.mockReturnValue(2);
      const scrollSpy = vi
        .spyOn(window.HTMLElement.prototype, 'scrollIntoView')
        .mockImplementation(() => {});

      renderTextDisplay();

      await waitFor(() => expect(getText).toHaveBeenCalled());
      await screen.findByText('Bookmark Test');

      await waitFor(() => {
        expect(scrollSpy).toHaveBeenCalled();
      });

      // The scrolled element must be the sentence at index 2.
      const scrolledNodes = scrollSpy.mock.instances.filter(
        (node) =>
          node instanceof window.HTMLElement &&
          node.getAttribute('data-sentence-index') === '2'
      );
      expect(scrolledNodes.length).toBeGreaterThan(0);
      expect(scrollSpy).toHaveBeenCalledWith({
        block: 'center',
        behavior: 'smooth'
      });

      scrollSpy.mockRestore();
    });

    test('does not scroll when no bookmark is stored', async () => {
      getText.mockResolvedValueOnce({
        textId: 1,
        title: 'No Bookmark',
        content: longText,
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: false,
        words: [],
        bookId: null
      });
      getLastBookmarkedSentence.mockReturnValue(null);
      const scrollSpy = vi
        .spyOn(window.HTMLElement.prototype, 'scrollIntoView')
        .mockImplementation(() => {});

      renderTextDisplay();

      await waitFor(() => expect(getText).toHaveBeenCalled());
      await screen.findByText('No Bookmark');

      // Give the effect a frame to run if it were going to.
      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      });

      expect(scrollSpy).not.toHaveBeenCalled();
      scrollSpy.mockRestore();
    });

    test('does not re-scroll on subsequent re-renders of the same textId', async () => {
      getText.mockResolvedValue({
        textId: 1,
        title: 'Bookmark Once',
        content: longText,
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: false,
        words: [],
        bookId: null
      });
      getLastBookmarkedSentence.mockReturnValue(1);
      const scrollSpy = vi
        .spyOn(window.HTMLElement.prototype, 'scrollIntoView')
        .mockImplementation(() => {});

      const { rerender } = renderTextDisplay();

      await waitFor(() => expect(getText).toHaveBeenCalled());
      await screen.findByText('Bookmark Once');
      await waitFor(() => expect(scrollSpy).toHaveBeenCalled());

      const callCountAfterFirstLoad = scrollSpy.mock.calls.length;

      // Force a re-render of the same TextDisplay component tree without
      // changing textId. The guard ref should prevent any additional scrolls.
      rerender(
        <SettingsContext.Provider value={createSettingsValue({})}>
          <MemoryRouter
            initialEntries={['/texts/1']}
            future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
          >
            <Routes>
              <Route path="/texts/:textId" element={<TextDisplay />} />
            </Routes>
          </MemoryRouter>
        </SettingsContext.Provider>
      );

      await act(async () => {
        await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      });

      // Within the same textId mount, no additional scroll calls beyond the
      // initial one for the bookmarked sentence.
      expect(scrollSpy.mock.calls.length).toBe(callCountAfterFirstLoad);

      scrollSpy.mockRestore();
    });
  });

  describe('mobile audio player rendering', () => {
    const useMobileViewport = () => {
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: true,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }));
    };

    const findAudiobookCalls = (predicate) =>
      mockAudiobookPlayer.mock.calls
        .map(([props]) => props)
        .filter(predicate);

    test('mobile + audiobook with tracks renders book-mode player wired to the shared audioRef and FAB', async () => {
      useMobileViewport();
      getText.mockResolvedValueOnce({
        textId: 2,
        title: 'Chapter 1',
        content: 'Content here.',
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: false,
        words: [],
        bookId: 10
      });
      updateLastRead.mockResolvedValueOnce({});
      getBook.mockResolvedValueOnce({
        bookId: 10,
        title: 'My Book',
        languageId: 3,
        parts: [{ textId: 2, title: 'Chapter 1' }],
        audiobookTracks: [
          { trackId: 'track-1', filePath: 'audio/track-1.mp3' },
          { trackId: 'track-2', filePath: 'audio/track-2.mp3' }
        ]
      });

      renderTextDisplay();

      await waitFor(() => expect(getBook).toHaveBeenCalledWith(10));
      // The mobile book-mode player must receive the shared audioRef and the
      // playback-state callback so the floating FAB Play/Pause can control it.
      await waitFor(() => {
        const bookCalls = findAudiobookCalls(
          (props) =>
            props.type === 'book' &&
            props.book?.bookId === 10 &&
            props.audioRef != null &&
            typeof props.onPlaybackStateChange === 'function'
        );
        expect(bookCalls.length).toBeGreaterThan(0);
      });

      // FAB Play button is rendered (because hasAudio is true via audiobookTracks).
      expect(screen.getByRole('button', { name: /Play audio/i })).toBeInTheDocument();
    });

    test('mobile + audio lesson renders lesson-mode player (and not book-mode)', async () => {
      useMobileViewport();
      getText.mockResolvedValueOnce({
        textId: 1,
        title: 'Audio Lesson',
        content: 'Hola mundo.',
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: true,
        audioFilePath: 'audio_lessons/1.mp3',
        hasSrtContent: true,
        words: [],
        bookId: null
      });
      getTextSrt.mockResolvedValueOnce('1\n00:00:00,000 --> 00:00:02,000\nHola mundo.\n');

      renderTextDisplay();

      await waitFor(() => expect(getText).toHaveBeenCalled());
      await waitFor(() => {
        const lessonCalls = findAudiobookCalls((props) => props.type === 'lesson');
        expect(lessonCalls.length).toBeGreaterThan(0);
      });

      // The book-mode mobile branch must NOT fire for a pure audio lesson.
      const bookCalls = findAudiobookCalls((props) => props.type === 'book');
      expect(bookCalls.length).toBe(0);
    });

    test('mobile + plain text renders no audio player at all', async () => {
      useMobileViewport();
      // Default getText mock already returns a plain text (isAudioLesson:false, bookId:null).
      renderTextDisplay();

      await waitFor(() => expect(getText).toHaveBeenCalled());
      expect(await screen.findByText('Sample Text')).toBeInTheDocument();

      expect(mockAudiobookPlayer).not.toHaveBeenCalled();
    });

    test('desktop + audiobook does not trigger the mobile book-mode branch', async () => {
      // LessonHeader still renders its own desktop player; that path is covered
      // by LessonHeader.test.js. Here we only assert the new mobile branch in
      // TextDisplay doesn't double-render on desktop.
      window.matchMedia = vi.fn().mockImplementation(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn()
      }));
      getText.mockResolvedValueOnce({
        textId: 2,
        title: 'Chapter 1',
        content: 'Content here.',
        languageId: null,
        languageCode: 'ES',
        languageName: 'Spanish',
        isAudioLesson: false,
        words: [],
        bookId: 10
      });
      updateLastRead.mockResolvedValueOnce({});
      getBook.mockResolvedValueOnce({
        bookId: 10,
        title: 'My Book',
        languageId: 3,
        parts: [{ textId: 2, title: 'Chapter 1' }],
        audiobookTracks: [
          { trackId: 'track-1', filePath: 'audio/track-1.mp3' }
        ]
      });

      renderTextDisplay();

      await waitFor(() => expect(getBook).toHaveBeenCalledWith(10));
      // Wait for at least one render to settle.
      await waitFor(() => {
        expect(
          findAudiobookCalls((props) => props.type === 'book').length
        ).toBeGreaterThan(0);
      });

      // On desktop, every book-mode render comes from LessonHeader, which
      // does NOT pass an `audioRef` or `onPlaybackStateChange`. Only the mobile
      // TextDisplay branch passes those. So a desktop render means no
      // book-mode call has an audioRef, and the sticky mobile container
      // (`.lesson-audio-bar`) is absent from the DOM.
      const bookCallsWithAudioRef = findAudiobookCalls(
        (props) => props.type === 'book' && props.audioRef != null
      );
      expect(bookCallsWithAudioRef.length).toBe(0);
      expect(document.querySelector('.lesson-audio-bar')).toBeNull();
    });
  });
});
