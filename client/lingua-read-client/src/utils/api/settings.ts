import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';

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

export const updateUserSettings = async (
  settings: UpdateUserSettingsInput
): Promise<UserSettings> => {
  try {
    return await fetchApi<UserSettings>('/usersettings', {
      method: 'PUT',
      body: JSON.stringify(settings)
    });
  } catch (error) {
    console.error('Failed to update user settings:', error);
    throw error;
  }
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

export const testOpenRouterConnection = async (): Promise<unknown> => {
  console.log('[API] Testing OpenRouter connection');
  return await fetchApi('/usersettings/test-openrouter', {
    method: 'POST'
  });
};

export const getAudioStorageSize = async (): Promise<AudioStorageSize> => {
  try {
    console.log('[API] Getting audio storage size');
    return await fetchApi<AudioStorageSize>('/usersettings/audio-storage-size');
  } catch (error) {
    console.error('Failed to get audio storage size:', error);
    throw error;
  }
};
