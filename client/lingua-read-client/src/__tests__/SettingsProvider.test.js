import React, { useContext } from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import { SettingsProvider } from '../contexts/SettingsProvider';
import { SettingsContext } from '../contexts/SettingsContext';
import { getUserSettings } from '../utils/api';

vi.mock('../utils/api', () => ({
  getUserSettings: vi.fn()
}));

// What the reader toolbar does: update the context; the server save goes out separately.
const Probe = () => {
  const { settings, updateSetting, refetchSettings } = useContext(SettingsContext);
  return (
    <>
      <span data-testid="width">{settings.leftPanelWidth}</span>
      <span data-testid="alignment">{settings.readerTextAlignment}</span>
      <span data-testid="theme">{settings.theme}</span>
      <span data-testid="shortcuts">{String(settings.readerCharacterShortcutsEnabled)}</span>
      <span data-testid="markers">{String(settings.readerStatusMarkersEnabled)}</span>
      <button type="button" onClick={refetchSettings}>reload settings</button>
      <button
        type="button"
        onClick={() => {
          updateSetting('leftPanelWidth', 60);
          updateSetting('paragraphSpacing', 1.6);
          updateSetting('readerTextAlignment', 'justify');
        }}
      >
        change
      </button>
    </>
  );
};

const cached = () => JSON.parse(localStorage.getItem('cachedSettings') || '{}');

describe('SettingsProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.className = '';
    getUserSettings.mockReset();
  });

  test('server appearance and accessibility preferences replace cache and survive offline reload', async () => {
    localStorage.setItem('cachedSettings', JSON.stringify({ theme: 'dark', readerCharacterShortcutsEnabled: true }));
    getUserSettings.mockResolvedValue({ theme: 'high-contrast-dark', readerCharacterShortcutsEnabled: false, readerStatusMarkersEnabled: true });
    const { unmount } = render(<SettingsProvider><Probe /></SettingsProvider>);
    // Rendering the settings can precede the effects that apply and cache them.
    await waitFor(() => {
      expect(screen.getByTestId('shortcuts')).toHaveTextContent('false');
      expect(document.body).toHaveClass('high-contrast-dark-theme', 'reader-status-markers');
      expect(localStorage.getItem('theme')).toBe('high-contrast-dark');
      expect(cached().readerCharacterShortcutsEnabled).toBe(false);
      expect(cached().readerStatusMarkersEnabled).toBe(true);
    });
    unmount();

    getUserSettings.mockReturnValue(new Promise(() => {}));
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(screen.getByTestId('shortcuts')).toHaveTextContent('false');
    expect(screen.getByTestId('markers')).toHaveTextContent('true');
    expect(document.body).toHaveClass('high-contrast-dark-theme', 'reader-status-markers');
  });

  test('a change made outside the Settings page survives a reload', async () => {
    getUserSettings.mockResolvedValue({ leftPanelWidth: 80, paragraphSpacing: 1.0 });
    const { unmount } = render(<SettingsProvider><Probe /></SettingsProvider>);
    await waitFor(() => expect(screen.getByTestId('width')).toHaveTextContent('80'));

    fireEvent.click(screen.getByRole('button', { name: 'change' }));

    expect(cached().leftPanelWidth).toBe(60);
    expect(cached().paragraphSpacing).toBe(1.6);
    unmount();

    // The next load starts from the cache while the server request is still out.
    getUserSettings.mockReturnValue(new Promise(() => {}));
    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(screen.getByTestId('width')).toHaveTextContent('60');
  });

  test('the server copy replaces the cached one once it arrives', async () => {
    localStorage.setItem('cachedSettings', JSON.stringify({ leftPanelWidth: 60 }));
    getUserSettings.mockResolvedValue({ leftPanelWidth: 70 });

    render(<SettingsProvider><Probe /></SettingsProvider>);
    expect(screen.getByTestId('width')).toHaveTextContent('60');

    await waitFor(() => expect(screen.getByTestId('width')).toHaveTextContent('70'));
    await waitFor(() => expect(cached().leftPanelWidth).toBe(70));
  });

  test('a delayed settings load preserves toolbar edits made while it was loading', async () => {
    let resolveSettings;
    getUserSettings.mockReturnValue(new Promise(resolve => { resolveSettings = resolve; }));
    render(<SettingsProvider><Probe /></SettingsProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'change' }));
    expect(screen.getByTestId('alignment')).toHaveTextContent('justify');

    resolveSettings({ leftPanelWidth: 80, readerTextAlignment: 'left', theme: 'dark' });
    await waitFor(() => expect(screen.getByTestId('theme')).toHaveTextContent('dark'));
    expect(screen.getByTestId('width')).toHaveTextContent('60');
    expect(screen.getByTestId('alignment')).toHaveTextContent('justify');
    await waitFor(() => expect(cached().readerTextAlignment).toBe('justify'));
  });

  test('an older load cannot overwrite a newer settings refresh', async () => {
    let resolveFirst;
    getUserSettings.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }));
    getUserSettings.mockResolvedValueOnce({ leftPanelWidth: 70, readerTextAlignment: 'justify' });
    render(<SettingsProvider><Probe /></SettingsProvider>);
    fireEvent.click(screen.getByRole('button', { name: 'reload settings' }));
    await waitFor(() => expect(screen.getByTestId('width')).toHaveTextContent('70'));

    resolveFirst({ leftPanelWidth: 80, readerTextAlignment: 'left' });
    await waitFor(() => expect(cached().readerTextAlignment).toBe('justify'));
    expect(screen.getByTestId('width')).toHaveTextContent('70');
  });

  test('preserves srsMaxNewCards = 0, srsNewCardOrder, and srsNewCardsIgnoreReviewLimit across cache reload', async () => {
    const SrsProbe = () => {
      const { settings } = useContext(SettingsContext);
      return (
        <>
          <span data-testid="srs-max-new">{settings.srsMaxNewCards}</span>
          <span data-testid="srs-new-order">{settings.srsNewCardOrder}</span>
          <span data-testid="srs-ignore-limit">{String(settings.srsNewCardsIgnoreReviewLimit)}</span>
        </>
      );
    };
    getUserSettings.mockResolvedValue({
      srsMaxNewCards: 0,
      srsNewCardOrder: 'frequent',
      srsNewCardsIgnoreReviewLimit: true
    });
    const { unmount } = render(<SettingsProvider><SrsProbe /></SettingsProvider>);
    await waitFor(() => {
      expect(screen.getByTestId('srs-max-new')).toHaveTextContent('0');
      expect(screen.getByTestId('srs-new-order')).toHaveTextContent('frequent');
      expect(screen.getByTestId('srs-ignore-limit')).toHaveTextContent('true');
    });
    unmount();

    getUserSettings.mockReturnValue(new Promise(() => {}));
    render(<SettingsProvider><SrsProbe /></SettingsProvider>);
    expect(screen.getByTestId('srs-max-new')).toHaveTextContent('0');
    expect(screen.getByTestId('srs-new-order')).toHaveTextContent('frequent');
    expect(screen.getByTestId('srs-ignore-limit')).toHaveTextContent('true');
  });
});
