import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { Container, Form, Button, Alert, Spinner } from 'react-bootstrap';
import {
  getUserSettings, updateUserSettings, getAllLanguages,
  backupDatabase, restoreDatabase, resetUserStatistics, sendDiscordReport, getAudioStorageSize,
  getHardcoverStatus, syncAllHardcover
} from '../utils/api';
import * as api from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';
import type { AiProviderConfig, Settings, SettingKey } from '../contexts/SettingsContext';
import type { Language } from '../utils/api/languages';
import type { UpdateUserSettingsInput, UserSettings as UserSettingsResponse } from '../utils/api/settings';
import type { AiProviderInfo, AiProviderTestResult } from '../utils/api/aiProviders';
import { useAutoSave } from '../hooks/useAutoSave';

type PageSettings = Partial<Settings>;

type AudioStorageInfo = {
  totalSizeBytes?: number;
  totalSizeMB?: number;
  totalSizeGB?: number;
  totalFiles?: number;
};

type HardcoverStatus = {
  configured?: boolean;
  connected?: boolean;
  syncEnabled?: boolean;
  hardcoverUserId?: number | null;
  username?: string | null;
  message?: string | null;
  success?: boolean;
};
import AppearanceSettings from '../components/settings/AppearanceSettings';
import ReadingSettings from '../components/settings/ReadingSettings';
import NavigationSettings from '../components/settings/NavigationSettings';
import AiProviderSettings from '../components/settings/AiProviderSettings';
import type { AiProviderConfigField } from '../components/settings/AiProviderSettings';
import DiscordSettings from '../components/settings/DiscordSettings';
import HardcoverSettings from '../components/settings/HardcoverSettings';
import DataManagementSettings from '../components/settings/DataManagementSettings';
import SaveStatus from '../components/settings/SaveStatus';
import './UserSettings.css';

const SECTIONS = [
  { id: 'appearance', label: 'Appearance', icon: '\uD83C\uDFA8' },
  { id: 'reading', label: 'Reading', icon: '\uD83D\uDCDA' },
  { id: 'navigation', label: 'Navigation', icon: '\u2699\uFE0F' },
  { id: 'ai', label: 'AI Provider', icon: '\uD83E\uDD16' },
  { id: 'discord', label: 'Discord', icon: '\uD83D\uDCE8' },
  { id: 'hardcover', label: 'Hardcover', icon: 'HC' },
  { id: 'data', label: 'Data', icon: '\uD83D\uDDC4\uFE0F' },
];

// The settings response carries only booleans for write-only secrets (never the values).
const applyProviderKeyFlags = (saved: UserSettingsResponse): Partial<Settings> => ({
  hasWiktionaryAccessToken: saved.hasWiktionaryAccessToken ?? false,
  hasAzureTranslatorKey: saved.hasAzureTranslatorKey ?? false,
  hasGoogleTranslateApiKey: saved.hasGoogleTranslateApiKey ?? false,
  hasDiscordWebhookUrl: saved.hasDiscordWebhookUrl ?? false
});

// The settings this page edits, and so saves. The rest of PageSettings is display-only: the has*
// flags of write-only secrets and Hardcover's token/sync status change through their own requests.
const EDITABLE_KEYS: readonly SettingKey[] = [
  'theme', 'textSize', 'textFont', 'readingUiMode', 'readerContentWidth',
  'readingDensity', 'showWordInfoPanel', 'readerParagraphIndent', 'readerTextAlignment',
  'leftPanelWidth', 'autoTranslateWords', 'autoTranslateOnOpen', 'pauseOnWordClick', 'highlightKnownWords',
  'tooltipOnlyForSavedWords', 'sentenceTtsEnabled', 'defaultLanguageId', 'translationTargetLanguageCode',
  'wordTranslationProvider', 'wiktionaryRichDisplay',
  'azureTranslatorRegion',
  'autoAdvanceToNextLesson', 'autoAdvanceAudiobookTracks', 'autoMoveFinishedLessons', 'showProgressStats', 'lineSpacing',
  'discordWeeklyReportEnabled', 'discordWeeklyReportDayOfWeek',
  'discordWeeklyReportHourLocal', 'discordTimezoneOffsetMinutes',
  'hardcoverSyncEnabled',
  'aiProvider', 'aiProviders',
  'openRouterReasoningEnabled', 'openRouterReasoningEffort',
  'openRouterStoryReasoningEnabled', 'openRouterStoryReasoningEffort',
  'customTranslationPrompt', 'customExplanationPrompt',
  'customStoryPrompt', 'customSummarizationPrompt',
  'minimalHome'
];

// Kept in this browser only (see the minimalHome note in fetchSettings), so a change to just these
// makes no request.
const LOCAL_ONLY_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>(['minimalHome']);

const NUMERIC_FIELDS: ReadonlySet<string> = new Set([
  'textSize', 'readerContentWidth', 'leftPanelWidth', 'lineSpacing',
  'defaultLanguageId', 'discordWeeklyReportHourLocal', 'discordTimezoneOffsetMinutes'
]);

// How long a change waits for the next one before it is saved. A switch or a dropdown saves at
// once; a slider waits out the drag; typing waits for a pause, so a model name or prompt is saved
// once rather than letter by letter. Leaving a text field saves it straight away.
const SAVE_DELAY_MS = { choice: 150, slider: 400, typing: 800 };

const applyThemeToBody = (theme: string) => {
  document.body.classList.remove('light-theme', 'dark-theme', 'classic-dark-theme');
  if (theme === 'dark') {
    document.body.classList.add('dark-theme');
  } else if (theme === 'light') {
    document.body.classList.add('light-theme');
  } else if (theme === 'classic-dark') {
    document.body.classList.add('classic-dark-theme');
  } else {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.body.classList.add(prefersDark ? 'dark-theme' : 'light-theme');
  }
};

const readCachedSettings = (): Record<string, unknown> => {
  try {
    const cached = JSON.parse(localStorage.getItem('cachedSettings') || '{}');
    return cached && typeof cached === 'object' ? cached : {};
  } catch {
    return {};
  }
};

// Sends the server-side part of a patch; local-only keys never reach the API.
const saveSettingsPatch = async (patch: PageSettings): Promise<UserSettingsResponse | null> => {
  const serverPatch = Object.fromEntries(
    Object.entries(patch).filter(([key]) => !LOCAL_ONLY_KEYS.has(key as SettingKey))
  );
  if (Object.keys(serverPatch).length === 0) return null;
  return updateUserSettings(serverPatch as UpdateUserSettingsInput);
};

const UserSettings = () => {
  const browserTimezoneOffsetMinutes = -new Date().getTimezoneOffset();
  const { updateSetting } = useContext(SettingsContext);

  // Once a patch is saved, hand it to the rest of the app (context, localStorage, theme).
  const handleSaved = useCallback((patch: PageSettings, result: unknown) => {
    const saved = (result ?? {}) as Partial<Record<SettingKey, unknown>>;
    const syncSetting = <K extends SettingKey>(key: K) => {
      // What the server stored (it may normalise a value), else what was sent: local-only keys
      // are never echoed back.
      const val = saved[key] ?? patch[key];
      if (val === undefined || val === null) return;
      updateSetting(key, val as Settings[K]);
      localStorage.setItem(key, typeof val === 'object' ? JSON.stringify(val) : String(val));
    };
    (Object.keys(patch) as SettingKey[]).forEach(syncSetting);

    const localOnly = Object.fromEntries(
      Object.entries(patch).filter(([key]) => LOCAL_ONLY_KEYS.has(key as SettingKey))
    );
    localStorage.setItem('cachedSettings', JSON.stringify({ ...readCachedSettings(), ...(result ?? {}), ...localOnly }));

    if (patch.theme !== undefined) applyThemeToBody(String(saved.theme ?? patch.theme));
  }, [updateSetting]);

  // Local settings state holds the subset this page initializes/persists;
  // missing keys are filled in by the API response on first load.
  const {
    values: settings,
    status: saveStatus,
    error: saveError,
    setField,
    reset: resetSettings,
    applyServerValues,
    flush: flushSettings
  } = useAutoSave<PageSettings>({
    editableKeys: EDITABLE_KEYS,
    save: saveSettingsPatch,
    onSaved: handleSaved,
    initialValues: {
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
      defaultLanguageId: 0,
      translationTargetLanguageCode: 'EN',
      wordTranslationProvider: 'deepl',
      wiktionaryRichDisplay: false,
      hasWiktionaryAccessToken: false,
      hasAzureTranslatorKey: false,
      azureTranslatorRegion: '',
      hasGoogleTranslateApiKey: false,
      autoAdvanceToNextLesson: false,
      autoAdvanceAudiobookTracks: true,
      autoMoveFinishedLessons: false,
      showProgressStats: true,
      lineSpacing: 1.5,
      discordWeeklyReportEnabled: false,
      hasDiscordWebhookUrl: false,
      discordWeeklyReportDayOfWeek: 'Monday',
      discordWeeklyReportHourLocal: 8,
      discordTimezoneOffsetMinutes: browserTimezoneOffsetMinutes,
      hardcoverSyncEnabled: false,
      hasHardcoverApiToken: false,
      hardcoverLastSyncAt: null,
      aiProvider: 'gemini',
      aiProviders: {},
      aiProvidersWithApiKey: [],
      openRouterReasoningEnabled: false,
      openRouterReasoningEffort: 'medium',
      openRouterStoryReasoningEnabled: false,
      openRouterStoryReasoningEffort: 'medium',
      customTranslationPrompt: '',
      customExplanationPrompt: '',
      customStoryPrompt: '',
      customSummarizationPrompt: '',
      minimalHome: false
    }
  });

  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [loadingLanguages, setLoadingLanguages] = useState(true);
  // When the initial GET fails the form must not render: it would be filled with the hard-coded
  // defaults above, and any edit would save them over the real server-side values (custom
  // prompts, model ids, default language).
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [activeSection, setActiveSection] = useState('appearance');

  // Backup/Restore state
  const [isBackingUp, setIsBackingUp] = useState(false);
  const [backupMessage, setBackupMessage] = useState({ type: '', text: '' });
  const [isRestoring, setIsRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState({ type: '', text: '' });
  const [restoreFile, setRestoreFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isResettingStats, setIsResettingStats] = useState(false);
  const [resetStatsMessage, setResetStatsMessage] = useState({ type: '', text: '' });

  // Discord report state
  const [reportPeriod, setReportPeriod] = useState('week');
  const [reportDays, setReportDays] = useState(30);
  const [isSendingReport, setIsSendingReport] = useState(false);
  const [reportMessage, setReportMessage] = useState({ type: '', text: '' });

  // Hardcover state
  const [testingHardcover, setTestingHardcover] = useState(false);
  const [hardcoverTestResult, setHardcoverTestResult] = useState<HardcoverStatus | null>(null);
  const [syncingHardcover, setSyncingHardcover] = useState(false);
  const [hardcoverSyncMessage, setHardcoverSyncMessage] = useState({ type: '', text: '' });

  // AI provider catalog and connection test state
  const [aiProviderCatalog, setAiProviderCatalog] = useState<AiProviderInfo[] | null>(null);
  const [aiProviderCatalogError, setAiProviderCatalogError] = useState('');
  const [testingAiProvider, setTestingAiProvider] = useState(false);
  const [aiProviderTestResult, setAiProviderTestResult] = useState<{ provider: string; result: AiProviderTestResult } | null>(null);

  // Audio storage state
  const [audioStorage, setAudioStorage] = useState<AudioStorageInfo | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState('');

  // Section refs for scroll. Keys are section ids ('appearance', 'reading', …);
  // values are the section's outer <div>.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      setLoadFailed(false);
      setError('');
      try {
        const data = await getUserSettings();
        resetSettings({
          theme: data.theme || 'dark',
          textSize: data.textSize || 16,
          textFont: data.textFont || 'default',
          readingUiMode: data.readingUiMode || 'classic',
          readerContentWidth: data.readerContentWidth || 740,
          readingDensity: data.readingDensity || 'balanced',
          showWordInfoPanel: data.showWordInfoPanel ?? true,
          readerParagraphIndent: data.readerParagraphIndent ?? true,
          readerTextAlignment: data.readerTextAlignment || 'left',
          leftPanelWidth: data.leftPanelWidth || 85,
          autoTranslateWords: data.autoTranslateWords ?? true,
          autoTranslateOnOpen: data.autoTranslateOnOpen ?? false,
          pauseOnWordClick: data.pauseOnWordClick ?? false,
          highlightKnownWords: data.highlightKnownWords ?? true,
          tooltipOnlyForSavedWords: data.tooltipOnlyForSavedWords ?? false,
          sentenceTtsEnabled: data.sentenceTtsEnabled ?? false,
          defaultLanguageId: data.defaultLanguageId || 0,
          translationTargetLanguageCode: data.translationTargetLanguageCode || 'EN',
          wordTranslationProvider: data.wordTranslationProvider || 'deepl',
          wiktionaryRichDisplay: data.wiktionaryRichDisplay ?? false,
          hasWiktionaryAccessToken: data.hasWiktionaryAccessToken ?? false,
          hasAzureTranslatorKey: data.hasAzureTranslatorKey ?? false,
          azureTranslatorRegion: data.azureTranslatorRegion ?? '',
          hasGoogleTranslateApiKey: data.hasGoogleTranslateApiKey ?? false,
          autoAdvanceToNextLesson: data.autoAdvanceToNextLesson ?? false,
          autoAdvanceAudiobookTracks: data.autoAdvanceAudiobookTracks ?? true,
          autoMoveFinishedLessons: data.autoMoveFinishedLessons ?? false,
          showProgressStats: data.showProgressStats ?? true,
          lineSpacing: data.lineSpacing || 1.5,
          discordWeeklyReportEnabled: data.discordWeeklyReportEnabled ?? false,
          hasDiscordWebhookUrl: data.hasDiscordWebhookUrl ?? false,
          discordWeeklyReportDayOfWeek: data.discordWeeklyReportDayOfWeek || 'Monday',
          discordWeeklyReportHourLocal: data.discordWeeklyReportHourLocal ?? 8,
          discordTimezoneOffsetMinutes: data.discordTimezoneOffsetMinutes ?? browserTimezoneOffsetMinutes,
          hardcoverSyncEnabled: data.hardcoverSyncEnabled ?? false,
          hasHardcoverApiToken: data.hasHardcoverApiToken ?? false,
          hardcoverLastSyncAt: data.hardcoverLastSyncAt ?? null,
          aiProvider: data.aiProvider || 'gemini',
          aiProviders: (data.aiProviders ?? {}) as Record<string, AiProviderConfig>,
          aiProvidersWithApiKey: data.aiProvidersWithApiKey ?? [],
          openRouterReasoningEnabled: data.openRouterReasoningEnabled ?? false,
          openRouterReasoningEffort: data.openRouterReasoningEffort || 'medium',
          openRouterStoryReasoningEnabled: data.openRouterStoryReasoningEnabled ?? false,
          openRouterStoryReasoningEffort: data.openRouterStoryReasoningEffort || 'medium',
          customTranslationPrompt: data.customTranslationPrompt ?? '',
          customExplanationPrompt: data.customExplanationPrompt ?? '',
          customStoryPrompt: data.customStoryPrompt ?? '',
          customSummarizationPrompt: data.customSummarizationPrompt ?? '',
          // Deliberately localStorage, not `data`: minimalHome has no server-side column or DTO
          // field, so the PUT carries it but the API drops it and never echoes it back. Reading
          // `data.minimalHome` here would always yield undefined and silently turn the toggle off.
          // Persisting it server-side (model + migration + DTO) is what would make it sync across
          // devices; until then this is the only store.
          minimalHome: localStorage.getItem('minimalHome') === 'true'
        });
      } catch (e: unknown) { const err = e as Error;
        setError('Failed to load settings. Please try again later.');
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    };

    const fetchLanguages = async () => {
      try {
        const data = await getAllLanguages();
        setLanguages(data || []);
      } catch (e: unknown) { const err = e as Error;
        console.error('Failed to load languages:', err);
      } finally {
        setLoadingLanguages(false);
      }
    };

    const fetchStorageSize = async () => {
      setLoadingStorage(true);
      try {
        const data = await getAudioStorageSize();
        setAudioStorage(data);
      } catch (e: unknown) { const err = e as Error;
        console.error('Failed to load audio storage size:', err);
        setStorageError('Failed to load storage information');
      } finally {
        setLoadingStorage(false);
      }
    };

    const fetchAiProviderCatalog = async () => {
      setAiProviderCatalogError('');
      try {
        setAiProviderCatalog(await api.getAiProviders());
      } catch (e: unknown) {
        setAiProviderCatalog([]);
        setAiProviderCatalogError((e instanceof Error && e.message) || 'Request failed.');
      }
    };

    fetchSettings();
    fetchLanguages();
    fetchStorageSize();
    fetchAiProviderCatalog();
  }, [browserTimezoneOffsetMinutes, reloadKey, resetSettings]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const { name, value, type } = target;
    let processedValue: string | number | boolean = value;
    let delay = SAVE_DELAY_MS.typing;
    if (type === 'checkbox') {
      processedValue = target.checked;
      delay = SAVE_DELAY_MS.choice;
    } else if (type === 'number' || type === 'range' || NUMERIC_FIELDS.has(name)) {
      const parsed = name === 'lineSpacing' ? parseFloat(value) : parseInt(value, 10);
      // A half-typed number ("" or "-") would save as 0; keep the saved value until it parses.
      if (isNaN(parsed)) return;
      processedValue = parsed;
    }
    if (type === 'range') delay = SAVE_DELAY_MS.slider;
    else if (type.startsWith('select')) delay = SAVE_DELAY_MS.choice;
    setField(name as SettingKey, processedValue as Settings[SettingKey], delay);
  };

  // The form has no submit button, so Enter doesn't normally submit it. If something ever does,
  // save what is waiting rather than reload the page.
  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    void flushSettings();
  };

  // Leaving a field saves its edit straight away rather than after the typing pause; also the
  // status pill's Retry.
  const saveNow = () => {
    void flushSettings();
  };

  const handleSendReportNow = async () => {
    setIsSendingReport(true);
    setReportMessage({ type: '', text: '' });
    try {
      const result = (await sendDiscordReport(reportPeriod, reportPeriod === 'days' ? reportDays : null)) as { message?: string } | null;
      setReportMessage({ type: 'success', text: result?.message || 'Report sent.' });
    } catch (e: unknown) { const err = e as Error;
      setReportMessage({ type: 'danger', text: err.message || 'Failed to send report.' });
    } finally {
      setIsSendingReport(false);
    }
  };

  const handleSetBrowserTimezone = () => {
    const offsetMinutes = -new Date().getTimezoneOffset();
    setField('discordTimezoneOffsetMinutes', offsetMinutes, SAVE_DELAY_MS.choice);
  };

  const handleBackupClick = async () => {
    setIsBackingUp(true);
    setBackupMessage({ type: '', text: '' });
    try {
      const result = (await backupDatabase()) as { message?: string } | null;
      setBackupMessage({ type: 'success', text: result?.message || 'Backup download started.' });
      setTimeout(() => setBackupMessage({ type: '', text: '' }), 5000);
    } catch (e: unknown) { const err = e as Error;
      setBackupMessage({ type: 'danger', text: `Backup failed: ${err.message}` });
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleRestoreFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      setRestoreFile(e.target.files[0]);
      setRestoreMessage({ type: '', text: '' });
    } else {
      setRestoreFile(null);
    }
  };

  const handleRestoreClick = async () => {
    if (!restoreFile) {
      setRestoreMessage({ type: 'warning', text: 'Please select a backup file to restore.' });
      return;
    }
    const confirmation = window.confirm(
      "WARNING: Restoring from this backup will completely overwrite the current database.\n\n" +
      "All data added since this backup was created WILL BE LOST.\n\n" +
      "This action is IRREVERSIBLE.\n\n" +
      "Are you absolutely sure you want to proceed?"
    );
    if (!confirmation) {
      setRestoreMessage({ type: 'info', text: 'Restore cancelled.' });
      return;
    }
    setIsRestoring(true);
    setRestoreMessage({ type: '', text: '' });
    try {
      const result = (await restoreDatabase(restoreFile)) as { message?: string } | null;
      setRestoreMessage({ type: 'success', text: result?.message || 'Database restored successfully. Please refresh or restart the application.' });
      setRestoreFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    } catch (e: unknown) { const err = e as Error;
      setRestoreMessage({ type: 'danger', text: `Restore failed: ${err.message}` });
    } finally {
      setIsRestoring(false);
    }
  };

  const handleResetStatistics = async () => {
    const confirmation = window.confirm(
      "Are you sure you want to reset all your reading and listening statistics?\n\n" +
      "This includes activity history, words read counts, listening time, etc.\n\n" +
      "Your account, books, texts, and learned word statuses will NOT be affected.\n\n" +
      "This action cannot be undone."
    );
    if (!confirmation) {
      setResetStatsMessage({ type: 'info', text: 'Statistics reset cancelled.' });
      return;
    }
    setIsResettingStats(true);
    setResetStatsMessage({ type: '', text: '' });
    try {
      const result = (await resetUserStatistics()) as { message?: string } | null;
      setResetStatsMessage({ type: 'success', text: result?.message || 'Statistics reset successfully.' });
      setTimeout(() => setResetStatsMessage({ type: '', text: '' }), 5000);
    } catch (e: unknown) { const err = e as Error;
      setResetStatsMessage({ type: 'danger', text: `Reset failed: ${err.message}` });
    } finally {
      setIsResettingStats(false);
    }
  };

  const handleTestAiProvider = useCallback(async (provider: string) => {
    setTestingAiProvider(true);
    setAiProviderTestResult(null);
    try {
      // The test reads the saved settings, so a model name still waiting to save goes out first.
      if (!(await flushSettings())) {
        setAiProviderTestResult({
          provider,
          result: {
            success: false,
            message: "Your latest changes aren't saved yet, so the test would use the old ones. Retry the save first."
          }
        });
        return;
      }
      setAiProviderTestResult({ provider, result: await api.testAiProvider(provider) });
    } catch (e: unknown) { const err = e as Error;
      setAiProviderTestResult({ provider, result: { success: false, message: err.message } });
    } finally {
      setTestingAiProvider(false);
    }
  }, [flushSettings]);

  // A field of one provider's settings. The whole provider map is one auto-saved setting: entries
  // are keyed by provider, so a switch to another provider can never land an edit on the wrong one.
  const handleAiProviderConfigChange = (provider: string, field: AiProviderConfigField, value: string) => {
    const current = settings.aiProviders ?? {};
    setField('aiProviders', { ...current, [provider]: { ...current[provider], [field]: value } }, SAVE_DELAY_MS.typing);
  };

  // AI provider keys are write-only secrets like the ones below, one per provider.
  const handleSaveAiApiKey = useCallback(async (provider: string, value: string) => {
    if (!value.trim()) return;
    const saved = await updateUserSettings({ aiApiKeys: { [provider]: value.trim() } });
    applyServerValues({ aiProvidersWithApiKey: saved.aiProvidersWithApiKey ?? [] });
    updateSetting('aiProvidersWithApiKey', saved.aiProvidersWithApiKey ?? []);
  }, [applyServerValues, updateSetting]);

  const handleClearAiApiKey = useCallback(async (provider: string) => {
    const saved = await updateUserSettings({ aiApiKeys: { [provider]: '' } });
    applyServerValues({ aiProvidersWithApiKey: saved.aiProvidersWithApiKey ?? [] });
    updateSetting('aiProvidersWithApiKey', saved.aiProvidersWithApiKey ?? []);
  }, [applyServerValues, updateSetting]);

  const handleTestHardcover = useCallback(async () => {
    setTestingHardcover(true);
    setHardcoverTestResult(null);
    setHardcoverSyncMessage({ type: '', text: '' });
    try {
      const result = await getHardcoverStatus();
      setHardcoverTestResult(result);
    } catch (e: unknown) { const err = e as Error;
      setHardcoverTestResult({ connected: false, message: err.message || 'Failed to test Hardcover connection.' });
    } finally {
      setTestingHardcover(false);
    }
  }, []);

  // Re-throws so HardcoverSettings keeps the typed token for a retry.
  const handleSaveHardcoverToken = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setHardcoverSyncMessage({ type: '', text: '' });
    try {
      const saved = await updateUserSettings({ hardcoverApiToken: token.trim() });
      applyServerValues({
        hasHardcoverApiToken: saved.hasHardcoverApiToken ?? true,
        ...(saved.hardcoverLastSyncAt ? { hardcoverLastSyncAt: saved.hardcoverLastSyncAt } : {})
      });
      updateSetting('hasHardcoverApiToken', saved.hasHardcoverApiToken ?? true);
      setHardcoverSyncMessage({ type: 'success', text: 'Hardcover token saved.' });
    } catch (e: unknown) { const err = e as Error;
      setHardcoverSyncMessage({ type: 'danger', text: err.message || 'Failed to save Hardcover token.' });
      throw err;
    }
    try {
      setHardcoverTestResult(await getHardcoverStatus());
    } catch (e: unknown) { const err = e as Error;
      setHardcoverTestResult({ connected: false, message: err.message || 'Failed to test Hardcover connection.' });
    }
  }, [applyServerValues, updateSetting]);

  const handleClearHardcoverToken = useCallback(async () => {
    setHardcoverSyncMessage({ type: '', text: '' });
    setHardcoverTestResult(null);
    try {
      await updateUserSettings({ clearHardcoverApiToken: true });
      // Clearing the token also turns sync off on the server.
      applyServerValues({
        hasHardcoverApiToken: false,
        hardcoverSyncEnabled: false,
        hardcoverLastSyncAt: null
      });
      updateSetting('hasHardcoverApiToken', false);
      updateSetting('hardcoverSyncEnabled', false);
      setHardcoverSyncMessage({ type: 'success', text: 'Hardcover token cleared.' });
    } catch (e: unknown) { const err = e as Error;
      setHardcoverSyncMessage({ type: 'danger', text: err.message || 'Failed to clear Hardcover token.' });
    }
  }, [applyServerValues, updateSetting]);

  // Write-only provider keys (Azure/Google/Wiktionary/Discord). Saved/cleared on their
  // own, never with the other settings; the server returns only the has* booleans. Re-throws so
  // SecretKeyField shows the error and keeps the typed value for a retry.
  const handleSaveProviderKey = useCallback(async (field: string, value: string) => {
    if (!value.trim()) return;
    const saved = await updateUserSettings({ [field]: value.trim() } as UpdateUserSettingsInput);
    applyServerValues(applyProviderKeyFlags(saved));
  }, [applyServerValues]);

  const handleClearProviderKey = useCallback(async (field: string) => {
    const saved = await updateUserSettings({ [field]: '' } as UpdateUserSettingsInput);
    applyServerValues(applyProviderKeyFlags(saved));
  }, [applyServerValues]);

  const handleSyncAllHardcover = useCallback(async () => {
    setSyncingHardcover(true);
    setHardcoverSyncMessage({ type: '', text: '' });
    try {
      const result = (await syncAllHardcover()) as { message?: string } | null;
      setHardcoverSyncMessage({ type: 'success', text: result?.message || 'Hardcover sync completed.' });
      const refreshed = await getUserSettings();
      if (refreshed.hardcoverLastSyncAt) {
        applyServerValues({ hardcoverLastSyncAt: refreshed.hardcoverLastSyncAt });
      }
    } catch (e: unknown) { const err = e as Error;
      setHardcoverSyncMessage({ type: 'danger', text: err.message || 'Hardcover sync failed.' });
    } finally {
      setSyncingHardcover(false);
    }
  }, [applyServerValues]);

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId);
    const el = sectionRefs.current[sectionId];
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" role="status">
          <span className="visually-hidden">Loading settings...</span>
        </Spinner>
      </Container>
    );
  }

  // Settings never loaded: render the error on its own. Showing the form here would let a save
  // PUT the component's default values over the real ones on the server.
  if (loadFailed) {
    return (
      <Container className="py-4" style={{ maxWidth: '1100px' }}>
        <h2 className="settings-page-header">Settings</h2>
        <Alert variant="danger">
          <p className="mb-3">{error || 'Failed to load settings. Please try again later.'}</p>
          <Button variant="outline-danger" onClick={() => setReloadKey(k => k + 1)}>
            Try again
          </Button>
        </Alert>
      </Container>
    );
  }

  return (
    <Container className="py-4" style={{ maxWidth: '1100px' }}>
      <h2 className="settings-page-header settings-page-header--with-hint">Settings</h2>
      <p className="settings-page-hint text-muted">Changes are saved automatically.</p>

      <div className="settings-layout">
        {/* Sidebar */}
        <nav className="settings-sidebar">
          {SECTIONS.map(s => (
            <button
              key={s.id}
              className={`settings-sidebar-item ${activeSection === s.id ? 'active' : ''}`}
              onClick={() => scrollToSection(s.id)}
              type="button"
            >
              <span className="settings-sidebar-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>

        {/* Content */}
        <div className="settings-content">
          <Form onSubmit={handleSubmit} onBlur={saveNow} id="settings-form">
            {/* Appearance */}
            <div ref={el => { sectionRefs.current.appearance = el; }} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83C\uDFA8'}</span>
                <span>Appearance</span>
              </div>
              <AppearanceSettings settings={settings as Settings} handleChange={handleChange} />
            </div>

            {/* Reading */}
            <div ref={el => { sectionRefs.current.reading = el; }} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83D\uDCDA'}</span>
                <span>Reading</span>
              </div>
              <ReadingSettings
                settings={settings as Settings}
                handleChange={handleChange}
                languages={languages as Array<{ languageId: number; name: string; code?: string | null }>}
                loadingLanguages={loadingLanguages}
                onSaveProviderKey={handleSaveProviderKey}
                onClearProviderKey={handleClearProviderKey}
              />
            </div>

            {/* Navigation */}
            <div ref={el => { sectionRefs.current.navigation = el; }} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\u2699\uFE0F'}</span>
                <span>Navigation</span>
              </div>
              <NavigationSettings settings={settings as Settings} handleChange={handleChange} />
            </div>

            {/* AI Provider */}
            <div ref={el => { sectionRefs.current.ai = el; }} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83E\uDD16'}</span>
                <span>AI Provider</span>
              </div>
              <AiProviderSettings
                settings={settings as Settings}
                handleChange={handleChange}
                providers={aiProviderCatalog}
                providersError={aiProviderCatalogError}
                onProviderConfigChange={handleAiProviderConfigChange}
                onSaveApiKey={handleSaveAiApiKey}
                onClearApiKey={handleClearAiApiKey}
                testingConnection={testingAiProvider}
                testResult={aiProviderTestResult}
                onTestConnection={handleTestAiProvider}
                saveNow={flushSettings}
              />
            </div>

            {/* Discord */}
            <div ref={el => { sectionRefs.current.discord = el; }} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83D\uDCE8'}</span>
                <span>Discord Reports</span>
              </div>
              <DiscordSettings
                settings={settings as Settings}
                handleChange={handleChange}
                onSaveProviderKey={handleSaveProviderKey}
                onClearProviderKey={handleClearProviderKey}
                onSetBrowserTimezone={handleSetBrowserTimezone}
                reportPeriod={reportPeriod}
                setReportPeriod={setReportPeriod}
                reportDays={reportDays}
                setReportDays={setReportDays}
                isSendingReport={isSendingReport}
                reportMessage={reportMessage}
                onSendReportNow={handleSendReportNow}
              />
            </div>

            {/* Hardcover */}
            <div ref={el => { sectionRefs.current.hardcover = el; }} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">HC</span>
                <span>Hardcover</span>
              </div>
              <HardcoverSettings
                settings={settings as Settings}
                handleChange={handleChange}
                testingHardcover={testingHardcover}
                hardcoverTestResult={hardcoverTestResult}
                syncingHardcover={syncingHardcover}
                hardcoverSyncMessage={hardcoverSyncMessage}
                onTestConnection={handleTestHardcover}
                onSaveToken={handleSaveHardcoverToken}
                onClearToken={handleClearHardcoverToken}
                onSyncAll={handleSyncAllHardcover}
              />
            </div>
          </Form>

          {/* Data Management - outside form since it has independent actions */}
          <div ref={el => { sectionRefs.current.data = el; }} className="settings-section-card mb-4">
            <div className="settings-section-header">
              <span className="settings-section-header-icon">{'\uD83D\uDDC4\uFE0F'}</span>
              <span>Data Management</span>
            </div>
            <DataManagementSettings
              audioStorage={audioStorage}
              loadingStorage={loadingStorage}
              storageError={storageError}
              isBackingUp={isBackingUp}
              backupMessage={backupMessage}
              onBackupClick={handleBackupClick}
              restoreFile={restoreFile}
              isRestoring={isRestoring}
              restoreMessage={restoreMessage}
              onRestoreFileChange={handleRestoreFileChange}
              onRestoreClick={handleRestoreClick}
              fileInputRef={fileInputRef}
              isResettingStats={isResettingStats}
              resetStatsMessage={resetStatsMessage}
              onResetStatistics={handleResetStatistics}
            />
          </div>
        </div>
      </div>

      <SaveStatus status={saveStatus} error={saveError} onRetry={saveNow} />
    </Container>
  );
};

export default UserSettings;
