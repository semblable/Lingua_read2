import { fetchApi } from './client';
import type { ResponseOf } from '../fetchApi';

export type HardcoverStatus = ResponseOf<'/api/Hardcover/status', 'get'>;
export type HardcoverMatchResult = ResponseOf<'/api/Hardcover/match/{bookId}', 'post'>;
export type HardcoverMetadataImportResult = ResponseOf<'/api/Hardcover/import-metadata/{bookId}', 'post'>;
export type HardcoverProgressSyncResult = ResponseOf<'/api/Hardcover/sync-progress/{bookId}', 'post'>;
export type HardcoverSyncAllResult = ResponseOf<'/api/Hardcover/sync-all', 'post'>;

export type HardcoverCandidate = NonNullable<HardcoverMatchResult['candidates']>[number];

export const getHardcoverStatus = (): Promise<HardcoverStatus> => {
  return fetchApi<HardcoverStatus>('/hardcover/status');
};

export const matchHardcoverBook = (
  bookId: number | string,
  hardcoverBookId: number | string | null = null
): Promise<HardcoverMatchResult> => {
  const body = hardcoverBookId ? JSON.stringify({ hardcoverBookId }) : undefined;
  return fetchApi<HardcoverMatchResult>(`/hardcover/match/${bookId}`, {
    method: 'POST',
    ...(body ? { body } : {})
  });
};

export const importHardcoverMetadata = (bookId: number | string): Promise<HardcoverMetadataImportResult> => {
  return fetchApi<HardcoverMetadataImportResult>(`/hardcover/import-metadata/${bookId}`, {
    method: 'POST'
  });
};

export const syncHardcoverProgress = (bookId: number | string): Promise<HardcoverProgressSyncResult> => {
  return fetchApi<HardcoverProgressSyncResult>(`/hardcover/sync-progress/${bookId}`, {
    method: 'POST'
  });
};

export const syncAllHardcover = (): Promise<HardcoverSyncAllResult> => {
  return fetchApi<HardcoverSyncAllResult>('/hardcover/sync-all', {
    method: 'POST'
  });
};
