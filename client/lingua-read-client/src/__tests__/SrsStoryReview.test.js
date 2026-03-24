import React from 'react';
import { render, screen, fireEvent, waitFor, within, waitForElementToBeRemoved } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SrsStoryReview from '../pages/SrsStoryReview';
import { getAllLanguages, getSrsStats, generateSrsStory, submitSrsReview, getWordsByLanguage } from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';
import '@testing-library/jest-dom';

// Mock the API calls
jest.mock('../utils/api', () => ({
  getAllLanguages: jest.fn(),
  getSrsStats: jest.fn(),
  generateSrsStory: jest.fn(),
  submitSrsReview: jest.fn(),
  createWord: jest.fn(),
  getWordsByLanguage: jest.fn(),
  translateSelectionWithContext: jest.fn(),
}));

const mockSettings = {
  translationTargetLanguageCode: 'EN',
  autoTranslateWords: true,
};

// Mock localStorage
const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: jest.fn((key) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: mockLocalStorage
});

describe('SrsStoryReview', () => {
  const mockLanguages = [
    { languageId: 1, name: 'Spanish' },
    { languageId: 2, name: 'French' }
  ];

  const mockStats = {
    dueCount: 15,
    newCards: 5,
    learningCards: 5,
    matureCards: 5,
    currentStreak: 10,
    retentionRate: 85.5
  };

  const mockStoryResult = {
    story: 'El gato rápido corre.',
    textId: 99,
    languageCode: 'es',
    targetWords: [
      { wordId: 10, srsCardReviewId: 101, term: 'gato', translation: 'cat', wordStatus: 3 },
      { wordId: 11, srsCardReviewId: 102, term: 'rápido', translation: 'fast', wordStatus: 2 }
    ],
    usedWords: ['gato', 'rápido']
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getSrsStats.mockResolvedValue(mockStats);
    generateSrsStory.mockResolvedValue(mockStoryResult);
    submitSrsReview.mockResolvedValue({});
    getWordsByLanguage.mockResolvedValue([]);
  });

  const renderComponent = () => render(
    <SettingsContext.Provider value={{ settings: mockSettings, loadingSettings: false }}>
      <BrowserRouter>
        <SrsStoryReview />
      </BrowserRouter>
    </SettingsContext.Provider>
  );

  it('renders setup phase initially with language options', async () => {
    renderComponent();

    // Stats should load eventually if language is pre-selected or manually selected
    // But since localStorage is mocked empty, language is probably empty
    expect(screen.getByText('Story Review')).toBeInTheDocument();
    
    // Wait for languages to be loaded and rendered in select
    const select = await screen.findByLabelText(/Language/i);
    await within(select).findByText('Spanish');
    
    // Generate button should be disabled initially
    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    expect(generateBtn).toBeDisabled();
  });

  it('enables generate button when language is selected and loads stats', async () => {
    renderComponent();
    
    const select = await screen.findByLabelText(/Language/i);
    // Wait for options to be populated
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    // Should load stats on language change
    await waitFor(() => {
      expect(getSrsStats).toHaveBeenCalledWith('1');
    });

    // Check stats are displayed
    expect(await screen.findByText('15')).toBeInTheDocument(); // dueCount
    
    // Generate button should now be enabled - wait for it
    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
  });

  it('progresses to story phase when generate is clicked', async () => {
    renderComponent();
    
    // Select language
    const select = await screen.findByLabelText(/Language/i);
    // Wait for options to be populated
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });
    
    // Wait for button to be enabled before clicking
    const generateBtn = await screen.findByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    // Should enter loading phase briefly (but JS execution is fast, it might skip to story)
    // Wait for the API to resolve and story phase to render
    await waitFor(() => {
      expect(generateSrsStory).toHaveBeenCalledWith(1, expect.any(Object));
    });

    // Story text and words should appear
    expect(await screen.findByText(/El/)).toBeInTheDocument();
    
    // Find 'gato' specifically in the story text to avoid ambiguity with the legend
    const storyText = await screen.findByTestId('srs-story-text');
    expect(within(storyText).getByText('gato')).toHaveClass('srs-story-target-word');
  });

  it('allows grading a word and completes story when all words graded', async () => {
    renderComponent();
    
    // Setup and generate
    const select = await screen.findByLabelText(/Language/i);
    // Wait for options to be populated
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });
    
    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    // Wait for story to render
    await screen.findByText(/El/);
    const storyText = screen.getByTestId('srs-story-text');
    
    const gatoEl = await within(storyText).findByText('gato');
    
    // Click target word
    fireEvent.click(gatoEl);
    
    // Popover should appear (we expect grade buttons inside it)
    const goodButton = await screen.findByRole('button', { name: /Good/i });
    fireEvent.click(goodButton);

    // Verify grading API was called
    await waitFor(() => {
      expect(submitSrsReview).toHaveBeenCalledWith(101, 2);
    });

    // Wait for popover to close before clicking the next word
    await waitForElementToBeRemoved(() => screen.queryByRole('button', { name: /Good/i }));

    // Now grade the second word to complete the story
    const rapidoEl = within(storyText).getByText('rápido');
    fireEvent.click(rapidoEl);
    
    const easyButton = await screen.findByRole('button', { name: /Easy/i });
    fireEvent.click(easyButton);

    // Wait for transition to complete phase
    await waitFor(() => {
      expect(screen.getByText('Story Complete!')).toBeInTheDocument();
    }, { timeout: 1500 }); // There is a 500ms timeout in the component
    
    expect(screen.getByText(/You reviewed/)).toBeInTheDocument();
  });

  // --- Error State Tests ---

  it('shows error and returns to setup when story generation fails', async () => {
    generateSrsStory.mockRejectedValue(new Error('API timeout'));
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    // Should show error alert and return to setup phase
    expect(await screen.findByText(/Failed to generate story: API timeout/)).toBeInTheDocument();
    // Setup phase should still be visible (generate button present)
    expect(screen.getByRole('button', { name: /Generate Story/i })).toBeInTheDocument();
  });

  it('shows error on review failure without losing story phase', async () => {
    submitSrsReview.mockRejectedValue(new Error('Review failed'));
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    // Wait for story
    const storyText = await screen.findByTestId('srs-story-text');
    const gatoEl = within(storyText).getByText('gato');
    fireEvent.click(gatoEl);

    const goodButton = await screen.findByRole('button', { name: /Good/i });
    fireEvent.click(goodButton);

    // Error should appear but story phase should remain
    expect(await screen.findByText(/Failed to submit review: Review failed/)).toBeInTheDocument();
    // Story text should still be visible
    expect(screen.getByTestId('srs-story-text')).toBeInTheDocument();
  });

  it('shows no due words message when story result is empty', async () => {
    generateSrsStory.mockResolvedValue({ story: '', targetWords: [], usedWords: [] });
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    expect(await screen.findByText(/No due words found/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Story/i })).toBeInTheDocument();
  });

  // --- Style Selection Tests ---

  it('includes style in API call when a style is selected', async () => {
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    // Click on "Funny" style badge
    const funnyBadge = screen.getByText('Funny');
    fireEvent.click(funnyBadge);

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(generateSrsStory).toHaveBeenCalledWith(1, expect.objectContaining({
        style: 'Funny'
      }));
    });
  });

  it('toggles style off when clicking same style again', async () => {
    renderComponent();

    await screen.findByLabelText(/Language/i);

    const absurdBadge = screen.getByText('Absurd');
    fireEvent.click(absurdBadge);
    // Click again to deselect
    fireEvent.click(absurdBadge);

    // Select language and generate to verify no style is passed
    const select = screen.getByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(generateSrsStory).toHaveBeenCalledWith(1, expect.objectContaining({
        style: undefined
      }));
    });
  });

  // --- Edge Case Tests ---

  it('transitions to complete phase when "Finish Early" is clicked', async () => {
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    await screen.findByTestId('srs-story-text');

    const finishBtn = screen.getByRole('button', { name: /Finish Early/i });
    fireEvent.click(finishBtn);

    expect(await screen.findByText('Story Complete!')).toBeInTheDocument();
  });

  it('resets to setup phase when "New Story" is clicked', async () => {
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    await screen.findByTestId('srs-story-text');

    const newStoryBtn = screen.getByRole('button', { name: /New Story/i });
    fireEvent.click(newStoryBtn);

    // Should be back in setup phase
    expect(await screen.findByRole('button', { name: /Generate Story/i })).toBeInTheDocument();
  });

  it('shows unused words in "Not in story" section', async () => {
    generateSrsStory.mockResolvedValue({
      story: 'El gato corre.',
      targetWords: [
        { wordId: 10, srsCardReviewId: 101, term: 'gato', translation: 'cat', wordStatus: 3 },
        { wordId: 11, srsCardReviewId: 102, term: 'perro', translation: 'dog', wordStatus: 2 }
      ],
      usedWords: ['gato'] // only gato was used, perro was not
    });
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    await screen.findByTestId('srs-story-text');

    // Should show unused word
    expect(screen.getByText(/Not in story:/)).toBeInTheDocument();
    expect(screen.getByText(/perro/)).toBeInTheDocument();
  });

  it('works with a single target word', async () => {
    generateSrsStory.mockResolvedValue({
      story: 'El gato duerme.',
      targetWords: [
        { wordId: 10, srsCardReviewId: 101, term: 'gato', translation: 'cat', wordStatus: 3 }
      ],
      usedWords: ['gato']
    });
    renderComponent();

    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });

    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
    fireEvent.click(generateBtn);

    const storyText = await screen.findByTestId('srs-story-text');
    const gatoEl = within(storyText).getByText('gato');
    fireEvent.click(gatoEl);

    const goodButton = await screen.findByRole('button', { name: /Good/i });
    fireEvent.click(goodButton);

    // Should complete since there's only one word
    await waitFor(() => {
      expect(screen.getByText('Story Complete!')).toBeInTheDocument();
    }, { timeout: 1500 });
  });
});
