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
  cancelQueuedSrsReview,
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
  cancelQueuedSrsReview: vi.fn(),
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
      isLearning: false,
      nextIntervals: [60, 330, 600, 86400]
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
      isLearning: false,
      nextIntervals: [60, 330, 600, 86400]
    }
  ];

  // Server response for a grade that moves the card out of today's session.
  const graduated = (logId) => ({
    queued: false,
    clientEventId: `evt-${logId}`,
    result: { srsReviewLogId: logId, isLearning: false, interval: 1, nextReviewAt: new Date(Date.now() + 86_400_000).toISOString() }
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockLocalStorage.clear();
    getAllLanguages.mockResolvedValue(mockLanguages);
    getSrsStats.mockResolvedValue(mockStats);
    getSrsDueCards.mockResolvedValue(mockCards);
    submitSrsReview.mockResolvedValue(graduated(1));
    undoSrsReview.mockResolvedValue({});
    cancelQueuedSrsReview.mockResolvedValue(true);
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

  it('labels the grade buttons with the intervals the server previewed', async () => {
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);
    fireEvent.click(screen.getByText(/Click or press/));

    expect(await screen.findByRole('button', { name: /Again.*1m/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Hard.*5\.5m/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Good.*10m/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Easy.*1d/ })).toBeInTheDocument();
  });

  it('brings a card back later in the session when it lands on a learning step', async () => {
    submitSrsReview
      .mockResolvedValueOnce({
        queued: false,
        clientEventId: 'evt-1',
        result: {
          srsReviewLogId: 1,
          isLearning: true,
          currentLearningStepIndex: 0,
          nextReviewAt: new Date(Date.now() + 60_000).toISOString(),
          nextIntervals: [60, 330, 600, 86400]
        }
      })
      .mockResolvedValue(graduated(2));
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);

    // gato -> Again: comes back after perro.
    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /Again/ }));
    expect(await screen.findByText(/corre/)).toBeInTheDocument();
    expect(screen.getByText('1/3')).toBeInTheDocument();

    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));

    // Nothing else is left, so gato is shown ahead of its 1-minute step.
    expect(await screen.findByText(/duerme/)).toBeInTheDocument();
    expect(screen.queryByText('Session Complete')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));
    expect(await screen.findByText('Session Complete')).toBeInTheDocument();
    expect(submitSrsReview).toHaveBeenCalledTimes(3);
  });

  it('undo reverts the graded review by its log id and shows that card again', async () => {
    submitSrsReview.mockResolvedValue(graduated(55));
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);
    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));
    await screen.findByText(/corre/);

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));

    await waitFor(() => expect(undoSrsReview).toHaveBeenCalledWith(55));
    expect(await screen.findByText(/duerme/)).toBeInTheDocument();
    expect(cancelQueuedSrsReview).not.toHaveBeenCalled();
  });

  it('undo of a grade still queued offline drops it from the queue instead', async () => {
    submitSrsReview.mockResolvedValue({ queued: true, clientEventId: 'evt-offline' });
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
    await screen.findByText(/duerme/);
    fireEvent.click(screen.getByText(/Click or press/));
    fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));
    await screen.findByText(/corre/);

    fireEvent.click(screen.getByRole('button', { name: /Undo/ }));

    await waitFor(() => expect(cancelQueuedSrsReview).toHaveBeenCalledWith('evt-offline'));
    expect(undoSrsReview).not.toHaveBeenCalled();
    expect(await screen.findByText(/duerme/)).toBeInTheDocument();
  });

  it('saves the FSRS options and rejects a retention outside 0.70-0.97', async () => {
    renderComponent();
    await selectSpanish();
    fireEvent.click(await screen.findByRole('button', { name: /Options/i }));

    fireEvent.change(await screen.findByLabelText('Desired Retention'), { target: { value: '0.99' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));
    expect(await screen.findByText(/between 0.70 and 0.97/)).toBeInTheDocument();
    expect(updateUserSettings).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('Desired Retention'), { target: { value: '0.85' } });
    fireEvent.change(screen.getByLabelText(/Relearning Steps/), { target: { value: '5, 30' } });
    fireEvent.change(screen.getByLabelText(/Next Day Starts At/), { target: { value: '6' } });
    fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalledWith(expect.objectContaining({
        srsDesiredRetention: 0.85,
        srsRelearningStepMinutes: '5, 30',
        srsDayStartHour: 6,
        srsFsrsWeights: ''
      }));
    });
  });

  it("keys heatmap cells by the local calendar date, so today's reviews land on today", async () => {
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    getSrsHeatmap.mockResolvedValue([{ date: today, reviewCount: 3 }]);
    renderComponent();
    await selectSpanish();

    expect(await screen.findByTitle(`${today}: 3 reviews`)).toBeInTheDocument();
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

  describe('card type setting (Feature 1)', () => {
    const renderWithCardType = (cardType) =>
      render(
        <SettingsContext.Provider
          value={{
            settings: { ...mockSettings, srsCardType: cardType },
            updateSetting: vi.fn(),
            loadingSettings: false,
          }}
        >
          <BrowserRouter>
            <SrsReview />
          </BrowserRouter>
        </SettingsContext.Provider>
      );

    const clozeCard = {
      ...mockCards[0],
      clozeSentence: 'El ___ duerme.',
    };

    it('renders the translation card when srsCardType is "translation" (default behavior preserved)', async () => {
      renderComponent();
      await selectSpanish();
      fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
      await screen.findByText(/duerme/);
      expect(screen.getByTestId('translation-review-card')).toBeInTheDocument();
      expect(screen.queryByTestId('cloze-review-card')).not.toBeInTheDocument();
    });

    it('renders the cloze card when srsCardType is "cloze" and the card has a clozeSentence', async () => {
      getSrsDueCards.mockResolvedValue([clozeCard]);
      renderWithCardType('cloze');
      await selectSpanish();
      fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));

      expect(await screen.findByTestId('cloze-review-card')).toBeInTheDocument();
      expect(screen.getByTestId('cloze-sentence')).toHaveTextContent('El ___ duerme.');
      expect(screen.queryByTestId('translation-review-card')).not.toBeInTheDocument();
    });

    it('falls back to the translation card when srsCardType is "cloze" but the card lacks a clozeSentence', async () => {
      const cardWithoutCloze = { ...mockCards[0], clozeSentence: null };
      getSrsDueCards.mockResolvedValue([cardWithoutCloze]);
      renderWithCardType('cloze');
      await selectSpanish();
      fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));

      expect(await screen.findByTestId('translation-review-card')).toBeInTheDocument();
      expect(screen.queryByTestId('cloze-review-card')).not.toBeInTheDocument();
    });

    it('in mixed mode, the card type is not derivable from cardId parity', async () => {
      // Mixed mode uses a per-session random seed XOR'd with the card id and
      // hashed (high bit). The crucial property is that a single observation
      // must NOT let the user predict the other cards via parity — i.e. two
      // adjacent IDs (one even, one odd) must be able to land on the same
      // type. The old `id % 2` and the buggy low-bit hash both split adjacent
      // IDs across cloze/translation deterministically.
      //
      // Pin Math.random to 0.99 — under the high-bit hash this yields the
      // outcome (card 100 → cloze, card 101 → cloze), which is impossible
      // under any parity-derived rule on adjacent IDs.
      const restoreRandom = vi.spyOn(Math, 'random').mockReturnValue(0.99);
      try {
        const first  = { ...mockCards[0], srsCardReviewId: 100, clozeSentence: 'El ___ duerme.' };
        const second = { ...mockCards[1], srsCardReviewId: 101, clozeSentence: 'El ___ corre.' };
        getSrsDueCards.mockResolvedValue([first, second]);

        renderWithCardType('mixed');
        await selectSpanish();
        fireEvent.click(await screen.findByRole('button', { name: /Start Review/i }));
        // First card (even id 100) → cloze under seed≈0.99*2^32.
        expect(await screen.findByTestId('cloze-review-card')).toBeInTheDocument();

        // Grade through to the second card.
        fireEvent.change(screen.getByTestId('cloze-input'), { target: { value: 'gato' } });
        fireEvent.keyDown(screen.getByTestId('cloze-input'), { key: 'Enter' });
        fireEvent.click(await screen.findByRole('button', { name: /^Good/ }));

        // Second card (odd id 101) → also cloze. A parity-derived rule would
        // be forced to split these; the high-bit hash can map them the same.
        expect(await screen.findByTestId('cloze-review-card')).toBeInTheDocument();
      } finally {
        restoreRandom.mockRestore();
      }
    });

    it('settings modal exposes the card-style radio group and persists the choice', async () => {
      const updateSetting = vi.fn();
      render(
        <SettingsContext.Provider
          value={{ settings: mockSettings, updateSetting, loadingSettings: false }}
        >
          <BrowserRouter>
            <SrsReview />
          </BrowserRouter>
        </SettingsContext.Provider>
      );
      await selectSpanish();
      // Open settings modal
      fireEvent.click(await screen.findByRole('button', { name: /Options/i }));

      const group = await screen.findByTestId('srs-card-type-group');
      expect(group).toBeInTheDocument();

      // Switch to cloze
      const clozeRadio = document.getElementById('srs-card-type-cloze');
      fireEvent.click(clozeRadio);

      // Save
      fireEvent.click(screen.getByRole('button', { name: /Save Changes/i }));

      await waitFor(() => {
        expect(updateUserSettings).toHaveBeenCalledWith(
          expect.objectContaining({ srsCardType: 'cloze' })
        );
      });
      expect(updateSetting).toHaveBeenCalledWith('srsCardType', 'cloze');
    });
  });
});
