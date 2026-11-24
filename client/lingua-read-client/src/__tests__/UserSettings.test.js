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
  getAiProviders,
  getAiPromptDefaults,
  testAiProvider,
  getAiProviderModels,
  getNewsFeeds,
  getHardcoverStatus,
  syncAllHardcover,
  createMpvToken
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
  getAiProviders: vi.fn(),
  getAiPromptDefaults: vi.fn(),
  testAiProvider: vi.fn(),
  getAiProviderModels: vi.fn(),
  getNewsFeeds: vi.fn(),
  addNewsFeed: vi.fn(),
  updateNewsFeed: vi.fn(),
  deleteNewsFeed: vi.fn(),
  fetchNewsFeed: vi.fn(),
  createMpvToken: vi.fn(),
  revokeMpvToken: vi.fn()
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
  aiProvider: 'google',
  aiProviders: {},
  aiProvidersWithApiKey: []
};

// GET /api/aiproviders, trimmed to the providers the tests use.
const catalog = [
  {
    id: 'openrouter', displayName: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', defaultModel: null,
    keyPlaceholder: 'sk-or-...', keysUrl: 'https://openrouter.ai/keys', modelsUrl: 'https://openrouter.ai/models',
    requiresBaseUrl: false, apiKeyOptional: false, supportsReasoning: true
  },
  {
    id: 'deepseek', displayName: 'DeepSeek', baseUrl: 'https://api.deepseek.com', defaultModel: 'deepseek-flash',
    keyPlaceholder: 'sk-...', keysUrl: 'https://platform.deepseek.com/api_keys', modelsUrl: null,
    requiresBaseUrl: false, apiKeyOptional: false, supportsReasoning: true
  },
  {
    id: 'openai', displayName: 'OpenAI', baseUrl: 'https://api.openai.com/v1', defaultModel: null,
    keyPlaceholder: 'sk-...', keysUrl: null, modelsUrl: null,
    requiresBaseUrl: false, apiKeyOptional: false, supportsReasoning: false
  },
  {
    id: 'google', displayName: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.5-flash-lite', keyPlaceholder: 'AIza...', keysUrl: 'https://aistudio.google.com/apikey',
    modelsUrl: null, requiresBaseUrl: false, apiKeyOptional: false, supportsReasoning: false
  },
  {
    id: 'custom', displayName: 'Custom (OpenAI-compatible)', baseUrl: null, defaultModel: null,
    keyPlaceholder: '(optional)', keysUrl: null, modelsUrl: null,
    requiresBaseUrl: true, apiKeyOptional: true, supportsReasoning: false
  }
];

const promptDefaults = {
  sentenceTranslation: 'Translate {text} into {targetLanguage}.',
  selectionTranslation: 'Translate {selectedText} using {sentenceContext}.',
  fullTextTranslation: 'Pair each original <o> with its translation <t>.',
  sentenceExplanation: 'Explain {text} in {explanationLanguage}.',
  story: 'Write a {level} story about {prompt}.',
  summarization: 'Summarize {text} in {maxSummaryWords} words.',
  vocabularyPractice: 'Make a JSON array from {wordList}.'
};

// A user on OpenRouter with a key and a model, like the settings the migration carries over.
const onOpenRouter = {
  ...mockSettings,
  aiProvider: 'openrouter',
  aiProviders: { openrouter: { model: 'mistralai/mistral-small-2603' } },
  aiProvidersWithApiKey: ['openrouter']
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

// The page's save delays (SAVE_DELAY_MS in pages/UserSettings.tsx).
const CHOICE_DELAY = 150;
const TYPING_DELAY = 800;

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

// Renders and waits for the form. The generous timeout only matters on a starved CI runner.
const renderLoaded = async () => {
  const view = renderPage();
  await screen.findByText('Settings', {}, { timeout: 5000 });
  return view;
};

// Auto-save runs on timers. Once the page has loaded, the tests that depend on them stop the
// clock, so time only moves when the test advances it: a slow machine can neither fire a save
// "too early" nor make one arrive "too late". (The project default lets fake time drift with
// the wall clock, which is exactly what these tests must not do.)
const useManualClock = () =>
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: false });
const advance = (ms) => act(() => vi.advanceTimersByTimeAsync(ms));

const field = (name) => document.querySelector(`[name="${name}"]`);
const sectionOf = (element) => within(element.closest('.settings-section-card'));

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
    getAiProviders.mockResolvedValue(catalog);
    getAiPromptDefaults.mockResolvedValue(promptDefaults);
    getAiProviderModels.mockResolvedValue({ models: [], error: null });
    getNewsFeeds.mockResolvedValue([]);
    getHardcoverStatus.mockResolvedValue({ configured: false, connected: false, message: 'Not configured' });
    syncAllHardcover.mockResolvedValue({ results: [], message: 'Synced 0 of 0 books.' });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('a full local cache cannot turn a successful settings save into a failure', async () => {
    await renderLoaded();
    useManualClock();
    const realStorage = localStorage;
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubGlobal('localStorage', {
      getItem: key => realStorage.getItem(key),
      setItem: () => { throw new DOMException('Full', 'QuotaExceededError'); },
    });
    try {
      fireEvent.change(field('theme'), { target: { value: 'light' } });
      await advance(CHOICE_DELAY);
      expect(updateUserSettings).toHaveBeenCalledWith({ theme: 'light' }, { keepalive: true });
      expect(screen.getByText('All changes saved')).toBeInTheDocument();
      expect(updateSetting).toHaveBeenCalledWith('theme', 'light');
    } finally {
      vi.unstubAllGlobals();
      errorLog.mockRestore();
    }
  });

  test('renders a spinner while loading', () => {
    getUserSettings.mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.spinner-border')).toBeInTheDocument();
  });

  test('renders the settings layout after data loads', async () => {
    await renderLoaded();
    // Sidebar entries
    expect(screen.getByRole('button', { name: /Appearance/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reading/i })).toBeInTheDocument();
    expect(screen.getByText(/Changes are saved automatically/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save Settings/i })).not.toBeInTheDocument();
  });

  test('loading the page saves nothing', async () => {
    await renderLoaded();
    useManualClock();
    await advance(10_000);

    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  test('saves a toggled switch by itself, sending only that field', async () => {
    await renderLoaded();
    useManualClock();

    fireEvent.click(field('autoTranslateWords'));
    expect(screen.getByText('Saving…')).toBeInTheDocument();
    await advance(CHOICE_DELAY - 1);
    expect(updateUserSettings).not.toHaveBeenCalled();

    await advance(1);
    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({ autoTranslateWords: false }, { keepalive: true });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(updateSetting).toHaveBeenCalledWith('autoTranslateWords', false);
    expect(localStorage.getItem('autoTranslateWords')).toBe('false');
    expect(JSON.parse(localStorage.getItem('cachedSettings')).autoTranslateWords).toBe(false);
  });

  test('saves the status for automatically translated words as a number', async () => {
    await renderLoaded();
    useManualClock();
    // Older accounts have no value yet: Known, what these words always got.
    expect(field('autoTranslateWordStatus')).toHaveValue('5');

    fireEvent.change(field('autoTranslateWordStatus'), { target: { value: '1' } });
    await advance(CHOICE_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({ autoTranslateWordStatus: 1 }, { keepalive: true });
    expect(updateSetting).toHaveBeenCalledWith('autoTranslateWordStatus', 1);
  });

  test('automatic flashcards can be turned off from Reading without changing word settings', async () => {
    await renderLoaded();
    useManualClock();
    const select = screen.getByLabelText('Create flashcards when saving words');
    expect(select).toHaveValue('always');
    fireEvent.change(select, { target: { value: 'never' } });
    await advance(CHOICE_DELAY);
    expect(updateUserSettings).toHaveBeenCalledWith({ srsAutoCreateCards: 'never' }, { keepalive: true });
    expect(updateSetting).toHaveBeenCalledWith('srsAutoCreateCards', 'never');
    expect(JSON.parse(localStorage.getItem('cachedSettings')).srsAutoCreateCards).toBe('never');
  });

  test.each(['never', 'with_sentence'])('Reading retains an existing %s automatic flashcard preference', async mode => {
    getUserSettings.mockResolvedValueOnce({ ...mockSettings, srsAutoCreateCards: mode });
    await renderLoaded();
    expect(screen.getByLabelText('Create flashcards when saving words')).toHaveValue(mode);
    expect(updateUserSettings).not.toHaveBeenCalled();
  });

  test('turning news import on saves it and shows the feeds, whose options save as numbers', async () => {
    await renderLoaded();
    useManualClock();
    expect(screen.queryByText('Your feeds')).not.toBeInTheDocument();

    fireEvent.click(field('newsImportEnabled'));
    await advance(CHOICE_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({ newsImportEnabled: true }, { keepalive: true });
    expect(updateSetting).toHaveBeenCalledWith('newsImportEnabled', true);
    expect(screen.getByText('Your feeds')).toBeInTheDocument();
    expect(getNewsFeeds).toHaveBeenCalledTimes(1);

    fireEvent.change(field('newsDeleteUnreadAfterDays'), { target: { value: '0' } });
    await advance(CHOICE_DELAY);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ newsDeleteUnreadAfterDays: 0 }, { keepalive: true });
  });

  test('sends nothing when a switch is flipped back before it saves', async () => {
    await renderLoaded();
    useManualClock();

    fireEvent.click(field('autoTranslateWords'));
    fireEvent.click(field('autoTranslateWords'));
    await advance(10_000);

    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(screen.queryByText('Saving…')).not.toBeInTheDocument();
  });

  test('saves typing once, after a pause, with the final text', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    await renderLoaded();
    const model = await screen.findByLabelText('Model');
    useManualClock();

    // Keystrokes closer together than the pause keep pushing the save back.
    fireEvent.change(model, { target: { value: 'a' } });
    await advance(TYPING_DELAY - 100);
    fireEvent.change(model, { target: { value: 'an' } });
    await advance(TYPING_DELAY - 100);
    fireEvent.change(model, { target: { value: 'anthropic/claude' } });
    await advance(TYPING_DELAY - 1);
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(screen.getByText('Saving…')).toBeInTheDocument();

    await advance(1);
    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'anthropic/claude' } } }, { keepalive: true });
  });

  test('saves a text edit as soon as the field loses focus', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    await renderLoaded();
    const model = await screen.findByLabelText('Model');
    useManualClock();

    fireEvent.change(model, { target: { value: 'openai/gpt' } });
    fireEvent.blur(model);

    // No time has passed: only the blur can have sent it.
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'openai/gpt' } } }, { keepalive: true });
  });

  test('does not save a half-typed timezone offset as 0', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, discordTimezoneOffsetMinutes: 120 });
    await renderLoaded();
    useManualClock();

    const offset = field('discordTimezoneOffsetMinutes');
    fireEvent.change(offset, { target: { value: '' } });
    fireEvent.blur(offset);
    await advance(10_000);
    expect(updateUserSettings).not.toHaveBeenCalled();

    fireEvent.change(offset, { target: { value: '-300' } });
    fireEvent.blur(offset);
    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({ discordTimezoneOffsetMinutes: -300 }, { keepalive: true });
  });

  test('sends a change made while a save is running right after it, not alongside', async () => {
    const first = deferred();
    updateUserSettings.mockImplementationOnce(() => first.promise);
    await renderLoaded();
    useManualClock();

    fireEvent.click(field('autoTranslateWords'));
    await advance(CHOICE_DELAY);
    expect(updateUserSettings).toHaveBeenCalledTimes(1);

    fireEvent.click(field('pauseOnWordClick'));
    await advance(10_000);
    // Still waiting for the first response.
    expect(updateUserSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve({ ...mockSettings, autoTranslateWords: false });
    });
    await advance(0);

    expect(updateUserSettings).toHaveBeenCalledTimes(2);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ pauseOnWordClick: true }, { keepalive: true });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  test('shows a failed save with Retry, which sends it again', async () => {
    updateUserSettings.mockRejectedValueOnce(new Error('Network down'));
    await renderLoaded();
    useManualClock();

    fireEvent.click(field('autoTranslateWords'));
    await advance(CHOICE_DELAY);

    expect(screen.getByText("Couldn't save your changes: Network down").closest('[role="alert"]')).toBeInTheDocument();
    expect(updateSetting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(0);

    expect(updateUserSettings).toHaveBeenCalledTimes(2);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ autoTranslateWords: false }, { keepalive: true });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't save your changes/)).not.toBeInTheDocument();
    expect(updateSetting).toHaveBeenCalledWith('autoTranslateWords', false);
  });

  test('saves a change still waiting when the page is left', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    const { unmount } = await renderLoaded();
    const model = await screen.findByLabelText('Model');
    useManualClock();

    fireEvent.change(model, { target: { value: 'left/in-a-hurry' } });
    expect(updateUserSettings).not.toHaveBeenCalled();
    unmount();

    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'left/in-a-hurry' } } }, { keepalive: true });
  });

  test('keeps minimalHome on this device: no request, but stored and applied', async () => {
    await renderLoaded();
    useManualClock();

    fireEvent.click(field('minimalHome'));
    await advance(CHOICE_DELAY);

    expect(updateSetting).toHaveBeenCalledWith('minimalHome', true);
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(localStorage.getItem('minimalHome')).toBe('true');
    expect(JSON.parse(localStorage.getItem('cachedSettings')).minimalHome).toBe(true);
  });

  test('applies a saved theme to the page', async () => {
    await renderLoaded();
    useManualClock();

    fireEvent.change(field('theme'), { target: { value: 'light' } });
    await advance(CHOICE_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({ theme: 'light' }, { keepalive: true });
    expect(document.body).toHaveClass('light-theme');
    expect(document.body).not.toHaveClass('dark-theme');
    expect(localStorage.getItem('theme')).toBe('light');
  });

  test.each(['high-contrast-light', 'high-contrast-dark'])('saves %s without enabling experimental markers', async theme => {
    await renderLoaded();
    useManualClock();
    document.body.classList.add('reader-modern', 'custom-state');
    expect(field('readerStatusMarkersEnabled')).not.toBeChecked();
    expect(field('readerCharacterShortcutsEnabled')).toBeChecked();
    fireEvent.change(field('theme'), { target: { value: theme } });
    await advance(CHOICE_DELAY);
    expect(updateUserSettings).toHaveBeenCalledWith({ theme }, { keepalive: true });
    expect(document.body).toHaveClass(`${theme}-theme`, 'reader-modern', 'custom-state');
    expect(document.body).not.toHaveClass('reader-status-markers');
    expect(localStorage.getItem('theme')).toBe(theme);
  });

  test('saves both reader preferences independently through the existing autosave queue', async () => {
    await renderLoaded();
    useManualClock();
    fireEvent.click(field('readerCharacterShortcutsEnabled'));
    await advance(CHOICE_DELAY);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ readerCharacterShortcutsEnabled: false }, { keepalive: true });
    expect(updateSetting).toHaveBeenCalledWith('readerCharacterShortcutsEnabled', false);
    expect(JSON.parse(localStorage.getItem('cachedSettings')).readerCharacterShortcutsEnabled).toBe(false);
    fireEvent.click(field('readerStatusMarkersEnabled'));
    await advance(CHOICE_DELAY);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ readerStatusMarkersEnabled: true }, { keepalive: true });
    expect(document.body).toHaveClass('reader-status-markers');
    expect(screen.getByLabelText('Synthetic reading preview')).toBeInTheDocument();
  });

  test('a rejected marker preference remains visibly unsaved and does not change applied appearance', async () => {
    await renderLoaded();
    useManualClock();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      updateUserSettings.mockRejectedValueOnce(new Error('network unavailable'));
      fireEvent.click(field('readerStatusMarkersEnabled'));
      await advance(CHOICE_DELAY);
      expect(document.body).not.toHaveClass('reader-status-markers');
      expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('Enter in a key field saves just that key, not the other settings', async () => {
    updateUserSettings.mockImplementation(async (body) => ({
      ...mockSettings,
      hasDiscordWebhookUrl: Boolean(body.discordWebhookUrl)
    }));
    await renderLoaded();

    const webhook = document.querySelector('#discordWebhookUrl');
    fireEvent.change(webhook, { target: { value: 'https://discord.com/api/webhooks/1' } });
    expect(screen.getByText(/Not saved yet/)).toBeInTheDocument();
    fireEvent.keyDown(webhook, { key: 'Enter' });

    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({ discordWebhookUrl: 'https://discord.com/api/webhooks/1' });
    await waitFor(() => expect(webhook).toHaveValue(''));
    expect(webhook).toHaveAttribute('placeholder', 'Configured — leave blank to keep');
    expect(screen.queryByText(/Not saved yet/)).not.toBeInTheDocument();
  });

  test('a key that fails to save shows the error by the field and keeps what was typed', async () => {
    updateUserSettings.mockRejectedValueOnce(new Error('Webhook URL must start with https://discord.com'));
    await renderLoaded();

    const webhook = document.querySelector('#discordWebhookUrl');
    fireEvent.change(webhook, { target: { value: 'http://example.com' } });
    fireEvent.click(webhook.closest('.form-group, .mb-0, .mb-3').querySelector('button'));

    expect(await screen.findByText('Webhook URL must start with https://discord.com')).toBeInTheDocument();
    expect(webhook).toHaveValue('http://example.com');
  });

  test('Test Connection saves a waiting model change before testing the selected provider', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    testAiProvider.mockResolvedValue({ success: true, message: 'Connected' });
    await renderLoaded();

    const model = await screen.findByLabelText('Model');
    fireEvent.change(model, { target: { value: 'new/model' } });
    fireEvent.click(sectionOf(model).getByRole('button', { name: 'Test Connection' }));

    expect(await screen.findByText('Connected')).toBeInTheDocument();
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'new/model' } } }, { keepalive: true });
    expect(testAiProvider).toHaveBeenCalledWith('openrouter');
    expect(updateUserSettings.mock.invocationCallOrder[0])
      .toBeLessThan(testAiProvider.mock.invocationCallOrder[0]);
  });

  test('Test Connection does not run on stale settings when the save fails', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    updateUserSettings.mockRejectedValue(new Error('Network down'));
    await renderLoaded();

    const model = await screen.findByLabelText('Model');
    fireEvent.change(model, { target: { value: 'new/model' } });
    fireEvent.click(sectionOf(model).getByRole('button', { name: 'Test Connection' }));

    expect(await screen.findByText(/latest changes aren't saved yet/)).toBeInTheDocument();
    expect(testAiProvider).not.toHaveBeenCalled();
  });

  // --- AI providers ---

  test('the legacy Gemini selection waits for the user to choose Google Gemini', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'gemini' });
    await renderLoaded();

    await screen.findByRole('option', { name: 'Google Gemini' });
    expect(field('aiProvider')).toHaveValue('none');
    expect(screen.queryByLabelText('Google Gemini API key')).not.toBeInTheDocument();
    fireEvent.change(field('aiProvider'), { target: { value: 'google' } });
    expect(screen.getByLabelText('Google Gemini API key')).toBeInTheDocument();
    expect(screen.getByLabelText('Model')).toHaveAttribute('placeholder', 'gemini-3.5-flash-lite');
    expect(screen.getByTestId('ai-provider-incomplete')).toHaveTextContent('Add an API key to use Google Gemini.');
    expect(getAiProviderModels).not.toHaveBeenCalled();
  });

  test('picking DeepSeek saves the choice and asks for its key', async () => {
    await renderLoaded();
    await screen.findByRole('option', { name: 'DeepSeek' });
    useManualClock();

    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    await advance(CHOICE_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({ aiProvider: 'deepseek' }, { keepalive: true });
    expect(updateSetting).toHaveBeenCalledWith('aiProvider', 'deepseek');
    expect(screen.getByLabelText('DeepSeek API key')).toBeInTheDocument();
    // DeepSeek has a default model, so only the key is missing.
    expect(screen.getByTestId('ai-provider-incomplete'))
      .toHaveTextContent('Add an API key to use DeepSeek.');
    expect(screen.getByLabelText('Model')).toHaveAttribute('placeholder', 'deepseek-flash');
  });

  test('a provider key saves on its own, for that provider only, and is never shown again', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'deepseek' });
    updateUserSettings.mockImplementation(async (body) => ({
      ...mockSettings,
      aiProvider: 'deepseek',
      aiProvidersWithApiKey: body.aiApiKeys?.deepseek ? ['deepseek'] : []
    }));
    await renderLoaded();

    const key = await screen.findByLabelText('DeepSeek API key');
    fireEvent.change(key, { target: { value: '  sk-deepseek  ' } });
    fireEvent.keyDown(key, { key: 'Enter' });

    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({ aiApiKeys: { deepseek: 'sk-deepseek' } });
    await waitFor(() => expect(key).toHaveValue(''));
    expect(key).toHaveAttribute('placeholder', 'Configured — leave blank to keep');
    expect(screen.queryByTestId('ai-provider-incomplete')).not.toBeInTheDocument();
    expect(updateSetting).toHaveBeenCalledWith('aiProvidersWithApiKey', ['deepseek']);

    fireEvent.click(sectionOf(key).getAllByRole('button', { name: 'Clear' })[0]);
    await waitFor(() => expect(updateUserSettings).toHaveBeenLastCalledWith({ aiApiKeys: { deepseek: '' } }));
    expect(await screen.findByTestId('ai-provider-incomplete')).toBeInTheDocument();
  });

  test('switching providers discards unsaved keys', async () => {
    await renderLoaded();
    const googleKey = await screen.findByLabelText('Google Gemini API key');
    fireEvent.change(googleKey, { target: { value: 'synthetic-unsaved-key' } });

    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    const deepSeekKey = screen.getByLabelText('DeepSeek API key');
    expect(deepSeekKey).toHaveValue('');
    fireEvent.keyDown(deepSeekKey, { key: 'Enter' });

    fireEvent.change(field('aiProvider'), { target: { value: 'google' } });
    expect(screen.getByLabelText('Google Gemini API key')).toHaveValue('');
    expect(updateUserSettings.mock.calls.some(([patch]) => patch.aiApiKeys)).toBe(false);
    expect(getAiProviderModels).not.toHaveBeenCalled();
  });

  test('each provider keeps its own model: an edit made just before switching stays with its provider', async () => {
    getUserSettings.mockResolvedValue({
      ...onOpenRouter,
      aiProviders: { ...onOpenRouter.aiProviders, deepseek: { model: 'deepseek-v4-pro' } },
      aiProvidersWithApiKey: ['openrouter', 'deepseek']
    });
    await renderLoaded();
    const model = await screen.findByLabelText('Model');
    useManualClock();

    fireEvent.change(model, { target: { value: 'openai/gpt-6-luna' } });
    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    expect(screen.getByLabelText('Model')).toHaveValue('deepseek-v4-pro');
    await advance(TYPING_DELAY);

    expect(updateUserSettings).toHaveBeenCalledTimes(1);
    expect(updateUserSettings).toHaveBeenCalledWith({
      aiProvider: 'deepseek',
      aiProviders: {
        openrouter: { model: 'openai/gpt-6-luna' },
        deepseek: { model: 'deepseek-v4-pro' }
      }
    }, { keepalive: true });

    fireEvent.change(field('aiProvider'), { target: { value: 'openrouter' } });
    expect(screen.getByLabelText('Model')).toHaveValue('openai/gpt-6-luna');
  });

  test('per-task models belong to the selected provider', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    await renderLoaded();
    await screen.findByLabelText('Model');
    useManualClock();

    fireEvent.change(field('aiStoryModel'), { target: { value: 'anthropic/claude-story' } });
    await advance(TYPING_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({
      aiProviders: { openrouter: { model: 'mistralai/mistral-small-2603', storyModel: 'anthropic/claude-story' } }
    }, { keepalive: true });
  });

  test('a custom endpoint asks for a server URL, and its key is optional', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'custom' });
    await renderLoaded();
    const url = await screen.findByLabelText('Server URL');
    useManualClock();

    expect(screen.getByLabelText('Custom (OpenAI-compatible) API key (optional)')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-incomplete')).toHaveTextContent('Add the server URL and a model');

    fireEvent.change(url, { target: { value: 'http://localhost:11434/v1' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'llama3.3' } });
    await advance(TYPING_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({
      aiProviders: { custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.3' } }
    }, { keepalive: true });
    expect(screen.queryByTestId('ai-provider-incomplete')).not.toBeInTheDocument();
  });

  test('automatically loads and refreshes suggestions without selecting a model or testing it', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    getAiProviderModels.mockResolvedValue({ models: ['a/one', 'b/two'], error: null });
    await renderLoaded();

    const model = await screen.findByLabelText('Model');
    expect(await screen.findByText('2 models available.')).toBeInTheDocument();
    expect(getAiProviderModels).toHaveBeenCalledWith('openrouter', expect.any(AbortSignal));
    const list = document.getElementById(model.getAttribute('list'));
    expect([...list.querySelectorAll('option')].map(o => o.value)).toEqual(['a/one', 'b/two']);
    expect(field('aiTranslationModel')).toHaveAttribute('list', model.getAttribute('list'));

    getAiProviderModels.mockResolvedValue({ models: ['a/one', 'b/two', 'c/new'], error: null });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));

    expect(await screen.findByText('3 models available.')).toBeInTheDocument();
    expect([...list.querySelectorAll('option')].map(o => o.value)).toEqual(['a/one', 'b/two', 'c/new']);
    expect(model).toHaveValue(onOpenRouter.aiProviders.openrouter.model);
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(testAiProvider).not.toHaveBeenCalled();
  });

  test('shows the live default prompts, starts an editable draft, and resets to the default', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'none', customStoryPrompt: 'My story prompt' });
    await renderLoaded();
    const summary = await screen.findByText('Default sentence translation prompt');
    const preview = within(summary.closest('details'));
    fireEvent.click(summary);

    expect(preview.getByText(promptDefaults.sentenceTranslation)).toBeInTheDocument();
    expect(screen.getByText('Default selection translation prompt')).toBeInTheDocument();
    expect(screen.getByText('Full-text translation prompt')).toBeInTheDocument();
    expect(screen.getByText('Default vocabulary practice prompt')).toBeInTheDocument();
    expect(field('customStoryPrompt')).toHaveValue('My story prompt');

    useManualClock();
    fireEvent.click(preview.getByText('Edit a copy'));
    const translation = field('customTranslationPrompt');
    expect(translation).toHaveValue(promptDefaults.sentenceTranslation);
    await advance(TYPING_DELAY);
    expect(updateUserSettings).not.toHaveBeenCalled();
    expect(testAiProvider).not.toHaveBeenCalled();

    const customized = `${promptDefaults.sentenceTranslation} Use everyday language.`;
    fireEvent.change(translation, { target: { value: customized } });
    await advance(TYPING_DELAY);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ customTranslationPrompt: customized }, { keepalive: true });

    fireEvent.click(within(translation.closest('.border-bottom')).getByRole('button', { name: 'Reset to default' }));
    await advance(TYPING_DELAY);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ customTranslationPrompt: '' }, { keepalive: true });
    expect(translation).toHaveValue('');
    expect(preview.getByText(promptDefaults.sentenceTranslation)).toBeInTheDocument();
  });

  test('switching providers fetches new suggestions and discards the previous response', async () => {
    const pending = deferred();
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvidersWithApiKey: ['google', 'deepseek'] });
    getAiProviderModels.mockImplementation(provider => provider === 'google'
      ? pending.promise
      : Promise.resolve({ models: ['deepseek-new'] }));
    await renderLoaded();
    await waitFor(() => expect(getAiProviderModels).toHaveBeenCalledWith('google', expect.any(AbortSignal)));

    const googleSignal = getAiProviderModels.mock.calls[0][1];
    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    expect(await screen.findByText('1 model available.')).toBeInTheDocument();
    expect(googleSignal.aborted).toBe(true);
    await act(async () => pending.resolve({ models: ['gemini-new'] }));

    const list = document.getElementById(field('aiModel').getAttribute('list'));
    expect([...list.querySelectorAll('option')].map(o => o.value)).toEqual(['deepseek-new']);
    expect(testAiProvider).not.toHaveBeenCalled();
  });

  test('refreshing models saves a pending custom URL before fetching', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'custom' });
    getAiProviderModels.mockResolvedValue({ models: ['llama3.3'], error: null });
    await renderLoaded();

    const url = await screen.findByLabelText('Server URL');
    fireEvent.change(url, { target: { value: 'http://localhost:11434/v1' } });
    expect(getAiProviderModels).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh models' }));

    expect(await screen.findByText('1 model available.')).toBeInTheDocument();
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { custom: { baseUrl: 'http://localhost:11434/v1' } } }, { keepalive: true });
    expect(updateUserSettings.mock.invocationCallOrder[0])
      .toBeLessThan(getAiProviderModels.mock.invocationCallOrder[0]);
  });

  test('saving a custom URL with a stored key waits for an explicit model refresh', async () => {
    getUserSettings.mockResolvedValue({
      ...mockSettings,
      aiProvider: 'custom',
      aiProviders: { custom: { baseUrl: 'https://first.example/v1', model: 'test-model' } },
      aiProvidersWithApiKey: ['custom']
    });
    getAiProviderModels.mockResolvedValue({ models: ['test-model'], error: null });
    await renderLoaded();
    const url = await screen.findByLabelText('Server URL');
    useManualClock();

    fireEvent.change(url, { target: { value: 'https://second.example/v1' } });
    await advance(TYPING_DELAY);
    expect(updateUserSettings).toHaveBeenCalledWith({
      aiProviders: { custom: { baseUrl: 'https://second.example/v1', model: 'test-model' } }
    }, { keepalive: true });
    expect(getAiProviderModels).not.toHaveBeenCalled();

    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Refresh models' })));
    expect(getAiProviderModels).toHaveBeenCalledExactlyOnceWith('custom', expect.any(AbortSignal));
    expect(screen.getByText('1 model available.')).toBeInTheDocument();

    fireEvent.change(url, { target: { value: 'https://third.example/v1' } });
    await advance(TYPING_DELAY);
    expect(getAiProviderModels).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('1 model available.')).not.toBeInTheDocument();
  });

  test('a connection test result stays with the provider it was for', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    testAiProvider.mockResolvedValue({ success: false, message: 'OpenRouter error: Unauthorized' });
    await renderLoaded();

    const model = await screen.findByLabelText('Model');
    fireEvent.click(sectionOf(model).getByRole('button', { name: 'Test Connection' }));
    expect(await screen.findByText('OpenRouter error: Unauthorized')).toBeInTheDocument();

    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    expect(screen.queryByText('OpenRouter error: Unauthorized')).not.toBeInTheDocument();
    fireEvent.change(field('aiProvider'), { target: { value: 'openrouter' } });
    expect(screen.getByText('OpenRouter error: Unauthorized')).toBeInTheDocument();
  });

  test('shows a provider error when automatic model discovery fails', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'openai', aiProvidersWithApiKey: ['openai'] });
    getAiProviderModels.mockResolvedValue({ models: [], error: 'OpenAI API key was rejected' });
    await renderLoaded();

    expect(await screen.findByText('OpenAI API key was rejected')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh models' })).toBeEnabled();
  });

  test('reasoning settings show only for providers that support them', async () => {
    getUserSettings.mockResolvedValue({ ...onOpenRouter });
    await renderLoaded();
    await screen.findByLabelText('Model');
    expect(field('openRouterReasoningEnabled')).toBeInTheDocument();

    fireEvent.change(field('aiProvider'), { target: { value: 'openai' } });
    expect(field('openRouterReasoningEnabled')).not.toBeInTheDocument();

    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    expect(field('openRouterReasoningEnabled')).toBeInTheDocument();
    expect(screen.getByText(/DeepSeek thinks by default/)).toBeInTheDocument();
  });

  test('keeps a saved provider selectable when the provider list fails to load', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    getAiProviders.mockRejectedValue(new Error('Server unavailable'));
    await renderLoaded();

    expect(await screen.findByText(/Couldn't load the list of providers: Server unavailable/)).toBeInTheDocument();
    expect(field('aiProvider')).toHaveValue('openrouter');
  });

  test('saved provider settings are cached as JSON, not "[object Object]"', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    await renderLoaded();
    const model = await screen.findByLabelText('Model');
    useManualClock();

    fireEvent.change(model, { target: { value: 'x/y' } });
    await advance(TYPING_DELAY);

    expect(JSON.parse(localStorage.getItem('aiProviders'))).toEqual({ openrouter: { model: 'x/y' } });
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

  // --- Hardcover ---

  test('saving Hardcover token clears password input immediately, shows Testing... during status check, and displays result', async () => {
    const statusCheck = deferred();
    updateUserSettings.mockResolvedValueOnce({
      ...mockSettings,
      hasHardcoverApiToken: true
    });
    getHardcoverStatus.mockImplementationOnce(() => statusCheck.promise);

    await renderLoaded();

    const tokenInput = document.querySelector('#hardcoverApiToken');
    const hcSection = sectionOf(tokenInput);
    fireEvent.change(tokenInput, { target: { value: '  hc-secret-token  ' } });
    fireEvent.click(hcSection.getByRole('button', { name: /save token/i }));

    await waitFor(() =>
      expect(updateUserSettings).toHaveBeenCalledWith({ hardcoverApiToken: 'hc-secret-token' })
    );
    // Input clears right after save completes, while getHardcoverStatus is still in flight.
    await waitFor(() => expect(tokenInput).toHaveValue(''));
    expect(hcSection.getByText('Hardcover token saved.')).toBeInTheDocument();
    expect(hcSection.getByRole('button', { name: /testing\.\.\./i })).toBeDisabled();
    expect(updateSetting).toHaveBeenCalledWith('hasHardcoverApiToken', true);

    await act(async () => {
      statusCheck.resolve({
        configured: true,
        connected: true,
        username: 'hardcover-reader',
        message: 'Connected to Hardcover.'
      });
    });

    expect(await hcSection.findByText('Connected to Hardcover.')).toBeInTheDocument();
    expect(hcSection.getByText('Connected as hardcover-reader')).toBeInTheDocument();
    expect(hcSection.getByRole('button', { name: /test connection/i })).not.toBeDisabled();
  });

  test('Clear Token asks for confirmation and invalidates an in-flight status test', async () => {
    const statusCheck = deferred();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    getUserSettings.mockResolvedValue({
      ...mockSettings,
      hasHardcoverApiToken: true,
      hardcoverSyncEnabled: true
    });
    getHardcoverStatus.mockImplementationOnce(() => statusCheck.promise);
    updateUserSettings.mockResolvedValueOnce({
      ...mockSettings,
      hasHardcoverApiToken: false,
      hardcoverSyncEnabled: false,
      hardcoverLastSyncAt: null
    });

    try {
      await renderLoaded();
      const tokenInput = document.querySelector('#hardcoverApiToken');
      const hcSection = sectionOf(tokenInput);

      // Start an in-flight connection test
      fireEvent.click(hcSection.getByRole('button', { name: /test connection/i }));
      expect(hcSection.getByRole('button', { name: /testing\.\.\./i })).toBeDisabled();

      // Cancelling confirm does not clear the token
      fireEvent.click(hcSection.getByRole('button', { name: /clear token/i }));
      expect(updateUserSettings).not.toHaveBeenCalled();

      // Confirming Clear Token while status test is still pending clears the token
      fireEvent.click(hcSection.getByRole('button', { name: /clear token/i }));
      await waitFor(() =>
        expect(updateUserSettings).toHaveBeenCalledWith({ clearHardcoverApiToken: true })
      );
      expect(await hcSection.findByText('Hardcover token cleared.')).toBeInTheDocument();
      expect(updateSetting).toHaveBeenCalledWith('hasHardcoverApiToken', false);
      expect(updateSetting).toHaveBeenCalledWith('hardcoverSyncEnabled', false);
      expect(updateSetting).toHaveBeenCalledWith('hardcoverLastSyncAt', null);

      // Now resolve the stale in-flight status check — it must be ignored!
      await act(async () => {
        statusCheck.resolve({
          configured: true,
          connected: true,
          username: 'stale-user',
          message: 'Stale connection result'
        });
      });

      expect(hcSection.queryByText('Stale connection result')).not.toBeInTheDocument();
      expect(hcSection.queryByText('Connected as stale-user')).not.toBeInTheDocument();
      expect(hcSection.getByText('Hardcover token cleared.')).toBeInTheDocument();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  test('Sync All Books flushes pending settings before syncing and updates hardcoverLastSyncAt', async () => {
    getUserSettings
      .mockResolvedValueOnce({
        ...mockSettings,
        hasHardcoverApiToken: true,
        hardcoverSyncEnabled: false
      })
      .mockResolvedValueOnce({
        ...mockSettings,
        hasHardcoverApiToken: true,
        hardcoverSyncEnabled: true,
        hardcoverLastSyncAt: '2026-05-01T12:00:00Z'
      });
    syncAllHardcover.mockResolvedValueOnce({
      results: [{ bookId: 1, success: true, skipped: false }],
      message: 'Synced 1 of 1 books.'
    });

    await renderLoaded();
    const hcSection = sectionOf(document.querySelector('#hardcoverApiToken'));

    // Toggle sync on (pending auto-save) and immediately click Sync All Books
    fireEvent.click(field('hardcoverSyncEnabled'));
    fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));

    const alert = await hcSection.findByText('Synced 1 of 1 books.');
    expect(alert.closest('.alert')).toHaveClass('alert-success');
    expect(updateUserSettings).toHaveBeenCalledWith({ hardcoverSyncEnabled: true }, { keepalive: true });
    expect(syncAllHardcover).toHaveBeenCalledTimes(1);
    expect(updateUserSettings.mock.invocationCallOrder[0])
      .toBeLessThan(syncAllHardcover.mock.invocationCallOrder[0]);
    expect(updateSetting).toHaveBeenCalledWith('hardcoverLastSyncAt', '2026-05-01T12:00:00Z');
  });

  test('Sync All Books uses danger/warning/success alert variants based on per-book results', async () => {
    getUserSettings.mockResolvedValue({
      ...mockSettings,
      hasHardcoverApiToken: true,
      hardcoverSyncEnabled: true
    });

    await renderLoaded();
    const hcSection = sectionOf(document.querySelector('#hardcoverApiToken'));

    // All failed -> danger with concise error details
    syncAllHardcover.mockResolvedValueOnce({
      results: [{ bookId: 1, success: false, skipped: false, message: 'Hardcover 502 Bad Gateway' }],
      message: 'Synced 0 of 1 books.'
    });
    fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));
    const dangerAlert = await hcSection.findByText(/Synced 0 of 1 books\. \(Hardcover 502 Bad Gateway\)/);
    expect(dangerAlert.closest('.alert')).toHaveClass('alert-danger');

    // Partial failure (some succeeded, some failed) -> warning
    syncAllHardcover.mockResolvedValueOnce({
      results: [
        { bookId: 1, success: true, skipped: false },
        { bookId: 2, success: false, skipped: false, message: 'Rate limited' }
      ],
      message: 'Synced 1 of 2 books.'
    });
    fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));
    const partialAlert = await hcSection.findByText(/Synced 1 of 2 books\. \(Rate limited\)/);
    expect(partialAlert.closest('.alert')).toHaveClass('alert-warning');

    // All skipped -> warning
    syncAllHardcover.mockResolvedValueOnce({
      results: [{ bookId: 1, success: false, skipped: true, message: 'No high-confidence match' }],
      message: 'Synced 0 of 1 books.'
    });
    fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));
    const skippedAlert = await hcSection.findByText('Synced 0 of 1 books.');
    expect(skippedAlert.closest('.alert')).toHaveClass('alert-warning');

    // Empty results with disabled message -> warning
    syncAllHardcover.mockResolvedValueOnce({
      results: [],
      message: 'Hardcover sync is disabled.'
    });
    fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));
    const disabledAlert = await hcSection.findByText('Hardcover sync is disabled.');
    expect(disabledAlert.closest('.alert')).toHaveClass('alert-warning');

    // Empty results "Synced 0 of 0 books." -> success
    syncAllHardcover.mockResolvedValueOnce({
      results: [],
      message: 'Synced 0 of 0 books.'
    });
    fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));
    const emptySuccessAlert = await hcSection.findByText('Synced 0 of 0 books.');
    expect(emptySuccessAlert.closest('.alert')).toHaveClass('alert-success');
  });

  test('Sync All Books keeps success message even when trailing getUserSettings refresh fails', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    getUserSettings
      .mockResolvedValueOnce({
        ...mockSettings,
        hasHardcoverApiToken: true,
        hardcoverSyncEnabled: true
      })
      .mockRejectedValueOnce(new Error('Transient refresh failure'));
    syncAllHardcover.mockResolvedValueOnce({
      results: [{ bookId: 1, success: true, skipped: false }],
      message: 'Synced 1 of 1 books.'
    });

    try {
      await renderLoaded();
      const hcSection = sectionOf(document.querySelector('#hardcoverApiToken'));

      fireEvent.click(hcSection.getByRole('button', { name: /sync all books/i }));

      const alert = await hcSection.findByText('Synced 1 of 1 books.');
      expect(alert.closest('.alert')).toHaveClass('alert-success');
      expect(hcSection.queryByText(/Transient refresh failure/)).not.toBeInTheDocument();
      await waitFor(() => expect(getUserSettings).toHaveBeenCalledTimes(2));
      expect(hcSection.getByText('Synced 1 of 1 books.')).toBeInTheDocument();
    } finally {
      consoleError.mockRestore();
    }
  });

  test('mpv Player section renders outside settings form and does not trigger updateUserSettings', async () => {
    createMpvToken.mockResolvedValueOnce({
      localMode: false,
      token: 'mpv-user-settings-test-token',
      expiresAt: '2027-02-20T12:00:00Z'
    });

    await renderLoaded();

    expect(screen.getByRole('button', { name: /mpv Player/i })).toBeInTheDocument();
    const generateButton = screen.getByRole('button', { name: 'Generate mpv Config' });
    expect(generateButton.closest('#settings-form')).toBeNull();

    fireEvent.click(generateButton);

    expect(await screen.findByDisplayValue(/api_token=mpv-user-settings-test-token/)).toBeInTheDocument();
    expect(updateUserSettings).not.toHaveBeenCalled();
  });
});
