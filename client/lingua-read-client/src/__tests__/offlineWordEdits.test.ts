import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
import { createWord, updateWord } from '../utils/api/words';
import { fetchApi } from '../utils/api/client';
import { clearAll, drain, listPending, type SyncHandlers } from '../utils/offline/syncQueue';
import { productionSyncHandlers } from '../utils/offline/handlers';
import { subscribeWordReplay } from '../utils/offline/events';
import { clearOfflineState } from '../utils/offline/cleanup';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn(), fetchApiDownload: vi.fn() }));
const online = (value: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value });
beforeEach(async () => { online(false); await clearAll(); vi.clearAllMocks(); });
afterEach(() => online(true));

test('queued creates return usable reader fields and preserve sentence context across edits', async () => {
  const queued = await createWord(1, 'cat', 1, 'kot', 'A cat sleeps.');
  expect(queued)
    .toMatchObject({ term: 'cat', status: 1, translation: 'kot', wordId: 0 });
  expect(queued).toMatchObject({ queuedOp: { id: (await listPending())[0].id } });
  await createWord(1, 'cat', 2, 'kotek');
  const [op] = await listPending();
  expect(await listPending()).toHaveLength(1);
  expect(op.payload).toMatchObject({ sentence: 'A cat sleeps.', status: 2, translation: 'kotek' });
  online(true);
  await drain(productionSyncHandlers);
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body)))
    .toMatchObject({ textId: 1, term: 'cat', sentence: 'A cat sleeps.', status: 2, translation: 'kotek' });
});

test('offline status coalescing retains translation edits and explicit clearing', async () => {
  await updateWord(5, 1, 'kot');
  await updateWord(5, 2, undefined);
  expect((await listPending())[0].payload).toEqual({ wordId: 5, status: 2, translation: 'kot' });
  await updateWord(5, 3, '');
  online(true);
  await drain(productionSyncHandlers);
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body)))
    .toEqual({ status: 3, translation: '' });
});

test('a provisional word save explicitly applies demotion and clearing after replay', async () => {
  await createWord(1, 'cat', 4, 'kot');
  online(true);
  await drain(productionSyncHandlers);
  vi.mocked(fetchApi).mockResolvedValueOnce({ wordId: 41, term: 'cat', status: 2, translation: '' });
  const saved = await createWord(1, 'cat', 2, '');
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls.at(-1)?.[1]?.body)))
    .toMatchObject({ replaceExisting: true, status: 2, translation: '' });
  expect(saved).toMatchObject({ wordId: 41, status: 2, translation: '' });
});

test('a newer online edit waits behind a queued edit of the same word', async () => {
  await createWord(1, 'cat', 4, 'kot');
  online(true);
  await createWord(1, 'cat', 2, '');
  expect(fetchApi).not.toHaveBeenCalled();
  expect(await listPending()).toHaveLength(1);
  await drain(productionSyncHandlers);
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls.at(-1)?.[1]?.body)))
    .toMatchObject({ status: 2, translation: '', replaceExisting: true });
});

test('status-only natural-key replay omits translation rather than clearing the server value', async () => {
  await createWord(1, 'cat', 2, undefined);
  online(true);
  await drain(productionSyncHandlers);
  const payload = JSON.parse(String(vi.mocked(fetchApi).mock.calls.at(-1)?.[1]?.body));
  expect(payload).toMatchObject({ textId: 1, term: 'cat', status: 2, replaceExisting: true });
  expect(payload).not.toHaveProperty('translation');
});

test('a retryable failure keeps later writes behind it', async () => {
  await updateWord(5, 1, undefined);
  await updateWord(6, 2, undefined);
  online(true);
  const handler = vi.fn().mockRejectedValueOnce({ status: 429 }).mockResolvedValue(undefined);
  const handlers = { ...productionSyncHandlers, wordStatusUpdate: handler } as SyncHandlers;
  expect(await drain(handlers)).toEqual({ attempted: 1, succeeded: 0, failed: 1 });
  expect(handler).toHaveBeenCalledTimes(1);
  expect(await listPending()).toHaveLength(2);
  await drain(handlers);
  expect(handler.mock.calls.map(([op]) => op.payload.wordId)).toEqual([5, 5, 6]);
});

test('word replay confirms the actual coalesced payload and returned server identity', async () => {
  await createWord(1, 'cat', 3, 'kot');
  await createWord(1, 'cat', 4, undefined);
  const replayed = vi.fn();
  const stop = subscribeWordReplay(replayed);
  try {
    online(true);
    vi.mocked(fetchApi).mockResolvedValueOnce({ wordId: 41, term: 'cat', status: 4, translation: 'kot' });
    await drain(productionSyncHandlers);
    expect(replayed).toHaveBeenCalledOnce();
    expect(replayed).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'confirmed',
      op: expect.objectContaining({ type: 'wordCreate', payload: expect.objectContaining({ status: 4, translation: 'kot' }) }),
      result: expect.objectContaining({ wordId: 41 }),
    }));
    expect(await listPending()).toHaveLength(0);
  } finally { stop(); }
});

test('terminal and retryable word replay failures are reported per word, without claiming confirmation', async () => {
  await updateWord(5, 4, undefined);
  const replayed = vi.fn();
  const stop = subscribeWordReplay(replayed);
  try {
    online(true);
    vi.mocked(fetchApi).mockRejectedValueOnce({ status: 503 });
    await drain(productionSyncHandlers);
    expect(replayed).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'retryable',
      op: expect.objectContaining({ type: 'wordStatusUpdate', payload: { wordId: 5, status: 4 } }),
    }));
    expect(await listPending()).toHaveLength(1);
    vi.mocked(fetchApi).mockRejectedValueOnce({ status: 422 });
    await drain(productionSyncHandlers);
    expect(replayed).toHaveBeenLastCalledWith(expect.objectContaining({ outcome: 'rejected' }));
    expect(await listPending()).toHaveLength(0);
  } finally { stop(); }
});

test('a network failure arriving after explicit logout cannot repopulate the cleared offline queue', async () => {
  online(true);
  let failRequest!: (error: unknown) => void;
  vi.mocked(fetchApi).mockImplementationOnce(() => new Promise((_, reject) => { failRequest = reject; }));
  const request = updateWord(5, 4, undefined);
  // Wait until the online request has passed its queue check.
  await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledOnce());
  await clearOfflineState();
  failRequest(new TypeError('network disconnected after logout'));
  await expect(request).rejects.toThrow('session ended');
  expect(await listPending()).toHaveLength(0);
});

test('an old-session drain cannot send its later snapshot operations after logout', async () => {
  await updateWord(5, 3, undefined);
  await updateWord(6, 4, undefined);
  let finishRequest!: (result: unknown) => void;
  vi.mocked(fetchApi).mockImplementationOnce(() => new Promise(resolve => { finishRequest = resolve; }));
  online(true);
  const replay = drain(productionSyncHandlers);
  await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledOnce());
  await clearOfflineState();
  online(false);
  await updateWord(7, 2, undefined);
  finishRequest({});
  await replay;
  expect(fetchApi).toHaveBeenCalledTimes(1);
  expect((await listPending()).map(op => op.type === 'wordStatusUpdate' ? op.payload.wordId : null)).toEqual([7]);
  online(true);
  await drain(productionSyncHandlers);
  expect(fetchApi).toHaveBeenLastCalledWith('/words/7', expect.anything());
});
