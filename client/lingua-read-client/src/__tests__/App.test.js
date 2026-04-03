import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../utils/store';
import { authStatus, getUserSettings, getRecentTexts } from '../utils/api';

jest.mock('../utils/api', () => ({
  authStatus: jest.fn(),
  authLogin: jest.fn(),
  authLogout: jest.fn(),
  authSetup: jest.fn(),
  getUserSettings: jest.fn(),
  getRecentTexts: jest.fn()
}));

describe('App', () => {
  beforeEach(() => {
    useAuthStore.setState({ isAuthenticated: false, user: null, isLoading: true, needsSetup: false });
    authStatus.mockReset();
    getUserSettings.mockReset();
    getRecentTexts.mockReset();
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

    await waitFor(() => expect(screen.getByText(/LinguaRead/i)).toBeInTheDocument());
    await waitFor(() => expect(getRecentTexts).toHaveBeenCalled());
    await screen.findByText(/No recently read texts found/i);
  });
});
