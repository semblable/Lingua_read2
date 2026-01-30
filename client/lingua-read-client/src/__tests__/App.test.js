import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { useAuthStore } from '../utils/store';
import { login, getUserSettings, getRecentTexts } from '../utils/api';
import { jwtDecode } from 'jwt-decode';

jest.mock('../utils/api', () => ({
  login: jest.fn(),
  getUserSettings: jest.fn(),
  getRecentTexts: jest.fn()
}));

jest.mock('jwt-decode', () => ({
  jwtDecode: jest.fn()
}));

describe('App', () => {
  beforeEach(() => {
    localStorage.clear();
    useAuthStore.setState({ token: null, user: null });
    login.mockReset();
    getUserSettings.mockReset();
    getRecentTexts.mockReset();
    jwtDecode.mockReset();
  });

  test('renders loading then navigation after auto-login', async () => {
    login.mockResolvedValue({ token: 'test-token' });
    jwtDecode.mockReturnValue({
      exp: Date.now() / 1000 + 3600,
      sub: 'user-1',
      email: 'user@example.com'
    });
    getUserSettings.mockResolvedValue({});
    getRecentTexts.mockResolvedValue([]);

    render(
      <MemoryRouter>
        <App />
      </MemoryRouter>
    );

    expect(screen.getByText(/loading/i)).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/LinguaRead/i)).toBeInTheDocument());
  });
});
