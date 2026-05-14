import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

export type HardcoverStatus = ResponseOf<'/api/Hardcover/status', 'get'>;

// Swagger marks Hardcover responses as opaque (no body schema). Define
// permissive shapes here based on the BookDetail / UserSettings call sites.
export type HardcoverCandidate = {
  bookId?: number | string;
  title?: string;
  author?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
};

export type HardcoverResult = {
  applied?: boolean;
  success?: boolean;
  message?: string;
  candidates?: HardcoverCandidate[];
};

export const getHardcoverStatus = (): Promise<HardcoverStatus> => {
  return fetchApi<HardcoverStatus>('/hardcover/status');
};

export const matchHardcoverBook = (
  bookId: number | string,
  hardcoverBookId: number | string | null = null
): Promise<HardcoverResult> => {
  const body = hardcoverBookId ? JSON.stringify({ hardcoverBookId }) : undefined;
  return fetchApi<HardcoverResult>(`/hardcover/match/${bookId}`, {
    method: 'POST',
    ...(body ? { body } : {})
  });
};

export const importHardcoverMetadata = (bookId: number | string): Promise<HardcoverResult> => {
  return fetchApi<HardcoverResult>(`/hardcover/import-metadata/${bookId}`, {
    method: 'POST'
  });
};

export const syncHardcoverProgress = (bookId: number | string): Promise<HardcoverResult> => {
  return fetchApi<HardcoverResult>(`/hardcover/sync-progress/${bookId}`, {
    method: 'POST'
  });
};

export const syncAllHardcover = (): Promise<HardcoverResult> => {
  return fetchApi<HardcoverResult>('/hardcover/sync-all', {
    method: 'POST'
  });
};
