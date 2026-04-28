import React, { createContext, useState, useEffect, useCallback } from 'react';
import { getUserSettings } from '../utils/api'; // Assuming getUserSettings is in api.js

// Default settings structure
const defaultSettings = {
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
  showProgressStats: true,
  showDesktopLessonControls: true,
  lineSpacing: 1.5,
  paragraphSpacing: 1.0,
  discordWeeklyReportEnabled: false,
  discordWebhookUrl: '',
  discordWeeklyReportDayOfWeek: 'Monday',
  discordWeeklyReportHourLocal: 8,
  discordTimezoneOffsetMinutes: 0,
  srsMaxNewCards: 20,
  srsMaxReviews: 200,
  srsReviewOrder: 'mix',
  srsMaxIntervalDays: 36500,
  srsLapseMinimumIntervalDays: 1,
  srsLearningStepMinutes: '1,10',
  // Add other settings as needed
};

// Create the context
export const SettingsContext = createContext({
  settings: defaultSettings,
  loadingSettings: true,
  errorSettings: null,
  updateSetting: () => {}, // Placeholder function
  refetchSettings: async () => {}, // Placeholder function
});

// Load cached settings from localStorage, merging with defaults for forward-compat
const getInitialSettings = () => {
  try {
    const cached = localStorage.getItem('cachedSettings');
    if (cached) {
      const parsed = JSON.parse(cached);
      return { ...defaultSettings, ...parsed };
    }
  } catch {
    // Ignore parse errors, fall through to defaults
  }
  return defaultSettings;
};

const mergeSettings = (data) => ({
  theme: data.theme || defaultSettings.theme,
  textSize: data.textSize || defaultSettings.textSize,
  textFont: data.textFont || defaultSettings.textFont,
  readingUiMode: data.readingUiMode || defaultSettings.readingUiMode,
  readerContentWidth: data.readerContentWidth || defaultSettings.readerContentWidth,
  readingDensity: data.readingDensity || defaultSettings.readingDensity,
  showWordInfoPanel: data.showWordInfoPanel ?? defaultSettings.showWordInfoPanel,
  readerParagraphIndent: data.readerParagraphIndent ?? defaultSettings.readerParagraphIndent,
  readerTextAlignment: data.readerTextAlignment || defaultSettings.readerTextAlignment,
  leftPanelWidth: data.leftPanelWidth || defaultSettings.leftPanelWidth,
  autoTranslateWords: data.autoTranslateWords ?? defaultSettings.autoTranslateWords,
  autoTranslateOnOpen: data.autoTranslateOnOpen ?? defaultSettings.autoTranslateOnOpen,
  pauseOnWordClick: data.pauseOnWordClick ?? defaultSettings.pauseOnWordClick,
  highlightKnownWords: data.highlightKnownWords ?? defaultSettings.highlightKnownWords,
  tooltipOnlyForSavedWords: data.tooltipOnlyForSavedWords ?? defaultSettings.tooltipOnlyForSavedWords,
  sentenceMode: data.sentenceMode ?? defaultSettings.sentenceMode,
  sentenceAudioRepeats: data.sentenceAudioRepeats ?? defaultSettings.sentenceAudioRepeats,
  sentenceTtsEnabled: data.sentenceTtsEnabled ?? defaultSettings.sentenceTtsEnabled,
  sentenceTtsRate: data.sentenceTtsRate ?? defaultSettings.sentenceTtsRate,
  defaultLanguageId: data.defaultLanguageId || defaultSettings.defaultLanguageId,
  translationTargetLanguageCode: data.translationTargetLanguageCode || defaultSettings.translationTargetLanguageCode,
  autoAdvanceToNextLesson: data.autoAdvanceToNextLesson ?? defaultSettings.autoAdvanceToNextLesson,
  showProgressStats: data.showProgressStats ?? defaultSettings.showProgressStats,
  lineSpacing: data.lineSpacing || defaultSettings.lineSpacing,
  paragraphSpacing: data.paragraphSpacing || defaultSettings.paragraphSpacing,
  discordWeeklyReportEnabled: data.discordWeeklyReportEnabled ?? defaultSettings.discordWeeklyReportEnabled,
  discordWebhookUrl: data.discordWebhookUrl || defaultSettings.discordWebhookUrl,
  discordWeeklyReportDayOfWeek: data.discordWeeklyReportDayOfWeek || defaultSettings.discordWeeklyReportDayOfWeek,
  discordWeeklyReportHourLocal: data.discordWeeklyReportHourLocal ?? defaultSettings.discordWeeklyReportHourLocal,
  discordTimezoneOffsetMinutes: data.discordTimezoneOffsetMinutes ?? defaultSettings.discordTimezoneOffsetMinutes,
  srsMaxNewCards: data.srsMaxNewCards ?? defaultSettings.srsMaxNewCards,
  srsMaxReviews: data.srsMaxReviews ?? defaultSettings.srsMaxReviews,
  srsReviewOrder: data.srsReviewOrder || defaultSettings.srsReviewOrder,
  srsMaxIntervalDays: data.srsMaxIntervalDays ?? defaultSettings.srsMaxIntervalDays,
  srsLapseMinimumIntervalDays: data.srsLapseMinimumIntervalDays ?? defaultSettings.srsLapseMinimumIntervalDays,
  srsLearningStepMinutes: data.srsLearningStepMinutes || defaultSettings.srsLearningStepMinutes,
});

// Create the provider component
export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(getInitialSettings);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [errorSettings, setErrorSettings] = useState(null);

  const fetchSettings = useCallback(async () => {
    setErrorSettings(null);
    try {
      const data = await getUserSettings();
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

  // Function to update a specific setting locally
  const updateSetting = useCallback((key, value) => {
    console.log(`[SettingsContext] Updating setting locally - ${key}: ${value}`);
    setSettings(prevSettings => ({
      ...prevSettings,
      [key]: value,
    }));
    // Note: API update should be triggered from the component making the change
    // for better control over saving state (e.g., after debouncing).
  }, []);

  // Function to manually refetch settings if needed
  const refetchSettings = useCallback(async () => {
      await fetchSettings();
  }, [fetchSettings]);


  return (
    <SettingsContext.Provider value={{ settings, loadingSettings, errorSettings, updateSetting, refetchSettings }}>
      {children}
    </SettingsContext.Provider>
  );
};