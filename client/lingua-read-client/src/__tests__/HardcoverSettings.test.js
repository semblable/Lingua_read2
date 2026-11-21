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
    handleChange: vi.fn(),
    testingHardcover: false,
    hardcoverTestResult: null,
    syncingHardcover: false,
    hardcoverSyncMessage: null,
    onTestConnection: vi.fn(),
    onSaveToken: vi.fn(() => Promise.resolve()),
    onClearToken: vi.fn(),
    onSyncAll: vi.fn()
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

  test('Enter in the token field saves the token', async () => {
    const props = renderSettings();
    const input = screen.getByPlaceholderText('Paste your Hardcover API token');

    fireEvent.change(input, { target: { value: 'typed-token' } });
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => expect(props.onSaveToken).toHaveBeenCalledWith('typed-token'));
    await waitFor(() => expect(input).toHaveValue(''));
    expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument();
  });

  test('keeps the typed token when saving it fails', async () => {
    const props = renderSettings({}, { onSaveToken: vi.fn(() => Promise.reject(new Error('401'))) });
    const input = screen.getByPlaceholderText('Paste your Hardcover API token');

    fireEvent.change(input, { target: { value: 'typed-token' } });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));

    await waitFor(() => expect(props.onSaveToken).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /save token/i })).not.toBeDisabled());
    expect(input).toHaveValue('typed-token');
  });

  test('disables sync-all until token exists and sync is enabled', () => {
    renderSettings();
    expect(screen.getByRole('button', { name: /sync all books/i })).toBeDisabled();
  });

  test('does not test unsaved token values', () => {
    renderSettings();

    fireEvent.change(screen.getByPlaceholderText('Paste your Hardcover API token'), {
      target: { value: 'unsaved-token' }
    });

    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
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

  test('links to pre-scoped Hardcover PAT Link Builder URL and documents required scopes', () => {
    renderSettings();

    const link = screen.getByRole('link', { name: /hardcover api settings/i });
    expect(link).toHaveAttribute(
      'href',
      'https://hardcover.app/account/api/keys/new?scope=read:me:content+read:catalog+read:library+write:library'
    );
    expect(screen.getByText('read:me:content')).toBeInTheDocument();
    expect(screen.getByText('read:catalog')).toBeInTheDocument();
    expect(screen.getByText('read:library')).toBeInTheDocument();
    expect(screen.getByText('write:library')).toBeInTheDocument();
  });

  test('shows Saving... and disables related actions while saving token', async () => {
    let resolveSave;
    const onSaveToken = vi.fn(() => new Promise((res) => { resolveSave = res; }));
    renderSettings(
      { hasHardcoverApiToken: true, hardcoverSyncEnabled: true },
      { onSaveToken }
    );

    const input = screen.getByPlaceholderText('Token configured');
    fireEvent.change(input, { target: { value: 'new-token' } });
    fireEvent.click(screen.getByRole('button', { name: /save token/i }));

    expect(screen.getByRole('button', { name: /saving\.\.\./i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear token/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sync all books/i })).toBeDisabled();
    expect(input).toBeDisabled();

    resolveSave();
    await waitFor(() => expect(screen.getByRole('button', { name: /save token/i })).toBeInTheDocument());
    expect(input).toHaveValue('');
  });

  test('disables action buttons while clearing token or syncing', () => {
    const { rerender } = render(
      <HardcoverSettings
        settings={{ ...baseSettings, hasHardcoverApiToken: true, hardcoverSyncEnabled: true }}
        handleChange={vi.fn()}
        testingHardcover={false}
        clearingHardcoverToken={true}
        hardcoverTestResult={null}
        syncingHardcover={false}
        hardcoverSyncMessage={null}
        onTestConnection={vi.fn()}
        onSaveToken={vi.fn()}
        onClearToken={vi.fn()}
        onSyncAll={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /clearing\.\.\./i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /save token/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sync all books/i })).toBeDisabled();

    rerender(
      <HardcoverSettings
        settings={{ ...baseSettings, hasHardcoverApiToken: true, hardcoverSyncEnabled: true }}
        handleChange={vi.fn()}
        testingHardcover={false}
        clearingHardcoverToken={false}
        hardcoverTestResult={null}
        syncingHardcover={true}
        hardcoverSyncMessage={null}
        onTestConnection={vi.fn()}
        onSaveToken={vi.fn()}
        onClearToken={vi.fn()}
        onSyncAll={vi.fn()}
      />
    );

    expect(screen.getByRole('button', { name: /syncing\.\.\./i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear token/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /test connection/i })).toBeDisabled();
  });

  test('shows Testing... and disables Test Connection and Sync All while testing', () => {
    renderSettings(
      { hasHardcoverApiToken: true, hardcoverSyncEnabled: true },
      { testingHardcover: true }
    );

    expect(screen.getByRole('button', { name: /testing\.\.\./i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /sync all books/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear token/i })).not.toBeDisabled();
  });
});
