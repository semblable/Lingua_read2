import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../pages/Login';
import { useAuthStore } from '../utils/store';

// Mock the store's login action
const mockLogin = vi.fn();

beforeEach(() => {
  mockLogin.mockReset();
  useAuthStore.setState({ login: mockLogin });
});

const renderLogin = () =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Login />
    </MemoryRouter>
  );

describe('Login', () => {
  test('renders password input and submit button', () => {
    renderLogin();
    expect(screen.getByPlaceholderText('Enter your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /log in/i })).toBeInTheDocument();
  });

  test('submit calls login with entered password', async () => {
    mockLogin.mockResolvedValue(undefined);
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'my-secret' }
    });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenCalledWith('my-secret'));
  });

  test('displays error on login failure', async () => {
    mockLogin.mockRejectedValue(new Error('Invalid password.'));
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'wrong' }
    });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(screen.getByText('Invalid password.')).toBeInTheDocument());
  });

  test('shows loading state during login', async () => {
    // Login that never resolves during the test
    let resolveLogin;
    mockLogin.mockImplementation(() => new Promise(r => { resolveLogin = r; }));
    renderLogin();

    fireEvent.change(screen.getByPlaceholderText('Enter your password'), {
      target: { value: 'test' }
    });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /logging in/i })).toBeDisabled();
    });

    // Clean up
    resolveLogin();
  });

  test('clears error on new submission', async () => {
    mockLogin.mockRejectedValueOnce(new Error('Bad password'));
    renderLogin();

    const input = screen.getByPlaceholderText('Enter your password');
    const button = screen.getByRole('button', { name: /log in/i });

    // First attempt: fails
    fireEvent.change(input, { target: { value: 'wrong' } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Bad password')).toBeInTheDocument());

    // Second attempt: error should disappear while loading
    mockLogin.mockResolvedValue(undefined);
    fireEvent.change(input, { target: { value: 'correct' } });
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByText('Bad password')).not.toBeInTheDocument());
  });
});
