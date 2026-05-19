import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import SrsReview from '../pages/SrsReview';
import {
  getAllLanguages,
  getSrsStats,
  getSrsDueCards,
  submitSrsReview,
  undoSrsReview,
  getSrsForecast,
  getSrsHeatmap,
  getSrsAnalytics,
  updateUserSettings,
  suspendSrsCard,
  burySrsCard,
  updateSrsCard
} from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';
import '@testing-library/jest-dom';

vi.mock('../utils/api', () => ({
  getAllLanguages: vi.fn(),
  getSrsStats: vi.fn(),
  getSrsDueCards: vi.fn(),
  submitSrsReview: vi.fn(),
  undoSrsReview: vi.fn(),
  getSrsForecast: vi.fn(),
  getSrsHeatmap: vi.fn(),
  getSrsAnalytics: vi.fn(),
  updateUserSettings: vi.fn(),
  suspendSrsCard: vi.fn(),
  burySrsCard: vi.fn(),
  updateSrsCard: vi.fn()
}));

const mockSettings = {
  srsMaxNewCards: 20,
  srsMaxReviews: 100,
  srsReviewOrder: 'mix',
  srsLearningStepMinutes: '1,10',
  srsMaxIntervalDays: 36500,
  srsLapseMinimumIntervalDays: 1
};

const mockLocalStorage = (() => {
  let store = {};
  return {
    getItem: vi.fn((key) => store[key] || null),
    setItem: vi.fn((key, value) => {
      store[key] = value.toString();
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    })
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true });

describe('SrsReview', () => {
  const mockLanguages = [
    { languageId: 1, name: 'Spanish' },
    { languageId: 2, name: 'French' }
  ];

  const mockStats = {
    dueCount: 10,
    reviewableCount: 10,
    newCards: 3,
    learningCards: 4,
    matureCards: 3,
    reviewedToday: 5,
    currentStreak: 7,
    longestStreak: 14,
    retentionRate: 85,
    studiedNewCardsToday: 1,
    maxNewCards: 20,
    studiedReviewsToday: 5,
    maxReviews: 100
  };

  const mockCards = [
    {
      srsCardReviewId: 101,
      wordId: 1,
      term: 'gato',
      translation: 'cat',
      wordStatus: 3,
      phrases: [{ srsPhraseId: 1, sentence: 'El gato duerme.' }],
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      isLearning: false
    },
    {
      srsCardReviewId: 102,
      wordId: 2,
      term: 'perro',
      translation: 'dog',
      wordStatus: 3,
      phrases: [{ srsPhraseId: 2, sentence: 'El perro corre.' }],
      repetitions: 0,
      interval: 0,
      easeFactor: 2.5,
      isLearning: false
    }
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getSrsStats.mockResolvedValue(mockStats);
    getSrsDueCards.mockResolvedValue(mockCards);
    submitSrsReview.mockResolvedValue({});
    undoSrsReview.mockResolvedValue({});
    getSrsForecast.mockResolvedValue([]);
    getSrsHeatmap.mockResolvedValue([]);
    getSrsAnalytics.mockResolvedValue({
      retentionByStatus: [],
      gradeDistribution: [],
      totalReviewsLast30Days: 0,
      avgReviewsPerDay: 0,
      cardsMaturedThisWeek: 0,
      leechCards: []
    });
    updateUserSettings.mockResolvedValue({});
  });

  const renderComponent = () =>
    render(
      <SettingsContext.Provider
        value={{ settings: mockSettings, updateSetting: vi.fn(), loadingSettings: false }}
      >
        <BrowserRouter>
          <SrsReview />
        </BrowserRouter>
      </SettingsContext.Provider>
    );

  const selectSpanish = async () => {
    const select = await screen.findByRole('combobox');
    await waitFor(() => {
      expect(within(select).queryByText('Spanish')).toBeInTheDocument();
    });
    fireEvent.change(select, { target: { value: '1' } });
    return select;
  };

  it('renders setup phase initially with language options and a disabled Start button', async () => {
    renderComponent();
    expect(screen.getByText(/SRS Review/)).toBeInTheDocument();

    const select = await screen.findByRole('combobox');
    await within(select).findByText('Spanish');

    const startBtn = screen.getByRole('button', { name: /Start Review/i });
    expect(startBtn).toBeDisabled();
  });

  it('loads stats and enables Start Review once a language is selected', async () => {
    renderComponent();
    await selectSpanish();

    await waitFor(() => {
      expect(getSrsStats).toHaveBeenCalledWith('1');
    });
    expect(await screen.findByText(/Retention: 85%/)).toBeInTheDocument();

    const startBtn = screen.getByRole('button', { name: /Start Review/i });
    await waitFor(() => expect(startBtn).not.toBeDisabled());
  });

  it('starts a review session with the configured filter and renders the first card', async () => {
    renderComponent();
    await selectSpanish();

    const startBtn = await screen.findByRole('button', { name: /Start Review/i });
    await waitFor(() => expect(startBtn).not.toBeDisabled());
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(getSrsDueCards).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({
          status: [1, 2, 3, 4, 5],
          onlyOneTarget: false,
          limit: 50
        })
      );
    });

    // First card sentence is visible (use a non-highlighted word to avoid span splitting)
    expect(await screen.findByText(/duerme/)).toBeInTheDocument();
    // Reveal hint is shown before flip
    expect(screen.getByText(/Click or press/)).toBeInTheDocument();
  });

  it('reveals translation and grade buttons after flipping the card', async () => {
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);

    // Click the reveal hint area (bubbles to the flip handler)
    fireEvent.click(screen.getByText(/Click or press/));

    expect(await screen.findByText('cat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Again/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Hard/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Good/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Easy/ })).toBeInTheDocument();
  });

  it('submits a grade and advances to the next card', async () => {
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);
    fireEvent.click(screen.getByText(/Click or press/));

    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));
    await waitFor(() => {
      expect(submitSrsReview).toHaveBeenCalledWith(101, 2);
    });

    // Next card visible
    expect(await screen.findByText(/corre/)).toBeInTheDocument();
  });

  it('completes the session after grading the final card', async () => {
    getSrsDueCards.mockResolvedValue([mockCards[0]]);
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);
    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));

    expect(await screen.findByText('Session Complete')).toBeInTheDocument();
    expect(screen.getByText(/You reviewed/)).toBeInTheDocument();
  });

  it('jumps directly to the complete screen when there are no cards due', async () => {
    getSrsDueCards.mockResolvedValue([]);
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));

    expect(await screen.findByText('Session Complete')).toBeInTheDocument();
  });

  it('shows an error and stays in setup when the due-cards fetch rejects', async () => {
    getSrsDueCards.mockRejectedValue(new Error('timeout'));
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));

    expect(await screen.findByText(/Failed to load cards: timeout/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Start Review/i })).toBeInTheDocument();
  });

  it('shows an error and stays in review when submitSrsReview rejects', async () => {
    submitSrsReview.mockRejectedValue(new Error('grade error'));
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);
    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));

    expect(await screen.findByText(/Failed to submit review: grade error/)).toBeInTheDocument();
    // First card still visible (no advance on failure)
    expect(screen.getByText(/duerme/)).toBeInTheDocument();
  });

  it('returns to setup when End is clicked during review', async () => {
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);

    fireEvent.click(screen.getByRole('button', { name: /^End$/ }));

    expect(await screen.findByRole('button', { name: /Start Review/i })).toBeInTheDocument();
  });

  it('passes the trimmed status filter through to getSrsDueCards when a status is unchecked', async () => {
    renderComponent();
    await selectSpanish();

    // Uncheck the "Known" status (status 5). Form.Check renders a label whose
    // visible content is a <Badge>, so role+name name-calculation skips it;
    // grab the input by id instead.
    const knownCheckbox = document.getElementById('srs-status-5');
    fireEvent.click(knownCheckbox);

    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await waitFor(() => {
      expect(getSrsDueCards).toHaveBeenCalledWith(
        '1',
        expect.objectContaining({ status: [1, 2, 3, 4] })
      );
    });
  });
});
