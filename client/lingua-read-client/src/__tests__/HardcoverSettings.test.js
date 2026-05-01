import React from 'react';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import HardcoverSettings from '../components/settings/HardcoverSettings';

const baseSettings = {
  hardcoverSyncEnabled: false,
  hasHardcoverApiToken: false,
  hardcoverLastSyncAt: null
};

const renderSettings = (overrides = {}, props = {}) => {
  const defaultProps = {
    settings: { ...baseSettings, ...overrides },
    handleChange: jest.fn(),
    testingHardcover: false,
    hardcoverTestResult: null,
    syncingHardcover: false,
    hardcoverSyncMessage: null,
    onTestConnection: jest.fn(),
    onSaveToken: jest.fn(() => Promise.resolve()),
    onClearToken: jest.fn(),
    onSyncAll: jest.fn()
  };

  const mergedProps = { ...defaultProps, ...props };
  render(<HardcoverSettings {...mergedProps} />);
  return mergedProps;
};

describe('HardcoverSettings', () => {
  test('keeps token write-only and saves explicit token value', async () => {
    const props = renderSettings({ hasHardcoverApiToken: true });

    expect(screen.getByPlaceholderText('Token configured')).toHaveValue('');
    fireEvent.change(screen.getByPlaceholderText('Token configured'), {
      target: { value: 'hardcover-token' }
    });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));

    await waitFor(() => expect(props.onSaveToken).toHaveBeenCalledWith('hardcover-token'));
    await waitFor(() => expect(screen.getByPlaceholderText('Token configured')).toHaveValue(''));
  });

  test('disables sync-all until token exists and sync is enabled', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /sync all books/i })).toBeDisabled();
  });

  test('enables sync-all and clear when configured', () => {
    const props = renderSettings({
      hasHardcoverApiToken: true,
      hardcoverSyncEnabled: true
    });

    fireEvent.click(screen.getByRole('button', { name: /sync all books/i }));
    fireEvent.click(screen.getByRole('button', { name: /clear token/i }));

    expect(props.onSyncAll).toHaveBeenCalledTimes(1);
    expect(props.onClearToken).toHaveBeenCalledTimes(1);
  });

  test('shows connection and sync feedback', () => {
    renderSettings(
      { hasHardcoverApiToken: true, hardcoverSyncEnabled: true },
      {
        hardcoverTestResult: {
          connected: true,
          message: 'Connection successful.',
          username: 'reader'
        },
        hardcoverSyncMessage: {
          type: 'success',
          text: 'Synced 3 books.'
        }
      }
    );

    expect(screen.getByText('Connection successful.')).toBeInTheDocument();
    expect(screen.getByText('Connected as reader')).toBeInTheDocument();
    expect(screen.getByText('Synced 3 books.')).toBeInTheDocument();
  });

  test('toggle delegates to settings change handler', () => {
    const props = renderSettings();

    fireEvent.click(screen.getByLabelText(/enable automatic hardcover progress sync/i));

    expect(props.handleChange).toHaveBeenCalledTimes(1);
  });
});
