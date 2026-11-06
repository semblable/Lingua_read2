import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Word } from '../utils/api/words';
import type { DisplayedWord } from '../types/displayedWord';
import { useSyncedWordIdentities } from '../hooks/useSyncedWordIdentities';
import { fetchApi } from '../utils/api/client';
import { pending } from '../utils/offline/syncQueue';
import { notifyOfflineEvent } from '../utils/offline/events';

vi.mock('../utils/api/client', () => ({ fetchApi: vi.fn() }));
vi.mock('../utils/offline/syncQueue', () => ({ pending: vi.fn() }));
const online = (value: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, value });
const lookup = (term: string) => term.toLowerCase();
beforeEach(() => { vi.clearAllMocks(); online(true); });
afterEach(() => online(true));

test('reconciles server IDs after sync while retaining the latest optimistic edit', async () => {
  vi.mocked(pending).mockResolvedValue(1);
  vi.mocked(fetchApi).mockResolvedValue({ words: [{ wordId: 41, term: 'cat', status: 4, translation: 'old' }] });
  const { result } = renderHook(() => {
    const [words, setWords] = useState<Word[]>([{ wordId: 0, term: 'Cat', status: 2, translation: '' }]);
    const [displayed, setDisplayed] = useState<DisplayedWord | null>({ wordId: 0, term: 'Cat', status: 2, translation: '' });
    useSyncedWordIdentities(1, words, lookup, setWords, setDisplayed);
    return { words, displayed };
  });
  await act(async () => {});
  expect(fetchApi).not.toHaveBeenCalled();
  vi.mocked(pending).mockResolvedValue(0);
  act(() => notifyOfflineEvent('sync-complete'));
  await waitFor(() => expect(result.current.words[0].wordId).toBe(41));
  expect(result.current.words[0]).toMatchObject({ term: 'Cat', status: 2, translation: '' });
  expect(result.current.displayed).toMatchObject({ wordId: 41, status: 2, translation: '' });
});

test('does not repeatedly refetch an unresolved identity', async () => {
  vi.mocked(pending).mockResolvedValue(0);
  vi.mocked(fetchApi).mockResolvedValue({ words: [] });
  renderHook(() => {
    const [words, setWords] = useState<Word[]>([{ wordId: 0, term: 'cat', status: 1 }]);
    const [, setDisplayed] = useState<DisplayedWord | null>(null);
    useSyncedWordIdentities(1, words, lookup, setWords, setDisplayed);
  });
  await waitFor(() => expect(fetchApi).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(fetchApi).toHaveBeenCalledTimes(1);
});

test('does not apply an old text identity when navigation happens during the queue check', async () => {
  let resolveOldQueue!: (value: number) => void;
  vi.mocked(pending).mockResolvedValue(0).mockResolvedValueOnce(0)
    .mockReturnValueOnce(new Promise(resolve => { resolveOldQueue = resolve; }));
  vi.mocked(fetchApi).mockImplementation(endpoint => String(endpoint) === '/texts/1'
    ? Promise.resolve({ words: [{ wordId: 41, term: 'cat' }] })
    : new Promise(() => {}));
  const { result, rerender } = renderHook(({ textId }) => {
    const [words, setWords] = useState<Word[]>([{ wordId: 0, term: 'cat', status: 1 }]);
    const [, setDisplayed] = useState<DisplayedWord | null>(null);
    useSyncedWordIdentities(textId, words, lookup, setWords, setDisplayed);
    return words;
  }, { initialProps: { textId: 1 } });
  await waitFor(() => expect(pending).toHaveBeenCalledTimes(2));
  rerender({ textId: 2 });
  await act(async () => { resolveOldQueue(0); });
  expect(result.current[0].wordId).toBe(0);
});
