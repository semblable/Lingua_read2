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

test.each(['create', 'update'])('%s keeps the time of a deliberate grade across later gloss-only saves', async kind => {
  const save = (status: number, translation: string | undefined, minute: number, translationOnly = false) => {
    const options = { clientUpdatedAt: `2026-11-18T08:0${minute}:00.000Z`, translationOnly };
    return kind === 'create' ? createWord(7, 'cat', status, translation, null, options) : updateWord(5, status, translation, options);
  };
  await save(1, 'older gloss', 1, true);
  await save(3, undefined, 2);
  await save(1, 'new gloss', 4, true);
  await save(2, undefined, 0);
  expect(await listPending()).toHaveLength(1);
  online(true);
  await drain(productionSyncHandlers);
  const body = JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body));
  expect(body).toMatchObject({ status: 3, translation: 'new gloss', statusUpdatedAt: '2026-11-18T08:02:00.000Z',
    clientUpdatedAt: '2026-11-18T08:04:00.000Z' });
  expect(body).not.toHaveProperty('translationOnly');
});

test('coalescing two definition-only updates never turns them into a status choice', async () => {
  await updateWord(5, 1, 'cat', { translationOnly: true });
  await updateWord(5, 1, '', { translationOnly: true });
  online(true);
  await drain(productionSyncHandlers);
  const body = JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body));
  expect(body).toMatchObject({ translation: '', translationOnly: true });
  expect(body).not.toHaveProperty('statusUpdatedAt');
});

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
  const translatedAt = '2026-11-18T08:00:00.000Z';
  const gradedAt = '2026-11-18T08:01:00.000Z';
  const clearedAt = '2026-11-18T08:02:00.000Z';
  await updateWord(5, 1, 'kot', { clientUpdatedAt: translatedAt });
  await updateWord(5, 2, undefined, { clientUpdatedAt: gradedAt });
  expect((await listPending())[0].payload).toEqual({
    wordId: 5, status: 2, translation: 'kot', clientUpdatedAt: gradedAt, translationUpdatedAt: translatedAt,
  });
  await updateWord(5, 3, '', { clientUpdatedAt: clearedAt });
  online(true);
  await drain(productionSyncHandlers);
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body)))
    .toEqual({ status: 3, translation: '', clientUpdatedAt: clearedAt });
});

test('existing-word offline edits retain the first example and its source together through replay', async () => {
  await updateWord(5, 1, 'kot', { textId: 7, sentence: 'A cat sleeps.', clientUpdatedAt: '2026-11-18T08:18:00.000Z' });
  await updateWord(5, 2, undefined, { textId: 8, sentence: 'Another cat wakes.', clientUpdatedAt: '2026-11-18T08:19:00.000Z' });
  const clientUpdatedAt = '2026-11-18T08:20:00.000Z';
  await updateWord(5, 3, 'kotek', { clientUpdatedAt });
  expect(await listPending()).toHaveLength(1);
  expect((await listPending())[0].payload).toEqual({
    wordId: 5, status: 3, translation: 'kotek', textId: 7, sentence: 'A cat sleeps.', clientUpdatedAt,
  });
  online(true);
  await drain(productionSyncHandlers);
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body)))
    .toEqual({ status: 3, translation: 'kotek', textId: 7, sentence: 'A cat sleeps.', clientUpdatedAt });
});

test.each(['create', 'update'])('delayed %s keeps the newest status, last explicit translation and earliest eligible example', async kind => {
  const save = (minute: number, status: number, translation: string | undefined, sentence: string) => {
    const clientUpdatedAt = `2026-11-18T08:0${minute}:00.000Z`;
    return kind === 'create' ? createWord(7, 'cat', status, translation, sentence, { clientUpdatedAt })
      : updateWord(5, status, translation, { textId: minute + 7, sentence, clientUpdatedAt });
  };
  let failEarlier!: (error: Error) => void;
  online(true);
  vi.mocked(fetchApi).mockImplementationOnce(() => new Promise((_, reject) => { failEarlier = reject; }));
  const delayed = save(1, 2, 'outdated', 'The first cat.');
  await vi.waitFor(() => expect(fetchApi).toHaveBeenCalledOnce());
  online(false);
  await save(2, 3, '', 'Another cat.');
  await save(3, 4, undefined, 'The last cat.');
  failEarlier(new TypeError('Disconnected'));
  await delayed;
  await save(0, 5, 'oldest', 'A Known word cannot capture this cat example.');

  const queued = await listPending();
  expect(queued).toHaveLength(1);
  const expected = { textId: kind === 'create' ? 7 : 8, sentence: 'The first cat.', status: 4, translation: '',
    clientUpdatedAt: '2026-11-18T08:03:00.000Z', translationUpdatedAt: '2026-11-18T08:02:00.000Z' };
  expect(queued[0].payload).toMatchObject(expected);
  online(true);
  await drain(productionSyncHandlers);
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls.at(-1)?.[1]?.body))).toMatchObject(expected);
});

test('an online existing-word save sends context alongside its grade without inventing a translation', async () => {
  online(true);
  await updateWord(5, 2, undefined, { textId: 7, sentence: 'A cat sleeps.' });
  expect(JSON.parse(String(vi.mocked(fetchApi).mock.calls[0][1]?.body)))
    .toEqual({ status: 2, textId: 7, sentence: 'A cat sleeps.', clientUpdatedAt: expect.any(String) });
  expect(await listPending()).toHaveLength(0);
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
  expect(payload.clientUpdatedAt).toEqual(expect.any(String));
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
      op: expect.objectContaining({ type: 'wordStatusUpdate',
        payload: { wordId: 5, status: 4, clientUpdatedAt: expect.any(String) } }),
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
