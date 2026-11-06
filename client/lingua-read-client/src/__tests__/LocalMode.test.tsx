import { beforeEach, expect, test, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useAuthStore } from '../utils/store';
import { authStatus, authLogout } from '../utils/api';
import { clearOfflineState } from '../utils/offline/cleanup';
import Navigation from '../components/Navigation';
import PasswordSettings from '../components/settings/PasswordSettings';

vi.mock('../utils/api', () => ({ authStatus: vi.fn(), authLogin: vi.fn(), authSetup: vi.fn(), authLogout: vi.fn() }));
vi.mock('../utils/offline/cleanup', () => ({ clearOfflineState: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  useAuthStore.setState({ isAuthenticated: false, localMode: false, needsSetup: false, user: null, isLoading: true });
});

test('local status opens the owner session without setup or login and normal status clears local mode', async () => {
  vi.mocked(authStatus).mockResolvedValue({ authenticated: true, localMode: true, needsSetup: false, user: { id: 'owner' } });
  await useAuthStore.getState().checkAuth();
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: true, localMode: true, needsSetup: false, isLoading: false });
  vi.mocked(authStatus).mockResolvedValue({ authenticated: false, needsSetup: true });
  await useAuthStore.getState().checkAuth();
  expect(useAuthStore.getState()).toMatchObject({ isAuthenticated: false, localMode: false, needsSetup: true });
});

test('local account menu explains mode and has no ineffective logout action', () => {
  useAuthStore.setState({ isAuthenticated: true, localMode: true });
  render(<MemoryRouter><Navigation /></MemoryRouter>);
  fireEvent.click(screen.getByText('Account'));
  expect(screen.getByText('Password-free local mode')).toBeInTheDocument();
  expect(screen.queryByText('Logout on all devices')).not.toBeInTheDocument();
  expect(screen.getByText('User Settings')).toBeInTheDocument();
});

test('local password settings explain how to restore authentication instead of showing a password form', () => {
  useAuthStore.setState({ localMode: true });
  render(<PasswordSettings />);
  expect(screen.getByText('Password-free local mode')).toBeInTheDocument();
  expect(screen.getByText(/Existing passwords are preserved/)).toBeInTheDocument();
  expect(screen.queryByLabelText('Current password')).not.toBeInTheDocument();
});

test('stale logout invocation in local mode does not discard pending offline work', async () => {
  useAuthStore.setState({ isAuthenticated: true, localMode: true });
  await useAuthStore.getState().logout();
  expect(authLogout).not.toHaveBeenCalled();
  expect(clearOfflineState).not.toHaveBeenCalled();
  expect(useAuthStore.getState().isAuthenticated).toBe(true);
});
