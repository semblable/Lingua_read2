import React, { useState, useEffect, useRef, useContext, useCallback } from 'react';
import { Container, Form, Button, Alert, Spinner } from 'react-bootstrap';
import {
  getUserSettings, updateUserSettings, getAllLanguages,
  backupDatabase, restoreDatabase, resetUserStatistics, sendDiscordReport, getAudioStorageSize,
  getHardcoverStatus, syncAllHardcover
} from '../utils/api';
import * as api from '../utils/api';
import { SettingsContext } from '../contexts/SettingsContext';
import type { Settings, SettingKey } from '../contexts/SettingsContext';
import type { Language } from '../utils/api/languages';

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
import DiscordSettings from '../components/settings/DiscordSettings';
import HardcoverSettings from '../components/settings/HardcoverSettings';
import DataManagementSettings from '../components/settings/DataManagementSettings';
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

const UserSettings = () => {
  const browserTimezoneOffsetMinutes = -new Date().getTimezoneOffset();
  // Local settings state holds the subset this page initializes/persists;
  // missing keys are filled in by the API response on first load.
  const [settings, setSettings] = useState<PageSettings>({
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
    autoAdvanceToNextLesson: false,
    autoAdvanceAudiobookTracks: true,
    autoMoveFinishedLessons: false,
    showProgressStats: true,
    lineSpacing: 1.5,
    discordWeeklyReportEnabled: false,
    discordWebhookUrl: '',
    discordWeeklyReportDayOfWeek: 'Monday',
    discordWeeklyReportHourLocal: 8,
    discordTimezoneOffsetMinutes: browserTimezoneOffsetMinutes,
    hardcoverSyncEnabled: false,
    hasHardcoverApiToken: false,
    hardcoverLastSyncAt: null,
    useOpenRouter: false,
    openRouterApiKey: '',
    openRouterModel: 'google/gemini-2.5-flash-preview-05-20:free',
    openRouterReasoningEnabled: false,
    openRouterReasoningEffort: 'medium',
    openRouterStoryReasoningEnabled: false,
    openRouterStoryReasoningEffort: 'medium',
    openRouterTranslationModel: '',
    openRouterExplanationModel: '',
    openRouterStoryModel: '',
    openRouterSummarizationModel: '',
    customTranslationPrompt: '',
    customExplanationPrompt: '',
    customStoryPrompt: '',
    customSummarizationPrompt: '',
    minimalHome: false
  });

  const [languages, setLanguages] = useState<Language[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loadingLanguages, setLoadingLanguages] = useState(true);
  const [hasChanges, setHasChanges] = useState(false);
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

  // OpenRouter test state
  const [testingOpenRouter, setTestingOpenRouter] = useState(false);
  const [openRouterTestResult, setOpenRouterTestResult] = useState<{ success?: boolean; message?: string } | null>(null);

  // Audio storage state
  const [audioStorage, setAudioStorage] = useState<AudioStorageInfo | null>(null);
  const [loadingStorage, setLoadingStorage] = useState(false);
  const [storageError, setStorageError] = useState('');

  // Section refs for scroll. Keys are section ids ('appearance', 'reading', …);
  // values are the section's outer <div>.
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const { updateSetting } = useContext(SettingsContext);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const data = await getUserSettings();
        setSettings({
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
          autoAdvanceToNextLesson: data.autoAdvanceToNextLesson ?? false,
          autoAdvanceAudiobookTracks: data.autoAdvanceAudiobookTracks ?? true,
          autoMoveFinishedLessons: data.autoMoveFinishedLessons ?? false,
          showProgressStats: data.showProgressStats ?? true,
          lineSpacing: data.lineSpacing || 1.5,
          discordWeeklyReportEnabled: data.discordWeeklyReportEnabled ?? false,
          discordWebhookUrl: data.discordWebhookUrl || '',
          discordWeeklyReportDayOfWeek: data.discordWeeklyReportDayOfWeek || 'Monday',
          discordWeeklyReportHourLocal: data.discordWeeklyReportHourLocal ?? 8,
          discordTimezoneOffsetMinutes: data.discordTimezoneOffsetMinutes ?? browserTimezoneOffsetMinutes,
          hardcoverSyncEnabled: data.hardcoverSyncEnabled ?? false,
          hasHardcoverApiToken: data.hasHardcoverApiToken ?? false,
          hardcoverLastSyncAt: data.hardcoverLastSyncAt ?? null,
          useOpenRouter: data.useOpenRouter ?? false,
          openRouterApiKey: data.openRouterApiKey || '',
          openRouterModel: data.openRouterModel || 'google/gemini-2.5-flash-preview-05-20:free',
          openRouterReasoningEnabled: data.openRouterReasoningEnabled ?? false,
          openRouterReasoningEffort: data.openRouterReasoningEffort || 'medium',
          openRouterStoryReasoningEnabled: data.openRouterStoryReasoningEnabled ?? false,
          openRouterStoryReasoningEffort: data.openRouterStoryReasoningEffort || 'medium',
          openRouterTranslationModel: data.openRouterTranslationModel ?? '',
          openRouterExplanationModel: data.openRouterExplanationModel ?? '',
          openRouterStoryModel: data.openRouterStoryModel ?? '',
          openRouterSummarizationModel: data.openRouterSummarizationModel ?? '',
          customTranslationPrompt: data.customTranslationPrompt ?? '',
          customExplanationPrompt: data.customExplanationPrompt ?? '',
          customStoryPrompt: data.customStoryPrompt ?? '',
          customSummarizationPrompt: data.customSummarizationPrompt ?? '',
          minimalHome: localStorage.getItem('minimalHome') === 'true'
        });
      } catch (e: unknown) { const err = e as Error;
        setError('Failed to load settings. Please try again later.');
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

    fetchSettings();
    fetchLanguages();
    fetchStorageSize();
  }, [browserTimezoneOffsetMinutes]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = e.target as HTMLInputElement;
    const { name, value, type } = target;
    const checked = target.checked;
    let processedValue: string | number | boolean = value;
    if (type === 'checkbox') {
      processedValue = checked;
    } else if (
      type === 'number' || type === 'range' ||
      name === 'textSize' || name === 'readerContentWidth' ||
      name === 'leftPanelWidth' || name === 'lineSpacing' ||
      name === 'defaultLanguageId' || name === 'discordWeeklyReportHourLocal' ||
      name === 'discordTimezoneOffsetMinutes'
    ) {
      const parsed = name === 'lineSpacing' ? parseFloat(value) : parseInt(value, 10);
      processedValue = isNaN(parsed) ? 0 : parsed;
    }
    setSettings((prev) => ({ ...prev, [name]: processedValue }));
    setHasChanges(true);
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess(false);

    try {
      const savedSettings = await updateUserSettings(settings);
      const persistedSettings = { ...settings, ...savedSettings };

      // Apply theme
      localStorage.setItem('theme', persistedSettings.theme ?? 'dark');
      document.body.classList.remove('light-theme', 'dark-theme', 'classic-dark-theme');
      if (persistedSettings.theme === 'dark') {
        document.body.classList.add('dark-theme');
      } else if (persistedSettings.theme === 'light') {
        document.body.classList.add('light-theme');
      } else if (persistedSettings.theme === 'classic-dark') {
        document.body.classList.add('classic-dark-theme');
      } else {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        document.body.classList.add(prefersDark ? 'dark-theme' : 'light-theme');
      }

      // Update context and localStorage for all settings
      const settingsToSync: SettingKey[] = [
        'theme', 'textSize', 'textFont', 'readingUiMode', 'readerContentWidth',
        'readingDensity', 'showWordInfoPanel', 'readerParagraphIndent', 'readerTextAlignment',
        'leftPanelWidth', 'autoTranslateWords', 'autoTranslateOnOpen', 'pauseOnWordClick', 'highlightKnownWords',
        'tooltipOnlyForSavedWords', 'sentenceTtsEnabled', 'defaultLanguageId', 'translationTargetLanguageCode',
        'autoAdvanceToNextLesson', 'autoAdvanceAudiobookTracks', 'autoMoveFinishedLessons', 'showProgressStats', 'lineSpacing',
        'discordWeeklyReportEnabled', 'discordWebhookUrl', 'discordWeeklyReportDayOfWeek',
        'discordWeeklyReportHourLocal', 'discordTimezoneOffsetMinutes',
        'hardcoverSyncEnabled', 'hasHardcoverApiToken', 'hardcoverLastSyncAt',
        'useOpenRouter', 'openRouterApiKey', 'openRouterModel',
        'openRouterReasoningEnabled', 'openRouterReasoningEffort',
        'openRouterStoryReasoningEnabled', 'openRouterStoryReasoningEffort',
        'openRouterTranslationModel', 'openRouterExplanationModel',
        'openRouterStoryModel', 'openRouterSummarizationModel',
        'customTranslationPrompt', 'customExplanationPrompt',
        'customStoryPrompt', 'customSummarizationPrompt',
        'minimalHome'
      ];
      const syncSetting = <K extends SettingKey>(key: K) => {
        const val = persistedSettings[key];
        if (val === undefined || val === null) return;
        updateSetting(key, val as Settings[K]);
        localStorage.setItem(key, String(val));
      };
      settingsToSync.forEach(syncSetting);
      localStorage.setItem('cachedSettings', JSON.stringify(persistedSettings));

      setSuccess(true);
      setHasChanges(false);
      setTimeout(() => setSuccess(false), 3000);
    } catch (e: unknown) { const err = e as Error;
      setError(err.message || 'Failed to update settings. Please try again.');
    } finally {
      setSaving(false);
    }
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
    setSettings((prev: any) => ({ ...prev, discordTimezoneOffsetMinutes: offsetMinutes }));
    setHasChanges(true);
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

  const handleTestOpenRouter = useCallback(async () => {
    setTestingOpenRouter(true);
    setOpenRouterTestResult(null);
    try {
      await api.updateUserSettings(settings);
      const result = await api.testOpenRouterConnection();
      setOpenRouterTestResult(result as { success?: boolean; message?: string });
    } catch (e: unknown) { const err = e as Error;
      setOpenRouterTestResult({ success: false, message: err.message });
    } finally {
      setTestingOpenRouter(false);
    }
  }, [settings]);

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

  const handleSaveHardcoverToken = useCallback(async (token: string) => {
    if (!token.trim()) return;
    setHardcoverSyncMessage({ type: '', text: '' });
    try {
      const saved = await updateUserSettings({
        hardcoverApiToken: token.trim(),
        hardcoverSyncEnabled: settings.hardcoverSyncEnabled
      });
      setSettings((prev: any) => ({
        ...prev,
        hasHardcoverApiToken: saved.hasHardcoverApiToken ?? true,
        hardcoverSyncEnabled: saved.hardcoverSyncEnabled ?? prev.hardcoverSyncEnabled,
        hardcoverLastSyncAt: saved.hardcoverLastSyncAt ?? prev.hardcoverLastSyncAt
      }));
      setHardcoverSyncMessage({ type: 'success', text: 'Hardcover token saved.' });
      const status = await getHardcoverStatus();
      setHardcoverTestResult(status);
    } catch (e: unknown) { const err = e as Error;
      setHardcoverSyncMessage({ type: 'danger', text: err.message || 'Failed to save Hardcover token.' });
    }
  }, [settings.hardcoverSyncEnabled]);

  const handleClearHardcoverToken = useCallback(async () => {
    setHardcoverSyncMessage({ type: '', text: '' });
    setHardcoverTestResult(null);
    try {
      await updateUserSettings({ clearHardcoverApiToken: true });
      setSettings((prev: any) => ({
        ...prev,
        hasHardcoverApiToken: false,
        hardcoverSyncEnabled: false,
        hardcoverLastSyncAt: null
      }));
      setHasChanges(false);
      setHardcoverSyncMessage({ type: 'success', text: 'Hardcover token cleared.' });
    } catch (e: unknown) { const err = e as Error;
      setHardcoverSyncMessage({ type: 'danger', text: err.message || 'Failed to clear Hardcover token.' });
    }
  }, []);

  const handleSyncAllHardcover = useCallback(async () => {
    setSyncingHardcover(true);
    setHardcoverSyncMessage({ type: '', text: '' });
    try {
      const result = (await syncAllHardcover()) as { message?: string } | null;
      setHardcoverSyncMessage({ type: 'success', text: result?.message || 'Hardcover sync completed.' });
      const refreshed = await getUserSettings();
      setSettings((prev: any) => ({
        ...prev,
        hardcoverLastSyncAt: refreshed.hardcoverLastSyncAt ?? prev.hardcoverLastSyncAt
      }));
    } catch (e: unknown) { const err = e as Error;
      setHardcoverSyncMessage({ type: 'danger', text: err.message || 'Hardcover sync failed.' });
    } finally {
      setSyncingHardcover(false);
    }
  }, []);

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

  return (
    <Container className="py-4" style={{ maxWidth: '1100px' }}>
      <h2 className="settings-page-header">Settings</h2>

      {error && <Alert variant="danger" dismissible onClose={() => setError('')}>{error}</Alert>}
      {success && <Alert variant="success">Settings saved successfully!</Alert>}

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
          <Form onSubmit={handleSubmit} id="settings-form">
            {/* Appearance */}
            <div ref={el => sectionRefs.current.appearance = el} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83C\uDFA8'}</span>
                <span>Appearance</span>
              </div>
              <AppearanceSettings settings={settings as Settings} handleChange={handleChange} />
            </div>

            {/* Reading */}
            <div ref={el => sectionRefs.current.reading = el} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83D\uDCDA'}</span>
                <span>Reading</span>
              </div>
              <ReadingSettings
                settings={settings as Settings}
                handleChange={handleChange}
                languages={languages as Array<{ languageId: number; name: string; code?: string | null }>}
                loadingLanguages={loadingLanguages}
              />
            </div>

            {/* Navigation */}
            <div ref={el => sectionRefs.current.navigation = el} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\u2699\uFE0F'}</span>
                <span>Navigation</span>
              </div>
              <NavigationSettings settings={settings as Settings} handleChange={handleChange} />
            </div>

            {/* AI Provider */}
            <div ref={el => sectionRefs.current.ai = el} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83E\uDD16'}</span>
                <span>AI Provider</span>
              </div>
              <AiProviderSettings
                settings={settings as Settings}
                handleChange={handleChange}
                testingOpenRouter={testingOpenRouter}
                openRouterTestResult={openRouterTestResult}
                onTestConnection={handleTestOpenRouter}
              />
            </div>

            {/* Discord */}
            <div ref={el => sectionRefs.current.discord = el} className="settings-section-card mb-4">
              <div className="settings-section-header">
                <span className="settings-section-header-icon">{'\uD83D\uDCE8'}</span>
                <span>Discord Reports</span>
              </div>
              <DiscordSettings
                settings={settings as Settings}
                handleChange={handleChange}
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
            <div ref={el => sectionRefs.current.hardcover = el} className="settings-section-card mb-4">
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
          <div ref={el => sectionRefs.current.data = el} className="settings-section-card mb-4">
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

      {/* Sticky Save Bar */}
      <div className={`settings-save-bar ${hasChanges ? '' : 'settings-save-bar--hidden'}`}>
        <span className="settings-save-indicator">Unsaved changes</span>
        <Button
          variant="primary"
          type="submit"
          form="settings-form"
          disabled={saving}
        >
          {saving ? (
            <>
              <Spinner animation="border" size="sm" className="me-2" />
              Saving...
            </>
          ) : 'Save Settings'}
        </Button>
      </div>
    </Container>
  );
};

export default UserSettings;
