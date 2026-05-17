import React, { useCallback, useEffect, useState } from 'react';
import {
  getBookmarkedSentences,
  toggleBookmark as toggleBookmarkInStorage
} from '../utils/bookmarks';

export type UseReaderBookmarksArgs = {
  textId: number | string | null | undefined;
  isMobile: boolean;
  hasActiveTextSelection: () => boolean;
};

export type UseReaderBookmarksResult = {
  bookmarkedIndices: number[];
  isBookmarked: (sentenceIndex: number) => boolean;
  toggleBookmarkForIndex: (sentenceIndex: number) => void;
  handleSentenceContextMenu: (
    event: React.MouseEvent,
    sentenceIndex: number
  ) => void;
};

export const useReaderBookmarks = ({
  textId,
  isMobile,
  hasActiveTextSelection
}: UseReaderBookmarksArgs): UseReaderBookmarksResult => {
  const [bookmarkedIndices, setBookmarkedIndices] = useState<number[]>([]);

  useEffect(() => {
    if (!textId) {
      setBookmarkedIndices([]);
      return;
    }
    setBookmarkedIndices(getBookmarkedSentences(textId));
  }, [textId]);

  const isBookmarked = useCallback(
    (sentenceIndex: number) => bookmarkedIndices.includes(sentenceIndex),
    [bookmarkedIndices]
  );

  const toggleBookmarkForIndex = useCallback(
    (sentenceIndex: number) => {
      if (!textId || typeof sentenceIndex !== 'number' || sentenceIndex < 0) return;
      toggleBookmarkInStorage(textId, sentenceIndex);
      setBookmarkedIndices(getBookmarkedSentences(textId));
    },
    [textId]
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
    isBookmarked,
    toggleBookmarkForIndex,
    handleSentenceContextMenu
  };
};
