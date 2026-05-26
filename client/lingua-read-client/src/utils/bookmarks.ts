const BOOKMARKS_STORAGE_KEY = 'linguaReadBookmarks';
const LAST_BOOKMARK_STORAGE_KEY = 'linguaReadLastBookmark';

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
