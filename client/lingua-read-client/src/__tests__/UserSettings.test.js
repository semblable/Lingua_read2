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
  testAiProvider,
  getAiProviderModels
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
  testAiProvider: vi.fn(),
  getAiProviderModels: vi.fn()
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
  aiProvider: 'gemini',
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
    id: 'custom', displayName: 'Custom (OpenAI-compatible)', baseUrl: null, defaultModel: null,
    keyPlaceholder: '(optional)', keysUrl: null, modelsUrl: null,
    requiresBaseUrl: true, apiKeyOptional: true, supportsReasoning: false
  }
];

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
  });

  afterEach(() => {
    vi.useRealTimers();
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
    expect(updateUserSettings).toHaveBeenCalledWith({ autoTranslateWords: false });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
    expect(updateSetting).toHaveBeenCalledWith('autoTranslateWords', false);
    expect(localStorage.getItem('autoTranslateWords')).toBe('false');
    expect(JSON.parse(localStorage.getItem('cachedSettings')).autoTranslateWords).toBe(false);
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
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'anthropic/claude' } } });
  });

  test('saves a text edit as soon as the field loses focus', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    await renderLoaded();
    const model = await screen.findByLabelText('Model');
    useManualClock();

    fireEvent.change(model, { target: { value: 'openai/gpt' } });
    fireEvent.blur(model);

    // No time has passed: only the blur can have sent it.
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'openai/gpt' } } });
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
    expect(updateUserSettings).toHaveBeenCalledWith({ discordTimezoneOffsetMinutes: -300 });
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
    expect(updateUserSettings).toHaveBeenLastCalledWith({ pauseOnWordClick: true });
    expect(screen.getByText('All changes saved')).toBeInTheDocument();
  });

  test('shows a failed save with Retry, which sends it again', async () => {
    updateUserSettings.mockRejectedValueOnce(new Error('Network down'));
    await renderLoaded();
    useManualClock();

    fireEvent.click(field('autoTranslateWords'));
    await advance(CHOICE_DELAY);

    expect(screen.getByRole('alert')).toHaveTextContent("Couldn't save your changes: Network down");
    expect(updateSetting).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await advance(0);

    expect(updateUserSettings).toHaveBeenCalledTimes(2);
    expect(updateUserSettings).toHaveBeenLastCalledWith({ autoTranslateWords: false });
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

    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'left/in-a-hurry' } } });
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

    expect(updateUserSettings).toHaveBeenCalledWith({ theme: 'light' });
    expect(document.body).toHaveClass('light-theme');
    expect(document.body).not.toHaveClass('dark-theme');
    expect(localStorage.getItem('theme')).toBe('light');
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
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { openrouter: { model: 'new/model' } } });
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

  test('the built-in Gemini shows no key or model fields', async () => {
    await renderLoaded();

    expect(await screen.findByRole('option', { name: 'DeepSeek' })).toBeInTheDocument();
    expect(field('aiProvider')).toHaveValue('gemini');
    expect(screen.queryByLabelText('Model')).not.toBeInTheDocument();
    expect(sectionOf(field('aiProvider')).queryByText(/API key/)).not.toBeInTheDocument();
  });

  test('picking DeepSeek saves the choice and asks for its key', async () => {
    await renderLoaded();
    await screen.findByRole('option', { name: 'DeepSeek' });
    useManualClock();

    fireEvent.change(field('aiProvider'), { target: { value: 'deepseek' } });
    await advance(CHOICE_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({ aiProvider: 'deepseek' });
    expect(updateSetting).toHaveBeenCalledWith('aiProvider', 'deepseek');
    expect(screen.getByLabelText('DeepSeek API key')).toBeInTheDocument();
    // DeepSeek has a default model, so only the key is missing.
    expect(screen.getByTestId('ai-provider-incomplete'))
      .toHaveTextContent('DeepSeek is not in use yet: add an API key. Until then, AI features use the built-in Gemini.');
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
    });

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
    });
  });

  test('a custom endpoint asks for a server URL, and its key is optional', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'custom' });
    await renderLoaded();
    const url = await screen.findByLabelText('Server URL');
    useManualClock();

    expect(screen.getByLabelText('Custom (OpenAI-compatible) API key (optional)')).toBeInTheDocument();
    expect(screen.getByTestId('ai-provider-incomplete')).toHaveTextContent('add the server URL and a model');

    fireEvent.change(url, { target: { value: 'http://localhost:11434/v1' } });
    fireEvent.change(screen.getByLabelText('Model'), { target: { value: 'llama3.3' } });
    await advance(TYPING_DELAY);

    expect(updateUserSettings).toHaveBeenCalledWith({
      aiProviders: { custom: { baseUrl: 'http://localhost:11434/v1', model: 'llama3.3' } }
    });
    expect(screen.queryByTestId('ai-provider-incomplete')).not.toBeInTheDocument();
  });

  test('Load models lists the provider\'s models as suggestions', async () => {
    getUserSettings.mockResolvedValue(onOpenRouter);
    getAiProviderModels.mockResolvedValue({ models: ['a/one', 'b/two'], error: null });
    await renderLoaded();

    const model = await screen.findByLabelText('Model');
    fireEvent.click(screen.getByRole('button', { name: 'Load models' }));

    expect(await screen.findByText(/2 models loaded/)).toBeInTheDocument();
    expect(getAiProviderModels).toHaveBeenCalledWith('openrouter');
    const list = document.getElementById(model.getAttribute('list'));
    expect([...list.querySelectorAll('option')].map(o => o.value)).toEqual(['a/one', 'b/two']);
    // The per-task fields share the suggestions.
    expect(field('aiTranslationModel')).toHaveAttribute('list', model.getAttribute('list'));
  });

  test('Load models saves a server URL still waiting to save before fetching', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'custom' });
    getAiProviderModels.mockResolvedValue({ models: ['llama3.3'], error: null });
    await renderLoaded();

    const url = await screen.findByLabelText('Server URL');
    fireEvent.change(url, { target: { value: 'http://localhost:11434/v1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load models' }));

    expect(await screen.findByText(/1 models loaded/)).toBeInTheDocument();
    expect(updateUserSettings).toHaveBeenCalledWith({ aiProviders: { custom: { baseUrl: 'http://localhost:11434/v1' } } });
    expect(updateUserSettings.mock.invocationCallOrder[0])
      .toBeLessThan(getAiProviderModels.mock.invocationCallOrder[0]);
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

  test('Load models shows why the list could not be fetched', async () => {
    getUserSettings.mockResolvedValue({ ...mockSettings, aiProvider: 'openai' });
    getAiProviderModels.mockResolvedValue({ models: [], error: 'OpenAI API key not configured' });
    await renderLoaded();

    fireEvent.click(await screen.findByRole('button', { name: 'Load models' }));

    expect(await screen.findByText('OpenAI API key not configured')).toBeInTheDocument();
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
});
