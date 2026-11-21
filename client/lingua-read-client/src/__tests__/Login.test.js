import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Login from '../pages/Login';
import { useAuthStore } from '../utils/store';
import { LoginError } from '../utils/api/auth';

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
    expect(screen.queryByLabelText(/owner recovery code/i)).not.toBeInTheDocument();
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

  test('offers optional owner recovery after the server reports an active lockout', async () => {
    mockLogin.mockRejectedValueOnce(new LoginError('Sign-in is temporarily locked.', true));
    mockLogin.mockResolvedValueOnce(undefined);
    renderLogin();

    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'owner-password' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    const recovery = await screen.findByLabelText(/owner recovery code/i);
    expect(recovery).not.toBeRequired();
    fireEvent.change(recovery, { target: { value: 'owner-code' } });
    fireEvent.click(screen.getByRole('button', { name: /log in/i }));

    await waitFor(() => expect(mockLogin).toHaveBeenLastCalledWith('owner-password', 'owner-code'));
    expect(screen.queryByLabelText(/owner recovery code/i)).not.toBeInTheDocument();
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
