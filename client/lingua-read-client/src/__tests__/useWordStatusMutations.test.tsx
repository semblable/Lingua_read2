import 'fake-indexeddb/auto';
import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from 'vitest';
import { useWordStatusMutations, type WordStatusIntent } from '../hooks/useWordStatusMutations';
import { createWord, updateWord, type Word } from '../utils/api/words';
import * as apiClient from '../utils/api/client';
import type { DisplayedWord } from '../types/displayedWord';
import { notifyOfflineEvent, notifyWordReplay } from '../utils/offline/events';
import { clearAll, drain, enqueue, listPending } from '../utils/offline/syncQueue';
import { productionSyncHandlers } from '../utils/offline/handlers';

const lookupTerm = (term: string) => term.toLowerCase();
const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const target = (word: Word) => ({ textId: 7, term: word.term!, word, sentence: `A ${word.term} rests.` });
const cat = { wordId: 41, term: 'cat', status: 1, translation: 'chat' };
const dog = { wordId: 42, term: 'dog', status: 2, translation: 'chien' };
function setup(initial: Word[] = [cat, dog], options: {
  create?: Mock<typeof createWord>; update?: Mock<typeof updateWord>;
  onTranslationSaved?: (target: unknown, translation: string) => void;
} = {}) {
  const create = options.create ?? vi.fn().mockResolvedValue({ wordId: 91 });
  const update = options.update ?? vi.fn().mockResolvedValue({});
  const hook = renderHook(({ generation, languageId = 3 }: { generation: string; languageId?: number }) => {
    const [words, setWords] = useState(initial);
    const [displayed, setDisplayedWord] = useState<DisplayedWord | null>(initial[0] as DisplayedWord);
    const mutations = useWordStatusMutations({ generation, languageId, lookupTerm, create, update,
      setWords, setDisplayedWord, onTranslationSaved: options.onTranslationSaved });
    return { ...mutations, words, displayed, setWords, setDisplayedWord };
  }, { initialProps: { generation: 'first' } as { generation: string; languageId?: number } });
  return { ...hook, create, update };
}
beforeEach(async () => { await clearAll(); });
afterEach(() => { notifyOfflineEvent('session-ended'); vi.useRealTimers(); });

describe('reader status mutation coordination', () => {
  test('retiring a newly created word removes its natural-key alias so the same term can be created again', async () => {
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const { result, create, update } = setup([unsaved]);
    await act(async () => { await result.current.mutate({ target: target(unsaved), status: 3 }); });
    await act(async () => {
      await result.current.retire(result.current.words[0]);
      result.current.setWords([]);
      result.current.setDisplayedWord({ term: 'cat', status: 0, translation: '', isNew: true });
    });
    expect(result.current.states).toEqual([]);
    await act(async () => { await result.current.mutate({ target: { textId: 7, term: 'cat', word: null }, status: 2 }); });
    expect(create).toHaveBeenCalledTimes(2);
    expect(update).not.toHaveBeenCalled();
    expect(result.current.words[0]).toMatchObject({ wordId: 91, term: 'cat', status: 2 });
  });

  test('retirement stops later intents and prevents an in-flight completion from restoring a deleted word', async () => {
    const pending = deferred<unknown>();
    const update = vi.fn().mockImplementation((id: number) => id === 41 ? pending.promise : Promise.resolve({}));
    const { result } = setup([cat, dog], { update });
    let unsent!: Promise<unknown>;
    act(() => {
      void result.current.mutate({ target: target(cat), status: 3 });
      unsent = result.current.mutate({ target: target(cat), status: 4 });
      void result.current.mutate({ target: target(dog), status: 3 });
    });
    await act(async () => {
      await result.current.retire(cat);
      result.current.setWords(words => words.filter(word => word.wordId !== 41));
      result.current.setDisplayedWord({ term: 'cat', status: 0, isNew: true });
    });
    await expect(unsent).resolves.toBe('failed');
    await act(async () => { pending.resolve({ wordId: 41, term: 'cat', status: 3 }); });
    expect(update.mock.calls.map(([id, status]) => [id, status])).toEqual([[41, 3], [42, 3]]);
    expect(result.current.words).toEqual([expect.objectContaining({ wordId: 42, status: 3 })]);
    expect(result.current.displayed).toMatchObject({ term: 'cat', status: 0, isNew: true });
    expect(result.current.states).toHaveLength(1);
  });

  test('retirement removes only this word from the offline queue', async () => {
    const update = vi.fn().mockImplementation(async (wordId: number, status: number) => {
      const op = { type: 'wordStatusUpdate' as const, payload: { wordId, status } };
      return { offline: true, queuedOp: { ...op, id: await enqueue(op, `wordStatusUpdate:${wordId}`) } };
    });
    const { result } = setup([cat, dog], { update });
    await act(async () => {
      await result.current.mutate({ target: target(cat), status: 3 });
      await result.current.mutate({ target: target(dog), status: 4 });
    });
    await enqueue({ type: 'srsReview', payload: { cardId: 8, grade: 2 } });
    await act(async () => { await result.current.retire(cat); });
    expect((await listPending()).map(op => op.type === 'wordStatusUpdate' ? op.payload.wordId : op.type)).toEqual([42, 'srsReview']);
    expect(result.current.states[0]).toMatchObject({ wordId: 42, queuedOffline: true });
  });

  test.each([3, 4] as const)('tracks two passage creates independently when the later status is %s', async laterStatus => {
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const create = vi.fn().mockResolvedValueOnce({ offline: true, queuedOp: {
      id: 101, type: 'wordCreate', payload: { textId: 7, term: 'cat', status: 3 },
    } }).mockResolvedValueOnce({ offline: true, queuedOp: {
      id: 102, type: 'wordCreate', payload: { textId: 8, term: 'cat', status: laterStatus },
    } }).mockResolvedValue({ wordId: 91 });
    const { result, rerender, update } = setup([unsaved], { create });
    await act(async () => { await result.current.mutate({ target: target(unsaved), status: 3 }); });
    rerender({ generation: 'passage-b' });
    await act(async () => { await result.current.mutate({ target: { ...target(unsaved), textId: 8 }, status: laterStatus }); });
    act(() => notifyWordReplay({ outcome: 'confirmed',
      op: { id: 101, enqueuedAt: 0, type: 'wordCreate', payload: { textId: 7, term: 'cat', status: 3 } },
      result: { wordId: 91, term: 'cat', status: 3 },
    }));
    expect(result.current.states[0]).toMatchObject({ queuedOffline: true, confirmedStatus: 3, desiredStatus: laterStatus });
    act(() => notifyWordReplay({ outcome: 'rejected',
      op: { id: 102, enqueuedAt: 0, type: 'wordCreate', payload: { textId: 8, term: 'cat', status: laterStatus } },
    }));
    expect(result.current.states[0]).toMatchObject({ queuedOffline: false, confirmedStatus: 3, desiredStatus: 3 });
    expect(result.current.states[0].error).toContain('Could not save cat');
    await act(async () => { await result.current.retry(result.current.states[0].key); });
    expect(update).toHaveBeenLastCalledWith(91, laterStatus, undefined);
  });

  test('a matching server read after another tab drains the queue confirms identified operations without a local replay event', async () => {
    const update = vi.fn().mockResolvedValue({ offline: true, queuedOp: {
      id: 103, type: 'wordStatusUpdate', payload: { wordId: 41, status: 4, translation: 'new sense' },
    } });
    const { result } = setup([cat], { update });
    await act(async () => { await result.current.mutate({ target: target(cat), status: 4, translation: 'new sense' }); });
    act(() => result.current.reconcileServerWords([{ ...cat, status: 4, translation: 'new sense' }]));
    expect(result.current.states[0]).toMatchObject({ queuedOffline: false, confirmedStatus: 4, desiredStatus: 4 });
    expect(result.current.states[0].error).toBeUndefined();
  });

  test('a new passage save stays behind an older queued create after an earlier replay supplies the ID', async () => {
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const secondReplay = deferred<void>();
    let serverStatus = 0;
    const fetch = vi.spyOn(apiClient, 'fetchApi').mockImplementation(async <T,>(endpoint: string, options?: apiClient.FetchApiOptions): Promise<T> => {
      if (endpoint === '/words/42') return {} as T;
      const payload = JSON.parse(String(options?.body)) as { textId: number; status: number };
      if (payload.textId === 8) await secondReplay.promise;
      serverStatus = payload.status;
      return { wordId: 91, term: 'cat', status: payload.status } as T;
    });
    const online = (value: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value });
    const create = vi.fn(createWord);
    const update = vi.fn(updateWord);
    try {
      online(false);
      const { result, rerender } = setup([unsaved], { create, update });
      await act(async () => { await result.current.mutate({ target: target(unsaved), status: 3 }); });
      rerender({ generation: 'passage-b' });
      await act(async () => { await result.current.mutate({ target: { ...target(unsaved), textId: 8, sentence: 'The cat in B.' }, status: 4 }); });
      online(true);
      let replay!: ReturnType<typeof drain>;
      act(() => { replay = drain(productionSyncHandlers); });
      await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
      expect(result.current.words[0].wordId).toBe(91);
      rerender({ generation: 'passage-c' });
      await act(async () => {
        await result.current.mutate({ target: { ...target(result.current.words[0]), textId: 9, sentence: 'The cat in C.' }, status: 5 });
      });
      expect(fetch).toHaveBeenCalledTimes(2);
      expect((await listPending()).map(op => op.payload)).toEqual([
        expect.objectContaining({ textId: 8, status: 4, sentence: 'The cat in B.' }),
        expect.objectContaining({ textId: 9, status: 5, sentence: 'The cat in C.' }),
      ]);
      await act(async () => { await result.current.mutate({ target: target(dog), status: 3 }); });
      expect(fetch).toHaveBeenLastCalledWith('/words/42', expect.objectContaining({ method: 'PUT' }));
      await act(async () => { secondReplay.resolve(); await replay; });
      expect(serverStatus).toBe(4);
      expect(result.current.states[0]).toMatchObject({ desiredStatus: 5, confirmedStatus: 4, queuedOffline: true });
      await act(async () => { await drain(productionSyncHandlers); });
      expect(fetch.mock.calls.filter(([endpoint]) => endpoint === '/words')
        .map(([, options]) => JSON.parse(String(options?.body)).textId)).toEqual([7, 8, 9]);
      expect(serverStatus).toBe(5);
      expect(result.current.states[0]).toMatchObject({ desiredStatus: 5, confirmedStatus: 5, queuedOffline: false });
      expect(result.current.words[0].status).toBe(5);
      expect(await listPending()).toEqual([]);
    } finally {
      secondReplay.resolve();
      online(true);
      fetch.mockRestore();
    }
  });

  test('an older replay rejection publishes its cleared queue flags after a newer response', async () => {
    const update = vi.fn().mockResolvedValueOnce({ offline: true, queuedOp: {
      id: 104, type: 'wordStatusUpdate', payload: { wordId: 41, status: 3 },
    } }).mockResolvedValueOnce({});
    const { result } = setup([cat], { update });
    await act(async () => {
      await result.current.mutate({ target: target(cat), status: 3 });
      await result.current.mutate({ target: target(cat), status: 4 });
    });
    expect(result.current.states[0].queuedOffline).toBe(true);
    act(() => notifyWordReplay({ outcome: 'rejected', op: {
      id: 104, enqueuedAt: 0, type: 'wordStatusUpdate', payload: { wordId: 41, status: 3 },
    } }));
    expect(result.current.states[0]).toMatchObject({ queuedOffline: false, desiredStatus: 4, confirmedStatus: 4 });
    expect(result.current.states[0].error).toBeUndefined();
  });

  test.each(['retry', 'repeat'] as const)('%s refetches a provider translation after an imported empty-translation row fails to save', async action => {
    const untracked = { ...cat, status: 0, translation: '' };
    const update = vi.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue({});
    const fillTranslation = vi.fn().mockResolvedValue('translated cat');
    const { result } = setup([untracked], { update });
    const intent = { target: target(untracked), status: 3 as const, fillTranslation };
    await act(async () => { await result.current.mutate(intent); });
    expect(update).toHaveBeenLastCalledWith(41, 3, 'translated cat');
    await act(async () => {
      if (action === 'retry') await result.current.retry(result.current.states[0].key);
      else await result.current.mutate(intent);
    });
    expect(update).toHaveBeenLastCalledWith(41, 3, 'translated cat');
    expect(result.current.words[0]).toMatchObject({ status: 3, translation: 'translated cat' });
  });

  test.each(['new sense', ''])('a later explicit translation %j keeps ownership when a provider-filled save is retried', async translation => {
    const untracked = { ...cat, status: 0, translation: '' };
    const pending = deferred<unknown>();
    const update = vi.fn().mockReturnValueOnce(pending.promise).mockRejectedValueOnce({ status: 503 }).mockResolvedValue({});
    const fillTranslation = vi.fn().mockResolvedValue('provider sense');
    const { result } = setup([untracked], { update });
    act(() => { void result.current.mutate({ target: target(untracked), status: 3, fillTranslation }); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(1));
    act(() => { void result.current.mutate({ target: target(untracked), status: 4, translation }); });
    await act(async () => { pending.reject({ status: 503 }); });
    await act(async () => { await result.current.retry(result.current.states[0].key); });
    expect(update).toHaveBeenLastCalledWith(41, 4, translation);
    expect(result.current.words[0].translation).toBe(translation);
  });

  test('queued provisional identity survives unmount, protects a stale read, and receives replay while no reader is mounted', async () => {
    const create = vi.fn().mockResolvedValue({ wordId: 0, offline: true });
    const update = vi.fn().mockResolvedValue({});
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const first = setup([unsaved], { create, update });
    await act(async () => { await first.result.current.mutate({ target: target(unsaved), status: 4 }); });
    first.unmount();
    await act(async () => {});
    const second = setup([unsaved], { create, update });
    expect(second.result.current.states[0]).toMatchObject({ desiredStatus: 4, queuedOffline: true });
    expect(second.result.current.reconcileWords([unsaved], [unsaved], second.result.current.version())[0].status).toBe(4);
    second.unmount();
    act(() => notifyWordReplay({ outcome: 'confirmed',
      op: { id: 2, enqueuedAt: 0, type: 'wordCreate', payload: { textId: 7, term: 'cat', status: 4 } },
      result: { wordId: 91, term: 'cat', status: 4 },
    }));
    await act(async () => {});
    const third = setup([{ wordId: 91, term: 'cat', status: 4 }], { create, update });
    await act(async () => { await third.result.current.mutate({ target: target(third.result.current.words[0]), status: 2 }); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(91, 2, undefined);
  });
  test('captures two different words immediately and lets their responses finish in either order', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const update = vi.fn().mockImplementation((id: number) => id === 41 ? first.promise : second.promise);
    const { result } = setup(undefined, { update });
    act(() => {
      void result.current.mutate({ target: target(cat), status: 3 });
      void result.current.mutate({ target: target(dog), status: 4 });
    });
    expect(update.mock.calls.map(([id, status]) => [id, status])).toEqual([[41, 3], [42, 4]]);
    expect(result.current.words.map(word => word.status)).toEqual([3, 4]);
    await act(async () => { second.resolve({ status: 4 }); });
    expect(result.current.states.find(state => state.wordId === 41)?.pending).toBe(true);
    await act(async () => { first.resolve({ status: 3 }); });
    expect(result.current.words.map(word => word.status)).toEqual([3, 4]);
    expect(result.current.states.every(state => !state.pending)).toBe(true);
  });

  test('creates once, transfers pending intents to the server ID, and keeps each later write in order', async () => {
    const creating = deferred<unknown>();
    const updating = deferred<unknown>();
    const create = vi.fn().mockReturnValue(creating.promise);
    const update = vi.fn().mockReturnValueOnce(updating.promise).mockResolvedValue({});
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const { result } = setup([unsaved], { create, update });
    const intent: WordStatusIntent = { target: target(unsaved), status: 3 };
    act(() => {
      void result.current.mutate(intent);
      void result.current.mutate({ target: target(unsaved), status: 4 });
    });
    intent.target.sentence = 'Changed context after dispatch.';
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(7, 'cat', 3, undefined, 'A cat rests.');
    expect(update).not.toHaveBeenCalled();
    expect(result.current.words[0].status).toBe(4);
    await act(async () => { creating.resolve({ wordId: 91, term: 'cat', status: 3 }); });
    expect(update).toHaveBeenCalledWith(91, 4, undefined);
    expect(result.current.states[0]).toMatchObject({ wordId: 91, desiredStatus: 4, confirmedStatus: 3, pending: true });
    act(() => { void result.current.mutate({ target: target(result.current.words[0]), status: 2 }); });
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => { updating.resolve({}); });
    await waitFor(() => expect(update).toHaveBeenCalledTimes(2));
    expect(update.mock.calls.map(([, status]) => status)).toEqual([4, 2]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.words).toHaveLength(1);
    expect(result.current.words[0]).toMatchObject({ wordId: 91, status: 2 });
  });

  test('an older failure cannot roll back a later intent; a rejected latest write rolls back to confirmed and retries', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValue({});
    const { result } = setup([cat], { update });
    act(() => {
      void result.current.mutate({ target: target(cat), status: 3 });
      void result.current.mutate({ target: target(cat), status: 4 });
    });
    await act(async () => { first.reject(new Error('rejected older edit')); });
    expect(result.current.words[0].status).toBe(4);
    expect(result.current.states[0].error).toBeUndefined();
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => { second.reject(new Error('rejected latest edit')); });
    expect(result.current.words[0].status).toBe(1);
    expect(result.current.states[0].error).toContain('Could not save cat');
    await act(async () => { await result.current.retry(result.current.states[0].key); });
    expect(update).toHaveBeenLastCalledWith(41, 4, undefined);
    expect(result.current.words[0].status).toBe(4);
    expect(result.current.states[0].error).toBeUndefined();
  });

  test('rolls a failed second write back to the first confirmed status', async () => {
    const first = deferred<unknown>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockRejectedValueOnce(new Error('rejected'));
    const { result } = setup([cat], { update });
    act(() => {
      void result.current.mutate({ target: target(cat), status: 3 });
      void result.current.mutate({ target: target(cat), status: 4 });
    });
    await act(async () => { first.resolve({}); });
    expect(result.current.words[0].status).toBe(3);
    expect(result.current.states[0]).toMatchObject({ confirmedStatus: 3, desiredStatus: 3, pending: false });
  });

  test('a late provider fill and stale server translation cannot overwrite a later explicit translation', async () => {
    const fill = deferred<string>();
    const create = vi.fn().mockResolvedValue({ wordId: 91, translation: 'stale server translation' });
    const update = vi.fn().mockResolvedValue({ translation: 'stale server translation' });
    const onTranslationSaved = vi.fn();
    const unsaved = { wordId: 0, term: 'cat', status: 0, translation: '' };
    const { result } = setup([unsaved], { create, update, onTranslationSaved });
    act(() => {
      void result.current.mutate({ target: target(unsaved), status: 3, fillTranslation: () => fill.promise });
      void result.current.mutate({ target: target(unsaved), status: 4, translation: 'new translation' });
    });
    expect(result.current.words[0].translation).toBe('new translation');
    await act(async () => { fill.resolve('late fill'); });
    expect(create).toHaveBeenCalledWith(7, 'cat', 3, undefined, 'A cat rests.');
    expect(update).toHaveBeenCalledWith(91, 4, 'new translation');
    expect(result.current.words[0].translation).toBe('new translation');
    expect(onTranslationSaved).toHaveBeenCalledTimes(1);
    expect(onTranslationSaved).toHaveBeenLastCalledWith(expect.objectContaining({ term: 'cat' }), 'new translation');
  });

  test('preserves an independently updated translation when a status-only response arrives', async () => {
    const pending = deferred<unknown>();
    const { result } = setup([cat], { update: vi.fn().mockReturnValue(pending.promise) });
    act(() => { void result.current.mutate({ target: target(cat), status: 4 }); });
    act(() => { result.current.setWords(words => words.map(word => ({ ...word, translation: 'newer sense' }))); });
    await act(async () => { pending.resolve({ translation: 'old sense' }); });
    expect(result.current.words[0]).toMatchObject({ status: 4, translation: 'newer sense' });
  });

  test('keeps queued offline separate from confirmed, reconciles replay by identity, then uses the returned ID', async () => {
    const create = vi.fn().mockResolvedValue({ wordId: 0, offline: true });
    const update = vi.fn().mockResolvedValue({});
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const { result } = setup([unsaved], { create, update });
    await act(async () => {
      await result.current.mutate({ target: target(unsaved), status: 3 });
      await result.current.mutate({ target: target(unsaved), status: 4 });
    });
    expect(result.current.states[0]).toMatchObject({ desiredStatus: 4, confirmedStatus: 0, queuedOffline: true });
    act(() => result.current.reconcileServerWords([{ wordId: 91, term: 'cat', status: 1 }]));
    expect(result.current.states[0].queuedOffline).toBe(true);
    expect(result.current.words[0].status).toBe(4);
    act(() => notifyWordReplay({ outcome: 'confirmed',
      op: { id: 2, enqueuedAt: 0, type: 'wordCreate', payload: { textId: 7, term: 'cat', status: 4 } },
      result: { wordId: 91, term: 'cat', status: 4 },
    }));
    expect(result.current.states[0]).toMatchObject({ confirmedStatus: 4, queuedOffline: false, wordId: 91 });
    await act(async () => { await result.current.mutate({ target: target(result.current.words[0]), status: 2 }); });
    expect(update).toHaveBeenCalledWith(91, 2, undefined);
    expect(create).toHaveBeenCalledTimes(2);
  });

  test('retains actionable replay failures and rejects only the failed latest offline status', async () => {
    const { result } = setup([cat], { update: vi.fn().mockResolvedValue({ offline: true }) });
    await act(async () => { await result.current.mutate({ target: target(cat), status: 4 }); });
    const op = { id: 1, enqueuedAt: 0, type: 'wordStatusUpdate' as const, payload: { wordId: 41, status: 4 } };
    act(() => notifyWordReplay({ op, outcome: 'retryable' }));
    expect(result.current.states[0]).toMatchObject({ queuedOffline: true, desiredStatus: 4, confirmedStatus: 1 });
    expect(result.current.states[0].error).toContain('Could not save cat');
    act(() => notifyWordReplay({ op, outcome: 'rejected' }));
    expect(result.current.states[0]).toMatchObject({ queuedOffline: false, desiredStatus: 1, confirmedStatus: 1 });
    expect(result.current.states[0].error).toContain('Could not save cat');
  });

  test('a status-only offline edit confirms after an earlier online translation edit', async () => {
    const update = vi.fn().mockResolvedValueOnce({}).mockResolvedValueOnce({ offline: true });
    const { result } = setup([cat], { update });
    await act(async () => { await result.current.mutate({ target: target(cat), status: 3, translation: 'new sense' }); });
    await act(async () => { await result.current.mutate({ target: target(result.current.words[0]), status: 4 }); });
    act(() => notifyWordReplay({ outcome: 'confirmed',
      op: { id: 1, enqueuedAt: 0, type: 'wordStatusUpdate', payload: { wordId: 41, status: 4 } },
    }));
    expect(result.current.states[0]).toMatchObject({ desiredStatus: 4, confirmedStatus: 4, queuedOffline: false });
    expect(result.current.words[0].translation).toBe('new sense');
  });

  test('a read started before an intent preserves it, including duplicate occurrences and translations', async () => {
    const pending = deferred<unknown>();
    const { result } = setup([cat], { update: vi.fn().mockReturnValue(pending.promise) });
    const readVersion = result.current.version();
    act(() => { void result.current.mutate({ target: target(cat), status: 4, translation: 'new sense' }); });
    const staleRead = [{ ...cat, status: 1, translation: 'old sense' }, dog];
    expect(result.current.reconcileWords(staleRead, result.current.words, readVersion))
      .toEqual([{ ...cat, status: 4, translation: 'new sense', offline: false, isNew: false }, dog]);
    await act(async () => { pending.resolve({}); });
    expect(result.current.reconcileWords(staleRead, result.current.words, readVersion)[0].status).toBe(4);
    const fresh = result.current.reconcileWords(staleRead, result.current.words, result.current.version());
    expect(fresh[0].status).toBe(1);
  });

  test('never merges distinct saved rows with similar lookup spellings', async () => {
    const rows = [{ ...cat, term: 'résumé' }, { ...dog, term: 'resume' }];
    const pending = deferred<unknown>();
    const update = vi.fn().mockReturnValue(pending.promise);
    const { result } = setup(rows, { update });
    act(() => {
      void result.current.mutate({ target: target(rows[0]), status: 3 });
      void result.current.mutate({ target: target(rows[1]), status: 4 });
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.states).toHaveLength(2);
    expect(result.current.words.map(word => word.status)).toEqual([3, 4]);
    await act(async () => { pending.resolve({}); });
  });

  test('continues already-dispatched FIFO writes without updating a different generation', async () => {
    const creating = deferred<unknown>();
    const create = vi.fn().mockReturnValue(creating.promise);
    const update = vi.fn().mockResolvedValue({});
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const { result, rerender } = setup([unsaved], { create, update });
    act(() => {
      void result.current.mutate({ target: target(unsaved), status: 3 });
      void result.current.mutate({ target: target(unsaved), status: 4 });
    });
    rerender({ generation: 'second' });
    act(() => { result.current.setWords([dog]); result.current.setDisplayedWord(dog); });
    await act(async () => { creating.resolve({ wordId: 91, term: 'cat' }); });
    expect(update).toHaveBeenCalledWith(91, 4, undefined);
    expect(result.current.words).toEqual([dog]);
    expect(result.current.displayed).toEqual(dog);
    expect(result.current.states).toEqual([]);
    expect(result.current.announcement).toBe('');
  });

  test('keeps the same saved entity FIFO when a new passage generation edits it', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result, rerender } = setup([cat], { update });
    act(() => { void result.current.mutate({ target: target(cat), status: 3 }); });
    rerender({ generation: 'second' });
    act(() => {
      result.current.setWords([cat]);
      result.current.setDisplayedWord(cat);
      void result.current.mutate({ target: { ...target(cat), textId: 8 }, status: 4 });
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(result.current.words[0].status).toBe(4);
    await act(async () => { first.resolve({ status: 3 }); });
    expect(update).toHaveBeenCalledTimes(2);
    expect(update.mock.calls.map(([, status]) => status)).toEqual([3, 4]);
    expect(result.current.words[0].status).toBe(4);
    await act(async () => { second.resolve({ status: 4 }); });
    expect(result.current.states[0]).toMatchObject({ desiredStatus: 4, confirmedStatus: 4, pending: false });
  });

  test('a provisional create retains its single FIFO and returned ID across passage generations', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const create = vi.fn().mockReturnValue(first.promise);
    const update = vi.fn().mockReturnValue(second.promise);
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const { result, rerender } = setup([unsaved], { create, update });
    act(() => { void result.current.mutate({ target: target(unsaved), status: 3 }); });
    rerender({ generation: 'retokenized' });
    act(() => {
      result.current.setWords([unsaved]);
      void result.current.mutate({ target: { ...target(unsaved), textId: 8, sentence: 'A new cat rests.' }, status: 4 });
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    await act(async () => { first.resolve({ wordId: 91, term: 'cat', status: 3 }); });
    expect(update).toHaveBeenCalledWith(91, 4, undefined);
    expect(create).toHaveBeenCalledTimes(1);
    expect(result.current.words[0]).toMatchObject({ wordId: 91, status: 4 });
    await act(async () => { second.resolve({}); });
  });

  test('language changes keep separate saved IDs while returning to a language retains its pending FIFO', async () => {
    const first = deferred<unknown>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue({});
    const { result, rerender } = setup([cat], { update });
    act(() => { void result.current.mutate({ target: target(cat), status: 3 }); });
    rerender({ generation: 'other-language', languageId: 4 });
    await act(async () => { await result.current.mutate({ target: target(cat), status: 2 }); });
    expect(update).toHaveBeenCalledTimes(2);
    rerender({ generation: 'returned', languageId: 3 });
    act(() => { void result.current.mutate({ target: target(cat), status: 4 }); });
    expect(update).toHaveBeenCalledTimes(2);
    await act(async () => { first.resolve({}); });
    expect(update.mock.calls.map(([, status]) => status)).toEqual([3, 2, 4]);
    expect(result.current.words[0].status).toBe(4);
  });

  test('an unmounted reader and its replacement share only unfinished saved-entity persistence', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    const update = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const oldReader = setup([cat], { update });
    act(() => { void oldReader.result.current.mutate({ target: target(cat), status: 3 }); });
    oldReader.unmount();
    const newReader = setup([cat], { update });
    act(() => { void newReader.result.current.mutate({ target: { ...target(cat), textId: 8 }, status: 4 }); });
    expect(update).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve({}); });
    expect(update.mock.calls.map(([, status]) => status)).toEqual([3, 4]);
    expect(newReader.result.current.words[0].status).toBe(4);
    await act(async () => { second.resolve({}); });
    expect(newReader.result.current.states[0]).toMatchObject({ desiredStatus: 4, confirmedStatus: 4 });
  });

  test('an unfinished create supplies its ID to a replacement reader without another create', async () => {
    const first = deferred<unknown>();
    const create = vi.fn().mockReturnValue(first.promise);
    const update = vi.fn().mockResolvedValue({});
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const oldReader = setup([unsaved], { create, update });
    act(() => { void oldReader.result.current.mutate({ target: target(unsaved), status: 3 }); });
    oldReader.unmount();
    const newReader = setup([unsaved], { create, update });
    act(() => { void newReader.result.current.mutate({ target: { ...target(unsaved), textId: 8 }, status: 4 }); });
    expect(create).toHaveBeenCalledTimes(1);
    await act(async () => { first.resolve({ wordId: 91, term: 'cat', status: 3 }); });
    expect(create).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(91, 4, undefined);
    expect(newReader.result.current.words[0]).toMatchObject({ wordId: 91, status: 4 });
  });

  test('old mounted-generation UI cannot land in a replacement reader with the same supplied generation string', async () => {
    const first = deferred<unknown>();
    const update = vi.fn().mockReturnValue(first.promise);
    const oldReader = setup([cat], { update });
    act(() => { void oldReader.result.current.mutate({ target: target(cat), status: 3 }); });
    oldReader.unmount();
    const newReader = setup([dog], { update });
    await act(async () => { first.resolve({}); });
    expect(newReader.result.current.words).toEqual([dog]);
    expect(newReader.result.current.displayed).toEqual(dog);
    expect(newReader.result.current.states).toEqual([]);
    expect(newReader.result.current.announcement).toBe('');
  });

  test('explicit logout separates sessions and prevents unsent old-session intentions from running', async () => {
    const first = deferred<unknown>();
    const oldUpdate = vi.fn().mockReturnValue(first.promise);
    const oldReader = setup([cat], { update: oldUpdate });
    act(() => {
      void oldReader.result.current.mutate({ target: target(cat), status: 3 });
      void oldReader.result.current.mutate({ target: target(cat), status: 4 });
    });
    oldReader.unmount();
    act(() => notifyOfflineEvent('session-ended'));
    const newUpdate = vi.fn().mockResolvedValue({});
    const newReader = setup([cat], { update: newUpdate });
    await act(async () => { await newReader.result.current.mutate({ target: target(cat), status: 2 }); });
    expect(newUpdate).toHaveBeenCalledWith(41, 2, undefined);
    await act(async () => { first.resolve({}); });
    expect(oldUpdate).toHaveBeenCalledTimes(1);
    expect(newReader.result.current.words[0].status).toBe(2);
  });

  test('settled unowned identity aliases are discarded before a later reader mounts', async () => {
    const unsaved = { wordId: 0, term: 'cat', status: 0 };
    const oldReader = setup([unsaved]);
    await act(async () => { await oldReader.result.current.mutate({ target: target(unsaved), status: 3 }); });
    oldReader.unmount();
    await act(async () => {});
    const newReader = setup([unsaved]);
    await act(async () => { await newReader.result.current.mutate({ target: target(unsaved), status: 4 }); });
    expect(newReader.create).toHaveBeenCalledWith(7, 'cat', 4, undefined, 'A cat rests.');
    expect(newReader.update).not.toHaveBeenCalled();
  });

  test('coalesces emitted feedback without coalescing different-word write intentions', async () => {
    vi.useFakeTimers();
    const { result, update } = setup();
    await act(async () => {
      void result.current.mutate({ target: target(cat), status: 3 });
      void result.current.mutate({ target: target(dog), status: 4 });
    });
    expect(update).toHaveBeenCalledTimes(2);
    expect(result.current.announcement).toBe('');
    act(() => vi.advanceTimersByTime(151));
    expect(result.current.announcement).toBe('dog: Advanced saved.');
  });
});
