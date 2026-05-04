import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SrsStoryReview from '../pages/SrsStoryReview';
import { getAllLanguages, getSrsStats, generateSrsStory, submitSrsReview, getWordsByLanguage, getSrsStories } from '../utils/api';
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
  getSrsStories: jest.fn(),
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

describe('SrsStoryReview (micro-contexts)', () => {
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

  const mockResult = {
    textId: 99,
    languageCode: 'es',
    microContexts: [
      { wordId: 10, srsCardReviewId: 101, term: 'gato', usedForm: 'gato', translation: 'cat', wordStatus: 3,
        context: 'El gato duerme en el sofá. Está muy tranquilo.' },
      { wordId: 11, srsCardReviewId: 102, term: 'rápido', usedForm: 'rápido', translation: 'fast', wordStatus: 2,
        context: 'El coche es muy rápido en la autopista.' }
    ]
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockLocalStorage.clear();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getSrsStats.mockResolvedValue(mockStats);
    generateSrsStory.mockResolvedValue(mockResult);
    submitSrsReview.mockResolvedValue({});
    getWordsByLanguage.mockResolvedValue([]);
    getSrsStories.mockResolvedValue([]);
  });

  const renderComponent = () => render(
    <SettingsContext.Provider value={{ settings: mockSettings, loadingSettings: false }}>
      <BrowserRouter>
        <SrsStoryReview />
      </BrowserRouter>
    </SettingsContext.Provider>
  );

  const selectSpanish = async () => {
    const select = await screen.findByLabelText(/Language/i);
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });
    return select;
  };

  const generateBtnQuery = { name: /Generate Micro-Contexts/i };

  it('renders setup phase initially with language options', async () => {
    renderComponent();

    expect(screen.getByText('Micro-Context Review')).toBeInTheDocument();

    const select = await screen.findByLabelText(/Language/i);
    await within(select).findByText('Spanish');

    const generateBtn = screen.getByRole('button', generateBtnQuery);
    expect(generateBtn).toBeDisabled();
  });

  it('enables generate button when language is selected and loads stats', async () => {
    renderComponent();
    await selectSpanish();

    await waitFor(() => {
      expect(getSrsStats).toHaveBeenCalledWith('1');
    });
    expect(await screen.findByText('15')).toBeInTheDocument();

    const generateBtn = screen.getByRole('button', generateBtnQuery);
    await waitFor(() => {
      expect(generateBtn).not.toBeDisabled();
    });
  });

  it('progresses to review phase and renders one card per micro-context', async () => {
    renderComponent();
    await selectSpanish();

    const generateBtn = await screen.findByRole('button', generateBtnQuery);
    await waitFor(() => { expect(generateBtn).not.toBeDisabled(); });
    fireEvent.click(generateBtn);

    await waitFor(() => {
      expect(generateSrsStory).toHaveBeenCalledWith(1, expect.objectContaining({
        maxWords: expect.any(Number),
        status: expect.any(Array),
      }));
    });

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    expect(cards).toHaveLength(2);
    // 'gato' appears in both the card header and the highlighted body — assert the highlighted one exists
    const highlighted = within(cards[0]).getAllByText('gato').filter(el => el.classList.contains('srs-microcontext-target'));
    expect(highlighted).toHaveLength(1);
    expect(within(cards[0]).getByText(/duerme/)).toBeInTheDocument();
  });

  it('grades each card via inline buttons and finishes the session', async () => {
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    expect(cards).toHaveLength(2);

    // Reveal first card, then grade "Good" (grade=2)
    fireEvent.click(within(cards[0]).getByTestId('srs-microcontext-reveal'));
    fireEvent.click(within(cards[0]).getByRole('button', { name: /^Good$/ }));
    await waitFor(() => {
      expect(submitSrsReview).toHaveBeenCalledWith(101, 2);
    });

    // First card collapses to a reviewed strip
    await waitFor(() => {
      expect(screen.getAllByTestId('srs-microcontext-reviewed')).toHaveLength(1);
    });

    // Second card still active — reveal then grade "Easy" (grade=3)
    const remainingCards = screen.getAllByTestId('srs-microcontext-card');
    expect(remainingCards).toHaveLength(1);
    fireEvent.click(within(remainingCards[0]).getByTestId('srs-microcontext-reveal'));
    fireEvent.click(within(remainingCards[0]).getByRole('button', { name: /^Easy$/ }));
    await waitFor(() => {
      expect(submitSrsReview).toHaveBeenCalledWith(102, 3);
    });

    // All graded — Finish Review appears
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Finish Review/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Finish Review/i }));

    expect(await screen.findByText('Session Complete!')).toBeInTheDocument();
    expect(screen.getByText(/You reviewed/)).toBeInTheDocument();
  });

  it('shows error and returns to setup when generation fails', async () => {
    generateSrsStory.mockRejectedValue(new Error('API timeout'));
    renderComponent();
    await selectSpanish();

    const generateBtn = screen.getByRole('button', generateBtnQuery);
    await waitFor(() => { expect(generateBtn).not.toBeDisabled(); });
    fireEvent.click(generateBtn);

    expect(await screen.findByText(/Failed to generate micro-contexts: API timeout/)).toBeInTheDocument();
    expect(screen.getByRole('button', generateBtnQuery)).toBeInTheDocument();
  });

  it('shows error on review failure without leaving the review phase', async () => {
    submitSrsReview.mockRejectedValue(new Error('Review failed'));
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    fireEvent.click(within(cards[0]).getByTestId('srs-microcontext-reveal'));
    fireEvent.click(within(cards[0]).getByRole('button', { name: /^Good$/ }));

    expect(await screen.findByText(/Failed to submit review: Review failed/)).toBeInTheDocument();
    // Card stays in review state (not collapsed to reviewed strip)
    expect(screen.queryByTestId('srs-microcontext-reviewed')).not.toBeInTheDocument();
  });

  it('shows a friendly message when no micro-contexts come back', async () => {
    generateSrsStory.mockResolvedValue({ microContexts: [], textId: 0, languageCode: 'es' });
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    expect(await screen.findByText(/No micro-contexts generated/)).toBeInTheDocument();
    expect(screen.getByRole('button', generateBtnQuery)).toBeInTheDocument();
  });

  it('does not send theme/style/tense/maxLength in the request payload', async () => {
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    await waitFor(() => {
      expect(generateSrsStory).toHaveBeenCalled();
    });
    const [, payload] = generateSrsStory.mock.calls[0];
    expect(payload).not.toHaveProperty('theme');
    expect(payload).not.toHaveProperty('style');
    expect(payload).not.toHaveProperty('tense');
    expect(payload).not.toHaveProperty('maxLength');
  });

  it('transitions to complete phase when "Finish Early" is clicked', async () => {
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));
    await screen.findAllByTestId('srs-microcontext-card');

    fireEvent.click(screen.getByRole('button', { name: /Finish Early/i }));
    expect(await screen.findByText('Session Complete!')).toBeInTheDocument();
  });

  it('resets to setup phase when "New Session" is clicked', async () => {
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));
    await screen.findAllByTestId('srs-microcontext-card');

    fireEvent.click(screen.getByRole('button', { name: /New Session/i }));
    expect(await screen.findByRole('button', generateBtnQuery)).toBeInTheDocument();
  });

  it('highlights usedForm verbatim when it differs from the term (clitic case)', async () => {
    generateSrsStory.mockResolvedValue({
      textId: 99,
      languageCode: 'pt',
      microContexts: [
        {
          wordId: 10, srsCardReviewId: 101,
          term: 'lembrar', usedForm: 'lembrei-me',
          translation: 'to remember', wordStatus: 3,
          context: 'Ontem lembrei-me da reunião importante.'
        }
      ]
    });
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    expect(cards).toHaveLength(1);

    // The card should highlight "lembrei-me" exactly (not "lembrar")
    const highlighted = within(cards[0]).getAllByText('lembrei-me')
      .filter(el => el.classList.contains('srs-microcontext-target'));
    expect(highlighted).toHaveLength(1);

    // Header should show both the dictionary term and the inflected form
    expect(within(cards[0]).getByText('lembrar')).toBeInTheDocument();
    // The "→ lembrei-me" hint appears in the header (separate from the highlighted body span)
    expect(within(cards[0]).getByText(/→ lembrei-me/)).toBeInTheDocument();
  });

  it('falls back to highlighting the term when usedForm is missing', async () => {
    generateSrsStory.mockResolvedValue({
      textId: 99,
      languageCode: 'es',
      microContexts: [
        // No usedForm field at all — frontend should highlight the term substring
        { wordId: 10, srsCardReviewId: 101, term: 'gato', translation: 'cat', wordStatus: 3,
          context: 'El gato duerme.' }
      ]
    });
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    const highlighted = within(cards[0]).getAllByText('gato')
      .filter(el => el.classList.contains('srs-microcontext-target'));
    expect(highlighted).toHaveLength(1);
  });

  it('works with a single micro-context', async () => {
    generateSrsStory.mockResolvedValue({
      textId: 99,
      languageCode: 'es',
      microContexts: [
        { wordId: 10, srsCardReviewId: 101, term: 'gato', usedForm: 'gato', translation: 'cat', wordStatus: 3,
          context: 'El gato duerme.' }
      ]
    });
    renderComponent();
    await selectSpanish();

    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    expect(cards).toHaveLength(1);

    fireEvent.click(within(cards[0]).getByTestId('srs-microcontext-reveal'));
    fireEvent.click(within(cards[0]).getByRole('button', { name: /^Good$/ }));
    await waitFor(() => {
      expect(submitSrsReview).toHaveBeenCalledWith(101, 2);
    });

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Finish Review/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /Finish Review/i }));
    expect(await screen.findByText('Session Complete!')).toBeInTheDocument();
  });

  it('hides translation and grade buttons until reveal is clicked', async () => {
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', generateBtnQuery));

    const cards = await screen.findAllByTestId('srs-microcontext-card');
    const firstCard = cards[0];

    // Before reveal: no translation, no grade row, reveal button present
    expect(within(firstCard).queryByTestId('srs-microcontext-translation')).not.toBeInTheDocument();
    expect(within(firstCard).queryByTestId('srs-microcontext-grade-row')).not.toBeInTheDocument();
    expect(within(firstCard).queryByText(/— cat/)).not.toBeInTheDocument();
    expect(within(firstCard).getByTestId('srs-microcontext-reveal')).toBeInTheDocument();

    // Context (with highlighted target) is visible — that's the prompt
    expect(within(firstCard).getByText(/duerme/)).toBeInTheDocument();

    // Click reveal
    fireEvent.click(within(firstCard).getByTestId('srs-microcontext-reveal'));

    // After reveal: translation + grade row appear, reveal button gone
    expect(within(firstCard).getByTestId('srs-microcontext-translation')).toBeInTheDocument();
    expect(within(firstCard).getByText(/— cat/)).toBeInTheDocument();
    expect(within(firstCard).getByTestId('srs-microcontext-grade-row')).toBeInTheDocument();
    expect(within(firstCard).queryByTestId('srs-microcontext-reveal')).not.toBeInTheDocument();

    // The other card stays hidden until its own reveal
    expect(within(cards[1]).queryByTestId('srs-microcontext-translation')).not.toBeInTheDocument();
  });
});
