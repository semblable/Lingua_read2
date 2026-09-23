// Glue between the server's bookmarks (api/bookmarks.ts), the local cache
// (bookmarks.ts) and the offline queue. Kept apart from bookmarks.ts so that
// module stays import-free: offline/cleanup.ts imports it, and api/client.ts
// imports cleanup.ts.

import { importLegacyBookmarks } from './api/bookmarks';
import {
  getAllCachedBookmarks,
  isLegacyBookmarkImportDone,
  markLegacyBookmarkImportDone
} from './bookmarks';
import type { StoredPendingOp } from './offline/syncQueue';

export type BookmarkState = {
  sentenceIndices: number[];
  lastSentenceIndex: number | null;
};

let legacyImport: Promise<void> | null = null;

/**
 * Uploads, once per browser, the bookmarks that builds before bookmark sync
 * kept only in localStorage. Shared promise, so the app-start call and the
 * reader can both await it; a failure (e.g. offline) is retried on the next call.
 */
export const migrateLegacyBookmarks = (): Promise<void> => {
  if (isLegacyBookmarkImportDone()) return Promise.resolve();
  if (!legacyImport) {
    legacyImport = (async () => {
      const texts = getAllCachedBookmarks()
        .map((entry) => ({
          textId: Number(entry.textId),
          sentenceIndices: entry.sentenceIndices.filter((i) => Number.isInteger(i) && i >= 0),
          lastSentenceIndex: entry.lastSentenceIndex
        }))
        .filter((entry) => Number.isInteger(entry.textId) && entry.textId > 0 && entry.sentenceIndices.length > 0);
      if (texts.length > 0) {
        await importLegacyBookmarks({ texts });
      }
      markLegacyBookmarkImportDone();
    })().catch((error: unknown) => {
      console.error('Failed to upload local bookmarks; will retry:', error);
      legacyImport = null;
    });
  }
  return legacyImport;
};

// Test-only: forget the in-flight/finished import between tests.
export const _resetLegacyBookmarkImportForTests = (): void => {
  legacyImport = null;
};

/**
 * Replays this text's still-queued offline toggles over the server's answer,
 * so a toggle that hasn't synced yet doesn't flicker back on reload.
 */
export const applyPendingBookmarkOps = (
  state: BookmarkState,
  pendingOps: StoredPendingOp[],
  textId: number
): BookmarkState => {
  const indices = new Set(state.sentenceIndices);
  let last = state.lastSentenceIndex;

  for (const op of pendingOps) {
    if (op.type !== 'bookmarkSet' || op.payload.textId !== textId) continue;
    const { sentenceIndex, bookmarked } = op.payload;
    if (bookmarked) {
      indices.add(sentenceIndex);
      last = sentenceIndex;
    } else {
      indices.delete(sentenceIndex);
      if (last === sentenceIndex) {
        last = indices.size > 0 ? Math.max(...indices) : null;
      }
    }
  }

  return { sentenceIndices: [...indices].sort((a, b) => a - b), lastSentenceIndex: last };
};

/**
 * Until the one-time import has succeeded, the cache may hold bookmarks the
 * server has never seen; show (and keep) both instead of letting the server's
 * answer overwrite them.
 */
export const mergeWithUnimportedCache = (
  server: BookmarkState,
  cached: BookmarkState
): BookmarkState => ({
  sentenceIndices: [...new Set([...server.sentenceIndices, ...cached.sentenceIndices])].sort((a, b) => a - b),
  lastSentenceIndex: server.lastSentenceIndex ?? cached.lastSentenceIndex
});
