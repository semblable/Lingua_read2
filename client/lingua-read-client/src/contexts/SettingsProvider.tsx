import React, { useState, useEffect, useCallback, ReactNode } from 'react';
import { getUserSettings } from '../utils/api';
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

  const fetchSettings = useCallback(async () => {
    setErrorSettings(null);
    try {
      const data = (await getUserSettings()) as Partial<Settings> | null | undefined;
      setSettings((prev) => mergeSettings(data, prev));
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
