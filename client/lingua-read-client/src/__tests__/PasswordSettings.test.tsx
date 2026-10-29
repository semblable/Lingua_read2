import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { vi, test, expect } from 'vitest';
import PasswordSettings from '../components/settings/PasswordSettings';
import { fetchApi } from '../utils/api/client';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn() }));

test('password change submits current password, clears secrets, and explains revoked sessions', async () => {
  vi.mocked(fetchApi).mockResolvedValue({});
  render(<PasswordSettings />);
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-fixture' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  await screen.findByText('Password changed. Other sessions have been signed out.');
  expect(fetchApi).toHaveBeenCalledWith('/auth/change-password', { method: 'POST', body: JSON.stringify({ currentPassword: 'old-fixture', newPassword: 'new-fixture' }) });
  expect(screen.getByLabelText('Current password')).toHaveValue('');
  expect(screen.getByLabelText('New password')).toHaveValue('');
});

test('failed password change displays the server error and permits a retry', async () => {
  vi.mocked(fetchApi).mockRejectedValue(new Error('Current password is incorrect.'));
  render(<PasswordSettings />);
  fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'wrong-fixture' } });
  fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-fixture' } });
  fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
  await screen.findByText('Current password is incorrect.');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Change password' })).not.toBeDisabled());
});
