import storage from './storage';
import type { components } from './api-types';

const STORAGE_PREFIX = 'linguaReadSentenceProgress:';
const CLOCK_OFFSET_KEY = `${STORAGE_PREFIX}clock-offset`;

export type SentenceReadSegment = components['schemas']['SentenceSegmentDto'];
export type SentenceSourceCoverage = components['schemas']['SentenceSourceCoverage'];

let sentenceClock: { serverTime: number; receivedAt: number } | undefined;

function rememberSentenceClock(serverTime?: string): void {
  const time = Date.parse(serverTime ?? '');
  if (!Number.isFinite(time) || (sentenceClock && time < sentenceClock.serverTime)) return;
  sentenceClock = { serverTime: time, receivedAt: performance.now() };
  storage.setItem(CLOCK_OFFSET_KEY, String(time - Date.now()));
}

export function estimatedSentenceServerTime(): number | undefined {
  if (sentenceClock) return sentenceClock.serverTime + performance.now() - sentenceClock.receivedAt;
  // Preserve calibration when the reader reloads offline on the same device.
  const stored = storage.getItem(CLOCK_OFFSET_KEY);
  const offset = stored == null ? NaN : Number(stored);
  return Number.isFinite(offset) ? Date.now() + offset : undefined;
}

export function sentenceSourceRange(segment: SentenceReadSegment) {
  const { sourceStart, sourceText } = segment;
  if (typeof sourceStart !== 'number' || !sourceText) return null;
  return { start: sourceStart, end: sourceStart + sourceText.length };
}

export function hasSentenceRange(coverage: SentenceSourceCoverage, segment: SentenceReadSegment): boolean {
  const span = sentenceSourceRange(segment);
  return span != null && coverage.ranges.some(range => span.start >= range.start && span.end <= range.end);
}

export function mergeSentenceCoverage(previous: SentenceSourceCoverage | null | undefined, incoming: SentenceSourceCoverage): SentenceSourceCoverage {
  if (previous?.sourceRevision !== incoming.sourceRevision) return incoming;
  const ordered = [...previous.ranges, ...incoming.ranges].sort((a, b) => a.start - b.start);
  const ranges: SentenceSourceCoverage['ranges'] = [];
  for (const range of ordered) {
    const last = ranges[ranges.length - 1];
    if (last && last.end >= range.start) last.end = Math.max(last.end, range.end);
    else ranges.push({ ...range });
  }
  return { ...incoming, ranges };
}

export function includeSentenceReadRanges(
  coverage: SentenceSourceCoverage | null,
  sourceRevision: string | null | undefined,
  segments: SentenceReadSegment[],
  legacyIndices: number[]
): SentenceSourceCoverage | null {
  if (!sourceRevision || (coverage && coverage.sourceRevision !== sourceRevision)) return coverage;
  const ranges = segments.flatMap(segment => {
    const range = sentenceSourceRange(segment);
    return range && segment.segmentText.trim() ? [range] : [];
  });
  if (!ranges.length) return coverage;
  return mergeSentenceCoverage(coverage, { sourceRevision, ranges, legacyIndices: coverage?.legacyIndices ?? legacyIndices });
}

type CachedSentenceProgress = {
  lastSegmentIndex: number | null;
  cursorUpdatedAt: string | null;
  creditedSegmentIndices: number[];
  sourceCoverage?: SentenceSourceCoverage;
};

type SentenceProgressSnapshot = {
  lastSegmentIndex?: number | null;
  cursorUpdatedAt?: string | null;
  creditedSegmentIndices?: number[] | null;
  sourceCoverage?: SentenceSourceCoverage | null;
  serverTime?: string;
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
  rememberSentenceClock(progress?.serverTime);
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
    creditedSegmentIndices: [...credited].sort((a, b) => a - b),
    sourceCoverage: progress?.sourceCoverage ? mergeSentenceCoverage(cached?.sourceCoverage, progress.sourceCoverage)
      : cached?.sourceCoverage
  };
  storage.setItem(`${STORAGE_PREFIX}${textId}`, JSON.stringify(snapshot));
  return snapshot;
}

export function forgetSentenceProgress(textId: number | string): void {
  storage.removeItem(`${STORAGE_PREFIX}${textId}`);
}

export function clearCachedSentenceProgress(): void {
  sentenceClock = undefined;
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
