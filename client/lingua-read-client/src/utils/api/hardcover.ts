import { fetchApi } from './client';
import type { RequestBodyOf, ResponseOf } from '../fetchApi';

export type HardcoverStatus = ResponseOf<'/api/Hardcover/status', 'get'>;
export type HardcoverMatchRequest = RequestBodyOf<'/api/Hardcover/match/{bookId}', 'post'>;
export type HardcoverMatchResult = ResponseOf<'/api/Hardcover/match/{bookId}', 'post'>;
export type HardcoverMetadataImportResult = ResponseOf<'/api/Hardcover/import-metadata/{bookId}', 'post'>;
export type HardcoverProgressSyncResult = ResponseOf<'/api/Hardcover/sync-progress/{bookId}', 'post'>;
export type HardcoverSyncAllResult = ResponseOf<'/api/Hardcover/sync-all', 'post'>;

export type HardcoverCandidate = NonNullable<HardcoverMatchResult['candidates']>[number];
export type HardcoverEditionOption = NonNullable<HardcoverCandidate['editions']>[number];

export type HardcoverMatchOptions = {
  hardcoverBookId?: number | string | null;
  hardcoverEditionId?: number | string | null;
  query?: string | null;
};

export const parsePositiveIntId = (
  value: number | string | null | undefined,
  fieldName: string
): number | undefined => {
  if (value == null) return undefined;

  let parsed: number;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return undefined;
    if (!/^\d+$/.test(trimmed)) {
      throw new RangeError(`${fieldName} must be a positive integer.`);
    }
    parsed = Number(trimmed);
  } else if (typeof value === 'number') {
    parsed = value;
  } else {
    throw new RangeError(`${fieldName} must be a positive integer.`);
  }

  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new RangeError(`${fieldName} must be a positive integer.`);
  }

  return parsed;
};

export const getHardcoverStatus = (): Promise<HardcoverStatus> => {
  return fetchApi<HardcoverStatus>('/hardcover/status');
};

export const matchHardcoverBook = async (
  bookId: number | string,
  optionsOrBookId: number | string | HardcoverMatchOptions | null = null
): Promise<HardcoverMatchResult> => {
  const payload: HardcoverMatchRequest = {};
  if (optionsOrBookId && typeof optionsOrBookId === 'object') {
    const hardcoverBookId = parsePositiveIntId(optionsOrBookId.hardcoverBookId, 'hardcoverBookId');
    if (hardcoverBookId !== undefined) {
      payload.hardcoverBookId = hardcoverBookId;
    }
    const hardcoverEditionId = parsePositiveIntId(optionsOrBookId.hardcoverEditionId, 'hardcoverEditionId');
    if (hardcoverEditionId !== undefined) {
      payload.hardcoverEditionId = hardcoverEditionId;
    }
    if (optionsOrBookId.query != null && optionsOrBookId.query.trim() !== '') {
      payload.query = optionsOrBookId.query.trim();
    }
  } else {
    const hardcoverBookId = parsePositiveIntId(optionsOrBookId, 'hardcoverBookId');
    if (hardcoverBookId !== undefined) {
      payload.hardcoverBookId = hardcoverBookId;
    }
  }

  const body = Object.keys(payload).length > 0 ? JSON.stringify(payload) : undefined;
  return fetchApi<HardcoverMatchResult>(`/hardcover/match/${bookId}`, {
    method: 'POST',
    ...(body ? { body } : {})
  });
};

export const unlinkHardcoverBook = (bookId: number | string): Promise<void> => {
  return fetchApi<void>(`/hardcover/link/${bookId}`, {
    method: 'DELETE'
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
