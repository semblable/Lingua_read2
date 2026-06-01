import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Dashboard from '../pages/Dashboard';
import { getDashboard, getTexts } from '../utils/api';

vi.mock('../utils/api', () => ({
  getDashboard: vi.fn(),
  // Dashboard renders <GoalsCard /> which loads goals on mount — silence the
  // stderr from that side-effect by mocking the API surface it uses.
  getGoals: vi.fn(() => Promise.resolve([])),
  // Dashboard renders <ResumeAtLevelSection /> which fetches texts on mount.
  getTexts: vi.fn(() => Promise.resolve([])),
}));

const renderDashboard = () =>
  render(
    <MemoryRouter
      future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
    >
      <Dashboard />
    </MemoryRouter>
  );

describe('Dashboard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('renders a spinner while loading', () => {
    getDashboard.mockReturnValue(new Promise(() => {})); // never resolves
    const { container } = renderDashboard();
    expect(container.querySelector('.spinner-border')).toBeInTheDocument();
  });

  test('renders the OnboardingHome takeover when no languages are returned', async () => {
    getDashboard.mockResolvedValue({ languages: [] });
    renderDashboard();
    // Dashboard now delegates the empty branch to <OnboardingHome />, which
    // shows the LinguaRead welcome and three primary CTAs.
    expect(await screen.findByTestId('onboarding-home')).toBeInTheDocument();
    expect(
      screen.getByRole('heading', { name: /Welcome to LinguaRead/i })
    ).toBeInTheDocument();
    // CTAs are LinkContainer+Button = <a role="button">
    expect(
      screen.getByRole('button', { name: /Add a text/i })
    ).toHaveAttribute('href', '/texts/create');
  });

  test('renders the dashboard with totals when data is present', async () => {
    getDashboard.mockResolvedValue({
      totalKnownWords: 1234,
      totalWordsReadWeek: 5678,
      totalListeningSecondsWeek: 7200,
      totalLanguages: 2,
      languages: [
        { languageId: 1, languageName: 'French', knownWords: 500, totalWords: 1000 },
        { languageId: 2, languageName: 'Spanish', knownWords: 734, totalWords: 1234 }
      ]
    });
    renderDashboard();

    expect(await screen.findByText('Dashboard')).toBeInTheDocument();
    expect(screen.getByText('1,234')).toBeInTheDocument(); // totalKnownWords
    expect(screen.getByText('5,678')).toBeInTheDocument(); // totalWordsReadWeek
    expect(screen.getByText('2h')).toBeInTheDocument(); // 7200 sec = 120 min = 2h
  });

  test('renders an error alert when getDashboard rejects', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getDashboard.mockRejectedValue(new Error('network'));
    renderDashboard();
    expect(
      await screen.findByText(/Failed to load dashboard\. Please try again\./)
    ).toBeInTheDocument();
    consoleSpy.mockRestore();
  });

  test('passes the local timezone offset to getDashboard', async () => {
    getDashboard.mockResolvedValue({ languages: [] });
    renderDashboard();
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(1));
    const [tz] = getDashboard.mock.calls[0];
    expect(typeof tz).toBe('number');
    expect(tz).toBe(-new Date().getTimezoneOffset());
  });

  describe('Resume at your level', () => {
    const sampleLanguages = [
      { languageId: 1, languageName: 'French', knownWords: 500, totalWords: 1000 },
    ];

    test('renders nothing when there are no sweet-spot texts', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        // 50% — too-hard
        { textId: 1, title: 'Hard one', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 50, unknownWordPercentage: 50 },
        // 99% — too-easy
        { textId: 2, title: 'Easy one', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 99, unknownWordPercentage: 1 },
      ]);
      renderDashboard();
      await screen.findByText('Dashboard');
      await waitFor(() => expect(getTexts).toHaveBeenCalled());
      // Section card present (it's the loading or wrapper), but no language sub-block.
      expect(screen.queryByText(/Resume at your level/i)).not.toBeInTheDocument();
    });

    test('surfaces sweet-spot texts ordered by closeness to 94%', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        // 90% sweet-spot
        { textId: 10, title: 'Sweet 90', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 90, unknownWordPercentage: 10 },
        // 95% sweet-spot — closest to target 94
        { textId: 11, title: 'Sweet 95', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
        // 98% sweet-spot
        { textId: 12, title: 'Sweet 98', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 98, unknownWordPercentage: 2 },
        // 99% too-easy — should NOT appear
        { textId: 13, title: 'Easy 99', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 99, unknownWordPercentage: 1 },
        // Sweet-spot but already finished — should NOT appear
        { textId: 14, title: 'Done one', languageName: 'French', isFinished: true,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
      ]);
      renderDashboard();
      expect(await screen.findByText(/Resume at your level/i)).toBeInTheDocument();
      expect(screen.getByText('Sweet 90')).toBeInTheDocument();
      expect(screen.getByText('Sweet 95')).toBeInTheDocument();
      expect(screen.getByText('Sweet 98')).toBeInTheDocument();
      expect(screen.queryByText('Easy 99')).not.toBeInTheDocument();
      expect(screen.queryByText('Done one')).not.toBeInTheDocument();
    });

    test('caps each language at 3 picks', async () => {
      getDashboard.mockResolvedValue({ languages: sampleLanguages });
      getTexts.mockResolvedValue([
        { textId: 20, title: 'A', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 90, unknownWordPercentage: 10 },
        { textId: 21, title: 'B', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 91, unknownWordPercentage: 9 },
        { textId: 22, title: 'C', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 94, unknownWordPercentage: 6 },
        { textId: 23, title: 'D', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
        { textId: 24, title: 'E', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 96, unknownWordPercentage: 4 },
      ]);
      renderDashboard();
      await screen.findByText(/Resume at your level/i);
      // C/D/E are closest to 94 — A and B drop off.
      expect(screen.getByText('C')).toBeInTheDocument();
      expect(screen.getByText('D')).toBeInTheDocument();
      expect(screen.getByText('E')).toBeInTheDocument();
      expect(screen.queryByText('A')).not.toBeInTheDocument();
      expect(screen.queryByText('B')).not.toBeInTheDocument();
    });

    test('groups picks by language with a label per language', async () => {
      getDashboard.mockResolvedValue({
        languages: [
          { languageId: 1, languageName: 'French' },
          { languageId: 2, languageName: 'Spanish' },
        ],
      });
      getTexts.mockResolvedValue([
        { textId: 30, title: 'French Sweet', languageName: 'French', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
        { textId: 31, title: 'Spanish Sweet', languageName: 'Spanish', isFinished: false,
          totalWords: 100, knownWords: 95, unknownWordPercentage: 5 },
      ]);
      renderDashboard();
      await screen.findByText('French Sweet');
      expect(screen.getByTestId('resume-language-French')).toBeInTheDocument();
      expect(screen.getByTestId('resume-language-Spanish')).toBeInTheDocument();
    });
  });
});
