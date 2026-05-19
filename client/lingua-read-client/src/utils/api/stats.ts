import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

export type UserStatistics = ResponseOf<'/api/Users/statistics', 'get'>;
export type Dashboard = ResponseOf<'/api/Users/dashboard', 'get'>;
export type ReadingActivityResponse = ResponseOf<'/api/Users/reading-activity', 'get'>;
export type ListeningActivityResponse = ResponseOf<'/api/Users/listening-activity', 'get'>;
export type KnownWordsActivityResponse = ResponseOf<'/api/Users/known-words-activity', 'get'>;

export const getUserStatistics = (): Promise<UserStatistics> => {
  return fetchApi<UserStatistics>('/users/statistics');
};

export const getDashboard = async (
  timezoneOffsetMinutes: number | null = null
): Promise<Dashboard> => {
  const params = new URLSearchParams();
  if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
    params.append('timezoneOffsetMinutes', String(timezoneOffsetMinutes));
  }
  const qs = params.toString();
  return fetchApi<Dashboard>(`/users/dashboard${qs ? `?${qs}` : ''}`);
};

// Returns the activity data on success, or `{ error: string }` on failure
// (callers degrade gracefully rather than throwing in the UI).
export type ReadingActivityResult = ReadingActivityResponse | { error: string };

export const getReadingActivity = async (
  period: string = 'all',
  timezoneOffsetMinutes: number | null = null,
  languageId: number | string | null = null,
  offset: number = 0
): Promise<ReadingActivityResult> => {
  try {
    const params = new URLSearchParams({ period });
    if (timezoneOffsetMinutes !== null) {
      params.append('timezoneOffsetMinutes', String(timezoneOffsetMinutes));
    }
    if (languageId !== null) {
      params.append('languageId', String(languageId));
    }
    if (offset && offset > 0) {
      params.append('offset', String(offset));
    }
    const data = await fetchApi<ReadingActivityResponse>(
      `/users/reading-activity?${params.toString()}`
    );
    return data;
  } catch (error) {
    console.error('Error getting reading activity:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export type ListeningActivityResult = ListeningActivityResponse | { error: string };

export const getListeningActivity = async (
  period: string = 'all',
  timezoneOffsetMinutes: number | null = null,
  languageId: number | string | null = null,
  offset: number = 0
): Promise<ListeningActivityResult> => {
  try {
    const params = new URLSearchParams({ period });
    if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
      params.append('timezoneOffsetMinutes', String(timezoneOffsetMinutes));
    }
    if (languageId !== null && languageId !== undefined) {
      params.append('languageId', String(languageId));
    }
    if (offset && offset > 0) {
      params.append('offset', String(offset));
    }
    const data = await fetchApi<ListeningActivityResponse>(
      `/users/listening-activity?${params.toString()}`
    );
    return data;
  } catch (error) {
    console.error('Error getting listening activity:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export type KnownWordsActivityResult = KnownWordsActivityResponse | { error: string };

export const getKnownWordsActivity = async (
  period: string = 'all',
  timezoneOffsetMinutes: number | null = null,
  languageId: number | string | null = null,
  offset: number = 0
): Promise<KnownWordsActivityResult> => {
  try {
    const params = new URLSearchParams({ period });
    if (timezoneOffsetMinutes !== null && timezoneOffsetMinutes !== undefined) {
      params.append('timezoneOffsetMinutes', String(timezoneOffsetMinutes));
    }
    if (languageId !== null && languageId !== undefined) {
      params.append('languageId', String(languageId));
    }
    if (offset && offset > 0) {
      params.append('offset', String(offset));
    }
    const data = await fetchApi<KnownWordsActivityResponse>(
      `/users/known-words-activity?${params.toString()}`
    );
    return data;
  } catch (error) {
    console.error('Error getting known-words activity:', error);
    return { error: error instanceof Error ? error.message : String(error) };
  }
};

export const resetUserStatistics = (): Promise<unknown> => {
  return fetchApi('/users/reset-statistics', {
    method: 'POST'
  });
};
