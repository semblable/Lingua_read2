const BOOKMARKS_STORAGE_KEY = 'linguaReadBookmarks';

type BookmarksByText = Record<string, number[]>;

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
 * Toggles a bookmark for a specific sentence in a text.
 * Adds the sentence index if not present, removes it if present.
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
    allBookmarks[stringTextId] = currentBookmarks.filter((idx) => idx !== sentenceIndex);
    if (allBookmarks[stringTextId].length === 0) {
      delete allBookmarks[stringTextId];
    }
  } else {
    allBookmarks[stringTextId] = [...currentBookmarks, sentenceIndex].sort((a, b) => a - b);
  }

  saveAllBookmarks(allBookmarks);
};
