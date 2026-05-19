import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import UserSettings from '../pages/UserSettings';
import { SettingsContext } from '../contexts/SettingsContext';
import {
  getUserSettings,
  updateUserSettings,
  getAllLanguages,
  getAudioStorageSize
} from '../utils/api';

vi.mock('../utils/api', () => ({
  getUserSettings: vi.fn(),
  updateUserSettings: vi.fn(),
  getAllLanguages: vi.fn(),
  backupDatabase: vi.fn(),
  restoreDatabase: vi.fn(),
  resetUserStatistics: vi.fn(),
  sendDiscordReport: vi.fn(),
  getAudioStorageSize: vi.fn(),
  getHardcoverStatus: vi.fn(),
  syncAllHardcover: vi.fn(),
  testOpenRouterConnection: vi.fn()
}));

const mockSettings = {
  theme: 'dark',
  textSize: 16,
  textFont: 'default',
  readingUiMode: 'classic',
  readerContentWidth: 740,
  readingDensity: 'balanced',
  showWordInfoPanel: true,
  readerParagraphIndent: true,
  readerTextAlignment: 'left',
  leftPanelWidth: 85,
  autoTranslateWords: true,
  autoTranslateOnOpen: false,
  pauseOnWordClick: false,
  highlightKnownWords: true,
  tooltipOnlyForSavedWords: false,
  sentenceTtsEnabled: false,
  defaultLanguageId: 1,
  translationTargetLanguageCode: 'EN',
  autoAdvanceToNextLesson: false,
  autoMoveFinishedLessons: false,
  showProgressStats: true,
  lineSpacing: 1.5,
  discordWeeklyReportEnabled: false,
  discordWebhookUrl: '',
  discordWeeklyReportDayOfWeek: 'Monday',
  discordWeeklyReportHourLocal: 8,
  discordTimezoneOffsetMinutes: 0,
  hardcoverSyncEnabled: false,
  hasHardcoverApiToken: false,
  hardcoverLastSyncAt: null,
  useOpenRouter: false,
  openRouterApiKey: '',
  openRouterModel: 'google/gemini-2.5-flash-preview-05-20:free'
};

const renderPage = () =>
  render(
    <SettingsContext.Provider
      value={{ settings: mockSettings, updateSetting: vi.fn(), loadingSettings: false }}
    >
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <UserSettings />
      </MemoryRouter>
    </SettingsContext.Provider>
  );

describe('UserSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getUserSettings.mockResolvedValue(mockSettings);
    getAllLanguages.mockResolvedValue([{ languageId: 1, name: 'Spanish' }]);
    getAudioStorageSize.mockResolvedValue({
      totalSizeBytes: 0,
      totalSizeMB: 0,
      totalSizeGB: 0,
      totalFiles: 0
    });
    updateUserSettings.mockResolvedValue(mockSettings);
  });

  test('renders a spinner while loading', () => {
    getUserSettings.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.spinner-border')).toBeInTheDocument();
  });

  test('renders the settings layout after data loads', async () => {
    renderPage();
    expect(await screen.findByText('Settings')).toBeInTheDocument();
    // Sidebar entries
    expect(screen.getByRole('button', { name: /Appearance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reading/i })).toBeInTheDocument();
  });

  test('saves settings when the sticky save bar Save button is clicked after a change', async () => {
    renderPage();
    await screen.findByText('Settings');

    // Toggle a known checkbox to mark hasChanges
    const autoTranslate = document.querySelector('input[name="autoTranslateWords"]');
    fireEvent.click(autoTranslate);

    const saveBtn = await screen.findByRole('button', { name: /Save Settings/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(updateUserSettings).toHaveBeenCalled();
    });
    expect(await screen.findByText(/Settings saved successfully/i)).toBeInTheDocument();
  });

  test('surfaces the error alert when initial settings load fails', async () => {
    getUserSettings.mockRejectedValue(new Error('forbidden'));
    renderPage();
    expect(
      await screen.findByText(/Failed to load settings\. Please try again later\./)
    ).toBeInTheDocument();
  });
});
