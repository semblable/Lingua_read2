import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SrsStoryReview from '../pages/SrsStoryReview';
import { getAllLanguages, getSrsStats, generateSrsStory, submitSrsReview } from '../utils/api';
import '@testing-library/jest-dom';

// Mock the API calls
jest.mock('../utils/api', () => ({
  getAllLanguages: jest.fn(),
  getSrsStats: jest.fn(),
  generateSrsStory: jest.fn(),
  submitSrsReview: jest.fn(),
}));

// Mock localStorage
const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: jest.fn((key) => store[key] || null),
    setItem: jest.fn((key, value) => {
      store[key] = value.toString();
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
    targetWords: [
      { wordId: 10, srsCardReviewId: 101, term: 'gato', translation: 'cat', wordStatus: 3 },
      { wordId: 11, srsCardReviewId: 102, term: 'rápido', translation: 'fast', wordStatus: 2 }
    ],
    usedWords: ['gato', 'rápido']
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getSrsStats.mockResolvedValue(mockStats);
    generateSrsStory.mockResolvedValue(mockStoryResult);
    submitSrsReview.mockResolvedValue({});
  });

  const renderComponent = () => render(
    <BrowserRouter>
      <SrsStoryReview />
    </BrowserRouter>
  );

  it('renders setup phase initially with language options', async () => {
    renderComponent();

    // Stats should load eventually if language is pre-selected or manually selected
    // But since localStorage is mocked empty, language is probably empty
    expect(screen.getByText('Story Review')).toBeInTheDocument();
    
    // Wait for languages to be loaded and rendered in select
    const select = await screen.findByLabelText(/Language/i);
    expect(within(select).getByText('Spanish')).toBeInTheDocument();
    
    // Generate button should be disabled initially
    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    expect(generateBtn).toBeDisabled();
  });

  it('enables generate button when language is selected and loads stats', async () => {
    renderComponent();
    
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });

    // Should load stats on language change
    await waitFor(() => {
      expect(getSrsStats).toHaveBeenCalledWith('1');
    });

    // Check stats are displayed
    expect(screen.getByText('15')).toBeInTheDocument(); // dueCount
    
    // Generate button should now be enabled
    const generateBtn = screen.getByRole('button', { name: /Generate Story/i });
    expect(generateBtn).not.toBeDisabled();
  });

  it('progresses to story phase when generate is clicked', async () => {
    renderComponent();
    
    // Select language
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });
    
    // Click Generate
    const generateBtn = await screen.findByRole('button', { name: /Generate Story/i });
    fireEvent.click(generateBtn);

    // Should enter loading phase briefly (but JS execution is fast, it might skip to story)
    // Wait for the API to resolve and story phase to render
    await waitFor(() => {
      expect(generateSrsStory).toHaveBeenCalledWith(1, expect.any(Object));
    });

    // Story text and words should appear
    expect(await screen.findByText(/El/)).toBeInTheDocument();
    expect(screen.getByText('gato')).toHaveClass('srs-story-target-word');
  });

  it('allows grading a word and completes story when all words graded', async () => {
    renderComponent();
    
    // Setup and generate
    const select = await screen.findByLabelText(/Language/i);
    fireEvent.change(select, { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Story/i }));

    // Wait for story to render
    const wordElements = await screen.findAllByText(/(gato|rápido)/);
    const gatoEl = wordElements.find(el => el.textContent === 'gato');
    
    // Click target word
    fireEvent.click(gatoEl);
    
    // Popover should appear (we expect grade buttons inside it)
    const goodButton = await screen.findByRole('button', { name: /Good/i });
    fireEvent.click(goodButton);

    // Verify grading API was called
    await waitFor(() => {
      expect(submitSrsReview).toHaveBeenCalledWith(101, 2);
    });

    // Now grade the second word to complete the story
    const rapidoEl = wordElements.find(el => el.textContent === 'rápido');
    fireEvent.click(rapidoEl);
    
    const easyButton = await screen.findByRole('button', { name: /Easy/i });
    fireEvent.click(easyButton);

    // Wait for transition to complete phase
    await waitFor(() => {
      expect(screen.getByText('Story Complete!')).toBeInTheDocument();
    }, { timeout: 1500 }); // There is a 500ms timeout in the component
    
    expect(screen.getByText(/You reviewed/)).toBeInTheDocument();
  });
});
