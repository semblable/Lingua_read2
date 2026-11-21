import 'fake-indexeddb/auto';
import { beforeEach, expect, test, vi } from 'vitest';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn() }));

import { getSentenceProgress, logSentenceReadActivity } from '../utils/api/audiobook';
import { fetchApi } from '../utils/api/client';
import { productionSyncHandlers } from '../utils/offline/handlers';
import { clearAll, drain, enqueue, listPending } from '../utils/offline/syncQueue';
import { clearCachedSentenceProgress, rememberSentenceProgress } from '../utils/sentenceProgress';

const mockFetch = vi.mocked(fetchApi);

beforeEach(async () => {
  mockFetch.mockReset();
  clearCachedSentenceProgress();
  await clearAll();
});

test('restores the most recent pending cursor and retains credits across an offline reload', async () => {
  const textId = 12;
  mockFetch.mockResolvedValueOnce({
    textId, lastSegmentIndex: 4, cursorUpdatedAt: '2026-11-16T12:00:00Z', creditedSegmentIndices: [4]
  });
  await getSentenceProgress(textId);

  await enqueue({ type: 'sentenceRead', payload: {
    textId, currentSegmentIndex: 5, clientUpdatedAt: '2026-11-16T12:10:00Z',
    segments: [{ segmentIndex: 5, segmentText: 'Five.' }]
  } });
  await enqueue({ type: 'sentenceRead', payload: {
    textId, currentSegmentIndex: 1, clientUpdatedAt: '2026-11-16T12:11:00Z',
    segments: [{ segmentIndex: 1, segmentText: 'One.' }]
  } });

  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    lastSegmentIndex: 1,
    cursorUpdatedAt: '2026-11-16T12:11:00Z',
    creditedSegmentIndices: [1, 4, 5]
  });
});

test('a reread resets old cached and queued cursors while retaining sentence credit', async () => {
  const textId = 12;
  const cursorResetAt = '2026-11-21T12:00:00Z';
  rememberSentenceProgress(textId, {
    lastSegmentIndex: 4, cursorUpdatedAt: '2026-11-21T11:50:00Z', creditedSegmentIndices: [4]
  });
  await enqueue({ type: 'sentenceRead', payload: {
    textId, currentSegmentIndex: 5, clientUpdatedAt: '2026-11-21T11:55:00Z',
    segments: [{ segmentIndex: 5, segmentText: 'Five.' }]
  } });

  rememberSentenceProgress(textId, { cursorResetAt });
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    lastSegmentIndex: null, cursorResetAt, creditedSegmentIndices: [4, 5]
  });

  await enqueue({ type: 'sentenceRead', payload: {
    textId, currentSegmentIndex: 1, clientUpdatedAt: '2026-11-21T12:01:00Z',
    segments: [{ segmentIndex: 1, segmentText: 'One.' }]
  } });
  mockFetch.mockResolvedValueOnce({ textId, lastSegmentIndex: null, cursorResetAt, creditedSegmentIndices: [4] });
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    lastSegmentIndex: 1, cursorResetAt, creditedSegmentIndices: [1, 4, 5]
  });
});

test('a credit-only offline read survives both reload and successful replay without assigning a cursor', async () => {
  const textId = 13;
  await enqueue({ type: 'sentenceRead', payload: {
    textId, segments: [{ segmentIndex: 0, segmentText: 'First.' }]
  } });
  const offlineSnapshot = { lastSegmentIndex: null, cursorUnknown: true, creditedSegmentIndices: [0] };
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject(offlineSnapshot);

  mockFetch.mockResolvedValueOnce({ textId, lastSegmentIndex: null, creditedSegmentIndices: [0] });
  await expect(drain(productionSyncHandlers)).resolves.toMatchObject({ succeeded: 1 });
  expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).not.toHaveProperty('currentSegmentIndex');
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject(offlineSnapshot);

  mockFetch.mockResolvedValueOnce({ textId, lastSegmentIndex: null, creditedSegmentIndices: [] });
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({ lastSegmentIndex: null, creditedSegmentIndices: [] });
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).rejects.toThrow('offline');
});

test('calibrates new cursor writes and skips an older queue entry with a future timestamp', async () => {
  const textId = 14;
  const serverTime = '2026-11-16T13:00:00Z';
  const progress = { textId, lastSegmentIndex: 4, cursorUpdatedAt: '2026-11-16T12:00:00Z', creditedSegmentIndices: [4], serverTime };
  await enqueue({ type: 'sentenceRead', payload: {
    textId, currentSegmentIndex: 2, clientUpdatedAt: '2026-11-17T12:00:00Z',
    segments: [{ segmentIndex: 2, segmentText: 'Two.' }]
  } });
  mockFetch.mockResolvedValueOnce(progress);
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({ lastSegmentIndex: 4, creditedSegmentIndices: [2, 4] });

  mockFetch.mockResolvedValueOnce(progress);
  await logSentenceReadActivity({ textId, currentSegmentIndex: 5, segments: [{ segmentIndex: 5, segmentText: 'Five.' }] });
  const timestamp = Date.parse(JSON.parse(String(mockFetch.mock.calls[1][1]?.body)).clientUpdatedAt);
  expect(timestamp).toBeGreaterThanOrEqual(Date.parse(serverTime));
  expect(timestamp).toBeLessThan(Date.parse(serverTime) + 1000);
});

test('preserves source spans through the offline queue and across a reopen', async () => {
  const textId = 16;
  const sourceRevision = 'source revision';
  const first = { segmentIndex: 0, segmentText: 'First.', sourceStart: 0, sourceText: 'First. ' };
  const second = { segmentIndex: 1, segmentText: 'Next.', sourceStart: 7, sourceText: 'Next.' };
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await logSentenceReadActivity({ textId, sourceRevision, segments: [second], legacySegments: [first] });
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    sourceCoverage: { sourceRevision, ranges: [{ start: 7, end: 12 }] }
  });
  mockFetch.mockResolvedValueOnce({ textId, creditedSegmentIndices: [0, 1] });
  await expect(drain(productionSyncHandlers)).resolves.toMatchObject({ succeeded: 1 });
  expect(JSON.parse(String(mockFetch.mock.calls[2][1]?.body))).toMatchObject({ sourceRevision, legacySegments: [first], segments: [second] });
});

test('keeps an offline read of an earlier text revision queued without restoring its position', async () => {
  const textId = 17;
  await enqueue({ type: 'sentenceRead', payload: {
    textId, sourceRevision: 'previous', currentSegmentIndex: 2, clientUpdatedAt: '2026-11-16T12:10:00Z',
    segments: [{ segmentIndex: 2, segmentText: 'Previous sentence.' }]
  } });
  mockFetch.mockResolvedValueOnce({ textId, lastSegmentIndex: 4, cursorUpdatedAt: '2026-11-16T12:00:00Z', creditedSegmentIndices: [4] });

  await expect(getSentenceProgress(textId, 'current')).resolves.toMatchObject({ lastSegmentIndex: 4, creditedSegmentIndices: [4] });
  await expect(listPending()).resolves.toHaveLength(1);
});

test('retains queued source spans for an edited revision when cached coverage is from an earlier revision', async () => {
  const textId = 18;
  mockFetch.mockResolvedValueOnce({
    textId,
    lastSegmentIndex: 0,
    cursorUpdatedAt: '2026-11-16T12:00:00Z',
    creditedSegmentIndices: [0],
    sourceCoverage: { sourceRevision: 'previous', ranges: [{ start: 0, end: 6 }], legacyIndices: [] }
  });
  await getSentenceProgress(textId, 'previous');

  await enqueue({ type: 'sentenceRead', payload: {
    textId,
    sourceRevision: 'current',
    currentSegmentIndex: 1,
    clientUpdatedAt: '2026-11-16T12:10:00Z',
    segments: [{ segmentIndex: 1, segmentText: 'Edited.', sourceStart: 10, sourceText: 'Edited.' }]
  } });

  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId, 'current')).resolves.toMatchObject({
    creditedSegmentIndices: [1],
    sourceCoverage: {
      sourceRevision: 'current',
      ranges: [{ start: 10, end: 17 }],
      legacyIndices: []
    }
  });
});

test('offline reload of an edited revision with no queued reads does not leak earlier revision credits', async () => {
  const textId = 19;
  mockFetch.mockResolvedValueOnce({
    textId,
    lastSegmentIndex: 2,
    cursorUpdatedAt: '2026-11-16T12:00:00Z',
    creditedSegmentIndices: [0, 1, 2],
    sourceCoverage: { sourceRevision: 'previous', ranges: [{ start: 0, end: 20 }], legacyIndices: [] }
  });
  await getSentenceProgress(textId, 'previous');

  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId, 'current')).resolves.toMatchObject({
    lastSegmentIndex: 2,
    creditedSegmentIndices: [],
    sourceCoverage: {
      sourceRevision: 'current',
      ranges: [],
      legacyIndices: []
    }
  });
});

test('legacy replay uses its original queue time and keeps the newer confirmed cursor offline', async () => {
  const textId = 23;
  await enqueue({ type: 'sentenceRead', payload: {
    textId, currentSegmentIndex: 2, segments: [{ segmentIndex: 2, segmentText: 'Two.' }]
  } });
  const [legacy] = await listPending();
  const newerAt = new Date(legacy.enqueuedAt + 1000).toISOString();
  const newerProgress = { textId, lastSegmentIndex: 7, cursorUpdatedAt: newerAt, creditedSegmentIndices: [7] };

  mockFetch.mockResolvedValueOnce(newerProgress);
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    lastSegmentIndex: 7, creditedSegmentIndices: [2, 7]
  });

  mockFetch.mockResolvedValueOnce({ ...newerProgress, creditedSegmentIndices: [2, 7] });
  await expect(drain(productionSyncHandlers)).resolves.toMatchObject({ succeeded: 1 });
  expect(JSON.parse(String(mockFetch.mock.calls[1][1]?.body))).toMatchObject({
    clientUpdatedAt: new Date(legacy.enqueuedAt).toISOString(),
    currentSegmentIndex: 2
  });
  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    lastSegmentIndex: 7, creditedSegmentIndices: [2, 7]
  });
});

test('out-of-order confirmations with the same cursor retain all credited indices', async () => {
  const textId = 32;
  const cursorUpdatedAt = '2026-11-16T12:00:00Z';
  const snapshot = { textId, lastSegmentIndex: 7, cursorUpdatedAt };
  const send = (segmentIndex: number) => productionSyncHandlers.sentenceRead({
    type: 'sentenceRead', payload: { textId, currentSegmentIndex: segmentIndex,
      segments: [{ segmentIndex, segmentText: 'Sentence.' }] }
  });
  let releaseEarlier!: (result: typeof snapshot & { creditedSegmentIndices: number[] }) => void;
  mockFetch.mockImplementationOnce(() => new Promise(resolve => { releaseEarlier = resolve; }));
  const earlier = send(7);
  mockFetch.mockResolvedValueOnce({ ...snapshot, creditedSegmentIndices: [2, 7] });
  await send(2);
  releaseEarlier({ ...snapshot, creditedSegmentIndices: [7] });
  await earlier;

  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({
    lastSegmentIndex: 7, creditedSegmentIndices: [2, 7]
  });
});

test.each([403, 404])('a %i response prevents fallback to a cached cursor', async status => {
  const textId = 43;
  mockFetch.mockResolvedValueOnce({
    textId, lastSegmentIndex: 3, cursorUpdatedAt: '2026-11-16T12:00:00Z', creditedSegmentIndices: [3]
  });
  await getSentenceProgress(textId);
  const payload = { textId, currentSegmentIndex: 4, segments: [{ segmentIndex: 4, segmentText: 'Four.' }] };
  await enqueue({ type: 'sentenceRead', payload });
  await enqueue({ type: 'sentenceRead', payload: { ...payload, textId: textId + 1 } });

  const error = Object.assign(new Error('Lesson unavailable'), { status });
  mockFetch.mockRejectedValueOnce(error);
  await expect(getSentenceProgress(textId)).rejects.toBe(error);
  await expect(listPending()).resolves.toMatchObject([{ payload: { textId: textId + 1 } }]);

  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).rejects.toThrow('offline');
});

test('a fresh empty server snapshot replaces prior offline progress after a restore', async () => {
  const textId = 57;
  mockFetch.mockResolvedValueOnce({
    textId, lastSegmentIndex: 6, cursorUpdatedAt: '2026-11-16T12:00:00Z', creditedSegmentIndices: [6]
  });
  await getSentenceProgress(textId);

  mockFetch.mockResolvedValueOnce({ textId, lastSegmentIndex: null, creditedSegmentIndices: [] });
  await expect(getSentenceProgress(textId)).resolves.toMatchObject({ lastSegmentIndex: null, creditedSegmentIndices: [] });

  mockFetch.mockRejectedValueOnce(new TypeError('offline'));
  await expect(getSentenceProgress(textId)).rejects.toThrow('offline');
});
