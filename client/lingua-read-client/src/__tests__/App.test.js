import 'fake-indexeddb/auto';
import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../utils/store';
import { authStatus, getUserSettings, getRecentTexts } from '../utils/api';

vi.mock('../utils/api', () => ({
  authStatus: vi.fn(),
  authLogin: vi.fn(),
  authLogout: vi.fn(),
  authSetup: vi.fn(),
  getUserSettings: vi.fn(),
  getRecentTexts: vi.fn(),
  // Home now orchestrates a parallel dashboard load + GoalsCard +
  // ResumeAtLevelSection + ContinueLearningCard, so each of those API calls
  // needs a safe default to keep the test from hitting `undefined()`.
  getDashboard: vi.fn(() => Promise.resolve({ languages: [] })),
  getSrsStats: vi.fn(() => Promise.resolve({ dueCount: 0 })),
  getGoals: vi.fn(() => Promise.resolve([])),
  getTexts: vi.fn(() => Promise.resolve([])),
  getText: vi.fn(() => Promise.resolve({})),
}));

// vi.hoisted gives a stable mock reference that both the module mock factory
// AND the test body can assert against (a plain `vi.fn()` inside the factory
// would be created fresh per-call and unreachable from the test file).
//
// Default: resolve to null (no updateSW available — matches dev/test where
// the virtual:pwa-register module isn't loaded).
const { registerServiceWorkerMock } = vi.hoisted(() => ({
  registerServiceWorkerMock: vi.fn(async () => null),
}));

vi.mock('../utils/offline/registerServiceWorker', () => ({
  registerServiceWorker: registerServiceWorkerMock,
}));

describe('App', () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null, isLoading: true, needsSetup: false });
    authStatus.mockReset();
    getUserSettings.mockReset();
    getRecentTexts.mockReset();
    registerServiceWorkerMock.mockClear();
  });

  test('renders loading then navigation after auth check', async () => {
    authStatus.mockResolvedValue({
      authenticated: true,
      needsSetup: false,
      user: { id: 'user-1', email: 'user@example.com' }
    });
    getUserSettings.mockResolvedValue({});
    getRecentTexts.mockResolvedValue([]);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    // The navbar brand is the first authenticated-shell element to render.
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /LinguaRead/i })).toBeInTheDocument()
    );
    await waitFor(() => expect(getRecentTexts).toHaveBeenCalled());
    // With no dashboard languages AND no recent texts, the new Home falls
    // through to the OnboardingHome takeover.
    await screen.findByTestId('onboarding-home');
  });

  test('registers the PWA service worker on mount (Feature 3)', async () => {
    authStatus.mockResolvedValue({
      authenticated: true, needsSetup: false,
      user: { id: 'user-1', email: 'user@example.com' }
    });
    getUserSettings.mockResolvedValue({});
    getRecentTexts.mockResolvedValue([]);

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(registerServiceWorkerMock).toHaveBeenCalledTimes(1));
  });
});
