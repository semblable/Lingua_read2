// Production replay handlers for the offline sync queue. The drain() function
// is kept handler-agnostic so the unit tests can supply mocks; this file is the
// single place where the real API helpers are imported.

import { fetchApi } from '../api/client';
import type { SyncHandlers } from './syncQueue';

export const productionSyncHandlers: SyncHandlers = {
  srsReview: async ({ payload }) => {
    await fetchApi('/srs/review', {
      method: 'POST',
      body: JSON.stringify({ srsCardReviewId: payload.cardId, grade: payload.grade }),
    });
  },
  wordStatusUpdate: async ({ payload }) => {
    // Omit translation: a status-only replay must not overwrite the saved
    // translation. The backend treats a missing/empty translation as
    // "leave unchanged".
    await fetchApi(`/words/${payload.wordId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: payload.status }),
    });
  },
  wordCreate: async ({ payload }) => {
    await fetchApi('/words', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        textId: payload.textId,
        term: payload.term,
        status: payload.status ?? 1,
        translation: payload.translation ?? '',
      }),
    });
  },
  // Replay handlers reconstruct the request directly from the stored payload —
  // they must NOT call the wrapped API helpers, which would mint a fresh
  // clientEventId / clientUpdatedAt and defeat the server-side dedup + guard.
  logListening: async ({ payload }) => {
    await fetchApi('/activity/logListening', {
      method: 'POST',
      body: JSON.stringify({
        languageId: payload.languageId,
        durationSeconds: payload.durationSeconds,
        clientEventId: payload.clientEventId,
      }),
    });
  },
  audiobookProgress: async ({ payload }) => {
    await fetchApi('/activity/audiobookprogress', {
      method: 'PUT',
      body: JSON.stringify({
        bookId: payload.bookId,
        currentAudiobookTrackId: payload.trackId,
        currentAudiobookPosition: payload.position,
        clientUpdatedAt: payload.clientUpdatedAt,
      }),
    });
  },
  audioLessonProgress: async ({ payload }) => {
    await fetchApi('/activity/audiolessonprogress', {
      method: 'PUT',
      body: JSON.stringify({
        textId: payload.textId,
        currentPosition: payload.position,
        clientUpdatedAt: payload.clientUpdatedAt,
      }),
    });
  },
  sentenceRead: async ({ payload }) => {
    await fetchApi('/activity/logSentenceRead', {
      method: 'POST',
      body: JSON.stringify({
        textId: payload.textId,
        currentSegmentIndex: payload.currentSegmentIndex,
        segments: payload.segments,
      }),
    });
  },
  lastRead: async ({ payload }) => {
    await fetchApi(`/books/${payload.bookId}/lastread`, {
      method: 'PUT',
      body: JSON.stringify({
        textId: payload.textId,
        clientUpdatedAt: payload.clientUpdatedAt,
      }),
    });
  },
};
