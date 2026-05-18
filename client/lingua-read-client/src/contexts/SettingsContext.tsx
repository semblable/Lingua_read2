import React, { createContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { getUserSettings } from '../utils/api';

// User-facing settings shape. Keys here MUST stay in sync with the
// /api/UserSettings response and with mergeSettings() below — those are
// the seams where new settings land.
export type Settings = {
  theme: string;
  textSize: number;
  textFont: string;
  readingUiMode: string;
  readerContentWidth: number;
  readingDensity: string;
  showWordInfoPanel: boolean;
  readerParagraphIndent: boolean;
  readerTextAlignment: string;
  leftPanelWidth: number;
  autoTranslateWords: boolean;
  autoTranslateOnOpen: boolean;
  pauseOnWordClick: boolean;
  highlightKnownWords: boolean;
  tooltipOnlyForSavedWords: boolean;
  sentenceMode: boolean;
  sentenceAudioRepeats: number;
  sentenceTtsEnabled: boolean;
  sentenceTtsRate: number;
  defaultLanguageId: number;
  translationTargetLanguageCode: string;
  autoAdvanceToNextLesson: boolean;
  autoMoveFinishedLessons: boolean;
  showProgressStats: boolean;
  showDesktopLessonControls: boolean;
  lineSpacing: number;
  paragraphSpacing: number;
  discordWeeklyReportEnabled: boolean;
  discordWebhookUrl: string;
  discordWeeklyReportDayOfWeek: string;
  discordWeeklyReportHourLocal: number;
  discordTimezoneOffsetMinutes: number;
  hardcoverSyncEnabled: boolean;
  hasHardcoverApiToken: boolean;
  hardcoverLastSyncAt: string | null;
  useOpenRouter: boolean;
  openRouterApiKey: string;
  openRouterModel: string;
  openRouterReasoningEnabled: boolean;
  openRouterReasoningEffort: string;
  openRouterStoryReasoningEnabled: boolean;
  openRouterStoryReasoningEffort: string;
  openRouterTranslationModel: string;
  openRouterExplanationModel: string;
  openRouterStoryModel: string;
  openRouterSummarizationModel: string;
  customTranslationPrompt: string;
  customExplanationPrompt: string;
  customStoryPrompt: string;
  customSummarizationPrompt: string;
  srsMaxNewCards: number;
  srsMaxReviews: number;
  srsReviewOrder: string;
  srsMaxIntervalDays: number;
  srsLapseMinimumIntervalDays: number;
  srsLearningStepMinutes: string;
};

export type SettingKey = keyof Settings;
export type SettingValue = Settings[SettingKey];

export type SettingsContextValue = {
  settings: Settings;
  loadingSettings: boolean;
  errorSettings: string | null;
  updateSetting: <K extends SettingKey>(key: K, value: Settings[K]) => void;
  refetchSettings: () => Promise<void>;
};

// Default settings structure
const defaultSettings: Settings = {
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
  sentenceMode: false,
  sentenceAudioRepeats: 1,
  sentenceTtsEnabled: false,
  sentenceTtsRate: 1,
  defaultLanguageId: 0,
  translationTargetLanguageCode: 'EN',
  autoAdvanceToNextLesson: false,
  autoMoveFinishedLessons: false,
  showProgressStats: true,
  showDesktopLessonControls: true,
  lineSpacing: 1.5,
  paragraphSpacing: 1.0,
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
  srsMaxNewCards: 20,
  srsMaxReviews: 200,
  srsReviewOrder: 'mix',
  srsMaxIntervalDays: 36500,
  srsLapseMinimumIntervalDays: 1,
  srsLearningStepMinutes: '1,10'
};

// Create the context
export const SettingsContext = createContext<SettingsContextValue>({
  settings: defaultSettings,
  loadingSettings: true,
  errorSettings: null,
  updateSetting: () => {},
  refetchSettings: async () => {}
});

// Load cached settings from localStorage, merging with defaults for forward-compat
const getInitialSettings = (): Settings => {
  try {
    const cached = localStorage.getItem('cachedSettings');
    if (cached) {
      const parsed = JSON.parse(cached) as Partial<Settings>;
      return { ...defaultSettings, ...parsed };
    }
  } catch {
    // Ignore parse errors, fall through to defaults
  }
  return defaultSettings;
};

// Server response is permissive; coerce each field to the typed shape using
// the default as the fallback when the server omits a key or sends null/undefined.
const mergeSettings = (data: Partial<Settings> | null | undefined): Settings => {
  const d = (data || {}) as Partial<Settings>;
  return {
    theme: d.theme || defaultSettings.theme,
    textSize: d.textSize || defaultSettings.textSize,
    textFont: d.textFont || defaultSettings.textFont,
    readingUiMode: d.readingUiMode || defaultSettings.readingUiMode,
    readerContentWidth: d.readerContentWidth || defaultSettings.readerContentWidth,
    readingDensity: d.readingDensity || defaultSettings.readingDensity,
    showWordInfoPanel: d.showWordInfoPanel ?? defaultSettings.showWordInfoPanel,
    readerParagraphIndent: d.readerParagraphIndent ?? defaultSettings.readerParagraphIndent,
    readerTextAlignment: d.readerTextAlignment || defaultSettings.readerTextAlignment,
    leftPanelWidth: d.leftPanelWidth || defaultSettings.leftPanelWidth,
    autoTranslateWords: d.autoTranslateWords ?? defaultSettings.autoTranslateWords,
    autoTranslateOnOpen: d.autoTranslateOnOpen ?? defaultSettings.autoTranslateOnOpen,
    pauseOnWordClick: d.pauseOnWordClick ?? defaultSettings.pauseOnWordClick,
    highlightKnownWords: d.highlightKnownWords ?? defaultSettings.highlightKnownWords,
    tooltipOnlyForSavedWords: d.tooltipOnlyForSavedWords ?? defaultSettings.tooltipOnlyForSavedWords,
    sentenceMode: d.sentenceMode ?? defaultSettings.sentenceMode,
    sentenceAudioRepeats: d.sentenceAudioRepeats ?? defaultSettings.sentenceAudioRepeats,
    sentenceTtsEnabled: d.sentenceTtsEnabled ?? defaultSettings.sentenceTtsEnabled,
    sentenceTtsRate: d.sentenceTtsRate ?? defaultSettings.sentenceTtsRate,
    defaultLanguageId: d.defaultLanguageId || defaultSettings.defaultLanguageId,
    translationTargetLanguageCode:
      d.translationTargetLanguageCode || defaultSettings.translationTargetLanguageCode,
    autoAdvanceToNextLesson: d.autoAdvanceToNextLesson ?? defaultSettings.autoAdvanceToNextLesson,
    autoMoveFinishedLessons: d.autoMoveFinishedLessons ?? defaultSettings.autoMoveFinishedLessons,
    showProgressStats: d.showProgressStats ?? defaultSettings.showProgressStats,
    showDesktopLessonControls:
      d.showDesktopLessonControls ?? defaultSettings.showDesktopLessonControls,
    lineSpacing: d.lineSpacing || defaultSettings.lineSpacing,
    paragraphSpacing: d.paragraphSpacing || defaultSettings.paragraphSpacing,
    discordWeeklyReportEnabled:
      d.discordWeeklyReportEnabled ?? defaultSettings.discordWeeklyReportEnabled,
    discordWebhookUrl: d.discordWebhookUrl || defaultSettings.discordWebhookUrl,
    discordWeeklyReportDayOfWeek:
      d.discordWeeklyReportDayOfWeek || defaultSettings.discordWeeklyReportDayOfWeek,
    discordWeeklyReportHourLocal:
      d.discordWeeklyReportHourLocal ?? defaultSettings.discordWeeklyReportHourLocal,
    discordTimezoneOffsetMinutes:
      d.discordTimezoneOffsetMinutes ?? defaultSettings.discordTimezoneOffsetMinutes,
    hardcoverSyncEnabled: d.hardcoverSyncEnabled ?? defaultSettings.hardcoverSyncEnabled,
    hasHardcoverApiToken: d.hasHardcoverApiToken ?? defaultSettings.hasHardcoverApiToken,
    hardcoverLastSyncAt: d.hardcoverLastSyncAt ?? defaultSettings.hardcoverLastSyncAt,
    useOpenRouter: d.useOpenRouter ?? defaultSettings.useOpenRouter,
    openRouterApiKey: d.openRouterApiKey || defaultSettings.openRouterApiKey,
    openRouterModel: d.openRouterModel || defaultSettings.openRouterModel,
    openRouterReasoningEnabled:
      d.openRouterReasoningEnabled ?? defaultSettings.openRouterReasoningEnabled,
    openRouterReasoningEffort:
      d.openRouterReasoningEffort || defaultSettings.openRouterReasoningEffort,
    openRouterStoryReasoningEnabled:
      d.openRouterStoryReasoningEnabled ?? defaultSettings.openRouterStoryReasoningEnabled,
    openRouterStoryReasoningEffort:
      d.openRouterStoryReasoningEffort || defaultSettings.openRouterStoryReasoningEffort,
    openRouterTranslationModel:
      d.openRouterTranslationModel ?? defaultSettings.openRouterTranslationModel,
    openRouterExplanationModel:
      d.openRouterExplanationModel ?? defaultSettings.openRouterExplanationModel,
    openRouterStoryModel: d.openRouterStoryModel ?? defaultSettings.openRouterStoryModel,
    openRouterSummarizationModel:
      d.openRouterSummarizationModel ?? defaultSettings.openRouterSummarizationModel,
    customTranslationPrompt:
      d.customTranslationPrompt ?? defaultSettings.customTranslationPrompt,
    customExplanationPrompt:
      d.customExplanationPrompt ?? defaultSettings.customExplanationPrompt,
    customStoryPrompt: d.customStoryPrompt ?? defaultSettings.customStoryPrompt,
    customSummarizationPrompt:
      d.customSummarizationPrompt ?? defaultSettings.customSummarizationPrompt,
    srsMaxNewCards: d.srsMaxNewCards ?? defaultSettings.srsMaxNewCards,
    srsMaxReviews: d.srsMaxReviews ?? defaultSettings.srsMaxReviews,
    srsReviewOrder: d.srsReviewOrder || defaultSettings.srsReviewOrder,
    srsMaxIntervalDays: d.srsMaxIntervalDays ?? defaultSettings.srsMaxIntervalDays,
    srsLapseMinimumIntervalDays:
      d.srsLapseMinimumIntervalDays ?? defaultSettings.srsLapseMinimumIntervalDays,
    srsLearningStepMinutes: d.srsLearningStepMinutes || defaultSettings.srsLearningStepMinutes
  };
};

export type SettingsProviderProps = {
  children: ReactNode;
};

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(getInitialSettings);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [errorSettings, setErrorSettings] = useState<string | null>(null);

  const fetchSettings = useCallback(async () => {
    setErrorSettings(null);
    try {
      const data = (await getUserSettings()) as Partial<Settings> | null | undefined;
      const merged = mergeSettings(data);
      setSettings(merged);
      localStorage.setItem('cachedSettings', JSON.stringify(merged));
    } catch (err) {
      console.error('[SettingsContext] Failed to load settings:', err);
      setErrorSettings('Failed to load settings. Using defaults.');
    } finally {
      setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    // Fetch settings when the provider mounts (only rendered when authenticated)
    fetchSettings();
  }, [fetchSettings]);

  // Update a specific setting locally; the API write is triggered from
  // the component making the change (so it can debounce/show save state).
  const updateSetting = useCallback(
    <K extends SettingKey>(key: K, value: Settings[K]) => {
      console.log(`[SettingsContext] Updating setting locally - ${key}: ${value}`);
      setSettings((prevSettings) => ({
        ...prevSettings,
        [key]: value
      }));
    },
    []
  );

  const refetchSettings = useCallback(async () => {
    await fetchSettings();
  }, [fetchSettings]);

  return (
    <SettingsContext.Provider
      value={{ settings, loadingSettings, errorSettings, updateSetting, refetchSettings }}
    >
      {children}
    </SettingsContext.Provider>
  );
};
