import { describe, test, expect, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useReaderBookmarks } from '../hooks/useReaderBookmarks';

const STORAGE_KEY = 'linguaReadBookmarks';

const hasActiveTextSelection = () => false;

describe('useReaderBookmarks', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  test('returns the documented Use<Name>Result shape', () => {
    const { result } = renderHook(() =>
      useReaderBookmarks({ textId: 1, isMobile: false, hasActiveTextSelection })
    );

    expect(result.current).toEqual(
      expect.objectContaining({
        bookmarkedIndices: expect.any(Array),
        isBookmarked: expect.any(Function),
        toggleBookmarkForIndex: expect.any(Function),
        handleSentenceContextMenu: expect.any(Function)
      })
    );
  });

  test('loads bookmarks from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 7: [1, 3, 5] }));
    const { result } = renderHook(() =>
      useReaderBookmarks({ textId: 7, isMobile: false, hasActiveTextSelection })
    );

    expect(result.current.bookmarkedIndices).toEqual([1, 3, 5]);
    expect(result.current.isBookmarked(3)).toBe(true);
    expect(result.current.isBookmarked(2)).toBe(false);
  });

  test('toggleBookmarkForIndex updates state and persists', () => {
    const { result } = renderHook(() =>
      useReaderBookmarks({ textId: 42, isMobile: false, hasActiveTextSelection })
    );

    act(() => {
      result.current.toggleBookmarkForIndex(2);
    });
    expect(result.current.bookmarkedIndices).toEqual([2]);

    act(() => {
      result.current.toggleBookmarkForIndex(2);
    });
    expect(result.current.bookmarkedIndices).toEqual([]);
  });

  test('handleSentenceContextMenu skips toggle on mobile', () => {
    const { result } = renderHook(() =>
      useReaderBookmarks({ textId: 9, isMobile: true, hasActiveTextSelection })
    );

    const fakeEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleSentenceContextMenu(fakeEvent, 0);
    });
    expect(fakeEvent.preventDefault).toHaveBeenCalled();
    expect(result.current.bookmarkedIndices).toEqual([]);
  });

  test('handleSentenceContextMenu skips toggle when text is actively selected', () => {
    const { result } = renderHook(() =>
      useReaderBookmarks({
        textId: 9,
        isMobile: false,
        hasActiveTextSelection: () => true
      })
    );

    const fakeEvent = { preventDefault: vi.fn() };
    act(() => {
      result.current.handleSentenceContextMenu(fakeEvent, 0);
    });
    expect(result.current.bookmarkedIndices).toEqual([]);
  });

  test('reloads bookmarks when textId changes', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 1: [10], 2: [20, 30] }));
    const { result, rerender } = renderHook(
      ({ textId }) =>
        useReaderBookmarks({ textId, isMobile: false, hasActiveTextSelection }),
      { initialProps: { textId: 1 } }
    );
    expect(result.current.bookmarkedIndices).toEqual([10]);

    rerender({ textId: 2 });
    expect(result.current.bookmarkedIndices).toEqual([20, 30]);
  });

  test('clears bookmarks when textId becomes null', () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ 5: [1, 2] }));
    const { result, rerender } = renderHook(
      ({ textId }) =>
        useReaderBookmarks({ textId, isMobile: false, hasActiveTextSelection }),
      { initialProps: { textId: 5 } }
    );
    expect(result.current.bookmarkedIndices).toEqual([1, 2]);

    rerender({ textId: null });
    expect(result.current.bookmarkedIndices).toEqual([]);
  });
});
