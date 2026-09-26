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
  const { settings, updateSetting } = useContext(SettingsContext);
  return (
    <>
      <span data-testid="width">{settings.leftPanelWidth}</span>
      <button
        type="button"
        onClick={() => {
          updateSetting('leftPanelWidth', 60);
          updateSetting('paragraphSpacing', 1.6);
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
    getUserSettings.mockReset();
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
    expect(cached().leftPanelWidth).toBe(70);
  });
});
