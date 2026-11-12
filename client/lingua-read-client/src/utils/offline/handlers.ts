// Production replay handlers for the offline sync queue. The drain() function
// is kept handler-agnostic so the unit tests can supply mocks; this file is the
// single place where the real API helpers are imported.

import { fetchApi as request, type FetchApiOptions } from '../api/client';
import type { SyncHandlers } from './syncQueue';
import { notifyStudyChange } from '../studyIntent';

const fetchApi = (endpoint: string, options: FetchApiOptions) =>
  request(endpoint, { ...options, suppressAuthRedirect: true });

export const productionSyncHandlers: SyncHandlers = {
  srsReview: async ({ payload }) => {
    await fetchApi(`/srs/review?timezoneOffsetMinutes=${payload.timezoneOffsetMinutes ?? 0}`, {
      method: 'POST',
      body: JSON.stringify({
        srsCardReviewId: payload.cardId,
        grade: payload.grade,
        clientEventId: payload.clientEventId,
        reviewedAt: payload.reviewedAt,
      }),
    });
  },
  wordStatusUpdate: async ({ payload }) => {
    await fetchApi(`/words/${payload.wordId}`, {
      method: 'PUT',
      body: JSON.stringify({ status: payload.status, ...(payload.translation !== undefined ? { translation: payload.translation } : {}) }),
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
        ...(payload.translation !== undefined ? { translation: payload.translation } : {}),
        sentence: payload.sentence,
        ...(payload.replaceExisting ? { replaceExisting: true } : {}),
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
        ...(payload.lesson ? { lesson: payload.lesson } : {}),
      }),
    });
    if (payload.lesson) notifyStudyChange(payload.lesson.textId);
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
  bookmarkSet: async ({ payload }) => {
    await fetchApi(`/bookmarks/${payload.textId}/${payload.sentenceIndex}`, {
      method: 'PUT',
      body: JSON.stringify({
        bookmarked: payload.bookmarked,
        clientUpdatedAt: payload.clientUpdatedAt,
      }),
    });
  },
};
