import { useEffect } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { Word } from '../utils/api/words';
import type { DisplayedWord } from '../types/displayedWord';
import { fetchApi } from '../utils/api/client';
import { pending } from '../utils/offline/syncQueue';
import { subscribeOfflineEvent } from '../utils/offline/events';

export function useSyncedWordIdentities(textId: number | string | null | undefined, words: Word[],
  lookupTerm: (term: string) => string, setWords: Dispatch<SetStateAction<Word[]>>,
  setDisplayedWord: Dispatch<SetStateAction<DisplayedWord | null>>,
  options: { reconcileServerWords?: (words: Word[]) => void; hasQueuedStatuses?: boolean } = {}): void {
  const { reconcileServerWords, hasQueuedStatuses = false } = options;
  const needsIdentity = words.some(word => !word.wordId);
  useEffect(() => {
    if (!textId || (!hasQueuedStatuses && !needsIdentity)) return;
    let disposed = false;
    let fetching = false;
    const reconcile = async () => {
      if (fetching || navigator.onLine === false) return;
      fetching = true;
      try {
        if (await pending() > 0 || disposed) return;
        const text = await fetchApi<{ words?: Word[] }>(`/texts/${textId}`, { suppressAuthRedirect: true });
        if (await pending() > 0 || disposed) return;
        // An ambiguous exact spelling cannot safely identify a provisional row.
        // In particular, never fold distinct saved rows into one identity.
        const savedWords = new Map<string, Word>();
        const ambiguous = new Set<string>();
        (text.words ?? []).filter(word => word.wordId && word.term).forEach(word => {
          const key = lookupTerm(word.term!);
          if (savedWords.has(key) && savedWords.get(key)?.wordId !== word.wordId) ambiguous.add(key);
          else savedWords.set(key, word);
        });
        ambiguous.forEach(key => savedWords.delete(key));
        reconcileServerWords?.(text.words ?? []);
        // Identity-only merge: a newer optimistic edit must not be overwritten
        // by the status/translation from an earlier network response.
        setWords(current => {
          let changed = false;
          const next = current.map(word => {
            const saved = savedWords.get(lookupTerm(word.term ?? ''));
            if (word.wordId || !saved) return word;
            changed = true;
            return { ...word, wordId: saved.wordId, translation: word.translation ?? saved.translation, offline: false };
          });
          return changed ? next : current;
        });
        setDisplayedWord(current => {
          const saved = savedWords.get(lookupTerm(current?.term ?? ''));
          return current && !current.wordId && saved
            ? { ...current, wordId: saved.wordId ?? undefined,
              translation: current.translation ?? saved.translation ?? undefined, offline: false } : current;
        });
      } catch { /* A later sync, focus or reconnect can retry identity lookup. */ }
      finally { fetching = false; }
    };
    const refresh = () => { void reconcile(); };
    const stop = subscribeOfflineEvent('sync-complete', refresh);
    const stopRestored = subscribeOfflineEvent('auth-restored', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    refresh();
    return () => {
      disposed = true;
      stop();
      stopRestored();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [textId, needsIdentity, lookupTerm, setWords, setDisplayedWord, reconcileServerWords, hasQueuedStatuses]);
}
