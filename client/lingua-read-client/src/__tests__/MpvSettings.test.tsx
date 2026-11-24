import { beforeEach, describe, expect, test, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import MpvSettings from '../components/settings/MpvSettings';
import { createMpvToken, revokeMpvToken } from '../utils/api';
import { useAuthStore } from '../utils/store';

vi.mock('../utils/api', () => ({
  createMpvToken: vi.fn(),
  revokeMpvToken: vi.fn()
}));

describe('MpvSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ localMode: false });
  });

  test('JWT mode generates mpv config, copies to clipboard, and revokes tokens with session note', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });

    vi.mocked(createMpvToken).mockResolvedValue({
      localMode: false,
      token: 'mpv-jwt-fixture-token',
      expiresAt: '2027-02-20T12:00:00Z'
    });
    vi.mocked(revokeMpvToken).mockResolvedValue({
      message: 'All mpv tokens and other sessions have been revoked.'
    });

    render(<MpvSettings />);

    expect(screen.getByText(/signs out other browser sessions while keeping this browser signed in/i)).toBeInTheDocument();
    expect(screen.getByText(/%APPDATA%\\mpv\.net\\Scripts\\linguaread\.lua/i)).toBeInTheDocument();
    expect(screen.getByText(/~\/\.config\/mpv\/scripts\/linguaread\.lua/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Generate mpv Config' }));
    await waitFor(() => expect(createMpvToken).toHaveBeenCalledTimes(1));

    const configBox = await screen.findByLabelText(/linguaread\.conf/i);
    expect(configBox).toHaveValue(`${window.location.origin ? `api_url=${window.location.origin}` : 'api_url=http://localhost:5000'}\napi_token=mpv-jwt-fixture-token`);
    expect(screen.getByText(/Expires:/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Config' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(
      `api_url=${window.location.origin || 'http://localhost:5000'}\napi_token=mpv-jwt-fixture-token`
    ));
    expect(await screen.findByRole('button', { name: 'Copied Config' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke mpv Tokens' }));
    await waitFor(() => expect(revokeMpvToken).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('All mpv tokens and other sessions have been revoked.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/linguaread\.conf/i)).not.toBeInTheDocument();
  });

  test('displays server error when generating or revoking mpv tokens fails', async () => {
    vi.mocked(createMpvToken).mockRejectedValueOnce(new Error('Token minting failed.'));
    vi.mocked(revokeMpvToken).mockRejectedValueOnce(new Error('Token revoke failed.'));
    render(<MpvSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate mpv Config' }));
    expect(await screen.findByText('Token minting failed.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Revoke mpv Tokens' }));
    expect(await screen.findByText('Token revoke failed.')).toBeInTheDocument();
  });

  test('switches to LocalMode snippet when createMpvToken reports localMode=true and clears stale clipboard errors on retry', async () => {
    const writeText = vi.fn()
      .mockRejectedValueOnce(new Error('Clipboard blocked'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true
    });
    vi.mocked(createMpvToken).mockResolvedValueOnce({
      localMode: true,
      token: '',
      expiresAt: null
    });

    render(<MpvSettings />);

    fireEvent.click(screen.getByRole('button', { name: 'Generate mpv Config' }));
    expect(await screen.findByText('Local mode is enabled; no API token is needed.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Revoke mpv Tokens' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Config' }));
    expect(await screen.findByText(/Could not copy to clipboard/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Copy Config' }));
    expect(await screen.findByRole('button', { name: 'Copied Config' })).toBeInTheDocument();
    expect(screen.queryByText(/Could not copy to clipboard/i)).not.toBeInTheDocument();
  });

  test('LocalMode renders blank-token config immediately and hides Revoke mpv Tokens', () => {
    useAuthStore.setState({ localMode: true });
    render(<MpvSettings />);

    expect(screen.getByText(/Password-free local mode:/i)).toBeInTheDocument();
    const configBox = screen.getByLabelText(/linguaread\.conf/i);
    expect(configBox).toHaveValue(`api_url=${window.location.origin || 'http://localhost:5000'}\napi_token=`);
    expect(screen.queryByRole('button', { name: 'Revoke mpv Tokens' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate mpv Config' })).not.toBeInTheDocument();
  });
});
