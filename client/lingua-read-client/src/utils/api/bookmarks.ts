import { fetchApi } from './client';
import type { ResponseOf, RequestBodyOf } from '../fetchApi';
import { enqueueIfOffline } from '../offline/enqueueIfOffline';

export type TextBookmarks = ResponseOf<'/api/bookmarks/{textId}', 'get'>;
export type ImportBookmarksInput = RequestBodyOf<'/api/bookmarks/import', 'post'>;
export type ImportBookmarksResult = ResponseOf<'/api/bookmarks/import', 'post'>;

export const getTextBookmarks = (textId: number | string): Promise<TextBookmarks> =>
  fetchApi<TextBookmarks>(`/bookmarks/${textId}`);

// Adds or removes one sentence bookmark. The timestamp is taken once here and
// replayed as-is by the offline queue, so a toggle that drains late loses to a
// newer one made on another device. Coalesced per sentence: an offline add then
// remove replays only the final state.
export const setTextBookmark = async (
  textId: number,
  sentenceIndex: number,
  bookmarked: boolean
) => {
  const clientUpdatedAt = new Date().toISOString();
  return await enqueueIfOffline(
    {
      type: 'bookmarkSet',
      payload: { textId, sentenceIndex, bookmarked, clientUpdatedAt }
    },
    () => fetchApi<TextBookmarks>(`/bookmarks/${textId}/${sentenceIndex}`, {
      method: 'PUT',
      body: JSON.stringify({ bookmarked, clientUpdatedAt })
    }),
    `bookmark:${textId}:${sentenceIndex}`
  );
};

// One-time upload of bookmarks that older builds kept only in localStorage.
export const importLegacyBookmarks = (
  payload: ImportBookmarksInput
): Promise<ImportBookmarksResult> =>
  fetchApi<ImportBookmarksResult>('/bookmarks/import', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
