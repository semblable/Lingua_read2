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
  autoAdvanceAudiobookTracks: boolean;
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
  srsCardType: string;
  minimalHome: boolean;
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
  autoAdvanceAudiobookTracks: true,
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
  srsLearningStepMinutes: '1,10',
  srsCardType: 'translation',
  minimalHome: false
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
const mergeSettings = (
  data: Partial<Settings> | null | undefined,
  currentSettings?: Settings
): Settings => {
  const d = (data || {}) as Partial<Settings>;
  const base = currentSettings || defaultSettings;
  return {
    theme: d.theme || base.theme,
    textSize: d.textSize || base.textSize,
    textFont: d.textFont || base.textFont,
    readingUiMode: d.readingUiMode || base.readingUiMode,
    readerContentWidth: d.readerContentWidth || base.readerContentWidth,
    readingDensity: d.readingDensity || base.readingDensity,
    showWordInfoPanel: d.showWordInfoPanel ?? base.showWordInfoPanel,
    readerParagraphIndent: d.readerParagraphIndent ?? base.readerParagraphIndent,
    readerTextAlignment: d.readerTextAlignment || base.readerTextAlignment,
    leftPanelWidth: d.leftPanelWidth || base.leftPanelWidth,
    autoTranslateWords: d.autoTranslateWords ?? base.autoTranslateWords,
    autoTranslateOnOpen: d.autoTranslateOnOpen ?? base.autoTranslateOnOpen,
    pauseOnWordClick: d.pauseOnWordClick ?? base.pauseOnWordClick,
    highlightKnownWords: d.highlightKnownWords ?? base.highlightKnownWords,
    tooltipOnlyForSavedWords: d.tooltipOnlyForSavedWords ?? base.tooltipOnlyForSavedWords,
    sentenceMode: d.sentenceMode ?? base.sentenceMode,
    sentenceAudioRepeats: d.sentenceAudioRepeats ?? base.sentenceAudioRepeats,
    sentenceTtsEnabled: d.sentenceTtsEnabled ?? base.sentenceTtsEnabled,
    sentenceTtsRate: d.sentenceTtsRate ?? base.sentenceTtsRate,
    defaultLanguageId: d.defaultLanguageId || base.defaultLanguageId,
    translationTargetLanguageCode:
      d.translationTargetLanguageCode || base.translationTargetLanguageCode,
    autoAdvanceToNextLesson: d.autoAdvanceToNextLesson ?? base.autoAdvanceToNextLesson,
    autoAdvanceAudiobookTracks:
      d.autoAdvanceAudiobookTracks ?? base.autoAdvanceAudiobookTracks,
    autoMoveFinishedLessons: d.autoMoveFinishedLessons ?? base.autoMoveFinishedLessons,
    showProgressStats: d.showProgressStats ?? base.showProgressStats,
    showDesktopLessonControls:
      d.showDesktopLessonControls ?? base.showDesktopLessonControls,
    lineSpacing: d.lineSpacing || base.lineSpacing,
    paragraphSpacing: d.paragraphSpacing || base.paragraphSpacing,
    discordWeeklyReportEnabled:
      d.discordWeeklyReportEnabled ?? base.discordWeeklyReportEnabled,
    discordWebhookUrl: d.discordWebhookUrl || base.discordWebhookUrl,
    discordWeeklyReportDayOfWeek:
      d.discordWeeklyReportDayOfWeek || base.discordWeeklyReportDayOfWeek,
    discordWeeklyReportHourLocal:
      d.discordWeeklyReportHourLocal ?? base.discordWeeklyReportHourLocal,
    discordTimezoneOffsetMinutes:
      d.discordTimezoneOffsetMinutes ?? base.discordTimezoneOffsetMinutes,
    hardcoverSyncEnabled: d.hardcoverSyncEnabled ?? base.hardcoverSyncEnabled,
    hasHardcoverApiToken: d.hasHardcoverApiToken ?? base.hasHardcoverApiToken,
    hardcoverLastSyncAt: d.hardcoverLastSyncAt ?? base.hardcoverLastSyncAt,
    useOpenRouter: d.useOpenRouter ?? base.useOpenRouter,
    openRouterApiKey: d.openRouterApiKey || base.openRouterApiKey,
    openRouterModel: d.openRouterModel || base.openRouterModel,
    openRouterReasoningEnabled:
      d.openRouterReasoningEnabled ?? base.openRouterReasoningEnabled,
    openRouterReasoningEffort:
      d.openRouterReasoningEffort || base.openRouterReasoningEffort,
    openRouterStoryReasoningEnabled:
      d.openRouterStoryReasoningEnabled ?? base.openRouterStoryReasoningEnabled,
    openRouterStoryReasoningEffort:
      d.openRouterStoryReasoningEffort || base.openRouterStoryReasoningEffort,
    openRouterTranslationModel:
      d.openRouterTranslationModel ?? base.openRouterTranslationModel,
    openRouterExplanationModel:
      d.openRouterExplanationModel ?? base.openRouterExplanationModel,
    openRouterStoryModel: d.openRouterStoryModel ?? base.openRouterStoryModel,
    openRouterSummarizationModel:
      d.openRouterSummarizationModel ?? base.openRouterSummarizationModel,
    customTranslationPrompt:
      d.customTranslationPrompt ?? base.customTranslationPrompt,
    customExplanationPrompt:
      d.customExplanationPrompt ?? base.customExplanationPrompt,
    customStoryPrompt: d.customStoryPrompt ?? base.customStoryPrompt,
    customSummarizationPrompt:
      d.customSummarizationPrompt ?? base.customSummarizationPrompt,
    srsMaxNewCards: d.srsMaxNewCards ?? base.srsMaxNewCards,
    srsMaxReviews: d.srsMaxReviews ?? base.srsMaxReviews,
    srsReviewOrder: d.srsReviewOrder || base.srsReviewOrder,
    srsMaxIntervalDays: d.srsMaxIntervalDays ?? base.srsMaxIntervalDays,
    srsLapseMinimumIntervalDays:
      d.srsLapseMinimumIntervalDays ?? base.srsLapseMinimumIntervalDays,
    srsLearningStepMinutes: d.srsLearningStepMinutes || base.srsLearningStepMinutes,
    srsCardType: d.srsCardType || base.srsCardType,
    minimalHome: d.minimalHome ?? base.minimalHome
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
      setSettings((prev) => {
        const merged = mergeSettings(data, prev);
        localStorage.setItem('cachedSettings', JSON.stringify(merged));
        return merged;
      });
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
