import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Dashboard from '../pages/Dashboard';
import { getDashboard } from '../utils/api';

vi.mock('../utils/api', () => ({
  getDashboard: vi.fn(),
  // Dashboard renders <GoalsCard /> which loads goals on mount — silence the
  // stderr from that side-effect by mocking the API surface it uses.
  getGoals: vi.fn(() => Promise.resolve([]))
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

  test('renders the empty state when no languages are returned', async () => {
    getDashboard.mockResolvedValue({ languages: [] });
    renderDashboard();
    expect(await screen.findByText(/Your polyglot dashboard is empty/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Add Text/i })).toBeInTheDocument();
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

    expect(await screen.findByText('Polyglot Dashboard')).toBeInTheDocument();
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
});
