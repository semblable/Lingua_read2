import { useCallback, useEffect, useRef } from 'react';
import { updateUserSettings } from '../utils/api';
import type { UpdateUserSettingsInput } from '../utils/api/settings';
import type { Settings, SettingKey } from '../contexts/SettingsContext';

type UpdateSetting = <K extends SettingKey>(key: K, value: Settings[K]) => void;

// How long a change waits for the next one before it is sent, so a run of clicks on A+ or ◀
// becomes one request.
export const SETTINGS_SAVE_DELAY_MS = 400;

/**
 * Saves settings changed in place, outside the Settings page (the reader toolbar). A change shows
 * at once through the settings context, which also keeps this browser's cached copy. The server
 * gets one patch per pause, one request at a time, so responses can't land out of order and leave
 * it on an older value. A patch that fails stays queued and goes out with the next change, or when
 * the page is hidden or the component unmounts; those last sends use keepalive, so closing the tab
 * right after a change doesn't cancel them.
 */
export function useSettingsSaver(updateSetting: UpdateSetting): (patch: Partial<Settings>) => void {
  const pendingRef = useRef<Partial<Settings>>({});
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const runningRef = useRef(false);

  const flush = useCallback(async (keepalive = false) => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    // The running loop sends whatever is pending once its request finishes.
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (Object.keys(pendingRef.current).length > 0) {
        const patch = pendingRef.current;
        pendingRef.current = {};
        try {
          await updateUserSettings(patch as UpdateUserSettingsInput, { keepalive });
        } catch (err) {
          console.error('[Save Settings] Failed to save settings via API:', err);
          // Keep it for the next attempt, under anything changed since.
          pendingRef.current = { ...patch, ...pendingRef.current };
          return;
        }
      }
    } finally {
      runningRef.current = false;
    }
  }, []);

  const saveSettings = useCallback((patch: Partial<Settings>) => {
    const apply = <K extends SettingKey>(key: K, value: Settings[K]) => updateSetting(key, value);
    (Object.keys(patch) as SettingKey[]).forEach((key) => apply(key, patch[key] as Settings[typeof key]));
    pendingRef.current = { ...pendingRef.current, ...patch };
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => { void flush(); }, SETTINGS_SAVE_DELAY_MS);
  }, [flush, updateSetting]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') void flush(true);
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      void flush(true);
    };
  }, [flush]);

  return saveSettings;
}
