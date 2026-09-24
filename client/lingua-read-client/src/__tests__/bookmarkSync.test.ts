import { describe, test, expect, beforeEach, vi } from 'vitest';

vi.mock('../utils/api/bookmarks', () => ({
  importLegacyBookmarks: vi.fn()
}));

import { importLegacyBookmarks } from '../utils/api/bookmarks';
import {
  _resetLegacyBookmarkImportForTests,
  applyPendingBookmarkOps,
  mergeWithUnimportedCache,
  migrateLegacyBookmarks
} from '../utils/bookmarkSync';
import type { StoredPendingOp } from '../utils/offline/syncQueue';

const KEY = 'linguaReadBookmarks';
const LAST_KEY = 'linguaReadLastBookmark';
const IMPORTED_KEY = 'linguaReadBookmarksImported';

const bookmarkOp = (id: number, textId: number, sentenceIndex: number, bookmarked: boolean): StoredPendingOp => ({
  id,
  enqueuedAt: id,
  type: 'bookmarkSet',
  payload: { textId, sentenceIndex, bookmarked, clientUpdatedAt: `t${id}` }
});

describe('migrateLegacyBookmarks', () => {
  beforeEach(() => {
    localStorage.clear();
    _resetLegacyBookmarkImportForTests();
    vi.mocked(importLegacyBookmarks).mockReset();
    vi.mocked(importLegacyBookmarks).mockResolvedValue({ imported: 1, skippedTexts: 0 });
  });

  test('uploads local bookmarks once and then never again', async () => {
    localStorage.setItem(KEY, JSON.stringify({ 7: [3, 1], 9: [0] }));
    localStorage.setItem(LAST_KEY, JSON.stringify({ 7: 3 }));

    await migrateLegacyBookmarks();
    _resetLegacyBookmarkImportForTests();
    await migrateLegacyBookmarks();

    expect(importLegacyBookmarks).toHaveBeenCalledTimes(1);
    expect(importLegacyBookmarks).toHaveBeenCalledWith({
      texts: [
        { textId: 7, sentenceIndices: [3, 1], lastSentenceIndex: 3 },
        { textId: 9, sentenceIndices: [0], lastSentenceIndex: null }
      ]
    });
    expect(localStorage.getItem(IMPORTED_KEY)).toBe('1');
  });

  test('concurrent callers share one upload', async () => {
    localStorage.setItem(KEY, JSON.stringify({ 7: [1] }));

    await Promise.all([migrateLegacyBookmarks(), migrateLegacyBookmarks()]);

    expect(importLegacyBookmarks).toHaveBeenCalledTimes(1);
  });

  test('marks nothing done when the upload fails, and retries on the next call', async () => {
    localStorage.setItem(KEY, JSON.stringify({ 7: [1] }));
    vi.mocked(importLegacyBookmarks).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await migrateLegacyBookmarks();
    expect(localStorage.getItem(IMPORTED_KEY)).toBeNull();

    await migrateLegacyBookmarks();
    expect(importLegacyBookmarks).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(IMPORTED_KEY)).toBe('1');
    consoleError.mockRestore();
  });

  test('skips the request when there is nothing usable to upload', async () => {
    localStorage.setItem(KEY, JSON.stringify({ abc: [1], 0: [2], 7: [], 8: [-1] }));

    await migrateLegacyBookmarks();

    expect(importLegacyBookmarks).not.toHaveBeenCalled();
    expect(localStorage.getItem(IMPORTED_KEY)).toBe('1');
  });
});

describe('applyPendingBookmarkOps', () => {
  test("replays this text's queued toggles in order and ignores other texts", () => {
    const result = applyPendingBookmarkOps(
      { sentenceIndices: [2, 5], lastSentenceIndex: 5 },
      [bookmarkOp(1, 7, 8, true), bookmarkOp(2, 7, 2, false), bookmarkOp(3, 99, 1, true)],
      7
    );

    expect(result).toEqual({ sentenceIndices: [5, 8], lastSentenceIndex: 8 });
  });

  test('falls back to the highest remaining index when the anchor is removed', () => {
    const result = applyPendingBookmarkOps(
      { sentenceIndices: [2, 4, 5], lastSentenceIndex: 2 },
      [bookmarkOp(1, 7, 2, false)],
      7
    );

    expect(result).toEqual({ sentenceIndices: [4, 5], lastSentenceIndex: 5 });
  });

  test('ignores ops of other kinds', () => {
    const state = { sentenceIndices: [1], lastSentenceIndex: 1 };
    const other: StoredPendingOp = { id: 1, enqueuedAt: 1, type: 'wordStatusUpdate', payload: { wordId: 1, status: 2 } };

    expect(applyPendingBookmarkOps(state, [other], 7)).toEqual(state);
  });
});

describe('mergeWithUnimportedCache', () => {
  test('keeps local-only bookmarks next to the server ones', () => {
    expect(mergeWithUnimportedCache(
      { sentenceIndices: [4], lastSentenceIndex: null },
      { sentenceIndices: [1, 4], lastSentenceIndex: 1 }
    )).toEqual({ sentenceIndices: [1, 4], lastSentenceIndex: 1 });
  });
});
