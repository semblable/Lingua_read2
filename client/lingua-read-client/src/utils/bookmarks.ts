// Local copy of the reader's sentence bookmarks. The server holds the real
// set (api/bookmarks.ts); this cache gives an instant first paint and works
// offline, and the reader overwrites a text's entry with server state once it
// loads. Builds before bookmark sync kept bookmarks ONLY here, so until
// bookmarkSync.migrateLegacyBookmarks has uploaded them once (marker key below),
// nothing may overwrite or clear this data.
const BOOKMARKS_STORAGE_KEY = 'linguaReadBookmarks';
const LAST_BOOKMARK_STORAGE_KEY = 'linguaReadLastBookmark';
const LEGACY_IMPORTED_STORAGE_KEY = 'linguaReadBookmarksImported';

type BookmarksByText = Record<string, number[]>;
type LastBookmarkByText = Record<string, number>;

const getAllBookmarks = (): BookmarksByText => {
  try {
    const storedBookmarks = localStorage.getItem(BOOKMARKS_STORAGE_KEY);
    return storedBookmarks ? JSON.parse(storedBookmarks) : {};
  } catch (error) {
    console.error('Error reading bookmarks from localStorage:', error);
    return {};
  }
};

const saveAllBookmarks = (allBookmarks: BookmarksByText): void => {
  try {
    localStorage.setItem(BOOKMARKS_STORAGE_KEY, JSON.stringify(allBookmarks));
  } catch (error) {
    console.error('Error saving bookmarks to localStorage:', error);
  }
};

const getAllLastBookmarks = (): LastBookmarkByText => {
  try {
    const stored = localStorage.getItem(LAST_BOOKMARK_STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (error) {
    console.error('Error reading last bookmark from localStorage:', error);
    return {};
  }
};

const saveAllLastBookmarks = (map: LastBookmarkByText): void => {
  try {
    localStorage.setItem(LAST_BOOKMARK_STORAGE_KEY, JSON.stringify(map));
  } catch (error) {
    console.error('Error saving last bookmark to localStorage:', error);
  }
};

/**
 * Returns the array of bookmarked sentence indices for a specific text,
 * or an empty array if none exist.
 */
export const getBookmarkedSentences = (
  textId: string | number | null | undefined
): number[] => {
  if (!textId) return [];
  const allBookmarks = getAllBookmarks();
  return allBookmarks[String(textId)] || [];
};

/**
 * Returns the sentence index that should be used as a save-place anchor
 * for the given text (the most recently added bookmark), or null if none.
 */
export const getLastBookmarkedSentence = (
  textId: string | number | null | undefined
): number | null => {
  if (!textId) return null;
  const map = getAllLastBookmarks();
  const value = map[String(textId)];
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
};

export const setLastBookmarkedSentence = (
  textId: string | number | null | undefined,
  sentenceIndex: number
): void => {
  if (!textId || typeof sentenceIndex !== 'number' || sentenceIndex < 0) return;
  const map = getAllLastBookmarks();
  map[String(textId)] = sentenceIndex;
  saveAllLastBookmarks(map);
};

export const clearLastBookmarkedSentence = (
  textId: string | number | null | undefined
): void => {
  if (!textId) return;
  const map = getAllLastBookmarks();
  if (Object.prototype.hasOwnProperty.call(map, String(textId))) {
    delete map[String(textId)];
    saveAllLastBookmarks(map);
  }
};

/**
 * Toggles a bookmark for a specific sentence in a text.
 * Adds the sentence index if not present, removes it if present.
 * Also maintains a "last bookmarked sentence" anchor used for scroll-on-load.
 */
export const toggleBookmark = (
  textId: string | number | null | undefined,
  sentenceIndex: number
): void => {
  if (!textId || typeof sentenceIndex !== 'number' || sentenceIndex < 0) return;

  const stringTextId = String(textId);
  const allBookmarks = getAllBookmarks();
  const currentBookmarks = allBookmarks[stringTextId] || [];
  const indexExists = currentBookmarks.includes(sentenceIndex);

  if (indexExists) {
    const remaining = currentBookmarks.filter((idx) => idx !== sentenceIndex);
    if (remaining.length === 0) {
      delete allBookmarks[stringTextId];
    } else {
      allBookmarks[stringTextId] = remaining;
    }

    const lastMap = getAllLastBookmarks();
    if (lastMap[stringTextId] === sentenceIndex) {
      if (remaining.length === 0) {
        delete lastMap[stringTextId];
      } else {
        lastMap[stringTextId] = Math.max(...remaining);
      }
      saveAllLastBookmarks(lastMap);
    }
  } else {
    allBookmarks[stringTextId] = [...currentBookmarks, sentenceIndex].sort((a, b) => a - b);
    setLastBookmarkedSentence(stringTextId, sentenceIndex);
  }

  saveAllBookmarks(allBookmarks);
};

/**
 * Overwrites one text's cached bookmarks with the server's state.
 */
export const setCachedBookmarks = (
  textId: string | number | null | undefined,
  sentenceIndices: number[],
  lastSentenceIndex: number | null
): void => {
  if (!textId) return;
  const stringTextId = String(textId);

  const allBookmarks = getAllBookmarks();
  if (sentenceIndices.length === 0) {
    delete allBookmarks[stringTextId];
  } else {
    allBookmarks[stringTextId] = [...sentenceIndices].sort((a, b) => a - b);
  }
  saveAllBookmarks(allBookmarks);

  const lastMap = getAllLastBookmarks();
  if (lastSentenceIndex == null) {
    delete lastMap[stringTextId];
  } else {
    lastMap[stringTextId] = lastSentenceIndex;
  }
  saveAllLastBookmarks(lastMap);
};

/** Every cached text's bookmarks plus its last-bookmark anchor, for the one-time import. */
export const getAllCachedBookmarks = (): Array<{
  textId: string;
  sentenceIndices: number[];
  lastSentenceIndex: number | null;
}> => {
  const lastMap = getAllLastBookmarks();
  return Object.entries(getAllBookmarks()).map(([textId, sentenceIndices]) => ({
    textId,
    sentenceIndices: Array.isArray(sentenceIndices) ? sentenceIndices : [],
    lastSentenceIndex: typeof lastMap[textId] === 'number' ? lastMap[textId] : null
  }));
};

export const isLegacyBookmarkImportDone = (): boolean => {
  try {
    return localStorage.getItem(LEGACY_IMPORTED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

export const markLegacyBookmarkImportDone = (): void => {
  try {
    localStorage.setItem(LEGACY_IMPORTED_STORAGE_KEY, '1');
  } catch (error) {
    console.error('Error saving bookmark import marker to localStorage:', error);
  }
};

/**
 * Drops the local bookmark cache (logout). Skipped while the one-time import
 * is still pending: then this is the only copy of those bookmarks.
 */
export const clearCachedBookmarks = (): void => {
  if (!isLegacyBookmarkImportDone()) return;
  try {
    localStorage.removeItem(BOOKMARKS_STORAGE_KEY);
    localStorage.removeItem(LAST_BOOKMARK_STORAGE_KEY);
  } catch (error) {
    console.error('Error clearing bookmarks from localStorage:', error);
  }
};
