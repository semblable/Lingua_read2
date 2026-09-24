import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';

vi.mock('../utils/api/bookmarks', () => ({
  getTextBookmarks: vi.fn(),
  setTextBookmark: vi.fn(),
  importLegacyBookmarks: vi.fn()
}));

vi.mock('../utils/offline/syncQueue', () => ({
  listPending: vi.fn()
}));

import { useReaderBookmarks } from '../hooks/useReaderBookmarks';
import { getTextBookmarks, setTextBookmark, importLegacyBookmarks } from '../utils/api/bookmarks';
import { listPending } from '../utils/offline/syncQueue';
import { _resetLegacyBookmarkImportForTests } from '../utils/bookmarkSync';

const STORAGE_KEY = 'linguaReadBookmarks';
const LAST_KEY = 'linguaReadLastBookmark';
const IMPORTED_KEY = 'linguaReadBookmarksImported';

const hasActiveTextSelection = () => false;

const serverState = (textId, sentenceIndices, lastSentenceIndex = null) => ({
  textId,
  sentenceIndices,
  lastSentenceIndex
});

const renderBookmarks = (textId, overrides = {}) =>
  renderHook(
    (props) => useReaderBookmarks({ isMobile: false, hasActiveTextSelection, ...props }),
    { initialProps: { textId, ...overrides } }
  );

describe('useReaderBookmarks', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem(IMPORTED_KEY, '1');
    _resetLegacyBookmarkImportForTests();
    vi.mocked(getTextBookmarks).mockReset();
    vi.mocked(getTextBookmarks).mockImplementation((id) => Promise.resolve(serverState(Number(id), [])));
    vi.mocked(setTextBookmark).mockReset();
    vi.mocked(setTextBookmark).mockResolvedValue(serverState(0, []));
    vi.mocked(importLegacyBookmarks).mockReset();
    vi.mocked(importLegacyBookmarks).mockResolvedValue({ imported: 0, skippedTexts: 0 });
    vi.mocked(listPending).mockReset();
    vi.mocked(listPending).mockResolvedValue([]);
  });

  test('returns the documented Use<Name>Result shape', async () => {
    const { result } = renderBookmarks(1);

    expect(result.current).toEqual(
      expect.objectContaining({
        bookmarkedIndices: expect.any(Array),
        lastBookmarkedIndex: null,
        bookmarksReady: false,
        isBookmarked: expect.any(Function),
        toggleBookmarkForIndex: expect.any(Function),
        handleSentenceContextMenu: expect.any(Function)
      })
    );
    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
  });

  test('shows cached bookmarks before the server answers', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 7: [1, 3, 5] }));
    localStorage.setItem(LAST_KEY, JSON.stringify({ 7: 3 }));
    vi.mocked(getTextBookmarks).mockReturnValue(new Promise(() => {}));

    const { result } = renderBookmarks(7);

    expect(result.current.bookmarkedIndices).toEqual([1, 3, 5]);
    expect(result.current.lastBookmarkedIndex).toBe(3);
    expect(result.current.isBookmarked(3)).toBe(true);
    expect(result.current.isBookmarked(2)).toBe(false);
    expect(result.current.bookmarksReady).toBe(false);
  });

  test("replaces the cache with the server's bookmarks once they arrive", async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 7: [1, 3, 5] }));
    vi.mocked(getTextBookmarks).mockResolvedValue(serverState(7, [2, 9], 9));

    const { result } = renderBookmarks(7);

    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
    expect(result.current.bookmarkedIndices).toEqual([2, 9]);
    expect(result.current.lastBookmarkedIndex).toBe(9);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ 7: [2, 9] });
    expect(JSON.parse(localStorage.getItem(LAST_KEY))).toEqual({ 7: 9 });
  });

  test('keeps offline toggles that have not synced yet over the server answer', async () => {
    vi.mocked(getTextBookmarks).mockResolvedValue(serverState(7, [2, 4], 4));
    vi.mocked(listPending).mockResolvedValue([
      { id: 1, type: 'bookmarkSet', payload: { textId: 7, sentenceIndex: 4, bookmarked: false, clientUpdatedAt: 'a' } },
      { id: 2, type: 'bookmarkSet', payload: { textId: 7, sentenceIndex: 6, bookmarked: true, clientUpdatedAt: 'b' } },
      { id: 3, type: 'bookmarkSet', payload: { textId: 8, sentenceIndex: 1, bookmarked: true, clientUpdatedAt: 'c' } }
    ]);

    const { result } = renderBookmarks(7);

    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
    expect(result.current.bookmarkedIndices).toEqual([2, 6]);
    expect(result.current.lastBookmarkedIndex).toBe(6);
  });

  test('uploads local-only bookmarks once before loading from the server', async () => {
    localStorage.removeItem(IMPORTED_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 7: [1, 3], 12: [0] }));
    localStorage.setItem(LAST_KEY, JSON.stringify({ 7: 1 }));
    vi.mocked(getTextBookmarks).mockResolvedValue(serverState(7, [1, 3], 1));

    const { result } = renderBookmarks(7);

    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
    expect(importLegacyBookmarks).toHaveBeenCalledTimes(1);
    expect(importLegacyBookmarks).toHaveBeenCalledWith({
      texts: [
        { textId: 7, sentenceIndices: [1, 3], lastSentenceIndex: 1 },
        { textId: 12, sentenceIndices: [0], lastSentenceIndex: null }
      ]
    });
    expect(importLegacyBookmarks.mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(getTextBookmarks).mock.invocationCallOrder[0]);
    expect(localStorage.getItem(IMPORTED_KEY)).toBe('1');
    // The other text's local bookmarks are untouched until it is opened.
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))[12]).toEqual([0]);
  });

  test('keeps local-only bookmarks while the one-time upload keeps failing', async () => {
    localStorage.removeItem(IMPORTED_KEY);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 7: [1] }));
    vi.mocked(importLegacyBookmarks).mockRejectedValue(new Error('500'));
    vi.mocked(getTextBookmarks).mockResolvedValue(serverState(7, [4], 4));

    const { result } = renderBookmarks(7);

    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
    expect(result.current.bookmarkedIndices).toEqual([1, 4]);
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual({ 7: [1, 4] });
    expect(localStorage.getItem(IMPORTED_KEY)).toBeNull();
  });

  test('falls back to the cache when the server is unreachable', async () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 7: [1, 3] }));
    localStorage.setItem(LAST_KEY, JSON.stringify({ 7: 3 }));
    vi.mocked(getTextBookmarks).mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderBookmarks(7);

    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
    expect(result.current.bookmarkedIndices).toEqual([1, 3]);
    expect(result.current.lastBookmarkedIndex).toBe(3);
  });

  test('ignores a late answer for a text the reader already left', async () => {
    let resolveFirst;
    vi.mocked(getTextBookmarks)
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockResolvedValueOnce(serverState(2, [20], 20));

    const { result, rerender } = renderBookmarks(1);
    rerender({ textId: 2 });
    await waitFor(() => expect(result.current.bookmarkedIndices).toEqual([20]));

    await act(async () => {
      resolveFirst(serverState(1, [10], 10));
    });

    expect(result.current.bookmarkedIndices).toEqual([20]);
    expect(result.current.lastBookmarkedIndex).toBe(20);
  });

  test('is not ready for a new text until its own answer arrives', async () => {
    const { result, rerender } = renderBookmarks(1);
    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));

    vi.mocked(getTextBookmarks).mockReturnValue(new Promise(() => {}));
    rerender({ textId: 2 });

    expect(result.current.bookmarksReady).toBe(false);
  });

  test('toggleBookmarkForIndex updates state at once and saves to the server', async () => {
    const { result } = renderBookmarks('42');
    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));

    act(() => {
      result.current.toggleBookmarkForIndex(2);
    });
    expect(result.current.bookmarkedIndices).toEqual([2]);
    expect(result.current.lastBookmarkedIndex).toBe(2);
    expect(setTextBookmark).toHaveBeenLastCalledWith(42, 2, true);

    act(() => {
      result.current.toggleBookmarkForIndex(2);
    });
    expect(result.current.bookmarkedIndices).toEqual([]);
    expect(setTextBookmark).toHaveBeenLastCalledWith(42, 2, false);
  });

  test('a toggle wins over a load that was still in flight', async () => {
    let resolveLoad;
    vi.mocked(getTextBookmarks).mockImplementationOnce(
      () => new Promise((resolve) => { resolveLoad = resolve; })
    );
    const { result } = renderBookmarks(42);
    await waitFor(() => expect(getTextBookmarks).toHaveBeenCalled());

    act(() => {
      result.current.toggleBookmarkForIndex(5);
    });
    await act(async () => {
      resolveLoad(serverState(42, [], null));
    });

    expect(result.current.bookmarkedIndices).toEqual([5]);
    expect(result.current.bookmarksReady).toBe(true);
  });

  test('reloads from the server when saving a toggle is rejected', async () => {
    const { result } = renderBookmarks(42);
    await waitFor(() => expect(result.current.bookmarksReady).toBe(true));
    vi.mocked(setTextBookmark).mockRejectedValueOnce(Object.assign(new Error('gone'), { name: 'ApiError', status: 404 }));
    vi.mocked(getTextBookmarks).mockResolvedValue(serverState(42, [], null));

    act(() => {
      result.current.toggleBookmarkForIndex(3);
    });
    expect(result.current.bookmarkedIndices).toEqual([3]);

    await waitFor(() => expect(result.current.bookmarkedIndices).toEqual([]));
  });

  test('handleSentenceContextMenu skips toggle on mobile', () => {
    const { result } = renderBookmarks(9, { isMobile: true });

    const fakeEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleSentenceContextMenu(fakeEvent, 0);
    });
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.bookmarkedIndices).toEqual([]);
    expect(setTextBookmark).not.toHaveBeenCalled();
  });

  test('handleSentenceContextMenu skips toggle when text is actively selected', () => {
    const { result } = renderBookmarks(9, { hasActiveTextSelection: () => true });

    const fakeEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleSentenceContextMenu(fakeEvent, 0);
    });
    expect(result.current.bookmarkedIndices).toEqual([]);
    expect(setTextBookmark).not.toHaveBeenCalled();
  });

  test('shows the cached bookmarks of the new text when textId changes', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 1: [10], 2: [20, 30] }));
    vi.mocked(getTextBookmarks).mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderBookmarks(1);
    expect(result.current.bookmarkedIndices).toEqual([10]);

    rerender({ textId: 2 });
    expect(result.current.bookmarkedIndices).toEqual([20, 30]);
  });

  test('clears bookmarks when textId becomes null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 5: [1, 2] }));
    vi.mocked(getTextBookmarks).mockReturnValue(new Promise(() => {}));
    const { result, rerender } = renderBookmarks(5);
    expect(result.current.bookmarkedIndices).toEqual([1, 2]);

    rerender({ textId: null });
    expect(result.current.bookmarkedIndices).toEqual([]);
    expect(result.current.lastBookmarkedIndex).toBeNull();
    expect(result.current.bookmarksReady).toBe(false);
  });
});
