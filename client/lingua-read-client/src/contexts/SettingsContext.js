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
  sentenceMode: false,
  sentenceAudioRepeats: 1,
  sentenceTtsEnabled: false,
  sentenceTtsRate: 1,
  defaultLanguageId: 0,
  translationTargetLanguageCode: 'EN',
  autoAdvanceToNextLesson: false,
  showProgressStats: true,
  showDesktopLessonControls: true,
  lineSpacing: 1.5, // Added lineSpacing
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

// Create the provider component
export const SettingsProvider = ({ children }) => {
  const [settings, setSettings] = useState(defaultSettings);
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [errorSettings, setErrorSettings] = useState(null);

  const fetchSettings = useCallback(async () => {
    setLoadingSettings(true);
    setErrorSettings(null);
    console.log('[SettingsContext] Fetching settings...');
    try {
      const data = await getUserSettings();
      console.log('[SettingsContext] Settings fetched:', data);
      setSettings({
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
        sentenceMode: data.sentenceMode ?? defaultSettings.sentenceMode,
        sentenceAudioRepeats: data.sentenceAudioRepeats ?? defaultSettings.sentenceAudioRepeats,
        sentenceTtsEnabled: data.sentenceTtsEnabled ?? defaultSettings.sentenceTtsEnabled,
        sentenceTtsRate: data.sentenceTtsRate ?? defaultSettings.sentenceTtsRate,
        defaultLanguageId: data.defaultLanguageId || defaultSettings.defaultLanguageId,
        translationTargetLanguageCode: data.translationTargetLanguageCode || defaultSettings.translationTargetLanguageCode,
        autoAdvanceToNextLesson: data.autoAdvanceToNextLesson ?? defaultSettings.autoAdvanceToNextLesson,
        showProgressStats: data.showProgressStats ?? defaultSettings.showProgressStats,
        lineSpacing: data.lineSpacing || defaultSettings.lineSpacing, // Fetch lineSpacing
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
    } catch (err) {
      console.error('[SettingsContext] Failed to load settings:', err);
      setErrorSettings('Failed to load settings. Using defaults.');
      setSettings(defaultSettings); // Fallback to defaults on error
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