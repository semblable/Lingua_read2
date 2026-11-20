import storage from './storage';

const STORAGE_PREFIX = 'linguaReadSentenceProgress:';

type CachedSentenceProgress = {
  lastSegmentIndex: number | null;
  cursorUpdatedAt: string | null;
  creditedSegmentIndices: number[];
};

type SentenceProgressSnapshot = {
  lastSegmentIndex?: number | null;
  cursorUpdatedAt?: string | null;
  creditedSegmentIndices?: number[] | null;
};

function hasCursor(progress?: SentenceProgressSnapshot | null): progress is { lastSegmentIndex: number; cursorUpdatedAt: string } {
  return typeof progress?.lastSegmentIndex === 'number' && Number.isInteger(progress.lastSegmentIndex)
    && progress.lastSegmentIndex >= 0 && typeof progress.cursorUpdatedAt === 'string'
    && Number.isFinite(Date.parse(progress.cursorUpdatedAt));
}

export function readCachedSentenceProgress(textId: number | string): CachedSentenceProgress | null {
  try {
    const stored = storage.getItem(`${STORAGE_PREFIX}${textId}`);
    const progress = stored ? JSON.parse(stored) as CachedSentenceProgress : null;
    if (!progress || !Array.isArray(progress.creditedSegmentIndices)) return null;
    if (hasCursor(progress) || (progress.lastSegmentIndex === null && progress.cursorUpdatedAt === null)) return progress;
  } catch { /* a bad snapshot must not prevent the reader from opening */ }
  return null;
}

export function rememberSentenceProgress(
  textId: number | string,
  progress: SentenceProgressSnapshot | null | undefined,
  replace = false
): CachedSentenceProgress | null {
  const cached = replace ? null : readCachedSentenceProgress(textId);
  const incoming = hasCursor(progress) ? progress : null;
  const latest = hasCursor(cached) && (!incoming || Date.parse(cached.cursorUpdatedAt) > Date.parse(incoming.cursorUpdatedAt))
    ? cached : incoming;
  const credited = new Set([...(cached?.creditedSegmentIndices ?? []), ...(progress?.creditedSegmentIndices ?? [])]);
  if (!latest && !credited.size) {
    if (replace) forgetSentenceProgress(textId);
    return null;
  }
  const snapshot = {
    lastSegmentIndex: latest?.lastSegmentIndex ?? null,
    cursorUpdatedAt: latest?.cursorUpdatedAt ?? null,
    creditedSegmentIndices: [...credited].sort((a, b) => a - b)
  };
  storage.setItem(`${STORAGE_PREFIX}${textId}`, JSON.stringify(snapshot));
  return snapshot;
}

export function forgetSentenceProgress(textId: number | string): void {
  storage.removeItem(`${STORAGE_PREFIX}${textId}`);
}

export function clearCachedSentenceProgress(): void {
  try {
    for (let index = localStorage.length - 1; index >= 0; index--) {
      const key = localStorage.key(index);
      if (key?.startsWith(STORAGE_PREFIX)) storage.removeItem(key);
    }
  } catch { /* storage may be unavailable */ }
}

export function queuedSentenceCursorTime(clientUpdatedAt?: string, enqueuedAt?: number): string | undefined {
  // Older queues recorded arrival time in IndexedDB but had no payload timestamp.
  return clientUpdatedAt ?? (enqueuedAt == null ? undefined : new Date(enqueuedAt).toISOString());
}
