import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';
import { tzOffsetMinutes } from '../timezone';

export type UserSettings = ResponseOf<'/api/UserSettings', 'get'>;
export type UpdateUserSettingsInput = RequestBodyOf<'/api/UserSettings', 'put'>;
export type AudioStorageSize = ResponseOf<'/api/UserSettings/audio-storage-size', 'get'>;

export const getUserSettings = async (): Promise<UserSettings> => {
  try {
    return await fetchApi<UserSettings>('/usersettings');
  } catch (error) {
    console.error('Failed to get user settings:', error);
    throw error;
  }
};

// All writers share one queue, including explicit secret saves and debounced
// form/reader patches. A late response must not overwrite a newer settings save.
let settingsUpdateTail: Promise<unknown> = Promise.resolve();

export const updateUserSettings = (
  settings: UpdateUserSettingsInput,
  // keepalive lets the request finish while the page unloads.
  options: { keepalive?: boolean } = {}
): Promise<UserSettings> => {
  const request = settingsUpdateTail.catch(() => undefined).then(async () => {
    try {
      // A change to the SRS retention, maximum interval or weights reschedules the
      // user's cards, which fall due at the start of a local day.
      const body = JSON.stringify(settings);
      // Fetch keepalive bodies have a 64 KiB limit. Large custom prompts must
      // still save normally while the page is open; measure UTF-8 bytes.
      const keepaliveOptions = options.keepalive
        ? { keepalive: new TextEncoder().encode(body).byteLength <= 64 * 1024 }
        : {};
      return await fetchApi<UserSettings>(`/usersettings?timezoneOffsetMinutes=${tzOffsetMinutes()}`, {
        method: 'PUT',
        body,
        ...options,
        ...keepaliveOptions
      });
    } catch (error) {
      console.error('Failed to update user settings:', error);
      throw error;
    }
  });
  settingsUpdateTail = request;
  return request;
};

export const sendDiscordReport = async (
  period: string = 'week',
  days: number | null = null
): Promise<unknown> => {
  const params = new URLSearchParams({ period });
  if (period === 'days' && days) {
    params.append('days', String(days));
  }
  return fetchApi(`/usersettings/discord/report?${params.toString()}`, {
    method: 'POST'
  });
};

export const getAudioStorageSize = async (): Promise<AudioStorageSize> => {
  try {
    return await fetchApi<AudioStorageSize>('/usersettings/audio-storage-size');
  } catch (error) {
    console.error('Failed to get audio storage size:', error);
    throw error;
  }
};
