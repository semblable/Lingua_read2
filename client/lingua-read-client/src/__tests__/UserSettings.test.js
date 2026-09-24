import React from 'react';
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import UserSettings from '../pages/UserSettings';
import { SettingsContext } from '../contexts/SettingsContext';
import {
  getUserSettings,
  updateUserSettings,
  getAllLanguages,
  getAudioStorageSize,
  testOpenRouterConnection
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
  hasDiscordWebhookUrl: false,
  discordWeeklyReportDayOfWeek: 'Monday',
  discordWeeklyReportHourLocal: 8,
  discordTimezoneOffsetMinutes: 0,
  hasWiktionaryAccessToken: false,
  hasAzureTranslatorKey: false,
  hasGoogleTranslateApiKey: false,
  hardcoverSyncEnabled: false,
  hasHardcoverApiToken: false,
  hardcoverLastSyncAt: null,
  useOpenRouter: false,
  hasOpenRouterApiKey: false,
  openRouterModel: 'google/gemini-2.5-flash-preview-05-20:free'
};

// The PUT is a partial update: the server applies what was sent and returns the full settings.
const echoSave = async (body) => ({ ...mockSettings, ...body });

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

let updateSetting;

const renderPage = () =>
  render(
    <SettingsContext.Provider
      value={{ settings: mockSettings, updateSetting, loadingSettings: false }}
    >
      <MemoryRouter
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <UserSettings />
      </MemoryRouter>
    </SettingsContext.Provider>
  );

const field = (name) => document.querySelector(`[name="${name}"]`);
const sectionOf = (element) => within(element.closest('.settings-section-card'));
const sleep = (ms) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

describe('UserSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    document.body.className = '';
    updateSetting = vi.fn();
    getUserSettings.mockResolvedValue(mockSettings);
    getAllLanguages.mockResolvedValue([{ languageId: 1, name: 'Spanish' }]);
    getAudioStorageSize.mockResolvedValue({
      totalSizeBytes: 0,
      totalSizeMB: 0,
      totalSizeGB: 0,
      totalFiles: 0
    });
    updateUserSettings.mockImplementation(echoSave);
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
    expect(screen.getByText(/Changes are saved automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Settings/i })).not.toBeInTheDocument();
  });

  test('saves a toggled switch by itself, sending only that field', async () => {
    renderPage();
    await screen.findByText('Settings');

    fireEvent.click(field('autoTranslateWords'));

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(1));
    expect(updateUserSettings).toHaveBeenCalledWith({ autoTranslateWords: false });
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    expect(updateSetting).toHaveBeenCalledWith('autoTranslateWords', false);
    expect(localStorage.getItem('autoTranslateWords')).toBe('false');
    expect(JSON.parse(localStorage.getItem('cachedSettings')).autoTranslateWords).toBe(false);
  });

  test('sends nothing when a switch is flipped back before it saves', async () => {
    renderPage();
    await screen.findByText('Settings');

    fireEvent.click(field('autoTranslateWords'));
    fireEvent.click(field('autoTranslateWords'));
    await sleep(400);

    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  test('saves typing once, after a pause, with the final text', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, useOpenRouter: true });
    renderPage();
    await screen.findByText('Settings');

    const model = field('openRouterModel');
    fireEvent.change(model, { target: { value: 'a' } });
    fireEvent.change(model, { target: { value: 'an' } });
    fireEvent.change(model, { target: { value: 'anthropic/claude' } });
    await sleep(300);
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(updateUserSettings).toHaveBeenCalledWith({ openRouterModel: 'anthropic/claude' });
  });

  test('saves a text edit as soon as the field loses focus', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, useOpenRouter: true });
    renderPage();
    await screen.findByText('Settings');

    const model = field('openRouterModel');
    fireEvent.change(model, { target: { value: 'openai/gpt' } });
    fireEvent.blur(model);

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledWith({ openRouterModel: 'openai/gpt' }), { timeout: 300 });
  });

  test('does not save a half-typed timezone offset as 0', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, discordTimezoneOffsetMinutes: 120 });
    renderPage();
    await screen.findByText('Settings');

    const offset = field('discordTimezoneOffsetMinutes');
    fireEvent.change(offset, { target: { value: '' } });
    fireEvent.blur(offset);
    await sleep(200);
    expect(updateUserSettings).not.toHaveBeenCalled();

    fireEvent.change(offset, { target: { value: '-300' } });
    fireEvent.blur(offset);
    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledWith({ discordTimezoneOffsetMinutes: -300 }));
  });

  test('sends a change made while a save is running right after it, not alongside', async () => {
    const first = deferred();
    updateUserSettings.mockImplementationOnce(() => first.promise);
    renderPage();
    await screen.findByText('Settings');

    fireEvent.click(field('autoTranslateWords'));
    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(1));

    fireEvent.click(field('pauseOnWordClick'));
    await sleep(300);
    expect(updateUserSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ ...mockSettings, autoTranslateWords: false });
    });

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(2));
    expect(updateUserSettings).toHaveBeenLastCalledWith({ pauseOnWordClick: true });
  });

  test('shows a failed save with Retry, which sends it again', async () => {
    updateUserSettings.mockRejectedValueOnce(new Error('Network down'));
    renderPage();
    await screen.findByText('Settings');

    fireEvent.click(field('autoTranslateWords'));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent("Couldn't save your changes: Network down");
    expect(updateSetting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(2));
    expect(updateUserSettings).toHaveBeenLastCalledWith({ autoTranslateWords: false });
    expect(await screen.findByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save your changes/)).not.toBeInTheDocument();
  });

  test('saves a change still waiting when the page is left', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, useOpenRouter: true });
    const { unmount } = renderPage();
    await screen.findByText('Settings');

    fireEvent.change(field('openRouterModel'), { target: { value: 'left/in-a-hurry' } });
    unmount();

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledWith({ openRouterModel: 'left/in-a-hurry' }));
  });

  test('keeps minimalHome on this device: no request, but stored and applied', async () => {
    renderPage();
    await screen.findByText('Settings');

    fireEvent.click(field('minimalHome'));

    await waitFor(() => expect(updateSetting).toHaveBeenCalledWith('minimalHome', true));
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem('minimalHome')).toBe('true');
    expect(JSON.parse(localStorage.getItem('cachedSettings')).minimalHome).toBe(true);
  });

  test('applies a saved theme to the page', async () => {
    renderPage();
    await screen.findByText('Settings');

    fireEvent.change(field('theme'), { target: { value: 'light' } });

    await waitFor(() => expect(document.body).toHaveClass('light-theme'));
    expect(document.body).not.toHaveClass('dark-theme');
    expect(updateUserSettings).toHaveBeenCalledWith({ theme: 'light' });
    expect(localStorage.getItem('theme')).toBe('light');
  });

  test('Enter in a key field saves just that key, not the other settings', async () => {
    updateUserSettings.mockImplementation(async (body) => ({
      ...mockSettings,
      hasDiscordWebhookUrl: Boolean(body.discordWebhookUrl)
    }));
    renderPage();
    await screen.findByText('Settings');

    const webhook = document.querySelector('#discordWebhookUrl');
    fireEvent.change(webhook, { target: { value: 'https://discord.com/api/webhooks/1' } });
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
    fireEvent.keyDown(webhook, { key: 'Enter' });

    await waitFor(() => expect(updateUserSettings).toHaveBeenCalledTimes(1));
    expect(updateUserSettings).toHaveBeenCalledWith({ discordWebhookUrl: 'https://discord.com/api/webhooks/1' });
    await waitFor(() => expect(webhook).toHaveValue(''));
    expect(webhook).toHaveAttribute('placeholder', 'Configured — leave blank to keep');
    expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument();
  });

  test('a key that fails to save shows the error by the field and keeps what was typed', async () => {
    updateUserSettings.mockRejectedValueOnce(new Error('Webhook URL must start with https://discord.com'));
    renderPage();
    await screen.findByText('Settings');

    const webhook = document.querySelector('#discordWebhookUrl');
    fireEvent.change(webhook, { target: { value: 'http://example.com' } });
    fireEvent.click(webhook.closest('.form-group, .mb-0, .mb-3').querySelector('button'));

    expect(await screen.findByText('Webhook URL must start with https://discord.com')).toBeInTheDocument();
    expect(webhook).toHaveValue('http://example.com');
  });

  test('Test Connection saves a waiting model change before testing', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, useOpenRouter: true, hasOpenRouterApiKey: true });
    testOpenRouterConnection.mockResolvedValue({ success: true, message: 'Connected' });
    renderPage();
    await screen.findByText('Settings');

    fireEvent.change(field('openRouterModel'), { target: { value: 'new/model' } });
    fireEvent.click(sectionOf(field('openRouterModel')).getByRole('button', { name: 'Test Connection' }));

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(updateUserSettings).toHaveBeenCalledWith({ openRouterModel: 'new/model' });
    expect(updateUserSettings.mock.invocationCallOrder[0])
      .toBeLessThan(testOpenRouterConnection.mock.invocationCallOrder[0]);
  });

  test('Test Connection does not run on stale settings when the save fails', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, useOpenRouter: true, hasOpenRouterApiKey: true });
    updateUserSettings.mockRejectedValue(new Error('Network down'));
    renderPage();
    await screen.findByText('Settings');

    fireEvent.change(field('openRouterModel'), { target: { value: 'new/model' } });
    fireEvent.click(sectionOf(field('openRouterModel')).getByRole('button', { name: 'Test Connection' }));

    expect(await screen.findByText(/latest changes aren't saved yet/)).toBeInTheDocument();
    expect(testOpenRouterConnection).not.toHaveBeenCalled();
  });

  test('surfaces the error alert when initial settings load fails', async () => {
    getUserSettings.mockRejectedValue(new Error('forbidden'));
    renderPage();
    expect(
      await screen.findByText(/Failed to load settings\. Please try again later\./)
    ).toBeInTheDocument();
  });

  test('hides the form entirely when the initial load fails', async () => {
    // The form is populated from hard-coded defaults, and an edit would save them — rendering it
    // after a failed load lets one click overwrite the real server-side settings with defaults.
    getUserSettings.mockRejectedValue(new Error('forbidden'));
    renderPage();

    await screen.findByText(/Failed to load settings\. Please try again later\./);

    expect(document.querySelector('#settings-form')).not.toBeInTheDocument();
    expect(document.querySelector('input[name="autoTranslateWords"]')).not.toBeInTheDocument();
    expect(screen.queryByText(/Changes are saved automatically/i)).not.toBeInTheDocument();
  });

  test('retries the load when Try again is clicked', async () => {
    getUserSettings.mockRejectedValueOnce(new Error('forbidden'));
    renderPage();

    const retry = await screen.findByRole('button', { name: /Try again/i });

    getUserSettings.mockResolvedValue(mockSettings);
    fireEvent.click(retry);

    expect(await screen.findByRole('button', { name: /Appearance/i })).toBeInTheDocument();
    expect(
      screen.queryByText(/Failed to load settings\. Please try again later\./)
    ).not.toBeInTheDocument();
  });

  test('loading the page saves nothing', async () => {
    renderPage();
    await screen.findByText('Settings');
    await sleep(300);

    expect(updateUserSettings).not.toHaveBeenCalled();
  });
});
