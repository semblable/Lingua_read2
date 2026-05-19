import { describe, test, expect, beforeEach, vi } from 'vitest';

const mockLocalStorage = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => (key in store ? store[key] : null)),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = String(value);
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    _getStore: () => store,
    _setStore: (next: Record<string, string>) => {
      store = next;
    }
  };
})();

Object.defineProperty(window, 'localStorage', { value: mockLocalStorage, configurable: true });

import { getBookmarkedSentences, toggleBookmark } from '../utils/bookmarks';

const KEY = 'linguaReadBookmarks';

describe('getBookmarkedSentences', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  test('returns an empty array for null/undefined/falsy textId', () => {
    expect(getBookmarkedSentences(null)).toEqual([]);
    expect(getBookmarkedSentences(undefined)).toEqual([]);
    expect(getBookmarkedSentences(0)).toEqual([]);
    expect(getBookmarkedSentences('')).toEqual([]);
  });

  test('returns an empty array when storage is empty', () => {
    expect(getBookmarkedSentences(7)).toEqual([]);
  });

  test('coerces numeric and string textId to the same key', () => {
    mockLocalStorage.setItem(KEY, JSON.stringify({ '7': [1, 2] }));
    expect(getBookmarkedSentences(7)).toEqual([1, 2]);
    expect(getBookmarkedSentences('7')).toEqual([1, 2]);
  });

  test('returns the stored indices for a populated textId', () => {
    mockLocalStorage.setItem(KEY, JSON.stringify({ '7': [3, 1, 2] }));
    expect(getBookmarkedSentences(7)).toEqual([3, 1, 2]);
  });

  test('returns empty array and logs when storage holds invalid JSON', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLocalStorage.setItem(KEY, '{not json');
    expect(getBookmarkedSentences(7)).toEqual([]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe('toggleBookmark', () => {
  beforeEach(() => {
    mockLocalStorage.clear();
    vi.clearAllMocks();
  });

  test('rejects falsy textId silently', () => {
    toggleBookmark(null, 1);
    toggleBookmark(undefined, 1);
    toggleBookmark(0, 1);
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
  });

  test('rejects non-number / negative sentenceIndex silently', () => {
    toggleBookmark(7, -1);
    toggleBookmark(7, 'foo' as unknown as number);
    expect(mockLocalStorage.setItem).not.toHaveBeenCalled();
  });

  test('adds a new index, maintaining sorted order', () => {
    toggleBookmark(7, 2);
    toggleBookmark(7, 0);
    toggleBookmark(7, 1);
    expect(getBookmarkedSentences(7)).toEqual([0, 1, 2]);
  });

  test('removes an existing index', () => {
    toggleBookmark(7, 1);
    toggleBookmark(7, 2);
    toggleBookmark(7, 1);
    expect(getBookmarkedSentences(7)).toEqual([2]);
  });

  test('deletes the entry entirely when the last index is removed', () => {
    toggleBookmark(7, 1);
    toggleBookmark(7, 1);
    const stored = JSON.parse(mockLocalStorage.getItem(KEY) || '{}');
    expect(stored['7']).toBeUndefined();
  });

  test('survives setItem throwing without raising', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockLocalStorage.setItem.mockImplementationOnce(() => {
      throw new Error('quota exceeded');
    });
    expect(() => toggleBookmark(7, 1)).not.toThrow();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('isolates bookmarks per textId', () => {
    toggleBookmark(7, 1);
    toggleBookmark(8, 5);
    expect(getBookmarkedSentences(7)).toEqual([1]);
    expect(getBookmarkedSentences(8)).toEqual([5]);
  });
});
