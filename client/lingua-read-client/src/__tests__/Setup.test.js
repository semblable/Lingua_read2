import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Setup from '../pages/Setup';
import { useAuthStore } from '../utils/store';

const mockSetup = jest.fn();

beforeEach(() => {
  mockSetup.mockReset();
  useAuthStore.setState({ setup: mockSetup });
});

const renderSetup = () =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Setup />
    </MemoryRouter>
  );

describe('Setup', () => {
  test('renders password, confirm fields, and submit button', () => {
    renderSetup();
    expect(screen.getByPlaceholderText('Choose a password')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Confirm your password')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /set password/i })).toBeInTheDocument();
  });

  test('rejects password under 6 characters', async () => {
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('Choose a password'), {
      target: { value: '12345' }
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
      target: { value: '12345' }
    });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() =>
      expect(screen.getByText('Password must be at least 6 characters.')).toBeInTheDocument()
    );
    expect(mockSetup).not.toHaveBeenCalled();
  });

  test('rejects mismatched passwords', async () => {
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('Choose a password'), {
      target: { value: 'password123' }
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
      target: { value: 'password456' }
    });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() =>
      expect(screen.getByText('Passwords do not match.')).toBeInTheDocument()
    );
    expect(mockSetup).not.toHaveBeenCalled();
  });

  test('calls setup on valid submission', async () => {
    mockSetup.mockResolvedValue(undefined);
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('Choose a password'), {
      target: { value: 'SecurePass123' }
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
      target: { value: 'SecurePass123' }
    });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(mockSetup).toHaveBeenCalledWith('SecurePass123'));
  });

  test('displays error on setup failure', async () => {
    mockSetup.mockRejectedValue(new Error('Server error'));
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('Choose a password'), {
      target: { value: 'SecurePass123' }
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
      target: { value: 'SecurePass123' }
    });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => expect(screen.getByText('Server error')).toBeInTheDocument());
  });

  test('shows loading state during setup', async () => {
    let resolveSetup;
    mockSetup.mockImplementation(() => new Promise(r => { resolveSetup = r; }));
    renderSetup();

    fireEvent.change(screen.getByPlaceholderText('Choose a password'), {
      target: { value: 'SecurePass123' }
    });
    fireEvent.change(screen.getByPlaceholderText('Confirm your password'), {
      target: { value: 'SecurePass123' }
    });
    fireEvent.click(screen.getByRole('button', { name: /set password/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /setting up/i })).toBeDisabled();
    });

    resolveSetup();
  });
});
