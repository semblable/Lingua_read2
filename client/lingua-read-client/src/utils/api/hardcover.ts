import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

export type HardcoverStatus = ResponseOf<'/api/Hardcover/status', 'get'>;

export const getHardcoverStatus = (): Promise<HardcoverStatus> => {
  return fetchApi<HardcoverStatus>('/hardcover/status');
};

export const matchHardcoverBook = (
  bookId: number | string,
  hardcoverBookId: number | string | null = null
): Promise<unknown> => {
  const body = hardcoverBookId ? JSON.stringify({ hardcoverBookId }) : undefined;
  return fetchApi(`/hardcover/match/${bookId}`, {
    method: 'POST',
    ...(body ? { body } : {})
  });
};

export const importHardcoverMetadata = (bookId: number | string): Promise<unknown> => {
  return fetchApi(`/hardcover/import-metadata/${bookId}`, {
    method: 'POST'
  });
};

export const syncHardcoverProgress = (bookId: number | string): Promise<unknown> => {
  return fetchApi(`/hardcover/sync-progress/${bookId}`, {
    method: 'POST'
  });
};

export const syncAllHardcover = (): Promise<unknown> => {
  return fetchApi('/hardcover/sync-all', {
    method: 'POST'
  });
};
