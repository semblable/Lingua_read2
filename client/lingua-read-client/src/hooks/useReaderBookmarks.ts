import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  getBookmarkedSentences,
  getLastBookmarkedSentence,
  isLegacyBookmarkImportDone,
  setCachedBookmarks,
  toggleBookmark as toggleBookmarkInStorage
} from '../utils/bookmarks';
import { getTextBookmarks, setTextBookmark } from '../utils/api/bookmarks';
import {
  applyPendingBookmarkOps,
  mergeWithUnimportedCache,
  migrateLegacyBookmarks
} from '../utils/bookmarkSync';
import { listPending } from '../utils/offline/syncQueue';

export type UseReaderBookmarksArgs = {
  textId: number | string | null | undefined;
  isMobile: boolean;
  hasActiveTextSelection: () => boolean;
};

export type UseReaderBookmarksResult = {
  bookmarkedIndices: number[];
  // Newest bookmark; the reader scrolls to it when the text opens.
  lastBookmarkedIndex: number | null;
  // False until the server answered (or failed, e.g. offline) for this text,
  // so the scroll-on-open uses the synced anchor, not a stale local one.
  bookmarksReady: boolean;
  isBookmarked: (sentenceIndex: number) => boolean;
  toggleBookmarkForIndex: (sentenceIndex: number) => void;
  handleSentenceContextMenu: (
    event: React.MouseEvent,
    sentenceIndex: number
  ) => void;
};

const toTextIdNumber = (textId: number | string): number => parseInt(String(textId), 10);

export const useReaderBookmarks = ({
  textId,
  isMobile,
  hasActiveTextSelection
}: UseReaderBookmarksArgs): UseReaderBookmarksResult => {
  const [bookmarkedIndices, setBookmarkedIndices] = useState<number[]>([]);
  const [lastBookmarkedIndex, setLastBookmarkedIndex] = useState<number | null>(null);
  // The text whose server answer is in (or failed). Keyed by text rather than a
  // boolean so it's never briefly "ready" with the previous text's anchor.
  const [readyForTextId, setReadyForTextId] = useState<string | null>(null);
  // Bumped per load, so an answer for a text the reader already left is dropped.
  const loadIdRef = useRef(0);
  const loadInFlightRef = useRef(false);
  // The text on screen, so a save that settles after "Next lesson" doesn't
  // reload the previous text over the new one.
  const textIdRef = useRef<string | null>(null);
  // Toggles still being saved, and whether the server state must be fetched
  // again once they have all landed (a toggle dropped an in-flight load's
  // answer, or the server rejected one).
  const savesInFlightRef = useRef(0);
  const reloadAfterSavesRef = useRef(false);

  const showCached = useCallback((id: number | string) => {
    setBookmarkedIndices(getBookmarkedSentences(id));
    setLastBookmarkedIndex(getLastBookmarkedSentence(id));
  }, []);

  const loadFromServer = useCallback(async (id: number | string) => {
    const loadId = ++loadIdRef.current;
    loadInFlightRef.current = true;
    try {
      await migrateLegacyBookmarks();
      const server = await getTextBookmarks(id);
      let pendingOps: Awaited<ReturnType<typeof listPending>> = [];
      try {
        pendingOps = await listPending();
      } catch {
        /* no IndexedDB: nothing queued to replay */
      }
      if (loadId !== loadIdRef.current) return;

      let state = applyPendingBookmarkOps(
        {
          sentenceIndices: server?.sentenceIndices ?? [],
          lastSentenceIndex: server?.lastSentenceIndex ?? null
        },
        pendingOps,
        toTextIdNumber(id)
      );
      if (!isLegacyBookmarkImportDone()) {
        state = mergeWithUnimportedCache(state, {
          sentenceIndices: getBookmarkedSentences(id),
          lastSentenceIndex: getLastBookmarkedSentence(id)
        });
      }
      setCachedBookmarks(id, state.sentenceIndices, state.lastSentenceIndex);
      setBookmarkedIndices(state.sentenceIndices);
      setLastBookmarkedIndex(state.lastSentenceIndex);
    } catch (error) {
      // Offline or server error: keep showing the cached copy.
      console.error('Failed to load bookmarks:', error);
    } finally {
      if (loadId === loadIdRef.current) {
        loadInFlightRef.current = false;
        setReadyForTextId(String(id));
      }
    }
  }, []);

  useEffect(() => {
    textIdRef.current = textId ? String(textId) : null;
    reloadAfterSavesRef.current = false;
    if (!textId) {
      loadIdRef.current++;
      loadInFlightRef.current = false;
      setBookmarkedIndices([]);
      setLastBookmarkedIndex(null);
      return;
    }
    showCached(textId);
    void loadFromServer(textId);
  }, [textId, showCached, loadFromServer]);

  const isBookmarked = useCallback(
    (sentenceIndex: number) => bookmarkedIndices.includes(sentenceIndex),
    [bookmarkedIndices]
  );

  const toggleBookmarkForIndex = useCallback(
    (sentenceIndex: number) => {
      if (!textId || typeof sentenceIndex !== 'number' || sentenceIndex < 0) return;
      const bookmarked = !getBookmarkedSentences(textId).includes(sentenceIndex);
      // A load still in flight may predate this toggle; drop its answer, and
      // fetch again once the toggle is saved so other devices' bookmarks show.
      if (loadInFlightRef.current) reloadAfterSavesRef.current = true;
      loadIdRef.current++;
      loadInFlightRef.current = false;
      setReadyForTextId(String(textId));
      toggleBookmarkInStorage(textId, sentenceIndex);
      showCached(textId);
      savesInFlightRef.current++;
      // Offline, this queues the toggle and resolves; only a server rejection
      // lands in the catch, and then the server's state is the one to show.
      setTextBookmark(toTextIdNumber(textId), sentenceIndex, bookmarked)
        .catch((error: unknown) => {
          console.error('Failed to save bookmark:', error);
          reloadAfterSavesRef.current = true;
        })
        .finally(() => {
          savesInFlightRef.current--;
          // Waiting for every save keeps the answer from missing one still in flight.
          if (savesInFlightRef.current > 0 || !reloadAfterSavesRef.current) return;
          if (textIdRef.current !== String(textId)) return;
          reloadAfterSavesRef.current = false;
          void loadFromServer(textId);
        });
    },
    [textId, showCached, loadFromServer]
  );

  const handleSentenceContextMenu = useCallback(
    (event: React.MouseEvent, sentenceIndex: number) => {
      event.preventDefault();
      if (isMobile || hasActiveTextSelection()) return;
      toggleBookmarkForIndex(sentenceIndex);
    },
    [isMobile, hasActiveTextSelection, toggleBookmarkForIndex]
  );

  return {
    bookmarkedIndices,
    lastBookmarkedIndex,
    bookmarksReady: textId != null && readyForTextId === String(textId),
    isBookmarked,
    toggleBookmarkForIndex,
    handleSentenceContextMenu
  };
};
