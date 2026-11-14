import React, { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { getUserSettings } from '../utils/api';
import { applyReaderStatusMarkers, persistTheme, watchTheme } from '../utils/theme';
import {
  SettingsContext,
  getInitialSettings,
  mergeSettings,
  type Settings,
  type SettingKey
} from './SettingsContext';

export type SettingsProviderProps = {
  children: ReactNode;
};

export const SettingsProvider: React.FC<SettingsProviderProps> = ({ children }) => {
  const [settings, setSettings] = useState<Settings>(getInitialSettings);
  const [loadingSettings, setLoadingSettings] = useState(false);
  const [errorSettings, setErrorSettings] = useState<string | null>(null);
  const settingsRequestRef = useRef(0);
  const editsDuringLoadRef = useRef<Partial<Settings>>({});

  useEffect(() => {
    persistTheme(settings.theme);
    return watchTheme(() => settings.theme);
  }, [settings.theme]);

  useEffect(() => {
    applyReaderStatusMarkers(settings.readerStatusMarkersEnabled);
  }, [settings.readerStatusMarkersEnabled]);

  const fetchSettings = useCallback(async () => {
    const requestId = ++settingsRequestRef.current;
    editsDuringLoadRef.current = {};
    setErrorSettings(null);
    try {
      const data = (await getUserSettings()) as Partial<Settings> | null | undefined;
      if (requestId !== settingsRequestRef.current) return;
      // The fetched snapshot may predate a toolbar change or its debounced save.
      const localEdits = editsDuringLoadRef.current;
      setSettings((prev) => ({ ...mergeSettings(data, prev), ...localEdits }));
    } catch (err) {
      if (requestId !== settingsRequestRef.current) return;
      console.error('[SettingsContext] Failed to load settings:', err);
      setErrorSettings('Failed to load settings. Using defaults.');
    } finally {
      if (requestId === settingsRequestRef.current) setLoadingSettings(false);
    }
  }, []);

  useEffect(() => {
    // Fetch settings when the provider mounts (only rendered when authenticated)
    fetchSettings();
    return () => { settingsRequestRef.current += 1; };
  }, [fetchSettings]);

  // The next load starts from this copy until the server answers, so it follows every change,
  // not only the fetched values: otherwise a size or width set in the reader comes back at its
  // old value on reload.
  useEffect(() => {
    try {
      localStorage.setItem('cachedSettings', JSON.stringify(settings));
    } catch {
      // Storage full or blocked: the server copy still loads.
    }
  }, [settings]);

  // Update a specific setting locally; the API write is triggered from
  // the component making the change (so it can debounce/show save state).
  const updateSetting = useCallback(
    <K extends SettingKey>(key: K, value: Settings[K]) => {
      editsDuringLoadRef.current = { ...editsDuringLoadRef.current, [key]: value };
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
