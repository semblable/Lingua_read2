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
