import 'fake-indexeddb/auto';
import React, { act } from 'react';
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
// the virtual:pwa-register module isn't loaded). Individual tests override
// with mockImplementationOnce when they need to drive the prompt flow.
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

  test('shows the update prompt when the SW signals a new bundle, and reloads on click', async () => {
    authStatus.mockResolvedValue({
      authenticated: true, needsSetup: false,
      user: { id: 'user-1', email: 'user@example.com' }
    });
    getUserSettings.mockResolvedValue({});
    getRecentTexts.mockResolvedValue([]);

    // Capture the onNeedRefresh callback that App passes to the wrapper so
    // we can fire it manually — and return a fake updateSW that the prompt's
    // Reload button should invoke with `true` (skipWaiting + reload).
    let capturedOnNeedRefresh = null;
    const fakeUpdateSW = vi.fn(async () => {});
    registerServiceWorkerMock.mockImplementationOnce(async (opts) => {
      capturedOnNeedRefresh = opts?.onNeedRefresh ?? null;
      return fakeUpdateSW;
    });

    render(
      <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
        <App />
      </MemoryRouter>
    );

    await waitFor(() => expect(registerServiceWorkerMock).toHaveBeenCalled());
    // Wait for the registerServiceWorker promise to resolve so updateSWRef
    // is populated before we click the Reload button.
    await waitFor(() => expect(capturedOnNeedRefresh).toBeTruthy());

    // Prompt is hidden until the SW signals a waiting bundle.
    expect(screen.queryByTestId('app-update-prompt')).not.toBeInTheDocument();

    // Simulate vite-plugin-pwa calling onNeedRefresh.
    act(() => { capturedOnNeedRefresh(); });

    expect(await screen.findByTestId('app-update-prompt')).toBeInTheDocument();

    // Clicking "Reload to update" activates the waiting SW.
    act(() => { screen.getByTestId('app-update-reload').click(); });
    expect(fakeUpdateSW).toHaveBeenCalledWith(true);
  });
});
